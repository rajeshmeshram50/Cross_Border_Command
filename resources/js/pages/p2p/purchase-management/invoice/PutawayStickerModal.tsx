import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import QRCode from 'qrcode';
import { useScrollLock } from '../../../../hooks/useScrollLock';
import { IcoBox, IcoDownload, IcoX } from '../../icons';
import type { PutawayBox } from './putaway-data';
import type { InvoiceRow } from './types';

import './putaway-sticker.css';

const ic = {
  viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2.2,
  strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
};
const ICON_RULER = <svg {...ic} width="9" height="9"><path d="m21.3 8.7-12.6 12.6a1 1 0 0 1-1.4 0l-4.6-4.6a1 1 0 0 1 0-1.4L15.3 2.7a1 1 0 0 1 1.4 0l4.6 4.6a1 1 0 0 1 0 1.4z" /><path d="m7.5 10.5 2 2M10.5 7.5l2 2M13.5 4.5l2 2" /></svg>;
const ICON_STACK = <svg {...ic} width="9" height="9"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /></svg>;
const ICON_SCALE = <svg {...ic} width="9" height="9"><path d="M12 3v18M3 7h18M6 7l-3 7h6zM18 7l-3 7h6z" /></svg>;
const ICON_PRINT = <svg {...ic} width="13" height="13"><path d="M6 9V2h12v7" /><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" /><rect x="6" y="14" width="12" height="8" rx="1" /></svg>;

/** What the label's code carries: enough to find the box without the screen. */
const payloadFor = (box: PutawayBox, spi: string) =>
  ['PUT', spi, box.id, box.allocationId, String(box.products.reduce((n, p) => n + p.qty, 0))].join('|');

/** The code itself, painted once per box. */
function StickerQr({ text }: { text: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    QRCode.toCanvas(c, text, {
      width: 60, margin: 0, errorCorrectionLevel: 'M',
      color: { dark: '#0c4a6e', light: '#ffffff' },
    }).catch(() => setFailed(true));
  }, [text]);
  if (failed) return <span className="gsm-qrfail">No code</span>;
  return <canvas ref={ref} width={60} height={60} />;
}

/**
 * Temporary Putaway Sticker — the label for one box.
 *
 * Opened from a box's strip in Box & Product Details. It is a preview of what
 * gets stuck on the carton, so it shows only what the label itself carries:
 * the box, the invoice it came in on, the product, its measurements and where
 * it was put away.
 */
export default function PutawayStickerModal({ box, row, onClose }: {
  box: PutawayBox;
  row: InvoiceRow;
  onClose: () => void;
}) {
  useScrollLock(true, '.gsm-box');

  const cardRef = useRef<HTMLDivElement>(null);
  useEffect(() => { cardRef.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const qty = box.products.reduce((n, p) => n + p.qty, 0);
  /* A carton holding several lines has no single name to print, so the label
     names the count and the code carries the rest. */
  const title = box.products.length === 1
    ? box.products[0].name
    : `${box.products.length} products`;

  return createPortal(
    <div className="gsm-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        className="gsm-box"
        role="dialog" aria-modal="true" aria-labelledby="gsm-title"
        tabIndex={-1} ref={cardRef}
      >
        <div className="gsm-head">
          <span className="gsm-head-ico"><IcoBox /></span>
          <div className="gsm-head-txt">
            <div className="gsm-head-t" id="gsm-title">Temporary Putaway Sticker</div>
            <div className="gsm-head-s">{box.scenario}</div>
          </div>
          <div className="gsm-kpis">
            <div className="gsm-kpi">
              <span className="gsm-kpi-l">SPI ID</span>
              <span className="gsm-kpi-v">{row.invoiceNo}</span>
            </div>
            <div className="gsm-kpi">
              <span className="gsm-kpi-l">Shipment ID</span>
              <span className="gsm-kpi-v">{row.shipmentId || 'NA'}</span>
            </div>
          </div>
          <button type="button" className="gsm-close" onClick={onClose} aria-label="Close"><IcoX /></button>
        </div>

        {/* The label itself, on the slab it would be printed from. */}
        <div className="gsm-stage">
          <div className="gsm-face">
            <div className="gsm-strip">
              <div className="gsm-strip-l">
                <span className="gsm-strip-ll">Box ID</span>
                <span className="gsm-strip-v">{box.id}</span>
              </div>
              <div className="gsm-strip-r">
                <span className="gsm-strip-ll">SPI Number</span>
                <span className="gsm-strip-v">{row.invoiceNo}</span>
              </div>
            </div>

            <div className="gsm-body">
              <div className="gsm-pname">{title}</div>
              <div className="gsm-qr-row">
                <div className="gsm-qr"><StickerQr text={payloadFor(box, row.invoiceNo)} /></div>
                <div className="gsm-dims">
                  <div className="gsm-dim">
                    <div className="gsm-dim-l">{ICON_RULER} L×W×H</div>
                    <div className="gsm-dim-v">{box.length}×{box.width}×{box.height}</div>
                  </div>
                  <div className="gsm-dim">
                    <div className="gsm-dim-l">{ICON_STACK} Qty</div>
                    <div className="gsm-dim-v">{qty} Units</div>
                  </div>
                  <div className="gsm-dim">
                    <div className="gsm-dim-l">{ICON_SCALE} Gross Wt</div>
                    <div className="gsm-dim-v">{box.gross} kg</div>
                  </div>
                </div>
              </div>

              <div className="gsm-footrow">
                <span className="gsm-loc">Temporary Location: {box.allocationId}</span>
                <span className="gsm-status gsm-status--temp">Temporary Putaway</span>
              </div>
            </div>
          </div>
        </div>

        <div className="gsm-actions">
          <div className="gsm-actions-row gsm-stickbtns">
            {/* Neither is wired yet: there is no label endpoint, and a button
                that silently does nothing is worse than one that says so. */}
            <button type="button" className="gsm-btn gsm-btn--pdf" disabled
              title="Downloading the label arrives with the print service">
              <IcoDownload /> PDF
            </button>
            <button type="button" className="gsm-btn gsm-btn--print" disabled
              title="Printing arrives with the label print service">
              {ICON_PRINT} Print Label
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
