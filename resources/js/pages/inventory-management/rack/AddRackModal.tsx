import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useScrollLock } from '../../../hooks/useScrollLock';
import { useToast } from '../../../contexts/ToastContext';
import '../../p2p/p2p-detail.css';
import '../../p2p/purchase-management/order/create-po/create-po.css';
import '../warehouse/warehouse-master.css';
import '../zone/zone-form.css';
import './rack-form.css';
import { Field, EditSelect } from '../../p2p/purchase-management/order/create-po/form-fields';
import {
  InventoryApiError, rackApi, type InventoryLookups, type Rack, type RackPayload,
} from './rack-data';
import { uniqueLabels } from '../zone/zone-data';

const LABEL = (id: string, name: string) => `${id} · ${name}`;

/* How much of a name an option row can hold beside its code chip. */
const NAME_MAX = 20;
const truncate = (s: string, max: number) => (s.length > max ? `${s.slice(0, max).trimEnd()}…` : s);

/* "WH-001 · Mumbai Central Warehouse" split into the chip and the name the
   list draws. The label itself stays the option's value, so the stored draft,
   the tooltip and the search over it are untouched. The name is whatever
   follows the id, since the de-duplicating pass may have appended a city. */
function split<T extends { id: string }>(rows: T[], labelOf: (row: T) => string) {
  const codes: Record<string, string> = {};
  const names: Record<string, string> = {};
  for (const row of rows) {
    const label = labelOf(row);
    const head = `${row.id} · `;
    codes[label] = row.id;
    names[label] = truncate(label.startsWith(head) ? label.slice(head.length) : label, NAME_MAX);
  }
  return { codes, names };
}

const inGrouping = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });
const inWhole = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });

const SQFT_PER_SQM = 10.7639;

const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

const FIELD_FOR: Record<string, 'wh' | 'zone' | 'name' | 'len' | 'wid' | 'ht'> = {
  zone_id: 'zone', rack_name: 'name', length: 'len', width: 'wid', height: 'ht', dim_unit: 'len',
};

function fieldForMessage(msg: string): 'zone' | 'name' | 'len' | 'ht' | null {
  const m = msg.toLowerCase();
  if (m.includes('rack with this name')) return 'name';
  if (m.includes('footprint')) return 'len';
  if (m.includes('cannot be shorter')) return 'ht';
  if (m.includes('zone')) return 'zone';
  return null;
}

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

export default function AddRackModal({ rack, lookups, onClose, onSaved }: {
  rack?: Rack;
  lookups: InventoryLookups;
  onClose: () => void;
  onSaved?: (rack: Rack) => void;
}) {
  useScrollLock(true, '.whm-addmdl');
  const toast = useToast();
  const editing = !!rack;

  const cardRef = useRef<HTMLDivElement>(null);
  useEffect(() => { cardRef.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !saving) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  const [saving, setSaving] = useState(false);
  // Plus, on an edit, the rack's own warehouse even if since switched off — it must stay selectable.
  const activeWarehouses = useMemo(
    () => lookups.warehouses.filter(w => w.active || (!!rack && w.apiId === rack.warehouseId)),
    [lookups, rack],
  );
  const rackWarehouse = rack?.warehouseId ? lookups.warehouses.find(w => w.apiId === rack.warehouseId) : undefined;
  const rackZone = rack?.zoneId ? lookups.zones.find(z => z.apiId === rack.zoneId) : undefined;
  const whLabels = useMemo(
    () => uniqueLabels(lookups.warehouses, w => w.apiId, w => LABEL(w.id, w.name), w => w.city),
    [lookups],
  );
  const zoneLabels = useMemo(
    () => uniqueLabels(lookups.zones.filter(z => z.apiId), z => z.apiId as number, z => LABEL(z.id, z.name), z => z.whName ?? ''),
    [lookups],
  );
  /* The same cut Add Zone makes: a long warehouse name is shortened for the
     option row, while the closed field and the tooltip keep it whole. */
  const whList = useMemo(() => split(activeWarehouses, w => whLabels.get(w.apiId) ?? LABEL(w.id, w.name)),
    [activeWarehouses, whLabels]);
  /* CS-941 #2. It varies here, unlike the zone form: a rack may sit in a
     third-party warehouse, so this list is filtered on `active` alone and
     both kinds appear in it. */
  const whBadges = useMemo(() => {
    const m: Record<string, { text: string; tone: 'green' | 'gray' }> = {};
    for (const w of activeWarehouses) {
      const label = whLabels.get(w.apiId) ?? LABEL(w.id, w.name);
      m[label] = w.type === 'own'
        ? { text: 'Own Warehouse', tone: 'green' }
        : { text: 'Third Party (3PL)', tone: 'gray' };
    }
    return m;
  }, [activeWarehouses, whLabels]);

  const [unit, setUnit] = useState<Unit>(rack?.dims.unit ?? 'cm');
  const [d, setD] = useState<Draft>(() => {
    if (!rack) return EMPTY;
    return {
      wh: rackWarehouse ? whLabels.get(rackWarehouse.apiId) ?? '' : '',
      zone: rackZone?.apiId ? zoneLabels.get(rackZone.apiId) ?? '' : '',
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

  useEffect(() => {
    if (rackWarehouse && !d.wh) set({ wh: whLabels.get(rackWarehouse.apiId) ?? '' });
    if (rackZone?.apiId && !d.zone) set({ zone: zoneLabels.get(rackZone.apiId) ?? '' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rackWarehouse, rackZone]);
  const clear = (k: keyof Draft) => setErrors(e => (e[k] ? { ...e, [k]: undefined } : e));

  const picked = useMemo(
    () => (d.wh ? lookups.warehouses.find(w => whLabels.get(w.apiId) === d.wh) ?? null : null),
    [d.wh, lookups, whLabels],
  );

  const zoneChoices = useMemo(
    () => (picked
      ? lookups.zones.filter(z => z.warehouseId === picked.apiId && z.type === 'rack'
        && (z.status !== 'inactive' || z.apiId === rack?.zoneId))
      : []),
    [picked, lookups, rack],
  );
  /* The zone list is the same shape, and sits in the same card: chipping one
     and not the other would read as a list that half-loaded. */
  const zoneList = useMemo(() => split(zoneChoices, z => (z.apiId && zoneLabels.get(z.apiId)) || LABEL(z.id, z.name)),
    [zoneChoices, zoneLabels]);
  const zone = useMemo(
    () => (d.zone ? zoneChoices.find(z => z.apiId && zoneLabels.get(z.apiId) === d.zone) ?? null : null),
    [d.zone, zoneChoices, zoneLabels],
  );

  const [nextCode, setNextCode] = useState<string | null>(null);
  useEffect(() => {
    if (editing) return;
    let live = true;
    rackApi.nextCode()
      .then(code => { if (live) setNextCode(code || 'Assigned on save'); })
      .catch(() => { if (live) setNextCode('Assigned on save'); });
    return () => { live = false; };
  }, [editing]);
  const id = editing ? rack!.id : (nextCode ?? 'Loading…');

  const area = useMemo(() => {
    const L = parseFloat(d.len), W = parseFloat(d.wid);
    if (!(L > 0) || !(W > 0)) return null;
    const a = L * W;
    const sqm = unit === 'm' ? a : a / 10000;
    return { raw: a, sqft: sqm * SQFT_PER_SQM };
  }, [d.len, d.wid, unit]);

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

  const save = async () => {
    if (saving) return;
    const e: Partial<Record<keyof Draft, string>> = {};
    if (!d.wh) e.wh = 'Select the warehouse';
    if (!d.zone || !zone) e.zone = picked ? 'Select a zone (with rack)' : 'Select the warehouse first';
    if (!d.name.trim()) e.name = 'Enter the rack name';
    if (!(parseFloat(d.len) > 0)) e.len = 'Enter the length';
    if (!(parseFloat(d.wid) > 0)) e.wid = 'Enter the width';
    if (!(parseFloat(d.ht) > 0)) e.ht = 'Enter the height';
    setErrors(e);
    const first = Object.keys(e)[0];
    if (first) {
      toast.warning('Rack not saved', e[first as keyof Draft] ?? 'Check the highlighted fields.');
      return;
    }
    if (!zone?.apiId) return;

    const payload: RackPayload = {
      zone_id: zone.apiId,
      rack_name: d.name.trim(),
      cold_chain: d.cold && zone.cold ? 1 : 0,
      hazardous: d.haz && zone.haz ? 1 : 0,
      dim_unit: unit,
      length: parseFloat(d.len),
      width: parseFloat(d.wid),
      height: parseFloat(d.ht),
    };

    setSaving(true);
    try {
      const saved = editing ? await rackApi.update(rack!.apiId, payload) : await rackApi.create(payload);
      toast.success(editing ? `${saved.id} · ${saved.name} updated` : `${saved.id} · ${saved.name} added to ${zone.id}`);
      onSaved?.(saved);
      onClose();
    } catch (err) {
      if (err instanceof InventoryApiError) {
        const next: Partial<Record<keyof Draft, string>> = {};
        for (const [k, msgs] of Object.entries(err.fieldErrors)) {
          const f = FIELD_FOR[k];
          if (f && !next[f]) next[f] = msgs[0];
        }
        if (!Object.keys(next).length) {
          const f = fieldForMessage(err.message);
          if (f) next[f] = err.message;
        }
        setErrors(next);
        toast.error(editing ? 'Could not update the rack' : 'Could not create the rack', Object.values(next)[0] ?? err.message);
      } else {
        toast.error('Could not save the rack', 'Please try again.');
      }
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    /* No backdrop-click close. The form holds unsaved input, and a stray
       click outside it must not throw that away — the dialog closes only
       through the X or Cancel. */
    <div className="spi-mdl-backdrop whm-backdrop">
      <div
        className="spi-mdl whm-addmdl rkm-addmdl whm-page"
        role="dialog" aria-modal="true" aria-labelledby="rkm-add-title"
        tabIndex={-1} ref={cardRef}
      >
        {/* CS-941 #8 (loader) and #3 (form stays clickable) are one thing:
            a sheet over the dialog reports and blocks at once. */}
        {saving && (
          <div className="whm-saving" role="status" aria-live="polite">
            <span className="whm-saving__box">
              <span className="whm-saving__spin" aria-hidden />
              Saving the rack…
            </span>
          </div>
        )}
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
          <button type="button" className="spi-mdl-x" onClick={onClose} aria-label="Close"
            disabled={saving} title={saving ? 'Saving — please wait' : undefined}><IcoX /></button>
        </div>

        {/* inert as well as the sheet: the Warehouse and Zone menus portal
            to document.body, outside anything drawn in the dialog. */}
        <div className="spi-mdl-body whm-addbody" inert={saving}>

          <Card icon={<IcoWarehouse />} title="Warehouse Details">
            <Field label="Warehouse" req error={errors.wh}>
              <EditSelect
                value={d.wh}
                options={activeWarehouses.map(w => whLabels.get(w.apiId) ?? LABEL(w.id, w.name))}
                codes={whList.codes}
                shortLabels={whList.names}
                searchPlaceholder="Search warehouse ID or name"
                placeholder="Select warehouse"
                badges={whBadges}
                /* List only: the Warehouse Type box beside the field already
                   states the type of whichever one is selected. */
                listBadgesOnly
                invalid={!!errors.wh}
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

          <Card icon={<IcoZone />} title="Zone Details">
            <Field
              label={<>Zone <span className="rkm-lbltag">With Rack only</span></>}
              req
              error={errors.zone ?? (picked && !zoneChoices.length
                ? `${picked.id} has no rack-based zones`
                : undefined)}
            >
              <EditSelect
                value={d.zone}
                options={zoneChoices.map(z => (z.apiId && zoneLabels.get(z.apiId)) || LABEL(z.id, z.name))}
                codes={zoneList.codes}
                shortLabels={zoneList.names}
                searchPlaceholder="Search zone ID or name"
                placeholder={picked ? 'Select zone' : 'Select warehouse first'}
                invalid={!!errors.zone}
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

          <Card icon={<IcoRack />} title="Rack Details">
            <Field label="Rack ID">
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
                  <div className={`whm-auto whm-auto--text${area ? ' is-filled' : ''}`}>
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
            <button type="button" className="spi-mdl-cancel" onClick={onClose} disabled={saving}>Cancel</button>
            <button type="button" className="spi-mdl-confirm" onClick={() => void save()} disabled={saving}>
              {saving ? <span className="whm-btnspin" aria-hidden /> : <IcoCheck />}
              {saving ? 'Saving…' : editing ? 'Update Rack' : 'Save Rack'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

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

function AutoField({ label, value, from }: { label: string; value: string; from: 'warehouse' | 'zone' }) {
  return (
    <Field label={label}>
      <div className={`whm-auto znm-auto whm-auto--text${value ? ' is-filled' : ''}`}>
        <input className="spi-dt-inp" value={value} placeholder={`Fetched from ${from}`} readOnly tabIndex={-1} />
        <span className="whm-auto__tag">AUTO</span>
      </div>
    </Field>
  );
}

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
