import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import QRCode from 'qrcode';
import { useScrollLock } from '../../../../hooks/useScrollLock';
import { IcoBox, IcoDownload, IcoX } from '../../icons';
import { putawayApi, type PutawayBox } from './putaway-data';
import type { InvoiceRow } from './types';
import { useToast } from '../../../../contexts/ToastContext';

import './putaway-sticker.css';
import { putId } from './spi-api';

const ic = {
  viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2.2,
  strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
};
const ICON_RULER = <svg {...ic} width="9" height="9"><path d="m21.3 8.7-12.6 12.6a1 1 0 0 1-1.4 0l-4.6-4.6a1 1 0 0 1 0-1.4L15.3 2.7a1 1 0 0 1 1.4 0l4.6 4.6a1 1 0 0 1 0 1.4z" /><path d="m7.5 10.5 2 2M10.5 7.5l2 2M13.5 4.5l2 2" /></svg>;
const ICON_STACK = <svg {...ic} width="9" height="9"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /></svg>;
const ICON_SCALE = <svg {...ic} width="9" height="9"><path d="M12 3v18M3 7h18M6 7l-3 7h6zM18 7l-3 7h6z" /></svg>;
const ICON_PRINT = <svg {...ic} width="13" height="13"><path d="M6 9V2h12v7" /><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" /><rect x="6" y="14" width="12" height="8" rx="1" /></svg>;

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

  const toast = useToast();
  const [busy, setBusy] = useState<'pdf' | 'print' | null>(null);
  const fetchPdf = async (mode: 'pdf' | 'print') => {
    if (!row.apiId || !box.apiId || busy) return;
    setBusy(mode);
    try {
      const blob = await putawayApi.stickerPdf(row.apiId, box.apiId);
      const url = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }));
      if (mode === 'print') {
        window.open(url, '_blank', 'noopener');
      } else {
        const a = document.createElement('a');
        a.href = url;
        a.download = `${row.invoiceNo.replace(/\//g, '-')}-${box.id}.pdf`;
        a.click();
      }
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch {
      toast.error('Could not get the sticker', 'Please try again.');
    } finally {
      setBusy(null);
    }
  };

  const qty = box.products.reduce((n, p) => n + p.qty, 0);
  const title = box.products.length === 1
    ? box.products[0].name
    : `${box.products.length} products`;

  return createPortal(
    <div className="gsm-backdrop">
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

        <div className="gsm-stage">
          <div className="gsm-face">
            <div className="gsm-strip">
              <div className="gsm-strip-l">
                <span className="gsm-strip-ll">Box ID</span>
                <span className="gsm-strip-v">{putId(box.id)}</span>
              </div>
              <div className="gsm-strip-r">
                <span className="gsm-strip-ll">SPI Number</span>
                <span className="gsm-strip-v">{row.invoiceNo}</span>
              </div>
            </div>

            <div className="gsm-body">
              <div className="gsm-pname">{title}</div>
              <div className="gsm-qr-row">
                <div className="gsm-qr"><StickerQr text={String(box.apiId ?? box.id)} /></div>
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
                <span className="gsm-loc">Temporary Location: {box.allocationId ?? 'Not placed yet'}</span>
                <span className="gsm-status gsm-status--temp">Temporary Putaway</span>
              </div>
            </div>
          </div>
        </div>

        <div className="gsm-actions">
          <div className="gsm-actions-row gsm-stickbtns">
            <button type="button" className="gsm-btn gsm-btn--pdf" disabled={!box.apiId || !!busy}
              title="Download the 4 × 6 in sticker as a PDF" onClick={() => void fetchPdf('pdf')}>
              <IcoDownload /> {busy === 'pdf' ? 'Preparing…' : 'PDF'}
            </button>
            <button type="button" className="gsm-btn gsm-btn--print" disabled={!box.apiId || !!busy}
              title="Open the sticker to print it" onClick={() => void fetchPdf('print')}>
              {ICON_PRINT} {busy === 'print' ? 'Opening…' : 'Print Label'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
