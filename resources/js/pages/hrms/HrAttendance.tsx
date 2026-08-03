import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Card, CardBody, Col, Row, Input, Popover, PopoverBody } from 'reactstrap';
import { MasterFormStyles, MasterDatePicker } from '../master/masterFormKit';
import { useToast } from '../../contexts/ToastContext';
import { Turtle } from 'lucide-react';
import api from '../../api';
import RegularizationModal, { type RegPrefillPunch } from './RegularizationModal';
import RegularizationApprovals from './RegularizationApprovals';
import type { ApiRegularization } from './regularizationApi';
import WorklistPager from '../../components/ui/WorklistPager';
import { Shimmer, ShimmerTable } from '../../components/ui/Shimmer';
import '../../../css/recruitment.css';

const TODAY_ISO = new Date().toISOString().slice(0, 10);
const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const WEEK_LABELS  = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

const parseISO  = (iso: string) => { const [y,m,d] = iso.split('-').map(Number); return new Date(y, m - 1, d); };
const toISO     = (d: Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const addDays   = (iso: string, n: number) => { const d = parseISO(iso); d.setDate(d.getDate() + n); return toISO(d); };
const fmtLong   = (iso: string) => { const d = parseISO(iso); return `${WEEK_LABELS[d.getDay()]}, ${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`; };
const monthKey  = (iso: string) => `${iso.slice(0,7)}`;
const monthOf   = (iso: string) => MONTHS_SHORT[parseISO(iso).getMonth()];
const yearOf    = (iso: string) => parseISO(iso).getFullYear();

type DayStatus =
  | 'Present'
  | 'Late'
  | 'Half Day'
  | 'Missing In'
  | 'Missing Out'
  | 'Weekly Off'
  | 'Holiday'
  | 'On Duty'
  | 'Work From Home'
  | 'Absent'
  | 'Leave'
  | 'Paid Leave'
  | 'Unpaid Leave'
  | 'Corrected';

type CorrStatus = 'Pending' | 'Approved' | 'Rejected';

interface AttendanceEmployee {
  id: number;
  empCode: string;
  name: string;
  initials: string;
  accent: string;
  department: string;
  designation: string;
  managerName: string;
  shift: string;
  shiftStart: string;
  shiftEnd: string;
  weeklyOff: string;
  attendanceNumber: string;
  status: DayStatus;
  firstIn?: string;
  lastOut?: string | null;
  workedMinutes: number;
  workedSeconds?: number;
  workedCompletedSeconds?: number;
  openInAt?: string | null;
  autoCutoffAt?: string | null;
  expectedMinutes: number;
  lateByMinutes: number;
  punches: PunchEvent[];
  correction?: CorrectionRequest;
  presentDays: number;
  lateMarks: number;
  missingPunch: number;
  compliancePct: number;
  logs: AttendanceLog[];
}

interface PunchEvent {
  time: string;
  type: 'in' | 'out' | 'missing';
  source: 'BIOMETRIC' | 'MANUAL' | 'WEB' | 'MOBILE';
  label?: string;
  worked?: string;
  breakAfter?: string;
  note?: string;
  lat?: number | null;
  lng?: number | null;
  place?: string | null;
}

interface CorrectionRequest {
  id: string;
  date: string;
  type: string;
  requestedIn?: string;
  requestedOut?: string;
  reason: string;
  status: CorrStatus;
  raisedAt: string;
  managerActionAt?: string;
  hrActionAt?: string;
}

interface AttendanceLog {
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
  exception?: string;
  /* `open` = an in-punch with no matching out (still clocked in, or a forgotten
     check-out). The out time is unknown, so the popover prints MISSING for it. */
  workSegments?: Array<{ start: number; end: number; open?: boolean }>;
  effectiveMinutes?: number;
  grossMinutes?: number;
  expectedMinutes?: number;
  lateMinutes?: number;
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

const ACCENTS = ['#7c5cfc', '#0ab39c', '#f7b84b', '#f06548', '#0ea5e9', '#e83e8c', '#0c63b0', '#22c55e', '#a855f7'];
const accent = (i: number) => ACCENTS[i % ACCENTS.length];
const fmtMinutes = (m: number) => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
// Human-readable late duration for the Logs table: "37 min" under an hour,
// "1h 05m" once it crosses the hour mark.
const fmtLateDuration = (m: number) => m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${m} min`;
// Break Taken = idle time inside the work window (gross − effective).
const fmtDurHm = (m: number) => m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${m} min`;
// Grace window (minutes after shift start) before an arrival counts as late —
// mirrors the server rule in AttendanceController (`minutesBetween > 10`). Below
// this an arrival is on-time; at/above it we show the minutes-late measured from
// the shift start time (e.g. 9:30 start, arrive 9:47 → 17 min late).
const LATE_GRACE_MINUTES = 10;

/* ── Calendar month summary tiles ──────────────────────────────────────────
   A day carries ONE status, but the KPI totals aren't mutually exclusive:
   turning up late is still turning up, so a Late day counts under BOTH Present
   and Late. Same for a half day, a forgotten punch (Missing In/Out) and a
   corrected day — the employee attended, and only the exception tile should
   single them out. `Leave` aggregates Paid + Unpaid, which previously read 0
   even with leave days on the calendar because the raw statuses are stored as
   "Paid Leave" / "Unpaid Leave". WFH and On Duty stay out of Present: they get
   their own tiles and aren't office attendance. */
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

/** "18:30" → "06:30 PM". Plain string (renderTime returns a ReactNode). */
const fmt12h = (hhmm?: string | null): string => {
  const m = /^(\d{1,2}):(\d{2})/.exec((hhmm || '').trim());
  if (!m) return '';
  const h = Number(m[1]);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${String(h12).padStart(2, '0')}:${m[2]} ${ampm}`;
};

const renderTime = (t?: string | null, hour24 = false): ReactNode => {
  if (!t) return '—';
  const m = /^(\d{1,2}):(\d{2})/.exec(t);
  if (!m) return t;
  const h = Number(m[1]);
  const mm = m[2];
  if (hour24) return `${String(h).padStart(2,'0')}:${mm}`;
  const ampm = h >= 12 ? ' PM' : ' AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return <>{`${String(h12).padStart(2,'0')}:${mm}`}<span className="att-tile-am">{ampm}</span></>;
};

export default function HrAttendance() {
  const [employees, setEmployees] = useState<AttendanceEmployee[]>([]);
  const [employeesLoading, setEmployeesLoading] = useState<boolean>(true);
  const [employeesError, setEmployeesError] = useState<string | null>(null);
  const [filter, setFilter]       = useState<'all' | 'on_time' | 'late' | 'missing' | 'absent' | 'wfh' | 'leave'>('all');
  const [search, setSearch]       = useState('');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [logTab, setLogTab]       = useState<'log' | 'calendar'>('log');
  const [regOpen, setRegOpen]     = useState(false);
  // Date + prefill punches the regularization modal opens on. Set from the log
  // row that was clicked; falls back to the day panel's date when empty.
  const [regDate, setRegDate]     = useState<string>('');
  const [regPunches, setRegPunches] = useState<RegPrefillPunch[] | null>(null);

  /* Clock format is fixed at 12-hour. The "24 hour format" toggle was removed
     from the Logs & Requests header, so this is a constant rather than stored
     state — the old localStorage preference is deliberately NOT read back: a
     user who had switched it on would otherwise be stuck in 24-hour with no
     control left to turn it off. Every formatter still takes the flag, so
     restoring a toggle later only means putting the control back. */
  const hour24 = false;

  const [viewDate, setViewDate]   = useState<string>(TODAY_ISO);
  const [calMonth, setCalMonth]   = useState<string>(monthKey(TODAY_ISO));
  const isToday = viewDate === TODAY_ISO;
  const isPast  = viewDate < TODAY_ISO;

  useEffect(() => {
    const wantedMonth = monthKey(viewDate);
    setCalMonth((prev) => (prev === wantedMonth ? prev : wantedMonth));
  }, [viewDate]);

  // Fetch real attendance for the inspected date; refires on viewDate change.
  useEffect(() => {
    let cancelled = false;
    setEmployeesLoading(true);
    setEmployeesError(null);
    api.get('/attendance/daily-view', { params: { date: viewDate } })
      .then((res) => {
        if (cancelled) return;
        const rows: AttendanceEmployee[] = Array.isArray(res.data) ? res.data : [];
        const hydrated = rows.map((e, i) => ({
          ...e,
          accent: e.accent || accent(i),
          punches: Array.isArray(e.punches) ? e.punches : [],
          logs:    Array.isArray(e.logs)    ? e.logs    : [],
        }));
        setEmployees(hydrated);
        setSelectedId((prev) => {
          if (prev != null && hydrated.some((e) => e.id === prev)) return prev;
          return hydrated[0]?.id ?? null;
        });
      })
      .catch((err) => {
        if (cancelled) return;
        setEmployeesError(err?.response?.data?.message || 'Failed to load attendance for this date.');
        setEmployees([]);
      })
      .finally(() => { if (!cancelled) setEmployeesLoading(false); });
    return () => { cancelled = true; };
  }, [viewDate]);

  const counts = useMemo(() => ({
    all:     employees.length,
    on_time: employees.filter(e => e.status === 'Present').length,
    late:    employees.filter(e => e.status === 'Late' || e.status === 'Half Day').length,
    missing: employees.filter(e => e.status === 'Missing In' || e.status === 'Missing Out').length,
    absent:  employees.filter(e => e.status === 'Absent').length,
    wfh:     employees.filter(e => e.status === 'Work From Home' || e.status === 'On Duty').length,
    leave:   employees.filter(e => e.status === 'Leave').length,
  }), [employees]);

  const filteredEmployees = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return employees.filter(e => {
      if (filter === 'on_time' && e.status !== 'Present') return false;
      if (filter === 'late'    && e.status !== 'Late' && e.status !== 'Half Day') return false;
      if (filter === 'missing' && e.status !== 'Missing In' && e.status !== 'Missing Out') return false;
      if (filter === 'absent'  && e.status !== 'Absent') return false;
      if (filter === 'wfh'     && e.status !== 'Work From Home' && e.status !== 'On Duty') return false;
      if (filter === 'leave'   && e.status !== 'Leave') return false;
      if (!needle) return true;
      return [e.name, e.empCode, e.department, e.designation, e.attendanceNumber].some(v => (v || '').toLowerCase().includes(needle));
    });
  }, [employees, filter, search]);

  const selected = useMemo(
    () => employees.find(e => e.id === selectedId) || employees[0],
    [employees, selectedId]
  );

  // After a regularization is persisted, reflect a Pending correction on the
  // selected employee so the Logs/Requests card updates immediately. The
  // request itself is already saved server-side and routed for approval.
  const onRegularizationSubmitted = (row: ApiRegularization) => {
    const firstPunch = (row.punches ?? [])[0];
    const newReq: CorrectionRequest = {
      id: `REG-${row.id}`,
      date: row.regularization_date,
      type: row.type || (row.mode === 'exempt' ? 'On Duty (OD)' : 'Forgot to Punch'),
      requestedIn: firstPunch?.in ?? undefined,
      requestedOut: firstPunch?.out ?? undefined,
      reason: row.reason || '',
      status: 'Pending',
      raisedAt: new Date().toLocaleString(),
    };
    if (selected) {
      setEmployees(prev => prev.map(e => e.id === selected.id ? { ...e, correction: newReq } : e));
    }
    setRegOpen(false);
  };

  /* Open the regularization modal for a SPECIFIC log row. It used to just flip
     `regOpen` and let the modal read `viewDate`, so Regularize on any row —
     1 Aug, 3 Aug, anything — always opened on the date pinned in the day panel
     above, and prefilled that day's punches. Both now follow the row clicked. */
  const openRegularizeFor = (iso: string) => {
    const log = selected?.logs?.find(l => l.iso === iso);
    // Rebuild prefill punches from the row's work segments (decimal hours →
    // "HH:MM"). An open segment contributes only its in-punch, so a forgotten
    // check-out opens with the out box empty and ready to fill.
    const hhmm = (h: number) => {
      let hr = Math.floor(h);
      let mi = Math.round((h - hr) * 60);
      if (mi === 60) { hr += 1; mi = 0; }
      return `${String(hr).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
    };
    const punches = (log?.workSegments ?? []).flatMap(s => ([
      { time: hhmm(s.start), type: 'in' as const },
      ...(s.open ? [] : [{ time: hhmm(s.end), type: 'out' as const }]),
    ]));
    setRegDate(iso);
    setRegPunches(punches);
    setRegOpen(true);
  };

  if (employeesLoading) {
    return (
      <>
        <MasterFormStyles />
        <Row>
            <div
              style={{
                padding: '18px',
                marginBottom: '24px',
              }}
            >
              <div className="d-flex align-items-center justify-content-between gap-3 mb-3 flex-wrap">
                <div className="d-flex align-items-center gap-3">
                  <Shimmer width={44} height={44} radius={12} />
                  <div className="d-flex flex-column gap-2">
                    <Shimmer width={150} height={18} />
                    <Shimmer width={280} height={12} />
                  </div>
                </div>
                <Shimmer width={230} height={40} radius={10} />
              </div>

              <Row className="g-2 align-items-stretch">
                <Col xl={3} lg={4} md={5} xs={12}>
                  <div className="d-flex flex-column gap-2">
                    <div className="d-flex gap-2 flex-wrap">
                      {Array.from({ length: 5 }).map((_, i) => <Shimmer key={i} width={56} height={30} radius={8} />)}
                    </div>
                    <Shimmer height={38} radius={10} />
                    {Array.from({ length: 7 }).map((_, i) => (
                      <div key={i} className="d-flex align-items-center gap-2" style={{ padding: '8px 4px' }}>
                        <Shimmer width={40} height={40} radius={999} />
                        <div className="flex-grow-1 d-flex flex-column gap-2">
                          <Shimmer height={13} width="70%" />
                          <Shimmer height={11} width="45%" />
                        </div>
                        <Shimmer width={64} height={22} radius={999} />
                      </div>
                    ))}
                  </div>
                </Col>

                <Col xl={9} lg={8} md={7} xs={12}>
                  <div className="d-flex align-items-center gap-3 mb-3">
                    <Shimmer width={48} height={48} radius={999} />
                    <div className="flex-grow-1 d-flex flex-column gap-2">
                      <Shimmer height={16} width={200} />
                      <Shimmer height={12} width={320} />
                    </div>
                  </div>

                  <Row className="g-2 mb-2 row-cols-xl-4 row-cols-md-2 row-cols-2">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <Col key={i}><Shimmer height={84} radius={12} /></Col>
                    ))}
                  </Row>

                  <Row className="g-2">
                    <Col xl={7} lg={12}><Shimmer height={230} radius={14} /></Col>
                    <Col xl={5} lg={12}><Shimmer height={230} radius={14} /></Col>
                  </Row>
                </Col>
              </Row>

              <div className="mt-3">
                <Shimmer height={48} radius={12} style={{ marginBottom: 12 }} />
                <ShimmerTable rows={6} cols={6} />
              </div>
            </div>
        </Row>
      </>
    );
  }

  if (!selected) {
    return (
      <>
        <MasterFormStyles />
        <Row>
          <Col xs={12}>
            <Card>
              <CardBody>
                <div style={{ minHeight: 320, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12, color: 'var(--vz-secondary-color)' }}>
                  {employeesError ? (
                    <>
                      <i className="ri-error-warning-line" style={{ fontSize: 28, color: '#f06548' }} />
                      <span style={{ fontSize: 13 }}>{employeesError}</span>
                    </>
                  ) : (
                    <>
                      <i className="ri-team-line" style={{ fontSize: 28 }} />
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--vz-body-color)' }}>No employees tracked for attendance</div>
                      <div style={{ fontSize: 12 }}>Add employees with Attendance Tracking enabled to see their punches here.</div>
                    </>
                  )}
                </div>
              </CardBody>
            </Card>
          </Col>
        </Row>
      </>
    );
  }

  return (
    <>
      <MasterFormStyles />
      <Row>
        <Col xs={12}>
          
            <div className="frm-cstrip mb-3">
              <span className="frm-cstrip-accent" />
              <div className="frm-cstrip-left">
                <div className="frm-cstrip-icon"><i className="ri-time-line" /></div>
                <div className="min-w-0">
                  <div className="d-flex align-items-center gap-2 flex-wrap">
                    <span className="frm-cstrip-title">Attendance</span>
                    {isPast && <span className="att-head-readonly"><i className="ri-eye-line" />Read-only · past day</span>}
                  </div>
                  <div className="frm-cstrip-sub">
                    Track punches, exceptions and regularizations · pick any past day to review
                  </div>
                </div>
              </div>
              <div className="d-flex align-items-center gap-2 flex-wrap flex-shrink-0">
                <div className="att-date-nav">
                  <button type="button" className="att-date-nav-btn" onClick={() => setViewDate(addDays(viewDate, -1))} aria-label="Previous day">
                    <i className="ri-arrow-left-s-line" />
                  </button>
                  <div className="att-date-nav-pick">
                    {/* Cap at today — attendance can't exist for a future date,
                        so future days must not be selectable (bug #17). The
                        Next-day button is already disabled at today. */}
                    <MasterDatePicker value={viewDate} onChange={v => setViewDate(v || TODAY_ISO)} maxDate={TODAY_ISO} placeholder="Pick date" />
                  </div>
                  <button type="button" className="att-date-nav-btn" onClick={() => setViewDate(addDays(viewDate, 1))} aria-label="Next day" disabled={isToday}>
                    <i className="ri-arrow-right-s-line" />
                  </button>
                  {!isToday && (
                    <button type="button" className="att-date-nav-today" onClick={() => setViewDate(TODAY_ISO)}>
                      Today
                    </button>
                  )}
                </div>
              </div>
            </div>

            <Row className="g-2 align-items-stretch">
              <Col xl={3} lg={4} md={5} xs={12} className="att-emplist-col">
                <div className="att-emplist">
                  <div className="att-emplist-tabs">
                    {[
                      { k: 'all'     as const, l: 'All',      c: counts.all },
                      { k: 'on_time' as const, l: 'On Time',  c: counts.on_time },
                      { k: 'late'    as const, l: 'Late',     c: counts.late },
                      { k: 'absent'  as const, l: 'Absent',   c: counts.absent },
                      { k: 'leave'   as const, l: 'Leave',    c: counts.leave },
                    ].map(t => (
                      <button key={t.k} type="button" className={`att-emplist-tab ${filter === t.k ? 'is-active' : ''}`} onClick={() => setFilter(t.k)}>
                        {t.l} <span className="att-emplist-tab-count">{t.c}</span>
                      </button>
                    ))}
                  </div>

                  <div className="att-emplist-search">
                    <div className="rec-req-search search-box">
                      <Input type="text" className="form-control form-control-sm" placeholder="Search name, EMP-ID, biometric…" value={search} onChange={e => setSearch(e.target.value)} />
                      <i className="ri-search-line search-icon" />
                    </div>
                  </div>

                  <div className="att-emplist-meta">
                    <span>{filteredEmployees.length} of {employees.length} employees</span>
                  </div>

                  <div className="att-emplist-scroll">
                    {filteredEmployees.map(e => {
                      const tone = STATUS_TONE[e.status];
                      const isSelected = e.id === selectedId;
                      return (
                        <button key={e.id} type="button" onClick={() => setSelectedId(e.id)} className={`att-emp-card ${isSelected ? 'is-selected' : ''}`}>
                          <span className="att-emp-avatar" style={{ background: e.accent }}>{e.initials.slice(0, 2).toUpperCase()}</span>
                          <div className="att-emp-info">
                            <div className="att-emp-name">{e.name}</div>
                            <div className="att-emp-meta">{e.empCode} · {e.department}</div>
                            {e.correction?.status === 'Pending' && (
                              <span className="att-emp-corr-pill"><i className="ri-error-warning-line" />Correction Pending</span>
                            )}
                          </div>
                          <div className="att-emp-right">
                            <span className="att-status-pill att-tone-pill" data-status={e.status} style={{ color: tone.fg, background: tone.bg }}>
                              {tone.label}
                            </span>
                            {e.firstIn && <div className="att-emp-time">{renderTime(e.firstIn, hour24)}</div>}
                          </div>
                        </button>
                      );
                    })}
                    {filteredEmployees.length === 0 && (
                      <div className="att-emplist-empty">
                        <i className="ri-search-line" />
                        <span>No employees match.</span>
                      </div>
                    )}
                  </div>
                </div>
              </Col>

              <Col xl={9} lg={8} md={7} xs={12}>
                <div className="att-emp-bar">
                  <span className="att-emp-bar-avatar" style={{ background: selected.accent }}>{selected.initials.slice(0, 2).toUpperCase()}</span>
                  <div className="att-emp-bar-info">
                    <div className="att-emp-bar-name">{selected.name}</div>
                    <div className="att-emp-bar-meta">
                      {selected.empCode} · {selected.designation} · {selected.department}
                    </div>
                  </div>
                  <div className="att-emp-bar-chips">
                    {/* Shift NAME + the window it resolves to. The name alone
                        ("Evening Shift") told HR nothing about when the day
                        actually starts, and the window is what every late /
                        effective-hours reading on this screen is measured
                        against — it comes from the branch's Shift Details via
                        Employee::resolveShiftWindow(). */}
                    <span className="att-chip">
                      <i className="ri-time-line" />
                      {selected.shift}
                      {selected.shiftStart && selected.shiftEnd && (
                        <span className="att-chip-sub">{fmt12h(selected.shiftStart)} – {fmt12h(selected.shiftEnd)}</span>
                      )}
                    </span>
                    <span className="att-chip"><i className="ri-calendar-2-line" />Off: {selected.weeklyOff}</span>
                    <span className="att-chip"><i className="ri-fingerprint-line" />{selected.attendanceNumber}</span>
                    <span className="att-chip"><i className="ri-user-star-line" />Mgr: {selected.managerName}</span>
                  </div>
                </div>

                <Row className="g-2 mb-3 align-items-stretch row-cols-xl-4 row-cols-md-2 row-cols-2">
                  {([
                    { key: 'pres', label: 'Present Days',   sub: 'This month',     value: selected.presentDays,        icon: 'ri-checkbox-circle-line', gradient: 'linear-gradient(135deg,#0ab39c,#22c8a9)', deep: '#0ab39c' },
                    { key: 'late', label: 'Late Marks',     sub: 'This month',     value: selected.lateMarks,          icon: 'ri-time-line',            gradient: 'linear-gradient(135deg,#f7b84b,#fbcc77)', deep: '#92400e' },
                    { key: 'miss', label: 'Missing Punches',sub: 'This month',     value: selected.missingPunch,       icon: 'ri-error-warning-line',   gradient: 'linear-gradient(135deg,#f06548,#f47c5d)', deep: '#b91c1c' },
                    { key: 'comp', label: 'Compliance',     sub: 'Attendance rate',value: `${selected.compliancePct}%`,icon: 'ri-shield-check-line',    gradient: 'linear-gradient(135deg,#0d9488,#14b8a6)', deep: '#0d9488' },
                  ] as const).map(k => (
                    <Col key={k.key}>
                      <div className="rec-kpi-card h-100">
                        <span className="rec-kpi-strip" style={{ background: k.gradient }} />
                        <div className="rec-kpi-text">
                          <span className="rec-kpi-label">{k.label}</span>
                          <span className="rec-kpi-num">{k.value}</span>
                          <span className="att-kpi-sub">{k.sub}</span>
                        </div>
                        <span className="rec-kpi-icon" style={{ background: k.gradient }}>
                          <i className={k.icon} />
                        </span>
                      </div>
                    </Col>
                  ))}
                </Row>

                <div className="att-section-head">
                  <span className="att-section-label">{isToday ? "TODAY'S RECORD" : 'DAY RECORD'}</span>
                  <span className="att-section-date">{fmtLong(viewDate)}</span>
                </div>
                <Row className="g-2 align-items-stretch">
                  <Col xl={7} lg={12}>
                    <TodayRecordCard employee={selected} viewDate={viewDate} isPast={isPast} hour24={hour24} />
                  </Col>
                  <Col xl={5} lg={12}>
                    <PunchTimelineCard employee={selected} />
                  </Col>
                </Row>
              </Col>
            </Row>

            <div className="mt-2">
              <LogsRequestsCard
                employee={selected}
                tab={logTab} setTab={setLogTab}
                calMonth={calMonth} setCalMonth={setCalMonth}
                onPickDate={(iso) => setViewDate(iso)}
                onRegularize={openRegularizeFor}
                hour24={hour24}
              />
            </div>

            <RegularizationApprovals />
        </Col>
      </Row>

      {selected && (
        <RegularizationModal
          open={regOpen}
          employeeId={selected.id}
          managerName={selected.managerName}
          dateIso={regDate || viewDate}
          shiftStart={selected.shiftStart}
          shiftEnd={selected.shiftEnd}
          shiftName={selected.shift}
          initialPunches={regPunches ?? selected.punches}
          onClose={() => setRegOpen(false)}
          onSubmitted={onRegularizationSubmitted}
        />
      )}
    </>
  );
}

function TodayRecordCard({
  employee, viewDate, isPast, hour24 = false,
}: {
  employee: AttendanceEmployee;
  viewDate: string;
  isPast: boolean;
  hour24?: boolean;
}) {
  void isPast;
  const effectiveStatus: DayStatus = employee.status;
  const tone = STATUS_TONE[effectiveStatus];

  // Live WORKED total — ticks every second while the employee is still on the
  // clock (an open 'in' with no matching 'out'), mirroring the employee's own
  // Clock-In screen so the same record reads the same in both portals. The
  // open pair is extended only up to a 9 PM auto-checkout (autoCutoffAt): the
  // timer runs to min(now, 9 PM) and then freezes — no phantom hours past 9 PM.
  // Past/closed days have no open punch, so the value is the static server
  // figure (which the model already capped at 9 PM for a missing out-punch).
  const openInMs = !isPast && employee.openInAt ? new Date(employee.openInAt).getTime() : null;
  const cutoffMs = employee.autoCutoffAt ? new Date(employee.autoCutoffAt).getTime() : null;
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (openInMs == null) return;
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [openInMs]);
  // For an open (today) record, build from the COMPLETED-pairs baseline and add
  // the open stretch capped at 9 PM. Otherwise use the full server figure.
  const liveWorkedSecs = (() => {
    if (openInMs == null) {
      return typeof employee.workedSeconds === 'number' ? employee.workedSeconds : employee.workedMinutes * 60;
    }
    const base = typeof employee.workedCompletedSeconds === 'number'
      ? employee.workedCompletedSeconds
      : (typeof employee.workedSeconds === 'number' ? employee.workedSeconds : employee.workedMinutes * 60);
    const boundary = cutoffMs != null ? Math.min(nowMs, cutoffMs) : nowMs;
    return base + Math.max(0, Math.floor((boundary - openInMs) / 1000));
  })();

  const dateLabel = `${WEEK_LABELS[parseISO(viewDate).getDay()].slice(0,3)}, ${parseISO(viewDate).getDate()}-${monthOf(viewDate)}-${yearOf(viewDate)}`;

  return (
    <Card className="att-today-card mb-0">
      <CardBody className="p-0">
        <div className="att-today-titlebar">
          <div className="d-flex align-items-center gap-2 min-w-0">
            <span className="att-today-titlebar-icon"><i className="ri-time-line" /></span>
            <div className="att-today-titlebar-text">Today's Updated Record</div>
            <span className="att-today-status-pill att-tone-pill" data-status={effectiveStatus} style={{ color: tone.fg, background: tone.bg }}>
              <span className="att-today-status-dot" style={{ background: tone.dot }} />
              {tone.label}
              {!isPast && employee.lateByMinutes > 0 && effectiveStatus !== 'Weekly Off' && effectiveStatus !== 'Holiday' && effectiveStatus !== 'Leave' && effectiveStatus !== 'Absent' && (
                <span className="att-today-status-sub"> · {employee.lateByMinutes}m late</span>
              )}
            </span>
          </div>
          <span className="att-today-date">{dateLabel}</span>
        </div>

        <div className="att-today-times-2">
          <div className="att-tile">
            <div className="att-tile-label"><i className="ri-login-circle-line" />FIRST IN</div>
            <div className="att-tile-value">{renderTime(employee.firstIn, hour24)}</div>
            {(() => {
              const firstInPunch = employee.punches.find(p => p.type === 'in' && p.lat != null && p.lng != null);
              if (!firstInPunch || firstInPunch.lat == null || firstInPunch.lng == null) return null;
              return (
                <a
                  href={`https://www.google.com/maps?q=${firstInPunch.lat},${firstInPunch.lng}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="att-tile-geo"
                  title={`${firstInPunch.lat.toFixed(5)}, ${firstInPunch.lng.toFixed(5)} — open on map`}
                >
                  <i className="ri-map-pin-2-line" />
                  <span>{firstInPunch.place || `${firstInPunch.lat.toFixed(3)}, ${firstInPunch.lng.toFixed(3)}`}</span>
                </a>
              );
            })()}
          </div>
          <div className="att-tile">
            <div className="att-tile-label"><i className="ri-logout-circle-r-line" />LAST OUT</div>
            <div className="att-tile-value">
              {!employee.firstIn
                ? '—'
                : employee.lastOut === null
                  ? <span className="att-in-progress">In Progress</span>
                  : renderTime(employee.lastOut, hour24)}
            </div>
            {(() => {
              const outPunches = employee.punches.filter(p => p.type === 'out' && p.lat != null && p.lng != null);
              const lastOutPunch = outPunches[outPunches.length - 1];
              if (!lastOutPunch || lastOutPunch.lat == null || lastOutPunch.lng == null) return null;
              return (
                <a
                  href={`https://www.google.com/maps?q=${lastOutPunch.lat},${lastOutPunch.lng}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="att-tile-geo"
                  title={`${lastOutPunch.lat.toFixed(5)}, ${lastOutPunch.lng.toFixed(5)} — open on map`}
                >
                  <i className="ri-map-pin-2-line" />
                  <span>{lastOutPunch.place || `${lastOutPunch.lat.toFixed(3)}, ${lastOutPunch.lng.toFixed(3)}`}</span>
                </a>
              );
            })()}
          </div>
        </div>

        <div className="att-today-stats">
          <div className="att-stat">
            <div className="att-stat-num" style={{ color: '#7c5cfc' }}>{employee.punches.filter(p => p.type !== 'missing').length}</div>
            <div className="att-stat-label">PUNCHES</div>
          </div>
          <div className="att-stat">
            <div className="att-stat-num" style={{ color: '#0d9488' }}>{fmtMinutes(Math.floor(liveWorkedSecs / 60))}</div>
            <div className="att-stat-label">WORKED</div>
          </div>
          <div className="att-stat">
            <div className="att-stat-num" style={{ color: '#6b7280' }}>{fmtMinutes(employee.expectedMinutes)}</div>
            <div className="att-stat-label">EXPECTED</div>
          </div>
        </div>

      </CardBody>
    </Card>
  );
}

function PunchTimelineCard({ employee }: { employee: AttendanceEmployee }) {
  const punchCount = employee.punches.filter(p => p.type !== 'missing').length;
  const hasMissing = employee.punches.some(p => p.type === 'missing');

  return (
    <Card className="att-timeline-card mb-0 h-100">
      <CardBody>
        <div className="att-timeline-head">
          <div className="d-flex align-items-center gap-2 min-w-0">
            <span className="att-timeline-icon"><i className="ri-pulse-line" /></span>
            <div className="att-timeline-title">Intraday Punch Timeline</div>
          </div>
          <span className="att-timeline-count">{punchCount} punches today</span>
        </div>

        <div className="att-h-timeline">
          {employee.punches.length === 0 ? (
            <div className="att-timeline-empty">
              <i className="ri-calendar-2-line" />
              <span>No punches recorded for today.</span>
            </div>
          ) : (
            <div className="att-h-timeline-track">
              <div className="att-h-timeline-line" />
              {employee.punches.map((p, i) => {
                const isIn      = p.type === 'in';
                const isOut     = p.type === 'out';
                const isMissing = p.type === 'missing';
                const label = p.label ?? (isIn ? 'Check In' : isOut ? 'Check Out' : 'Missing');
                return (
                  <div key={i} className="att-h-event">
                    <div className={`att-h-circle ${isIn ? 'is-in' : isOut ? 'is-out' : 'is-missing'}`}>
                      <i className={isIn ? 'ri-login-circle-line' : isOut ? 'ri-logout-circle-r-line' : 'ri-question-line'} />
                    </div>
                    <div className="att-h-time">{p.time}</div>
                    <div className={`att-h-label ${isMissing ? 'is-missing' : ''}`}>{label}</div>
                    {!isMissing && <span className={`att-h-source att-h-source--${p.source.toLowerCase()}`}>{p.source}</span>}
                    {isMissing && <span className="att-h-source att-h-source--missing">MISSING</span>}
                    {!isMissing && p.lat != null && p.lng != null && (
                      <a
                        href={`https://www.google.com/maps?q=${p.lat},${p.lng}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="att-h-geo"
                        title={`${p.place || 'Open on map'} · ${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`}
                      >
                        <i className="ri-map-pin-2-line" />
                        <span className="att-h-geo-place">{p.place || `${p.lat.toFixed(3)}, ${p.lng.toFixed(3)}`}</span>
                      </a>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {hasMissing && (
          <div className="att-timeline-alert">
            <i className="ri-error-warning-fill" />
            <div>
              <div className="att-timeline-alert-title">Missing punch detected</div>
              <div className="att-timeline-alert-sub">Raise a regularization request to fix the record</div>
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

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

function LogsRequestsCard({
  employee, tab, setTab, calMonth, setCalMonth, onPickDate, onRegularize, hour24,
}: {
  employee: AttendanceEmployee;
  tab: 'log' | 'calendar';
  setTab: (t: 'log' | 'calendar') => void;
  calMonth: string;
  setCalMonth: (m: string) => void;
  onPickDate: (iso: string) => void;
  /** Regularize the given log row's date — NOT the day panel's date. */
  onRegularize: (iso: string) => void;
  hour24: boolean;
}) {
  const [pageSize, setPageSize] = useState(5);
  const [page, setPage] = useState(1);

  const filteredLogs = useMemo(() => {
    if (!calMonth) return employee.logs;
    return employee.logs.filter((l) => (l.iso || '').startsWith(calMonth));
  }, [employee.logs, calMonth]);

  useEffect(() => { setPage(1); }, [calMonth, employee.id]);

  const totalPages = Math.max(1, Math.ceil(filteredLogs.length / pageSize));
  const safePage   = Math.min(page, totalPages);
  const pageStart  = (safePage - 1) * pageSize;
  const pageEnd    = Math.min(pageStart + pageSize, filteredLogs.length);
  const visibleLogs = filteredLogs.slice(pageStart, pageEnd);

  const [viewMode, setViewMode] = useState<'list' | 'cal'>('list');

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

  const [popoverIdx, setPopoverIdx] = useState<number | null>(null);

  const fmtClock = (raw: string): string => {
    if (!raw || raw === '—') return raw;
    const m = /^(\d{1,2}):(\d{2})$/.exec(raw);
    if (!m) return raw;
    const h = Number(m[1]);
    const mm = m[2];
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
                <button key={r.key} type="button" className={`att-logs-range ${calMonth === r.mk ? 'is-active' : ''}`} onClick={() => setCalMonth(r.mk)}>
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
                    const popId = `att-log-info-${employee.id}-${pageStart + i}`;
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
                              ? `Full day ${tone.label}`
                              : isHolidayDay ? (l.holidayName ? `Holiday — ${l.holidayName}` : 'Holiday') : 'Full day Weekly-off'}
                          </td>
                          <td className="text-center">
                            {/* Holiday / Weekly-off rows have no punches to review
                                or regularize, so there's no Log action — show a
                                muted dash instead of a dead three-dot button that
                                does nothing on click (CBC #40). */}
                            <span className="text-muted">—</span>
                          </td>
                        </tr>
                      );
                    }

                    return (
                      <tr key={pageStart + i} className={isOpen ? 'is-open' : ''}>
                        <td className="att-log-datecell">{formattedDate}</td>
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
                                    return <span className="text-muted">{brk > 0 ? fmtDurHm(brk) : '—'}</span>;
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
                            onClick={() => setPopoverIdx(isOpen ? null : pageStart + i)}
                            title="Day details"
                          >
                            <i className={l.exception || isAbsent ? 'ri-error-warning-line' : 'ri-checkbox-circle-line'} />
                          </button>
                          <Popover isOpen={isOpen} target={popId} placement="left" toggle={() => setPopoverIdx(isOpen ? null : pageStart + i)} trigger="legacy" className="att-log-pop att-log-pop--keka">
                            <PopoverBody>
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
                                    })()} ({dateDay} {dateMonth})
                                  </div>
                                  <div className="att-log-pop-shift-time--v2">
                                    {fmtClock(employee.shiftStart)} - {fmtClock(employee.shiftEnd)}
                                  </div>

                                  <button type="button" className="att-log-pop-regularize" onClick={() => { setPopoverIdx(null); if (l.iso) onRegularize(l.iso); }}>
                                    <i className="ri-pencil-line" />
                                    Regularize
                                  </button>
                                </div>
                              )}

                              <div className="att-log-pop-body att-log-pop-body--tight">
                                <div className="att-log-pop-location--v2">Baner Office</div>
                              </div>

                              {l.workSegments && l.workSegments.length > 0 && (
                                <div className="att-log-pop-body att-log-pop-body--tight">
                                  <div className="att-log-pop-pairs">
                                    {l.workSegments.map((seg, idx) => {
                                      const isLast = idx === l.workSegments!.length - 1;
                                      const inMissing = false;
                                      // `seg.open` — punched in, never out: the out
                                      // time genuinely doesn't exist yet, so show
                                      // MISSING even while the day is still 'Present'
                                      // (today's row), not just once it turns
                                      // 'Missing Out' overnight.
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
                                            {inMissing ? <span className="att-log-pop-missing">MISSING</span> : fmtPair(inHrs, inMin, inSec)}
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
                            </PopoverBody>
                          </Popover>
                        </td>
                      </tr>
                    );
                  })}
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
            month={calMonth}
            onPrevMonth={() => {
              const [y,m] = calMonth.split('-').map(Number);
              const d = new Date(y, m - 2, 1);
              setCalMonth(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`);
            }}
            onNextMonth={() => {
              const [y,m] = calMonth.split('-').map(Number);
              const d = new Date(y, m, 1);
              setCalMonth(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`);
            }}
            onPickDate={onPickDate}
          />
        )}
      </CardBody>
    </Card>
  );
}

function CalendarMonthGrid({
  employee, month, onPrevMonth, onNextMonth, onPickDate,
}: {
  employee: AttendanceEmployee;
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
