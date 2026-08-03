import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Card, CardBody } from 'reactstrap';
import { Turtle } from 'lucide-react';
import WorklistPager from '../../../components/ui/WorklistPager';
import '../../../../css/recruitment.css';

// ─────────────────────────────────────────────────────────────────────────
// Self-contained copy of the HR Attendance "Logs & Requests" view so the
// employee profile renders the IDENTICAL UI (same att-* classes). Fed by the
// rich `logs` the /attendance/employee/{id}/summary endpoint now returns.
// ─────────────────────────────────────────────────────────────────────────

const TODAY_ISO = new Date().toISOString().slice(0, 10);
const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const WEEK_LABELS  = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const parseISO = (iso: string) => { const [y,m,d] = iso.split('-').map(Number); return new Date(y, m - 1, d); };
const toISO    = (d: Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

export type DayStatus =
  | 'Present' | 'Late' | 'Half Day' | 'Missing In' | 'Missing Out'
  | 'Weekly Off' | 'Holiday' | 'On Duty' | 'Work From Home' | 'Absent' | 'Leave' | 'Paid Leave' | 'Unpaid Leave' | 'Corrected';

export interface AttLog {
  iso?: string;
  date: string;
  weekday: string;
  status: DayStatus;
  holidayName?: string | null;
  shift: string;
  firstIn: string;
  lastOut: string;
  worked: string;
  deviation: string;
  exception?: string | null;
  /* Approved leave covering this day. `leavePortion` is 'full' for a whole-day
     leave and 'first_half' / 'second_half' for a half-day one — a half-day
     leave still has the employee working the other half, so the row stays a
     working row and shows the leave as a pill instead of blanking the day. */
  leaveKind?: 'Paid' | 'Unpaid' | null;
  leavePortion?: 'full' | 'first_half' | 'second_half' | null;
  /* `open` = an in-punch with no matching out (still clocked in, or a forgotten
     check-out). The out time is unknown, so the popover prints MISSING for it. */
  workSegments?: Array<{ start: number; end: number; open?: boolean }>;
  effectiveMinutes?: number;
  grossMinutes?: number;
  expectedMinutes?: number;
  lateMinutes?: number;
}

export interface AttLogsEmployee {
  id: number;
  shiftStart: string;
  shiftEnd: string;
  weeklyOff: string;
  logs: AttLog[];
}

const STATUS_TONE: Record<DayStatus, { fg: string; bg: string; dot: string; label: string }> = {
  'Present':         { fg: '#15803d', bg: '#dcfce7', dot: '#22c55e', label: 'Present' },
  'Late':            { fg: '#92400e', bg: '#fef3c7', dot: '#f59e0b', label: 'Late' },
  'Half Day':        { fg: '#92400e', bg: '#fef3c7', dot: '#f59e0b', label: 'Half Day' },
  'Missing In':      { fg: '#b91c1c', bg: '#fee2e2', dot: '#ef4444', label: 'Missing In' },
  'Missing Out':     { fg: '#b91c1c', bg: '#fee2e2', dot: '#ef4444', label: 'Missing Out' },
  'Weekly Off':      { fg: '#3b82f6', bg: '#dbeafe', dot: '#60a5fa', label: 'Weekly Off' },
  'Holiday':         { fg: '#3b82f6', bg: '#dbeafe', dot: '#60a5fa', label: 'Holiday' },
  'On Duty':         { fg: '#0d9488', bg: '#ccfbf1', dot: '#14b8a6', label: 'On Duty' },
  'Work From Home':  { fg: '#0d9488', bg: '#ccfbf1', dot: '#14b8a6', label: 'WFH' },
  'Absent':          { fg: '#b91c1c', bg: '#fee2e2', dot: '#ef4444', label: 'Absent' },
  'Leave':           { fg: '#5b3fd1', bg: '#ede9fe', dot: '#7c5cfc', label: 'Leave' },
  'Paid Leave':      { fg: '#0a716a', bg: '#d3f0ee', dot: '#0ab39c', label: 'Paid Leave' },
  'Unpaid Leave':    { fg: '#a4661c', bg: '#fde8c4', dot: '#f59e0b', label: 'Unpaid Leave' },
  'Corrected':       { fg: '#5b3fd1', bg: '#ede9fe', dot: '#7c5cfc', label: 'Corrected' },
};

/** Non-working day bands shown across the visual bar when there are no work
 *  segments (e.g. Leave / On Duty / WFH) — otherwise the graph looked empty. */
const VBAR_BANDS: Partial<Record<DayStatus, { label: string; fg: string; bg: string }>> = {
  'Leave':          { label: 'On Leave', fg: '#5a3fd1', bg: '#ede9fe' },
  'Paid Leave':     { label: 'Paid Leave', fg: '#0a716a', bg: '#d3f0ee' },
  'Unpaid Leave':   { label: 'Unpaid Leave', fg: '#a4661c', bg: '#fde8c4' },
  'On Duty':        { label: 'On Duty',  fg: '#0d9488', bg: '#ccfbf1' },
  'Work From Home': { label: 'WFH',      fg: '#0d9488', bg: '#ccfbf1' },
};

// Decimal-hour (e.g. 9.55) → "09:33 AM" for per-session tooltips on the bar.
function hourLabel(h: number): string {
  let hh = Math.floor(h);
  let mm = Math.round((h - hh) * 60);
  if (mm === 60) { hh += 1; mm = 0; }
  const ampm = hh >= 12 ? 'PM' : 'AM';
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${String(h12).padStart(2, '0')}:${String(mm).padStart(2, '0')} ${ampm}`;
}

// Human-readable late duration for the Logs table: "37 min" under an hour,
// "1h 05m" once it crosses the hour mark.
const fmtLateDuration = (m: number) => m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${m} min`;
// Break Taken = time inside the work window that wasn't worked (gross − effective).
const fmtDurHm = (m: number) => m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${m} min`;
// Grace window (minutes after shift start) before an arrival counts as late —
// mirrors the server rule in AttendanceController (`minutesBetween > 10`). Below
// this an arrival is on-time; at/above it we show the minutes-late measured from
// the shift start time (e.g. 9:30 start, arrive 9:47 → 17 min late).
const LATE_GRACE_MINUTES = 10;

/* Leave portion labels. A half-day leave is shown on an otherwise normal
   working row (the employee worked the other half), so the label has to say
   WHICH half rather than the row reading "Full day Paid Leave". */
const LEAVE_PORTION_LABEL: Record<string, string> = {
  full: 'Full day', first_half: 'First half', second_half: 'Second half',
};
const LEAVE_PORTION_PILL: Record<string, string> = {
  first_half: '1ST HALF', second_half: '2ND HALF',
};
const isHalfLeave = (l: AttLog) => l.leavePortion === 'first_half' || l.leavePortion === 'second_half';
const leaveToneOf = (l: AttLog) => STATUS_TONE[l.leaveKind === 'Unpaid' ? 'Unpaid Leave' : 'Paid Leave'];

/* ── Calendar month summary tiles ──────────────────────────────────────────
   A day carries ONE status, but the KPI totals aren't mutually exclusive:
   turning up late is still turning up, so a Late day counts under BOTH Present
   and Late. Same for a half day, a forgotten punch (Missing In/Out) and a
   corrected day — the employee attended, and only the exception tile should
   single them out. `Leave` aggregates Paid + Unpaid, which previously read 0
   even with leave days on the calendar because the raw statuses are stored as
   "Paid Leave" / "Unpaid Leave". WFH and On Duty stay out of Present: they get
   their own tiles and aren't office attendance. Mirrors HrAttendance.tsx. */
const CAL_PRESENT_LIKE: DayStatus[] = ['Present', 'Late', 'Half Day', 'Missing In', 'Missing Out', 'Corrected'];
const CAL_LEAVE_LIKE:   DayStatus[] = ['Leave', 'Paid Leave', 'Unpaid Leave'];
const CAL_KPIS: { key: DayStatus; label: string; icon: string }[] = [
  { key: 'Present',        label: 'Present',     icon: 'ri-checkbox-circle-line' },
  { key: 'Late',           label: 'Late',        icon: 'ri-time-line' },
  { key: 'Half Day',       label: 'Half Day',    icon: 'ri-contrast-2-line' },
  { key: 'Work From Home', label: 'WFH',         icon: 'ri-home-office-line' },
  { key: 'On Duty',        label: 'On Duty',     icon: 'ri-briefcase-line' },
  { key: 'Leave',          label: 'Leave',       icon: 'ri-calendar-check-line' },
  { key: 'Absent',         label: 'Absent',      icon: 'ri-close-circle-line' },
  { key: 'Weekly Off',     label: 'Weekly Off',  icon: 'ri-calendar-2-line' },
  { key: 'Missing Out',    label: 'Missing Out', icon: 'ri-error-warning-line' },
  { key: 'Holiday',        label: 'Holiday',     icon: 'ri-flag-2-line' },
];
const calCount = (summary: Record<DayStatus, number>, key: DayStatus): number => {
  const sum = (keys: DayStatus[]) => keys.reduce((n, s) => n + (summary[s] || 0), 0);
  if (key === 'Present') return sum(CAL_PRESENT_LIKE);
  if (key === 'Leave')   return sum(CAL_LEAVE_LIKE);
  return summary[key] || 0;
};

function AttendanceVisualBar({ segments, status }: { segments: Array<{ start: number; end: number; open?: boolean }>; status?: DayStatus }) {
  const ticks = Array.from({ length: 24 }, (_, h) => h);
  const band = status && segments.length === 0 ? VBAR_BANDS[status] : undefined;
  return (
    <div className="att-vbar">
      <div className="att-vbar-track">
        {ticks.map(h => <span key={h} className={`att-vbar-tick ${h % 6 === 0 ? 'is-major' : ''}`} />)}
        {band ? (
          <span
            className="att-vbar-band"
            style={{
              position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 11, fontWeight: 700, letterSpacing: 0.3,
              color: band.fg, background: band.bg, borderRadius: 6,
            }}
          >
            {band.label}
          </span>
        ) : segments.map((s, i) => (
          // One pill per work session (each punch-in → punch-out pair). The
          // empty track BETWEEN pills is the break/gap after a punch-out; the
          // next pill is where the employee punched back in.
          <span
            key={i}
            className="att-vbar-block"
            /* An open session (in with no out) on a PAST day has no known end,
               so it comes back zero-length — floor the width so the in time is
               still visible as a marker instead of vanishing. */
            style={{ left: `${(s.start / 24) * 100}%`, width: `${Math.max(((s.end - s.start) / 24) * 100, s.open ? 0.7 : 0)}%` }}
            title={`Session ${i + 1}: ${hourLabel(s.start)} – ${s.open ? 'missing' : hourLabel(s.end)}`}
          />
        ))}
      </div>
    </div>
  );
}

function EffectiveDonut({ effective, expected }: { effective: number; expected: number }) {
  const pct = Math.max(0, Math.min(1, effective / Math.max(1, expected)));
  const fill = (pct * 100).toFixed(4);
  return (
    <span
      className="att-fill-circle"
      style={{ backgroundImage: `linear-gradient(to top, #64c3d1 ${fill}%, transparent 0px)` }}
      aria-label={`${Math.round(pct * 100)}% effective`}
    />
  );
}

function TurtleIcon({ size = 24 }: { size?: number }) {
  return <Turtle size={size} color="#fbbf24" strokeWidth={1.5} aria-hidden="true" />;
}

function ArrivalIcon({ lateMinutes, arrival }: { lateMinutes: number; arrival: ReactNode }) {
  const late = lateMinutes > LATE_GRACE_MINUTES;
  return (
    <span className="att-arrival">
      <span className={`att-arrival-icon ${late ? 'att-arrival-icon--late' : 'att-arrival-icon--ok'}`}>
        {late ? <TurtleIcon size={20} /> : <i className="ri-check-line" />}
      </span>
      <span className="att-arrival-text">
        <span style={{ display: 'inline-block', minWidth: 62, textAlign: 'left' }}>{arrival || '—'}</span>
      </span>
    </span>
  );
}

interface Props {
  employee: AttLogsEmployee;
  /** Controlled 'YYYY-MM' — the parent refetches its summary on change. */
  month: string;
  onMonthChange: (m: string) => void;
  /** Open the regularization modal for a given ISO date. */
  onRegularize: (iso: string) => void;
}

export default function AttendanceLogsView({ employee, month, onMonthChange, onRegularize }: Props) {
  const [tab, setTab] = useState<'log' | 'calendar'>('log');
  const [viewMode, setViewMode] = useState<'list' | 'cal'>('list');
  /* Fixed 12-hour clock — the "24 hour format" toggle was removed from the
     header. Not read back from localStorage on purpose: anyone who had it
     switched on would be stranded in 24-hour with no control to undo it. */
  const hour24 = false;

  const [pageSize, setPageSize] = useState(5);
  const [page, setPage] = useState(1);
  /* Day-details popup. Deliberately NOT a reactstrap <Popover>: inside the
     employee-profile fullscreen overlay that component resolved its target by
     document lookup and threw ("could not be identified in the dom"), which
     took the whole tab down and left the Log button looking dead. This is a
     plain panel portalled to <body> and positioned from the button's own
     bounding rect — same att-log-pop markup and styling, no target resolution,
     no Popper, nothing that can silently fail. */
  const [popoverIdx, setPopoverIdx] = useState<number | null>(null);
  const [popPos, setPopPos] = useState<{ top: number; right: number } | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);

  const closeDayPop = () => { setPopoverIdx(null); setPopPos(null); };
  const openDayPop = (idx: number, btn: HTMLElement) => {
    if (popoverIdx === idx) { closeDayPop(); return; }
    const r = btn.getBoundingClientRect();
    // Sits to the LEFT of the button (its right edge 10px clear of it) and is
    // clamped into the viewport so a row near the bottom still shows the whole
    // panel, Regularize button included.
    const EST_H = 300;
    setPopPos({
      top:   Math.max(12, Math.min(r.top - 8, window.innerHeight - EST_H)),
      right: Math.max(12, window.innerWidth - r.left + 10),
    });
    setPopoverIdx(idx);
  };

  // Close on outside click, Esc, or any scroll/resize (the panel is pinned to a
  // rect that goes stale the moment the page moves under it).
  useEffect(() => {
    if (popoverIdx === null) return;
    const onDown = (e: MouseEvent) => {
      if (popRef.current?.contains(e.target as Node)) return;
      if ((e.target as HTMLElement)?.closest?.('.att-log-status-btn')) return;
      closeDayPop();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeDayPop(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', closeDayPop, true);
    window.addEventListener('resize', closeDayPop);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', closeDayPop, true);
      window.removeEventListener('resize', closeDayPop);
    };
  }, [popoverIdx]);

  const filteredLogs = useMemo(() => {
    if (!month) return employee.logs;
    return employee.logs.filter((l) => (l.iso || '').startsWith(month));
  }, [employee.logs, month]);

  // Month / employee / page / tab changes invalidate the anchored panel — its
  // row may not even be on screen any more.
  useEffect(() => { setPage(1); closeDayPop(); }, [month, employee.id]);
  useEffect(() => { closeDayPop(); }, [page, pageSize, tab]);

  const totalPages = Math.max(1, Math.ceil(filteredLogs.length / pageSize));
  const safePage   = Math.min(page, totalPages);
  const pageStart  = (safePage - 1) * pageSize;
  const pageEnd    = Math.min(pageStart + pageSize, filteredLogs.length);
  const visibleLogs = filteredLogs.slice(pageStart, pageEnd);

  const ranges = useMemo(() => {
    const out: { key: string; label: string; mk: string }[] = [];
    const t = parseISO(TODAY_ISO);
    for (let i = 0; i < 7; i++) {
      const d = new Date(t.getFullYear(), t.getMonth() - i, 1);
      const mk = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
      out.push({ key: mk, label: MONTHS_SHORT[d.getMonth()].toUpperCase(), mk });
    }
    return out;
  }, []);

  const fmtClock = (raw: string): string => {
    if (!raw || raw === '—') return raw;
    const m = /^(\d{1,2}):(\d{2})$/.exec(raw);
    if (!m) return raw;
    const h = Number(m[1]); const mm = m[2];
    if (hour24) return `${String(h).padStart(2,'0')}:${mm}`;
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12  = h % 12 === 0 ? 12 : h % 12;
    return `${String(h12).padStart(2,'0')}:${mm} ${ampm}`;
  };

  return (
    <Card className="att-logs-card mb-0">
      <CardBody>
        <div className="att-logs-headbar">
          <div className="d-flex align-items-center gap-3 min-w-0">
            <span className="att-logs-headbar-icon"><i className="ri-file-list-3-line" /></span>
            <div>
              <div className="att-logs-headbar-title">Logs &amp; Requests</div>
              <div className="att-logs-headbar-sub">Full attendance history for selected employee</div>
            </div>
          </div>
          <div className="d-flex align-items-center gap-2 flex-wrap">
            <div className="att-logs-ranges">
              {ranges.map(r => (
                <button key={r.key} type="button" className={`att-logs-range ${month === r.mk ? 'is-active' : ''}`} onClick={() => onMonthChange(r.mk)}>
                  {r.label}
                </button>
              ))}
            </div>
            <div className="att-logs-viewtoggle">
              <button type="button" className={`att-logs-vbtn ${viewMode === 'list' ? 'is-active' : ''}`} onClick={() => { setViewMode('list'); setTab('log'); }} title="Attendance Log view">
                <i className="ri-list-check" />Attendance Log
              </button>
              <button type="button" className={`att-logs-vbtn ${viewMode === 'cal' ? 'is-active' : ''}`} onClick={() => { setViewMode('cal'); setTab('calendar'); }} title="Calendar view">
                <i className="ri-calendar-2-line" />Calendar
              </button>
            </div>
          </div>
        </div>

        {/* No tab row — the labelled Attendance Log / Calendar buttons in the
            header strip above switch the same view, so this was a duplicate
            control for the same two states. */}

        {tab === 'log' && (
          <>
            <div
              className="table-responsive table-card border rounded att-logs-table-wrap--fixed"
              /* 34px accent header band + 46px rows — matches the DataTable
                 metrics the table now follows, so the card doesn't reserve
                 dead space below a short page. */
              style={{ minHeight: `${34 + Math.min(Math.max(visibleLogs.length, 1), pageSize) * 46}px` }}
            >
              <table className="table align-middle table-nowrap mb-0 att-logs-table att-logs-table--v2">
                {/* No `table-light`: the header is a solid accent band now, and
                    Bootstrap's light-header vars would paint over it. */}
                <thead>
                  <tr>
                    <th scope="col">Date</th>
                    <th scope="col" style={{ minWidth: 280 }}>Attendance Visual</th>
                    <th scope="col">Effective Hours</th>
                    <th scope="col">Gross Hours</th>
                    <th scope="col">Break Taken</th>
                    <th scope="col">Arrival</th>
                    <th scope="col">Late Duration</th>
                    <th scope="col" className="text-center pe-3">Log</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleLogs.map((l, i) => {
                    const dParts = l.date.split(' ');
                    const dateDay   = (dParts[0] || '').padStart(2, '0');
                    const dateMonth = dParts[1] || '';
                    const dateYear  = dParts[2] || '';
                    const formattedDate = `${dateDay}-${dateMonth}-${dateYear}`;
                    const popId = `ep-att-log-info-${employee.id}-${pageStart + i}`;
                    const isOpen = popoverIdx === pageStart + i;
                    const isHolidayDay = l.status === 'Holiday';
                    /* Approved-leave days carry no punches, so they get the same
                       single-line treatment as a weekly-off / holiday — a pill
                       beside the date and one centred line — instead of a row of
                       dashes across Effective / Gross / Break / Arrival / Late. */
                    const isLeaveDay = l.status === 'Leave' || l.status === 'Paid Leave' || l.status === 'Unpaid Leave';
                    const isOff   = l.status === 'Weekly Off' || isHolidayDay || isLeaveDay;
                    const isAbsent = l.status === 'Absent';
                    // A day with no punches at all (synthesised Absent / no record)
                    // should read as "No Time Entries Logged" rather than three
                    // separate blank dashes, so it's clear no data exists vs. a
                    // load failure.
                    const noEntries = isAbsent
                      && (!l.workSegments || l.workSegments.length === 0)
                      && (!l.firstIn || l.firstIn === '—');
                    const tone = STATUS_TONE[l.status];

                    if (isOff) {
                      return (
                        <tr key={pageStart + i} className={`att-log-row--off${isHolidayDay ? ' att-log-row--holiday' : ''}${isLeaveDay ? ' att-log-row--leave' : ''}`}>
                          <td className="att-log-datecell">
                            {formattedDate}
                            <span
                              className="att-log-woff-pill"
                              style={
                                isLeaveDay    ? { color: tone.fg, background: tone.bg }
                                : isHolidayDay ? { color: '#0c63b0', background: '#dceefe' }
                                : undefined
                              }
                            >
                              {isLeaveDay ? tone.label.toUpperCase() : isHolidayDay ? 'HOLIDAY' : 'W-OFF'}
                            </span>
                          </td>
                          <td colSpan={6} className="text-center att-log-woff-text">
                            {isLeaveDay
                              ? `${LEAVE_PORTION_LABEL[l.leavePortion || 'full']} ${tone.label}`
                              : isHolidayDay ? (l.holidayName ? `Holiday — ${l.holidayName}` : 'Holiday') : 'Full day Weekly-off'}
                          </td>
                          <td className="text-center">
                            {/* Leave / Holiday / Weekly-off rows have no punches to
                                review or regularize — muted dash rather than a dead
                                three-dot button that does nothing on click. Matches
                                the HR Attendance module (CBC #40). */}
                            <span className="text-muted">—</span>
                          </td>
                        </tr>
                      );
                    }

                    return (
                      <tr key={pageStart + i} className={isOpen ? 'is-open' : ''}>
                        <td className="att-log-datecell">
                          {formattedDate}
                          {/* Half-day leave on a day that was still (partly)
                              worked — the row keeps its punches and hours, and
                              the leave rides beside the date. */}
                          {isHalfLeave(l) && (
                            <span
                              className="att-log-woff-pill"
                              style={{ color: leaveToneOf(l).fg, background: leaveToneOf(l).bg }}
                              title={`${LEAVE_PORTION_LABEL[l.leavePortion!]} ${leaveToneOf(l).label}`}
                            >
                              {LEAVE_PORTION_PILL[l.leavePortion!]} {leaveToneOf(l).label.toUpperCase()}
                            </span>
                          )}
                        </td>
                        {noEntries ? (
                          /* No punches → hide the Attendance Visual bar entirely
                             and let the "No Time Entries Logged" note span the
                             visual + data columns (bug #14). */
                          <td colSpan={6} className="att-log-noentry-cell">
                            <span className="att-log-noentry-text">
                              <i className="ri-time-line" />
                              No Time Entries Logged
                            </span>
                          </td>
                        ) : (
                          <>
                            <td>
                              <AttendanceVisualBar segments={l.workSegments || []} status={l.status} />
                            </td>
                            <td>
                              {isAbsent ? <span className="text-muted">—</span> : (
                                <div className="att-log-eff">
                                  <EffectiveDonut effective={l.effectiveMinutes || 0} expected={l.expectedMinutes || 9 * 60} />
                                  <span className="att-log-eff-text">{l.worked}{(l.effectiveMinutes || 0) > (l.expectedMinutes || 9 * 60) ? ' +' : ''}</span>
                                </div>
                              )}
                            </td>
                            <td className={isAbsent ? 'text-muted' : ''}>
                              {isAbsent ? '—' : <>{l.worked}{(l.grossMinutes || 0) > (l.expectedMinutes || 9 * 60) ? ' +' : ''}</>}
                            </td>
                            <td className={isAbsent ? 'text-muted' : ''}>
                              {/* Break Taken = gross − effective (idle time inside the
                                  work window). Absent days show a dash (bug #22). */}
                              {isAbsent
                                ? '—'
                                : (() => {
                                    const brk = Math.max(0, (l.grossMinutes || 0) - (l.effectiveMinutes || 0));
                                    return brk > 0
                                      ? <span className="text-muted">{fmtDurHm(brk)}</span>
                                      : <span className="text-muted">—</span>;
                                  })()}
                            </td>
                            <td>
                              {isAbsent ? <span className="text-muted">—</span> : <ArrivalIcon lateMinutes={l.lateMinutes ?? 0} arrival={fmtClock(l.firstIn)} />}
                            </td>
                            <td>
                              {!isAbsent && (l.lateMinutes ?? 0) > LATE_GRACE_MINUTES
                                ? <span className="att-late-pill">{fmtLateDuration(l.lateMinutes ?? 0)} late</span>
                                : <span className="text-muted">—</span>}
                            </td>
                          </>
                        )}
                        <td className="text-center">
                          <button
                            type="button"
                            id={popId}
                            className={`att-log-status-btn ${l.exception || isAbsent ? 'is-warn' : 'is-ok'}`}
                            onClick={(ev) => openDayPop(pageStart + i, ev.currentTarget)}
                            title="Day details"
                          >
                            <i className={l.exception || isAbsent ? 'ri-error-warning-line' : 'ri-checkbox-circle-line'} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {visibleLogs.length === 0 && (
                    <tr><td colSpan={8} className="text-center text-muted py-4">No attendance records for this period.</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            <WorklistPager
              total={filteredLogs.length}
              page={safePage}
              pageSize={pageSize}
              onPage={setPage}
              onPageSize={(n) => { setPageSize(n); setPage(1); }}
            />
          </>
        )}

        {tab === 'calendar' && (
          <CalendarMonthGrid
            employee={employee}
            month={month}
            onPrevMonth={() => {
              const [y,m] = month.split('-').map(Number);
              const d = new Date(y, m - 2, 1);
              onMonthChange(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`);
            }}
            onNextMonth={() => {
              const [y,m] = month.split('-').map(Number);
              const d = new Date(y, m, 1);
              onMonthChange(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`);
            }}
            onPickDate={onRegularize}
          />
        )}

        {/* Day-details panel — portalled to <body> so it escapes the scrolling
            table AND the profile's fullscreen overlay stacking context. */}
        {popoverIdx !== null && popPos && filteredLogs[popoverIdx] && createPortal(
          (() => {
            const l = filteredLogs[popoverIdx];
            const tone = STATUS_TONE[l.status];
            const isAbsent = l.status === 'Absent';
            const dParts = l.date.split(' ');
            const dDay   = (dParts[0] || '').padStart(2, '0');
            const dMonth = dParts[1] || '';
            return (
              <div
                ref={popRef}
                className="popover show att-log-pop att-log-pop--keka ep-att-log-pop"
                style={{ position: 'fixed', top: popPos.top, right: popPos.right, zIndex: 2090 }}
              >
                <div className="popover-body">
                  <div className="att-log-pop-head--v2">
                    <span className="att-log-pop-head-text">
                      {tone.label}
                      {l.exception && <> · {l.exception}</>}
                    </span>
                    {(l.exception || isAbsent) && (
                      <i className="ri-error-warning-fill att-log-pop-warn" />
                    )}
                  </div>

                  {l.shift !== '—' && (
                    <div className="att-log-pop-body">
                      <div className="att-log-pop-shift--v2">
                        {(() => {
                          const raw = l.shift;
                          if (raw === 'WFH') return 'WFH Shift';
                          return /shift\s*$/i.test(raw) ? raw : `${raw} Shift`;
                        })()} ({dDay} {dMonth})
                      </div>
                      <div className="att-log-pop-shift-time--v2">
                        {fmtClock(employee.shiftStart)} - {fmtClock(employee.shiftEnd)}
                      </div>
                    </div>
                  )}

                  {/* Regularize must always be reachable, even for a day with no
                      configured shift (l.shift === '—') — otherwise the whole
                      action disappears and the icon looks dead (bug #24). */}
                  {l.iso && (
                    <div className="att-log-pop-body att-log-pop-body--tight">
                      <button type="button" className="att-log-pop-regularize" onClick={() => { closeDayPop(); onRegularize(l.iso!); }}>
                        <i className="ri-pencil-line" />
                        Regularize
                      </button>
                    </div>
                  )}

                  {l.workSegments && l.workSegments.length > 0 && (
                    <div className="att-log-pop-body att-log-pop-body--tight">
                      <div className="att-log-pop-pairs">
                        {l.workSegments.map((seg, idx) => {
                          const isLast = idx === l.workSegments!.length - 1;
                          // `seg.open` — punched in, never out: show MISSING for the
                          // out time even while the day still reads 'Present'.
                          const outMissing = seg.open || (isLast && l.status === 'Missing Out');
                          const inHrs = Math.floor(seg.start);
                          const inMin = Math.floor((seg.start - inHrs) * 60);
                          const inSec = Math.floor((((seg.start - inHrs) * 60) - inMin) * 60);
                          const outHrs = Math.floor(seg.end);
                          const outMin = Math.floor((seg.end - outHrs) * 60);
                          const outSec = Math.floor((((seg.end - outHrs) * 60) - outMin) * 60);
                          const fmtPair = (h: number, m: number, s: number) => {
                            if (hour24) return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
                            const ampm = h >= 12 ? 'PM' : 'AM';
                            const h12  = h % 12 === 0 ? 12 : h % 12;
                            return `${String(h12).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')} ${ampm}`;
                          };
                          return (
                            <div key={idx} className="att-log-pop-pair">
                              <span className="att-log-pop-cell att-log-pop-cell--in">
                                <i className="ri-arrow-right-up-line" />
                                {fmtPair(inHrs, inMin, inSec)}
                              </span>
                              <span className="att-log-pop-cell att-log-pop-cell--out">
                                <i className="ri-arrow-right-up-line" />
                                {outMissing ? <span className="att-log-pop-missing">MISSING</span> : fmtPair(outHrs, outMin, outSec)}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })(),
          document.body,
        )}
      </CardBody>
    </Card>
  );
}

function CalendarMonthGrid({
  employee, month, onPrevMonth, onNextMonth, onPickDate,
}: {
  employee: AttLogsEmployee;
  month: string;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  onPickDate: (iso: string) => void;
}) {
  const [y, m] = month.split('-').map(Number);
  const first  = new Date(y, m - 1, 1);
  const last   = new Date(y, m, 0);
  const startWeekday = first.getDay();
  const daysInMonth  = last.getDate();

  const logByIso = new Map<string, DayStatus>();
  for (const lg of (employee.logs || [])) {
    if (lg.iso) logByIso.set(lg.iso, lg.status);
  }
  const weeklyOffDays = new Set<number>();
  for (const tok of (employee.weeklyOff || '').split(/[\s,]+/)) {
    const key = tok.slice(0, 3).toLowerCase();
    const map: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
    if (map[key] !== undefined) weeklyOffDays.add(map[key]);
  }
  const statusFor = (iso: string): DayStatus | null => {
    if (iso > TODAY_ISO) return null;
    const fromLog = logByIso.get(iso);
    if (fromLog) return fromLog;
    const d = parseISO(iso);
    if (weeklyOffDays.has(d.getDay())) return 'Weekly Off';
    return null;
  };

  type Cell = { iso: string; day: number; inMonth: boolean; future: boolean; status: DayStatus | null };
  const cells: Cell[] = [];
  const prevMonthLast = new Date(y, m - 1, 0).getDate();
  for (let i = 0; i < startWeekday; i++) {
    const d = new Date(y, m - 2, prevMonthLast - startWeekday + i + 1);
    const iso = toISO(d);
    cells.push({ iso, day: d.getDate(), inMonth: false, future: iso > TODAY_ISO, status: statusFor(iso) });
  }
  for (let day = 1; day <= daysInMonth; day++) {
    const d = new Date(y, m - 1, day);
    const iso = toISO(d);
    cells.push({ iso, day, inMonth: true, future: iso > TODAY_ISO, status: statusFor(iso) });
  }
  while (cells.length % 7 !== 0 || cells.length < 42) {
    const idx = cells.length - (startWeekday + daysInMonth) + 1;
    const d = new Date(y, m, idx);
    const iso = toISO(d);
    cells.push({ iso, day: d.getDate(), inMonth: false, future: iso > TODAY_ISO, status: statusFor(iso) });
    if (cells.length >= 42) break;
  }

  const summary = cells.reduce<Record<DayStatus, number>>((acc, c) => {
    if (!c.inMonth || !c.status || c.future) return acc;
    acc[c.status] = (acc[c.status] || 0) + 1;
    return acc;
  }, { Present: 0, Late: 0, 'Half Day': 0, 'Missing In': 0, 'Missing Out': 0, 'Weekly Off': 0, Holiday: 0, 'On Duty': 0, 'Work From Home': 0, Absent: 0, Leave: 0, 'Paid Leave': 0, 'Unpaid Leave': 0, Corrected: 0 });

  return (
    <div className="att-cal">
      <div className="att-cal-head">
        <button type="button" className="att-cal-nav" onClick={onPrevMonth}><i className="ri-arrow-left-s-line" /></button>
        <div className="att-cal-title">{MONTHS_SHORT[m - 1]} {y}</div>
        <button type="button" className="att-cal-nav" onClick={onNextMonth}><i className="ri-arrow-right-s-line" /></button>
      </div>

      <div className="att-cal-kpis">
        {CAL_KPIS.map(k => {
          const tone = STATUS_TONE[k.key];
          return (
            <div key={k.key} className="rec-kpi-card">
              <span className="rec-kpi-strip" style={{ background: tone.dot }} />
              <div className="rec-kpi-text">
                <span className="rec-kpi-label">{k.label}</span>
                <span className="rec-kpi-num">{calCount(summary, k.key)}</span>
              </div>
              <span className="rec-kpi-icon" style={{ background: tone.dot }}>
                <i className={k.icon} />
              </span>
            </div>
          );
        })}
      </div>

      <div className="att-cal-week">
        {WEEK_LABELS.map(d => <div key={d} className="att-cal-weekday">{d}</div>)}
      </div>
      <div className="att-cal-grid">
        {cells.map((c, i) => {
          const tone = c.status ? STATUS_TONE[c.status] : null;
          const isToday = c.iso === TODAY_ISO;
          return (
            <button
              key={i}
              type="button"
              className={`att-cal-cell ${c.inMonth ? '' : 'is-out'} ${c.future ? 'is-future' : ''} ${isToday ? 'is-today' : ''}`}
              disabled={c.future || !c.inMonth}
              onClick={() => onPickDate(c.iso)}
              title={tone ? `${c.day} — ${tone.label}` : `${c.day}`}
              style={tone ? { borderColor: tone.dot } : undefined}
            >
              <span className="att-cal-day">{c.day}</span>
              {tone && (
                <span className="att-cal-status att-tone-pill" data-status={c.status} style={{ color: tone.fg, background: tone.bg }}>
                  <span className="att-cal-status-dot" style={{ background: tone.dot }} />
                  {tone.label}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
