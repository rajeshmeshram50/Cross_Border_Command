import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import QRCode from 'qrcode';
import { useScrollLock } from '../../../hooks/useScrollLock';
import { WarehouseApiError, warehouseApi, type Warehouse } from './warehouse-data';
import './warehouse-master.css';

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

export default function WarehouseQrModal({ warehouse: w, onClose }: {
  warehouse: Warehouse;
  onClose: () => void;
}) {
  useScrollLock(true, '.whm-qrmodal');

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [code, setCode] = useState<string | null>(null);
  const [state, setState] = useState<'painting' | 'ready' | 'failed'>('painting');
  const [error, setError] = useState('');

  useEffect(() => { cardRef.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    if (!w.apiId) { setState('failed'); setError('This warehouse has not been saved yet.'); return; }
    let live = true;
    setState('painting');
    warehouseApi.preview(w.apiId)
      .then(l => { if (live) setCode(l.code || w.id); })
      .catch(e => {
        if (!live) return;
        setState('failed');
        setError(e instanceof WarehouseApiError ? e.message : 'QR could not be loaded.');
      });
    return () => { live = false; };
  }, [w.apiId, w.id]);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !code) return;
    QRCode.toCanvas(c, code, {
      width: 196, margin: 0, errorCorrectionLevel: 'H',
      color: { dark: '#0c4a6e', light: '#ffffff' },
    })
      .then(() => setState('ready'))
      .catch(() => { setState('failed'); setError('QR could not be generated.'); });
  }, [code]);

  const shownCode = code || w.id;
  const address = [w.address, w.city, [w.state, w.pin].filter(Boolean).join(' ')].filter(Boolean).join(', ');

  const download = () => {
    const c = canvasRef.current;
    if (!c || state !== 'ready') return;
    const a = document.createElement('a');
    a.href = c.toDataURL('image/png');
    a.download = `${shownCode}-QR.png`;
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
              <canvas ref={canvasRef} width={196} height={196}
                style={{ display: state === 'ready' ? 'block' : 'none' }} />
              {state === 'painting' && <span className="whm-qr__load">Generating QR…</span>}
              {state === 'failed' && <span className="whm-qr__load">{error || 'QR could not be generated.'}</span>}
            </div>
            <div className="whm-qr__id">{shownCode}</div>
            <div className="whm-qr__name">{w.name}</div>
            {address && <div className="whm-qr__addr">{address}</div>}
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
