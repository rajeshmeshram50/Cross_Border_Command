import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Card, CardBody, Col, Row, Input, Modal, ModalBody, Popover, PopoverBody } from 'reactstrap';
import { MasterFormStyles, MasterDatePicker } from '../master/masterFormKit';
import { useToast } from '../../contexts/ToastContext';
import { Turtle } from 'lucide-react';
import api from '../../api';
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
  | 'Corrected';

type RegMode = 'adjust' | 'exempt';
type CorrStatus = 'Pending' | 'Approved' | 'Rejected';

interface PunchEdit {
  action: 'add' | 'edit' | 'keep' | 'delete';
  oldIn?: string;
  oldOut?: string;
  newIn: string;
  newOut: string;
}

const WORK_LOCATIONS = ['Baner Office', 'Wakad Office', 'WFH', 'Client Site', 'Field Visit'];

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
  shift: string;
  firstIn: string;
  lastOut: string;
  worked: string;
  deviation: string;
  exception?: string;
  workSegments?: Array<{ start: number; end: number }>;
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
  'Corrected':       { fg: '#5b3fd1', bg: '#ede9fe', dot: '#7c5cfc', label: 'Corrected' },
};

const ACCENTS = ['#7c5cfc', '#0ab39c', '#f7b84b', '#f06548', '#0ea5e9', '#e83e8c', '#0c63b0', '#22c55e', '#a855f7'];
const accent = (i: number) => ACCENTS[i % ACCENTS.length];
const fmtMinutes = (m: number) => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;

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

  // Time-format preference, shared page-wide so the "24 hour format" toggle
  // reformats every clock time. Persisted to localStorage; defaults to 12-hour.
  const [hour24, setHour24]       = useState<boolean>(() => {
    try { const v = localStorage.getItem('cbc-attendance-hour24'); return v === null ? false : v === '1'; }
    catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem('cbc-attendance-hour24', hour24 ? '1' : '0'); } catch {}
  }, [hour24]);

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

  const onSubmitRegularization = (req: Omit<CorrectionRequest, 'id' | 'status' | 'raisedAt'>) => {
    const newReq: CorrectionRequest = {
      ...req,
      id: `CR-${Date.now().toString().slice(-6)}`,
      status: 'Pending',
      raisedAt: new Date().toLocaleString(),
    };
    if (selected) {
      setEmployees(prev => prev.map(e => e.id === selected.id ? { ...e, correction: newReq } : e));
    }
    setRegOpen(false);
  };

  if (employeesLoading) {
    return (
      <>
        <MasterFormStyles />
        <Row>
          <Col xs={12}>
            <div
              className="hr-employees-surface"
              style={{
                borderRadius: 18,
                border: '1px solid var(--vz-border-color)',
                boxShadow: '0 8px 28px rgba(15,23,42,0.06), 0 2px 6px rgba(15,23,42,0.04)',
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

                  <Row className="g-2 mb-2 row-cols-xl-4 row-cols-md-2 row-cols-1">
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
          </Col>
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
          <div
            className="hr-employees-surface"
            style={{
              borderRadius: 18,
              border: '1px solid var(--vz-border-color)',
              boxShadow: '0 8px 28px rgba(15,23,42,0.06), 0 2px 6px rgba(15,23,42,0.04)',
              padding: '18px',
              marginBottom: '24px',
            }}
          >
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
                    <MasterDatePicker value={viewDate} onChange={v => setViewDate(v || TODAY_ISO)} placeholder="Pick date" />
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
              <Col xl={3} lg={4} md={5} xs={12}>
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
                              <span className="att-status-dot" style={{ background: tone.dot }} />{tone.label}
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
                    <span className="att-chip"><i className="ri-time-line" />{selected.shift}</span>
                    <span className="att-chip"><i className="ri-calendar-2-line" />Off: {selected.weeklyOff}</span>
                    <span className="att-chip"><i className="ri-fingerprint-line" />{selected.attendanceNumber}</span>
                    <span className="att-chip"><i className="ri-user-star-line" />Mgr: {selected.managerName}</span>
                  </div>
                </div>

                <Row className="g-2 mb-2 align-items-stretch row-cols-xl-4 row-cols-md-2 row-cols-1">
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
                <Row className="g-2 mb-2 align-items-stretch">
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
                onRegularize={() => setRegOpen(true)}
                hour24={hour24} setHour24={setHour24}
              />
            </div>
          </div>
        </Col>
      </Row>

      <RegularizationModal
        open={regOpen}
        employee={selected}
        onClose={() => setRegOpen(false)}
        onSubmit={onSubmitRegularization}
      />
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
              {employee.lastOut === null ? <span className="att-in-progress">In Progress</span> : renderTime(employee.lastOut, hour24)}
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
            <div className="att-stat-num" style={{ color: '#0d9488' }}>{fmtMinutes(employee.workedMinutes)}</div>
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

function AttendanceVisualBar({ segments }: { segments: Array<{ start: number; end: number }> }) {
  const ticks = Array.from({ length: 24 }, (_, h) => h);
  return (
    <div className="att-vbar">
      <div className="att-vbar-track">
        {ticks.map(h => <span key={h} className={`att-vbar-tick ${h % 6 === 0 ? 'is-major' : ''}`} />)}
        {segments.map((s, i) => (
          <span
            key={i}
            className="att-vbar-block"
            style={{ left: `${(s.start / 24) * 100}%`, width: `${((s.end - s.start) / 24) * 100}%` }}
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
  const late = lateMinutes > 0;
  return (
    <span className="att-arrival">
      <span className={`att-arrival-icon ${late ? 'att-arrival-icon--late' : 'att-arrival-icon--ok'}`}>
        {late ? <TurtleIcon size={20} /> : <i className="ri-check-line" />}
      </span>
      <span className={`att-arrival-text ${late ? 'att-arrival-text--late' : ''}`}>
        <span style={{ display: 'inline-block', minWidth: 62, textAlign: 'left' }}>{arrival || '—'}</span>
      </span>
    </span>
  );
}

function LogsRequestsCard({
  employee, tab, setTab, calMonth, setCalMonth, onPickDate, onRegularize, hour24, setHour24,
}: {
  employee: AttendanceEmployee;
  tab: 'log' | 'calendar';
  setTab: (t: 'log' | 'calendar') => void;
  calMonth: string;
  setCalMonth: (m: string) => void;
  onPickDate: (iso: string) => void;
  onRegularize: () => void;
  hour24: boolean;
  setHour24: (v: boolean | ((p: boolean) => boolean)) => void;
}) {
  const [pageSize, setPageSize] = useState(10);
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
      out.push({ key: mk, label: i === 0 ? '30 DAYS' : MONTHS_SHORT[d.getMonth()].toUpperCase(), mk });
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
              <button type="button" className={`att-logs-vbtn ${viewMode === 'list' ? 'is-active' : ''}`} onClick={() => { setViewMode('list'); setTab('log'); }} title="List view">
                <i className="ri-list-check" />
              </button>
              <button type="button" className={`att-logs-vbtn ${viewMode === 'cal' ? 'is-active' : ''}`} onClick={() => { setViewMode('cal'); setTab('calendar'); }} title="Calendar view">
                <i className="ri-calendar-2-line" />
              </button>
            </div>
            <label className="att-logs-h24">
              <span>24 hour format</span>
              <span className={`att-switch ${hour24 ? 'is-on' : ''}`} onClick={() => setHour24(v => !v)} role="switch" aria-checked={hour24}>
                <span className="att-switch-knob" />
              </span>
            </label>
          </div>
        </div>

        <div className="att-logs-tabs">
          <button type="button" className={`att-logs-tab ${tab === 'log' ? 'is-active' : ''}`} onClick={() => setTab('log')}>
            <i className="ri-checkbox-circle-line" />Attendance Log
          </button>
          <button type="button" className={`att-logs-tab ${tab === 'calendar' ? 'is-active' : ''}`} onClick={() => setTab('calendar')}>
            <i className="ri-calendar-line" />Calendar
          </button>
        </div>

        {tab === 'log' && (
          <>
            <div
              className="table-responsive table-card border rounded att-logs-table-wrap--fixed"
              style={{ minHeight: `${46 + Math.min(Math.max(visibleLogs.length, 1), pageSize) * 52}px` }}
            >
              <table className="table align-middle table-nowrap mb-0 att-logs-table att-logs-table--v2">
                <thead className="table-light">
                  <tr>
                    <th scope="col">Date</th>
                    <th scope="col" style={{ minWidth: 280 }}>Attendance Visual</th>
                    <th scope="col">Effective Hours</th>
                    <th scope="col">Gross Hours</th>
                    <th scope="col">Arrival</th>
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
                    const isOff   = l.status === 'Weekly Off' || l.status === 'Holiday';
                    const isAbsent = l.status === 'Absent';
                    const tone = STATUS_TONE[l.status];

                    if (isOff) {
                      return (
                        <tr key={pageStart + i} className="att-log-row--off">
                          <td className="att-log-datecell">
                            {formattedDate}
                            <span className="att-log-woff-pill">W-OFF</span>
                          </td>
                          <td colSpan={4} className="text-center att-log-woff-text">Full day Weekly-off</td>
                          <td className="text-center">
                            <button type="button" className="att-log-action-btn" disabled>
                              <i className="ri-more-2-fill" />
                            </button>
                          </td>
                        </tr>
                      );
                    }

                    return (
                      <tr key={pageStart + i} className={isOpen ? 'is-open' : ''}>
                        <td className="att-log-datecell">{formattedDate}</td>
                        <td>
                          <AttendanceVisualBar segments={l.workSegments || []} />
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
                        <td>
                          {isAbsent ? <span className="text-muted">—</span> : <ArrivalIcon lateMinutes={l.lateMinutes ?? 0} arrival={fmtClock(l.firstIn)} />}
                        </td>
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

                                  <button type="button" className="att-log-pop-regularize" onClick={() => { setPopoverIdx(null); onRegularize(); }}>
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
                                      const outMissing = isLast && (l.status === 'Missing Out');
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
  }, { Present: 0, Late: 0, 'Half Day': 0, 'Missing In': 0, 'Missing Out': 0, 'Weekly Off': 0, Holiday: 0, 'On Duty': 0, 'Work From Home': 0, Absent: 0, Leave: 0, Corrected: 0 });

  return (
    <div className="att-cal">
      <div className="att-cal-head">
        <button type="button" className="att-cal-nav" onClick={onPrevMonth}><i className="ri-arrow-left-s-line" /></button>
        <div className="att-cal-title">{MONTHS_SHORT[m - 1]} {y}</div>
        <button type="button" className="att-cal-nav" onClick={onNextMonth}><i className="ri-arrow-right-s-line" /></button>
      </div>

      <div className="att-cal-summary">
        {(['Present','Late','Half Day','Work From Home','On Duty','Leave','Absent','Weekly Off'] as DayStatus[]).map(s => {
          const tone = STATUS_TONE[s];
          return (
            <span key={s} className="att-cal-sum">
              <span className="att-cal-sum-dot" style={{ background: tone.dot }} />
              <span className="att-cal-sum-label">{tone.label}</span>
              <span className="att-cal-sum-num">{summary[s] || 0}</span>
            </span>
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

function RegularizationModal({
  open, employee, onClose, onSubmit,
}: {
  open: boolean;
  employee: AttendanceEmployee;
  onClose: () => void;
  onSubmit: (req: Omit<CorrectionRequest, 'id' | 'status' | 'raisedAt'>) => void;
}) {
  const toast = useToast();

  const [date]                    = useState('2 May 2026');
  const [mode, setMode]           = useState<RegMode>('adjust');
  const initialEdits = useMemo<PunchEdit[]>(() => {
    const inOuts: { in?: string; out?: string }[] = [];
    let cur: { in?: string; out?: string } = {};
    for (const p of employee.punches) {
      if (p.type === 'in')  { cur = { in: p.time.replace(/\s?(AM|PM)/i, '') }; }
      if (p.type === 'out') { cur.out = p.time.replace(/\s?(AM|PM)/i, ''); inOuts.push(cur); cur = {}; }
    }
    if (cur.in) inOuts.push(cur);
    return inOuts.length === 0
      ? [{ action: 'add' as const, newIn: '', newOut: '' }]
      : inOuts.map(io => ({ action: 'keep' as const, oldIn: io.in, oldOut: io.out, newIn: io.in ?? '', newOut: io.out ?? '' }));
  }, [employee.punches]);
  const [punchEdits, setPunchEdits] = useState<PunchEdit[]>(initialEdits);
  const [workLocations, setWorkLocations] = useState<string[]>(['Baner Office']);
  const [reason, setReason]       = useState('');
  const [errors, setErrors]       = useState<Partial<Record<'reason' | 'punches' | 'locations', string>>>({});

  useEffect(() => { setPunchEdits(initialEdits); }, [initialEdits]);

  const updateEdit = (idx: number, patch: Partial<PunchEdit>) => {
    setPunchEdits(prev => prev.map((e, i) => {
      if (i !== idx) return e;
      const next = { ...e, ...patch };
      if (e.action === 'keep' && (next.newIn !== e.oldIn || next.newOut !== e.oldOut)) {
        next.action = 'edit';
      }
      return next;
    }));
  };
  const addEdit = () => setPunchEdits(prev => [...prev, { action: 'add', newIn: '', newOut: '' }]);
  const removeEdit = (idx: number) => {
    setPunchEdits(prev => prev.flatMap((e, i) => {
      if (i !== idx) return [e];
      if (e.action === 'add') return [];
      return [{ ...e, action: 'delete' as const, newIn: '', newOut: '' }];
    }));
  };

  const addLocation = (loc: string) => {
    if (!loc || workLocations.includes(loc)) return;
    setWorkLocations(prev => [...prev, loc]);
  };
  const removeLocation = (loc: string) => setWorkLocations(prev => prev.filter(l => l !== loc));

  const submit = () => {
    const errs: typeof errors = {};
    if (!reason.trim()) errs.reason = 'Reason is required';
    if (workLocations.length === 0) errs.locations = 'Pick at least one work location';
    if (mode === 'adjust') {
      const valid = punchEdits.some(e => e.action !== 'delete');
      const allOk = punchEdits.every(e =>
        e.action === 'delete' ||
        (e.newIn && /^\d{2}:\d{2}$/.test(e.newIn) && (!e.newOut || /^\d{2}:\d{2}$/.test(e.newOut)))
      );
      if (!valid) errs.punches = 'Add at least one punch entry';
      else if (!allOk) errs.punches = 'All punch entries need a valid HH:MM time';
    }
    if (Object.keys(errs).length) {
      setErrors(errs);
      toast.error('Validation', 'Fix the highlighted fields');
      return;
    }
    setErrors({});
    const firstEdit = punchEdits.find(e => e.action !== 'delete');
    onSubmit({
      date,
      type: mode === 'exempt' ? 'On Duty (OD)' : 'Forgot to Punch',
      requestedIn:  firstEdit?.newIn || undefined,
      requestedOut: firstEdit?.newOut || undefined,
      reason: reason.trim(),
    });
    toast.success('Submitted', `Routed to ${employee.managerName} for approval`);
    setReason(''); setErrors({});
  };

  return (
    <Modal isOpen={open} toggle={onClose} centered size="lg" backdrop="static" className="att-reg-modal-keka">
      <ModalBody className="p-0">
        <div className="att-reg-modal-v3">
          <div className="att-reg-keka-head">
            <div className="att-reg-keka-title">Request Attendance Regularization</div>
            <button type="button" className="att-reg-keka-close" onClick={onClose} aria-label="Close">
              <i className="ri-close-line" />
            </button>
          </div>

          <div className="att-reg-keka-body">
            <div className="att-reg-keka-field">
              <label className="att-reg-keka-label">Selected Date</label>
              <div className="att-reg-keka-readonly">{date}</div>
            </div>

            <div className="att-reg-keka-modes">
              <label className={`att-reg-keka-radio ${mode === 'adjust' ? 'is-active' : ''}`}>
                <input type="radio" name="reg-mode" checked={mode === 'adjust'} onChange={() => setMode('adjust')} />
                <span className="att-reg-keka-radio-dot" />
                <span>Add/update time entries to adjust attendance logs.</span>
              </label>
              <label className={`att-reg-keka-radio ${mode === 'exempt' ? 'is-active' : ''}`}>
                <input type="radio" name="reg-mode" checked={mode === 'exempt'} onChange={() => setMode('exempt')} />
                <span className="att-reg-keka-radio-dot" />
                <span>Raise regularization request to exempt this day from penalization policy.</span>
              </label>
              <div className="att-reg-keka-hint">
                {mode === 'adjust'
                  ? 'Click and select time stamp box that you would like to adjust and make changes to the time'
                  : 'No time edits — the day will be exempted from late / absent / penalty policy after manager approval'}
              </div>
            </div>

            {mode === 'adjust' && (
              <>
                <div className="att-reg-keka-section-head">
                  <div className="att-reg-keka-section-title">Attendance Adjustment</div>
                  <button type="button" className="att-reg-keka-addlog" onClick={addEdit}>
                    <i className="ri-add-line" />Add Log
                  </button>
                </div>

                <div className="att-reg-keka-loc-pick">
                  <i className="ri-map-pin-line" />
                  <select
                    className="att-reg-keka-loc-select"
                    value={workLocations[0] || ''}
                    onChange={e => setWorkLocations([e.target.value])}
                  >
                    {WORK_LOCATIONS.map(l => <option key={l} value={l}>{l}</option>)}
                  </select>
                </div>

                <div className="att-reg-keka-rows">
                  {punchEdits.filter(e => e.action !== 'delete').map((e) => {
                    const realIdx = punchEdits.indexOf(e);
                    const outMissing = !e.newOut;
                    return (
                      <div key={realIdx} className="att-reg-keka-row">
                        <i className="ri-arrow-left-down-line att-reg-keka-arrow att-reg-keka-arrow--in" />
                        <Input
                          type="time"
                          className="att-reg-keka-time"
                          value={e.newIn}
                          onChange={ev => updateEdit(realIdx, { newIn: ev.target.value })}
                        />
                        <i className="ri-arrow-right-up-line att-reg-keka-arrow att-reg-keka-arrow--out" />
                        {outMissing ? (
                          <span className="att-reg-keka-missing" onClick={() => updateEdit(realIdx, { newOut: '12:00' })}>
                            MISSING
                          </span>
                        ) : (
                          <Input
                            type="time"
                            className="att-reg-keka-time"
                            value={e.newOut}
                            onChange={ev => updateEdit(realIdx, { newOut: ev.target.value })}
                          />
                        )}
                        <button type="button" className="att-reg-keka-rm" onClick={() => removeEdit(realIdx)} title="Remove">
                          <i className="ri-subtract-line" />
                        </button>
                      </div>
                    );
                  })}
                  {punchEdits.filter(e => e.action !== 'delete').length === 0 && (
                    <div className="att-reg-keka-empty">Click <strong>Add Log</strong> to add a punch entry.</div>
                  )}
                  <button type="button" className="d-none" onClick={() => addLocation('')} aria-hidden></button>
                  <button type="button" className="d-none" onClick={() => removeLocation('')} aria-hidden></button>
                </div>
                {errors.punches && <small className="att-reg-keka-error">{errors.punches}</small>}
              </>
            )}

            <div className="att-reg-keka-field">
              <label className="att-reg-keka-label">Note</label>
              <textarea
                className="form-control att-reg-keka-note"
                rows={3}
                value={reason}
                onChange={e => setReason(e.target.value)}
                placeholder="Enter note"
              />
              {errors.reason && <small className="att-reg-keka-error">{errors.reason}</small>}
              {errors.locations && <small className="att-reg-keka-error">{errors.locations}</small>}
            </div>
          </div>

          <div className="att-reg-keka-foot">
            <button type="button" className="att-reg-keka-cancel" onClick={onClose}>Cancel</button>
            <button type="button" className="att-reg-keka-submit" onClick={submit}>Request</button>
          </div>
        </div>
      </ModalBody>
    </Modal>
  );
}
