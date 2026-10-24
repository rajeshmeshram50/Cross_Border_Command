import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import api from '../../../../api';
import { useToast } from '../../../../contexts/ToastContext';
import { MasterSelect } from '../../../../components/ui/MasterSelect';
import { MasterDatePicker } from '../../../../components/ui/MasterDatePicker';
import { MasterTimePicker } from '../../../../components/ui/MasterTimePicker';
import '../../insights-productivity/SalesTodo.css';

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
/* Current wall-clock time as "HH:MM" — floors the time pickers so a meeting
 * scheduled for TODAY can't start or end in the past (same rule as SalesTodo). */
const hmNow = () => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
/* Add `mins` minutes to "HH:MM", clamped to 23:59 so it never wraps past midnight. */
const addHm = (hm: string, mins: number): string => {
  const [h, m] = hm.split(':').map(Number);
  const total = Math.min(h * 60 + m + mins, 23 * 60 + 59);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};
const toMin = (hm: string) => { const [h, m] = hm.split(':').map(Number); return h * 60 + m; };

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
  // Local date, not toISOString() — that is the UTC day, which in IST is still
  // yesterday until 05:30 and would let a past date through.
  const today = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  })();
  const isToday = date === today;
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
    // Backstop for the picker's minTime — the clock may have moved on since the
    // time was picked, or the date changed to today after it.
    else if (isToday && toMin(startTime) < toMin(hmNow())) e.startTime = 'Start time cannot be in the past.';
    if (!endTime)   e.endTime = 'End Time is required.';
    // Minimum meeting length 15 min, mirroring the Productivity Tracker form.
    else if (startTime && toMin(endTime) - toMin(startTime) < 15) e.endTime = 'Meeting must be at least 15 minutes long (End ≥ Start + 15 min).';

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

  /* Same markup and classes as the Productivity Tracker's Add Meeting form
     (SalesTodo.tsx / SalesTodo.css), so the two dialogs look identical (QA #304). */
  const fld = (label: string, key: string | null, required: boolean, body: React.ReactNode, full = false) => (
    <div className="td-field" style={full ? { gridColumn: 'span 2' } : undefined}>
      <label className="td-label">{label} {required && <span className="td-req">*</span>}</label>
      {body}
      {key && errors[key] && <div className="td-field-err">{errors[key]}</div>}
    </div>
  );

  return createPortal((
    <div className="td-overlay" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
      <div className="td-modal">
        <div className="td-modal-header">
          <div className="td-modal-header-left">
            <div className="td-modal-header-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2">
                <polygon points="23 7 16 12 23 17 23 7" />
                <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
              </svg>
            </div>
            <div>
              <div className="td-modal-title-row">
                <span className="td-modal-title">Add Meeting</span>
                <span className="td-modal-pill">MEETING</span>
              </div>
              <div className="td-modal-sub">Meeting</div>
            </div>
          </div>
          <button className="td-modal-close" onClick={onClose} aria-label="Close">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="td-modal-body">
          {/* Virtual / Physical toggle */}
          <div className="td-mtg-toggle">
            <button
              type="button"
              className={`td-mtg-toggle-btn ${type === 'virtual' ? 'active' : ''}`}
              onClick={() => { setType('virtual'); setPlatform(''); }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><polygon points="23 7 16 12 23 17 23 7" /><rect x="1" y="5" width="15" height="14" rx="2" ry="2" /></svg>
              Virtual Meeting
            </button>
            <button
              type="button"
              className={`td-mtg-toggle-btn ${type === 'physical' ? 'active' : ''}`}
              onClick={() => { setType('physical'); setPlatform(''); }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></svg>
              Physical Meeting
            </button>
          </div>

          {/* Opportunity ID + date come from the lead in context (read-only). */}
          <div className="td-form-row">
            {fld('Opportunity ID', null, false,
              <input className="td-inp" value={oppId ?? ''} readOnly />)}
            {fld('Opportunity Date', null, false,
              <input className="td-inp" value={toDisplayDate(oppDate)} readOnly placeholder="Auto-filled from opportunity" />)}
          </div>

          <div className="td-form-row">
            {fld('Person Name', 'customer', true,
              <input className={`td-inp ${errors.customer ? 'td-inp-err' : ''}`} value={customer} onChange={e => { setCustomer(e.target.value); clearErr('customer'); }} placeholder="Person name" />)}
            {fld('Person Email', 'email', false,
              <input className={`td-inp ${errors.email ? 'td-inp-err' : ''}`} type="email" value={email} onChange={e => { setEmail(e.target.value); clearErr('email'); }} placeholder="Email address" />)}
          </div>
          <div className="td-form-row">
            {fld('Contact No', 'contact', true,
              <input
                className={`td-inp ${errors.contact ? 'td-inp-err' : ''}`}
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
              />)}
            {fld(type === 'physical' ? 'Meeting Type / Format' : 'Platform', 'platform', true,
              <MasterSelect
                value={platform}
                onChange={(v) => { setPlatform(v); clearErr('platform'); }}
                options={(type === 'physical' ? PHYSICAL_PLATFORMS : VIRTUAL_PLATFORMS).map(p => ({ value: p, label: p }))}
                placeholder={type === 'physical' ? 'Select type' : 'Select platform'}
                invalid={!!errors.platform}
              />)}
          </div>

          {type === 'virtual'
            ? fld('Meeting Link', 'link', true,
                <input className={`td-inp ${errors.link ? 'td-inp-err' : ''}`} value={link} onChange={e => { setLink(e.target.value); clearErr('link'); }} placeholder="https://..." />, true)
            : fld('Place / Venue', 'venue', true,
                <input className={`td-inp ${errors.venue ? 'td-inp-err' : ''}`} value={venue} onChange={e => { setVenue(e.target.value); clearErr('venue'); }} placeholder="e.g. Mumbai Head Office, BKC" />, true)}

          <div className="td-form-row td-form-row-3">
            {fld('Meeting Date', 'date', true,
              <MasterDatePicker value={date} onChange={(v) => { setDate(v); clearErr('date'); clearErr('startTime'); clearErr('endTime'); }} minDate={today} placeholder="dd-mm-yyyy" invalid={!!errors.date} />)}
            {fld('Start Time', 'startTime', true,
              <MasterTimePicker value={startTime} onChange={(v) => { setStartTime(v); clearErr('startTime'); clearErr('endTime'); }} placeholder="--:--" invalid={!!errors.startTime} accent="teal"
                // Today → past slots are disabled; can't start before now.
                minTime={isToday ? hmNow() : undefined} />)}
            {fld('End Time', 'endTime', true,
              <MasterTimePicker value={endTime} onChange={(v) => { setEndTime(v); clearErr('endTime'); }} placeholder="--:--" invalid={!!errors.endTime} showNow={false} accent="teal"
                // End ≥ Start + 15 min, and ≥ now when the meeting is today.
                minTime={[startTime ? addHm(startTime, 15) : '', isToday ? hmNow() : ''].filter(Boolean).sort().pop() || undefined} />)}
          </div>

          {fld('Meeting Agenda', 'agenda', true,
            <textarea
              className={`td-inp ${errors.agenda ? 'td-inp-err' : ''}`}
              rows={2}
              maxLength={1000}
              value={agenda}
              onChange={e => { setAgenda(e.target.value); clearErr('agenda'); }}
              placeholder="Meeting agenda..."
              style={{ resize: 'none', minHeight: 52 }}
            />, true)}

          {formError && (
            <div className="td-form-error" role="alert">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" style={{ flexShrink: 0, marginTop: 1 }}>
                <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <span>{formError}</span>
            </div>
          )}
        </div>

        <div className="td-modal-footer">
          <div className="td-footer-hint">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
            Fields marked <span className="td-req">*</span> are required
          </div>
          <div className="td-footer-actions">
            <button type="button" className="td-btn-cancel" onClick={onClose} disabled={saving}>Cancel</button>
            <button type="button" className="td-btn-save" onClick={() => void save()} disabled={saving || !oppId} aria-busy={saving}>
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
