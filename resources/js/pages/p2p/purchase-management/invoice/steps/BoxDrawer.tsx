import { lazy, Suspense, useCallback, useState } from 'react';
import { MasterDatePicker } from '../../../../../components/ui/MasterDatePicker';
import Tooltip from '../../../../../components/ui/Tooltip';
import {
  IcoBox, IcoCamera, IcoChevronR, IcoSave, IcoTag, IcoThermometer, IcoUpload, IcoWarn,
} from '../../../icons';
import { type CustomFlag } from './ProductFlagsModal';
const AddProductFlagModal = lazy(() => import('../../../../inventory-management/product-flag/AddProductFlagModal'));
import TemperatureModal, { formatRange, type TempRange } from './TemperatureModal';
import SelectedProducts, {
  EMPTY_IDENTITY, type BoxContent, type ProductIdentity,
} from './SelectedProducts';
import BoxStickerModal from './BoxStickerModal';
import type { ProductLine } from '../invoice-products';

const REMARKS = [
  { id: 'correct', cls: 'vti-rmk-correct', title: 'Correct Product', sub: 'As expected' },
  { id: 'damaged', cls: 'vti-rmk-damaged', title: 'Damaged / Rejected', sub: 'Not accepted' },
  { id: 'mismatch', cls: 'vti-rmk-mismatch', title: 'Mismatched', sub: 'Wrong item' },
  { id: 'extra', cls: 'vti-rmk-extra', title: 'Extra Quantity', sub: 'Over-supplied' },
] as const;

const CONDITIONS = [
  { id: 'perfect', cls: 'vti-cond-perfect', title: 'Perfect', sub: 'No damage' },
  { id: 'minor', cls: 'vti-cond-minor', title: 'Minor Damage', sub: 'Light wear' },
  { id: 'severe', cls: 'vti-cond-severe', title: 'Critical Damage', sub: 'Not usable' },
] as const;

const FLAGS = [
  { id: 'hazardous', cls: 'flag-hazardous', label: 'Hazardous' },
  { id: 'coldchain', cls: 'flag-coldchain', label: 'Cold Chain' },
  { id: 'fragile', cls: 'flag-fragile', label: 'Fragile' },
] as const;

const DIMENSIONS = [
  { key: 'length', label: 'Length', unit: 'dim' },
  { key: 'width', label: 'Width', unit: 'dim' },
  { key: 'height', label: 'Height', unit: 'dim' },
  { key: 'weight', label: 'Weight', unit: 'wt' },
  { key: 'netWeight', label: 'Net Weight', unit: 'wt' },
  { key: 'grossWeight', label: 'Gross Weight', unit: 'wt' },
] as const;

const ADVANCED = [
  { key: 'serial', label: 'Serial No.', placeholder: 'e.g. SN-001', type: 'text' },
  { key: 'lot', label: 'Lot No.', placeholder: 'e.g. LT-001', type: 'text' },
  { key: 'batch', label: 'Batch No.', placeholder: 'e.g. BT-001', type: 'text' },
  { key: 'cat', label: 'Cat No.', placeholder: 'e.g. CT-001', type: 'text' },
  { key: 'expiry', label: 'Expiry Date', placeholder: '', type: 'date' },
  { key: 'mfg', label: 'MFG Date', placeholder: '', type: 'date' },
] as const;

export interface BoxSaveData {
  dims: {
    length_cm: number | null; width_cm: number | null; height_cm: number | null;
    weight_kg: number | null; net_weight_kg: number | null; gross_weight_kg: number | null;
  };
  condition: 'perfect' | 'minor' | 'severe';
  remark: 'correct' | 'damaged' | 'mismatched' | 'extra';
  flagIds: string[];
  flagNames: string[];
  stackable: boolean;
  note: string | null;
  boxIdentity: ProductIdentity;
  identities: Record<string, ProductIdentity>;
}

const VOLUMETRIC_DIVISOR = 5000;

export default function BoxDrawer({
  boxId, line, quantity,
  scenario = '1 Product → 1 Box',
  modeKey = 'Mode',
  modeLabel = 'Single Box',
  variant = 'accordion',
  contents,
  onRemoveContent,
  onClearContents,
  onSave,
  saving = false,
  saved = false,
  customFlags = [],
  onQuantityChange,
}: {
  boxId: string;
  line: ProductLine;
  quantity: number;
  scenario?: string;
  modeKey?: string;
  modeLabel?: string;
  variant?: 'accordion' | 'panel';
  contents?: BoxContent[];
  onRemoveContent?: (code: string) => void;
  onClearContents?: () => void;
  onSave?: (data: BoxSaveData) => void;
  saving?: boolean;
  saved?: boolean;
  customFlags?: CustomFlag[];
  onQuantityChange?: (qty: number) => void;
}) {
  const [unit, setUnit] = useState<'cm' | 'm'>('cm');
  const [wUnit, setWUnit] = useState<'kg' | 'g'>('kg');
  const [dims, setDims] = useState<Record<string, string>>({});
  const [remark, setRemark] = useState<string>('correct');
  const [condition, setCondition] = useState<string>('perfect');
  const [flags, setFlags] = useState<string[]>([]);
  const [stackable, setStackable] = useState(true);
  const [flagsOpen, setFlagsOpen] = useState(false);
  const [temp, setTemp] = useState<TempRange>({ min: '', max: '' });
  const [tempOpen, setTempOpen] = useState(false);
  const [stickerOpen, setStickerOpen] = useState(false);
  const [advOpen, setAdvOpen] = useState(false);
  const [boxIdentity, setBoxIdentity] = useState<Record<string, string>>({});

  const [identities, setIdentities] = useState<Record<string, ProductIdentity>>({});
  const patchIdentity = useCallback((code: string, patch: Partial<ProductIdentity>) => {
    setIdentities(m => ({ ...m, [code]: { ...(m[code] ?? EMPTY_IDENTITY), ...patch } }));
  }, []);
  const contentRows: BoxContent[] = contents ?? [{ line, qty: quantity }];
  const mixedCarton = !!contents;

  const volumetric = (() => {
    const toCm = (v: string) => (Number(v) || 0) * (unit === 'm' ? 100 : 1);
    const cc = toCm(dims.length) * toCm(dims.width) * toCm(dims.height);
    if (cc <= 0) return '';
    const kg = cc / VOLUMETRIC_DIVISOR;
    return (wUnit === 'g' ? kg * 1000 : kg).toFixed(2);
  })();

  const collect = (): BoxSaveData => {
    const num = (v: string | undefined, factor: number) => {
      const n = parseFloat(v ?? '');
      return Number.isFinite(n) ? Math.round(n * factor * 1000) / 1000 : null;
    };
    const dimF = unit === 'm' ? 100 : 1;
    const wtF = wUnit === 'g' ? 0.001 : 1;
    const range = flags.includes('coldchain') ? formatRange(temp) : '';
    const note = [boxIdentity.remarks?.trim(), range ? `Cold chain ${range}` : ''].filter(Boolean).join(' · ');
    return {
      dims: {
        length_cm: num(dims.length, dimF), width_cm: num(dims.width, dimF), height_cm: num(dims.height, dimF),
        weight_kg: num(dims.weight, wtF), net_weight_kg: num(dims.netWeight, wtF), gross_weight_kg: num(dims.grossWeight, wtF),
      },
      condition: condition as BoxSaveData['condition'],
      remark: (remark === 'mismatch' ? 'mismatched' : remark) as BoxSaveData['remark'],
      flagIds: flags,
      flagNames: flags
        .map(id => FLAGS.find(f => f.id === id)?.label ?? customFlags.find(c => c.id === id)?.name)
        .filter((n): n is string => !!n),
      stackable,
      note: note || null,
      boxIdentity: {
        serial: boxIdentity.serial ?? '', lot: boxIdentity.lot ?? '', batch: boxIdentity.batch ?? '',
        cat: boxIdentity.cat ?? '', expiry: boxIdentity.expiry ?? '', mfg: boxIdentity.mfg ?? '',
        remarks: boxIdentity.remarks ?? '',
      },
      identities,
    };
  };

  const toggleFlag = (id: string) =>
    setFlags(f => (f.includes(id) ? f.filter(x => x !== id) : [...f, id]));

  const Shell = variant === 'accordion' ? AccordionShell : PanelShell;

  return (
    <Shell>

        <div className="vti-dw-strip">
          <div className="vti-dw-strip-accent" />
          <div className="vti-dw-strip-left">
            <StripItem label="Box ID" className="strip-boxid">
              <span className="vti-dw-strip-val vti-dw-strip-id">{boxId}</span>
            </StripItem>
            <div className="vti-dw-strip-sep" />
            <StripItem label="Scenario"><span className="vti-dw-strip-val">{scenario}</span></StripItem>
            <div className="vti-dw-strip-sep" />
            <StripItem label={modeKey}><span className="vti-dw-strip-val">{modeLabel}</span></StripItem>
            <div className="vti-dw-strip-sep" />
            <StripItem label="Product" className="strip-product">
              <span className="vti-dw-strip-val">{line.spiName}</span>
            </StripItem>
            <div className="vti-dw-strip-sep" />
            <StripItem label="Quantity">
              {onQuantityChange ? (
                <span className="vti-dw-strip-qty invf-qty-edit">
                  <span className="vti-dw-strip-qty-dot" />
                  <input
                    type="number" min={0} className="invf-qty-inp"
                    value={quantity}
                    aria-label="Units in this box"
                    onChange={e => onQuantityChange(Math.max(0, Number(e.target.value) || 0))}
                  />
                  <span className="invf-qty-spin">
                    <button
                      type="button" className="invf-qty-spin__btn" aria-label="One unit more"
                      onClick={() => onQuantityChange(quantity + 1)}
                    >
                      <Caret up />
                    </button>
                    <button
                      type="button" className="invf-qty-spin__btn" aria-label="One unit fewer"
                      disabled={quantity <= 0}
                      onClick={() => onQuantityChange(Math.max(0, quantity - 1))}
                    >
                      <Caret />
                    </button>
                  </span>
                  <span className="invf-qty-unit">Units</span>
                </span>
              ) : (
                <span className="vti-dw-strip-qty"><span className="vti-dw-strip-qty-dot" />{quantity} Units</span>
              )}
            </StripItem>
          </div>

          <div className="vti-dw-toolbar">
            <span className="vti-dw-dim-label">Dimensions</span>
            <div className="vti-dw-unit-toggle">
              {(['cm', 'm'] as const).map(u => (
                <button key={u} type="button"
                  className={`vti-dw-unit-opt${unit === u ? ' is-active' : ''}`}
                  onClick={() => setUnit(u)}>
                  {u.toUpperCase()}
                </button>
              ))}
            </div>
            <span className="vti-dw-dim-label">Weight</span>
            <div className="vti-dw-unit-toggle">
              {(['kg', 'g'] as const).map(u => (
                <button key={u} type="button"
                  className={`vti-dw-unit-opt${wUnit === u ? ' is-active' : ''}`}
                  onClick={() => setWUnit(u)}>
                  {u.toUpperCase()}
                </button>
              ))}
            </div>
            <Tooltip label="Upload a photo of this box">
              <button type="button" className="vti-dw-icon-btn"><IcoUpload size={13} stroke={2.3} /> Upload</button>
            </Tooltip>
            <Tooltip label="Photograph this box with the camera">
              <button type="button" className="vti-dw-icon-btn"><IcoCamera size={13} stroke={2.3} /> Camera</button>
            </Tooltip>
            <button type="button" className="vti-dw-save-btn"
              disabled={saving || saved || !onSave}
              onClick={() => onSave?.(collect())}>
              <IcoSave size={12} stroke={2.5} /> {saving ? 'Saving…' : saved ? 'Saved' : 'Save'}
            </button>
          </div>
          <Tooltip label={saved ? `Print the sticker for ${boxId}` : 'Save the box first — the sticker carries its box ID'}>
            <button type="button" className="vti-dw-sticker-btn" disabled={!saved}
              onClick={() => { if (saved) setStickerOpen(true); }}>
              <IcoBox size={13} stroke={2.3} /> Box Sticker
            </button>
          </Tooltip>
        </div>

        <div className="vti-dw-body">
          {mixedCarton && (
            <SelectedProducts
              rows={contentRows}
              identities={identities}
              onIdentityChange={patchIdentity}
              onRemove={onRemoveContent}
              onClear={onClearContents}
            />
          )}

          <div className="vti-dw-section">
            <div className="vti-dw-section-hd">
              <div className="vti-dw-section-title"><IcoBox size={13} stroke={2.3} /> Box Core Details</div>
            </div>

            <div className="vti-dw-fields">
              {DIMENSIONS.map((f, i) => (
                <Fragmentish key={f.key}>
                  {i === 3 && <div className="vti-dw-field-sep" />}
                  <div className="vti-dw-field">
                    <label className="vti-dw-field-lbl">
                      {f.label} <span className="vti-dw-unit-tag">{f.unit === 'dim' ? unit : wUnit}</span>
                    </label>
                    <input className="vti-dw-inp" type="number" min={0} step="0.01" placeholder="0.00"
                      value={dims[f.key] ?? ''}
                      onChange={e => setDims(d => ({ ...d, [f.key]: e.target.value }))} />
                  </div>
                </Fragmentish>
              ))}
              <div className="vti-dw-field vti-dw-field--auto">
                <label className="vti-dw-field-lbl">
                  Vol. Weight <span className="vti-dw-unit-tag">{wUnit}</span>{' '}
                  <span className="vti-dw-auto-tag">Auto</span>
                </label>
                <input className="vti-dw-inp vti-dw-inp--auto" type="text" placeholder="—"
                  value={volumetric} readOnly />
              </div>
            </div>

            <div className="vti-dw-row2-inner">
              <div className="vti-dw-mini-section">
                <div className="vti-dw-mini-title">Product Remark</div>
                <div className="vti-dw-remarks">
                  {REMARKS.map(r => (
                    <button key={r.id} type="button"
                      className={`vti-rmk-btn ${r.cls}${remark === r.id ? ' is-active' : ''}`}
                      onClick={() => setRemark(r.id)}>
                      {r.title}<span className="vti-rmk-btn-sub">{r.sub}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="vti-dw-mini-section">
                <div className="vti-dw-mini-title">Box Condition</div>
                <div className="vti-dw-conditions">
                  {CONDITIONS.map(c => (
                    <button key={c.id} type="button"
                      className={`vti-cond-btn ${c.cls}${condition === c.id ? ' is-active' : ''}`}
                      onClick={() => setCondition(c.id)}>
                      {c.title}<span className="vti-cond-btn-sub">{c.sub}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="vti-dw-mini-section">
                <div className="vti-dw-mini-title-row">
                  <div className="vti-dw-mini-title">Product Flags</div>
                  <Tooltip label="Add a product flag to the master">
                    <button type="button" className="vti-flag-add-btn"
                      onClick={() => setFlagsOpen(true)}>+</button>
                  </Tooltip>
                </div>
                <div className="vti-dw-flags">
                  {FLAGS.map(f => {
                    const on = flags.includes(f.id);
                    const cold = f.id === 'coldchain';
                    const label = cold && on && formatRange(temp)
                      ? `${f.label} · ${formatRange(temp)}`
                      : f.label;
                    return (
                      <button key={f.id} type="button"
                        className={`vti-flag-btn ${f.cls}${on ? ' is-active' : ''}`}
                        aria-pressed={on}
                        onClick={() => {
                          toggleFlag(f.id);
                          if (!cold) return;
                          if (on) setTemp({ min: '', max: '' });
                          else setTempOpen(true);
                        }}>
                        <IcoWarn size={11} stroke={2.5} />{label}
                      </button>
                    );
                  })}
                  {customFlags.map(f => {
                    const on = flags.includes(f.id);
                    return (
                      <button
                        key={f.id}
                        type="button"
                        className={`vti-flag-btn invf-flag-custom${on ? ' is-active' : ''}`}
                        aria-pressed={on}
                        style={on
                          ? { background: f.color, borderColor: f.color, color: '#fff', boxShadow: `0 4px 16px ${f.color}66` }
                          : { color: f.color, borderColor: `${f.color}66`, background: `${f.color}14` }}
                        onClick={() => toggleFlag(f.id)}
                      >
                        <IcoTag size={11} stroke={2.4} />{f.name}
                      </button>
                    );
                  })}
                  <div
                    className={`vti-stack-toggle${stackable ? ' is-stack' : ''}`}
                    role="switch" tabIndex={0} aria-checked={stackable}
                    onClick={() => setStackable(s => !s)}
                    onKeyDown={e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); setStackable(s => !s); } }}
                  >
                    <span className="vti-stack-sw"><span className="vti-stack-knob" /></span>
                    <span className="vti-stack-txt">Stackable</span>
                  </div>
                </div>
              </div>
            </div>

          </div>

          {!mixedCarton && (
            <div className="vti-dw-advanced">
              <button type="button" className={`vti-dw-adv-toggle${advOpen ? ' is-open' : ''}`}
                onClick={() => setAdvOpen(o => !o)}>
                <IcoChevronR size={10} stroke={2.8} className="adv-chev" />
                Advanced Details<span style={{ fontWeight: 400, opacity: .6 }}>&nbsp;(optional)</span>
              </button>
              {advOpen && (
                <div className="vti-dw-adv-body is-open">
                  <div className="vti-dw-adv-fields">
                    <div className="vti-adv-line1">
                      {ADVANCED.map(f => (
                        <div className="vti-dw-field" key={f.key}>
                          <label className="vti-dw-field-lbl">{f.label}</label>
                          {/* Same here: the app's picker, not the browser's. */}
                          {f.type === 'date' ? (
                            <MasterDatePicker
                              value={boxIdentity[f.key] ?? ''}
                              onChange={v => setBoxIdentity(m => ({ ...m, [f.key]: v }))}
                              placeholder={f.label}
                            />
                          ) : (
                            <input
                              className="vti-dw-inp" type={f.type} placeholder={f.placeholder}
                              value={boxIdentity[f.key] ?? ''}
                              onChange={e => setBoxIdentity(m => ({ ...m, [f.key]: e.target.value }))}
                            />
                          )}
                        </div>
                      ))}
                    </div>
                    <div className="vti-adv-line2">
                      <div className="vti-dw-field">
                        <label className="vti-dw-field-lbl">Remarks</label>
                        <input
                          className="vti-dw-inp" type="text"
                          placeholder="Any additional notes about this box..."
                          value={boxIdentity.remarks ?? ''}
                          onChange={e => setBoxIdentity(m => ({ ...m, remarks: e.target.value }))}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      {stickerOpen && (
        <BoxStickerModal
          boxId={boxId}
          rows={contentRows}
          quantity={quantity}
          scenario={scenario}
          modeLabel={modeLabel}
          condition={CONDITIONS.find(c => c.id === condition)?.title ?? 'Perfect'}
          onClose={() => setStickerOpen(false)}
        />
      )}

      {tempOpen && (
        <TemperatureModal
          range={temp}
          onApply={r => { setTemp(r); setTempOpen(false); }}
          onCancel={() => {
            setTempOpen(false);
            if (!formatRange(temp)) setFlags(f => f.filter(x => x !== 'coldchain'));
          }}
        />
      )}

      {flagsOpen && (
        <Suspense fallback={null}>
          <AddProductFlagModal onClose={() => setFlagsOpen(false)} />
        </Suspense>
      )}
    </Shell>
  );
}

function AccordionShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="vti-drawer-inner">
      <div className="vti-drawer-content">{children}</div>
    </div>
  );
}

function PanelShell({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

function Caret({ up }: { up?: boolean }) {
  return (
    <svg width="7" height="4" viewBox="0 0 7 4" aria-hidden
      style={up ? undefined : { transform: 'rotate(180deg)' }}>
      <path d="M3.5 0 7 4H0z" fill="currentColor" />
    </svg>
  );
}

function StripItem({ label, className, children }: {
  label: string; className?: string; children: React.ReactNode;
}) {
  return (
    <div className={`vti-dw-strip-item${className ? ` ${className}` : ''}`}>
      <span className="vti-dw-strip-lbl">{label}</span>
      {children}
    </div>
  );
}

function Fragmentish({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
