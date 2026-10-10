import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import QRCode from 'qrcode';
import { useScrollLock } from '../../../hooks/useScrollLock';
import type { Warehouse } from './warehouse-data';
/* Carries its own styling: the QR card, the backdrop and the modal's edge all
   live here, and the list page is not always what opened it. */
import './warehouse-master.css';

/**
 * What the code carries.
 *
 * Enough to identify the warehouse off a phone with no app and no network:
 * the id, the name, the full address, then the map link when there is one.
 * Newline-separated, which is how a scanner shows it as readable lines
 * rather than one run-on string.
 */
const payloadFor = (w: Warehouse) => [
  w.id,
  w.name,
  `${w.address}, ${w.city}, ${w.state} ${w.pin}`,
  w.map,
].filter(Boolean).join('\n');

const Ico = (d: React.ReactNode, size: number) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>
);
const IcoQr = (p: { size?: number }) => Ico(
  <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="3" y="14" width="7" height="7" rx="1" />
    <path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3" /></>,
  p.size ?? 22,
);
const IcoX = () => Ico(<><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></>, 16);
const IcoDownload = () => Ico(
  <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" /></>,
  14,
);

/**
 * Warehouse QR — the code for one warehouse, with what it identifies.
 *
 * Painted in the browser from the `qrcode` package the sticker modals already
 * use, so it needs nothing from the server and works with the page's static
 * rows. Download writes the canvas straight to a PNG.
 */
export default function WarehouseQrModal({ warehouse: w, onClose }: {
  warehouse: Warehouse;
  onClose: () => void;
}) {
  useScrollLock(true, '.whm-qrmodal');

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  /* 'painting' until the code is on the canvas: Download must not offer a
     blank PNG, and a failure has to say so rather than show an empty box. */
  const [state, setState] = useState<'painting' | 'ready' | 'failed'>('painting');

  useEffect(() => { cardRef.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    /* 'M' recovers from about 15% damage, which is what a label stuck on a
        carton and scuffed in a warehouse actually needs. */
    QRCode.toCanvas(c, payloadFor(w), {
      width: 196, margin: 0, errorCorrectionLevel: 'M',
      color: { dark: '#0c4a6e', light: '#ffffff' },
    })
      .then(() => setState('ready'))
      .catch(() => setState('failed'));
  }, [w]);

  const download = () => {
    const c = canvasRef.current;
    if (!c || state !== 'ready') return;
    const a = document.createElement('a');
    a.href = c.toDataURL('image/png');
    a.download = `${w.id}-QR.png`;
    a.click();
  };

  return createPortal(
    <div className="spi-mdl-backdrop whm-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        className="spi-mdl whm-qrmodal"
        role="dialog" aria-modal="true" aria-labelledby="whm-qr-title"
        tabIndex={-1} ref={cardRef}
      >
        <div className="spi-mdl-head">
          <div className="spi-mdl-head-left">
            <div className="spi-mdl-head-ico"><IcoQr /></div>
            <div>
              <div className="spi-mdl-title" id="whm-qr-title">Warehouse QR</div>
              <div className="spi-mdl-sub">Scan to identify this warehouse at receiving and putaway.</div>
            </div>
          </div>
          <button type="button" className="spi-mdl-x" onClick={onClose} aria-label="Close"><IcoX /></button>
        </div>

        <div className="spi-mdl-body">
          <div className="whm-qr">
            <div className="whm-qr__code">
              {/* Kept mounted while it paints — the effect needs the canvas to
                  draw into, so swapping it for a message would mean it never
                  appears. The message sits over it instead. */}
              <canvas ref={canvasRef} width={196} height={196}
                style={{ display: state === 'ready' ? 'block' : 'none' }} />
              {state === 'painting' && <span className="whm-qr__load">Generating QR…</span>}
              {state === 'failed' && <span className="whm-qr__load">QR could not be generated.</span>}
            </div>
            <div className="whm-qr__id">{w.id}</div>
            <div className="whm-qr__name">{w.name}</div>
            <div className="whm-qr__addr">{w.address}, {w.city}, {w.state} {w.pin}</div>
          </div>
        </div>

        <div className="spi-mdl-foot">
          <span className="whm-qr__note">
            {w.type === 'own' ? 'Own Warehouse' : 'Third Party (3PL)'}
          </span>
          <div className="spi-mdl-foot-btns">
            <button type="button" className="spi-mdl-cancel" onClick={onClose}>Close</button>
            <button type="button" className="spi-mdl-confirm" onClick={download} disabled={state !== 'ready'}>
              <IcoDownload /> Download QR
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
