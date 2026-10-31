import { useState } from 'react';
import { IcoBox } from '../../../icons';
import BoxDrawer, { type BoxSaveData } from './BoxDrawer';
import type { ProductLine } from '../invoice-products';
import type { CustomFlag } from './ProductFlagsModal';

export interface SplitBox {
  no: number;
  qty: number;
}

/** More boxes than this per product only when the units themselves outnumber it. */
export const MAX_PART_BOXES = 100;

/** Most boxes a quantity can be split into: one per unit, or — for a unit
    shipped in parts, like a machine in several cartons — down to 0.001 a box. */
export const maxSplitBoxes = (total: number) =>
  Math.max(1, Math.floor(total), Math.min(MAX_PART_BOXES, Math.round(total * 1000)));

export function splitQuantity(total: number, boxes: number): SplitBox[] {
  const whole = Math.floor(total);
  /* Fewer units than boxes: each box holds a part of a unit, shared out in
     thousandths so the parts add back to the total exactly. */
  if (boxes > whole) {
    const milli = Math.round(total * 1000);
    const part = Math.floor(milli / boxes);
    const extra = milli % boxes;
    return Array.from({ length: boxes }, (_, i) => ({ no: i + 1, qty: (part + (i < extra ? 1 : 0)) / 1000 }));
  }
  const fraction = Math.round((total - whole) * 1000) / 1000;
  const base = Math.floor(whole / boxes);
  const remainder = whole % boxes;
  return Array.from({ length: boxes }, (_, i) => ({
    no: i + 1,
    qty: base + (i < remainder ? 1 : 0) + (i === boxes - 1 ? fraction : 0),
  }));
}

export default function MultiBoxPanel({
  line, boxes, onClose, closeDisabled = false, onSaveBox, savedCodes = {}, previewCodes = {}, savingNo = null, readOnly = false, customFlags, onFlagCreated, onBoxQty,
}: {
  line: ProductLine;
  boxes: SplitBox[];
  onClose: () => void;
  closeDisabled?: boolean;
  onSaveBox: (boxNo: number, qty: number, data: BoxSaveData) => void;
  savedCodes?: Record<number, string>;
  previewCodes?: Record<number, string>;
  savingNo?: number | null;
  readOnly?: boolean;
  customFlags?: CustomFlag[];
  onFlagCreated?: () => void;
  onBoxQty?: (boxNo: number, qty: number) => void;
}) {
  const [active, setActive] = useState(1);
  const allocated = boxes.reduce((n, b) => n + b.qty, 0);

  const unsaved = boxes.filter(b => !savedCodes[b.no] && b.qty > 0);
  const unitsPacked = boxes.reduce((n, b) => n + (savedCodes[b.no] ? b.qty : 0), 0);
  const unitsLeft = Math.max(0, line.spiQty - unitsPacked);
  const setNote = () => {
    if (unsaved.length === 0) return 'All units of this product are packed';
    const boxPart = `${unsaved.length} more box${unsaved.length === 1 ? '' : 'es'} to save in this set`;
    return unitsLeft > 0
      ? `${boxPart} · ${unitsLeft} unit${unitsLeft === 1 ? '' : 's'} still to pack`
      : boxPart;
  };

  return (
    <div className="vmb-wrap">
      <div className="vmb-nav">
        <div className="vmb-nav-left">
          <div className="vmb-nav-icon"><IcoBox size={14} stroke={2.2} /></div>
          <div>
            <div className="vmb-nav-title">1 Product → Multiple Boxes</div>
            <div className="vmb-nav-sub">
              {line.spiName} · {boxes.length} box{boxes.length === 1 ? '' : 'es'} · {allocated} of {line.spiQty} units allocated
              {allocated !== line.spiQty && (
                <span className={`invf-alloc${allocated > line.spiQty ? ' is-over' : ''}`}>
                  {allocated > line.spiQty
                    ? `${allocated - line.spiQty} over`
                    : `${line.spiQty - allocated} unallocated`}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="vmb-tabs">
          {boxes.map(b => (
            <button
              key={b.no}
              type="button"
              className={`vmb-tab${b.no === active ? ' is-active' : ''}`}
              onClick={() => setActive(b.no)}
            >
              <span className="vmb-tab-num">{savedCodes[b.no] ? `✓ ${savedCodes[b.no]}` : `Box ${b.no}`}</span>
              <span className="vmb-tab-qty">{b.qty}u</span>
            </button>
          ))}
        </div>

        <button
          type="button"
          className="vmb-close"
          onClick={onClose}
          disabled={closeDisabled}
          title={closeDisabled ? 'Boxes in this set are saved — they stay in Packed Boxes. Use the scenario chip to remove them.' : undefined}
        >× Close</button>
      </div>

      <div className="vmb-panel is-active">
        {boxes.map(b => (
          <div key={b.no} hidden={b.no !== active}>
            <BoxDrawer
              boxId={savedCodes[b.no] ?? previewCodes[b.no] ?? `New box ${b.no}`}
              line={line}
              quantity={b.qty}
              scenario="1 Product → Multiple Boxes"
              modeLabel={`Box ${b.no} of ${boxes.length}`}
              modeKey="Box"
              variant="panel"
              onSave={readOnly ? undefined : data => onSaveBox(b.no, b.qty, data)}
              saving={savingNo === b.no}
              quantityMax={b.qty + Math.max(0, line.spiQty - allocated)}
              saved={!!savedCodes[b.no]}
              updatable={!!savedCodes[b.no] && !readOnly}
              savedBanner={savedCodes[b.no] ? {
                note: setNote(),
                actionLabel: unsaved.length === 0 ? 'Done' : 'Continue Packing',
                onAction: () => (unsaved.length === 0 ? onClose() : setActive(unsaved[0].no)),
              } : undefined}
              customFlags={customFlags}
              onFlagCreated={onFlagCreated}
              onQuantityChange={onBoxQty && !savedCodes[b.no] && !readOnly ? q => onBoxQty(b.no, q) : undefined}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
