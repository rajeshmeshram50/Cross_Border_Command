import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Button, Card, CardBody, Col, Row, Dropdown, DropdownToggle, DropdownMenu, DropdownItem } from 'reactstrap';
import { useToast } from '../../contexts/ToastContext';
import { MasterSelect, MasterDatePicker, MasterFormStyles } from '../master/masterFormKit';
import ComingSoonShell from '../../components/ComingSoonShell';
import HeaderFooterPanel, {
  DEFAULT_HEADER, DEFAULT_FOOTER,
  type HeaderConfig, type FooterConfig,
} from '../hrms/doc-templates/HeaderFooterPanel';
import api from '../../api';
import { useAuth } from '../../contexts/AuthContext';
import ExpenseClaimsTable from '../../components/ExpenseClaimsTable';
import FaceRegistrationModal from '../../components/FaceRegistrationModal';
import './EmployeeProfile.css';
import ImageCropperModal from '../../components/ui/ImageCropperModal';
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

type TabKey = 'profile' | 'job' | 'attendance' | 'vault' | 'payroll' | 'expense' | 'apply_leave';
type PayrollTab = 'summary' | 'details';
type VaultTab = 'employee' | 'organizational';
type ExpenseFilter = 'all' | 'approved' | 'rejected' | 'pending';

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
    return (
      <div className="d-flex align-items-center justify-content-center py-5">
        <span className="spinner-border spinner-border-sm me-2" /> Loading attendance…
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
      { name: 'Background Verification',authority: 'BGV Vendor',             issueDate: '15-Nov-2023', attachment: 'BGV.pdf',        status: 'Verified' },
      { name: 'Reference Check',        authority: 'BGV Vendor',             issueDate: '15-Nov-2023',                                status: 'Pending'  },
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

  // Full employee record from /employees/{id} — drives the Personal /
  // Contact / Address sections so every field reflects what the admin
  // actually saved (was previously hardcoded with sample data).
  const [empDetail, setEmpDetail] = useState<any>(null);
  useEffect(() => {
    let cancelled = false;
    const empCode = String(employeeId || '').trim();
    if (!empCode) return;
    // The route uses emp_code (e.g. EMP-001) but the API show endpoint
    // expects the numeric id. Resolve via the search index first, then
    // fetch the full record.
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
      }
    })();
    return () => { cancelled = true; };
  }, [employeeId]);

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
  const breakdownRow   = SALARY_TIMELINE.find(s => s.id === breakdownRowId) || SALARY_TIMELINE[0];
  const breakdownData  = makeBreakdown(breakdownRow.annual);

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
  // free-text label).
  const [claimCategories, setClaimCategories] = useState<{ id: number; name: string }[]>([]);
  useEffect(() => {
    if (!claimOpen) return;
    api.get('/master/expense_category')
      .then((res: any) => {
        const rows = Array.isArray(res?.data) ? res.data : [];
        setClaimCategories(
          rows
            .filter((r: any) => (r.status ?? 'Active') === 'Active')
            .map((r: any) => ({ id: Number(r.id), name: String(r.name ?? '') })),
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
  };
  const blankDraft = (): ClaimDraft => ({
    employee: employeeId,
    category: '',
    currency: 'INR',
    project: '',
    payment: 'UPI',
    title: '',
    amount: '',
    date: new Date().toISOString().slice(0, 10),
    vendor: '',
    purpose: '',
    saved: false,
  });
  const [claimDrafts, setClaimDrafts] = useState<ClaimDraft[]>([blankDraft()]);
  const [activeClaimIdx, setActiveClaimIdx] = useState(0);
  // Each time the modal re-opens, start with one fresh draft.
  useEffect(() => {
    if (claimOpen) {
      setClaimDrafts([blankDraft()]);
      setActiveClaimIdx(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claimOpen]);
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
  // Multi-file attachments — separate buckets for expense receipts vs advance
  // supporting docs so the two flows don't bleed into each other.
  const [claimFiles, setClaimFiles] = useState<File[]>([]);
  const [advFiles, setAdvFiles] = useState<File[]>([]);
  // Reset attachments + custom advance-type field every time the modal opens.
  useEffect(() => {
    if (claimOpen) {
      setClaimFiles([]);
      setAdvFiles([]);
      setAdvTypeOther('');
    }
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
  const { user: authUser } = useAuth();
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
    const photo = employee?.photoUrl || null;
    const resolved = photo ? resolveFileUrl(photo) : null;
    setProfilePhotoPreview(prev => (profilePhotoFile ? prev : resolved));
  }, [employee?.photoUrl, profilePhotoFile]);

  const restoreSavedProfilePhoto = () => {
    const saved = employee?.photoUrl || null;
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
      setProfilePhotoFile(null);
      toast.success('Photo updated', 'Profile picture has been changed.');
    } catch (err: any) {
      toast.error('Upload failed', err?.response?.data?.message || err?.message || 'Could not update photo');
    } finally {
      setSavingPhoto(false);
    }
  };

  const profilePhotoSrc = profilePhotoPreview || (employee?.photoUrl ? resolveFileUrl(employee.photoUrl) : null);
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

  // POST every draft as multipart/form-data so the optional attachments[]
  // upload alongside. On success, clear drafts, close modal, refresh list.
  const submitAllDrafts = async () => {
    const valid = claimDrafts.filter(d => d.title.trim() && d.amount.trim());
    if (valid.length === 0) {
      setClaimOpen(false);
      return;
    }
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
        for (const f of claimFiles) fd.append('files[]', f);
        await api.post('/expense-claims', fd, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
      }
      toast.success('Claim submitted', `${valid.length} claim${valid.length > 1 ? 's' : ''} sent for approval`);
      setClaimOpen(false);
      await refreshClaims();
    } catch (err: any) {
      const msg = err?.response?.data?.message || 'Could not submit the claim. Please try again.';
      toast.error('Submit failed', msg);
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

  // Live counts for the Evidence Vault hero KPIs.
  const allVaultDocs = [
    ...VAULT_EMPLOYEE.flatMap(s => s.docs.map(d => ({ status: d.status }))),
    ...VAULT_ORG.flatMap(s => s.docs.map(d => ({ status: d.status }))),
  ];
  const vaultCounts = {
    total:    allVaultDocs.length,
    verified: allVaultDocs.filter(d => d.status === 'Verified').length,
    pending:  allVaultDocs.filter(d => d.status === 'Pending').length,
    signed:   allVaultDocs.filter(d => d.status === 'Signed' || d.status === 'Sent').length,
  };
  const employeeDocCount      = VAULT_EMPLOYEE.reduce((n, s) => n + s.docs.length, 0);
  const organizationalDocCount = VAULT_ORG.reduce((n, s) => n + s.docs.length, 0);

  const TABS: { key: TabKey; label: string; icon: string; color: string }[] = [
    { key: 'profile',    label: 'Profile Details', icon: 'ri-user-line',                color: 'linear-gradient(135deg,#6366f1,#8b5cf6)' },
    { key: 'job',        label: 'Job Details',     icon: 'ri-briefcase-line',           color: 'linear-gradient(135deg,#0ab39c,#30d5b5)' },
    { key: 'attendance', label: 'Attendance',      icon: 'ri-calendar-check-line',      color: 'linear-gradient(135deg,#299cdb,#5fc8ff)' },
    { key: 'vault',      label: 'Evidence Vault',  icon: 'ri-folder-shield-2-line',     color: 'linear-gradient(135deg,#a855f7,#c084fc)' },
    { key: 'payroll',    label: 'Payroll Details', icon: 'ri-money-dollar-circle-line', color: 'linear-gradient(135deg,#f59e0b,#fbbf24)' },
    { key: 'expense',    label: 'Expense Details', icon: 'ri-wallet-3-line',            color: 'linear-gradient(135deg,#f06548,#ff7a5c)' },
    { key: 'apply_leave',label: 'Leave',           icon: 'ri-calendar-2-line',          color: 'linear-gradient(135deg,#7c5cfc,#5a3fd1)' },
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
            <p className="mb-1" style={{ color: 'rgba(255,255,255,0.55)', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.06em' }}>{employeeId}</p>
            <p className="mb-2" style={{ color: 'rgba(255,255,255,0.78)', fontSize: 12.5 }}>
              {employee?.department || 'Accounts'}
              <span className="mx-2" style={{ opacity: 0.5 }}>·</span>
              {employee?.designation || 'Associate Engineer'}
              <span className="mx-2" style={{ opacity: 0.5 }}>·</span>
              Full-time
            </p>
            <div className="d-flex gap-2 flex-wrap mb-3">
              {employee?.primaryRole && (
                <span className="ep-hero-pill ep-hero-pill-blue">
                  <i className="ri-suitcase-line" /> {employee.primaryRole}
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
              <div className="ep-hero-meta">
                <i className="ri-mail-line" />
                <div>
                  <span className="ep-hero-meta-label">Email</span>{' '}
                  <span className="ep-hero-meta-value">{employee?.email || 'aarav.kale@enterprise.com'}</span>
                </div>
              </div>
              <div className="ep-hero-meta">
                <i className="ri-user-line" />
                <div>
                  <span className="ep-hero-meta-label">Manager</span>{' '}
                  <span className="ep-hero-meta-value">{employee?.manager || '—'}</span>
                </div>
              </div>
              <div className="ep-hero-meta">
                <i className="ri-phone-line" />
                <div>
                  <span className="ep-hero-meta-label">Mobile</span>{' '}
                  <span className="ep-hero-meta-value">9635203533</span>
                </div>
              </div>
              <div className="ep-hero-meta">
                <i className="ri-calendar-line" />
                <div>
                  <span className="ep-hero-meta-label">Joined</span>{' '}
                  <span className="ep-hero-meta-value">03-Nov-2023</span>
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
    <Row className="g-4 align-items-stretch">
      <Col lg={3} md={4}>
        <div
          className="h-100 d-flex flex-column align-items-center justify-content-center text-center p-3"
          style={{
            border: '1px dashed rgba(99,102,241,0.35)',
            borderRadius: 12,
            background: 'rgba(99,102,241,0.04)',
          }}
        >
      {profilePhotoSrc ? (
        <img
          src={profilePhotoSrc}
          alt="profile"
          className="rounded-circle mb-3"
          style={{ width: 112, height: 112, objectFit: 'cover', border: '3px solid var(--vz-card-bg)', boxShadow: '0 8px 24px rgba(15,23,42,0.16)' }}
        />
      ) : (
        <div
          className="rounded-circle d-inline-flex align-items-center justify-content-center text-muted mb-3"
          style={{ width: 112, height: 112, background: 'var(--vz-secondary-bg)', border: '2px solid var(--vz-border-color)', fontSize: 38 }}
        >
          <i className="ri-user-line" />
        </div>
      )}
        <label className="ep-field-label mb-2">Employee Photo</label>
        <input
          ref={profilePhotoInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={e => handleProfilePhotoChange(e.target.files?.[0] || null)}
          className="form-control form-control-sm"
          style={{ fontSize: 12 }}
        />
        <small className="text-muted mt-2" style={{ fontSize: 11, lineHeight: 1.35 }}>
          JPG, PNG, WebP — Max 4MB · you'll be able to crop & zoom after picking
        </small>
        {profilePhotoFile && (
          <div className="mt-3 d-flex gap-2 flex-wrap justify-content-center">
            <button
              type="button"
              className="btn btn-sm btn-success"
              onClick={handleSaveProfilePhoto}
              disabled={savingPhoto}
            >
              {savingPhoto ? <span className="spinner-border spinner-border-sm me-1" /> : <i className="ri-save-line me-1" />}
              Save Photo
            </button>
            <button
              type="button"
              className="btn btn-sm btn-outline-secondary"
              onClick={() => {
                setProfilePhotoFile(null);
                restoreSavedProfilePhoto();
              }}
            >
              Cancel
            </button>
          </div>
        )}
        </div>
      </Col>
      <Col lg={9} md={8}>
        <Row className="g-4">
          <Col md={4} sm={6}><div className="ep-field-label">First Name</div><div className="ep-field-value">{empDetail?.first_name || (employee?.name || '').split(' ')[0] || '—'}</div></Col>
          <Col md={4} sm={6}><div className="ep-field-label">Middle Name</div><div className="ep-field-value">{empDetail?.middle_name || '—'}</div></Col>
          <Col md={4} sm={6}><div className="ep-field-label">Last Name</div><div className="ep-field-value">{empDetail?.last_name || (employee?.name || '').split(' ').slice(1).join(' ') || '—'}</div></Col>
          <Col md={4} sm={6}><div className="ep-field-label">Display Name</div><div className="ep-field-value">{empDetail?.display_name || employee?.name || '—'}</div></Col>
          <Col md={4} sm={6}><div className="ep-field-label">Date of Birth</div><div className="ep-field-value font-monospace">{fmtDate(empDetail?.date_of_birth)}</div></Col>
          <Col md={4} sm={6}><div className="ep-field-label">Gender</div><div className="ep-field-value">{empDetail?.gender || '—'}</div></Col>
          <Col md={4} sm={6}><div className="ep-field-label">Nationality</div><div className="ep-field-value">{empDetail?.nationality_country?.name || '—'}</div></Col>
        </Row>
      </Col>
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
                  <Row className="g-3">
                    <Col xs={6}>
                      <div className="ep-field-label">Status</div>
                      <div className="ep-field-value">Experienced</div>
                    </Col>
                    <Col xs={6}>
                      <div className="ep-field-label">Total Experience</div>
                      <div className="ep-field-value">5 yrs 3 mos</div>
                    </Col>
                    <Col xs={6}>
                      <div className="ep-field-label">Last Company</div>
                      <div className="ep-field-value">Infotech Solutions Ltd</div>
                    </Col>
                    <Col xs={6}>
                      <div className="ep-field-label">Last Designation</div>
                      <div className="ep-field-value">Software Engineer</div>
                    </Col>
                  </Row>
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

          {/* Security — Change Password section. Sits at the bottom of the
              profile tab so identity/contact/address details remain the top
              of fold. Backend endpoint already enforces the password policy
              (min:8, no last-3 reuse) and sends a confirmation email. */}
          <div className="ep-section-card-flat ep-section-card mb-3" style={{ borderTop: '3px solid #f43f5e' }}>
            <div
              className="d-flex align-items-center gap-3 px-3 py-2"
              style={{
                borderBottom: '1px solid rgba(244,63,94,0.18)',
                background: 'linear-gradient(135deg, rgba(244,63,94,0.12) 0%, rgba(244,63,94,0.03) 60%, rgba(244,63,94,0.01) 100%)',
              }}
            >
              <span className="ep-section-icon" style={{ background: 'rgba(244,63,94,0.18)', color: '#be123c' }}>
                <i className="ri-shield-keyhole-line" />
              </span>
              <h6 className="mb-0 fw-bold" style={{ fontSize: 13 }}>Security</h6>
            </div>
            <div className="px-3 py-3 d-flex align-items-center justify-content-between flex-wrap gap-3">
              <div>
                <div className="fw-semibold" style={{ fontSize: 13 }}>Login password</div>
                <small className="text-muted">
                  Rotate your password regularly. We'll email you a confirmation each time it changes.
                </small>
              </div>
              <Button
                color="danger"
                size="sm"
                className="d-inline-flex align-items-center gap-2"
                onClick={() => { resetPwForm(); setPwOpen(true); }}
              >
                <i className="ri-lock-password-line" /> Change Password
              </Button>
            </div>
            <div className="px-3 py-3 d-flex align-items-center justify-content-between flex-wrap gap-3" style={{ borderTop: '1px solid var(--vz-border-color)' }}>
              <div>
                <div className="fw-semibold" style={{ fontSize: 13 }}>Face biometric for attendance</div>
                <small className="text-muted">
                  Register your face once so you can clock in / out from <a href="/clock-in">/clock-in</a> without a card or password.
                </small>
              </div>
              <Button
                color="primary"
                size="sm"
                className="d-inline-flex align-items-center gap-2"
                onClick={() => setFaceRegOpen(true)}
              >
                <i className="ri-user-smile-line" /> Register Face
              </Button>
            </div>
          </div>
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
                  <span className=" fw-semibold" style={{ background: 'rgba(99,102,241,0.10)', color: '#4338ca', padding: '4px 12px', borderRadius: 8, fontSize: 10 }}>{employeeId}</span>
                </Col>
                <Col><div className="ep-field-label">Joining Date</div><div className="ep-field-value " style={{ fontSize: 11 }}>29-Apr-2026</div></Col>
                <Col><div className="ep-field-label">Job Title (Primary)</div><div className="ep-field-value">{employee?.designation || '—'}</div></Col>
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
                <Col><div className="ep-field-label">Employment Status</div><div className="ep-field-value">{employee?.enabled === false ? 'Disabled' : 'active'}</div></Col>
                <Col><div className="ep-field-label">Worker Type</div><div className="ep-field-value">Full-time</div></Col>
                <Col><div className="ep-field-label">Time Type</div><div className="ep-field-value">Full Time</div></Col>
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
                <Col md={3}><div className="ep-field-label">Legal Entity</div><div className="ep-field-value">Inorbvict Healthcare India Pvt. Ltd.</div></Col>
                <Col md={3}><div className="ep-field-label">Department</div><div className="ep-field-value">{employee?.department || '—'}</div></Col>
                <Col md={3}><div className="ep-field-label">Location</div><div className="ep-field-value">Pune, Maharashtra</div></Col>
                <Col md={3}><div className="ep-field-label">Reporting Manager</div><div className="ep-field-value">{employee?.manager || '—'}</div></Col>
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
                    <Col xs={6}><div className="ep-field-label">Probation Policy</div><div className="ep-field-value">Default Probation Policy</div></Col>
                    <Col xs={6}><div className="ep-field-label">Probation Duration</div><div className="ep-field-value">3 Months</div></Col>
                    <Col xs={6}><div className="ep-field-label">Notice Period</div><div className="ep-field-value">2 Months</div></Col>
                    <Col xs={6}><div className="ep-field-label">Contract Status</div><div className="ep-field-value">Permanent</div></Col>
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
                <Col md={3}><div className="ep-field-label">Laptop Assigned</div><div className="ep-field-value">Yes</div></Col>
                <Col md={3}>
                  <div className="ep-field-label">Laptop Asset ID</div>
                  <span className="font-monospace fw-semibold" style={{ background: 'rgba(99,102,241,0.10)', color: '#4338ca', padding: '4px 12px', borderRadius: 8, fontSize: 9 }}>LAP-0042</span>
                </Col>
                <Col md={3}><div className="ep-field-label">Laptop Type</div><div className="ep-field-value">Dell Latitude 5510</div></Col>
                <Col md={3}><div className="ep-field-label">Mobile Device</div><div className="ep-field-value text-muted fw-normal">—</div></Col>

                <Col md={3}><div className="ep-field-label">Monitor</div><div className="ep-field-value">24" Dell Monitor</div></Col>
                <Col md={3}><div className="ep-field-label">Keyboard</div><div className="ep-field-value">Logitech K380</div></Col>
                <Col md={3}><div className="ep-field-label">Mouse</div><div className="ep-field-value">Logitech MX</div></Col>
                <Col md={3}><div className="ep-field-label">Headset</div><div className="ep-field-value text-muted fw-normal">—</div></Col>

                <Col md={3}><div className="ep-field-label">Other Assets</div><div className="ep-field-value">Access Card, Desk</div></Col>
                <Col md={3}><div className="ep-field-label">Asset Issued Date</div><div className="ep-field-value font-monospace">17-May-2022</div></Col>
                <Col md={3}><div className="ep-field-label">Acknowledgment</div><div className="ep-field-value">Signed</div></Col>
                <Col md={3}><div className="ep-field-label">Return Required</div><div className="ep-field-value">No</div></Col>
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
                        <div className="fw-bold lh-1" style={{ color: c.color, fontSize: 13 }}>{c.value}</div>
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
                        className="badge rounded-pill"
                        style={{
                          fontSize: 10,
                          padding: '2px 6px',
                          background: on ? 'rgba(255,255,255,0.22)' : 'var(--vz-light)',
                          color: on ? '#fff' : 'var(--vz-secondary-color)',
                        }}
                      >
                        {t.count}
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
                  <h4 className="mb-0 fw-bold" style={{ color: '#5a3fd1', fontSize: 22, lineHeight: 1 }}>{uploadedDocs.length}</h4>
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
                        <tr><td colSpan={8} style={{ padding: 28, textAlign: 'center', color: '#9ca3af' }}>
                          <i className="ri-loader-4-line" style={{ fontSize: 24, display: 'block', marginBottom: 6 }} />
                          Loading uploaded documents…
                        </td></tr>
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
                  <h4 className="mb-0 fw-bold" style={{ color: '#16a34a', fontSize: 22, lineHeight: 1 }}>{signedDocs.length}</h4>
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
                        <tr><td colSpan={6} style={{ padding: 22, textAlign: 'center', color: '#9ca3af' }}>
                          <i className="ri-loader-4-line" style={{ fontSize: 22, display: 'block', marginBottom: 6 }} />
                          Loading signed documents…
                        </td></tr>
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
                              <code style={{ fontSize: 10.5, background: '#fef3c7', color: '#a16207', padding: '2px 6px', borderRadius: 4 }}>{doc.code || '—'}</code>
                            </td>
                            <td>
                              <div className="d-flex flex-wrap gap-1">
                                {(doc.signers || []).slice(0, 3).map((s, j) => (
                                  <span key={j} style={{ fontSize: 10.5, padding: '2px 7px', borderRadius: 999, background: s.status === 'Done' ? '#dcfce7' : '#f3f4f6', color: s.status === 'Done' ? '#15803d' : '#6b7280', fontWeight: 700 }}>
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
                                <button type="button" onClick={() => setSignedPreview(doc)}
                                  style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid #c7d2fe', background: '#eef2ff', color: '#4338ca', fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}>
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

          {/* Organizational Documents sub-tab */}
          {vaultTab === 'organizational' && VAULT_ORG.map(section => (
            <div
              className="ep-section-card-flat ep-section-card mb-3"
              style={{ borderTop: `3px solid ${section.iconFg}` }}
              key={section.title}
            >
              <div
                className="d-flex align-items-center justify-content-between gap-3 px-3 py-2"
                style={{
                  borderBottom: `1px solid color-mix(in srgb, ${section.iconFg} 18%, transparent)`,
                  background: `linear-gradient(135deg, color-mix(in srgb, ${section.iconFg} 14%, transparent) 0%, color-mix(in srgb, ${section.iconFg} 4%, transparent) 60%, color-mix(in srgb, ${section.iconFg} 1%, transparent) 100%)`,
                }}
              >
                <div className="d-flex align-items-center gap-2">
                  <span className="ep-section-icon" style={{ background: `color-mix(in srgb, ${section.iconFg} 18%, transparent)`, color: section.iconFg }}>
                    <i className={section.icon} />
                  </span>
                  <div>
                    <h6 className="mb-0 fw-bold" style={{ fontSize: 12 }}>{section.title}</h6>
                    <small className="text-muted" style={{ fontSize: 11 }}>{section.subtitle}</small>
                  </div>
                </div>
                <div className="text-end">
                  <h4 className="mb-0 fw-bold" style={{ color: section.iconFg, fontSize: 22, lineHeight: 1 }}>{section.docs.length}</h4>
                  <small className="text-muted text-uppercase" style={{ fontSize: 9.5, letterSpacing: '0.06em', fontWeight: 700 }}>Documents</small>
                </div>
              </div>
              <div className="px-3 pb-3 pt-2">
                <div className="table-responsive border rounded ep-att-scroll-wrap">
                  <table className="table align-middle table-nowrap ep-att-table mb-0">
                    <thead className="table-light">
                      <tr>
                        {['SR', 'Document Name', 'Type', 'Effective Date', 'Valid Until', 'Attachment', 'Status'].map(h => (
                          <th key={h}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {section.docs.map((doc, idx) => {
                        const st = VAULT_STATUS_TONE[doc.status];
                        const typeTone = doc.type === 'AGREEMENT'
                          ? { bg: '#d6f4e3', fg: '#108548' }
                          : { bg: '#dceefe', fg: '#0c63b0' };
                        return (
                          <tr key={`${section.title}-${doc.name}`}>
                            <td className="text-muted">{idx + 1}</td>
                            <td className="fw-semibold">{doc.name}</td>
                            <td>
                              <span className="d-inline-flex align-items-center fw-semibold text-uppercase" style={{ fontSize: 9.5, padding: '3px 9px', borderRadius: 999, background: typeTone.bg, color: typeTone.fg, letterSpacing: '0.04em' }}>
                                {doc.type}
                              </span>
                            </td>
                            <td className="font-monospace">{doc.effectiveDate || <span className="text-muted">—</span>}</td>
                            <td className="font-monospace">{doc.validUntil || <span className="text-muted">—</span>}</td>
                            <td>
                              {doc.attachment
                                ? <a href="#" onClick={e => { e.preventDefault(); toast.info('Downloading attachment', `${doc.attachment} is being prepared…`); }} className="d-inline-flex align-items-center gap-1 text-decoration-none" style={{ background: 'rgba(16,185,129,0.10)', color: '#0a8a78', padding: '3px 9px', borderRadius: 999, fontSize: 11, fontWeight: 600, border: '1px solid rgba(16,185,129,0.25)' }}>
                                    <i className="ri-file-text-line" /> {doc.attachment}
                                  </a>
                                : <span className="text-muted">—</span>}
                            </td>
                            <td>
                              <span className="d-inline-flex align-items-center gap-1 fw-semibold text-uppercase" style={{ fontSize: 9.5, padding: '3px 9px', borderRadius: 999, background: st.bg, color: st.fg, letterSpacing: '0.04em' }}>
                                <span style={{ width: 5, height: 5, borderRadius: '50%', background: st.dot }} /> {doc.status}
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
          ))}
        </>
      )}

      {/* ── Tab: Payroll Details ── */}
      {tab === 'payroll' && (
        <ComingSoonShell title="Payroll" subtitle="Salary breakdown, payment history, tax sheets">
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
                          onClick={() => setPaySlipOpen(true)}
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
                        <h2 className="mb-0 fw-bold text-white" style={{ fontSize: 28, lineHeight: 1.1 }}>₹3,02,400</h2>
                        <p className="mb-0 mt-1" style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.80)' }}>Per Annum</p>
                      </div>
                      <div className="d-flex gap-3 mt-3 pt-2" style={{ borderTop: '1px solid rgba(255,255,255,0.18)' }}>
                        <div>
                          <p className="mb-1" style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.72)' }}>Monthly</p>
                          <h6 className="mb-0 text-white fw-bold" style={{ fontSize: 12 }}>₹25,200</h6>
                        </div>
                        <div className="ps-3" style={{ borderLeft: '1px solid rgba(255,255,255,0.18)' }}>
                          <p className="mb-1" style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.72)' }}>Annual</p>
                          <h6 className="mb-0 text-white fw-bold" style={{ fontSize: 12 }}>₹3,02,400</h6>
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
                    onClick={() => setReviseOpen(true)}
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
                  {SALARY_TIMELINE.map((row, idx) => (
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
        </ComingSoonShell>
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
                  <p className="mb-0 text-uppercase fw-semibold" style={{ color: 'rgba(255,255,255,0.72)', letterSpacing: '0.06em', fontSize: 9.5 }}>Expense Overview</p>
                  <div className="text-white" style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.25 }}>
                    Total Claimed: <span style={{ color: '#bce8ff' }}>₹{totalClaimed.toLocaleString('en-IN')}</span>
                  </div>
                  <small style={{ color: 'rgba(255,255,255,0.70)', fontSize: 10.5 }}>{expenseCounts.all} claims · {expenseCounts.approved} approved · {expenseCounts.pending} pending</small>
                </Col>
                <Col xs="12" lg="auto">
                  <div className="d-flex gap-1 flex-wrap justify-content-lg-end">
                    {[
                      { label: 'Total',    value: expenseCounts.all,      color: '#fff' },
                      { label: 'Approved', value: expenseCounts.approved, color: '#86efac' },
                      { label: 'Pending',  value: expenseCounts.pending,  color: '#fcd34d' },
                      { label: 'Rejected', value: expenseCounts.rejected, color: '#fca5a5' },
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
                  </div>
                </Col>
              </Row>
            </div>
          </Card>

          {/* Expense Claims */}
          <div
            className="ep-section-card-flat ep-section-card mb-3"
            style={{ borderTop: '3px solid #a855f7' }}
          >
            <div
              className="d-flex align-items-center justify-content-between gap-3 px-3 py-2 flex-wrap"
              style={{
                borderBottom: '1px solid rgba(168,85,247,0.18)',
                background: 'linear-gradient(135deg, rgba(168,85,247,0.14) 0%, rgba(168,85,247,0.04) 60%, rgba(168,85,247,0.01) 100%)',
              }}
            >
              <div className="d-flex align-items-center gap-2">
                <span className="ep-section-icon" style={{ background: 'rgba(168,85,247,0.18)', color: '#7c3aed' }}>
                  <i className="ri-file-list-3-line" />
                </span>
                <div>
                  <h6 className="mb-0 fw-bold" style={{ fontSize: 12 }}>Expense Claims</h6>
                  <small className="text-muted" style={{ fontSize: 11 }}>
                    {expenseCounts.all} total · {expenseCounts.approved} approved · {expenseCounts.pending} pending
                  </small>
                </div>
              </div>
              <div className="d-flex align-items-center gap-2 flex-wrap">
                <div className="search-box" style={{ minWidth: 200 }}>
                  <input type="text" className="form-control form-control-sm" placeholder="Search…" style={{ fontSize: 12, height: 30 }} />
                  <i className="ri-search-line search-icon" style={{ fontSize: 12 }} />
                </div>
                <button
                  type="button"
                  className="btn btn-sm rounded-pill fw-semibold d-inline-flex align-items-center gap-1"
                  style={{
                    background: 'var(--vz-card-bg)',
                    color: '#374151',
                    border: '1px solid var(--vz-border-color)',
                    fontSize: 11.5, padding: '4px 12px',
                  }}
                >
                  <i className="ri-download-2-line" /> Export
                </button>
                <button
                  type="button"
                  className="btn btn-sm rounded-pill fw-semibold d-inline-flex align-items-center gap-1"
                  style={{
                    background: 'linear-gradient(135deg,#f97316,#fb923c)',
                    color: '#fff',
                    border: 'none',
                    boxShadow: '0 4px 10px rgba(249,115,22,0.28)',
                    fontSize: 11.5, padding: '4px 12px',
                  }}
                  onClick={() => { setClaimMode('expense'); setClaimOpen(true); }}
                >
                  <i className="ri-add-line" /> Raise New Claim
                </button>
              </div>
            </div>
            <div className="px-3 pb-3 pt-2">
              {/* My / Team sub-tabs — only render when the current user is
                  viewing their own profile AND has a team (i.e. is someone's
                  reporting manager). For everyone else the table behaves as
                  a single-list view (the user's own claims). */}
              {isOwnProfile && teamClaims.length > 0 && (
                <div className="d-flex gap-1 mb-3" style={{
                  background: 'var(--vz-secondary-bg)', padding: 4, borderRadius: 10,
                  border: '1px solid var(--vz-border-color)', width: 'fit-content',
                }}>
                  {[
                    { key: 'mine' as const, label: 'My Expenses',   icon: 'ri-user-line',   count: apiClaims.length },
                    { key: 'team' as const, label: 'Team Expenses', icon: 'ri-team-line',   count: teamClaims.length },
                  ].map(t => {
                    const on = expenseSubTab === t.key;
                    return (
                      <button
                        key={t.key}
                        type="button"
                        onClick={() => setExpenseSubTab(t.key)}
                        className="d-inline-flex align-items-center gap-2 fw-semibold"
                        style={{
                          fontSize: 12,
                          padding: '5px 14px',
                          borderRadius: 8,
                          border: 'none',
                          background: on ? 'var(--vz-card-bg)' : 'transparent',
                          color: on ? '#7c3aed' : 'var(--vz-secondary-color)',
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
                            background: on ? 'rgba(124,58,237,0.12)' : 'var(--vz-secondary-bg)',
                            color: on ? '#7c3aed' : 'var(--vz-secondary-color)',
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
                  strong visibility; inactive = subtle white with border. */}
              <div className="d-flex gap-2 flex-wrap mb-3">
                {[
                  { key: 'all'      as ExpenseFilter, label: 'All',      count: expenseCounts.all,      active: '#6366f1', shadow: 'rgba(99,102,241,0.32)' },
                  { key: 'approved' as ExpenseFilter, label: 'Approved', count: expenseCounts.approved, active: '#10b981', shadow: 'rgba(16,185,129,0.32)' },
                  { key: 'rejected' as ExpenseFilter, label: 'Rejected', count: expenseCounts.rejected, active: '#ef4444', shadow: 'rgba(239,68,68,0.32)'  },
                  { key: 'pending'  as ExpenseFilter, label: 'Pending',  count: expenseCounts.pending,  active: '#f59e0b', shadow: 'rgba(245,158,11,0.32)' },
                ].map(f => {
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

              {/* Claims table — API-backed. Status pill replaces the old
                  Payment Action column; the 3-dot Action menu opens the audit
                  log popover (Created → Manager → HR/Finance). When viewing
                  Team Expenses as the assigned manager, inline Approve/Reject
                  buttons appear next to the menu. */}
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

              <div className="d-flex justify-content-between align-items-center flex-wrap gap-2 mt-3 pt-2 border-top">
                <small className="text-muted">
                  Showing <strong className="text-body">{filteredExpenses.length}</strong> claim{filteredExpenses.length === 1 ? '' : 's'}
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
        <LeaveSummaryPanel employeeId={employeeId} />
      )}

      </div>
    </div>

    {/* ── Attendance Regularization Modal ── */}
    <EpModal open={regOpen} onClose={() => setRegOpen(false)} size="md" panelClassName="ep-reg-modal">

        <div className="ep-reg-header">
          <h5>Request Attendance Regularization</h5>
          <button type="button" className="ep-reg-x" onClick={() => setRegOpen(false)} aria-label="Close">
            <i className="ri-close-line" style={{ fontSize: 16 }} />
          </button>
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
      <EpModal open={paySlipOpen} onClose={() => setPaySlipOpen(false)} size="xl" panelClassName="ep-pay-modal">
        <div className="ep-pay-shell">
          {/* Header bar */}
          <div className="ep-pay-header">
            <div className="d-flex align-items-center gap-3">
              <span className="ep-pay-logo">
                <i className="ri-file-text-line" />
              </span>
              <div>
                <h5 className="mb-0 fw-bold" style={{ fontSize: 13 }}>Payslip Viewer</h5>
                <small className="text-muted" style={{ fontSize: 10.5 }}>Select month and year to view or download payslip</small>
              </div>
            </div>
            <div className="d-flex align-items-center gap-2">
              <button type="button" className="btn fw-semibold d-inline-flex align-items-center gap-1" style={{ background: 'linear-gradient(135deg,#0ab39c,#02c8a7)', color: '#fff', border: 'none', fontSize: 11, padding: '5px 12px', borderRadius: 7, boxShadow: '0 3px 10px rgba(10,179,156,0.28)' }}>
                <i className="ri-download-2-line" /> Download PDF
              </button>
              <button type="button" className="btn fw-semibold d-inline-flex align-items-center gap-1" style={{ background: 'var(--vz-card-bg)', color: 'var(--vz-body-color)', border: '1px solid var(--vz-border-color)', fontSize: 11, padding: '5px 12px', borderRadius: 7 }}>
                <i className="ri-printer-line" /> Print
              </button>
              <button type="button" className="btn fw-semibold d-inline-flex align-items-center gap-1" style={{ background: 'var(--vz-card-bg)', color: 'var(--vz-body-color)', border: '1px solid var(--vz-border-color)', fontSize: 11, padding: '5px 12px', borderRadius: 7 }}>
                <i className="ri-mail-line" /> Email
              </button>
              <button type="button" className="ep-pay-x" onClick={() => setPaySlipOpen(false)} aria-label="Close">
                <i className="ri-close-line" style={{ fontSize: 14 }} />
              </button>
            </div>
          </div>

          {/* Body — sidebar + payslip preview */}
          <div className="ep-pay-body">
            {/* Sidebar */}
            <aside className="ep-pay-sidebar">
              <div className="ep-pay-side-label">Filter</div>
              <div className="mb-3">
                <div className="ep-pay-mini-label">Year</div>
                <MasterSelect
                  value={paySlipYear}
                  options={['2026','2025','2024'].map(y => ({ value: y, label: y }))}
                  onChange={setPaySlipYear}
                />
              </div>
              <div className="mb-3">
                <div className="ep-pay-mini-label">Month</div>
                <MasterSelect
                  value={paySlipMonth}
                  options={['January','February','March','April','May','June','July','August','September','October','November','December'].map(m => ({ value: m, label: m }))}
                  onChange={setPaySlipMonth}
                />
              </div>
              <button type="button" className="ep-pay-side-btn">
                <i className="ri-eye-line me-1" /> View Payslip
              </button>

              <div className="ep-pay-side-label mt-4">Recent Payslips</div>
              <div className="d-flex flex-column gap-2">
                {PAYSLIP_RECENT.map(p => (
                  <button
                    key={p.label}
                    type="button"
                    className={`ep-pay-recent${p.now ? ' is-current' : ''}`}
                    onClick={() => {
                      const [m, y] = p.label.split(' ');
                      const monthMap: Record<string,string> = { Jan:'January', Feb:'February', Mar:'March', Apr:'April', May:'May', Jun:'June', Jul:'July', Aug:'August', Sep:'September', Oct:'October', Nov:'November', Dec:'December' };
                      setPaySlipMonth(monthMap[m] || m);
                      setPaySlipYear(y);
                    }}
                  >
                    <span>{p.label}</span>
                    {p.now ? <span className="ep-pay-now">NOW</span> : <i className="ri-arrow-right-s-line" />}
                  </button>
                ))}
              </div>
            </aside>

            {/* Payslip preview */}
            <div className="ep-pay-preview">
              {/* Company hero */}
              <div className="ep-pay-company">
                <div style={{ position: 'absolute', top: -40, right: -30, width: 180, height: 180, borderRadius: '50%', background: 'rgba(255,255,255,0.06)', pointerEvents: 'none' }} />
                <div className="d-flex align-items-start justify-content-between gap-3" style={{ position: 'relative', zIndex: 1 }}>
                  <div className="d-flex align-items-center gap-2">
                    <span className="ep-pay-company-logo">IN</span>
                    <div>
                      <h5 className="mb-0 text-white fw-bold" style={{ fontSize: 14 }}>INORBVICT Healthcare India Pvt. Ltd.</h5>
                      <small style={{ color: 'rgba(255,255,255,0.72)', fontSize: 10.5 }}>
                        Pune, Maharashtra, India · GSTIN: 27XXXXXXXXXXX · CIN: U85190MH2020PTC339XXX
                      </small>
                    </div>
                  </div>
                  <div className="text-end">
                    <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.10em', color: 'rgba(255,255,255,0.62)' }}>PAYSLIP</div>
                    <h4 className="text-white mb-0 fw-bold" style={{ fontSize: 17 }}>{paySlipMonth} {paySlipYear}</h4>
                    <small style={{ color: 'rgba(255,255,255,0.72)', fontSize: 10 }}>Pay Period: 01–31 {paySlipMonth.slice(0,3)} {paySlipYear}</small>
                  </div>
                </div>

                {/* Inner identity strip */}
                <div className="ep-pay-identity">
                  {[
                    { label: 'Employee Name', value: employee?.name || 'Aarav Patel' },
                    { label: 'Employee ID',   value: employeeId },
                    { label: 'Designation',   value: employee?.designation || 'VP Engineering' },
                    { label: 'Department',    value: employee?.department || 'Software Development' },
                    { label: 'Pay Period',    value: `${paySlipMonth.slice(0,3)} ${paySlipYear}` },
                  ].map(c => (
                    <div className="ep-pay-identity-cell" key={c.label}>
                      <div className="ep-pay-identity-label">{c.label}</div>
                      <div className="ep-pay-identity-value">{c.value}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* 4 KPI strip */}
              <div className="ep-pay-kpis">
                {[
                  { label: 'Working Days', value: 31, tint: 'rgba(99,102,241,0.10)',  fg: '#4338ca' },
                  { label: 'Days Present', value: 31, tint: 'rgba(10,179,156,0.10)',  fg: '#0a8a78' },
                  { label: 'Loss of Pay',  value: 0,  tint: 'rgba(245,158,11,0.10)',  fg: '#a16207' },
                  { label: 'Paid Days',    value: 31, tint: 'rgba(10,179,156,0.10)',  fg: '#0a8a78' },
                ].map(k => (
                  <div className="ep-pay-kpi" key={k.label} style={{ background: k.tint }}>
                    <div className="ep-pay-kpi-label">{k.label}</div>
                    <div className="ep-pay-kpi-value" style={{ color: k.fg }}>{k.value}</div>
                  </div>
                ))}
              </div>

              {/* Earnings + Deductions */}
              <Row className="g-2 mb-2">
                <Col md={6}>
                  <div className="ep-pay-table-card">
                    <div className="ep-pay-table-head">
                      <span className="ep-pay-dot" style={{ background: '#10b981' }} />
                      <span style={{ color: '#108548' }}>EARNINGS</span>
                    </div>
                    <table className="ep-pay-table">
                      <thead>
                        <tr><th>Component</th><th className="text-end">Monthly</th></tr>
                      </thead>
                      <tbody>
                        {PAYSLIP_EARNINGS.map(r => (
                          <tr key={r.label}>
                            <td>{r.label}</td>
                            <td className="text-end fw-semibold">₹{r.amount.toLocaleString('en-IN')}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr style={{ background: 'rgba(16,185,129,0.06)' }}>
                          <td className="fw-bold" style={{ color: '#108548' }}>Total Earnings</td>
                          <td className="text-end fw-bold" style={{ color: '#108548' }}>₹{paySlipTotalEarnings.toLocaleString('en-IN')}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </Col>
                <Col md={6}>
                  <div className="ep-pay-table-card">
                    <div className="ep-pay-table-head">
                      <span className="ep-pay-dot" style={{ background: '#ef4444' }} />
                      <span style={{ color: '#b91c1c' }}>DEDUCTIONS</span>
                    </div>
                    <table className="ep-pay-table">
                      <thead>
                        <tr><th>Component</th><th className="text-end">Monthly</th></tr>
                      </thead>
                      <tbody>
                        {PAYSLIP_DEDUCTIONS.map(r => (
                          <tr key={r.label}>
                            <td>{r.label}</td>
                            <td className="text-end fw-semibold">₹{r.amount.toLocaleString('en-IN')}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr style={{ background: 'rgba(239,68,68,0.06)' }}>
                          <td className="fw-bold" style={{ color: '#b91c1c' }}>Total Deductions</td>
                          <td className="text-end fw-bold" style={{ color: '#b91c1c' }}>₹{paySlipTotalDeductions.toLocaleString('en-IN')}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </Col>
              </Row>

              {/* Net Pay banner */}
              <div className="ep-pay-net">
                <div>
                  <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.10em', color: 'rgba(255,255,255,0.78)' }}>
                    NET PAY — {paySlipMonth.toUpperCase()} {paySlipYear}
                  </div>
                  <h5 className="text-white fw-semibold mb-2" style={{ fontSize: 12 }}>Gross Earnings − Total Deductions</h5>
                  <div className="d-flex gap-3">
                    <div>
                      <div style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '0.10em', color: 'rgba(255,255,255,0.65)' }}>GROSS</div>
                      <div className="text-white fw-bold" style={{ fontSize: 12 }}>₹{paySlipTotalEarnings.toLocaleString('en-IN')}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '0.10em', color: 'rgba(255,255,255,0.65)' }}>DEDUCTIONS</div>
                      <div className="fw-bold" style={{ color: '#fecaca', fontSize: 12 }}>−₹{paySlipTotalDeductions.toLocaleString('en-IN')}</div>
                    </div>
                  </div>
                </div>
                <div className="text-end">
                  <h2 className="text-white fw-bold mb-0" style={{ fontSize: 26 }}>
                    ₹{paySlipNetPay.toLocaleString('en-IN')}
                  </h2>
                  <small style={{ color: 'rgba(255,255,255,0.78)', fontSize: 10 }}>Per Month (In Hand)</small>
                </div>
              </div>

              <div className="ep-pay-footer">
                This is a computer-generated payslip. No signature required. Queries:{' '}
                <a href="mailto:hr@inorbvict.com">hr@inorbvict.com</a>
              </div>
            </div>
          </div>
        </div>
      </EpModal>

      {/* ── Revise Salary Modal ── */}
      <EpModal open={reviseOpen} onClose={() => setReviseOpen(false)} size="xl" panelClassName="ep-rev-modal">
        {/* Hero header */}
        <div className="ep-rev-hero">
          <div className="d-flex align-items-start justify-content-between gap-3">
            <div>
              <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.10em', color: 'rgba(255,255,255,0.62)' }}>PAYROLL ACTION</div>
              <h4 className="text-white fw-bold mb-0" style={{ fontSize: 16 }}>Revise Salary</h4>
            </div>
            <div className="d-flex align-items-center gap-2">
              <button type="button" className="ep-rev-cancel-hero" onClick={() => setReviseOpen(false)}>Cancel</button>
              <button type="button" className="ep-rev-submit-hero" onClick={() => setReviseOpen(false)}>
                <i className="ri-check-line me-1" /> Revise Salary
              </button>
            </div>
          </div>

          {/* Employee strip */}
          <div className="ep-rev-strip">
            <div className="ep-rev-strip-cell">
              <span className="ep-rev-avatar">{initials}</span>
              <div>
                <div className="ep-rev-strip-label">Employee</div>
                <div className="ep-rev-strip-value">{employee?.name || 'Aarav Patel'}</div>
                <div className="ep-rev-strip-sub">{employee?.designation || 'VP Engineering'}</div>
              </div>
            </div>
            <div className="ep-rev-strip-cell">
              <div>
                <div className="ep-rev-strip-label">Joined</div>
                <div className="ep-rev-strip-value">17-May-2022</div>
              </div>
            </div>
            <div className="ep-rev-strip-cell">
              <div>
                <div className="ep-rev-strip-label">Department</div>
                <div className="ep-rev-strip-value">{employee?.department || 'Software Development'}</div>
              </div>
            </div>
            <div className="ep-rev-strip-cell">
              <div>
                <div className="ep-rev-strip-label">Current Salary</div>
                <div className="ep-rev-strip-value">₹{currentAnnual.toLocaleString('en-IN')}</div>
              </div>
            </div>
            <div className="ep-rev-strip-cell">
              <div>
                <div className="ep-rev-strip-label">Remuneration</div>
                <div className="ep-rev-strip-value">Annual</div>
              </div>
            </div>
            <div className="ep-rev-strip-cell">
              <div>
                <div className="ep-rev-strip-label">Bonus</div>
                <div className="ep-rev-strip-value" style={{ color: '#fcd34d' }}>₹0</div>
              </div>
            </div>
          </div>
        </div>

        {/* Body — form on left, live preview on right */}
        <div className="ep-rev-body">
          <div className="ep-rev-form">
            {/* New Salary Details */}
            <div className="ep-rev-card mb-2">
              <div className="d-flex align-items-center gap-2 mb-2">
                <span className="ep-rev-icon" style={{ background: 'linear-gradient(135deg,#0ab39c,#02c8a7)' }}>
                  <i className="ri-money-dollar-circle-line" />
                </span>
                <h6 className="mb-0 fw-bold" style={{ fontSize: 12 }}>New Salary Details</h6>
              </div>
              <Row className="g-2">
                <Col md={6}>
                  <div className="ep-rev-label">New Salary (₹ Annual)</div>
                  <div className="position-relative">
                    <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--vz-secondary-color)', fontSize: 11.5, fontWeight: 600 }}>₹</span>
                    <input
                      className="ep-rev-input"
                      style={{ paddingLeft: 24 }}
                      value={reviseAmount}
                      onChange={e => setReviseAmount(e.target.value)}
                      placeholder="0"
                    />
                  </div>
                </Col>
                <Col md={6}>
                  <div className="ep-rev-label">Percentage Change (%)</div>
                  <div className="position-relative">
                    <input
                      className="ep-rev-input"
                      style={{ paddingRight: 24 }}
                      value={revisePct}
                      onChange={e => setRevisePct(e.target.value)}
                      placeholder="e.g. 15"
                    />
                    <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--vz-secondary-color)', fontSize: 11.5, fontWeight: 600 }}>%</span>
                  </div>
                </Col>
              </Row>
            </div>

            <Row className="g-2 mb-2">
              <Col md={6}>
                <div className="ep-rev-card h-100">
                  <h6 className="fw-bold mb-1" style={{ fontSize: 12 }}>Salary Structure</h6>
                  <div className="ep-rev-label mt-2">Structure Type</div>
                  <MasterSelect
                    value={reviseStructure}
                    options={['Class A', 'Class B', 'Class C'].map(s => ({ value: s, label: s }))}
                    onChange={setReviseStructure}
                  />
                </div>
              </Col>
              <Col md={6}>
                <div className="ep-rev-card h-100">
                  <h6 className="fw-bold mb-1" style={{ fontSize: 12 }}>Effective Date</h6>
                  <div className="ep-rev-label mt-2">From Date</div>
                  <MasterDatePicker
                    value={reviseDate}
                    onChange={setReviseDate}
                  />
                </div>
              </Col>
            </Row>

            <div className="ep-rev-card mb-2">
              <div className="d-flex align-items-center justify-content-between mb-1">
                <h6 className="mb-0 fw-bold" style={{ fontSize: 11 }}>Bonus</h6>
                <label className="d-inline-flex align-items-center gap-1" style={{ fontSize: 11, cursor: 'pointer' }}>
                  <input type="checkbox" checked={reviseBonusInSal} onChange={e => setReviseBonusInSal(e.target.checked)} />
                  Include bonus in salary
                </label>
              </div>
              {reviseBonusOpen && (
                <div className="mb-1">
                  <div className="ep-rev-label">Bonus Amount (₹)</div>
                  <div className="position-relative">
                    <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--vz-secondary-color)', fontSize: 11.5, fontWeight: 600 }}>₹</span>
                    <input
                      className="ep-rev-input"
                      style={{ paddingLeft: 24 }}
                      placeholder="0"
                      value={reviseBonusAmount}
                      onChange={e => setReviseBonusAmount(e.target.value)}
                    />
                  </div>
                </div>
              )}
              <button
                type="button"
                className="ep-rev-add-btn"
                onClick={() => {
                  if (reviseBonusOpen) {
                    setReviseBonusOpen(false);
                    setReviseBonusAmount('');
                  } else {
                    setReviseBonusOpen(true);
                  }
                }}
              >
                <i className={reviseBonusOpen ? 'ri-subtract-line' : 'ri-add-line'} />{' '}
                {reviseBonusOpen ? 'Remove Bonus' : 'Add Bonus'}
              </button>
            </div>

            <div className="ep-rev-card">
              <h6 className="fw-bold mb-1" style={{ fontSize: 12 }}>
                Add Note <span className="text-muted fw-normal" style={{ fontSize: 10.5 }}>(optional)</span>
              </h6>
              <textarea
                className="ep-rev-input mt-1"
                rows={2}
                placeholder="Reason for revision, performance notes, appraisal cycle..."
                value={reviseNote}
                onChange={e => setReviseNote(e.target.value)}
              />
            </div>
          </div>

          {/* Live preview sidebar */}
          <aside className="ep-rev-preview">
            <div className="d-flex align-items-center gap-2 mb-2">
              <i className="ri-eye-line" style={{ color: '#0ab39c', fontSize: 13 }} />
              <h6 className="mb-0 fw-bold" style={{ fontSize: 12 }}>Live Preview</h6>
            </div>

            <div className="ep-rev-net">
              <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.10em', color: 'rgba(255,255,255,0.78)' }}>NEW COMPENSATION</div>
              <h2 className="text-white fw-bold mb-0" style={{ fontSize: 22, lineHeight: 1.1 }}>
                ₹{reviseAnnualNum.toLocaleString('en-IN')}
              </h2>
              <small style={{ color: 'rgba(255,255,255,0.78)', fontSize: 10 }}>Per Annum</small>
              <div className="d-flex justify-content-between mt-2 pt-2" style={{ borderTop: '1px solid rgba(255,255,255,0.20)' }}>
                <div>
                  <div style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '0.08em', color: 'rgba(255,255,255,0.65)' }}>MONTHLY</div>
                  <div className="text-white fw-bold" style={{ fontSize: 11.5 }}>₹{reviseMonthlyNum.toLocaleString('en-IN')}</div>
                </div>
                <div>
                  <div style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '0.08em', color: 'rgba(255,255,255,0.65)' }}>BONUS</div>
                  <div className="fw-bold" style={{ color: '#fcd34d', fontSize: 11.5 }}>₹0</div>
                </div>
                <div>
                  <div style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '0.08em', color: 'rgba(255,255,255,0.65)' }}>TOTAL</div>
                  <div className="text-white fw-bold" style={{ fontSize: 11.5 }}>₹{reviseAnnualNum.toLocaleString('en-IN')}</div>
                </div>
              </div>
            </div>

            <div className="ep-rev-summary">
              <div className="ep-rev-summary-head">CHANGE SUMMARY</div>
              <div className="ep-rev-summary-row">
                <span>Current Salary</span>
                <span className="fw-semibold">₹{currentAnnual.toLocaleString('en-IN')}</span>
              </div>
              <div className="ep-rev-summary-row">
                <span>New Salary</span>
                <span className="fw-semibold" style={{ color: '#0a8a78' }}>
                  {reviseAnnualNum > 0 ? `₹${reviseAnnualNum.toLocaleString('en-IN')}` : '₹—'}
                </span>
              </div>
              <div className="ep-rev-summary-row">
                <span>Difference</span>
                <span className="fw-semibold" style={{ color: reviseDifference >= 0 ? '#0a8a78' : '#b91c1c' }}>
                  {reviseAnnualNum > 0 ? `${reviseDifference >= 0 ? '+' : ''}₹${reviseDifference.toLocaleString('en-IN')}` : '₹—'}
                </span>
              </div>
              <div className="ep-rev-summary-row">
                <span>% Change</span>
                <span className="fw-semibold" style={{ color: revisePctChange >= 0 ? '#0a8a78' : '#b91c1c' }}>
                  {reviseAnnualNum > 0 ? `${revisePctChange >= 0 ? '+' : ''}${revisePctChange.toFixed(1)}%` : '—%'}
                </span>
              </div>
            </div>

            <div className="ep-rev-summary mt-2">
              <div className="d-flex align-items-center justify-content-between">
                <div className="ep-rev-summary-head mb-0">COMPONENT BREAKDOWN</div>
                <label className="d-inline-flex align-items-center gap-1" style={{ fontSize: 10.5, cursor: 'pointer' }}>
                  <input type="checkbox" checked={showBreakdownToggle} onChange={e => setShowBreakdownToggle(e.target.checked)} />
                  Show
                </label>
              </div>
              {!showBreakdownToggle && (
                <small className="text-muted d-block text-center mt-1" style={{ fontSize: 10.5 }}>Toggle to see component split</small>
              )}
              {showBreakdownToggle && reviseAnnualNum > 0 && (() => {
                const bd = makeBreakdown(reviseAnnualNum);
                return (
                  <div className="mt-1">
                    {bd.rows.map(r => (
                      <div className="ep-rev-summary-row" key={r.label} style={{ fontSize: 10.5 }}>
                        <span>{r.label}</span>
                        <span className="fw-semibold">₹{r.monthly.toLocaleString('en-IN')}/mo</span>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
          </aside>
        </div>
      </EpModal>

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
              {SALARY_TIMELINE.map(s => {
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

          {/* Mode tabs + flow hint */}
          <div className="d-flex align-items-center justify-content-between flex-wrap gap-2 mt-2">
            <div className="ep-claim-tabs">
              <button
                type="button"
                className={`ep-claim-tab${claimMode === 'expense' ? ' is-active' : ''}`}
                onClick={() => setClaimMode('expense')}
              >
                <i className="ri-file-text-line" /> Expense Claim
              </button>
              <button
                type="button"
                className={`ep-claim-tab${claimMode === 'advance' ? ' is-active' : ''}`}
                onClick={() => setClaimMode('advance')}
              >
                <i className="ri-money-dollar-circle-line" /> Advance Request
              </button>
            </div>
            <small style={{ color: 'rgba(255,255,255,0.85)', fontSize: 10 }}>
              {claimMode === 'expense'
                ? <>Expense → <strong>Reimbursement</strong> &nbsp;|&nbsp; Advance → Payroll Recovery</>
                : <>Advance → <strong>Payroll Recovery</strong> &nbsp;|&nbsp; Expense → Reimbursement</>}
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
                      onChange={setClaimCategory}
                    />
                  </Col>
                  <Col md={6}>
                    <div className="ep-claim-label">Currency</div>
                    <MasterSelect
                      value={claimCurrency}
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
                  <input className="ep-claim-input" placeholder="Brief description of expense..." value={claimTitle} onChange={e => setClaimTitle(e.target.value)} />
                </div>
                <Row className="g-3 mb-3">
                  <Col md={6}>
                    <div className="ep-claim-label">Amount (₹) <span className="ep-claim-req">*</span></div>
                    <div className="position-relative">
                      <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--vz-secondary-color)', fontSize: 13, fontWeight: 600 }}>₹</span>
                      <input className="ep-claim-input" style={{ paddingLeft: 28 }} placeholder="0.00" value={claimAmount} onChange={e => setClaimAmount(e.target.value)} />
                    </div>
                  </Col>
                  <Col md={6}>
                    <div className="ep-claim-label">Expense Date <span className="ep-claim-req">*</span></div>
                    <MasterDatePicker value={claimDate} onChange={setClaimDate} />
                  </Col>
                </Row>
                <div className="mb-3">
                  <div className="ep-claim-label">Vendor / Merchant</div>
                  <input className="ep-claim-input" placeholder="Vendor name (optional)" value={claimVendor} onChange={e => setClaimVendor(e.target.value)} />
                </div>
                <div className="mb-0">
                  <div className="ep-claim-label">Business Purpose <span className="ep-claim-req">*</span></div>
                  <textarea className="ep-claim-input" rows={3} placeholder="Explain the business purpose..." value={claimPurpose} onChange={e => setClaimPurpose(e.target.value)} />
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
                      onChange={setAdvType}
                    />
                  </Col>
                  <Col md={6}>
                    <div className="ep-claim-label">Amount (₹) <span className="ep-claim-req">*</span></div>
                    <div className="position-relative">
                      <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--vz-secondary-color)', fontSize: 13, fontWeight: 600 }}>₹</span>
                      <input className="ep-claim-input" style={{ paddingLeft: 28 }} placeholder="0" value={advAmount} onChange={e => setAdvAmount(e.target.value)} />
                    </div>
                  </Col>
                </Row>
                {/* "Other" advance type — free-text input appears only when the
                    user picks Other so the dropdown stays uncluttered for the
                    common cases. */}
                {advType === 'Other' && (
                  <div className="mb-3">
                    <div className="ep-claim-label">Specify Advance Type <span className="ep-claim-req">*</span></div>
                    <input
                      className="ep-claim-input"
                      placeholder="e.g. Conference Registration, Education Loan…"
                      value={advTypeOther}
                      onChange={e => setAdvTypeOther(e.target.value)}
                    />
                  </div>
                )}
                <Row className="g-3 mb-3">
                  <Col md={6}>
                    <div className="ep-claim-label">Requested Date <span className="ep-claim-req">*</span></div>
                    <MasterDatePicker value={advRequestedDate} onChange={setAdvRequestedDate} />
                  </Col>
                  <Col md={6}>
                    <div className="ep-claim-label">Recovery Start <span className="ep-claim-req">*</span></div>
                    <MasterDatePicker value={advRecoveryStart} onChange={setAdvRecoveryStart} />
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
                    onChange={setAdvRecoveryMode}
                  />
                </div>
                {/* Months + computed EMI only make sense for EMI mode — hide
                    them for lump sum / bi-monthly so the form stays tight. */}
                {advRecoveryMode === 'emi' && (
                  <Row className="g-3 mb-3">
                    <Col md={6}>
                      <div className="ep-claim-label">No. of Months</div>
                      <input className="ep-claim-input" placeholder="e.g. 6" value={advMonths} onChange={e => setAdvMonths(e.target.value)} />
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
                  <textarea className="ep-claim-input" rows={3} placeholder="Describe why this advance is needed..." value={advReason} onChange={e => setAdvReason(e.target.value)} />
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

        {/* Footer */}
        <div className="ep-claim-footer">
          <button type="button" className="ep-claim-cancel" onClick={() => setClaimOpen(false)}>Cancel</button>
          <div className="d-flex gap-2 ms-auto">
            <button type="button" className="ep-claim-secondary">
              <i className="ri-save-line me-1" /> Save Draft
            </button>
            {claimMode === 'expense' && (
              <button type="button" className="ep-claim-secondary" onClick={saveAndAddAnother}>
                <i className="ri-add-line me-1" /> Save &amp; Add Another
              </button>
            )}
            <button
              type="button"
              className="ep-claim-submit"
              onClick={claimMode === 'expense' ? submitAllDrafts : () => setClaimOpen(false)}
            >
              <i className={claimMode === 'expense' ? 'ri-send-plane-line me-1' : 'ri-send-plane-fill me-1'} />
              {claimMode === 'expense'
                ? (claimDrafts.length > 1 ? `Submit ${claimDrafts.length} Claims` : 'Submit Claim')
                : 'Submit Advance Request'}
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
            {/* Strength meter — coloured bar + label that grade the password
                from Weak → Strong as rules are satisfied. */}
            {pwNew && (
              <div className="mt-2">
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
                {/* Rule checklist — each item turns green ✓ once satisfied. */}
                <ul className="list-unstyled mb-0 mt-1" style={{ fontSize: 11 }}>
                  {PW_RULES.map(rule => {
                    const passed = !validatePwRules(pwNew).includes(rule);
                    return (
                      <li key={rule} className={`d-inline-flex align-items-center gap-1 me-3 ${passed ? 'text-success fw-semibold' : 'text-muted'}`}>
                        <i className={passed ? 'ri-checkbox-circle-fill' : 'ri-checkbox-blank-circle-line'} style={{ fontSize: 12 }} />
                        {rule}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
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

