import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useToast } from '../../../contexts/ToastContext';

/* ────────────────────────────────────────────────────────────────────────────
 * Remarks — add or view remarks attached to an opportunity. Top half is
 * a textarea for a fresh remark, bottom half lists previously stored
 * remarks (newest first). Frontend-only mock for now; once the API
 * lands, replace the local `remarks` state with a fetch +
 * POST /sales/opportunities/{id}/remarks call.
 * ──────────────────────────────────────────────────────────────────────── */

export type StoredRemark = {
  id: string;
  text: string;
  author?: string;
  at: string;          // ISO timestamp
};

export default function RemarksModal(props: {
  open: boolean;
  /** Initial list of stored remarks — defaults to empty. */
  initialRemarks?: StoredRemark[];
  onClose: () => void;
  onSave?: (text: string) => void;
}) {
  const { open, initialRemarks = [], onClose, onSave } = props;
  const toast = useToast();

  const [draft, setDraft] = useState('');
  const [remarks, setRemarks] = useState<StoredRemark[]>(initialRemarks);

  // Reset on each open so the textarea is empty, but keep the stored
  // list from the parent (or whatever the user added in this session).
  useEffect(() => {
    if (open) {
      setDraft('');
      setRemarks(initialRemarks);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const handleSave = () => {
    const trimmed = draft.trim();
    if (!trimmed) {
      toast.error('Empty remark', 'Type something before saving');
      return;
    }
    const next: StoredRemark = {
      id: String(Date.now()),
      text: trimmed,
      author: 'You',
      at: new Date().toISOString(),
    };
    setRemarks(prev => [next, ...prev]);
    setDraft('');
    if (onSave) onSave(trimmed);
    toast.success('Remark saved', 'Your note has been added');
  };

  const fmtTime = (iso: string) => {
    try {
      const d = new Date(iso);
      return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch {
      return iso;
    }
  };

  return createPortal((
    <div className="rmk-backdrop">
      <style>{SCOPED_CSS}</style>
      <div className="rmk-modal" onClick={(e) => e.stopPropagation()}>
        <div className="rmk-head">
          <div className="rmk-head-left">
            <div className="rmk-head-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            </div>
            <div>
              <div className="rmk-head-title">Remarks</div>
              <div className="rmk-head-sub">Add or view remarks for this opportunity</div>
            </div>
          </div>
          <button className="rmk-close" onClick={onClose} aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="rmk-body">
          <label className="rmk-label">
            Write your remark <span className="rmk-req">*</span>
          </label>
          <textarea
            className="rmk-textarea"
            placeholder="Write your remarks here…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={4}
          />

          <div className="rmk-list-head">
            <span className="rmk-list-icon">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
              </svg>
            </span>
            <span className="rmk-list-label">Stored Remarks</span>
            <span className="rmk-list-count">{remarks.length}</span>
          </div>

          <div className="rmk-list">
            {remarks.length === 0 ? (
              <div className="rmk-empty">No remarks added yet.</div>
            ) : remarks.map(r => (
              <div key={r.id} className="rmk-row">
                <div className="rmk-row-text">{r.text}</div>
                <div className="rmk-row-meta">
                  <span className="rmk-row-author">{r.author ?? 'Anonymous'}</span>
                  <span className="rmk-row-dot">·</span>
                  <span className="rmk-row-time">{fmtTime(r.at)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rmk-foot">
          <button className="rmk-btn-ghost" onClick={onClose}>Close</button>
          <button className="rmk-btn-primary" onClick={handleSave} disabled={!draft.trim()}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3">
              <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
              <polyline points="17 21 17 13 7 13 7 21" />
              <polyline points="7 3 7 8 15 8" />
            </svg>
            Save Remark
          </button>
        </div>
      </div>
    </div>
  ), document.body);
}

const SCOPED_CSS = `
.rmk-backdrop {
  position: fixed; inset: 0; z-index: 1100;
  background: rgba(15, 23, 42, .55);
  -webkit-backdrop-filter: blur(3px); backdrop-filter: blur(3px);
  display: flex; align-items: flex-start; justify-content: center;
  padding: 56px 20px 20px;
  overflow-y: auto;
  font-family: 'DM Sans', 'Inter', system-ui, sans-serif;
}
.rmk-modal {
  width: 100%; max-width: 720px;
  background: #fff;
  border-radius: 18px;
  overflow: hidden;
  display: flex; flex-direction: column;
  box-shadow: 0 30px 80px rgba(15, 23, 42, .45);
  color: #1e1b4b;
  max-height: calc(100vh - 96px);
}
.rmk-modal *, .rmk-modal *::before, .rmk-modal *::after { box-sizing: border-box; }

.rmk-head {
  position: relative;
  padding: 16px 22px;
  background: linear-gradient(115deg, #7c3aed 0%, #6d28d9 55%, #5b21b6 100%);
  color: #fff;
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  overflow: hidden;
}
.rmk-head::after {
  content: ''; position: absolute;
  top: -40%; right: -10%; width: 280px; height: 220px;
  background: radial-gradient(ellipse, rgba(255,255,255,.18), transparent 70%);
  pointer-events: none;
}
.rmk-head-left { display: flex; align-items: center; gap: 12px; position: relative; z-index: 1; }
.rmk-head-icon {
  width: 40px; height: 40px; border-radius: 11px;
  background: rgba(255,255,255,.18);
  border: 1px solid rgba(255,255,255,.28);
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
}
.rmk-head-title { font-size: 16px; font-weight: 700; letter-spacing: -0.01em; }
.rmk-head-sub   { font-size: 12px; font-weight: 400; color: rgba(255,255,255,.85); margin-top: 2px; }
.rmk-close {
  width: 30px; height: 30px; border-radius: 9px;
  border: 1px solid rgba(255,255,255,.25);
  background: rgba(255,255,255,.12);
  color: #fff; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
  transition: background .15s, transform .12s;
  position: relative; z-index: 1;
}
.rmk-close:hover { background: rgba(255,255,255,.22); transform: rotate(90deg); }

.rmk-body {
  padding: 20px 22px;
  background: linear-gradient(180deg, #faf5ff 0%, #ffffff 100%);
  display: flex; flex-direction: column; gap: 12px;
  overflow-y: auto;
}
.rmk-label {
  font-size: 10.5px; font-weight: 500;
  letter-spacing: 0.06em; text-transform: uppercase;
  color: #5b21b6;
}
.rmk-req { color: #f06548; font-weight: 600; }
.rmk-textarea {
  width: 100%;
  padding: 12px 14px;
  border: 1.5px solid #ddd6fe;
  border-radius: 12px;
  background: #fff;
  color: #1e1b4b;
  font-family: inherit; font-size: 13px; font-weight: 400;
  outline: none; resize: vertical; min-height: 100px;
  transition: border-color .15s ease, box-shadow .15s ease;
}
.rmk-textarea::placeholder { color: #94a3b8; opacity: .55; }
.rmk-textarea:focus {
  border-color: #7c3aed;
  box-shadow: 0 0 0 3px rgba(124, 58, 237, .15);
}

/* Stored remarks list */
.rmk-list-head {
  display: inline-flex; align-items: center; gap: 6px;
  margin-top: 6px;
}
.rmk-list-icon {
  width: 24px; height: 24px; border-radius: 7px;
  background: linear-gradient(135deg, #7c3aed, #5b21b6);
  color: #fff;
  display: inline-flex; align-items: center; justify-content: center;
}
.rmk-list-label {
  font-size: 10.5px; font-weight: 600;
  letter-spacing: 0.06em; text-transform: uppercase;
  color: #5b21b6;
}
.rmk-list-count {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 22px; height: 22px; padding: 0 8px;
  border-radius: 999px;
  background: linear-gradient(135deg, #7c3aed, #5b21b6);
  color: #fff;
  font-size: 11px; font-weight: 700;
}

.rmk-list {
  display: flex; flex-direction: column; gap: 8px;
  max-height: 240px; overflow-y: auto;
  padding-right: 4px;
  scrollbar-width: thin;
  scrollbar-color: #c4b5fd transparent;
}
.rmk-list::-webkit-scrollbar { width: 6px; }
.rmk-list::-webkit-scrollbar-thumb { background: #c4b5fd; border-radius: 99px; }
.rmk-empty {
  padding: 18px;
  text-align: center;
  color: #94a3b8;
  font-size: 12.5px; font-style: italic;
}
.rmk-row {
  padding: 10px 14px;
  border: 1px solid #ede9fe;
  border-radius: 10px;
  background: #fff;
}
.rmk-row-text {
  font-size: 12.5px; color: #1e1b4b;
  line-height: 1.5;
  white-space: pre-wrap;
}
.rmk-row-meta {
  display: inline-flex; align-items: center; gap: 6px;
  margin-top: 6px;
  font-size: 10.5px; color: #94a3b8;
}
.rmk-row-author { color: #7c3aed; font-weight: 600; }
.rmk-row-dot    { color: #c4b5fd; }

.rmk-foot {
  display: flex; justify-content: flex-end; gap: 8px;
  padding: 14px 22px;
  background: #fff;
  border-top: 1px solid #ede9fe;
}
.rmk-btn-ghost, .rmk-btn-primary {
  display: inline-flex; align-items: center; gap: 8px;
  height: 38px; padding: 0 18px;
  border-radius: 10px;
  font-family: inherit; font-size: 13px; font-weight: 600;
  cursor: pointer;
  transition: background .15s, border-color .15s, transform .12s, box-shadow .15s;
}
.rmk-btn-ghost {
  background: #fff;
  border: 1.5px solid #e2e8f0;
  color: #475569;
}
.rmk-btn-ghost:hover { background: #f1f5f9; border-color: #cbd5e1; }
.rmk-btn-primary {
  border: none;
  background: linear-gradient(135deg, #7c3aed, #5b21b6);
  color: #fff;
  box-shadow: 0 4px 12px rgba(124, 58, 237, .35);
}
.rmk-btn-primary:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 6px 16px rgba(124, 58, 237, .45); }
.rmk-btn-primary:disabled { opacity: 0.55; cursor: not-allowed; }

/* Dark mode */
[data-bs-theme="dark"] .rmk-modal { background: #14102a; color: #ede9fe; }
[data-bs-theme="dark"] .rmk-body  { background: linear-gradient(180deg, #1a1538 0%, #14102a 100%); }
[data-bs-theme="dark"] .rmk-foot  { background: #1a1538; border-top-color: #2a2150; }
[data-bs-theme="dark"] .rmk-label { color: #c4b5fd; }
[data-bs-theme="dark"] .rmk-textarea {
  background: #2a2150; border-color: rgba(167, 139, 250, .35); color: #ede9fe;
}
[data-bs-theme="dark"] .rmk-textarea::placeholder { color: #6b7280; }
[data-bs-theme="dark"] .rmk-list-label { color: #c4b5fd; }
[data-bs-theme="dark"] .rmk-row {
  background: #1a1538; border-color: rgba(167, 139, 250, .25);
}
[data-bs-theme="dark"] .rmk-row-text { color: #ede9fe; }
[data-bs-theme="dark"] .rmk-row-author { color: #c4b5fd; }
[data-bs-theme="dark"] .rmk-row-dot    { color: #6b7280; }
[data-bs-theme="dark"] .rmk-row-meta   { color: #94a3b8; }
[data-bs-theme="dark"] .rmk-empty { color: #94a3b8; }
[data-bs-theme="dark"] .rmk-btn-ghost { background: transparent; color: #cbd5e1; border-color: #3b2a6b; }
[data-bs-theme="dark"] .rmk-btn-ghost:hover { background: #2a2150; border-color: #4338ca; }
`;
