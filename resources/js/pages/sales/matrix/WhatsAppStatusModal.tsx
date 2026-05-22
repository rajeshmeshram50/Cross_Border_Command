import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import api from '../../../api';
import { useToast } from '../../../contexts/ToastContext';

/* ─────────────────────────────────────────────────────────────────────────
 * WhatsApp Status — opens off the matrix toolbar's WhatsApp pill.
 *
 * The flow asks a single yes/no question and branches:
 *   Yes → upload a proof screenshot/PDF
 *   No  → capture a reason
 *
 * Both branches POST to /sales/leads/{id}/whatsapp with multipart form data.
 * The legacy backend accepts 4 statuses (connected/pending/not_connected/
 * opted_out); we collapse the UI to two and map:
 *   Yes  → whatsapp_status = 'connected'   (+ screenshot)
 *   No   → whatsapp_status = 'not_connected'(+ whatsapp_reason)
 * ───────────────────────────────────────────────────────────────────────── */

type Status = 'connected' | 'pending' | 'not_connected' | 'opted_out';
type YesNo  = 'yes' | 'no' | '';

type Props = {
  open: boolean;
  leadId: number | null;
  currentStatus: Status | null;
  currentReason: string | null;
  currentScreenshot: string | null;
  onClose: () => void;
  onSaved: () => void;
};

export default function WhatsAppStatusModal({
  open, leadId, currentStatus, currentReason, currentScreenshot, onClose, onSaved,
}: Props) {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement | null>(null);

  const [choice, setChoice] = useState<YesNo>('');
  const [reason, setReason] = useState('');
  const [picked, setPicked] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  /* Hydrate on open. Map the legacy 4-status server value into the yes/no
   * binary the UI uses: 'connected' is the only positive outcome, anything
   * else lands as "No" so the reason textarea pre-fills. */
  useEffect(() => {
    if (!open) { setPicked(null); setSaving(false); return; }
    if (currentStatus === 'connected') setChoice('yes');
    else if (currentStatus) setChoice('no');
    else setChoice('');
    setReason(currentReason ?? '');
    if (fileRef.current) fileRef.current.value = '';
  }, [open, currentStatus, currentReason]);

  if (!open) return null;

  const onSubmit = async () => {
    if (!leadId) {
      toast.warning('No lead in context', 'Open this opportunity from the Lead Worksheet to enable saving');
      return;
    }
    if (!choice) {
      toast.warning('Pick an option', 'Select Yes or No before submitting');
      return;
    }
    if (choice === 'no' && !reason.trim()) {
      toast.warning('Reason required', 'Specify why you didn’t communicate via WhatsApp');
      return;
    }
    setSaving(true);
    try {
      const fd = new FormData();
      fd.append('whatsapp_status', choice === 'yes' ? 'connected' : 'not_connected');
      /* Yes branch carries the proof screenshot, No branch carries the
       * reason text — each branch only sends what its UI captures. */
      if (choice === 'yes' && picked)       fd.append('screenshot', picked);
      if (choice === 'no'  && reason.trim()) fd.append('whatsapp_reason', reason.trim());

      await api.post(`/sales/leads/${leadId}/whatsapp`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      toast.success(
        'WhatsApp updated',
        choice === 'yes' ? 'Communication confirmed' : 'Reason captured',
      );
      onSaved();
    } catch (e: any) {
      toast.error('Save failed', e?.response?.data?.message ?? 'Could not save WhatsApp status');
    } finally {
      setSaving(false);
    }
  };

  const fileLabel =
    picked
      ? picked.name
      : currentScreenshot
        ? (currentScreenshot.split('/').pop() ?? 'View existing')
        : '';

  const clearPicked = () => {
    setPicked(null);
    if (fileRef.current) fileRef.current.value = '';
  };

  return createPortal((
    <div className="was-backdrop">
      <style>{WAS_CSS}</style>
      <div className="was-modal" onClick={(e) => e.stopPropagation()}>
        <div className="was-head">
          <div className="was-head-left">
            <div className="was-head-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            </div>
            <div>
              <div className="was-head-title">WhatsApp Status</div>
              <div className="was-head-sub">Update WhatsApp communication status for this lead</div>
            </div>
          </div>
          <button className="was-close" onClick={onClose} aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="was-body">
          <div className="was-card">
            <div className="was-q">Have you communicated with the customer via WhatsApp?</div>

            <div className="was-radios">
              <label className="was-radio">
                <input
                  type="radio"
                  name="was-choice"
                  value="yes"
                  checked={choice === 'yes'}
                  onChange={() => setChoice('yes')}
                />
                <span>Yes</span>
              </label>
              <label className="was-radio">
                <input
                  type="radio"
                  name="was-choice"
                  value="no"
                  checked={choice === 'no'}
                  onChange={() => setChoice('no')}
                />
                <span>No</span>
              </label>
            </div>

            {choice === 'yes' && (
              <>
                <div className="was-prompt">Please Upload Supporting Proof For WhatsApp Usage Related To This Lead.</div>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".jpg,.jpeg,.png,.gif,.webp,.pdf"
                  onChange={e => setPicked(e.target.files?.[0] ?? null)}
                  style={{ display: 'none' }}
                />
                <div className="was-file-row">
                  <button type="button" className="was-file-pick" onClick={() => fileRef.current?.click()}>
                    Choose File
                  </button>
                  <span className="was-file-name">
                    {fileLabel
                      ? (
                          <>
                            <span className="was-file-name-text" title={fileLabel}>{fileLabel}</span>
                            {!picked && currentScreenshot && (
                              <a
                                className="was-link"
                                href={`/storage/${currentScreenshot}`}
                                target="_blank"
                                rel="noreferrer"
                              >View</a>
                            )}
                            {picked && (
                              <button type="button" className="was-file-x" onClick={clearPicked} aria-label="Remove">
                                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                                </svg>
                              </button>
                            )}
                          </>
                        )
                      : <span className="was-file-empty">No file chosen</span>}
                  </span>
                </div>
                <div className="was-formats">
                  Accepted formats: PDF or image (JPG, PNG, GIF, WEBP)
                </div>
              </>
            )}

            {choice === 'no' && (
              <>
                <div className="was-prompt">Please Specify The Reason For Not Communicating With The Customer Via WhatsApp.</div>
                <textarea
                  className="was-textarea"
                  rows={4}
                  placeholder="Reason For Not Communicating"
                  value={reason}
                  onChange={e => setReason(e.target.value)}
                />
              </>
            )}

            <div className="was-note">
              <strong>Note :</strong> Updating the WhatsApp status ensure accurate lead tracking &amp; operational transparency.
            </div>
          </div>
        </div>

        <div className="was-foot">
          <button className="was-btn was-btn-ghost" onClick={onClose} disabled={saving}>Close</button>
          <button
            className="was-btn was-btn-primary"
            onClick={() => void onSubmit()}
            disabled={saving || !leadId || !choice || (choice === 'no' && !reason.trim())}
          >
            {saving ? 'Saving…' : 'Submit'}
          </button>
        </div>
      </div>
    </div>
  ), document.body);
}

const WAS_CSS = `
.was-backdrop {
  position: fixed; inset: 0; z-index: 1080;
  background: rgba(15, 23, 42, .55);
  backdrop-filter: blur(3px);
  display: flex; align-items: center; justify-content: center;
  padding: 16px;
  animation: was-fade .15s ease-out;
}
@keyframes was-fade { from { opacity: 0; } to { opacity: 1; } }

.was-modal {
  width: min(560px, 100%); max-height: 92vh;
  background: linear-gradient(180deg, #f5f3ff 0%, #ede9fe 100%);
  border-radius: 16px;
  box-shadow: 0 18px 48px rgba(15, 23, 42, .28);
  overflow: hidden;
  display: flex; flex-direction: column;
  animation: was-pop .18s ease-out;
}
@keyframes was-pop {
  from { transform: scale(.96); opacity: 0; }
  to   { transform: scale(1);   opacity: 1; }
}

/* ── Header — violet gradient with top sheen ── */
.was-head {
  position: relative; overflow: hidden;
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 18px;
  background: linear-gradient(135deg, #8b5cf6 0%, #7c3aed 50%, #5b21b6 100%);
  color: #fff;
}
.was-head::before {
  content: ''; position: absolute; top: 0; left: 0; right: 0; height: 50%;
  background: linear-gradient(180deg, rgba(255, 255, 255, .18), transparent);
  pointer-events: none;
}
.was-head-left { position: relative; z-index: 1; display: flex; align-items: center; gap: 12px; }
.was-head-icon {
  width: 38px; height: 38px; border-radius: 10px;
  background: rgba(255, 255, 255, .20);
  border: 1px solid rgba(255, 255, 255, .30);
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 3px 10px rgba(0, 0, 0, .15);
}
.was-head-title { font-size: 16px; font-weight: 800; line-height: 1.2; letter-spacing: -.2px; }
.was-head-sub   { font-size: 11px; color: rgba(255, 255, 255, .85); margin-top: 3px; font-weight: 500; }
.was-close {
  position: relative; z-index: 1;
  width: 28px; height: 28px; border: none; cursor: pointer;
  background: rgba(255, 255, 255, .18);
  color: #fff; border-radius: 8px;
  display: flex; align-items: center; justify-content: center;
  transition: background .15s;
}
.was-close:hover { background: rgba(255, 255, 255, .32); }

/* ── Body & inner card ── */
.was-body {
  padding: 16px 20px;
  flex: 1; overflow-y: auto;
}
.was-card {
  background: #fff;
  border-radius: 12px;
  padding: 22px 22px 20px;
  box-shadow: 0 2px 12px rgba(124, 58, 237, .07);
}

.was-q {
  font-size: 14px; font-weight: 700; color: #1e1b4b;
  text-align: center;
  letter-spacing: -.1px;
  margin-bottom: 14px;
}

/* ── Radio row ── */
.was-radios {
  display: flex; justify-content: center; gap: 38px;
  margin-bottom: 6px;
}
.was-radio {
  display: inline-flex; align-items: center; gap: 8px;
  font-size: 13px; font-weight: 600; color: #1e1b4b;
  cursor: pointer;
  user-select: none;
}
.was-radio input[type="radio"] {
  accent-color: #7c3aed;
  width: 16px; height: 16px;
  margin: 0;
  cursor: pointer;
}

/* ── Conditional prompt heading ── */
.was-prompt {
  font-size: 13px; font-weight: 700; color: #1e1b4b;
  text-align: center;
  margin: 18px 0 12px;
  line-height: 1.5;
  letter-spacing: -.05px;
}
.was-prompt.was-prompt-second { margin-top: 16px; }

/* ── File upload row (Yes branch) ── */
.was-file-row {
  display: flex; align-items: stretch;
  border: 1.5px solid #c4b5fd;
  border-radius: 10px;
  overflow: hidden;
  background: #fff;
}
.was-file-pick {
  background: linear-gradient(135deg, #ede9fe, #ddd6fe);
  border: none; border-right: 1.5px solid #c4b5fd;
  padding: 10px 18px;
  font-size: 13px; font-weight: 700; color: #5b21b6;
  cursor: pointer;
  font-family: inherit;
  white-space: nowrap;
  transition: background .15s;
}
.was-file-pick:hover { background: linear-gradient(135deg, #ddd6fe, #c4b5fd); }
.was-file-name {
  flex: 1; min-width: 0;
  padding: 0 12px;
  display: flex; align-items: center; gap: 8px;
  font-size: 12.5px; color: #1e1b4b;
  background: #fff;
  overflow: hidden;
}
.was-file-name-text {
  flex: 1; min-width: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-weight: 500;
}
.was-file-empty { color: #94a3b8; font-style: italic; }
.was-file-x {
  background: transparent; border: none; cursor: pointer;
  color: #ef4444; padding: 4px;
  display: inline-flex; align-items: center; justify-content: center;
  border-radius: 50%; transition: background .15s;
  flex-shrink: 0;
}
.was-file-x:hover { background: rgba(239, 68, 68, .10); }
.was-link {
  color: #7c3aed; font-weight: 700; text-decoration: none;
  font-size: 11.5px;
  padding: 3px 8px; border-radius: 6px;
  border: 1px solid rgba(124, 58, 237, .25);
  flex-shrink: 0;
}
.was-link:hover { background: rgba(124, 58, 237, .08); }

.was-formats {
  margin-top: 12px;
  font-size: 11.5px; color: #7c3aed;
  text-align: center;
  font-weight: 600;
}

/* ── Textarea (No branch) ── */
.was-textarea {
  width: 100%;
  min-height: 100px;
  border: 1.5px solid #c4b5fd;
  border-radius: 10px;
  padding: 10px 14px;
  font-size: 13px; font-weight: 500; color: #1e1b4b;
  background: #fff;
  outline: none;
  font-family: inherit;
  resize: vertical;
  transition: border-color .15s, box-shadow .15s;
}
.was-textarea:focus {
  border-color: #7c3aed;
  box-shadow: 0 0 0 3px rgba(124, 58, 237, .15);
}
.was-textarea::placeholder { color: #94a3b8; }

/* ── Note ── */
.was-note {
  margin-top: 18px;
  font-size: 12px; color: #64748b;
  text-align: center;
  line-height: 1.55;
}
.was-note strong { color: #7c3aed; font-weight: 700; }

/* ── Footer buttons ── */
.was-foot {
  display: flex; justify-content: flex-end; gap: 8px;
  padding: 14px 20px;
  background: transparent;
  border-top: none;
}
.was-btn {
  padding: 9px 24px; border-radius: 10px;
  border: 1.5px solid transparent;
  font-size: 13px; font-weight: 700; cursor: pointer;
  transition: all .15s;
  font-family: inherit;
}
.was-btn:disabled { opacity: .50; cursor: not-allowed; }
.was-btn-ghost {
  background: #fff;
  border-color: #cbd5e1;
  color: #1e1b4b;
}
.was-btn-ghost:hover:not(:disabled) {
  background: #f8fafc;
  border-color: #94a3b8;
}
.was-btn-primary {
  position: relative; overflow: hidden;
  background: linear-gradient(135deg, #8b5cf6 0%, #7c3aed 50%, #5b21b6 100%);
  color: #fff;
  box-shadow:
    0 4px 14px rgba(124, 58, 237, .40),
    inset 0 1px 0 rgba(255, 255, 255, .18);
  border-color: transparent;
}
.was-btn-primary:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow:
    0 6px 18px rgba(124, 58, 237, .50),
    inset 0 1px 0 rgba(255, 255, 255, .18);
}

/* ── Dark mode ── */
[data-bs-theme="dark"] .was-modal {
  background: linear-gradient(180deg, #1a1538 0%, #20184a 100%);
}
[data-bs-theme="dark"] .was-card {
  background: #14102a;
  box-shadow: 0 4px 18px rgba(0, 0, 0, .45);
}
[data-bs-theme="dark"] .was-q,
[data-bs-theme="dark"] .was-prompt        { color: #ede9fe; }
[data-bs-theme="dark"] .was-radio         { color: #ede9fe; }
[data-bs-theme="dark"] .was-textarea {
  background: #1f1845;
  border-color: rgba(167, 139, 250, .30);
  color: #ede9fe;
}
[data-bs-theme="dark"] .was-textarea::placeholder { color: #6b7280; }
[data-bs-theme="dark"] .was-textarea:focus {
  border-color: #a78bfa;
  box-shadow: 0 0 0 3px rgba(167, 139, 250, .20);
}
[data-bs-theme="dark"] .was-file-row {
  background: #1f1845; border-color: rgba(167, 139, 250, .30);
}
[data-bs-theme="dark"] .was-file-pick {
  background: linear-gradient(135deg, #2a2150, #1f1845);
  border-right-color: rgba(167, 139, 250, .30);
  color: #d8b4fe;
}
[data-bs-theme="dark"] .was-file-pick:hover { background: linear-gradient(135deg, #3b2f6e, #2a2150); }
[data-bs-theme="dark"] .was-file-name      { background: #1f1845; color: #ede9fe; }
[data-bs-theme="dark"] .was-note           { color: #c4b5fd; }
[data-bs-theme="dark"] .was-formats        { color: #a78bfa; }
[data-bs-theme="dark"] .was-btn-ghost {
  background: #1f1845; border-color: rgba(167, 139, 250, .30); color: #ede9fe;
}
[data-bs-theme="dark"] .was-btn-ghost:hover:not(:disabled) { background: #2a2150; }

@media (max-width: 520px) {
  .was-backdrop { padding: 0; }
  .was-modal { border-radius: 0; height: 100vh; max-height: 100vh; }
  .was-radios { gap: 24px; }
  .was-foot { flex-direction: column-reverse; }
  .was-btn  { width: 100%; }
}
`;
