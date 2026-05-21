import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import api from '../../../api';
import { useToast } from '../../../contexts/ToastContext';

/* ─────────────────────────────────────────────────────────────────────────
 * WhatsApp Status — opens off the matrix toolbar's WhatsApp pill.
 *
 * Captures the lead's WhatsApp engagement state plus an optional proof
 * screenshot. Multipart POST to /sales/leads/{id}/whatsapp; the server
 * also derives `has_whatsapp` from status === 'connected'.
 *
 *   connected      — the salesperson reached the customer on WhatsApp
 *   pending        — message sent, no reply yet
 *   not_connected  — number doesn't have WhatsApp / didn't connect
 *   opted_out      — customer explicitly asked not to be messaged
 *
 * The previous screenshot (if any) is shown as a "View existing" link;
 * picking a new file replaces it on save.
 * ───────────────────────────────────────────────────────────────────────── */

type Status = 'connected' | 'pending' | 'not_connected' | 'opted_out';

type Props = {
  open: boolean;
  leadId: number | null;
  currentStatus: Status | null;
  currentReason: string | null;
  currentScreenshot: string | null;
  onClose: () => void;
  onSaved: () => void;
};

const STATUS_META: Record<Status, { label: string; chip: string; hint: string }> = {
  connected:     { label: 'Connected',     chip: 'was-on',  hint: 'Reached the customer on WhatsApp' },
  pending:       { label: 'Pending',       chip: 'was-pen', hint: 'Message sent, no reply yet' },
  not_connected: { label: 'Not Connected', chip: 'was-nc',  hint: 'Number does not have WhatsApp / no engagement' },
  opted_out:     { label: 'Opted Out',     chip: 'was-out', hint: 'Customer asked not to be messaged' },
};

export default function WhatsAppStatusModal({
  open, leadId, currentStatus, currentReason, currentScreenshot, onClose, onSaved,
}: Props) {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement | null>(null);

  const [status, setStatus] = useState<Status | ''>('');
  const [reason, setReason] = useState('');
  const [picked, setPicked] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) { setPicked(null); setSaving(false); return; }
    setStatus(currentStatus ?? '');
    setReason(currentReason ?? '');
    if (fileRef.current) fileRef.current.value = '';
  }, [open, currentStatus, currentReason]);

  if (!open) return null;

  const onSave = async () => {
    if (!leadId) {
      toast.warning('No lead in context', 'Open this opportunity from the Lead Worksheet to enable saving');
      return;
    }
    if (!status) {
      toast.warning('Pick a status', 'Select a WhatsApp engagement status first');
      return;
    }
    setSaving(true);
    try {
      const fd = new FormData();
      fd.append('whatsapp_status', status);
      if (reason.trim())  fd.append('whatsapp_reason', reason.trim());
      if (picked)         fd.append('screenshot', picked);

      await api.post(`/sales/leads/${leadId}/whatsapp`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      toast.success('WhatsApp updated', `Status set to ${STATUS_META[status as Status].label}`);
      onSaved();
    } catch (e: any) {
      toast.error('Save failed', e?.response?.data?.message ?? 'Could not save WhatsApp status');
    } finally {
      setSaving(false);
    }
  };

  return createPortal((
    <div className="was-backdrop" onClick={onClose}>
      <style>{WAS_CSS}</style>
      <div className="was-modal" onClick={(e) => e.stopPropagation()}>
        <div className="was-head">
          <div className="was-head-left">
            <div className="was-head-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8z" />
              </svg>
            </div>
            <div>
              <div className="was-head-title">WhatsApp Status</div>
              <div className="was-head-sub">Track outreach state for this opportunity</div>
            </div>
          </div>
          <button className="was-close" onClick={onClose} aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="was-body">
          <div className="was-label">SELECT STATUS</div>
          <div className="was-pills">
            {(Object.keys(STATUS_META) as Status[]).map(s => (
              <button
                key={s}
                type="button"
                className={`was-pill ${STATUS_META[s].chip} ${status === s ? 'on' : ''}`}
                onClick={() => setStatus(s)}
              >
                <span className="was-pill-dot" />
                {STATUS_META[s].label}
              </button>
            ))}
          </div>
          {status && <div className="was-hint">{STATUS_META[status as Status].hint}</div>}

          <div className="was-field">
            <div className="was-label">REASON / NOTE <span className="was-opt">(optional)</span></div>
            <textarea
              className="was-textarea"
              rows={3}
              placeholder="Any context worth remembering (e.g. customer replied on email instead)…"
              value={reason}
              onChange={e => setReason(e.target.value)}
            />
          </div>

          <div className="was-field">
            <div className="was-label">PROOF SCREENSHOT <span className="was-opt">(optional)</span></div>
            <input
              ref={fileRef}
              type="file"
              accept=".jpg,.jpeg,.png,.webp,.pdf"
              onChange={e => setPicked(e.target.files?.[0] ?? null)}
              style={{ display: 'none' }}
            />
            <div className="was-file">
              <button type="button" className="was-file-pick" onClick={() => fileRef.current?.click()}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                </svg>
                {picked ? 'Replace file' : 'Choose file'}
              </button>
              <span className="was-file-name">
                {picked
                  ? picked.name
                  : currentScreenshot
                    ? <a className="was-link" href={`/storage/${currentScreenshot}`} target="_blank" rel="noreferrer">View existing</a>
                    : <span className="was-muted">No file chosen</span>}
              </span>
              {picked && (
                <button
                  type="button"
                  className="was-file-x"
                  onClick={() => { setPicked(null); if (fileRef.current) fileRef.current.value = ''; }}
                >
                  Remove
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="was-foot">
          <button className="was-btn was-btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="was-btn was-btn-primary" onClick={() => void onSave()} disabled={saving || !leadId}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  ), document.body);
}

const WAS_CSS = `
.was-backdrop {
  position: fixed; inset: 0; z-index: 1080;
  background: rgba(15,23,42,.55); backdrop-filter: blur(3px);
  display: flex; align-items: center; justify-content: center;
  padding: 16px;
  animation: was-fade .15s ease-out;
}
@keyframes was-fade { from { opacity: 0; } to { opacity: 1; } }
.was-modal {
  width: min(560px, 100%); max-height: 92vh;
  background: #fff; border-radius: 14px;
  box-shadow: 0 18px 48px rgba(15,23,42,.28);
  overflow: hidden; display: flex; flex-direction: column;
  animation: was-pop .18s ease-out;
}
@keyframes was-pop { from { transform: scale(.96); opacity: 0; } to { transform: scale(1); opacity: 1; } }
.was-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 20px; color: #fff;
  background: linear-gradient(135deg, #25d366 0%, #128c7e 100%);
}
.was-head-left { display: flex; align-items: center; gap: 12px; }
.was-head-icon {
  width: 38px; height: 38px; border-radius: 11px;
  background: rgba(255,255,255,.18); display: flex; align-items: center; justify-content: center;
}
.was-head-title { font-size: 16px; font-weight: 700; line-height: 1.2; }
.was-head-sub   { font-size: 11px; opacity: .85; margin-top: 3px; }
.was-close {
  width: 30px; height: 30px; border: none; cursor: pointer;
  background: rgba(255,255,255,.18); color: #fff; border-radius: 9px;
  display: flex; align-items: center; justify-content: center;
}
.was-close:hover { background: rgba(255,255,255,.32); }

.was-body { padding: 18px 20px; flex: 1; overflow-y: auto; }
.was-label { font-size: 10.5px; font-weight: 800; letter-spacing: .08em; color: #4b5563; text-transform: uppercase; margin-bottom: 8px; }
.was-opt   { color: #94a3b8; font-weight: 600; letter-spacing: 0; }
.was-pills { display: flex; flex-wrap: wrap; gap: 8px; }
.was-pill {
  display: inline-flex; align-items: center; gap: 7px;
  padding: 8px 14px; border-radius: 999px;
  border: 1.5px solid; background: #fff;
  font-size: 12.5px; font-weight: 600; cursor: pointer;
  transition: transform .12s, filter .15s;
}
.was-pill:hover { transform: translateY(-1px); }
.was-pill-dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; opacity: .85; }
.was-pill.was-on  { color: #15803d; border-color: #bbf7d0; }
.was-pill.was-on.on  { background: #dcfce7; box-shadow: 0 0 0 3px rgba(34,197,94,.18); }
.was-pill.was-pen { color: #b45309; border-color: #fde68a; }
.was-pill.was-pen.on { background: #fef3c7; box-shadow: 0 0 0 3px rgba(245,158,11,.18); }
.was-pill.was-nc  { color: #475569; border-color: #cbd5e1; }
.was-pill.was-nc.on  { background: #e2e8f0; box-shadow: 0 0 0 3px rgba(100,116,139,.18); }
.was-pill.was-out { color: #b91c1c; border-color: #fecaca; }
.was-pill.was-out.on { background: #fee2e2; box-shadow: 0 0 0 3px rgba(239,68,68,.18); }
.was-hint { font-size: 11.5px; color: #64748b; margin-top: 8px; }

.was-field { margin-top: 16px; }
.was-textarea {
  width: 100%; resize: vertical; min-height: 64px;
  border: 1.5px solid #cbd5e1; border-radius: 10px;
  padding: 9px 12px; font-size: 12.5px; color: #0f172a;
  background: #fff; outline: none;
  transition: border-color .15s, box-shadow .15s;
  font-family: inherit;
}
.was-textarea:focus { border-color: #128c7e; box-shadow: 0 0 0 3px rgba(18,140,126,.18); }

.was-file {
  display: flex; align-items: center; gap: 10px;
  padding: 6px 10px; border: 1.5px dashed #cbd5e1; border-radius: 10px;
  background: #f8fafc;
}
.was-file-pick {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 7px 12px; border: none; border-radius: 8px;
  background: linear-gradient(135deg, #25d366, #128c7e); color: #fff;
  font-size: 11.5px; font-weight: 600; cursor: pointer;
}
.was-file-pick:hover { filter: brightness(1.08); }
.was-file-name { flex: 1; font-size: 12px; color: #0f172a; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.was-file-x   { background: none; border: none; cursor: pointer; color: #ef4444; font-size: 11.5px; font-weight: 600; }
.was-file-x:hover { text-decoration: underline; }
.was-link  { color: #128c7e; font-weight: 600; text-decoration: none; }
.was-link:hover { text-decoration: underline; }
.was-muted { color: #94a3b8; font-style: italic; }

.was-foot {
  display: flex; justify-content: flex-end; gap: 8px;
  padding: 14px 20px; background: #f8fafc; border-top: 1px solid #e2e8f0;
}
.was-btn {
  padding: 9px 22px; border-radius: 9px; border: 1.5px solid transparent;
  font-size: 12.5px; font-weight: 700; cursor: pointer; transition: all .15s;
}
.was-btn:disabled { opacity: .55; cursor: not-allowed; }
.was-btn-ghost   { background: #fff; border-color: #cbd5e1; color: #475569; }
.was-btn-ghost:hover:not(:disabled) { background: #f1f5f9; }
.was-btn-primary { background: linear-gradient(135deg, #25d366, #128c7e); color: #fff; }
.was-btn-primary:hover:not(:disabled) { filter: brightness(1.08); }

/* Dark mode */
[data-bs-theme="dark"] .was-modal     { background: #0f172a; }
[data-bs-theme="dark"] .was-body      { background: #0f172a; color: #e2e8f0; }
[data-bs-theme="dark"] .was-textarea  { background: #1e293b; border-color: #334155; color: #e2e8f0; }
[data-bs-theme="dark"] .was-pill      { background: #1e293b; }
[data-bs-theme="dark"] .was-file      { background: #1e293b; border-color: #334155; }
[data-bs-theme="dark"] .was-foot      { background: #1e293b; border-top-color: #334155; }
[data-bs-theme="dark"] .was-btn-ghost { background: #1e293b; border-color: #334155; color: #cbd5e1; }
[data-bs-theme="dark"] .was-label     { color: #cbd5e1; }
[data-bs-theme="dark"] .was-hint      { color: #94a3b8; }

@media (max-width: 520px) {
  .was-backdrop { padding: 0; }
  .was-modal { border-radius: 0; height: 100vh; max-height: 100vh; }
  .was-pills { flex-direction: column; align-items: stretch; }
  .was-foot  { flex-direction: column-reverse; }
  .was-btn   { width: 100%; }
}
`;
