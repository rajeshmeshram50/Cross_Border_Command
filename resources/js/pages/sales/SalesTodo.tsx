import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import api from '../../api';
import { useToast } from '../../contexts/ToastContext';
import { useAuth } from '../../contexts/AuthContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import Tooltip from '../../components/ui/Tooltip';
import { MasterSelect } from '../../components/ui/MasterSelect';
import { MasterDatePicker } from '../../components/ui/MasterDatePicker';
import { MasterTimePicker } from '../../components/ui/MasterTimePicker';
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
  const [oppOptions, setOppOptions] = useState<{ value: string; label: string; date: string }[]>([]);
  // Admins (super_admin / client_admin / main_branch_user) see the whole tenant
  // by default; everyone else sees their own rows. Mirrors the controller's
  // applyScope() — the SPA just hints at which scope to ask for.
  const isMainBranch = (user?.user_type === 'branch_user' && user?.is_main_branch === true);
  const defaultScope: 'mine' | 'all' = (
    user?.user_type === 'super_admin' ||
    user?.user_type === 'client_admin' ||
    user?.user_type === 'client_user' ||
    isMainBranch
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

  // Scroll lock — while the Add/Edit form or the Reminder Details modal is
  // open, lock BOTH <html> and <body> so the page behind can't scroll.
  useEffect(() => {
    const anyOpen = modalOpen || viewReminder !== null;
    if (!anyOpen) return;
    const b = document.body.style.overflow;
    const h = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    return () => { document.body.style.overflow = b; document.documentElement.style.overflow = h; };
  }, [modalOpen, viewReminder]);

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
      : { editId: null, code:'', oppId:'', customer:'', email:'', contact:'', countryCode:'+91', platform:'', platformOther:'', date: TODAY_STR, startTime:'10:00', endTime:'11:00', link:'', venue:'', agenda:'', status:'In Progress', type: meetingSub });
    setFormErrors([]);
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
    setModalOpen(true);
  };

  const close = () => { setModalOpen(false); setForm({}); setFormErrors([]); };

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
      // Accumulate every validation failure so they're all shown together.
      const errs: string[] = [];
      const cust = (form.customer || '').trim();
      // Customer name: must contain at least one letter (rejects "!!!", "123",
      // "@@@" etc.) and stay within a sensible length / safe character set.
      if (!cust) errs.push('Customer Name is required.');
      else {
        if (!/[A-Za-z]/.test(cust))                            errs.push('Customer Name must contain letters.');
        if (!/^[A-Za-z][A-Za-z0-9 .,'&()\-]{1,99}$/.test(cust)) errs.push('Customer Name has invalid characters or length.');
      }

      // Customer Email — optional, but if given it's trimmed + format-checked
      // so leading/trailing spaces don't trip the backend (QA: trim spaces).
      const emailRaw = (form.email || '').trim();
      if (emailRaw) {
        if (emailRaw.length > 191)                              errs.push('Customer Email cannot exceed 191 characters.');
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw))       errs.push('Customer Email is not a valid email address.');
      }

      if (!form.date)      errs.push('Meeting Date is required.');
      if (!form.startTime) errs.push('Start Time is required.');
      if (!form.endTime)   errs.push('End Time is required.');

      // Contact number — REQUIRED. Combine the selected country code with the
      // local number, then enforce 10–15 total digits (10 covers India's
      // standard mobile length; 15 is the ITU-T E.164 maximum).
      const localNum  = (form.contact || '').trim();
      const ccode     = (form.countryCode || '+91').trim();
      const contactRaw = localNum ? `${ccode} ${localNum}`.trim() : '';
      if (!localNum) {
        errs.push('Contact Number is required.');
      } else {
        const digits = contactRaw.replace(/\D/g, '');
        if (digits.length < 10)  errs.push('Contact Number must be at least 10 digits.');
        if (digits.length > 15)  errs.push('Contact Number cannot be more than 15 digits.');
        if (!/^\+?[\d\s\-]+$/.test(contactRaw)) errs.push('Contact Number can only contain digits, spaces, dashes and a leading +.');
      }

      // Resolve the platform/type, honouring the free-text "Other" choice.
      const platformVal = form.platform === 'Other'
        ? (form.platformOther || '').trim()
        : (form.platform || '');
      if (!form.platform) {
        errs.push(meetingSub === 'physical' ? 'Meeting Type is required.' : 'Platform is required.');
      } else if (form.platform === 'Other' && !platformVal) {
        errs.push(meetingSub === 'physical' ? 'Please specify the meeting type.' : 'Please specify the platform.');
      }

      const isVirtual = ((form.type as MeetingSub) || meetingSub) === 'virtual';
      const linkRaw  = (form.link  || '').trim();
      const venueRaw = (form.venue || '').trim();

      if (isVirtual) {
        // Virtual meeting link — REQUIRED, must be a valid http(s) URL.
        if (!linkRaw) {
          errs.push('Meeting Link is required.');
        } else {
          let ok = false;
          try { const u = new URL(linkRaw); ok = /^https?:$/.test(u.protocol); } catch { ok = false; }
          if (!ok) errs.push('Meeting Link must be a valid http(s) URL (e.g. https://meet.google.com/abc-def-ghi).');
        }
      } else {
        // Physical meeting — venue is REQUIRED and must look like a real
        // place name (at least one letter, sensible length, safe punctuation).
        if (!venueRaw) {
          errs.push('Place / Venue is required.');
        } else {
          if (!/[A-Za-z]/.test(venueRaw))                            errs.push('Venue must contain letters, not just symbols or digits.');
          if (venueRaw.length < 3 || venueRaw.length > 200)          errs.push('Venue must be between 3 and 200 characters.');
          if (!/^[A-Za-z0-9 .,'&()#\/\-\n\r]+$/.test(venueRaw))      errs.push('Venue contains invalid characters.');
        }
      }

      // Meeting agenda — REQUIRED for both meeting types.
      const agendaRaw = (form.agenda || '').trim();
      if (!agendaRaw)                   errs.push('Meeting Agenda is required.');
      else if (agendaRaw.length < 2)    errs.push('Meeting Agenda must be at least 2 characters.');
      else if (agendaRaw.length > 1000) errs.push('Meeting Agenda cannot exceed 1000 characters.');

      if (errs.length) { setFormErrors(errs); return; }

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
        <style>{SCOPED_CSS}</style>
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
      <style>{SCOPED_CSS}</style>

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
                            <Tooltip label="Join Meeting">
                              <a href={m.link} target="_blank" rel="noreferrer" className="td-ab td-ab-join" aria-label="Join Meeting"><IconVideo /></a>
                            </Tooltip>
                          ))}
                          {canEdit && (
                            <Tooltip label="Edit">
                              <button className="td-ab td-ab-edit" aria-label="Edit" onClick={() => openEdit(m)}><IconEdit /></button>
                            </Tooltip>
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
                      onClick={() => { setMeetingSub('virtual'); setForm(p => ({ ...p, type: 'virtual', platform: '', platformOther: '' })); }}
                    >
                      <IconCam /> 💻 Virtual Meeting
                    </button>
                    <button
                      type="button"
                      className={`td-mtg-toggle-btn ${meetingSub === 'physical' ? 'active' : ''}`}
                      onClick={() => { setMeetingSub('physical'); setForm(p => ({ ...p, type: 'physical', platform: '', platformOther: '' })); }}
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
                        onChange={v => setForm(p => ({ ...p, oppId: v, oppDate: oppDateFor(v) }))}
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
                    <Field label="Customer Name" required>
                      <input className="td-inp" value={form.customer || ''} onChange={e => setForm(p => ({ ...p, customer: e.target.value }))} placeholder="Customer name" />
                    </Field>
                    <Field label="Customer Email">
                      <input
                        className="td-inp"
                        type="email"
                        maxLength={191}
                        value={form.email || ''}
                        onChange={e => setForm(p => ({ ...p, email: e.target.value }))}
                        placeholder="Email address"
                      />
                    </Field>
                  </div>
                  <div className="td-form-row">
                    <Field label="Contact No" required>
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
                          className="td-inp"
                          type="tel"
                          inputMode="tel"
                          maxLength={15}
                          value={form.contact || ''}
                          onChange={e => {
                            // Local number only — digits, spaces and dashes.
                            // The country code lives in the dropdown beside it.
                            const cleaned = e.target.value.replace(/[^\d\s\-]/g, '');
                            setForm(p => ({ ...p, contact: cleaned }));
                          }}
                          placeholder="e.g. 98765 43210"
                        />
                      </div>
                    </Field>
                    <Field label={meetingSub === 'physical' ? 'Meeting Type / Format' : 'Platform'} required>
                      <MasterSelect
                        value={form.platform || ''}
                        placeholder={meetingSub === 'physical' ? 'Select type' : 'Select platform'}
                        options={(meetingSub === 'physical' ? PHYSICAL_PLATFORMS : VIRTUAL_PLATFORMS).map(p => ({ value: p, label: p }))}
                        onChange={v => setForm(p => ({ ...p, platform: v, platformOther: v === 'Other' ? p.platformOther : '' }))}
                      />
                      {/* Free-text capture when "Other" is picked (QA bug 34). */}
                      {form.platform === 'Other' && (
                        <input
                          className="td-inp"
                          style={{ marginTop: 6 }}
                          value={form.platformOther || ''}
                          maxLength={100}
                          onChange={e => setForm(p => ({ ...p, platformOther: e.target.value }))}
                          placeholder={meetingSub === 'physical' ? 'Specify meeting type…' : 'Specify platform…'}
                        />
                      )}
                    </Field>
                  </div>
                  {meetingSub === 'virtual' ? (
                    <Field label="Meeting Link" required colSpan={2}>
                      <input className="td-inp" value={form.link || ''} onChange={e => setForm(p => ({ ...p, link: e.target.value }))} placeholder="https://..." />
                    </Field>
                  ) : (
                    <Field label="Place / Venue" required colSpan={2}>
                      <input className="td-inp" value={form.venue || ''} onChange={e => setForm(p => ({ ...p, venue: e.target.value }))} placeholder="e.g. Mumbai Head Office, BKC" />
                    </Field>
                  )}
                  <div className="td-form-row td-form-row-3">
                    <Field label="Meeting Date" required>
                      <MasterDatePicker
                        value={toInputDate(form.date)}
                        onChange={iso => setForm(p => ({ ...p, date: fromInputDate(iso) }))}
                        placeholder="dd-mm-yyyy"
                        // Meetings can't be scheduled in the past — applies to both
                        // add AND edit, so editing a row also can't pick an old date.
                        minDate={toInputDate(TODAY_STR)}
                      />
                    </Field>
                    <Field label="Start Time" required>
                      <MasterTimePicker
                        value={form.startTime || ''}
                        onChange={v => setForm(p => ({ ...p, startTime: v }))}
                        placeholder="--:--"
                      />
                    </Field>
                    <Field label="End Time" required>
                      <MasterTimePicker
                        value={form.endTime || ''}
                        onChange={v => setForm(p => ({ ...p, endTime: v }))}
                        placeholder="--:--"
                      />
                    </Field>
                  </div>
                  <Field label="Meeting Agenda" required colSpan={2}>
                    <textarea className="td-inp" rows={2} value={form.agenda || ''} onChange={e => setForm(p => ({ ...p, agenda: e.target.value }))} placeholder="Meeting agenda..." style={{ resize: 'none', minHeight: 52 }} />
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
    const label = `${parts[0]} ${CAL_MONTH_NAMES[parseInt(parts[1], 10) - 1]} ${parts[2]}`;
    const inN = list.filter(i => i.status === 'In Progress').length;
    const dnN = list.filter(i => i.status === 'Done').length;
    popoverEl = (
      <div
        id="td-cal-popover"
        className="td-cal-popover"
        style={{
          left: dragPos ? dragPos.x : Math.max(8, Math.min(popover.x, window.innerWidth - 360)),
          top:  dragPos ? dragPos.y : Math.max(60, Math.min(popover.y, window.innerHeight - 340)),
        }}
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
function Field({ label, required, colSpan, children }: { label: string; required?: boolean; colSpan?: 1 | 2; children: React.ReactNode }) {
  return (
    <div className="td-field" style={colSpan === 2 ? { gridColumn: 'span 2' } : undefined}>
      <label className="td-label">{label} {required && <span className="td-req">*</span>}</label>
      {children}
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

/* ─── Scoped CSS ─── */
const SCOPED_CSS = `
.td-root {
  font-family: 'DM Sans', 'Inter', system-ui, -apple-system, sans-serif;
  background: linear-gradient(160deg, #f0fdfa 0%, #ecfdf5 50%, #ffffff 100%);
  padding: 16px 24px 24px;
  margin: -1rem -1.5rem;
  height: calc(100vh - 130px);
  overflow: hidden;
  color: #111827;
  font-size: 13.5px;
  display: flex; flex-direction: column; gap: 0;
}
.td-root *, .td-root *::before, .td-root *::after { box-sizing: border-box; }

.td-no-access { background:#fff; border:1.5px solid #99f6e4; border-radius:14px; padding:28px; text-align:center; box-shadow:0 2px 10px rgba(20,184,166,.08); }
.td-no-access-title { font-size:16px; font-weight:800; color:#0d9488; }
.td-no-access-sub   { font-size:12px; color:#64748b; margin-top:8px; max-width:540px; margin-left:auto; margin-right:auto; line-height:1.55; }

/* Header */
.td-root .td-header {
  background: linear-gradient(100deg, #f0fdfa 0%, #ccfbf1 60%, #99f6e4 100%);
  border: 1px solid #5eead4; border-radius: 12px;
  padding: 0 16px 0 20px;
  display: flex; align-items: center; gap: 14px;
  margin-bottom: 10px; min-height: 58px;
  position: relative; overflow: hidden;
  box-shadow: 0 2px 12px rgba(20,184,166,.15);
}
.td-root .td-header-glow {
  position: absolute; right: -20px; top: -20px;
  width: 100px; height: 100px; border-radius: 50%;
  background: rgba(20,184,166,.08); pointer-events: none;
}
.td-root .td-header-icon {
  width: 40px; height: 40px; border-radius: 11px;
  background: linear-gradient(135deg, #14b8a6, #0d9488);
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
  box-shadow: 0 3px 10px rgba(13,148,136,.35);
}
.td-root .td-header-title {
  font-size:15px; font-weight:800; letter-spacing:-.3px; line-height:1.2;
  color: #065f46;
}
.td-root .td-header-sub   { font-size:11px; color:#0d9488; margin-top:2px; font-weight:500; opacity:.85; }
.td-root .td-header-text  { flex: 1; }
.td-root .td-tabs {
  margin-left:auto; display:flex; align-items:center; gap:3px;
  background: rgba(255,255,255,.55); padding: 3px;
  border-radius: 9px; border: 1px solid rgba(20,184,166,.3); z-index: 1;
}
.td-root .td-tab {
  padding: 9px 20px; border-radius: 8px; font-size:12.5px; font-weight:600;
  cursor: pointer; background: transparent; color: #0f766e;
  border: none; transition: all .15s; white-space: nowrap; font-family: inherit;
}
.td-root .td-tab:hover { color:#0d9488; background: rgba(20,184,166,.1); }
.td-root .td-tab-active { background: linear-gradient(135deg, #14b8a6, #0d9488); color: #fff; box-shadow: 0 2px 8px rgba(13,148,136,.35); }

/* Toolbar */
.td-root .td-toolbar { display:flex; flex-direction:column; gap:8px; margin-bottom:10px; }
/* Keep the whole toolbar on a single line — Virtual / Physical / List /
   Calendar tabs on the left, Add + Search on the right. Wraps only on very
   small screens (<900px) to avoid horizontal scroll. */
.td-root .td-toolbar-row {
  display:flex; align-items:center;
  gap:10px; flex-wrap: nowrap; min-width: 0;
}
/* Search + Add button group anchors to the right together (Figma): the
   search-wrap takes the auto margin so it sits beside the Add button. */
.td-root .td-toolbar-row .td-search-wrap { margin-left: auto; }
@media (max-width: 900px) {
  .td-root .td-toolbar-row { flex-wrap: wrap; }
  .td-root .td-toolbar-row .td-search-wrap { margin-left: 0; }
}
.td-root .td-filters { display:flex; align-items:center; gap:8px; flex-wrap:nowrap; min-width: 0; }
.td-root .td-sf {
  padding:5px 14px; border-radius:20px; font-size:11.5px; font-weight:600;
  cursor:pointer; border:1.5px solid #99f6e4; background:#f0fdfa; color:#0d9488;
  font-family:inherit; transition:all .15s;
  display:inline-flex; align-items:center; gap:5px;
}
.td-root .td-sf:hover { border-color:#14b8a6; background:#ccfbf1; color:#065f46; }
.td-root .td-sf.active { background: linear-gradient(135deg, #0d9488, #065f46); color:#fff; border-color:#065f46; box-shadow: 0 2px 8px rgba(13,148,136,.3); }

/* Filter chip count badge */
.td-root .td-sf-count {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 18px; height: 18px; padding: 0 5px;
  border-radius: 20px; font-size: 9.5px; font-weight: 800;
  background: #ccfbf1; color: #0d9488;
  margin-left: 2px;
}
.td-root .td-sf-count-sm { min-width: 16px; height: 16px; padding: 0 4px; font-size: 9px; background: rgba(13,148,136,.12); }
.td-root .td-sf-count-active { background: rgba(255,255,255,.25); color: #fff; }

/* Big Virtual/Physical pill buttons (primary filter for Meeting tab) */
.td-root .td-meeting-pill {
  display: inline-flex; align-items: center; gap: 7px;
  padding: 9px 20px; border-radius: 8px; border: 1.5px solid #99f6e4;
  font-family: inherit; font-size: 12.5px; font-weight: 700;
  background: #fff; color: #0d9488;
  cursor: pointer; transition: all .18s;
  height: 40px;
}
.td-root .td-meeting-pill:hover { background: #f0fdfa; }
.td-root .td-meeting-pill.active {
  background: linear-gradient(135deg, #0d9488, #065f46);
  color: #fff; border-color: #065f46;
  box-shadow: 0 2px 10px rgba(13,148,136,.3);
}
.td-root .td-pill-count {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 20px; height: 20px; padding: 0 5px;
  border-radius: 20px; font-size: 10px; font-weight: 800;
  background: #f0fdfa; color: #0d9488;
  margin-left: 2px;
}
.td-root .td-pill-count-active { background: rgba(255,255,255,.25); color: #fff; }

/* View toggle row (Reminder tab, screenshot 1 — view toggle alone below filters) */
.td-root .td-reminder-view-row {
  display: flex; align-items: center; gap: 6px;
  padding: 0; margin-top: 2px;
}
.td-root .td-reminder-view-row .td-view-toggle {
  background: rgba(255,255,255,.7);
  border: 1.5px solid #99f6e4;
  border-radius: 8px;
}

/* Meeting status sub-filter row (under primary pills) */
.td-root .td-meeting-status-row {
  display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
  padding: 8px 14px;
  background: linear-gradient(90deg, #f0fdfa, #f8fffe);
  border-radius: 10px; border: 1.5px solid #e0f2f1;
}
.td-root .td-meeting-status-label {
  font-size: 10.5px; font-weight: 700; color: #0d9488;
  text-transform: uppercase; letter-spacing: .08em;
  margin-right: 4px; white-space: nowrap;
}

.td-root .td-view-toggle {
  display:flex; align-items:center; gap:2px;
  background: rgba(255,255,255,.7); padding:3px;
  border-radius: 8px; border: 1.5px solid #99f6e4; flex-shrink: 0;
}
.td-root .td-view-btn {
  display:inline-flex; align-items:center; gap:5px;
  padding:6px 12px; border-radius:6px; border:none;
  font-family:inherit; font-size:11.5px; font-weight:600;
  cursor:pointer; transition: all .15s;
  background: transparent; color: #0d9488;
}
.td-root .td-view-btn.active {
  background: linear-gradient(135deg, #0d9488, #065f46); color:#fff;
  box-shadow: 0 1px 4px rgba(13,148,136,.3);
}

.td-root .td-toolbar-right { display:flex; align-items:center; gap:8px; flex-shrink:0; flex-wrap: nowrap; }
@media (max-width: 900px) {
  .td-root .td-toolbar-right { flex-wrap: wrap; }
}
.td-root .td-search-wrap {
  display: flex; align-items: center;
  background: #fff;
  border: 1.5px solid #99f6e4;
  border-radius: 9px; padding: 7px 12px;
  gap: 7px; max-width: 280px; width: 100%;
  box-shadow: 0 1px 4px rgba(20,184,166,.07);
  transition: border-color .15s, box-shadow .15s;
}
.td-root .td-search-wrap:focus-within {
  border-color: #14b8a6;
  box-shadow: 0 0 0 3px rgba(20,184,166,.1);
}
.td-root .td-search-wrap svg { flex-shrink: 0; }
.td-root .td-search-wrap input {
  border: none; background: transparent;
  font-family: inherit; font-size: 11.5px;
  color: #1e293b; outline: none; width: 100%;
}
.td-root .td-search-wrap input::placeholder { color:#99c9c4; }
.td-root .td-add-btn {
  display:inline-flex; align-items:center; gap:6px;
  padding:11px 20px; border-radius:8px; border:none;
  background: linear-gradient(135deg, #14b8a6, #0d9488); color:#fff;
  font-family:inherit; font-size:12.5px; font-weight:700;
  cursor:pointer; box-shadow: 0 2px 8px rgba(13,148,136,.35);
  flex-shrink:0; transition: all .15s;
}
.td-root .td-add-btn:hover { transform: translateY(-1px); box-shadow: 0 4px 12px rgba(13,148,136,.45); }

/* Meeting sub-tab */
.td-root .td-meeting-sub {
  display: flex; gap: 6px;
  padding: 4px;
  background: rgba(255,255,255,.6);
  border: 1px solid #5eead4;
  border-radius: 10px;
  align-self: flex-start;
}
.td-root .td-sub-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 7px 16px; border-radius: 7px; border: none;
  background: transparent; color: #0d9488;
  font-family: inherit; font-size: 12px; font-weight: 600;
  cursor: pointer; transition: all .15s;
}
.td-root .td-sub-btn:hover { background: rgba(20,184,166,.1); }
.td-root .td-sub-btn.active {
  background: linear-gradient(135deg, #0d9488, #0f766e); color: #fff;
  box-shadow: 0 2px 6px rgba(13,148,136,.3);
}

/* Table card */
.td-root .td-table-card {
  background: #fff;
  border: 1.5px solid #99f6e4;
  border-radius: 14px;
  box-shadow: 0 4px 20px rgba(20,184,166,.1), 0 1px 4px rgba(0,0,0,.04);
  overflow: hidden;
  display: flex; flex-direction: column;
  flex: 1; min-height: 0;
}
.td-root .td-table-wrap {
  overflow: auto; flex: 1; min-height: 0;
  scrollbar-width: thin; scrollbar-color: #5eead4 transparent;
}
.td-root .td-table-wrap::-webkit-scrollbar { width: 9px; height: 9px; }
.td-root .td-table-wrap::-webkit-scrollbar-track { background: transparent; }
.td-root .td-table-wrap::-webkit-scrollbar-thumb {
  background: #5eead4; border-radius: 8px;
  border: 2px solid transparent; background-clip: content-box;
}
.td-root .td-table-wrap::-webkit-scrollbar-thumb:hover { background: #2dd4bf; background-clip: content-box; }
[data-bs-theme="dark"] .td-root .td-table-wrap { scrollbar-color: rgba(94,234,212,.4) transparent; }
[data-bs-theme="dark"] .td-root .td-table-wrap::-webkit-scrollbar-thumb { background: rgba(94,234,212,.4); background-clip: content-box; }
.td-root .td-table { width:100%; border-collapse: collapse; font-size: 11.5px; }
.td-root .td-table thead { position: sticky; top: 0; z-index: 5; }
.td-root .td-table thead tr {
  background: linear-gradient(90deg, #14b8a6 0%, #0d9488 55%, #0f766e 100%);
  box-shadow: 0 2px 8px rgba(20,184,166,.2);
}
.td-root .td-table thead th {
  color: rgba(255,255,255,.95);
  font-size: 9.5px; font-weight: 700;
  padding: 8px 10px; letter-spacing: .06em; text-transform: uppercase;
  text-align: left; white-space: nowrap;
}
.td-root .td-table thead th:first-child { padding-left: 14px; }
.td-root .td-table tbody tr { border-bottom: 1px solid #f0fdfa; }
.td-root .td-table tbody tr:hover { background: #f0fdfa; }
.td-root .td-table tbody td { padding: 8px 10px; vertical-align: middle; color: #1e293b; }
.td-root .td-table tbody td:first-child { padding-left: 14px; }
.td-root .td-empty { text-align: center !important; padding: 36px !important; color: #94a3b8; font-style: italic; }

.td-root .td-today-row td { background: transparent; }

.td-root .td-mono { font-family: 'JetBrains Mono', ui-monospace, monospace; color: #0d9488; font-weight: 600; font-size: 10.5px; }
.td-root .td-cust-sub { color: #94a3b8; font-size: 10px; margin-top: 2px; }

/* Sr No pill (rounded teal square) */
.td-root .td-sr-pill {
  display: inline-flex; align-items: center; justify-content: center;
  width: 22px; height: 22px; border-radius: 6px;
  background: #ccfbf1; color: #0d9488;
  font-size: 10.5px; font-weight: 700;
}
.td-root .td-today-row .td-sr-pill { color: #065f46; }

/* Opportunity / Meeting code label */
.td-root .td-opp-id {
  color: #0d9488; font-weight: 600;
}

/* TODAY indicator pill in Set Date column — amber matches screenshot */
.td-root .td-today-pill {
  display: inline-block; margin-left: 6px;
  font-size: 9.5px; font-weight: 800;
  background: #fef3c7; color: #92400e;
  padding: 2px 8px; border-radius: 99px;
  border: 1px solid #fde68a;
  letter-spacing: .06em;
}

/* Virtual/Physical type badge next to meeting code */
.td-root .td-mtg-type {
  display: inline-flex; align-items: center; gap: 3px;
  font-size: 9px; font-weight: 700;
  padding: 1px 6px; border-radius: 20px;
  margin-left: 4px;
}
.td-root .td-mtg-type-virt { background: #eff6ff; color: #1d4ed8; border: 1px solid #bfdbfe; }
.td-root .td-mtg-type-phys { background: #fef3c7; color: #d97706; border: 1px solid #fde68a; }
[data-bs-theme="dark"] .td-root .td-mtg-type-virt { background: rgba(59,130,246,.20); color: #93c5fd; border-color: rgba(59,130,246,.38); }
[data-bs-theme="dark"] .td-root .td-mtg-type-phys { background: rgba(245,158,11,.20); color: #fcd34d; border-color: rgba(245,158,11,.38); }

.td-root .td-tat-pill {
  display:inline-flex; align-items:center;
  padding: 2px 9px; border-radius: 20px;
  font-size: 10px; font-weight: 700;
  background: #ecfdf5; color: #047857; border: 1px solid #a7f3d0;
}
.td-root .td-platform-pill {
  display:inline-flex; align-items:center;
  padding: 2px 9px; border-radius: 20px;
  font-size: 10px; font-weight: 700;
  background: #f0f9ff; color: #0369a1; border: 1px solid #bae6fd;
}

.td-root .td-badge { display:inline-flex; align-items:center; gap:0; padding:5px 14px; border-radius:999px; font-size:11.5px; font-weight:600; white-space:nowrap; line-height:1.2; border:none; }
.td-root .td-badge-dot { display:none; }
.td-root .td-inprog { background:#dbeafe; color:#1d4ed8; border:1px solid #bfdbfe; }
.td-root .td-done   { background:#dcfce7; color:#15803d; border:1px solid #bbf7d0; }
.td-root .td-post   { background:#fef3c7; color:#92400e; border:1px solid #fde68a; }
.td-root .td-cancel { background:#fee2e2; color:#dc2626; border:1px solid #fecaca; }

.td-root .td-actions { display:flex; gap:5px; justify-content:center; align-items: center; }
.td-root .td-ab {
  width:26px; height:26px; border-radius:6px; border:none;
  cursor:pointer; display:inline-flex; align-items:center; justify-content:center;
  transition: all .15s; text-decoration: none;
}
.td-root .td-ab-edit { background:#ccfbf1; color:#0d9488; }
.td-root .td-ab-edit:hover { background:#0d9488; color:#fff; }
.td-root .td-ab-view { background:#dbeafe; color:#1d4ed8; }
.td-root .td-ab-view:hover { background:#1d4ed8; color:#fff; }
.td-root .td-ab-revert { background:#ede9fe; color:#7c3aed; }
.td-root .td-ab-revert:hover { background:#7c3aed; color:#fff; }
.td-root .td-ab-del  { background:#fff1f2; color:#f43f5e; }
.td-root .td-ab-del:hover { background:#f43f5e; color:#fff; }
.td-root .td-ab-join { background:#dcfce7; color:#15803d; }
.td-root .td-ab-join:hover { background:#15803d; color:#fff; }
.td-root .td-ab-done { background:#d1fae5; color:#059669; }
.td-root .td-ab-done:hover { background:#059669; color:#fff; }
.td-root .td-ab-post { background:#fef3c7; color:#d97706; }
.td-root .td-ab-post:hover { background:#d97706; color:#fff; }
.td-root .td-ab-loc  { background:#fef3c7; color:#d97706; }
.td-root .td-ab-loc:hover  { background:#d97706; color:#fff; }

/* Pagination */
.td-root .td-pagination {
  display:flex; align-items:center; justify-content:space-between;
  padding:10px 16px; border-top:1px solid #f0fdfa;
  background: #f8fffe;
  font-size: 11.5px; color: #64748b;
  flex-wrap: wrap; gap: 8px;
}
.td-root .td-pag-info {
  display: inline-flex; align-items: center;
  padding: 5px 14px; border-radius: 99px;
  background: #ccfbf1; border: 1.5px solid #5eead4;
  font-size: 11.5px; color: #0d9488; font-weight: 700;
}
.td-root .td-pag-info strong { color: #065f46; font-weight: 800; font-size: 11.5px; margin: 0 2px; }
.td-root .td-pag-btns { display:flex; align-items:center; gap:8px; }
.td-root .td-pag-rows {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 4px 12px; border-radius: 99px;
  background: #fff; border: 1.5px solid #99f6e4;
  color: #0d9488; font-family: inherit;
  font-size: 11.5px; font-weight: 700;
}
.td-root .td-pag-rows select {
  border: none; background: transparent;
  font-family: inherit; font-size: 11.5px;
  color: #0d9488; font-weight: 800;
  cursor: pointer; outline: none;
}
.td-root .td-pag-range {
  display: inline-flex; align-items: center;
  padding: 4px 14px; border-radius: 99px;
  background: #fff; border: 1.5px solid #99f6e4;
  color: #0d9488; font-weight: 800; font-size: 11.5px;
  white-space: nowrap;
}
.td-root .td-pg-btn-icon {
  width: 28px; height: 28px; border-radius: 50%;
  border: 1.5px solid #99f6e4; background: #fff;
  color: #0d9488; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
  transition: all .15s;
}
.td-root .td-pg-btn-icon:hover:not(:disabled) { background:#f0fdfa; border-color:#14b8a6; transform: translateY(-1px); }
.td-root .td-pg-btn-icon:disabled { opacity:.4; cursor:not-allowed; }

/* Rows-per-page selector (lives in the toolbar) */
.td-root .td-rows-sel {
  display: flex; align-items: center; gap: 5px;
  font-size: 11.5px; color: #0d9488; font-weight: 500;
  background: #fff; border: 1.5px solid #99f6e4;
  padding: 4px 12px; border-radius: 20px;
  box-shadow: 0 1px 4px rgba(20,184,166,.08);
  flex-shrink: 0;
}
.td-root .td-rows-sel select {
  border: none; background: transparent;
  font-family: inherit; font-size: 11.5px;
  color: #0d9488; font-weight: 700;
  cursor: pointer; outline: none;
}

/* Modal */
.td-overlay {
  position: fixed; inset: 0; z-index: 9500;
  background: rgba(15,23,42,.45);
  backdrop-filter: blur(4px);
  display: flex; align-items: center; justify-content: center;
  font-family: 'DM Sans', 'Inter', sans-serif;
}
.td-modal {
  background:#fff; border-radius:14px;
  width: min(94vw, 620px); max-height: 92vh;
  display: flex; flex-direction: column;
  box-shadow: 0 24px 60px rgba(13,148,136,.25), 0 8px 24px rgba(0,0,0,.1);
  overflow: hidden;
}
.td-modal-header {
  background: linear-gradient(135deg, #0d9488 0%, #065f46 60%, #064e3b 100%);
  padding: 14px 18px;
  display:flex; align-items:center; justify-content:space-between;
  flex-shrink: 0;
  position: relative; overflow: hidden;
}
/* Decorative bubble orbs — exact Figma values (solid translucent circles) */
.td-modal-header::before {
  content:''; position:absolute; right:-40px; top:-40px;
  width:160px; height:160px; border-radius:50%;
  background: rgba(255,255,255,.06); pointer-events:none;
}
.td-modal-header::after {
  content:''; position:absolute; right:80px; bottom:-50px;
  width:120px; height:120px; border-radius:50%;
  background: rgba(255,255,255,.04); pointer-events:none;
}
.td-modal-header-left { display:flex; align-items:center; gap:11px; position: relative; z-index: 1; }
.td-modal-close { position: relative; z-index: 1; }
.td-modal-header-icon {
  width:36px; height:36px; border-radius:9px;
  background: rgba(255,255,255,.2); border: 1px solid rgba(255,255,255,.3);
  display:flex; align-items:center; justify-content:center; flex-shrink:0;
}
.td-modal-title-row { display: inline-flex; align-items: center; gap: 9px; }
.td-modal-title { font-size:14px; font-weight:800; color:#fff; letter-spacing:-.2px; }
.td-modal-pill {
  display: inline-flex; align-items: center;
  padding: 2px 9px; border-radius: 99px;
  background: rgba(255,255,255,.22);
  border: 1px solid rgba(255,255,255,.35);
  color: #fff; font-size: 9px; font-weight: 800;
  letter-spacing: .08em; text-transform: uppercase;
}
.td-modal-sub   { font-size:10.5px; color:rgba(255,255,255,.75); margin-top:2px; }
.td-modal-close {
  width:26px; height:26px; border-radius:7px; border:none;
  background: rgba(255,255,255,.2); color:#fff; cursor:pointer;
  display:flex; align-items:center; justify-content:center; flex-shrink:0;
  transition: background .15s, transform .15s;
}
.td-modal-close:hover { background: rgba(255,255,255,.4); transform: rotate(90deg); }
.td-modal-close:active { background: rgba(255,255,255,.55); }
.td-modal-body {
  padding: 13px 22px 10px; background: #f0fdfa;
  overflow-y: auto; flex: 1;
}
.td-form-grid {
  display: grid; grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.td-form-row {
  display: grid; grid-template-columns: 1fr 1fr;
  gap: 10px 14px; margin-bottom: 9px;
  align-items: start;
}
.td-form-row-3 { grid-template-columns: 1fr 1fr 1fr; }
.td-field { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
.td-label {
  font-size: 10.5px; font-weight: 800;
  color: #475569; letter-spacing: .08em;
  text-transform: uppercase;
  margin: 0;
  line-height: 1.3;
}
/* Force every form control (input, native select via .td-inp, custom select
   trigger via .td-cs-trigger, date/time inputs) to share the SAME box —
   exact height, identical padding, identical font metrics — so adjacent
   fields in a row sit on the same baseline. Without these overrides the
   browser's native UI for date/time inputs renders slightly taller than a
   plain text input, which made the Edit Meeting popup's 3-col row
   (Date / Start / End) look misaligned. */
.td-modal .td-inp,
.td-modal .td-cs-trigger {
  box-sizing: border-box;
  height: 36px;
  min-height: 36px;
  padding: 6px 11px;
  font-size: 12px;
  line-height: 22px;       /* 22 + 6 + 6 + 2 border = 36px exactly */
  vertical-align: middle;
}
/* Fields render on white so they stand out from the tinted (#f0fdfa) modal
   body — the Master select / date toggles otherwise blend into the body. */
.td-modal .master-select-toggle,
.td-modal .master-datepicker-toggle { background: #fff; }
.td-modal textarea.td-inp {
  height: auto;
  min-height: 60px;
  padding: 8px 11px;
  line-height: 1.45;
}
/* Date / time inputs — strip the browser-injected internal padding so the
   value text aligns vertically with the text-input siblings in the same
   row, and stretch them to the full cell width. */
.td-modal input[type="date"].td-inp,
.td-modal input[type="time"].td-inp {
  width: 100%;
  padding: 6px 11px;
  font-variant-numeric: tabular-nums;
}
.td-modal input[type="date"].td-inp::-webkit-datetime-edit,
.td-modal input[type="time"].td-inp::-webkit-datetime-edit { padding: 0; }
.td-modal input[type="date"].td-inp::-webkit-calendar-picker-indicator,
.td-modal input[type="time"].td-inp::-webkit-calendar-picker-indicator {
  margin: 0; padding: 0; cursor: pointer; opacity: .65;
}
.td-modal input[type="date"].td-inp::-webkit-calendar-picker-indicator:hover,
.td-modal input[type="time"].td-inp::-webkit-calendar-picker-indicator:hover { opacity: 1; }
/* 3-column rows (Date / Start / End) — slightly tighter gap looks balanced
   when the three controls are narrow, and gives the row visual rhythm.
   Extra top margin separates this row from the standalone Meeting Link /
   Venue field above it (those use colSpan=2 without a .td-form-row wrapper,
   so they don't contribute a bottom margin). */
.td-form-row-3 { gap: 10px 12px; margin-top: 9px; }
/* Standalone colSpan=2 fields (Meeting Link / Venue / Meeting Agenda) — give
   them their own bottom margin so they don't crowd the next row. */
.td-modal-body > .td-field { margin-bottom: 9px; }

/* Virtual / Physical toggle at top of meeting modal */
.td-mtg-toggle {
  display: flex; margin-bottom: 14px;
  border-radius: 10px; overflow: hidden;
  border: 1.5px solid #99f6e4;
}
.td-mtg-toggle-btn {
  flex: 1; display: flex; align-items: center; justify-content: center; gap: 7px;
  padding: 10px 0; border: none;
  font-family: inherit; font-size: 12px; font-weight: 700;
  cursor: pointer; transition: all .18s;
  background: #f0fdfa; color: #0d9488;
}
.td-mtg-toggle-btn + .td-mtg-toggle-btn { border-left: 1.5px solid #99f6e4; }
.td-mtg-toggle-btn.active {
  background: linear-gradient(135deg, #0d9488, #065f46);
  color: #fff;
}

/* Attachment dropzone */
.td-file-drop {
  display: flex; align-items: flex-start; gap: 9px;
  cursor: pointer;
  border: 1.5px dashed #99f6e4; border-radius: 8px;
  padding: 9px 12px; background: #f0fdfa;
  /* Same height as the Remark textarea so the two fields line up evenly,
     matching the lead-matrix reminder modal. */
  height: 76px; transition: all .15s;
}
.td-file-drop:hover { border-color: #14b8a6; background: #ccfbf1; }
.td-file-label {
  font-size: 11.5px; color: #64748b;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  max-width: 180px; flex: 1;
}
.td-file-clear {
  margin-left: auto;
  width: 18px; height: 18px; border-radius: 50%;
  border: 1px solid #99f6e4; background: #fff;
  color: #0d9488; font-size: 12px; font-weight: 800; line-height: 1;
  display: inline-flex; align-items: center; justify-content: center;
  cursor: pointer;
}
.td-file-clear:hover { background: #f43f5e; color: #fff; border-color: #f43f5e; }

/* Existing-attachment chip — shows in edit mode when the row already has
   a file. Lets the user open / replace / detach it without re-uploading. */
.td-file-existing {
  display: flex; align-items: center; gap: 9px;
  border: 1.5px solid #5eead4; border-radius: 8px;
  padding: 7px 12px; background: #ccfbf1;
  /* Same height as the file picker + Remark textarea so the row stays even
     when an existing attachment chip is shown. */
  height: 76px;
}
.td-file-existing-link {
  flex: 1;
  font-size: 11.5px; font-weight: 700; color: #0d9488;
  text-decoration: none;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  max-width: 200px;
}
.td-file-existing-link:hover { color: #065f46; text-decoration: underline; }
.td-file-replace {
  border: 1.5px solid #0d9488; background: #fff;
  color: #0d9488; font-family: inherit;
  font-size: 10.5px; font-weight: 800;
  padding: 3px 10px; border-radius: 99px; cursor: pointer;
}
.td-file-replace:hover { background: #0d9488; color: #fff; }
.td-file-remove {
  width: 22px; height: 22px; border-radius: 50%;
  border: 1.5px solid #fecaca; background: #fef2f2;
  color: #dc2626; font-size: 14px; font-weight: 800; line-height: 1;
  display: inline-flex; align-items: center; justify-content: center;
  cursor: pointer;
}
.td-file-remove:hover { background: #dc2626; color: #fff; border-color: #dc2626; }

/* TdSelect — themed custom dropdown */
.td-cs { position: relative; }
.td-cs-trigger {
  display: flex; align-items: center; justify-content: space-between;
  width: 100%; gap: 8px;
  border: 1.5px solid #99f6e4; border-radius: 8px;
  background: #fff; color: #1e293b;
  font-family: inherit; font-size: 12px; line-height: 1.4;
  padding: 7px 12px; cursor: pointer; outline: none;
  transition: border-color .15s, box-shadow .15s, background .15s;
  text-align: left;
}
.td-cs-trigger:hover { border-color: #14b8a6; background: #f0fdfa; }
.td-cs.is-open .td-cs-trigger {
  border-color: #14b8a6;
  box-shadow: 0 0 0 3px rgba(20,184,166,.12);
  background: #fff;
}
.td-cs.is-open .td-cs-trigger > svg { transform: rotate(180deg); }
.td-cs-trigger > svg { transition: transform .15s; color: #0d9488; flex-shrink: 0; }
.td-cs-value {
  flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.td-cs-value.is-placeholder { color: #94a3b8; }
.td-cs-menu {
  position: absolute; top: calc(100% + 4px); left: 0; right: 0;
  background: #fff; border: 1.5px solid #5eead4; border-radius: 10px;
  box-shadow: 0 12px 28px rgba(13,148,136,.18), 0 4px 10px rgba(15,23,42,.05);
  padding: 4px;
  max-height: 260px; overflow: hidden;
  z-index: 9600;
  animation: tdCsIn .15s cubic-bezier(.22,1,.36,1);
  display: flex; flex-direction: column;
}
@keyframes tdCsIn { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
/* Search row — only rendered when options.length > 4. Sticks to the top
   of the menu and scrolls with the option list underneath it. */
.td-cs-search {
  display: flex; align-items: center; gap: 6px;
  padding: 6px 8px 6px 10px; margin: 2px 2px 4px;
  border: 1.5px solid #ccfbf1; border-radius: 7px; background: #f0fdfa;
}
.td-cs-search > svg { flex-shrink: 0; }
.td-cs-search input {
  flex: 1; min-width: 0; border: none; outline: none; background: transparent;
  font-family: inherit; font-size: 12px; font-weight: 500; color: #1e293b;
}
.td-cs-search input::placeholder { color: #94a3b8; }
.td-cs-list { overflow-y: auto; flex: 1; min-height: 0; }
.td-cs-empty {
  padding: 14px 12px; text-align: center;
  font-size: 11.5px; font-weight: 600; color: #94a3b8;
}
.td-cs-opt {
  display: flex; align-items: center; justify-content: space-between;
  width: 100%; gap: 8px;
  padding: 8px 12px; border-radius: 7px; border: none;
  background: transparent; color: #1e293b;
  font-family: inherit; font-size: 12px; font-weight: 600;
  text-align: left; cursor: pointer;
  transition: background .12s, color .12s;
}
.td-cs-opt:hover { background: #f0fdfa; color: #0d9488; }
.td-cs-opt.is-active { background: linear-gradient(135deg, #14b8a6, #0d9488); color: #fff; }
.td-cs-opt.is-active:hover { background: linear-gradient(135deg, #0d9488, #065f46); }
.td-cs-opt > svg { color: currentColor; flex-shrink: 0; }

.td-req { color: #e11d48; font-weight: 700; }
.td-inp {
  width:100%; box-sizing:border-box;
  border:1.5px solid #99f6e4; border-radius:8px;
  padding:7px 11px; font-family:inherit; font-size:12px;
  color:#1e293b; background:#fff; outline:none;
  transition: all .15s; line-height:1.4;
}
.td-inp:focus { border-color:#14b8a6; box-shadow:0 0 0 3px rgba(20,184,166,.1); }
.td-inp.td-inp-invalid {
  border-color: #e11d48 !important;
  background: #fff1f2;
}
.td-inp.td-inp-invalid:focus {
  border-color: #e11d48 !important;
  box-shadow: 0 0 0 3px rgba(225,29,72,.15);
}
.td-inline-err {
  display: block; margin-top: 4px;
  font-size: 11px; font-weight: 600; color: #e11d48;
  line-height: 1.3;
}
[data-bs-theme="dark"] .td-inp.td-inp-invalid {
  background: rgba(225,29,72,.10);
  border-color: #fb7185 !important;
}
[data-bs-theme="dark"] .td-inline-err { color: #fda4af; }
.td-inp::placeholder { color:#94a3b8; font-size:11.5px; }
.td-sel {
  appearance:none; -webkit-appearance:none; cursor:pointer;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='%230d9488' stroke-width='2.5'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 10px center;
  padding-right: 28px;
}
.td-form-error {
  font-size:11.5px; color:#e11d48; margin-top:10px;
  display:flex; align-items:flex-start; gap:6px;
  background:#fff1f2; border:1px solid #fecdd3; border-radius:8px;
  padding:8px 10px;
}
.td-form-error-list { margin:0; padding-left:16px; display:flex; flex-direction:column; gap:2px; }
.td-form-error-list li { line-height:1.4; }
.td-char-count { font-size:10px; color:#94a3b8; align-self:flex-end; margin-top:2px; }
.td-contact-row { display:flex; gap:6px; align-items:stretch; }
.td-cc-select { flex:0 0 78px; width:78px; padding-right:6px; background-position:right 6px center; }
/* Read-only reminder "view" modal */
.td-view-modal { max-width: 560px; }
.td-view-grid { display:grid; grid-template-columns:1fr 1fr; gap:12px 16px; }
.td-view-item { display:flex; flex-direction:column; gap:3px; min-width:0; }
.td-view-item-full { grid-column:span 2; }
.td-view-label { font-size:10px; font-weight:600; color:#64748b; letter-spacing:.04em; text-transform:uppercase; }
.td-view-val { font-size:12.5px; color:#0f172a; font-weight:500; word-break:break-word; }
.td-view-val-multiline { white-space:pre-wrap; }
[data-bs-theme="dark"] .td-view-label { color:#94a3b8; }
[data-bs-theme="dark"] .td-view-val { color:#e2e8f0; }

.td-modal-footer {
  display:flex; align-items:center; justify-content:space-between;
  padding: 12px 20px;
  border-top: 1px solid #ccfbf1; background:#fff;
  flex-shrink: 0;
}
.td-footer-hint {
  font-size:11px; color:#94a3b8;
  display:flex; align-items:center; gap:5px;
}
.td-footer-actions { display:flex; gap:8px; }
/* Semantic table-cell classes — replace inline color styles so dark mode can
   override them. Inline style color always wins over CSS, which is why the
   meeting table looked dim on dark bg before this refactor. */
/* Meeting table: every cell stays on one line (Figma) — the code + Virtual/
   Physical badge sit inline, and the wide table scrolls horizontally rather
   than wrapping rows onto two lines. */
.td-root .td-table-mtg tbody td { white-space: nowrap; }
.td-root .td-table-mtg .td-mtg-type { vertical-align: middle; }
.td-cell-strong  { font-weight: 600; color: #1e293b; }
.td-cell-muted   { color: #64748b; }
.td-cell-sm      { font-size: 11px; }
.td-cell-ellipsis { max-width: 200px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.td-cell-link    { color: #0d9488; font-size: 11px; text-decoration: none; }
.td-cell-link:hover { text-decoration: underline; }
.td-cell-empty   { color: #94a3b8; }

[data-bs-theme="dark"] .td-cell-strong { color: #f1f5f9; }
[data-bs-theme="dark"] .td-cell-muted  { color: #cbd5e1; }
[data-bs-theme="dark"] .td-cell-link   { color: #5eead4; }
[data-bs-theme="dark"] .td-cell-empty  { color: #64748b; }

.td-cell-subject { max-width: none; }
.td-subject-text {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  text-overflow: ellipsis;
  word-break: break-word;
  line-height: 1.4;
}
.td-ab-muted {
  opacity: .45 !important;
  cursor: not-allowed !important;
  filter: grayscale(.35);
}
.td-ab-muted:hover { transform: none !important; box-shadow: none !important; }
.td-btn-cancel {
  padding:7px 18px; border:1.5px solid #e2e8f0;
  border-radius:8px; background:#fff; color:#64748b;
  font-family:inherit; font-size:12px; font-weight:600;
  cursor:pointer; transition: all .15s;
}
.td-btn-cancel:hover:not(:disabled) { background:#f8fafc; border-color:#cbd5e1; color:#0f172a; }
.td-btn-cancel:disabled { opacity:.55; cursor:not-allowed; }
.td-btn-save {
  display:inline-flex; align-items:center; gap:6px;
  padding:7px 18px; border:none; border-radius:8px;
  background: linear-gradient(135deg, #14b8a6, #0d9488);
  color:#fff; font-family:inherit;
  font-size:12px; font-weight:700; cursor:pointer;
  box-shadow: 0 2px 8px rgba(20,184,166,.4);
  transition: transform .15s, box-shadow .15s, filter .15s;
}
.td-btn-save:hover:not(:disabled)  { transform: translateY(-1px); box-shadow: 0 6px 18px rgba(20,184,166,.5); filter: brightness(1.05); }
.td-btn-save:active:not(:disabled) { transform: translateY(0); }
.td-btn-save:disabled { opacity:.7; cursor:not-allowed; box-shadow: none; }
.td-spinner {
  display:inline-block; width:11px; height:11px; border-radius:50%;
  border:2px solid rgba(255,255,255,.35); border-top-color:#fff;
  animation: td-spin .7s linear infinite;
}
@keyframes td-spin { to { transform: rotate(360deg); } }

/* ── Calendar view ── */
.td-root .td-cal-topbar {
  background: linear-gradient(135deg, #134e4a 0%, #0d9488 55%, #2dd4bf 100%);
  border-radius: 14px; padding: 12px 20px;
  display: flex; align-items: center; justify-content: space-between;
  gap: 14px; flex-wrap: wrap;
  box-shadow: 0 4px 20px rgba(13,148,136,.28), 0 1px 4px rgba(0,0,0,.08);
  margin-bottom: 10px;
}
.td-root .td-cal-topbar-left { display:flex; align-items:center; gap:12px; flex-wrap:wrap; }
.td-root .td-cal-topbar-icon {
  width:34px; height:34px; border-radius:10px;
  background: rgba(255,255,255,.16); border:1.5px solid rgba(255,255,255,.28);
  display:flex; align-items:center; justify-content:center; flex-shrink:0;
}
.td-root .td-cal-topbar-title { font-size:13.5px; font-weight:800; color:#fff; letter-spacing:-.2px; }
.td-root .td-cal-topbar-sub   { font-size:9.5px; color:rgba(255,255,255,.65); font-weight:500; margin-top:1px; }
.td-root .td-cal-topbar-divider { width:1px; height:28px; background:rgba(255,255,255,.2); }
.td-root .td-cal-today-btn {
  padding:5px 14px; border-radius:20px;
  border:1.5px solid rgba(255,255,255,.35); background:rgba(255,255,255,.14);
  color:#fff; font-family:inherit; font-size:11.5px; font-weight:700;
  cursor:pointer; transition:all .15s;
}
.td-root .td-cal-today-btn:hover { background: rgba(255,255,255,.26); }
.td-root .td-cal-nav { display:flex; gap:3px; }
.td-root .td-cal-nav button {
  width:28px; height:28px; border-radius:50%;
  border:1.5px solid rgba(255,255,255,.28); background:rgba(255,255,255,.1);
  color:#fff; cursor:pointer; display:flex; align-items:center; justify-content:center;
  transition: all .15s;
}
.td-root .td-cal-nav button:hover { background: rgba(255,255,255,.22); }
.td-root .td-cal-month-label {
  font-size:18px; font-weight:800; color:#fff;
  letter-spacing:-.3px; min-width:130px;
}
.td-root .td-cal-topbar-right { display:flex; align-items:center; gap:6px; flex-wrap:wrap; }
.td-root .td-cal-stat {
  display:inline-flex; align-items:center; gap:4px;
  background: rgba(255,255,255,.14); border:1px solid rgba(255,255,255,.22);
  padding:4px 10px; border-radius:20px;
  font-size:10px; font-weight:700; color:#fff; white-space:nowrap;
}
.td-root .td-cal-stat::before {
  content:''; width:6px; height:6px; border-radius:50%; background:#fff;
}
.td-root .td-cal-stat-inprog::before { background:#6ee7b7; }
.td-root .td-cal-stat-done::before   { background:#a7f3d0; }

.td-root .td-cal-card {
  background:#fff;
  border-radius:14px;
  box-shadow: 0 2px 16px rgba(0,0,0,.07), 0 1px 4px rgba(0,0,0,.04);
  overflow:hidden;
  border:1px solid #e2e8e7;
  display:flex; flex-direction:column;
  flex:1; min-height:0;
}
.td-root .td-cal-day-hdr {
  display:grid; grid-template-columns:repeat(7,1fr);
  gap:1px; flex-shrink:0;
  background: #cdeee7;
  border-bottom: 1.5px solid #cdeee7;
}
.td-root .td-cal-day-hdr-cell {
  padding:11px 12px 10px;
  font-size:10.5px; font-weight:800; color:#0f766e;
  text-transform:uppercase; letter-spacing:.12em;
  text-align:center;
  background: linear-gradient(180deg,#f0fdfa 0%,#e6faf6 100%);
}
.td-root .td-cal-day-hdr-we    { color:#5b8f87; }
.td-root .td-cal-day-hdr-today {
  color:#fff; background: linear-gradient(135deg,#0d9488,#0f766e);
  box-shadow: inset 0 -3px 0 #115e59;
}

.td-root .td-cal-grid {
  flex:1; min-height:0; overflow-y:auto;
  display:grid; grid-template-columns:repeat(7,1fr);
  grid-auto-rows: minmax(116px, 1fr);
  gap:1px;
  scrollbar-width: thin; scrollbar-color: #5eead4 transparent;
  background:#e3ebe9;
}
.td-root .td-cal-grid::-webkit-scrollbar { width: 9px; }
.td-root .td-cal-grid::-webkit-scrollbar-track { background: transparent; }
.td-root .td-cal-grid::-webkit-scrollbar-thumb { background: #5eead4; border-radius: 8px; border: 2px solid transparent; background-clip: content-box; }
[data-bs-theme="dark"] .td-root .td-cal-grid { scrollbar-color: rgba(94,234,212,.4) transparent; }
[data-bs-theme="dark"] .td-root .td-cal-grid::-webkit-scrollbar-thumb { background: rgba(94,234,212,.4); background-clip: content-box; }
.td-root .td-cal-cell {
  background-color:#fff;
  /* faint diagonal "paper" texture so empty days read as designed, not blank */
  background-image: repeating-linear-gradient(135deg,
    rgba(13,148,136,.032) 0, rgba(13,148,136,.032) 1px,
    transparent 1px, transparent 12px);
  padding:8px 10px 10px;
  min-height:116px;
  position:relative;
  transition: background-color .14s, box-shadow .14s;
}
.td-root .td-cal-cell:hover {
  background-color:#f1fcf9;
  box-shadow: inset 0 0 0 1.5px rgba(20,184,166,.35);
  z-index:1;
}
.td-root .td-cal-cell-weekend { background-color:#f8fcfb; }
.td-root .td-cal-cell-weekend:hover { background-color:#ecfbf6; }
.td-root .td-cal-cell-today {
  background-color:#e9f9f3; background-image:none;
  box-shadow: inset 0 0 0 2px #14b8a6;
}
.td-root .td-cal-cell-today:hover { background-color:#dff5ed; }
/* Out-of-month days: stronger muted hatch so they clearly read as "off" */
.td-root .td-cal-cell-out {
  background-color:#f4f7f6;
  background-image: repeating-linear-gradient(135deg,
    rgba(100,116,139,.06) 0, rgba(100,116,139,.06) 1px,
    transparent 1px, transparent 10px);
  cursor: default;
}
.td-root .td-cal-cell-out:hover { box-shadow:none; }
.td-root .td-cal-cell-out-num { font-size:12px; color:#c2cbc8; font-weight:500; }
.td-root .td-cal-weekend-stripe { display:none; }
.td-root .td-cal-cell-head {
  display:flex; align-items:center; margin-bottom:5px;
}
.td-root .td-cal-num     {
  display:inline-flex; align-items:center; justify-content:center;
  min-width:24px; height:24px; border-radius:50%;
  font-size:12.5px; font-weight:600; color:#334155;
  transition: background .12s, color .12s;
}
.td-root .td-cal-cell:hover .td-cal-num { background:#d6f5ee; color:#0f766e; }
.td-root .td-cal-num-we  { font-weight:700; color:#0f766e; }
.td-root .td-cal-today-num {
  display:inline-flex; align-items:center; justify-content:center;
  width:28px; height:28px; border-radius:50%;
  background: linear-gradient(135deg,#0d9488,#065f46); color:#fff;
  font-size:12.5px; font-weight:800;
  box-shadow: 0 3px 10px rgba(13,148,136,.45);
}
.td-root .td-cal-count {
  display:inline-flex; align-items:center; justify-content:center;
  min-width:16px; height:16px; padding:0 4px;
  border-radius:8px; background:#f0f4f3; color:#64748b;
  font-size:8px; font-weight:800; margin-left:5px;
  border:1px solid #e2e8e6;
}
.td-root .td-cal-cell-today .td-cal-count {
  background: rgba(13,148,136,.18); color:#0d9488;
  border-color: rgba(20,184,166,.4);
}
.td-root .td-cal-pill {
  position:relative;
  border-radius:7px; padding:4px 8px 4px 11px;
  font-size:10px; font-weight:600; line-height:1.35;
  margin-bottom:4px; cursor:pointer;
  white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
  max-width:100%;
  box-shadow: 0 1px 2px rgba(16,24,40,.07), inset 0 0 0 1px rgba(255,255,255,.4);
  transition: transform .13s, box-shadow .13s, filter .13s;
}
/* round the inline left-accent into a soft pill edge */
.td-root .td-cal-pill { border-left-width:3px !important; border-top-left-radius:7px; border-bottom-left-radius:7px; }
.td-root .td-cal-pill:hover { transform: translateY(-1px); box-shadow: 0 5px 12px rgba(16,24,40,.16); filter: brightness(.98); }
.td-root .td-cal-more {
  font-size:9px; color:#0d9488; font-weight:800;
  padding:2px 6px; cursor:pointer;
  background: linear-gradient(90deg,#f0fdfa,#e6faf7);
  border-radius:4px; display:inline-flex; align-items:center; gap:3px;
  margin-top:2px; border:1px solid #99f6e4;
  transition: all .12s;
}
.td-root .td-cal-more:hover { background:#ccfbf1; }

/* Popover */
.td-cal-popover {
  position: fixed; z-index: 10500;
  background:#fff; border-radius:16px;
  box-shadow: 0 24px 70px rgba(2,44,40,.28), 0 6px 24px rgba(0,0,0,.10);
  min-width:340px; max-width:380px;
  overflow:hidden; border:1px solid rgba(13,148,136,.18);
  font-family: 'DM Sans','Inter',sans-serif;
  animation: td-pop-in .16s cubic-bezier(.16,1,.3,1);
}
@keyframes td-pop-in {
  from { opacity:0; transform: translateY(-6px) scale(.97); }
  to   { opacity:1; transform: translateY(0)    scale(1); }
}
.td-cal-popover-hdr {
  background: linear-gradient(135deg, #0f766e 0%, #0d9488 55%, #14b8a6 100%);
  padding:12px 14px 12px 12px;
  display:flex; align-items:flex-start; gap:9px;
  cursor: grab; user-select:none; position:relative; overflow:hidden;
}
.td-cal-popover-hdr::after {
  content:''; position:absolute; right:-30px; top:-34px;
  width:110px; height:110px; border-radius:50%;
  background: rgba(255,255,255,.07); pointer-events:none;
}
.td-cal-popover-hdr:active { cursor: grabbing; }
.td-cal-popover-grip {
  color: rgba(255,255,255,.6); flex-shrink:0;
  display:flex; align-items:center; margin-top:1px;
  transition: color .12s;
}
.td-cal-popover-hdr:hover .td-cal-popover-grip { color: rgba(255,255,255,.9); }
.td-cal-popover-hdr-main { flex:1; min-width:0; position:relative; z-index:1; }
.td-cal-popover-title {
  font-size:13.5px; font-weight:800; color:#fff;
  letter-spacing:-.2px; margin-bottom:6px;
}
.td-cal-popover-meta { display:flex; gap:5px; flex-wrap:wrap; }
.td-cal-popover-chip {
  font-size:10px; background: rgba(255,255,255,.20); color:#fff;
  padding:2.5px 10px; border-radius:20px; font-weight:700;
  backdrop-filter: blur(2px);
}
.td-cal-popover-close {
  width:25px; height:25px; border-radius:8px; border:none;
  background: rgba(255,255,255,.16); color:#fff; cursor:pointer;
  display:flex; align-items:center; justify-content:center; flex-shrink:0;
  transition: background .12s; position:relative; z-index:1;
}
.td-cal-popover-close:hover { background: rgba(255,255,255,.34); }
.td-cal-popover-list { max-height:320px; overflow-y:auto; padding:4px 0; }
.td-cal-popover-list::-webkit-scrollbar { width:7px; }
.td-cal-popover-list::-webkit-scrollbar-thumb { background:#5eead4; border-radius:4px; border:2px solid #fff; }
.td-cal-popover-row {
  padding:9px 14px;
  display:flex; gap:11px; align-items:flex-start;
  cursor:pointer; transition: background .12s;
  border-bottom: 1px solid #f1f5f9;
}
.td-cal-popover-row:last-child { border-bottom:none; }
.td-cal-popover-row:hover { background:#f0fdfa; }
.td-cal-popover-bar {
  width:3.5px; border-radius:3px; align-self:stretch;
  flex-shrink:0; min-height:42px;
}
.td-cal-popover-body { flex:1; min-width:0; }
.td-cal-popover-row-title {
  font-size:12px; font-weight:700; color:#0f172a;
  line-height:1.4; margin-bottom:5px;
}
.td-cal-popover-row-meta {
  display:flex; align-items:center; gap:5px; flex-wrap:wrap;
}
.td-cal-popover-pill {
  font-size:9.5px; font-weight:700;
  padding:2px 7px; border-radius:20px;
}
.td-cal-popover-pill-muted {
  color:#64748b; background:#f8fafc; border:1px solid #e2e8f0; font-weight:500;
}
.td-cal-popover-status {
  font-size:9.5px; font-weight:700;
  padding:2px 8px; border-radius:20px;
}
.td-cal-popover-status-inprog { background:#dbeafe; color:#1d4ed8; }
.td-cal-popover-status-done   { background:#dcfce7; color:#166534; }

/* ════════════════════════════════════════════════════════════════════
 * DARK MODE — bound to Velzon's data-bs-theme="dark" attribute on <html>.
 * Mirrors the override pattern already used by Toaster / ConfirmContext /
 * recruitment.css so all themed surfaces stay consistent in dark mode.
 * Keeps the teal accent for actions (it works against dark surfaces) and
 * just inverts page chrome (page bg, cards, table rows, inputs, modals).
 * ════════════════════════════════════════════════════════════════════ */
[data-bs-theme="dark"] .td-root {
  background: linear-gradient(160deg, #0b1220 0%, #0f1e2b 50%, #0a1620 100%);
  color: #e2e8f0;
}
[data-bs-theme="dark"] .td-root .td-header {
  background: linear-gradient(110deg, #0e2730 0%, #0d3b48 50%, #0f4c5c 100%);
  border-color: rgba(94,234,212,.28);
  box-shadow: 0 2px 14px rgba(20,184,166,.25);
}
[data-bs-theme="dark"] .td-root .td-header-title { color: #5eead4; }
[data-bs-theme="dark"] .td-root .td-header-sub { color: #5eead4; opacity: .9; }
[data-bs-theme="dark"] .td-root .td-tabs {
  background: rgba(15,23,42,.55);
  border-color: rgba(94,234,212,.30);
}
[data-bs-theme="dark"] .td-root .td-tab { color: #5eead4; }
[data-bs-theme="dark"] .td-root .td-tab:hover { background: rgba(20,184,166,.15); color: #99f6e4; }

/* Filter pills */
[data-bs-theme="dark"] .td-root .td-sf {
  background: rgba(15,23,42,.55); color: #5eead4;
  border-color: rgba(94,234,212,.30);
}
[data-bs-theme="dark"] .td-root .td-sf:hover {
  background: rgba(20,184,166,.18); color: #99f6e4; border-color: rgba(94,234,212,.45);
}
[data-bs-theme="dark"] .td-root .td-sf-count { background: rgba(20,184,166,.22); color: #5eead4; }
[data-bs-theme="dark"] .td-root .td-meeting-pill {
  background: rgba(15,23,42,.55); color: #5eead4;
  border-color: rgba(94,234,212,.30);
}
[data-bs-theme="dark"] .td-root .td-meeting-pill:hover { background: rgba(20,184,166,.18); }
[data-bs-theme="dark"] .td-root .td-pill-count { background: rgba(15,23,42,.7); color: #5eead4; }

/* View toggle + meeting status row */
[data-bs-theme="dark"] .td-root .td-view-toggle {
  background: rgba(15,23,42,.55); border-color: rgba(94,234,212,.30);
}
[data-bs-theme="dark"] .td-root .td-view-btn { color: #5eead4; }
[data-bs-theme="dark"] .td-root .td-reminder-view-row .td-view-toggle {
  background: rgba(15,23,42,.55);
}
[data-bs-theme="dark"] .td-root .td-meeting-status-row {
  background: linear-gradient(90deg, rgba(15,23,42,.6), rgba(20,30,45,.55));
  border-color: rgba(94,234,212,.20);
}
[data-bs-theme="dark"] .td-root .td-meeting-status-label { color: #5eead4; }

/* Search input + Add button */
[data-bs-theme="dark"] .td-root .td-search-wrap {
  background: #11182a; border-color: rgba(94,234,212,.30);
  box-shadow: 0 1px 4px rgba(0,0,0,.25);
}
[data-bs-theme="dark"] .td-root .td-search-wrap input { color: #e2e8f0; }
[data-bs-theme="dark"] .td-root .td-search-wrap input::placeholder { color: #475569; }
[data-bs-theme="dark"] .td-root .td-search-wrap svg { stroke: #5eead4; }

/* Table card */
[data-bs-theme="dark"] .td-root .td-table-card {
  background: #11182a; border-color: rgba(94,234,212,.25);
  box-shadow: 0 6px 24px rgba(0,0,0,.35);
}
[data-bs-theme="dark"] .td-root .td-table tbody tr { border-bottom-color: rgba(255,255,255,.06); }
[data-bs-theme="dark"] .td-root .td-table tbody tr:hover { background: rgba(20,184,166,.08); }
[data-bs-theme="dark"] .td-root .td-table tbody td { color: #e2e8f0; }
[data-bs-theme="dark"] .td-root .td-today-row td { background: transparent; }
/* TODAY pill — translucent amber on dark (was bright cream). */
[data-bs-theme="dark"] .td-root .td-today-pill { background: rgba(245,158,11,.20); color: #fcd34d; border-color: rgba(245,158,11,.38); }
/* Status badges — translucent tint + light ink on dark (matches role-pill style). */
[data-bs-theme="dark"] .td-root .td-inprog { background: rgba(59,130,246,.22); color: #93c5fd; border-color: rgba(59,130,246,.35); }
[data-bs-theme="dark"] .td-root .td-done   { background: rgba(34,197,94,.22);  color: #6ee7b7; border-color: rgba(34,197,94,.35); }
[data-bs-theme="dark"] .td-root .td-post   { background: rgba(245,158,11,.20); color: #fcd34d; border-color: rgba(245,158,11,.35); }
[data-bs-theme="dark"] .td-root .td-cancel { background: rgba(239,68,68,.20);  color: #fca5a5; border-color: rgba(239,68,68,.35); }
[data-bs-theme="dark"] .td-root .td-empty { color: #64748b; }
[data-bs-theme="dark"] .td-root .td-sr-pill { background: rgba(20,184,166,.18); color: #5eead4; }
[data-bs-theme="dark"] .td-root .td-opp-id { color: #5eead4; }

/* Pagination footer */
[data-bs-theme="dark"] .td-root .td-pagination {
  background: rgba(15,23,42,.55); border-top-color: rgba(255,255,255,.06);
}
[data-bs-theme="dark"] .td-root .td-pag-info {
  background: rgba(20,184,166,.18); color: #5eead4; border-color: rgba(94,234,212,.32);
}
[data-bs-theme="dark"] .td-root .td-pag-info strong { color: #99f6e4; }
[data-bs-theme="dark"] .td-root .td-pag-rows,
[data-bs-theme="dark"] .td-root .td-pag-range {
  background: rgba(15,23,42,.7); color: #5eead4; border-color: rgba(94,234,212,.30);
}
[data-bs-theme="dark"] .td-root .td-pag-rows select { color: #99f6e4; }
[data-bs-theme="dark"] .td-root .td-pg-btn-icon {
  background: rgba(15,23,42,.7); color: #5eead4; border-color: rgba(94,234,212,.30);
}
[data-bs-theme="dark"] .td-root .td-pg-btn-icon:hover:not(:disabled) { background: rgba(20,184,166,.20); }

/* Action buttons — keep teal accent but tint backgrounds for dark */
[data-bs-theme="dark"] .td-root .td-ab-edit { background: rgba(20,184,166,.18); color: #5eead4; }
[data-bs-theme="dark"] .td-root .td-ab-edit:hover { background: #14b8a6; color: #0f172a; }
[data-bs-theme="dark"] .td-root .td-ab-done { background: rgba(16,185,129,.18); color: #6ee7b7; }
[data-bs-theme="dark"] .td-root .td-ab-done:hover { background: #10b981; color: #0f172a; }
[data-bs-theme="dark"] .td-root .td-ab-post { background: rgba(245,158,11,.18); color: #fcd34d; }
[data-bs-theme="dark"] .td-root .td-ab-post:hover { background: #f59e0b; color: #0f172a; }
[data-bs-theme="dark"] .td-root .td-ab-del  { background: rgba(244,63,94,.18); color: #fda4af; }
[data-bs-theme="dark"] .td-root .td-ab-del:hover  { background: #f43f5e; color: #fff; }
[data-bs-theme="dark"] .td-root .td-ab-join { background: rgba(34,197,94,.18); color: #86efac; }
[data-bs-theme="dark"] .td-root .td-ab-join:hover { background: #16a34a; color: #fff; }
[data-bs-theme="dark"] .td-root .td-ab-loc { background: rgba(245,158,11,.18); color: #fcd34d; }
[data-bs-theme="dark"] .td-root .td-ab-loc:hover { background: #d97706; color: #fff; }
[data-bs-theme="dark"] .td-root .td-ab-view { background: rgba(59,130,246,.20); color: #93c5fd; }
[data-bs-theme="dark"] .td-root .td-ab-view:hover { background: #3b82f6; color: #fff; }
[data-bs-theme="dark"] .td-root .td-ab-revert { background: rgba(124,58,237,.20); color: #c4b5fd; }
[data-bs-theme="dark"] .td-root .td-ab-revert:hover { background: #7c3aed; color: #fff; }

/* Modal */
[data-bs-theme="dark"] .td-modal { background: #0e1726; box-shadow: 0 24px 60px rgba(0,0,0,.6); }
[data-bs-theme="dark"] .td-modal-body { background: #11182a; }
[data-bs-theme="dark"] .td-label { color: #94a3b8; }
[data-bs-theme="dark"] .td-inp,
[data-bs-theme="dark"] .td-cs-trigger {
  background: #0e1726; color: #e2e8f0; border-color: rgba(94,234,212,.28);
}
[data-bs-theme="dark"] .td-modal .master-select-toggle,
[data-bs-theme="dark"] .td-modal .master-datepicker-toggle { background: #0e1726; }
[data-bs-theme="dark"] .td-inp:focus,
[data-bs-theme="dark"] .td-cs.is-open .td-cs-trigger {
  border-color: #14b8a6; box-shadow: 0 0 0 3px rgba(20,184,166,.20);
}
[data-bs-theme="dark"] .td-cs-trigger:hover { background: rgba(20,184,166,.10); }
[data-bs-theme="dark"] .td-cs-menu {
  background: #0e1726; border-color: rgba(94,234,212,.35);
  box-shadow: 0 12px 32px rgba(0,0,0,.55);
}
[data-bs-theme="dark"] .td-cs-opt { color: #e2e8f0; }
[data-bs-theme="dark"] .td-cs-opt:hover { background: rgba(20,184,166,.12); color: #99f6e4; }
[data-bs-theme="dark"] .td-cs-value.is-placeholder { color: #475569; }
[data-bs-theme="dark"] .td-cs-search {
  background: rgba(15,23,42,.55); border-color: rgba(94,234,212,.30);
}
[data-bs-theme="dark"] .td-cs-search input { color: #e2e8f0; }
[data-bs-theme="dark"] .td-cs-search input::placeholder { color: #475569; }
[data-bs-theme="dark"] .td-cs-empty { color: #475569; }
[data-bs-theme="dark"] .td-mtg-toggle { border-color: rgba(94,234,212,.45); background: rgba(15,23,42,.4); }
[data-bs-theme="dark"] .td-mtg-toggle-btn {
  background: rgba(15,23,42,.55); color: #5eead4;
  border-color: rgba(94,234,212,.30);
}
[data-bs-theme="dark"] .td-mtg-toggle-btn + .td-mtg-toggle-btn { border-left-color: rgba(94,234,212,.30); }
[data-bs-theme="dark"] .td-mtg-toggle-btn:hover { background: rgba(20,184,166,.18); color: #99f6e4; }
[data-bs-theme="dark"] .td-mtg-toggle-btn.active {
  background: linear-gradient(135deg, #2dd4bf 0%, #14b8a6 60%, #0d9488 100%) !important;
  color: #0f172a !important;
  font-weight: 800;
  box-shadow: inset 0 0 0 1px rgba(255,255,255,.20), 0 4px 14px rgba(20,184,166,.40);
}
/* Filter pill — active state needed a stronger, brighter background in dark mode
   so the selected filter stands out instead of just glowing slightly. */
[data-bs-theme="dark"] .td-root .td-sf.active,
[data-bs-theme="dark"] .td-root .td-meeting-pill.active {
  background: linear-gradient(135deg, #2dd4bf 0%, #14b8a6 60%, #0d9488 100%) !important;
  color: #052e2b !important;
  border-color: #5eead4 !important;
  font-weight: 800;
  box-shadow: 0 6px 20px rgba(45,212,191,.35), inset 0 0 0 1px rgba(255,255,255,.22);
}
[data-bs-theme="dark"] .td-root .td-sf-count-active,
[data-bs-theme="dark"] .td-root .td-pill-count-active {
  background: rgba(15,23,42,.40);
  color: #f0fdfa;
}
[data-bs-theme="dark"] .td-file-drop { background: rgba(15,23,42,.55); border-color: rgba(94,234,212,.30); }
[data-bs-theme="dark"] .td-file-drop:hover { background: rgba(20,184,166,.12); border-color: #14b8a6; }
[data-bs-theme="dark"] .td-file-label { color: #94a3b8; }
[data-bs-theme="dark"] .td-file-existing {
  background: rgba(20,184,166,.14); border-color: rgba(94,234,212,.40);
}
[data-bs-theme="dark"] .td-file-existing-link { color: #5eead4; }
[data-bs-theme="dark"] .td-file-existing-link:hover { color: #99f6e4; }
[data-bs-theme="dark"] .td-file-replace { background: #0e1726; color: #5eead4; border-color: #14b8a6; }
[data-bs-theme="dark"] .td-modal-footer { background: #0e1726; border-top-color: rgba(255,255,255,.08); }
[data-bs-theme="dark"] .td-footer-hint { color: #64748b; }
[data-bs-theme="dark"] .td-btn-cancel {
  background: rgba(15,23,42,.6); color: #cbd5e1; border-color: rgba(255,255,255,.10);
}
[data-bs-theme="dark"] .td-btn-cancel:hover { background: rgba(255,255,255,.06); }

/* Calendar — dark cells + popover */
[data-bs-theme="dark"] .td-cal-card { background: #11182a; border-color: rgba(94,234,212,.25); }
[data-bs-theme="dark"] .td-cal-grid { background: rgba(94,234,212,.10); }
[data-bs-theme="dark"] .td-cal-cell {
  background-color: #0e1726;
  background-image: repeating-linear-gradient(135deg,
    rgba(94,234,212,.038) 0, rgba(94,234,212,.038) 1px,
    transparent 1px, transparent 12px);
}
[data-bs-theme="dark"] .td-cal-cell-out {
  background-color: #0a101e;
  background-image: repeating-linear-gradient(135deg,
    rgba(148,163,184,.055) 0, rgba(148,163,184,.055) 1px,
    transparent 1px, transparent 10px);
}
[data-bs-theme="dark"] .td-cal-cell-out-num { color: #475569; }
/* Calendar hover — the light-mode rules use near-white tints (#f5fffe etc.)
   which bleed through to dark mode and create a harsh bright flash on
   hover. Override each hover variant with a soft teal-tinted dark surface
   that reads as "highlighted" without losing the dark-mode feel. */
[data-bs-theme="dark"] .td-cal-cell:hover {
  background: rgba(20,184,166,.10) !important;
  box-shadow: inset 0 0 0 1.5px rgba(94,234,212,.30);
}
[data-bs-theme="dark"] .td-cal-cell:hover .td-cal-num { background: rgba(20,184,166,.25); color:#5eead4; }
[data-bs-theme="dark"] .td-cal-cell-weekend { background-color: rgba(15,23,42,.55); }
[data-bs-theme="dark"] .td-cal-cell-weekend:hover {
  background: rgba(20,184,166,.13) !important;
}
[data-bs-theme="dark"] .td-cal-cell-today:hover {
  background: linear-gradient(160deg, rgba(20,184,166,.22), rgba(13,148,136,.18)) !important;
}
[data-bs-theme="dark"] .td-cal-cell-out:hover { background: rgba(15,23,42,.4) !important; box-shadow:none; }
[data-bs-theme="dark"] .td-cal-num { color: #e2e8f0; }
[data-bs-theme="dark"] .td-cal-num-we { color: #5eead4; }
/* Weekday header row */
[data-bs-theme="dark"] .td-cal-day-hdr {
  background: rgba(94,234,212,.18);
  border-bottom-color: rgba(94,234,212,.25);
}
[data-bs-theme="dark"] .td-cal-day-hdr-cell {
  background: linear-gradient(180deg, rgba(20,184,166,.14), rgba(15,23,42,.65));
  color: #5eead4;
}
[data-bs-theme="dark"] .td-cal-day-hdr-we { color: #4cc9b8; }
[data-bs-theme="dark"] .td-cal-day-hdr-today {
  background: linear-gradient(135deg, #0d9488, #0f766e);
  color: #fff; box-shadow: inset 0 -3px 0 #115e59;
}
/* Today cell base (only :hover was overridden before — base stayed light) */
[data-bs-theme="dark"] .td-cal-cell-today {
  background: linear-gradient(160deg, rgba(20,184,166,.16), rgba(20,184,166,.08));
  box-shadow: inset 0 0 0 2px #14b8a6, inset 2px 0 0 #14b8a6;
}
/* Count chip + "+more" pill */
[data-bs-theme="dark"] .td-cal-count { background: rgba(148,163,184,.18); color: #94a3b8; border-color: rgba(148,163,184,.28); }
[data-bs-theme="dark"] .td-cal-cell-today .td-cal-count { background: rgba(20,184,166,.22); color: #5eead4; border-color: rgba(20,184,166,.4); }
[data-bs-theme="dark"] .td-cal-more {
  background: rgba(20,184,166,.14); color: #5eead4; border-color: rgba(94,234,212,.30);
}
/* Event pills: their light pastel fill + dark text are set inline (per-event
   hash colour) and glare in dark mode. Override the surface to a dark slate and
   the text to light; the inline coloured left-accent stays for event identity. */
[data-bs-theme="dark"] .td-cal-pill {
  background: rgba(30,41,59,.92) !important;
  color: #e2e8f0 !important;
  box-shadow: 0 1px 2px rgba(0,0,0,.4) !important;
}
[data-bs-theme="dark"] .td-cal-pill:hover {
  background: rgba(51,65,85,.95) !important;
  box-shadow: 0 5px 12px rgba(0,0,0,.5) !important;
  filter: none;
}
[data-bs-theme="dark"] .td-cal-popover { background: #0e1726; border-color: rgba(94,234,212,.35); box-shadow: 0 24px 70px rgba(0,0,0,.55), 0 6px 24px rgba(0,0,0,.4); }
[data-bs-theme="dark"] .td-cal-popover-hdr { background: linear-gradient(135deg, #115e59 0%, #0d9488 100%); }
[data-bs-theme="dark"] .td-cal-popover-row { border-bottom-color: rgba(148,163,184,.12); }
[data-bs-theme="dark"] .td-cal-popover-row:hover { background: rgba(20,184,166,.10); }
[data-bs-theme="dark"] .td-cal-popover-row-title { color: #e2e8f0; }
[data-bs-theme="dark"] .td-cal-popover-pill-muted { color:#94a3b8; background:rgba(148,163,184,.12); border-color:rgba(148,163,184,.22); }
/* Code chip (M-026 etc.) gets a light pastel fill inline — glares in dark.
   Override only the coloured chip, not the muted ones. */
[data-bs-theme="dark"] .td-cal-popover-pill:not(.td-cal-popover-pill-muted) {
  background: rgba(94,234,212,.14) !important;
  color: #5eead4 !important;
  border-color: rgba(94,234,212,.30) !important;
}
/* Status badges: light tints → translucent dark tint + light ink */
[data-bs-theme="dark"] .td-cal-popover-status-inprog { background: rgba(59,130,246,.22); color:#93c5fd; }
[data-bs-theme="dark"] .td-cal-popover-status-done   { background: rgba(34,197,94,.20);  color:#86efac; }
[data-bs-theme="dark"] .td-cal-popover-list::-webkit-scrollbar-thumb { border-color:#0e1726; }

/* ════════════════════════════════════════════════════════════════════
 * RESPONSIVE — three breakpoints: mobile (≤640), tablet (641-1024),
 * big-screen cap (>1440). Above 900px the layout is already locked to a
 * single row by the toolbar rules above; here we just shrink padding,
 * collapse the toolbar to two stacked rows on mobile, and allow tables to
 * scroll horizontally so the page never overflows the viewport.
 * ════════════════════════════════════════════════════════════════════ */
@media (max-width: 1024px) {
  .td-root { padding: 12px 12px 18px; font-size: 13px; }
  .td-root .td-table { font-size: 11px; }
  .td-root .td-table thead th { padding: 9px 8px; font-size: 9px; }
  .td-root .td-table tbody td { padding: 7px 8px; }
}
@media (max-width: 720px) {
  .td-root { padding: 10px 10px 16px; }
  .td-root .td-header {
    flex-direction: column; align-items: flex-start; gap: 10px;
    padding: 12px 14px; min-height: 0;
  }
  .td-root .td-tabs { margin-left: 0; width: 100%; justify-content: stretch; }
  .td-root .td-tab { flex: 1; padding: 8px 14px; }
  .td-root .td-toolbar-row { flex-direction: column; align-items: stretch; }
  .td-root .td-filters {
    flex-wrap: wrap; gap: 6px;
    overflow-x: auto;
  }
  .td-root .td-toolbar-right { width: 100%; gap: 6px; }
  .td-root .td-search-wrap { max-width: none; flex: 1; }
  .td-root .td-add-btn { padding: 11px 16px; font-size: 12px; }
  .td-root .td-table-wrap { overflow-x: auto; }
  .td-root .td-table { min-width: 720px; }
  .td-root .td-meeting-status-row { overflow-x: auto; }
  .td-root .td-pagination { flex-wrap: wrap; gap: 10px; padding: 10px 12px; }
}
@media (max-width: 480px) {
  .td-root .td-header-title { font-size: 14px; }
  .td-root .td-header-sub { font-size: 10px; }
  .td-root .td-add-btn { padding: 10px 12px; }
  .td-root .td-add-btn span,
  .td-root .td-add-btn { font-size: 11.5px; }
  .td-modal { width: calc(100vw - 24px); }
  .td-form-row, .td-form-row-3 { grid-template-columns: 1fr !important; gap: 8px; }
  .td-modal-header { padding: 12px 14px; }
  .td-modal-body   { padding: 14px 14px 10px; }
  .td-modal-footer { padding: 10px 12px; flex-wrap: wrap; gap: 8px; }
  .td-footer-actions { width: 100%; justify-content: flex-end; }
}

`;
