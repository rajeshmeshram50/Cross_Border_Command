import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useScrollLock } from '../../../hooks/useScrollLock';
import { useToast } from '../../../contexts/ToastContext';
/* The stylesheets this form is dressed by — it carries its own rather than
   relying on the dialog that opened it. */
import '../../p2p/p2p-detail.css';
import '../../p2p/purchase-management/order/create-po/create-po.css';
import '../warehouse/warehouse-master.css';
import '../zone/zone-form.css';
import './rack-form.css';
import './shelf-form.css';
import { Field, EditSelect } from '../../p2p/purchase-management/order/create-po/form-fields';
import { rackHeightCm, type Rack } from './rack-data';
import { shelfCode, type Shelf, type ShelfType } from './shelf-data';

const SHELF_TYPES: ShelfType[] = [
  'Standard Shelf', 'Heavy Duty Shelf', 'Pallet Level', 'Bin Shelf', 'Wire Mesh Shelf',
];

const PURPOSES = [
  'Fast-Moving Picking', 'Bulk / Reserve Storage', 'Small Parts & Bins', 'Cold Chain Stock',
  'Hazardous Goods', 'Returns / QC Hold', 'Kitting & Assembly', 'Dispatch Staging', 'Other',
];

const nf = (v: number, dp = 2) => v.toLocaleString('en-IN', { maximumFractionDigits: dp });
const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

/* ── Icons: the prototype's own paths ─────────────────────────────────── */
const Ico = (d: ReactNode, size = 14) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>
);
const IcoRack = (p: { size?: number }) => Ico(
  <><rect x="4" y="2" width="16" height="20" rx="1.5" /><line x1="4" y1="8" x2="20" y2="8" />
    <line x1="4" y1="14" x2="20" y2="14" /></>, p.size ?? 15,
);
const IcoShelf = (p: { size?: number }) => Ico(
  <><rect x="3" y="4" width="18" height="16" rx="1.5" /><line x1="3" y1="10" x2="21" y2="10" />
    <line x1="3" y1="15" x2="21" y2="15" /></>, p.size ?? 15,
);
const IcoFlag = (p: { size?: number }) => Ico(
  <><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
    <line x1="4" y1="22" x2="4" y2="15" /></>, p.size ?? 15,
);
const IcoX = () => Ico(<><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></>, 16);
const IcoCheck = () => Ico(<polyline points="20 6 9 17 4 12" />, 14);
const IcoInfo = (p: { size?: number }) => Ico(
  <><circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" />
    <line x1="12" y1="8" x2="12.01" y2="8" /></>, p.size ?? 13,
);

type Unit = 'cm' | 'm';

interface Draft {
  level: string;
  name: string;
  type: string;
  max: string;
  len: string;
  wid: string;
  ht: string;
  cold: boolean;
  haz: boolean;
  purpose: string;
}

/**
 * Add / Edit Shelf.
 *
 * Design only, on the derived shelves: nothing is persisted, and Save reports
 * what it would have written.
 *
 * The rack above is read-only throughout — a shelf does not get to restate the
 * rack it sits in. What the rack DOES constrain is live: its flags gate the
 * shelf's flags, and its unused height is the ceiling on this shelf's height,
 * stated above the field rather than enforced after the fact.
 */
export default function AddShelfModal({ rack: r, shelves, shelf, onClose }: {
  rack: Rack;
  /** The shelves already in the rack — what is left of its height comes from these. */
  shelves: Shelf[];
  /** Editing an existing shelf, or undefined to add one. */
  shelf?: Shelf;
  onClose: () => void;
}) {
  useScrollLock(true, '.rks-addmdl');
  const toast = useToast();
  const editing = !!shelf;

  const cardRef = useRef<HTMLDivElement>(null);
  useEffect(() => { cardRef.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const [unit, setUnit] = useState<Unit>('cm');
  const [d, setD] = useState<Draft>(() => (shelf ? {
    level: String(shelf.level),
    name: shelf.name,
    type: shelf.type,
    max: String(shelf.max),
    len: String(shelf.dims.length),
    wid: String(shelf.dims.width),
    ht: String(shelf.dims.height),
    cold: shelf.cold,
    haz: shelf.haz,
    purpose: shelf.purpose,
  } : {
    level: '', name: '', type: '', max: '', len: '', wid: '', ht: '',
    cold: false, haz: false, purpose: '',
  }));
  const [errors, setErrors] = useState<Partial<Record<keyof Draft, string>>>({});

  const set = (p: Partial<Draft>) => setD(s => ({ ...s, ...p }));
  const clear = (k: keyof Draft) => setErrors(e => (e[k] ? { ...e, [k]: undefined } : e));

  const next = shelves.length + 1;
  const id = editing ? shelf!.id : shelfCode(r, next);

  /* Height the rack has not given to a shelf yet. The one being edited gives
     its own back, or editing a shelf would look like it no longer fits. */
  const freeCm = useMemo(() => {
    const used = shelves.reduce((t, s) => t + (s === shelf ? 0 : s.dims.heightCm), 0);
    return Math.max(0, Math.round(rackHeightCm(r) - used));
  }, [shelves, shelf, r]);

  /* Area and volume, recomputed rather than stored: two numbers for one box
     can only ever disagree. */
  const calc = useMemo(() => {
    const L = parseFloat(d.len), W = parseFloat(d.wid), H = parseFloat(d.ht);
    const area = L > 0 && W > 0 ? L * W : null;
    const vol = area != null && H > 0 ? area * H : null;
    /* Volume reads in cubic metres whatever the box was measured in — 1,440,000
       cm³ is a number nobody can picture. */
    const m3 = vol == null ? null : unit === 'm' ? vol : vol / 1e6;
    return { area, m3 };
  }, [d.len, d.wid, d.ht, unit]);

  /* Switching Cm ⇄ Metres converts what is typed rather than clearing it: the
     figures are the same shelf either way. */
  const switchUnit = (to: Unit) => {
    if (to === unit) return;
    const k = to === 'm' ? 0.01 : 100;
    const conv = (v: string) => {
      const n = parseFloat(v);
      return Number.isFinite(n) ? String(Math.round(n * k * 1000) / 1000) : v;
    };
    setD(s => ({ ...s, len: conv(s.len), wid: conv(s.wid), ht: conv(s.ht) }));
    setUnit(to);
  };

  const rackDims = r.dims;
  const ru = rackDims.unit;

  const save = () => {
    const e: Partial<Record<keyof Draft, string>> = {};
    if (!/^\d+$/.test(d.level.trim()) || Number(d.level) < 1) e.level = 'Enter a level, 1 or more';
    if (!d.name.trim()) e.name = 'Enter a shelf name';
    if (!d.type) e.type = 'Choose a shelf type';
    if (!(parseFloat(d.max) > 0)) e.max = 'Enter the weight it can hold';
    (['len', 'wid', 'ht'] as const).forEach(k => {
      if (!(parseFloat(d[k]) > 0)) e[k] = 'Required';
    });
    /* The one constraint the rack really imposes: a shelf taller than the
       height left over does not fit in it. */
    const hCm = unit === 'm' ? parseFloat(d.ht) * 100 : parseFloat(d.ht);
    if (Number.isFinite(hCm) && hCm > freeCm) {
      e.ht = `Only ${freeCm} cm of rack height is left`;
    }
    if (!d.purpose) e.purpose = 'Choose what the shelf is for';

    setErrors(e);
    const first = Object.keys(e)[0] as keyof Draft | undefined;
    if (first) {
      toast.warning('Shelf not saved', e[first] ?? 'Check the highlighted fields.');
      return;
    }
    toast.success(
      editing ? `${id} updated` : `${id} saved`,
      `${d.name} on level ${d.level} of ${r.id}. Nothing is stored yet — this screen is design only.`,
    );
    onClose();
  };

  return createPortal(
    <div className="spi-mdl-backdrop whm-backdrop"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        className="spi-mdl whm-addmdl rks-addmdl whm-page"
        role="dialog" aria-modal="true" aria-labelledby="rks-add-title"
        tabIndex={-1} ref={cardRef}
      >
        <div className="spi-mdl-head">
          <div className="spi-mdl-head-left">
            <div className="spi-mdl-head-ico"><IcoShelf size={22} /></div>
            <div>
              <div className="spi-mdl-title" id="rks-add-title">
                {editing ? 'Edit Shelf' : 'Add Shelf'}
              </div>
              <div className="spi-mdl-sub">
                {editing ? `Update ${id} in ` : 'Add a shelf to '}{r.id} | {r.name} with its
                dimensions, weight limit and handling flags.
              </div>
            </div>
          </div>
          <button type="button" className="spi-mdl-x" onClick={onClose} aria-label="Close"><IcoX /></button>
        </div>

        <div className="spi-mdl-body whm-addbody">

          {/* ── The rack, read-only ───────────────────────────────────── */}
          <Card icon={<IcoRack />} title="Rack Details">
            <AutoField label="Rack ID" value={r.id} mono />
            <AutoField label="Rack Name" value={r.name} />
            <AutoField
              label="Cold Chain"
              value={r.cold
                ? `Allowed${r.tempRange ? ` · ${signed(r.tempRange.min)} to ${signed(r.tempRange.max)} °C` : ''}`
                : 'Not Allowed'}
            />
            <AutoField label="Hazardous" value={r.haz ? 'Allowed' : 'Not Allowed'} />

            <div className="rks-sub">
              <div className="znm-sub__hd"><i className="znm-sub__bar" />Rack Dimensions</div>
              <div className="spi-dt-grid4">
                <AutoField label="Length" value={`${nf(rackDims.length)} ${ru}`} />
                <AutoField label="Width" value={`${nf(rackDims.width)} ${ru}`} />
                <AutoField label="Height" value={`${nf(rackDims.height)} ${ru}`} />
                <AutoField
                  label="Rack Area"
                  value={`${nf(rackDims.area)} ${ru}² (≈ ${nf(r.areaSqft)} Sq. Ft)`}
                />
              </div>
            </div>
          </Card>

          {/* ── The shelf ─────────────────────────────────────────────── */}
          <Card icon={<IcoShelf />} title="Shelf Details" five>
            <Field label="Shelf ID">
              {/* The one field that IS an id, so it keeps `.whm-auto`'s mono. */}
              <div className="whm-auto is-filled">
                <input className="spi-dt-inp" value={id} readOnly tabIndex={-1} />
                <span className="whm-auto__tag">AUTO</span>
              </div>
            </Field>
            <Field label="Shelf Level" req error={errors.level}>
              <input
                className={`spi-dt-inp${errors.level ? ' is-invalid' : ''}`}
                type="number" min={1} step={1} placeholder={`e.g. ${next}`}
                value={d.level} onChange={e => { set({ level: e.target.value }); clear('level'); }}
              />
            </Field>
            <Field label="Shelf Name" req error={errors.name}>
              <input
                className={`spi-dt-inp${errors.name ? ' is-invalid' : ''}`}
                maxLength={60} placeholder={`e.g. ${r.name} – Shelf ${next}`}
                value={d.name} onChange={e => { set({ name: e.target.value }); clear('name'); }}
              />
            </Field>
            <Field label="Shelf Type" req error={errors.type}>
              <EditSelect
                value={d.type}
                options={SHELF_TYPES}
                placeholder="Select shelf type"
                invalid={!!errors.type}
                onChange={v => { set({ type: v }); clear('type'); }}
              />
            </Field>
            <Field label="Maximum Shelf Weight (Kg)" req error={errors.max}>
              <div className="whm-suf">
                <input
                  className={`spi-dt-inp${errors.max ? ' is-invalid' : ''}`}
                  type="number" min={0} step={1} placeholder="e.g. 500"
                  value={d.max} onChange={e => { set({ max: e.target.value }); clear('max'); }}
                />
                <span>kg</span>
              </div>
            </Field>

            <div className="rks-sub">
              <div className="znm-sub__hd">
                <i className="znm-sub__bar" />Shelf Dimensions
                <div className="znm-unit" role="group" aria-label="Unit">
                  {(['cm', 'm'] as Unit[]).map(u => (
                    <button key={u} type="button" className={unit === u ? 'is-on' : undefined}
                      onClick={() => switchUnit(u)}>
                      {u === 'cm' ? 'Cm' : 'Metres'}
                    </button>
                  ))}
                </div>
                {/* Stated, not just enforced: the height a shelf may take is
                    the one number here that depends on the other shelves, and
                    finding that out by being refused is a poor way to learn
                    it. */}
                <span className="rks-hint">
                  <IcoInfo size={12} />Free rack height: <b>{freeCm} cm</b>
                </span>
              </div>
              <div className="spi-dt-grid5">
                {([
                  ['len', 'Length', unit === 'cm' ? `e.g. ${nf(rackDims.length * (ru === 'm' ? 100 : 1), 0)}` : 'e.g. 2.4'],
                  ['wid', 'Width', unit === 'cm' ? `e.g. ${nf(rackDims.width * (ru === 'm' ? 100 : 1), 0)}` : 'e.g. 1'],
                  ['ht', 'Height', unit === 'cm' ? 'e.g. 50' : 'e.g. 0.5'],
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
                <Field label={<>Area <span className="rkm-lbltag">L × W</span></>}>
                  <div className={`whm-auto${calc.area != null ? ' is-filled' : ''}`}>
                    <input
                      className="spi-dt-inp"
                      value={calc.area != null ? `${nf(calc.area)} ${unit}²` : ''}
                      placeholder="Auto-calculated" readOnly tabIndex={-1}
                    />
                    <span className="whm-auto__tag">AUTO</span>
                  </div>
                </Field>
                <Field label={<>Volume <span className="rkm-lbltag">L × W × H</span></>}>
                  <div className={`whm-auto${calc.m3 != null ? ' is-filled' : ''}`}>
                    <input
                      className="spi-dt-inp"
                      value={calc.m3 != null ? `${nf(calc.m3, 3)} m³` : ''}
                      placeholder="Auto-calculated" readOnly tabIndex={-1}
                    />
                    <span className="whm-auto__tag">AUTO</span>
                  </div>
                </Field>
              </div>
            </div>
          </Card>

          {/* ── Flags ─────────────────────────────────────────────────── */}
          <Card icon={<IcoFlag />} title="Shelf Flag Details">
            <Field label="Cold Chain">
              <Switch
                on={d.cold}
                disabled={!r.cold}
                label={r.cold ? (d.cold ? 'Cold chain shelf' : 'Not Allowed') : 'Not allowed in this rack'}
                onToggle={() => set({ cold: !d.cold })}
              />
            </Field>
            <Field label="Hazardous">
              <Switch
                on={d.haz}
                disabled={!r.haz}
                label={r.haz ? (d.haz ? 'Hazardous shelf' : 'Not Allowed') : 'Not allowed in this rack'}
                onToggle={() => set({ haz: !d.haz })}
              />
            </Field>
            {/* Two columns, so the row is Cold Chain · Hazardous · Purpose and
                fills its four. On the whole row it would sit alone under two
                toggles and two empty columns. */}
            <Field label="Shelf Purpose" req error={errors.purpose} wide>
              <EditSelect
                value={d.purpose}
                options={PURPOSES}
                placeholder="Select shelf purpose"
                invalid={!!errors.purpose}
                onChange={v => { set({ purpose: v }); clear('purpose'); }}
              />
            </Field>
          </Card>
        </div>

        <div className="spi-mdl-foot">
          <span className="whm-footnote"><IcoInfo /> Fields marked * are required</span>
          <div className="spi-mdl-foot-btns">
            <button type="button" className="spi-mdl-cancel" onClick={onClose}>Cancel</button>
            <button type="button" className="spi-mdl-confirm" onClick={save}>
              <IcoCheck /> {editing ? 'Update Shelf' : 'Save Shelf'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** One titled card of fields. `five` is the shelf row, which has five. */
function Card({ icon, title, five, children }: {
  icon: ReactNode; title: string; five?: boolean; children: ReactNode;
}) {
  return (
    <div className="whm-card">
      <div className="whm-sec">
        <span className="whm-sec__ico">{icon}</span>
        <b>{title}</b>
      </div>
      <div className={five ? 'spi-dt-grid5' : 'spi-dt-grid4'}>{children}</div>
    </div>
  );
}

/**
 * A field the rack fills in: read-only, and it shows that it is filled.
 *
 * `mono` is the exception rather than the rule — `.whm-auto` is monospaced
 * because it was written for generated ids, and most of what it carries here
 * is ordinary text that should not look like a code.
 */
function AutoField({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <Field label={label}>
      <div className={`whm-auto znm-auto is-filled${mono ? '' : ' rks-autotxt'}`}>
        <input className="spi-dt-inp" value={value} readOnly tabIndex={-1} />
        <span className="whm-auto__tag">AUTO</span>
      </div>
    </Field>
  );
}

/** A handling flag the rack can close off, with the reason written beside it. */
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
        role="switch" aria-checked={live} aria-label={label}
        disabled={disabled}
        onClick={e => { e.stopPropagation(); onToggle(); }}
      >
        <span />
      </button>
      <span className="znm-tg__st">{label}</span>
    </div>
  );
}
