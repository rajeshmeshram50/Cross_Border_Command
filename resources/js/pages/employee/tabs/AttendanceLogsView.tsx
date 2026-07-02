import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Card, CardBody, Popover, PopoverBody } from 'reactstrap';
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
  | 'Weekly Off' | 'Holiday' | 'On Duty' | 'Work From Home' | 'Absent' | 'Leave' | 'Corrected';

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
  workSegments?: Array<{ start: number; end: number }>;
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
  'Corrected':       { fg: '#5b3fd1', bg: '#ede9fe', dot: '#7c5cfc', label: 'Corrected' },
};

/** Non-working day bands shown across the visual bar when there are no work
 *  segments (e.g. Leave / On Duty / WFH) — otherwise the graph looked empty. */
const VBAR_BANDS: Partial<Record<DayStatus, { label: string; fg: string; bg: string }>> = {
  'Leave':          { label: 'On Leave', fg: '#5a3fd1', bg: '#ede9fe' },
  'On Duty':        { label: 'On Duty',  fg: '#0d9488', bg: '#ccfbf1' },
  'Work From Home': { label: 'WFH',      fg: '#0d9488', bg: '#ccfbf1' },
};

function AttendanceVisualBar({ segments, status }: { segments: Array<{ start: number; end: number }>; status?: DayStatus }) {
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
  const [hour24, setHour24] = useState<boolean>(() => {
    try { return localStorage.getItem('cbc-attendance-hour24') === '1'; } catch { return false; }
  });
  useEffect(() => { try { localStorage.setItem('cbc-attendance-hour24', hour24 ? '1' : '0'); } catch {} }, [hour24]);

  const [pageSize, setPageSize] = useState(5);
  const [page, setPage] = useState(1);
  const [popoverIdx, setPopoverIdx] = useState<number | null>(null);

  const filteredLogs = useMemo(() => {
    if (!month) return employee.logs;
    return employee.logs.filter((l) => (l.iso || '').startsWith(month));
  }, [employee.logs, month]);

  useEffect(() => { setPage(1); }, [month, employee.id]);

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
      out.push({ key: mk, label: i === 0 ? '30 DAYS' : MONTHS_SHORT[d.getMonth()].toUpperCase(), mk });
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
                    const popId = `ep-att-log-info-${employee.id}-${pageStart + i}`;
                    const isOpen = popoverIdx === pageStart + i;
                    const isHolidayDay = l.status === 'Holiday';
                    const isOff   = l.status === 'Weekly Off' || isHolidayDay;
                    const isAbsent = l.status === 'Absent';
                    const tone = STATUS_TONE[l.status];

                    if (isOff) {
                      return (
                        <tr key={pageStart + i} className={`att-log-row--off${isHolidayDay ? ' att-log-row--holiday' : ''}`}>
                          <td className="att-log-datecell">
                            {formattedDate}
                            <span className="att-log-woff-pill" style={isHolidayDay ? { color: '#0c63b0', background: '#dceefe' } : undefined}>
                              {isHolidayDay ? 'HOLIDAY' : 'W-OFF'}
                            </span>
                          </td>
                          <td colSpan={4} className="text-center att-log-woff-text">
                            {isHolidayDay ? (l.holidayName ? `Holiday — ${l.holidayName}` : 'Holiday') : 'Full day Weekly-off'}
                          </td>
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

                                  <button type="button" className="att-log-pop-regularize" onClick={() => { setPopoverIdx(null); if (l.iso) onRegularize(l.iso); }}>
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
                            </PopoverBody>
                          </Popover>
                        </td>
                      </tr>
                    );
                  })}
                  {visibleLogs.length === 0 && (
                    <tr><td colSpan={6} className="text-center text-muted py-4">No attendance records for this period.</td></tr>
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
