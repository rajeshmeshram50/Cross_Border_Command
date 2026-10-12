import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useScrollLock } from '../../../hooks/useScrollLock';
import { useToast } from '../../../contexts/ToastContext';
/* The stylesheets this form is dressed by. It carries its own rather than
   relying on the page that opens it — the grid, the hints and the field errors
   all live in these two, and a form that borrows them without importing them
   loses its layout silently. */
import '../../p2p/p2p-detail.css';
import '../../p2p/purchase-management/order/create-po/create-po.css';
import '../warehouse/warehouse-master.css';
import '../zone/zone-form.css';
import './rack-form.css';
import { Field, EditSelect } from '../../p2p/purchase-management/order/create-po/form-fields';
import { WAREHOUSES } from '../warehouse/warehouse-data';
import { ZONES } from '../zone/zone-data';
import { RACKS, type Rack } from './rack-data';

/* Only an active warehouse can take a new rack. */
const ACTIVE_WAREHOUSES = WAREHOUSES.filter(w => w.status !== 'inactive');
const LABEL = (id: string, name: string) => `${id} · ${name}`;
/** The code back out of a "WH-002 · Pune Phase 2 Warehouse" label. */
const codeOf = (label: string) => label.split('·')[0].trim();

const inGrouping = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });
const inWhole = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });

/** A square metre in square feet, for carrying the footprint into Sq. Ft. */
const SQFT_PER_SQM = 10.7639;

/** `+15 to +25 °C`, as the design writes a range. */
const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

/* ── Icons: the prototype's own paths ─────────────────────────────────── */
const Ico = (d: ReactNode, size = 14) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>
);
const IcoWarehouse = (p: { size?: number }) => Ico(
  <><path d="M3 21V9l9-6 9 6v12" /><path d="M9 21v-7h6v7" /><line x1="3" y1="21" x2="21" y2="21" /></>,
  p.size ?? 15,
);
const IcoZone = (p: { size?: number }) => Ico(
  <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" />
    <rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
  p.size ?? 15,
);
const IcoRack = (p: { size?: number }) => Ico(
  <><rect x="4" y="2" width="16" height="20" rx="1.5" /><line x1="4" y1="8" x2="20" y2="8" />
    <line x1="4" y1="14" x2="20" y2="14" /></>,
  p.size ?? 15,
);
const IcoX = () => Ico(<><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></>, 16);
const IcoCheck = () => Ico(<polyline points="20 6 9 17 4 12" />, 14);
const IcoInfo = () => Ico(
  <><circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" />
    <line x1="12" y1="8" x2="12.01" y2="8" /></>, 13,
);

type Unit = 'cm' | 'm';

interface Draft {
  wh: string;
  zone: string;
  name: string;
  cold: boolean;
  haz: boolean;
  len: string;
  wid: string;
  ht: string;
}

const EMPTY: Draft = { wh: '', zone: '', name: '', cold: false, haz: false, len: '', wid: '', ht: '' };

/**
 * Add / Edit Rack.
 *
 * Design only, on the static rows: nothing is persisted, and Save reports what
 * it would have written.
 *
 * The form is a cascade — warehouse, then zone, then the rack. Everything in
 * the first two cards is read-only and fetched, because a rack does not get to
 * redescribe the building it stands in. The two flags are the one place the
 * cascade bites: a rack can only be cold or hazardous if its ZONE allows it,
 * so the switches are disabled by the zone rather than validated after the
 * fact.
 */
export default function AddRackModal({ rack, onClose }: {
  rack?: Rack;
  onClose: () => void;
}) {
  useScrollLock(true, '.whm-addmdl');
  const toast = useToast();
  const editing = !!rack;

  const cardRef = useRef<HTMLDivElement>(null);
  useEffect(() => { cardRef.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const [unit, setUnit] = useState<Unit>(rack?.dims.unit ?? 'cm');
  const [d, setD] = useState<Draft>(() => {
    if (!rack) return EMPTY;
    const w = WAREHOUSES.find(x => x.id === rack.wh);
    const z = ZONES.find(x => x.id === rack.zone);
    return {
      wh: w ? LABEL(w.id, w.name) : '',
      zone: z ? LABEL(z.id, z.name) : '',
      name: rack.name,
      cold: rack.cold,
      haz: rack.haz,
      len: String(rack.dims.length),
      wid: String(rack.dims.width),
      ht: String(rack.dims.height),
    };
  });
  const [errors, setErrors] = useState<Partial<Record<keyof Draft, string>>>({});

  const set = (p: Partial<Draft>) => setD(s => ({ ...s, ...p }));
  const clear = (k: keyof Draft) => setErrors(e => (e[k] ? { ...e, [k]: undefined } : e));

  const picked = useMemo(
    () => (d.wh ? WAREHOUSES.find(w => w.id === codeOf(d.wh)) ?? null : null),
    [d.wh],
  );

  /* Racks only stand in rack-based zones, so the list is filtered rather than
     validated — offering a floor zone and then refusing it is a worse way to
     say the same thing. */
  const zoneChoices = useMemo(
    () => (picked ? ZONES.filter(z => z.wh === picked.id && z.type === 'rack' && z.status !== 'inactive') : []),
    [picked],
  );
  const zone = useMemo(
    () => (d.zone ? ZONES.find(z => z.id === codeOf(d.zone)) ?? null : null),
    [d.zone],
  );

  /* The next free code. In the prototype this is the server's job; here it is
     one past the highest, so it does not repeat a code already on screen. */
  const id = useMemo(() => {
    if (rack) return rack.id;
    const top = RACKS.reduce((n, r) => Math.max(n, Number(r.id.slice(3)) || 0), 0);
    return `RC-${String(top + 1).padStart(3, '0')}`;
  }, [rack]);

  /* The footprint, in the unit being typed in and in square feet. Recomputed
     rather than stored: two numbers for one area can only ever disagree. */
  const area = useMemo(() => {
    const L = parseFloat(d.len), W = parseFloat(d.wid);
    if (!(L > 0) || !(W > 0)) return null;
    const a = L * W;
    const sqm = unit === 'm' ? a : a / 10000;
    return { raw: a, sqft: sqm * SQFT_PER_SQM };
  }, [d.len, d.wid, unit]);

  /* Switching Cm ⇄ Metres converts what is typed rather than clearing it:
     the figures are the same rack either way, and retyping three numbers to
     change a label is work the form can do. */
  const switchUnit = (next: Unit) => {
    if (next === unit) return;
    const k = next === 'm' ? 0.01 : 100;
    const conv = (v: string) => {
      const n = parseFloat(v);
      return Number.isFinite(n) ? String(Math.round(n * k * 1000) / 1000) : v;
    };
    setD(s => ({ ...s, len: conv(s.len), wid: conv(s.wid), ht: conv(s.ht) }));
    setUnit(next);
  };

  const save = () => {
    const e: Partial<Record<keyof Draft, string>> = {};
    if (!d.wh) e.wh = 'Choose a warehouse';
    if (!d.zone) e.zone = picked ? 'Choose a zone' : 'Choose a warehouse first';
    if (!d.name.trim()) e.name = 'Enter a rack name';
    (['len', 'wid', 'ht'] as const).forEach(k => {
      const n = parseFloat(d[k]);
      if (!(n > 0)) e[k] = 'Required';
    });
    setErrors(e);
    const first = Object.keys(e)[0];
    if (first) {
      toast.warning('Rack not saved', e[first as keyof Draft] ?? 'Check the highlighted fields.');
      return;
    }
    toast.success(
      editing ? `${id} updated` : `${id} saved`,
      `${d.name} in ${codeOf(d.zone)} · ${codeOf(d.wh)}. Nothing is stored yet — this screen is design only.`,
    );
    onClose();
  };

  return createPortal(
    <div className="spi-mdl-backdrop whm-backdrop"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        /* `whm-page` carries the shared toggle style, which is scoped to it
           and so never reached this portalled dialog — the two flag switches
           were rendering as bare buttons. */
        className="spi-mdl whm-addmdl rkm-addmdl whm-page"
        role="dialog" aria-modal="true" aria-labelledby="rkm-add-title"
        tabIndex={-1} ref={cardRef}
      >
        <div className="spi-mdl-head">
          <div className="spi-mdl-head-left">
            <div className="spi-mdl-head-ico"><IcoRack size={22} /></div>
            <div>
              <div className="spi-mdl-title" id="rkm-add-title">
                {editing ? 'Edit Rack' : 'Add Rack'}
              </div>
              <div className="spi-mdl-sub">
                Create a rack inside a storage zone (with rack) with its handling flags and dimensions.
              </div>
            </div>
          </div>
          <button type="button" className="spi-mdl-x" onClick={onClose} aria-label="Close"><IcoX /></button>
        </div>

        <div className="spi-mdl-body whm-addbody">

          {/* ── Warehouse ─────────────────────────────────────────────── */}
          <Card icon={<IcoWarehouse />} title="Warehouse Details">
            {/* No hints anywhere in this form: the design passes none, and in
                a grid of four columns a hint under one field lifts the whole
                row's height for a sentence that is true of every warehouse
                list in the app. Errors still take that slot. */}
            <Field label="Warehouse" req error={errors.wh}>
              <EditSelect
                value={d.wh}
                options={ACTIVE_WAREHOUSES.map(w => LABEL(w.id, w.name))}
                placeholder="Select warehouse"
                invalid={!!errors.wh}
                /* Changing the building invalidates the zone under it, so the
                   zone is dropped rather than left pointing elsewhere. */
                onChange={v => { set({ wh: v, zone: '', cold: false, haz: false }); clear('wh'); clear('zone'); }}
              />
            </Field>
            <AutoField label="Warehouse Type" from="warehouse"
              value={picked ? (picked.type === 'own' ? 'Own Warehouse' : 'Third Party (3PL)') : ''} />
            <AutoField label="Warehouse Area (Sq. Ft)" from="warehouse"
              value={picked ? inWhole.format(picked.area) : ''} />
            <AutoField label="Location" from="warehouse"
              value={picked ? [picked.city, picked.state, picked.pin].filter(Boolean).join(', ') : ''} />
          </Card>

          {/* ── Zone ──────────────────────────────────────────────────── */}
          <Card icon={<IcoZone />} title="Zone Details">
            <Field
              label={<>Zone <span className="rkm-lbltag">With Rack only</span></>}
              req
              /* "No rack zones in WH-002" is not a hint, it is why the list
                 is empty — so it goes in the error slot, which is the one the
                 design keeps. */
              error={errors.zone ?? (picked && !zoneChoices.length
                ? `${picked.id} has no rack-based zones`
                : undefined)}
            >
              <EditSelect
                value={d.zone}
                options={zoneChoices.map(z => LABEL(z.id, z.name))}
                placeholder={picked ? 'Select zone' : 'Select warehouse first'}
                invalid={!!errors.zone}
                /* A rack cannot be colder or more hazardous than the zone
                   around it, so the flags reset with the zone. */
                onChange={v => { set({ zone: v, cold: false, haz: false }); clear('zone'); }}
              />
            </Field>
            <AutoField label="Zone Area (Sq. Ft)" from="zone"
              value={zone ? inWhole.format(zone.area) : ''} />
            <AutoField label="Cold Chain" from="zone"
              value={zone ? (zone.cold
                ? `Allowed${zone.tempRange ? ` · ${signed(zone.tempRange.min)} to ${signed(zone.tempRange.max)} °C` : ''}`
                : 'Not Allowed') : ''} />
            <AutoField label="Hazardous" from="zone"
              value={zone ? (zone.haz ? 'Allowed' : 'Not Allowed') : ''} />
          </Card>

          {/* ── Rack ──────────────────────────────────────────────────── */}
          <Card icon={<IcoRack />} title="Rack Details">
            <Field label="Rack ID">
              {/* Plain `whm-auto`, as the design has it: the AUTO pill already
                  goes teal when there is a value, which is the same signal
                  `is-filled` would tint the whole box to give. */}
              <div className="whm-auto">
                <input className="spi-dt-inp" value={id} readOnly tabIndex={-1} />
                <span className="whm-auto__tag">AUTO</span>
              </div>
            </Field>
            <Field label="Rack Name" req error={errors.name}>
              <input
                className={`spi-dt-inp${errors.name ? ' is-invalid' : ''}`}
                placeholder="e.g. Rack A-01" maxLength={60}
                value={d.name} onChange={e => { set({ name: e.target.value }); clear('name'); }}
              />
            </Field>
            {/* Gated by the zone, and the switch says so where it is off —
                a disabled control with no reason beside it is a dead end. */}
            <Field label="Cold Chain">
              <Switch
                on={d.cold}
                disabled={!zone?.cold}
                label={zone
                  ? zone.cold ? 'Cold chain rack' : 'Not allowed in this zone'
                  : 'Select a zone first'}
                onToggle={() => set({ cold: !d.cold })}
              />
            </Field>
            <Field label="Hazardous">
              <Switch
                on={d.haz}
                disabled={!zone?.haz}
                label={zone
                  ? zone.haz ? 'Hazardous rack' : 'Not allowed in this zone'
                  : 'Select a zone first'}
                onToggle={() => set({ haz: !d.haz })}
              />
            </Field>

            <div className="rkm-sub">
              <div className="znm-sub__hd">
                <i className="znm-sub__bar" />Rack Dimensions
                <div className="znm-unit" role="group" aria-label="Unit">
                  {(['cm', 'm'] as Unit[]).map(u => (
                    <button key={u} type="button" className={unit === u ? 'is-on' : undefined}
                      onClick={() => switchUnit(u)}>
                      {u === 'cm' ? 'Cm' : 'Metres'}
                    </button>
                  ))}
                </div>
              </div>
              <div className="spi-dt-grid4">
                {([
                  ['len', 'Length', unit === 'cm' ? 'e.g. 240' : 'e.g. 2.4'],
                  ['wid', 'Width', unit === 'cm' ? 'e.g. 100' : 'e.g. 1'],
                  ['ht', 'Height', unit === 'cm' ? 'e.g. 300' : 'e.g. 3'],
                ] as const).map(([key, label, ph]) => (
                  <Field key={key} label={label} req error={errors[key]}>
                    <div className="whm-suf">
                      <input
                        className={`spi-dt-inp${errors[key] ? ' is-invalid' : ''}`}
                        type="number" min={0} step="0.01" placeholder={ph}
                        value={d[key]}
                        onChange={e => { set({ [key]: e.target.value } as Partial<Draft>); clear(key); }}
                      />
                      <span>{unit}</span>
                    </div>
                  </Field>
                ))}
                <Field label={<>Area <span className="rkm-lbltag">Length × Width</span></>}>
                  <div className={`whm-auto${area ? ' is-filled' : ''}`}>
                    <input
                      className="spi-dt-inp"
                      value={area ? `${inGrouping.format(area.raw)} ${unit}²` : ''}
                      placeholder="Auto-calculated" readOnly tabIndex={-1}
                    />
                    <span className="whm-auto__tag">AUTO</span>
                  </div>
                </Field>
              </div>
            </div>
          </Card>
        </div>

        <div className="spi-mdl-foot">
          <span className="whm-footnote"><IcoInfo /> Fields marked * are required</span>
          <div className="spi-mdl-foot-btns">
            <button type="button" className="spi-mdl-cancel" onClick={onClose}>Cancel</button>
            <button type="button" className="spi-mdl-confirm" onClick={save}>
              <IcoCheck /> {editing ? 'Update Rack' : 'Save Rack'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** One titled card of fields. */
function Card({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="whm-card">
      <div className="whm-sec">
        <span className="whm-sec__ico">{icon}</span>
        <b>{title}</b>
      </div>
      <div className="spi-dt-grid4">{children}</div>
    </div>
  );
}

/** A field the warehouse or the zone fills in: read-only, and it says which. */
function AutoField({ label, value, from }: { label: string; value: string; from: 'warehouse' | 'zone' }) {
  return (
    <Field label={label}>
      <div className={`whm-auto znm-auto${value ? ' is-filled' : ''}`}>
        <input className="spi-dt-inp" value={value} placeholder={`Fetched from ${from}`} readOnly tabIndex={-1} />
        <span className="whm-auto__tag">AUTO</span>
      </div>
    </Field>
  );
}

/**
 * A handling flag, with the reason it cannot be set written beside it.
 *
 * Wears the zone form's own `.znm-tg` row rather than a rack-only copy of it —
 * the two forms ask the same question and should answer it the same way. Only
 * the locked state is added here, dashed, which is how the design marks a
 * control the zone has closed off.
 */
function Switch({ on, disabled, label, onToggle }: {
  on: boolean; disabled?: boolean; label: string; onToggle: () => void;
}) {
  const live = on && !disabled;
  return (
    <div
      className={`znm-tg${live ? ' is-on' : ''}${disabled ? ' is-locked' : ''}`}
      onClick={() => { if (!disabled) onToggle(); }}
    >
      <button
        type="button"
        className={`whm-toggle${live ? ' is-on' : ''}`}
        role="switch" aria-checked={live}
        aria-label={label}
        disabled={disabled}
        onClick={e => { e.stopPropagation(); onToggle(); }}
      >
        <span />
      </button>
      <span className="znm-tg__st">{label}</span>
    </div>
  );
}
