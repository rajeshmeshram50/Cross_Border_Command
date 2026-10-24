import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import api from '../../../../api';
import { useToast } from '../../../../contexts/ToastContext';
import { MasterSelect } from '../../../../components/ui/MasterSelect';
import { MasterDatePicker } from '../../../../components/ui/MasterDatePicker';

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
  const [errors, setErrors]   = useState<{ subject?: string; setDate?: string; tat?: string; attachment?: string }>({});

  const todayStr = new Date().toISOString().slice(0, 10);

  /* Reminder attachments are images + PDF only — Word/Excel/CSV are rejected
   * (QA #23). Kept in lock-step with the backend `mimes` rule and the input's
   * `accept`. `accept` is only a hint (drag-drop / "All files" bypasses it),
   * so this is validated on selection too. */
  const ATTACH_EXTS = ['jpg', 'jpeg', 'png', 'webp', 'pdf'];
  const ATTACH_MSG  = 'Unsupported file type. Only images (JPG, PNG, WEBP) and PDF are allowed.';

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
    if (!f) return;
    const ext = f.name.split('.').pop()?.toLowerCase() ?? '';
    if (!ATTACH_EXTS.includes(ext)) {
      setErrors(p => ({ ...p, attachment: ATTACH_MSG }));
      setPicked(null);
      if (fileRef.current) fileRef.current.value = '';
      return;
    }
    setErrors(p => ({ ...p, attachment: undefined }));
    setPicked(f);
  };
  const clearPicked = () => {
    setPicked(null);
    setErrors(p => ({ ...p, attachment: undefined }));
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
    const nextErrors: { subject?: string; setDate?: string; tat?: string } = {};
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
    // Backstop for the picker's minDate — a reminder can't be set in the past.
    else if (setDate < todayStr) nextErrors.setDate = 'Reminder set date cannot be in the past.';
    /* TAT is required (QA #61). It is the turnaround the reminder is chased
       against, so a reminder without one cannot be judged late or on time —
       and the list prints a "—" where the pill belongs. */
    if (!tat) nextErrors.tat = 'TAT is required';
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
      fd.append('tat', tat);
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

  /* Same markup and classes as the Productivity Tracker's Add Reminder form
     (SalesTodo.tsx / SalesTodo.css), so the two dialogs look identical. */
  return createPortal((
    <div className="td-overlay" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
      <div className="td-modal">
        <div className="td-modal-header">
          <div className="td-modal-header-left">
            <div className="td-modal-header-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
            </div>
            <div>
              <div className="td-modal-title-row">
                <span className="td-modal-title">Add Reminder</span>
                <span className="td-modal-pill">REMINDER</span>
              </div>
              <div className="td-modal-sub">Reminder</div>
            </div>
          </div>
          <button className="td-modal-close" onClick={onClose} aria-label="Close">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="td-modal-body">
          <div className="td-form-row">
            <div className="td-field">
              <label className="td-label">Opportunity ID</label>
              <input className="td-inp" value={oppId ?? ''} readOnly disabled />
            </div>
            <div className="td-field">
              <label className="td-label">Opportunity Date</label>
              <MasterDatePicker
                value={toIsoDate(oppDate) ?? ''}
                onChange={() => { /* derived from the opportunity — not user-editable */ }}
                placeholder="Auto-filled from opportunity"
                disabled
              />
            </div>
          </div>

          <div className="td-form-row">
            <div className="td-field">
              <label className="td-label">Status</label>
              {/* Add-only form, so "In Progress" is the only status on offer.
                  A reminder that is Done the moment it is created is a
                  contradiction — nothing was ever chased — and offering it here
                  let a new reminder be filed straight into the completed pile,
                  where nobody looks. The list's own Done / Reopen buttons are
                  where the status changes after that, and the Sales To-Do
                  editor still offers both when EDITING an existing one. */}
              <MasterSelect
                value={status}
                onChange={(v) => setStatus(v as ReminderStatus)}
                options={[
                  { value: 'In Progress', label: 'In Progress' },
                ]}
                placeholder="Select status"
              />
            </div>
            <div className="td-field">
              <label className="td-label">Reminder Subject <span className="td-req">*</span></label>
              <input
                className={`td-inp${errors.subject ? ' td-inp-invalid' : ''}`}
                placeholder="Subject"
                value={subject}
                onChange={e => { setSubject(e.target.value); if (errors.subject) setErrors(p => ({ ...p, subject: undefined })); }}
              />
              {errors.subject && <div className="td-field-err">{errors.subject}</div>}
            </div>
          </div>

          <div className="td-form-row">
            <div className="td-field">
              <label className="td-label">Reminder Set Date <span className="td-req">*</span></label>
              <MasterDatePicker
                value={setDate}
                onChange={(v) => { setSetDate(v); if (errors.setDate) setErrors(p => ({ ...p, setDate: undefined })); }}
                minDate={todayStr}
                placeholder="dd-mm-yyyy"
                invalid={!!errors.setDate}
              />
              {errors.setDate && <div className="td-field-err">{errors.setDate}</div>}
            </div>
            <div className="td-field">
              <label className="td-label">TAT <span className="td-req">*</span></label>
              <MasterSelect
                value={tat}
                onChange={(v) => { setTat(v); if (errors.tat) setErrors(p => ({ ...p, tat: undefined })); }}
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
              {errors.tat && <div className="td-field-err">{errors.tat}</div>}
            </div>
          </div>

          <div className="td-form-row">
            <div className="td-field">
              <label className="td-label">Attachment</label>
              <input
                ref={fileRef}
                type="file"
                accept=".jpg,.jpeg,.png,.webp,.pdf"
                onChange={onFileChange}
                style={{ display: 'none' }}
              />
              <label className="td-file-drop" onClick={(e) => { e.preventDefault(); onPickFile(); }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#14b8a6" strokeWidth="2.2" style={{ flexShrink: 0 }}>
                  <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                </svg>
                <span className="td-file-label">{picked?.name || 'Choose file…'}</span>
                {picked && (
                  <button
                    type="button"
                    className="td-file-clear"
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); clearPicked(); }}
                    title="Clear selection"
                  >×</button>
                )}
              </label>
              {errors.attachment && <div className="td-field-err">{errors.attachment}</div>}
            </div>
            <div className="td-field">
              <label className="td-label">Remark</label>
              <textarea
                className="td-inp"
                rows={3}
                maxLength={2000}
                placeholder="Add a remark or note…"
                value={remark}
                onChange={e => setRemark(e.target.value)}
                style={{ resize: 'none', height: 76 }}
              />
              <span className="td-char-count">{remark.length}/2000</span>
            </div>
          </div>
        </div>

        <div className="td-modal-footer">
          <div className="td-footer-hint">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
            Fields marked <span className="td-req">*</span> are required
          </div>
          <div className="td-footer-actions">
            <button type="button" className="td-btn-cancel" onClick={onClose} disabled={saving}>Cancel</button>
            <button type="button" className="td-btn-save" onClick={() => void save()} disabled={saving || !oppId}>
              {saving ? (
                <>
                  <span className="td-spinner" aria-hidden />
                  Saving…
                </>
              ) : (
                <>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /></svg>
                  Save
                </>
              )}
            </button>
          </div>
        </div>
        {/* While saving, blanket the whole modal so no field/button can be touched. */}
        {saving && (
          <div className="td-form-lock" aria-live="polite" aria-busy="true">
            <span className="td-form-lock-spinner" />
            <span className="td-form-lock-text">Saving…</span>
          </div>
        )}
      </div>
    </div>
  ), document.body);
}
