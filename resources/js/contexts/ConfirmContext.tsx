import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, X, Loader2 } from 'lucide-react';

type ConfirmTone = 'danger' | 'warning' | 'info' | 'success';

interface ConfirmOptions {
  title?: string;
  message: ReactNode;
  /** Visual treatment for the icon + confirm button. Default: 'danger'. */
  tone?: ConfirmTone;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Icon name from remixicon (without the `ri-` prefix). When omitted we
   *  pick a sensible default for the tone. */
  icon?: string;
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

const Ctx = createContext<ConfirmFn | null>(null);

export function useConfirm(): ConfirmFn {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useConfirm must be used inside <ConfirmProvider>');
  return ctx;
}

// Style map for each tone — keeps the modal generic but visually tied to
// the action's severity. Danger = red, Warning = amber, Info = indigo,
// Success = teal. Mirrors the DeleteConfirmModal palette.
const TONE_STYLES: Record<ConfirmTone, { iconBg: string; iconBorder: string; iconColor: string; confirmGrad: string; confirmShadow: string }> = {
  danger:  { iconBg: '#fef2f2', iconBorder: '#fee2e2', iconColor: '#ef4444', confirmGrad: 'linear-gradient(135deg, #f06548, #ef4444)', confirmShadow: '0 4px 14px rgba(240,101,72,0.4)' },
  warning: { iconBg: '#fffbeb', iconBorder: '#fef3c7', iconColor: '#f59e0b', confirmGrad: 'linear-gradient(135deg, #f59e0b, #d97706)', confirmShadow: '0 4px 14px rgba(245,158,11,0.4)' },
  info:    { iconBg: '#eef2ff', iconBorder: '#e0e7ff', iconColor: '#6366f1', confirmGrad: 'linear-gradient(135deg, #7c5cfc, #6366f1)', confirmShadow: '0 4px 14px rgba(99,102,241,0.4)' },
  success: { iconBg: '#ecfdf5', iconBorder: '#d1fae5', iconColor: '#10b981', confirmGrad: 'linear-gradient(135deg, #10b981, #059669)', confirmShadow: '0 4px 14px rgba(16,185,129,0.4)' },
};

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [open, setOpen]   = useState(false);
  const [opts, setOpts]   = useState<ConfirmOptions>({ message: '' });
  // Hold the pending resolver so confirm() can resolve once the user
  // clicks Confirm or Cancel (or hits Escape).
  const resolveRef = useRef<((v: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((options) => {
    setOpts(options);
    setOpen(true);
    return new Promise<boolean>(res => { resolveRef.current = res; });
  }, []);

  const finish = (v: boolean) => {
    resolveRef.current?.(v);
    resolveRef.current = null;
    setOpen(false);
  };

  const tone = opts.tone || 'danger';
  const palette = TONE_STYLES[tone];
  const title = opts.title ?? (tone === 'danger' ? 'Are you sure?' : 'Confirm');
  const confirmLabel = opts.confirmLabel ?? 'Confirm';
  const cancelLabel  = opts.cancelLabel  ?? 'Cancel';

  return (
    <Ctx.Provider value={confirm}>
      {children}
      {open && createPortal(
        <>
          <style>{`
            @keyframes cfm-fade-in { from { opacity: 0 } to { opacity: 1 } }
            @keyframes cfm-scale-in { from { opacity: 0; transform: scale(.92) } to { opacity: 1; transform: scale(1) } }
            .cfm-overlay {
              position: fixed; inset: 0;
              /* High z-index so the confirm stays on top of nested
                 reactstrap modals (each ~1055, sometimes stacked) and
                 custom EpModal/Vault overlays in this app that climb
                 up to ~6500. The native confirm() this replaced was
                 always above app chrome, so the styled one must be too. */
              z-index: 10050;
              display: flex; align-items: center; justify-content: center;
              background: rgba(15, 23, 42, 0.45);
              backdrop-filter: blur(6px);
              -webkit-backdrop-filter: blur(6px);
              animation: cfm-fade-in .18s ease both;
            }
            .cfm-popup {
              width: 380px;
              max-width: calc(100vw - 24px);
              background: #fff;
              border-radius: 16px;
              border: 1px solid rgba(15,23,42,0.08);
              box-shadow: 0 24px 60px rgba(15,23,42,0.25), 0 8px 20px rgba(15,23,42,0.12);
              overflow: hidden;
              animation: cfm-scale-in .22s cubic-bezier(.22,1,.36,1) both;
              position: relative;
            }
            .cfm-close {
              position: absolute; top: 12px; right: 12px;
              width: 26px; height: 26px; border-radius: 8px;
              background: transparent;
              border: 1px solid rgba(15,23,42,0.08);
              display: inline-flex; align-items: center; justify-content: center;
              color: #64748b; cursor: pointer;
              transition: all .15s ease;
            }
            .cfm-close:hover { color: #ef4444; border-color: rgba(239,68,68,0.35); background: rgba(239,68,68,0.06); }
            .cfm-body { padding: 22px 22px 16px; text-align: center; }
            .cfm-icon-wrap { display: flex; justify-content: center; margin-bottom: 12px; }
            .cfm-icon {
              width: 56px; height: 56px; border-radius: 50%;
              display: flex; align-items: center; justify-content: center;
              background: ${palette.iconBg};
              border: 2px solid ${palette.iconBorder};
              color: ${palette.iconColor};
            }
            .cfm-title {
              font-size: 16px; font-weight: 700; letter-spacing: -0.01em;
              color: #0f172a; margin: 0 0 8px;
            }
            .cfm-message {
              font-size: 13px; line-height: 1.5;
              color: #475569; margin: 0;
            }
            .cfm-message strong { color: #0f172a; }
            .cfm-actions { display: flex; gap: 8px; padding: 4px 18px 18px; }
            .cfm-btn {
              flex: 1; border: none; border-radius: 999px;
              padding: 9px 18px; font-size: 13px; font-weight: 600;
              cursor: pointer; transition: all .18s ease;
              display: inline-flex; align-items: center; justify-content: center; gap: 6px;
            }
            .cfm-btn-cancel { background: #f3f4f6; color: #374151; border: 1px solid #e5e7eb; }
            .cfm-btn-cancel:hover { background: #e5e7eb; }
            .cfm-btn-confirm {
              background: ${palette.confirmGrad};
              color: #fff;
              box-shadow: ${palette.confirmShadow}, inset 0 1px 0 rgba(255,255,255,0.22);
            }
            .cfm-btn-confirm:hover {
              transform: translateY(-1px);
              filter: brightness(1.04);
            }
            [data-bs-theme="dark"] .cfm-popup,
            [data-layout-mode="dark"] .cfm-popup {
              background: #1f2937;
              border-color: rgba(255,255,255,0.08);
            }
            [data-bs-theme="dark"] .cfm-title,
            [data-layout-mode="dark"] .cfm-title { color: #f1f5f9; }
            [data-bs-theme="dark"] .cfm-message,
            [data-layout-mode="dark"] .cfm-message { color: #cbd5e1; }
            [data-bs-theme="dark"] .cfm-message strong,
            [data-layout-mode="dark"] .cfm-message strong { color: #f8fafc; }
            [data-bs-theme="dark"] .cfm-close,
            [data-layout-mode="dark"] .cfm-close { border-color: rgba(255,255,255,0.1); color: #94a3b8; }
            [data-bs-theme="dark"] .cfm-btn-cancel,
            [data-layout-mode="dark"] .cfm-btn-cancel {
              background: rgba(255,255,255,0.06); color: #e2e8f0; border-color: rgba(255,255,255,0.1);
            }
            [data-bs-theme="dark"] .cfm-btn-cancel:hover,
            [data-layout-mode="dark"] .cfm-btn-cancel:hover { background: rgba(255,255,255,0.1); }
          `}</style>
          <div className="cfm-overlay" onClick={e => { if (e.target === e.currentTarget) finish(false); }}>
            <div className="cfm-popup" role="alertdialog" aria-modal="true" onClick={e => e.stopPropagation()}>
              <button type="button" className="cfm-close" onClick={() => finish(false)} aria-label="Close">
                <X size={13} />
              </button>
              <div className="cfm-body">
                <div className="cfm-icon-wrap">
                  <div className="cfm-icon">
                    {opts.icon
                      ? <i className={`ri-${opts.icon}`} style={{ fontSize: 24 }} />
                      : <AlertTriangle size={24} strokeWidth={2.2} />}
                  </div>
                </div>
                <h2 className="cfm-title">{title}</h2>
                <p className="cfm-message">{opts.message}</p>
              </div>
              <div className="cfm-actions">
                <button type="button" className="cfm-btn cfm-btn-cancel" onClick={() => finish(false)}>
                  {cancelLabel}
                </button>
                <button type="button" className="cfm-btn cfm-btn-confirm" onClick={() => finish(true)} autoFocus>
                  {confirmLabel}
                </button>
              </div>
            </div>
          </div>
        </>,
        document.body
      )}
    </Ctx.Provider>
  );
}

// Re-exported for any consumer that wants to render a custom spinner alongside.
export { Loader2 };
