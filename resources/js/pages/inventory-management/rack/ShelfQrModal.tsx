import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import QRCode from 'qrcode';
import { useScrollLock } from '../../../hooks/useScrollLock';
import '../warehouse/warehouse-master.css';
import './rack-shelves.css';
import type { Zone, ZoneWarehouse } from '../zone/zone-data';
import { InventoryApiError, type Rack } from './rack-data';
import { shelfApi, type Shelf } from './shelf-data';

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
    <line x1="12" y1="15" x2="12" y2="3" /></>, 14,
);

export default function ShelfQrModal({ shelf: s, rack: r, warehouse: w, zone: z, onClose }: {
  shelf: Shelf;
  rack: Rack;
  warehouse?: ZoneWarehouse;
  zone?: Zone;
  onClose: () => void;
}) {
  useScrollLock(true, '.whm-qrmodal');

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<'painting' | 'ready' | 'failed'>('painting');

  useEffect(() => { cardRef.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const [code, setCode] = useState<string | null>(null);
  const [scan, setScan] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    setState('painting');
    shelfApi.preview(s.apiId)
      .then(l => { if (live) { setCode(l.code || s.id); setScan(l.scan || l.code || s.id); } })
      .catch(e => {
        if (!live) return;
        setState('failed');
        setError(e instanceof InventoryApiError ? e.message : 'QR could not be loaded.');
      });
    return () => { live = false; };
  }, [s.apiId, s.id]);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !scan) return;
    QRCode.toCanvas(c, scan, {
      width: 196, margin: 0, errorCorrectionLevel: 'H',
      color: { dark: '#0c4a6e', light: '#ffffff' },
    })
      .then(() => setState('ready'))
      .catch(() => { setState('failed'); setError('QR could not be generated.'); });
  }, [scan]);

  const shownCode = code || s.id;

  const download = () => {
    const c = canvasRef.current;
    if (!c || state !== 'ready') return;
    const a = document.createElement('a');
    a.href = c.toDataURL('image/png');
    a.download = `${shownCode}-QR.png`;
    a.click();
  };

  return createPortal(
    <div className="spi-mdl-backdrop whm-backdrop"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        className="spi-mdl whm-qrmodal rks-qrmdl"
        role="dialog" aria-modal="true" aria-labelledby="rks-qr-title"
        tabIndex={-1} ref={cardRef}
      >
        <div className="spi-mdl-head">
          <div className="spi-mdl-head-left">
            <div className="spi-mdl-head-ico"><IcoQr /></div>
            <div>
              <div className="spi-mdl-title" id="rks-qr-title">Shelf QR</div>
              <div className="spi-mdl-sub">Scan to identify this shelf during putaway and picking.</div>
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
            <div className="whm-qr__name">{s.name} · Level {s.level} · {s.type}</div>
            <div className="whm-qr__addr">{r.id} {r.name}</div>
            <div className="whm-qr__addr">
              {[z?.id, z?.name || r.zoneName].filter(Boolean).join(' · ')}
              {(w?.name || r.whName) ? ` · ${[w?.id, w?.name || r.whName].filter(Boolean).join(' ')}` : ''}
            </div>
          </div>
        </div>

        <div className="spi-mdl-foot">
          <span className="whm-qr__note">Max {s.max.toLocaleString('en-IN')} kg</span>
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
