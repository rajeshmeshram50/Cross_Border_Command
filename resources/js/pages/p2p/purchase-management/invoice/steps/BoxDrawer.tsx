import { useCallback, useState } from 'react';
import {
  IcoBox, IcoCamera, IcoChevronR, IcoSave, IcoTag, IcoThermometer, IcoUpload, IcoWarn,
} from '../../../icons';
import ProductFlagsModal, { type CustomFlag } from './ProductFlagsModal';
import TemperatureModal, { formatRange, type TempRange } from './TemperatureModal';
import SelectedProducts, {
  EMPTY_IDENTITY, type BoxContent, type ProductIdentity,
} from './SelectedProducts';
import BoxStickerModal from './BoxStickerModal';
import type { ProductLine } from '../invoice-products';

/** How a box's contents came in. */
const REMARKS = [
  { id: 'correct', cls: 'vti-rmk-correct', title: 'Correct Product', sub: 'As expected' },
  { id: 'damaged', cls: 'vti-rmk-damaged', title: 'Damaged / Rejected', sub: 'Not accepted' },
  { id: 'mismatch', cls: 'vti-rmk-mismatch', title: 'Mismatched', sub: 'Wrong item' },
  { id: 'extra', cls: 'vti-rmk-extra', title: 'Extra Quantity', sub: 'Over-supplied' },
] as const;

/** What state the carton itself arrived in. */
const CONDITIONS = [
  { id: 'perfect', cls: 'vti-cond-perfect', title: 'Perfect', sub: 'No damage' },
  { id: 'minor', cls: 'vti-cond-minor', title: 'Minor Damage', sub: 'Light wear' },
  { id: 'severe', cls: 'vti-cond-severe', title: 'Critical Damage', sub: 'Not usable' },
] as const;

/** The three standing handling flags. */
const FLAGS = [
  { id: 'hazardous', cls: 'flag-hazardous', label: 'Hazardous' },
  { id: 'coldchain', cls: 'flag-coldchain', label: 'Cold Chain' },
  { id: 'fragile', cls: 'flag-fragile', label: 'Fragile' },
] as const;

/** The box's measurements. Each one follows the toggle for its own kind. */
const DIMENSIONS = [
  { key: 'length', label: 'Length', unit: 'dim' },
  { key: 'width', label: 'Width', unit: 'dim' },
  { key: 'height', label: 'Height', unit: 'dim' },
  { key: 'weight', label: 'Weight', unit: 'wt' },
  { key: 'netWeight', label: 'Net Weight', unit: 'wt' },
  { key: 'grossWeight', label: 'Gross Weight', unit: 'wt' },
] as const;

/**
 * The optional identifiers, behind Advanced Details.
 *
 * A box holding ONE product carries exactly one of each, so they belong to the
 * box and sit here. A mixed carton does not — four SKUs have four lots and four
 * expiry dates — so there they are per product, as columns in Selected
 * Products, and this panel is not shown at all.
 */
const ADVANCED = [
  { key: 'serial', label: 'Serial No.', placeholder: 'e.g. SN-001', type: 'text' },
  { key: 'lot', label: 'Lot No.', placeholder: 'e.g. LT-001', type: 'text' },
  { key: 'batch', label: 'Batch No.', placeholder: 'e.g. BT-001', type: 'text' },
  { key: 'cat', label: 'Cat No.', placeholder: 'e.g. CT-001', type: 'text' },
  { key: 'expiry', label: 'Expiry Date', placeholder: '', type: 'date' },
  { key: 'mfg', label: 'MFG Date', placeholder: '', type: 'date' },
] as const;

/** The air-freight divisor: L × W × H in cm, over 5000, gives kg. */
const VOLUMETRIC_DIVISOR = 5000;

/**
 * One box, opened under its product row.
 *
 * Everything on it describes a single physical carton: its id, its dimensions,
 * what was inside, what state it arrived in, and the identifiers printed on
 * it. The `vti-dw-*` classes are the prototype's own; nothing in the repo had
 * a box drawer to borrow from.
 */
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
  customFlags = [],
  onAddFlag,
  onRemoveFlag,
  onQuantityChange,
}: {
  boxId: string;
  line: ProductLine;
  quantity: number;
  /** Which packing scenario this box belongs to. */
  scenario?: string;
  /** Scenario 01 labels this slot "Mode"; a split calls it "Box". */
  modeKey?: string;
  /** "Single Box", or "Box 3 of 20" in a split. */
  modeLabel?: string;
  /**
   * Where this drawer is mounted.
   *
   * 'accordion' (the default) wraps it in `.vti-drawer-inner`, which the
   * product row's `.vti-drawer-row.is-open` expands from max-height 0.
   * 'panel' renders it bare, for the split-carton strip: there is no drawer
   * row there, so that wrapper would collapse the whole thing to nothing —
   * which is exactly what it did. The prototype puts the strip and body
   * straight into `.vmb-panel` for the same reason.
   */
  variant?: 'accordion' | 'panel';
  /**
   * What is in this box, when it is more than the one product above.
   *
   * Left out for a single box or one carton of a split, where the contents are
   * exactly `line` at `quantity` and saying so twice would only let the two
   * disagree. A mixed carton passes its several products.
   */
  contents?: BoxContent[];
  /** Given only where a product can be taken back out — a mixed carton. */
  onRemoveContent?: (code: string) => void;
  onClearContents?: () => void;
  /** Finalises the box. The product then leaves the table above and appears
   *  under Packed Products. */
  onSave?: () => void;
  /* Custom flags are shared by every box on the step, not owned by one of
     them: a flag created on one carton should be offered on all of them. */
  customFlags?: CustomFlag[];
  onAddFlag?: (f: CustomFlag) => void;
  onRemoveFlag?: (id: string) => void;
  /** Given when this box's unit count may be changed. Absent on a single-box
   *  carton, where the quantity IS the product's quantity. */
  onQuantityChange?: (qty: number) => void;
}) {
  const [unit, setUnit] = useState<'cm' | 'm'>('cm');
  /* Weight switches too. It used to be fixed at kg while the sides switched,
     so half the row's unit tags could be changed and half could not, with
     nothing saying why. */
  const [wUnit, setWUnit] = useState<'kg' | 'g'>('kg');
  const [dims, setDims] = useState<Record<string, string>>({});
  const [remark, setRemark] = useState<string>('correct');
  const [condition, setCondition] = useState<string>('perfect');
  const [flags, setFlags] = useState<string[]>([]);
  const [stackable, setStackable] = useState(true);
  const [flagsOpen, setFlagsOpen] = useState(false);
  /* Kept as strings: an empty field is '' and a typed minus sign is '-', and
     neither survives a round trip through Number. */
  const [temp, setTemp] = useState<TempRange>({ min: '', max: '' });
  const [tempOpen, setTempOpen] = useState(false);
  const [stickerOpen, setStickerOpen] = useState(false);
  const [advOpen, setAdvOpen] = useState(false);
  /* Wired, unlike the panel this restores: its inputs carried no value and no
     onChange, so everything typed into them was discarded. */
  const [boxIdentity, setBoxIdentity] = useState<Record<string, string>>({});

  /* The identifiers for whatever is in THIS box, keyed by product code.
     Held per drawer rather than per step: one product split across twenty
     cartons is twenty boxes, and keying by product alone would give them all
     the same lot number. One drawer is one box, so a code is unique here. */
  const [identities, setIdentities] = useState<Record<string, ProductIdentity>>({});
  const patchIdentity = useCallback((code: string, patch: Partial<ProductIdentity>) => {
    setIdentities(m => ({ ...m, [code]: { ...(m[code] ?? EMPTY_IDENTITY), ...patch } }));
  }, []);
  /* A box with no explicit contents holds exactly the product above it, at
     this box's own quantity — which in a split is its share, not the total. */
  const contentRows: BoxContent[] = contents ?? [{ line, qty: quantity }];
  /* Only a mixed carton is given contents; every other box holds exactly the
     product above it, which is what tells the two layouts apart. */
  const mixedCarton = !!contents;


  /* Volumetric weight — what a carrier bills when a box is bulky but light.
     Computed, never typed, which is what the AUTO tag on the field means.

     The unit toggle re-reads the same figures in the new unit rather than
     converting them, so switching to M does raise the answer: 50 metres is a
     hundred times 50 centimetres, and the volume a million times. The sides
     are normalised to cm and divided by the standard 5000.

     NOTE: the prototype divides by 5 for metres, which is not the standard
     factor — 1 m3 is 1,000,000 cm3, so metres work out at x200, not /5. This
     follows the formula a carrier actually bills on. */
  const volumetric = (() => {
    const toCm = (v: string) => (Number(v) || 0) * (unit === 'm' ? 100 : 1);
    const cc = toCm(dims.length) * toCm(dims.width) * toCm(dims.height);
    if (cc <= 0) return '';
    /* The divisor yields kilograms; shown in grams when that is what the
       weights beside it are in, so the two can be read against each other. */
    const kg = cc / VOLUMETRIC_DIVISOR;
    return (wUnit === 'g' ? kg * 1000 : kg).toFixed(2);
  })();

  const toggleFlag = (id: string) =>
    setFlags(f => (f.includes(id) ? f.filter(x => x !== id) : [...f, id]));

  /* The accordion needs the collapsing wrapper; the split panel must not have
     it. Rendering the body once and choosing its shell keeps the two mountings
     from drifting apart. */
  const Shell = variant === 'accordion' ? AccordionShell : PanelShell;

  return (
    <Shell>

        {/* The identity strip: which box this is, and the actions on it. */}
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
                /* Editable when the caller can take the change — a split's
                   boxes are an even division to start with, but a packer
                   moves units between cartons as they fill them.

                   Typed OR stepped: the steppers are our own rather than the
                   browser's, which are a few pixels wide, appear only on
                   hover, and render differently in every engine. */
                <span className="vti-dw-strip-qty invf-qty-edit">
                  <span className="vti-dw-strip-qty-dot" />
                  <input
                    type="number" min={0} className="invf-qty-inp"
                    value={quantity}
                    aria-label="Units in this box"
                    onChange={e => onQuantityChange(Math.max(0, Number(e.target.value) || 0))}
                  />
                  {/* Stacked arrows at the field's right edge, the shape of the
                      Sub-Box Count spinner. Drawn rather than left native: the
                      browser's own spinner is invisible against this teal strip
                      and appears only on hover. */}
                  <span className="invf-qty-spin">
                    <button
                      type="button" className="invf-qty-spin__btn" aria-label="One unit more"
                      onClick={() => onQuantityChange(quantity + 1)}
                    >
                      <Caret up />
                    </button>
                    <button
                      type="button" className="invf-qty-spin__btn" aria-label="One unit fewer"
                      /* Nothing below zero: a carton cannot hold a negative. */
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
            {/* The same control for the other half of the row. Without it the
                sides could be switched and the weights could not, which is
                only visible as unit tags that respond differently. */}
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
            <button type="button" className="vti-dw-icon-btn" title="Upload Photo"><IcoUpload size={13} stroke={2.3} /> Upload</button>
            <button type="button" className="vti-dw-icon-btn" title="Camera"><IcoCamera size={13} stroke={2.3} /> Camera</button>
            <button type="button" className="vti-dw-icon-btn" title="Scan Barcode"><IcoBox size={13} stroke={2.3} /> Scan</button>
            <button type="button" className="vti-dw-save-btn" onClick={onSave}>
              <IcoSave size={12} stroke={2.5} /> Save
            </button>
          </div>
          <button type="button" className="vti-dw-sticker-btn" onClick={() => setStickerOpen(true)}>
            <IcoBox size={13} stroke={2.3} /> Box Sticker
          </button>
        </div>

        <div className="vti-dw-body">
          {/* The carton's contents, above the figures that describe the
              carton itself — what is in the box, then the box. A mixed carton
              shows this INSTEAD of the Advanced Details panel at the foot:
              four SKUs have four lots and four expiry dates, which one
              box-level set cannot express, so the identifiers are columns
              here. The two never appear together. */}
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
                  {/* A rule after the third field: the measurements and the
                      weights are two different kinds of number. */}
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
                {/* readOnly, not disabled: a disabled field is skipped by the
                    keyboard and drops out of a form submission. */}
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
                  <button type="button" className="vti-flag-add-btn" title="Add a custom product flag"
                    onClick={() => setFlagsOpen(true)}>+</button>
                </div>
                {/* Flags are independent of each other, so they toggle rather
                    than select — a box can be both fragile and cold chain. */}
                <div className="vti-dw-flags">
                  {FLAGS.map(f => {
                    const on = flags.includes(f.id);
                    /* Cold Chain is the one flag that needs an answer as well
                       as a state, so switching it on asks for the range. The
                       chip then carries it, which is where you would look. */
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
                          /* Switching Cold Chain ON asks for the range; OFF
                             clears it, so a stale one cannot reappear when the
                             flag is switched on again. Otherwise this chip
                             toggles exactly like the rest. */
                          if (!cold) return;
                          if (on) setTemp({ min: '', max: '' });
                          else setTempOpen(true);
                        }}>
                        <IcoWarn size={11} stroke={2.5} />{label}
                      </button>
                    );
                  })}
                  {/* Custom flags sit with the standing three and toggle the
                      same way. Their colour is inline because it is data, not
                      one of a fixed set of classes. */}
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

          {/* A box holding one product carries exactly one serial, one lot
              and one batch, so they belong to the box and sit here, closed by
              default — six fields most boxes never carry. A mixed carton has
              its identifiers per product in the table above instead. */}
          {!mixedCarton && (
            <div className="vti-dw-advanced">
              <button type="button" className={`vti-dw-adv-toggle${advOpen ? ' is-open' : ''}`}
                onClick={() => setAdvOpen(o => !o)}>
                <IcoChevronR size={10} stroke={2.8} className="adv-chev" />
                {/* The gap is a non-breaking space INSIDE the span. The toggle
                    is a flex row, and a whitespace-only text node between two
                    flex items is not rendered at all — a plain space vanishes. */}
                Advanced Details<span style={{ fontWeight: 400, opacity: .6 }}>&nbsp;(optional)</span>
              </button>
              {advOpen && (
                <div className="vti-dw-adv-body is-open">
                  <div className="vti-dw-adv-fields">
                    <div className="vti-adv-line1">
                      {ADVANCED.map(f => (
                        <div className="vti-dw-field" key={f.key}>
                          <label className="vti-dw-field-lbl">{f.label}</label>
                          <input
                            className="vti-dw-inp" type={f.type} placeholder={f.placeholder}
                            value={boxIdentity[f.key] ?? ''}
                            onChange={e => setBoxIdentity(m => ({ ...m, [f.key]: e.target.value }))}
                          />
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
          /* The chosen condition by its label, not its id: the sticker is read
             by a person at a rack, not by the code that set it. */
          condition={CONDITIONS.find(c => c.id === condition)?.title ?? 'Perfect'}
          onClose={() => setStickerOpen(false)}
        />
      )}

      {tempOpen && (
        <TemperatureModal
          range={temp}
          onApply={r => { setTemp(r); setTempOpen(false); }}
          /* Cancelled with no range set means the flag was never answered, so
             it goes back off rather than sitting on with nothing behind it. */
          onCancel={() => {
            setTempOpen(false);
            if (!formatRange(temp)) setFlags(f => f.filter(x => x !== 'coldchain'));
          }}
        />
      )}

      {flagsOpen && (
        <ProductFlagsModal
          flags={customFlags}
          onAdd={f => onAddFlag?.(f)}
          onRemove={id => onRemoveFlag?.(id)}
          onClose={() => setFlagsOpen(false)}
        />
      )}
    </Shell>
  );
}

/**
 * The accordion mounting: the collapsing wrapper the product row expands.
 * `.vti-drawer-inner` is max-height 0 until `.vti-drawer-row.is-open` opens it.
 */
function AccordionShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="vti-drawer-inner">
      <div className="vti-drawer-content">{children}</div>
    </div>
  );
}

/** The split-carton mounting: no wrapper, because `.vmb-panel` is the shell. */
function PanelShell({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

/**
 * One arrowhead of the quantity spinner.
 *
 * A filled triangle rather than a chevron, because that is the shape the
 * browser's own spinner draws and the Sub-Box Count field shows.
 */
function Caret({ up }: { up?: boolean }) {
  return (
    <svg width="7" height="4" viewBox="0 0 7 4" aria-hidden
      style={up ? undefined : { transform: 'rotate(180deg)' }}>
      <path d="M3.5 0 7 4H0z" fill="currentColor" />
    </svg>
  );
}

/** One labelled item on the identity strip. */
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

/* The separator sits between two siblings in a grid, so the pair needs one
   parent that renders nothing of its own. A shorthand fragment cannot take a
   key, hence the named one. */
function Fragmentish({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
