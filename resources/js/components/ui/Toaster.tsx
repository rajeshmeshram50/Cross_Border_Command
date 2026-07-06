import { createPortal } from 'react-dom';
import { CheckCircle, AlertCircle, AlertTriangle, Info, X } from 'lucide-react';

type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastItemType {
  id: number;
  type: ToastType;
  title: string;
  message?: string;
  exiting?: boolean;
}

/* Per-status palette — picked at the JS level instead of via Tailwind
 * `dark:` utilities because the project's `dark:` variant has been
 * flaky across the velzon `[data-bs-theme]` attribute. We instead emit
 * an inline <style> block below with explicit `[data-bs-theme="dark"]`
 * rules — identical to how every other component in the app handles
 * dark mode. Hex colours below feed the inline rail gradient + glow. */
interface ToastVariant {
  icon: typeof CheckCircle;
  base: string;       // base color (rail + icon tile + progress)
  glow: string;       // low-alpha colour for the rail's box-shadow glow
  titleLight: string; // bold tinted title on white card
  titleDark: string;  // bright tinted title on slate card
  iconBg: string;     // light-mode icon tile bg
  iconBgDark: string; // dark-mode icon tile bg
}

const VARIANTS: Record<ToastType, ToastVariant> = {
  success: {
    icon: CheckCircle,
    base: '#10b981',
    glow: 'rgba(16,185,129,0.45)',
    titleLight: '#065f46',
    titleDark: '#6ee7b7',
    iconBg: 'rgba(16,185,129,0.12)',
    iconBgDark: 'rgba(16,185,129,0.18)',
  },
  error: {
    icon: AlertCircle,
    base: '#ef4444',
    glow: 'rgba(239,68,68,0.45)',
    titleLight: '#991b1b',
    titleDark: '#fca5a5',
    iconBg: 'rgba(239,68,68,0.12)',
    iconBgDark: 'rgba(239,68,68,0.18)',
  },
  warning: {
    icon: AlertTriangle,
    base: '#f59e0b',
    glow: 'rgba(245,158,11,0.45)',
    titleLight: '#92400e',
    titleDark: '#fcd34d',
    iconBg: 'rgba(245,158,11,0.12)',
    iconBgDark: 'rgba(245,158,11,0.20)',
  },
  info: {
    icon: Info,
    base: '#0ea5e9',
    glow: 'rgba(14,165,233,0.45)',
    titleLight: '#075985',
    titleDark: '#7dd3fc',
    iconBg: 'rgba(14,165,233,0.12)',
    iconBgDark: 'rgba(14,165,233,0.18)',
  },
};

export function ToasterRoot({ toasts, onDismiss }: { toasts: ToastItemType[]; onDismiss: (id: number) => void }) {
  /* Portal to <body> so the toast wrap escapes any ancestor that
   * created a new stacking context (e.g. master modals with backdrop
   * filters or transformed wizard shells). Without this, even a
   * z-index of 100000 stays trapped under the modal's portal layer
   * and the validation toast lands behind the open modal. */
  if (typeof document === 'undefined') return null;
  return createPortal((
    <>
      {/* One stylesheet for the whole toaster — bound to the .cbc-toast
          class names emitted below. Centralising it here keeps the JSX
          uncluttered and means the dark-mode rules live next to the
          light-mode defaults. Using [data-bs-theme="dark"] (velzon's
          attribute) — the same selector the rest of the app uses to
          flip dark mode, so this works regardless of Tailwind config. */}
      <style>{`
        .cbc-toast-wrap {
          position: fixed;
          top: 16px;
          right: 16px;
          /* Above every modal in the app. Customer / Consignee / Vendor
             modals sit at 10000-10002, sub-modals at 10500, confirm
             dialogs at 10050-11050, dropdown portals at 11000-11200.
             CLM modals sit at 200000 and master-select menus at 250000,
             and the P2P Bulk Sourcing modals sit very high (up to ~10000001),
             so the toaster uses the max int to outrank everything and stay
             visible above any stacked modal. */
          z-index: 2147483647;
          display: flex;
          flex-direction: column;
          gap: 12px;
          width: 380px;
          max-width: calc(100vw - 32px);
          pointer-events: none;
        }
        .cbc-toast {
          pointer-events: auto;
          position: relative;
          display: flex;
          /* center vertically so a single-line title is not pinned to
             the top with empty space below. The rail is absolutely
             positioned (see below) so it can still stretch the full
             toast height. */
          align-items: center;
          gap: 12px;
          padding: 14px 12px 14px 16px;
          border-radius: 16px;
          background: #ffffff;
          border: 1px solid #e5e7eb;
          overflow: hidden;
          box-shadow:
            0 10px 40px -10px rgba(15,23,42,0.18),
            0 4px 12px -2px rgba(15,23,42,0.08);
        }
        [data-bs-theme="dark"] .cbc-toast {
          background: #11182a;
          border-color: rgba(255,255,255,0.10);
          box-shadow:
            0 18px 44px -10px rgba(0,0,0,0.55),
            0 6px 14px -2px rgba(0,0,0,0.30),
            inset 0 1px 0 0 rgba(255,255,255,0.04);
        }
        .cbc-toast-rail {
          /* absolute so the rail hugs the full toast height even when
             the parent is center-aligned. The 16px left padding on
             .cbc-toast reserves the visual space for the rail plus a
             small gap. */
          position: absolute;
          top: 0; bottom: 0; left: 0;
          width: 6px;
          border-radius: 16px 0 0 16px;
          background: linear-gradient(180deg, var(--cbc-toast-rail-top) 0%, var(--cbc-toast-rail-bottom) 100%);
        }
        [data-bs-theme="dark"] .cbc-toast-rail {
          box-shadow: 0 0 18px var(--cbc-toast-rail-glow);
        }
        .cbc-toast-icon {
          flex-shrink: 0;
          width: 36px;
          height: 36px;
          border-radius: 12px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          background: var(--cbc-toast-icon-bg);
          color: var(--cbc-toast-icon-color);
        }
        [data-bs-theme="dark"] .cbc-toast-icon {
          background: var(--cbc-toast-icon-bg-dark);
        }
        .cbc-toast-body {
          flex: 1;
          min-width: 0;
          padding-right: 4px;
        }
        .cbc-toast-title {
          font-size: 13px;
          font-weight: 700;
          line-height: 1.25;
          color: var(--cbc-toast-title-light);
          /* Break long unbroken strings (tokens, URLs) instead of overflowing
             the card, and cap the title at 2 lines with an ellipsis so it can
             never blow up the toast height (reported: long text broke the UI). */
          overflow-wrap: anywhere;
          word-break: break-word;
          display: -webkit-box;
          -webkit-box-orient: vertical;
          -webkit-line-clamp: 2;
          overflow: hidden;
        }
        [data-bs-theme="dark"] .cbc-toast-title {
          color: var(--cbc-toast-title-dark);
        }
        .cbc-toast-msg {
          font-size: 11.5px;
          color: #475569;
          margin-top: 4px;
          line-height: 1.5;
          /* Same treatment as the title: break long strings and clamp to 5
             lines with an ellipsis so a long message wraps cleanly and can't
             overflow or stretch the toast off-screen. */
          overflow-wrap: anywhere;
          word-break: break-word;
          display: -webkit-box;
          -webkit-box-orient: vertical;
          -webkit-line-clamp: 5;
          overflow: hidden;
        }
        [data-bs-theme="dark"] .cbc-toast-msg {
          color: rgba(226,232,240,0.80);
        }
        .cbc-toast-close {
          flex-shrink: 0;
          width: 28px;
          height: 28px;
          border-radius: 8px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          background: transparent;
          border: 0;
          color: #64748b;
          cursor: pointer;
          transition: background 0.15s ease, color 0.15s ease;
        }
        .cbc-toast-close:hover {
          background: rgba(15,23,42,0.06);
          color: #0f172a;
        }
        [data-bs-theme="dark"] .cbc-toast-close {
          color: rgba(226,232,240,0.85);
        }
        [data-bs-theme="dark"] .cbc-toast-close:hover {
          background: rgba(255,255,255,0.10);
          color: #ffffff;
        }
        .cbc-toast-progress-track {
          position: absolute;
          bottom: 0;
          left: 0;
          right: 0;
          height: 3px;
          background: rgba(15,23,42,0.06);
        }
        [data-bs-theme="dark"] .cbc-toast-progress-track {
          background: rgba(255,255,255,0.08);
        }
        .cbc-toast-progress-fill {
          height: 100%;
          background: var(--cbc-toast-progress);
          opacity: 0.6;
          border-radius: 999px;
        }
      `}</style>
      <div className="cbc-toast-wrap">
        {toasts.map((toast) => (
          <ToastCard key={toast.id} toast={toast} onClose={() => onDismiss(toast.id)} />
        ))}
      </div>
    </>
  ), document.body);
}

function ToastCard({ toast, onClose }: { toast: ToastItemType; onClose: () => void }) {
  const v = VARIANTS[toast.type];
  const Icon = v.icon;

  // Lighter shade of `base` for the rail's top gradient stop. Achieved
  // by mixing with white at ~30% so each rail reads as a polished
  // 3D-feeling bar rather than a flat block.
  const railTop = lighten(v.base, 0.30);

  return (
    <div
      className={`cbc-toast ${toast.exiting ? 'slide-out-to-right' : 'slide-in-from-right'}`}
      style={{
        // CSS variables consumed by the stylesheet above — keeps the
        // per-status palette out of the global selectors.
        ['--cbc-toast-rail-top' as any]:    railTop,
        ['--cbc-toast-rail-bottom' as any]: v.base,
        ['--cbc-toast-rail-glow' as any]:   v.glow,
        ['--cbc-toast-icon-bg' as any]:     v.iconBg,
        ['--cbc-toast-icon-bg-dark' as any]:v.iconBgDark,
        ['--cbc-toast-icon-color' as any]:  v.base,
        ['--cbc-toast-title-light' as any]: v.titleLight,
        ['--cbc-toast-title-dark' as any]:  v.titleDark,
        ['--cbc-toast-progress' as any]:    v.base,
      }}
    >
      <div className="cbc-toast-rail" />
      <div className="cbc-toast-icon">
        <Icon size={17} strokeWidth={2.4} />
      </div>
      <div className="cbc-toast-body">
        <div className="cbc-toast-title">{toast.title}</div>
        {toast.message && <div className="cbc-toast-msg">{toast.message}</div>}
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label="Dismiss"
        className="cbc-toast-close"
      >
        <X size={14} strokeWidth={2.6} />
      </button>
      <div className="cbc-toast-progress-track">
        <div className="cbc-toast-progress-fill toast-progress" />
      </div>
    </div>
  );
}

/** Mix a hex colour with white. `amount` 0..1 — higher = lighter. */
function lighten(hex: string, amount: number): string {
  const m = hex.replace('#', '').match(/.{2}/g);
  if (!m) return hex;
  const [r, g, b] = m.map(x => parseInt(x, 16));
  const mix = (c: number) => Math.round(c + (255 - c) * amount);
  const toHex = (n: number) => n.toString(16).padStart(2, '0');
  return `#${toHex(mix(r))}${toHex(mix(g))}${toHex(mix(b))}`;
}