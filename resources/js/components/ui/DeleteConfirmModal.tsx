import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Loader2, X } from 'lucide-react';

interface Props {
  open: boolean;
  clientName?: string;
  onClose: () => void;
  onConfirm: () => void;
  loading?: boolean;
}

export default function DeleteConfirmModal({ open, clientName, onClose, onConfirm, loading = false }: Props) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape' && !loading) onClose(); };
    if (open) document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose, loading]);

  if (!open) return null;

  const itemName = clientName ? `"${clientName}"` : 'this item';

  return createPortal(
    <>
      <style>{`
        @keyframes dcm-scale-in {
          from { opacity: 0; transform: scale(.92); }
          to { opacity: 1; transform: scale(1); }
        }
        @keyframes dcm-fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        .dcm-overlay {
          position: fixed;
          inset: 0;
          z-index: 1050;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(15, 23, 42, 0.45);
          backdrop-filter: blur(6px);
          -webkit-backdrop-filter: blur(6px);
          animation: dcm-fade-in .18s ease both;
        }
        .dcm-popup {
          width: 360px;
          max-width: calc(100vw - 24px);
          background: #fff;
          border-radius: 16px;
          border: 1px solid rgba(15,23,42,0.08);
          box-shadow: 0 24px 60px rgba(15,23,42,0.25), 0 8px 20px rgba(15,23,42,0.12);
          overflow: hidden;
          animation: dcm-scale-in .22s cubic-bezier(.22,1,.36,1) both;
          position: relative;
        }
        .dcm-close {
          position: absolute;
          top: 12px;
          right: 12px;
          width: 26px;
          height: 26px;
          border-radius: 8px;
          background: transparent;
          border: 1px solid rgba(15,23,42,0.08);
          display: inline-flex;
          align-items: center;
          justify-content: center;
          color: #64748b;
          cursor: pointer;
          transition: all .15s ease;
          z-index: 2;
        }
        .dcm-close:hover {
          color: #ef4444;
          border-color: rgba(239,68,68,0.35);
          background: rgba(239,68,68,0.06);
        }
        .dcm-body {
          padding: 22px 22px 16px;
          text-align: center;
        }
        .dcm-icon-wrap {
          display: flex;
          justify-content: center;
          margin-bottom: 12px;
        }
        .dcm-icon {
          width: 56px;
          height: 56px;
          border-radius: 50%;
          background: #fef2f2;
          border: 2px solid #fee2e2;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #ef4444;
        }
        .dcm-title {
          font-size: 16px;
          font-weight: 700;
          letter-spacing: -0.01em;
          color: #0f172a;
          margin: 0 0 6px;
        }
        .dcm-message {
          font-size: 13px;
          line-height: 1.5;
          color: #475569;
          margin: 0 0 4px;
        }
        .dcm-message strong { color: #0f172a; }
        .dcm-sub {
          font-size: 12px;
          line-height: 1.45;
          color: #94a3b8;
          margin: 4px 0 0;
        }
        .dcm-actions {
          display: flex;
          gap: 8px;
          padding: 4px 18px 18px;
        }
        .dcm-btn {
          flex: 1;
          border: none;
          border-radius: 999px;
          padding: 9px 18px;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          transition: all .18s ease;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
        }
        .dcm-btn:disabled { opacity: 0.6; cursor: not-allowed; }
        .dcm-btn-cancel {
          background: #f3f4f6;
          color: #374151;
          border: 1px solid #e5e7eb;
        }
        .dcm-btn-cancel:hover:not(:disabled) { background: #e5e7eb; }
        .dcm-btn-confirm {
          background: linear-gradient(135deg, #f06548, #ef4444);
          color: #fff;
          box-shadow: 0 4px 14px rgba(240,101,72,0.4), inset 0 1px 0 rgba(255,255,255,0.22);
        }
        .dcm-btn-confirm:hover:not(:disabled) {
          transform: translateY(-1px);
          box-shadow: 0 8px 20px rgba(240,101,72,0.55), inset 0 1px 0 rgba(255,255,255,0.3);
        }
        [data-bs-theme="dark"] .dcm-popup,
        [data-layout-mode="dark"] .dcm-popup {
          background: #1f2937;
          border-color: rgba(255,255,255,0.08);
        }
        [data-bs-theme="dark"] .dcm-title,
        [data-layout-mode="dark"] .dcm-title { color: #f1f5f9; }
        [data-bs-theme="dark"] .dcm-message,
        [data-layout-mode="dark"] .dcm-message { color: #cbd5e1; }
        [data-bs-theme="dark"] .dcm-message strong,
        [data-layout-mode="dark"] .dcm-message strong { color: #f8fafc; }
        [data-bs-theme="dark"] .dcm-sub,
        [data-layout-mode="dark"] .dcm-sub { color: #64748b; }
        [data-bs-theme="dark"] .dcm-close,
        [data-layout-mode="dark"] .dcm-close {
          border-color: rgba(255,255,255,0.1);
          color: #94a3b8;
        }
        [data-bs-theme="dark"] .dcm-icon,
        [data-layout-mode="dark"] .dcm-icon {
          background: rgba(239,68,68,0.12);
          border-color: rgba(239,68,68,0.25);
        }
        [data-bs-theme="dark"] .dcm-btn-cancel,
        [data-layout-mode="dark"] .dcm-btn-cancel {
          background: rgba(255,255,255,0.06);
          color: #e2e8f0;
          border-color: rgba(255,255,255,0.1);
        }
        [data-bs-theme="dark"] .dcm-btn-cancel:hover:not(:disabled),
        [data-layout-mode="dark"] .dcm-btn-cancel:hover:not(:disabled) {
          background: rgba(255,255,255,0.1);
        }
      `}</style>
      <div
        className="dcm-overlay"
        onClick={(e) => e.target === e.currentTarget && !loading && onClose()}
      >
        <div className="dcm-popup" onClick={e => e.stopPropagation()}>
          <button type="button" className="dcm-close" onClick={onClose} disabled={loading} aria-label="Close">
            <X size={13} />
          </button>

          <div className="dcm-body">
            <div className="dcm-icon-wrap">
              <div className="dcm-icon">
                <AlertTriangle size={24} strokeWidth={2.2} />
              </div>
            </div>

            <h2 className="dcm-title">Delete Client</h2>

            <p className="dcm-message">
              Delete <strong>{itemName}</strong>?
            </p>
            <p className="dcm-sub">
              This action cannot be undone. All branches, users, and data will be permanently removed.
            </p>
          </div>

          <div className="dcm-actions">
            <button type="button" className="dcm-btn dcm-btn-cancel" onClick={onClose} disabled={loading}>
              Cancel
            </button>
            <button type="button" className="dcm-btn dcm-btn-confirm" onClick={onConfirm} disabled={loading}>
              {loading ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  Deleting...
                </>
              ) : (
                <>
                  <i className="ri-delete-bin-line" style={{ fontSize: 13 }} />
                  Delete
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </>,
    document.body
  );
}
