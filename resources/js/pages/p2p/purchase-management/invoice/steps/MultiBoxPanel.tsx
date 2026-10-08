import { useState } from 'react';
import { IcoBox } from '../../../icons';
import BoxDrawer from './BoxDrawer';
import type { ProductLine } from '../invoice-products';
import type { CustomFlag } from './ProductFlagsModal';

/** One carton in a split: which number it is, and how many units it holds. */
export interface SplitBox {
  no: number;
  qty: number;
}

/**
 * Divides a quantity across N boxes as evenly as it will go.
 *
 * The remainder is spread one unit at a time over the first boxes rather than
 * dumped on the last, so 150 across 20 gives ten 8s and ten 7s instead of
 * nineteen 7s and a 17. Every unit is accounted for: the parts always sum back
 * to the original quantity.
 */
export function splitQuantity(total: number, boxes: number): SplitBox[] {
  const base = Math.floor(total / boxes);
  const remainder = total % boxes;
  return Array.from({ length: boxes }, (_, i) => ({
    no: i + 1,
    qty: base + (i < remainder ? 1 : 0),
  }));
}

/**
 * Scenario 02 — one product across many boxes.
 *
 * A strip of box tabs over a single panel: only the selected box is mounted,
 * which is what keeps a large count cheap. Fifty boxes is fifty small buttons
 * and one drawer, not fifty drawers.
 *
 * There is no cap on the count. The prototype refuses anything over 20, but
 * the strip scrolls horizontally, so the layout holds at any number — the
 * limit was arbitrary and a real delivery can exceed it.
 */
export default function MultiBoxPanel({
  line, boxes, onClose, onSave, customFlags, onAddFlag, onRemoveFlag, onBoxQty,
}: {
  line: ProductLine;
  boxes: SplitBox[];
  onClose: () => void;
  /** Saving any box finalises the product: the split is one decision, and
   *  the cartons were generated together. */
  onSave: () => void;
  customFlags?: CustomFlag[];
  onAddFlag?: (f: CustomFlag) => void;
  onRemoveFlag?: (id: string) => void;
  /** Moves units into or out of one carton. */
  onBoxQty?: (boxNo: number, qty: number) => void;
}) {
  const [active, setActive] = useState(1);
  const box = boxes.find(b => b.no === active) ?? boxes[0];

  /* Summed from the boxes themselves, never stored: a second copy of this
     total is how the header ends up disagreeing with the tabs. */
  const allocated = boxes.reduce((n, b) => n + b.qty, 0);

  return (
    <div className="vmb-wrap">
      <div className="vmb-nav">
        <div className="vmb-nav-left">
          <div className="vmb-nav-icon"><IcoBox size={14} stroke={2.2} /></div>
          <div>
            <div className="vmb-nav-title">1 Product → Multiple Boxes</div>
            <div className="vmb-nav-sub">
              {line.spiName} · {boxes.length} boxes · {line.spiQty} units total
              {/* Once the per-box counts can be edited, they can stop adding
                  up. The difference is stated here rather than left for
                  someone to notice at the putaway stage. */}
              {allocated !== line.spiQty && (
                <span className={`invf-alloc${allocated > line.spiQty ? ' is-over' : ''}`}>
                  {allocated > line.spiQty
                    ? `${allocated - line.spiQty} over`
                    : `${line.spiQty - allocated} unassigned`}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* The strip scrolls rather than wraps: a wrapped row would grow the
            nav downwards and push Close off the line. */}
        <div className="vmb-tabs">
          {boxes.map(b => (
            <button
              key={b.no}
              type="button"
              className={`vmb-tab${b.no === active ? ' is-active' : ''}`}
              onClick={() => setActive(b.no)}
            >
              <span className="vmb-tab-num">Box {b.no}</span>
              <span className="vmb-tab-qty">{b.qty}u</span>
            </button>
          ))}
        </div>

        <button type="button" className="vmb-close" onClick={onClose}>× Close</button>
      </div>

      {/* One panel, re-keyed per box. The key is what resets the drawer's own
          fields when another tab is picked — without it React would keep the
          previous box's dimensions in place under a new heading. */}
      <div className="vmb-panel is-active">
        <BoxDrawer
          key={box.no}
          boxId={`B-${String(box.no).padStart(3, '0')}`}
          line={line}
          quantity={box.qty}
          scenario="1 Product → Multiple Boxes"
          modeLabel={`Box ${box.no} of ${boxes.length}`}
          modeKey="Box"
          variant="panel"
          onSave={onSave}
          customFlags={customFlags} onAddFlag={onAddFlag} onRemoveFlag={onRemoveFlag}
          onQuantityChange={onBoxQty ? q => onBoxQty(box.no, q) : undefined}
        />
      </div>
    </div>
  );
}
