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
  return (
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
          z-index: 9999;
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
          align-items: stretch;
          gap: 12px;
          padding: 14px 12px 14px 0;
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
          flex-shrink: 0;
          width: 6px;
          border-radius: 16px 0 0 16px;
          background: linear-gradient(180deg, var(--cbc-toast-rail-top) 0%, var(--cbc-toast-rail-bottom) 100%);
        }
        [data-bs-theme="dark"] .cbc-toast-rail {
          box-shadow: 0 0 18px var(--cbc-toast-rail-glow);
        }
        .cbc-toast-icon {
          flex-shrink: 0;
          margin-top: 2px;
          margin-left: 4px;
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
          padding-top: 2px;
          padding-right: 4px;
        }
        .cbc-toast-title {
          font-size: 13px;
          font-weight: 700;
          line-height: 1.25;
          color: var(--cbc-toast-title-light);
        }
        [data-bs-theme="dark"] .cbc-toast-title {
          color: var(--cbc-toast-title-dark);
        }
        .cbc-toast-msg {
          font-size: 11.5px;
          color: #475569;
          margin-top: 4px;
          line-height: 1.5;
        }
        [data-bs-theme="dark"] .cbc-toast-msg {
          color: rgba(226,232,240,0.80);
        }
        .cbc-toast-close {
          flex-shrink: 0;
          margin-top: 2px;
          align-self: flex-start;
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
  );
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