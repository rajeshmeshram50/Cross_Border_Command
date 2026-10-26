import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import useDismissPopover from '../../../../../hooks/useDismissPopover';
import { useScrollLock } from '../../../../../hooks/useScrollLock';
import { MasterDatePicker } from '../../../../../components/ui/MasterDatePicker';
import Tooltip from '../../../../../components/ui/Tooltip';
import {
  IcoBox, IcoCamera, IcoCheck, IcoChevronR, IcoSave, IcoTag, IcoThermometer, IcoUpload, IcoWarn, IcoX,
} from '../../../icons';
import { type CustomFlag } from './ProductFlagsModal';
const AddProductFlagModal = lazy(() => import('../../../../inventory-management/product-flag/AddProductFlagModal'));
const CameraCaptureModal = lazy(() => import('../../order/physical-inspection/CameraCaptureModal'));

type Shot = { file: File; url: string };
import TemperatureModal, { formatRange, type TempRange } from './TemperatureModal';
import SelectedProducts, {
  EMPTY_IDENTITY, type BoxContent, type ProductIdentity,
} from './SelectedProducts';
import BoxStickerModal from './BoxStickerModal';
import type { ProductLine } from '../invoice-products';
import { putId } from '../spi-api';

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
  /* The cold-chain range as numbers, null when the box is not cold chain or
     no range has been set. `note` still carries the human sentence for the
     remark line; these two are what anything can actually compare. */
  tempMin: number | null;
  tempMax: number | null;
  note: string | null;
  boxIdentity: ProductIdentity;
  identities: Record<string, ProductIdentity>;
}

export interface BoxInitial {
  dims: BoxSaveData['dims'];
  condition: BoxSaveData['condition'];
  remark: BoxSaveData['remark'];
  flagIds: string[];
  stackable: boolean;
  boxIdentity: ProductIdentity;
  identities: Record<string, ProductIdentity>;
  temp?: TempRange;
}

const VOLUMETRIC_DIVISOR = 5000;

const dimStr = (v: number | null | undefined) => (v == null ? '' : String(v));

export default function BoxDrawer({
  boxId, line, quantity, initial,
  scenario = '1 Product → 1 Box',
  modeKey = 'Mode',
  modeLabel = 'Single Box',
  variant = 'accordion',
  contents,
  onRemoveContent,
  onContentQtyChange,
  contentQtyMaxOf,
  onClearContents,
  onSave,
  onClose,
  saving = false,
  saved = false,
  savedBanner,
  customFlags = [],
  onFlagCreated,
  onQuantityChange,
  quantityMax,
}: {
  boxId: string;
  line: ProductLine;
  quantity: number;
  initial?: BoxInitial;
  scenario?: string;
  modeKey?: string;
  modeLabel?: string;
  variant?: 'accordion' | 'panel' | 'modal';
  contents?: BoxContent[];
  onRemoveContent?: (code: string) => void;
  onContentQtyChange?: (code: string, qty: number) => void;
  /** Per-product ceiling for the content steppers. */
  contentQtyMaxOf?: (code: string) => number;
  onClearContents?: () => void;
  onSave?: (data: BoxSaveData) => void;
  onClose?: () => void;
  saving?: boolean;
  /** Ceiling for the quantity stepper. Defaults to the line's open units. */
  quantityMax?: number;
  saved?: boolean;
  /** Shown under the header once `saved`. The wording is the caller's because
   *  it differs per scenario — see the note at the render site. */
  savedBanner?: { note: string; actionLabel: string; onAction: () => void };
  customFlags?: CustomFlag[];
  onFlagCreated?: () => void;
  onQuantityChange?: (qty: number) => void;
}) {
  const [unit, setUnit] = useState<'cm' | 'm'>('cm');
  /* Weight is kilograms. The toggle that let it be grams is gone (see the
     note in the toolbar), so the conversions below collapse to 1. */
  const wUnit = 'kg' as const;
  const [dims, setDims] = useState<Record<string, string>>((): Record<string, string> => (initial ? {
    length: dimStr(initial.dims.length_cm),
    width: dimStr(initial.dims.width_cm),
    height: dimStr(initial.dims.height_cm),
    weight: dimStr(initial.dims.weight_kg),
    netWeight: dimStr(initial.dims.net_weight_kg),
    grossWeight: dimStr(initial.dims.gross_weight_kg),
  } : {}));
  const [remark, setRemark] = useState<string>(
    initial ? (initial.remark === 'mismatched' ? 'mismatch' : initial.remark) : 'correct',
  );
  const [condition, setCondition] = useState<string>(initial?.condition ?? 'perfect');
  const [flags, setFlags] = useState<string[]>(initial?.flagIds ?? []);
  const [stackable, setStackable] = useState(initial?.stackable ?? true);
  const [flagsOpen, setFlagsOpen] = useState(false);
  /* One. The row already carries three built-in flags and the Stackable
     toggle, and custom names run long — three of them was still enough to
     force the strip wider than the drawer. So the second custom flag is
     already behind "+1 more". */
  const CUSTOM_FLAGS_SHOWN = 1;
  /* Exactly four chips in the row: the three built-ins above plus one custom.
     Everything else is behind the counter, whether or not it is switched on.

     Selected flags used to be exempt from the cap — "a flag you cannot see is
     one you cannot clear" — but with eight of them on, the exemption WAS the
     overflow: every flag stayed in the row and the counter never appeared.
     The panel can clear them just as well, so the cap holds and the counter
     says how many of the hidden ones are on. */
  const visibleCustomFlags = customFlags.slice(0, CUSTOM_FLAGS_SHOWN);
  const hiddenCustomFlags = customFlags.slice(CUSTOM_FLAGS_SHOWN);
  const hiddenOnCount = hiddenCustomFlags.filter(f => flags.includes(f.id)).length;
  /* The rest open in a popover rather than unfolding into the row. Expanding
     in place pushed this strip wider again, which is the thing the counter is
     here to stop; a portalled panel is laid out against the viewport and
     cannot disturb the drawer at all. Same interaction as the CLM masters'
     "+N" authority chips. */
  const [flagPop, setFlagPop] = useState<{ x: number; y: number; flipUp: boolean } | null>(null);
  /* `inside` matters: the hook closes on any scroll EXCEPT one that starts
     inside the popover, and it finds the popover by this selector. It defaults
     to '.clm-pop', which is CLM's class and matches nothing here — so every
     wheel tick over this list counted as an outside scroll and shut the panel.
     With 50+ flags the list is the one thing you have to scroll. */
  useDismissPopover(!!flagPop, () => setFlagPop(null), { inside: '.vti-flag-pop' });
  const [temp, setTemp] = useState<TempRange>(initial?.temp ?? { min: '', max: '' });
  const [tempOpen, setTempOpen] = useState(false);
  const [stickerOpen, setStickerOpen] = useState(false);
  const [advOpen, setAdvOpen] = useState(false);
  const [boxIdentity, setBoxIdentity] = useState<Record<string, string>>(
    () => (initial ? { ...initial.boxIdentity } : {}),
  );

  const [identities, setIdentities] = useState<Record<string, ProductIdentity>>(
    () => initial?.identities ?? {},
  );

  const [photos, setPhotos] = useState<Shot[]>([]);
  const [camOpen, setCamOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const addPhotos = useCallback((files: File[]) => {
    const pics = files.filter(f => f.type.startsWith('image/'));
    if (!pics.length) return;
    setPhotos(p => [...p, ...pics.map(file => ({ file, url: URL.createObjectURL(file) }))]);
  }, []);

  const dropPhoto = (url: string) => {
    URL.revokeObjectURL(url);
    setPhotos(p => p.filter(s => s.url !== url));
  };

  const photosRef = useRef(photos);
  photosRef.current = photos;
  useEffect(() => () => { photosRef.current.forEach(s => URL.revokeObjectURL(s.url)); }, []);
  const patchIdentity = useCallback((code: string, patch: Partial<ProductIdentity>) => {
    setIdentities(m => ({ ...m, [code]: { ...(m[code] ?? EMPTY_IDENTITY), ...patch } }));
  }, []);
  const contentRows: BoxContent[] = contents ?? [{ line, qty: quantity }];
  const mixedCarton = !!contents;

  /* The ceiling the stepper counts up to. Defaults to what is left of the
     line, which is right for a single box; a split box passes its own share
     plus whatever is still unallocated, so raising one box is bounded by the
     units actually available rather than by the whole line. */
  const qtyMax = Math.max(quantity, quantityMax ?? line.spiQty);

  const volumetric = (() => {
    const toCm = (v: string) => (Number(v) || 0) * (unit === 'm' ? 100 : 1);
    const cc = toCm(dims.length) * toCm(dims.width) * toCm(dims.height);
    if (cc <= 0) return '';
    const kg = cc / VOLUMETRIC_DIVISOR;
    return kg.toFixed(2);
  })();

  const collect = (): BoxSaveData => {
    const num = (v: string | undefined, factor: number) => {
      const n = parseFloat(v ?? '');
      return Number.isFinite(n) ? Math.round(n * factor * 1000) / 1000 : null;
    };
    const dimF = unit === 'm' ? 100 : 1;
    const wtF = 1;
    const isCold = flags.includes('coldchain');
    const numOrNull = (v: string | number | null | undefined) => {
      const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
      return Number.isFinite(n) ? n : null;
    };
    const range = isCold ? formatRange(temp) : '';
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
      // Only a cold-chain box carries a range; anything else sends nulls so a
      // flag turned off does not leave its temperatures behind.
      tempMin: isCold ? numOrNull(temp.min) : null,
      tempMax: isCold ? numOrNull(temp.max) : null,
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

  const Shell = variant === 'accordion' ? AccordionShell
    : variant === 'modal' ? ModalShell
      : PanelShell;

  return (
    <Shell onClose={variant === 'modal' ? onClose : undefined}>

        <div className="vti-dw-strip">
          <div className="vti-dw-strip-accent" />
          <div className="vti-dw-strip-left">
            <StripItem label="Box ID" className="strip-boxid">
              <span className="vti-dw-strip-val vti-dw-strip-id">{putId(boxId)}</span>
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
            {/* "Box Quantity" when you can set it, "Total Qty" when you
                cannot — a mixed carton's figure is the sum of its products
                and is changed on their rows, not here. */}
            <StripItem label={onQuantityChange ? 'Box Quantity' : 'Total Qty'}>
              {onQuantityChange ? (
                /* Stepper, not a number input with carets. The carets were
                   8px tall and stacked, which is a hard target on a warehouse
                   screen; round −/+ either side of the value are the obvious
                   controls. "/ max" sits with them because the ceiling is
                   part of the reading: 14 means little without "of 20". */
                <span className="vti-dw-qty">
                  <button
                    type="button" className="vti-dw-qty-btn" aria-label="One unit fewer"
                    disabled={quantity <= 0}
                    onClick={() => onQuantityChange(Math.max(0, quantity - 1))}
                  >&minus;</button>
                  <input
                    type="text" inputMode="numeric" className="vti-dw-qty-val"
                    value={quantity}
                    aria-label="Units in this box"
                    /* Digits only: a number input still accepts "-" and "e",
                       which reached state and had to be cleaned up later. */
                    onChange={e => {
                      const n = Number(e.target.value.replace(/[^\d]/g, '')) || 0;
                      onQuantityChange(Math.min(Math.max(0, n), qtyMax));
                    }}
                  />
                  <button
                    type="button" className="vti-dw-qty-btn" aria-label="One unit more"
                    disabled={quantity >= qtyMax}
                    onClick={() => onQuantityChange(Math.min(qtyMax, quantity + 1))}
                  >+</button>
                  <span className="vti-dw-qty-max">/ {qtyMax}</span>
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
            {/* No Weight KG/G toggle: the design has only Dimensions here,
                and each weight field already carries its unit as a chip on
                its own label (WEIGHT KG, VOL. WEIGHT KG). A second toggle
                beside Dimensions read as if it governed them both. Weight is
                kilograms throughout. */}
            <Tooltip label="Upload a photo of this box">
              <button type="button" className="vti-dw-icon-btn" onClick={() => fileRef.current?.click()}>
                <IcoUpload size={13} stroke={2.3} /> Upload
              </button>
            </Tooltip>
            <Tooltip label="Photograph this box with the camera">
              <button type="button" className="vti-dw-icon-btn" onClick={() => setCamOpen(true)}>
                <IcoCamera size={13} stroke={2.3} /> Camera
              </button>
            </Tooltip>
            <button type="button" className="vti-dw-save-btn"
              disabled={saving || (!initial && saved) || !onSave}
              onClick={() => onSave?.(collect())}>
              <IcoSave size={12} stroke={2.5} />
              {/* "Save" when editing too — the design labels it that way, and
                  the dialog's title strip already says which box this is, so
                  "Update Box" was naming the object twice. */}
              {saving ? 'Saving…' : saved && !initial ? 'Saved' : 'Save'}
            </button>
            {/* Inline, "× Close" is one more button in a row of buttons and
                reads as part of the form. In the modal it is the dialog's
                dismiss, so it takes the icon square at the far end, past the
                sticker — last in the row because it is the way out, not an
                action on the box. */}
            {onClose && variant !== 'modal' && (
              <button type="button" className="vti-dw-close-btn" onClick={onClose} disabled={saving}>
                × Close
              </button>
            )}
            {/* Inside the toolbar, not beside it.
                As a direct child of the strip these two were separate flex
                items, so once the strip could wrap they broke away on their
                own — the sticker ended up alone on a third line under the
                buttons it belongs with. In here the whole toolbar wraps as
                one group. */}
          <Tooltip label={saved ? `Print the sticker for ${putId(boxId)}` : 'Save the box first — the sticker carries its box ID'}>
            <button type="button" className="vti-dw-sticker-btn" disabled={!saved}
              onClick={() => { if (saved) setStickerOpen(true); }}>
              {/* Once saved the button names the box it will print, so the id
                  on screen and the id on the label are visibly the same one. */}
              <IcoBox size={13} stroke={2.3} /> {saved ? `${putId(boxId)} Sticker` : 'Box Sticker'}
            </button>
          </Tooltip>
          {onClose && variant === 'modal' && (
            <Tooltip label="Close without saving">
              <button type="button" className="vti-dw-modal-x" onClick={onClose} disabled={saving} aria-label="Close">
                <IcoX size={14} stroke={2.6} />
              </button>
            </Tooltip>
          )}
          </div>
        </div>

        {/* Saved confirmation.
            A box used to vanish the moment it saved — the row collapsed and
            the only proof was a toast. The design keeps the box open and says
            what happened to it, where it went and how much it holds, and waits
            for an explicit dismissal. `note` and the action come from the
            caller because they differ per scenario: a single box is finished
            ("Done"), one box of a split set is not ("Continue Packing"). */}
        {saved && savedBanner && (
          <div className="vti-dw-saved">
            <span className="vti-dw-saved-ico" aria-hidden>
              <IcoCheck size={13} stroke={3} />
            </span>
            <div className="vti-dw-saved-text">
              <div className="vti-dw-saved-title">
                <b>{putId(boxId)}</b> saved to Packed Boxes &amp; Products Details · {quantity} unit{quantity === 1 ? '' : 's'} packed
              </div>
              <div className="vti-dw-saved-note">{savedBanner.note}</div>
            </div>
            <button type="button" className="vti-dw-saved-act" onClick={savedBanner.onAction}>
              {savedBanner.actionLabel} <IcoChevronR size={11} stroke={2.8} />
            </button>
          </div>
        )}

        <div className="vti-dw-body">
          {photos.length > 0 && (
            <div className="vti-dw-shots">
              <div className="vti-dw-shots-lbl">
                Box Photos <span>{photos.length}</span>
              </div>
              <div className="vti-dw-shots-strip">
                {photos.map(s => (
                  <div className="vti-dw-shot" key={s.url}>
                    <img src={s.url} alt={s.file.name} />
                    <button
                      type="button"
                      className="vti-dw-shot__x"
                      onClick={() => dropPhoto(s.url)}
                      aria-label={`Remove ${s.file.name}`}
                    >
                      <IcoX size={10} stroke={3} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {mixedCarton && (
            <SelectedProducts
              rows={contentRows}
              identities={identities}
              onIdentityChange={patchIdentity}
              onRemove={onRemoveContent}
              onClear={onClearContents}
              onQtyChange={onContentQtyChange}
              qtyMaxOf={contentQtyMaxOf}
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
                  {visibleCustomFlags.map(f => {
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
                        <IcoTag size={11} stroke={2.4} />
                        {/* In its own element so it can be truncated. A bare
                            text node in a flex container is anonymous and
                            cannot take text-overflow, so one long flag name
                            would still widen the strip past the drawer. */}
                        <span className="vti-flag-name" title={f.name}>{f.name}</span>
                      </button>
                    );
                  })}
                  {hiddenCustomFlags.length > 0 && (
                    <button type="button" className="vti-flag-more"
                      aria-haspopup="dialog" aria-expanded={!!flagPop}
                      onClick={e => {
                        if (flagPop) { setFlagPop(null); return; }
                        const b = e.currentTarget.getBoundingClientRect();
                        /* Flip above the chip when the panel would not fit
                           below it — this row sits low in a drawer, so below
                           is usually the side without room. */
                        const estH = Math.min(300, 34 + hiddenCustomFlags.length * 38);
                        const spaceBelow = window.innerHeight - b.bottom;
                        const flipUp = spaceBelow < estH + 12 && b.top > spaceBelow;
                        setFlagPop({ x: b.left, y: flipUp ? b.top - 4 : b.bottom + 4, flipUp });
                      }}>
                      +{hiddenCustomFlags.length} more
                      {/* How many of the hidden ones are switched on, so the
                          row never hides a selection without saying so. */}
                      {hiddenOnCount > 0 && (
                        <span className="vti-flag-more__on">{hiddenOnCount}</span>
                      )}
                    </button>
                  )}
                  <div
                    className={`vti-stack-toggle${stackable ? ' is-stack' : ''}`}
                    role="switch" tabIndex={0} aria-checked={stackable}
                    onClick={() => setStackable(s => !s)}
                    onKeyDown={e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); setStackable(s => !s); } }}
                  >
                    <span className="vti-stack-sw"><span className="vti-stack-knob" /></span>
                    <span className="vti-stack-txt">Stackable</span>
                  </div>

                  {/* Portalled to the body, so the panel is positioned against
                      the viewport and cannot widen the drawer. The flags stay
                      live in here — they are toggles, not labels, and one you
                      can see but not switch would be worse than hiding it. */}
                  {/* Nothing hidden means nothing to show. The row re-flows
                      as the panel resizes, so flags that were behind "+2 more"
                      can come back onto the row while the panel is open —
                      leaving it rendering its title over an empty box. */}
                  {flagPop && hiddenCustomFlags.length > 0 && createPortal(
                    <>
                      <div onClick={() => setFlagPop(null)}
                        style={{ position: 'fixed', inset: 0, zIndex: 100000 }} />
                      <div
                        className="vti-flag-pop"
                        role="dialog"
                        aria-label="More product flags"
                        /* Clamped to the viewport with a margin at BOTH ends.
                           It was clamped only on the right and only against
                           the panel's own width, so it could still sit flush
                           to the screen edge — and nothing held the bottom,
                           so a long list ran off the screen. */
                        style={{
                          position: 'fixed',
                          left: Math.max(12, Math.min(flagPop.x, window.innerWidth - 320 - 12)),
                          top: flagPop.flipUp ? undefined : flagPop.y,
                          bottom: flagPop.flipUp ? Math.max(12, window.innerHeight - flagPop.y) : undefined,
                          /* Never taller than the room it actually has. */
                          maxHeight: flagPop.flipUp
                            ? Math.max(160, flagPop.y - 16)
                            : Math.max(160, window.innerHeight - flagPop.y - 16),
                          zIndex: 100001,
                        }}
                      >
                        <div className="vti-flag-pop__title">
                          Product Flags ({customFlags.length})
                        </div>
                        {/* Rows, not the row-chips from the strip above.
                            Each chip there carries its flag's colour as a
                            border and a tint; stacked fifty deep that is
                            fifty outlines down a narrow column, which is what
                            made this panel unreadable. In here the colour
                            stays on the tag and the label, the surface is a
                            quiet alternating tint, and only the flags that
                            are ON take their colour as a fill — so what is
                            selected is the thing that stands out. */}
                        {hiddenCustomFlags.map((f, i) => {
                          const on = flags.includes(f.id);
                          return (
                            <button
                              key={f.id}
                              type="button"
                              /* role=checkbox, not a pressed button: this is a
                                 list you tick through, and the box is the
                                 thing that says what is selected. */
                              role="checkbox"
                              aria-checked={on}
                              /* No per-flag colour in here. Each flag carrying
                                 its own tint made the panel a different colour
                                 on every line — the chips in the row already
                                 show which flag is which, and a list you tick
                                 through should read as one list. Selection is
                                 the app's teal, the same everywhere. */
                              className={`vti-flag-pop__row${on ? ' is-active' : ''}${i % 2 ? ' is-alt' : ''}`}
                              onClick={() => toggleFlag(f.id)}
                            >
                              <span className="vti-flag-pop__box" aria-hidden>
                                {on && <IcoCheck size={10} stroke={3.2} />}
                              </span>
                              <IcoTag size={11} stroke={2.4} />
                              <span className="vti-flag-pop__name" title={f.name}>{f.name}</span>
                            </button>
                          );
                        })}
                      </div>
                    </>,
                    document.body,
                  )}
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
          <AddProductFlagModal onClose={() => setFlagsOpen(false)} onSaved={() => onFlagCreated?.()} />
        </Suspense>
      )}

      {camOpen && (
        <Suspense fallback={null}>
          <CameraCaptureModal
            subject={mixedCarton ? `${contentRows.length} products in ${putId(boxId)}` : line.spiName}
            title={`Photograph ${putId(boxId)}`}
            namePrefix={`box-${boxId.toLowerCase()}`}
            onAttach={files => { addPhotos(files); setCamOpen(false); }}
            onClose={() => setCamOpen(false)}
          />
        </Suspense>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={e => {
          addPhotos(Array.from(e.target.files ?? []));
          e.target.value = '';
        }}
      />
    </Shell>
  );
}

function AccordionShell({ children }: { onClose?: () => void; children: React.ReactNode }) {
  return (
    <div className="vti-drawer-inner">
      <div className="vti-drawer-content">{children}</div>
    </div>
  );
}

function PanelShell({ children }: { onClose?: () => void; children: React.ReactNode }) {
  return <>{children}</>;
}

/**
 * Editing a SAVED box happens over the page, not inside it.
 *
 * Inline, the form opened above the Packed Boxes table and pushed everything
 * below it down — so pressing the pencil on row 5 moved row 5. The design puts
 * the box on top of a dimmed page instead: the row you came from stays where
 * it was, and the form is plainly a thing you finish and close.
 *
 * Portalled to document.body because the table lives inside
 * `.vti-table-wrap`, whose `overflow-x: auto` clips any descendant.
 */
function ModalShell({ onClose, children }: { onClose?: () => void; children: React.ReactNode }) {
  useScrollLock(true);
  useEffect(() => {
    if (!onClose) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return createPortal(
    <div
      className="vti-dw-modal-backdrop"
      /* Only a press that both starts AND ends on the backdrop closes it —
         otherwise releasing a drag that began inside the form (selecting
         text in a field, say) would throw the edit away. */
      onMouseDown={e => { if (e.target === e.currentTarget) onClose?.(); }}
    >
      <div className="vti-dw-modal" role="dialog" aria-modal="true" onMouseDown={e => e.stopPropagation()}>
        {children}
      </div>
    </div>,
    document.body,
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
