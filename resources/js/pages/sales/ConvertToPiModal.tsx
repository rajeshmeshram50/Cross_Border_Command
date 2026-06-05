import { createPortal } from 'react-dom';

/**
 * Convert-to-PI confirmation dialog.
 *
 * Shared by the standalone Quotations V/S PI page (SalesQPI) and the
 * Sales Matrix Stage 5 (Stage5QuotationVsPI) so the "Convert to PI"
 * action behaves identically in both places: it opens this popup, shows
 * the conversion details + the one-PI-per-lead warning, and only fires
 * the actual conversion when the user confirms.
 *
 * Stateless / presentational — the parent owns the open flag, the
 * preview PI code fetch, the converting flag, and the confirm handler.
 */
export type ConvertToPiModalProps = {
  open: boolean;
  fromQuotation: string;          // QT/2026-27/3
  newPiCode: string | null;       // INV/2026-27/14 (preview) | null while loading
  piDate: string;                 // dd/mm/yyyy
  quotationValue: string;         // e.g. "$ —"
  converting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export default function ConvertToPiModal({
  open,
  fromQuotation,
  newPiCode,
  piDate,
  quotationValue,
  converting,
  onCancel,
  onConfirm,
}: ConvertToPiModalProps) {
  if (!open) return null;

  return createPortal(
    <div className="cv2pi-backdrop" onClick={() => { if (!converting) onCancel(); }}>
      <style>{SCOPED_CSS}</style>
      <div className="cv2pi-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="cv2pi-head">
          <div className="cv2pi-head-left">
            <div className="cv2pi-head-icon"><i className="ri-arrow-left-right-line" /></div>
            <div>
              <div className="cv2pi-title">Convert to Proforma Invoice</div>
              <div className="cv2pi-sub">This will create a new PI from the selected quotation</div>
            </div>
          </div>
          <button type="button" className="cv2pi-close" onClick={onCancel} aria-label="Close" disabled={converting}>
            <i className="ri-close-line" />
          </button>
        </div>

        <div className="cv2pi-body">
          <div className="cv2pi-card">
            <div className="cv2pi-card-title">Conversion Details</div>
            <div className="cv2pi-grid">
              <div className="cv2pi-field">
                <span className="cv2pi-label">From Quotation</span>
                <span className="cv2pi-value cv2pi-accent">{fromQuotation || '—'}</span>
              </div>
              <div className="cv2pi-field">
                <span className="cv2pi-label">New PI Number</span>
                <span className="cv2pi-value cv2pi-accent">{newPiCode ?? 'Auto-generated'}</span>
              </div>
              <div className="cv2pi-field">
                <span className="cv2pi-label">PI Date</span>
                <span className="cv2pi-value">{piDate}</span>
              </div>
              <div className="cv2pi-field">
                <span className="cv2pi-label">Quotation Value</span>
                <span className="cv2pi-value cv2pi-money">{quotationValue}</span>
              </div>
            </div>
          </div>

          <div className="cv2pi-note">
            <i className="ri-error-warning-line" />
            <span><strong>Note:</strong> Only one Proforma Invoice is allowed per lead. Once converted, you must delete this PI before creating another.</span>
          </div>
        </div>

        <div className="cv2pi-foot">
          <button type="button" className="cv2pi-cancel" onClick={onCancel} disabled={converting}>Cancel</button>
          <button type="button" className="cv2pi-confirm" onClick={onConfirm} disabled={converting}>
            {converting ? (
              <>Converting…</>
            ) : (
              <><i className="ri-check-line" /> Yes, Convert to PI</>
            )}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Conversion-blocked dialog — shown instead of ConvertToPiModal when the
 * lead already has a Proforma Invoice. One PI per lead is the rule, so the
 * user can't convert again; the call to action is to EDIT the existing PI
 * (NOT delete it). "View Existing PI" takes them to the PI tab.
 */
export type ConversionBlockedModalProps = {
  open: boolean;
  fromQuotation: string;            // the quotation they tried to convert
  existingPiCode: string;           // PI already on the lead
  existingPiDate?: string | null;   // when it was created
  existingPiFromQuotation?: string | null; // source quotation of that PI
  onClose: () => void;
  onViewExistingPi: () => void;
};

export function ConversionBlockedModal({
  open,
  fromQuotation,
  existingPiCode,
  existingPiDate,
  existingPiFromQuotation,
  onClose,
  onViewExistingPi,
}: ConversionBlockedModalProps) {
  if (!open) return null;

  return createPortal(
    <div className="cv2pi-backdrop" onClick={onClose}>
      <style>{SCOPED_CSS}</style>
      <div className="cv2pi-modal cv2pi-modal-block" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="cv2pi-head cv2pi-head-danger">
          <div className="cv2pi-head-left">
            <div className="cv2pi-head-icon"><i className="ri-error-warning-line" /></div>
            <div>
              <div className="cv2pi-title">Conversion Not Allowed</div>
              <div className="cv2pi-sub">Only one PI is permitted per lead</div>
            </div>
          </div>
          <button type="button" className="cv2pi-close" onClick={onClose} aria-label="Close">
            <i className="ri-close-line" />
          </button>
        </div>

        <div className="cv2pi-body">
          <div className="cv2pi-alert">
            <div className="cv2pi-alert-title">
              <i className="ri-error-warning-line" /> A Proforma Invoice already exists for this lead.
            </div>
            <div className="cv2pi-alert-line">
              PI <strong>{existingPiCode}</strong>
              {existingPiDate ? <> was created on <strong>{existingPiDate}</strong></> : null}
              {existingPiFromQuotation ? <> from quotation <strong>{existingPiFromQuotation}</strong></> : null}.
            </div>
          </div>

          <p className="cv2pi-block-hint">
            To create a new Proforma Invoice from <strong>{fromQuotation}</strong>, you can{' '}
            <strong>edit the existing PI</strong> from the Proforma Invoice tab.
          </p>
        </div>

        <div className="cv2pi-foot">
          <button type="button" className="cv2pi-cancel" onClick={onClose}>Close</button>
          <button type="button" className="cv2pi-confirm cv2pi-confirm-danger" onClick={onViewExistingPi}>
            View Existing PI <i className="ri-arrow-right-line" />
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

const SCOPED_CSS = `
.cv2pi-backdrop {
  position: fixed; inset: 0; z-index: 1080;
  background: rgba(15,23,42,0.55);
  backdrop-filter: blur(2px);
  display: flex; align-items: center; justify-content: center;
  padding: 20px;
}
.cv2pi-modal {
  width: 100%; max-width: 540px;
  background: var(--vz-card-bg, #fff);
  border-radius: 18px;
  overflow: hidden;
  box-shadow: 0 24px 60px rgba(0,0,0,0.35);
  font-family: inherit;
  animation: cv2pi-pop .18s ease;
}
@keyframes cv2pi-pop { from { opacity: 0; transform: translateY(8px) scale(.98); } to { opacity: 1; transform: none; } }

.cv2pi-head {
  display: flex; align-items: center; justify-content: space-between;
  gap: 12px;
  padding: 16px 18px;
  background: linear-gradient(120deg, #0d9488 0%, #0f766e 55%, #115e59 100%);
  color: #fff;
}
.cv2pi-head-left { display: flex; align-items: center; gap: 12px; }
.cv2pi-head-icon {
  width: 38px; height: 38px; border-radius: 10px;
  display: inline-flex; align-items: center; justify-content: center;
  background: rgba(255,255,255,0.18);
  font-size: 18px;
}
.cv2pi-title { font-size: 16px; font-weight: 800; line-height: 1.2; }
.cv2pi-sub { font-size: 12px; opacity: 0.9; margin-top: 2px; }
.cv2pi-close {
  width: 30px; height: 30px; border-radius: 8px;
  border: 0; background: rgba(255,255,255,0.16); color: #fff;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 18px; cursor: pointer; flex-shrink: 0;
  transition: background .15s ease;
}
.cv2pi-close:hover:not(:disabled) { background: rgba(255,255,255,0.30); }
.cv2pi-close:disabled { opacity: .5; cursor: not-allowed; }

.cv2pi-body { padding: 18px; }
.cv2pi-card {
  background: linear-gradient(120deg, #f0fdfa 0%, #ecfdf5 100%);
  border: 1px solid #99f6e4;
  border-radius: 12px;
  padding: 14px 16px;
}
.cv2pi-card-title {
  font-size: 11px; font-weight: 800; letter-spacing: .04em; text-transform: uppercase;
  color: #0d9488; margin-bottom: 12px;
}
.cv2pi-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px 18px; }
.cv2pi-field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.cv2pi-label {
  font-size: 10.5px; font-weight: 700; letter-spacing: .03em; text-transform: uppercase;
  color: var(--vz-secondary-color, #64748b);
}
.cv2pi-value { font-size: 14px; font-weight: 700; color: var(--vz-body-color, #1e293b); word-break: break-word; }
.cv2pi-accent { color: #0f766e; }
.cv2pi-money { color: #16a34a; }

.cv2pi-note {
  display: flex; align-items: flex-start; gap: 8px;
  margin-top: 14px;
  padding: 11px 13px;
  background: #fffbeb;
  border: 1px solid #fde68a;
  border-radius: 10px;
  font-size: 12px; line-height: 1.5;
  color: #92400e;
}
.cv2pi-note i { font-size: 15px; margin-top: 1px; flex-shrink: 0; }

.cv2pi-foot {
  display: flex; align-items: center; justify-content: flex-end; gap: 10px;
  padding: 14px 18px;
  border-top: 1px solid var(--vz-border-color, #e5e7eb);
}
.cv2pi-cancel {
  height: 40px; padding: 0 18px;
  border-radius: 10px;
  border: 1px solid var(--vz-border-color, #d1d5db);
  background: var(--vz-card-bg, #fff);
  color: var(--vz-body-color, #374151);
  font-size: 13px; font-weight: 700; cursor: pointer;
  transition: background .15s ease;
}
.cv2pi-cancel:hover:not(:disabled) { background: var(--vz-light, #f3f4f6); }
.cv2pi-cancel:disabled { opacity: .6; cursor: not-allowed; }
.cv2pi-confirm {
  display: inline-flex; align-items: center; gap: 7px;
  height: 40px; padding: 0 20px;
  border-radius: 10px; border: 0;
  background: linear-gradient(135deg, #0d9488, #0f766e);
  color: #fff; font-size: 13px; font-weight: 700; cursor: pointer;
  box-shadow: 0 6px 16px rgba(13,148,136,0.35);
  transition: transform .15s ease, box-shadow .15s ease, background .15s ease;
}
.cv2pi-confirm:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 9px 22px rgba(13,148,136,0.45); }
.cv2pi-confirm:disabled { opacity: .75; cursor: not-allowed; box-shadow: none; }
.cv2pi-confirm i { font-size: 15px; }

@media (max-width: 520px) { .cv2pi-grid { grid-template-columns: 1fr; } }

/* ─── Conversion-blocked (danger) variant ─── */
.cv2pi-head-danger { background: linear-gradient(120deg, #dc2626 0%, #b91c1c 60%, #991b1b 100%); }
.cv2pi-alert {
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-left: 4px solid #ef4444;
  border-radius: 10px;
  padding: 12px 14px;
}
.cv2pi-alert-title {
  display: flex; align-items: center; gap: 7px;
  font-size: 13px; font-weight: 800; color: #b91c1c; margin-bottom: 6px;
}
.cv2pi-alert-title i { font-size: 15px; }
.cv2pi-alert-line { font-size: 12.5px; line-height: 1.55; color: #7f1d1d; }
.cv2pi-alert-line strong { color: #b91c1c; }
.cv2pi-block-hint {
  margin: 14px 0 0;
  font-size: 12.5px; line-height: 1.6;
  color: var(--vz-secondary-color, #475569);
}
.cv2pi-block-hint strong { color: var(--vz-body-color, #1e293b); }
.cv2pi-confirm-danger {
  background: linear-gradient(135deg, #dc2626, #b91c1c);
  box-shadow: 0 6px 16px rgba(220,38,38,0.35);
}
.cv2pi-confirm-danger:hover:not(:disabled) { box-shadow: 0 9px 22px rgba(220,38,38,0.45); }

[data-bs-theme="dark"] .cv2pi-card { background: rgba(13,148,136,0.10); border-color: rgba(94,234,212,0.30); }
[data-bs-theme="dark"] .cv2pi-accent { color: #5eead4; }
[data-bs-theme="dark"] .cv2pi-note { background: rgba(251,191,36,0.10); border-color: rgba(251,191,36,0.30); color: #fcd34d; }
[data-bs-theme="dark"] .cv2pi-alert { background: rgba(220,38,38,0.10); border-color: rgba(248,113,113,0.30); border-left-color: #ef4444; }
[data-bs-theme="dark"] .cv2pi-alert-title { color: #fca5a5; }
[data-bs-theme="dark"] .cv2pi-alert-line { color: #fecaca; }
[data-bs-theme="dark"] .cv2pi-alert-line strong { color: #fca5a5; }
`;
