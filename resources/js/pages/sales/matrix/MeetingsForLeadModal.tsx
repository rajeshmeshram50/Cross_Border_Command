import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import api from '../../../api';
import { useToast } from '../../../contexts/ToastContext';

/* ─────────────────────────────────────────────────────────────────────────
 * Meetings for this lead — toolbar pill drawer.
 *
 * Mirrors the Reminders flow: lists meetings filtered by opp_id and lets
 * the user spin a new one up via an inline + New form at the top, then
 * appends it to the table on save. No redirects out to /sales/todo —
 * the full Sales To-Do page is still there for the multi-lead inbox view.
 *
 * The inline form captures the bare-minimum legacy required fields:
 * type (virtual/physical), customer, contact, platform, date, time
 * window, link (virtual) / venue (physical), agenda. The customer +
 * contact are pre-filled when the parent passes the lead's mapped
 * customer down via props.
 *
 * Status toggles fire the existing PATCH /status endpoint with the
 * server's exact constants ("In Progress" / "Done" / "Postponed" /
 * "Cancelled") — earlier builds shipped lowercase values which 422'd.
 * ───────────────────────────────────────────────────────────────────────── */

type MeetingStatus = 'In Progress' | 'Done' | 'Postponed' | 'Cancelled';
type MeetingType   = 'virtual' | 'physical';

type Meeting = {
  id:         number;
  meeting_code: string | null;
  type:       MeetingType;
  opp_id:     string | null;
  customer:   string;
  email:      string | null;
  contact:    string | null;
  platform:   string | null;
  date:       string;
  start_time: string;
  end_time:   string;
  link:       string | null;
  venue:      string | null;
  agenda:     string;
  status:     MeetingStatus;
};

const STATUS_META: Record<MeetingStatus, { label: string; pill: string }> = {
  'In Progress': { label: 'In Progress', pill: 'mfl-pill-sch'  },
  'Done':        { label: 'Done',        pill: 'mfl-pill-done' },
  'Postponed':   { label: 'Postponed',   pill: 'mfl-pill-sch'  },
  'Cancelled':   { label: 'Cancelled',   pill: 'mfl-pill-cncl' },
};

const VIRTUAL_PLATFORMS  = ['Zoom', 'Google Meet', 'Microsoft Teams', 'WhatsApp Video', 'Skype', 'Other'];
const PHYSICAL_PLATFORMS = ['On-site', 'Customer Office', 'Our Office', 'Hotel / Conference', 'Trade Fair', 'Other'];

type Props = {
  open:   boolean;
  oppId:  string | undefined;
  /** Pre-fill the meeting's `customer` + `contact` from the lead so the
   *  user doesn't have to retype them. Both optional — when missing the
   *  fields stay empty and editable. */
  defaultCustomer?: string;
  defaultContact?:  string;
  defaultEmail?:    string;
  onClose: () => void;
};

const digitsOnly = (s: string) => s.replace(/[^\d+\s-]/g, '').slice(0, 20);
const isValidEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());

export default function MeetingsForLeadModal({
  open, oppId, defaultCustomer, defaultContact, defaultEmail, onClose,
}: Props) {
  const toast = useToast();
  const [rows, setRows]       = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(false);
  const [draftOpen, setDraftOpen] = useState(false);
  const [saving, setSaving]   = useState(false);

  /* ── Inline + New form state ────────────────────────────────── */
  const [type, setType]             = useState<MeetingType>('virtual');
  const [customer, setCustomer]     = useState(defaultCustomer ?? '');
  const [email, setEmail]           = useState(defaultEmail ?? '');
  const [contact, setContact]       = useState(defaultContact ?? '');
  const [platform, setPlatform]     = useState(VIRTUAL_PLATFORMS[0]);
  const [date, setDate]             = useState('');
  const [startTime, setStartTime]   = useState('10:00');
  const [endTime, setEndTime]       = useState('11:00');
  const [link, setLink]             = useState('');
  const [venue, setVenue]           = useState('');
  const [agenda, setAgenda]         = useState('');

  const refresh = () => {
    if (!oppId) return;
    setLoading(true);
    api.get<Meeting[]>('/sales/meetings', { params: { scope: 'mine', search: oppId } })
      .then(({ data }) => setRows((data ?? []).filter(m => m.opp_id === oppId)))
      .catch(() => toast.error('Load failed', 'Could not load meetings'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (open) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, oppId]);

  /* Reset draft form whenever modal opens or the lead context
   * (customer / contact) changes. */
  useEffect(() => {
    if (!open) { setDraftOpen(false); return; }
    setType('virtual');
    setCustomer(defaultCustomer ?? '');
    setEmail(defaultEmail ?? '');
    setContact(defaultContact ?? '');
    setPlatform(VIRTUAL_PLATFORMS[0]);
    setDate('');
    setStartTime('10:00');
    setEndTime('11:00');
    setLink(''); setVenue(''); setAgenda('');
  }, [open, defaultCustomer, defaultContact, defaultEmail]);

  /* Swap platform list when type flips. */
  useEffect(() => {
    setPlatform(type === 'virtual' ? VIRTUAL_PLATFORMS[0] : PHYSICAL_PLATFORMS[0]);
  }, [type]);

  if (!open) return null;

  const setStatus = async (m: Meeting, next: MeetingStatus) => {
    try {
      await api.patch(`/sales/meetings/${m.id}/status`, { status: next });
      setRows(prev => prev.map(x => x.id === m.id ? { ...x, status: next } : x));
      toast.success('Status updated', `Meeting marked ${next}`);
    } catch (e: any) {
      toast.error('Update failed', e?.response?.data?.message ?? 'Could not change status');
    }
  };

  const saveDraft = async () => {
    if (!customer.trim()) { toast.warning('Customer required',  'Type the customer name'); return; }
    if (!contact.trim())  { toast.warning('Contact required',   'Type the contact number'); return; }
    if (!date)            { toast.warning('Date required',      'Pick the meeting date'); return; }
    if (!startTime || !endTime) { toast.warning('Time required', 'Set both start and end time'); return; }
    if (endTime <= startTime)   { toast.warning('Bad time window', 'End time must be after start time'); return; }
    if (!agenda.trim())   { toast.warning('Agenda required',    'Describe what the meeting is about'); return; }
    if (type === 'virtual'  && !link.trim())  { toast.warning('Link required',  'Paste the meeting link for a virtual meeting'); return; }
    if (type === 'physical' && !venue.trim()) { toast.warning('Venue required', 'Enter the venue for an in-person meeting'); return; }
    if (email.trim() && !isValidEmail(email)) { toast.warning('Invalid email', 'Enter a valid email or leave blank'); return; }

    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        type, opp_id: oppId,
        customer:   customer.trim(),
        contact:    contact.trim(),
        platform:   platform.trim(),
        date,
        start_time: startTime,
        end_time:   endTime,
        agenda:     agenda.trim(),
      };
      if (email.trim())           payload.email = email.trim();
      if (type === 'virtual')     payload.link  = link.trim();
      if (type === 'physical')    payload.venue = venue.trim();

      await api.post('/sales/meetings', payload);
      toast.success('Meeting scheduled', 'Saved to this opportunity');
      setDraftOpen(false);
      refresh();
    } catch (e: any) {
      const errors = e?.response?.data?.errors as Record<string, string[]> | undefined;
      const firstErr = errors ? Object.values(errors)[0]?.[0] : undefined;
      toast.error('Save failed', firstErr ?? e?.response?.data?.message ?? 'Could not save meeting');
    } finally {
      setSaving(false);
    }
  };

  return createPortal((
    <div className="mfl-backdrop" onClick={onClose}>
      <style>{CSS}</style>
      <div className="mfl-modal" onClick={(e) => e.stopPropagation()}>
        <div className="mfl-head">
          <div className="mfl-head-left">
            <div className="mfl-head-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <rect x="3" y="4" width="18" height="18" rx="2" />
                <line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
              </svg>
            </div>
            <div>
              <div className="mfl-head-title">Meetings</div>
              <div className="mfl-head-sub">Opp ID: {oppId ?? '—'} · {rows.length} {rows.length === 1 ? 'meeting' : 'meetings'}</div>
            </div>
          </div>
          <div className="mfl-head-actions">
            <button className="mfl-add-btn" onClick={() => setDraftOpen(o => !o)}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              {draftOpen ? 'Close form' : 'New'}
            </button>
            <button className="mfl-close" onClick={onClose} aria-label="Close">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        <div className="mfl-body">
          {/* Inline + New form */}
          {draftOpen && (
            <div className="mfl-draft">
              <div className="mfl-draft-row mfl-row-3">
                <div className="mfl-fld">
                  <label>TYPE *</label>
                  <select className="mfl-input" value={type} onChange={e => setType(e.target.value as MeetingType)}>
                    <option value="virtual">🔗 Virtual</option>
                    <option value="physical">📍 Physical</option>
                  </select>
                </div>
                <div className="mfl-fld mfl-fld-span-2">
                  <label>CUSTOMER *</label>
                  <input className="mfl-input" value={customer} onChange={e => setCustomer(e.target.value)} placeholder="Customer name" />
                </div>
              </div>

              <div className="mfl-draft-row mfl-row-2">
                <div className="mfl-fld">
                  <label>CONTACT *</label>
                  <input className="mfl-input" value={contact} onChange={e => setContact(digitsOnly(e.target.value))} placeholder="+91 98xxxxxxxx" />
                </div>
                <div className="mfl-fld">
                  <label>EMAIL</label>
                  <input type="email" className="mfl-input" value={email} onChange={e => setEmail(e.target.value)} placeholder="optional" />
                </div>
              </div>

              <div className="mfl-draft-row mfl-row-3">
                <div className="mfl-fld">
                  <label>DATE *</label>
                  <input type="date" className="mfl-input" value={date} onChange={e => setDate(e.target.value)} />
                </div>
                <div className="mfl-fld">
                  <label>START *</label>
                  <input type="time" className="mfl-input" value={startTime} onChange={e => setStartTime(e.target.value)} />
                </div>
                <div className="mfl-fld">
                  <label>END *</label>
                  <input type="time" className="mfl-input" value={endTime} onChange={e => setEndTime(e.target.value)} />
                </div>
              </div>

              <div className="mfl-draft-row mfl-row-2">
                <div className="mfl-fld">
                  <label>PLATFORM *</label>
                  <select className="mfl-input" value={platform} onChange={e => setPlatform(e.target.value)}>
                    {(type === 'virtual' ? VIRTUAL_PLATFORMS : PHYSICAL_PLATFORMS).map(p => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                </div>
                <div className="mfl-fld">
                  {type === 'virtual'
                    ? <>
                        <label>MEETING LINK *</label>
                        <input className="mfl-input" value={link} onChange={e => setLink(e.target.value)} placeholder="https://meet.google.com/…" />
                      </>
                    : <>
                        <label>VENUE *</label>
                        <input className="mfl-input" value={venue} onChange={e => setVenue(e.target.value)} placeholder="Office address / hotel etc." />
                      </>}
                </div>
              </div>

              <div className="mfl-fld">
                <label>AGENDA *</label>
                <textarea className="mfl-input" rows={2} value={agenda} onChange={e => setAgenda(e.target.value)} placeholder="What's the meeting about?" />
              </div>

              <div className="mfl-draft-foot">
                <button className="mfl-btn" onClick={() => setDraftOpen(false)} disabled={saving}>Cancel</button>
                <button className="mfl-btn mfl-btn-primary" onClick={() => void saveDraft()} disabled={saving}>
                  {saving ? 'Saving…' : 'Save Meeting'}
                </button>
              </div>
            </div>
          )}

          {/* List */}
          {loading && <div className="mfl-status">Loading meetings…</div>}
          {!loading && rows.length === 0 && !draftOpen && (
            <div className="mfl-status">
              No meetings for this opportunity yet — click <strong>+ New</strong> to schedule one.
            </div>
          )}
          {rows.map(m => (
            <div key={m.id} className={`mfl-row mfl-row-${m.status.toLowerCase().replace(/\s+/g, '-')}`}>
              <div className="mfl-row-main">
                <div className="mfl-row-head">
                  <span className="mfl-row-code">{m.meeting_code ?? `MTG-${m.id}`}</span>
                  <span className={`mfl-type mfl-type-${m.type}`}>{m.type === 'virtual' ? '🔗 Virtual' : '📍 Physical'}</span>
                  <span className={`mfl-pill ${STATUS_META[m.status]?.pill ?? 'mfl-pill-sch'}`}>
                    {STATUS_META[m.status]?.label ?? m.status}
                  </span>
                </div>
                <div className="mfl-row-title">{m.customer}</div>
                <div className="mfl-row-meta">
                  <span>📅 {new Date(m.date).toLocaleDateString('en-GB')}</span>
                  <span>· {m.start_time}–{m.end_time}</span>
                  {m.platform && <span>· {m.platform}</span>}
                  {m.type === 'physical' && m.venue && <span>· {m.venue}</span>}
                  {m.type === 'virtual'  && m.link  && (
                    <a className="mfl-row-link" href={m.link} target="_blank" rel="noreferrer">Join</a>
                  )}
                </div>
                <div className="mfl-row-agenda">{m.agenda}</div>
              </div>
              <div className="mfl-row-actions">
                {(m.status === 'In Progress' || m.status === 'Postponed') && (
                  <>
                    <button className="mfl-row-btn" onClick={() => void setStatus(m, 'Done')}>Done</button>
                    <button className="mfl-row-btn mfl-row-btn-x" onClick={() => void setStatus(m, 'Cancelled')}>Cancel</button>
                  </>
                )}
                {(m.status === 'Done' || m.status === 'Cancelled') && (
                  <button className="mfl-row-btn" onClick={() => void setStatus(m, 'In Progress')}>Reopen</button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  ), document.body);
}

const CSS = `
.mfl-backdrop {
  position: fixed; inset: 0; z-index: 1080;
  background: rgba(15,23,42,.55); backdrop-filter: blur(3px);
  display: flex; align-items: center; justify-content: center;
  padding: 16px;
}
.mfl-modal {
  width: min(720px, 100%); max-height: 90vh;
  background: #fff; border-radius: 14px;
  box-shadow: 0 18px 48px rgba(15,23,42,.28);
  overflow: hidden; display: flex; flex-direction: column;
}
.mfl-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 18px; color: #fff;
  background: linear-gradient(135deg, #0ea5e9 0%, #1e40af 100%);
}
.mfl-head-left { display: flex; align-items: center; gap: 12px; }
.mfl-head-icon {
  width: 36px; height: 36px; border-radius: 10px;
  background: rgba(255,255,255,.18); display: flex; align-items: center; justify-content: center;
}
.mfl-head-title { font-size: 15px; font-weight: 700; }
.mfl-head-sub   { font-size: 11px; opacity: .85; margin-top: 3px; }
.mfl-head-actions { display: flex; gap: 8px; align-items: center; }
.mfl-add-btn {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 7px 13px; border-radius: 8px; border: none;
  background: rgba(255,255,255,.18); color: #fff; font-size: 11.5px; font-weight: 700; cursor: pointer;
}
.mfl-add-btn:hover { background: rgba(255,255,255,.30); }
.mfl-close {
  width: 28px; height: 28px; border: none; cursor: pointer;
  background: rgba(255,255,255,.18); color: #fff; border-radius: 8px;
  display: flex; align-items: center; justify-content: center;
}
.mfl-close:hover { background: rgba(255,255,255,.32); }

.mfl-body { flex: 1; overflow-y: auto; padding: 14px 18px; background: #f0f9ff; display: flex; flex-direction: column; gap: 8px; }
.mfl-status { text-align: center; padding: 26px 12px; color: #0c4a6e; font-style: italic; font-size: 12px; }

/* Inline draft form */
.mfl-draft {
  background: #fff; border: 1.5px solid #bae6fd; border-radius: 10px;
  padding: 12px; margin-bottom: 12px;
}
.mfl-draft-row { display: grid; gap: 10px; margin-bottom: 8px; }
.mfl-row-2 { grid-template-columns: 1fr 1fr; }
.mfl-row-3 { grid-template-columns: 1fr 1fr 1fr; }
.mfl-fld { display: flex; flex-direction: column; gap: 4px; margin-bottom: 8px; min-width: 0; }
.mfl-fld-span-2 { grid-column: span 2; }
.mfl-fld label { font-size: 9.5px; font-weight: 800; letter-spacing: .06em; color: #1e40af; }
.mfl-input {
  width: 100%; min-height: 34px; padding: 6px 10px;
  border: 1.5px solid #bae6fd; border-radius: 8px;
  font-size: 12.5px; background: #fff; outline: none; font-family: inherit;
  color: #0f172a;
}
.mfl-input:focus { border-color: #1e40af; box-shadow: 0 0 0 3px rgba(30,64,175,.16); }
.mfl-draft-foot { display: flex; justify-content: flex-end; gap: 8px; margin-top: 4px; }
.mfl-btn { padding: 7px 14px; border-radius: 8px; border: 1.5px solid #bae6fd; background: #fff; color: #0c4a6e; font-size: 11.5px; font-weight: 700; cursor: pointer; }
.mfl-btn-primary { border-color: transparent; background: linear-gradient(135deg,#0ea5e9,#1e40af); color: #fff; }
.mfl-btn-primary:hover { filter: brightness(1.08); }
.mfl-btn:disabled { opacity: .55; cursor: not-allowed; }

/* Existing meeting cards */
.mfl-row {
  display: flex; gap: 12px; align-items: flex-start;
  background: #fff; border: 1.5px solid #bae6fd; border-radius: 10px;
  padding: 11px 14px;
}
.mfl-row-main  { flex: 1; min-width: 0; }
.mfl-row-head  { display: flex; align-items: center; gap: 8px; margin-bottom: 5px; flex-wrap: wrap; }
.mfl-row-code  {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10.5px; color: #0c4a6e; font-weight: 700;
  background: #e0f2fe; padding: 1px 8px; border-radius: 5px;
}
.mfl-type {
  font-size: 10.5px; padding: 2px 9px; border-radius: 999px;
  font-weight: 700;
}
.mfl-type-virtual  { background: #e0e7ff; color: #4338ca; }
.mfl-type-physical { background: #dcfce7; color: #166534; }
.mfl-pill { font-size: 10px; padding: 2px 9px; border-radius: 999px; font-weight: 700; }
.mfl-pill-sch  { background: #fef3c7; color: #b45309; }
.mfl-pill-done { background: #dcfce7; color: #166534; }
.mfl-pill-cncl { background: #fee2e2; color: #b91c1c; }
.mfl-row-title { font-size: 13px; font-weight: 700; color: #0f172a; }
.mfl-row-meta {
  display: flex; flex-wrap: wrap; gap: 6px;
  font-size: 11px; color: #475569; margin-top: 3px;
}
.mfl-row-link { color: #1e40af; font-weight: 600; text-decoration: none; }
.mfl-row-link:hover { text-decoration: underline; }
.mfl-row-agenda { font-size: 11.5px; color: #334155; margin-top: 5px; line-height: 1.45; }
.mfl-row-actions { display: flex; flex-direction: column; gap: 6px; flex-shrink: 0; }
.mfl-row-btn { padding: 5px 12px; border: 1.5px solid #bae6fd; background: #fff; color: #0c4a6e; border-radius: 7px; font-size: 11px; font-weight: 600; cursor: pointer; }
.mfl-row-btn:hover { background: #e0f2fe; }
.mfl-row-btn-x { color: #b91c1c; border-color: #fecaca; }
.mfl-row-btn-x:hover { background: #fee2e2; }

/* Dark mode */
[data-bs-theme="dark"] .mfl-modal { background: #0f172a; }
[data-bs-theme="dark"] .mfl-body  { background: #0b1226; }
[data-bs-theme="dark"] .mfl-draft, [data-bs-theme="dark"] .mfl-row { background: #1e293b; border-color: #334155; }
[data-bs-theme="dark"] .mfl-fld label { color: #93c5fd; }
[data-bs-theme="dark"] .mfl-input { background: #0f172a; border-color: #334155; color: #e2e8f0; }
[data-bs-theme="dark"] .mfl-row-title { color: #f1f5f9; }
[data-bs-theme="dark"] .mfl-row-meta  { color: #cbd5e1; }
[data-bs-theme="dark"] .mfl-row-agenda { color: #94a3b8; }
[data-bs-theme="dark"] .mfl-btn, [data-bs-theme="dark"] .mfl-row-btn {
  background: #0f172a; border-color: #334155; color: #67e8f9;
}

@media (max-width: 640px) {
  .mfl-row-2, .mfl-row-3 { grid-template-columns: 1fr; }
  .mfl-fld-span-2 { grid-column: span 1; }
  .mfl-row { flex-direction: column; }
  .mfl-row-actions { flex-direction: row; justify-content: flex-end; width: 100%; }
}
`;
