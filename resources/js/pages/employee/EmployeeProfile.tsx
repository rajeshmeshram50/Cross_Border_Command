import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Button, Card, CardBody, Col, Row, Dropdown, DropdownToggle, DropdownMenu, DropdownItem } from 'reactstrap';
import { useToast } from '../../contexts/ToastContext';
import { MasterSelect, MasterDatePicker, MasterFormStyles } from '../master/masterFormKit';
import ComingSoonShell from '../../components/ComingSoonShell';
import SalaryStructureModal, { type SalaryEmployeeLite } from '../../components/SalaryStructureModal';
import PayslipViewerModal from '../../components/PayslipViewerModal';
import HeaderFooterPanel, {
  DEFAULT_HEADER, DEFAULT_FOOTER,
  type HeaderConfig, type FooterConfig,
} from '../hrms/doc-templates/HeaderFooterPanel';
import api from '../../api';
import { useAuth } from '../../contexts/AuthContext';
import ExpenseClaimsTable from '../../components/ExpenseClaimsTable';
import AdvanceRequestsTable, { type AdvanceRequestRow } from '../../components/AdvanceRequestsTable';
import FaceRegistrationModal from '../../components/FaceRegistrationModal';
import {
  RaiseHiringRequestModal,
  HiringRequestsListModal,
  type HiringRequestRow,
} from '../recruitment/HrRecruitment';
import './EmployeeProfile.css';
import ImageCropperModal from '../../components/ui/ImageCropperModal';
import { Shimmer, ShimmerTableRows } from '../../components/ui/Shimmer';
import { resolveFileUrl } from '../../utils/resolveFileUrl';
import { leaveTypesApi, leaveRequestsApi, ApiLeaveRequest } from '../hrms/leavePlansApi';
import LeaveSummaryPanel from './LeaveSummaryPanel';

// Custom portal-based modal — renders directly to document.body so it always
// escapes the .ep-fullscreen-overlay stacking context. Reactstrap's Modal had
// timing issues with our z-index overrides on first open; this is bulletproof.
function EpModal({ open, onClose, size = 'md', children, dismissOnBackdrop = false, panelClassName }: {
  open: boolean;
  onClose: () => void;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  children: React.ReactNode;
  dismissOnBackdrop?: boolean;
  panelClassName?: string;
}) {
  if (!open) return null;
  const widths = { sm: 420, md: 600, lg: 900, xl: 1180 };
  return createPortal(
    <div
      className="ep-modal-overlay"
      onClick={dismissOnBackdrop ? onClose : undefined}
      style={{
        position: 'fixed', inset: 0, zIndex: 5000,
        background: 'rgba(15,23,42,0.55)',
        backdropFilter: 'blur(2px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16, overflowY: 'auto',
      }}
    >
      <div
        className={`ep-modal-card ${panelClassName || ''}`}
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--vz-card-bg, #fff)',
          borderRadius: 16,
          boxShadow: '0 24px 60px rgba(0,0,0,0.30)',
          width: '100%',
          maxWidth: widths[size],
          maxHeight: 'calc(100vh - 32px)',
          overflow: 'hidden',
          display: 'flex', flexDirection: 'column',
        }}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}


export interface EmployeeProfileTarget {
  id: string;
  name: string;
  email: string;
  initials?: string;
  accent?: string;
  department?: string;
  designation?: string;
  primaryRole?: string;
  ancillaryRole?: string | string[] | null;
  /** Multi-role array — populated by HrEmployees' apiToUiRow from the
   *  server-side `ancillary_roles_resolved` accessor. Preferred over the
   *  legacy single `ancillaryRole`. */
  ancillaryRoles?: string[];
  manager?: string;
  /** Passport-size photo URL — populated by ProfileRouter and HrEmployees
   *  apiToUiRow. The hero avatar (and a couple of fallback render sites)
   *  read it. */
  photoUrl?: string | null;
  profile?: number;
  onboarding?: 'Completed' | 'In Progress' | 'Pending';
  status?: 'active' | 'on_leave' | 'high_attention' | 'probation' | 'inactive';
  enabled?: boolean;
}

interface Props {
  employeeId: string;
  employee?: EmployeeProfileTarget;
  onBack: () => void;
}

type TabKey = 'profile' | 'job' | 'attendance' | 'vault' | 'payroll' | 'expense' | 'apply_leave' | 'hiring';
type PayrollTab = 'summary' | 'details';
type VaultTab = 'employee' | 'organizational';
type ExpenseFilter = 'all' | 'approved' | 'rejected' | 'pending' | 'draft';

const GRAD_PRIMARY = 'linear-gradient(135deg, #405189 0%, #6691e7 100%)';
const GRAD_SUCCESS = 'linear-gradient(135deg, #0ab39c 0%, #30d5b5 100%)';
const GRAD_WARNING = 'linear-gradient(135deg, #f7b84b 0%, #ffd47a 100%)';
const GRAD_INFO    = 'linear-gradient(135deg, #299cdb 0%, #5fc8ff 100%)';
const GRAD_PURPLE  = 'linear-gradient(135deg, #6a5acd 0%, #a78bfa 100%)';
const GRAD_DANGER  = 'linear-gradient(135deg, #f06548 0%, #ff9e7c 100%)';

const cardStyle: React.CSSProperties = {
  borderRadius: 18,
  border: '1px solid var(--vz-border-color)',
  boxShadow: '0 4px 24px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)',
  background: 'var(--vz-card-bg)',
  overflow: 'hidden',
  position: 'relative',
  transition: 'transform .25s ease, box-shadow .25s ease',
};

// Section card wrapper — adds a top gradient strip and a hover lift to any
// content card. The gradient is the same colour family as the section header
// icon, so each section has a distinct visual identity (Personal=indigo,
// Contact=blue, Address=green, etc.).
function SectionCard({ gradient, children, className }: { gradient: string; children: React.ReactNode; className?: string }) {
  return (
    <Card className={`ep-section-card mb-0 ${className || ''}`} style={cardStyle}>
      <div
        style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: 4,
          background: gradient, zIndex: 1,
        }}
      />
      {children}
    </Card>
  );
}

function SectionHeader({ title, gradient, icon, action, subtitle }: { title: string; gradient: string; icon: string; action?: React.ReactNode; subtitle?: string }) {
  return (
    <div className="d-flex align-items-center gap-3 mb-3 pb-3" style={{ borderBottom: '1px solid var(--vz-border-color)' }}>
      <span
        className="d-inline-flex align-items-center justify-content-center rounded-3 flex-shrink-0"
        style={{ width: 40, height: 40, background: gradient, boxShadow: '0 6px 14px rgba(64,81,137,0.22)' }}
      >
        <i className={icon} style={{ color: '#fff', fontSize: 18 }} />
      </span>
      <div className="flex-grow-1 min-w-0">
        <h5 className="card-title mb-0">{title}</h5>
        {subtitle && <small className="text-muted">{subtitle}</small>}
      </div>
      {action}
    </div>
  );
}

// Single label / value field — rendered as a clean key/value row with a small
// colored accent dot. The accent dot's color comes from the parent section so
// every field nests visually under its section header.
function Field({ label, value, span = 6, accent = '#6366f1' }: { label: string; value?: React.ReactNode; span?: number; accent?: string }) {
  return (
    <Col md={span as any} className="mb-3">
      <div className="d-flex align-items-center gap-2 mb-1">
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: accent, boxShadow: `0 0 0 3px ${accent}22`, flexShrink: 0 }} />
        <p className="mb-0 fs-11 text-uppercase fw-bold" style={{ color: 'var(--vz-secondary-color)', letterSpacing: '0.08em' }}>
          {label}
        </p>
      </div>
      <div className="fs-14 fw-bold ps-3" style={{ color: 'var(--vz-heading-color, var(--vz-body-color))', lineHeight: 1.4 }}>
        {value || <span className="text-muted fw-normal">—</span>}
      </div>
    </Col>
  );
}

function MiniInfo({ icon, label, value, gradient }: { icon: string; label: string; value: React.ReactNode; gradient: string }) {
  return (
    <div
      className="d-flex align-items-center p-3 h-100"
      style={{
        borderRadius: 14,
        background: 'linear-gradient(135deg, rgba(64,81,137,0.06), rgba(102,145,231,0.04))',
        border: '1px solid var(--vz-border-color)',
      }}
    >
      <div className="flex-shrink-0 me-3">
        <span
          className="d-inline-flex align-items-center justify-content-center rounded-circle"
          style={{ width: 40, height: 40, background: gradient, boxShadow: '0 4px 10px rgba(64,81,137,0.25)' }}
        >
          <i className={icon} style={{ color: '#fff', fontSize: 18 }} />
        </span>
      </div>
      <div className="flex-grow-1 overflow-hidden">
        <p className="mb-1 fs-12 text-uppercase fw-semibold" style={{ color: 'var(--vz-secondary-color)', letterSpacing: '0.05em' }}>
          {label}
        </p>
        <h6 className="text-truncate mb-0">{value || '—'}</h6>
      </div>
    </div>
  );
}

// Count-up number animation — mirrors the AnimatedNumber recipe used on the
// admin/client/branch dashboards so KPI tiles feel consistent across the app.
function AnimatedNumber({ value, prefix = '', suffix = '' }: { value: number; prefix?: string; suffix?: string }) {
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    let start = 0;
    const end = value;
    const duration = 1200;
    const step = Math.max(1, Math.floor(end / 60));
    const interval = duration / (end / step || 1);
    const timer = setInterval(() => {
      start += step;
      if (start >= end) { setDisplay(end); clearInterval(timer); }
      else setDisplay(start);
    }, interval);
    return () => clearInterval(timer);
  }, [value]);
  return <>{prefix}{display.toLocaleString()}{suffix}</>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Attendance — live panel rendered on the Employee Profile's Attendance tab.
//
// Replaces the old "Coming Soon" mock-data block. Calls the dedicated
// /attendance/employee/{employeeId}/summary endpoint which returns:
//   - today (Attendance row + punches)
//   - month stats (present, late, missing biometric, leave)
//   - history (every Attendance row in the selected month with its punches)
//
// One `employeeId` prop — the route slug (emp_code like "EMP-001"). The
// backend resolves either numeric DB id or emp_code so we don't have to.
// ─────────────────────────────────────────────────────────────────────────────
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
  employee: { id: number; emp_code: string | null; name: string; face_registered: boolean };
  month: string;
  stats: { present_days: number; late_marks: number; missing_biometric: number; total_leaves: number };
  today: AttendancePanelRecord | null;
  history: AttendancePanelRecord[];
}

// Activity-label palette — mirrors the ClockIn page so the same Step Out /
// Lunch In / Meeting chip looks identical across the two surfaces.
const ATT_LABEL_TONE: Record<string, { bg: string; fg: string; dot: string; icon: string }> = {
  'Check In':  { bg: 'rgba(16,185,129,0.12)',  fg: '#047857', dot: '#10b981', icon: 'ri-login-circle-line'  },
  'Step Out':  { bg: 'rgba(245,158,11,0.12)',  fg: '#a16207', dot: '#f59e0b', icon: 'ri-walk-line'          },
  'Step In':   { bg: 'rgba(20,184,166,0.12)',  fg: '#0f766e', dot: '#14b8a6', icon: 'ri-walk-line'          },
  'Lunch Out': { bg: 'rgba(244,114,182,0.12)', fg: '#9d174d', dot: '#f472b6', icon: 'ri-restaurant-line'    },
  'Lunch In':  { bg: 'rgba(34,197,94,0.12)',   fg: '#166534', dot: '#22c55e', icon: 'ri-restaurant-line'    },
  'Meeting':   { bg: 'rgba(99,102,241,0.12)',  fg: '#4338ca', dot: '#6366f1', icon: 'ri-presentation-line'  },
  'Check Out': { bg: 'rgba(244,63,94,0.12)',   fg: '#9f1239', dot: '#f43f5e', icon: 'ri-logout-circle-line' },
};
const attLabelTone = (label: string) => ATT_LABEL_TONE[label] || {
  bg: 'rgba(100,116,139,0.12)', fg: '#475569', dot: '#64748b', icon: 'ri-time-line',
};

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

function AttendanceTabPanel({ employeeId }: { employeeId: string }) {
  const [data, setData] = useState<AttendancePanelResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  // YYYY-MM. Defaults to the current month — admins can paginate backwards
  // via the < > arrows next to the month label.
  const [month, setMonth] = useState<string>(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 8;

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

  const stepMonth = (delta: number) => {
    const [y, m] = month.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  };

  if (loading) {
    // Skeleton mirrors the attendance panel's real layout — a KPI strip
    // row above a wide chart-style block — so the page doesn't reflow
    // when data lands.
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18, padding: '12px 4px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
          {[0, 1, 2, 3, 4].map(i => (
            <div key={i} style={{ padding: 14, borderRadius: 12, border: '1px solid var(--vz-border-color)', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <Shimmer height={10} width="50%" />
              <Shimmer height={22} width="35%" />
              <Shimmer height={8} width="65%" />
            </div>
          ))}
        </div>
        <div style={{ padding: 18, borderRadius: 12, border: '1px solid var(--vz-border-color)', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Shimmer height={14} width={180} />
          <Shimmer height={220} radius={10} />
        </div>
      </div>
    );
  }
  if (error) {
    return (
      <div className="p-4 text-center text-muted" style={{ fontSize: 13 }}>
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

  // Same gradient palette EmployeeProfile uses for the other KPI strips so
  // the visual rhythm matches the rest of the page.
  const G_SUCCESS = 'linear-gradient(135deg, #0ab39c 0%, #30d5b5 100%)';
  const G_WARNING = 'linear-gradient(135deg, #f7b84b 0%, #ffd47a 100%)';
  const G_DANGER  = 'linear-gradient(135deg, #f06548 0%, #ff9e7c 100%)';
  const G_PURPLE  = 'linear-gradient(135deg, #6a5acd 0%, #a78bfa 100%)';
  return (
    <>
      {/* KPI strip */}
      <Row className="g-3 mb-3 align-items-stretch">
        <Col xl><KpiTile label="Present Days"      value={<AnimatedNumber value={stats.present_days} />}      sub="This month"         icon="ri-checkbox-circle-line" gradient={G_SUCCESS} /></Col>
        <Col xl><KpiTile label="Late Marks"        value={<AnimatedNumber value={stats.late_marks} />}        sub="This month"         icon="ri-time-line"            gradient={G_WARNING} /></Col>
        <Col xl><KpiTile label="Missing Biometric" value={<AnimatedNumber value={stats.missing_biometric} />} sub="Entries this month" icon="ri-error-warning-line"   gradient={G_DANGER}  /></Col>
        <Col xl><KpiTile label="Total Leaves"      value={<AnimatedNumber value={stats.total_leaves} />}      sub="This month"         icon="ri-calendar-todo-line"   gradient={G_PURPLE}  /></Col>
      </Row>

      {/* Today + Timeline side-by-side */}
      <Row className="g-3 mb-3 align-items-stretch">
        <Col xl={6}>
          <div className="ep-section-card-flat ep-section-card h-100 d-flex flex-column" style={{ borderTop: '3px solid #0ab39c' }}>
            <div
              className="d-flex align-items-center justify-content-between gap-3 px-3 py-2"
              style={{
                borderBottom: '1px solid rgba(10,179,156,0.18)',
                background: 'linear-gradient(135deg, rgba(10,179,156,0.14) 0%, rgba(10,179,156,0.04) 60%, rgba(10,179,156,0.01) 100%)',
              }}
            >
              <div className="d-flex align-items-center gap-2">
                <span className="ep-section-icon" style={{ background: 'rgba(10,179,156,0.18)', color: '#0a8a78' }}>
                  <i className="ri-calendar-check-line" />
                </span>
                <h6 className="mb-0 fw-bold" style={{ fontSize: 12 }}>Today's Record</h6>
              </div>
              <small className="text-muted" style={{ fontSize: 11 }}>
                {new Date().toLocaleDateString([], { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })}
              </small>
            </div>
            <div className="px-3 py-3 flex-grow-1">
              {today ? (
                <>
                  <span
                    className="d-inline-flex align-items-center gap-1 fw-semibold mb-3"
                    style={{
                      fontSize: 11, padding: '2px 8px', borderRadius: 999,
                      background: '#d6f4e3', color: '#108548',
                    }}
                  >
                    <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#10b981' }} />
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
                <div className="text-center text-muted py-3" style={{ fontSize: 13 }}>
                  No attendance record for today yet.
                </div>
              )}
            </div>
          </div>
        </Col>

        <Col xl={6}>
          <div className="ep-section-card-flat ep-section-card h-100 d-flex flex-column" style={{ borderTop: '3px solid #6366f1' }}>
            <div
              className="d-flex align-items-center justify-content-between gap-3 px-3 py-2"
              style={{
                borderBottom: '1px solid rgba(99,102,241,0.18)',
                background: 'linear-gradient(135deg, rgba(99,102,241,0.12) 0%, rgba(99,102,241,0.03) 60%, rgba(99,102,241,0.01) 100%)',
              }}
            >
              <div className="d-flex align-items-center gap-2">
                <span className="ep-section-icon" style={{ background: 'rgba(99,102,241,0.18)', color: '#4338ca' }}>
                  <i className="ri-pulse-line" />
                </span>
                <h6 className="mb-0 fw-bold" style={{ fontSize: 12 }}>Intraday Punch Timeline</h6>
              </div>
              <small className="text-muted" style={{ fontSize: 11 }}>
                {todayPunches.length} {todayPunches.length === 1 ? 'punch today' : 'punches today'}
              </small>
            </div>
            <div className="px-3 py-3 flex-grow-1" style={{ overflowX: 'auto' }}>
              {todayPunches.length === 0 ? (
                <div className="text-center text-muted py-3" style={{ fontSize: 13 }}>
                  No punches yet today.
                </div>
              ) : (
                <div className="d-flex gap-3 align-items-stretch" style={{ minWidth: 'fit-content' }}>
                  {todayPunches.map((p, idx) => {
                    const t = attLabelTone(p.label);
                    return (
                      <div
                        key={p.id}
                        className="position-relative d-flex flex-column align-items-center"
                        style={{ minWidth: 92, flex: '0 0 auto' }}
                      >
                        {idx < todayPunches.length - 1 && (
                          <div
                            aria-hidden
                            style={{
                              position: 'absolute', top: 20, left: '60%', right: '-50%',
                              height: 2, background: 'rgba(148,163,184,0.35)',
                            }}
                          />
                        )}
                        <div
                          className="d-inline-flex align-items-center justify-content-center"
                          style={{
                            width: 40, height: 40, borderRadius: '50%',
                            background: t.bg, color: t.fg,
                            border: `2px solid ${t.dot}`,
                            fontSize: 16, zIndex: 1,
                          }}
                        >
                          <i className={t.icon} />
                        </div>
                        <div className="text-center mt-2" style={{ fontSize: 11.5, fontWeight: 700 }}>
                          {attFmtClock(p.punched_at)}
                        </div>
                        <div className="text-center" style={{ fontSize: 11, color: t.fg, fontWeight: 600 }}>
                          {p.label}
                        </div>
                        <div
                          className="text-uppercase mt-1"
                          style={{ fontSize: 9, letterSpacing: 0.6, color: 'var(--vz-secondary-color)' }}
                        >
                          {p.method}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </Col>
      </Row>

      {/* Attendance Timelog History */}
      <Row className="g-3">
        <Col xs={12}>
          <div className="ep-section-card-flat ep-section-card" style={{ borderTop: '3px solid #f59e0b' }}>
            <div
              className="d-flex align-items-center justify-content-between gap-3 px-3 py-2 flex-wrap"
              style={{
                borderBottom: '1px solid rgba(245,158,11,0.18)',
                background: 'linear-gradient(135deg, rgba(245,158,11,0.12) 0%, rgba(245,158,11,0.03) 60%, rgba(245,158,11,0.01) 100%)',
              }}
            >
              <div className="d-flex align-items-center gap-2">
                <span className="ep-section-icon" style={{ background: 'rgba(245,158,11,0.18)', color: '#a16207' }}>
                  <i className="ri-history-line" />
                </span>
                <h6 className="mb-0 fw-bold" style={{ fontSize: 12 }}>Attendance Timelog History</h6>
              </div>
              <div className="d-flex align-items-center gap-2">
                <button type="button" className="btn btn-sm btn-light" onClick={() => stepMonth(-1)} aria-label="Previous month">
                  <i className="ri-arrow-left-s-line" />
                </button>
                <span className="fw-semibold" style={{ fontSize: 12, minWidth: 80, textAlign: 'center' }}>
                  {new Date(month + '-01').toLocaleDateString([], { month: 'long', year: 'numeric' })}
                </span>
                <button type="button" className="btn btn-sm btn-light" onClick={() => stepMonth(1)} aria-label="Next month">
                  <i className="ri-arrow-right-s-line" />
                </button>
              </div>
            </div>
            <div className="px-3 py-3">
              {history.length === 0 ? (
                <div className="text-center text-muted py-4" style={{ fontSize: 13 }}>
                  No attendance records for {new Date(month + '-01').toLocaleDateString([], { month: 'long', year: 'numeric' })}.
                </div>
              ) : (
                <>
                  <div className="table-responsive">
                    <table className="table table-sm mb-0" style={{ fontSize: 12 }}>
                      <thead>
                        <tr style={{ background: 'rgba(15,23,42,0.04)' }}>
                          <th>Date</th>
                          <th>Day</th>
                          <th>First In</th>
                          <th>Last Out</th>
                          <th>Punches</th>
                          <th>Worked</th>
                          <th>Status</th>
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
                                className="d-inline-flex align-items-center gap-1 fw-semibold"
                                style={{
                                  fontSize: 10.5, padding: '2px 8px', borderRadius: 999,
                                  background: r.status === 'Present' ? '#d6f4e3' :
                                              r.status === 'Late'    ? '#fef3c7' :
                                              r.status === 'Leave'   ? '#e0e7ff' : '#f1f5f9',
                                  color: r.status === 'Present' ? '#108548' :
                                         r.status === 'Late'    ? '#92400e' :
                                         r.status === 'Leave'   ? '#3730a3' : '#475569',
                                }}
                              >
                                {r.status}
                              </span>
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
    </>
  );
}

// Generic KPI tile — same recipe as the admin/client/branch dashboard
// `KpiCard` so every tile across the app reads consistently. The `tint` prop
// is accepted for backwards compatibility but ignored; the card always uses
// var(--vz-card-bg) and the gradient lives on the top strip + icon tile.
function KpiTile({ label, value, sub, icon, gradient }: { label: string; value: React.ReactNode; sub?: string; icon: string; gradient: string; tint?: string }) {
  return (
    <div
      className="ep-kpi-tile dashboard-surface"
      style={{
        borderRadius: 12,
        padding: '12px 14px 10px',
        boxShadow: '0 2px 14px rgba(0,0,0,0.05)',
        border: '1px solid var(--vz-border-color)',
        position: 'relative',
        overflow: 'hidden',
        height: '100%',
        background: '#ffffff',
        transition: 'transform .25s ease, box-shadow .25s ease, border-color .25s ease',
        cursor: 'default',
      }}
    >
      {/* Gradient top strip */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 2,
        background: gradient,
      }} />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 10, fontWeight: 700, color: 'var(--vz-secondary-color)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 4 }}>
            {label}
          </p>
          <h3 style={{ fontSize: 22, fontWeight: 800, color: 'var(--vz-heading-color, var(--vz-body-color))', margin: 0, lineHeight: 1 }}>
            {value}
          </h3>
          {sub && <small className="text-muted d-block" style={{ fontSize: 10.5, marginTop: 4 }}>{sub}</small>}
        </div>
        <div style={{
          width: 36, height: 36, borderRadius: 10,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: gradient, flexShrink: 0,
          boxShadow: '0 3px 8px rgba(0,0,0,0.10)',
        }}>
          <i className={icon} style={{ fontSize: 16, color: '#fff' }} />
        </div>
      </div>
    </div>
  );
}

// Mock attendance history rows used inside the Attendance tab.
const ATTENDANCE_HISTORY = [
  { date: '21-Apr', day: 'Mon', shift: 'EARLY',   firstIn: '07:01', lastOut: '16:02', punches: 2, worked: '9h 01m', deviation: '+0h 01m', status: 'Present' },
  { date: '20-Apr', day: 'Sun', shift: '—',       firstIn: '—',     lastOut: '—',     punches: 0, worked: '—',     deviation: '—',        status: 'Weekly Off' },
  { date: '19-Apr', day: 'Sat', shift: '—',       firstIn: '—',     lastOut: '—',     punches: 0, worked: '—',     deviation: '—',        status: 'Weekly Off' },
  { date: '18-Apr', day: 'Fri', shift: 'GENERAL', firstIn: '09:15', lastOut: '18:20', punches: 4, worked: '9h 05m', deviation: '+0h 05m', status: 'Present' },
  { date: '17-Apr', day: 'Thu', shift: 'GENERAL', firstIn: '10:02', lastOut: '19:15', punches: 4, worked: '9h 13m', deviation: '+0h 13m', status: 'Late' },
  { date: '16-Apr', day: 'Wed', shift: 'GENERAL', firstIn: '09:00', lastOut: '18:00', punches: 4, worked: '9h 00m', deviation: '+0h 00m', status: 'Present' },
  { date: '15-Apr', day: 'Tue', shift: 'GENERAL', firstIn: '09:10', lastOut: '18:10', punches: 4, worked: '9h 00m', deviation: '+0h 00m', status: 'Present' },
  { date: '14-Apr', day: 'Mon', shift: 'GENERAL', firstIn: '09:05', lastOut: '18:07', punches: 4, worked: '9h 02m', deviation: '+0h 02m', status: 'Present' },
  { date: '13-Apr', day: 'Sun', shift: '—',       firstIn: '—',     lastOut: '—',     punches: 0, worked: '—',     deviation: '—',        status: 'Weekly Off' },
  { date: '11-Apr', day: 'Fri', shift: 'GENERAL', firstIn: '09:00', lastOut: '18:00', punches: 4, worked: '9h 00m', deviation: '+0h 00m', status: 'Present' },
  { date: '10-Apr', day: 'Thu', shift: 'GENERAL', firstIn: '09:22', lastOut: '18:30', punches: 4, worked: '9h 08m', deviation: '+0h 08m', status: 'Present' },
  { date: '09-Apr', day: 'Wed', shift: 'GENERAL', firstIn: '—',     lastOut: '—',     punches: 0, worked: '—',     deviation: '—',        status: 'Absent' },
  { date: '08-Apr', day: 'Tue', shift: 'GENERAL', firstIn: '09:00', lastOut: '18:00', punches: 4, worked: '9h 00m', deviation: '+0h 00m', status: 'Present' },
];

const STATUS_TONE: Record<string, { bg: string; fg: string; dot: string }> = {
  'Present':    { bg: '#d6f4e3', fg: '#108548', dot: '#10b981' },
  'Late':       { bg: '#fde8c4', fg: '#a4661c', dot: '#f59e0b' },
  'Absent':     { bg: '#fdd9ea', fg: '#a02960', dot: '#ef4444' },
  'Weekly Off': { bg: '#eef2f6', fg: '#5b6478', dot: '#878a99' },
};

// Evidence Vault — table-style document repository.
// Two sub-tabs: Employee Documents (KYC + address + education + employment)
// and Organizational Documents (legal agreements + company policies).
type VaultStatus = 'Verified' | 'Uploaded' | 'Pending' | 'Signed' | 'Sent' | 'Not Generated';
interface EmpDocRow {
  name: string; idNumber?: string; authority?: string; issueDate?: string; expiryDate?: string; attachment?: string; status: VaultStatus;
}
interface OrgDocRow {
  name: string; type: string; effectiveDate?: string; validUntil?: string; attachment?: string; status: VaultStatus;
}
interface EmpDocSection { title: string; subtitle: string; icon: string; iconTint: string; iconFg: string; docs: EmpDocRow[] }
interface OrgDocSection { title: string; subtitle: string; icon: string; iconTint: string; iconFg: string; docs: OrgDocRow[] }

const VAULT_EMPLOYEE: EmpDocSection[] = [
  {
    title: 'Identity (KYC)', subtitle: 'Core identity documents for employee verification',
    icon: 'ri-shield-user-line', iconTint: '#dceefe', iconFg: '#0c63b0',
    docs: [
      { name: 'Aadhaar Card',              idNumber: 'XXXX-XXXX-1234', authority: 'UIDAI',           issueDate: '01-Jan-2020', attachment: 'Aadhaar.pdf', status: 'Verified' },
      { name: 'PAN Card',                  idNumber: 'ABCDE1234F',     authority: 'Income Tax Dept', issueDate: '01-Jan-2018', attachment: 'PAN.pdf',     status: 'Verified' },
      { name: 'Passport-size Photograph',                                                            issueDate: '01-Jan-2024', attachment: 'Photo.jpg',   status: 'Uploaded' },
    ],
  },
  {
    title: 'Address Proof', subtitle: 'Residential address verification documents',
    icon: 'ri-map-pin-line', iconTint: '#d6f4e3', iconFg: '#108548',
    docs: [
      { name: 'Aadhaar Card (Reused)', idNumber: 'XXXX-XXXX-1234', authority: 'UIDAI', issueDate: '01-Jan-2020', expiryDate: '01-Jan-2030', attachment: 'Aadhaar.pdf',     status: 'Verified' },
      { name: 'Current Address Proof',                                                  issueDate: '01-Jan-2022', expiryDate: '01-Jan-2027', attachment: 'CurrentAddr.pdf', status: 'Verified' },
      { name: 'Permanent Address Proof',                                                                                                                                  status: 'Pending'  },
    ],
  },
  {
    title: 'Education Documents', subtitle: 'Academic qualifications and credentials',
    icon: 'ri-graduation-cap-line', iconTint: '#ece6ff', iconFg: '#5a3fd1',
    docs: [
      { name: '10th Marksheet',         authority: 'State Board', issueDate: '01-May-2001', attachment: '10th.pdf',     status: 'Verified' },
      { name: '12th Marksheet',         authority: 'State Board', issueDate: '01-May-2003', attachment: '12th.pdf',     status: 'Verified' },
      { name: 'Graduation Marksheet',   authority: 'University',  issueDate: '01-Jun-2007', attachment: 'GradMark.pdf', status: 'Verified' },
      { name: 'Graduation Certificate', authority: 'University',  issueDate: '01-Oct-2007', attachment: 'GradCert.pdf', status: 'Pending'  },
    ],
  },
  {
    title: 'Previous Employment Documents', subtitle: 'Employment history, documents & background verification',
    icon: 'ri-briefcase-line', iconTint: '#fde8c4', iconFg: '#a4661c',
    docs: [
      { name: 'Experience Letter',      authority: 'Infotech Solutions Ltd', issueDate: '01-Nov-2023', attachment: 'ExpLetter.pdf',  status: 'Verified' },
      { name: 'Relieving Letter',       authority: 'Infotech Solutions Ltd', issueDate: '01-Nov-2023', attachment: 'Relieving.pdf',  status: 'Verified' },
      { name: 'Last 3 Pay Slips',       authority: 'Infotech Solutions Ltd', issueDate: '01-Oct-2023', attachment: 'PaySlips.pdf',   status: 'Verified' },
      { name: 'Form 16 (FY 2022-23)',   authority: 'Infotech Solutions Ltd', issueDate: '01-Jun-2023', attachment: 'Form16.pdf',     status: 'Verified' },
      { name: 'Bank Statement (3 mo.)', authority: 'Kotak Mahindra Bank',    issueDate: '01-Nov-2023', attachment: 'BankStmt.pdf',   status: 'Uploaded' },
      { name: 'Background Verification',authority: 'BGV Supplier',             issueDate: '15-Nov-2023', attachment: 'BGV.pdf',        status: 'Verified' },
      { name: 'Reference Check',        authority: 'BGV Supplier',             issueDate: '15-Nov-2023',                                status: 'Pending'  },
    ],
  },
];

const VAULT_ORG: OrgDocSection[] = [
  {
    title: 'Legal Agreements', subtitle: 'Binding legal documents signed between employee and organization',
    icon: 'ri-file-shield-2-line', iconTint: '#ece6ff', iconFg: '#5a3fd1',
    docs: [
      { name: 'Non-Disclosure Agreement (NDA)',           type: 'AGREEMENT', effectiveDate: '01-Nov-2023', validUntil: '01-Nov-2028', attachment: 'NDA.pdf',             status: 'Signed' },
      { name: 'Employment Agreement / Appointment Letter', type: 'AGREEMENT', effectiveDate: '03-Nov-2023',                           attachment: 'Appointment.pdf',     status: 'Signed' },
      { name: 'Confidentiality Agreement',                 type: 'AGREEMENT', effectiveDate: '03-Nov-2023',                           attachment: 'Confidentiality.pdf', status: 'Signed' },
    ],
  },
  {
    title: 'Company Policies', subtitle: 'Internal policies acknowledged and accepted by the employee',
    icon: 'ri-file-list-3-line', iconTint: '#d3f0ee', iconFg: '#0a716a',
    docs: [
      { name: 'Code of Conduct Policy',         type: 'POLICY', effectiveDate: '03-Nov-2023', attachment: 'CodeOfConduct.pdf', status: 'Signed' },
      { name: 'IT Security & Acceptable Use Policy', type: 'POLICY', effectiveDate: '03-Nov-2023', attachment: 'ITPolicy.pdf',   status: 'Signed' },
      { name: 'Leave & Attendance Policy',      type: 'POLICY', effectiveDate: '03-Nov-2023', attachment: 'LeavePolicy.pdf',   status: 'Signed' },
      { name: 'Gratuity & Benefit Policy',      type: 'POLICY', effectiveDate: '03-Nov-2023', attachment: 'GratuityPolicy.pdf', status: 'Pending' },
    ],
  },
];
// Expense Details — mock claims and the per-category visual tones used on
// the claim-row "category" pill.
const EXPENSE_CATEGORY_TONE: Record<string, { bg: string; fg: string; icon: string }> = {
  'Travel':         { bg: '#dceefe', fg: '#0c63b0', icon: 'ri-flight-takeoff-line' },
  'Meals':          { bg: '#fde8c4', fg: '#a4661c', icon: 'ri-restaurant-line' },
  'Internet':       { bg: '#d3f0ee', fg: '#0a716a', icon: 'ri-wifi-line' },
  'Office Supplies':{ bg: '#ece6ff', fg: '#5a3fd1', icon: 'ri-folder-line' },
  'Training':       { bg: '#d6f4e3', fg: '#108548', icon: 'ri-graduation-cap-line' },
};
const EXPENSE_STATUS_TONE: Record<string, { bg: string; fg: string; dot: string }> = {
  'Approved': { bg: '#d6f4e3', fg: '#108548', dot: '#10b981' },
  'Pending':  { bg: '#fde8c4', fg: '#a4661c', dot: '#f59e0b' },
  'Rejected': { bg: '#fdd9ea', fg: '#a02960', dot: '#ef4444' },
};
const EXPENSE_CLAIMS: { id: string; category: keyof typeof EXPENSE_CATEGORY_TONE; description: string; date: string; amount: number; receipt: string; status: 'Approved' | 'Pending' | 'Rejected' }[] = [
  { id: 'EXP-2201', category: 'Travel',          description: 'Client visit to Mumbai — cab + train',         date: '10-Apr-2026', amount: 2800, receipt: 'Receipt_EXP2201', status: 'Approved' },
  { id: 'EXP-2198', category: 'Meals',           description: 'Team lunch — project kickoff meeting',         date: '05-Apr-2026', amount: 850,  receipt: 'Receipt_EXP2198', status: 'Pending'  },
  { id: 'EXP-2181', category: 'Internet',        description: 'Monthly internet reimbursement — Apr',         date: '22-Mar-2026', amount: 999,  receipt: 'Receipt_EXP2181', status: 'Approved' },
  { id: 'EXP-2174', category: 'Travel',          description: 'Pune–Mumbai flight for quarterly review',      date: '15-Mar-2026', amount: 4500, receipt: 'Receipt_EXP2174', status: 'Rejected' },
  { id: 'EXP-2165', category: 'Office Supplies', description: 'Stationery and printer cartridges',            date: '08-Mar-2026', amount: 1200, receipt: 'Receipt_EXP2165', status: 'Approved' },
  { id: 'EXP-2150', category: 'Training',        description: 'Online certification course — AWS',            date: '01-Mar-2026', amount: 3500, receipt: 'Receipt_EXP2150', status: 'Pending'  },
];

const VAULT_STATUS_TONE: Record<string, { bg: string; fg: string; dot: string }> = {
  'Verified':      { bg: '#d6f4e3', fg: '#108548', dot: '#10b981' },
  'Uploaded':      { bg: '#dceefe', fg: '#0c63b0', dot: '#3b82f6' },
  'Pending':       { bg: '#fde8c4', fg: '#a4661c', dot: '#f59e0b' },
  'Signed':        { bg: '#ece6ff', fg: '#5b3fd1', dot: '#7c5cfc' },
  'Sent':          { bg: '#dceefe', fg: '#0c63b0', dot: '#3b82f6' },
  'Not Generated': { bg: '#eef2f6', fg: '#5b6478', dot: '#878a99' },
};

export default function EmployeeProfile({ employeeId, employee, onBack }: Props) {
  const initials = employee?.initials
    || (employee?.name ? employee.name.split(' ').map(p => p[0]).slice(0, 2).join('').toUpperCase() : 'EM');
  const accent = employee?.accent || '#7c5cfc';
  const profilePct = typeof employee?.profile === 'number' ? employee.profile : 83;
  // Ancillary roles support multiple values per employee. Prefer the
  // explicit `ancillaryRoles` array (server-resolved from
  // `ancillary_roles_resolved`); fall back to the legacy single
  // `ancillaryRole` for older row shapes. No hardcoded demo data —
  // empty saved data renders as an empty list, not fake names.
  const ancillaryList: string[] = Array.isArray(employee?.ancillaryRoles) && employee.ancillaryRoles.length > 0
    ? employee.ancillaryRoles.filter(Boolean)
    : Array.isArray(employee?.ancillaryRole)
      ? (employee?.ancillaryRole as string[]).filter(Boolean)
      : (employee?.ancillaryRole ? [employee.ancillaryRole as string] : []);

  const statusTone =
      employee?.status === 'active'         ? { bg: 'rgba(255,255,255,0.18)', dot: '#22c55e', label: 'Active' }
    : employee?.status === 'on_leave'       ? { bg: 'rgba(255,255,255,0.18)', dot: '#f59e0b', label: 'On Leave' }
    : employee?.status === 'high_attention' ? { bg: 'rgba(255,255,255,0.18)', dot: '#ef4444', label: 'High Attention' }
    : employee?.status === 'probation'      ? { bg: 'rgba(255,255,255,0.18)', dot: '#3b82f6', label: 'Probation' }
    : employee?.status === 'inactive'       ? { bg: 'rgba(255,255,255,0.18)', dot: '#94a3b8', label: 'Inactive' }
    :                                          { bg: 'rgba(255,255,255,0.18)', dot: '#22c55e', label: employee?.enabled === false ? 'Disabled' : 'Active' };

  const [tab, setTab] = useState<TabKey>('profile');
  const [payrollTab, setPayrollTab] = useState<PayrollTab>('summary');
  const [vaultTab, setVaultTab] = useState<VaultTab>('employee');
  const [expenseFilter, setExpenseFilter] = useState<ExpenseFilter>('all');

  // ── Manager detection — the "Hiring Requests" tab is gated to people
  //   who actually manage someone (i.e. someone else's reporting_manager
  //   points at them). Fetched once via /my-team/employees so the gate
  //   is independent of whether the team has filed any expense claims /
  //   advances yet.
  const [isManager, setIsManager] = useState<boolean>(false);
  const [teamSize, setTeamSize] = useState<number>(0);
  // Hiring Requests state — filled only when the manager opens the tab
  // (lazy fetch). The list+raise modals reuse the existing HrRecruitment
  // components so we don't duplicate the form / KPI rendering logic.
  const [hiringRequests, setHiringRequests] = useState<HiringRequestRow[]>([]);
  const [hiringLoading, setHiringLoading] = useState<boolean>(false);
  const [raiseHiringOpen, setRaiseHiringOpen] = useState<boolean>(false);
  const [listHiringOpen, setListHiringOpen] = useState<boolean>(false);
  const [hiringRefreshKey, setHiringRefreshKey] = useState<number>(0);

  // Full employee record from /employees/{id} — drives the Personal /
  // Contact / Address sections so every field reflects what the admin
  // actually saved (was previously hardcoded with sample data).
  const [empDetail, setEmpDetail] = useState<any>(null);
  // Drives the shimmer placeholders shown across the Profile / Job tabs
  // while the /employees/{id} fetch is in flight. Without this every
  // field rendered "—" for the first 200-500ms which looked broken.
  const [empDetailLoading, setEmpDetailLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    const empCode = String(employeeId || '').trim();
    if (!empCode) { setEmpDetailLoading(false); return; }
    // The route uses emp_code (e.g. EMP-001) but the API show endpoint
    // expects the numeric id. Resolve via the search index first, then
    // fetch the full record.
    setEmpDetailLoading(true);
    (async () => {
      try {
        let dbId: number | undefined = profileEmpIdNum ?? undefined;
        if (!dbId) {
          const list = await api.get('/employees', { params: { search: empCode } });
          const rows = Array.isArray(list.data) ? list.data : [];
          const match = rows.find((r: any) => String(r.emp_code || r.id) === empCode) || rows[0];
          dbId = match?.id;
        }
        if (!dbId) return;
        const r = await api.get(`/employees/${dbId}`);
        if (!cancelled) setEmpDetail(r.data || null);
      } catch {
        // Non-fatal — the page still renders the props-passed lightweight row.
      } finally {
        if (!cancelled) setEmpDetailLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [employeeId]);

  // Real salary structure (Payroll tab) — the employee's active structure, so
  // the compensation card / Revise Salary reflect actual payroll data, not the
  // sample numbers this tab used to hardcode.
  const [salaryStruct, setSalaryStruct] = useState<any>(null);
  const [salaryModalOpen, setSalaryModalOpen] = useState(false);
  const reloadSalaryStruct = () => {
    const empId = empDetail?.id;
    if (!empId) return;
    api.get('/salary-structures', { params: { employee_id: empId, active_only: 1 } })
      .then(res => setSalaryStruct((Array.isArray(res.data?.data) ? res.data.data : [])[0] ?? null))
      .catch(() => setSalaryStruct(null));
  };
  useEffect(() => { if (empDetail?.id) reloadSalaryStruct(); /* eslint-disable-next-line */ }, [empDetail?.id]);

  // Real compensation derived from the structure (falls back to the employee's
  // annual_salary, then to 0). Drives the Current Compensation card.
  const realMonthlyGross = salaryStruct ? Number(salaryStruct.monthly_gross) || 0
    : (empDetail?.annual_salary ? Math.round(Number(empDetail.annual_salary) / 12) : 0);
  const realAnnualCtc = salaryStruct ? Math.round((Number(salaryStruct.monthly_gross) || 0) * 12)
    : (empDetail?.annual_salary ? Math.round(Number(empDetail.annual_salary)) : 0);
  const fmtRupee = (n: number) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(n || 0);

  // Lightweight employee shape for the shared SalaryStructureModal.
  const salaryEmpLite: SalaryEmployeeLite | null = empDetail?.id ? {
    employee_id: empDetail.id,
    name: empDetail.display_name || `${empDetail.first_name ?? ''} ${empDetail.last_name ?? ''}`.trim() || (employee?.name || ''),
    emp_code: empDetail.emp_code,
    pf_eligible: !!empDetail.pf_eligible,
    annual_salary: empDetail.annual_salary != null ? Number(empDetail.annual_salary) : null,
    has_structure: !!salaryStruct,
    structure_id: salaryStruct?.id ?? null,
    monthly_gross: realMonthlyGross,
  } : null;

  // ── Real payslip history + salary versions (Payroll tab) ──────────────
  const MONTH_ABBR_FULL: Record<string, string> = {
    Jan: 'January', Feb: 'February', Mar: 'March', Apr: 'April', May: 'May', Jun: 'June',
    Jul: 'July', Aug: 'August', Sep: 'September', Oct: 'October', Nov: 'November', Dec: 'December',
  };
  const [payslipHistory, setPayslipHistory] = useState<any[]>([]);
  const [salaryVersions, setSalaryVersions] = useState<any[]>([]);
  const [viewSlip, setViewSlip] = useState<any>(null);
  useEffect(() => {
    const empId = empDetail?.id;
    if (!empId) return;
    api.get(`/payroll/employee/${empId}/payslips`)
      .then(res => setPayslipHistory(Array.isArray(res.data?.data) ? res.data.data : []))
      .catch(() => setPayslipHistory([]));
    api.get('/salary-structures', { params: { employee_id: empId } })
      .then(res => setSalaryVersions(Array.isArray(res.data?.data) ? res.data.data : []))
      .catch(() => setSalaryVersions([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empDetail?.id]);

  // Load a payslip's full breakup into the shared viewer.
  const loadSlip = (payslipId?: number, label?: string) => {
    if (!payslipId) return;
    api.get(`/payroll/payslip/${payslipId}`)
      .then(res => {
        const d = res.data?.data ?? {};
        const [mAbbr, y] = String(label || '').split(' ');
        setViewSlip({
          id: payslipId,
          earnings: (d.earningsBreakup ?? []).map((c: any) => ({ label: c.label, amount: Number(c.amount) || 0 })),
          deductions: (d.deductionsBreakup ?? []).map((c: any) => ({ label: c.label, amount: Number(c.amount) || 0 })),
          isFinal: d.is_final,
          company: d.company,
          month: MONTH_ABBR_FULL[mAbbr] || mAbbr || 'March',
          year: y || String(new Date().getFullYear()),
          working: d.workingDays, present: d.present, paid: d.paidDays, lop: d.lopDays,
        });
      })
      .catch(() => { /* keep prior */ });
  };
  const openLatestPayslip = () => {
    if (!payslipHistory.length) { toast.error('No payslip yet', 'No payroll has been processed for this employee.'); return; }
    const latest = payslipHistory[0];
    loadSlip(latest.payslip_id, latest.label);
    setPaySlipOpen(true);
  };

  // Real salary revision timeline from the structure versions (latest first).
  const realTimeline = salaryVersions.map((v: any) => {
    const d = v.effective_from ? new Date(v.effective_from) : null;
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const dateShort = d && !isNaN(d.getTime())
      ? `${String(d.getDate()).padStart(2, '0')}-${months[d.getMonth()]}-${d.getFullYear()}`
      : '—';
    return {
      id: String(v.id),
      current: v.status === 'active',
      dateShort,
      annual: Math.round((Number(v.monthly_gross) || 0) * 12),
      version: v.version,
      note: v.revision_note,
    };
  });

  // Helper — formats a date string like "1985-11-02" → "02-Nov-1985".
  const fmtDate = (raw: any): string => {
    if (!raw) return '—';
    const d = new Date(String(raw));
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).replace(/ /g, '-');
  };

  // ── Signed Documents — final, fully-signed copies for this employee.
  // Fetched once when the Vault tab is opened. The route accepts either
  // the numeric employee id or the EMP-### code (the slug the profile
  // already has), so no extra resolve hop is required.
  type SignedDoc = {
    id: number;
    code: string | null;
    status: string;
    template?: { id: number; code: string; name: string; doc_type: string | null } | null;
    content_html: string | null;
    header_config: any;
    footer_config: any;
    signers: Array<{ name: string; role_name: string; action: string; status: string; acted_at: string | null }>;
    updated_at: string;
  };
  const [signedDocs, setSignedDocs] = useState<SignedDoc[]>([]);
  const [signedLoading, setSignedLoading] = useState(false);
  const [signedPreview, setSignedPreview] = useState<SignedDoc | null>(null);

  // ── Uploaded employee documents — the rows the employee actually
  // uploaded through onboarding (Aadhaar/PAN/photo/etc.) plus anything HR
  // staff attached later. Drives the Employee Documents subtab below.
  type UploadedDoc = {
    id: number;
    document_key: string;
    status: 'uploaded' | 'verified' | 'rejected';
    original_name: string | null;
    mime_type: string | null;
    size_bytes: number | null;
    uploaded_at: string | null;
    verified_at: string | null;
    rejection_reason: string | null;
    uploader: { id: number; name: string } | null;
    verifier: { id: number; name: string } | null;
    url: string | null;
  };
  const [uploadedDocs, setUploadedDocs] = useState<UploadedDoc[]>([]);
  const [uploadedLoading, setUploadedLoading] = useState(false);

  useEffect(() => {
    if (tab !== 'vault' || !employeeId) return;
    let cancelled = false;
    (async () => {
      try {
        setSignedLoading(true);
        const { data } = await api.get(`/employees/${encodeURIComponent(employeeId)}/signed-documents`);
        if (!cancelled) setSignedDocs(Array.isArray(data) ? data : []);
      } catch {
        if (!cancelled) setSignedDocs([]);
      } finally {
        if (!cancelled) setSignedLoading(false);
      }

      // Uploaded employee documents — backend route binds {employee} to
      // a numeric id, so we resolve the slug first via the same helper
      // used for profile-photo uploads.
      try {
        setUploadedLoading(true);
        const empId = await resolveEmployeeUploadId();
        if (cancelled) return;
        const { data } = await api.get(`/employees/${encodeURIComponent(String(empId))}/documents`);
        if (!cancelled) setUploadedDocs(Array.isArray(data) ? data : []);
      } catch {
        if (!cancelled) setUploadedDocs([]);
      } finally {
        if (!cancelled) setUploadedLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, employeeId]);

  // Pretty-print a document_key like `aadhaar` → "Aadhaar", `prev_3_relieving` → "Prev 3 Relieving"
  const prettyDocKey = (key: string): string =>
    key.split(/[_\-\s]+/).filter(Boolean)
       .map(p => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
       .join(' ');

  const formatBytes = (b: number | null): string => {
    if (!b || b <= 0) return '—';
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
    return `${(b / 1024 / 1024).toFixed(1)} MB`;
  };

  const downloadSignedPdf = async (docId: number, code: string | null) => {
    try {
      const resp = await api.get(`/hr-document-signatures/${docId}/download-pdf`, { responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([resp.data], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${code || `doc-${docId}`}-signed.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success('Downloaded', 'Your signed PDF has been saved.');
    } catch (err: any) {
      toast.error('Could not download', err?.response?.data?.message || 'Please try again.');
    }
  };

  // ── Change-password modal state ─────────────────────────────────────
  // The signed-in employee uses this to rotate their own login password.
  // Backend lives at POST /api/change-password (AuthController::changePassword),
  // which enforces min:8 + confirmed, blocks last-3-password reuse, and
  // dispatches PasswordChangedMail with the new credential. We keep field
  // errors here as a map so the inline <small className="text-danger"> hints
  // light up the right input.
  const [pwOpen, setPwOpen]         = useState(false);
  // Face-biometric enrolment modal. Self-service path so the employee can
  // (re-)register their face for attendance from this same Security card.
  const [faceRegOpen, setFaceRegOpen] = useState(false);
  const [pwCurrent, setPwCurrent]   = useState('');
  const [pwNew, setPwNew]           = useState('');
  const [pwConfirm, setPwConfirm]   = useState('');
  const [pwSaving, setPwSaving]     = useState(false);
  const [pwShow, setPwShow]         = useState<{ cur: boolean; nw: boolean; cf: boolean }>({ cur: false, nw: false, cf: false });
  const [pwErrors, setPwErrors]     = useState<Record<string, string>>({});

  // Password strength rules — matched against the New Password value to
  // drive both the inline checklist and the colored strength bar. Same
  // ruleset used by Profile.tsx / ClientForm.tsx so the experience is
  // consistent across every password input in the app.
  const PW_RULES = [
    'At least 8 characters',
    'One uppercase letter',
    'One lowercase letter',
    'One number',
  ] as const;
  const validatePwRules = (pw: string): string[] => {
    const failed: string[] = [];
    if (pw.length < 8)        failed.push('At least 8 characters');
    if (!/[A-Z]/.test(pw))    failed.push('One uppercase letter');
    if (!/[a-z]/.test(pw))    failed.push('One lowercase letter');
    if (!/[0-9]/.test(pw))    failed.push('One number');
    return failed;
  };
  // Bonus rule for visual strength only — not required, but bumps the
  // bar to 5/5 and labels it "Strong" so users have a target to aim at.
  const pwHasSymbol = (pw: string) => /[^A-Za-z0-9]/.test(pw);
  const pwStrength = (() => {
    if (!pwNew) return { level: 0, text: '', barColor: '', barTextClass: '' };
    const passed = 4 - validatePwRules(pwNew).length + (pwHasSymbol(pwNew) ? 1 : 0);
    const labels = ['', 'Weak', 'Weak', 'Fair', 'Good', 'Strong'];
    const colors = ['', '#ef4444', '#ef4444', '#f97316', '#eab308', '#10b981'];
    const text   = ['', 'text-danger', 'text-danger', 'text-warning', 'text-warning', 'text-success'];
    return { level: passed, text: labels[passed] || 'Strong', barColor: colors[passed] || '#10b981', barTextClass: text[passed] || 'text-success' };
  })();

  const resetPwForm = () => {
    setPwCurrent(''); setPwNew(''); setPwConfirm('');
    setPwShow({ cur: false, nw: false, cf: false });
    setPwErrors({});
  };

  const handleChangePassword = async () => {
    // Client-side guards first so the user sees mistakes without a round-trip.
    const errs: Record<string, string> = {};
    if (!pwCurrent) errs.current_password = 'Current password is required';
    if (!pwNew) {
      errs.password = 'New password is required';
    } else {
      const failed = validatePwRules(pwNew);
      if (failed.length) errs.password = failed.join(', ');
      else if (pwNew === pwCurrent) errs.password = 'New password must differ from the current one';
    }
    if (!pwConfirm) errs.password_confirmation = 'Please re-enter the new password';
    else if (pwNew !== pwConfirm) errs.password_confirmation = 'Passwords do not match';
    if (Object.keys(errs).length > 0) { setPwErrors(errs); return; }

    setPwSaving(true);
    setPwErrors({});
    try {
      await api.post('/change-password', {
        current_password: pwCurrent,
        password: pwNew,
        password_confirmation: pwConfirm,
      });
      toast.success('Password updated', 'A confirmation email has been sent.');
      setPwOpen(false);
      resetPwForm();
    } catch (err: any) {
      const fieldErrors = err?.response?.data?.errors;
      if (fieldErrors && typeof fieldErrors === 'object') {
        const flat: Record<string, string> = {};
        for (const k of Object.keys(fieldErrors)) {
          flat[k] = Array.isArray(fieldErrors[k]) ? fieldErrors[k][0] : String(fieldErrors[k]);
        }
        setPwErrors(flat);
      } else {
        const msg = err?.response?.data?.message || err?.message || 'Could not change password';
        // 422 from the controller for wrong-current / re-use lands here.
        if (/current password/i.test(String(msg))) {
          setPwErrors({ current_password: String(msg) });
        } else if (/reuse|previous/i.test(String(msg))) {
          setPwErrors({ password: String(msg) });
        } else {
          toast.error('Password change failed', String(msg));
        }
      }
    } finally {
      setPwSaving(false);
    }
  };

  // Attendance regularization modal — opens from the "+ Regularization" button
  // in the Intraday Punch Timeline card. Lets the user submit a request to
  // either adjust time entries or exempt the day from penalization.
  const [regOpen, setRegOpen] = useState(false);
  const [regOption, setRegOption] = useState<'adjust' | 'exempt'>('adjust');
  const [regLocations, setRegLocations] = useState<string[]>(['Baner Office']);
  const [regLocationDraft, setRegLocationDraft] = useState('');
  const [regLogs, setRegLogs] = useState<{ id: string; from: string; to: string }[]>([
    { id: 'log-1', from: '09:32', to: '13:14' },
    { id: 'log-2', from: '14:06', to: '14:06' },
    { id: 'log-3', from: '09:32', to: '09:32' },
  ]);
  const [regNote, setRegNote] = useState('');
  const REG_LOCATION_OPTIONS = ['Baner Office', 'Hinjewadi Office', 'Kharadi Office', 'Remote', 'Client Site'];

  // Today's date in "DD MMM YYYY" so the regularization modal shows the
  // correct selected day on every open instead of a stale hardcoded value.
  const regSelectedDate = new Date()
    .toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    .replace(/ /g, '-');

  // Toast hook (used by the Export Timelogs button) and last-7-month picker
  // for the timelog history filter.
  const toast = useToast();
  const [monthOpen, setMonthOpen] = useState(false);
  const ATT_MONTHS = (() => {
    const out: { key: string; label: string }[] = [];
    const now = new Date();
    for (let i = 0; i < 7; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      out.push({
        key: `${d.getFullYear()}-${d.getMonth() + 1}`,
        label: d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }),
      });
    }
    return out;
  })();
  const [attMonth, setAttMonth] = useState<string>(ATT_MONTHS[0]?.label || 'April 2026');
  // Attendance Timelog History pagination — 6 rows per page to match the
  // compact card height used by the Attendance tab. Reset to page 0 whenever
  // the month filter changes so the user doesn't land on an empty page.
  const ATT_PAGE_SIZE = 6;
  const [attPage, setAttPage] = useState(0);
  useEffect(() => { setAttPage(0); }, [attMonth]);

  // Payslip viewer modal — opens from the "View Payslip" button in the
  // Payroll Summary hero. Filters by year/month and shows the rendered
  // payslip on the right with download/print/email actions in the header.
  const [paySlipOpen, setPaySlipOpen] = useState(false);
  const [paySlipYear, setPaySlipYear] = useState('2026');
  const [paySlipMonth, setPaySlipMonth] = useState('March');
  const PAYSLIP_RECENT = [
    { label: 'Mar 2026', now: true },
    { label: 'Feb 2026' },
    { label: 'Jan 2026' },
    { label: 'Dec 2025' },
    { label: 'Nov 2025' },
    { label: 'Oct 2025' },
  ];
  const PAYSLIP_EARNINGS = [
    { label: 'Basic Salary',          amount: 121000 },
    { label: 'House Rent Allowance (HRA)', amount: 60500 },
    { label: 'Special Allowance',     amount: 120900 },
  ];
  const PAYSLIP_DEDUCTIONS = [
    { label: 'Professional Tax',  amount: 200 },
    { label: 'Provident Fund (12%)', amount: 14520 },
    { label: 'Income Tax (TDS)',  amount: 8400 },
  ];
  const paySlipTotalEarnings   = PAYSLIP_EARNINGS.reduce((s, r) => s + r.amount, 0);
  const paySlipTotalDeductions = PAYSLIP_DEDUCTIONS.reduce((s, r) => s + r.amount, 0);
  const paySlipNetPay          = paySlipTotalEarnings - paySlipTotalDeductions;

  // Salary timeline + Revise Salary / View Breakdown modals (Payment Details
  // sub-tab). Timeline is defined here so both the inline list and the
  // breakdown modal stay in sync.
  const SALARY_TIMELINE = [
    { id: 'sal-1', dateShort: '01-Nov-2025', annual: 302400, current: true  },
    { id: 'sal-2', dateShort: '23-May-2025', annual: 222000, current: false },
    { id: 'sal-3', dateShort: '27-Jan-2025', annual: 72000,  current: false },
  ];
  function makeBreakdown(annual: number) {
    const monthly = annual / 12;
    // 40% / 20% / remainder split — same rule the HRMS reference uses.
    const basic   = Math.round(monthly * 0.40);
    const hra     = Math.round(monthly * 0.20);
    const special = Math.round(monthly - basic - hra);
    const totalMonthly = basic + hra + special;
    // Net pay ≈ gross − PF (12% of basic) − TDS (rough). Mirrors the screenshot
    // ratio (₹22,176 / ₹25,200 ≈ 0.88 of monthly gross).
    const netPay  = Math.round(totalMonthly * 0.88);
    return {
      rows: [
        { label: 'Basic Salary',                  monthly: basic,   annual: basic * 12   },
        { label: 'House Rent Allowance (HRA)',    monthly: hra,     annual: hra * 12     },
        { label: 'Special Allowance',             monthly: special, annual: special * 12 },
      ],
      totalMonthly,
      totalAnnual: totalMonthly * 12,
      netPay,
    };
  }
  const [reviseOpen, setReviseOpen]       = useState(false);
  const [reviseAmount, setReviseAmount]   = useState('3,50,000');
  const [revisePct, setRevisePct]         = useState('');
  const [reviseStructure, setReviseStructure] = useState('Class A');
  const [reviseDate, setReviseDate]       = useState('2026-05-01');
  const [reviseBonusInSal, setReviseBonusInSal] = useState(false);
  const [reviseBonusOpen, setReviseBonusOpen]   = useState(false);
  const [reviseBonusAmount, setReviseBonusAmount] = useState('');
  const [reviseNote, setReviseNote]       = useState('');
  const [showBreakdownToggle, setShowBreakdownToggle] = useState(false);
  const [breakdownOpen, setBreakdownOpen] = useState(false);
  const [breakdownRowId, setBreakdownRowId] = useState<string>('sal-1');
  // Breakdown modal — prefer the REAL salary version's components; fall back
  // to the mock makeBreakdown only when no real structure exists.
  const breakdownVersion = salaryVersions.find((v: any) => String(v.id) === breakdownRowId) || salaryVersions[0];
  const breakdownRow   = realTimeline.find(r => r.id === breakdownRowId) || realTimeline[0] || SALARY_TIMELINE[0];
  const breakdownData  = breakdownVersion ? {
    rows: (breakdownVersion.earnings || []).map((c: any) => ({
      label: c.label, monthly: Number(c.amount) || 0, annual: (Number(c.amount) || 0) * 12,
    })),
    totalMonthly: Number(breakdownVersion.monthly_gross) || 0,
    totalAnnual: Math.round((Number(breakdownVersion.monthly_gross) || 0) * 12),
    netPay: Math.round((Number(breakdownVersion.monthly_gross) || 0) * 0.88),
  } : makeBreakdown(breakdownRow.annual);

  // Live preview math for the Revise Salary modal.
  const reviseAnnualNum = Number(String(reviseAmount).replace(/[^\d.]/g, '')) || 0;
  const reviseMonthlyNum = reviseAnnualNum > 0 ? Math.round(reviseAnnualNum / 12) : 0;
  const currentAnnual = SALARY_TIMELINE[0].annual;
  const reviseDifference = reviseAnnualNum - currentAnnual;
  const revisePctChange  = currentAnnual > 0 ? ((reviseDifference / currentAnnual) * 100) : 0;

  // Submit New Expense Claim modal — opens from "+ Raise New Claim" in the
  // Expense Details tab. Two modes: Expense Claim (orange) and Advance
  // Request (purple/indigo).
  const [claimOpen, setClaimOpen] = useState(false);
  const [claimMode, setClaimMode] = useState<'expense' | 'advance'>('expense');

  // Categories pulled from the expense_category master so the dropdown stays
  // in sync with what admins configure (and so we save the master id, not a
  // free-text label). `monthly_limit` and `yearly_limit` are also fetched
  // so we can warn the user on the form when a draft amount exceeds the
  // per-category budget the admin set in Master > Expense Categories.
  type ClaimCategory = { id: number; name: string; monthly_limit: number | null; yearly_limit: number | null };
  const [claimCategories, setClaimCategories] = useState<ClaimCategory[]>([]);
  useEffect(() => {
    if (!claimOpen) return;
    api.get('/master/expense_category')
      .then((res: any) => {
        const rows = Array.isArray(res?.data) ? res.data : [];
        setClaimCategories(
          rows
            .filter((r: any) => (r.status ?? 'Active') === 'Active')
            .map((r: any) => ({
              id: Number(r.id),
              name: String(r.name ?? ''),
              monthly_limit: r.monthly_limit != null && r.monthly_limit !== '' ? Number(r.monthly_limit) : null,
              yearly_limit:  r.yearly_limit  != null && r.yearly_limit  !== '' ? Number(r.yearly_limit)  : null,
            })),
        );
      })
      .catch(() => setClaimCategories([]));
  }, [claimOpen]);
  const categoryLabelById = (id: string | number | undefined): string => {
    if (id === undefined || id === '' || id === null) return '';
    const num = Number(id);
    const hit = claimCategories.find(c => c.id === num);
    return hit ? hit.name : String(id);
  };
  const categoryById = (id: string | number | undefined): ClaimCategory | null => {
    if (id === undefined || id === '' || id === null) return null;
    const num = Number(id);
    return claimCategories.find(c => c.id === num) || null;
  };

  // Multi-draft tab support — every form-render reads/writes the active draft
  // in `claimDrafts`. "Save & Add Another" appends a fresh draft and switches
  // to it; clicking a tab swaps drafts in/out. This lets users line up several
  // claims in one sitting without losing in-progress work.
  type ClaimDraft = {
    employee: string;
    category: string;     // expense_category id (stringified)
    currency: string;
    project: string;
    payment: string;
    title: string;
    amount: string;
    date: string;
    vendor: string;
    purpose: string;
    saved: boolean;       // marked true once "Save & Add Another" / "Submit" runs on this draft
    // Each draft owns its own attachment list. Used to live in a single
    // top-level `claimFiles` state, which meant "Save & Add Another"
    // carried Claim 1's receipts into Claim 2 — the user saw the same
    // attachments on every draft and had no way to upload distinct ones.
    files: File[];
  };
  const blankDraft = (): ClaimDraft => ({
    employee: employeeId,
    category: '',
    // Currency, payment, and date all start empty so every field reads
    // as "untouched" with its placeholder visible. Previously currency/
    // payment defaulted to INR/UPI and date defaulted to today —
    // people submitted with wrong defaults assuming they'd been filled
    // in deliberately. Force an explicit choice on each.
    currency: '',
    project: '',
    payment: '',
    title: '',
    amount: '',
    date: '',
    vendor: '',
    purpose: '',
    saved: false,
    files: [],
  });
  const [claimDrafts, setClaimDrafts] = useState<ClaimDraft[]>([blankDraft()]);
  const [activeClaimIdx, setActiveClaimIdx] = useState(0);
  // True only when the modal was opened via the Drafts tab's Resume button.
  // "Raise New Claim" / "New Advance Request" leaves this false so the
  // form opens empty regardless of what's parked in localStorage. The
  // open-side effects reset the flag back to false after consuming it.
  const [resumeFromDraft, setResumeFromDraft] = useState(false);
  // Local-storage key for the Save Draft feature. Scoped per employee so
  // viewing two different profiles doesn't cross-contaminate drafts.
  const claimDraftKey = `cbc.expense.draft.${employeeId || 'me'}`;
  // List of saved expense / advance drafts. Each entry is independently
  // resumable, editable, and discardable so the user can keep multiple
  // works-in-progress side by side. Stored as a JSON array under the
  // per-employee localStorage key.
  type ExpenseDraftEntry = { id: string; savedAt: string; drafts: ClaimDraft[] };
  type AdvanceDraftEntry = { id: string; savedAt: string; data: any };
  const [expenseDrafts, setExpenseDrafts] = useState<ExpenseDraftEntry[]>([]);
  const [advanceDrafts, setAdvanceDrafts] = useState<AdvanceDraftEntry[]>([]);
  // Id of the draft currently loaded in the modal (when the user opened
  // via Resume). When set, Save Draft updates that entry in place rather
  // than appending a new one. Null when the modal was opened via Raise
  // New Claim, so Save Draft always creates a fresh entry.
  const [editingDraftId, setEditingDraftId] = useState<string | null>(null);
  // Reader that pulls both saved-draft buckets out of localStorage. Each
  // bucket is a JSON-encoded array of entries. Back-compat: also accepts
  // the previous single-slot shapes — raw array or `{savedAt,data}` — and
  // promotes them to a one-entry array under a freshly-minted id so users
  // upgrading from the older flow don't lose their saved draft.
  const readSavedDrafts = () => {
    const mkId = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    try {
      const raw = localStorage.getItem(claimDraftKey);
      if (!raw) { setExpenseDrafts([]); }
      else {
        const parsed = JSON.parse(raw);
        let entries: ExpenseDraftEntry[] = [];
        if (Array.isArray(parsed) && parsed.length > 0 && parsed[0] && typeof parsed[0] === 'object' && 'drafts' in parsed[0]) {
          // New format: array of entries.
          entries = (parsed as ExpenseDraftEntry[])
            .filter(e => e && Array.isArray(e.drafts) && e.drafts.length > 0)
            .map(e => ({ id: e.id || mkId('exp'), savedAt: e.savedAt || '', drafts: e.drafts }));
        } else if (Array.isArray(parsed) && parsed.length > 0) {
          // Old raw-array shape: ClaimDraft[]. Promote to single entry.
          entries = [{ id: mkId('exp'), savedAt: '', drafts: parsed as ClaimDraft[] }];
        } else if (parsed && Array.isArray(parsed.data) && parsed.data.length > 0) {
          // Old wrapped shape: { savedAt, data: ClaimDraft[] }. Promote.
          entries = [{ id: mkId('exp'), savedAt: parsed.savedAt || '', drafts: parsed.data as ClaimDraft[] }];
        }
        setExpenseDrafts(entries);
      }
    } catch { setExpenseDrafts([]); }
    try {
      const raw = localStorage.getItem(advanceDraftKey);
      if (!raw) { setAdvanceDrafts([]); }
      else {
        const parsed = JSON.parse(raw);
        let entries: AdvanceDraftEntry[] = [];
        if (Array.isArray(parsed) && parsed.length > 0 && parsed[0] && typeof parsed[0] === 'object' && 'data' in parsed[0] && 'id' in parsed[0]) {
          // New format: array of entries.
          entries = (parsed as AdvanceDraftEntry[])
            .filter(e => e && e.data && typeof e.data === 'object')
            .map(e => ({ id: e.id || mkId('adv'), savedAt: e.savedAt || '', data: e.data }));
        } else if (parsed && typeof parsed === 'object' && 'savedAt' in parsed && 'data' in parsed) {
          // Old wrapped shape. Promote to single entry.
          entries = [{ id: mkId('adv'), savedAt: parsed.savedAt || '', data: parsed.data }];
        } else if (parsed && typeof parsed === 'object') {
          // Old raw shape (advance payload at top level). Promote.
          entries = [{ id: mkId('adv'), savedAt: '', data: parsed }];
        }
        setAdvanceDrafts(entries);
      }
    } catch { setAdvanceDrafts([]); }
  };
  // Each time the modal re-opens, restore from localStorage if a draft is
  // saved there; otherwise start with one fresh draft. Also refresh the
  // draft-meta cache when the modal closes (the user may have just hit
  // Save Draft, or submitted, which clears storage).
  useEffect(() => {
    if (claimOpen) {
      // Only restore from localStorage when the user explicitly hit
      // Resume on a specific draft card. Look up the entry by id from
      // the in-memory `expenseDrafts` array; if no editing id is set
      // (or the id no longer exists), fall back to a blank draft so
      // Raise New Claim always starts fresh.
      let restored: ClaimDraft[] | null = null;
      if (resumeFromDraft && editingDraftId) {
        const entry = expenseDrafts.find(e => e.id === editingDraftId);
        if (entry && entry.drafts.length > 0) {
          // File objects can't survive JSON serialisation, so attachments
          // staged before Save Draft are lost — force `files: []` on
          // every restored draft so we don't end up with `undefined`
          // (which would crash the file list map).
          restored = entry.drafts.map(p => ({ ...p, files: [] }));
        }
      }
      setClaimDrafts(restored || [blankDraft()]);
      setActiveClaimIdx(0);
    } else {
      // Modal just closed (or first mount) — refresh the cached meta so
      // the Drafts pill on the table reflects what's actually in storage.
      // Also clear the resume / editing flags so the next "Raise New
      // Claim" starts fresh even if Resume was used earlier this session.
      readSavedDrafts();
      setResumeFromDraft(false);
      setEditingDraftId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claimOpen, employeeId]);

  // Save Draft handler — persists either the expense `claimDrafts` array
  // or the advance form fields, depending on which mode the modal is in.
  // Doesn't hit the backend (rows are created only on actual Submit).
  // File objects are stripped before serialising since browsers can't
  // round-trip File through JSON — attachments must be re-staged on resume.
  const handleSaveDraft = () => {
    try {
      const savedAt = new Date().toISOString();
      const newId = `${claimMode === 'advance' ? 'adv' : 'exp'}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      if (claimMode === 'advance') {
        const payload = {
          advType, advTypeOther, advAmount,
          advRequestedDate, advRecoveryStart,
          advRecoveryMode, advMonths, advMonthlyEmi, advReason,
        };
        // If we opened via Resume, update that entry in place; otherwise
        // append a fresh one so multiple in-progress drafts coexist.
        const next: AdvanceDraftEntry[] = editingDraftId
          ? advanceDrafts.map(e => e.id === editingDraftId ? { ...e, savedAt, data: payload } : e)
          : [...advanceDrafts, { id: newId, savedAt, data: payload }];
        localStorage.setItem(advanceDraftKey, JSON.stringify(next));
        toast.success(
          editingDraftId ? 'Draft updated' : 'Draft saved',
          advFiles.length > 0
            ? `Form fields saved — you'll need to re-attach ${advFiles.length} file${advFiles.length === 1 ? '' : 's'} on resume.`
            : 'Your draft is now available in the Drafts tab.',
        );
        setExpenseModuleTab('advance');
      } else {
        const serialisable = claimDrafts.map(d => ({ ...d, files: [] }));
        const next: ExpenseDraftEntry[] = editingDraftId
          ? expenseDrafts.map(e => e.id === editingDraftId ? { ...e, savedAt, drafts: serialisable } : e)
          : [...expenseDrafts, { id: newId, savedAt, drafts: serialisable }];
        localStorage.setItem(claimDraftKey, JSON.stringify(next));
        const stagedFiles = claimDrafts.reduce((n, d) => n + (d.files?.length || 0), 0);
        toast.success(
          editingDraftId ? 'Draft updated' : 'Draft saved',
          stagedFiles > 0
            ? `Form fields saved — you'll need to re-attach ${stagedFiles} file${stagedFiles === 1 ? '' : 's'} on resume.`
            : 'Your draft is now available in the Drafts tab.',
        );
        setExpenseModuleTab('expense');
      }
      readSavedDrafts();
      setEditingDraftId(null);
      // Close the modal and jump straight to the Drafts pill so the user
      // sees the saved entry as the new active view.
      setClaimOpen(false);
      setExpenseFilter('draft');
    } catch {
      toast.error('Could not save draft', 'Browser storage is full or blocked.');
    }
  };
  const draft = claimDrafts[activeClaimIdx] ?? blankDraft();
  const updateDraft = (patch: Partial<ClaimDraft>) =>
    setClaimDrafts(d => d.map((x, i) => (i === activeClaimIdx ? { ...x, ...patch } : x)));
  const saveAndAddAnother = () => {
    setClaimDrafts(d => {
      const next = d.map((x, i) => (i === activeClaimIdx ? { ...x, saved: true } : x));
      next.push(blankDraft());
      return next;
    });
    setActiveClaimIdx(i => i + 1);
  };

  // Aliases so the existing JSX bindings (claimEmployee, setClaimEmployee, …)
  // keep working without touching every value/onChange site below.
  const claimEmployee = draft.employee;
  const setClaimEmployee = (v: string) => updateDraft({ employee: v });
  const claimCategory = draft.category;
  const setClaimCategory = (v: string) => updateDraft({ category: v });
  const claimCurrency = draft.currency;
  const setClaimCurrency = (v: string) => updateDraft({ currency: v });
  const claimProject = draft.project;
  const setClaimProject = (v: string) => updateDraft({ project: v });
  const claimPayment = draft.payment;
  const setClaimPayment = (v: string) => updateDraft({ payment: v });
  const claimTitle = draft.title;
  const setClaimTitle = (v: string) => updateDraft({ title: v });
  const claimAmount = draft.amount;
  const setClaimAmount = (v: string) => updateDraft({ amount: v });
  const claimDate = draft.date;
  const setClaimDate = (v: string) => updateDraft({ date: v });
  const claimVendor = draft.vendor;
  const setClaimVendor = (v: string) => updateDraft({ vendor: v });
  const claimPurpose = draft.purpose;
  const setClaimPurpose = (v: string) => updateDraft({ purpose: v });

  // Per-field error map for the active expense draft — wired to red
  // borders + inline error messages on every input, same pattern the
  // candidate form uses. Reset on draft switch or modal re-open so we
  // don't carry over errors from a previously-active draft.
  const [claimErrors, setClaimErrors] = useState<Record<string, string>>({});
  useEffect(() => { setClaimErrors({}); }, [activeClaimIdx, claimOpen]);
  const clearClaimErr = (key: string) =>
    setClaimErrors(prev => (prev[key] ? { ...prev, [key]: '' } : prev));
  // Advance request — per-field error map. Cleared whenever the modal
  // re-opens or the mode toggles so old errors don't haunt a fresh form.
  const [advErrors, setAdvErrors] = useState<Record<string, string>>({});
  useEffect(() => { setAdvErrors({}); }, [claimOpen, claimMode]);
  const clearAdvErr = (key: string) =>
    setAdvErrors(prev => (prev[key] ? { ...prev, [key]: '' } : prev));

  // Validator for the Advance Request form. Same toast-summary +
  // per-field map pattern the expense draft validator uses, so both
  // forms surface mistakes identically (red border + inline message).
  const submitAdvanceRequest = async () => {
    // Re-entrancy guard — shares the same flag the expense flow uses so
    // a fast double-click on Submit Advance Request can't fire two POSTs
    // and create duplicate rows.
    if (claimSubmitting) return;
    const errs: Record<string, string> = {};
    const summary: string[] = [];
    const amt = Number(String(advAmount).replace(/[^\d.]/g, ''));
    if (!advType)              { errs.type = 'Advance type is required'; summary.push('Advance type is required'); }
    if (advType === 'Other' && !advTypeOther.trim()) {
      errs.type_other = 'Please specify the advance type';
      summary.push('Specify the advance type');
    }
    if (!advAmount.trim() || !Number.isFinite(amt) || amt <= 0) {
      errs.amount = 'Amount must be greater than 0';
      summary.push('Amount must be greater than 0');
    }
    if (!advRequestedDate)     { errs.requested = 'Requested date is required';   summary.push('Requested date is required'); }
    if (!advRecoveryStart)     { errs.recovery_start = 'Recovery start date is required'; summary.push('Recovery start date is required'); }
    // Today (local, YYYY-MM-DD) — lexicographic compare works because the
    // MasterDatePicker emits ISO date strings, so today/past detection is
    // a plain string compare. Both dates must be today or later; recovery
    // additionally must be on/after the requested date.
    const todayIso = new Date().toISOString().slice(0, 10);
    if (advRequestedDate && advRequestedDate < todayIso) {
      errs.requested = 'Requested date cannot be in the past';
      summary.push('Requested date cannot be in the past');
    }
    if (advRecoveryStart && advRecoveryStart < todayIso) {
      errs.recovery_start = 'Recovery start cannot be in the past';
      summary.push('Recovery start cannot be in the past');
    }
    // Server enforces after_or_equal:requested_date too, but catch it
    // client-side so the user gets immediate feedback instead of a 422.
    if (advRequestedDate && advRecoveryStart && advRecoveryStart < advRequestedDate) {
      errs.recovery_start = 'Recovery start must be on or after requested date';
      summary.push('Recovery start must be on or after requested date');
    }
    if (!advRecoveryMode)      { errs.recovery_mode = 'Recovery mode is required'; summary.push('Recovery mode is required'); }
    if (advRecoveryMode === 'emi') {
      const months = Number(advMonths);
      if (!advMonths || !Number.isFinite(months) || months <= 0) {
        errs.months = 'Months must be greater than 0';
        summary.push('Months must be greater than 0');
      }
    }
    if (!advReason.trim())     { errs.reason = 'Reason / purpose is required';    summary.push('Reason / purpose is required'); }
    if (Object.keys(errs).length > 0) {
      setAdvErrors(errs);
      toast.error('Fix the highlighted issues', summary.slice(0, 3).join('. '));
      return;
    }
    setClaimSubmitting(true);
    try {
      const fd = new FormData();
      fd.append('advance_type', advType);
      if (advType === 'Other') fd.append('advance_type_other', advTypeOther.trim());
      fd.append('amount', String(amt));
      fd.append('requested_date', advRequestedDate);
      fd.append('recovery_start', advRecoveryStart);
      fd.append('recovery_mode', advRecoveryMode);
      if (advRecoveryMode === 'emi') {
        fd.append('recovery_months', String(Number(advMonths)));
        if (advMonthlyEmi) {
          const emi = Number(String(advMonthlyEmi).replace(/[^\d.]/g, ''));
          if (Number.isFinite(emi) && emi > 0) fd.append('monthly_emi', String(emi));
        }
      }
      fd.append('reason', advReason.trim());
      // Profile owner — same routing logic as expense-claim store(). The
      // backend resolves either numeric id or EMP- code, and gates the
      // "you can only file under yourself" rule for non-super-admins.
      if (profileEmpIdNum !== null) {
        fd.append('employee_id', String(profileEmpIdNum));
      } else if (profileEmpCode) {
        fd.append('employee_code', profileEmpCode);
      }
      for (const f of advFiles) fd.append('files[]', f);

      await api.post('/advance-requests', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      toast.success('Advance request submitted', 'Sent for manager + finance approval.');
      // If this submission resumed a parked draft, drop only that one
      // entry from storage so the rest of the user's drafts survive.
      // Fresh "Raise New Claim" submissions leave storage untouched.
      if (editingDraftId) {
        try {
          const next = advanceDrafts.filter(e => e.id !== editingDraftId);
          if (next.length) localStorage.setItem(advanceDraftKey, JSON.stringify(next));
          else             localStorage.removeItem(advanceDraftKey);
        } catch { /* swallow */ }
      }
      setEditingDraftId(null);
      setClaimOpen(false);
      // Refresh the list table so the new row appears immediately. Wrapped
      // in try/catch so a stale-fetch failure doesn't surface a second
      // error toast right after the success one.
      try { await refreshAdvances(); } catch { /* swallow */ }
    } catch (err: any) {
      // Same surface-the-best-message pattern submitAllDrafts uses —
      // 422 field errors first, then top-level message, then a status
      // hint as fallback.
      const fieldErrors = err?.response?.data?.errors;
      let msg = '';
      if (fieldErrors && typeof fieldErrors === 'object') {
        const first = Object.values(fieldErrors)[0];
        msg = Array.isArray(first) ? String(first[0]) : String(first);
      }
      if (!msg) msg = err?.response?.data?.message || '';
      const status = err?.response?.status;
      if (!msg) {
        msg = status === 500
          ? 'The server rejected the request. Check the amount fits 12 digits and try again.'
          : status === 413
            ? 'One or more attachments are too large to upload.'
            : 'Could not submit the advance request. Please try again.';
      }
      toast.error('Submit failed', msg);
    } finally {
      setClaimSubmitting(false);
    }
  };

  // Advance request fields
  const [advType, setAdvType] = useState('');
  const [advTypeOther, setAdvTypeOther] = useState(''); // shown only when advType === 'Other'
  const [advAmount, setAdvAmount] = useState('');
  const [advRequestedDate, setAdvRequestedDate] = useState(new Date().toISOString().slice(0, 10));
  const [advRecoveryStart, setAdvRecoveryStart] = useState('');
  const [advRecoveryMode, setAdvRecoveryMode] = useState('');
  const [advMonths, setAdvMonths] = useState('');
  const [advReason, setAdvReason] = useState('');
  // Editable EMI — auto-derived from amount/months unless the user has typed
  // a value into the field. `advEmiTouched` flips on any keystroke and stops
  // the auto-fill from overwriting their manual override.
  const [advMonthlyEmi, setAdvMonthlyEmi] = useState('');
  const [advEmiTouched, setAdvEmiTouched] = useState(false);
  useEffect(() => {
    if (advEmiTouched) return;
    const a = Number(String(advAmount).replace(/[^\d.]/g, ''));
    const m = Number(advMonths);
    if (a > 0 && m > 0) {
      setAdvMonthlyEmi(String(Math.round(a / m)));
    } else {
      setAdvMonthlyEmi('');
    }
  }, [advAmount, advMonths, advEmiTouched]);
  // Reset the manual-override flag every time the modal re-opens so the
  // auto-fill kicks back in for a fresh request.
  useEffect(() => {
    if (claimOpen) setAdvEmiTouched(false);
  }, [claimOpen]);
  // Expense receipts now live per-draft (`draft.files`) so each claim
  // owns its own attachments. The `claimFiles` / `setClaimFiles`
  // aliases below preserve the existing JSX bindings while reading and
  // writing the active draft's bucket. Advance docs stay top-level
  // since the advance form is a single record, not a list.
  const claimFiles = draft.files;
  const setClaimFiles = (next: File[] | ((prev: File[]) => File[])) => {
    setClaimDrafts(d => d.map((x, i) => {
      if (i !== activeClaimIdx) return x;
      const nextFiles = typeof next === 'function' ? (next as (prev: File[]) => File[])(x.files) : next;
      return { ...x, files: nextFiles };
    }));
  };
  const [advFiles, setAdvFiles] = useState<File[]>([]);
  // localStorage key for the advance-mode Save Draft. Kept separate from
  // the expense draft key so flipping modules doesn't clobber the other
  // form's saved fields. Scoped per employee like the expense draft.
  const advanceDraftKey = `cbc.advance.draft.${employeeId || 'me'}`;
  // Reset attachments + custom advance-type field every time the modal
  // opens — then, if a saved advance draft exists in localStorage, hydrate
  // every advance field from it. File objects don't round-trip JSON so
  // attachments must be re-staged on resume (same trade-off as the
  // expense Save Draft flow).
  useEffect(() => {
    if (claimOpen) {
      // Always wipe attachments + transient fields on open so the form is
      // visually consistent. Only re-hydrate other fields from localStorage
      // when the user explicitly opened via the Drafts Resume button;
      // "New Advance Request" should start blank even when a draft exists.
      setAdvFiles([]);
      setAdvTypeOther('');
      if (!resumeFromDraft || !editingDraftId) {
        setAdvType('');
        setAdvAmount('');
        setAdvRequestedDate(new Date().toISOString().slice(0, 10));
        setAdvRecoveryStart('');
        setAdvRecoveryMode('');
        setAdvMonths('');
        setAdvMonthlyEmi('');
        setAdvReason('');
        return;
      }
      try {
        // Hydrate the specific advance entry that was clicked in the
        // Drafts tab. Look it up by id in the in-memory list rather
        // than re-reading localStorage — same source of truth used by
        // the cards themselves.
        const entry = advanceDrafts.find(e => e.id === editingDraftId);
        if (entry) {
          const d = entry.data as Partial<{
            advType: string; advTypeOther: string; advAmount: string;
            advRequestedDate: string; advRecoveryStart: string;
            advRecoveryMode: string; advMonths: string; advMonthlyEmi: string;
            advReason: string;
          }>;
          if (d && typeof d === 'object') {
            if (typeof d.advType            === 'string') setAdvType(d.advType);
            if (typeof d.advTypeOther       === 'string') setAdvTypeOther(d.advTypeOther);
            if (typeof d.advAmount          === 'string') setAdvAmount(d.advAmount);
            if (typeof d.advRequestedDate   === 'string') setAdvRequestedDate(d.advRequestedDate);
            if (typeof d.advRecoveryStart   === 'string') setAdvRecoveryStart(d.advRecoveryStart);
            if (typeof d.advRecoveryMode    === 'string') setAdvRecoveryMode(d.advRecoveryMode);
            if (typeof d.advMonths          === 'string') setAdvMonths(d.advMonths);
            if (typeof d.advMonthlyEmi      === 'string') setAdvMonthlyEmi(d.advMonthlyEmi);
            if (typeof d.advReason          === 'string') setAdvReason(d.advReason);
          }
        }
      } catch { /* ignore — leave defaults in place */ }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claimOpen]);

  // ── Expense Claims — API-backed list ──────────────────────────────────
  // Shape mirrors what ExpenseClaimController::serialize() returns. The
  // table renders directly from `apiClaims` (own) and `teamClaims` (when the
  // current user is the reporting manager for someone). Both are refetched
  // after a successful submit / approve / reject.
  type ApiClaim = {
    id: number;
    claim_no: string | null;
    employee_id: number;
    employee_name: string | null;
    employee_code: string | null;
    department_id?: number | null;
    department_name?: string | null;
    manager_id: number | null;
    manager_name: string | null;
    category_id: number | null;
    category_name: string | null;
    currency: string | null;
    project: string | null;
    payment_method: string | null;
    title: string;
    amount: number;
    expense_date: string;
    vendor: string | null;
    purpose: string | null;
    attachments: { name: string; size?: number; url?: string }[];
    status: 'pending' | 'approved' | 'rejected';
    manager_status: 'pending' | 'approved' | 'rejected';
    manager_acted_at: string | null;
    manager_comment: string | null;
    hr_status: 'pending' | 'approved' | 'rejected';
    hr_user_name: string | null;
    hr_acted_at: string | null;
    hr_comment: string | null;
    creator_name: string | null;
    created_at: string | null;
  };
  const { user: authUser, refresh: refreshAuth } = useAuth();
  // The route `/hr/employees/:id/profile` carries the EMP- code (e.g.
  // "EMP-001") in the URL, NOT the numeric Employee.id. Pass both to the
  // backend — it will resolve whichever it gets.
  const profileEmpCode = String(employeeId || '');
  const profileEmpIdNum = /^\d+$/.test(profileEmpCode) ? Number(profileEmpCode) : null;
  // Profile photo upload & cropping mirrors Profile.tsx: validate the picked
  // image, open the square cropper, then stage a cropped JPEG preview.
  const [profilePhotoFile, setProfilePhotoFile] = useState<File | null>(null);
  const [profilePhotoPreview, setProfilePhotoPreview] = useState<string | null>(null);
  const [cropOpen, setCropOpen] = useState(false);
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  const [savingPhoto, setSavingPhoto] = useState(false);
  const profilePhotoInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    // Prefer the freshly-fetched empDetail.photo_url over the lightweight
    // employee prop passed via navigation state — the prop can be stale if
    // the user uploaded a new photo elsewhere (HR Employees / Onboarding)
    // since opening this profile.
    const photo = empDetail?.photo_url || employee?.photoUrl || null;
    const resolved = photo ? resolveFileUrl(photo) : null;
    setProfilePhotoPreview(prev => (profilePhotoFile ? prev : resolved));
  }, [empDetail?.photo_url, employee?.photoUrl, profilePhotoFile]);

  const restoreSavedProfilePhoto = () => {
    const saved = empDetail?.photo_url || employee?.photoUrl || null;
    setProfilePhotoPreview(saved ? resolveFileUrl(saved) : null);
  };

  const validateProfilePhoto = (file: File): string | null => {
    const MAX_BYTES = 4 * 1024 * 1024;
    const OK_TYPES  = ['image/jpeg', 'image/png', 'image/webp'];
    if (!OK_TYPES.includes(file.type)) return 'Use a PNG, JPG or WebP file.';
    if (file.size > MAX_BYTES)         return `Photo is larger than 4 MB (got ${(file.size / 1024 / 1024).toFixed(1)} MB).`;
    return null;
  };

  const handleProfilePhotoChange = (file: File | null) => {
    if (!file) {
      setProfilePhotoFile(null);
      restoreSavedProfilePhoto();
      return;
    }
    const err = validateProfilePhoto(file);
    if (err) {
      toast.error('Invalid Photo', err);
      if (profilePhotoInputRef.current) profilePhotoInputRef.current.value = '';
      return;
    }
    const r = new FileReader();
    r.onload = ev => {
      setCropSrc(ev.target?.result as string);
      setCropOpen(true);
    };
    r.readAsDataURL(file);
    if (profilePhotoInputRef.current) profilePhotoInputRef.current.value = '';
  };

  const handleCropConfirm = (blob: Blob) => {
    const file = new File([blob], `profile-${Date.now()}.jpg`, { type: 'image/jpeg' });
    setProfilePhotoFile(file);
    const r = new FileReader();
    r.onload = ev => setProfilePhotoPreview(ev.target?.result as string);
    r.readAsDataURL(blob);
    setCropOpen(false);
    setCropSrc(null);
  };

  const resolveEmployeeUploadId = async (): Promise<number | string> => {
    if (profileEmpIdNum !== null) return profileEmpIdNum;
    if (authUser?.employee_id && authUser?.employee_code === profileEmpCode) return authUser.employee_id;

    const res = await api.get('/employees', { params: { search: profileEmpCode } });
    const rows = Array.isArray(res.data) ? res.data : [];
    const match = rows.find((row: any) => String(row.emp_code || row.id) === profileEmpCode) || rows[0];
    if (!match?.id) throw new Error('Could not resolve employee record for photo upload.');
    return match.id;
  };

  const handleSaveProfilePhoto = async () => {
    if (!profilePhotoFile) return;
    setSavingPhoto(true);
    try {
      const uploadEmployeeId = await resolveEmployeeUploadId();
      const fd = new FormData();
      fd.append('document_key', 'photo');
      fd.append('file', profilePhotoFile);
      const res = await api.post(`/employees/${encodeURIComponent(String(uploadEmployeeId))}/documents`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const nextUrl = res?.data?.document?.url;
      setProfilePhotoPreview(nextUrl ? resolveFileUrl(nextUrl) : profilePhotoPreview);
      // Mirror the new URL into empDetail so the avatar source stays in
      // sync without waiting for the next /employees/{id} refetch.
      if (nextUrl) {
        setEmpDetail((prev: any) => prev ? { ...prev, photo_url: nextUrl } : prev);
      }
      setProfilePhotoFile(null);
      // If the user is editing their OWN profile, re-fetch /me so the
      // header avatar (ProfileDropdown reads user.employee_profile_photo)
      // and any other auth-derived avatars pick up the new photo without
      // a hard refresh. Scoped check — HR admins editing someone else's
      // photo shouldn't trigger their own /me re-fetch.
      const editingSelf = !!authUser?.employee_id && (
        (profileEmpIdNum !== null && Number(authUser.employee_id) === profileEmpIdNum)
        || (!!authUser?.employee_code && authUser.employee_code === profileEmpCode)
      );
      if (editingSelf) {
        // Fire-and-forget — the toast doesn't depend on refresh succeeding,
        // and a failed /me shouldn't block the user's upload confirmation.
        refreshAuth().catch(() => {});
      }
      toast.success('Photo updated', 'Profile picture has been changed.');
    } catch (err: any) {
      toast.error('Upload failed', err?.response?.data?.message || err?.message || 'Could not update photo');
    } finally {
      setSavingPhoto(false);
    }
  };

  const profilePhotoSrc =
    profilePhotoPreview
    || (empDetail?.photo_url ? resolveFileUrl(empDetail.photo_url) : null)
    || (employee?.photoUrl   ? resolveFileUrl(employee.photoUrl)   : null);
  // "Is this the current user's own profile?" — first try numeric id match,
  // fall back to the linked Employee.id. We don't have the current user's
  // emp_code in /me, so when the URL is a code we trust the backend's later
  // claims API to scope correctly and just compare against the API rows'
  // employee_id once they load.
  const [apiClaims, setApiClaims] = useState<ApiClaim[]>([]);
  const [teamClaims, setTeamClaims] = useState<ApiClaim[]>([]);
  // Three signals that the profile being viewed belongs to the logged-in user.
  // Any one is enough: numeric id match, EMP-code match, or one of the loaded
  // "mine"-scope claims belongs to the auth user (catches edge cases where
  // /me's employee_code wasn't set yet but the API resolved correctly).
  const isOwnProfile = !!authUser?.employee_id
    && (
      (profileEmpIdNum !== null && Number(authUser.employee_id) === profileEmpIdNum)
      || (!!authUser?.employee_code && authUser.employee_code === profileEmpCode)
      || apiClaims.some(c => c.employee_id === authUser.employee_id)
    );

  // Detect whether the *profile owner* manages anyone — drives visibility
  // of the Hiring Requests tab. Hits /my-team/employees which, for an
  // employee user_type, returns rows where reporting_manager_id matches
  // their Employee.id. We only run the probe on the user's own profile
  // since the endpoint is auth-context-scoped (it always reflects the
  // logged-in user, not the profile being viewed).
  useEffect(() => {
    if (!isOwnProfile) {
      setIsManager(false);
      setTeamSize(0);
      return;
    }
    let cancelled = false;
    api.get('/my-team/employees')
      .then((res: any) => {
        if (cancelled) return;
        const list = Array.isArray(res?.data?.employees) ? res.data.employees : [];
        setTeamSize(list.length);
        setIsManager(list.length > 0);
      })
      .catch(() => {
        if (!cancelled) { setIsManager(false); setTeamSize(0); }
      });
    return () => { cancelled = true; };
  }, [isOwnProfile]);

  // Hiring Requests list — fetched lazily when the manager opens the tab
  // (or when a new request is submitted, signalled by hiringRefreshKey).
  // We filter client-side to entries this employee filed so the inline
  // KPI/list view shows just their own pipeline, even though the API
  // returns every request visible in their tenant scope.
  useEffect(() => {
    if (tab !== 'hiring') return;
    // Fetch when the user has access to the tab — either as a manager
    // (own raised requests) or as an admin-tier viewer (all org rows).
    const seesAll = ['branch_user', 'client_admin', 'super_admin']
      .includes(String(authUser?.user_type || ''));
    if (!isManager && !seesAll) return;
    let cancelled = false;
    setHiringLoading(true);
    // Pull hiring requests AND the recruitment list in parallel so the
    // table can show "Recruitment Created" once HR converts a request
    // into a recruitment row (hiring_request_id back-pointer). Mirrors
    // the cross-reference HiringRequestsListModal builds for its tabs.
    Promise.all([
      api.get('/hiring-requests'),
      api.get('/recruitments').catch(() => ({ data: [] })),
    ])
      .then(([reqRes, recRes]: any[]) => {
        if (cancelled) return;
        const rows: any[] = Array.isArray(reqRes.data) ? reqRes.data : [];
        // Visibility rules:
        //   - Reporting-manager *employee*       → only requests THEY raised.
        //   - branch_user / client_admin / super → full tenant list (they
        //                                            already have HR-wide
        //                                            visibility elsewhere).
        // The backend stores the creator id on `created_by` (not
        // `requested_by` — which is a free-text display field). Using the
        // wrong column was why freshly-raised requests didn't appear in
        // the manager's own list.
        const myUserId = authUser?.id;
        const visible = seesAll
          ? rows
          : (myUserId ? rows.filter(r => Number(r.created_by) === Number(myUserId)) : rows);
        // Annotate each row with `_hasRecruitment` so the table can render
        // a "Recruitment Created" pill that supersedes the raw status.
        const recs: any[] = Array.isArray(recRes.data) ? recRes.data : [];
        const linkedHrIds = new Set<number>();
        for (const r of recs) {
          const id = Number(r?.hiring_request_id);
          if (id) linkedHrIds.add(id);
        }
        setHiringRequests(visible.map((r: any) => ({
          ...r,
          _hasRecruitment: linkedHrIds.has(Number(r.id)),
        })));
      })
      .catch(() => { if (!cancelled) setHiringRequests([]); })
      .finally(() => { if (!cancelled) setHiringLoading(false); });
    return () => { cancelled = true; };
  }, [tab, isManager, hiringRefreshKey, authUser?.id, authUser?.user_type]);
  const [loadingClaims, setLoadingClaims] = useState(false);
  const [expenseSubTab, setExpenseSubTab] = useState<'mine' | 'team'>('mine');
  // Fetch (or re-fetch) both lists. `mine` is filtered by employee_id so HR /
  // super-admin viewing someone else's profile sees that employee's claims.
  // `team` is only meaningful for the current user — backend scopes it to
  // claims where manager_id = the current user's Employee.id.
  const refreshClaims = async () => {
    if (tab !== 'expense' || !profileEmpCode) return;
    setLoadingClaims(true);
    try {
      // Pass both forms — the backend accepts whichever resolves first.
      const mineRes = await api.get('/expense-claims', {
        params: {
          scope: 'mine',
          ...(profileEmpIdNum !== null
            ? { employee_id: profileEmpIdNum }
            : { employee_code: profileEmpCode }),
        },
      });
      setApiClaims(Array.isArray(mineRes.data) ? mineRes.data : []);
      // Always fetch team claims for the current user — the strip only renders
      // when the result is non-empty AND this is their own profile.
      const teamRes = await api.get('/expense-claims', { params: { scope: 'team' } });
      setTeamClaims(Array.isArray(teamRes.data) ? teamRes.data : []);
    } catch {
      setApiClaims([]);
      setTeamClaims([]);
    } finally {
      setLoadingClaims(false);
    }
  };
  // Re-fetch whenever the tab switches to expense, the profile changes, or
  // ownership changes (e.g. /me re-resolves and we now know the employee_id).
  useEffect(() => {
    refreshClaims();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, profileEmpIdNum, isOwnProfile]);

  // ── Advance Requests — same shape as the expense-claim lists above.
  // `apiAdvances` = the profile owner's advances (mine scope, optionally
  // filtered to a specific employee). `teamAdvances` = pending requests
  // routed to the current user as the assigned reporting manager.
  const [apiAdvances, setApiAdvances]   = useState<AdvanceRequestRow[]>([]);
  const [teamAdvances, setTeamAdvances] = useState<AdvanceRequestRow[]>([]);
  const [loadingAdvances, setLoadingAdvances] = useState(false);
  // Top-level switcher: 'expense' (default) or 'advance'. The two surfaces
  // share the Expense Details tab so HR / employee can flip between
  // expense-claim and advance-request rows without leaving the page.
  const [expenseModuleTab, setExpenseModuleTab] = useState<'expense' | 'advance'>('expense');
  // Mine / Team sub-pill — same semantics as the expense version. When the
  // user is viewing their own profile and is also a reporting manager,
  // they can switch between their own advances and pending team requests.
  const [advanceSubTab, setAdvanceSubTab] = useState<'mine' | 'team'>('mine');

  const refreshAdvances = async () => {
    if (tab !== 'expense' || !profileEmpCode) return;
    setLoadingAdvances(true);
    try {
      const mineRes = await api.get('/advance-requests', {
        params: {
          scope: 'mine',
          ...(profileEmpIdNum !== null
            ? { employee_id: profileEmpIdNum }
            : { employee_code: profileEmpCode }),
        },
      });
      setApiAdvances(Array.isArray(mineRes.data) ? mineRes.data : []);
      const teamRes = await api.get('/advance-requests', { params: { scope: 'team' } });
      setTeamAdvances(Array.isArray(teamRes.data) ? teamRes.data : []);
    } catch {
      setApiAdvances([]);
      setTeamAdvances([]);
    } finally {
      setLoadingAdvances(false);
    }
  };
  useEffect(() => {
    refreshAdvances();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, profileEmpIdNum, isOwnProfile]);

  /** Dispatcher for inline Approve / Reject buttons on advance-request
   *  rows. Same shape as `actOnClaim`, just a different REST collection. */
  const actOnAdvance = async (
    advanceId: number,
    action: 'manager-approve' | 'manager-reject' | 'hr-approve' | 'hr-reject',
    comment?: string,
  ) => {
    try {
      await api.post(`/advance-requests/${advanceId}/${action}`, comment ? { comment } : {});
      toast.success('Updated', 'Advance request status updated');
      await refreshAdvances();
    } catch (err: any) {
      const msg = err?.response?.data?.message || 'Action failed.';
      toast.error('Action failed', msg);
    }
  };

  // POST every draft as multipart/form-data so the optional attachments[]
  // upload alongside. On success, clear drafts, close modal, refresh list.
  //
  // `claimSubmitting` is a re-entrancy guard — a fast double-click on the
  // Submit button used to fire the loop twice in parallel, creating two
  // copies of every draft. The flag flips immediately, the button is
  // disabled while it's true, and try/finally guarantees we always clear
  // it (success, failure, or the user closing the modal mid-flight).
  const [claimSubmitting, setClaimSubmitting] = useState(false);
  const submitAllDrafts = async () => {
    if (claimSubmitting) return;
    // Per-draft validation — block submit when ANY draft is missing a
    // required field OR exceeds its category's monthly budget. Used to
    // silently close the modal on an empty form, which the user reported
    // as "form brings us back to profile view".
    //
    // We populate two things in parallel:
    //   - `errors` (toast summary, capped at 3 messages)
    //   - `firstFieldErrors` for the ACTIVE draft, mapped to the input
    //     keys (title / amount / date / category / purpose) so the form
    //     paints red borders + inline messages exactly like the candidate
    //     form does. Other drafts' errors aren't shown inline (they're
    //     not currently visible), but the toast still names them.
    const errors: string[] = [];
    const firstFieldErrors: Record<string, string> = {};
    claimDrafts.forEach((d, idx) => {
      const label = `Claim ${idx + 1}`;
      const title = d.title.trim();
      const amt   = Number(String(d.amount).replace(/[^\d.]/g, ''));
      const draftErrs: Record<string, string> = {};
      if (!title) {
        draftErrs.title = 'Expense title is required';
        errors.push(`${label}: Expense title is required`);
      }
      if (!d.amount.trim() || !Number.isFinite(amt) || amt <= 0) {
        draftErrs.amount = 'Amount must be greater than 0';
        errors.push(`${label}: Amount must be greater than 0`);
      }
      if (!d.date) {
        draftErrs.date = 'Expense date is required';
        errors.push(`${label}: Expense date is required`);
      }
      if (!d.category) {
        draftErrs.category = 'Category is required';
        errors.push(`${label}: Category is required`);
      }
      if (!d.purpose.trim()) {
        draftErrs.purpose = 'Business purpose is required';
        errors.push(`${label}: Business purpose is required`);
      }
      // Budget cap — categoryById carries the monthly_limit configured in
      // Master > Expense Categories. We treat it as a hard ceiling per
      // claim: any single claim that already exceeds the monthly cap is
      // an obvious error and the server would reject it after manager
      // approval anyway, so block it now.
      const cat = categoryById(d.category);
      if (cat?.monthly_limit && Number.isFinite(amt) && amt > cat.monthly_limit) {
        draftErrs.amount = `Exceeds the "${cat.name}" monthly budget of ₹${cat.monthly_limit.toLocaleString()}`;
        errors.push(`${label}: Amount ₹${amt.toLocaleString()} exceeds the "${cat.name}" monthly budget of ₹${cat.monthly_limit.toLocaleString()}.`);
      }
      if (idx === activeClaimIdx) Object.assign(firstFieldErrors, draftErrs);
    });
    if (errors.length > 0) {
      setClaimErrors(firstFieldErrors);
      toast.error('Fix the highlighted issues', errors.slice(0, 3).join('. '));
      return;
    }
    const valid = claimDrafts.filter(d => d.title.trim() && d.amount.trim());
    if (valid.length === 0) {
      toast.warning('Nothing to submit', 'Add at least one expense before submitting.');
      return;
    }
    setClaimSubmitting(true);
    try {
      for (const d of valid) {
        const fd = new FormData();
        fd.append('title', d.title.trim());
        fd.append('amount', String(Number(String(d.amount).replace(/[^\d.]/g, '')) || 0));
        fd.append('expense_date', d.date);
        if (d.category)       fd.append('category_id', d.category);
        if (d.currency)       fd.append('currency', d.currency);
        if (d.project)        fd.append('project', d.project);
        if (d.payment)        fd.append('payment_method', d.payment);
        if (d.vendor)         fd.append('vendor', d.vendor);
        if (d.purpose)        fd.append('purpose', d.purpose);
        // Always file under the profile we're viewing. The backend resolves
        // either employee_id (numeric) or employee_code (EMP- string), and
        // falls back to the current user's linked Employee row if neither is
        // present. Backend also enforces "non-super-admin can only file under
        // their own employee record".
        if (profileEmpIdNum !== null) {
          fd.append('employee_id', String(profileEmpIdNum));
        } else if (profileEmpCode) {
          fd.append('employee_code', profileEmpCode);
        }
        // Use THIS draft's own attachments — earlier the loop reused the
        // active-draft's files for every claim, so every backend row got
        // an identical copy of whichever attachment list was showing.
        for (const f of (d.files || [])) fd.append('files[]', f);
        await api.post('/expense-claims', fd, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
      }
      toast.success('Claim submitted', `${valid.length} claim${valid.length > 1 ? 's' : ''} sent for approval`);
      // If this submission resumed a parked draft entry, drop only that
      // one from storage. Other parked drafts are preserved. Fresh
      // submissions leave storage untouched.
      if (editingDraftId) {
        try {
          const next = expenseDrafts.filter(e => e.id !== editingDraftId);
          if (next.length) localStorage.setItem(claimDraftKey, JSON.stringify(next));
          else             localStorage.removeItem(claimDraftKey);
        } catch { /* ignore */ }
      }
      setEditingDraftId(null);
      setClaimOpen(false);
      await refreshClaims();
    } catch (err: any) {
      // Pick the most useful message out of the response:
      //   1. 422 field errors (Laravel validator) — pull the first one
      //   2. Top-level `message` (controller's abort/exception)
      //   3. Raw status — special-case 500 with a hint, because the most
      //      common cause is an amount that overflowed the decimal(18,2)
      //      column and we already cap the input now but legacy payloads
      //      can still hit it.
      const fieldErrors = err?.response?.data?.errors;
      let msg = '';
      if (fieldErrors && typeof fieldErrors === 'object') {
        const first = Object.values(fieldErrors)[0];
        msg = Array.isArray(first) ? String(first[0]) : String(first);
      }
      if (!msg) msg = err?.response?.data?.message || '';
      const status = err?.response?.status;
      if (!msg) {
        msg = status === 500
          ? 'The server rejected the claim. Check that the amount fits within 12 digits and try again.'
          : status === 413
            ? 'One or more receipts are too large to upload. Trim attachments and retry.'
            : 'Could not submit the claim. Please try again.';
      }
      toast.error('Submit failed', msg);
    } finally {
      setClaimSubmitting(false);
    }
  };
  

  // Audit-log popover state — `auditOpenId` holds the claim id whose 3-dot
  // dropdown is currently open; null = nothing open.
  const [auditOpenId, setAuditOpenId] = useState<number | null>(null);

  // Inline manager / HR actions used by the team-tab and HR pages.
  const actOnClaim = async (
    claimId: number,
    action: 'manager-approve' | 'manager-reject' | 'hr-approve' | 'hr-reject',
    comment?: string,
  ) => {
    try {
      await api.post(`/expense-claims/${claimId}/${action}`, comment ? { comment } : {});
      toast.success('Updated', 'Claim status updated');
      await refreshClaims();
    } catch (err: any) {
      const msg = err?.response?.data?.message || 'Action failed.';
      toast.error('Action failed', msg);
    }
  };

  // Live counts for the Evidence Vault hero KPIs and tab badges. Used to
  // be derived from the hardcoded VAULT_EMPLOYEE / VAULT_ORG mock arrays
  // (which never matched the actual rows shown in the body); now read
  // directly from the same `uploadedDocs` + `signedDocs` arrays the
  // tables render, so the header always agrees with the body.
  const verifiedUploadedCount = uploadedDocs.filter(d => d.status === 'verified').length;
  const pendingUploadedCount  = uploadedDocs.filter(d => d.status !== 'verified').length;
  const signedCompletedCount  = signedDocs.filter(d => String(d.status).toLowerCase() === 'completed').length;
  const employeeDocCount       = uploadedDocs.length;
  const organizationalDocCount = signedDocs.length;
  const vaultCounts = {
    total:    employeeDocCount + organizationalDocCount,
    verified: verifiedUploadedCount,
    pending:  pendingUploadedCount,
    signed:   signedCompletedCount,
  };

  const TABS: { key: TabKey; label: string; icon: string; color: string }[] = [
    { key: 'profile',    label: 'Profile Details', icon: 'ri-user-line',                color: 'linear-gradient(135deg,#6366f1,#8b5cf6)' },
    { key: 'job',        label: 'Job Details',     icon: 'ri-briefcase-line',           color: 'linear-gradient(135deg,#0ab39c,#30d5b5)' },
    { key: 'attendance', label: 'Attendance',      icon: 'ri-calendar-check-line',      color: 'linear-gradient(135deg,#299cdb,#5fc8ff)' },
    { key: 'vault',      label: 'Evidence Vault',  icon: 'ri-folder-shield-2-line',     color: 'linear-gradient(135deg,#a855f7,#c084fc)' },
    { key: 'payroll',    label: 'Payroll Details', icon: 'ri-money-dollar-circle-line', color: 'linear-gradient(135deg,#f59e0b,#fbbf24)' },
    { key: 'expense',    label: 'Expense Details', icon: 'ri-wallet-3-line',            color: 'linear-gradient(135deg,#f06548,#ff7a5c)' },
    { key: 'apply_leave',label: 'Leave',           icon: 'ri-calendar-2-line',          color: 'linear-gradient(135deg,#7c5cfc,#5a3fd1)' },
    // Hiring Requests — visible when the profile owner is also the
    // viewer AND they either (a) manage at least one direct report
    // (employee-as-manager) or (b) have org-wide HR visibility
    // (branch_user / client_admin / super_admin). The list view inside
    // applies the matching visibility filter — own-raised for managers,
    // tenant-wide for the admin tiers — so each role lands on data
    // they're meant to see.
    ...(isOwnProfile && (isManager || ['branch_user', 'client_admin', 'super_admin'].includes(String(authUser?.user_type || ''))) ? [{
      key: 'hiring' as TabKey, label: 'Hiring Requests', icon: 'ri-user-add-line',
      color: 'linear-gradient(135deg,#0ea5e9,#6366f1)',
    }] : []),
  ];

  // Onboarding progress as a numeric percent for the hero ring chart.
  const onboardingPct =
      employee?.onboarding === 'Completed'   ? 100
    : employee?.onboarding === 'In Progress' ? 65
    : employee?.onboarding === 'Pending'     ? 25
    :                                          83;

  // Pre-compute counts and the filtered list from API rows. The list source
  // depends on the active sub-tab: "mine" → claims this employee raised,
  // "team" → claims where the current user is the assigned reporting manager.
  const activeClaimsSource: ApiClaim[] =
    expenseSubTab === 'team' ? teamClaims : apiClaims;
  const expenseCounts = {
    all:      activeClaimsSource.length,
    approved: activeClaimsSource.filter(c => c.status === 'approved').length,
    rejected: activeClaimsSource.filter(c => c.status === 'rejected').length,
    pending:  activeClaimsSource.filter(c => c.status === 'pending').length,
  };
  const totalClaimed = activeClaimsSource.reduce((sum, c) => sum + Number(c.amount || 0), 0);
  const filteredExpenses: ApiClaim[] = expenseFilter === 'all'
    ? activeClaimsSource
    : activeClaimsSource.filter(c => c.status === expenseFilter);

  // Mirror counts/filtering for the Advance Requests tab so the same set
  // of filter pills (All/Approved/Rejected/Pending) drives the advance
  // table. `activeAdvancesSource` follows the My/Team sub-tab selection
  // the same way `activeClaimsSource` does for expenses.
  const activeAdvancesSource: AdvanceRequestRow[] =
    advanceSubTab === 'team' ? teamAdvances : apiAdvances;
  const advanceCounts = {
    all:      activeAdvancesSource.length,
    approved: activeAdvancesSource.filter(a => a.status === 'approved').length,
    rejected: activeAdvancesSource.filter(a => a.status === 'rejected').length,
    pending:  activeAdvancesSource.filter(a => a.status === 'pending').length,
  };
  const filteredAdvances: AdvanceRequestRow[] = expenseFilter === 'all'
    ? activeAdvancesSource
    : activeAdvancesSource.filter(a => a.status === expenseFilter);

  // Snap back to the All view when the user is sitting on the Drafts pill
  // but their saved draft for the active module just got submitted /
  // discarded — otherwise they'd be stuck on a "No saved drafts" empty
  // state with no obvious way out.
  useEffect(() => {
    if (expenseFilter !== 'draft') return;
    const hasDraft = expenseModuleTab === 'advance'
      ? advanceDrafts.length > 0
      : expenseDrafts.length > 0;
    if (!hasDraft) setExpenseFilter('all');
  }, [expenseFilter, expenseModuleTab, expenseDrafts, advanceDrafts]);

  // Inline component — renders the saved-draft list (one card per saved
  // expense draft line item, one card per advance draft) with Resume +
  // Discard. Defined inside the closure so it can reuse ClaimDraft typing
  // and the parent's category-name lookup without a giant prop signature.
  const fmtSavedAt = (iso: string | null): string => {
    if (!iso) return 'Saved earlier';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return 'Saved earlier';
    const diffMs = Date.now() - d.getTime();
    const min = Math.round(diffMs / 60000);
    if (min < 1)   return 'Saved just now';
    if (min < 60)  return `Saved ${min}m ago`;
    const hrs = Math.round(min / 60);
    if (hrs < 24)  return `Saved ${hrs}h ago`;
    const days = Math.round(hrs / 24);
    if (days < 30) return `Saved ${days}d ago`;
    return `Saved ${d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}`;
  };
  const DraftListView = ({
    module,
    expenseEntries,
    advanceEntries,
    onResume,
    onDiscard,
  }: {
    module: 'expense' | 'advance';
    expenseEntries: ExpenseDraftEntry[];
    advanceEntries: AdvanceDraftEntry[];
    onResume: (draftId: string) => void;
    onDiscard: (draftId: string) => void;
  }) => {
    const isAdvance = module === 'advance';
    const entries = isAdvance ? advanceEntries : expenseEntries;
    if (entries.length === 0) {
      return (
        <div className="border rounded p-4 text-center" style={{ background: 'var(--vz-card-bg)' }}>
          <i className="ri-draft-line" style={{ fontSize: 32, color: 'var(--vz-secondary-color)', display: 'block', marginBottom: 8 }} />
          <div className="fw-semibold" style={{ fontSize: 13 }}>No saved drafts</div>
          <small className="text-muted" style={{ fontSize: 11.5 }}>
            Saved drafts appear here so you can finish them later — they're stored locally on this device only.
          </small>
        </div>
      );
    }
    const cards: React.ReactNode[] = [];
    if (isAdvance) {
      // One card per saved advance draft. Each card carries its own
      // Resume / Discard, keyed by the entry's id so multiple parked
      // drafts can be edited/dropped independently.
      advanceEntries.forEach(entry => {
        const d = entry.data || {};
        cards.push(
          <div key={entry.id} className="border rounded p-3 mb-2" style={{ background: 'var(--vz-card-bg)' }}>
            <div className="d-flex align-items-start justify-content-between gap-3 flex-wrap">
              <div className="d-flex align-items-start gap-2 min-w-0" style={{ flex: '1 1 280px' }}>
                <span className="d-inline-flex align-items-center justify-content-center rounded-3 flex-shrink-0"
                  style={{ width: 36, height: 36, background: 'rgba(67,56,202,0.12)', color: '#4338ca', fontSize: 16 }}>
                  <i className="ri-money-dollar-circle-line" />
                </span>
                <div className="min-w-0">
                  <div className="d-flex align-items-center gap-2 flex-wrap">
                    <strong style={{ fontSize: 13 }}>
                      {d.advType || 'Advance Request'}{d.advTypeOther ? ` · ${d.advTypeOther}` : ''}
                    </strong>
                    <span className="badge rounded-pill" style={{ background: 'rgba(14,165,233,0.16)', color: '#0369a1', fontSize: 10 }}>
                      DRAFT
                    </span>
                  </div>
                  <div className="text-muted mt-1" style={{ fontSize: 11.5 }}>
                    {d.advAmount ? <>₹{Number(String(d.advAmount).replace(/[^\d.]/g, '') || 0).toLocaleString('en-IN')}</> : '—'}
                    {d.advRequestedDate && <> · Requested {d.advRequestedDate}</>}
                    {d.advRecoveryStart && <> · Recovery {d.advRecoveryStart}</>}
                    {d.advRecoveryMode && <> · {d.advRecoveryMode.toUpperCase()}</>}
                  </div>
                  {d.advReason && (
                    <div className="text-muted mt-1" style={{ fontSize: 11.5, fontStyle: 'italic' }} title={d.advReason}>
                      <i className="ri-double-quotes-l me-1" />
                      {String(d.advReason).length > 100 ? String(d.advReason).slice(0, 100) + '…' : d.advReason}
                    </div>
                  )}
                  <small className="text-muted d-inline-flex align-items-center gap-1 mt-1" style={{ fontSize: 10.5 }}>
                    <i className="ri-time-line" /> {fmtSavedAt(entry.savedAt)}
                  </small>
                </div>
              </div>
              <div className="d-flex gap-2 flex-shrink-0">
                <button type="button" className="btn btn-sm" onClick={() => onResume(entry.id)}
                  style={{ background: 'linear-gradient(135deg,#0ea5e9,#0284c7)', color: '#fff', fontSize: 11.5, fontWeight: 600, padding: '5px 12px' }}>
                  <i className="ri-arrow-go-forward-line me-1" /> Resume
                </button>
                <button type="button" className="btn btn-sm btn-outline-danger" onClick={() => onDiscard(entry.id)}
                  style={{ fontSize: 11.5, fontWeight: 600, padding: '5px 12px' }}>
                  <i className="ri-delete-bin-line me-1" /> Discard
                </button>
              </div>
            </div>
          </div>
        );
      });
    } else {
      // One card per saved expense draft entry. Each entry can hold one
      // or more line items (the "Save & Add Another" stack inside the
      // modal), so the summary surfaces the first line item plus a
      // count badge when the entry holds more than one.
      expenseEntries.forEach(entry => {
        const head = entry.drafts[0] ?? null;
        if (!head) return;
        const catName = (() => {
          const found = claimCategories.find(c => String(c.id) === String(head.category));
          return found?.name || (head.category ? `Cat #${head.category}` : '—');
        })();
        const lineCount = entry.drafts.length;
        cards.push(
          <div key={entry.id} className="border rounded p-3 mb-2" style={{ background: 'var(--vz-card-bg)' }}>
            <div className="d-flex align-items-start justify-content-between gap-3 flex-wrap">
              <div className="d-flex align-items-start gap-2 min-w-0" style={{ flex: '1 1 280px' }}>
                <span className="d-inline-flex align-items-center justify-content-center rounded-3 flex-shrink-0"
                  style={{ width: 36, height: 36, background: 'rgba(124,58,237,0.12)', color: '#7c3aed', fontSize: 16 }}>
                  <i className="ri-file-list-3-line" />
                </span>
                <div className="min-w-0">
                  <div className="d-flex align-items-center gap-2 flex-wrap">
                    <strong style={{ fontSize: 13 }}>
                      {head.title || 'Untitled claim'}
                    </strong>
                    <span className="badge rounded-pill" style={{ background: 'rgba(14,165,233,0.16)', color: '#0369a1', fontSize: 10 }}>
                      DRAFT{lineCount > 1 ? ` · ${lineCount} lines` : ''}
                    </span>
                  </div>
                  <div className="text-muted mt-1" style={{ fontSize: 11.5 }}>
                    {head.amount ? <>₹{Number(String(head.amount).replace(/[^\d.]/g, '') || 0).toLocaleString('en-IN')}</> : '—'}
                    {catName && catName !== '—' && <> · {catName}</>}
                    {head.date && <> · {head.date}</>}
                    {head.vendor && <> · {head.vendor}</>}
                  </div>
                  {head.purpose && (
                    <div className="text-muted mt-1" style={{ fontSize: 11.5, fontStyle: 'italic' }} title={head.purpose}>
                      <i className="ri-double-quotes-l me-1" />
                      {head.purpose.length > 100 ? head.purpose.slice(0, 100) + '…' : head.purpose}
                    </div>
                  )}
                  <small className="text-muted d-inline-flex align-items-center gap-1 mt-1" style={{ fontSize: 10.5 }}>
                    <i className="ri-time-line" /> {fmtSavedAt(entry.savedAt)}
                  </small>
                </div>
              </div>
              <div className="d-flex gap-2 flex-shrink-0">
                <button type="button" className="btn btn-sm" onClick={() => onResume(entry.id)}
                  style={{ background: 'linear-gradient(135deg,#0ea5e9,#0284c7)', color: '#fff', fontSize: 11.5, fontWeight: 600, padding: '5px 12px' }}>
                  <i className="ri-arrow-go-forward-line me-1" /> Resume
                </button>
                <button type="button" className="btn btn-sm btn-outline-danger" onClick={() => onDiscard(entry.id)}
                  style={{ fontSize: 11.5, fontWeight: 600, padding: '5px 12px' }}>
                  <i className="ri-delete-bin-line me-1" /> Discard
                </button>
              </div>
            </div>
          </div>
        );
      });
    }
    return (
      <div>
        <div className="d-flex align-items-center gap-2 mb-2 px-1">
          <i className="ri-information-line" style={{ color: '#0ea5e9' }} />
          <small className="text-muted" style={{ fontSize: 11.5 }}>
            Drafts are stored on this device only and aren't visible to managers/HR until you submit.
          </small>
        </div>
        {cards}
      </div>
    );
  };

  return (
    <>
    {/* Inject the shared master form theme so MasterSelect / MasterDatePicker
        used inside the modals pick up the same look as the master forms. */}
    <MasterFormStyles />
    <div className="ep-fullscreen-overlay">

      {/* ── Hero banner ── */}
      <div className="ep-hero">
        <button type="button" className="ep-close-btn" onClick={onBack} aria-label="Close">
          <i className="ri-close-line" style={{ fontSize: 20 }} />
        </button>

        <Row className="g-4 align-items-center" style={{ position: 'relative', zIndex: 2 }}>
          {/* Avatar */}
          <Col xs="auto">
            {profilePhotoSrc ? (
              <img
                src={profilePhotoSrc}
                alt={employee?.name || 'employee'}
                className="ep-avatar-square"
                style={{ objectFit: 'cover', background: '#fff' }}
              />
            ) : (
              <div className="ep-avatar-square">{initials}</div>
            )}
          </Col>

          {/* Identity */}
          <Col xs={12} md className="min-w-0">
            <div className="d-flex align-items-center gap-2 mb-1">
              <h2 className="text-white mb-0 fw-bold" style={{ fontSize: 22, lineHeight: 1.15 }}>{employee?.name || employeeId}</h2>
              <button
                type="button"
                className="btn btn-sm d-inline-flex align-items-center justify-content-center"
                style={{ width: 26, height: 26, padding: 0, background: 'rgba(255,255,255,0.10)', border: '1px solid rgba(255,255,255,0.18)', borderRadius: 7, color: '#fff', fontSize: 13 }}
                aria-label="More actions"
              >
                <i className="ri-more-2-fill" />
              </button>
            </div>
            <p className="mb-1" style={{ color: 'rgba(255,255,255,0.55)', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.06em' }}>{empDetail?.emp_code || employeeId}</p>
            <p className="mb-2" style={{ color: 'rgba(255,255,255,0.78)', fontSize: 12.5 }}>
              {/* Hero meta line — prefer the freshly-fetched empDetail
                  relations so newly-edited Department / Designation / work
                  type are reflected immediately, instead of the stale
                  navigation-state row that previously fell back to
                  hardcoded "Accounts" / "Associate Engineer" / "Full-time". */}
              {empDetail?.department?.name || employee?.department || '—'}
              <span className="mx-2" style={{ opacity: 0.5 }}>·</span>
              {empDetail?.designation?.name || employee?.designation || '—'}
              <span className="mx-2" style={{ opacity: 0.5 }}>·</span>
              {empDetail?.worker_type || empDetail?.work_type || empDetail?.time_type || '—'}
            </p>
            <div className="d-flex gap-2 flex-wrap mb-3">
              {(empDetail?.primary_role?.name || employee?.primaryRole) && (
                <span className="ep-hero-pill ep-hero-pill-blue">
                  <i className="ri-suitcase-line" /> {empDetail?.primary_role?.name || employee?.primaryRole}
                </span>
              )}
              {ancillaryList.map(r => (
                <span key={r} className="ep-hero-pill ep-hero-pill-teal">{r}</span>
              ))}
              <span className="ep-hero-pill ep-hero-pill-active">
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#22c55e' }} />
                {statusTone.label}
              </span>
            </div>
            <div className="d-flex column-gap-4 row-gap-2 flex-wrap">
              {/* Each meta cell renders a thin shimmer placeholder until
                  empDetail resolves — keeps the row from flashing "—" /
                  partial data on first render. */}
              <div className="ep-hero-meta">
                <i className="ri-mail-line" />
                <div>
                  <span className="ep-hero-meta-label">Email</span>{' '}
                  {empDetailLoading
                    ? <Shimmer height={11} width={150} style={{ background: 'rgba(255,255,255,0.18)' }} />
                    : <span className="ep-hero-meta-value">{empDetail?.email || employee?.email || '—'}</span>}
                </div>
              </div>
              <div className="ep-hero-meta">
                <i className="ri-user-line" />
                <div>
                  <span className="ep-hero-meta-label">Manager</span>{' '}
                  {empDetailLoading
                    ? <Shimmer height={11} width={120} style={{ background: 'rgba(255,255,255,0.18)' }} />
                    : <span className="ep-hero-meta-value">{(() => {
                        const m = empDetail?.reporting_manager;
                        if (!m) return employee?.manager || '—';
                        return m.display_name || [m.first_name, m.middle_name, m.last_name].filter(Boolean).join(' ') || '—';
                      })()}</span>}
                </div>
              </div>
              <div className="ep-hero-meta">
                <i className="ri-phone-line" />
                <div>
                  <span className="ep-hero-meta-label">Mobile</span>{' '}
                  {empDetailLoading
                    ? <Shimmer height={11} width={100} style={{ background: 'rgba(255,255,255,0.18)' }} />
                    : <span className="ep-hero-meta-value">{empDetail?.mobile || '—'}</span>}
                </div>
              </div>
              <div className="ep-hero-meta">
                <i className="ri-calendar-line" />
                <div>
                  <span className="ep-hero-meta-label">Joined</span>{' '}
                  {empDetailLoading
                    ? <Shimmer height={11} width={90} style={{ background: 'rgba(255,255,255,0.18)' }} />
                    : <span className="ep-hero-meta-value">{empDetail?.date_of_joining ? fmtDate(empDetail.date_of_joining) : '—'}</span>}
                </div>
              </div>
            </div>
          </Col>

          {/* Ring charts — pulled in toward the centre with auto-margin */}
          <Col xs="auto" className="ms-auto" style={{ marginRight: 80 }}>
            <div className="d-flex gap-3">
              <div>
                <div
                  className="ep-ring"
                  style={{ ['--ring-color' as any]: '#a855f7', ['--ring-pct' as any]: profilePct, ['--ring-bg' as any]: '#131c46' }}
                >
                  <div className="ep-ring-inner">
                    <div className="ep-ring-num">{profilePct}</div>
                    <div className="ep-ring-pct">%</div>
                  </div>
                </div>
                <div className="ep-ring-label">Profile</div>
              </div>
              <div>
                <div
                  className="ep-ring"
                  style={{ ['--ring-color' as any]: '#22c55e', ['--ring-pct' as any]: onboardingPct, ['--ring-bg' as any]: '#131c46' }}
                >
                  <div className="ep-ring-inner">
                    <div className="ep-ring-num">{onboardingPct}</div>
                    <div className="ep-ring-pct">%</div>
                  </div>
                </div>
                <div className="ep-ring-label">Onboarding</div>
              </div>
            </div>
          </Col>
        </Row>

        {/* Tab nav nested inside the hero card so the strip reads as part of
            the same identity surface, not a separate floating bar. */}
        <div className="ep-hero-tabs">
          <div className="ep-tabbar">
            {TABS.map(t => {
              const on = tab === t.key;
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setTab(t.key)}
                  className={`ep-tabbar-btn${on ? ' is-active' : ''}`}
                >
                  <span className="ep-tabbar-icon" style={{ background: t.color }}>
                    <i className={t.icon} />
                  </span>
                  {t.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Tab content wrapper ── */}
      <div className="ep-content-pane px-4 pt-3">

      {/* ── Tab: Profile Details ── */}
      {tab === 'profile' && (
        <>
          {/* Personal Information — full-width row of 7 identity fields */}
          <div className="ep-section-card-flat ep-section-card mb-3" style={{ borderTop: '3px solid #6366f1' }}>
  <div
    className="d-flex align-items-center gap-3 px-3 py-2"
    style={{
      borderBottom: '1px solid rgba(99,102,241,0.18)',
      background: 'linear-gradient(135deg, rgba(99,102,241,0.10) 0%, rgba(99,102,241,0.03) 60%, rgba(99,102,241,0.01) 100%)',
    }}
  >
    <span className="ep-section-icon" style={{ background: 'rgba(99,102,241,0.18)', color: '#4338ca' }}>
      <i className="ri-user-line" />
    </span>
    <h6 className="mb-0 fw-bold" style={{ fontSize: 13 }}>Personal Information</h6>
  </div>
  <div className="px-3 py-3">
    {/* Row 1 — three action tiles side by side: Profile Photo · Login
        Password · Face Biometric. Each takes 1/3 of the width on md+
        and stacks on smaller screens. Tiles are vertically aligned (no
        h-100 stretch) and use compact padding so the row stays low. */}
    <Row className="g-3 mb-3 align-items-center">
      {/* Profile Photo tile */}
      <Col md={4} sm={12}>
        <div
          className="d-flex align-items-center gap-2"
          style={{
            border: '1px dashed rgba(99,102,241,0.35)',
            borderRadius: 12,
            background: 'rgba(99,102,241,0.04)',
            padding: '8px 12px',
          }}
        >
          {profilePhotoSrc ? (
            <img
              src={profilePhotoSrc}
              alt="profile"
              className="rounded-circle flex-shrink-0"
              style={{ width: 38, height: 38, objectFit: 'cover', border: '2px solid var(--vz-card-bg)' }}
            />
          ) : (
            <div
              className="rounded-circle d-inline-flex align-items-center justify-content-center text-muted flex-shrink-0"
              style={{ width: 38, height: 38, background: 'var(--vz-secondary-bg)', border: '2px solid var(--vz-border-color)', fontSize: 16 }}
            >
              <i className="ri-user-line" />
            </div>
          )}
          <div className="min-w-0 flex-grow-1">
            <div className="fw-semibold" style={{ fontSize: 12 }}>Profile Photo</div>
            <input
              ref={profilePhotoInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={e => handleProfilePhotoChange(e.target.files?.[0] || null)}
              className="form-control form-control-sm"
              style={{ fontSize: 11, padding: '2px 6px', height: 26 }}
            />
          </div>
          {profilePhotoFile && (
            <div className="d-flex gap-1 flex-shrink-0">
              <button
                type="button"
                className="btn btn-sm btn-success"
                style={{ fontSize: 10.5, padding: '3px 8px' }}
                onClick={handleSaveProfilePhoto}
                disabled={savingPhoto}
                title="Save photo"
              >
                {savingPhoto ? <span className="spinner-border spinner-border-sm" style={{ width: 10, height: 10 }} /> : <i className="ri-save-line" />}
              </button>
              <button
                type="button"
                className="btn btn-sm btn-outline-secondary"
                style={{ fontSize: 10.5, padding: '3px 8px' }}
                onClick={() => {
                  setProfilePhotoFile(null);
                  restoreSavedProfilePhoto();
                }}
                title="Cancel"
              >
                <i className="ri-close-line" />
              </button>
            </div>
          )}
        </div>
      </Col>

      {/* Change Password tile */}
      <Col md={4} sm={12}>
        <div
          className="d-flex align-items-center gap-2"
          style={{
            border: '1px solid rgba(244,63,94,0.25)',
            borderRadius: 12,
            background: 'rgba(244,63,94,0.05)',
            padding: '8px 12px',
          }}
        >
          <span className="ep-section-icon flex-shrink-0" style={{ background: 'rgba(244,63,94,0.18)', color: '#be123c', width: 30, height: 30, fontSize: 14 }}>
            <i className="ri-shield-keyhole-line" />
          </span>
          <div className="min-w-0 flex-grow-1">
            <div className="fw-semibold" style={{ fontSize: 12 }}>Login Password</div>
            <small className="text-muted" style={{ fontSize: 10, lineHeight: 1.2 }}>Rotate regularly. Email on change.</small>
          </div>
          <Button
            color="danger"
            size="sm"
            className="d-inline-flex align-items-center gap-1 flex-shrink-0"
            style={{ fontSize: 10.5, padding: '3px 10px' }}
            onClick={() => { resetPwForm(); setPwOpen(true); }}
          >
            <i className="ri-lock-password-line" /> Change
          </Button>
        </div>
      </Col>

      {/* Face Biometric tile */}
      <Col md={4} sm={12}>
        <div
          className="d-flex align-items-center gap-2"
          style={{
            border: '1px solid rgba(99,102,241,0.25)',
            borderRadius: 12,
            background: 'rgba(99,102,241,0.05)',
            padding: '8px 12px',
          }}
        >
          <span className="ep-section-icon flex-shrink-0" style={{ background: 'rgba(99,102,241,0.18)', color: '#4338ca', width: 30, height: 30, fontSize: 14 }}>
            <i className="ri-user-smile-line" />
          </span>
          <div className="min-w-0 flex-grow-1">
            <div className="fw-semibold" style={{ fontSize: 12 }}>Face Biometric</div>
            <small className="text-muted" style={{ fontSize: 10, lineHeight: 1.2 }}>Register once to clock in.</small>
          </div>
          <Button
            color="primary"
            size="sm"
            className="d-inline-flex align-items-center gap-1 flex-shrink-0"
            style={{ fontSize: 10.5, padding: '3px 10px' }}
            onClick={() => setFaceRegOpen(true)}
          >
            <i className="ri-camera-line" /> Register
          </Button>
        </div>
      </Col>
    </Row>

    {/* Row 2 — seven identity fields in a single horizontal row on lg+.
        While empDetail is loading each value cell renders a shimmer
        placeholder so the page doesn't flash "—" before the API resolves. */}
    <Row className="g-4">
      {[
        { label: 'First Name',  value: empDetail?.first_name || (employee?.name || '').split(' ')[0] },
        { label: 'Middle Name', value: empDetail?.middle_name },
        { label: 'Last Name',   value: empDetail?.last_name || (employee?.name || '').split(' ').slice(1).join(' ') },
        { label: 'Display Name', value: empDetail?.display_name || employee?.name },
        { label: 'Date of Birth', value: fmtDate(empDetail?.date_of_birth), monospace: true },
        { label: 'Gender', value: empDetail?.gender },
        { label: 'Nationality', value: empDetail?.nationality_country?.name },
      ].map((f, i) => (
        <Col key={i} lg={3} md={4} sm={6}>
          <div className="ep-field-label">{f.label}</div>
          {empDetailLoading
            ? <Shimmer height={16} width="70%" />
            : <div className={`ep-field-value${f.monospace ? ' font-monospace' : ''}`}>{(f.value && String(f.value).trim()) ? f.value : '—'}</div>}
        </Col>
      ))}
    </Row>
  </div>
</div>

          {/* Contact Information — 4 fields */}
          <div className="ep-section-card-flat ep-section-card mb-3" style={{ borderTop: '3px solid #299cdb' }}>
            <div
              className="d-flex align-items-center gap-3 px-3 py-2"
              style={{
                borderBottom: '1px solid rgba(41,156,219,0.18)',
                background: 'linear-gradient(135deg, rgba(41,156,219,0.12) 0%, rgba(41,156,219,0.03) 60%, rgba(41,156,219,0.01) 100%)',
              }}
            >
              <span className="ep-section-icon" style={{ background: 'rgba(41,156,219,0.18)', color: '#0c63b0' }}>
                <i className="ri-phone-line" />
              </span>
              <h6 className="mb-0 fw-bold" style={{ fontSize: 13 }}>Contact Information</h6>
            </div>
            <div className="px-3 py-3">
              <Row className="g-4">
                <Col md={3}><div className="ep-field-label">Work Email</div><div className="ep-field-value">{empDetail?.email || employee?.email || '—'}</div></Col>
                <Col md={3}><div className="ep-field-label">Mobile</div><div className="ep-field-value font-monospace">{empDetail?.mobile || '—'}</div></Col>
                <Col md={3}><div className="ep-field-label">Work Country</div><div className="ep-field-value">{empDetail?.work_country?.name || '—'}</div></Col>
                <Col md={3}><div className="ep-field-label">Reporting Manager</div><div className="ep-field-value">{(() => {
                  const mgr = empDetail?.reporting_manager;
                  if (mgr) {
                    return mgr.display_name
                      || [mgr.first_name, mgr.middle_name, mgr.last_name].filter(Boolean).join(' ')
                      || '—';
                  }
                  return employee?.manager || '—';
                })()}</div></Col>
              </Row>
            </div>
          </div>

          {/* Address Details — Current + Permanent side-by-side. Gradient
              tint is restricted to the header strip; the body sits on plain
              white so the field rows stay readable. */}
          <div className="ep-section-card-flat ep-section-card mb-3" style={{ borderTop: '3px solid #0ab39c' }}>
            <div
              className="d-flex align-items-center gap-3 px-3 py-2"
              style={{
                borderBottom: '1px solid rgba(10,179,156,0.18)',
                background: 'linear-gradient(135deg, rgba(10,179,156,0.12) 0%, rgba(10,179,156,0.04) 60%, rgba(10,179,156,0.01) 100%)',
              }}
            >
              <span className="ep-section-icon" style={{ background: 'rgba(10,179,156,0.18)', color: '#0a8a78' }}>
                <i className="ri-map-pin-line" />
              </span>
              <h6 className="mb-0 fw-bold" style={{ fontSize: 13 }}>Address Details</h6>
            </div>
            <div className="px-3 py-3">
              <Row className="g-4">
                <Col md={6}>
                  <div className="ep-addr-marker" style={{ color: '#0ab39c' }}>
                    <span className="dot" style={{ background: '#0ab39c' }} /> Current Address
                  </div>
                  <Row className="g-3">
                    <Col><div className="ep-field-label">Address</div><div className="ep-field-value">{[empDetail?.address_line1, empDetail?.address_line2].filter(Boolean).join(', ') || '—'}</div></Col>
                    <Col><div className="ep-field-label">City</div><div className="ep-field-value">{empDetail?.city || '—'}</div></Col>
                    <Col><div className="ep-field-label">State</div><div className="ep-field-value">{empDetail?.state?.name || '—'}</div></Col>
                    <Col><div className="ep-field-label">Country</div><div className="ep-field-value">{empDetail?.country?.name || '—'}</div></Col>
                    <Col><div className="ep-field-label">Pincode</div><div className="ep-field-value font-monospace">{empDetail?.pincode || '—'}</div></Col>
                  </Row>
                </Col>
                <Col md={6}>
                  <div className="ep-addr-marker" style={{ color: '#0ab39c' }}>
                    <span className="dot" style={{ background: '#0ab39c' }} /> Permanent Address
                  </div>
                  <Row className="g-3">
                    <Col><div className="ep-field-label">Address</div><div className="ep-field-value">{[empDetail?.perm_address_line1, empDetail?.perm_address_line2].filter(Boolean).join(', ') || '—'}</div></Col>
                    <Col><div className="ep-field-label">City</div><div className="ep-field-value">{empDetail?.perm_city || '—'}</div></Col>
                    <Col><div className="ep-field-label">State</div><div className="ep-field-value">{empDetail?.perm_state?.name || '—'}</div></Col>
                    <Col><div className="ep-field-label">Country</div><div className="ep-field-value">{empDetail?.perm_country?.name || '—'}</div></Col>
                    <Col><div className="ep-field-label">Pincode</div><div className="ep-field-value font-monospace">{empDetail?.perm_pincode || '—'}</div></Col>
                  </Row>
                </Col>
              </Row>
            </div>
          </div>

          {/* Bottom row: Work Experience | Profile Completion | KYC Documents */}
          <Row className="g-3 mb-3 align-items-stretch">
            <Col xl={4}>
              <div className="ep-section-card-flat ep-section-card h-100 d-flex flex-column" style={{ borderTop: '3px solid #f59e0b' }}>
                <div
                  className="d-flex align-items-center gap-3 px-3 py-2"
                  style={{
                    borderBottom: '1px solid rgba(245,158,11,0.18)',
                    background: 'linear-gradient(135deg, rgba(245,158,11,0.14) 0%, rgba(245,158,11,0.04) 60%, rgba(245,158,11,0.01) 100%)',
                  }}
                >
                  <span className="ep-section-icon" style={{ background: 'rgba(245,158,11,0.18)', color: '#a16207' }}>
                    <i className="ri-briefcase-line" />
                  </span>
                  <h6 className="mb-0 fw-bold" style={{ fontSize: 13 }}>Work Experience</h6>
                </div>
                <div className="px-3 py-3 flex-grow-1">
                  {/* REAL work experience (was hardcoded sample data). Sourced
                      from the employee's previous_employments + the
                      has_prior_experience flag — shows "Fresher" / "Not
                      Provided" when no experience was entered. */}
                  {(() => {
                    const prev: any[] = Array.isArray(empDetail?.previous_employments) ? empDetail.previous_employments : [];
                    const hasExp = empDetail?.has_prior_experience === true || prev.length > 0;
                    let months = 0;
                    prev.forEach((p) => {
                      if (!p?.start_date) return;
                      const s = new Date(p.start_date);
                      const e = p.end_date ? new Date(p.end_date) : new Date();
                      if (!Number.isNaN(s.getTime()) && !Number.isNaN(e.getTime()) && e >= s) {
                        months += (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth());
                      }
                    });
                    const totalExp = months > 0 ? `${Math.floor(months / 12)} yrs ${months % 12} mos` : (hasExp ? '—' : 'Fresher');
                    const last = prev[0] || null;
                    const notProvided = <span className="text-muted fst-italic">Not Provided</span>;
                    return (
                      <Row className="g-3">
                        <Col xs={6}>
                          <div className="ep-field-label">Status</div>
                          <div className="ep-field-value">{hasExp ? 'Experienced' : 'Fresher'}</div>
                        </Col>
                        <Col xs={6}>
                          <div className="ep-field-label">Total Experience</div>
                          <div className="ep-field-value">{totalExp}</div>
                        </Col>
                        <Col xs={6}>
                          <div className="ep-field-label">Last Company</div>
                          <div className="ep-field-value">{last?.company_name || notProvided}</div>
                        </Col>
                        <Col xs={6}>
                          <div className="ep-field-label">Last Designation</div>
                          <div className="ep-field-value">{last?.job_title || notProvided}</div>
                        </Col>
                      </Row>
                    );
                  })()}
                </div>
              </div>
            </Col>

            <Col xl={4}>
              <div className="ep-section-card-flat ep-section-card h-100 d-flex flex-column" style={{ background: 'linear-gradient(135deg, rgba(168,85,247,0.12) 0%, rgba(99,102,241,0.06) 60%, rgba(168,85,247,0.04) 100%)', border: '1px solid rgba(168,85,247,0.18)', borderTop: '3px solid #a855f7' }}>
                <div className="px-3 pt-3 pb-2 d-flex align-items-center gap-3">
                  <div
                    className="d-inline-flex align-items-center justify-content-center"
                    style={{
                      width: 44, height: 44, borderRadius: '50%',
                      background: `conic-gradient(#a855f7 ${profilePct}%, rgba(168,85,247,0.18) 0)`,
                      flexShrink: 0,
                      position: 'relative',
                    }}
                  >
                    <span
                      style={{
                        position: 'absolute', inset: 4, borderRadius: '50%',
                        background: '#ffffff',
                        display: 'flex', alignItems: 'baseline', justifyContent: 'center',
                        fontWeight: 800, color: '#7c3aed',
                        fontSize: 12, gap: 1, paddingTop: 4,
                      }}
                    >
                      {profilePct}<span style={{ fontSize: 7.5, fontWeight: 700 }}>%</span>
                    </span>
                  </div>
                  <div className="flex-grow-1">
                    <h6 className="mb-1 fw-bold" style={{ color: '#7c3aed', fontSize: 12 }}>Profile Completion</h6>
                    <small className="text-muted" style={{ fontSize: 12 }}>
                      In Progress · {profilePct}% done
                    </small>
                  </div>
                </div>
                {/* Full-width striped progress bar with floating circular
                    badge above the fill end. Locked to the card's violet
                    theme so it reads as a continuation of the gradient
                    background instead of a separate tier-colored band. */}
                <div className="px-3 pb-2">
                  {(() => {
                    const p = profilePct;
                    const VIOLET = { dark: '#7c3aed', light: '#a855f7' };
                    const badgeLeft = Math.max(8, Math.min(92, p));
                    return (
                      <div style={{ position: 'relative', width: '100%', paddingTop: 0 }} title={`Profile ${p}% complete`}>
                        {/* Floating badge + downward pointer */}
                        <div
                          style={{
                            position: 'absolute',
                            top: -33,
                            left: `${badgeLeft}%`,
                            transform: 'translateX(-50%)',
                            textAlign: 'center',
                          }}
                        >
                          <div
                            className="d-flex align-items-center justify-content-center fw-bold"
                            style={{
                              width: 30, height: 30, borderRadius: '50%',
                              background: `linear-gradient(135deg, ${VIOLET.dark}, ${VIOLET.light})`,
                              color: '#fff', fontSize: 10.5,
                              boxShadow: `0 6px 14px ${VIOLET.dark}55, inset 0 1px 0 rgba(255,255,255,0.20)`,
                              border: '2px solid #fff',
                            }}
                          >
                            {p}%
                          </div>
                          <div
                            style={{
                              width: 0, height: 0, margin: '0 auto',
                              borderLeft: '5px solid transparent',
                              borderRight: '5px solid transparent',
                              borderTop: `6px solid ${VIOLET.dark}`,
                            }}
                          />
                        </div>

                        {/* Track + striped fill */}
                        <div
                          style={{
                            width: '100%', height: 10,
                            borderRadius: 999,
                            background: 'rgba(168,85,247,0.18)',
                            overflow: 'hidden',
                          }}
                        >
                          <div
                            style={{
                              width: `${p}%`, height: '100%',
                              borderRadius: 999,
                              background: `repeating-linear-gradient(-45deg, rgba(255,255,255,0.32) 0 6px, transparent 6px 12px), linear-gradient(90deg, ${VIOLET.dark}, ${VIOLET.light})`,
                              transition: 'width .35s ease',
                            }}
                          />
                        </div>
                      </div>
                    );
                  })()}
                </div>
                {/* 4 mini-tiles */}
                <div className="px-3 pb-3 flex-grow-1">
                  <Row className="g-2">
                    <Col xs={6}>
                      <div className="px-3 py-2" style={{ borderRadius: 10, background: 'rgba(34,197,94,0.10)', border: '1px solid rgba(34,197,94,0.25)' }}>
                        <div className="ep-field-label" style={{ color: '#108548' }}>Status</div>
                        <div className="ep-field-value d-inline-flex align-items-center gap-1" style={{ color: '#108548', fontSize: 13 }}>
                          <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#10b981' }} />
                          {employee?.enabled === false ? 'Disabled' : 'Active'}
                        </div>
                      </div>
                    </Col>
                    <Col xs={6}>
                      <div className="px-3 py-2" style={{ borderRadius: 10, background: 'rgba(99,102,241,0.10)', border: '1px solid rgba(99,102,241,0.22)' }}>
                        <div className="ep-field-label" style={{ color: '#4338ca' }}>Emp Type</div>
                        <div className="ep-field-value" style={{ color: '#4338ca', fontSize: 13 }}>Full-time</div>
                      </div>
                    </Col>
                    <Col xs={6}>
                      <div className="px-3 py-2" style={{ borderRadius: 10, background: 'rgba(245,158,11,0.10)', border: '1px solid rgba(245,158,11,0.25)' }}>
                        <div className="ep-field-label" style={{ color: '#a16207' }}>Joined</div>
                        <div className="ep-field-value font-monospace" style={{ color: '#a16207', fontSize: 13 }}>03-Nov-2023</div>
                      </div>
                    </Col>
                    <Col xs={6}>
                      <div className="px-3 py-2" style={{ borderRadius: 10, background: 'rgba(20,184,166,0.10)', border: '1px solid rgba(20,184,166,0.25)' }}>
                        <div className="ep-field-label" style={{ color: '#0a716a' }}>Department</div>
                        <div className="ep-field-value" style={{ color: '#0a716a', fontSize: 13 }}>{employee?.department || '—'}</div>
                      </div>
                    </Col>
                  </Row>
                </div>
              </div>
            </Col>

            <Col xl={4}>
              <div className="ep-section-card-flat ep-section-card h-100 d-flex flex-column" style={{ borderTop: '3px solid #6366f1' }}>
                <div
                  className="d-flex align-items-center justify-content-between gap-3 px-3 py-2"
                  style={{
                    borderBottom: '1px solid rgba(99,102,241,0.18)',
                    background: 'linear-gradient(135deg, rgba(99,102,241,0.14) 0%, rgba(99,102,241,0.04) 60%, rgba(99,102,241,0.01) 100%)',
                  }}
                >
                  <div className="d-flex align-items-center gap-3">
                    <span className="ep-section-icon" style={{ background: 'rgba(99,102,241,0.18)', color: '#4338ca' }}>
                      <i className="ri-shield-check-line" />
                    </span>
                    <h6 className="mb-0 fw-bold" style={{ fontSize: 13 }}>KYC Documents</h6>
                  </div>
                  <span className="badge rounded-pill fw-semibold px-2 py-1" style={{ background: 'rgba(99,102,241,0.16)', color: '#4338ca', fontSize: 10.5 }}>3 / 4</span>
                </div>
                <div className="px-3 py-3 flex-grow-1">
                  {[
                    { label: 'Aadhaar Card',   status: 'Uploaded' },
                    { label: 'PAN Card',       status: 'Uploaded' },
                    { label: 'Passport Photo', status: 'Uploaded' },
                    { label: 'Address Proof',  status: 'Pending'  },
                  ].map(d => {
                    const uploaded = d.status === 'Uploaded';
                    return (
                      <div key={d.label} className="d-flex align-items-center gap-2 px-2 py-1">
                        <span
                          className="d-inline-flex align-items-center justify-content-center"
                          style={{
                            width: 18, height: 18, borderRadius: 5,
                            background: uploaded ? '#3b82f6' : '#f59e0b',
                            color: '#fff', fontSize: 12,
                            flexShrink: 0,
                          }}
                        >
                          <i className={uploaded ? 'ri-check-line' : 'ri-time-line'} />
                        </span>
                        <div className="flex-grow-1" style={{ fontSize: 12.5, fontWeight: 600 }}>{d.label}</div>
                        <span
                          className="d-inline-flex align-items-center fw-semibold"
                          style={{
                            fontSize: 10, padding: '2px 9px', borderRadius: 999,
                            background: uploaded ? 'rgba(59,130,246,0.10)' : 'rgba(245,158,11,0.12)',
                            color:      uploaded ? '#1d4ed8' : '#a16207',
                            border:     `1px solid ${uploaded ? 'rgba(59,130,246,0.25)' : 'rgba(245,158,11,0.25)'}`,
                          }}
                        >
                          {d.status}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </Col>
          </Row>

        </>
      )}

      {/* ── Tab: Job Details ── */}
      {tab === 'job' && (
        <>
          {/* Employment Details — single row of 7 fields */}
          <div className="ep-section-card-flat ep-section-card mb-3" style={{ borderTop: '3px solid #6366f1' }}>
            <div
              className="d-flex align-items-center gap-3 px-3 py-2"
              style={{
                borderBottom: '1px solid rgba(99,102,241,0.18)',
                background: 'linear-gradient(135deg, rgba(99,102,241,0.14) 0%, rgba(99,102,241,0.04) 60%, rgba(99,102,241,0.01) 100%)',
              }}
            >
              <span className="ep-section-icon" style={{ background: 'rgba(99,102,241,0.18)', color: '#4338ca' }}>
                <i className="ri-briefcase-line" />
              </span>
              <h6 className="mb-0 fw-bold" style={{ fontSize: 13 }}>Employment Details</h6>
            </div>
            <div className="px-3 py-3">
              <Row className="g-4">
                <Col>
                  <div className="ep-field-label">Employee Number</div>
                  <span className=" fw-semibold" style={{ background: 'rgba(99,102,241,0.10)', color: '#4338ca', padding: '4px 12px', borderRadius: 8, fontSize: 10 }}>{empDetail?.emp_code || employeeId}</span>
                </Col>
                <Col><div className="ep-field-label">Joining Date</div><div className="ep-field-value " style={{ fontSize: 11 }}>{fmtDate(empDetail?.date_of_joining)}</div></Col>
                <Col><div className="ep-field-label">Job Title (Primary)</div><div className="ep-field-value">{empDetail?.designation?.name || employee?.designation || '—'}</div></Col>
                <Col>
                  <div className="ep-field-label">Job Title (Secondary)</div>
                  {ancillaryList.length > 0 ? (
                    <div className="d-flex flex-wrap gap-1">
                      {ancillaryList.map(r => (
                        <span
                          key={r}
                          className="d-inline-flex align-items-center fw-semibold"
                          style={{
                            fontSize: 11, padding: '2px 9px', borderRadius: 999,
                            background: 'rgba(20,184,166,0.10)', color: '#0a716a',
                            border: '1px solid rgba(20,184,166,0.25)',
                          }}
                        >
                          {r}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <div className="ep-field-value text-muted fw-normal">—</div>
                  )}
                </Col>
                <Col><div className="ep-field-label">Employment Status</div><div className="ep-field-value">{empDetail?.status || (employee?.enabled === false ? 'Disabled' : 'Active')}</div></Col>
                <Col><div className="ep-field-label">Worker Type</div><div className="ep-field-value">{empDetail?.worker_type || empDetail?.work_type || '—'}</div></Col>
                <Col><div className="ep-field-label">Time Type</div><div className="ep-field-value">{empDetail?.time_type || empDetail?.work_type || '—'}</div></Col>
              </Row>
            </div>
          </div>

          {/* Organisational Structure — 4 fields full width */}
          <div className="ep-section-card-flat ep-section-card mb-3" style={{ borderTop: '3px solid #299cdb' }}>
            <div
              className="d-flex align-items-center gap-3 px-3 py-2"
              style={{
                borderBottom: '1px solid rgba(41,156,219,0.20)',
                background: 'linear-gradient(135deg, rgba(41,156,219,0.14) 0%, rgba(41,156,219,0.04) 60%, rgba(41,156,219,0.01) 100%)',
              }}
            >
              <span className="ep-section-icon" style={{ background: 'rgba(41,156,219,0.18)', color: '#0c63b0' }}>
                <i className="ri-building-2-line" />
              </span>
              <h6 className="mb-0 fw-bold" style={{ fontSize: 12 }}>Organisational Structure</h6>
            </div>
            <div className="px-3 py-3">
              <Row className="g-4">
                <Col md={3}><div className="ep-field-label">Legal Entity</div><div className="ep-field-value">{empDetail?.legal_entity?.entity_name || '—'}</div></Col>
                <Col md={3}><div className="ep-field-label">Department</div><div className="ep-field-value">{empDetail?.department?.name || employee?.department || '—'}</div></Col>
                <Col md={3}><div className="ep-field-label">Location</div><div className="ep-field-value">{empDetail?.location || '—'}</div></Col>
                <Col md={3}>
                  <div className="ep-field-label">Reporting Manager</div>
                  <div className="ep-field-value">{(() => {
                    const m = empDetail?.reporting_manager;
                    if (!m) return employee?.manager || '—';
                    return m.display_name || [m.first_name, m.middle_name, m.last_name].filter(Boolean).join(' ') || '—';
                  })()}</div>
                </Col>
              </Row>
            </div>
          </div>

          {/* Row of 3 cards: Role & Positioning | Employment Terms | Attendance & Time */}
          <Row className="g-3 mb-3 align-items-stretch">
            <Col xl={4}>
              <div className="ep-section-card-flat ep-section-card h-100" style={{ borderTop: '3px solid #0ab39c' }}>
                <div
                  className="d-flex align-items-center gap-3 px-3 py-2"
                  style={{
                    borderBottom: '1px solid rgba(10,179,156,0.18)',
                    background: 'linear-gradient(135deg, rgba(10,179,156,0.14) 0%, rgba(10,179,156,0.04) 60%, rgba(10,179,156,0.01) 100%)',
                  }}
                >
                  <span className="ep-section-icon" style={{ background: 'rgba(10,179,156,0.18)', color: '#0a8a78' }}>
                    <i className="ri-edit-line" />
                  </span>
                  <h6 className="mb-0 fw-bold" style={{ fontSize: 12 }}>Role &amp; Positioning</h6>
                </div>
                <div className="px-3 py-3">
                  <Row className="g-4">
                    <Col xs={4}><div className="ep-field-label">Primary Role</div><div className="ep-field-value">{employee?.primaryRole || 'Executive'}</div></Col>
                    <Col xs={4}>
                      <div className="ep-field-label">Ancillary Role</div>
                      {ancillaryList.length > 0 ? (
                        <div className="d-flex flex-wrap gap-1">
                          {ancillaryList.map(r => (
                            <span
                              key={r}
                              className="d-inline-flex align-items-center fw-semibold"
                              style={{
                                fontSize: 9, padding: '2px 8px', borderRadius: 999,
                                background: 'rgba(20,184,166,0.10)', color: '#0a716a',
                                border: '1px solid rgba(20,184,166,0.25)',
                              }}
                            >
                              {r}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <div className="ep-field-value text-muted fw-normal">—</div>
                      )}
                    </Col>
                    <Col xs={4}><div className="ep-field-label">Employee Level</div><div className="ep-field-value">L3 — Mid</div></Col>
                  </Row>
                </div>
              </div>
            </Col>
            <Col xl={4}>
              <div className="ep-section-card-flat ep-section-card h-100" style={{ borderTop: '3px solid #f59e0b' }}>
                <div
                  className="d-flex align-items-center gap-3 px-3 py-2"
                  style={{
                    borderBottom: '1px solid rgba(245,158,11,0.20)',
                    background: 'linear-gradient(135deg, rgba(245,158,11,0.14) 0%, rgba(245,158,11,0.04) 60%, rgba(245,158,11,0.01) 100%)',
                  }}
                >
                  <span className="ep-section-icon" style={{ background: 'rgba(245,158,11,0.18)', color: '#a16207' }}>
                    <i className="ri-file-list-3-line" />
                  </span>
                  <h6 className="mb-0 fw-bold" style={{ fontSize: 12 }}>Employment Terms</h6>
                </div>
                <div className="px-3 py-3">
                  <Row className="g-3">
                    <Col xs={6}><div className="ep-field-label">Probation Policy</div><div className="ep-field-value">{empDetail?.probation_policy || '—'}</div></Col>
                    <Col xs={6}><div className="ep-field-label">Probation Duration</div><div className="ep-field-value">{empDetail?.probation_months ? `${empDetail.probation_months} Months` : '—'}</div></Col>
                    <Col xs={6}><div className="ep-field-label">Notice Period</div><div className="ep-field-value">{empDetail?.notice_period || (empDetail?.notice_period_days ? `${empDetail.notice_period_days} Days` : '—')}</div></Col>
                    <Col xs={6}><div className="ep-field-label">Contract Status</div><div className="ep-field-value">{empDetail?.contract_status || empDetail?.work_type || '—'}</div></Col>
                  </Row>
                </div>
              </div>
            </Col>
            <Col xl={4}>
              <div className="ep-section-card-flat ep-section-card h-100" style={{ borderTop: '3px solid #299cdb' }}>
                <div
                  className="d-flex align-items-center gap-3 px-3 py-2"
                  style={{
                    borderBottom: '1px solid rgba(41,156,219,0.20)',
                    background: 'linear-gradient(135deg, rgba(41,156,219,0.14) 0%, rgba(41,156,219,0.04) 60%, rgba(41,156,219,0.01) 100%)',
                  }}
                >
                  <span className="ep-section-icon" style={{ background: 'rgba(41,156,219,0.18)', color: '#0c63b0' }}>
                    <i className="ri-time-line" />
                  </span>
                  <h6 className="mb-0 fw-bold" style={{ fontSize: 12 }}>Attendance &amp; Time</h6>
                </div>
                <div className="px-3 py-3">
                  <Row className="g-3">
                    <Col xs={4}><div className="ep-field-label">Shift</div><div className="ep-field-value">Morning Shift</div></Col>
                    <Col xs={4}><div className="ep-field-label">Weekly Off</div><div className="ep-field-value">Sat &amp; Sun</div></Col>
                    <Col xs={4}><div className="ep-field-label">Leave Plan</div><div className="ep-field-value">Default Leave Plan</div></Col>
                    <Col xs={4}><div className="ep-field-label">Holiday Calendar</div><div className="ep-field-value">Maharashtra 2026</div></Col>
                    <Col xs={4}><div className="ep-field-label">Time Tracking</div><div className="ep-field-value">Enabled</div></Col>
                    <Col xs={4}><div className="ep-field-label">Attendance No.</div><div className="ep-field-value font-monospace">{employeeId}</div></Col>
                    <Col xs={4}><div className="ep-field-label">Penalization</div><div className="ep-field-value">Default</div></Col>
                    <Col xs={4}><div className="ep-field-label">Overtime Policy</div><div className="ep-field-value">Standard OT</div></Col>
                    <Col xs={4}><div className="ep-field-label">Shift Allowance</div><div className="ep-field-value">None</div></Col>
                  </Row>
                </div>
              </div>
            </Col>
          </Row>

          {/* Asset Details */}
          <div className="ep-section-card-flat ep-section-card mb-3" style={{ borderTop: '3px solid #f59e0b' }}>
            <div
              className="d-flex align-items-center gap-3 px-3 py-2"
              style={{
                borderBottom: '1px solid rgba(245,158,11,0.20)',
                background: 'linear-gradient(135deg, rgba(245,158,11,0.14) 0%, rgba(245,158,11,0.04) 60%, rgba(245,158,11,0.01) 100%)',
              }}
            >
              <span className="ep-section-icon" style={{ background: 'rgba(245,158,11,0.18)', color: '#a16207' }}>
                <i className="ri-computer-line" />
              </span>
              <h6 className="mb-0 fw-bold" style={{ fontSize: 12 }}>Asset Details</h6>
            </div>
            <div className="px-3 py-3">
              <Row className="g-3">
                {(() => {
                  const laptop = empDetail?.laptop_asset;
                  const mobile = empDetail?.mobile_asset;
                  // `other_assets_resolved` is an accessor on the Employee
                  // model that joins the selected master_asset rows. Falls
                  // back to the raw id array if the accessor wasn't loaded.
                  const otherAssets: Array<{ asset_name?: string; code?: string }> =
                    Array.isArray(empDetail?.other_assets_resolved)
                      ? empDetail.other_assets_resolved
                      : [];
                  const otherSummary = otherAssets.length > 0
                    ? otherAssets.map(a => a.asset_name || a.code).filter(Boolean).join(', ')
                    : '—';
                  return (
                    <>
                      <Col md={3}><div className="ep-field-label">Laptop Assigned</div><div className="ep-field-value">{empDetail?.laptop_assigned || (laptop ? 'Yes' : 'No')}</div></Col>
                      <Col md={3}>
                        <div className="ep-field-label">Laptop Asset ID</div>
                        {laptop ? (
                          <span className="font-monospace fw-semibold" style={{ background: 'rgba(99,102,241,0.10)', color: '#4338ca', padding: '4px 12px', borderRadius: 8, fontSize: 9 }}>{laptop.code || laptop.asset_number || `LAP-${laptop.id}`}</span>
                        ) : <div className="ep-field-value text-muted fw-normal">—</div>}
                      </Col>
                      <Col md={3}><div className="ep-field-label">Laptop Type</div><div className="ep-field-value">{laptop?.asset_name || '—'}</div></Col>
                      <Col md={3}>
                        <div className="ep-field-label">Mobile Device</div>
                        {mobile ? (
                          <div className="ep-field-value">{mobile.asset_name || mobile.code || '—'}</div>
                        ) : <div className="ep-field-value text-muted fw-normal">—</div>}
                      </Col>

                      <Col md={6}><div className="ep-field-label">Other Assets</div><div className="ep-field-value">{otherSummary}</div></Col>
                      <Col md={3}><div className="ep-field-label">Asset Issued Date</div><div className="ep-field-value font-monospace">{fmtDate(empDetail?.asset_issued_date)}</div></Col>
                      <Col md={3}><div className="ep-field-label">Return Required</div><div className="ep-field-value">{empDetail?.return_required || '—'}</div></Col>
                    </>
                  );
                })()}
              </Row>
            </div>
          </div>
        </>
      )}

      {/* ── Tab: Attendance — LIVE (face-driven, multi-punch). The
           ComingSoonShell wrapper was removed; the panel below renders
           real /api/attendance/employee/{id}/summary data. ── */}
      {tab === 'attendance' && (
        <AttendanceTabPanel employeeId={employeeId} />
      )}

      {/* Legacy mock-data block below was the "Coming Soon" placeholder.
          Kept commented in case design wants to A/B back. Safe to delete
          after the real panel ships. */}
      {false && (
        <ComingSoonShell title="Attendance" subtitle="Punch-in, biometric sync, compliance score">
          <Row className="g-3 mb-3 align-items-stretch">
            <Col xl><KpiTile label="Present Days"    value={<AnimatedNumber value={14} />}            sub="This month"      icon="ri-checkbox-circle-line" gradient={GRAD_SUCCESS} tint="#ecfaf3" /></Col>
            <Col xl><KpiTile label="Late Marks"      value={<AnimatedNumber value={1} />}             sub="This month"      icon="ri-time-line"            gradient={GRAD_WARNING} tint="#fff7e6" /></Col>
            <Col xl><KpiTile label="Missing Biometric" value={<AnimatedNumber value={1} />}           sub="Entries this month" icon="ri-error-warning-line" gradient={GRAD_DANGER}  tint="#fff1ed" /></Col>
            <Col xl><KpiTile label="Compliance Score" value={<AnimatedNumber value={93} suffix="%" />} sub="Attendance rate" icon="ri-shield-check-line"   gradient={GRAD_INFO}    tint="#eaf6fd" /></Col>
            <Col xl><KpiTile label="Total Leaves"    value={<AnimatedNumber value={0} />}             sub="This month"      icon="ri-calendar-todo-line"   gradient={GRAD_PURPLE}  tint="#f3eeff" /></Col>
          </Row>

          <Row className="g-3 mb-3 align-items-stretch">
            <Col xl={6}>
              <div className="ep-section-card-flat ep-section-card h-100 d-flex flex-column" style={{ borderTop: '3px solid #0ab39c' }}>
                <div
                  className="d-flex align-items-center justify-content-between gap-3 px-3 py-2"
                  style={{
                    borderBottom: '1px solid rgba(10,179,156,0.18)',
                    background: 'linear-gradient(135deg, rgba(10,179,156,0.14) 0%, rgba(10,179,156,0.04) 60%, rgba(10,179,156,0.01) 100%)',
                  }}
                >
                  <div className="d-flex align-items-center gap-2">
                    <span className="ep-section-icon" style={{ background: 'rgba(10,179,156,0.18)', color: '#0a8a78' }}>
                      <i className="ri-calendar-check-line" />
                    </span>
                    <h6 className="mb-0 fw-bold" style={{ fontSize: 12 }}>Today's Updated Record</h6>
                  </div>
                  <small className="text-muted" style={{ fontSize: 11 }}>Mon, 21-Apr-2026</small>
                </div>
                <div className="px-3 py-3 flex-grow-1">
                  <span className="d-inline-flex align-items-center gap-1 fw-semibold mb-2" style={{ fontSize: 11, padding: '2px 8px', borderRadius: 999, background: '#d6f4e3', color: '#108548' }}>
                    <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#10b981' }} /> Present
                  </span>
                  <Row className="g-2 mb-2">
                    <Col xs={6}>
                      <div className="px-2 py-2" style={{ borderRadius: 8, background: '#ecfaf3', border: '1px solid #bce8d2' }}>
                        <p className="mb-1 fw-semibold" style={{ fontSize: 10, color: '#0a8a78', letterSpacing: '0.06em', textTransform: 'uppercase' }}>» First In</p>
                        <h5 className="mb-0 fw-bold" style={{ color: '#108548', fontSize: 18 }}>07:01 <small style={{ fontSize: 10 }}>AM</small></h5>
                      </div>
                    </Col>
                    <Col xs={6}>
                      <div className="px-2 py-2" style={{ borderRadius: 8, background: '#eaf6fd', border: '1px solid #b8dcef' }}>
                        <p className="mb-1 fw-semibold" style={{ fontSize: 10, color: '#0c63b0', letterSpacing: '0.06em', textTransform: 'uppercase' }}>» Last Out</p>
                        <h5 className="mb-0 fw-bold" style={{ color: '#0c63b0', fontSize: 18 }}>04:02 <small style={{ fontSize: 10 }}>PM</small></h5>
                      </div>
                    </Col>
                  </Row>
                  <div className="d-flex justify-content-around text-center pt-2 border-top">
                    <div><h6 className="mb-0 fw-bold" style={{ color: '#5a3fd1', fontSize: 14 }}>2</h6><small className="text-muted text-uppercase fw-semibold" style={{ fontSize: 9.5, letterSpacing: '0.06em' }}>Punches</small></div>
                    <div><h6 className="mb-0 fw-bold" style={{ color: '#108548', fontSize: 14 }}>9h 01m</h6><small className="text-muted text-uppercase fw-semibold" style={{ fontSize: 9.5, letterSpacing: '0.06em' }}>Worked</small></div>
                    <div><h6 className="mb-0 fw-bold" style={{ color: '#5a3fd1', fontSize: 14 }}>9h 00m</h6><small className="text-muted text-uppercase fw-semibold" style={{ fontSize: 9.5, letterSpacing: '0.06em' }}>Expected</small></div>
                  </div>
                </div>
              </div>
            </Col>
            <Col xl={6}>
              <div className="ep-section-card-flat ep-section-card h-100 d-flex flex-column" style={{ borderTop: '3px solid #299cdb' }}>
                <div
                  className="d-flex align-items-center justify-content-between gap-3 px-3 py-2"
                  style={{
                    borderBottom: '1px solid rgba(41,156,219,0.18)',
                    background: 'linear-gradient(135deg, rgba(41,156,219,0.14) 0%, rgba(41,156,219,0.04) 60%, rgba(41,156,219,0.01) 100%)',
                  }}
                >
                  <div className="d-flex align-items-center gap-2">
                    <span className="ep-section-icon" style={{ background: 'rgba(41,156,219,0.18)', color: '#0c63b0' }}>
                      <i className="ri-pulse-line" />
                    </span>
                    <h6 className="mb-0 fw-bold" style={{ fontSize: 12 }}>Intraday Punch Timeline</h6>
                  </div>
                  <div className="d-flex align-items-center gap-2">
                    {(() => {
                      const PUNCHES = [
                        { time: '08:02 AM', kind: 'in',  label: 'Check In',  src: 'BIOMETRIC' },
                        { time: '10:15 AM', kind: 'out', label: 'Step Out',  src: 'WEB' },
                        { time: '10:42 AM', kind: 'in',  label: 'Step In',   src: 'WEB' },
                        { time: '12:30 PM', kind: 'out', label: 'Lunch Out', src: 'BIOMETRIC' },
                        { time: '01:14 PM', kind: 'in',  label: 'Lunch In',  src: 'BIOMETRIC' },
                        { time: '02:48 PM', kind: 'out', label: 'Meeting',   src: 'MOBILE' },
                        { time: '04:05 PM', kind: 'in',  label: 'Back',      src: 'MOBILE' },
                        { time: '05:20 PM', kind: 'out', label: 'Tea Break', src: 'WEB' },
                        { time: '05:38 PM', kind: 'in',  label: 'Resumed',   src: 'WEB' },
                        { time: '07:02 PM', kind: 'out', label: 'Step Out',  src: 'BIOMETRIC' },
                        { time: '07:25 PM', kind: 'in',  label: 'Step In',   src: 'BIOMETRIC' },
                        { time: '08:55 PM', kind: 'out', label: 'Check Out', src: 'BIOMETRIC' },
                      ];
                      return (
                        <span className="badge rounded-pill" style={{ background: 'rgba(99,102,241,0.12)', color: '#6366f1', fontSize: 10.5, padding: '3px 9px' }}>{PUNCHES.length} punches today</span>
                      );
                    })()}
                    <Button
                      color="secondary"
                      className="btn-label waves-effect waves-light rounded-pill btn-sm"
                      onClick={() => setRegOpen(true)}
                    >
                      <i className="ri-add-line label-icon align-middle rounded-pill fs-16 me-2" />
                      Regularization
                    </Button>
                  </div>
                </div>
                <div className="px-3 py-3 flex-grow-1">
                  {(() => {
                    const PUNCHES = [
                      { time: '08:02 AM', kind: 'in',  label: 'Check In',  src: 'BIOMETRIC' },
                      { time: '10:15 AM', kind: 'out', label: 'Step Out',  src: 'WEB' },
                      { time: '10:42 AM', kind: 'in',  label: 'Step In',   src: 'WEB' },
                      { time: '12:30 PM', kind: 'out', label: 'Lunch Out', src: 'BIOMETRIC' },
                      { time: '01:14 PM', kind: 'in',  label: 'Lunch In',  src: 'BIOMETRIC' },
                      { time: '02:48 PM', kind: 'out', label: 'Meeting',   src: 'MOBILE' },
                      { time: '04:05 PM', kind: 'in',  label: 'Back',      src: 'MOBILE' },
                      { time: '05:20 PM', kind: 'out', label: 'Tea Break', src: 'WEB' },
                      { time: '05:38 PM', kind: 'in',  label: 'Resumed',   src: 'WEB' },
                      { time: '07:02 PM', kind: 'out', label: 'Step Out',  src: 'BIOMETRIC' },
                      { time: '07:25 PM', kind: 'in',  label: 'Step In',   src: 'BIOMETRIC' },
                      { time: '08:55 PM', kind: 'out', label: 'Check Out', src: 'BIOMETRIC' },
                    ];
                    return (
                      <div className="ep-punch-rail">
                        <div className="ep-punch-track">
                          <div className="ep-punch-line" />
                          {PUNCHES.map((p, i) => {
                            const isIn = p.kind === 'in';
                            const dotBg = isIn ? '#10b981' : '#3b82f6';
                            const dotShadow = isIn ? 'rgba(16,185,129,0.40)' : 'rgba(59,130,246,0.40)';
                            const fg = isIn ? '#108548' : '#0c63b0';
                            return (
                              <div className="ep-punch-stop" key={i}>
                                <span
                                  className="ep-punch-dot d-inline-flex align-items-center justify-content-center rounded-circle"
                                  style={{ background: dotBg, color: '#fff', boxShadow: `0 3px 8px ${dotShadow}` }}
                                >
                                  <i className={isIn ? 'ri-checkbox-circle-fill' : 'ri-logout-circle-r-line'} style={{ fontSize: 11 }} />
                                </span>
                                <h6 className="mb-0 fw-bold mt-2" style={{ color: fg, fontSize: 12 }}>{p.time}</h6>
                                <p className="mb-1 fw-semibold" style={{ fontSize: 10.5 }}>{p.label}</p>
                                <span className="badge rounded-pill" style={{ background: '#dceefe', color: '#0c63b0', fontSize: 8.5, padding: '2px 6px', letterSpacing: '0.04em' }}>{p.src}</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>
            </Col>
          </Row>

          <Row className="g-3 mb-3">
            <Col xs={12}>
              <div className="ep-section-card-flat ep-section-card" style={{ borderTop: '3px solid #a855f7' }}>
                <div
                  className="d-flex align-items-center justify-content-between gap-3 px-3 py-2"
                  style={{
                    borderBottom: '1px solid rgba(168,85,247,0.18)',
                    background: 'linear-gradient(135deg, rgba(168,85,247,0.14) 0%, rgba(168,85,247,0.04) 60%, rgba(168,85,247,0.01) 100%)',
                  }}
                >
                  <div className="d-flex align-items-center gap-2">
                    <span className="ep-section-icon" style={{ background: 'rgba(168,85,247,0.18)', color: '#7c3aed' }}>
                      <i className="ri-history-line" />
                    </span>
                    <h6 className="mb-0 fw-bold" style={{ fontSize: 12 }}>Attendance Timelog History</h6>
                  </div>
                  <div className="d-flex align-items-center gap-2">
                    <Dropdown isOpen={monthOpen} toggle={() => setMonthOpen(o => !o)}>
                      <DropdownToggle
                        tag="button"
                        type="button"
                        className="btn btn-sm rounded-pill fw-semibold d-inline-flex align-items-center gap-1"
                        style={{ background: 'var(--vz-secondary-bg)', color: 'var(--vz-body-color)', border: '1px solid var(--vz-border-color)', fontSize: 11.5, padding: '4px 12px' }}
                      >
                        <i className="ri-calendar-line" /> {attMonth}
                        <i className="ri-arrow-down-s-line" />
                      </DropdownToggle>
                      <DropdownMenu end>
                        {ATT_MONTHS.map(m => (
                          <DropdownItem
                            key={m.key}
                            active={attMonth === m.label}
                            onClick={() => setAttMonth(m.label)}
                          >
                            {m.label}
                          </DropdownItem>
                        ))}
                      </DropdownMenu>
                    </Dropdown>
                    <Button
                      color="secondary"
                      className="btn-label waves-effect waves-light rounded-pill btn-sm"
                      onClick={() => toast.info('Exporting timelogs', `Preparing ${attMonth} export…`)}
                    >
                      <i className="ri-download-2-line label-icon align-middle rounded-pill fs-16 me-2" />
                      Export Timelogs
                    </Button>
                  </div>
                </div>
                <div className="px-3 pb-3 pt-2">
                  <div className="table-responsive border rounded ep-att-scroll-wrap">
                    <table className="table align-middle table-nowrap ep-att-table mb-0">
                      <thead className="table-light">
                        <tr>
                          <th>Date</th><th>Day</th><th>Shift</th><th>First In</th><th>Last Out</th><th>Punches</th><th>Worked</th><th>Deviation</th><th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {ATTENDANCE_HISTORY.slice(attPage * ATT_PAGE_SIZE, attPage * ATT_PAGE_SIZE + ATT_PAGE_SIZE).map(r => {
                          const t = STATUS_TONE[r.status];
                          const shiftTone = r.shift === 'EARLY' ? { bg: '#d6f4e3', fg: '#108548' } : r.shift === 'GENERAL' ? { bg: '#dceefe', fg: '#0c63b0' } : null;
                          return (
                            <tr key={r.date}>
                              <td className="fw-semibold">{r.date}</td>
                              <td className="text-muted">{r.day}</td>
                              <td>{shiftTone ? <span className="ep-shift-pill" style={{ background: shiftTone.bg, color: shiftTone.fg }}>{r.shift}</span> : <span className="text-muted">—</span>}</td>
                              <td className="font-monospace">{r.firstIn}</td>
                              <td className="font-monospace">{r.lastOut}</td>
                              <td className="fw-bold" style={{ color: '#5a3fd1' }}>{r.punches > 0 ? r.punches : <span className="text-muted">—</span>}</td>
                              <td className="fw-bold" style={{ color: '#108548' }}>{r.worked}</td>
                              <td className="fw-bold" style={{ color: '#108548' }}>{r.deviation}</td>
                              <td>
                                <span className="d-inline-flex align-items-center gap-1 fw-semibold" style={{ fontSize: 11, padding: '3px 10px', borderRadius: 999, background: t.bg, color: t.fg }}>
                                  <span style={{ width: 5, height: 5, borderRadius: '50%', background: t.dot }} /> {r.status}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {(() => {
                    const total = ATTENDANCE_HISTORY.length;
                    const pageCount = Math.max(1, Math.ceil(total / ATT_PAGE_SIZE));
                    const startIdx = attPage * ATT_PAGE_SIZE;
                    const shownEnd = Math.min(startIdx + ATT_PAGE_SIZE, total);
                    const canPrev = attPage > 0;
                    const canNext = attPage < pageCount - 1;
                    // Windowed paginator — same recipe as the master TableContainer:
                    // first, last, current ± 1, ellipses for any gap. With ≤7 pages
                    // we render every number.
                    const siblings = 1;
                    const items: Array<number | 'ellipsis-l' | 'ellipsis-r'> = [];
                    if (pageCount <= 7) {
                      for (let i = 0; i < pageCount; i++) items.push(i);
                    } else {
                      const left = Math.max(attPage - siblings, 1);
                      const right = Math.min(attPage + siblings, pageCount - 2);
                      items.push(0);
                      if (left > 1) items.push('ellipsis-l');
                      for (let i = left; i <= right; i++) items.push(i);
                      if (right < pageCount - 2) items.push('ellipsis-r');
                      items.push(pageCount - 1);
                    }
                    return (
                      <Row className="align-items-center mt-3 g-3 text-center text-sm-start">
                        <div className="col-sm">
                          <div className="text-muted">
                            Showing<span className="fw-semibold ms-1">{shownEnd - startIdx}</span> of <span className="fw-semibold">{total}</span> Results
                          </div>
                        </div>
                        <div className="col-sm-auto">
                          <ul className="pagination pagination-separated pagination-md justify-content-center justify-content-sm-start mb-0">
                            <li className={!canPrev ? 'page-item disabled' : 'page-item'}>
                              <a href="#" className="page-link" onClick={e => { e.preventDefault(); if (canPrev) setAttPage(p => p - 1); }}>
                                <i className="ri-arrow-left-s-line" />
                              </a>
                            </li>
                            {items.map((item, key) => {
                              if (item === 'ellipsis-l' || item === 'ellipsis-r') {
                                return (
                                  <li key={`${item}-${key}`} className="page-item disabled">
                                    <span className="page-link" style={{ cursor: 'default' }}>…</span>
                                  </li>
                                );
                              }
                              const isActive = attPage === item;
                              return (
                                <li key={item} className="page-item">
                                  <a
                                    href="#"
                                    className={isActive ? 'page-link active' : 'page-link'}
                                    style={isActive ? { backgroundColor: 'var(--vz-secondary)', borderColor: 'var(--vz-secondary)', color: '#fff' } : undefined}
                                    onClick={e => { e.preventDefault(); setAttPage(item); }}
                                  >
                                    {item + 1}
                                  </a>
                                </li>
                              );
                            })}
                            <li className={!canNext ? 'page-item disabled' : 'page-item'}>
                              <a href="#" className="page-link" onClick={e => { e.preventDefault(); if (canNext) setAttPage(p => p + 1); }}>
                                <i className="ri-arrow-right-s-line" />
                              </a>
                            </li>
                          </ul>
                        </div>
                      </Row>
                    );
                  })()}
                </div>
              </div>
            </Col>
          </Row>
        </ComingSoonShell>
      )}

      {/* ── Tab: Evidence Vault ── */}
      {tab === 'vault' && (
        <>
          {/* Hero strip — "Evidence Vault — {Name} Document Repository" + KPIs */}
          <Card className="mb-3 border-0" style={{ borderRadius: 14, overflow: 'hidden' }}>
            <div
              style={{
                background: 'linear-gradient(135deg,#0f0c29 0%,#1e1b4b 30%,#312e81 65%,#4338ca 100%)',
                color: '#fff',
                padding: '12px 18px',
                position: 'relative',
                overflow: 'hidden',
              }}
            >
              <div style={{ position: 'absolute', top: -50, right: -40, width: 200, height: 200, borderRadius: '50%', background: 'rgba(255,255,255,0.06)', pointerEvents: 'none' }} />
              <Row className="align-items-center g-2" style={{ position: 'relative' }}>
                <Col xs="auto">
                  <span className="d-inline-flex align-items-center justify-content-center rounded-3" style={{ width: 38, height: 38, background: 'rgba(255,255,255,0.22)', border: '1px solid rgba(255,255,255,0.30)' }}>
                    <i className="ri-lock-2-line" style={{ fontSize: 17, color: '#fff' }} />
                  </span>
                </Col>
                <Col className="min-w-0">
                  <p className="mb-0 text-uppercase fw-semibold" style={{ color: 'rgba(255,255,255,0.72)', letterSpacing: '0.06em', fontSize: 9.5 }}>Evidence Vault</p>
                  <div className="text-white" style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.25 }}>
                    {employee?.name || employeeId} <span style={{ color: 'rgba(255,255,255,0.55)' }}>—</span> Document Repository
                  </div>
                  <small style={{ color: 'rgba(255,255,255,0.70)', fontSize: 10.5 }}>All documents are securely stored and version-controlled</small>
                </Col>
                <Col xs="12" lg="auto">
                  <div className="d-flex gap-1 flex-wrap justify-content-lg-end">
                    {[
                      { label: 'Total Docs', value: vaultCounts.total,    color: '#fff' },
                      { label: 'Verified',   value: vaultCounts.verified, color: '#86efac' },
                      { label: 'Pending',    value: vaultCounts.pending,  color: '#fcd34d' },
                      { label: 'Signed',     value: vaultCounts.signed,   color: '#c4b5fd' },
                    ].map(c => (
                      <div
                        key={c.label}
                        className="text-center"
                        style={{
                          background: 'rgba(255,255,255,0.10)',
                          border: '1px solid rgba(255,255,255,0.18)',
                          borderRadius: 9,
                          padding: '4px 10px',
                          minWidth: 72,
                        }}
                      >
                        <p className="mb-0 text-uppercase fw-semibold" style={{ color: 'rgba(255,255,255,0.72)', letterSpacing: '0.05em', fontSize: 8.5 }}>{c.label}</p>
                        {(uploadedLoading || signedLoading) ? (
                          // Translucent-white shimmer bar so the KPI tile
                          // doesn't flash 0 before the counts resolve.
                          <div className="d-flex justify-content-center" style={{ paddingTop: 2 }}>
                            <Shimmer height={13} width={28} style={{ background: 'rgba(255,255,255,0.25)' }} />
                          </div>
                        ) : (
                          <div className="fw-bold lh-1" style={{ color: c.color, fontSize: 13 }}>{c.value}</div>
                        )}
                      </div>
                    ))}
                  </div>
                </Col>
              </Row>
            </div>
          </Card>

          {/* Sub-tab pill — Employee Documents | Organizational Documents */}
          <Row className="g-2 mb-3">
            <Col xs={12}>
              <div
                className="d-flex"
                style={{
                  background: 'var(--vz-secondary-bg)',
                  border: '1px solid var(--vz-border-color)',
                  borderRadius: 9,
                  padding: 3,
                  gap: 3,
                }}
              >
                {[
                  { key: 'employee'       as VaultTab, label: 'Employee Documents',      count: employeeDocCount,      icon: 'ri-user-line',     activeBg: 'linear-gradient(135deg,#1e1b4b,#4338ca)', shadow: 'rgba(67,56,202,0.22)' },
                  { key: 'organizational' as VaultTab, label: 'Organizational Documents', count: organizationalDocCount, icon: 'ri-building-line', activeBg: 'linear-gradient(135deg,#064e3b,#047857)', shadow: 'rgba(4,120,87,0.22)' },
                ].map(t => {
                  const on = vaultTab === t.key;
                  return (
                    <button
                      key={t.key}
                      type="button"
                      onClick={() => setVaultTab(t.key)}
                      className="btn flex-grow-1 d-inline-flex align-items-center justify-content-center gap-2 fw-semibold"
                      style={{
                        borderRadius: 7,
                        padding: '5px 12px',
                        fontSize: 11.5,
                        background: on ? t.activeBg : 'transparent',
                        color: on ? '#fff' : 'var(--vz-secondary-color)',
                        border: 'none',
                        boxShadow: on ? `0 3px 8px ${t.shadow}` : 'none',
                      }}
                    >
                      <i className={t.icon} style={{ fontSize: 12 }} />
                      {t.label}
                      <span
                        className="badge rounded-pill d-inline-flex align-items-center justify-content-center"
                        style={{
                          fontSize: 10,
                          padding: '2px 6px',
                          minWidth: 24,
                          background: on ? 'rgba(255,255,255,0.22)' : 'var(--vz-light)',
                          color: on ? '#fff' : 'var(--vz-secondary-color)',
                        }}
                      >
                        {(t.key === 'employee' ? uploadedLoading : signedLoading)
                          ? <Shimmer height={9} width={14} style={{ background: on ? 'rgba(255,255,255,0.35)' : 'var(--vz-secondary-color)', opacity: 0.5 }} />
                          : t.count}
                      </span>
                    </button>
                  );
                })}
              </div>
            </Col>
          </Row>

          {/* Employee Documents sub-tab — live list of files the employee
              has actually uploaded (Aadhaar / PAN / photo / etc.). Drops
              the static placeholder catalogue; rows come straight from
              /api/employees/{id}/documents. */}
          {vaultTab === 'employee' && (
            <div
              className="ep-section-card-flat ep-section-card mb-3"
              style={{ borderTop: '3px solid #5a3fd1' }}
            >
              <div
                className="d-flex align-items-center justify-content-between gap-3 px-3 py-2"
                style={{
                  borderBottom: '1px solid rgba(90,63,209,0.18)',
                  background: 'linear-gradient(135deg, rgba(90,63,209,0.14) 0%, rgba(90,63,209,0.04) 60%, rgba(90,63,209,0.01) 100%)',
                }}
              >
                <div className="d-flex align-items-center gap-2">
                  <span className="ep-section-icon" style={{ background: 'rgba(90,63,209,0.18)', color: '#5a3fd1' }}>
                    <i className="ri-upload-cloud-2-line" />
                  </span>
                  <div>
                    <h6 className="mb-0 fw-bold" style={{ fontSize: 12 }}>Uploaded Documents</h6>
                    <small className="text-muted" style={{ fontSize: 11 }}>
                      Files attached by the employee or HR — view, download, and verification status.
                    </small>
                  </div>
                </div>
                <div className="text-end">
                  {uploadedLoading
                    ? <Shimmer height={20} width={28} style={{ marginBottom: 4 }} />
                    : <h4 className="mb-0 fw-bold" style={{ color: '#5a3fd1', fontSize: 22, lineHeight: 1 }}>{uploadedDocs.length}</h4>}
                  <small className="text-muted text-uppercase" style={{ fontSize: 9.5, letterSpacing: '0.06em', fontWeight: 700 }}>Documents</small>
                </div>
              </div>
              <div className="px-3 pb-3 pt-2">
                <div className="table-responsive border rounded ep-att-scroll-wrap">
                  <table className="table align-middle table-nowrap ep-att-table mb-0">
                    <thead className="table-light">
                      <tr>
                        {['SR', 'Document', 'File Name', 'Size', 'Uploaded', 'Verified By', 'Attachment', 'Status'].map(h => (
                          <th key={h}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {uploadedLoading ? (
                        <ShimmerTableRows rows={4} cols={8} keyPrefix="uploaded-shim" />
                      ) : uploadedDocs.length === 0 ? (
                        <tr><td colSpan={8} style={{ padding: 28, textAlign: 'center', color: '#9ca3af' }}>
                          <i className="ri-inbox-line" style={{ fontSize: 28, display: 'block', marginBottom: 6 }} />
                          No uploaded documents yet. Files attached during onboarding will land here.
                        </td></tr>
                      ) : (
                        uploadedDocs.map((d, idx) => {
                          const statusKey = d.status === 'verified' ? 'Verified'
                                          : d.status === 'rejected' ? 'Pending'   // surface rejected in amber
                                          : 'Uploaded';
                          const st = VAULT_STATUS_TONE[statusKey as keyof typeof VAULT_STATUS_TONE]
                                  || { bg: '#eef2f6', fg: '#5b6478', dot: '#878a99' };
                          return (
                            <tr key={d.id}>
                              <td className="text-muted">{idx + 1}</td>
                              <td className="fw-semibold">{prettyDocKey(d.document_key)}</td>
                              <td className="text-muted" style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }} title={d.original_name || ''}>
                                {d.original_name || '—'}
                              </td>
                              <td className="font-monospace" style={{ fontSize: 11.5 }}>{formatBytes(d.size_bytes)}</td>
                              <td className="font-monospace" style={{ fontSize: 11.5 }}>
                                {d.uploaded_at ? new Date(d.uploaded_at).toLocaleDateString() : '—'}
                              </td>
                              <td style={{ fontSize: 11.5 }}>
                                {d.verifier ? d.verifier.name : <span className="text-muted">—</span>}
                              </td>
                              <td>
                                {d.url
                                  ? <a href={resolveFileUrl(d.url) || d.url} target="_blank" rel="noopener noreferrer" className="d-inline-flex align-items-center gap-1 text-decoration-none"
                                      style={{ background: 'rgba(16,185,129,0.10)', color: '#0a8a78', padding: '3px 9px', borderRadius: 999, fontSize: 11, fontWeight: 600, border: '1px solid rgba(16,185,129,0.25)' }}>
                                      <i className="ri-file-text-line" /> Open
                                    </a>
                                  : <span className="text-muted">—</span>}
                              </td>
                              <td>
                                <span className="d-inline-flex align-items-center gap-1 fw-semibold text-uppercase"
                                  title={d.status === 'rejected' ? (d.rejection_reason || 'Rejected') : undefined}
                                  style={{ fontSize: 9.5, padding: '3px 9px', borderRadius: 999,
                                    background: d.status === 'rejected' ? '#fee2e2' : st.bg,
                                    color: d.status === 'rejected' ? '#b91c1c' : st.fg,
                                    letterSpacing: '0.04em' }}>
                                  <span style={{ width: 5, height: 5, borderRadius: '50%', background: d.status === 'rejected' ? '#ef4444' : st.dot }} /> {d.status}
                                </span>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* My Signed Documents — live list of completed signature
              workflows targeting this employee. Sits above the static
              Org Docs catalogue so the most recent signed copies are
              top of the page. */}
          {vaultTab === 'organizational' && (
            <div
              className="ep-section-card-flat ep-section-card mb-3"
              style={{ borderTop: '3px solid #16a34a' }}
            >
              {/* Dark-theme-aware styling for the org-doc Code badge, Signer
                  tags and View button (were hardcoded light → BUG-131/132/133). */}
              <style>{`
                .epv-code-badge { font-size: 10.5px; background: #fef3c7; color: #a16207; padding: 2px 6px; border-radius: 4px; }
                .epv-signer-tag { font-size: 10.5px; padding: 2px 7px; border-radius: 999px; font-weight: 700; display: inline-block; }
                .epv-signer-tag.is-done { background: #dcfce7; color: #15803d; }
                .epv-signer-tag.is-pending { background: #f3f4f6; color: #6b7280; }
                .epv-view-btn { padding: 4px 10px; border-radius: 6px; border: 1px solid #c7d2fe; background: #eef2ff; color: #4338ca; font-size: 11.5px; font-weight: 700; cursor: pointer; transition: background .15s ease; }
                .epv-view-btn:hover { background: #e0e7ff; }
                [data-bs-theme="dark"] .epv-code-badge, [data-layout-mode="dark"] .epv-code-badge { background: rgba(251,191,36,.16); color: #fcd34d; }
                [data-bs-theme="dark"] .epv-signer-tag.is-done, [data-layout-mode="dark"] .epv-signer-tag.is-done { background: rgba(34,197,94,.18); color: #86efac; }
                [data-bs-theme="dark"] .epv-signer-tag.is-pending, [data-layout-mode="dark"] .epv-signer-tag.is-pending { background: rgba(148,163,184,.16); color: #cbd5e1; }
                [data-bs-theme="dark"] .epv-view-btn, [data-layout-mode="dark"] .epv-view-btn { background: rgba(99,102,241,.16); border-color: rgba(129,140,248,.40); color: #c7d2fe; }
                [data-bs-theme="dark"] .epv-view-btn:hover, [data-layout-mode="dark"] .epv-view-btn:hover { background: rgba(99,102,241,.26); }
              `}</style>
              <div
                className="d-flex align-items-center justify-content-between gap-3 px-3 py-2"
                style={{
                  borderBottom: '1px solid rgba(22,163,74,0.18)',
                  background: 'linear-gradient(135deg, rgba(22,163,74,0.14) 0%, rgba(22,163,74,0.04) 60%, rgba(22,163,74,0.01) 100%)',
                }}
              >
                <div className="d-flex align-items-center gap-2">
                  <span className="ep-section-icon" style={{ background: 'rgba(22,163,74,0.18)', color: '#16a34a' }}>
                    <i className="ri-quill-pen-line" />
                  </span>
                  <div>
                    <h6 className="mb-0 fw-bold" style={{ fontSize: 12 }}>My Signed Documents</h6>
                    <small className="text-muted" style={{ fontSize: 11 }}>
                      Final, fully-signed copies — view in the browser or download as PDF.
                    </small>
                  </div>
                </div>
                <div className="text-end">
                  {signedLoading
                    ? <Shimmer height={20} width={28} style={{ marginBottom: 4 }} />
                    : <h4 className="mb-0 fw-bold" style={{ color: '#16a34a', fontSize: 22, lineHeight: 1 }}>{signedDocs.length}</h4>}
                  <small className="text-muted text-uppercase" style={{ fontSize: 9.5, letterSpacing: '0.06em', fontWeight: 700 }}>Documents</small>
                </div>
              </div>
              <div className="px-3 pb-3 pt-2">
                <div className="table-responsive border rounded ep-att-scroll-wrap">
                  <table className="table align-middle table-nowrap ep-att-table mb-0">
                    <thead className="table-light">
                      <tr>
                        {['SR', 'Document', 'Code', 'Signers', 'Completed', 'Actions'].map(h => (
                          <th key={h}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {signedLoading ? (
                        <ShimmerTableRows rows={3} cols={6} keyPrefix="signed-shim" />
                      ) : signedDocs.length === 0 ? (
                        <tr><td colSpan={6} style={{ padding: 28, textAlign: 'center', color: '#9ca3af' }}>
                          <i className="ri-inbox-line" style={{ fontSize: 28, display: 'block', marginBottom: 6 }} />
                          No signed documents yet. Completed workflows will land here automatically.
                        </td></tr>
                      ) : (
                        signedDocs.map((doc, i) => (
                          <tr key={doc.id}>
                            <td className="text-muted">{i + 1}</td>
                            <td className="fw-semibold">{doc.template?.name || '(template removed)'}</td>
                            <td>
                              <code className="epv-code-badge">{doc.code || '—'}</code>
                            </td>
                            <td>
                              <div className="d-flex flex-wrap gap-1">
                                {(doc.signers || []).slice(0, 3).map((s, j) => (
                                  <span key={j} className={`epv-signer-tag ${s.status === 'Done' ? 'is-done' : 'is-pending'}`}>
                                    {s.name}
                                  </span>
                                ))}
                                {doc.signers && doc.signers.length > 3 && (
                                  <span style={{ fontSize: 10.5, color: '#6b7280' }}>+{doc.signers.length - 3} more</span>
                                )}
                              </div>
                            </td>
                            <td className="font-monospace" style={{ fontSize: 11.5 }}>
                              {new Date(doc.updated_at).toLocaleDateString()}
                            </td>
                            <td>
                              <div className="d-flex gap-1">
                                <button type="button" className="epv-view-btn" onClick={() => setSignedPreview(doc)}>
                                  <i className="ri-eye-line me-1" />View
                                </button>
                                <button type="button" onClick={() => downloadSignedPdf(doc.id, doc.code)}
                                  style={{ padding: '4px 10px', borderRadius: 6, border: 0, background: 'linear-gradient(135deg,#dc2626,#ef4444)', color: '#fff', fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}>
                                  <i className="ri-file-pdf-2-line me-1" />Download PDF
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

        </>
      )}

      {/* ── Tab: Payroll Details (live — backend wired) ── */}
      {tab === 'payroll' && (
        <>
          {/* Sub-tab pill — Payroll Summary (indigo) | Payment Details (green).
              Same compact strap shape as the Evidence Vault subtabs. */}
          <Row className="g-2 mb-3">
            <Col xs={12}>
              <div
                className="d-flex"
                style={{
                  background: 'var(--vz-secondary-bg)',
                  border: '1px solid var(--vz-border-color)',
                  borderRadius: 9,
                  padding: 3,
                  gap: 3,
                }}
              >
                {[
                  { key: 'summary' as PayrollTab, label: 'Payroll Summary',  icon: 'ri-calendar-line',            activeBg: 'linear-gradient(135deg,#1e1b4b,#4338ca)', shadow: 'rgba(67,56,202,0.22)' },
                  { key: 'details' as PayrollTab, label: 'Payment Details',  icon: 'ri-money-dollar-circle-line', activeBg: 'linear-gradient(135deg,#064e3b,#047857)', shadow: 'rgba(4,120,87,0.22)' },
                ].map(t => {
                  const on = payrollTab === t.key;
                  return (
                    <button
                      key={t.key}
                      type="button"
                      onClick={() => setPayrollTab(t.key)}
                      className="btn flex-grow-1 d-inline-flex align-items-center justify-content-center gap-2 fw-semibold"
                      style={{
                        borderRadius: 7,
                        padding: '5px 12px',
                        fontSize: 11.5,
                        background: on ? t.activeBg : 'transparent',
                        color: on ? '#fff' : 'var(--vz-secondary-color)',
                        border: 'none',
                        boxShadow: on ? `0 3px 8px ${t.shadow}` : 'none',
                      }}
                    >
                      <i className={t.icon} style={{ fontSize: 12 }} />
                      {t.label}
                    </button>
                  );
                })}
              </div>
            </Col>
          </Row>

          {payrollTab === 'summary' && (
            <>
              {/* Hero strip — only on the Payroll Summary tab. */}
              <Card className="mb-3 border-0" style={{ borderRadius: 14, overflow: 'hidden' }}>
                <div
                  style={{
                    background: 'linear-gradient(135deg,#0f0c29 0%,#1e1b4b 30%,#312e81 65%,#4338ca 100%)',
                    color: '#fff',
                    padding: '12px 18px',
                    position: 'relative',
                    overflow: 'hidden',
                  }}
                >
                  <div style={{ position: 'absolute', top: -50, right: -40, width: 200, height: 200, borderRadius: '50%', background: 'rgba(255,255,255,0.06)', pointerEvents: 'none' }} />
                  <Row className="align-items-center g-2" style={{ position: 'relative' }}>
                    <Col xs="auto">
                      <span className="d-inline-flex align-items-center justify-content-center rounded-3" style={{ width: 38, height: 38, background: 'rgba(255,255,255,0.22)', border: '1px solid rgba(255,255,255,0.30)' }}>
                        <i className="ri-money-dollar-circle-line" style={{ fontSize: 17, color: '#fff' }} />
                      </span>
                    </Col>
                    <Col className="min-w-0">
                      <p className="mb-0 text-uppercase fw-semibold" style={{ color: 'rgba(255,255,255,0.72)', letterSpacing: '0.06em', fontSize: 9.5 }}>Payroll Summary</p>
                      <div className="text-white" style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.25 }}>
                        Last Processed: <span style={{ color: '#bce8ff' }}>Mar 2026</span> (01 Mar – 31 Mar)
                      </div>
                      <small style={{ color: 'rgba(255,255,255,0.70)', fontSize: 10.5 }}>Next cycle: Apr 2026 · Monthly payroll</small>
                    </Col>
                    <Col xs="12" lg="auto">
                      <div className="d-flex gap-1 flex-wrap justify-content-lg-end align-items-center">
                        {[
                          { label: 'Working Days', value: '31',     color: '#fff' },
                          { label: 'Loss of Pay',  value: '0',      color: '#fcd34d' },
                          { label: 'Status',       value: 'Active', color: '#86efac' },
                        ].map(c => (
                          <div
                            key={c.label}
                            className="text-center"
                            style={{
                              background: 'rgba(255,255,255,0.10)',
                              border: '1px solid rgba(255,255,255,0.18)',
                              borderRadius: 9,
                              padding: '4px 10px',
                              minWidth: 72,
                            }}
                          >
                            <p className="mb-0 text-uppercase fw-semibold" style={{ color: 'rgba(255,255,255,0.72)', letterSpacing: '0.05em', fontSize: 8.5 }}>{c.label}</p>
                            <div className="fw-bold lh-1" style={{ color: c.color, fontSize: 13 }}>{c.value}</div>
                          </div>
                        ))}
                        <button
                          type="button"
                          onClick={openLatestPayslip}
                          className="d-inline-flex align-items-center gap-1 fw-semibold lh-1"
                          style={{
                            background: 'rgba(255,255,255,0.10)',
                            border: '1px solid rgba(255,255,255,0.18)',
                            borderRadius: 9,
                            padding: '4px 10px',
                            minWidth: 72,
                            height: 36,
                            color: '#fff',
                            fontSize: 11,
                            cursor: 'pointer',
                            transition: 'background .15s ease',
                          }}
                          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.18)'; }}
                          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.10)'; }}
                        >
                          <i className="ri-download-2-line" style={{ fontSize: 13 }} /> View Payslip
                        </button>
                      </div>
                    </Col>
                  </Row>
                </div>
              </Card>

              <Row className="g-3 mb-3 align-items-stretch">
                <Col xl={6}>
                  <div className="ep-section-card-flat ep-section-card h-100 d-flex flex-column" style={{ borderTop: '3px solid #299cdb' }}>
                    <div
                      className="d-flex align-items-center justify-content-between gap-3 px-3 py-2"
                      style={{
                        borderBottom: '1px solid rgba(41,156,219,0.18)',
                        background: 'linear-gradient(135deg, rgba(41,156,219,0.14) 0%, rgba(41,156,219,0.04) 60%, rgba(41,156,219,0.01) 100%)',
                      }}
                    >
                      <div className="d-flex align-items-center gap-2">
                        <span className="ep-section-icon" style={{ background: 'rgba(41,156,219,0.18)', color: '#0c63b0' }}>
                          <i className="ri-bank-card-line" />
                        </span>
                        <h6 className="mb-0 fw-bold" style={{ fontSize: 12 }}>Payment Information</h6>
                      </div>
                      <span className="d-inline-flex align-items-center gap-1 fw-semibold" style={{ fontSize: 10, padding: '3px 9px', borderRadius: 999, background: 'rgba(245,158,11,0.12)', color: '#a16207', border: '1px solid rgba(245,158,11,0.30)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#f59e0b' }} /> Not Initiated
                      </span>
                    </div>
                    <div className="px-3 py-3 flex-grow-1">
                      <p className="mb-3" style={{ fontSize: 12.5 }}>
                        Salary Payment Mode: <strong style={{ color: 'var(--vz-heading-color, var(--vz-body-color))' }}>Bank Transfer</strong>
                      </p>
                      <Row className="g-3">
                        <Col md={6}><div className="ep-field-label">Bank Name</div><div className="ep-field-value">Kotak Mahindra Bank</div></Col>
                        <Col md={6}>
                          <div className="ep-field-label">Account Number</div>
                          <span className="font-monospace fw-semibold" style={{ background: 'rgba(99,102,241,0.10)', color: '#4338ca', padding: '3px 10px', borderRadius: 8, fontSize: 9 }}>XXXXXXXX36</span>
                        </Col>
                        <Col md={6}>
                          <div className="ep-field-label">IFSC Code</div>
                          <span className="font-monospace fw-semibold" style={{ background: 'rgba(99,102,241,0.10)', color: '#4338ca', padding: '3px 10px', borderRadius: 8, fontSize: 9 }}>KKBK0000823</span>
                        </Col>
                        <Col md={6}><div className="ep-field-label">Name on Account</div><div className="ep-field-value">{employee?.name || 'Aarav Kale'}</div></Col>
                        <Col md={6}><div className="ep-field-label">Branch</div><div className="ep-field-value">Silvaasa</div></Col>
                        <Col md={6}><div className="ep-field-label">Account Type</div><div className="ep-field-value">Salary</div></Col>
                      </Row>
                    </div>
                  </div>
                </Col>
                <Col xl={6}>
                  <div className="ep-section-card-flat ep-section-card h-100 d-flex flex-column" style={{ borderTop: '3px solid #a855f7' }}>
                    <div
                      className="d-flex align-items-center gap-3 px-3 py-2"
                      style={{
                        borderBottom: '1px solid rgba(168,85,247,0.18)',
                        background: 'linear-gradient(135deg, rgba(168,85,247,0.14) 0%, rgba(168,85,247,0.04) 60%, rgba(168,85,247,0.01) 100%)',
                      }}
                    >
                      <span className="ep-section-icon" style={{ background: 'rgba(168,85,247,0.18)', color: '#7c3aed' }}>
                        <i className="ri-user-2-line" />
                      </span>
                      <h6 className="mb-0 fw-bold" style={{ fontSize: 12 }}>Identity Information</h6>
                    </div>
                    <div className="px-3 py-3 flex-grow-1">
                      {/* PAN Card sub-header */}
                      <div className="d-flex align-items-center justify-content-between gap-2 px-3 py-2 mb-2" style={{ background: 'rgba(168,85,247,0.08)', border: '1px solid rgba(168,85,247,0.20)', borderRadius: 8 }}>
                        <span className="fw-bold" style={{ color: '#7c3aed', fontSize: 12.5 }}>PAN Card</span>
                        <span className="d-inline-flex align-items-center gap-1 fw-semibold" style={{ fontSize: 10, padding: '2px 8px', borderRadius: 999, background: 'rgba(16,185,129,0.12)', color: '#0a8a78', border: '1px solid rgba(16,185,129,0.30)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                          <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#10b981' }} /> Verified
                        </span>
                      </div>
                      <Row className="g-3 mb-3">
                        <Col md={3}>
                          <div className="ep-field-label">PAN Number</div>
                          <span className="font-monospace fw-semibold" style={{ background: 'rgba(99,102,241,0.10)', color: '#4338ca', padding: '3px 10px', borderRadius: 8, fontSize: 9 }}>XXXXXX89K</span>
                        </Col>
                        <Col md={3}><div className="ep-field-label">Name</div><div className="ep-field-value">{employee?.name || 'Aarav Kale'}</div></Col>
                        <Col md={3}><div className="ep-field-label">Date of Birth</div><div className="ep-field-value font-monospace">02-Nov-1985</div></Col>
                        <Col md={3}><div className="ep-field-label">Parent Name</div><div className="ep-field-value">Kiran Kale</div></Col>
                      </Row>

                      {/* Aadhaar Card sub-header */}
                      <div className="d-flex align-items-center justify-content-between gap-2 px-3 py-2 mb-2" style={{ background: 'rgba(10,179,156,0.08)', border: '1px solid rgba(10,179,156,0.20)', borderRadius: 8 }}>
                        <span className="fw-bold" style={{ color: '#0a8a78', fontSize: 12.5 }}>Aadhaar Card</span>
                        <span className="d-inline-flex align-items-center gap-1 fw-semibold" style={{ fontSize: 10, padding: '2px 8px', borderRadius: 999, background: 'rgba(16,185,129,0.12)', color: '#0a8a78', border: '1px solid rgba(16,185,129,0.30)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                          <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#10b981' }} /> Verified
                        </span>
                      </div>
                      <Row className="g-3">
                        <Col md={3}>
                          <div className="ep-field-label">Aadhaar Number</div>
                          <span className="font-monospace fw-semibold" style={{ background: 'rgba(99,102,241,0.10)', color: '#4338ca', padding: '3px 10px', borderRadius: 8, fontSize: 9 }}>XXXX-XXXX-2821</span>
                        </Col>
                        <Col md={3}><div className="ep-field-label">Enrollment No</div><div className="ep-field-value">147</div></Col>
                        <Col md={3}><div className="ep-field-label">Address</div><div className="ep-field-value">21 Jay Mahalar…</div></Col>
                        <Col md={3}><div className="ep-field-label">Gender</div><div className="ep-field-value">Male</div></Col>
                      </Row>
                    </div>
                  </div>
                </Col>
              </Row>

              <Row className="g-3 mb-3 align-items-stretch">
                <Col xl={6}>
                  <div className="ep-section-card-flat ep-section-card h-100 d-flex flex-column" style={{ borderTop: '3px solid #0ab39c' }}>
                    <div
                      className="d-flex align-items-center gap-3 px-3 py-2"
                      style={{
                        borderBottom: '1px solid rgba(10,179,156,0.18)',
                        background: 'linear-gradient(135deg, rgba(10,179,156,0.14) 0%, rgba(10,179,156,0.04) 60%, rgba(10,179,156,0.01) 100%)',
                      }}
                    >
                      <span className="ep-section-icon" style={{ background: 'rgba(10,179,156,0.18)', color: '#0a8a78' }}>
                        <i className="ri-map-pin-line" />
                      </span>
                      <h6 className="mb-0 fw-bold" style={{ fontSize: 12 }}>Address Proof</h6>
                    </div>
                    <div className="px-3 py-3 flex-grow-1">
                      <div className="d-flex align-items-center justify-content-between gap-2 px-3 py-2 mb-3" style={{ background: 'rgba(10,179,156,0.08)', border: '1px solid rgba(10,179,156,0.20)', borderRadius: 8 }}>
                        <span className="fw-bold" style={{ color: '#0a8a78', fontSize: 12.5 }}>Aadhaar Card (Address Proof)</span>
                        <span className="d-inline-flex align-items-center gap-1 fw-semibold" style={{ fontSize: 10, padding: '2px 8px', borderRadius: 999, background: 'rgba(16,185,129,0.12)', color: '#0a8a78', border: '1px solid rgba(16,185,129,0.30)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                          <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#10b981' }} /> Verified
                        </span>
                      </div>
                      <Row className="g-3">
                        <Col md={6}>
                          <div className="ep-field-label">Aadhaar Number</div>
                          <span className="font-monospace fw-semibold" style={{ background: 'rgba(99,102,241,0.10)', color: '#4338ca', padding: '3px 10px', borderRadius: 8, fontSize: 9 }}>XXXX-XXXX-2821</span>
                        </Col>
                        <Col md={6}><div className="ep-field-label">Enrollment No</div><div className="ep-field-value">147</div></Col>
                        <Col md={6}><div className="ep-field-label">Address</div><div className="ep-field-value">21 Jay Mahalar, Pune</div></Col>
                        <Col md={6}><div className="ep-field-label">Verification</div><div className="ep-field-value font-monospace">01-Jan-2024</div></Col>
                      </Row>
                    </div>
                  </div>
                </Col>
                <Col xl={6}>
                  <div className="ep-section-card-flat ep-section-card h-100 d-flex flex-column" style={{ borderTop: '3px solid #f59e0b' }}>
                    <div
                      className="d-flex align-items-center gap-3 px-3 py-2"
                      style={{
                        borderBottom: '1px solid rgba(245,158,11,0.20)',
                        background: 'linear-gradient(135deg, rgba(245,158,11,0.14) 0%, rgba(245,158,11,0.04) 60%, rgba(245,158,11,0.01) 100%)',
                      }}
                    >
                      <span className="ep-section-icon" style={{ background: 'rgba(245,158,11,0.18)', color: '#a16207' }}>
                        <i className="ri-shield-line" />
                      </span>
                      <h6 className="mb-0 fw-bold" style={{ fontSize: 12 }}>Statutory Information</h6>
                    </div>
                    <div className="px-3 py-3 flex-grow-1">
                      <span className="d-inline-flex align-items-center fw-semibold mb-3" style={{ fontSize: 10.5, padding: '3px 10px', borderRadius: 999, background: 'rgba(245,158,11,0.12)', color: '#a16207', border: '1px solid rgba(245,158,11,0.30)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        PT Details
                      </span>
                      <Row className="g-3">
                        <Col md={6}><div className="ep-field-label">State</div><div className="ep-field-value">Maharashtra</div></Col>
                        <Col md={6}><div className="ep-field-label">Registered Location</div><div className="ep-field-value">Maharashtra</div></Col>
                        <Col md={6}><div className="ep-field-label">PT Applicable</div><div className="ep-field-value">Yes</div></Col>
                        <Col md={6}><div className="ep-field-label">Professional Tax</div><div className="ep-field-value">₹200/month</div></Col>
                      </Row>
                    </div>
                  </div>
                </Col>
              </Row>
            </>
          )}

          {payrollTab === 'details' && (
            <>
              <Row className="g-3 mb-3 align-items-stretch">
                <Col xl={5}>
                  <div
                    className="ep-section-card-flat ep-section-card h-100 d-flex flex-column"
                    style={{
                      background: 'linear-gradient(135deg, #064e3b, #065f46, #059669)',
                      color: '#fff', padding: '14px 18px',
                      position: 'relative', overflow: 'hidden',
                      border: 'none',
                    }}
                  >
                    <div style={{ position: 'absolute', top: -30, right: -20, width: 130, height: 130, borderRadius: '50%', background: 'rgba(255,255,255,0.08)', pointerEvents: 'none' }} />
                    <div style={{ position: 'relative', flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                      <div>
                        <p className="mb-1" style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.10em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.78)' }}>Current Compensation</p>
                        <h2 className="mb-0 fw-bold text-white" style={{ fontSize: 28, lineHeight: 1.1 }}>
                          {realAnnualCtc > 0 ? `₹${fmtRupee(realAnnualCtc)}` : '— Not set'}
                        </h2>
                        <p className="mb-0 mt-1" style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.80)' }}>
                          Per Annum{salaryStruct ? '' : (realAnnualCtc > 0 ? ' (from annual salary)' : '')}
                        </p>
                      </div>
                      <div className="d-flex gap-3 mt-3 pt-2" style={{ borderTop: '1px solid rgba(255,255,255,0.18)' }}>
                        <div>
                          <p className="mb-1" style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.72)' }}>Monthly</p>
                          <h6 className="mb-0 text-white fw-bold" style={{ fontSize: 12 }}>₹{fmtRupee(realMonthlyGross)}</h6>
                        </div>
                        <div className="ps-3" style={{ borderLeft: '1px solid rgba(255,255,255,0.18)' }}>
                          <p className="mb-1" style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.72)' }}>{salaryStruct ? `Structure v${salaryStruct.version ?? 1}` : 'Source'}</p>
                          <h6 className="mb-0 text-white fw-bold" style={{ fontSize: 12 }}>{salaryStruct ? 'Active' : (realAnnualCtc > 0 ? 'Annual' : 'None')}</h6>
                        </div>
                      </div>
                    </div>
                  </div>
                </Col>
                <Col xl={7}>
                  <div className="ep-section-card-flat ep-section-card h-100 d-flex flex-column" style={{ borderTop: '3px solid #6366f1' }}>
                    <div
                      className="d-flex align-items-center gap-3 px-3 py-2"
                      style={{
                        borderBottom: '1px solid rgba(99,102,241,0.18)',
                        background: 'linear-gradient(135deg, rgba(99,102,241,0.14) 0%, rgba(99,102,241,0.04) 60%, rgba(99,102,241,0.01) 100%)',
                      }}
                    >
                      <span className="ep-section-icon" style={{ background: 'rgba(99,102,241,0.18)', color: '#4338ca' }}>
                        <i className="ri-briefcase-line" />
                      </span>
                      <h6 className="mb-0 fw-bold" style={{ fontSize: 12 }}>Payroll Info</h6>
                    </div>
                    <div className="px-3 py-3 flex-grow-1">
                      <Row className="g-3">
                        <Col md={4}><div className="ep-field-label">Legal Entity</div><div className="ep-field-value">INORBVICT Healthcare India Pvt. Ltd.</div></Col>
                        <Col md={4}><div className="ep-field-label">Remuneration Type</div><div className="ep-field-value">Annual</div></Col>
                        <Col md={4}><div className="ep-field-label">Pay Cycle</div><div className="ep-field-value">Monthly</div></Col>
                        <Col md={4}><div className="ep-field-label">Payroll Status</div><div className="ep-field-value">Active</div></Col>
                        <Col md={4}><div className="ep-field-label">Tax Regime</div><div className="ep-field-value">New Regime (115BAC)</div></Col>
                        <Col md={4}><div className="ep-field-label">Pay Group</div><div className="ep-field-value">Default</div></Col>
                      </Row>
                    </div>
                  </div>
                </Col>
              </Row>

              <div
                className="d-flex align-items-center gap-2 mb-3"
                style={{ padding: '12px 16px', borderRadius: 12, background: '#fff7e6', border: '1px solid #fbcf8a', color: '#a4661c', fontSize: 13 }}
              >
                <i className="ri-information-line" style={{ fontSize: 16 }} />
                <span>Income and tax liability is being computed as per <strong>New Tax Regime</strong>. To switch to Old Tax Regime, contact your HR admin.</span>
              </div>

              <div
                className="ep-section-card-flat ep-section-card mb-3"
                style={{ borderTop: '3px solid #0ab39c' }}
              >
                <div
                  className="d-flex align-items-center justify-content-between gap-3 px-3 py-2"
                  style={{
                    borderBottom: '1px solid rgba(10,179,156,0.18)',
                    background: 'linear-gradient(135deg, rgba(10,179,156,0.14) 0%, rgba(10,179,156,0.04) 60%, rgba(10,179,156,0.01) 100%)',
                  }}
                >
                  <div className="d-flex align-items-center gap-2">
                    <span className="ep-section-icon" style={{ background: 'rgba(10,179,156,0.18)', color: '#0a8a78' }}>
                      <i className="ri-line-chart-line" />
                    </span>
                    <h6 className="mb-0 fw-bold" style={{ fontSize: 12 }}>Salary Timeline</h6>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSalaryModalOpen(true)}
                    className="d-inline-flex align-items-center gap-1 fw-semibold"
                    style={{
                      background: 'linear-gradient(135deg,#0a8a78,#0ab39c)',
                      color: '#fff',
                      border: 'none',
                      borderRadius: 999,
                      padding: '6px 16px',
                      fontSize: 12,
                      cursor: 'pointer',
                      boxShadow: '0 4px 12px rgba(10,138,120,0.32)',
                    }}
                  >
                    <i className="ri-edit-line" style={{ fontSize: 13 }} /> Revise Salary
                  </button>
                </div>
                <div className="px-3 py-2 position-relative">
                  {/* Vertical guide line connecting the timeline dots */}
                  <span style={{
                    position: 'absolute',
                    left: 25, top: 22, bottom: 22,
                    width: 2,
                    background: 'var(--vz-border-color)',
                    pointerEvents: 'none',
                  }} />
                  {realTimeline.length === 0 && (
                    <div className="text-muted text-center py-3" style={{ fontSize: 12.5 }}>
                      No salary revisions recorded yet — use <strong>Revise Salary</strong> to set one.
                    </div>
                  )}
                  {realTimeline.map((row, idx) => (
                    <div
                      key={row.id}
                      className="d-flex align-items-center gap-3 py-2 flex-wrap position-relative"
                    >
                      {/* Timeline dot */}
                      <span
                        className="d-inline-flex align-items-center justify-content-center rounded-circle flex-shrink-0"
                        style={{
                          width: 18, height: 18,
                          background: row.current ? '#0ab39c' : 'var(--vz-card-bg)',
                          border: row.current ? '3px solid #fff' : '2px solid var(--vz-border-color)',
                          boxShadow: row.current ? '0 0 0 3px #0ab39c, 0 0 0 6px rgba(10,179,156,0.18)' : 'none',
                          position: 'relative', zIndex: 1,
                        }}
                      >
                        {!row.current && <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--vz-border-color)' }} />}
                      </span>

                      {/* Row body — current row gets the soft green → white gradient */}
                      <div
                        className="d-flex align-items-center gap-3 flex-grow-1 flex-wrap"
                        style={{
                          background: row.current
                            ? 'linear-gradient(90deg, rgba(10,179,156,0.10) 0%, rgba(10,179,156,0.02) 60%, transparent 100%)'
                            : 'transparent',
                          border: row.current ? '1px solid rgba(10,179,156,0.30)' : '1px solid transparent',
                          borderRadius: 10,
                          padding: '8px 12px',
                        }}
                      >
                        <div className="flex-grow-1 min-w-0">
                          <div className="d-flex align-items-center gap-2 flex-wrap">
                            <p className="mb-0 text-uppercase fw-semibold" style={{ color: 'var(--vz-secondary-color)', letterSpacing: '0.06em', fontSize: 10.5 }}>SALARY REVISION</p>
                            {row.current && (
                              <span
                                className="d-inline-flex align-items-center fw-bold text-uppercase"
                                style={{
                                  background: 'linear-gradient(135deg,#0a8a78,#0ab39c)',
                                  color: '#fff',
                                  fontSize: 9,
                                  letterSpacing: '0.08em',
                                  padding: '2px 8px',
                                  borderRadius: 999,
                                  boxShadow: '0 2px 6px rgba(10,138,120,0.32)',
                                }}
                              >
                                CURRENT
                              </span>
                            )}
                          </div>
                          <small style={{ color: 'var(--vz-secondary-color)', fontSize: 11.5 }}>
                            Effective <span className="fw-semibold" style={{ color: 'var(--vz-body-color)' }}>{row.dateShort}</span>
                          </small>
                        </div>
                        <div className="text-end">
                          <p className="mb-0 text-uppercase fw-semibold" style={{ color: 'var(--vz-secondary-color)', letterSpacing: '0.06em', fontSize: 9.5 }}>Regular Salary</p>
                          <div className="fw-bold" style={{ fontSize: 13, color: 'var(--vz-body-color)' }}>₹{row.annual.toLocaleString('en-IN')}</div>
                        </div>
                        <span style={{ color: 'var(--vz-secondary-color)', fontSize: 14 }}>=</span>
                        <div className="text-end">
                          <p className="mb-0 text-uppercase fw-semibold" style={{ color: 'var(--vz-secondary-color)', letterSpacing: '0.06em', fontSize: 9.5 }}>Total</p>
                          <div className="fw-bold" style={{ fontSize: 13, color: '#0a8a78' }}>₹{row.annual.toLocaleString('en-IN')}</div>
                        </div>
                        <button
                          type="button"
                          className="d-inline-flex align-items-center fw-semibold"
                          style={{
                            background: '#fff',
                            color: '#374151',
                            border: '1px solid var(--vz-border-color)',
                            borderRadius: 999,
                            padding: '5px 14px',
                            fontSize: 11.5,
                            cursor: 'pointer',
                          }}
                          onClick={() => { setBreakdownRowId(row.id); setBreakdownOpen(true); }}
                        >
                          View Breakdown
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </>
      )}

      {/* ── Tab: Expense Details ── */}
      {tab === 'expense' && (
        <>
          {/* Expense Overview hero — same shape as Evidence Vault / Payroll Summary. */}
          <Card className="mb-3 border-0" style={{ borderRadius: 14, overflow: 'hidden' }}>
            <div
              style={{
                background: 'linear-gradient(135deg,#0f0c29 0%,#1e1b4b 30%,#312e81 65%,#4338ca 100%)',
                color: '#fff',
                padding: '12px 18px',
                position: 'relative',
                overflow: 'hidden',
              }}
            >
              <div style={{ position: 'absolute', top: -50, right: -40, width: 200, height: 200, borderRadius: '50%', background: 'rgba(255,255,255,0.06)', pointerEvents: 'none' }} />
              <Row className="align-items-center g-2" style={{ position: 'relative' }}>
                <Col xs="auto">
                  <span className="d-inline-flex align-items-center justify-content-center rounded-3" style={{ width: 38, height: 38, background: 'rgba(255,255,255,0.22)', border: '1px solid rgba(255,255,255,0.30)' }}>
                    <i className="ri-wallet-3-line" style={{ fontSize: 17, color: '#fff' }} />
                  </span>
                </Col>
                <Col className="min-w-0">
                  <p className="mb-0 text-uppercase fw-semibold" style={{ color: 'rgba(255,255,255,0.72)', letterSpacing: '0.06em', fontSize: 9.5 }}>
                    {expenseModuleTab === 'advance' ? 'Advance Overview' : 'Expense Overview'}
                  </p>
                  <div className="text-white" style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.25 }}>
                    {expenseModuleTab === 'advance' ? 'Total Requested' : 'Total Claimed'}:{' '}
                    <span style={{ color: '#bce8ff' }}>
                      ₹{(expenseModuleTab === 'advance'
                          ? activeAdvancesSource.reduce((s, a) => s + Number(a.amount || 0), 0)
                          : totalClaimed
                        ).toLocaleString('en-IN')}
                    </span>
                  </div>
                  <small style={{ color: 'rgba(255,255,255,0.70)', fontSize: 10.5 }}>
                    {expenseModuleTab === 'advance'
                      ? `${advanceCounts.all} advances · ${advanceCounts.approved} approved · ${advanceCounts.pending} pending`
                      : `${expenseCounts.all} claims · ${expenseCounts.approved} approved · ${expenseCounts.pending} pending`}
                  </small>
                </Col>
                <Col xs="12" lg="auto">
                  <div className="d-flex gap-1 flex-wrap justify-content-lg-end">
                    {(() => {
                      // Counts switch with the active module so the KPI strip
                      // reflects whatever the user is currently viewing
                      // (expense claims vs advance requests).
                      const c = expenseModuleTab === 'advance' ? advanceCounts : expenseCounts;
                      return [
                        { key: 'all'      as ExpenseFilter, label: 'Total',    value: c.all,      color: '#fff'    },
                        { key: 'approved' as ExpenseFilter, label: 'Approved', value: c.approved, color: '#86efac' },
                        { key: 'pending'  as ExpenseFilter, label: 'Pending',  value: c.pending,  color: '#fcd34d' },
                        { key: 'rejected' as ExpenseFilter, label: 'Rejected', value: c.rejected, color: '#fca5a5' },
                      ];
                    })().map(c => {
                      // Tiles double as filter toggles — clicking "Approved"
                      // narrows the table to approved rows; clicking the
                      // already-active tile (or Total) restores All.
                      const on = expenseFilter === c.key;
                      return (
                        <button
                          key={c.label}
                          type="button"
                          onClick={() => setExpenseFilter(on && c.key !== 'all' ? 'all' : c.key)}
                          className="text-center border-0"
                          style={{
                            background: on ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.10)',
                            outline: on ? '1px solid rgba(255,255,255,0.45)' : '1px solid rgba(255,255,255,0.18)',
                            borderRadius: 9,
                            padding: '4px 10px',
                            minWidth: 72,
                            cursor: 'pointer',
                            transition: 'background .15s ease',
                          }}
                        >
                          <p className="mb-0 text-uppercase fw-semibold" style={{ color: 'rgba(255,255,255,0.72)', letterSpacing: '0.05em', fontSize: 8.5 }}>{c.label}</p>
                          <div className="fw-bold lh-1" style={{ color: c.color, fontSize: 13 }}>{c.value}</div>
                        </button>
                      );
                    })}
                  </div>
                </Col>
              </Row>
            </div>
          </Card>

          {/* Expense / Advance module switcher — sits between the hero
              overview and the section card so the user can flip between
              Expense Claims and Advance Requests without leaving the
              Expense Details tab. */}
          <Row className="g-2 mb-3">
            <Col xs={12}>
              <div
                className="d-flex"
                style={{
                  background: 'var(--vz-secondary-bg)',
                  border: '1px solid var(--vz-border-color)',
                  borderRadius: 9,
                  padding: 3,
                  gap: 3,
                }}
              >
                {[
                  { key: 'expense' as const, label: 'Expense Claims',    icon: 'ri-file-list-3-line',         activeBg: 'linear-gradient(135deg,#a855f7,#c084fc)', shadow: 'rgba(168,85,247,0.22)' },
                  { key: 'advance' as const, label: 'Advance Requests',  icon: 'ri-money-dollar-circle-line', activeBg: 'linear-gradient(135deg,#1e1b4b,#4338ca)', shadow: 'rgba(67,56,202,0.22)' },
                ].map(t => {
                  const on = expenseModuleTab === t.key;
                  return (
                    <button
                      key={t.key}
                      type="button"
                      onClick={() => setExpenseModuleTab(t.key)}
                      className="btn flex-grow-1 d-inline-flex align-items-center justify-content-center gap-2 fw-semibold"
                      style={{
                        borderRadius: 7,
                        padding: '5px 12px',
                        fontSize: 11.5,
                        background: on ? t.activeBg : 'transparent',
                        color: on ? '#fff' : 'var(--vz-secondary-color)',
                        border: 'none',
                        boxShadow: on ? `0 3px 8px ${t.shadow}` : 'none',
                      }}
                    >
                      <i className={t.icon} style={{ fontSize: 12 }} />
                      {t.label}
                    </button>
                  );
                })}
              </div>
            </Col>
          </Row>

          {/* Section card — header copy + counts swap based on the
              active module so the rest of the layout (search, Export,
              Raise New Claim, table) stays consistent. */}
          <div
            className="ep-section-card-flat ep-section-card mb-3"
            style={{ borderTop: expenseModuleTab === 'expense' ? '3px solid #a855f7' : '3px solid #4338ca' }}
          >
            <div
              className="d-flex align-items-center justify-content-between gap-3 px-3 py-2 flex-wrap"
              style={{
                borderBottom: expenseModuleTab === 'expense'
                  ? '1px solid rgba(168,85,247,0.18)'
                  : '1px solid rgba(67,56,202,0.18)',
                background: expenseModuleTab === 'expense'
                  ? 'linear-gradient(135deg, rgba(168,85,247,0.14) 0%, rgba(168,85,247,0.04) 60%, rgba(168,85,247,0.01) 100%)'
                  : 'linear-gradient(135deg, rgba(67,56,202,0.14) 0%, rgba(67,56,202,0.04) 60%, rgba(67,56,202,0.01) 100%)',
              }}
            >
              <div className="d-flex align-items-center gap-2">
                <span className="ep-section-icon" style={{
                  background: expenseModuleTab === 'expense' ? 'rgba(168,85,247,0.18)' : 'rgba(67,56,202,0.18)',
                  color: expenseModuleTab === 'expense' ? '#7c3aed' : '#4338ca',
                }}>
                  <i className={expenseModuleTab === 'expense' ? 'ri-file-list-3-line' : 'ri-money-dollar-circle-line'} />
                </span>
                <div>
                  <h6 className="mb-0 fw-bold" style={{ fontSize: 12 }}>
                    {expenseModuleTab === 'expense' ? 'Expense Claims' : 'Advance Requests'}
                  </h6>
                  <small className="text-muted" style={{ fontSize: 11 }}>
                    {expenseModuleTab === 'expense'
                      ? `${expenseCounts.all} total · ${expenseCounts.approved} approved · ${expenseCounts.pending} pending`
                      : `${apiAdvances.length} total · ${apiAdvances.filter(a => a.status === 'approved').length} approved · ${apiAdvances.filter(a => a.status === 'pending').length} pending`}
                  </small>
                </div>
              </div>
              <div className="d-flex align-items-center gap-2 flex-wrap">
                <div className="search-box" style={{ minWidth: 200 }}>
                  <input type="text" className="form-control form-control-sm" placeholder="Search…" style={{ fontSize: 12, height: 30 }} />
                  <i className="ri-search-line search-icon" style={{ fontSize: 12 }} />
                </div>
                {/* Export — text was hardcoded `#374151` which disappeared
                    against the dark card in dark mode. Theme variable now
                    drives both modes, with a small accent-tinted hover. */}
                <button
                  type="button"
                  className="btn btn-sm rounded-pill fw-semibold d-inline-flex align-items-center gap-1"
                  style={{
                    background: 'var(--vz-card-bg)',
                    color: 'var(--vz-body-color)',
                    border: '1px solid var(--vz-border-color)',
                    fontSize: 11.5, padding: '4px 12px',
                    transition: 'background .15s ease, border-color .15s ease, color .15s ease',
                  }}
                  onMouseEnter={e => {
                    const t = e.currentTarget;
                    t.style.background = 'rgba(168,85,247,0.10)';
                    t.style.borderColor = 'rgba(168,85,247,0.45)';
                    t.style.color = '#7c3aed';
                  }}
                  onMouseLeave={e => {
                    const t = e.currentTarget;
                    t.style.background = 'var(--vz-card-bg)';
                    t.style.borderColor = 'var(--vz-border-color)';
                    t.style.color = 'var(--vz-body-color)';
                  }}
                >
                  <i className="ri-download-2-line" /> Export
                </button>
                {/* Raise New Claim — inline styles can't carry :hover, so
                    we drive the brightening + lift via mouse handlers. */}
                <button
                  type="button"
                  className="btn btn-sm rounded-pill fw-semibold d-inline-flex align-items-center gap-1"
                  style={{
                    background: 'linear-gradient(135deg,#f97316,#fb923c)',
                    color: '#fff',
                    border: 'none',
                    boxShadow: '0 4px 10px rgba(249,115,22,0.28)',
                    fontSize: 11.5, padding: '4px 12px',
                    transition: 'transform .15s ease, box-shadow .15s ease, filter .15s ease',
                  }}
                  onMouseEnter={e => {
                    const t = e.currentTarget;
                    t.style.transform = 'translateY(-1px)';
                    t.style.boxShadow = '0 6px 14px rgba(249,115,22,0.45)';
                    t.style.filter = 'brightness(1.06)';
                  }}
                  onMouseLeave={e => {
                    const t = e.currentTarget;
                    t.style.transform = 'translateY(0)';
                    t.style.boxShadow = '0 4px 10px rgba(249,115,22,0.28)';
                    t.style.filter = 'none';
                  }}
                  onClick={() => {
                    // Open the unified modal in the right mode based on
                    // which list is currently visible.
                    setClaimMode(expenseModuleTab === 'advance' ? 'advance' : 'expense');
                    setClaimOpen(true);
                  }}
                >
                  <i className="ri-add-line" /> {expenseModuleTab === 'advance' ? 'New Advance Request' : 'Raise New Claim'}
                </button>
              </div>
            </div>
            <div className="px-3 pb-3 pt-2">
              {/* My / Team sub-tabs — only render when the current user is
                  viewing their own profile AND has a team (i.e. is someone's
                  reporting manager). For everyone else the table behaves as
                  a single-list view (the user's own claims/advances). The
                  labels, counts and active-state mirror whichever module
                  (Expense Claims vs Advance Requests) is currently open. */}
              {/* Visible whenever the user is a manager in *either* module —
                  approved/rejected rows stay in teamClaims/teamAdvances
                  (backend returns every row where manager_id = current user
                  regardless of status), so this toggle keeps the historic
                  track visible after the manager has acted. */}
              {isOwnProfile && (teamClaims.length > 0 || teamAdvances.length > 0) && (
                <div className="d-flex gap-1 mb-3" style={{
                  background: 'var(--vz-secondary-bg)', padding: 4, borderRadius: 10,
                  border: '1px solid var(--vz-border-color)', width: 'fit-content',
                }}>
                  {(expenseModuleTab === 'advance'
                    ? [
                        { key: 'mine' as const, label: 'My Advances',   icon: 'ri-user-line', count: apiAdvances.length },
                        { key: 'team' as const, label: 'Team Advances', icon: 'ri-team-line', count: teamAdvances.length },
                      ]
                    : [
                        { key: 'mine' as const, label: 'My Expenses',   icon: 'ri-user-line', count: apiClaims.length },
                        { key: 'team' as const, label: 'Team Expenses', icon: 'ri-team-line', count: teamClaims.length },
                      ]
                  ).map(t => {
                    const currentSub = expenseModuleTab === 'advance' ? advanceSubTab : expenseSubTab;
                    const on = currentSub === t.key;
                    const activeAccent = expenseModuleTab === 'advance' ? '#4338ca' : '#7c3aed';
                    const activeWash   = expenseModuleTab === 'advance' ? 'rgba(67,56,202,0.12)' : 'rgba(124,58,237,0.12)';
                    return (
                      <button
                        key={t.key}
                        type="button"
                        onClick={() => {
                          if (expenseModuleTab === 'advance') setAdvanceSubTab(t.key);
                          else                                setExpenseSubTab(t.key);
                        }}
                        className="d-inline-flex align-items-center gap-2 fw-semibold"
                        style={{
                          fontSize: 12,
                          padding: '5px 14px',
                          borderRadius: 8,
                          border: 'none',
                          background: on ? 'var(--vz-card-bg)' : 'transparent',
                          color: on ? activeAccent : 'var(--vz-secondary-color)',
                          boxShadow: on ? '0 2px 6px rgba(0,0,0,0.06)' : 'none',
                          cursor: 'pointer',
                        }}
                      >
                        <i className={t.icon} />
                        {t.label}
                        <span
                          className="d-inline-flex align-items-center justify-content-center rounded-pill"
                          style={{
                            minWidth: 18, height: 16, padding: '0 6px',
                            background: on ? activeWash : 'var(--vz-secondary-bg)',
                            color: on ? activeAccent : 'var(--vz-secondary-color)',
                            fontSize: 10, fontWeight: 700,
                          }}
                        >
                          {t.count}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Filter pills — active = solid filled with colored shadow for
                  strong visibility; inactive = subtle white with border. When
                  the Advance Requests module is active the same pills drive
                  filtering against `advanceCounts` instead of `expenseCounts`.
                  The Drafts pill is appended only when a saved-draft exists
                  in localStorage for the active module — clicking it swaps
                  the table area for a list of resumable drafts. */}
              <div className="d-flex gap-2 flex-wrap mb-3">
                {(() => {
                  const c = expenseModuleTab === 'advance' ? advanceCounts : expenseCounts;
                  const draftCount = expenseModuleTab === 'advance'
                    ? advanceDrafts.length
                    : expenseDrafts.length;
                  const base = [
                    { key: 'all'      as ExpenseFilter, label: 'All',      count: c.all,      active: '#6366f1', shadow: 'rgba(99,102,241,0.32)' },
                    { key: 'approved' as ExpenseFilter, label: 'Approved', count: c.approved, active: '#10b981', shadow: 'rgba(16,185,129,0.32)' },
                    { key: 'rejected' as ExpenseFilter, label: 'Rejected', count: c.rejected, active: '#ef4444', shadow: 'rgba(239,68,68,0.32)'  },
                    { key: 'pending'  as ExpenseFilter, label: 'Pending',  count: c.pending,  active: '#f59e0b', shadow: 'rgba(245,158,11,0.32)' },
                  ];
                  if (draftCount > 0) {
                    base.push({ key: 'draft' as ExpenseFilter, label: 'Drafts', count: draftCount, active: '#0ea5e9', shadow: 'rgba(14,165,233,0.32)' });
                  }
                  return base;
                })().map(f => {
                  const on = expenseFilter === f.key;
                  return (
                    <button
                      key={f.key}
                      type="button"
                      onClick={() => setExpenseFilter(f.key)}
                      className="btn d-inline-flex align-items-center gap-2 rounded-pill fw-semibold"
                      style={{
                        fontSize: 11.5,
                        padding: '4px 12px',
                        background: on ? f.active : 'var(--vz-card-bg)',
                        color: on ? '#fff' : 'var(--vz-secondary-color)',
                        border: `1px solid ${on ? f.active : 'var(--vz-border-color)'}`,
                        boxShadow: on ? `0 4px 10px ${f.shadow}` : 'none',
                        transition: 'all .15s ease',
                      }}
                    >
                      {f.label}
                      <span
                        className="d-inline-flex align-items-center justify-content-center rounded-pill"
                        style={{
                          minWidth: 20, height: 16,
                          padding: '0 6px',
                          background: on ? 'rgba(255,255,255,0.28)' : 'var(--vz-secondary-bg)',
                          color: on ? '#fff' : 'var(--vz-secondary-color)',
                          fontSize: 10, fontWeight: 700,
                        }}
                      >
                        {f.count}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Claims / Advances table — API-backed. Status pill replaces
                  the old Payment Action column; the 3-dot Action menu opens
                  the audit log popover (Created → Manager → HR/Finance).
                  When viewing Team rows as the assigned manager, inline
                  Approve/Reject buttons appear next to the menu. The
                  AdvanceRequestsTable mirror is rendered when the user
                  switches the module pill to "Advance Requests".

                  When the Drafts filter is active the table area is replaced
                  by a list of resumable drafts pulled from localStorage —
                  drafts aren't real rows so they can't share the same table
                  component. Each row offers Resume (reopens the modal with
                  the saved fields hydrated) and Discard (removes from
                  storage and refreshes the meta state). */}
              {expenseFilter === 'draft' ? (
                <DraftListView
                  module={expenseModuleTab}
                  expenseEntries={expenseDrafts}
                  advanceEntries={advanceDrafts}
                  onResume={(draftId) => {
                    setClaimMode(expenseModuleTab === 'advance' ? 'advance' : 'expense');
                    setEditingDraftId(draftId);
                    setResumeFromDraft(true);
                    setClaimOpen(true);
                  }}
                  onDiscard={(draftId) => {
                    try {
                      if (expenseModuleTab === 'advance') {
                        const next = advanceDrafts.filter(e => e.id !== draftId);
                        if (next.length) localStorage.setItem(advanceDraftKey, JSON.stringify(next));
                        else             localStorage.removeItem(advanceDraftKey);
                      } else {
                        const next = expenseDrafts.filter(e => e.id !== draftId);
                        if (next.length) localStorage.setItem(claimDraftKey, JSON.stringify(next));
                        else             localStorage.removeItem(claimDraftKey);
                      }
                    } catch { /* ignore */ }
                    readSavedDrafts();
                    toast.success('Draft discarded', 'The saved draft has been removed.');
                  }}
                />
              ) : expenseModuleTab === 'advance' ? (
                <AdvanceRequestsTable
                  rows={filteredAdvances}
                  loading={loadingAdvances}
                  accent={accent}
                  fallbackInitials={initials}
                  fallbackName={employee?.name || employeeId}
                  mode={advanceSubTab === 'team' ? 'team' : 'mine'}
                  currentEmployeeId={authUser?.employee_id ?? null}
                  onAct={actOnAdvance}
                />
              ) : (
                <ExpenseClaimsTable
                  rows={filteredExpenses}
                  loading={loadingClaims}
                  accent={accent}
                  fallbackInitials={initials}
                  fallbackName={employee?.name || employeeId}
                  mode={expenseSubTab === 'team' ? 'team' : 'mine'}
                  currentEmployeeId={authUser?.employee_id ?? null}
                  onAct={actOnClaim}
                />
              )}

              <div className="d-flex justify-content-between align-items-center flex-wrap gap-2 mt-3 pt-2 border-top">
                <small className="text-muted">
                  {expenseModuleTab === 'advance' ? (
                    <>Showing <strong className="text-body">{filteredAdvances.length}</strong> advance{filteredAdvances.length === 1 ? '' : 's'}</>
                  ) : (
                    <>Showing <strong className="text-body">{filteredExpenses.length}</strong> claim{filteredExpenses.length === 1 ? '' : 's'}</>
                  )}
                </small>
                <small className="text-muted d-inline-flex align-items-center gap-1">
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#10b981' }} />
                  Last updated: Apr 2026
                </small>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ── Tab: Leave (clean Keka-style flow) ──
           LeaveSummaryPanel owns the whole experience now: the "Request
           Leave" button at the top opens a compact modal, the Pending /
           History rows are clickable to open the read-only details modal,
           and the donut cards show per-type balances inline. The old
           7-stage ApplyLeavePanel wizard is no longer rendered — kept in
           the file for now in case we want to re-introduce a "detailed
           application" entry point later. */}
      {tab === 'apply_leave' && (
        <LeaveSummaryPanel employeeId={employeeId} canRequest={isOwnProfile} />
      )}

      {/* ── Hiring Requests tab — manager-only. Mirrors HrRecruitment's
           hiring-request surface (KPI strip + list table + Raise CTA),
           scoped to the requests THIS manager raised. Reuses the
           existing RaiseHiringRequestModal + HiringRequestsListModal
           components so the create form, validation and list filters
           stay in one place. */}
      {tab === 'hiring' && isOwnProfile && (isManager || ['branch_user', 'client_admin', 'super_admin'].includes(String(authUser?.user_type || ''))) && (() => {
        const stats = {
          total:     hiringRequests.length,
          draft:     hiringRequests.filter((r: any) => r.status === 'Draft').length,
          submitted: hiringRequests.filter((r: any) => r.status === 'Submitted').length,
          critical:  hiringRequests.filter((r: any) => r.urgency === 'Critical').length,
        };
        const fmtDate = (raw: any): string => {
          if (!raw) return '—';
          const d = new Date(String(raw));
          if (Number.isNaN(d.getTime())) return '—';
          return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
        };
        const urgencyTone = (u?: string) => {
          switch ((u || '').toLowerCase()) {
            case 'critical': return { bg: 'rgba(239,68,68,0.14)',  fg: '#b91c1c' };
            case 'high':     return { bg: 'rgba(249,115,22,0.14)', fg: '#c2410c' };
            case 'medium':   return { bg: 'rgba(245,158,11,0.14)', fg: '#92400e' };
            default:         return { bg: 'rgba(16,185,129,0.14)', fg: '#047857' };
          }
        };
        const statusTone = (s?: string) => {
          switch ((s || '').toLowerCase()) {
            case 'draft':     return { bg: 'rgba(115,115,115,0.14)', fg: '#525252' };
            case 'submitted': return { bg: 'rgba(124,58,237,0.14)',  fg: '#6d28d9' };
            case 'approved':  return { bg: 'rgba(16,185,129,0.14)',  fg: '#047857' };
            case 'rejected':  return { bg: 'rgba(239,68,68,0.14)',   fg: '#b91c1c' };
            default:          return { bg: 'rgba(99,102,241,0.14)',  fg: '#4338ca' };
          }
        };
        return (
          <Card className="mb-3 border-0" style={{ borderRadius: 14 }}>
            <CardBody>
              {/* Header — title + Raise CTA + View All */}
              <div className="d-flex align-items-center justify-content-between flex-wrap gap-2 mb-3">
                <div className="d-flex align-items-center gap-2">
                  <span className="d-inline-flex align-items-center justify-content-center rounded-3"
                    style={{ width: 38, height: 38, background: 'linear-gradient(135deg,#0ea5e9,#6366f1)', color: '#fff' }}>
                    <i className="ri-user-add-line" style={{ fontSize: 18 }} />
                  </span>
                  <div>
                    <h6 className="mb-0 fw-bold" style={{ fontSize: 14 }}>Hiring Requests</h6>
                    <small className="text-muted" style={{ fontSize: 11.5 }}>
                      {(() => {
                        const seesAll = ['branch_user', 'client_admin', 'super_admin']
                          .includes(String(authUser?.user_type || ''));
                        if (seesAll) return `All hiring requests across the organisation · ${hiringRequests.length} total`;
                        return `Raise hires for your team · ${teamSize} direct report${teamSize === 1 ? '' : 's'}`;
                      })()}
                    </small>
                  </div>
                </div>
                <div className="d-flex align-items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    className="btn d-inline-flex align-items-center gap-2 fw-semibold"
                    onClick={() => setRaiseHiringOpen(true)}
                    style={{
                      background: 'linear-gradient(135deg,#0ea5e9,#6366f1)', color: '#fff',
                      border: 'none', fontSize: 12, padding: '7px 14px', borderRadius: 999,
                      boxShadow: '0 4px 12px rgba(99,102,241,0.28)',
                    }}
                  >
                    <i className="ri-file-add-line" /> Raise Hiring Request
                  </button>
                </div>
              </div>

              {/* KPI strip — matches the recruitment KPI shape (top accent
                  strip + label/number + iconTile). Scoped to this manager's
                  own raised requests. */}
              <Row className="g-3 mb-3 align-items-stretch">
                {[
                  { label: 'Total',     value: stats.total,     icon: 'ri-file-list-3-line', accent: 'linear-gradient(135deg,#4338ca 0%,#6366f1 60%,#818cf8 100%)', deep: '#4338ca' },
                  { label: 'Draft',     value: stats.draft,     icon: 'ri-draft-line',       accent: 'linear-gradient(135deg,#525252 0%,#737373 60%,#a3a3a3 100%)', deep: '#525252' },
                  { label: 'Submitted', value: stats.submitted, icon: 'ri-send-plane-line',  accent: 'linear-gradient(135deg,#7c3aed 0%,#9333ea 60%,#a855f7 100%)', deep: '#7c3aed' },
                  { label: 'Critical',  value: stats.critical,  icon: 'ri-flashlight-line',  accent: 'linear-gradient(135deg,#be123c 0%,#ef4444 60%,#fb7185 100%)', deep: '#be123c' },
                ].map(k => (
                  <Col key={k.label} xl={3} md={6} sm={6} xs={12}>
                    <div
                      className="ep-hr-kpi"
                      style={{
                        position: 'relative', overflow: 'hidden',
                        border: '1px solid var(--vz-border-color)', borderRadius: 12,
                        background: 'var(--vz-card-bg)', padding: '14px 16px',
                        height: '100%',
                        transition: 'transform 180ms ease, box-shadow 180ms ease, border-color 180ms ease',
                        cursor: 'default',
                      }}
                    >
                      <span style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: k.accent }} />
                      <div className="d-flex align-items-start justify-content-between gap-2">
                        <div className="min-w-0">
                          <p className="mb-1 text-uppercase fw-semibold" style={{ color: 'var(--vz-secondary-color)', letterSpacing: '0.06em', fontSize: 10.5 }}>
                            {k.label}
                          </p>
                          {hiringLoading
                            ? <Shimmer height={26} width={48} />
                            : <h3 className="mb-0 fw-bold" style={{ fontSize: 24, color: k.deep, fontVariantNumeric: 'tabular-nums' }}>{k.value}</h3>}
                        </div>
                        <span className="ep-hr-kpi-icon d-inline-flex align-items-center justify-content-center rounded-3"
                          style={{ width: 40, height: 40, background: k.accent, color: '#fff', transition: 'transform 180ms ease' }}>
                          <i className={k.icon} style={{ fontSize: 18 }} />
                        </span>
                      </div>
                    </div>
                  </Col>
                ))}
              </Row>
              {/* Hover polish for the four KPI tiles — lift + shadow halo
                  matched to the tile's accent. Reads "interactive" without
                  actually clicking through; the figures themselves are the
                  source of truth, so a click target would be misleading. */}
              <style>{`
                .ep-hr-kpi:hover {
                  transform: translateY(-2px);
                  box-shadow: 0 12px 26px rgba(99,102,241,0.16), 0 4px 10px rgba(15,23,42,0.08);
                  border-color: rgba(99,102,241,0.40) !important;
                }
                .ep-hr-kpi:hover .ep-hr-kpi-icon {
                  transform: scale(1.06) rotate(-2deg);
                }
                [data-bs-theme="dark"] .ep-hr-kpi:hover {
                  box-shadow: 0 12px 26px rgba(124,92,252,0.22), 0 4px 10px rgba(0,0,0,0.40);
                  border-color: rgba(124,92,252,0.50) !important;
                }
              `}</style>

              {/* Inline list — compact 5-row preview of recent requests.
                  Full filtering / pagination lives behind View All Requests. */}
              <div className="table-responsive border rounded">
                <table className="table align-middle table-nowrap mb-0">
                  <thead className="table-light">
                    <tr>
                      <th className="ps-3">Code</th>
                      <th>Position</th>
                      <th>Department</th>
                      <th>Urgency</th>
                      <th>Status</th>
                      <th>Submitted</th>
                    </tr>
                  </thead>
                  <tbody>
                    {hiringLoading ? (
                      <ShimmerTableRows rows={4} cols={6} keyPrefix="hr-req-shim" />
                    ) : hiringRequests.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="text-center py-4 text-muted" style={{ fontSize: 12.5 }}>
                          <i className="ri-inbox-line" style={{ fontSize: 26, display: 'block', marginBottom: 6 }} />
                          You haven't raised any hiring requests yet.
                        </td>
                      </tr>
                    ) : hiringRequests.map((r: any) => {
                      const uTone = urgencyTone(r.urgency);
                      // Once HR has converted this hiring request into a
                      // recruitment row, surface that as the status (it's
                      // the "next" step in the pipeline and carries more
                      // information than the original Submitted/Draft
                      // value). Falls back to the row's own status for
                      // requests still sitting in the queue.
                      const displayStatus = r._hasRecruitment ? 'Recruitment Created' : (r.status || '—');
                      const sTone = r._hasRecruitment
                        ? { bg: 'rgba(16,185,129,0.16)', fg: '#047857' }
                        : statusTone(r.status);
                      return (
                        <tr key={r.id}>
                          <td className="ps-3 fw-semibold" style={{ fontSize: 12 }}>
                            <span style={{
                              background: 'rgba(99,102,241,0.10)', color: '#4338ca',
                              padding: '2px 8px', borderRadius: 6, fontFamily: 'monospace',
                            }}>{r.code || `HR-${r.id}`}</span>
                          </td>
                          <td style={{ fontSize: 12.5 }}>{r.position || r.job_role || r.role_name || '—'}</td>
                          <td style={{ fontSize: 12.5, color: 'var(--vz-secondary-color)' }}>{r.department?.name || r.department_name || '—'}</td>
                          <td>
                            <span style={{
                              padding: '2px 10px', borderRadius: 999, fontWeight: 600,
                              background: uTone.bg, color: uTone.fg, fontSize: 10.5,
                            }}>{r.urgency || '—'}</span>
                          </td>
                          <td>
                            <span style={{
                              padding: '2px 10px', borderRadius: 999, fontWeight: 600,
                              background: sTone.bg, color: sTone.fg, fontSize: 10.5,
                              display: 'inline-flex', alignItems: 'center', gap: 4,
                            }}>
                              {r._hasRecruitment && <i className="ri-checkbox-circle-fill" style={{ fontSize: 11 }} />}
                              {displayStatus}
                            </span>
                          </td>
                          <td style={{ fontSize: 11.5, color: 'var(--vz-secondary-color)', fontVariantNumeric: 'tabular-nums' }}>
                            {fmtDate(r.submittedAt || r.created_at)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {!hiringLoading && hiringRequests.length > 0 && (
                <div className="d-flex justify-content-between align-items-center mt-2 pt-2 border-top">
                  <small className="text-muted" style={{ fontSize: 11.5 }}>
                    Showing <strong>{hiringRequests.length}</strong> request{hiringRequests.length === 1 ? '' : 's'}
                  </small>
                </div>
              )}
            </CardBody>
          </Card>
        );
      })()}

      </div>
    </div>

    {/* ── Attendance Regularization Modal ── */}
    <EpModal open={regOpen} onClose={() => setRegOpen(false)} size="md" panelClassName="ep-reg-modal">

        <div className="ep-reg-header">
          <h5>Request Attendance Regularization</h5>
          {/* No top-right X — footer has Cancel; one dismiss path. */}
        </div>

        <div style={{ padding: '20px 22px', overflowY: 'auto', flex: '1 1 auto' }}>
          {/* Selected Date */}
          <div className="mb-3">
            <div className="ep-reg-label">Selected Date</div>
            <input className="ep-reg-input" value={regSelectedDate} readOnly />
          </div>

          {/* Radio options */}
          <div className="d-flex flex-column gap-2 mb-2">
            <label className={`ep-reg-radio${regOption === 'adjust' ? ' is-on' : ''}`}>
              <span className="ep-reg-radio-dot" />
              <input
                type="radio"
                checked={regOption === 'adjust'}
                onChange={() => setRegOption('adjust')}
                style={{ display: 'none' }}
              />
              <span>Add/update time entries to adjust attendance logs.</span>
            </label>
            <label className={`ep-reg-radio${regOption === 'exempt' ? ' is-on' : ''}`}>
              <span className="ep-reg-radio-dot" />
              <input
                type="radio"
                checked={regOption === 'exempt'}
                onChange={() => setRegOption('exempt')}
                style={{ display: 'none' }}
              />
              <span>Raise regularization request to exempt this day from penalization policy.</span>
            </label>
          </div>
          <small className="text-muted d-block mb-3" style={{ fontSize: 12 }}>
            Click and select time stamp box that you would like to adjust and make changes to the time
          </small>

          {regOption === 'adjust' && (
            <>
              {/* Attendance Adjustment header + Add Log */}
              <div className="d-flex align-items-center justify-content-between mb-2">
                <h6 className="mb-0 fw-bold" style={{ fontSize: 12 }}>Attendance Adjustment</h6>
                <button
                  type="button"
                  className="ep-reg-add-btn"
                  onClick={() => setRegLogs(prev => [...prev, { id: `log-${Date.now()}`, from: '', to: '' }])}
                >
                  <i className="ri-add-line" /> Add Log
                </button>
              </div>

              {/* Work Location */}
              <div className="d-flex align-items-center justify-content-between mb-1">
                <div className="ep-reg-label" style={{ marginBottom: 0 }}>
                  Work Location <span style={{ color: '#ef4444' }}>*</span>
                </div>
                <small className="text-muted" style={{ fontSize: 11 }}>Select all that apply</small>
              </div>
              {regLocations.length > 0 && (
                <div className="d-flex flex-wrap gap-2 mb-2">
                  {regLocations.map(loc => (
                    <span key={loc} className="ep-reg-chip">
                      <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#6366f1' }} />
                      {loc}
                      <i
                        className="ri-close-line ep-reg-chip-x"
                        onClick={() => setRegLocations(prev => prev.filter(l => l !== loc))}
                      />
                    </span>
                  ))}
                </div>
              )}
              <div className="mb-1">
                <MasterSelect
                  value={regLocationDraft}
                  placeholder="— Select location —"
                  options={REG_LOCATION_OPTIONS.filter(o => !regLocations.includes(o)).map(o => ({ value: o, label: o }))}
                  onChange={(v) => {
                    if (v && !regLocations.includes(v)) {
                      setRegLocations(prev => [...prev, v]);
                    }
                    setRegLocationDraft('');
                  }}
                />
              </div>
              <small className="text-muted d-block mb-3" style={{ fontSize: 11 }}>
                Select your work location(s) for this correction request
              </small>

              {/* Time-entry rows */}
              <div className="d-flex flex-column gap-2 mb-3">
                {regLogs.map(log => (
                  <div className="ep-reg-log-row" key={log.id}>
                    <i className="ri-checkbox-circle-fill" style={{ color: '#10b981', fontSize: 18 }} />
                    <input
                      type="text"
                      className="ep-reg-time-input"
                      value={log.from}
                      onChange={e => setRegLogs(prev => prev.map(l => l.id === log.id ? { ...l, from: e.target.value } : l))}
                      placeholder="00:00"
                    />
                    <i className="ri-time-line ep-reg-log-icon" />
                    <i className="ri-time-line ep-reg-log-icon" />
                    <i className="ri-arrow-right-up-line ep-reg-log-arrow" />
                    <input
                      type="text"
                      className="ep-reg-time-input"
                      value={log.to}
                      onChange={e => setRegLogs(prev => prev.map(l => l.id === log.id ? { ...l, to: e.target.value } : l))}
                      placeholder="00:00"
                    />
                    <i className="ri-time-line ep-reg-log-icon" />
                    <i className="ri-time-line ep-reg-log-icon" />
                    <button
                      type="button"
                      className="ep-reg-log-remove"
                      onClick={() => setRegLogs(prev => prev.filter(l => l.id !== log.id))}
                      aria-label="Remove log"
                    >
                      <i className="ri-subtract-line" />
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* Note */}
          <div>
            <h6 className="fw-bold mb-2" style={{ fontSize: 14 }}>Note</h6>
            <textarea
              className="ep-reg-textarea"
              placeholder="Enter note"
              rows={3}
              value={regNote}
              onChange={e => setRegNote(e.target.value)}
            />
          </div>
        </div>

        <div className="ep-reg-footer">
          <button type="button" className="ep-reg-cancel" onClick={() => setRegOpen(false)}>
            Cancel
          </button>
          <button
            type="button"
            className="ep-reg-submit"
            onClick={() => { setRegOpen(false); }}
          >
            Request
          </button>
        </div>
      </EpModal>

      {/* ── Payslip Viewer Modal ── */}
      {/* Payslip viewer — real data via the shared PayslipViewerModal
          (replaces the old inline mock). Driven by the employee's real
          payslip history + the rendered PDF. */}
      <PayslipViewerModal
        open={paySlipOpen}
        onClose={() => { setPaySlipOpen(false); setViewSlip(null); }}
        employee={{
          name: empDetail?.display_name || employee?.name || String(employeeId),
          empId: empDetail?.emp_code || String(employeeId),
          designation: empDetail?.designation_name || empDetail?.designation || '—',
          department: empDetail?.department_name || empDetail?.department || '—',
        }}
        defaultMonth={viewSlip?.month || 'March'}
        defaultYear={viewSlip?.year || String(new Date().getFullYear())}
        earnings={viewSlip?.earnings || []}
        deductions={viewSlip?.deductions || []}
        workingDays={viewSlip?.working}
        daysPresent={viewSlip?.present}
        paidDays={viewSlip?.paid}
        lossOfPay={viewSlip?.lop}
        isFinal={viewSlip?.isFinal}
        payslipId={viewSlip?.id}
        recentMonths={payslipHistory.map((s: any, i: number) => ({ label: s.label, now: i === 0, payslipId: s.payslip_id, status: s.status }))}
        onSelectRecent={(e: any) => loadSlip(e.payslipId, e.label)}
        companyName={viewSlip?.company?.name || undefined}
        companyMeta={viewSlip?.company?.address || undefined}
        companyInitials={viewSlip?.company?.initials || undefined}
        hrEmail={viewSlip?.company?.hr_email || undefined}
      />

      {/* Revise Salary uses the real SalaryStructureModal (rendered above); old mock modal removed. */}

      {/* ── Salary Breakdown Modal ── */}
      <EpModal open={breakdownOpen} onClose={() => setBreakdownOpen(false)} size="lg" panelClassName="ep-bd-modal">
        <div className="ep-bd-hero">
          <div className="d-flex align-items-start justify-content-between gap-3">
            <div>
              <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.10em', color: 'rgba(255,255,255,0.62)' }}>SALARY DETAILS</div>
              <h4 className="text-white fw-bold mb-1" style={{ fontSize: 20 }}>
                Salary Breakdown for{' '}
                <span style={{ color: '#86efac' }}>₹{breakdownRow.annual.toLocaleString('en-IN')} / Annum</span>
              </h4>
              <small style={{ color: 'rgba(255,255,255,0.78)', fontSize: 12 }}>
                Pay Group: <strong>Default</strong> · Structure: <strong>Class A</strong> · Effective: <strong>{breakdownRow.dateShort}</strong>
              </small>
            </div>
            <button type="button" className="ep-bd-close" onClick={() => setBreakdownOpen(false)} aria-label="Close">
              <i className="ri-close-line" style={{ fontSize: 18 }} />
            </button>
          </div>
        </div>

        <div className="ep-bd-body">
          <div className="ep-bd-main">
            <div className="ep-bd-card">
              <div className="d-flex align-items-center gap-2 px-3 py-2" style={{ borderBottom: '1px solid var(--vz-border-color)' }}>
                <span className="ep-rev-icon" style={{ background: 'linear-gradient(135deg,#0ab39c,#02c8a7)', width: 32, height: 32, fontSize: 16 }}>
                  <i className="ri-line-chart-line" />
                </span>
                <h6 className="mb-0 fw-bold" style={{ fontSize: 13 }}>Earnings Breakdown</h6>
              </div>
              <table className="ep-bd-table">
                <thead>
                  <tr>
                    <th>Component</th>
                    <th className="text-end">Monthly</th>
                    <th className="text-end">Annually</th>
                  </tr>
                </thead>
                <tbody>
                  {breakdownData.rows.map(r => (
                    <tr key={r.label}>
                      <td>{r.label}</td>
                      <td className="text-end font-monospace fw-semibold">₹{r.monthly.toLocaleString('en-IN')}</td>
                      <td className="text-end font-monospace fw-semibold">₹{r.annual.toLocaleString('en-IN')}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ background: 'rgba(16,185,129,0.06)' }}>
                    <td className="fw-bold" style={{ color: '#108548' }}>Total Earnings</td>
                    <td className="text-end fw-bold font-monospace" style={{ color: '#108548' }}>₹{breakdownData.totalMonthly.toLocaleString('en-IN')}</td>
                    <td className="text-end fw-bold font-monospace" style={{ color: '#108548' }}>₹{breakdownData.totalAnnual.toLocaleString('en-IN')}</td>
                  </tr>
                </tfoot>
              </table>

              <div className="ep-bd-net">
                <div>
                  <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.10em', color: 'rgba(255,255,255,0.78)' }}>AFTER TAX & DEDUCTIONS</div>
                  <h5 className="text-white fw-bold mb-0" style={{ fontSize: 16 }}>NET PAY</h5>
                </div>
                <div className="text-end">
                  <h2 className="text-white fw-bold mb-0" style={{ fontSize: 32 }}>₹{breakdownData.netPay.toLocaleString('en-IN')}</h2>
                  <small style={{ color: 'rgba(255,255,255,0.78)' }}>per month (estimated)</small>
                </div>
              </div>
            </div>

            <div className="ep-bd-note">
              <i className="ri-information-line" style={{ fontSize: 16, color: '#a16207', flexShrink: 0 }} />
              <div>
                <strong>Note:</strong> Net Pay excludes applicable taxes (TDS) and statutory deductions (PF, PT). Actual disbursement may vary based on declarations and investments.
              </div>
            </div>
          </div>

          {/* Version history */}
          <aside className="ep-bd-history">
            <div className="d-flex align-items-center gap-2 mb-3">
              <i className="ri-history-line" style={{ color: '#0ab39c' }} />
              <h6 className="mb-0 fw-bold">Version History</h6>
            </div>
            <div className="position-relative" style={{ paddingLeft: 22 }}>
              <div style={{ position: 'absolute', top: 12, bottom: 12, left: 8, width: 2, background: 'var(--vz-border-color)' }} />
              {(realTimeline.length ? realTimeline : SALARY_TIMELINE).map(s => {
                const active = s.id === breakdownRow.id;
                return (
                  <button
                    key={s.id}
                    type="button"
                    className={`ep-bd-version${active ? ' is-current' : ''}`}
                    onClick={() => setBreakdownRowId(s.id)}
                  >
                    <span className="ep-bd-dot" style={{ background: active ? '#0ab39c' : 'transparent', border: active ? 'none' : '2px solid var(--vz-border-color)' }}>
                      {active && <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#fff' }} />}
                    </span>
                    <div className="flex-grow-1 min-w-0 text-start">
                      <div className="d-flex align-items-center gap-2 mb-1">
                        <small className="fw-semibold">{s.dateShort}</small>
                        {s.current && <span className="ep-bd-now">CURRENT</span>}
                      </div>
                      <div className="fw-bold" style={{ color: active ? '#0a8a78' : 'var(--vz-body-color)' }}>
                        ₹{s.annual.toLocaleString('en-IN')}
                      </div>
                      <small className="text-muted">Per Annum</small>
                    </div>
                  </button>
                );
              })}
            </div>
          </aside>
        </div>
      </EpModal>

      {/* ── Submit New Expense Claim / Advance Request Modal ── */}
      <EpModal open={claimOpen} onClose={() => setClaimOpen(false)} size="xl" panelClassName={`ep-claim-modal ${claimMode === 'expense' ? 'is-expense' : 'is-advance'}`}>
        {/* Hero header */}
        <div className="ep-claim-hero">
          <div className="d-flex align-items-start justify-content-between gap-3">
            <div className="d-flex align-items-center gap-3">
              <span className="ep-claim-icon">
                <i className="ri-file-text-line" />
              </span>
              <div>
                <h5 className="text-white fw-bold mb-0" style={{ fontSize: 14 }}>
                  {claimMode === 'expense' ? 'Submit New Expense Claim' : 'Advance Request — Recoverable Payout'}
                </h5>
                <small style={{ color: 'rgba(255,255,255,0.78)', fontSize: 10.5 }}>
                  All required fields must be completed · Receipt required above ₹500 · Changes take effect after approval flow completes
                </small>
              </div>
            </div>
            <div className="d-flex align-items-center gap-2">
              <span className="ep-claim-mode-pill">
                {claimMode === 'expense' ? 'EXPENSE MODE' : 'ADVANCE MODE'}
              </span>
              <button type="button" className="ep-claim-x" onClick={() => setClaimOpen(false)} aria-label="Close">
                <i className="ri-close-line" style={{ fontSize: 14 }} />
              </button>
            </div>
          </div>

          {/* Flow hint — mode is already chosen by the outer Expense /
              Advance module pill (which decides which form opens), so the
              in-modal tab row was redundant and has been removed. */}
          <div className="d-flex align-items-center justify-content-end flex-wrap gap-2 mt-2">
            <small style={{ color: 'rgba(255,255,255,0.85)', fontSize: 10 }}>
              {claimMode === 'expense'
                ? <>Expense → <strong>Reimbursement</strong></>
                : <>Advance → <strong>Payroll Recovery</strong></>}
            </small>
          </div>
        </div>

        {/* Body */}
        <div className="ep-claim-body">
          {claimMode === 'expense' ? (
            <Row className="g-2">
              {/* Left column */}
              <Col lg={6}>
                {/* Draft tabs — one per "Save & Add Another" click. Sits above
                    section A so users can hop between in-progress claims. */}
                <div className="ep-claim-tabs-strip">
                  {claimDrafts.map((d, i) => {
                    const isActive = i === activeClaimIdx;
                    const label = d.title?.trim()
                      ? d.title.trim().slice(0, 22)
                      : `Claim ${i + 1}`;
                    return (
                      <button
                        key={i}
                        type="button"
                        className={`ep-claim-draft-tab${isActive ? ' is-active' : ''}${d.saved ? ' is-saved' : ''}`}
                        onClick={() => setActiveClaimIdx(i)}
                        title={d.saved ? 'Saved draft — click to view' : 'Click to switch to this draft'}
                      >
                        {d.saved && <i className="ri-check-line me-1" />}
                        {label}
                        {claimDrafts.length > 1 && (
                          <span
                            className="ep-claim-draft-tab-x"
                            onClick={(e) => {
                              e.stopPropagation();
                              const next = claimDrafts.filter((_, j) => j !== i);
                              setClaimDrafts(next.length ? next : [blankDraft()]);
                              setActiveClaimIdx(prev => {
                                if (next.length === 0) return 0;
                                if (i < prev) return prev - 1;
                                if (i === prev) return Math.max(0, prev - 1);
                                return prev;
                              });
                            }}
                            title="Close draft"
                          >
                            <i className="ri-close-line" />
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>

                <div className="ep-claim-section-head">
                  <span className="ep-claim-dot" /> A — Claim Context
                </div>
                <div className="mb-3">
                  <div className="ep-claim-label">Employee <span className="ep-claim-req">*</span></div>
                  <MasterSelect
                    value={claimEmployee || employeeId}
                    placeholder="Select employee"
                    disabled
                    options={[{ value: employeeId, label: `${employee?.name || 'Aarav Patel'} (${employeeId})` }]}
                    onChange={setClaimEmployee}
                  />
                </div>
                <Row className="g-2 mb-2">
                  <Col md={6}>
                    <div className="ep-claim-label">Category <span className="ep-claim-req">*</span></div>
                    <MasterSelect
                      value={claimCategory}
                      placeholder={claimCategories.length ? 'Select category' : 'Loading…'}
                      options={claimCategories.map(c => ({ value: String(c.id), label: c.name }))}
                      onChange={(v) => { setClaimCategory(v); clearClaimErr('category'); }}
                      invalid={!!claimErrors.category}
                    />
                    {claimErrors.category && <div className="ep-claim-err"><i className="ri-error-warning-line" />{claimErrors.category}</div>}
                  </Col>
                  <Col md={6}>
                    <div className="ep-claim-label">Currency</div>
                    <MasterSelect
                      value={claimCurrency}
                      placeholder="Select currency"
                      options={[{ value: 'INR', label: '₹ INR' }, { value: 'USD', label: '$ USD' }, { value: 'EUR', label: '€ EUR' }]}
                      onChange={setClaimCurrency}
                    />
                  </Col>
                </Row>
                <Row className="g-3 mb-4">
                  <Col md={6}>
                    <div className="ep-claim-label">Project / Cost Center</div>
                    <MasterSelect
                      value={claimProject}
                      placeholder="Not assigned"
                      options={['HR','Sales','Operations','IT'].map(o => ({ value: o, label: o }))}
                      onChange={setClaimProject}
                    />
                  </Col>
                  <Col md={6}>
                    <div className="ep-claim-label">Payment Method</div>
                    <MasterSelect
                      value={claimPayment}
                      placeholder="Select payment method"
                      options={['UPI','PhonePe','Cash','Cheque','Bank Transfer'].map(o => ({ value: o, label: o }))}
                      onChange={setClaimPayment}
                    />
                  </Col>
                </Row>

                <div className="ep-claim-section-head">
                  <span className="ep-claim-dot is-faded" /> B — Expense Details
                </div>
                <div className="mb-3">
                  <div className="ep-claim-label">Expense Title <span className="ep-claim-req">*</span></div>
                  <input
                    className={`ep-claim-input${claimErrors.title ? ' is-invalid' : ''}`}
                    placeholder="Brief description of expense..."
                    value={claimTitle}
                    onChange={e => { setClaimTitle(e.target.value); clearClaimErr('title'); }}
                  />
                  {claimErrors.title && <div className="ep-claim-err"><i className="ri-error-warning-line" />{claimErrors.title}</div>}
                </div>
                <Row className="g-3 mb-3">
                  <Col md={6}>
                    <div className="ep-claim-label">Amount (₹) <span className="ep-claim-req">*</span></div>
                    <div className="position-relative">
                      <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--vz-secondary-color)', fontSize: 13, fontWeight: 600 }}>₹</span>
                      <input
                        className={`ep-claim-input${claimErrors.amount ? ' is-invalid' : ''}`}
                        style={{ paddingLeft: 28 }}
                        placeholder="0.00"
                        value={claimAmount}
                        inputMode="decimal"
                        onChange={e => {
                          // Sanitise the input as the user types — only digits +
                          // one dot, cap the whole part at 12 digits and fraction
                          // at 2. The DB column is decimal(18,2) so 12+2 fits
                          // comfortably; without this cap a paste of a long
                          // number used to slip through and crash the backend
                          // with a "numeric field overflow" SQL error.
                          let raw = e.target.value.replace(/[^0-9.]/g, '');
                          const firstDot = raw.indexOf('.');
                          if (firstDot !== -1) {
                            raw = raw.slice(0, firstDot + 1) + raw.slice(firstDot + 1).replace(/\./g, '');
                          }
                          const [whole, frac] = raw.split('.');
                          let capped = (whole || '').slice(0, 12);
                          if (frac !== undefined) capped += '.' + frac.slice(0, 2);
                          setClaimAmount(capped);
                          clearClaimErr('amount');
                        }}
                      />
                    </div>
                    {claimErrors.amount && <div className="ep-claim-err"><i className="ri-error-warning-line" />{claimErrors.amount}</div>}
                  </Col>
                  <Col md={6}>
                    <div className="ep-claim-label">Expense Date <span className="ep-claim-req">*</span></div>
                    <MasterDatePicker
                      value={claimDate}
                      onChange={(v) => { setClaimDate(v); clearClaimErr('date'); }}
                      invalid={!!claimErrors.date}
                    />
                    {claimErrors.date && <div className="ep-claim-err"><i className="ri-error-warning-line" />{claimErrors.date}</div>}
                  </Col>
                </Row>
                <div className="mb-3">
                  <div className="ep-claim-label">Supplier / Merchant</div>
                  <input className="ep-claim-input" placeholder="Supplier name (optional)" value={claimVendor} onChange={e => setClaimVendor(e.target.value)} />
                </div>
                <div className="mb-0">
                  <div className="ep-claim-label">Business Purpose <span className="ep-claim-req">*</span></div>
                  <textarea
                    className={`ep-claim-input${claimErrors.purpose ? ' is-invalid' : ''}`}
                    rows={3}
                    placeholder="Explain the business purpose..."
                    value={claimPurpose}
                    onChange={e => { setClaimPurpose(e.target.value); clearClaimErr('purpose'); }}
                  />
                  {claimErrors.purpose && <div className="ep-claim-err"><i className="ri-error-warning-line" />{claimErrors.purpose}</div>}
                </div>
              </Col>

              {/* Right column */}
              <Col lg={6}>
                <div className="ep-claim-section-head">
                  <span className="ep-claim-dot is-faded" /> C — Proof &amp; Receipt
                </div>
                <label className="ep-claim-upload mb-2 d-block" style={{ cursor: 'pointer' }}>
                  <input
                    type="file"
                    multiple
                    accept=".pdf,.jpg,.jpeg,.png"
                    style={{ display: 'none' }}
                    onChange={(e) => {
                      const picked = Array.from(e.target.files || []);
                      if (picked.length) setClaimFiles(prev => [...prev, ...picked]);
                      e.target.value = '';
                    }}
                  />
                  <span className="ep-claim-upload-icon">
                    <i className="ri-upload-2-line" />
                  </span>
                  <div className="fw-semibold" style={{ fontSize: 13 }}>Click to upload or drag &amp; drop</div>
                  <small className="text-muted" style={{ fontSize: 11.5 }}>PDF, JPG, PNG · Multiple files allowed · Max 5 MB each</small>
                </label>
                {claimFiles.length > 0 && (
                  <div className="ep-claim-file-list mb-4">
                    {claimFiles.map((f, i) => (
                      <div key={i} className="ep-claim-file-row">
                        <i className="ri-attachment-2 ep-claim-file-icon" />
                        <div className="ep-claim-file-meta">
                          <div className="ep-claim-file-name">{f.name}</div>
                          <div className="ep-claim-file-size">{(f.size / 1024).toFixed(1)} KB</div>
                        </div>
                        {/* View — opens the just-picked file in a new tab
                            using an object URL so the user can sanity-check
                            their receipt before submitting. The URL is
                            revoked after a short delay so the new tab has
                            time to load it without leaking memory. */}
                        <button
                          type="button"
                          className="ep-claim-file-x"
                          title="View"
                          onClick={() => {
                            try {
                              const url = URL.createObjectURL(f);
                              window.open(url, '_blank', 'noopener,noreferrer');
                              setTimeout(() => URL.revokeObjectURL(url), 60_000);
                            } catch {
                              toast.error('Could not open file', 'Your browser blocked the preview.');
                            }
                          }}
                        >
                          <i className="ri-eye-line" />
                        </button>
                        <button
                          type="button"
                          className="ep-claim-file-x"
                          onClick={() => setClaimFiles(prev => prev.filter((_, j) => j !== i))}
                          title="Remove"
                        >
                          <i className="ri-close-line" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                {claimFiles.length === 0 && <div className="mb-4" />}

                <div className="ep-claim-section-head">
                  <span className="ep-claim-dot is-faded" /> D — Approval Flow
                </div>
                <div className="ep-claim-flow mb-4">
                  <div className="ep-claim-flow-step">
                    <span className="ep-claim-flow-icon" style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)' }}>
                      <i className="ri-user-line" />
                    </span>
                    <div>
                      <div className="ep-claim-flow-title">You</div>
                      <div className="ep-claim-flow-sub">{employee?.name || employeeId}</div>
                    </div>
                  </div>
                  <i className="ri-arrow-right-line ep-claim-flow-arrow" />
                  <div className="ep-claim-flow-step">
                    <span className="ep-claim-flow-icon" style={{ background: 'linear-gradient(135deg,#0ab39c,#30d5b5)' }}>
                      <i className="ri-user-star-line" />
                    </span>
                    <div>
                      <div className="ep-claim-flow-title">Reporting Manager</div>
                      <div className="ep-claim-flow-sub">First-level review</div>
                    </div>
                  </div>
                  <i className="ri-arrow-right-line ep-claim-flow-arrow" />
                  <div className="ep-claim-flow-step">
                    <span className="ep-claim-flow-icon" style={{ background: 'linear-gradient(135deg,#f59e0b,#fbbf24)' }}>
                      <i className="ri-shield-check-line" />
                    </span>
                    <div>
                      <div className="ep-claim-flow-title">HR / Finance Manager</div>
                      <div className="ep-claim-flow-sub">Final approval</div>
                    </div>
                  </div>
                </div>
              </Col>
            </Row>
          ) : (
            /* ── Advance Request mode ── */
            <Row className="g-4">
              <Col lg={6}>
                <div className="ep-claim-banner">
                  <span className="ep-claim-banner-icon">
                    <i className="ri-money-dollar-circle-line" />
                  </span>
                  <div className="flex-grow-1">
                    <h6 className="mb-1 fw-bold" style={{ color: '#4338ca', fontSize: 14 }}>Advance Request — Recoverable Payout</h6>
                    <small style={{ color: '#6366f1', fontSize: 11.5 }}>Amount will be recovered through payroll deduction · Approval flow required</small>
                  </div>
                  <span className="ep-claim-flow-pill">APPROVAL FLOW</span>
                </div>

                <div className="mb-3">
                  <div className="ep-claim-label">Employee <span className="ep-claim-req">*</span></div>
                  <MasterSelect
                    value={claimEmployee || employeeId}
                    placeholder="Select employee"
                    disabled
                    options={[{ value: employeeId, label: `${employee?.name || 'Aarav Patel'} (${employeeId})` }]}
                    onChange={setClaimEmployee}
                  />
                </div>
                <Row className="g-3 mb-3">
                  <Col md={6}>
                    <div className="ep-claim-label">Advance Type <span className="ep-claim-req">*</span></div>
                    <MasterSelect
                      value={advType}
                      placeholder="Select type..."
                      options={['Travel Advance','Salary Advance','Medical Advance','Other'].map(o => ({ value: o, label: o }))}
                      onChange={(v) => { setAdvType(v); clearAdvErr('type'); }}
                      invalid={!!advErrors.type}
                    />
                    {advErrors.type && <div className="ep-claim-err"><i className="ri-error-warning-line" />{advErrors.type}</div>}
                  </Col>
                  <Col md={6}>
                    <div className="ep-claim-label">Amount (₹) <span className="ep-claim-req">*</span></div>
                    <div className="position-relative">
                      <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--vz-secondary-color)', fontSize: 13, fontWeight: 600 }}>₹</span>
                      <input
                        className={`ep-claim-input${advErrors.amount ? ' is-invalid' : ''}`}
                        style={{ paddingLeft: 28 }}
                        placeholder="0"
                        value={advAmount}
                        onChange={e => { setAdvAmount(e.target.value); clearAdvErr('amount'); }}
                      />
                    </div>
                    {advErrors.amount && <div className="ep-claim-err"><i className="ri-error-warning-line" />{advErrors.amount}</div>}
                  </Col>
                </Row>
                {/* "Other" advance type — free-text input appears only when the
                    user picks Other so the dropdown stays uncluttered for the
                    common cases. */}
                {advType === 'Other' && (
                  <div className="mb-3">
                    <div className="ep-claim-label">Specify Advance Type <span className="ep-claim-req">*</span></div>
                    <input
                      className={`ep-claim-input${advErrors.type_other ? ' is-invalid' : ''}`}
                      placeholder="e.g. Conference Registration, Education Loan…"
                      value={advTypeOther}
                      onChange={e => { setAdvTypeOther(e.target.value); clearAdvErr('type_other'); }}
                    />
                    {advErrors.type_other && <div className="ep-claim-err"><i className="ri-error-warning-line" />{advErrors.type_other}</div>}
                  </div>
                )}
                <Row className="g-3 mb-3">
                  <Col md={6}>
                    <div className="ep-claim-label">Requested Date <span className="ep-claim-req">*</span></div>
                    <MasterDatePicker
                      value={advRequestedDate}
                      onChange={(v) => { setAdvRequestedDate(v); clearAdvErr('requested'); }}
                      invalid={!!advErrors.requested}
                      minDate={new Date().toISOString().slice(0, 10)}
                    />
                    {advErrors.requested && <div className="ep-claim-err"><i className="ri-error-warning-line" />{advErrors.requested}</div>}
                  </Col>
                  <Col md={6}>
                    <div className="ep-claim-label">Recovery Start <span className="ep-claim-req">*</span></div>
                    <MasterDatePicker
                      value={advRecoveryStart}
                      onChange={(v) => { setAdvRecoveryStart(v); clearAdvErr('recovery_start'); }}
                      invalid={!!advErrors.recovery_start}
                      minDate={advRequestedDate || new Date().toISOString().slice(0, 10)}
                    />
                    {advErrors.recovery_start && <div className="ep-claim-err"><i className="ri-error-warning-line" />{advErrors.recovery_start}</div>}
                  </Col>
                </Row>
                <div className="mb-3">
                  <div className="ep-claim-label">Recovery Mode <span className="ep-claim-req">*</span></div>
                  <MasterSelect
                    value={advRecoveryMode}
                    placeholder="Select mode..."
                    options={[
                      { value: 'emi', label: 'EMI' },
                      { value: 'lumpsum', label: 'Single Lump Sum' },
                      { value: 'bimonthly', label: 'Bi-Monthly' },
                    ]}
                    onChange={(v) => { setAdvRecoveryMode(v); clearAdvErr('recovery_mode'); }}
                    invalid={!!advErrors.recovery_mode}
                  />
                  {advErrors.recovery_mode && <div className="ep-claim-err"><i className="ri-error-warning-line" />{advErrors.recovery_mode}</div>}
                </div>
                {/* Months + computed EMI only make sense for EMI mode — hide
                    them for lump sum / bi-monthly so the form stays tight. */}
                {advRecoveryMode === 'emi' && (
                  <Row className="g-3 mb-3">
                    <Col md={6}>
                      <div className="ep-claim-label">No. of Months <span className="ep-claim-req">*</span></div>
                      <input
                        className={`ep-claim-input${advErrors.months ? ' is-invalid' : ''}`}
                        placeholder="e.g. 6"
                        value={advMonths}
                        onChange={e => { setAdvMonths(e.target.value); clearAdvErr('months'); }}
                      />
                      {advErrors.months && <div className="ep-claim-err"><i className="ri-error-warning-line" />{advErrors.months}</div>}
                    </Col>
                    <Col md={6}>
                      <div className="ep-claim-label">Monthly EMI</div>
                      <div className="position-relative">
                        <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--vz-secondary-color)', fontSize: 13, fontWeight: 600 }}>₹</span>
                        <input
                          className="ep-claim-input"
                          style={{ paddingLeft: 28 }}
                          placeholder="Auto from amount ÷ months"
                          value={advMonthlyEmi}
                          onChange={(e) => {
                            setAdvMonthlyEmi(e.target.value.replace(/[^\d.]/g, ''));
                            setAdvEmiTouched(true);
                          }}
                        />
                      </div>
                    </Col>
                  </Row>
                )}
                <div className="mb-0">
                  <div className="ep-claim-label">Reason / Purpose <span className="ep-claim-req">*</span></div>
                  <textarea
                    className={`ep-claim-input${advErrors.reason ? ' is-invalid' : ''}`}
                    rows={3}
                    placeholder="Describe why this advance is needed..."
                    value={advReason}
                    onChange={e => { setAdvReason(e.target.value); clearAdvErr('reason'); }}
                  />
                  {advErrors.reason && <div className="ep-claim-err"><i className="ri-error-warning-line" />{advErrors.reason}</div>}
                </div>
              </Col>

              {/* Right column — Supporting Documents (multi-file) + Approval Flow.
                  Replaces the old Payroll Recovery Preview / Advance Intelligence
                  placeholders, which weren't wired to anything actionable. */}
              <Col lg={6}>
                <div className="ep-claim-section-head">
                  <span className="ep-claim-dot is-faded" /> Supporting Documents
                </div>
                <label className="ep-claim-upload mb-2 d-block" style={{ background: 'rgba(99,102,241,0.04)', borderColor: 'rgba(99,102,241,0.25)', cursor: 'pointer' }}>
                  <input
                    type="file"
                    multiple
                    accept=".pdf,.jpg,.jpeg,.png"
                    style={{ display: 'none' }}
                    onChange={(e) => {
                      const picked = Array.from(e.target.files || []);
                      if (picked.length) setAdvFiles(prev => [...prev, ...picked]);
                      e.target.value = '';
                    }}
                  />
                  <span className="ep-claim-upload-icon" style={{ background: 'rgba(99,102,241,0.10)', color: '#6366f1' }}>
                    <i className="ri-attachment-line" />
                  </span>
                  <div className="fw-semibold" style={{ fontSize: 13, color: '#4338ca' }}>Attach documents (bank letter, itinerary…)</div>
                  <small className="text-muted" style={{ fontSize: 11.5 }}>PDF, JPG, PNG · Multiple files allowed · Max 5 MB each</small>
                </label>
                {advFiles.length > 0 && (
                  <div className="ep-claim-file-list mb-4">
                    {advFiles.map((f, i) => (
                      <div key={i} className="ep-claim-file-row">
                        <i className="ri-attachment-2 ep-claim-file-icon" />
                        <div className="ep-claim-file-meta">
                          <div className="ep-claim-file-name">{f.name}</div>
                          <div className="ep-claim-file-size">{(f.size / 1024).toFixed(1)} KB</div>
                        </div>
                        <button
                          type="button"
                          className="ep-claim-file-x"
                          title="View"
                          onClick={() => {
                            try {
                              const url = URL.createObjectURL(f);
                              window.open(url, '_blank', 'noopener,noreferrer');
                              setTimeout(() => URL.revokeObjectURL(url), 60_000);
                            } catch {
                              toast.error('Could not open file', 'Your browser blocked the preview.');
                            }
                          }}
                        >
                          <i className="ri-eye-line" />
                        </button>
                        <button
                          type="button"
                          className="ep-claim-file-x"
                          onClick={() => setAdvFiles(prev => prev.filter((_, j) => j !== i))}
                          title="Remove"
                        >
                          <i className="ri-close-line" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                {advFiles.length === 0 && <div className="mb-4" />}

                <div className="ep-claim-section-head">
                  <span className="ep-claim-dot is-faded" /> Approval Flow
                </div>
                <div className="ep-claim-flow mb-3">
                  <div className="ep-claim-flow-step">
                    <span className="ep-claim-flow-icon" style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)' }}>
                      <i className="ri-user-line" />
                    </span>
                    <div>
                      <div className="ep-claim-flow-title">You</div>
                      <div className="ep-claim-flow-sub">{employee?.name || employeeId}</div>
                    </div>
                  </div>
                  <i className="ri-arrow-right-line ep-claim-flow-arrow" />
                  <div className="ep-claim-flow-step">
                    <span className="ep-claim-flow-icon" style={{ background: 'linear-gradient(135deg,#0ab39c,#30d5b5)' }}>
                      <i className="ri-user-star-line" />
                    </span>
                    <div>
                      <div className="ep-claim-flow-title">Reporting Manager</div>
                      <div className="ep-claim-flow-sub">First-level review</div>
                    </div>
                  </div>
                  <i className="ri-arrow-right-line ep-claim-flow-arrow" />
                  <div className="ep-claim-flow-step">
                    <span className="ep-claim-flow-icon" style={{ background: 'linear-gradient(135deg,#f59e0b,#fbbf24)' }}>
                      <i className="ri-shield-check-line" />
                    </span>
                    <div>
                      <div className="ep-claim-flow-title">HR / Finance Manager</div>
                      <div className="ep-claim-flow-sub">Final approval</div>
                    </div>
                  </div>
                </div>

                <div className="ep-claim-warn">
                  <i className="ri-error-warning-line" />
                  <div>
                    This creates a recoverable liability entry. The advance will be deducted from your salary per the selected schedule. Original record is immutable after approval.
                  </div>
                </div>
              </Col>
            </Row>
          )}
        </div>

        {/* Footer — every action is locked while a submit is in flight
            so the user can't close the modal, stage another draft, or
            (most importantly) re-fire the submit before the first one
            returns. */}
        <div className="ep-claim-footer">
          <button type="button" className="ep-claim-cancel" onClick={() => setClaimOpen(false)} disabled={claimSubmitting}>Cancel</button>
          <div className="d-flex gap-2 ms-auto">
            <button type="button" className="ep-claim-secondary" onClick={handleSaveDraft} disabled={claimSubmitting}>
              <i className="ri-save-line me-1" /> Save Draft
            </button>
            {claimMode === 'expense' && (
              <button type="button" className="ep-claim-secondary" onClick={saveAndAddAnother} disabled={claimSubmitting}>
                <i className="ri-add-line me-1" /> Save &amp; Add Another
              </button>
            )}
            <button
              type="button"
              className="ep-claim-submit"
              onClick={claimMode === 'expense' ? submitAllDrafts : submitAdvanceRequest}
              disabled={claimSubmitting}
              style={claimSubmitting ? { opacity: 0.7, cursor: 'wait' } : undefined}
            >
              {claimSubmitting ? (
                <>
                  <span className="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true" style={{ width: 12, height: 12 }} />
                  Submitting…
                </>
              ) : (
                <>
                  <i className={claimMode === 'expense' ? 'ri-send-plane-line me-1' : 'ri-send-plane-fill me-1'} />
                  {claimMode === 'expense'
                    ? (claimDrafts.length > 1 ? `Submit ${claimDrafts.length} Claims` : 'Submit Claim')
                    : 'Submit Advance Request'}
                </>
              )}
            </button>
          </div>
        </div>
      </EpModal>

      {/* ── Change Password modal ──
          Three inputs (current / new / confirm), per-field error display,
          and an eye-toggle for each field so the user can verify what they
          typed. Submit calls POST /api/change-password — the backend
          enforces the min:8 + no-reuse-of-last-3 policy and emails a
          confirmation via PasswordChangedMail. */}
      <EpModal open={pwOpen} onClose={() => { if (!pwSaving) { setPwOpen(false); resetPwForm(); } }} size="sm">
        {/* Header — gradient banner so the dialog reads as a distinct
            "Security" surface, not just a plain card. */}
        <div
          className="d-flex align-items-center justify-content-between px-3 py-3"
          style={{
            background: 'linear-gradient(135deg, rgba(244,63,94,0.10) 0%, rgba(244,63,94,0.02) 100%)',
            borderBottom: '1px solid rgba(244,63,94,0.18)',
          }}
        >
          <div className="d-flex align-items-center gap-2">
            <span
              className="d-inline-flex align-items-center justify-content-center rounded-3"
              style={{
                width: 38, height: 38,
                background: 'linear-gradient(135deg, #f43f5e, #fb7185)',
                color: '#fff',
                boxShadow: '0 6px 16px rgba(244,63,94,0.35)',
              }}
            >
              <i className="ri-lock-password-line" style={{ fontSize: 18 }} />
            </span>
            <div>
              <h6 className="mb-0 fw-bold" style={{ fontSize: 14 }}>Change Password</h6>
              <small className="text-muted" style={{ fontSize: 11 }}>Pick a strong, unique password</small>
            </div>
          </div>
          <button
            type="button"
            className="btn btn-light btn-sm rounded-circle d-inline-flex align-items-center justify-content-center"
            style={{ width: 30, height: 30 }}
            onClick={() => { if (!pwSaving) { setPwOpen(false); resetPwForm(); } }}
            disabled={pwSaving}
            aria-label="Close"
          >
            <i className="ri-close-line" />
          </button>
        </div>
        <div className="px-3 py-3">
          {/* Current Password */}
          <div className="mb-3">
            <label className="emp-label fw-semibold" style={{ fontSize: 12 }}>Current Password<span className="text-danger">*</span></label>
            <div className="position-relative">
              <input
                type={pwShow.cur ? 'text' : 'password'}
                className={`form-control${pwErrors.current_password ? ' is-invalid' : ''}`}
                value={pwCurrent}
                onChange={e => { setPwCurrent(e.target.value); if (pwErrors.current_password) setPwErrors(p => ({ ...p, current_password: '' })); }}
                placeholder="Enter your current password"
                autoComplete="current-password"
                disabled={pwSaving}
                style={{ paddingRight: 38, borderRadius: 10 }}
              />
              <button
                type="button"
                className="btn btn-link p-0 position-absolute"
                style={{ right: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--vz-secondary-color)' }}
                onClick={() => setPwShow(s => ({ ...s, cur: !s.cur }))}
                tabIndex={-1}
                aria-label={pwShow.cur ? 'Hide password' : 'Show password'}
              >
                <i className={pwShow.cur ? 'ri-eye-off-line' : 'ri-eye-line'} />
              </button>
            </div>
            {pwErrors.current_password && <small className="text-danger d-block mt-1" style={{ fontSize: 11 }}>{pwErrors.current_password}</small>}
          </div>

          {/* New Password */}
          <div className="mb-3">
            <label className="emp-label fw-semibold" style={{ fontSize: 12 }}>New Password<span className="text-danger">*</span></label>
            <div className="position-relative">
              <input
                type={pwShow.nw ? 'text' : 'password'}
                className={`form-control${pwErrors.password ? ' is-invalid' : ''}`}
                value={pwNew}
                onChange={e => { setPwNew(e.target.value); if (pwErrors.password) setPwErrors(p => ({ ...p, password: '' })); }}
                placeholder="Minimum 8 characters"
                autoComplete="new-password"
                disabled={pwSaving}
                style={{ paddingRight: 38, borderRadius: 10 }}
              />
              <button
                type="button"
                className="btn btn-link p-0 position-absolute"
                style={{ right: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--vz-secondary-color)' }}
                onClick={() => setPwShow(s => ({ ...s, nw: !s.nw }))}
                tabIndex={-1}
                aria-label={pwShow.nw ? 'Hide password' : 'Show password'}
              >
                <i className={pwShow.nw ? 'ri-eye-off-line' : 'ri-eye-line'} />
              </button>
            </div>
            {pwErrors.password && <small className="text-danger d-block mt-1" style={{ fontSize: 11 }}>{pwErrors.password}</small>}
            {/* Strength meter + rule checklist. The bar + label only show
                once the user starts typing (no point grading an empty
                field), but the checklist below stays visible upfront so
                users see exactly what a "strong" password needs — same
                pattern as the Reset Password / Forgot Password flows. */}
            <div className="mt-2">
              {pwNew && (
                <div className="d-flex align-items-center gap-2 mb-1">
                  <div style={{ flex: 1, height: 6, background: 'var(--vz-secondary-bg)', borderRadius: 999, overflow: 'hidden' }}>
                    <div style={{
                      width: `${(pwStrength.level / 5) * 100}%`,
                      height: '100%',
                      background: pwStrength.barColor,
                      transition: 'width .25s ease, background .25s ease',
                    }} />
                  </div>
                  <span className={`fw-bold ${pwStrength.barTextClass}`} style={{ fontSize: 11, minWidth: 44, textAlign: 'right' }}>
                    {pwStrength.text}
                  </span>
                </div>
              )}
              <ul className="list-unstyled mb-0 mt-1" style={{ fontSize: 11 }}>
                {PW_RULES.map(rule => {
                  const passed = !!pwNew && !validatePwRules(pwNew).includes(rule);
                  return (
                    <li key={rule} className={`d-inline-flex align-items-center gap-1 me-3 ${passed ? 'text-success fw-semibold' : 'text-muted'}`}>
                      <i className={passed ? 'ri-checkbox-circle-fill' : 'ri-checkbox-blank-circle-line'} style={{ fontSize: 12 }} />
                      {rule}
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>

          {/* Confirm New Password */}
          <div className="mb-2">
            <label className="emp-label fw-semibold" style={{ fontSize: 12 }}>Confirm New Password<span className="text-danger">*</span></label>
            <div className="position-relative">
              <input
                type={pwShow.cf ? 'text' : 'password'}
                className={`form-control${pwErrors.password_confirmation ? ' is-invalid' : ''}`}
                value={pwConfirm}
                onChange={e => { setPwConfirm(e.target.value); if (pwErrors.password_confirmation) setPwErrors(p => ({ ...p, password_confirmation: '' })); }}
                placeholder="Re-enter the new password"
                autoComplete="new-password"
                disabled={pwSaving}
                style={{ paddingRight: 38, borderRadius: 10 }}
                onKeyDown={e => { if (e.key === 'Enter' && !pwSaving) handleChangePassword(); }}
              />
              <button
                type="button"
                className="btn btn-link p-0 position-absolute"
                style={{ right: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--vz-secondary-color)' }}
                onClick={() => setPwShow(s => ({ ...s, cf: !s.cf }))}
                tabIndex={-1}
                aria-label={pwShow.cf ? 'Hide password' : 'Show password'}
              >
                <i className={pwShow.cf ? 'ri-eye-off-line' : 'ri-eye-line'} />
              </button>
            </div>
            {pwErrors.password_confirmation && <small className="text-danger d-block mt-1" style={{ fontSize: 11 }}>{pwErrors.password_confirmation}</small>}
            {/* Live match indicator — keeps users from racing each other to
                Submit before realising they typo'd the confirmation. */}
            {pwConfirm && (
              <div className="mt-2 d-inline-flex align-items-center gap-1" style={{ fontSize: 11 }}>
                {pwNew === pwConfirm ? (
                  <span className="text-success d-inline-flex align-items-center gap-1 fw-semibold">
                    <i className="ri-checkbox-circle-fill" style={{ fontSize: 12 }} /> Passwords match
                  </span>
                ) : (
                  <span className="text-danger d-inline-flex align-items-center gap-1 fw-semibold">
                    <i className="ri-close-circle-fill" style={{ fontSize: 12 }} /> Passwords do not match
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
        <div
          className="d-flex justify-content-end gap-2 px-3 py-3"
          style={{ borderTop: '1px solid var(--vz-border-color)', background: 'var(--vz-secondary-bg)' }}
        >
          <button
            type="button"
            className="btn fw-semibold rounded-pill"
            onClick={() => { setPwOpen(false); resetPwForm(); }}
            disabled={pwSaving}
            style={{
              padding: '7px 18px', fontSize: 13,
              background: '#fff', color: '#374151',
              border: '1px solid #e5e7eb',
              opacity: pwSaving ? 0.6 : 1,
              cursor: pwSaving ? 'not-allowed' : 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn d-inline-flex align-items-center justify-content-center gap-2 fw-semibold rounded-pill"
            onClick={handleChangePassword}
            disabled={pwSaving}
            style={{
              padding: '7px 18px', fontSize: 13, minWidth: 150,
              color: '#fff', border: 'none',
              background: 'linear-gradient(135deg, #f43f5e, #fb7185)',
              boxShadow: '0 6px 16px rgba(244,63,94,0.35)',
              opacity: pwSaving ? 0.85 : 1,
              cursor: pwSaving ? 'wait' : 'pointer',
            }}
          >
            {pwSaving ? (
              <>
                <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true" />
                Updating…
              </>
            ) : (
              <>
                <i className="ri-shield-check-line" style={{ fontSize: 14 }} />
                Update Password
              </>
            )}
          </button>
        </div>
      </EpModal>

      {/* WhatsApp/Instagram-style square crop dialog for the profile photo. */}
      <ImageCropperModal
        open={cropOpen}
        src={cropSrc}
        aspect={1}
        cropShape="round"
        outputSize={512}
        title="Adjust profile photo"
        onCancel={() => { setCropOpen(false); setCropSrc(null); }}
        onConfirm={handleCropConfirm}
      />

      {/* Face-biometric enrolment — opens from the Security card and posts
          the 128-d descriptor (with consent) to /api/face/register. */}
      <FaceRegistrationModal open={faceRegOpen} onClose={() => setFaceRegOpen(false)} />

      {/* Real salary structure editor — replaces the old mock "Revise Salary"
          flow. Saving creates a new version and propagates to payroll. */}
      <SalaryStructureModal
        open={salaryModalOpen}
        employee={salaryEmpLite}
        onClose={() => setSalaryModalOpen(false)}
        onSaved={reloadSalaryStruct}
      />

      {/* Hiring Requests — Raise form + read-only list. Both modals come
          from HrRecruitment so the create/validate logic, KPI strip, and
          filters all stay in one place. Only mounted when the user has
          opened the Hiring Requests tab at least once (and is a manager). */}
      {isOwnProfile && (isManager || ['branch_user', 'client_admin', 'super_admin'].includes(String(authUser?.user_type || ''))) && (
        <>
          <RaiseHiringRequestModal
            isOpen={raiseHiringOpen}
            onClose={() => setRaiseHiringOpen(false)}
            onSubmit={(_savedRow, _asDraft) => {
              // Bump the refresh key so the inline KPI strip + table
              // re-pull /hiring-requests on the next render.
              setHiringRefreshKey(k => k + 1);
              setRaiseHiringOpen(false);
            }}
          />
          <HiringRequestsListModal
            isOpen={listHiringOpen}
            onClose={() => setListHiringOpen(false)}
            onRaiseNew={() => { setListHiringOpen(false); setRaiseHiringOpen(true); }}
            onCreateRecruitment={() => { /* recruitment creation is HR-side; managers don't trigger this from the profile */ }}
            refreshKey={hiringRefreshKey}
          />
        </>
      )}

      {/* Signed-document preview — opens from the Vault > My Signed
          Documents table. Renders the frozen content_html inside the
          locked header/footer chrome so the employee can read the full
          letter before downloading the PDF. */}
      {signedPreview && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', zIndex: 1500, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
          onClick={() => setSignedPreview(null)}>
          <div style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 900, maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
            onClick={(e) => e.stopPropagation()}>
            <div style={{ padding: '14px 18px', background: 'linear-gradient(135deg,#16a34a,#22c55e)', color: '#fff' }}>
              <div className="d-flex align-items-center justify-content-between">
                <div className="min-w-0">
                  <strong style={{ fontSize: 15 }}><i className="ri-file-shield-2-line me-2" />{signedPreview.template?.name || 'Signed Document'}</strong>
                  <div style={{ fontSize: 11.5, opacity: 0.9, marginTop: 2 }}>
                    {signedPreview.code ? `${signedPreview.code} · ` : ''}Status: <strong>{signedPreview.status}</strong>
                  </div>
                </div>
                <button type="button" onClick={() => setSignedPreview(null)} aria-label="Close"
                  style={{ background: 'rgba(255,255,255,0.18)', border: 0, color: '#fff', borderRadius: 8, width: 28, height: 28 }}>
                  <i className="ri-close-line" />
                </button>
              </div>
            </div>
            <div style={{ padding: 16, background: '#f9fafb', overflowY: 'auto', flex: 1 }}>
              <HeaderFooterPanel
                header={{ ...DEFAULT_HEADER, ...(signedPreview.header_config || {}) } as HeaderConfig}
                setHeader={() => {}}
                footer={{ ...DEFAULT_FOOTER, ...(signedPreview.footer_config || {}) } as FooterConfig}
                setFooter={() => {}}
                readOnly
              >
                <div className="tpl-readonly-preview"
                  style={{ fontSize: 13.5, lineHeight: 1.65, color: '#374151', minHeight: 260 }}
                  dangerouslySetInnerHTML={{ __html: signedPreview.content_html || '<p>(empty)</p>' }}
                />
              </HeaderFooterPanel>
            </div>
            <div style={{ padding: 12, borderTop: '1px solid #e5e7eb', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" onClick={() => setSignedPreview(null)}
                style={{ padding: '7px 14px', background: '#fff', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, fontWeight: 600, color: '#374151', cursor: 'pointer' }}>
                Close
              </button>
              <button type="button" onClick={() => downloadSignedPdf(signedPreview.id, signedPreview.code)}
                style={{ padding: '7px 16px', background: 'linear-gradient(135deg,#dc2626,#ef4444)', border: 0, borderRadius: 8, fontSize: 13, fontWeight: 700, color: '#fff', cursor: 'pointer' }}>
                <i className="ri-file-pdf-2-line me-1" />Download PDF
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

