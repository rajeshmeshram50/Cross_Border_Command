import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useScrollLock } from '../../../hooks/useScrollLock';
import { useToast } from '../../../contexts/ToastContext';
/* The stylesheets this form is dressed by. It carries its own rather than
   relying on the page that opens it. */
import '../../p2p/p2p-detail.css';
import '../../p2p/purchase-management/order/create-po/create-po.css';
import '../warehouse/warehouse-master.css';
import './zone-form.css';
import { Field, EditSelect } from '../../p2p/purchase-management/order/create-po/form-fields';
import { WAREHOUSES } from '../warehouse/warehouse-data';
import { ZONES, type Zone, type ZoneStorage, type ZoneType } from './zone-data';

/* ── Lists ────────────────────────────────────────────────────────────── */
const PURPOSES = [
  'Receiving / Inward', 'Bulk Storage', 'Pick Face / Forward Picking',
  'Quarantine / QA Hold', 'Returns', 'Dispatch / Staging', 'Other',
];
const TYPE_LABEL: Record<ZoneType, string> = {
  rack: 'Storage Zone (With Rack)',
  norack: 'Storage Zone (Without Rack)',
};
const TYPE_OPTIONS = [TYPE_LABEL.rack, TYPE_LABEL.norack];

/** The ranges a cold zone is usually set to, as the design names them. */
const TEMP_PRESETS = [
  { k: 'Chilled', min: 2, max: 8 },
  { k: 'Cool', min: 8, max: 15 },
  { k: 'Frozen', min: -25, max: -18 },
  { k: 'Deep Frozen', min: -40, max: -25 },
];

/* Only an active warehouse can take a new zone. */
const ACTIVE_WAREHOUSES = WAREHOUSES.filter(w => w.status !== 'inactive');
const WAREHOUSE_LABEL = (id: string, name: string) => `${id} · ${name}`;

const inGrouping = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });
const inWhole = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });

/** One foot is 0.3048 m, so a metre is this many feet. */
const FEET_PER_METRE = 3.28084;
/** A square metre in square feet — used to carry the floor area into Sq. Ft. */
const SQFT_PER_SQM = 10.7639;

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
const IcoFlag = (p: { size?: number }) => Ico(
  <><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
    <line x1="4" y1="22" x2="4" y2="15" /></>,
  p.size ?? 15,
);
const IcoFridge = (p: { size?: number }) => Ico(
  <><rect x="5" y="2" width="14" height="20" rx="2" /><line x1="5" y1="10" x2="19" y2="10" />
    <line x1="9" y1="5" x2="9" y2="7" /><line x1="9" y1="13" x2="9" y2="16" /></>,
  p.size ?? 17,
);
const IcoFloor = (p: { size?: number }) => Ico(
  <><rect x="3" y="10" width="5" height="11" /><rect x="10" y="6" width="5" height="15" />
    <rect x="17" y="13" width="4" height="8" /><line x1="2" y1="21" x2="22" y2="21" /></>,
  p.size ?? 17,
);
const IcoThermo = (p: { size?: number }) => Ico(
  <path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z" />, p.size ?? 14,
);
const IcoPencil = () => Ico(
  <><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" /></>, 12,
);
const IcoX = (p: { size?: number }) => Ico(
  <><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></>, p.size ?? 16,
);
const IcoCheck = () => Ico(<polyline points="20 6 9 17 4 12" />, 14);
const IcoInfo = () => Ico(
  <><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" />
    <line x1="12" y1="16" x2="12.01" y2="16" /></>, 13,
);
const IcoList = () => Ico(
  <><line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" />
    <line x1="8" y1="18" x2="21" y2="18" /><line x1="3" y1="6" x2="3.01" y2="6" />
    <line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" /></>, 12,
);

type Unit = 'm' | 'ft';

interface Draft {
  wh: string;
  name: string;
  area: string;
  type: string;
  storage: ZoneStorage;
  litres: string;
  len: string;
  wid: string;
  ht: string;
  use: string;
  cold: boolean;
  haz: boolean;
  purpose: string;
  /** Typed in when the purpose is "Other". */
  purposeOther: string;
}

const EMPTY: Draft = {
  wh: '', name: '', area: '', type: '', storage: '', litres: '',
  len: '', wid: '', ht: '', use: '80', cold: false, haz: false,
  purpose: '', purposeOther: '',
};

/** One past the highest zone id. */
function nextId(): string {
  const max = ZONES.reduce((n, z) => Math.max(n, Number(z.id.replace(/\D/g, '')) || 0), 0);
  return `ZN-${String(max + 1).padStart(3, '0')}`;
}

/** `+8` / `-25` — a temperature always carries its sign. */
const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

/**
 * Add / Edit Zone.
 *
 * Design only: it validates, calculates and reports, and does not persist.
 * Three sections, with a branch — a without-rack zone is either a refrigerator
 * measured in litres or a floor measured in three dimensions, and the floor
 * case works out its own usable volume as you type.
 */
export default function AddZoneModal({ zone, onClose }: {
  /** Present when the pencil opened it. */
  zone?: Zone;
  onClose: () => void;
}) {
  const editing = !!zone;
  const toast = useToast();
  useScrollLock(true, '.znm-addmdl');

  const [d, setD] = useState<Draft>(() => (zone
    ? {
      wh: WAREHOUSE_LABEL(zone.wh, WAREHOUSES.find(w => w.id === zone.wh)?.name ?? ''),
      name: zone.name,
      area: String(zone.area),
      type: TYPE_LABEL[zone.type],
      storage: zone.storage,
      litres: zone.litres != null ? String(zone.litres) : '',
      len: zone.dims ? String(zone.dims.length) : '',
      wid: zone.dims ? String(zone.dims.width) : '',
      ht: zone.dims ? String(zone.dims.height) : '',
      use: zone.dims ? String(zone.dims.usablePct) : '80',
      cold: zone.cold,
      haz: zone.haz,
      /* A stored purpose outside the list is one someone typed. */
      purpose: PURPOSES.includes(zone.purpose) ? zone.purpose : 'Other',
      purposeOther: PURPOSES.includes(zone.purpose) ? '' : zone.purpose,
    }
    : EMPTY));
  const set = (p: Partial<Draft>) => setD(prev => ({ ...prev, ...p }));

  const [unit, setUnit] = useState<Unit>(() => (zone?.dims?.unit === 'cm' ? 'm' : 'm'));
  const [temp, setTemp] = useState<{ min: number; max: number } | null>(zone?.tempRange ?? null);
  const [tempOpen, setTempOpen] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<keyof Draft, string>>>({});
  const clear = (k: keyof Draft) => setErrors(e => (e[k] ? { ...e, [k]: undefined } : e));

  const cardRef = useRef<HTMLDivElement>(null);
  useEffect(() => { cardRef.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      /* One layer at a time: the temperature popup closes before the form. */
      if (tempOpen) { setTempOpen(false); return; }
      onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, tempOpen]);

  const id = editing ? zone!.id : nextId();
  const picked = ACTIVE_WAREHOUSES.find(w => WAREHOUSE_LABEL(w.id, w.name) === d.wh);
  const type: ZoneType | '' = d.type === TYPE_LABEL.rack ? 'rack' : d.type === TYPE_LABEL.norack ? 'norack' : '';
  const noRack = type === 'norack';

  /* ── The floor calculation ───────────────────────────────────────────── */
  const calc = useMemo(() => {
    const L = parseFloat(d.len), W = parseFloat(d.wid), H = parseFloat(d.ht), U = parseFloat(d.use);
    const area = L > 0 && W > 0 ? L * W : NaN;
    const vol = area > 0 && H > 0 ? area * H : NaN;
    const uvol = vol > 0 && U > 0 && U <= 100 ? (vol * U) / 100 : NaN;
    return { L, W, H, U, area, vol, uvol };
  }, [d.len, d.wid, d.ht, d.use]);

  /* A measured floor decides its own area, so the Sq. Ft field follows it
     rather than being typed twice and disagreeing. */
  const areaFromFloor = noRack && d.storage === 'regular' && calc.area > 0;
  const shownArea = areaFromFloor
    ? String(Math.round(unit === 'm' ? calc.area * SQFT_PER_SQM : calc.area))
    : d.area;

  /* The same figure in the other unit, which is what the small line shows. */
  const other: Unit = unit === 'm' ? 'ft' : 'm';
  const k = unit === 'm' ? FEET_PER_METRE : 1 / FEET_PER_METRE;
  const fmt = (v: number, dp = 2) =>
    (Number.isFinite(v) ? new Intl.NumberFormat('en-IN', { maximumFractionDigits: dp }).format(v) : '—');

  const save = () => {
    const e: Partial<Record<keyof Draft, string>> = {};
    if (!d.wh) e.wh = 'Choose the warehouse this zone is in.';
    if (!d.name.trim()) e.name = 'Give the zone a name.';
    const areaNum = Number(shownArea);
    if (!shownArea.trim()) e.area = 'Enter the zone area.';
    else if (!(areaNum > 0)) e.area = 'Area must be more than zero.';
    /* A zone cannot be bigger than the warehouse holding it. */
    else if (picked && areaNum > picked.area) {
      e.area = `Larger than ${picked.id}, which is ${inWhole.format(picked.area)} Sq. Ft.`;
    }
    if (!d.type) e.type = 'Choose the zone type.';
    if (noRack) {
      if (!d.storage) e.storage = 'Choose how this zone stores.';
      if (d.storage === 'fridge' && !(Number(d.litres) > 0)) e.litres = 'Enter the capacity in litres.';
      if (d.storage === 'regular') {
        if (!(calc.L > 0)) e.len = 'Enter the length.';
        if (!(calc.W > 0)) e.wid = 'Enter the width.';
        if (!(calc.H > 0)) e.ht = 'Enter the height.';
        if (!(calc.U > 0 && calc.U <= 100)) e.use = 'Usable floor is a percentage, 1 to 100.';
      }
    }
    const purpose = d.purpose === 'Other' ? d.purposeOther.trim() : d.purpose;
    if (!purpose) e.purpose = 'Choose or enter the zone purpose.';
    /* Cold chain without a range is a flag that says nothing. */
    if (d.cold && !temp) e.cold = 'Set the temperature range for this zone.';

    setErrors(e);
    const bad = Object.keys(e).filter(x => e[x as keyof Draft]);
    if (bad.length) {
      toast.error(
        bad.length === 1 ? 'One field needs attention' : `${bad.length} fields need attention`,
        'Each one is marked below.',
      );
      document.querySelector('.znm-addmdl .cpf-err')
        ?.closest('.spi-dt-field')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }
    toast.info(
      editing ? `${id} would be updated` : `${id} would be saved`,
      'The form is complete. Saving arrives with the zone endpoint.',
    );
    onClose();
  };

  return createPortal(
    <div className="spi-mdl-backdrop whm-backdrop"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        className="spi-mdl whm-addmdl znm-addmdl"
        role="dialog" aria-modal="true" aria-labelledby="znm-add-title"
        tabIndex={-1} ref={cardRef}
        /* The temperature popup is absolutely positioned inside this card. */
        style={{ position: 'relative' }}
      >
        <div className="spi-mdl-head">
          <div className="spi-mdl-head-left">
            <div className="spi-mdl-head-ico"><IcoZone size={22} /></div>
            <div>
              <div className="spi-mdl-title" id="znm-add-title">
                {editing ? 'Edit Zone' : 'Add Zone'}
              </div>
              <div className="spi-mdl-sub">
                Create a storage zone inside a warehouse with its type, size and handling flags.
              </div>
            </div>
          </div>
          <button type="button" className="spi-mdl-x" onClick={onClose} aria-label="Close"><IcoX /></button>
        </div>

        <div className="spi-mdl-body whm-addbody">

          {/* ── Warehouse ─────────────────────────────────────────────── */}
          <Card icon={<IcoWarehouse />} title="Warehouse Details">
            <Field label="Warehouse" req error={errors.wh} hint="Only active warehouses are listed">
              <EditSelect
                value={d.wh}
                options={ACTIVE_WAREHOUSES.map(w => WAREHOUSE_LABEL(w.id, w.name))}
                placeholder="Select warehouse"
                invalid={!!errors.wh}
                onChange={v => { set({ wh: v }); clear('wh'); clear('area'); }}
              />
            </Field>
            {/* Read-only, and they say where they came from. */}
            <AutoField label="Warehouse Type"
              value={picked ? (picked.type === 'own' ? 'Own Warehouse' : 'Third Party (3PL)') : ''} />
            <AutoField label="Warehouse Area (Sq. Ft)"
              value={picked ? inWhole.format(picked.area) : ''} />
            <AutoField label="Location"
              value={picked ? [picked.city, picked.state].filter(Boolean).join(', ') : ''} />
          </Card>

          {/* ── Zone ──────────────────────────────────────────────────── */}
          <Card icon={<IcoZone />} title="Zone Details">
            <Field label="Zone ID" hint="Generated automatically">
              <div className="whm-auto">
                <input className="spi-dt-inp" value={id} readOnly />
                <span className="whm-auto__tag">AUTO</span>
              </div>
            </Field>
            <Field label="Zone Name" req error={errors.name}>
              <input
                className={`spi-dt-inp${errors.name ? ' is-invalid' : ''}`}
                placeholder="e.g. Zone A – Fast Movers" maxLength={80}
                value={d.name} onChange={e => { set({ name: e.target.value }); clear('name'); }}
              />
            </Field>
            <Field
              label="Zone Area (Sq. Ft)" req error={errors.area}
              hint={areaFromFloor
                ? 'Taken from the measured floor area'
                : picked ? `Must fit within ${picked.id}'s ${inWhole.format(picked.area)} Sq. Ft`
                  : 'Must fit within the warehouse area'}
            >
              <div className="whm-suf">
                <input
                  className={`spi-dt-inp${errors.area ? ' is-invalid' : ''}`}
                  type="number" min={1} placeholder="e.g. 5000"
                  /* Read-only once a floor has been measured: two numbers for
                     one area can only ever disagree. */
                  readOnly={areaFromFloor}
                  value={shownArea}
                  onChange={e => { set({ area: e.target.value }); clear('area'); }}
                />
                <span>Sq. Ft</span>
              </div>
            </Field>
            <Field label="Zone Type" req error={errors.type}>
              <EditSelect
                value={d.type} options={TYPE_OPTIONS} placeholder="Select zone type"
                invalid={!!errors.type}
                onChange={v => {
                  /* Going back to racked clears the storage branch, so a
                     hidden litres value cannot be saved with it. */
                  set(v === TYPE_LABEL.rack
                    ? { type: v, storage: '', litres: '', len: '', wid: '', ht: '' }
                    : { type: v });
                  clear('type');
                }}
              />
            </Field>

            {noRack && (
              <div className="znm-nr">
                <div className="spi-dt-field">
                  <label className="spi-dt-field-lbl">Storage Type<span className="spi-dt-req">*</span></label>
                  <div className="znm-opts" role="radiogroup" aria-label="Storage type">
                    <StoreOption
                      on={d.storage === 'fridge'} icon={<IcoFridge />}
                      title="Refrigerator Storage"
                      desc="Temperature-controlled cold room. Capacity is captured in litres."
                      onPick={() => { set({ storage: 'fridge' }); clear('storage'); }}
                    />
                    <StoreOption
                      on={d.storage === 'regular'} icon={<IcoFloor />}
                      title="Regular Storage"
                      desc="General floor storage without racks. Capacity from length, width and height."
                      onPick={() => { set({ storage: 'regular' }); clear('storage'); }}
                    />
                  </div>
                  {errors.storage && <div className="cpf-err" role="alert">{errors.storage}</div>}
                </div>

                {d.storage === 'fridge' && (
                  <div className="znm-sub">
                    <div className="znm-sub__hd"><i className="znm-sub__bar" />Refrigerator Capacity</div>
                    <div className="spi-dt-grid4">
                      <Field label="Total Capacity (Litres)" req full error={errors.litres}
                        hint="Total internal storage capacity of the refrigerator">
                        <div className="whm-suf">
                          <input
                            className={`spi-dt-inp${errors.litres ? ' is-invalid' : ''}`}
                            type="number" min={1} placeholder="e.g. 5000"
                            value={d.litres}
                            onChange={e => { set({ litres: e.target.value }); clear('litres'); }}
                          />
                          <span>Litres</span>
                        </div>
                      </Field>
                    </div>
                  </div>
                )}

                {d.storage === 'regular' && (
                  <div className="znm-sub">
                    <div className="znm-sub__hd">
                      <i className="znm-sub__bar" />Zone Dimensions &amp; Capacity
                      <span className="znm-sub__tag">Floor storage · no racks</span>
                      <div className="znm-unit" role="group" aria-label="Unit">
                        {(['m', 'ft'] as Unit[]).map(u => (
                          <button key={u} type="button" className={unit === u ? 'is-on' : undefined}
                            onClick={() => setUnit(u)}>
                            {u === 'm' ? 'Metres' : 'Feet'}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="spi-dt-grid4">
                      {([
                        ['len', 'Length', 'e.g. 40'],
                        ['wid', 'Width', 'e.g. 25'],
                        ['ht', 'Height', 'e.g. 8'],
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
                      <Field label="Usable Floor (%)" req error={errors.use}>
                        <div className="whm-suf">
                          <input
                            className={`spi-dt-inp${errors.use ? ' is-invalid' : ''}`}
                            type="number" min={1} max={100}
                            value={d.use}
                            onChange={e => { set({ use: e.target.value }); clear('use'); }}
                          />
                          <span>%</span>
                        </div>
                      </Field>
                    </div>

                    <div className="znm-calc">
                      <Kpi
                        label="Floor Area"
                        value={calc.area > 0 ? `${fmt(calc.area)} ${unit}²` : '—'}
                        sub={calc.area > 0 ? `≈ ${fmt(calc.area * k * k, 0)} ${other}²` : 'Length × Width'}
                      />
                      <Kpi
                        label="Volume"
                        value={calc.vol > 0 ? `${fmt(calc.vol)} ${unit}³` : '—'}
                        sub={calc.vol > 0 ? `≈ ${fmt(calc.vol * k * k * k, 0)} ${other}³` : 'Floor area × Height'}
                      />
                      <Kpi
                        hi
                        label="Usable Volume"
                        value={calc.uvol > 0 ? `${fmt(calc.uvol)} ${unit}³` : '—'}
                        sub={calc.uvol > 0 ? `at ${fmt(calc.U, 0)}% usable floor` : 'Volume × Usable floor %'}
                      />
                    </div>
                  </div>
                )}
              </div>
            )}
          </Card>

          {/* ── Flags ─────────────────────────────────────────────────── */}
          <Card icon={<IcoFlag />} title="Zone Flags Details">
            <Field label="Cold Chain Allowed" error={errors.cold}>
              <div
                className={`znm-tg${d.cold ? ' is-on' : ''}`}
                /* Turning it on asks for the range straight away — the flag
                   on its own does not say what the zone must hold. */
                onClick={() => {
                  const next = !d.cold;
                  set({ cold: next });
                  clear('cold');
                  if (next && !temp) setTempOpen(true);
                }}
              >
                <button type="button" className={`whm-toggle${d.cold ? ' is-on' : ''}`}
                  role="switch" aria-checked={d.cold} aria-label="Toggle cold chain"
                  onClick={e => e.stopPropagation()}>
                  <span />
                </button>
                <span className="znm-tg__st">
                  {d.cold ? 'Allowed' : 'Not Allowed'}
                  {d.cold && temp && (
                    <span className="znm-tg__rng">{signed(temp.min)} to {signed(temp.max)} °C</span>
                  )}
                </span>
                {d.cold && (
                  <button type="button" className="znm-tg__edit" title="Edit temperature range"
                    aria-label="Edit temperature range"
                    onClick={e => { e.stopPropagation(); setTempOpen(true); }}>
                    <IcoPencil />
                  </button>
                )}
              </div>
            </Field>

            <Field label="Hazardous Allowed">
              <div className={`znm-tg${d.haz ? ' is-on' : ''}`} onClick={() => set({ haz: !d.haz })}>
                <button type="button" className={`whm-toggle${d.haz ? ' is-on' : ''}`}
                  role="switch" aria-checked={d.haz} aria-label="Toggle hazardous"
                  onClick={e => e.stopPropagation()}>
                  <span />
                </button>
                <span className="znm-tg__st">{d.haz ? 'Allowed' : 'Not Allowed'}</span>
              </div>
            </Field>

            <Field label="Zone Purpose" req error={errors.purpose}>
              <div className="znm-purp">
                {d.purpose === 'Other' ? (
                  <>
                    <input
                      className={`spi-dt-inp znm-purp__other${errors.purpose ? ' is-invalid' : ''}`}
                      maxLength={60} placeholder="Enter zone purpose" autoFocus
                      value={d.purposeOther}
                      onChange={e => { set({ purposeOther: e.target.value }); clear('purpose'); }}
                    />
                    <button type="button" className="znm-purp__back" title="Choose from the list"
                      aria-label="Choose from the list"
                      onClick={() => set({ purpose: '', purposeOther: '' })}>
                      <IcoList />
                    </button>
                  </>
                ) : (
                  <EditSelect
                    value={d.purpose} options={PURPOSES} placeholder="Select zone purpose"
                    invalid={!!errors.purpose}
                    onChange={v => { set({ purpose: v }); clear('purpose'); }}
                  />
                )}
              </div>
            </Field>
          </Card>
        </div>

        <div className="spi-mdl-foot">
          <span className="whm-footnote"><IcoInfo /> Fields marked * are required</span>
          <div className="spi-mdl-foot-btns">
            <button type="button" className="spi-mdl-cancel" onClick={onClose}>Cancel</button>
            <button type="button" className="spi-mdl-confirm" onClick={save}>
              <IcoCheck /> {editing ? 'Update Zone' : 'Save Zone'}
            </button>
          </div>
        </div>

        {tempOpen && (
          <TemperatureSheet
            value={temp}
            onCancel={() => {
              setTempOpen(false);
              /* Backing out without a range leaves the flag off rather than
                 on and meaningless. */
              if (!temp) set({ cold: false });
            }}
            onSave={(range) => { setTemp(range); setTempOpen(false); clear('cold'); }}
          />
        )}
      </div>
    </div>,
    document.body,
  );
}

/** One section: a white card with the gradient bar down its left edge. */
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

/** A field the warehouse fills in: read-only, and it shows whether it has. */
function AutoField({ label, value }: { label: string; value: string }) {
  return (
    <Field label={label}>
      <div className={`whm-auto znm-auto${value ? ' is-filled' : ''}`}>
        <input className="spi-dt-inp" value={value} placeholder="Fetched from warehouse" readOnly tabIndex={-1} />
        <span className="whm-auto__tag">AUTO</span>
      </div>
    </Field>
  );
}

/** Refrigerator or regular floor. */
function StoreOption({ on, icon, title, desc, onPick }: {
  on: boolean; icon: ReactNode; title: string; desc: string; onPick: () => void;
}) {
  return (
    <button type="button" className={`znm-opt${on ? ' is-on' : ''}`} role="radio" aria-checked={on}
      onClick={onPick}>
      <span className="znm-opt__rd" />
      <span className="znm-opt__ico">{icon}</span>
      <span className="znm-opt__t"><b>{title}</b><small>{desc}</small></span>
    </button>
  );
}

/** One worked-out figure. */
function Kpi({ label, value, sub, hi }: { label: string; value: string; sub: string; hi?: boolean }) {
  return (
    <div className={`znm-kpi${hi ? ' znm-kpi--hi' : ''}`}>
      <span>{label} <em>AUTO</em></span>
      <b>{value}</b>
      <small>{sub}</small>
    </div>
  );
}

/**
 * The cold-chain range.
 *
 * Inside the form rather than over the page: it sets one field on the card
 * behind it, and a second full-screen layer would read as a second task.
 */
function TemperatureSheet({ value, onCancel, onSave }: {
  value: { min: number; max: number } | null;
  onCancel: () => void;
  onSave: (v: { min: number; max: number }) => void;
}) {
  const [min, setMin] = useState(value ? String(value.min) : '');
  const [max, setMax] = useState(value ? String(value.max) : '');
  const [err, setErr] = useState('');

  const nMin = parseFloat(min), nMax = parseFloat(max);
  const preset = TEMP_PRESETS.find(p => p.min === nMin && p.max === nMax);

  const apply = () => {
    if (!Number.isFinite(nMin) || !Number.isFinite(nMax)) {
      setErr('Enter both a minimum and a maximum.');
      return;
    }
    /* Equal is allowed — a zone held at exactly one temperature is a real
       setting; the minimum above the maximum is not. */
    if (nMin > nMax) { setErr('The minimum cannot be above the maximum.'); return; }
    onSave({ min: nMin, max: nMax });
  };

  return (
    <div className="znm-tp-ov" onMouseDown={e => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="znm-tp" role="dialog" aria-modal="true" aria-labelledby="znm-tp-title">
        <div className="znm-tp__hd">
          <span className="znm-tp__ico"><IcoThermo size={18} /></span>
          <div>
            <b id="znm-tp-title">Cold Chain Temperature</b>
            <small>Set the temperature range this zone must hold.</small>
          </div>
          <button type="button" className="znm-tp__x" onClick={onCancel} aria-label="Close">
            <IcoX size={13} />
          </button>
        </div>

        <div className="znm-tp__bd">
          <div className="znm-tp__row">
            <span className="znm-tp__lbl">Temperature Range <i>*</i></span>
            <div className="znm-tp__presets">
              {TEMP_PRESETS.map(p => (
                <button
                  key={p.k} type="button"
                  className={`znm-tp__pre${preset?.k === p.k ? ' is-on' : ''}`}
                  onClick={() => { setMin(String(p.min)); setMax(String(p.max)); setErr(''); }}
                >
                  <b>{p.k}</b> {p.min}…{p.max}°C
                </button>
              ))}
            </div>
          </div>

          <div className="znm-tp__in">
            <label className="znm-tp__fld">
              <IcoThermo />
              <input type="number" step="0.5" placeholder="Min" value={min}
                onChange={e => { setMin(e.target.value); setErr(''); }} aria-label="Minimum temperature" />
              <span>°C</span>
            </label>
            <span className="znm-tp__to">to</span>
            <label className="znm-tp__fld">
              <IcoThermo />
              <input type="number" step="0.5" placeholder="Max" value={max}
                onChange={e => { setMax(e.target.value); setErr(''); }} aria-label="Maximum temperature" />
              <span>°C</span>
            </label>
          </div>

          <div className="znm-tp__err">{err}</div>
          <div className="znm-tp__note">
            Set the minimum and maximum temperature this zone must hold, or pick one of the
            ranges above.
          </div>
        </div>

        <div className="znm-tp__ft">
          <button type="button" className="spi-mdl-cancel" onClick={onCancel}>Cancel</button>
          <button type="button" className="spi-mdl-confirm" onClick={apply}>
            <IcoCheck /> Set Range
          </button>
        </div>
      </div>
    </div>
  );
}
