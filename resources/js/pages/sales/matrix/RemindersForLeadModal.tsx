import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import api from '../../../api';
import { useToast } from '../../../contexts/ToastContext';
import { MasterSelect } from '../../../components/ui/MasterSelect';
import { MasterDatePicker } from '../../../components/ui/MasterDatePicker';

/* ─────────────────────────────────────────────────────────────────────────
 * Reminders for this lead — toolbar pill drawer.
 *
 * Lists every reminder with this lead's opp_id pulled from the existing
 * /sales/reminders endpoint, plus a tiny inline "+ New" form that
 * pre-fills opp_id so the user doesn't retype it. Status toggles fire
 * the existing PATCH /sales/reminders/{id}/status endpoint.
 *
 * For the full reminder form (with attachments, tat etc.), users still
 * have /sales/todo. This modal is the quick-action shortcut from the
 * matrix toolbar.
 * ───────────────────────────────────────────────────────────────────────── */

/* Server status values are the exact constants on SalesReminder (capitalised
 * strings with spaces). Keep them as-is here so PATCH /status doesn't
 * 422 on validation. */
type ReminderStatus = 'In Progress' | 'Done';

type Reminder = {
  id:        number;
  subject:   string;
  set_date:  string;
  tat?:      string | null;
  remark?:   string | null;
  opp_id?:   string | null;
  opp_date?: string | null;
  status:    ReminderStatus;
};

const STATUS_META: Record<ReminderStatus, { label: string; pill: string }> = {
  'In Progress': { label: 'In Progress', pill: 'rfl-pill-prog' },
  'Done':        { label: 'Done',        pill: 'rfl-pill-done' },
};

/* Normalise a date that could come in as DD/MM/YYYY (display format),
 * YYYY-MM-DD (already ISO), or ISO 8601 with time → return YYYY-MM-DD
 * if anything parses, undefined otherwise. Server's `date` rule only
 * accepts an unambiguous date string. */
function toIsoDate(input: string | undefined | null): string | undefined {
  if (!input) return undefined;
  const s = String(input).trim();
  if (!s) return undefined;
  // Already YYYY-MM-DD or ISO with time → take the first 10 chars
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  // DD/MM/YYYY (en-GB locale format) → reorder
  const dmy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (dmy) {
    const [, d, m, y] = dmy;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  // Last resort — let the Date parser try
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : undefined;
}

type Props = {
  open:   boolean;
  oppId:  string | undefined;   // OPP-#### code, used to filter + prefill
  oppDate?: string;
  onClose: () => void;
};

export default function RemindersForLeadModal({ open, oppId, oppDate, onClose }: Props) {
  const toast = useToast();
  const [rows, setRows]       = useState<Reminder[]>([]);
  const [loading, setLoading] = useState(false);
  const [draftOpen, setDraftOpen] = useState(false);

  const [subject, setSubject]   = useState('');
  const [setDate, setSetDate]   = useState('');
  const [tat, setTat]           = useState('24 Hours');
  const [remark, setRemark]     = useState('');
  const [saving, setSaving]     = useState(false);

  const todayStr = new Date().toISOString().slice(0, 10);

  const refresh = () => {
    if (!oppId) return;
    setLoading(true);
    api.get<Reminder[]>('/sales/reminders', { params: { scope: 'mine', search: oppId } })
      .then(({ data }) => {
        // Server-side filter is `ilike` so we narrow to exact opp_id matches
        // here — avoids stray subject-matches polluting the list.
        setRows((data ?? []).filter(r => r.opp_id === oppId));
      })
      .catch(() => toast.error('Load failed', 'Could not load reminders'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (!open) { setDraftOpen(false); setSubject(''); setRemark(''); setSetDate(''); return; }
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, oppId]);

  if (!open) return null;

  const saveDraft = async () => {
    if (!subject.trim()) { toast.warning('Subject required', 'Type a subject'); return; }
    if (!setDate) { toast.warning('Date required', 'Pick the reminder date'); return; }
    setSaving(true);
    try {
      // `oppDate` arrives from the parent as the human display string
      // (DD/MM/YYYY) so Laravel's `date` rule rejects it. Convert to
      // ISO (YYYY-MM-DD) before sending; omit the field if it doesn't
      // parse cleanly — the column is nullable, no need to gamble.
      const isoOppDate = toIsoDate(oppDate);
      const payload: Record<string, unknown> = {
        opp_id:   oppId,
        subject:  subject.trim(),
        set_date: setDate,
        tat,
      };
      if (isoOppDate)            payload.opp_date = isoOppDate;
      if (remark.trim())         payload.remark   = remark.trim();

      await api.post('/sales/reminders', payload);
      toast.success('Reminder added', 'Saved to this opportunity');
      setSubject(''); setRemark(''); setSetDate(''); setDraftOpen(false);
      refresh();
    } catch (e: any) {
      // Surface the first server-side validation error if any so the
      // user sees the real complaint ("subject must be 3+ chars" etc).
      const errors = e?.response?.data?.errors as Record<string, string[]> | undefined;
      const firstErr = errors ? Object.values(errors)[0]?.[0] : undefined;
      toast.error('Save failed', firstErr ?? e?.response?.data?.message ?? 'Could not save reminder');
    } finally {
      setSaving(false);
    }
  };

  const setStatus = async (r: Reminder, next: ReminderStatus) => {
    try {
      await api.patch(`/sales/reminders/${r.id}/status`, { status: next });
      setRows(prev => prev.map(x => x.id === r.id ? { ...x, status: next } : x));
      toast.success('Status updated', `Reminder marked ${next}`);
    } catch (e: any) {
      toast.error('Update failed', e?.response?.data?.message ?? 'Could not change status');
    }
  };

  return createPortal((
    /* Backdrop is purely visual — closing only via the X / Cancel button
     * so accidental outside-clicks don't wipe an in-progress entry. */
    <div className="rfl-backdrop">
      <style>{CSS}</style>
      <div className="rfl-modal">
        <div className="rfl-head">
          <div className="rfl-head-left">
            <div className="rfl-head-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
            </div>
            <div>
              <div className="rfl-head-title">Reminders</div>
              <div className="rfl-head-sub">Opp ID: {oppId ?? '—'} · {rows.length} {rows.length === 1 ? 'reminder' : 'reminders'}</div>
            </div>
          </div>
          <div className="rfl-head-actions">
            <button className="rfl-add-btn" onClick={() => setDraftOpen(o => !o)}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              New
            </button>
            <button className="rfl-close" onClick={onClose} aria-label="Close">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        <div className="rfl-body">
          {draftOpen && (
            <div className="rfl-draft">
              <div className="rfl-draft-grid">
                <div className="rfl-fld">
                  <label>SUBJECT *</label>
                  <input className="rfl-input" value={subject} onChange={e => setSubject(e.target.value)} placeholder="e.g. Follow up on quotation" />
                </div>
                <div className="rfl-fld">
                  <label>DATE *</label>
                  <MasterDatePicker value={setDate} onChange={setSetDate} minDate={todayStr} placeholder="dd-mm-yyyy" />
                </div>
                <div className="rfl-fld">
                  <label>TAT</label>
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
              </div>
              <div className="rfl-fld">
                <label>REMARK</label>
                <textarea className="rfl-input" rows={2} value={remark} onChange={e => setRemark(e.target.value)} placeholder="Optional context…" />
              </div>
              <div className="rfl-draft-foot">
                <button className="rfl-btn" onClick={() => setDraftOpen(false)} disabled={saving}>Cancel</button>
                <button className="rfl-btn rfl-btn-primary" onClick={() => void saveDraft()} disabled={saving}>
                  {saving ? 'Saving…' : 'Save Reminder'}
                </button>
              </div>
            </div>
          )}

          <div className="rfl-list">
            {loading && <div className="rfl-status">Loading reminders…</div>}
            {!loading && rows.length === 0 && !draftOpen && (
              <div className="rfl-status">No reminders for this opportunity yet — click <strong>+ New</strong>.</div>
            )}
            {rows.map(r => (
              <div key={r.id} className={`rfl-row rfl-row-${r.status.toLowerCase().replace(/\s+/g, '-')}`}>
                <div className="rfl-row-main">
                  <div className="rfl-row-title">{r.subject}</div>
                  <div className="rfl-row-meta">
                    <span>📅 {new Date(r.set_date).toLocaleDateString('en-GB')}</span>
                    {r.tat && <span>· {r.tat}</span>}
                    {r.remark && <span className="rfl-row-remark"> · {r.remark}</span>}
                  </div>
                </div>
                <div className="rfl-row-actions">
                  <span className={`rfl-pill ${STATUS_META[r.status]?.pill ?? 'rfl-pill-prog'}`}>
                    {STATUS_META[r.status]?.label ?? r.status}
                  </span>
                  {r.status !== 'Done' && (
                    <button className="rfl-row-btn" onClick={() => void setStatus(r, 'Done')}>Mark Done</button>
                  )}
                  {r.status === 'Done' && (
                    <button className="rfl-row-btn" onClick={() => void setStatus(r, 'In Progress')}>Reopen</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  ), document.body);
}

const CSS = `
.rfl-backdrop {
  position: fixed; inset: 0; z-index: 1080;
  background: rgba(15,23,42,.55); backdrop-filter: blur(3px);
  display: flex; align-items: center; justify-content: center;
  padding: 16px;
}
.rfl-modal {
  width: min(620px, 100%); max-height: 88vh;
  background: #fff; border-radius: 14px;
  box-shadow: 0 18px 48px rgba(15,23,42,.28);
  overflow: hidden; display: flex; flex-direction: column;
}
.rfl-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 18px; color: #fff;
  background: linear-gradient(135deg, #f59e0b 0%, #ea580c 100%);
}
.rfl-head-left { display: flex; align-items: center; gap: 12px; min-width: 0; }
.rfl-head-icon {
  width: 36px; height: 36px; border-radius: 10px;
  background: rgba(255,255,255,.18); display: flex; align-items: center; justify-content: center;
}
.rfl-head-title { font-size: 15px; font-weight: 700; }
.rfl-head-sub   { font-size: 11px; opacity: .85; margin-top: 3px; }
.rfl-head-actions { display: flex; gap: 8px; align-items: center; }
.rfl-add-btn {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 7px 13px; border-radius: 8px; border: none;
  background: rgba(255,255,255,.18); color: #fff; font-size: 11.5px; font-weight: 700; cursor: pointer;
}
.rfl-add-btn:hover { background: rgba(255,255,255,.30); }
.rfl-close {
  width: 28px; height: 28px; border: none; cursor: pointer;
  background: rgba(255,255,255,.18); color: #fff; border-radius: 8px;
  display: flex; align-items: center; justify-content: center;
}
.rfl-close:hover { background: rgba(255,255,255,.32); }

.rfl-body { flex: 1; overflow-y: auto; padding: 14px 18px; background: #fffbeb; }

.rfl-draft { background: #fff; border: 1.5px solid #fde68a; border-radius: 10px; padding: 12px; margin-bottom: 12px; }
.rfl-draft-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; margin-bottom: 10px; }
.rfl-fld { display: flex; flex-direction: column; gap: 4px; margin-bottom: 8px; }
.rfl-fld label { font-size: 9.5px; font-weight: 800; letter-spacing: .06em; color: #b45309; }
.rfl-input {
  width: 100%; min-height: 34px; padding: 6px 10px;
  border: 1.5px solid #fde68a; border-radius: 8px;
  font-size: 12.5px; background: #fff; outline: none; font-family: inherit;
}
.rfl-input:focus { border-color: #f59e0b; box-shadow: 0 0 0 3px rgba(245,158,11,.18); }
.rfl-draft-foot { display: flex; justify-content: flex-end; gap: 8px; }
.rfl-btn { padding: 7px 14px; border-radius: 8px; border: 1.5px solid #fde68a; background: #fff; color: #b45309; font-size: 11.5px; font-weight: 700; cursor: pointer; }
.rfl-btn-primary { border-color: transparent; background: linear-gradient(135deg,#f59e0b,#ea580c); color: #fff; }
.rfl-btn-primary:hover { filter: brightness(1.08); }
.rfl-btn:disabled { opacity: .55; cursor: not-allowed; }

.rfl-status { text-align: center; padding: 26px 12px; color: #a16207; font-style: italic; font-size: 12px; }
.rfl-list { display: flex; flex-direction: column; gap: 8px; }
.rfl-row {
  display: flex; align-items: center; gap: 12px;
  background: #fff; border: 1.5px solid #fde68a; border-radius: 10px;
  padding: 10px 12px;
}
.rfl-row-main { flex: 1; min-width: 0; }
.rfl-row-title { font-size: 13px; font-weight: 700; color: #1f2937; }
.rfl-row-meta { font-size: 11px; color: #78716c; margin-top: 3px; display: flex; gap: 6px; flex-wrap: wrap; }
.rfl-row-remark { color: #57534e; }
.rfl-row-actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.rfl-pill { font-size: 10px; font-weight: 700; padding: 2px 10px; border-radius: 999px; }
.rfl-pill-prog { background: #fef3c7; color: #b45309; }
.rfl-pill-done { background: #dcfce7; color: #166534; }
.rfl-pill-cncl { background: #fee2e2; color: #b91c1c; }
.rfl-row-btn { padding: 5px 10px; border: 1.5px solid #fde68a; background: #fff; color: #b45309; border-radius: 7px; font-size: 11px; font-weight: 600; cursor: pointer; }
.rfl-row-btn:hover { background: #fef3c7; }

/* Dark mode */
[data-bs-theme="dark"] .rfl-modal { background: #1c1410; }
[data-bs-theme="dark"] .rfl-body  { background: #28190e; }
[data-bs-theme="dark"] .rfl-draft, [data-bs-theme="dark"] .rfl-row { background: #1f1611; border-color: #422006; }
[data-bs-theme="dark"] .rfl-fld label { color: #fcd34d; }
[data-bs-theme="dark"] .rfl-input { background: #28190e; border-color: #422006; color: #fef3c7; }
[data-bs-theme="dark"] .rfl-row-title { color: #fef3c7; }
[data-bs-theme="dark"] .rfl-row-meta  { color: #fcd34d; }
[data-bs-theme="dark"] .rfl-btn { background: #28190e; border-color: #422006; color: #fcd34d; }

@media (max-width: 520px) {
  .rfl-draft-grid { grid-template-columns: 1fr; }
  .rfl-row { flex-direction: column; align-items: stretch; }
  .rfl-row-actions { justify-content: space-between; }
}
`;
