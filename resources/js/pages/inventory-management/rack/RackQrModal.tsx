import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import QRCode from 'qrcode';
import { useScrollLock } from '../../../hooks/useScrollLock';
import { useLabelPdf } from '../label-pdf';
import '../warehouse/warehouse-master.css';
import type { Zone, ZoneWarehouse } from '../zone/zone-data';
import { InventoryApiError, rackApi, type Rack } from './rack-data';

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

export default function RackQrModal({ rack: r, warehouse: w, zone: z, onClose }: {
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
    rackApi.preview(r.apiId)
      .then(l => { if (live) { setCode(l.code || r.id); setScan(l.scan || l.code || r.id); } })
      .catch(e => {
        if (!live) return;
        setState('failed');
        setError(e instanceof InventoryApiError ? e.message : 'QR could not be loaded.');
      });
    return () => { live = false; };
  }, [r.apiId, r.id]);

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

  const shownCode = code || r.id;

  const label = useLabelPdf('racks', r.apiId);

  const download = () => {
    if (label.ready) { label.save(`${shownCode}-Label.pdf`); return; }
    const c = canvasRef.current;
    if (!c || state !== 'ready') return;
    const a = document.createElement('a');
    a.href = c.toDataURL('image/png');
    a.download = `${shownCode}-QR.png`;
    a.click();
  };

  const levels = r.shelves;

  return createPortal(
    /* No backdrop-click close — the dialog closes only through the X or
       Cancel, matching every other dialog in Inventory Management. */
    <div className="spi-mdl-backdrop whm-backdrop">
      <div
        className="spi-mdl whm-qrmodal"
        role="dialog" aria-modal="true" aria-labelledby="rkm-qr-title"
        tabIndex={-1} ref={cardRef}
      >
        <div className="spi-mdl-head">
          <div className="spi-mdl-head-left">
            <div className="spi-mdl-head-ico"><IcoQr /></div>
            <div>
              <div className="spi-mdl-title" id="rkm-qr-title">Rack QR</div>
              <div className="spi-mdl-sub">Scan to identify this rack during putaway and picking.</div>
            </div>
          </div>
          <button type="button" className="spi-mdl-x" onClick={onClose} aria-label="Close"><IcoX /></button>
        </div>

        <div className="spi-mdl-body">
          {label.ready && (
            <iframe className="whm-label-pv" src={`${label.url}#toolbar=0&navpanes=0&view=FitH`} title="Label preview" />
          )}
          {label.loading && (
            <div className="whm-label-pv whm-label-pv--load" role="status">
              <span className="spi-btn-spin" aria-hidden />Loading label…
            </div>
          )}
          <div className="whm-qr" style={label.ready || label.loading ? { display: 'none' } : undefined}>
            <div className="whm-qr__code">
              <canvas ref={canvasRef} width={196} height={196}
                style={{ display: state === 'ready' ? 'block' : 'none' }} />
              {state === 'painting' && <span className="whm-qr__load">Generating QR…</span>}
              {state === 'failed' && <span className="whm-qr__load">{error || 'QR could not be generated.'}</span>}
            </div>
            <div className="whm-qr__id">{shownCode}</div>
            <div className="whm-qr__name">{r.name}</div>
            <div className="whm-qr__addr">
              {[z?.id, z?.name || r.zoneName].filter(Boolean).join(' · ')}
              {(w?.name || r.whName) ? ` · ${w?.name || r.whName}` : ''}
              {w?.city ? `, ${w.city}` : ''}
            </div>
          </div>
        </div>

        <div className="spi-mdl-foot">
          <span className="whm-qr__note">
            {levels} shel{levels === 1 ? 'f' : 'ves'} · {r.dims.length} × {r.dims.width} × {r.dims.height} {r.dims.unit}
          </span>
          <div className="spi-mdl-foot-btns">
            <button type="button" className="spi-mdl-cancel" onClick={onClose}>Close</button>
            <button type="button" className="spi-mdl-confirm" onClick={download} disabled={!label.ready && state !== 'ready'}>
              <IcoDownload /> {label.ready ? 'Download Label' : 'Download QR'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
