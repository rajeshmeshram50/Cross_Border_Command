import { useState } from 'react';
import { IcoBox } from '../../../icons';
import BoxDrawer, { type BoxSaveData } from './BoxDrawer';
import type { ProductLine } from '../invoice-products';
import type { CustomFlag } from './ProductFlagsModal';

export interface SplitBox {
  no: number;
  qty: number;
}

export function splitQuantity(total: number, boxes: number): SplitBox[] {
  const whole = Math.floor(total);
  const fraction = Math.round((total - whole) * 1000) / 1000;
  const base = Math.floor(whole / boxes);
  const remainder = whole % boxes;
  return Array.from({ length: boxes }, (_, i) => ({
    no: i + 1,
    qty: base + (i < remainder ? 1 : 0) + (i === boxes - 1 ? fraction : 0),
  }));
}

export default function MultiBoxPanel({
  line, boxes, onClose, onSaveBox, savedCodes = {}, previewCodes = {}, savingNo = null, readOnly = false, customFlags, onBoxQty,
}: {
  line: ProductLine;
  boxes: SplitBox[];
  onClose: () => void;
  onSaveBox: (boxNo: number, qty: number, data: BoxSaveData) => void;
  savedCodes?: Record<number, string>;
  previewCodes?: Record<number, string>;
  savingNo?: number | null;
  readOnly?: boolean;
  customFlags?: CustomFlag[];
  onBoxQty?: (boxNo: number, qty: number) => void;
}) {
  const [active, setActive] = useState(1);
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

        <button type="button" className="vmb-close" onClick={onClose}>× Close</button>
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
              saved={!!savedCodes[b.no]}
              customFlags={customFlags}
              onQuantityChange={onBoxQty && !savedCodes[b.no] && !readOnly ? q => onBoxQty(b.no, q) : undefined}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
