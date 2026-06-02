import { useEffect } from 'react';
import { createPortal } from 'react-dom';

/* ─────────────────────────────────────────────────────────────────────────
 * StageEmbedModal — renders a full Sales-Matrix stage component (Stage 3 /
 * Stage 4 / …) inside a popup, so the toolbar "Product Sourcing" /
 * "Share Prices" buttons open the EXACT same view as the inline pipeline
 * stage (single source of truth — no duplicated logic).
 *
 * The stage is passed `embedded` so its "Save & Next / Previous" pipeline
 * footer is suppressed; every in-table action still persists immediately.
 * The stage's own header (smd-stg-head) serves as the modal header; we just
 * overlay a close button.
 * ───────────────────────────────────────────────────────────────────── */

type Props = {
  open:     boolean;
  onClose:  () => void;
  children: React.ReactNode;   // the stage component (with embedded)
};

export default function StageEmbedModal({ open, onClose, children }: Props) {
  // Esc closes; lock body scroll while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal((
    <div className="sem-backdrop" onMouseDown={onClose}>
      <style>{SEM_CSS}</style>
      <div className="sem-panel" onMouseDown={(e) => e.stopPropagation()}>
        <button className="sem-close" onClick={onClose} aria-label="Close" type="button">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
        {children}
      </div>
    </div>
  ), document.body);
}

const SEM_CSS = `
.sem-backdrop {
  position: fixed; inset: 0; z-index: 1080;
  background: rgba(15,23,42,.55); backdrop-filter: blur(4px);
  display: flex; align-items: center; justify-content: center;
  padding: 20px;
  animation: sem-fade .18s ease;
}
@keyframes sem-fade { from { opacity: 0; } to { opacity: 1; } }
.sem-panel {
  position: relative;
  width: min(1080px, 96vw); max-height: 92vh;
  background: #fff; border: 1.5px solid #c4b5fd; border-radius: 16px;
  overflow: hidden;
  display: flex; flex-direction: column;
  box-shadow: 0 24px 60px rgba(76,29,149,.32);
  animation: sem-pop .22s cubic-bezier(.34,1.56,.64,1);
}
@keyframes sem-pop {
  from { opacity: 0; transform: scale(.96) translateY(8px); }
  to   { opacity: 1; transform: scale(1) translateY(0); }
}
/* The embedded stage renders smd-stg-head (auto) + smd-stg-body (flex:1,
   scrolls). Make sure the body fills + scrolls within the panel height. */
.sem-panel > .smd-stg-body { flex: 1; min-height: 0; }
.sem-close {
  position: absolute; top: 11px; right: 12px; z-index: 5;
  width: 30px; height: 30px; border-radius: 8px;
  background: rgba(91,33,182,.16); border: 1px solid rgba(124,58,237,.30);
  color: #5b21b6; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: background .15s;
}
.sem-close:hover { background: rgba(124,58,237,.28); }
[data-bs-theme="dark"] .sem-panel { background: #14102a; border-color: rgba(167,139,250,.30); }
[data-bs-theme="dark"] .sem-close { background: rgba(167,139,250,.22); border-color: rgba(167,139,250,.35); color: #ede9fe; }
[data-bs-theme="dark"] .sem-close:hover { background: rgba(167,139,250,.34); }

@media (max-width: 640px) {
  .sem-backdrop { padding: 8px; }
  .sem-panel { width: 100%; max-height: 96vh; }
}
`;
