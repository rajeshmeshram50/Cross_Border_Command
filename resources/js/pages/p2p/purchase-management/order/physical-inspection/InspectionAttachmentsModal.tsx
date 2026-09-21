import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useScrollLock } from '../../../../../hooks/useScrollLock';
import { ProofChip, type ProofFile } from './inspection-shared';
import '../../supplier-purchase-invoice/supplier-purchase-invoice.css';
import './physical-inspection.css';

const ICON_X = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

export default function InspectionAttachmentsModal({
  productName, productCode, files, onView, onDownload, onRemove, onClose,
}: {
  productName: string;
  productCode: string;
  files: ProofFile[];
  onView: (i: number) => void;
  onDownload: (i: number) => void;
  onRemove: (i: number) => void;
  onClose: () => void;
}) {
  useScrollLock(true, '.pinsatt-card');

  const cardRef = useRef<HTMLDivElement>(null);
  useEffect(() => { cardRef.current?.focus(); }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div className="spi-mdl-backdrop pins-layer">
      <div className="spi-mdl pinsatt-card" role="dialog" aria-modal="true" aria-labelledby="pinsatt-title" tabIndex={-1} ref={cardRef}>
        <div className="spi-mdl-head">
          <div>
            <div className="spi-mdl-title" id="pinsatt-title">Inspection Attachments</div>
            <div className="spi-mdl-sub">
              {productName} · {productCode} · {files.length} file{files.length === 1 ? '' : 's'}
            </div>
          </div>
          <button type="button" className="spi-mdl-x" onClick={onClose} aria-label="Close">{ICON_X}</button>
        </div>
        <div className="pinsatt-bd">
          {files.length ? (
            <div className="pinsatt-grid">
              {files.map((f, i) => (
                <ProofChip
                  key={`${f.name}-${i}`}
                  file={f}
                  onView={() => onView(i)}
                  onDownload={() => onDownload(i)}
                  onRemove={() => onRemove(i)}
                />
              ))}
            </div>
          ) : (
            <div className="pins-empty">All attachments removed.</div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
