import { useEffect, useRef, useState } from 'react';
import api from '../../../../api';
import { useToast } from '../../../../contexts/ToastContext';
import { MasterDatePicker } from '../../../../components/ui/MasterDatePicker';
import { resolveFileUrl } from '../../../../utils/resolveFileUrl';

/* ─────────────────────────────────────────────────────────────────────────
 * Task Manager Panel — right sidebar of the Sales Matrix detail page.
 *
 * Tabbed shell (Task Manager active; Chanakya / Sarthi / Chat View are
 * SOON placeholders). The Task Manager tab is the form the salesperson
 * uses to capture the Purchase Decision Maker + buying-plan + order-
 * value context for a lead.
 *
 *   - Pre-populates from the lead.task_manager row owned by the parent
 *     (so it stays in sync when the parent refetches after a save).
 *   - Saves multipart-FormData to POST /sales/leads/{id}/task-manager
 *     and bubbles the freshly-persisted row up via `onSaved` so the
 *     parent can refresh the read-only Stage 1 display.
 *
 * Render hosting: the parent supplies its own .smd-deal-card wrapper +
 * header. This component renders only the tabs + form body so the look
 * stays consistent with the existing card chrome.
 * ───────────────────────────────────────────────────────────────────────── */

export type TaskManagerRow = {
  id?:                 number;
  order_value?:        string | number | null;
  buying_plan?:        string | null;
  name?:               string | null;
  mobile_no?:          string | null;
  email?:              string | null;
  attachment?:         string | null;
  /* Absolute, storage-host-correct URL built server-side via file_url(). Use
   * this for the "View" button — rebuilding it from the bare `attachment` path
   * on the client bounces to the dashboard (QA #55). */
  attachment_url?:     string | null;
  attachment_original?: string | null;
};

type Props = {
  /* DB id of the parent lead — required for the POST URL. Null/undef
   * disables the form (deep-linked-by-opp-code case). */
  leadId: number | null | undefined;
  /* Sales person rendered read-only at the top of the form. */
  salespersonName: string;
  /* Current task-manager values (server-side); used to seed the form. */
  initial: TaskManagerRow | null;
  /* Fired after a successful save, with the freshly-persisted row.
   * Parent uses this to update the Stage 1 read-only display. */
  onSaved: (row: TaskManagerRow) => void;
  /* When true the deal is locked (PI signed) — the form is read-only and
   * Save is disabled. */
  locked?: boolean;
};

const digitsOnly = (s: string) => s.replace(/\D/g, '').slice(0, 15);
const isValidEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());

export default function TaskManagerPanel({ leadId, salespersonName, initial, onSaved, locked = false }: Props) {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement | null>(null);

  const [orderValue, setOrderValue] = useState('');
  const [buyingPlan, setBuyingPlan] = useState('');
  const [name, setName]   = useState('');
  const [mobile, setMobile] = useState('');
  const [email, setEmail]   = useState('');

  const [pickedFile, setPickedFile] = useState<File | null>(null);
  const [existingPath, setExistingPath] = useState<string | null>(null);
  const [existingUrl, setExistingUrl] = useState<string | null>(null);
  const [existingName, setExistingName] = useState<string | null>(null);

  const [errors, setErrors] = useState<{ name?: string; mobile?: string; email?: string }>({});
  const [saving, setSaving] = useState(false);

  /* Hydrate from `initial` whenever the parent reloads the lead. */
  useEffect(() => {
    const t = initial;
    setOrderValue(t?.order_value !== null && t?.order_value !== undefined ? String(t.order_value) : '');
    setBuyingPlan(t?.buying_plan ? t.buying_plan.slice(0, 10) : '');
    setName(t?.name ?? '');
    setMobile(t?.mobile_no ?? '');
    setEmail(t?.email ?? '');
    setExistingPath(t?.attachment ?? null);
    setExistingUrl(t?.attachment_url ?? null);
    setExistingName(t?.attachment_original ?? null);
    setPickedFile(null);
    setErrors({});
  }, [initial]);

  const validate = (): boolean => {
    const e: typeof errors = {};
    if (!name.trim())                    e.name   = 'Name is required';
    if (!mobile.trim())                  e.mobile = 'Mobile is required';
    else if (!/^\d{6,15}$/.test(mobile)) e.mobile = 'Mobile must be 6–15 digits';
    if (!email.trim())                   e.email  = 'Email is required';
    else if (!isValidEmail(email))       e.email  = 'Enter a valid email';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const onSave = async () => {
    if (locked) {
      toast.warning('Deal locked', 'The Proforma Invoice is signed — this opportunity is read-only.');
      return;
    }
    if (!leadId) {
      toast.warning('No lead in context', 'Open this stage from the Lead Worksheet to enable saving');
      return;
    }
    if (!validate()) {
      toast.warning('Missing details', 'Please fix the highlighted fields');
      return;
    }
    setSaving(true);
    try {
      const fd = new FormData();
      fd.append('name', name.trim());
      fd.append('mobile_no', mobile);
      fd.append('email', email.trim());
      if (orderValue) fd.append('order_value', orderValue);
      if (buyingPlan) fd.append('buying_plan', buyingPlan);
      if (pickedFile) fd.append('attachment', pickedFile);

      const { data } = await api.post<{ status: boolean; data: TaskManagerRow }>(
        `/sales/leads/${leadId}/task-manager`,
        fd,
        { headers: { 'Content-Type': 'multipart/form-data' } },
      );
      toast.success('Saved', 'Task manager details updated');
      onSaved(data.data);
    } catch (e: any) {
      const serverErrors = e?.response?.data?.errors as Record<string, string[]> | undefined;
      if (serverErrors) {
        setErrors({
          name:   serverErrors.name?.[0],
          mobile: serverErrors.mobile_no?.[0],
          email:  serverErrors.email?.[0],
        });
      }
      toast.error('Save failed', e?.response?.data?.message ?? 'Could not save task manager');
    } finally {
      setSaving(false);
    }
  };

  const onPickFile = () => fileRef.current?.click();
  const onFileChange = (ev: React.ChangeEvent<HTMLInputElement>) => {
    const f = ev.target.files?.[0];
    if (f) setPickedFile(f);
  };
  const clearPickedFile = () => {
    setPickedFile(null);
    if (fileRef.current) fileRef.current.value = '';
  };

  /* Open the attached file in a new tab. For freshly picked files we
   * mint an object URL on demand (the browser GC's it when the spawned
   * tab is closed); for server-stored files we hit the /storage path
   * directly. */
  const onViewFile = () => {
    if (pickedFile) {
      const url = URL.createObjectURL(pickedFile);
      window.open(url, '_blank', 'noopener');
      return;
    }
    if (existingPath) {
      // Prefer the server-built absolute URL (file_url). Rebuilding it from the
      // bare disk path on the client resolves against the SPA origin, where the
      // router catch-all serves index.html and bounces the user to the dashboard
      // (QA #55). resolveFileUrl stays only as a legacy fallback for rows saved
      // before the backend started sending attachment_url.
      window.open(existingUrl || resolveFileUrl(existingPath), '_blank', 'noopener');
    }
  };

  /* Delete clears the staged pick first (back to the saved file, if any).
   * If only an existing server file is shown, clear it locally — the
   * next save can re-upload a new attachment to overwrite. */
  const onDeleteFile = () => {
    if (pickedFile) {
      clearPickedFile();
      return;
    }
    setExistingPath(null);
    setExistingName(null);
  };

  const hasFile   = !!(pickedFile || existingPath);
  const fileLabel = pickedFile?.name ?? existingName ?? 'Attach File';

  return (
    <>
      <style>{TM_CSS}</style>

      {/* Tabs — Task Manager active, others SOON. The active tab pill
          also shows a "Saved" badge when the lead already has a row
          persisted (initial !== null) so the user gets immediate
          feedback that their data was loaded from the server. */}
      <div className="smd-deal-tabs">
        <button className="smd-deal-tab smd-deal-tab-active">
          ✓ Task Manager
          {initial?.id != null && <span className="tm-saved-badge" title="Saved on server">●</span>}
        </button>
        <button className="smd-deal-tab" disabled>
          ⚡ Chanakya<span className="smd-deal-tab-soon">SOON</span>
        </button>
        <button className="smd-deal-tab" disabled>
          ◎ Sarthi<span className="smd-deal-tab-soon">SOON</span>
        </button>
        <button className="smd-deal-tab" disabled>
          ◆ Chat View<span className="smd-deal-tab-soon">SOON</span>
        </button>
      </div>

      {/* Form */}
      <div className="smd-deal-form">
        <div className="smd-deal-row">
          <Field label="SALES PERSON NAME">
            <input className="smd-input" value={salespersonName} readOnly />
          </Field>
          <Field label="CHOOSE FILE">
            <input
              ref={fileRef}
              type="file"
              accept=".jpg,.jpeg,.png,.webp,.pdf"
              onChange={onFileChange}
              style={{ display: 'none' }}
            />
            {hasFile ? (
              <div className="tm-file-chip" title={fileLabel}>
                <svg className="tm-file-chip-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                </svg>
                <span className="tm-file-chip-name">{fileLabel}</span>
                <button
                  type="button"
                  className="tm-file-chip-btn tm-file-chip-view tm-tip"
                  onClick={onViewFile}
                  aria-label="View file"
                  data-tip="View"
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                </button>
                <button
                  type="button"
                  className="tm-file-chip-btn tm-file-chip-del tm-tip"
                  onClick={onDeleteFile}
                  aria-label="Remove file"
                  data-tip="Remove"
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6l-1.5 14a2 2 0 0 1-2 2H8.5a2 2 0 0 1-2-2L5 6" />
                    <path d="M10 11v6M14 11v6" />
                    <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
                  </svg>
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="smd-input smd-input-file tm-file-btn"
                onClick={onPickFile}
                title="Choose a file"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                </svg>
                <span className="tm-file-btn-label">Attach File</span>
              </button>
            )}
          </Field>
        </div>

        <div className="smd-deal-row">
          <Field label="BUYING PLAN">
            <MasterDatePicker
              value={buyingPlan}
              onChange={setBuyingPlan}
              placeholder="dd-mm-yyyy"
            />
          </Field>
          <Field label="ORDER VALUE">
            <input
              type="number"
              min="0"
              step="any"
              className="smd-input"
              placeholder="Enter order value"
              value={orderValue}
              onChange={e => setOrderValue(e.target.value)}
            />
          </Field>
        </div>

        <div className="smd-deal-section-label">PURCHASE DECISION MAKER</div>

        <div className="smd-deal-row">
          <Field label={<>NAME <span className="smd-req">*</span></>} error={errors.name}>
            <input
              className={`smd-input ${errors.name ? 'tm-input-err' : ''}`}
              placeholder="Enter name"
              value={name}
              onChange={e => { setName(e.target.value); setErrors(p => ({ ...p, name: undefined })); }}
            />
          </Field>
          <Field label={<>MOBILE NUMBER <span className="smd-req">*</span></>} error={errors.mobile}>
            <input
              className={`smd-input ${errors.mobile ? 'tm-input-err' : ''}`}
              placeholder="Enter mobile"
              value={mobile}
              onChange={e => { setMobile(digitsOnly(e.target.value)); setErrors(p => ({ ...p, mobile: undefined })); }}
            />
          </Field>
        </div>

        <div className="smd-deal-row" style={{ gridTemplateColumns: '1fr' }}>
          <Field label={<>EMAIL <span className="smd-req">*</span></>} error={errors.email}>
            <input
              type="email"
              className={`smd-input ${errors.email ? 'tm-input-err' : ''}`}
              placeholder="Enter email address"
              value={email}
              onChange={e => { setEmail(e.target.value); setErrors(p => ({ ...p, email: undefined })); }}
            />
          </Field>
        </div>

        <div className="smd-deal-save-wrap">
          <button
            type="button"
            className="smd-deal-save-btn"
            onClick={() => void onSave()}
            disabled={saving || !leadId || locked}
            title={locked ? 'Locked — the Proforma Invoice has been signed' : undefined}
          >
            {locked ? 'Locked' : (saving ? 'Saving…' : 'Save')}
          </button>
        </div>
      </div>
    </>
  );
}

function Field(props: { label: React.ReactNode; error?: string; children: React.ReactNode }) {
  return (
    <div className="tm-field">
      <div className="tm-field-label">{props.label}</div>
      {props.children}
      {props.error && <div className="tm-field-err">{props.error}</div>}
    </div>
  );
}

const TM_CSS = `
.tm-saved-badge {
  display: inline-block; width: 7px; height: 7px;
  margin-left: 6px; vertical-align: middle;
  border-radius: 50%; background: #22c55e;
  box-shadow: 0 0 0 3px rgba(34,197,94,.22);
  font-size: 0;
}
.tm-field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.tm-field-label {
  font-size: 9.5px; font-weight: 800; letter-spacing: .06em;
  color: #6d28d9; text-transform: uppercase;
}
.tm-field-err {
  font-size: 10.5px; color: #ef4444; margin-top: -1px;
}
.tm-input-err { border-color: #ef4444 !important; }
.tm-input-err:focus { box-shadow: 0 0 0 3px rgba(239,68,68,.16); }

.tm-file-btn {
  display: inline-flex; align-items: center; gap: 7px;
  font-weight: 600;
}
.tm-file-btn-label {
  flex: 1; min-width: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  text-align: left;
}

/* File chip — shown in place of the Attach File button once a file
 * has been picked (or already exists on the server). Filename appears
 * in small, with inline View + Remove icon buttons in the same container. */
.tm-file-chip {
  display: flex; align-items: center; gap: 6px;
  padding: 4px 5px 4px 10px;
  background: #faf8ff;
  border: 1.5px solid #e0d9ff;
  border-radius: 8px;
  min-height: 31px;
  min-width: 0;
}
.tm-file-chip-icon { color: #7c3aed; flex-shrink: 0; }
.tm-file-chip-name {
  flex: 1; min-width: 0;
  font-size: 9px; font-weight: 600; color: #5b21b6;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  letter-spacing: .01em;
}
.tm-file-chip-btn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 22px; height: 22px; border-radius: 6px;
  background: #fff;
  border: 1.5px solid #e0d9ff;
  color: #7c3aed;
  cursor: pointer; padding: 0;
  transition: background .15s, border-color .15s, color .15s;
  flex-shrink: 0;
}
.tm-file-chip-view:hover { background: #ede9fe; border-color: #7c3aed; }
.tm-file-chip-del { color: #ef4444; }
.tm-file-chip-del:hover { background: #fef2f2; border-color: #ef4444; }

/* Dark mode */
[data-bs-theme="dark"] .tm-field-label { color: #c4b5fd; }
[data-bs-theme="dark"] .tm-file-chip {
  background: #1f1845; border-color: rgba(167,139,250,.30);
}
[data-bs-theme="dark"] .tm-file-chip-name { color: #ede9fe; }
[data-bs-theme="dark"] .tm-file-chip-icon { color: #a78bfa; }
[data-bs-theme="dark"] .tm-file-chip-btn {
  background: #2a2150; border-color: rgba(167,139,250,.30); color: #d8b4fe;
}
[data-bs-theme="dark"] .tm-file-chip-view:hover { background: #3b2f6e; border-color: #a78bfa; }
[data-bs-theme="dark"] .tm-file-chip-del { color: #fca5a5; }
[data-bs-theme="dark"] .tm-file-chip-del:hover { background: rgba(239,68,68,.18); border-color: #fca5a5; }

/* ── Custom tooltip (replaces native title=) ── */
.tm-tip { position: relative; }
.tm-tip::after {
  content: attr(data-tip);
  position: absolute; left: 50%; bottom: calc(100% + 7px);
  transform: translateX(-50%) translateY(3px);
  background: #2e1065; color: #fff;
  font-size: 9.5px; font-weight: 700; letter-spacing: .02em;
  white-space: nowrap; padding: 4px 9px; border-radius: 6px;
  box-shadow: 0 4px 14px rgba(46,16,101,.35);
  opacity: 0; pointer-events: none; z-index: 60;
  transition: opacity .15s ease, transform .15s ease;
}
.tm-tip::before {
  content: ''; position: absolute; left: 50%; bottom: calc(100% + 3px);
  transform: translateX(-50%);
  border: 4px solid transparent; border-top-color: #2e1065;
  opacity: 0; pointer-events: none; z-index: 60;
  transition: opacity .15s ease;
}
.tm-tip:hover::after { opacity: 1; transform: translateX(-50%) translateY(0); }
.tm-tip:hover::before { opacity: 1; }
[data-bs-theme="dark"] .tm-tip::after { background: #ede9fe; color: #2e1065; box-shadow: 0 4px 14px rgba(0,0,0,.5); }
[data-bs-theme="dark"] .tm-tip::before { border-top-color: #ede9fe; }
`;
