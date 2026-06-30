import { useCallback, useState, useEffect } from 'react';
import { Row, Col } from 'reactstrap';
import api from '../../../api';
import { Shimmer } from '../../../components/ui/Shimmer';
import { KpiTile, AnimatedNumber } from '../EmployeeProfileShared';
import RegularizationModal, { type RegPrefillPunch } from '../../hrms/RegularizationModal';
import { regularizationApi, type ApiRegularization } from '../../hrms/regularizationApi';

interface AttendancePanelPunch {
  id: number;
  punched_at: string;
  direction: 'in' | 'out';
  label: string;
  method: 'face' | 'manual' | 'auto';
}
interface AttendancePanelRecord {
  id: number;
  attendance_date: string;
  check_in_at: string | null;
  check_out_at: string | null;
  status: string;
  total_worked_seconds: number;
  punches_count: number;
  punches: AttendancePanelPunch[];
}
interface AttendancePanelResponse {
  employee: { id: number; emp_code: string | null; name: string; face_registered: boolean; shift_start?: string | null; shift_end?: string | null };
  month: string;
  stats: { present_days: number; late_marks: number; missing_biometric: number; total_leaves: number };
  today: AttendancePanelRecord | null;
  history: AttendancePanelRecord[];
}


// Colour duties moved to the global .ep-tone-* classes in EmployeeProfile.css.
// This map keeps ONLY the per-label remix icon + the global tone slug.
const ATT_LABEL_TONE: Record<string, { slug: string; icon: string }> = {
  'Check In':  { slug: 'checkin',  icon: 'ri-login-circle-line'  },
  'Step Out':  { slug: 'stepout',  icon: 'ri-walk-line'          },
  'Step In':   { slug: 'stepin',   icon: 'ri-walk-line'          },
  'Lunch Out': { slug: 'lunchout', icon: 'ri-restaurant-line'    },
  'Lunch In':  { slug: 'lunchin',  icon: 'ri-restaurant-line'    },
  'Meeting':   { slug: 'meeting',  icon: 'ri-presentation-line'  },
  'Check Out': { slug: 'checkout', icon: 'ri-logout-circle-line' },
};
const toneClass = (label: string) => `ep-tone-${ATT_LABEL_TONE[label]?.slug || 'default'}`;
const toneIcon  = (label: string) => ATT_LABEL_TONE[label]?.icon || 'ri-time-line';

const attFmtClock = (iso: string | null) => iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—';
const attFmtHM    = (secs: number) => {
  const h = Math.floor(Math.max(0, secs) / 3600);
  const m = Math.floor((Math.max(0, secs) % 3600) / 60);
  return `${h}h ${String(m).padStart(2, '0')}m`;
};
const attFmtDate  = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleDateString([], { day: '2-digit', month: 'short' });
};
const attDayName  = (iso: string) => new Date(iso).toLocaleDateString([], { weekday: 'short' });

export default function AttendanceTab({ employeeId }: { employeeId: string }) {
  const [data, setData] = useState<AttendancePanelResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [month, setMonth] = useState<string>(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 8;

  // Regularization (attendance correction) — self-service. The modal needs the
  // numeric employee id, which comes back on the summary payload.
  const [regOpen, setRegOpen]     = useState(false);
  const [regDate, setRegDate]     = useState<string>('');
  const [regPunches, setRegPunches] = useState<RegPrefillPunch[]>([]);
  const [myRegs, setMyRegs]       = useState<ApiRegularization[]>([]);
  const numericEmployeeId = data?.employee?.id ?? null;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api.get(`/attendance/employee/${encodeURIComponent(employeeId)}/summary`, { params: { month } })
      .then((r: any) => { if (!cancelled) { setData(r.data); setPage(0); } })
      .catch((err: any) => {
        if (cancelled) return;
        setError(err?.response?.data?.message || err?.message || 'Failed to load attendance.');
        setData(null);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [employeeId, month]);

  const loadRegs = useCallback(() => {
    if (!numericEmployeeId) return;
    regularizationApi.list({ employee_id: numericEmployeeId })
      .then(setMyRegs)
      .catch(() => { /* non-blocking — history just stays empty */ });
  }, [numericEmployeeId]);

  useEffect(() => { loadRegs(); }, [loadRegs]);

  // Open the regularization modal for a given day, prefilling the punch rows
  // from that day's first-in / last-out when available.
  const openReg = (record: AttendancePanelRecord | null, dateIso: string) => {
    const punches: RegPrefillPunch[] = [];
    const hhmm = (iso: string | null) => iso
      ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
      : null;
    if (record?.punches?.length) {
      for (const p of record.punches) {
        const t = hhmm(p.punched_at);
        if (t) punches.push({ time: t, type: p.direction });
      }
    } else if (record) {
      const ci = hhmm(record.check_in_at);
      const co = hhmm(record.check_out_at);
      if (ci) punches.push({ time: ci, type: 'in' });
      if (co) punches.push({ time: co, type: 'out' });
    }
    setRegPunches(punches);
    setRegDate(dateIso);
    setRegOpen(true);
  };

  const stepMonth = (delta: number) => {
    const [y, m] = month.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  };

  if (loading) {
    return (
      <div className="att-loading-root">
        <div className="att-loading-grid">
          {[0, 1, 2, 3, 4].map(i => (
            <div key={i} className="att-loading-card">
              <Shimmer height={10} width="50%" />
              <Shimmer height={22} width="35%" />
              <Shimmer height={8} width="65%" />
            </div>
          ))}
        </div>
        <div className="att-loading-section">
          <Shimmer height={14} width={180} />
          <Shimmer height={220} radius={10} />
        </div>
      </div>
    );
  }
  if (error) {
    return (
      <div className="p-4 text-center text-muted ep-fs-13">
        <i className="ri-error-warning-line me-1" /> {error}
      </div>
    );
  }
  if (!data) return null;

  const { stats, today, history } = data;
  const todayPunches = today?.punches || [];
  const pageStart = page * PAGE_SIZE;
  const pageEnd   = pageStart + PAGE_SIZE;
  const pageRows  = history.slice(pageStart, pageEnd);
  const pageCount = Math.max(1, Math.ceil(history.length / PAGE_SIZE));
  const G_SUCCESS = 'linear-gradient(135deg, #0ab39c 0%, #30d5b5 100%)';
  const G_WARNING = 'linear-gradient(135deg, #f7b84b 0%, #ffd47a 100%)';
  const G_DANGER  = 'linear-gradient(135deg, #f06548 0%, #ff9e7c 100%)';
  const G_PURPLE  = 'linear-gradient(135deg, #6a5acd 0%, #a78bfa 100%)';
  return (
    // Fill the content pane's full height (it's a flex item of the fixed-height
    // profile overlay) so the cards stretch to the bottom instead of leaving a
    // large empty area below — the two content rows below grow to share it.
    <div className="att-tab-fill d-flex flex-column" style={{ minHeight: '100%' }}>
      {/* KPI strip */}
      <Row className="g-3 mb-3 align-items-stretch">
        <Col xl><KpiTile label="Present Days"      value={<AnimatedNumber value={stats.present_days} />}      sub="This month"         icon="ri-checkbox-circle-line" gradient={G_SUCCESS} /></Col>
        <Col xl><KpiTile label="Late Marks"        value={<AnimatedNumber value={stats.late_marks} />}        sub="This month"         icon="ri-time-line"            gradient={G_WARNING} /></Col>
        <Col xl><KpiTile label="Missing Biometric" value={<AnimatedNumber value={stats.missing_biometric} />} sub="Entries this month" icon="ri-error-warning-line"   gradient={G_DANGER}  /></Col>
        <Col xl><KpiTile label="Total Leaves"      value={<AnimatedNumber value={stats.total_leaves} />}      sub="This month"         icon="ri-calendar-todo-line"   gradient={G_PURPLE}  /></Col>
      </Row>

      {/* Today + Timeline side-by-side */}
      <Row className="g-3 mb-3 align-items-stretch flex-grow-1">
        <Col xl={6}>
          <div className="ep-section-card-flat ep-section-card h-100 d-flex flex-column ep-ct-emerald">
            <div
              className="d-flex align-items-center justify-content-between gap-3 px-3 py-2 ep-hd-emerald"
            >
              <div className="d-flex align-items-center gap-2">
                <span className="ep-section-icon ep-icon-emerald">
                  <i className="ri-calendar-check-line" />
                </span>
                <h6 className="mb-0 fw-bold ep-fs-12">Today's Record</h6>
              </div>
              <small className="text-muted ep-fs-11">
                {new Date().toLocaleDateString([], { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })}
              </small>
            </div>
            <div className="px-3 py-3 flex-grow-1">
              {today ? (
                <>
                 
                  <style>{`
                    [data-bs-theme="dark"] .ep-att-today-badge,
                    [data-layout-mode="dark"] .ep-att-today-badge {
                      background: rgba(16,185,129,0.18) !important;
                      color: #6ee7b7 !important;
                    }
                  `}</style>
                  <span
                    className="ep-att-today-badge att-today-badge d-inline-flex align-items-center gap-1 fw-semibold mb-3"
                  >
                    <span className="att-today-badge-dot" />
                    {today.status}
                  </span>
                  <Row className="g-2 mb-2">
                    <Col xs={6}>
                      <div className="ep-field-label">First In</div>
                      <div className="ep-field-value font-monospace">{attFmtClock(today.check_in_at)}</div>
                    </Col>
                    <Col xs={6}>
                      <div className="ep-field-label">Last Out</div>
                      <div className="ep-field-value font-monospace">{attFmtClock(today.check_out_at)}</div>
                    </Col>
                    <Col xs={4}>
                      <div className="ep-field-label">Punches</div>
                      <div className="ep-field-value">{today.punches_count}</div>
                    </Col>
                    <Col xs={4}>
                      <div className="ep-field-label">Worked</div>
                      <div className="ep-field-value">{attFmtHM(today.total_worked_seconds)}</div>
                    </Col>
                    <Col xs={4}>
                      <div className="ep-field-label">Expected</div>
                      <div className="ep-field-value">9h 00m</div>
                    </Col>
                  </Row>
                </>
              ) : (
                <div className="text-center text-muted py-3 ep-fs-13">
                  No attendance record for today yet.
                </div>
              )}
            </div>
          </div>
        </Col>

        <Col xl={6}>
          <div className="ep-section-card-flat ep-section-card h-100 d-flex flex-column ep-ct-indigo">
            <div
              className="d-flex align-items-center justify-content-between gap-3 px-3 py-2 ep-hd-indigo"
            >
              <div className="d-flex align-items-center gap-2">
                <span className="ep-section-icon ep-icon-indigo">
                  <i className="ri-pulse-line" />
                </span>
                <h6 className="mb-0 fw-bold ep-fs-12">Intraday Punch Timeline</h6>
              </div>
              <small className="text-muted ep-fs-11">
                {todayPunches.length} {todayPunches.length === 1 ? 'punch today' : 'punches today'}
              </small>
            </div>
            <div className="px-3 py-3 flex-grow-1 att-overflow-x">
              {todayPunches.length === 0 ? (
                <div className="text-center text-muted py-3 ep-fs-13">
                  No punches yet today.
                </div>
              ) : (
                <div className="d-flex gap-3 align-items-stretch att-min-fit">
                  {todayPunches.map((p, idx) => (
                      <div
                        key={p.id}
                        className={`position-relative d-flex flex-column align-items-center att-punch-col ${toneClass(p.label)}`}
                      >
                        {idx < todayPunches.length - 1 && (
                          <div
                            aria-hidden
                            className="att-punch-connector"
                          />
                        )}
                        <div className="d-inline-flex align-items-center justify-content-center att-punch-dot ep-tone-ring">
                          <i className={toneIcon(p.label)} />
                        </div>
                        <div className="text-center mt-2 att-punch-time">
                          {attFmtClock(p.punched_at)}
                        </div>
                        <div className="text-center att-punch-label ep-tone-text">
                          {p.label}
                        </div>
                        <div
                          className="text-uppercase mt-1 att-punch-method"
                        >
                          {p.method}
                        </div>
                      </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </Col>
      </Row>

      {/* Attendance Timelog History */}
      <Row className="g-3 flex-grow-1 align-items-stretch">
        <Col xs={12}>
          <div className="ep-section-card-flat ep-section-card ep-ct-amber h-100 d-flex flex-column">
            <div
              className="d-flex align-items-center justify-content-between gap-3 px-3 py-2 flex-wrap ep-hd-amber"
            >
              <div className="d-flex align-items-center gap-2">
                <span className="ep-section-icon ep-icon-amber">
                  <i className="ri-history-line" />
                </span>
                <h6 className="mb-0 fw-bold ep-fs-12">Attendance Timelog History</h6>
              </div>
              <div className="d-flex align-items-center gap-2">
                {numericEmployeeId && (
                  <button
                    type="button"
                    className="btn btn-sm btn-primary"
                    onClick={() => openReg(today, today?.attendance_date || new Date().toISOString().slice(0, 10))}
                  >
                    <i className="ri-edit-circle-line me-1" /> Request Regularization
                  </button>
                )}
                <button type="button" className="btn btn-sm btn-light" onClick={() => stepMonth(-1)} aria-label="Previous month">
                  <i className="ri-arrow-left-s-line" />
                </button>
                <span className="fw-semibold att-month-label">
                  {new Date(month + '-01').toLocaleDateString([], { month: 'long', year: 'numeric' })}
                </span>
                <button type="button" className="btn btn-sm btn-light" onClick={() => stepMonth(1)} aria-label="Next month">
                  <i className="ri-arrow-right-s-line" />
                </button>
              </div>
            </div>
            <div className="px-3 py-3 flex-grow-1 d-flex flex-column">
              {history.length === 0 ? (
                <div className="text-center text-muted py-4 ep-fs-13 my-auto">
                  No attendance records for {new Date(month + '-01').toLocaleDateString([], { month: 'long', year: 'numeric' })}.
                </div>
              ) : (
                <>
                
                  <style>{`
                    [data-bs-theme="dark"] .att-tl-badge.att-tl-present { background: rgba(16,185,129,0.18) !important; color: #6ee7b7 !important; }
                    [data-bs-theme="dark"] .att-tl-badge.att-tl-late    { background: rgba(245,158,11,0.18) !important; color: #fcd34d !important; }
                    [data-bs-theme="dark"] .att-tl-badge.att-tl-leave   { background: rgba(99,102,241,0.20) !important; color: #c4b5fd !important; }
                    [data-bs-theme="dark"] .att-tl-badge.att-tl-other   { background: rgba(255,255,255,0.08) !important; color: #cbd5e1 !important; }
                  `}</style>
                  <div className="table-responsive">
                    <table className="table table-sm mb-0 att-table">
                      <thead>
                        <tr className="att-thead-row">
                          <th>Date</th>
                          <th>Day</th>
                          <th>First In</th>
                          <th>Last Out</th>
                          <th>Punches</th>
                          <th>Worked</th>
                          <th>Status</th>
                          <th className="text-end">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pageRows.map(r => (
                          <tr key={r.id}>
                            <td className="fw-semibold">{attFmtDate(r.attendance_date)}</td>
                            <td>{attDayName(r.attendance_date)}</td>
                            <td className="font-monospace">{attFmtClock(r.check_in_at)}</td>
                            <td className="font-monospace">{attFmtClock(r.check_out_at)}</td>
                            <td>{r.punches_count}</td>
                            <td>{attFmtHM(r.total_worked_seconds)}</td>
                            <td>
                              <span
                                className={`att-tl-badge att-status-badge att-tl-${r.status === 'Present' ? 'present' : r.status === 'Late' ? 'late' : r.status === 'Leave' ? 'leave' : 'other'} d-inline-flex align-items-center gap-1 fw-semibold`}
                                style={{
                                  ['--att-status-bg' as any]: r.status === 'Present' ? '#d6f4e3' :
                                              r.status === 'Late'    ? '#fef3c7' :
                                              r.status === 'Leave'   ? '#e0e7ff' : '#f1f5f9',
                                  ['--att-status-fg' as any]: r.status === 'Present' ? '#108548' :
                                         r.status === 'Late'    ? '#92400e' :
                                         r.status === 'Leave'   ? '#3730a3' : '#475569',
                                }}
                              >
                                {r.status}
                              </span>
                            </td>
                            <td className="text-end">
                              <button
                                type="button"
                                className="btn btn-sm btn-soft-primary"
                                title="Request regularization for this day"
                                onClick={() => openReg(r, r.attendance_date.slice(0, 10))}
                              >
                                <i className="ri-edit-2-line" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {pageCount > 1 && (
                    <div className="d-flex align-items-center justify-content-between mt-2 pt-2 border-top">
                      <small className="text-muted">
                        Showing {pageStart + 1}–{Math.min(pageEnd, history.length)} of {history.length}
                      </small>
                      <ul className="pagination pagination-sm mb-0">
                        <li className={page === 0 ? 'page-item disabled' : 'page-item'}>
                          <a href="#" className="page-link" onClick={e => { e.preventDefault(); if (page > 0) setPage(p => p - 1); }}>
                            <i className="ri-arrow-left-s-line" />
                          </a>
                        </li>
                        {Array.from({ length: pageCount }, (_, i) => (
                          <li key={i} className={page === i ? 'page-item active' : 'page-item'}>
                            <a href="#" className="page-link" onClick={e => { e.preventDefault(); setPage(i); }}>{i + 1}</a>
                          </li>
                        ))}
                        <li className={page >= pageCount - 1 ? 'page-item disabled' : 'page-item'}>
                          <a href="#" className="page-link" onClick={e => { e.preventDefault(); if (page < pageCount - 1) setPage(p => p + 1); }}>
                            <i className="ri-arrow-right-s-line" />
                          </a>
                        </li>
                      </ul>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </Col>
      </Row>

      {/* My Regularization Requests — the employee's own history + live status */}
      {myRegs.length > 0 && (
        <Row className="g-3 mt-1">
          <Col xs={12}>
            <div className="ep-section-card-flat ep-section-card ep-ct-indigo">
              <div className="d-flex align-items-center gap-2 px-3 py-2 ep-hd-indigo">
                <span className="ep-section-icon ep-icon-indigo"><i className="ri-file-edit-line" /></span>
                <h6 className="mb-0 fw-bold ep-fs-12">My Regularization Requests</h6>
              </div>
              <div className="px-3 py-3">
                <div className="table-responsive">
                  <table className="table table-sm align-middle mb-0">
                    <thead>
                      <tr className="att-thead-row">
                        <th>Date</th>
                        <th>Type</th>
                        <th>Requested Punches</th>
                        <th>Reason</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {myRegs.map(rg => {
                        const punches = (rg.punches ?? []).map(p => `${p.in ?? '—'}–${p.out ?? '—'}`).join(', ');
                        const tone =
                          rg.status === 'Approved' ? { bg: '#dcfce7', fg: '#15803d' } :
                          rg.status === 'Rejected' ? { bg: '#fee2e2', fg: '#b91c1c' } :
                          rg.status === 'Cancelled' ? { bg: '#f1f5f9', fg: '#475569' } :
                                                      { bg: '#fef3c7', fg: '#92400e' };
                        return (
                          <tr key={rg.id}>
                            <td className="fw-semibold">{attFmtDate(rg.regularization_date)}</td>
                            <td className="ep-fs-12">{rg.mode === 'exempt' ? 'Exempt day' : 'Adjust log'}{rg.type ? ` · ${rg.type}` : ''}</td>
                            <td className="font-monospace ep-fs-12">{rg.mode === 'exempt' ? '—' : (punches || '—')}</td>
                            <td className="ep-fs-12" style={{ maxWidth: 240 }}>{rg.reason || '—'}</td>
                            <td>
                              <span className="d-inline-flex align-items-center fw-semibold ep-fs-11 px-2 py-1 rounded" style={{ background: tone.bg, color: tone.fg }}>
                                {rg.status}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </Col>
        </Row>
      )}

      {numericEmployeeId && (
        <RegularizationModal
          open={regOpen}
          employeeId={numericEmployeeId}
          dateIso={regDate}
          shiftStart={data?.employee?.shift_start ?? undefined}
          shiftEnd={data?.employee?.shift_end ?? undefined}
          initialPunches={regPunches}
          onClose={() => setRegOpen(false)}
          onSubmitted={() => loadRegs()}
        />
      )}
    </div>
  );
}
