import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import QRCode from 'qrcode';
import { useScrollLock } from '../../../../../hooks/useScrollLock';
import { IcoCheck, IcoDownload, IcoTag, IcoX } from '../../../icons';
import type { BoxContent } from './SelectedProducts';

/** How the sticker prints a date: "8 Oct 2026", never a locale's own order. */
const STICKER_DATE = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric', month: 'short', year: 'numeric',
});

/**
 * The scanned payload.
 *
 * Pipe-separated rather than JSON: a warehouse scanner drops it into whatever
 * field has focus, and the shorter the string the smaller and more forgiving
 * the printed code. Prefixed so a scan can be told apart from a rack or shelf
 * label, which carry their own prefixes.
 */
export const stickerPayload = (boxId: string, rows: BoxContent[], qty: number) =>
  ['BOX', boxId, rows.map(r => r.line.code).join('+'), String(qty)].join('|');

/**
 * The QR, painted on a canvas.
 *
 * Canvas rather than an <img>: it prints crisply and never fires a network
 * request — the same reason InventoryStickers draws its codes this way.
 */
function StickerQr({ payload, size }: { payload: string; size: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    QRCode.toCanvas(el, payload, {
      width: size,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#0c4a6e', light: '#ffffff' },
    }).catch(() => setErr(true));
  }, [payload, size]);

  if (err) return <div className="invf-stk__qrfail">Could not render code</div>;
  return <canvas ref={ref} width={size} height={size} className="invf-stk__qr" />;
}

/**
 * Temporary Putaway Sticker — what goes on the outside of a box.
 *
 * Temporary because the box has not been put away yet: it carries a putaway id
 * (PUT-B-001), not a storage location, and the label is reprinted once the box
 * reaches its rack. The TEMPORARY chip in the header says so, rather than
 * leaving someone to find out at the rack.
 *
 * Portalled to document.body: the drawer sits in a table cell, and
 * `.vti-table-wrap`'s `overflow-x: auto` clips any descendant.
 */
export default function BoxStickerModal({
  boxId, rows, quantity, scenario, modeLabel, condition, spiNumber, onClose,
}: {
  boxId: string;
  /** What is in the box. A mixed carton lists several products. */
  rows: BoxContent[];
  quantity: number;
  /** "1 Product → 1 Box", and so on. */
  scenario: string;
  /** "Single Box", or "Box 3 of 20" in a split. */
  modeLabel: string;
  /** The box's condition, already resolved to its label. */
  condition: string;
  /** Absent until the invoice has a number of its own. */
  spiNumber?: string;
  onClose: () => void;
}) {
  useScrollLock(true);

  const printed = STICKER_DATE.format(new Date());
  const payload = stickerPayload(boxId, rows, quantity);
  const first = rows[0]?.line;
  const mixed = rows.length > 1;

  /* A mixed carton has no single SKU to print, so the label names the count and
     the products are listed under it — a scanner reads them all from the QR. */
  const title = mixed ? `${rows.length} products` : first?.spiName ?? '—';
  const sku = mixed ? `${rows.length} SKUs` : `HSN ${first?.hsn ?? '—'}`;

  return createPortal(
    <div className="spi-mdl-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="spi-mdl invf-stk" role="dialog" aria-modal="true" aria-labelledby="invf-stk-title">
        <div className="spi-mdl-head">
          <div className="spi-mdl-head-left">
            <div className="spi-mdl-head-ico"><IcoTag size={22} stroke={2.1} /></div>
            <div>
              <div className="spi-mdl-title" id="invf-stk-title">Temporary Putaway Sticker</div>
              <div className="spi-mdl-sub">
                {boxId} &nbsp;·&nbsp; {scenario} &nbsp;·&nbsp;
                <span className="invf-stk__temp"><IcoCheck size={9} stroke={3} /> TEMPORARY</span>
              </div>
            </div>
          </div>
          <button type="button" className="spi-mdl-x" onClick={onClose} aria-label="Close">
            <IcoX size={16} />
          </button>
        </div>

        <div className="spi-mdl-body">
          {/* The label itself. Everything inside this card is what gets printed;
              the dialog's own chrome is not. */}
          <div className="invf-stk__card">
            <div className="invf-stk__strip">
              <div>
                <div className="invf-stk__strip-lbl">SPI Number</div>
                <div className="invf-stk__strip-val">{spiNumber || '—'}</div>
              </div>
              <div className="invf-stk__strip-right">
                <div className="invf-stk__strip-lbl">Box No.</div>
                <div className="invf-stk__strip-box">{boxId}</div>
              </div>
            </div>

            <div className="invf-stk__name">{title}</div>
            <div className="invf-stk__chips">
              {!mixed && first && <span className="invf-stk__chip invf-stk__chip--code">{first.code}</span>}
              <span className="invf-stk__chip invf-stk__chip--mode">{modeLabel}</span>
              <span className="invf-stk__chip invf-stk__chip--cond">
                <IcoCheck size={10} stroke={3} /> {condition}
              </span>
            </div>

            <div className="invf-stk__grid">
              <div className="invf-stk__qrbox">
                <StickerQr payload={payload} size={118} />
              </div>
              <div className="invf-stk__facts">
                <div className="invf-stk__facts-lbl">Scan to verify</div>
                <dl className="invf-stk__rows">
                  <div><dt>SKU</dt><dd className="invf-stk__mono">{sku}</dd></div>
                  <div><dt>Quantity</dt><dd>{quantity} Units</dd></div>
                  <div><dt>Date</dt><dd>{printed}</dd></div>
                  <div><dt>Scenario</dt><dd>{scenario}</dd></div>
                </dl>
              </div>
            </div>

            {/* Repeated along the bottom edge so the count is still readable
                when the box is stacked and only its lower strip shows. */}
            <div className="invf-stk__foot">
              <span className="invf-stk__foot-qty">
                <span className="invf-stk__dot" />Qty: {quantity} u
              </span>
              <span className="invf-stk__mono">{printed}</span>
            </div>
          </div>

          {mixed && (
            <ul className="invf-stk__contents">
              {rows.map(r => (
                <li key={r.line.code}>
                  <span className="invf-stk__mono">{r.line.code}</span>
                  {r.line.spiName}
                  <b>{r.qty} u</b>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="spi-mdl-foot">
          <span className="spi-mdl-audit">Reprinted once the box reaches its rack</span>
          <div className="spi-mdl-foot-btns">
            {/* Both are stubs until the label service exists. They are left
                visible rather than hidden so the sticker reads as the finished
                thing it is, but neither pretends to have produced a file. */}
            <button type="button" className="spi-mdl-cancel" onClick={() => window.print()}>
              <IcoDownload size={13} /> PDF
            </button>
            <button type="button" className="spi-mdl-confirm" onClick={() => window.print()}>
              <IcoTag size={14} /> Print Label
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
