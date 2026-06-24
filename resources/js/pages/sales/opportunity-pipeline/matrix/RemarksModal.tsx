import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useToast } from '../../../../contexts/ToastContext';
import DeleteConfirmModal from '../../../../components/ui/DeleteConfirmModal';

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
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [clearing, setClearing] = useState(false);

  // Re-seed on every open so pre-fill stays in sync after a save +
  // reopen, and so dismiss-without-save discards an in-progress edit.
  useEffect(() => {
    if (open) {
      setDraft(currentRemark ?? '');
      setSaving(false);
    }
  }, [open, currentRemark]);

  // Body scroll lock — keep the page behind the modal from scrolling while open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

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
    /* Opens the themed DeleteConfirmModal — replaces the previous
     * browser-native `confirm()` dialog that surfaced the ugly
     * "localhost:8000 says" banner. */
    setClearConfirmOpen(true);
  };
  const confirmClear = async () => {
    setClearing(true);
    try {
      setDraft('');
      await onSave?.('');
      setClearConfirmOpen(false);
    } finally {
      setClearing(false);
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
            Write Your Remark <span className="rmk-req">*</span>
          </label>
          <textarea
            className="rmk-textarea"
            placeholder="Write your remarks here…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={6}
            disabled={saving}
          />

          {/* ── Stored remarks panel ── single-remark backend so the count
              is 0 or 1; matches the prototype's design language without
              promising a thread that doesn't exist yet. */}
          <div className="rmk-stored">
            <div className="rmk-stored-head">
              <div className="rmk-stored-chip" aria-hidden>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 12 7 12 10 5 14 19 17 12 21 12" />
                </svg>
              </div>
              <span className="rmk-stored-label">Stored Remarks</span>
              <span className="rmk-stored-count">{hasExisting ? 1 : 0}</span>
            </div>
            {hasExisting ? (
              <div className="rmk-stored-item">
                <span className="rmk-stored-item-text">{currentRemark}</span>
                <button
                  type="button"
                  className="rmk-stored-clear"
                  onClick={handleClear}
                  disabled={saving}
                  title="Remove the saved remark"
                  aria-label="Clear remark"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6" />
                  </svg>
                </button>
              </div>
            ) : (
              <div className="rmk-stored-empty">No remarks added yet.</div>
            )}
          </div>
        </div>

        <div className="rmk-foot">
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
              {saving ? 'Saving…' : 'Save Remark'}
            </button>
          </div>
        </div>
      </div>

      {/* Themed clear-remark confirmation — replaces the native
          browser confirm() dialog. */}
      <DeleteConfirmModal
        open={clearConfirmOpen}
        title="Clear Remark"
        itemName="this remark"
        actionVerb="Clear"
        confirmLabel="Clear"
        confirmingLabel="Clearing…"
        subMessage="Clearing the remark will remove it from this opportunity. This action cannot be undone."
        loading={clearing}
        onClose={() => { if (!clearing) setClearConfirmOpen(false); }}
        onConfirm={() => void confirmClear()}
      />
    </div>
  ), document.body);
}

const SCOPED_CSS = `
.rmk-backdrop {
  position: fixed; inset: 0; z-index: 1100;
  background: rgba(15, 23, 42, .55);
  -webkit-backdrop-filter: blur(3px); backdrop-filter: blur(3px);
  display: flex; align-items: center; justify-content: center;
  padding: 24px 20px;
  overflow-y: auto;
  font-family: var(--font-sans);
}
.rmk-modal {
  margin: auto;
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
  /* Lighter 4-stop violet sweep matching the prototype + the other
     matrix modals (Product Directory, Map Product, Change Owner). */
  position: relative;
  padding: 16px 22px;
  background: linear-gradient(115deg, #7c3aed 0%, #8b5cf6 45%, #a78bfa 80%, #c4b5fd 100%);
  color: #fff;
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  overflow: hidden; flex-shrink: 0;
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

/* ── Stored remarks panel — chip + label + count badge, then either
   the saved remark text or an italic empty-state line. Sits below
   the textarea on the body's lilac wash. */
.rmk-stored {
  display: flex; flex-direction: column; gap: 14px;
  margin-top: 4px;
}
.rmk-stored-head {
  display: inline-flex; align-items: center; gap: 9px;
}
.rmk-stored-chip {
  width: 22px; height: 22px; border-radius: 7px;
  background: linear-gradient(135deg, #7c3aed, #5b21b6);
  color: #fff;
  display: inline-flex; align-items: center; justify-content: center;
  box-shadow: 0 2px 6px rgba(124, 58, 237, .25);
}
.rmk-stored-label {
  font-size: 10.5px; font-weight: 700;
  color: #5b21b6;
  letter-spacing: .08em; text-transform: uppercase;
}
.rmk-stored-count {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 18px; height: 18px; padding: 0 6px; border-radius: 999px;
  background: #7c3aed; color: #fff;
  font-size: 10px; font-weight: 800;
}
.rmk-stored-empty {
  text-align: center; padding: 18px 12px;
  font-size: 12px; font-style: italic;
  color: #a78bfa;
}
.rmk-stored-item {
  display: flex; align-items: flex-start; gap: 12px;
  padding: 12px 14px;
  background: #fff;
  border: 1px solid #ede9fe;
  border-radius: 10px;
  font-size: 13px; color: #1e1b4b; font-weight: 500;
  line-height: 1.55;
}
.rmk-stored-item-text {
  flex: 1; min-width: 0;
  white-space: pre-wrap; word-break: break-word;
}
/* Trash chip anchored to the right edge of the saved remark card.
   Stays muted at rest, lights up red on hover so the destructive
   intent reads only when the user reaches for it. */
.rmk-stored-clear {
  flex-shrink: 0;
  width: 30px; height: 30px;
  display: inline-flex; align-items: center; justify-content: center;
  background: #fff;
  border: 1px solid #fecaca;
  border-radius: 8px;
  color: #b91c1c;
  cursor: pointer;
  transition: background .15s, border-color .15s, color .15s;
}
.rmk-stored-clear:hover:not(:disabled) {
  background: #fee2e2; border-color: #fca5a5;
}
.rmk-stored-clear:disabled { opacity: .55; cursor: not-allowed; }

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
/* Icon-only variant — collapses padding so the button reads as a
   square trash chip rather than a wide pill with empty text space. */
.rmk-btn-danger-icon {
  width: 38px; padding: 0;
  justify-content: center; gap: 0;
}

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

[data-bs-theme="dark"] .rmk-stored-label { color: #c4b5fd; }
[data-bs-theme="dark"] .rmk-stored-empty { color: rgba(196, 181, 253, .65); }
[data-bs-theme="dark"] .rmk-stored-item {
  background: #1f1845;
  border-color: rgba(167, 139, 250, .25);
  color: #ede9fe;
}
[data-bs-theme="dark"] .rmk-stored-clear {
  background: rgba(239, 68, 68, .14);
  border-color: rgba(252, 165, 165, .40);
  color: #fca5a5;
}
[data-bs-theme="dark"] .rmk-stored-clear:hover:not(:disabled) {
  background: rgba(239, 68, 68, .26);
  border-color: #fca5a5;
}

@media (max-width: 520px) {
  .rmk-backdrop { padding: 12px; }
  .rmk-modal    { border-radius: 14px; }
  .rmk-foot     { flex-direction: column-reverse; align-items: stretch; gap: 8px; }
  .rmk-foot-right { flex-direction: column-reverse; gap: 8px; margin-left: 0; }
  .rmk-foot button { width: 100%; justify-content: center; }
}
`;
