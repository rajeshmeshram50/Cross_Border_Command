import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useScrollLock } from '../../../hooks/useScrollLock';
import { useToast } from '../../../contexts/ToastContext';
import '../../p2p/p2p-detail.css';
import '../../p2p/purchase-management/order/create-po/create-po.css';
import '../warehouse/warehouse-master.css';
import '../zone/zone-form.css';
import './rack-form.css';
import './shelf-form.css';
import { Field, EditSelect } from '../../p2p/purchase-management/order/create-po/form-fields';
import { InventoryApiError, blockNonNumericKeys, type Rack } from './rack-data';
import { SHELF_PURPOSES, SHELF_TYPES, shelfApi, type Shelf, type ShelfPayload } from './shelf-data';

const PURPOSES = SHELF_PURPOSES;

type ShelfField = 'level' | 'name' | 'type' | 'max' | 'len' | 'wid' | 'ht' | 'purpose';

const FIELD_FOR: Record<string, ShelfField> = {
  level_no: 'level', shelf_name: 'name', shelf_type: 'type', max_weight_kg: 'max',
  length: 'len', width: 'wid', height: 'ht', purpose: 'purpose',
};

function fieldForMessage(msg: string): ShelfField | null {
  const m = msg.toLowerCase();
  if (m.includes('level')) return 'level';
  if (m.includes('shelf with this name')) return 'name';
  if (m.includes('rack length')) return 'len';
  if (m.includes('rack width')) return 'wid';
  if (m.includes('rack height')) return 'ht';
  if (m.includes('kg already stored')) return 'max';
  return null;
}

const nf = (v: number, dp = 2) => v.toLocaleString('en-IN', { maximumFractionDigits: dp });
const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

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
const IcoX = (p: { size?: number }) => Ico(
  <><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></>, p.size ?? 16,
);
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
  /** What the user typed once they picked "Other"; the saved purpose. */
  purposeOther: string;
}

export default function AddShelfModal({ rack: r, freeCm: rackFreeCm, nextLevel, shelf, onClose, onSaved }: {
  rack: Rack;
  freeCm: number;
  nextLevel: number;
  shelf?: Shelf;
  onClose: () => void;
  onSaved?: (shelf: Shelf) => void;
}) {
  useScrollLock(true, '.rks-addmdl');
  const toast = useToast();
  const editing = !!shelf;

  const cardRef = useRef<HTMLDivElement>(null);
  useEffect(() => { cardRef.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !saving) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  const [saving, setSaving] = useState(false);
  const [unit, setUnit] = useState<Unit>(shelf?.dims.unit ?? 'cm');
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
    /* A saved purpose that isn't one of the listed ones was typed, so the
       form reopens on the free-text side with that text in it. */
    purpose: PURPOSES.includes(shelf.purpose) ? shelf.purpose : 'Other',
    purposeOther: PURPOSES.includes(shelf.purpose) ? '' : shelf.purpose,
  } : {
    level: String(nextLevel), name: '', type: '', max: '', len: '', wid: '', ht: '',
    cold: false, haz: false, purpose: '', purposeOther: '',
  }));
  const [errors, setErrors] = useState<Partial<Record<keyof Draft, string>>>({});

  const set = (p: Partial<Draft>) => setD(s => ({ ...s, ...p }));
  const clear = (k: keyof Draft) => setErrors(e => (e[k] ? { ...e, [k]: undefined } : e));

  const next = nextLevel;
  const [nextCode, setNextCode] = useState<string | null>(null);
  useEffect(() => {
    if (editing) return;
    let live = true;
    shelfApi.nextCode(r.apiId)
      .then(code => { if (live) setNextCode(code || 'Assigned on save'); })
      .catch(() => { if (live) setNextCode('Assigned on save'); });
    return () => { live = false; };
  }, [editing, r.apiId]);
  const id = editing ? shelf!.id : (nextCode ?? 'Loading…');

  const freeCm = Math.max(0, Math.round((rackFreeCm + (shelf ? shelf.dims.heightCm : 0)) * 100) / 100);

  const calc = useMemo(() => {
    const L = parseFloat(d.len), W = parseFloat(d.wid), H = parseFloat(d.ht);
    const area = L > 0 && W > 0 ? L * W : null;
    const vol = area != null && H > 0 ? area * H : null;
    const m3 = vol == null ? null : unit === 'm' ? vol : vol / 1e6;
    return { area, m3 };
  }, [d.len, d.wid, d.ht, unit]);

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

  const save = async () => {
    if (saving) return;
    const e: Partial<Record<keyof Draft, string>> = {};
    if (!d.name.trim()) e.name = 'Enter a shelf name';
    if (!d.type) e.type = 'Choose a shelf type';
    if (!d.max.trim()) e.max = 'Enter the weight it can hold';
    else if (!(Number(d.max) > 0)) e.max = 'Enter a valid weight';
    /* Empty and invalid are told apart (QA CS-942 #10) — "Required" under a
       field that visibly holds "456e" read as the form not seeing it. */
    ([['len', 'length'], ['wid', 'width'], ['ht', 'height']] as const).forEach(([k, word]) => {
      if (!d[k].trim()) e[k] = `Enter the ${word}`;
      else if (!(Number(d[k]) > 0)) e[k] = `Enter a valid ${word}`;
    });
    const hCm = unit === 'm' ? parseFloat(d.ht) * 100 : parseFloat(d.ht);
    if (Number.isFinite(hCm) && hCm > freeCm) {
      e.ht = `Only ${freeCm} cm of rack height is left`;
    }
    if (!d.purpose) e.purpose = 'Choose what the shelf is for';
    else if (d.purpose === 'Other' && !d.purposeOther.trim()) e.purpose = 'Enter what the shelf is for';

    setErrors(e);
    const first = Object.keys(e)[0] as keyof Draft | undefined;
    if (first) {
      toast.warning('Shelf not saved', e[first] ?? 'Check the highlighted fields.');
      return;
    }
    const L = parseFloat(d.len), W = parseFloat(d.wid), H = parseFloat(d.ht);
    const payload: ShelfPayload = {
      shelf_name: d.name.trim(),
      level_no: Number(d.level),
      shelf_type: d.type,
      max_weight_kg: parseFloat(d.max),
      purpose: d.purpose === 'Other' ? d.purposeOther.trim() : d.purpose,
      // The rack's own flags — the server copies them down regardless.
      cold_chain: r.cold ? 1 : 0,
      hazardous: r.haz ? 1 : 0,
      dim_unit: unit,
      length: L,
      width: W,
      height: H,
      area: Math.round(L * W * 1e4) / 1e4,
      volume: Math.round(L * W * H * 1e6) / 1e6,
    };

    setSaving(true);
    try {
      const saved = editing ? await shelfApi.update(shelf!.apiId, payload) : await shelfApi.create(r.apiId, payload);
      toast.success(editing ? `${saved.id} updated` : `${saved.id} created`, `${saved.name} on level ${saved.level} of ${r.id}`);
      onSaved?.(saved);
      onClose();
    } catch (err) {
      if (err instanceof InventoryApiError) {
        const nextErr: Partial<Record<keyof Draft, string>> = {};
        for (const [k, msgs] of Object.entries(err.fieldErrors)) {
          const f = FIELD_FOR[k];
          if (f && !nextErr[f]) nextErr[f] = msgs[0];
        }
        if (!Object.keys(nextErr).length) {
          const f = fieldForMessage(err.message);
          if (f) nextErr[f] = err.message;
        }
        setErrors(nextErr);
        toast.error(editing ? 'Could not update the shelf' : 'Could not create the shelf', Object.values(nextErr)[0] ?? err.message);
      } else {
        toast.error('Could not save the shelf', 'Please try again.');
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

          <Card icon={<IcoShelf />} title="Shelf Details" five>
            <Field label="Shelf ID">
              <div className="whm-auto is-filled">
                <input className="spi-dt-inp" value={id} readOnly tabIndex={-1} />
                <span className="whm-auto__tag">AUTO</span>
              </div>
            </Field>
            {/* Assigned, not typed (QA CS-942 #12): the level is the "SH-07"
                in the Shelf ID, so a new shelf takes the next level and an
                existing one keeps its own — the server enforces both. */}
            <Field label="Shelf Level" error={errors.level}>
              <div className="whm-auto is-filled">
                <input className="spi-dt-inp" value={d.level} readOnly tabIndex={-1} />
                <span className="whm-auto__tag">AUTO</span>
              </div>
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
                  onKeyDown={blockNonNumericKeys}
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
                        onKeyDown={blockNonNumericKeys}
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

          <Card icon={<IcoFlag />} title="Shelf Flag Details">
            <Field label="Cold Chain">
              {/* Follows the rack (QA CS-942 #14) — on and locked in a
                  cold-chain rack, off and locked otherwise. */}
              <Switch
                on={r.cold}
                disabled
                label={r.cold ? 'Cold chain shelf · set by the rack' : 'Not allowed in this rack'}
                onToggle={() => {}}
              />
            </Field>
            <Field label="Hazardous">
              <Switch
                on={r.haz}
                disabled
                label={r.haz ? 'Hazardous shelf · set by the rack' : 'Not allowed in this rack'}
                onToggle={() => {}}
              />
            </Field>
            {/* "Other" swaps the list for a box you type in, with an × back to
                the list — the same control the Zone form already uses, down to
                its classes, so the two forms behave alike. */}
            <Field label="Shelf Purpose" req error={errors.purpose} wide>
              <div className="znm-purp">
                {d.purpose === 'Other' ? (
                  <>
                    <input
                      className={`spi-dt-inp znm-purp__other${errors.purpose ? ' is-invalid' : ''}`}
                      maxLength={60} placeholder="Enter shelf purpose" autoFocus
                      value={d.purposeOther}
                      onChange={e => { set({ purposeOther: e.target.value }); clear('purpose'); }}
                    />
                    <button type="button" className="znm-purp__back" title="Choose from the list"
                      aria-label="Choose from the list"
                      onClick={() => set({ purpose: '', purposeOther: '' })}>
                      <IcoX size={12} />
                    </button>
                  </>
                ) : (
                  <EditSelect
                    value={d.purpose}
                    options={PURPOSES}
                    placeholder="Select shelf purpose"
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
            <button type="button" className="spi-mdl-cancel" onClick={onClose} disabled={saving}>Cancel</button>
            <button type="button" className="spi-mdl-confirm" onClick={() => void save()} disabled={saving}>
              <IcoCheck /> {saving ? 'Saving…' : editing ? 'Update Shelf' : 'Save Shelf'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

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

function Switch({ on, disabled, label, onToggle }: {
  on: boolean; disabled?: boolean; label: string; onToggle: () => void;
}) {
  const live = on;
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
