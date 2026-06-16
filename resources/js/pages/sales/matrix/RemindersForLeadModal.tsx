import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import api from '../../../api';
import { useToast } from '../../../contexts/ToastContext';
import { MasterSelect } from '../../../components/ui/MasterSelect';
import { MasterDatePicker } from '../../../components/ui/MasterDatePicker';

/* ─────────────────────────────────────────────────────────────────────────
 * Add Reminder — focused dialog opened from the matrix toolbar.
 *
 * Auto-fetches Opportunity ID + Date from the current lead (read-only),
 * lets the user set Status / Subject / Reminder Date / TAT / Attachment /
 * Remark. Posts to /sales/reminders (multipart so the optional attachment
 * can ride along).
 * ───────────────────────────────────────────────────────────────────────── */

type ReminderStatus = 'In Progress' | 'Done';

/* Convert a date that could be DD/MM/YYYY (display format) or already
 * YYYY-MM-DD into ISO. Returns undefined on parse failure. */
function toIsoDate(input: string | undefined | null): string | undefined {
  if (!input) return undefined;
  const s = String(input).trim();
  if (!s) return undefined;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const dmy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (dmy) {
    const [, d, m, y] = dmy;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : undefined;
}

/* Display format for the read-only OPP DATE chip. */
function toDisplayDate(input: string | undefined | null): string {
  const iso = toIsoDate(input);
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}-${m}-${y}`;
}

type Props = {
  open:    boolean;
  oppId:   string | undefined;
  oppDate?: string;
  onClose: () => void;
};

export default function RemindersForLeadModal({ open, oppId, oppDate, onClose }: Props) {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement | null>(null);

  const [status, setStatus]   = useState<ReminderStatus>('In Progress');
  const [subject, setSubject] = useState('');
  const [setDate, setSetDate] = useState('');
  const [tat, setTat]         = useState('');
  const [remark, setRemark]   = useState('');
  const [picked, setPicked]   = useState<File | null>(null);
  const [saving, setSaving]   = useState(false);
  /* Inline field errors shown beneath the required fields. The toast was
   * the only feedback before, which the user could miss while looking at
   * the form — now Subject / Set Date show a red message under the box. */
  const [errors, setErrors]   = useState<{ subject?: string; setDate?: string }>({});

  const todayStr = new Date().toISOString().slice(0, 10);

  /* Reset every time the modal opens so an old draft never leaks into a
   * fresh lead. */
  useEffect(() => {
    if (!open) return;
    setStatus('In Progress');
    setSubject('');
    setSetDate('');
    setTat('');
    setRemark('');
    setPicked(null);
    setErrors({});
    if (fileRef.current) fileRef.current.value = '';
  }, [open]);

  if (!open) return null;

  const onPickFile = () => fileRef.current?.click();
  const onFileChange = (ev: React.ChangeEvent<HTMLInputElement>) => {
    const f = ev.target.files?.[0];
    if (f) setPicked(f);
  };
  const clearPicked = () => {
    setPicked(null);
    if (fileRef.current) fileRef.current.value = '';
  };

  const save = async () => {
    if (!oppId) {
      toast.warning('No opportunity in context', 'Open this from the Lead Worksheet to enable saving');
      return;
    }
    // Validate both required fields together so each shows its own inline
    // message under the box (not one-at-a-time toasts the user can miss).
    // The Subject content rules mirror the backend safeTextRule so the same
    // "special characters / must contain letters" feedback shows INLINE under
    // the field instead of coming back as a toast after a failed save.
    const nextErrors: { subject?: string; setDate?: string } = {};
    const subj = subject.trim();
    if (!subj) {
      nextErrors.subject = 'Reminder subject is required';
    } else if (!/^[A-Za-z0-9 ,.'\-&()\/:]+$/.test(subj)) {
      nextErrors.subject = 'Special characters are not allowed in Subject.';
    } else if (!/[A-Za-z]/.test(subj)) {
      nextErrors.subject = 'Subject must contain letters.';
    } else if (subj.length < 3) {
      nextErrors.subject = 'Subject must be at least 3 characters.';
    } else if (subj.length > 255) {
      nextErrors.subject = 'Subject cannot exceed 255 characters.';
    }
    if (!setDate) nextErrors.setDate = 'Reminder set date is required';
    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors);
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      const isoOppDate = toIsoDate(oppDate);
      const fd = new FormData();
      fd.append('opp_id', oppId);
      fd.append('subject', subject.trim());
      fd.append('set_date', setDate);
      fd.append('status', status);
      if (isoOppDate)    fd.append('opp_date', isoOppDate);
      if (tat)           fd.append('tat', tat);
      if (remark.trim()) fd.append('remark', remark.trim());
      if (picked)        fd.append('attachment', picked);

      await api.post('/sales/reminders', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      toast.success('Reminder added', 'Saved to this opportunity');
      onClose();
    } catch (e: any) {
      const errs = e?.response?.data?.errors as Record<string, string[]> | undefined;
      // Route field errors (subject / set_date) to their inline message under
      // the box; only non-field errors fall back to a toast.
      const fieldErrs: { subject?: string; setDate?: string } = {};
      if (errs?.subject?.[0])  fieldErrs.subject = errs.subject[0];
      if (errs?.set_date?.[0]) fieldErrs.setDate = errs.set_date[0];
      if (Object.keys(fieldErrs).length) {
        setErrors(p => ({ ...p, ...fieldErrs }));
      } else {
        const firstErr = errs ? Object.values(errs)[0]?.[0] : undefined;
        toast.error('Save failed', firstErr ?? e?.response?.data?.message ?? 'Could not save reminder');
      }
    } finally {
      setSaving(false);
    }
  };

  return createPortal((
    <div className="rfl-backdrop">
      <style>{RFL_CSS}</style>
      <div className="rfl-modal" onClick={(e) => e.stopPropagation()}>
        <div className="rfl-head">
          <div className="rfl-head-left">
            <div className="rfl-head-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
            </div>
            <div>
              <div className="rfl-head-row">
                <span className="rfl-head-title">Add Reminder</span>
                <span className="rfl-head-tag">REMINDER</span>
              </div>
              <div className="rfl-head-sub">Reminder</div>
            </div>
          </div>
          <button className="rfl-close" onClick={onClose} aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="rfl-body">
          <div className="rfl-grid">
            <div className="rfl-fld">
              <div className="rfl-lbl-row">
                <label className="rfl-lbl">OPPORTUNITY ID <span className="rfl-req">*</span></label>
                <span className="rfl-pill rfl-pill-fetched"><span className="rfl-pill-dot" /> AUTO-FETCHED</span>
              </div>
              <input className="rfl-input rfl-input-ro" value={oppId ?? ''} readOnly />
            </div>
            <div className="rfl-fld">
              <div className="rfl-lbl-row">
                <label className="rfl-lbl">OPPORTUNITY DATE <span className="rfl-req">*</span></label>
                <span className="rfl-pill rfl-pill-fetched"><span className="rfl-pill-dot" /> AUTO-FETCHED</span>
              </div>
              <input className="rfl-input rfl-input-ro" value={toDisplayDate(oppDate)} readOnly />
            </div>

            <div className="rfl-fld">
              <label className="rfl-lbl">STATUS</label>
              <MasterSelect
                value={status}
                onChange={(v) => setStatus(v as ReminderStatus)}
                options={[
                  { value: 'In Progress', label: 'In Progress' },
                  { value: 'Done',        label: 'Done'        },
                ]}
                placeholder="Select status"
              />
            </div>
            <div className="rfl-fld">
              <label className="rfl-lbl">REMINDER SUBJECT <span className="rfl-req">*</span></label>
              <input
                className={`rfl-input${errors.subject ? ' is-invalid' : ''}`}
                placeholder="Subject"
                value={subject}
                onChange={e => { setSubject(e.target.value); if (errors.subject) setErrors(p => ({ ...p, subject: undefined })); }}
              />
              {errors.subject && <div className="rfl-err">{errors.subject}</div>}
            </div>

            <div className="rfl-fld">
              <label className="rfl-lbl">REMINDER SET DATE <span className="rfl-req">*</span></label>
              <MasterDatePicker
                value={setDate}
                onChange={(v) => { setSetDate(v); if (errors.setDate) setErrors(p => ({ ...p, setDate: undefined })); }}
                minDate={todayStr}
                placeholder="dd-mm-yyyy"
                invalid={!!errors.setDate}
              />
              {errors.setDate && <div className="rfl-err">{errors.setDate}</div>}
            </div>
            <div className="rfl-fld">
              <label className="rfl-lbl">TAT</label>
              <MasterSelect
                value={tat}
                onChange={setTat}
                options={[
                  { value: '24 Hours', label: '24 Hours' },
                  { value: '48 Hours', label: '48 Hours' },
                  { value: '72 Hours', label: '72 Hours' },
                  { value: '1 Week',   label: '1 Week'   },
                  { value: '2 Weeks',  label: '2 Weeks'  },
                  { value: '1 Month',  label: '1 Month'  },
                ]}
                placeholder="Select TAT"
              />
            </div>

            <div className="rfl-fld">
              <label className="rfl-lbl">ATTACHMENT</label>
              <input
                ref={fileRef}
                type="file"
                accept=".jpg,.jpeg,.png,.webp,.pdf"
                onChange={onFileChange}
                style={{ display: 'none' }}
              />
              {picked ? (
                <div className="rfl-file-chip" title={picked.name}>
                  <svg className="rfl-file-chip-ico" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                    <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                  </svg>
                  <span className="rfl-file-chip-name">{picked.name}</span>
                  <button type="button" className="rfl-file-chip-x" onClick={clearPicked} aria-label="Remove">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
              ) : (
                <button type="button" className="rfl-file-btn" onClick={onPickFile}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                    <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                  </svg>
                  Choose file...
                </button>
              )}
            </div>
            <div className="rfl-fld">
              <label className="rfl-lbl">REMARK</label>
              <textarea
                className="rfl-input rfl-textarea"
                rows={3}
                placeholder="Add a remark or note…"
                value={remark}
                onChange={e => setRemark(e.target.value)}
              />
            </div>
          </div>
        </div>

        <div className="rfl-foot">
          <div className="rfl-foot-note">
            <span className="rfl-foot-dot" /> Fields marked <span className="rfl-req">*</span> are required
          </div>
          <div className="rfl-foot-actions">
            <button className="rfl-btn rfl-btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
            <button className="rfl-btn rfl-btn-primary" onClick={() => void save()} disabled={saving || !oppId}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                <polyline points="17 21 17 13 7 13 7 21" />
                <polyline points="7 3 7 8 15 8" />
              </svg>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  ), document.body);
}

const RFL_CSS = `
.rfl-backdrop {
  position: fixed; inset: 0; z-index: 1080;
  background: rgba(15, 23, 42, .55);
  backdrop-filter: blur(3px);
  display: flex; align-items: center; justify-content: center;
  padding: 16px;
  animation: rfl-fade .15s ease-out;
}
@keyframes rfl-fade { from { opacity: 0; } to { opacity: 1; } }

.rfl-modal {
  width: min(720px, 100%); max-height: 92vh;
  background: linear-gradient(180deg, #ecfdf5 0%, #d1fae5 100%);
  border-radius: 14px;
  box-shadow: 0 18px 48px rgba(15, 23, 42, .28);
  overflow: hidden;
  display: flex; flex-direction: column;
  animation: rfl-pop .18s ease-out;
}
@keyframes rfl-pop {
  from { transform: scale(.96); opacity: 0; }
  to   { transform: scale(1);   opacity: 1; }
}

/* ─── Header (teal gradient) ───
   Prototype spec: 135° sweep from deep emerald through dark teal to
   bright teal. Same layout properties as the other matrix popups so
   the header stays in a single row at any width. */
.rfl-head {
  position: relative; overflow: hidden;
  display: flex; align-items: center; justify-content: space-between;
  gap: 12px;
  padding: 14px 22px;
  background: linear-gradient(135deg, #065F46 0%, #0F766E 55%, #14B8A6 100%);
  color: #fff;
}
.rfl-head::before {
  content: ''; position: absolute; top: 0; left: 0; right: 0; height: 50%;
  background: linear-gradient(180deg, rgba(255, 255, 255, .18), transparent);
  pointer-events: none;
}
.rfl-head-left { position: relative; z-index: 1; display: flex; align-items: center; gap: 13px; }
.rfl-head-icon {
  width: 42px; height: 42px; border-radius: 11px;
  background: rgba(255, 255, 255, .22);
  border: 1px solid rgba(255, 255, 255, .30);
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 3px 10px rgba(0, 0, 0, .15);
  flex-shrink: 0;
}
.rfl-head-row { display: inline-flex; align-items: center; gap: 8px; }
.rfl-head-title { font-size: 17px; font-weight: 800; line-height: 1.2; letter-spacing: -.2px; }
.rfl-head-tag {
  font-size: 9px; font-weight: 800; letter-spacing: .12em;
  padding: 3px 9px; border-radius: 999px;
  background: rgba(255, 255, 255, .22);
  border: 1px solid rgba(255, 255, 255, .35);
  color: #fff;
  text-transform: uppercase;
}
.rfl-head-sub { font-size: 11.5px; color: rgba(255, 255, 255, .85); margin-top: 2px; font-weight: 500; }
.rfl-close {
  position: relative; z-index: 1;
  width: 30px; height: 30px; border: none; cursor: pointer;
  background: rgba(255, 255, 255, .20);
  color: #fff; border-radius: 9px;
  display: flex; align-items: center; justify-content: center;
  transition: background .15s;
}
.rfl-close:hover { background: rgba(255, 255, 255, .35); }

/* ─── Body ─── */
.rfl-body {
  padding: 18px 22px;
  background: #F0FDFA;
  flex: 1; overflow-y: auto;
}
.rfl-body::-webkit-scrollbar { width: 5px; }
.rfl-body::-webkit-scrollbar-thumb { background: rgba(20, 184, 166, .35); border-radius: 999px; }

.rfl-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px 18px;
}

.rfl-fld {
  display: flex; flex-direction: column; gap: 6px;
  min-width: 0;
}
.rfl-lbl-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.rfl-lbl {
  font-size: 11px; font-weight: 600; letter-spacing: .08em;
  color: #0f766e; text-transform: uppercase;
}
.rfl-req { color: #ef4444; }

/* AUTO-FETCHED chip */
.rfl-pill {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 2px 9px; border-radius: 999px;
  font-size: 8.5px; font-weight: 800; letter-spacing: .08em;
  text-transform: uppercase;
}
.rfl-pill-fetched {
  background: rgba(20, 184, 166, .12);
  border: 1px solid rgba(20, 184, 166, .40);
  color: #0f766e;
}
.rfl-pill-dot {
  width: 5px; height: 5px; border-radius: 50%;
  background: #14b8a6;
  box-shadow: 0 0 6px rgba(20, 184, 166, .55);
  animation: rfl-pulse 1.4s ease-in-out infinite;
}
@keyframes rfl-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50%      { opacity: .5; transform: scale(.7); }
}

/* Inputs */
.rfl-input {
  width: 100%;
  padding: 9px 12px;
  border: 1.5px solid rgba(20, 184, 166, .35);
  border-radius: 9px;
  background: #fff;
  font-family: inherit;
  font-size: 13px; font-weight: 500; color: #0f172a;
  outline: none;
  transition: border-color .15s, box-shadow .15s;
}
.rfl-input::placeholder { color: #94a3b8; font-weight: 400; }
.rfl-input:focus {
  border-color: #0d9488;
  box-shadow: 0 0 0 3px rgba(20, 184, 166, .18);
}
/* Required-field error state — red border on the box + a small red message
   below it. Matches the inline-validation pattern used in the Customer /
   Consignee modals so the user gets feedback at the field, not just a toast. */
.rfl-input.is-invalid {
  border-color: #ef4444;
  box-shadow: 0 0 0 3px rgba(239, 68, 68, .15);
}
.rfl-err {
  margin-top: 4px;
  font-size: 11px;
  font-weight: 600;
  color: #ef4444;
  line-height: 1.3;
}

/* MasterSelect + MasterDatePicker triggers — re-skin to match the rest
 * of the modal's inputs. Default ones use var(--vz-card-bg) which
 * resolves transparent against the mint body. */
.rfl-modal .master-select-toggle,
.rfl-modal .master-datepicker-toggle {
  height: 40px;
  background: #fff !important;
  border: 1.5px solid rgba(20, 184, 166, .35) !important;
  border-radius: 9px !important;
  color: #0f172a !important;
  font-size: 13px;
  font-weight: 500;
  padding: 7px 12px;
  box-shadow: none !important;
}
.rfl-modal .master-select-toggle:hover:not(:disabled),
.rfl-modal .master-datepicker-toggle:hover:not(:disabled) {
  border-color: rgba(20, 184, 166, .55) !important;
}
.rfl-modal .master-select-wrap.show .master-select-toggle,
.rfl-modal .master-datepicker-toggle.open {
  border-color: #0d9488 !important;
  box-shadow: 0 0 0 3px rgba(20, 184, 166, .18) !important;
}
/* Invalid state for the MasterDatePicker trigger. The toggle re-skin above
   sets border + box-shadow with !important, so the picker's own
   .master-datepicker-wrap.invalid rule (non-important) never won and the
   required-date field never turned red. Re-assert the error styling here
   with !important so the highlight actually shows. */
.rfl-modal .master-datepicker-wrap.invalid .master-datepicker-toggle {
  border-color: #ef4444 !important;
  box-shadow: 0 0 0 3px rgba(239, 68, 68, .15) !important;
}
.rfl-modal .master-select-placeholder,
.rfl-modal .master-datepicker-placeholder {
  color: #94a3b8 !important;
  opacity: 1 !important;
  font-weight: 400 !important;
}
.rfl-modal .master-datepicker-icon,
.rfl-modal .master-select-caret { color: #0d9488; }
.rfl-input-ro {
  background: rgba(20, 184, 166, .08);
  color: #0f766e;
  font-weight: 400;
  cursor: not-allowed;
}
.rfl-textarea {
  /* Locked to the exact same height as the ATTACHMENT box. Resize is disabled
     so dragging the handle can't desync the two fields — they stay identical.
     box-sizing keeps the 76px total (border + padding) matched to the box. */
  resize: none;
  box-sizing: border-box;
  height: 76px;
  min-height: 76px;
}

/* File picker */
.rfl-file-btn {
  display: inline-flex; align-items: flex-start; gap: 8px;
  width: 100%;
  /* Exact same height as the REMARK textarea so the two fields stay identical. */
  box-sizing: border-box;
  height: 76px;
  padding: 9px 12px;
  border: 1.5px dashed rgba(20, 184, 166, .50);
  border-radius: 9px;
  background: rgba(20, 184, 166, .06);
  color: #0f766e;
  font-family: inherit;
  font-size: 13px; font-weight: 600;
  cursor: pointer;
  transition: all .15s;
  text-align: left;
}
.rfl-file-btn:hover { background: rgba(20, 184, 166, .12); border-color: #0d9488; }

.rfl-file-chip {
  display: flex; align-items: center; gap: 6px;
  width: 100%;
  padding: 6px 8px 6px 10px;
  border: 1.5px solid rgba(20, 184, 166, .40);
  border-radius: 9px;
  background: #fff;
  /* Same height as the file button + REMARK textarea so swapping in the
     picked-file chip doesn't shrink the row. */
  box-sizing: border-box;
  height: 76px;
}
.rfl-file-chip-ico { color: #0d9488; flex-shrink: 0; }
.rfl-file-chip-name {
  flex: 1; min-width: 0;
  font-size: 12px; font-weight: 600; color: #0f766e;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.rfl-file-chip-x {
  display: inline-flex; align-items: center; justify-content: center;
  width: 22px; height: 22px; border-radius: 6px;
  background: transparent; border: 1.5px solid rgba(20, 184, 166, .30);
  color: #ef4444; cursor: pointer; padding: 0; flex-shrink: 0;
  transition: background .15s, border-color .15s;
}
.rfl-file-chip-x:hover { background: rgba(239, 68, 68, .08); border-color: #ef4444; }

/* ─── Footer ─── */
.rfl-foot {
  display: flex; align-items: center; justify-content: space-between;
  gap: 12px;
  padding: 14px 20px;
  background: #fff;
  border-top: 1px solid rgba(20, 184, 166, .20);
}
.rfl-foot-note {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 12px; color: #475569; font-weight: 500;
}
.rfl-foot-dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: #14b8a6;
  box-shadow: 0 0 4px rgba(20, 184, 166, .55);
}
.rfl-foot-actions { display: flex; align-items: center; gap: 8px; }

.rfl-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 6px 14px;
  border-radius: 8px;
  border: 1.5px solid transparent;
  font-family: inherit;
  font-size: 12.5px; font-weight: 700;
  cursor: pointer;
  transition: all .15s;
}
.rfl-btn:disabled { opacity: .55; cursor: not-allowed; }
.rfl-btn-ghost {
  background: #fff;
  border-color: #cbd5e1;
  color: #0f172a;
}
.rfl-btn-ghost:hover:not(:disabled) { background: #f8fafc; border-color: #94a3b8; }
.rfl-btn-primary {
  background: linear-gradient(135deg, #14b8a6, #0d9488);
  color: #fff;
  box-shadow: 0 4px 12px rgba(20, 184, 166, .35);
}
.rfl-btn-primary:hover:not(:disabled) {
  background: linear-gradient(135deg, #0d9488, #0f766e);
  transform: translateY(-1px);
  box-shadow: 0 6px 16px rgba(20, 184, 166, .45);
}

/* ─── Dark mode ─── */
[data-bs-theme="dark"] .rfl-modal {
  background: linear-gradient(180deg, #0c2620 0%, #0a1a17 100%);
}
[data-bs-theme="dark"] .rfl-body { background: #0a1f1b; color: #d1fae5; }
[data-bs-theme="dark"] .rfl-lbl  { color: #5eead4; }
[data-bs-theme="dark"] .rfl-input {
  background: #0f1f1c;
  border-color: rgba(20, 184, 166, .35);
  color: #ecfdf5;
}
[data-bs-theme="dark"] .rfl-input::placeholder { color: #475569; }
[data-bs-theme="dark"] .rfl-input:focus {
  border-color: #14b8a6;
  box-shadow: 0 0 0 3px rgba(20, 184, 166, .25);
}
[data-bs-theme="dark"] .rfl-modal .master-select-toggle,
[data-bs-theme="dark"] .rfl-modal .master-datepicker-toggle {
  background: #0f1f1c !important;
  border-color: rgba(20, 184, 166, .35) !important;
  color: #ecfdf5 !important;
}
[data-bs-theme="dark"] .rfl-modal .master-select-placeholder,
[data-bs-theme="dark"] .rfl-modal .master-datepicker-placeholder {
  color: rgba(94, 234, 212, .50) !important;
}
[data-bs-theme="dark"] .rfl-input-ro {
  background: rgba(20, 184, 166, .12);
  color: #5eead4;
}
[data-bs-theme="dark"] .rfl-file-btn {
  background: rgba(20, 184, 166, .10);
  border-color: rgba(20, 184, 166, .40);
  color: #5eead4;
}
[data-bs-theme="dark"] .rfl-file-btn:hover { background: rgba(20, 184, 166, .18); }
[data-bs-theme="dark"] .rfl-file-chip {
  background: #0f1f1c;
  border-color: rgba(20, 184, 166, .35);
}
[data-bs-theme="dark"] .rfl-file-chip-name { color: #5eead4; }
[data-bs-theme="dark"] .rfl-pill-fetched {
  background: rgba(20, 184, 166, .18);
  border-color: rgba(20, 184, 166, .45);
  color: #5eead4;
}
[data-bs-theme="dark"] .rfl-foot {
  background: #0f1f1c;
  border-top-color: rgba(20, 184, 166, .25);
}
[data-bs-theme="dark"] .rfl-foot-note { color: #94a3b8; }
[data-bs-theme="dark"] .rfl-btn-ghost {
  background: #1e293b;
  border-color: rgba(20, 184, 166, .30);
  color: #d1fae5;
}
[data-bs-theme="dark"] .rfl-btn-ghost:hover:not(:disabled) { background: #243b3a; }

@media (max-width: 720px) {
  .rfl-grid { grid-template-columns: 1fr; }
  .rfl-foot { flex-direction: column-reverse; align-items: stretch; gap: 10px; }
  .rfl-foot-actions { width: 100%; }
  .rfl-foot-actions .rfl-btn { flex: 1; justify-content: center; }
}
`;
