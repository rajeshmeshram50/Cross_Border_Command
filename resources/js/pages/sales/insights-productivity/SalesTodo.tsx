import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './SalesTodo.css';
import api from '../../../api';
import { useToast } from '../../../contexts/ToastContext';
import { useAuth } from '../../../contexts/AuthContext';
import { useConfirm } from '../../../contexts/ConfirmContext';
import Tooltip from '../../../components/ui/Tooltip';
import { MasterSelect } from '../../../components/ui/MasterSelect';
import { MasterDatePicker } from '../../../components/ui/MasterDatePicker';
import { MasterTimePicker } from '../../../components/ui/MasterTimePicker';
import {
  remindersApi, meetingsApi,
  isoToDisplay, displayToIso, hmsToHm,
  type ApiReminder, type ApiMeeting,
} from './salesTodoApi';

/* ────────────────────────────────────────────────────────────────────────────
 * Sales Matrix → To-Do (Productivity Tracker)
 *
 * Faithful port of the prototype's `#todoPage` (SalesMatrix_v4_9, line 9633) —
 * a teal-palette productivity page with two top tabs (Reminder, Meeting),
 * sub-status filters, search, add/edit modal, and a table per tab.
 *
 * Calendar view is scaffolded but defers to a "coming next" toast — the
 * prototype's calendar is rendered via a full-overlay component that's
 * non-trivial to port and not on the QA-critical path.
 *
 * Data is mock for now (seeded from prototype `TD_DATA`, line 22914).
 * Permission-gated on `sales.todo` — super_admin bypasses.
 * ──────────────────────────────────────────────────────────────────────── */

type TopTab = 'reminder' | 'meeting';
type MeetingSub = 'virtual' | 'physical';
type ReminderFilter = 'today' | 'all' | 'In Progress' | 'Done';
type MeetingStatus = 'In Progress' | 'Done' | 'Postponed' | 'Cancelled';

type Reminder = {
  id: number;
  oppId: string;
  oppDate: string;     // dd/mm/yyyy
  subject: string;
  setDate: string;     // dd/mm/yyyy
  tat: string;         // '24 Hours', '48 Hours', '72 Hours', '1 Week'
  remark: string;
  status: 'In Progress' | 'Done';
  // Existing attachment metadata — populated from the API response so the
  // edit modal can surface the previously-uploaded file. Empty when the
  // reminder has no attachment.
  attachmentName?: string;
  attachmentUrl?: string;
};

type Meeting = {
  id: number;
  code: string;        // M-001 / P-001
  oppId: string;
  customer: string;
  email: string;
  contact: string;
  platform: string;    // Zoom, Google Meet, Teams, Office Visit, Trade Fair, Client Site, Phone Call
  date: string;        // dd/mm/yyyy
  startTime: string;   // HH:mm
  endTime: string;
  link: string;
  venue: string;
  agenda: string;
  status: MeetingStatus;
  type: MeetingSub;
};

/* "Today" anchor for the "Today's Priority" filter. Computed at module load
 * in dd/mm/yyyy so it lines up with how reminders store set_date. */
const TODAY_STR = (() => {
  const d = new Date();
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
})();

/* Current wall-clock time as "HH:MM" — used to floor the meeting time pickers
 * so a meeting scheduled for TODAY can't be given a start/end in the past. */
const hmNow = () => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
};

/* Add `mins` minutes to an "HH:MM" string, clamped to 23:59 so it never wraps
 * past midnight. Used to enforce the 15-min minimum meeting duration on the
 * End-Time picker floor. */
const addHm = (hm: string, mins: number): string => {
  const [h, m] = hm.split(':').map(Number);
  const total = Math.min(h * 60 + m + mins, 23 * 60 + 59);
  return `${String(Math.floor(total / 60)).padStart(2,'0')}:${String(total % 60).padStart(2,'0')}`;
};

/* Convert API rows (snake_case + ISO dates) into the page's display shape
 * (camelCase + dd/mm/yyyy). Keeps the rendering code untouched even though
 * the data now flows from /api/sales/reminders. */
const apiToReminder = (r: ApiReminder): Reminder => ({
  id: r.id,
  oppId: r.opp_id ?? '',
  oppDate: isoToDisplay(r.opp_date),
  subject: r.subject,
  setDate: isoToDisplay(r.set_date),
  tat: r.tat || '24 Hours',
  remark: r.remark ?? '',
  status: r.status,
  attachmentName: r.attachment_original_name ?? undefined,
  attachmentUrl: r.attachment_url ?? undefined,
});

const apiToMeeting = (m: ApiMeeting): Meeting => ({
  id: m.id,
  code: m.code,
  oppId: m.opp_id ?? '',
  customer: m.customer,
  email: m.email ?? '',
  contact: m.contact ?? '',
  platform: m.platform ?? '',
  date: isoToDisplay(m.date),
  startTime: hmsToHm(m.start_time),
  endTime: hmsToHm(m.end_time),
  link: m.link ?? '',
  venue: m.venue ?? '',
  agenda: m.agenda ?? '',
  status: m.status,
  type: m.type,
});

/* Seed arrays removed — data flows from /api/sales/reminders + /api/sales/meetings */


const REMINDER_FILTERS: { key: ReminderFilter; label: string; icon: React.ReactNode }[] = [
  { key: 'today',       label: "Today's Priority", icon: <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> },
  { key: 'all',         label: 'All Reminders',    icon: <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg> },
  { key: 'In Progress', label: 'In Progress',      icon: <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg> },
  { key: 'Done',        label: 'Completed',        icon: <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg> },
];

const MEETING_FILTERS: { key: MeetingStatus; label: string; icon: React.ReactNode }[] = [
  { key: 'In Progress', label: 'In Progress', icon: <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg> },
  { key: 'Done',        label: 'Done',        icon: <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg> },
  { key: 'Postponed',   label: 'Postponed',   icon: <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg> },
  { key: 'Cancelled',   label: 'Cancelled',   icon: <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> },
];

const TAT_OPTIONS  = ['24 Hours', '48 Hours', '72 Hours', '1 Week', '2 Weeks'];
// Opportunity picker is fed by a live fetch of real leads (see the
// `oppOptions` effect below) — code + company + real opportunity date. No
// hard-coded placeholder list; an empty result simply shows no options.
// 'Other' is always last so the user can capture a platform/venue type that
// isn't in the predefined list (QA: "what if the meeting is scheduled on some
// another platform"). Selecting it reveals a free-text input.
const VIRTUAL_PLATFORMS  = ['Zoom', 'Google Meet', 'Microsoft Teams', 'Webex', 'Phone Call', 'Other'];
const PHYSICAL_PLATFORMS = ['Office Visit', 'Client Site', 'Trade Fair', 'Conference', 'Factory Visit', 'Port Visit', 'Other'];
// Common ISD dialing codes for the Contact No dropdown. India first since it's
// the primary market; the rest cover the app's frequent trade corridors.
const COUNTRY_CODES = ['+91', '+1', '+44', '+971', '+65', '+86', '+81', '+49', '+33', '+61', '+92', '+880', '+94', '+27'];
const ROWS_OPTIONS = [10, 25];

/* Loose shape — the modal renders one of two field-sets at a time, so the
 * union of every possible field is the simplest accurate type. Using
 * Partial<Reminder & Meeting> would over-constrain `status` (the intersection
 * of the two literal-string unions). */
type FormShape = {
  editId?: number | null;
  // common
  oppId?: string;
  status?: string;
  // reminder-only
  oppDate?: string;
  subject?: string;
  setDate?: string;
  tat?: string;
  remark?: string;
  attachmentName?: string;
  // The actual File object — captured on input change and sent via FormData
  // on save. Cleared after a successful save.
  attachmentFile?: File | null;
  // Direct download URL for an EXISTING attachment (only populated when
  // editing). When the user hasn't picked a new file, this URL drives the
  // "currently attached" link in the dropzone.
  attachmentUrl?: string;
  // meeting-only
  code?: string;
  customer?: string;
  email?: string;
  contact?: string;
  // Country dialing code shown in a dropdown beside the Contact No input.
  // The stored `contact` is rebuilt as "<countryCode> <localNumber>" on save.
  countryCode?: string;
  platform?: string;
  // Free-text platform name, only used when `platform === 'Other'`.
  platformOther?: string;
  date?: string;
  startTime?: string;
  endTime?: string;
  link?: string;
  venue?: string;
  agenda?: string;
  type?: MeetingSub;
};

export default function SalesTodo() {
  const toast = useToast();
  const confirmDialog = useConfirm();
  const { user } = useAuth();
  const isSuperAdmin = user?.user_type === 'super_admin';
  const perm = user?.permissions?.['sales.todo'];
  // Sales Matrix rollout — mirrors the sidebar gate in Sidebar.canView so
  // branch_user / employee accounts see the full UI (Add button + row actions)
  // even before per-leaf permission rows are seeded. Once perms are wired up,
  // delete the rollout branch and revert to strict perm flags.
  const isRolloutUser = user?.user_type === 'branch_user' || user?.user_type === 'employee';
  const canView = isSuperAdmin || isRolloutUser || perm?.can_view !== false;
  const canAdd  = isSuperAdmin || isRolloutUser || !!perm?.can_add;
  const canEdit = isSuperAdmin || isRolloutUser || !!perm?.can_edit;
  const canDel  = isSuperAdmin || isRolloutUser || !!perm?.can_delete;

  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [meetings,  setMeetings]  = useState<Meeting[]>([]);
  const [loadingData, setLoadingData] = useState<boolean>(true);
  /* Real opportunities for the picker (code + its opportunity date), so
   * selecting an opportunity can auto-fill the Opportunity Date. Falls back
   * to the static OPP_ID_OPTIONS list if the fetch fails / returns none. */
  const [oppOptions, setOppOptions] = useState<{ value: string; label: string; date: string; customer: string; email: string; contact: string }[]>([]);
  // Admins (super_admin / client_admin / client_user) see the whole tenant
  // by default; everyone else (branch users + employees) sees their own rows.
  // Mirrors the controller's applyScope() — the SPA just hints at which scope
  // to ask for.
  const defaultScope: 'mine' | 'all' = (
    user?.user_type === 'super_admin' ||
    user?.user_type === 'client_admin' ||
    user?.user_type === 'client_user'
  ) ? 'all' : 'mine';
  const [scope] = useState<'mine' | 'all'>(defaultScope);

  // Tracks any in-flight mutation so the action buttons can show a spinner
  // / suppress double-clicks without re-rendering the whole table.
  const savingRef = useRef(false);
  // Mirrored as state purely so the save button can render a spinner / get
  // visually disabled while a save is in flight. The ref is still the source
  // of truth for the re-entrancy guard.
  const [saving, setSaving] = useState(false);

  const [tab, setTab]             = useState<TopTab>('reminder');
  const [meetingSub, setMeetingSub] = useState<MeetingSub>('virtual');
  const [reminderFilter, setReminderFilter] = useState<ReminderFilter>('today');
  const [meetingFilter, setMeetingFilter]   = useState<MeetingStatus>('In Progress');
  const [q, setQ]                 = useState('');
  const [page, setPage]           = useState(1);
  const [rpp, setRpp]             = useState(10);

  // ── Auto-fit rows ── show exactly as many rows as fill the scroll area so
  // big screens don't leave a gap; picking a Rows-per-page value overrides it.
  const wrapRef    = useRef<HTMLDivElement>(null);
  const autoFitRef = useRef(true);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const recompute = () => {
      if (!autoFitRef.current) return;
      const avail = el.clientHeight;
      if (avail <= 0) return;
      const THEAD = 36, ROW = 40;   // todo table header + row heights (px)
      const fit = Math.max(5, Math.floor((avail - THEAD) / ROW));
      setRpp(prev => (prev === fit ? prev : fit));
    };
    const ro = new ResizeObserver(recompute);
    ro.observe(el);
    recompute();
    // Recompute after the flex layout settles (first paint can report a
    // stale/zero height before the viewport-fill chain resolves).
    const raf = requestAnimationFrame(recompute);
    return () => { ro.disconnect(); cancelAnimationFrame(raf); };
  }, []);

  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm]           = useState<FormShape>({});
  // Validation errors are kept as a list so every failing field surfaces at
  // once (QA: "multiple validation errors should be shown at a time") instead
  // of the old one-error-at-a-time behaviour.
  const [formErrors, setFormErrors] = useState<string[]>([]);
  // Per-field inline validation errors for the MEETING form — rendered right
  // under each input (red highlight) instead of one lumped box at the bottom.
  const [mtgErr, setMtgErr] = useState<Record<string, string>>({});
  const clearMtgErr = (k: string) => setMtgErr(p => (p[k] ? { ...p, [k]: '' } : p));
  // Read-only "view" modal for reminders — opened from the Actions column so
  // the user can inspect details + the attachment without entering edit mode.
  const [viewReminder, setViewReminder] = useState<Reminder | null>(null);

  // Calendar view state
  const [view, setView] = useState<'list' | 'calendar'>('list');
  const todayDate = useMemo(() => {
    const [d, m, y] = TODAY_STR.split('/').map(n => parseInt(n, 10));
    return { d, m: m - 1, y };
  }, []);
  const [calYear,  setCalYear]  = useState(todayDate.y);
  const [calMonth, setCalMonth] = useState(todayDate.m);
  const [popover, setPopover]   = useState<{ dateKey: string; x: number; y: number } | null>(null);

  // Scroll lock — while the Add/Edit form, the Reminder Details modal, or the
  // calendar day-detail popover is open, lock BOTH <html> and <body> so the
  // page behind can't scroll.
  useEffect(() => {
    const anyOpen = modalOpen || viewReminder !== null || popover !== null;
    if (!anyOpen) return;
    const b = document.body.style.overflow;
    const h = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    return () => { document.body.style.overflow = b; document.documentElement.style.overflow = h; };
  }, [modalOpen, viewReminder, popover]);

  // Inject Google Fonts (DM Sans + Inter) once on mount.
  useEffect(() => {
    const id = 'sm-td-fonts';
    if (document.getElementById(id)) return;
    const link = document.createElement('link');
    link.id = id; link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700;800&family=Inter:wght@400;500;600;700;800&display=swap';
    document.head.appendChild(link);
  }, []);

  // Load both reminders + meetings once on mount. Two parallel fetches — the
  // server returns at most a few hundred rows per scope, so we don't bother
  // with pagination yet.
  useEffect(() => {
    let cancelled = false;
    setLoadingData(true);
    Promise.all([
      remindersApi.list({ scope }),
      meetingsApi.list({ scope }),
    ])
      .then(([rems, mtgs]) => {
        if (cancelled) return;
        setReminders(rems.map(apiToReminder));
        setMeetings(mtgs.map(apiToMeeting));
      })
      .catch((err: any) => {
        if (cancelled) return;
        toast.error('Could not load Productivity Tracker', err?.response?.data?.message || err?.message || 'Please try again.');
      })
      .finally(() => { if (!cancelled) setLoadingData(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);

  /* Opportunity picker — SERVER-PAGINATED. Instead of loading every
   * opportunity up front, we page through /sales/leads 20 at a time: the
   * dropdown loads page 1 on open, fetches the next page as the user scrolls
   * to the bottom, and re-queries server-side (debounced) as they type. Each
   * option carries the real company + opportunity date for the auto-fill. */
  const OPP_PER = 20;
  const [oppPage, setOppPage]               = useState(1);
  const [oppHasMore, setOppHasMore]         = useState(true);
  const [oppLoadingMore, setOppLoadingMore] = useState(false);
  const oppSearchRef = useRef('');   // latest search term (for scroll-paging)
  const oppReqIdRef  = useRef(0);    // guards against out-of-order responses

  const mapOpp = (l: any) => {
    const raw = (l.query_time ?? l.created_at ?? '').slice(0, 10);
    // Surface the opportunity's company so the picker shows real data
    // ("OPP-0492 · HARI KRISHAN"), not just a bare code.
    const company = l.customer?.company_name || l.sender_company || l.sender_name || '';
    return {
      value: l.opp_code as string,
      label: company ? `${l.opp_code} · ${company}` : (l.opp_code as string),
      date: raw ? isoToDisplay(raw) : '',
      // Selecting an opportunity auto-fills the meeting's PRIMARY CONTACT
      // PERSON — NOT the company. The person who owns the inquiry lives on the
      // lead's sender_* fields (name / email / mobile); fall back to the mapped
      // customer's email only when the contact person has none.
      customer: (l.sender_name ?? '') as string,
      email: (l.sender_email || l.customer?.primary_email || '') as string,
      contact: (l.sender_mobile ?? '') as string,
    };
  };

  const loadOpps = useCallback((page: number, search: string, append: boolean) => {
    const reqId = ++oppReqIdRef.current;
    setOppLoadingMore(true);
    api.get<{ data: any[]; pagination?: { last_page?: number } }>(
      '/sales/leads',
      { params: { status: 'all', per_page: OPP_PER, page, with_counts: 0, search: search || undefined } },
    )
      .then(({ data }) => {
        if (reqId !== oppReqIdRef.current) return;   // a newer request superseded this one
        const opts = (data.data ?? []).filter(l => l.opp_code).map(mapOpp);
        setOppOptions(prev => append ? [...prev, ...opts] : opts);
        const lastPage = data.pagination?.last_page ?? page;
        setOppHasMore(page < lastPage);
        setOppPage(page);
      })
      .catch(() => {
        if (reqId !== oppReqIdRef.current) return;
        if (!append) setOppOptions([]);
        setOppHasMore(false);
      })
      .finally(() => { if (reqId === oppReqIdRef.current) setOppLoadingMore(false); });
  }, []);

  // First page on mount (the picker also re-fetches page 1 each time it opens).
  useEffect(() => { loadOpps(1, '', false); }, [loadOpps]);

  // Debounced server search (called by MasterSelect as the user types) — resets to page 1.
  const handleOppSearch = useCallback((q: string) => {
    oppSearchRef.current = q;
    loadOpps(1, q, false);
  }, [loadOpps]);

  // Scrolled near the bottom of the dropdown → append the next page.
  const handleOppScrollEnd = useCallback(() => {
    if (oppLoadingMore || !oppHasMore) return;
    loadOpps(oppPage + 1, oppSearchRef.current, true);
  }, [oppLoadingMore, oppHasMore, oppPage, loadOpps]);

  const oppPickerOptions = oppOptions.map(o => ({ value: o.value, label: o.label }));
  const oppDateFor = (code: string): string => oppOptions.find(o => o.value === code)?.date ?? '';
  const oppCustomerFor = (code: string): string => oppOptions.find(o => o.value === code)?.customer ?? '';
  const oppEmailFor    = (code: string): string => oppOptions.find(o => o.value === code)?.email ?? '';
  const oppContactFor  = (code: string): string => oppOptions.find(o => o.value === code)?.contact ?? '';

  /* ── Reminder filtering ── */
  const filteredReminders = useMemo(() => {
    let rows = reminders;
    if (reminderFilter === 'today')         rows = rows.filter(r => r.setDate === TODAY_STR && r.status === 'In Progress');
    else if (reminderFilter !== 'all')      rows = rows.filter(r => r.status === reminderFilter);
    if (q) {
      const lo = q.toLowerCase();
      rows = rows.filter(r =>
        r.subject.toLowerCase().includes(lo) ||
        r.oppId.toLowerCase().includes(lo) ||
        r.setDate.includes(lo) ||
        r.remark.toLowerCase().includes(lo) ||
        r.tat.toLowerCase().includes(lo)
      );
    }
    return rows;
  }, [reminders, reminderFilter, q]);

  /* ── Meeting filtering ── */
  const filteredMeetings = useMemo(() => {
    let rows = meetings.filter(m => m.type === meetingSub && m.status === meetingFilter);
    if (q) {
      const lo = q.toLowerCase();
      // Search across every text-bearing column the user can see in the
      // table — customer/agenda/etc. PLUS the columns that used to silently
      // miss ("Zoom" never matched the platform column; phone numbers
      // never matched contact; venue / email were also blind spots).
      rows = rows.filter(m =>
        m.customer.toLowerCase().includes(lo) ||
        m.oppId.toLowerCase().includes(lo) ||
        m.code.toLowerCase().includes(lo) ||
        m.date.includes(lo) ||
        m.agenda.toLowerCase().includes(lo) ||
        m.platform.toLowerCase().includes(lo) ||
        m.contact.toLowerCase().includes(lo) ||
        m.email.toLowerCase().includes(lo) ||
        m.venue.toLowerCase().includes(lo)
      );
    }
    return rows;
  }, [meetings, meetingSub, meetingFilter, q]);

  /* ── Calendar pipeline (uses current top-tab + meeting sub-tab) ── */
  type CalItem = { key: string; date: string; title: string; status: string; ref: Reminder | Meeting };
  const calendarItems: CalItem[] = useMemo(() => {
    if (tab === 'reminder') {
      return reminders.map(r => ({ key: `r-${r.id}`, date: r.setDate, title: r.subject, status: r.status, ref: r }));
    }
    return meetings
      .filter(m => m.type === meetingSub)
      .map(m => ({ key: `m-${m.id}`, date: m.date, title: m.customer, status: m.status, ref: m }));
  }, [tab, reminders, meetings, meetingSub]);

  const calendarMap = useMemo(() => {
    const map: Record<string, CalItem[]> = {};
    calendarItems.forEach(it => {
      if (!it.date) return;
      (map[it.date] ||= []).push(it);
    });
    return map;
  }, [calendarItems]);

  const monthStats = useMemo(() => {
    const mk = `${String(calMonth + 1).padStart(2, '0')}/${calYear}`;
    const inMonth = calendarItems.filter(it => it.date && it.date.slice(3) === mk);
    return {
      total: inMonth.length,
      inProgress: inMonth.filter(it => it.status === 'In Progress').length,
      done: inMonth.filter(it => it.status === 'Done').length,
    };
  }, [calendarItems, calYear, calMonth]);

  /* ── Counts for filter chip badges ── */
  const reminderCounts = useMemo(() => ({
    today:        reminders.filter(r => r.setDate === TODAY_STR && r.status === 'In Progress').length,
    all:          reminders.length,
    'In Progress': reminders.filter(r => r.status === 'In Progress').length,
    Done:         reminders.filter(r => r.status === 'Done').length,
  }), [reminders]);

  const meetingTypeCounts = useMemo(() => ({
    virtual:  meetings.filter(m => m.type === 'virtual').length,
    physical: meetings.filter(m => m.type === 'physical').length,
  }), [meetings]);

  const meetingStatusCounts = useMemo(() => {
    const subset = meetings.filter(m => m.type === meetingSub);
    return {
      'In Progress': subset.filter(m => m.status === 'In Progress').length,
      Done:          subset.filter(m => m.status === 'Done').length,
      Postponed:     subset.filter(m => m.status === 'Postponed').length,
      Cancelled:     subset.filter(m => m.status === 'Cancelled').length,
    };
  }, [meetings, meetingSub]);

  const filtered = tab === 'reminder' ? filteredReminders : filteredMeetings;
  const total = filtered.length;
  const pages = Math.max(1, Math.ceil(total / rpp));
  const safePage = Math.min(page, pages);
  const startIdx = (safePage - 1) * rpp;
  const rows = filtered.slice(startIdx, startIdx + rpp);

  // Resync the `page` state when filters / deletes shrink `pages` below
  // the currently selected page. Without this, the render-time `safePage`
  // clamp hides the drift but Prev/Next clicks operate on the stale
  // `page` and feel "stuck" — the first one or two clicks appear to do
  // nothing while the underlying counter catches up.
  useEffect(() => {
    if (page > pages) setPage(pages);
  }, [pages, page]);

  /* ── Actions ── */
  const switchTab = (next: TopTab) => {
    setTab(next);
    setPage(1);
    setQ('');
    if (next === 'meeting') {
      setMeetingSub('virtual');
      setMeetingFilter('In Progress');
    } else {
      setReminderFilter('today');
    }
  };

  const openAdd = () => {
    if (!canAdd) return;
    setForm(tab === 'reminder'
      // Opportunity Date starts empty — it's derived from the chosen
      // Opportunity ID, not free-typed. Pre-filling today's date before an
      // opportunity is picked was misleading (QA bug 29).
      ? { editId: null, oppId:'', oppDate: '', subject:'', setDate: TODAY_STR, tat:'24 Hours', remark:'', status:'In Progress' }
      // platform left empty intentionally — pre-filling "Zoom" silently
      // satisfied the required validation, so the user could save without
      // ever opening the dropdown. Forcing an active selection.
      : { editId: null, code:'', oppId:'', customer:'', email:'', contact:'', countryCode:'+91', platform:'', platformOther:'', date: TODAY_STR, startTime:'', endTime:'', link:'', venue:'', agenda:'', status:'In Progress', type: meetingSub });
    setFormErrors([]);
    setMtgErr({});
    setModalOpen(true);
  };

  const openEdit = (record: Reminder | Meeting) => {
    if (!canEdit) return;
    // Completed reminders are read-only — the action button is rendered as
    // disabled, but guard the programmatic path too (calendar popover, etc.).
    if ('subject' in record && (record as Reminder).status === 'Done') {
      toast.info('Read-only', 'Completed reminders cannot be edited.');
      return;
    }
    // For meetings, split the stored "<code> <number>" contact back into a
    // country-code + local-number pair so the dropdown re-selects correctly,
    // and map an unrecognised platform onto the "Other" + free-text inputs.
    if ('code' in record) {
      const m = record as Meeting;
      const { code, local } = splitContact(m.contact);
      const known = (m.type === 'physical' ? PHYSICAL_PLATFORMS : VIRTUAL_PLATFORMS);
      const isOther = !!m.platform && !known.includes(m.platform);
      setForm({
        ...m,
        editId: m.id,
        countryCode: code,
        contact: local,
        platform: isOther ? 'Other' : m.platform,
        platformOther: isOther ? m.platform : '',
      });
    } else {
      setForm({ ...record, editId: record.id });
    }
    setFormErrors([]);
    setMtgErr({});
    setModalOpen(true);
  };

  const close = () => { setModalOpen(false); setForm({}); setFormErrors([]); setMtgErr({}); };

  const setMark = async (record: Reminder | Meeting, status: string) => {
    if (savingRef.current) return;
    savingRef.current = true;
    // Optimistic update — flip the row in local state immediately so the UI
    // doesn't sit on "In Progress" for a few seconds waiting for the round
    // trip. If the API call fails we roll the row back and toast the error.
    const prevStatus = record.status;
    if (tab === 'reminder') {
      setReminders(prev => prev.map(r => r.id === record.id ? { ...r, status: status as Reminder['status'] } : r));
    } else {
      setMeetings(prev => prev.map(m => m.id === record.id ? { ...m, status: status as Meeting['status'] } : m));
    }
    try {
      if (tab === 'reminder') {
        const fresh = await remindersApi.setStatus(record.id, status as 'In Progress' | 'Done');
        setReminders(prev => prev.map(r => r.id === record.id ? apiToReminder(fresh) : r));
      } else {
        const fresh = await meetingsApi.setStatus(record.id, status as MeetingStatus);
        setMeetings(prev => prev.map(m => m.id === record.id ? apiToMeeting(fresh) : m));
      }
      toast.success('Updated', `Marked as ${status}`);
    } catch (err: any) {
      // Roll back to the prior status — the optimistic flip was incorrect.
      if (tab === 'reminder') {
        setReminders(prev => prev.map(r => r.id === record.id ? { ...r, status: prevStatus as Reminder['status'] } : r));
      } else {
        setMeetings(prev => prev.map(m => m.id === record.id ? { ...m, status: prevStatus as Meeting['status'] } : m));
      }
      toast.error('Could not update', err?.response?.data?.message || err?.message || 'Please try again.');
    } finally {
      savingRef.current = false;
    }
  };

  const del = async (record: Reminder | Meeting) => {
    if (!canDel || savingRef.current) return;

    // Mark "in-flight" BEFORE awaiting the confirm dialog so a second
    // delete click (or Enter-spam on the keyboard) is rejected by the
    // guard at the top instead of racing through to a duplicate DELETE.
    // Reset in `finally` covers all exit paths — cancel, network error,
    // success — so the ref never leaks across interactions.
    savingRef.current = true;
    try {
      // Confirm before delete — matches the project's confirm-dialog
      // pattern (Inbox / MyTeam / HrEmployeeOnboarding). Resolves true
      // on Yes, false on Cancel / Esc / backdrop click.
      const isReminder = tab === 'reminder';
      const label = isReminder
        ? (record as Reminder).subject
        : `${(record as Meeting).code} — ${(record as Meeting).customer}`;
      const ok = await confirmDialog({
        title: isReminder ? 'Delete reminder?' : 'Delete meeting?',
        message: (
          <>
            You're about to permanently delete <strong>{label}</strong>. This can't be undone.
          </>
        ),
        confirmLabel: 'Yes, Delete',
        cancelLabel:  'Cancel',
        tone:         'danger',
        icon:         'delete-bin-line',
      });
      if (!ok) return;

      try {
        if (isReminder) {
          await remindersApi.destroy(record.id);
          setReminders(prev => prev.filter(r => r.id !== record.id));
          toast.info('Deleted', (record as Reminder).subject);
        } else {
          await meetingsApi.destroy(record.id);
          setMeetings(prev => prev.filter(m => m.id !== record.id));
          toast.info('Deleted', (record as Meeting).code);
        }
      } catch (err: any) {
        toast.error('Could not delete', err?.response?.data?.message || err?.message || 'Please try again.');
      }
    } finally {
      savingRef.current = false;
    }
  };

  const save = async () => {
    if (savingRef.current) return;
    setFormErrors([]);

    if (tab === 'reminder') {
      // Collect every validation failure so they can all be shown at once,
      // rather than bailing on the first one.
      const errs: string[] = [];
      const subj = (form.subject || '').trim();
      if (!subj)                               errs.push('Subject is required.');
      else {
        if (!/^[A-Za-z0-9 ]+$/.test(subj))     errs.push('Special characters are not allowed in the subject.');
        if (subj.length < 3)                   errs.push('Subject must be at least 3 characters.');
        if (subj.length > 255)                 errs.push('Subject cannot exceed 255 characters.');
      }

      if (!form.setDate) {
        errs.push('Reminder set date is required.');
      } else if (!form.editId && displayToIso(form.setDate) < displayToIso(TODAY_STR)) {
        // Block past reminder dates on new reminders — you can't set a
        // reminder for a date that has already gone by (QA bug 30). Existing
        // reminders are exempt so a historic row can still be edited/saved.
        errs.push('Reminder set date cannot be in the past.');
      }

      if (errs.length) { setFormErrors(errs); return; }

      const payload = {
        opp_id: form.oppId || undefined,
        opp_date: form.oppDate ? displayToIso(form.oppDate) : null,
        subject: subj,
        set_date: displayToIso(form.setDate),
        tat: form.tat || '24 Hours',
        remark: form.remark || '',
        status: ((form.status as 'In Progress' | 'Done') || 'In Progress'),
        attachment: form.attachmentFile || null,
      };

      savingRef.current = true;
      setSaving(true);
      try {
        if (form.editId) {
          const fresh = await remindersApi.update(form.editId, payload);
          setReminders(prev => prev.map(r => r.id === form.editId ? apiToReminder(fresh) : r));
          toast.success('Saved', 'Reminder updated');
        } else {
          const fresh = await remindersApi.create(payload);
          setReminders(prev => [apiToReminder(fresh), ...prev]);
          toast.success('Added', 'Reminder created');
          // Switch to the filter that will actually show the new row. The
          // default "Today's Priority" filter only shows (today + In Progress),
          // so a Done reminder OR a future-dated one would silently vanish
          // and the user would think the save didn't work. Land on the
          // most specific filter that contains the new row:
          //   • Done            → Completed tab
          //   • today + InProg  → Today's Priority (preserves the focused view)
          //   • everything else → All Reminders
          const isTodayPriority =
            payload.status === 'In Progress' &&
            payload.set_date === displayToIso(TODAY_STR);
          setReminderFilter(
            payload.status === 'Done' ? 'Done' :
            isTodayPriority ? 'today' :
            'all'
          );
          setPage(1);
        }
        close();
      } catch (err: any) {
        setFormErrors([prettySaveError(err)]);
      } finally {
        savingRef.current = false;
        setSaving(false);
      }
    } else {
      // Per-field validation — each message is keyed to its field so it renders
      // inline under that input (red highlight), not in a lumped bottom box.
      const fe: Record<string, string> = {};
      const set = (k: string, msg: string) => { if (!fe[k]) fe[k] = msg; };
      const cust = (form.customer || '').trim();
      // Customer name: must contain at least one letter (rejects "!!!", "123",
      // "@@@" etc.) and stay within a sensible length / safe character set.
      if (!cust) set('customer', 'Person Name is required.');
      else {
        if (!/[A-Za-z]/.test(cust))                            set('customer', 'Person Name must contain letters.');
        if (!/^[A-Za-z][A-Za-z0-9 .,'&()\-]{1,99}$/.test(cust)) set('customer', 'Person Name has invalid characters or length.');
      }

      // Person Email — REQUIRED, trimmed + format-checked so leading/trailing
      // spaces don't trip the backend (QA: trim spaces).
      const emailRaw = (form.email || '').trim();
      if (!emailRaw) {
        set('email', 'Person Email is required.');
      } else {
        if (emailRaw.length > 191)                              set('email', 'Person Email cannot exceed 191 characters.');
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw))       set('email', 'Person Email is not a valid email address.');
      }

      if (!form.date) {
        set('date', 'Meeting Date is required.');
      } else if (!form.editId && displayToIso(form.date) < displayToIso(TODAY_STR)) {
        // Block past meeting dates on new meetings — mirrors the reminder rule.
        // Existing meetings are exempt so a historic row can still be edited/saved.
        set('date', 'Meeting date cannot be in the past.');
      }
      if (!form.startTime) set('startTime', 'Start Time is required.');
      if (!form.endTime)   set('endTime', 'End Time is required.');
      // Minimum meeting duration = 15 minutes (a 2–3 min slot is almost always
      // a mis-click). End must be at least 15 min after start.
      if (form.startTime && form.endTime) {
        const toMin = (hm: string) => { const [h, m] = hm.split(':').map(Number); return h * 60 + m; };
        if (toMin(form.endTime) - toMin(form.startTime) < 15) {
          set('endTime', 'Meeting must be at least 15 minutes long (End ≥ Start + 15 min).');
        }
      }

      // Contact number — REQUIRED. Combine the selected country code with the
      // local number, then enforce 10–15 total digits (10 covers India's
      // standard mobile length; 15 is the ITU-T E.164 maximum).
      const localNum  = (form.contact || '').trim();
      const ccode     = (form.countryCode || '+91').trim();
      const contactRaw = localNum ? `${ccode} ${localNum}`.trim() : '';
      if (!localNum) {
        set('contact', 'Contact Number is required.');
      } else {
        const digits = contactRaw.replace(/\D/g, '');
        if (digits.length < 10)  set('contact', 'Contact Number must be at least 10 digits.');
        if (digits.length > 15)  set('contact', 'Contact Number cannot be more than 15 digits.');
        if (!/^\+?[\d\s\-]+$/.test(contactRaw)) set('contact', 'Contact Number can only contain digits, spaces, dashes and a leading +.');
      }

      // Resolve the platform/type, honouring the free-text "Other" choice.
      const platformVal = form.platform === 'Other'
        ? (form.platformOther || '').trim()
        : (form.platform || '');
      if (!form.platform) {
        set('platform', meetingSub === 'physical' ? 'Meeting Type is required.' : 'Platform is required.');
      } else if (form.platform === 'Other' && !platformVal) {
        set('platform', meetingSub === 'physical' ? 'Please specify the meeting type.' : 'Please specify the platform.');
      }

      const isVirtual = ((form.type as MeetingSub) || meetingSub) === 'virtual';
      const linkRaw  = (form.link  || '').trim();
      const venueRaw = (form.venue || '').trim();

      if (isVirtual) {
        // Virtual meeting link — REQUIRED, must be a valid http(s) URL.
        if (!linkRaw) {
          set('link', 'Meeting Link is required.');
        } else {
          let ok = false;
          try { const u = new URL(linkRaw); ok = /^https?:$/.test(u.protocol); } catch { ok = false; }
          if (!ok) set('link', 'Meeting Link must be a valid http(s) URL (e.g. https://meet.google.com/abc-def-ghi).');
        }
      } else {
        // Physical meeting — venue is REQUIRED and must look like a real
        // place name (at least one letter, sensible length, safe punctuation).
        if (!venueRaw) {
          set('venue', 'Place / Venue is required.');
        } else {
          if (!/[A-Za-z]/.test(venueRaw))                            set('venue', 'Venue must contain letters, not just symbols or digits.');
          if (venueRaw.length < 3 || venueRaw.length > 200)          set('venue', 'Venue must be between 3 and 200 characters.');
          if (!/^[A-Za-z0-9 .,'&()#\/\-\n\r]+$/.test(venueRaw))      set('venue', 'Venue contains invalid characters.');
        }
      }

      // Meeting agenda — REQUIRED for both meeting types.
      const agendaRaw = (form.agenda || '').trim();
      if (!agendaRaw)                   set('agenda', 'Meeting Agenda is required.');
      else if (agendaRaw.length < 2)    set('agenda', 'Meeting Agenda must be at least 2 characters.');
      else if (agendaRaw.length > 1000) set('agenda', 'Meeting Agenda cannot exceed 1000 characters.');

      if (Object.keys(fe).length) { setMtgErr(fe); return; }

      const payload = {
        type: ((form.type as 'virtual' | 'physical') || meetingSub),
        opp_id: form.oppId || undefined,
        customer: cust,
        email: emailRaw || undefined,
        contact: contactRaw,
        platform: platformVal || undefined,
        date: displayToIso(form.date),
        start_time: form.startTime || undefined,
        end_time: form.endTime || undefined,
        link: isVirtual ? linkRaw : undefined,
        venue: isVirtual ? undefined : venueRaw,
        agenda: agendaRaw,
        status: ((form.status as MeetingStatus) || 'In Progress'),
      };

      savingRef.current = true;
      setSaving(true);
      try {
        if (form.editId) {
          const fresh = await meetingsApi.update(form.editId, payload);
          setMeetings(prev => prev.map(m => m.id === form.editId ? apiToMeeting(fresh) : m));
          toast.success('Saved', 'Meeting updated');
        } else {
          const fresh = await meetingsApi.create(payload);
          setMeetings(prev => [apiToMeeting(fresh), ...prev]);
          toast.success('Added', 'Meeting created');
          // Switch the meeting sub-tab + status filter to the bucket the
          // new meeting actually belongs to, so the row is always visible
          // after save. Mirrors the reminder save logic above.
          if (payload.type !== meetingSub) setMeetingSub(payload.type);
          setMeetingFilter(payload.status as MeetingStatus);
          setPage(1);
        }
        close();
      } catch (err: any) {
        setFormErrors([prettySaveError(err)]);
      } finally {
        savingRef.current = false;
        setSaving(false);
      }
    }
  };

  // Turn raw axios / Laravel errors into something a user can act on.
  // Catches the "POST data is too large" PHP error (returned as 413 or
  // surfaced as a 500 with that wording) and translates it to a sensible
  // size hint that matches the backend's ATTACH_MAX_KB constant (20 MB).
  const prettySaveError = (err: any): string => {
    const status = err?.response?.status;
    const raw = String(err?.response?.data?.message || err?.message || '');
    if (status === 413 || /POST data is too large|content length|413/i.test(raw)) {
      return 'Attachment is too large. Please upload a file under 20 MB.';
    }
    const errors = (err?.response?.data?.errors ?? {}) as Record<string, string[]>;
    const firstFieldError = Object.values(errors)[0]?.[0];
    return firstFieldError || raw || 'Save failed';
  };

  /* ── No-access ── */
  if (!canView) {
    return (
      <div className="td-root">
        
        <div className="td-no-access">
          <div className="td-no-access-title">No access</div>
          <div className="td-no-access-sub">You don't have permission to view the To-Do board. Ask your branch admin to grant <strong>can_view</strong> on Sales Matrix → To-Do.</div>
        </div>
      </div>
    );
  }

  const isToday = (d: string) => d === TODAY_STR;

  return (
    <div className="td-root">
      

      {/* ── Header with tabs ── */}
      <div className="td-header">
        <span className="td-header-glow" />
        <div className="td-header-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2">
            <path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
          </svg>
        </div>
        <div className="td-header-text">
          <div className="td-header-title">Productivity Tracker</div>
          <div className="td-header-sub">Manage your tasks, meetings and daily reminders</div>
        </div>
        <div className="td-tabs">
          <button
            className={`td-tab ${tab === 'reminder' ? 'td-tab-active' : ''}`}
            onClick={() => switchTab('reminder')}
          >Reminder</button>
          <button
            className={`td-tab ${tab === 'meeting' ? 'td-tab-active' : ''}`}
            onClick={() => switchTab('meeting')}
          >Meeting</button>
        </div>
      </div>

      {/* ── Toolbar ── */}
      <div className="td-toolbar">
        <div className="td-toolbar-row">
          <div className="td-filters">
            {tab === 'reminder' ? (
              REMINDER_FILTERS.map(f => {
                const active = reminderFilter === f.key;
                return (
                  <button
                    key={f.key}
                    className={`td-sf ${active ? 'active' : ''}`}
                    onClick={() => { setReminderFilter(f.key); setPage(1); }}
                  >
                    {f.icon}
                    {f.label}
                    <span className={`td-sf-count ${active ? 'td-sf-count-active' : ''}`}>{reminderCounts[f.key]}</span>
                  </button>
                );
              })
            ) : (
              <>
                <button
                  className={`td-meeting-pill ${meetingSub === 'virtual' ? 'active' : ''}`}
                  onClick={() => { setMeetingSub('virtual'); setMeetingFilter('In Progress'); setPage(1); }}
                >
                  <IconCam />
                  Virtual Meetings
                  <span className={`td-pill-count ${meetingSub === 'virtual' ? 'td-pill-count-active' : ''}`}>{meetingTypeCounts.virtual}</span>
                </button>
                <button
                  className={`td-meeting-pill ${meetingSub === 'physical' ? 'active' : ''}`}
                  onClick={() => { setMeetingSub('physical'); setMeetingFilter('In Progress'); setPage(1); }}
                >
                  <IconPin />
                  Physical Meetings
                  <span className={`td-pill-count ${meetingSub === 'physical' ? 'td-pill-count-active' : ''}`}>{meetingTypeCounts.physical}</span>
                </button>
              </>
            )}
            {/* View toggle inline with the filters for both tabs (matches Figma) */}
            <div className="td-view-toggle">
              <button
                className={`td-view-btn ${view === 'list' ? 'active' : ''}`}
                title="List View"
                onClick={() => setView('list')}
              >
                <IconList />
                List
              </button>
              <button
                className={`td-view-btn ${view === 'calendar' ? 'active' : ''}`}
                title="Calendar View"
                onClick={() => { setView('calendar'); setPopover(null); }}
              >
                <IconCal />
                Calendar
              </button>
            </div>
          </div>
          {/* Search sits right after the filters (and the inline view
              toggle for the Meeting tab) so it lands next to the
              List/Calendar control. The Add button is the only thing in
              the right corner of the row. */}
          <div className="td-search-wrap">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#99c9c4" strokeWidth="2.3">
              <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
            </svg>
            <input
              type="text"
              placeholder="Search by subject, opportunity ID, date…"
              value={q}
              onChange={e => { setQ(e.target.value); setPage(1); }}
            />
          </div>
          <div className="td-toolbar-right">
            {canAdd && (
              <button className="td-add-btn" onClick={openAdd}>
                <IconPlus />
                {tab === 'reminder' ? 'Add Reminder' : 'Add Meeting'}
              </button>
            )}
          </div>
        </div>

        {/* Meeting status sub-filter row (only shown for Meeting tab) */}
        {tab === 'meeting' && (
          <div className="td-meeting-status-row">
            <span className="td-meeting-status-label">
              {meetingSub === 'virtual' ? '💻 VIRTUAL —' : '🏢 PHYSICAL —'}
            </span>
            {MEETING_FILTERS.map(f => {
              const active = meetingFilter === f.key;
              return (
                <button
                  key={f.key}
                  className={`td-sf ${active ? 'active' : ''}`}
                  style={{ height: 34 }}
                  onClick={() => { setMeetingFilter(f.key); setPage(1); }}
                >
                  {f.icon}
                  {f.label}
                  <span className={`td-sf-count td-sf-count-sm ${active ? 'td-sf-count-active' : ''}`}>{meetingStatusCounts[f.key]}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Calendar View ── */}
      {view === 'calendar' && (
        <CalendarSection
          tab={tab}
          meetingSub={meetingSub}
          calYear={calYear}
          calMonth={calMonth}
          calendarMap={calendarMap}
          monthStats={monthStats}
          todayDate={todayDate}
          onPrev={() => {
            setCalMonth(m => {
              if (m === 0) { setCalYear(y => y - 1); return 11; }
              return m - 1;
            });
            setPopover(null);
          }}
          onNext={() => {
            setCalMonth(m => {
              if (m === 11) { setCalYear(y => y + 1); return 0; }
              return m + 1;
            });
            setPopover(null);
          }}
          onToday={() => { setCalYear(todayDate.y); setCalMonth(todayDate.m); setPopover(null); }}
          popover={popover}
          setPopover={setPopover}
          onItemClick={(item) => {
            setPopover(null);
            openEdit(item.ref);
          }}
        />
      )}

      {/* ── Table ── */}
      {view === 'list' && (
      <div className="td-table-card">
        <div className="td-table-wrap" ref={wrapRef}>
          {tab === 'reminder' ? (
            <table className="td-table" style={{ tableLayout: 'fixed' }}>
              <thead>
                <tr>
                  <th style={{ width: '5%' }}>Sr No</th>
                  <th style={{ width: '13%' }}>Opportunity ID</th>
                  <th style={{ width: '34%' }}>Reminder Subject</th>
                  <th style={{ width: '14%' }}>Reminder Set Date</th>
                  <th style={{ width: '10%' }}>TAT</th>
                  <th style={{ width: '12%' }}>Status</th>
                  <th style={{ width: '12%', textAlign: 'center' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr><td colSpan={7} className="td-empty">{loadingData ? 'Loading reminders…' : 'No reminders found'}</td></tr>
                )}
                {(rows as Reminder[]).map((r, i) => {
                  const today = isToday(r.setDate) && r.status === 'In Progress';
                  return (
                    <tr key={r.id} className={today ? 'td-today-row' : ''}>
                      <td><span className="td-sr-pill">{startIdx + i + 1}</span></td>
                      <td><span className="td-opp-id">{r.oppId}</span></td>
                      <td className="td-cell-subject" style={{ fontWeight: 500 }}>
                        <span className="td-subject-text" title={r.subject}>{r.subject}</span>
                      </td>
                      <td className="td-cell-muted">
                        {r.setDate}
                        {today && <span className="td-today-pill">TODAY</span>}
                      </td>
                      <td className="td-cell-muted">{r.tat}</td>
                      <td><StatusBadge status={r.status} /></td>
                      <td>
                        <div className="td-actions">
                          {/* View — read-only details + attachment. Always
                              available (even for completed reminders) so the
                              row can be inspected without entering edit mode
                              (QA bug 31). */}
                          <Tooltip label="View details">
                            <button type="button" className="td-ab td-ab-view" aria-label="View" onClick={() => setViewReminder(r)}><IconEye /></button>
                          </Tooltip>
                          {canEdit && r.status !== 'Done' && (
                            <Tooltip label="Edit">
                              <button type="button" className="td-ab td-ab-edit" aria-label="Edit" onClick={() => openEdit(r)}><IconEdit /></button>
                            </Tooltip>
                          )}
                          {canEdit && r.status === 'Done' && (
                            <Tooltip label="Completed reminders are read-only">
                              <button type="button" aria-disabled="true" className="td-ab td-ab-edit td-ab-muted" aria-label="Edit (disabled)"><IconEdit /></button>
                            </Tooltip>
                          )}
                          {r.status !== 'Done' && canEdit && (
                            <Tooltip label="Mark Done">
                              <button type="button" className="td-ab td-ab-done" aria-label="Mark Done" onClick={() => setMark(r, 'Done')}><IconCheck /></button>
                            </Tooltip>
                          )}
                          {canDel && (
                            <Tooltip label="Delete">
                              <button className="td-ab td-ab-del" aria-label="Delete" onClick={() => del(r)}><IconTrash /></button>
                            </Tooltip>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <table className="td-table td-table-mtg">
              <thead>
                <tr>
                  <th style={{ width: 60 }}>Sr No</th>
                  <th style={{ width: 110 }}>Meeting Code</th>
                  <th style={{ width: 110 }}>Opportunity ID</th>
                  <th>Customer Name</th>
                  <th>Customer Email</th>
                  <th style={{ width: 130 }}>Contact No</th>
                  <th style={{ width: 130 }}>{meetingSub === 'physical' ? 'Meeting Type' : 'Platform'}</th>
                  <th style={{ width: 110 }}>Meeting Date</th>
                  <th style={{ width: 110 }}>Time</th>
                  <th>{meetingSub === 'physical' ? 'Venue' : 'Meeting Link'}</th>
                  <th style={{ width: 130, whiteSpace: 'nowrap' }}>Status</th>
                  <th style={{ width: 170, textAlign: 'center' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr><td colSpan={12} className="td-empty">{loadingData ? 'Loading meetings…' : 'No meetings found'}</td></tr>
                )}
                {(rows as Meeting[]).map((m, i) => {
                  const isPhys = m.type === 'physical';
                  return (
                    <tr key={m.id}>
                      <td><span className="td-sr-pill">{startIdx + i + 1}</span></td>
                      <td>
                        <span className="td-opp-id">{m.code}</span>
                        <span className={`td-mtg-type ${isPhys ? 'td-mtg-type-phys' : 'td-mtg-type-virt'}`}>
                          {isPhys ? 'Physical' : 'Virtual'}
                        </span>
                      </td>
                      <td><span className="td-opp-id">{m.oppId}</span></td>
                      <td className="td-cell-strong">{m.customer}</td>
                      <td className="td-cell-muted td-cell-sm">{m.email}</td>
                      <td className="td-cell-muted">{m.contact}</td>
                      <td style={{ fontWeight: 500 }}>{m.platform}</td>
                      <td className="td-cell-muted">{m.date}</td>
                      <td className="td-cell-muted">{m.startTime}–{m.endTime}</td>
                      <td className="td-cell-ellipsis" title={isPhys ? (m.venue || '') : (m.link || '')}>
                        {isPhys
                          ? <span className="td-cell-muted td-cell-sm">{m.venue || '—'}</span>
                          : (m.link
                              ? <a href={m.link} target="_blank" rel="noreferrer" className="td-cell-link">{m.link.length > 25 ? m.link.slice(0, 25) + '…' : m.link}</a>
                              : <span className="td-cell-empty">—</span>)}
                      </td>
                      <td><StatusBadge status={m.status} /></td>
                      <td>
                        <div className="td-actions">
                          {isPhys ? (
                            // Physical meetings — clicking "View Location" opens the
                            // venue on Google Maps in a new tab. Falls back to a
                            // themed toast when the row has no venue captured,
                            // since a blank maps query is worse than nothing.
                            m.venue ? (
                              <Tooltip label="View on Maps">
                                <a
                                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(m.venue)}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="td-ab td-ab-loc"
                                  aria-label="View on Maps"
                                ><IconLocation /></a>
                              </Tooltip>
                            ) : (
                              <Tooltip label="No venue">
                                <button
                                  className="td-ab td-ab-loc"
                                  aria-label="No venue captured"
                                  onClick={() => toast.info('No venue', 'This meeting doesn’t have a venue captured.')}
                                ><IconLocation /></button>
                              </Tooltip>
                            )
                          ) : (m.link && (
                            // Join is only valid while the meeting is live. Once it's
                            // Postponed or Cancelled the link must not be launchable —
                            // render a greyed-out (disabled) button instead of the
                            // active anchor.
                            (m.status === 'Postponed' || m.status === 'Cancelled') ? (
                              <Tooltip label={`Join disabled — meeting ${m.status.toLowerCase()}`}>
                                <button
                                  type="button"
                                  className="td-ab td-ab-join"
                                  aria-label={`Join disabled — meeting ${m.status.toLowerCase()}`}
                                  disabled
                                  style={{ opacity: 0.4, cursor: 'not-allowed' }}
                                ><IconVideo /></button>
                              </Tooltip>
                            ) : (
                              <Tooltip label="Join Meeting">
                                <a href={m.link} target="_blank" rel="noreferrer" className="td-ab td-ab-join" aria-label="Join Meeting"><IconVideo /></a>
                              </Tooltip>
                            )
                          ))}
                          {canEdit && (
                            // A finalized meeting (Done / Cancelled) must not be
                            // editable — prevents backdated modifications. Greyed
                            // out (disabled); use the Undo action to revert it to
                            // In Progress first if a change is genuinely needed.
                            (m.status === 'Done' || m.status === 'Cancelled') ? (
                              <Tooltip label={`Editing disabled — meeting ${m.status.toLowerCase()}`}>
                                <button
                                  type="button"
                                  className="td-ab td-ab-edit"
                                  aria-label={`Edit disabled — meeting ${m.status.toLowerCase()}`}
                                  disabled
                                  style={{ opacity: 0.4, cursor: 'not-allowed' }}
                                ><IconEdit /></button>
                              </Tooltip>
                            ) : (
                              <Tooltip label="Edit">
                                <button className="td-ab td-ab-edit" aria-label="Edit" onClick={() => openEdit(m)}><IconEdit /></button>
                              </Tooltip>
                            )
                          )}
                          {m.status === 'In Progress' && canEdit && (
                            <>
                              <Tooltip label="Mark Done">
                                <button className="td-ab td-ab-done" aria-label="Mark Done" onClick={() => setMark(m, 'Done')}><IconCheck /></button>
                              </Tooltip>
                              <Tooltip label="Postpone">
                                <button className="td-ab td-ab-post" aria-label="Postpone" onClick={() => setMark(m, 'Postponed')}><IconClock /></button>
                              </Tooltip>
                              <Tooltip label="Cancel">
                                <button className="td-ab td-ab-del" aria-label="Cancel" onClick={() => setMark(m, 'Cancelled')}><IconX /></button>
                              </Tooltip>
                            </>
                          )}
                          {/* Undo / revert — once a meeting is Done, Postponed
                              or Cancelled it can be moved back to In Progress
                              so a mistaken status change is recoverable (QA bug
                              34). */}
                          {m.status !== 'In Progress' && canEdit && (
                            <Tooltip label="Revert to In Progress">
                              <button className="td-ab td-ab-revert" aria-label="Revert to In Progress" onClick={() => setMark(m, 'In Progress')}><IconRevert /></button>
                            </Tooltip>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Pagination — matches screenshot: Showing pill on left, Rows + 1/1 + chevrons on right */}
        <div className="td-pagination">
          <span className="td-pag-info">
            {total === 0
              ? 'Showing 0 of 0'
              : <>Showing <strong>{startIdx + 1}–{Math.min(startIdx + rpp, total)}</strong> of <strong>{total}</strong></>}
          </span>
          <div className="td-pag-btns">
            <span className="td-pag-rows">
              Rows:
              <select value={rpp} onChange={e => { autoFitRef.current = false; setRpp(parseInt(e.target.value, 10)); setPage(1); }}>
                {[...new Set([rpp, ...ROWS_OPTIONS])].sort((a, b) => a - b).map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </span>
            <span className="td-pag-range">{safePage} / {pages}</span>
            <button className="td-pg-btn-icon" disabled={safePage <= 1} onClick={() => setPage(p => Math.max(1, p - 1))} aria-label="Previous page">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6" /></svg>
            </button>
            <button className="td-pg-btn-icon" disabled={safePage >= pages || total === 0} onClick={() => setPage(p => Math.min(pages, p + 1))} aria-label="Next page">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="9 18 15 12 9 6" /></svg>
            </button>
          </div>
        </div>
      </div>
      )}

      {/* ── Add / Edit Modal ── */}
      {modalOpen && (
        <div className="td-overlay" onMouseDown={close}>
          <div className="td-modal" onMouseDown={e => e.stopPropagation()}>
            <div className="td-modal-header">
              <div className="td-modal-header-left">
                <div className="td-modal-header-icon">
                  {tab === 'reminder' ? (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2">
                      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                    </svg>
                  ) : (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2">
                      <polygon points="23 7 16 12 23 17 23 7" />
                      <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
                    </svg>
                  )}
                </div>
                <div>
                  <div className="td-modal-title-row">
                    <span className="td-modal-title">{form.editId ? `Edit ${tab === 'reminder' ? 'Reminder' : 'Meeting'}` : `Add ${tab === 'reminder' ? 'Reminder' : 'Meeting'}`}</span>
                    <span className="td-modal-pill">{tab === 'reminder' ? 'REMINDER' : 'MEETING'}</span>
                  </div>
                  <div className="td-modal-sub">{tab === 'reminder' ? 'Reminder' : 'Meeting'}</div>
                </div>
              </div>
              <button className="td-modal-close" onClick={close}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="td-modal-body">
              {tab === 'reminder' ? (
                <>
                  {/* Reminder form — matches prototype layout */}
                  <div className="td-form-row">
                    <Field label="Opportunity ID">
                      <MasterSelect
                        value={form.oppId || ''}
                        placeholder="— Select opportunity —"
                        options={oppPickerOptions}
                        onSearchChange={handleOppSearch}
                        onScrollEnd={handleOppScrollEnd}
                        loadingMore={oppLoadingMore}
                        onChange={v => setForm(p => ({
                          ...p,
                          oppId: v,
                          // Opportunity Date is derived from the chosen
                          // opportunity's real query/created date. Clearing the
                          // opportunity clears the date (QA bug 29).
                          oppDate: oppDateFor(v),
                        }))}
                      />
                    </Field>
                    <Field label="Opportunity Date">
                      <MasterDatePicker
                        value={toInputDate(form.oppDate)}
                        onChange={() => { /* derived — not user-editable */ }}
                        placeholder="Auto-filled from opportunity"
                        disabled
                      />
                    </Field>
                  </div>
                  <div className="td-form-row">
                    <Field label="Status">
                      <MasterSelect
                        value={form.status || 'In Progress'}
                        options={[
                          { value: 'In Progress', label: 'In Progress' },
                          { value: 'Done',        label: 'Done' },
                        ]}
                        onChange={v => setForm(p => ({ ...p, status: v as Reminder['status'] }))}
                      />
                    </Field>
                    <Field label="Reminder Subject" required>
                      {(() => {
                        const v = form.subject || '';
                        // Single rule: only letters, digits and spaces allowed.
                        const invalid = v.length > 0 && !/^[A-Za-z0-9 ]+$/.test(v);
                        return (
                          <>
                            <input
                              className={`td-inp ${invalid ? 'td-inp-invalid' : ''}`}
                              value={v}
                              maxLength={255}
                              onChange={e => setForm(p => ({ ...p, subject: e.target.value }))}
                              placeholder="Subject"
                              aria-invalid={invalid || undefined}
                            />
                            {invalid && <span className="td-inline-err">Special characters are not allowed.</span>}
                          </>
                        );
                      })()}
                    </Field>
                  </div>
                  <div className="td-form-row">
                    <Field label="Reminder Set Date" required>
                      <MasterDatePicker
                        value={toInputDate(form.setDate)}
                        onChange={iso => setForm(p => ({ ...p, setDate: fromInputDate(iso) }))}
                        placeholder="dd-mm-yyyy"
                        // Reminders can't be dated in the past — applies to both
                        // add AND edit, so editing a row also can't pick an old date.
                        minDate={toInputDate(TODAY_STR)}
                      />
                    </Field>
                    <Field label="TAT" required>
                      <MasterSelect
                        value={form.tat || ''}
                        placeholder="Select TAT"
                        options={TAT_OPTIONS.map(t => ({ value: t, label: t }))}
                        onChange={v => setForm(p => ({ ...p, tat: v }))}
                      />
                    </Field>
                  </div>
                  <div className="td-form-row">
                    <div className="td-field">
                      <label className="td-label">Attachment</label>

                      {/* Existing attachment — only shows in Edit mode when a
                          file is already on file AND the user hasn't picked a
                          replacement yet. Clicking the link opens / downloads
                          the file in a new tab. "Replace" / "Remove" buttons
                          let the user swap in a new file or detach. */}
                      {form.attachmentUrl && !form.attachmentFile && (
                        <div className="td-file-existing">
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#0d9488" strokeWidth="2.2" style={{ flexShrink: 0 }}>
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                            <polyline points="14 2 14 8 20 8" />
                          </svg>
                          <a href={form.attachmentUrl} target="_blank" rel="noreferrer" className="td-file-existing-link" title={form.attachmentName || 'Open attachment'}>
                            {form.attachmentName || 'Open attachment'}
                          </a>
                          <button
                            type="button"
                            className="td-file-replace"
                            onClick={() => document.getElementById('tdF_attachment')?.click()}
                          >
                            Replace
                          </button>
                          <button
                            type="button"
                            className="td-file-remove"
                            onClick={() => setForm(p => ({ ...p, attachmentUrl: undefined, attachmentName: '', attachmentFile: null }))}
                            title="Detach current file"
                          >
                            ×
                          </button>
                        </div>
                      )}

                      {/* Dropzone — shown when there's no existing attachment
                          OR after the user picked a replacement file. */}
                      {(!form.attachmentUrl || form.attachmentFile) && (
                        <label htmlFor="tdF_attachment" className="td-file-drop">
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#14b8a6" strokeWidth="2.2" style={{ flexShrink: 0 }}>
                            <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
                          </svg>
                          <span className="td-file-label">{form.attachmentFile?.name || form.attachmentName || 'Choose file…'}</span>
                          {form.attachmentFile && (
                            <button
                              type="button"
                              className="td-file-clear"
                              onClick={(e) => { e.preventDefault(); setForm(p => ({ ...p, attachmentFile: null, attachmentName: '' })); }}
                              title="Clear selection"
                            >×</button>
                          )}
                        </label>
                      )}
                      <input
                        type="file" id="tdF_attachment" style={{ display: 'none' }}
                        accept=".png,.jpg,.jpeg,.pdf,.doc,.docx,.xls,.xlsx,.csv"
                        onChange={e => {
                          const f = e.target.files?.[0];
                          // Reject too-large files client-side BEFORE the user
                          // hits Save — saves an upload of useless bytes and
                          // shows the message inline next to the field. Cap
                          // mirrors the backend's ATTACH_MAX_KB (20 MB).
                          const MAX_BYTES = 20 * 1024 * 1024;
                          if (f && f.size > MAX_BYTES) {
                            setFormErrors([`Attachment is too large (${(f.size / 1024 / 1024).toFixed(1)} MB). Please upload a file under 20 MB.`]);
                            e.target.value = '';
                            return;
                          }
                          setFormErrors([]);
                          setForm(p => ({ ...p, attachmentName: f ? f.name : '', attachmentFile: f || null }));
                        }}
                      />
                    </div>
                    <Field label="Remark">
                      <textarea
                        className="td-inp"
                        rows={3}
                        value={form.remark || ''}
                        maxLength={2000}
                        onChange={e => setForm(p => ({ ...p, remark: e.target.value }))}
                        placeholder="Add a remark or note…"
                        // Fixed height matches the ATTACHMENT box so the two
                        // fields stay identical (rows=3 alone rendered taller).
                        style={{ resize: 'none', height: 76 }}
                      />
                      <span className="td-char-count">{(form.remark || '').length}/2000</span>
                    </Field>
                  </div>
                </>
              ) : (
                <>
                  {/* Virtual/Physical toggle at top */}
                  <div className="td-mtg-toggle">
                    <button
                      type="button"
                      className={`td-mtg-toggle-btn ${meetingSub === 'virtual' ? 'active' : ''}`}
                      onClick={() => { setMeetingSub('virtual'); setForm(p => ({ ...p, type: 'virtual', platform: '', platformOther: '' })); setMtgErr({}); }}
                    >
                      <IconCam /> 💻 Virtual Meeting
                    </button>
                    <button
                      type="button"
                      className={`td-mtg-toggle-btn ${meetingSub === 'physical' ? 'active' : ''}`}
                      onClick={() => { setMeetingSub('physical'); setForm(p => ({ ...p, type: 'physical', platform: '', platformOther: '' })); setMtgErr({}); }}
                    >
                      <IconPin /> 🏢 Physical Meeting
                    </button>
                  </div>

                  {/* Opportunity picker — selecting an opportunity auto-fills
                      its Opportunity Date (read-only). */}
                  <div className="td-form-row">
                    <Field label="Opportunity ID">
                      <MasterSelect
                        value={form.oppId || ''}
                        placeholder="— Select opportunity —"
                        options={oppPickerOptions}
                        onSearchChange={handleOppSearch}
                        onScrollEnd={handleOppScrollEnd}
                        loadingMore={oppLoadingMore}
                        onChange={v => {
                          const name  = oppCustomerFor(v);
                          const email = oppEmailFor(v);
                          const phone = oppContactFor(v);
                          const cp    = splitContact(phone);
                          // Auto-fill the opportunity's PRIMARY CONTACT PERSON —
                          // name, email AND phone (split into country-code +
                          // number). Keep any manually-typed value when the
                          // contact person is missing that field.
                          setForm(p => ({
                            ...p,
                            oppId: v,
                            oppDate: oppDateFor(v),
                            customer:    name || p.customer,
                            email:       email || p.email,
                            contact:     phone ? cp.local : p.contact,
                            countryCode: phone ? cp.code : (p.countryCode || '+91'),
                          }));
                          // Clear the inline error on any field we just filled.
                          setMtgErr(e => ({
                            ...e,
                            ...(name  ? { customer: '' } : {}),
                            ...(email ? { email: '' }    : {}),
                            ...(phone ? { contact: '' }  : {}),
                          }));
                        }}
                      />
                    </Field>
                    <Field label="Opportunity Date">
                      <input
                        className="td-inp"
                        value={form.oppDate || oppDateFor(form.oppId || '')}
                        readOnly
                        placeholder="Auto-filled from opportunity"
                      />
                    </Field>
                  </div>

                  <div className="td-form-row">
                    <Field label="Person Name" required error={mtgErr.customer}>
                      <input className={`td-inp ${mtgErr.customer ? 'td-inp-err' : ''}`} value={form.customer || ''} onChange={e => { setForm(p => ({ ...p, customer: e.target.value })); clearMtgErr('customer'); }} placeholder="Person name" />
                    </Field>
                    <Field label="Person Email" required error={mtgErr.email}>
                      <input
                        className={`td-inp ${mtgErr.email ? 'td-inp-err' : ''}`}
                        type="email"
                        maxLength={191}
                        value={form.email || ''}
                        onChange={e => { setForm(p => ({ ...p, email: e.target.value })); clearMtgErr('email'); }}
                        placeholder="Email address"
                      />
                    </Field>
                  </div>
                  <div className="td-form-row">
                    <Field label="Contact No" required error={mtgErr.contact}>
                      {/* Country code dropdown + local number. The two combine
                          into a single stored contact on save (QA bug 34). */}
                      <div className="td-contact-row">
                        <select
                          className="td-inp td-cc-select"
                          value={form.countryCode || '+91'}
                          onChange={e => setForm(p => ({ ...p, countryCode: e.target.value }))}
                          aria-label="Country code"
                        >
                          {COUNTRY_CODES.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                        <input
                          className={`td-inp ${mtgErr.contact ? 'td-inp-err' : ''}`}
                          type="tel"
                          inputMode="tel"
                          maxLength={15}
                          value={form.contact || ''}
                          onChange={e => {
                            // Local number only — digits, spaces and dashes.
                            // The country code lives in the dropdown beside it.
                            const cleaned = e.target.value.replace(/[^\d\s\-]/g, '');
                            setForm(p => ({ ...p, contact: cleaned }));
                            clearMtgErr('contact');
                          }}
                          placeholder="e.g. 98765 43210"
                        />
                      </div>
                    </Field>
                    <Field label={meetingSub === 'physical' ? 'Meeting Type / Format' : 'Platform'} required error={mtgErr.platform}>
                      <MasterSelect
                        value={form.platform || ''}
                        placeholder={meetingSub === 'physical' ? 'Select type' : 'Select platform'}
                        options={(meetingSub === 'physical' ? PHYSICAL_PLATFORMS : VIRTUAL_PLATFORMS).map(p => ({ value: p, label: p }))}
                        invalid={!!mtgErr.platform}
                        onChange={v => { setForm(p => ({ ...p, platform: v, platformOther: v === 'Other' ? p.platformOther : '' })); clearMtgErr('platform'); }}
                      />
                      {/* Free-text capture when "Other" is picked (QA bug 34). */}
                      {form.platform === 'Other' && (
                        <input
                          className={`td-inp ${mtgErr.platform ? 'td-inp-err' : ''}`}
                          style={{ marginTop: 6 }}
                          value={form.platformOther || ''}
                          maxLength={100}
                          onChange={e => { setForm(p => ({ ...p, platformOther: e.target.value })); clearMtgErr('platform'); }}
                          placeholder={meetingSub === 'physical' ? 'Specify meeting type…' : 'Specify platform…'}
                        />
                      )}
                    </Field>
                  </div>
                  {meetingSub === 'virtual' ? (
                    <Field label="Meeting Link" required colSpan={2} error={mtgErr.link}>
                      <input className={`td-inp ${mtgErr.link ? 'td-inp-err' : ''}`} value={form.link || ''} onChange={e => { setForm(p => ({ ...p, link: e.target.value })); clearMtgErr('link'); }} placeholder="https://..." />
                    </Field>
                  ) : (
                    <Field label="Place / Venue" required colSpan={2} error={mtgErr.venue}>
                      <input className={`td-inp ${mtgErr.venue ? 'td-inp-err' : ''}`} value={form.venue || ''} onChange={e => { setForm(p => ({ ...p, venue: e.target.value })); clearMtgErr('venue'); }} placeholder="e.g. Mumbai Head Office, BKC" />
                    </Field>
                  )}
                  <div className="td-form-row td-form-row-3">
                    <Field label="Meeting Date" required error={mtgErr.date}>
                      <MasterDatePicker
                        value={toInputDate(form.date)}
                        onChange={iso => { setForm(p => ({ ...p, date: fromInputDate(iso) })); clearMtgErr('date'); }}
                        placeholder="dd-mm-yyyy"
                        invalid={!!mtgErr.date}
                        // Meetings can't be scheduled in the past — applies to both
                        // add AND edit, so editing a row also can't pick an old date.
                        minDate={toInputDate(TODAY_STR)}
                      />
                    </Field>
                    <Field label="Start Time" required error={mtgErr.startTime}>
                      <MasterTimePicker
                        value={form.startTime || ''}
                        onChange={v => { setForm(p => ({ ...p, startTime: v })); clearMtgErr('startTime'); clearMtgErr('endTime'); }}
                        placeholder="--:--"
                        invalid={!!mtgErr.startTime}
                        accent="teal"
                        // Today → can't start before now.
                        minTime={form.date === TODAY_STR ? hmNow() : undefined}
                      />
                    </Field>
                    <Field label="End Time" required error={mtgErr.endTime}>
                      <MasterTimePicker
                        value={form.endTime || ''}
                        onChange={v => { setForm(p => ({ ...p, endTime: v })); clearMtgErr('endTime'); }}
                        placeholder="--:--"
                        invalid={!!mtgErr.endTime}
                        accent="teal"
                        // End must be ≥ Start + 15 min (min meeting length), and
                        // also ≥ now when the meeting is today.
                        minTime={(() => {
                          const floors = [
                            form.startTime ? addHm(form.startTime, 15) : '',
                            form.date === TODAY_STR ? hmNow() : '',
                          ].filter(Boolean) as string[];
                          return floors.length ? floors.sort().slice(-1)[0] : undefined;
                        })()}
                      />
                    </Field>
                  </div>
                  <Field label="Meeting Agenda" required colSpan={2} error={mtgErr.agenda}>
                    <textarea className={`td-inp ${mtgErr.agenda ? 'td-inp-err' : ''}`} rows={2} value={form.agenda || ''} onChange={e => { setForm(p => ({ ...p, agenda: e.target.value })); clearMtgErr('agenda'); }} placeholder="Meeting agenda..." style={{ resize: 'none', minHeight: 52 }} />
                  </Field>
                </>
              )}
              {formErrors.length > 0 && (
                <div className="td-form-error" role="alert">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" style={{ flexShrink: 0, marginTop: 1 }}>
                    <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                  {formErrors.length === 1
                    ? <span>{formErrors[0]}</span>
                    : (
                      <ul className="td-form-error-list">
                        {formErrors.map((msg, i) => <li key={i}>{msg}</li>)}
                      </ul>
                    )}
                </div>
              )}
            </div>
            <div className="td-modal-footer">
              <div className="td-footer-hint">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
                Fields marked <span className="td-req">*</span> are required
              </div>
              <div className="td-footer-actions">
                <button type="button" className="td-btn-cancel" onClick={close} disabled={saving}>Cancel</button>
                <button type="button" className="td-btn-save" onClick={save} disabled={saving}>
                  {saving ? (
                    <>
                      <span className="td-spinner" aria-hidden />
                      {form.editId ? 'Updating…' : 'Saving…'}
                    </>
                  ) : (
                    <>
                      {form.editId
                        ? (<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" /></svg>)
                        : (<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /></svg>)}
                      {form.editId ? 'Update' : 'Save'}
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Reminder View (read-only) Modal ── */}
      {viewReminder && (
        <div className="td-overlay" onMouseDown={() => setViewReminder(null)}>
          <div className="td-modal td-view-modal" onMouseDown={e => e.stopPropagation()}>
            <div className="td-modal-header">
              <div className="td-modal-header-left">
                <div className="td-modal-header-icon">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2">
                    <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" /><circle cx="12" cy="12" r="3" />
                  </svg>
                </div>
                <div>
                  <div className="td-modal-title-row">
                    <span className="td-modal-title">Reminder Details</span>
                    <span className="td-modal-pill">REMINDER</span>
                  </div>
                  <div className="td-modal-sub">Read-only</div>
                </div>
              </div>
              <button className="td-modal-close" onClick={() => setViewReminder(null)}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="td-modal-body">
              <div className="td-view-grid">
                <div className="td-view-item"><span className="td-view-label">Opportunity ID</span><span className="td-view-val">{viewReminder.oppId || '—'}</span></div>
                <div className="td-view-item"><span className="td-view-label">Opportunity Date</span><span className="td-view-val">{viewReminder.oppDate || '—'}</span></div>
                <div className="td-view-item td-view-item-full"><span className="td-view-label">Subject</span><span className="td-view-val">{viewReminder.subject || '—'}</span></div>
                <div className="td-view-item"><span className="td-view-label">Set Date</span><span className="td-view-val">{viewReminder.setDate || '—'}</span></div>
                <div className="td-view-item"><span className="td-view-label">TAT</span><span className="td-view-val">{viewReminder.tat || '—'}</span></div>
                <div className="td-view-item"><span className="td-view-label">Status</span><span className="td-view-val"><StatusBadge status={viewReminder.status} /></span></div>
                <div className="td-view-item"><span className="td-view-label">Attachment</span>
                  <span className="td-view-val">
                    {viewReminder.attachmentUrl
                      ? <a href={viewReminder.attachmentUrl} target="_blank" rel="noreferrer" className="td-cell-link">{viewReminder.attachmentName || 'Open attachment'}</a>
                      : '—'}
                  </span>
                </div>
                <div className="td-view-item td-view-item-full"><span className="td-view-label">Remark</span><span className="td-view-val td-view-val-multiline">{viewReminder.remark || '—'}</span></div>
              </div>
            </div>
            <div className="td-modal-footer">
              <div className="td-footer-hint" />
              <div className="td-footer-actions">
                <button type="button" className="td-btn-cancel" onClick={() => setViewReminder(null)}>Close</button>
                {canEdit && viewReminder.status !== 'Done' && (
                  <button type="button" className="td-btn-save" onClick={() => { const r = viewReminder; setViewReminder(null); openEdit(r); }}>
                    <IconEdit /> Edit
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────
 * Calendar view section.
 * Shown when `view === 'calendar'` in place of the list table.
 * Cell click opens a popover; pill click opens the edit modal.
 * ──────────────────────────────────────────────────────────────────── */
type CalItemForSection = { key: string; date: string; title: string; status: string; ref: Reminder | Meeting };
const CAL_MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const CAL_DAY_NAMES   = ['SUN','MON','TUE','WED','THU','FRI','SAT'];
const CAL_COLORS = [
  { bg:'#eff6ff', br:'#bfdbfe', bar:'#3b82f6', clr:'#1e40af' },
  { bg:'#f5f3ff', br:'#ddd6fe', bar:'#8b5cf6', clr:'#5b21b6' },
  { bg:'#fff7ed', br:'#fed7aa', bar:'#f97316', clr:'#9a3412' },
  { bg:'#fdf2f8', br:'#fbcfe8', bar:'#ec4899', clr:'#9d174d' },
  { bg:'#f0fdf4', br:'#bbf7d0', bar:'#22c55e', clr:'#166534' },
  { bg:'#fefce8', br:'#fef08a', bar:'#eab308', clr:'#854d0e' },
];
function calColor(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 37 + s.charCodeAt(i)) & 0xffff;
  return CAL_COLORS[h % CAL_COLORS.length];
}

function CalendarSection(props: {
  tab: TopTab;
  meetingSub: MeetingSub;
  calYear: number;
  calMonth: number;
  calendarMap: Record<string, CalItemForSection[]>;
  monthStats: { total: number; inProgress: number; done: number };
  todayDate: { d: number; m: number; y: number };
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  popover: { dateKey: string; x: number; y: number } | null;
  setPopover: (p: { dateKey: string; x: number; y: number } | null) => void;
  onItemClick: (item: CalItemForSection) => void;
}) {
  const { tab, meetingSub, calYear, calMonth, calendarMap, monthStats, todayDate,
          onPrev, onNext, onToday, popover, setPopover, onItemClick } = props;

  // Draggable popover: once the user drags it, dragPos overrides the anchored position.
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);

  // Reset drag position whenever a new day popover opens.
  useEffect(() => { setDragPos(null); }, [popover?.dateKey, popover?.x, popover?.y]);

  const onDragStart = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const pop = document.getElementById('td-cal-popover');
    if (!pop) return;
    const rect = pop.getBoundingClientRect();
    dragRef.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const w = pop.offsetWidth, h = pop.offsetHeight;
      const nx = Math.max(8, Math.min(ev.clientX - dragRef.current.dx, window.innerWidth  - w - 8));
      const ny = Math.max(8, Math.min(ev.clientY - dragRef.current.dy, window.innerHeight - h - 8));
      setDragPos({ x: nx, y: ny });
    };
    const onUp = () => {
      dragRef.current = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  const firstDay  = new Date(calYear, calMonth, 1).getDay();          // 0 = Sun
  const daysIn    = new Date(calYear, calMonth + 1, 0).getDate();
  const prevDaysIn = new Date(calYear, calMonth, 0).getDate();
  const trailing = (7 - ((firstDay + daysIn) % 7)) % 7;

  const headerTitle = tab === 'meeting'
    ? (meetingSub === 'virtual' ? 'Virtual Meetings' : 'Physical Meetings')
    : 'Reminder Calendar';
  const headerSub = tab === 'meeting' ? 'Meeting Calendar' : 'Productivity Tracker';

  const onPillClick = (e: React.MouseEvent, dateKey: string) => {
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setPopover({ dateKey, x: rect.left + 8, y: rect.bottom + 8 });
  };

  // Close popover on outside click
  useEffect(() => {
    if (!popover) return;
    const handler = (ev: MouseEvent) => {
      const pop = document.getElementById('td-cal-popover');
      if (pop && !pop.contains(ev.target as Node)) setPopover(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [popover, setPopover]);

  const cells: React.ReactNode[] = [];

  // Leading blanks (prev month)
  for (let b = 0; b < firstDay; b++) {
    const pD = prevDaysIn - firstDay + b + 1;
    cells.push(
      <div key={`p-${b}`} className="td-cal-cell td-cal-cell-out">
        <div className="td-cal-cell-out-num">{pD}</div>
      </div>
    );
  }

  // Current month
  for (let d = 1; d <= daysIn; d++) {
    const dd = String(d).padStart(2, '0');
    const mm = String(calMonth + 1).padStart(2, '0');
    const key = `${dd}/${mm}/${calYear}`;
    const items = calendarMap[key] || [];
    const dow = (firstDay + d - 1) % 7;
    const isToday = (d === todayDate.d && calMonth === todayDate.m && calYear === todayDate.y);
    const isWE = (dow === 0 || dow === 6);
    const cellCls = `td-cal-cell ${isToday ? 'td-cal-cell-today' : isWE ? 'td-cal-cell-weekend' : ''}`;
    const pills = items.slice(0, 3).map(it => {
      const c = calColor(it.ref.id + ':' + it.title);
      const short = it.title.length > 21 ? it.title.slice(0, 21) + '…' : it.title;
      return (
        <div
          key={it.key}
          className="td-cal-pill"
          style={{ background: c.bg, color: c.clr, borderLeft: `3px solid ${c.bar}` }}
          title={it.title}
          onClick={(e) => onPillClick(e, key)}
        >
          {short}
        </div>
      );
    });
    const more = items.length > 3 ? (
      <div className="td-cal-more" onClick={(e) => onPillClick(e, key)}>+{items.length - 3} more</div>
    ) : null;

    cells.push(
      <div key={`d-${d}`} className={cellCls}>
        {isWE && !isToday && <div className="td-cal-weekend-stripe" />}
        <div className="td-cal-cell-head">
          {isToday
            ? <div className="td-cal-today-num">{d}</div>
            : <div className={`td-cal-num ${isWE ? 'td-cal-num-we' : ''}`}>{d}</div>}
          {items.length > 0 && (
            <span className="td-cal-count">{items.length}</span>
          )}
        </div>
        {pills}
        {more}
      </div>
    );
  }

  // Trailing blanks
  for (let t = 0; t < trailing; t++) {
    cells.push(
      <div key={`t-${t}`} className="td-cal-cell td-cal-cell-out">
        <div className="td-cal-cell-out-num">{t + 1}</div>
      </div>
    );
  }

  // Popover content
  let popoverEl: React.ReactNode = null;
  if (popover) {
    const list = calendarMap[popover.dateKey] || [];
    const parts = popover.dateKey.split('/');
    // Clamp the popover's anchor so it never bleeds below the fold (QA
    // 15/16/17). The list caps at 3 rows (~188px) + header (~68px), so the box
    // is ~260px tall; reserve that here so the position math and the actual
    // box agree regardless of screen size.
    const POP_MAX_H = Math.min(280, window.innerHeight - 24);
    const popLeft = dragPos ? dragPos.x : Math.max(8, Math.min(popover.x, window.innerWidth - 360));
    const popTop  = dragPos ? dragPos.y : Math.max(12, Math.min(popover.y, window.innerHeight - POP_MAX_H - 12));
    const label = `${parts[0]} ${CAL_MONTH_NAMES[parseInt(parts[1], 10) - 1]} ${parts[2]}`;
    const inN = list.filter(i => i.status === 'In Progress').length;
    const dnN = list.filter(i => i.status === 'Done').length;
    popoverEl = (
      <div
        id="td-cal-popover"
        className="td-cal-popover"
        style={{ left: popLeft, top: popTop }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="td-cal-popover-hdr" onMouseDown={onDragStart}>
          <span className="td-cal-popover-grip" aria-hidden="true">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="8" cy="6" r="1.6"/><circle cx="8" cy="12" r="1.6"/><circle cx="8" cy="18" r="1.6"/><circle cx="16" cy="6" r="1.6"/><circle cx="16" cy="12" r="1.6"/><circle cx="16" cy="18" r="1.6"/></svg>
          </span>
          <div className="td-cal-popover-hdr-main">
            <div className="td-cal-popover-title">{label}</div>
            <div className="td-cal-popover-meta">
              <span className="td-cal-popover-chip">{list.length} {tab === 'meeting' ? 'Meeting' : 'Reminder'}{list.length !== 1 ? 's' : ''}</span>
              {inN > 0 && <span className="td-cal-popover-chip">{inN} In Progress</span>}
              {dnN > 0 && <span className="td-cal-popover-chip">{dnN} Done</span>}
            </div>
          </div>
          <button className="td-cal-popover-close" onMouseDown={(e) => e.stopPropagation()} onClick={() => setPopover(null)} aria-label="Close">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div className="td-cal-popover-list">
          {list.map(it => {
            const c = calColor(it.ref.id + ':' + it.title);
            const isDone = it.status === 'Done';
            return (
              <div key={it.key} className="td-cal-popover-row" onClick={() => onItemClick(it)}>
                <div className="td-cal-popover-bar" style={{ background: c.bar }} />
                <div className="td-cal-popover-body">
                  <div className="td-cal-popover-row-title">{it.title}</div>
                  <div className="td-cal-popover-row-meta">
                    {tab === 'meeting' ? (
                      <>
                        <span className="td-cal-popover-pill" style={{ color: c.clr, background: c.bg, border: `1px solid ${c.br}` }}>
                          {(it.ref as Meeting).code}
                        </span>
                        <span className="td-cal-popover-pill td-cal-popover-pill-muted">{(it.ref as Meeting).platform}</span>
                        <span className="td-cal-popover-pill td-cal-popover-pill-muted">
                          {(it.ref as Meeting).startTime}–{(it.ref as Meeting).endTime}
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="td-cal-popover-pill" style={{ color: c.clr, background: c.bg, border: `1px solid ${c.br}` }}>
                          {(it.ref as Reminder).oppId}
                        </span>
                        <span className="td-cal-popover-pill td-cal-popover-pill-muted">{(it.ref as Reminder).tat}</span>
                      </>
                    )}
                    <span className={`td-cal-popover-status ${isDone ? 'td-cal-popover-status-done' : 'td-cal-popover-status-inprog'}`}>
                      {it.status}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="td-cal-topbar">
        <div className="td-cal-topbar-left">
          <div className="td-cal-topbar-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2">
              <rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
            </svg>
          </div>
          <div>
            <div className="td-cal-topbar-title">{headerTitle}</div>
            <div className="td-cal-topbar-sub">{headerSub}</div>
          </div>
          <div className="td-cal-topbar-divider" />
          <button className="td-cal-today-btn" onClick={onToday}>Today</button>
          <div className="td-cal-nav">
            <button onClick={onPrev} aria-label="Previous month">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8"><polyline points="15 18 9 12 15 6" /></svg>
            </button>
            <button onClick={onNext} aria-label="Next month">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8"><polyline points="9 18 15 12 9 6" /></svg>
            </button>
          </div>
          <span className="td-cal-month-label">{CAL_MONTH_NAMES[calMonth]} {calYear}</span>
        </div>
        <div className="td-cal-topbar-right">
          <span className="td-cal-stat">{monthStats.total} this month</span>
          <span className="td-cal-stat td-cal-stat-inprog">{monthStats.inProgress} In Progress</span>
          <span className="td-cal-stat td-cal-stat-done">{monthStats.done} Done</span>
        </div>
      </div>

      <div className="td-cal-card">
        <div className="td-cal-day-hdr">
          {/* Use the anchored `todayDate` (computed at module load) rather
              than a live `new Date()` here — otherwise the highlighted
              weekday column drifts across midnight while the page stays
              open, getting out of sync with the `td-cal-cell-today` cell. */}
          {(() => {
            const todayDow = new Date(todayDate.y, todayDate.m, todayDate.d).getDay();
            return CAL_DAY_NAMES.map((d, i) => {
              const isTdHdr = (i === todayDow && calMonth === todayDate.m && calYear === todayDate.y);
              return <div key={d} className={`td-cal-day-hdr-cell ${isTdHdr ? 'td-cal-day-hdr-today' : ''} ${(i===0||i===6) ? 'td-cal-day-hdr-we' : ''}`}>{d}</div>;
            });
          })()}
        </div>
        <div className="td-cal-grid">{cells}</div>
      </div>

      {popoverEl}
    </>
  );
}

/* ── Form field helper ── */
function Field({ label, required, colSpan, error, children }: { label: string; required?: boolean; colSpan?: 1 | 2; error?: string; children: React.ReactNode }) {
  return (
    <div className="td-field" style={colSpan === 2 ? { gridColumn: 'span 2' } : undefined}>
      <label className="td-label">{label} {required && <span className="td-req">*</span>}</label>
      {children}
      {error && <div className="td-field-err">{error}</div>}
    </div>
  );
}

/* ─── Date helpers: bridge dd/mm/yyyy ↔ HTML5 date input (yyyy-mm-dd) ─── */
function toInputDate(d?: string) {
  if (!d) return '';
  const p = d.split('/');
  if (p.length !== 3) return '';
  return `${p[2]}-${p[1]}-${p[0]}`;
}
function fromInputDate(d?: string) {
  if (!d) return '';
  const p = d.split('-');
  if (p.length !== 3) return '';
  return `${p[2]}/${p[1]}/${p[0]}`;
}

/* Split a stored contact string ("<code> <number>") into its dialing-code
 * and local-number parts so the edit form can re-hydrate the country-code
 * dropdown. Falls back to +91 when no leading code is present. */
function splitContact(raw?: string): { code: string; local: string } {
  const v = (raw || '').trim();
  const m = /^(\+\d{1,4})[\s-]+(.+)$/.exec(v);
  if (m) return { code: m[1], local: m[2].trim() };
  return { code: '+91', local: v };
}

/* ─── TdSelect — themed dropdown that matches the rest of the form.
 *  Native <select> elements can't be styled when their options panel is
 *  open (browsers refuse to honour CSS on <option>), so we build a tiny
 *  custom dropdown using a styled trigger + portal-less menu. Keeps the
 *  teal palette consistent end-to-end. Falls back to a plain trigger
 *  string when no option matches the value. ──────────────────────────── */
function TdSelect(props: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const { value, options, onChange, placeholder = 'Select…' } = props;
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const rootRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  // Reset the filter every time the menu closes so the next open is fresh,
  // and auto-focus the search input when the menu opens (mirrors how
  // MasterSelect behaves so the two read as siblings).
  useEffect(() => {
    if (!open) { setSearch(''); return; }
    // setTimeout shoves the focus past the click that just opened the menu —
    // otherwise React re-renders steal it back on the same tick.
    const id = window.setTimeout(() => searchInputRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const selected = options.find(o => o.value === value);
  // Only show the search row when there are enough options to make
  // scrolling annoying — keeps short status/yes-no dropdowns clean.
  const showSearch = options.length > 4;
  const lo = search.trim().toLowerCase();
  const filtered = lo
    ? options.filter(o => o.label.toLowerCase().includes(lo) || o.value.toLowerCase().includes(lo))
    : options;

  return (
    <div ref={rootRef} className={`td-cs ${open ? 'is-open' : ''}`}>
      <button
        type="button"
        className="td-cs-trigger"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className={`td-cs-value ${selected ? '' : 'is-placeholder'}`}>
          {selected ? selected.label : placeholder}
        </span>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <div className="td-cs-menu" role="listbox">
          {showSearch && (
            <div className="td-cs-search" onMouseDown={e => e.stopPropagation()}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2.3">
                <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
              </svg>
              <input
                ref={searchInputRef}
                type="text"
                placeholder="Search…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                onKeyDown={e => { if (e.key !== 'Escape') e.stopPropagation(); }}
              />
            </div>
          )}
          <div className="td-cs-list">
            {filtered.length === 0 ? (
              <div className="td-cs-empty">No results</div>
            ) : filtered.map(o => (
              <button
                key={o.value || '__empty'}
                type="button"
                role="option"
                aria-selected={o.value === value}
                className={`td-cs-opt ${o.value === value ? 'is-active' : ''}`}
                onClick={() => { onChange(o.value); setOpen(false); }}
              >
                {o.label}
                {o.value === value && (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6"><polyline points="20 6 9 17 4 12" /></svg>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Status badge (colored dot + text) ─── */
function StatusBadge({ status }: { status: string }) {
  const cls =
    status === 'Done' ? 'td-done' :
    status === 'In Progress' ? 'td-inprog' :
    status === 'Postponed' ? 'td-post' : 'td-cancel';
  return (
    <span className={`td-badge ${cls}`}>
      <span className="td-badge-dot" />
      {status}
    </span>
  );
}

/* ─── Icons ─── */
const IconPlus = () => <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>;
const IconX        = () => <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>;
const IconLocation = () => <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>;
const IconList = () => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3"><line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" /></svg>;
const IconCal  = () => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3"><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>;
const IconCheck = () => <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>;
const IconEdit  = () => <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4z" /></svg>;
const IconTrash = () => <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /></svg>;
const IconVideo = () => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><polygon points="23 7 16 12 23 17 23 7" /><rect x="1" y="5" width="15" height="14" rx="2" ry="2" /></svg>;
const IconClock = () => <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>;
const IconCam   = () => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><polygon points="23 7 16 12 23 17 23 7" /><rect x="1" y="5" width="15" height="14" rx="2" ry="2" /></svg>;
const IconPin   = () => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></svg>;
const IconEye   = () => <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" /><circle cx="12" cy="12" r="3" /></svg>;
const IconRevert = () => <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3"><polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" /></svg>;
