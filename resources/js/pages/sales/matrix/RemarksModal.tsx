import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useToast } from '../../../contexts/ToastContext';

/* ────────────────────────────────────────────────────────────────────────────
 * Remark — single editable note attached to the opportunity.
 *
 * `leads.remark` is a single text column, not a history table. So this
 * modal is an Add-or-Edit form, not a thread. Open it once: if the lead
 * has a remark, the textarea is pre-filled and the button reads
 * "Update"; otherwise it reads "Add Remark". Saving overwrites the
 * single column via the parent's PUT /sales/leads/{id} call.
 *
 * The parent owns the API call (it knows the lead id and refreshes the
 * page state after save); this modal stays presentational.
 * ──────────────────────────────────────────────────────────────────────── */

export default function RemarksModal(props: {
  open: boolean;
  /** Current remark on the lead — drives the pre-fill + button label. */
  currentRemark?: string | null;
  onClose: () => void;
  /** Fired with the trimmed text after the user clicks Save. Parent PUTs. */
  onSave?: (text: string) => void | Promise<void>;
}) {
  const { open, currentRemark, onClose, onSave } = props;
  const toast = useToast();

  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  // Re-seed on every open so pre-fill stays in sync after a save +
  // reopen, and so dismiss-without-save discards an in-progress edit.
  useEffect(() => {
    if (open) {
      setDraft(currentRemark ?? '');
      setSaving(false);
    }
  }, [open, currentRemark]);

  if (!open) return null;

  const hasExisting = !!(currentRemark && currentRemark.trim());
  const trimmed     = draft.trim();
  const isUnchanged = trimmed === (currentRemark ?? '').trim();

  const handleSave = async () => {
    if (!trimmed) {
      toast.error('Empty remark', 'Type something before saving');
      return;
    }
    if (isUnchanged) {
      toast.info('No changes', 'The remark is already saved');
      return;
    }
    setSaving(true);
    try {
      await onSave?.(trimmed);
    } finally {
      setSaving(false);
    }
  };

  const handleClear = () => {
    if (!hasExisting) return;
    if (!confirm('Clear the existing remark? This cannot be undone.')) return;
    setDraft('');
    void onSave?.('');
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
              <div className="rmk-head-title">Remark</div>
              <div className="rmk-head-sub">
                {hasExisting ? 'Edit the remark for this opportunity' : 'Add a remark to this opportunity'}
              </div>
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
            {hasExisting ? 'Your remark' : 'Write your remark'} <span className="rmk-req">*</span>
          </label>
          <textarea
            className="rmk-textarea"
            placeholder="Write your remarks here…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={6}
            disabled={saving}
          />

          {hasExisting && (
            <div className="rmk-existing-hint">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
              </svg>
              <span>This opportunity already has a remark — editing will overwrite it.</span>
            </div>
          )}
        </div>

        <div className="rmk-foot">
          {hasExisting && (
            <button
              className="rmk-btn-danger"
              onClick={handleClear}
              disabled={saving}
              title="Remove the saved remark"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6" />
              </svg>
              Clear
            </button>
          )}
          <div className="rmk-foot-right">
            <button className="rmk-btn-ghost" onClick={onClose} disabled={saving}>Close</button>
            <button
              className="rmk-btn-primary"
              onClick={() => void handleSave()}
              disabled={saving || !trimmed || isUnchanged}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3">
                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                <polyline points="17 21 17 13 7 13 7 21" />
                <polyline points="7 3 7 8 15 8" />
              </svg>
              {saving ? 'Saving…' : (hasExisting ? 'Update Remark' : 'Add Remark')}
            </button>
          </div>
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
  width: 100%; max-width: 640px;
  background: #fff;
  border-radius: 18px;
  overflow: hidden;
  display: flex; flex-direction: column;
  box-shadow: 0 30px 80px rgba(15, 23, 42, .45);
  color: #1e1b4b;
  max-height: calc(100vh - 96px);
  animation: rmk-pop .18s cubic-bezier(.22,1,.36,1);
}
@keyframes rmk-pop { from { transform: scale(.97); opacity: 0; } to { transform: scale(1); opacity: 1; } }
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
  font-size: 10.5px; font-weight: 600;
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
  outline: none; resize: vertical; min-height: 140px;
  transition: border-color .15s ease, box-shadow .15s ease;
}
.rmk-textarea::placeholder { color: #94a3b8; opacity: .55; }
.rmk-textarea:focus {
  border-color: #7c3aed;
  box-shadow: 0 0 0 3px rgba(124, 58, 237, .15);
}
.rmk-textarea:disabled { opacity: .65; cursor: not-allowed; }

.rmk-existing-hint {
  display: inline-flex; align-items: center; gap: 7px;
  font-size: 11px; color: #6d28d9;
  background: #ede9fe; border: 1px solid #ddd6fe;
  padding: 7px 11px; border-radius: 8px;
}

.rmk-foot {
  display: flex; justify-content: space-between; align-items: center; gap: 8px;
  padding: 14px 22px;
  background: #fff;
  border-top: 1px solid #ede9fe;
}
.rmk-foot-right { display: flex; gap: 8px; margin-left: auto; }
.rmk-btn-ghost, .rmk-btn-primary, .rmk-btn-danger {
  display: inline-flex; align-items: center; gap: 8px;
  height: 38px; padding: 0 18px;
  border-radius: 10px;
  font-family: inherit; font-size: 13px; font-weight: 600;
  cursor: pointer;
  transition: background .15s, border-color .15s, transform .12s, box-shadow .15s, color .15s;
}
.rmk-btn-ghost  {
  background: #fff;
  border: 1.5px solid #e2e8f0;
  color: #475569;
}
.rmk-btn-ghost:hover:not(:disabled)  { background: #f1f5f9; border-color: #cbd5e1; }
.rmk-btn-primary {
  border: none;
  background: linear-gradient(135deg, #7c3aed, #5b21b6);
  color: #fff;
  box-shadow: 0 4px 12px rgba(124, 58, 237, .35);
}
.rmk-btn-primary:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 6px 16px rgba(124, 58, 237, .45); }
.rmk-btn-primary:disabled, .rmk-btn-ghost:disabled, .rmk-btn-danger:disabled { opacity: 0.55; cursor: not-allowed; }
.rmk-btn-danger {
  background: #fff;
  border: 1.5px solid #fecaca;
  color: #b91c1c;
}
.rmk-btn-danger:hover:not(:disabled) { background: #fee2e2; border-color: #fca5a5; }

/* Dark mode */
[data-bs-theme="dark"] .rmk-modal { background: #14102a; color: #ede9fe; }
[data-bs-theme="dark"] .rmk-body  { background: linear-gradient(180deg, #1a1538 0%, #14102a 100%); }
[data-bs-theme="dark"] .rmk-foot  { background: #1a1538; border-top-color: #2a2150; }
[data-bs-theme="dark"] .rmk-label { color: #c4b5fd; }
[data-bs-theme="dark"] .rmk-textarea {
  background: #2a2150; border-color: rgba(167, 139, 250, .35); color: #ede9fe;
}
[data-bs-theme="dark"] .rmk-textarea::placeholder { color: #6b7280; }
[data-bs-theme="dark"] .rmk-existing-hint {
  background: rgba(124,58,237,.18); border-color: rgba(167,139,250,.32); color: #d8b4fe;
}
[data-bs-theme="dark"] .rmk-btn-ghost { background: transparent; color: #cbd5e1; border-color: #3b2a6b; }
[data-bs-theme="dark"] .rmk-btn-ghost:hover:not(:disabled) { background: #2a2150; border-color: #4338ca; }
[data-bs-theme="dark"] .rmk-btn-danger {
  background: rgba(239,68,68,.10); border-color: rgba(248,113,113,.35); color: #fca5a5;
}
[data-bs-theme="dark"] .rmk-btn-danger:hover:not(:disabled) { background: rgba(239,68,68,.22); }

@media (max-width: 520px) {
  .rmk-backdrop { padding: 12px; }
  .rmk-modal    { border-radius: 14px; }
  .rmk-foot     { flex-direction: column-reverse; align-items: stretch; gap: 8px; }
  .rmk-foot-right { flex-direction: column-reverse; gap: 8px; margin-left: 0; }
  .rmk-foot button { width: 100%; justify-content: center; }
}
`;
