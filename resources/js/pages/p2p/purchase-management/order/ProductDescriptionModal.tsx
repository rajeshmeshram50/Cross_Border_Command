import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useScrollLock } from '../../../../hooks/useScrollLock';
import type { InspectionProduct } from './inspection-shared';
import '../supplier-purchase-invoice/supplier-purchase-invoice.css';
import './physical-inspection.css';

const ICON_X = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

export default function ProductDescriptionModal({ product, onClose }: {
  product: InspectionProduct; onClose: () => void;
}) {
  useScrollLock(true, '.pinsdesc-card');

  const cardRef = useRef<HTMLDivElement>(null);
  useEffect(() => { cardRef.current?.focus(); }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div className="spi-mdl-backdrop pins-layer">
      <div className="spi-mdl pinsdesc-card" role="dialog" aria-modal="true" aria-labelledby="pinsdesc-title" tabIndex={-1} ref={cardRef}>
        <div className="spi-mdl-head">
          <div>
            <div className="spi-mdl-title" id="pinsdesc-title">{product.name}</div>
            <div className="spi-mdl-sub">Product description · read-only</div>
          </div>
          <button type="button" className="spi-mdl-x" onClick={onClose} aria-label="Close">{ICON_X}</button>
        </div>
        <div className="pinsatt-bd">
          <div className="pinsdesc-meta">
            <span className="pins-code">{product.code}</span>
            <span className="pins-kv">HSN <b>{product.hsn}</b></span>
            <span className="pins-kv">GST <b>{product.gst}%</b></span>
            <span className="pins-kv">Quantity (PO) <b>{product.qty}</b></span>
          </div>
          <p className="pinsdesc-text">{product.desc}</p>
        </div>
      </div>
    </div>,
    document.body,
  );
}
