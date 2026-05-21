import { createPortal } from 'react-dom';

/* ────────────────────────────────────────────────────────────────────────────
 * Key Opportunity confirmation — small confirm popup that flags an
 * opportunity as high-priority. Once confirmed, the parent flips the
 * action-pill colour to amber so the marked state is visible at a
 * glance in the toolbar.
 * ──────────────────────────────────────────────────────────────────────── */

export default function KeyOpportunityModal(props: {
  open: boolean;
  /** True once the opp has already been marked — flips the title and
   *  confirm-button copy from "Mark as Key" to "Unmark Key" so the
   *  popup can act as a toggle. */
  isKey?: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const { open, isKey = false, onClose, onConfirm } = props;

  if (!open) return null;

  const headTitle = isKey ? 'Mark As Key Opportunity' : 'Mark As Key Opportunity';
  const headSub   = isKey ? 'Remove high-priority flag' : 'Flag this opportunity as high-priority';
  const cardTitle = isKey ? 'Remove Key Opportunity Flag?' : 'Mark as Key Opportunity?';
  const bodyText  = isKey
    ? <>Do you want to <strong>remove</strong> the Key Opportunity flag from this lead? It will revert to standard priority.</>
    : <>Are you sure you want to mark this opportunity as a <strong>Key Opportunity</strong>? It will be highlighted and tracked as high-priority.</>;
  const confirmText = isKey ? 'Remove Flag' : 'Confirm';
  /* The whole modal flips to a rose/red treatment when the user is
     UN-marking a key opportunity — the icon tile, the icon stroke,
     and the confirm button all shift to red so the destructive
     intent is unmistakable. */
  const variant = isKey ? 'kop-variant-remove' : 'kop-variant-mark';

  return createPortal((
    <div className={`kop-backdrop ${variant}`}>
      <style>{SCOPED_CSS}</style>
      <div className="kop-modal" onClick={(e) => e.stopPropagation()}>
        <div className="kop-head">
          <div className="kop-head-left">
            <div className="kop-head-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <polygon points="12 2 15 9 22 9 17 14 19 22 12 18 5 22 7 14 2 9 9 9 12 2" />
              </svg>
            </div>
            <div>
              <div className="kop-head-title">{headTitle}</div>
              <div className="kop-head-sub">{headSub}</div>
            </div>
          </div>
          <button className="kop-close" onClick={onClose} aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="kop-body">
          <div className="kop-card">
            <div className="kop-card-icon">
              {isKey ? (
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#e11d48" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round">
                  <polygon points="12 2 15 9 22 9 17 14 19 22 12 18 5 22 7 14 2 9 9 9 12 2" />
                </svg>
              ) : (
                <svg width="22" height="22" viewBox="0 0 24 24" fill="#f59e0b" stroke="#d97706" strokeWidth="1.5" strokeLinejoin="round">
                  <polygon points="12 2 15 9 22 9 17 14 19 22 12 18 5 22 7 14 2 9 9 9 12 2" />
                </svg>
              )}
            </div>
            <div className="kop-card-text">
              <div className="kop-card-title">{cardTitle}</div>
              <div className="kop-card-body">{bodyText}</div>
            </div>
          </div>
        </div>

        <div className="kop-foot">
          <button className="kop-btn-ghost" onClick={onClose}>Cancel</button>
          <button className="kop-btn-primary" onClick={() => { onConfirm(); onClose(); }}>
            {isKey ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  ), document.body);
}

const SCOPED_CSS = `
.kop-backdrop {
  position: fixed; inset: 0; z-index: 1100;
  background: rgba(15, 23, 42, .55);
  -webkit-backdrop-filter: blur(3px); backdrop-filter: blur(3px);
  display: flex; align-items: flex-start; justify-content: center;
  padding: 96px 20px 20px;
  overflow-y: auto;
  font-family: 'DM Sans', 'Inter', system-ui, sans-serif;
}
.kop-modal {
  width: 100%; max-width: 540px;
  background: #fff;
  border-radius: 18px;
  overflow: hidden;
  display: flex; flex-direction: column;
  box-shadow: 0 30px 80px rgba(15, 23, 42, .45);
  color: #1e1b4b;
}
.kop-modal *, .kop-modal *::before, .kop-modal *::after { box-sizing: border-box; }

.kop-head {
  position: relative;
  padding: 16px 22px;
  background: linear-gradient(115deg, #a855f7 0%, #8b5cf6 55%, #7c3aed 100%);
  color: #fff;
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  overflow: hidden;
}
.kop-head::after {
  content: ''; position: absolute;
  top: -40%; right: -10%; width: 260px; height: 200px;
  background: radial-gradient(ellipse, rgba(255,255,255,.18), transparent 70%);
  pointer-events: none;
}
.kop-head-left { display: flex; align-items: center; gap: 12px; position: relative; z-index: 1; }
.kop-head-icon {
  width: 40px; height: 40px; border-radius: 11px;
  background: rgba(255,255,255,.18);
  border: 1px solid rgba(255,255,255,.28);
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
}
.kop-head-title { font-size: 16px; font-weight: 700; letter-spacing: -0.01em; }
.kop-head-sub   { font-size: 12px; font-weight: 400; color: rgba(255,255,255,.85); margin-top: 2px; }
.kop-close {
  width: 30px; height: 30px; border-radius: 9px;
  border: 1px solid rgba(255,255,255,.25);
  background: rgba(255,255,255,.12);
  color: #fff; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
  transition: background .15s, transform .12s;
  position: relative; z-index: 1;
}
.kop-close:hover { background: rgba(255,255,255,.22); transform: rotate(90deg); }

.kop-body {
  padding: 22px;
  background: linear-gradient(180deg, #faf5ff 0%, #ffffff 100%);
}
.kop-card {
  display: flex; align-items: flex-start; gap: 14px;
  padding: 16px 18px;
  background: linear-gradient(135deg, #fdfaff 0%, #f5f3ff 100%);
  border: 1px solid #ede9fe;
  border-radius: 12px;
}
.kop-card-icon {
  width: 44px; height: 44px; border-radius: 12px;
  background: linear-gradient(135deg, #fef3c7, #fde68a);
  border: 1px solid #fcd34d;
  display: inline-flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.kop-card-text { flex: 1; min-width: 0; }
.kop-card-title {
  font-size: 14px; font-weight: 700; color: #1e1b4b;
  letter-spacing: -0.01em;
}
.kop-card-body {
  margin-top: 6px;
  font-size: 12.5px; color: #64748b;
  line-height: 1.55;
}
.kop-card-body strong { color: #5b21b6; font-weight: 700; }

.kop-foot {
  display: flex; justify-content: center; gap: 8px;
  padding: 14px 22px 18px;
  background: #fff;
}
.kop-btn-ghost, .kop-btn-primary {
  display: inline-flex; align-items: center; gap: 8px;
  height: 40px; padding: 0 22px;
  border-radius: 10px;
  font-family: inherit; font-size: 13px; font-weight: 600;
  cursor: pointer;
  transition: background .15s, border-color .15s, transform .12s, box-shadow .15s;
}
.kop-btn-ghost {
  background: #fff;
  border: 1.5px solid #e2e8f0;
  color: #475569;
}
.kop-btn-ghost:hover { background: #f1f5f9; border-color: #cbd5e1; }
.kop-btn-primary {
  border: none;
  background: linear-gradient(135deg, #7c3aed, #5b21b6);
  color: #fff;
  box-shadow: 0 4px 12px rgba(124, 58, 237, .35);
}
.kop-btn-primary:hover { transform: translateY(-1px); box-shadow: 0 6px 16px rgba(124, 58, 237, .45); }

/* ── Remove-mode variant — flips the icon tile + confirm button to a
   rose/red treatment so the destructive flow reads distinct from the
   purple "mark" flow. */
.kop-variant-remove .kop-card-icon {
  background: linear-gradient(135deg, #fee2e2 0%, #fecaca 100%);
  border-color: #fda4af;
}
.kop-variant-remove .kop-btn-primary {
  background: linear-gradient(135deg, #f43f5e 0%, #e11d48 100%);
  box-shadow: 0 4px 12px rgba(244, 63, 94, .35);
}
.kop-variant-remove .kop-btn-primary:hover {
  box-shadow: 0 6px 16px rgba(244, 63, 94, .45);
}

/* Dark mode */
[data-bs-theme="dark"] .kop-modal { background: #14102a; color: #ede9fe; }
[data-bs-theme="dark"] .kop-body  { background: linear-gradient(180deg, #1a1538 0%, #14102a 100%); }
[data-bs-theme="dark"] .kop-foot  { background: #1a1538; }
[data-bs-theme="dark"] .kop-card  {
  background: linear-gradient(135deg, #1a1538 0%, #20184a 100%);
  border-color: rgba(167, 139, 250, .22);
}
[data-bs-theme="dark"] .kop-card-title { color: #ede9fe; }
[data-bs-theme="dark"] .kop-card-body  { color: #94a3b8; }
[data-bs-theme="dark"] .kop-card-body strong { color: #c4b5fd; }
[data-bs-theme="dark"] .kop-card-icon {
  background: linear-gradient(135deg, rgba(245, 158, 11, .22), rgba(245, 158, 11, .12));
  border-color: rgba(245, 158, 11, .35);
}
[data-bs-theme="dark"] .kop-btn-ghost { background: transparent; color: #cbd5e1; border-color: #3b2a6b; }
[data-bs-theme="dark"] .kop-btn-ghost:hover { background: #2a2150; border-color: #4338ca; }
[data-bs-theme="dark"] .kop-variant-remove .kop-card-icon {
  background: linear-gradient(135deg, rgba(244, 63, 94, .22), rgba(244, 63, 94, .12));
  border-color: rgba(244, 63, 94, .45);
}
[data-bs-theme="dark"] .kop-variant-remove .kop-btn-primary {
  background: linear-gradient(135deg, #f43f5e 0%, #e11d48 100%);
  box-shadow: 0 4px 14px rgba(244, 63, 94, .45);
}
`;
