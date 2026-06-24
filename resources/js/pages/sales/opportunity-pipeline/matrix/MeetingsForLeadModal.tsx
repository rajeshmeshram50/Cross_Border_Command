import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import api from '../../../../api';
import { useToast } from '../../../../contexts/ToastContext';
import { MasterSelect } from '../../../../components/ui/MasterSelect';
import { MasterDatePicker } from '../../../../components/ui/MasterDatePicker';
import { MasterTimePicker } from '../../../../components/ui/MasterTimePicker';

/* ─────────────────────────────────────────────────────────────────────────
 * Add Meeting — focused dialog opened from the matrix toolbar.
 *
 * Mirrors the Productivity Tracker (SalesTodo) Add Meeting form so the
 * UX is consistent across both pages. Auto-fetches Opportunity ID +
 * Date from the current lead (read-only chips at top), then captures
 * the meeting details and posts to /sales/meetings.
 * ───────────────────────────────────────────────────────────────────────── */

type MeetingType   = 'virtual' | 'physical';
type MeetingStatus = 'In Progress' | 'Done' | 'Postponed' | 'Cancelled';

const VIRTUAL_PLATFORMS  = ['Zoom', 'Google Meet', 'Microsoft Teams', 'Webex', 'Phone Call'];
const PHYSICAL_PLATFORMS = ['Office Visit', 'Client Site', 'Trade Fair', 'Conference', 'Factory Visit', 'Port Visit'];

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
  defaultCustomer?: string;
  defaultContact?:  string;
  defaultEmail?:    string;
  onClose: () => void;
};

export default function MeetingsForLeadModal({
  open, oppId, oppDate, defaultCustomer, defaultContact, defaultEmail, onClose,
}: Props) {
  const toast = useToast();

  const [type, setType]           = useState<MeetingType>('virtual');
  const [customer, setCustomer]   = useState('');
  const [email, setEmail]         = useState('');
  const [contact, setContact]     = useState('');
  const [platform, setPlatform]   = useState('');
  const [link, setLink]           = useState('');
  const [venue, setVenue]         = useState('');
  const [date, setDate]           = useState('');
  // Meetings can only be scheduled for today or a future date — block past days.
  const today = new Date().toISOString().slice(0, 10);
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime]     = useState('');
  const [agenda, setAgenda]       = useState('');
  const [status, setStatus]       = useState<MeetingStatus>('In Progress');
  const [saving, setSaving]       = useState(false);
  const [formError, setFormError] = useState('');
  /* Per-field inline errors — every empty/invalid required field is flagged
   * together (red border + message under the box) instead of one toast/banner
   * at a time, so the user sees ALL the missing fields in one go. */
  const [errors, setErrors]       = useState<Record<string, string>>({});
  const clearErr = (k: string) => setErrors(p => (p[k] ? { ...p, [k]: '' } : p));

  /* Reset every time the modal opens. */
  useEffect(() => {
    if (!open) return;
    setType('virtual');
    setCustomer(defaultCustomer ?? '');
    setEmail(defaultEmail ?? '');
    setContact(defaultContact ?? '');
    setPlatform('');
    setLink('');
    setVenue('');
    setDate('');
    setStartTime('');
    setEndTime('');
    setAgenda('');
    setStatus('In Progress');
    setFormError('');
    setErrors({});
  }, [open, defaultCustomer, defaultContact, defaultEmail]);

  if (!open) return null;

  const save = async () => {
    setFormError('');
    if (!oppId) { setFormError('No opportunity in context.'); return; }

    // Collect EVERY field problem in one pass so all bad/empty required
    // fields light up together instead of one-at-a-time.
    const e: Record<string, string> = {};

    const cust = customer.trim();
    if (!cust) e.customer = 'Person Name is required.';
    else if (!/[A-Za-z]/.test(cust)) e.customer = 'Person Name must contain letters.';
    else if (!/^[A-Za-z][A-Za-z0-9 .,'&()\-]{1,99}$/.test(cust)) e.customer = 'Invalid characters or length.';

    const contactRaw = contact.trim();
    if (!contactRaw) e.contact = 'Contact Number is required.';
    else {
      const digits = contactRaw.replace(/\D/g, '');
      if (digits.length < 10) e.contact = 'Must be at least 10 digits.';
      else if (digits.length > 15) e.contact = 'Cannot be more than 15 digits.';
      else if (!/^\+?[\d\s\-]+$/.test(contactRaw)) e.contact = 'Only digits, spaces, dashes and a leading +.';
    }

    if (!platform) e.platform = type === 'physical' ? 'Meeting Type is required.' : 'Platform is required.';

    const isVirtual = type === 'virtual';
    const linkRaw   = link.trim();
    const venueRaw  = venue.trim();
    if (isVirtual) {
      if (!linkRaw) e.link = 'Meeting Link is required.';
      else {
        try {
          const u = new URL(linkRaw);
          if (!/^https?:$/.test(u.protocol)) throw new Error();
        } catch { e.link = 'Must be a valid http(s) URL (e.g. https://meet.google.com/abc-def-ghi).'; }
      }
    } else {
      if (!venueRaw) e.venue = 'Place / Venue is required.';
      else if (!/[A-Za-z]/.test(venueRaw)) e.venue = 'Must contain letters, not just symbols or digits.';
      else if (venueRaw.length < 3 || venueRaw.length > 200) e.venue = 'Must be between 3 and 200 characters.';
    }

    if (!date)      e.date = 'Meeting Date is required.';
    // Backstop for the picker's minDate — a meeting can't be scheduled in the past.
    else if (date < today) e.date = 'Meeting date cannot be in the past.';
    if (!startTime) e.startTime = 'Start Time is required.';
    if (!endTime)   e.endTime = 'End Time is required.';

    const agendaRaw = agenda.trim();
    if (!agendaRaw) e.agenda = 'Meeting Agenda is required.';
    else if (agendaRaw.length < 2) e.agenda = 'Must be at least 2 characters.';
    else if (agendaRaw.length > 1000) e.agenda = 'Cannot exceed 1000 characters.';

    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) e.email = 'Email is invalid.';

    if (Object.keys(e).length) { setErrors(e); return; }
    setErrors({});

    setSaving(true);
    try {
      await api.post('/sales/meetings', {
        type,
        opp_id: oppId,
        customer: cust,
        email: email.trim() || undefined,
        contact: contactRaw,
        platform,
        date: toIsoDate(date),
        start_time: startTime,
        end_time: endTime,
        link: isVirtual ? linkRaw : undefined,
        venue: isVirtual ? undefined : venueRaw,
        agenda: agendaRaw,
        status,
      });
      toast.success('Meeting added', 'Saved to this opportunity');
      onClose();
    } catch (e: any) {
      const status = e?.response?.status;
      const errors = e?.response?.data?.errors as Record<string, string[]> | undefined;
      const firstErr = errors ? Object.values(errors)[0]?.[0] : undefined;
      if (status === 413) {
        setFormError('Attachment is too large.');
      } else {
        setFormError(firstErr ?? e?.response?.data?.message ?? 'Could not save meeting');
      }
    } finally {
      setSaving(false);
    }
  };

  return createPortal((
    <div className="mfl-backdrop">
      <style>{MFL_CSS}</style>
      <div className="mfl-modal" onClick={(e) => e.stopPropagation()}>
        <div className="mfl-head">
          <div className="mfl-head-left">
            <div className="mfl-head-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <polygon points="23 7 16 12 23 17 23 7" />
                <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
              </svg>
            </div>
            <div>
              <div className="mfl-head-row">
                <span className="mfl-head-title">Add Meeting</span>
                <span className="mfl-head-tag">MEETING</span>
              </div>
              <div className="mfl-head-sub">Meeting</div>
            </div>
          </div>
          <button className="mfl-close" onClick={onClose} aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="mfl-body">
          {/* Opportunity ID + date are auto-fetched from the lead in
              context, so the read-only display row is omitted here — the
              values are still submitted from props. */}

          {/* Virtual / Physical toggle */}
          <div className="mfl-toggle">
            <button
              type="button"
              className={`mfl-toggle-btn ${type === 'virtual' ? 'active' : ''}`}
              onClick={() => { setType('virtual'); setPlatform(''); }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="23 7 16 12 23 17 23 7" />
                <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
              </svg>
              Virtual Meeting
            </button>
            <button
              type="button"
              className={`mfl-toggle-btn ${type === 'physical' ? 'active' : ''}`}
              onClick={() => { setType('physical'); setPlatform(''); }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                <circle cx="12" cy="10" r="3" />
              </svg>
              Physical Meeting
            </button>
          </div>

          {/* Auto-fetched opp ID + date — sits below the meeting-type
              toggle. In the Sales Matrix lead stage these come from the
              lead in context (read-only). The Productivity Tracker form
              has its own selectable opportunity picker. */}
          <div className="mfl-grid">
            <div className="mfl-fld">
              <div className="mfl-lbl-row">
                <label className="mfl-lbl">OPPORTUNITY ID <span className="mfl-req">*</span></label>
                <span className="mfl-pill mfl-pill-fetched"><span className="mfl-pill-dot" /> AUTO-FETCHED</span>
              </div>
              <input className="mfl-input mfl-input-ro" value={oppId ?? ''} readOnly />
            </div>
            <div className="mfl-fld">
              <div className="mfl-lbl-row">
                <label className="mfl-lbl">OPPORTUNITY DATE <span className="mfl-req">*</span></label>
                <span className="mfl-pill mfl-pill-fetched"><span className="mfl-pill-dot" /> AUTO-FETCHED</span>
              </div>
              <input className="mfl-input mfl-input-ro" value={toDisplayDate(oppDate)} readOnly />
            </div>
          </div>

          <div className="mfl-grid">
            <div className="mfl-fld">
              <label className="mfl-lbl">PERSON NAME <span className="mfl-req">*</span></label>
              <input className={`mfl-input${errors.customer ? ' is-invalid' : ''}`} value={customer} onChange={e => { setCustomer(e.target.value); clearErr('customer'); }} placeholder="Person name" />
              {errors.customer && <div className="mfl-err">{errors.customer}</div>}
            </div>
            <div className="mfl-fld">
              <label className="mfl-lbl">PERSON EMAIL</label>
              <input className={`mfl-input${errors.email ? ' is-invalid' : ''}`} type="email" value={email} onChange={e => { setEmail(e.target.value); clearErr('email'); }} placeholder="Email address" />
              {errors.email && <div className="mfl-err">{errors.email}</div>}
            </div>

            <div className="mfl-fld">
              <label className="mfl-lbl">CONTACT NO <span className="mfl-req">*</span></label>
              <input
                className={`mfl-input${errors.contact ? ' is-invalid' : ''}`}
                type="tel"
                inputMode="tel"
                maxLength={20}
                value={contact}
                onChange={e => {
                  const cleaned = e.target.value
                    .replace(/[^\d\s+\-]/g, '')
                    .replace(/(?!^)\+/g, '');
                  setContact(cleaned);
                  clearErr('contact');
                }}
                placeholder="e.g. +91 98765 43210"
              />
              {errors.contact && <div className="mfl-err">{errors.contact}</div>}
            </div>
            <div className="mfl-fld">
              <label className="mfl-lbl">
                {type === 'physical' ? 'MEETING TYPE' : 'PLATFORM'} <span className="mfl-req">*</span>
              </label>
              <MasterSelect
                value={platform}
                onChange={(v) => { setPlatform(v); clearErr('platform'); }}
                options={(type === 'physical' ? PHYSICAL_PLATFORMS : VIRTUAL_PLATFORMS).map(p => ({ value: p, label: p }))}
                placeholder={type === 'physical' ? 'Select type' : 'Select platform'}
                invalid={!!errors.platform}
              />
              {errors.platform && <div className="mfl-err">{errors.platform}</div>}
            </div>
          </div>

          {/* Link OR Venue full-width */}
          <div className="mfl-fld mfl-fld-full">
            {type === 'virtual' ? (
              <>
                <label className="mfl-lbl">MEETING LINK <span className="mfl-req">*</span></label>
                <input className={`mfl-input${errors.link ? ' is-invalid' : ''}`} value={link} onChange={e => { setLink(e.target.value); clearErr('link'); }} placeholder="https://meet.google.com/abc-def-ghi" />
                {errors.link && <div className="mfl-err">{errors.link}</div>}
              </>
            ) : (
              <>
                <label className="mfl-lbl">PLACE / VENUE <span className="mfl-req">*</span></label>
                <input className={`mfl-input${errors.venue ? ' is-invalid' : ''}`} value={venue} onChange={e => { setVenue(e.target.value); clearErr('venue'); }} placeholder="e.g. Mumbai Head Office, BKC" />
                {errors.venue && <div className="mfl-err">{errors.venue}</div>}
              </>
            )}
          </div>

          {/* Date + start + end (3 cols) */}
          <div className="mfl-grid mfl-grid-3">
            <div className="mfl-fld">
              <label className="mfl-lbl">MEETING DATE <span className="mfl-req">*</span></label>
              <MasterDatePicker value={date} onChange={(v) => { setDate(v); clearErr('date'); }} minDate={today} placeholder="dd-mm-yyyy" invalid={!!errors.date} />
              {errors.date && <div className="mfl-err">{errors.date}</div>}
            </div>
            <div className="mfl-fld">
              <label className="mfl-lbl">START TIME <span className="mfl-req">*</span></label>
              <MasterTimePicker value={startTime} onChange={(v) => { setStartTime(v); clearErr('startTime'); }} placeholder="--:--" invalid={!!errors.startTime} />
              {errors.startTime && <div className="mfl-err">{errors.startTime}</div>}
            </div>
            <div className="mfl-fld">
              <label className="mfl-lbl">END TIME <span className="mfl-req">*</span></label>
              <MasterTimePicker value={endTime} onChange={(v) => { setEndTime(v); clearErr('endTime'); }} placeholder="--:--" invalid={!!errors.endTime} showNow={false} />
              {errors.endTime && <div className="mfl-err">{errors.endTime}</div>}
            </div>
          </div>

          {/* Agenda full-width */}
          <div className="mfl-fld mfl-fld-full">
            <label className="mfl-lbl">MEETING AGENDA <span className="mfl-req">*</span></label>
            <textarea
              className={`mfl-input mfl-textarea${errors.agenda ? ' is-invalid' : ''}`}
              rows={3}
              maxLength={1000}
              value={agenda}
              onChange={e => { setAgenda(e.target.value); clearErr('agenda'); }}
              placeholder="Meeting agenda..."
            />
            {errors.agenda && <div className="mfl-err">{errors.agenda}</div>}
          </div>

          {formError && <div className="mfl-form-error">{formError}</div>}
        </div>

        <div className="mfl-foot">
          <div className="mfl-foot-note">
            <span className="mfl-foot-dot" /> Fields marked <span className="mfl-req">*</span> are required
          </div>
          <div className="mfl-foot-actions">
            <button className="mfl-btn mfl-btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
            <button className="mfl-btn mfl-btn-primary" onClick={() => void save()} disabled={saving || !oppId}>
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

const MFL_CSS = `
.mfl-backdrop {
  position: fixed; inset: 0; z-index: 1080;
  background: rgba(15, 23, 42, .55);
  backdrop-filter: blur(3px);
  display: flex; align-items: center; justify-content: center;
  padding: 16px;
  animation: mfl-fade .15s ease-out;
}
@keyframes mfl-fade { from { opacity: 0; } to { opacity: 1; } }

.mfl-modal {
  width: min(820px, 100%); max-height: 92vh;
  background: linear-gradient(180deg, #ecfdf5 0%, #d1fae5 100%);
  border-radius: 14px;
  box-shadow: 0 18px 48px rgba(15, 23, 42, .28);
  overflow: hidden;
  display: flex; flex-direction: column;
  animation: mfl-pop .18s ease-out;
}
@keyframes mfl-pop {
  from { transform: scale(.96); opacity: 0; }
  to   { transform: scale(1);   opacity: 1; }
}

/* ─── Header (cyan gradient) ───
   Prototype spec: 135° sweep from deep cyan-blue through teal-blue to
   bright cyan. Distinct from the Reminder modal's emerald-teal family
   so the two side-by-side popups have a clear visual identity. */
.mfl-head {
  position: relative; overflow: hidden;
  display: flex; align-items: center; justify-content: space-between;
  gap: 12px;
  padding: 14px 22px;
  background: linear-gradient(135deg, #155E75 0%, #0E7490 55%, #0891B2 100%);
  color: #fff;
}
.mfl-head::before {
  content: ''; position: absolute; top: 0; left: 0; right: 0; height: 50%;
  background: linear-gradient(180deg, rgba(255, 255, 255, .18), transparent);
  pointer-events: none;
}
.mfl-head-left { position: relative; z-index: 1; display: flex; align-items: center; gap: 13px; }
.mfl-head-icon {
  width: 42px; height: 42px; border-radius: 11px;
  background: rgba(255, 255, 255, .22);
  border: 1px solid rgba(255, 255, 255, .30);
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 3px 10px rgba(0, 0, 0, .15);
  flex-shrink: 0;
}
.mfl-head-row { display: inline-flex; align-items: center; gap: 8px; }
.mfl-head-title { font-size: 17px; font-weight: 800; line-height: 1.2; letter-spacing: -.2px; }
.mfl-head-tag {
  font-size: 9px; font-weight: 800; letter-spacing: .12em;
  padding: 3px 9px; border-radius: 999px;
  background: rgba(255, 255, 255, .22);
  border: 1px solid rgba(255, 255, 255, .35);
  color: #fff;
  text-transform: uppercase;
}
.mfl-head-sub { font-size: 11.5px; color: rgba(255, 255, 255, .85); margin-top: 2px; font-weight: 500; }
.mfl-close {
  position: relative; z-index: 1;
  width: 30px; height: 30px; border: none; cursor: pointer;
  background: rgba(255, 255, 255, .20);
  color: #fff; border-radius: 9px;
  display: flex; align-items: center; justify-content: center;
  transition: background .15s;
}
.mfl-close:hover { background: rgba(255, 255, 255, .35); }

/* ─── Body ─── */
.mfl-body {
  padding: 18px 22px;
  background: #F0FDFA;
  flex: 1; overflow-y: auto;
}
.mfl-body::-webkit-scrollbar { width: 5px; }
.mfl-body::-webkit-scrollbar-thumb { background: rgba(14, 116, 144, .35); border-radius: 999px; }

.mfl-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px 18px;
  margin-bottom: 12px;
}
.mfl-grid-3 { grid-template-columns: 1fr 1fr 1fr; }

.mfl-fld {
  display: flex; flex-direction: column; gap: 6px;
  min-width: 0;
}
.mfl-fld-full { margin-bottom: 12px; }

.mfl-lbl-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.mfl-lbl {
  font-size: 11px; font-weight: 800; letter-spacing: .08em;
  color: #0F766E; text-transform: uppercase;
}
.mfl-req { color: #ef4444; }

/* AUTO-FETCHED chip */
.mfl-pill {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 2px 9px; border-radius: 999px;
  font-size: 8.5px; font-weight: 800; letter-spacing: .08em;
  text-transform: uppercase;
}
.mfl-pill-fetched {
  background: rgba(14, 116, 144, .12);
  border: 1px solid rgba(14, 116, 144, .40);
  color: #0F766E;
}
.mfl-pill-dot {
  width: 5px; height: 5px; border-radius: 50%;
  background: #0891B2;
  box-shadow: 0 0 6px rgba(14, 116, 144, .55);
  animation: mfl-pulse 1.4s ease-in-out infinite;
}
@keyframes mfl-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50%      { opacity: .5; transform: scale(.7); }
}

/* Virtual / Physical toggle */
.mfl-toggle {
  display: flex; gap: 8px;
  padding: 4px;
  /* Clean white shell with a neutral border (Figma) — inactive segment
     reads as white, active as solid teal. */
  background: #ffffff;
  border: 1.5px solid #e2e8f0;
  border-radius: 12px;
  margin-bottom: 14px;
}
.mfl-toggle-btn {
  flex: 1;
  display: inline-flex; align-items: center; justify-content: center; gap: 7px;
  padding: 9px 14px;
  border: none; border-radius: 9px;
  background: transparent;
  color: #64748b;
  font-family: inherit;
  font-size: 12.5px; font-weight: 700;
  cursor: pointer;
  transition: all .15s;
}
.mfl-toggle-btn:hover:not(.active) { background: #f1f5f9; }
.mfl-toggle-btn.active {
  /* Prototype spec — deep teal → cyan-blue. */
  background: linear-gradient(135deg, #0F766E, #0E7490);
  color: #fff;
  border-color: #0F766E;
  box-shadow: 0 3px 10px rgba(15, 118, 110, .30);
}

/* Inputs */
.mfl-input {
  width: 100%;
  padding: 9px 12px;
  border: 1.5px solid rgba(14, 116, 144, .35);
  border-radius: 9px;
  background: #fff;
  font-family: inherit;
  font-size: 13px; font-weight: 500; color: #0f172a;
  outline: none;
  transition: border-color .15s, box-shadow .15s;
}
.mfl-input::placeholder { color: #94a3b8; font-weight: 400; }
.mfl-input:focus {
  border-color: #0E7490;
  box-shadow: 0 0 0 3px rgba(14, 116, 144, .18);
}
/* Required-field error state — red border on the box + a small red message
   below it. Same inline-validation pattern as the Reminder / Customer modals
   so every missing required field is flagged at once. */
.mfl-input.is-invalid {
  border-color: #ef4444;
  box-shadow: 0 0 0 3px rgba(239, 68, 68, .15);
}
.mfl-err {
  margin-top: 4px;
  font-size: 11px;
  font-weight: 600;
  color: #ef4444;
  line-height: 1.3;
}

/* MasterSelect + MasterDatePicker + MasterTimePicker triggers — re-skin
 * inside this modal so they pick up the teal palette instead of the
 * default var(--vz-card-bg) which goes transparent on the mint body. */
.mfl-modal .master-select-toggle,
.mfl-modal .master-datepicker-toggle,
.mfl-modal .master-timepicker-toggle {
  height: 40px;
  background: #fff !important;
  border: 1.5px solid rgba(14, 116, 144, .35) !important;
  border-radius: 9px !important;
  color: #0f172a !important;
  font-size: 13px;
  font-weight: 500;
  padding: 7px 12px;
  box-shadow: none !important;
}
.mfl-modal .master-select-toggle:hover:not(:disabled),
.mfl-modal .master-datepicker-toggle:hover:not(:disabled),
.mfl-modal .master-timepicker-toggle:hover:not(:disabled) {
  border-color: rgba(14, 116, 144, .55) !important;
}
.mfl-modal .master-select-wrap.show .master-select-toggle,
.mfl-modal .master-datepicker-toggle.open,
.mfl-modal .master-timepicker-toggle.open {
  border-color: #0E7490 !important;
  box-shadow: 0 0 0 3px rgba(14, 116, 144, .18) !important;
}
/* Invalid state for the Master pickers — the toggle re-skin above sets the
   border with !important, so the pickers' own .invalid rule never won. Re-
   assert the red error border here so Platform / Date / Times highlight. */
.mfl-modal .master-select-wrap.invalid .master-select-toggle,
.mfl-modal .master-datepicker-wrap.invalid .master-datepicker-toggle,
.mfl-modal .master-timepicker-wrap.invalid .master-timepicker-toggle {
  border-color: #ef4444 !important;
  box-shadow: 0 0 0 3px rgba(239, 68, 68, .15) !important;
}
.mfl-modal .master-select-placeholder,
.mfl-modal .master-datepicker-placeholder,
.mfl-modal .master-timepicker-placeholder {
  color: #94a3b8 !important;
  opacity: 1 !important;
  font-weight: 400 !important;
}
.mfl-modal .master-datepicker-icon,
.mfl-modal .master-timepicker-icon,
.mfl-modal .master-select-caret { color: #0E7490; }
.mfl-input-ro {
  background: rgba(14, 116, 144, .08);
  color: #0F766E;
  font-weight: 700;
  cursor: not-allowed;
}
.mfl-textarea {
  resize: vertical;
  min-height: 72px;
}

.mfl-form-error {
  margin-top: 10px;
  padding: 8px 12px;
  background: rgba(239, 68, 68, .08);
  border: 1px solid rgba(239, 68, 68, .35);
  border-radius: 8px;
  color: #b91c1c;
  font-size: 12px; font-weight: 600;
}

/* ─── Footer ─── */
.mfl-foot {
  display: flex; align-items: center; justify-content: space-between;
  gap: 12px;
  padding: 14px 20px;
  background: #fff;
  border-top: 1px solid rgba(14, 116, 144, .20);
}
.mfl-foot-note {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 12px; color: #475569; font-weight: 500;
}
.mfl-foot-dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: #0891B2;
  box-shadow: 0 0 4px rgba(14, 116, 144, .55);
}
.mfl-foot-actions { display: flex; align-items: center; gap: 8px; }

.mfl-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 9px 20px;
  border-radius: 9px;
  border: 1.5px solid transparent;
  font-family: inherit;
  font-size: 13px; font-weight: 700;
  cursor: pointer;
  transition: all .15s;
}
.mfl-btn:disabled { opacity: .55; cursor: not-allowed; }
.mfl-btn-ghost {
  background: #fff;
  border-color: #cbd5e1;
  color: #0f172a;
}
.mfl-btn-ghost:hover:not(:disabled) { background: #f8fafc; border-color: #94a3b8; }
.mfl-btn-primary {
  /* Same prototype gradient as the active toggle tab so the
     "primary action" reads as the same surface across the form. */
  background: linear-gradient(135deg, #0F766E, #0E7490);
  color: #fff;
  box-shadow: 0 3px 10px rgba(15, 118, 110, .30);
}
.mfl-btn-primary:hover:not(:disabled) {
  background: linear-gradient(135deg, #0E7490, #155E75);
  transform: translateY(-1px);
  box-shadow: 0 6px 16px rgba(15, 118, 110, .45);
}

/* ─── Dark mode ─── */
[data-bs-theme="dark"] .mfl-modal {
  background: linear-gradient(180deg, #0c2620 0%, #0a1a17 100%);
}
[data-bs-theme="dark"] .mfl-body { background: #0a1f1b; color: #d1fae5; }
[data-bs-theme="dark"] .mfl-lbl  { color: #5eead4; }
[data-bs-theme="dark"] .mfl-input {
  background: #0f1f1c;
  border-color: rgba(14, 116, 144, .35);
  color: #ecfdf5;
}
[data-bs-theme="dark"] .mfl-input::placeholder { color: #475569; }
[data-bs-theme="dark"] .mfl-input:focus {
  border-color: #0891B2;
  box-shadow: 0 0 0 3px rgba(14, 116, 144, .25);
}
[data-bs-theme="dark"] .mfl-modal .master-select-toggle,
[data-bs-theme="dark"] .mfl-modal .master-datepicker-toggle,
[data-bs-theme="dark"] .mfl-modal .master-timepicker-toggle {
  background: #0f1f1c !important;
  border-color: rgba(14, 116, 144, .35) !important;
  color: #ecfdf5 !important;
}
[data-bs-theme="dark"] .mfl-modal .master-select-placeholder,
[data-bs-theme="dark"] .mfl-modal .master-datepicker-placeholder,
[data-bs-theme="dark"] .mfl-modal .master-timepicker-placeholder {
  color: rgba(94, 234, 212, .50) !important;
}
[data-bs-theme="dark"] .mfl-input-ro {
  background: rgba(14, 116, 144, .12);
  color: #5eead4;
}
[data-bs-theme="dark"] .mfl-toggle {
  background: #0b1f24;
  border-color: rgba(148, 163, 184, .25);
}
[data-bs-theme="dark"] .mfl-toggle-btn { color: #94a3b8; }
[data-bs-theme="dark"] .mfl-toggle-btn:hover:not(.active) { background: rgba(148, 163, 184, .12); }
[data-bs-theme="dark"] .mfl-pill-fetched {
  background: rgba(14, 116, 144, .18);
  border-color: rgba(14, 116, 144, .45);
  color: #5eead4;
}
[data-bs-theme="dark"] .mfl-form-error {
  background: rgba(239, 68, 68, .15);
  border-color: rgba(239, 68, 68, .45);
  color: #fca5a5;
}
[data-bs-theme="dark"] .mfl-foot {
  background: #0f1f1c;
  border-top-color: rgba(14, 116, 144, .25);
}
[data-bs-theme="dark"] .mfl-foot-note { color: #94a3b8; }
[data-bs-theme="dark"] .mfl-btn-ghost {
  background: #1e293b;
  border-color: rgba(14, 116, 144, .30);
  color: #d1fae5;
}
[data-bs-theme="dark"] .mfl-btn-ghost:hover:not(:disabled) { background: #243b3a; }

/* ─── Responsive ───
   The modal is capped at 820px and centered on large screens. As the
   viewport narrows it adapts in stages so it stays readable on tablets and
   phones instead of one abrupt single-column jump. */

/* Tablet — the 3-up Date / Start / End row gets cramped first, so collapse
   it to a single column while the 2-up rows stay side by side. */
@media (max-width: 680px) {
  .mfl-grid-3 { grid-template-columns: 1fr; }
}

/* Small tablet / large phone — stack the 2-up rows too and let the footer
   buttons go full width. */
@media (max-width: 560px) {
  .mfl-grid { grid-template-columns: 1fr; }
  .mfl-foot { flex-direction: column-reverse; align-items: stretch; gap: 10px; }
  .mfl-foot-actions { width: 100%; }
  .mfl-foot-actions .mfl-btn { flex: 1; justify-content: center; }
}

/* Phone — edge-to-edge sheet: full width/height, tighter padding, stacked
   Virtual / Physical toggle so neither label is clipped. */
@media (max-width: 440px) {
  .mfl-backdrop { padding: 8px; }
  .mfl-modal { width: 100%; max-height: 96vh; border-radius: 12px; }
  .mfl-head { padding: 12px 16px; }
  .mfl-body { padding: 14px 16px; }
  .mfl-foot { padding: 12px 16px; }
  .mfl-toggle { flex-direction: column; gap: 6px; }
  .mfl-toggle-btn { width: 100%; }
}
`;
