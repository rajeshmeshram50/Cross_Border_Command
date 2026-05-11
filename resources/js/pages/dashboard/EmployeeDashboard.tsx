import { useEffect, useState } from 'react';
import { Card, CardBody, Col, Row } from 'reactstrap';
import { useNavigate } from 'react-router-dom';
import api from '../../api';
import { useAuth } from '../../contexts/AuthContext';
import { ShimmerDashboard } from '../../components/ui/Shimmer';

/* ───────────────────────────────────────────────────────────────────────────
 *  Employee Dashboard — personal landing page for `user_type === 'employee'`.
 *
 *  Mirrors the chrome of ClientDashboard / BranchDashboard (KPI cards, card
 *  styles, INR compaction, animated counts) so the three dashboards read as
 *  a single visual family. All data comes from /api/dashboard/employee-stats
 *  which is auto-scoped to the current logged-in employee.
 * ───────────────────────────────────────────────────────────────────────── */

function formatINRCompact(n: number | null | undefined): string {
  const v = Math.max(0, Number(n) || 0);
  if (v < 100000) return '₹' + v.toLocaleString('en-IN', { maximumFractionDigits: 0 });
  if (v < 10000000) return '₹' + (v / 100000).toFixed(2) + 'L';
  return '₹' + (v / 10000000).toFixed(2) + 'Cr';
}

function AnimatedNumber({ value, prefix = '', suffix = '' }: { value: number; prefix?: string; suffix?: string }) {
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    const target = Number(value) || 0;
    if (target === 0) { setDisplay(0); return; }
    let start = 0;
    const duration = 1100;
    const ticks = 50;
    const step = Math.max(1, Math.ceil(target / ticks));
    const interval = duration / ticks;
    const id = setInterval(() => {
      start += step;
      if (start >= target) { setDisplay(target); clearInterval(id); }
      else setDisplay(start);
    }, interval);
    return () => clearInterval(id);
  }, [value]);
  return <>{prefix}{display.toLocaleString()}{suffix}</>;
}

interface KpiProps {
  label: string;
  value: React.ReactNode;
  iconClass: string;
  gradient: string;
  hint?: string;
  onClick?: () => void;
}

function KpiCard({ label, value, iconClass, gradient, hint, onClick }: KpiProps) {
  return (
    <div
      onClick={onClick}
      style={{
        borderRadius: 16,
        padding: '18px 18px 14px',
        boxShadow: '0 2px 20px rgba(0,0,0,0.06)',
        border: '1px solid var(--vz-border-color)',
        background: 'var(--vz-card-bg)',
        position: 'relative',
        overflow: 'hidden',
        height: '100%',
        cursor: onClick ? 'pointer' : 'default',
        transition: 'transform .15s ease, box-shadow .15s ease',
      }}
      onMouseEnter={e => { if (onClick) (e.currentTarget as HTMLDivElement).style.transform = 'translateY(-2px)'; }}
      onMouseLeave={e => { if (onClick) (e.currentTarget as HTMLDivElement).style.transform = 'translateY(0)'; }}
    >
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: gradient }} />
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--vz-secondary-color)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 8 }}>{label}</p>
          <h3 style={{
            fontSize: 'clamp(20px, 1.8vw, 26px)',
            fontWeight: 800,
            color: 'var(--vz-heading-color, var(--vz-body-color))',
            margin: 0, lineHeight: 1.05,
          }}>
            {value}
          </h3>
          {hint && <div style={{ marginTop: 6, fontSize: 11, color: 'var(--vz-secondary-color)' }}>{hint}</div>}
        </div>
        <div style={{
          width: 40, height: 40, borderRadius: 12,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: gradient, flexShrink: 0,
        }}>
          <i className={iconClass} style={{ fontSize: 18, color: '#fff' }} />
        </div>
      </div>
    </div>
  );
}

const cardStyle: React.CSSProperties = {
  borderRadius: 16,
  border: '1px solid var(--vz-border-color)',
  boxShadow: '0 2px 20px rgba(0,0,0,0.06)',
  overflow: 'hidden',
  marginBottom: 0,
  height: '100%',
};
const cardHeaderStyle: React.CSSProperties = {
  background: 'var(--vz-card-bg)',
  borderBottom: '1px solid var(--vz-border-color)',
  padding: '14px 18px',
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
};

interface OverviewMe {
  employee_id: number | null;
  display_name: string;
  emp_code: string | null;
  photo_url: string | null;
  status: string;
  department_name: string | null;
  designation_name: string | null;
  manager_id: number | null;
  manager_name: string | null;
  manager_photo: string | null;
  date_of_joining: string | null;
  email: string | null;
  mobile: string | null;
  profile_completion_pct: number;
}

interface OverviewData {
  me: OverviewMe;
  kpis: {
    my_expenses_pending: number;
    my_expenses_approved: number;
    my_expenses_rejected: number;
    approvals_pending: number;
    team_size: number;
    days_since_joining: number | null;
  };
  compensation: { annual_salary: number | null; salary_frequency: string | null; salary_structure: string | null; tax_regime: string | null; effective_from: string | null } | null;
  recent_expenses: Array<{ id: number; claim_no: string; title: string; category: string; amount: number; currency: string; expense_date: string | null; status: string }>;
  pending_approvals: Array<{ id: number; claim_no: string; title: string; category: string; amount: number; currency: string; filed_by: string | null; emp_code: string | null; created_at: string | null }>;
  team_peers: Array<{ id: number; emp_code: string; display_name: string; photo_url: string | null; designation_name: string | null }>;
  announcements: Array<{ id: number; title: string; snippet: string; created_at: string | null }>;
  upcoming_events: Array<{ employee_id: number; name: string; kind: 'birthday' | 'anniversary'; on: string; years: number | null }>;
  onboarding: { current_stage: number; total_stages: number; percent: number; next_label: string | null } | null;
}

function fmtDate(s: string | null): string {
  if (!s) return '—';
  try {
    return new Date(s + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch { return s; }
}

function fmtDateShort(s: string | null): string {
  if (!s) return '—';
  try {
    return new Date(s + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
  } catch { return s; }
}

const STATUS_PILL: Record<string, { bg: string; fg: string }> = {
  Approved: { bg: 'rgba(10,179,156,0.12)',  fg: '#0ab39c' },
  Pending:  { bg: 'rgba(247,184,75,0.14)',  fg: '#c98308' },
  Rejected: { bg: 'rgba(240,101,72,0.14)',  fg: '#f06548' },
};

function StatusPill({ status }: { status: string }) {
  const p = STATUS_PILL[status] || { bg: 'rgba(135,138,153,0.14)', fg: '#878a99' };
  return (
    <span style={{
      fontSize: 10.5, fontWeight: 700, letterSpacing: '0.04em',
      padding: '3px 9px', borderRadius: 999,
      background: p.bg, color: p.fg,
    }}>{status.toUpperCase()}</span>
  );
}

function Avatar({ src, name, size = 40 }: { src: string | null | undefined; name: string; size?: number }) {
  if (src) {
    return <img src={src} alt={name} style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />;
  }
  const initial = (name || '?').trim().charAt(0).toUpperCase();
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0,
      background: 'linear-gradient(135deg,#405189,#6691e7)',
      color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontWeight: 700, fontSize: size * 0.4,
    }}>{initial}</div>
  );
}

function EmptyState({ icon, text }: { icon: string; text: string }) {
  return (
    <div className="text-center text-muted py-4">
      <i className={icon} style={{ fontSize: 32, opacity: 0.5 }} />
      <div className="mt-2" style={{ fontSize: 12.5 }}>{text}</div>
    </div>
  );
}

export default function EmployeeDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    api.get('/dashboard/employee-stats', { signal: ctrl.signal })
      .then(r => {
        // Defensive normalization — guarantees every array is iterable
        // and every nested object has the keys the JSX touches.
        const raw = r.data || {};
        const arr = (v: any) => Array.isArray(v) ? v : [];
        setData({
          me: {
            employee_id: raw?.me?.employee_id ?? null,
            display_name: raw?.me?.display_name || user?.name || 'You',
            emp_code: raw?.me?.emp_code ?? null,
            photo_url: raw?.me?.photo_url ?? null,
            status: raw?.me?.status || 'Active',
            department_name: raw?.me?.department_name ?? null,
            designation_name: raw?.me?.designation_name ?? null,
            manager_id: raw?.me?.manager_id ?? null,
            manager_name: raw?.me?.manager_name ?? null,
            manager_photo: raw?.me?.manager_photo ?? null,
            date_of_joining: raw?.me?.date_of_joining ?? null,
            email: raw?.me?.email ?? null,
            mobile: raw?.me?.mobile ?? null,
            profile_completion_pct: Number(raw?.me?.profile_completion_pct ?? 0),
          },
          kpis: {
            my_expenses_pending:  Number(raw?.kpis?.my_expenses_pending  ?? 0),
            my_expenses_approved: Number(raw?.kpis?.my_expenses_approved ?? 0),
            my_expenses_rejected: Number(raw?.kpis?.my_expenses_rejected ?? 0),
            approvals_pending:    Number(raw?.kpis?.approvals_pending    ?? 0),
            team_size:            Number(raw?.kpis?.team_size            ?? 0),
            days_since_joining:   raw?.kpis?.days_since_joining == null ? null : Number(raw.kpis.days_since_joining),
          },
          compensation: raw?.compensation ?? null,
          recent_expenses:   arr(raw.recent_expenses),
          pending_approvals: arr(raw.pending_approvals),
          team_peers:        arr(raw.team_peers),
          announcements:     arr(raw.announcements),
          upcoming_events:   arr(raw.upcoming_events),
          onboarding:        raw?.onboarding ?? null,
        });
      })
      .catch((err: any) => {
        if (err.name === 'CanceledError' || err.code === 'ERR_CANCELED') return;
        setError(err?.response?.data?.message || 'Could not load your dashboard.');
      })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [user?.id]);

  if (loading) return <ShimmerDashboard />;

  if (error) {
    return (
      <div className="p-4">
        <div style={{ ...cardStyle, padding: 32, textAlign: 'center' }}>
          <i className="ri-error-warning-line" style={{ fontSize: 40, color: '#f06548' }} />
          <h5 className="mt-3 fw-bold">Couldn't load your dashboard</h5>
          <p className="text-muted mb-0">{error}</p>
        </div>
      </div>
    );
  }
  if (!data) return null;

  const { me, kpis, compensation, recent_expenses, pending_approvals, team_peers, announcements, upcoming_events, onboarding } = data;
  const firstName = (me.display_name || '').split(/\s+/)[0] || 'there';
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <div className="p-3 p-md-4">
      {/* ── Profile hero ───────────────────────────────────────────────── */}
      <Card style={{ ...cardStyle, marginBottom: 16, overflow: 'hidden' }}>
        <div style={{
          background: 'linear-gradient(120deg,#405189 0%,#6691e7 55%,#7c5cfc 100%)',
          color: '#fff',
          padding: '22px 24px',
          position: 'relative',
        }}>
          <Row className="align-items-center g-3">
            <Col xs="auto">
              <div style={{
                width: 84, height: 84, borderRadius: '50%',
                background: 'rgba(255,255,255,0.18)',
                border: '3px solid rgba(255,255,255,0.32)',
                padding: 3, flexShrink: 0,
                boxShadow: '0 8px 22px rgba(0,0,0,0.18)',
              }}>
                {me.photo_url ? (
                  <img src={me.photo_url} alt={me.display_name}
                    style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} />
                ) : (
                  <div style={{
                    width: '100%', height: '100%', borderRadius: '50%',
                    background: 'rgba(255,255,255,0.10)',
                    color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 32, fontWeight: 800, letterSpacing: '-0.02em',
                  }}>
                    {(me.display_name || '?').trim().charAt(0).toUpperCase()}
                  </div>
                )}
              </div>
            </Col>
            <Col>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.78)', fontWeight: 500, letterSpacing: '0.03em' }}>
                {greet}, {firstName}
              </div>
              <h3 className="text-white mb-1 fw-bold" style={{ fontSize: 22, letterSpacing: '-0.01em' }}>
                {me.display_name}
              </h3>
              <div className="d-flex flex-wrap align-items-center gap-2" style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.92)' }}>
                {me.emp_code && (
                  <span style={{ background: 'rgba(255,255,255,0.18)', padding: '3px 10px', borderRadius: 999, fontWeight: 600 }}>
                    {me.emp_code}
                  </span>
                )}
                {me.designation_name && <span>· {me.designation_name}</span>}
                {me.department_name && <span>· {me.department_name}</span>}
                {me.date_of_joining && <span>· Joined {fmtDate(me.date_of_joining)}</span>}
              </div>
            </Col>
            <Col xs={12} md="auto">
              <div className="d-flex flex-wrap gap-2 justify-content-md-end">
                <button
                  onClick={() => me.employee_id && navigate(`/hr/employees/${me.employee_id}/profile`)}
                  className="btn d-inline-flex align-items-center gap-1 fw-semibold rounded-pill px-3"
                  style={{
                    fontSize: 12, background: 'rgba(255,255,255,0.18)',
                    color: '#fff', border: '1px solid rgba(255,255,255,0.30)',
                    padding: '7px 16px',
                  }}
                >
                  <i className="ri-user-line" /> View profile
                </button>
                <button
                  onClick={() => navigate('/hr/expense')}
                  className="btn d-inline-flex align-items-center gap-1 fw-semibold rounded-pill px-3"
                  style={{
                    fontSize: 12, background: '#fff', color: '#405189',
                    border: 'none', padding: '7px 18px',
                    boxShadow: '0 6px 14px rgba(0,0,0,0.15)',
                  }}
                >
                  <i className="ri-add-circle-line" /> Raise expense
                </button>
              </div>
            </Col>
          </Row>
        </div>

        {/* Manager + profile completion strip */}
        <div className="d-flex flex-wrap align-items-center justify-content-between gap-3" style={{ padding: '14px 22px', background: 'var(--vz-card-bg)' }}>
          {me.manager_name ? (
            <div className="d-flex align-items-center gap-2">
              <Avatar src={me.manager_photo} name={me.manager_name} size={36} />
              <div>
                <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--vz-secondary-color)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                  Reporting Manager
                </div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--vz-heading-color, var(--vz-body-color))' }}>
                  {me.manager_name}
                </div>
              </div>
            </div>
          ) : <span />}
          <div style={{ flex: 1, maxWidth: 340 }}>
            <div className="d-flex justify-content-between mb-1">
              <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--vz-secondary-color)' }}>Profile completion</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#405189' }}>{me.profile_completion_pct}%</span>
            </div>
            <div style={{ height: 8, background: 'var(--vz-border-color)', borderRadius: 999, overflow: 'hidden' }}>
              <div style={{
                width: `${Math.min(100, Math.max(0, me.profile_completion_pct))}%`,
                height: '100%',
                background: 'linear-gradient(90deg,#405189,#6691e7)',
                borderRadius: 999, transition: 'width .6s ease',
              }} />
            </div>
          </div>
        </div>
      </Card>

      {/* ── Onboarding progress (only while incomplete) ─────────────────── */}
      {onboarding && (
        <Card style={{
          ...cardStyle, marginBottom: 16,
          // Layer the violet tint on top of the theme-aware card bg so the
          // strip still reads as a card (and not as transparent body) in
          // dark mode where rgba(124,92,252,0.06) over dark renders ~black.
          background: 'linear-gradient(135deg, rgba(124,92,252,0.10), rgba(167,139,250,0.06)), var(--vz-card-bg)',
          border: '1px solid rgba(124,92,252,0.28)',
        }}>
          <CardBody>
            <div className="d-flex flex-wrap align-items-center justify-content-between gap-3">
              <div className="d-flex align-items-center gap-3">
                <div style={{
                  width: 44, height: 44, borderRadius: 12,
                  background: 'linear-gradient(135deg,#7c5cfc,#a78bfa)',
                  color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  boxShadow: '0 8px 18px rgba(124,92,252,0.30)',
                }}>
                  <i className="ri-rocket-2-line" style={{ fontSize: 20 }} />
                </div>
                <div>
                  <h6 className="mb-0 fw-bold">Finish setting up your profile</h6>
                  <small className="text-muted">
                    Stage {onboarding.current_stage} of {onboarding.total_stages}
                    {onboarding.next_label ? ` — next: ${onboarding.next_label}` : ''}
                  </small>
                </div>
              </div>
              <div style={{ minWidth: 200 }}>
                <div className="d-flex justify-content-between mb-1">
                  <span style={{ fontSize: 11, color: 'var(--vz-secondary-color)', fontWeight: 600 }}>Progress</span>
                  <span style={{ fontSize: 12, color: '#7c5cfc', fontWeight: 800 }}>{onboarding.percent}%</span>
                </div>
                <div style={{ height: 8, background: 'var(--vz-border-color)', borderRadius: 999, overflow: 'hidden' }}>
                  <div style={{ width: `${onboarding.percent}%`, height: '100%', background: 'linear-gradient(90deg,#7c5cfc,#a78bfa)' }} />
                </div>
              </div>
            </div>
          </CardBody>
        </Card>
      )}

      {/* ── KPI strip ───────────────────────────────────────────────────── */}
      <Row className="g-3 mb-3">
        <Col xs={6} md={4} lg={2}>
          <KpiCard
            label="Pending Claims"
            value={<AnimatedNumber value={kpis.my_expenses_pending} />}
            iconClass="ri-time-line"
            gradient="linear-gradient(135deg,#f7b84b,#fad07e)"
            hint="Mine awaiting approval"
            onClick={() => navigate('/hr/expense')}
          />
        </Col>
        <Col xs={6} md={4} lg={2}>
          <KpiCard
            label="Approved Claims"
            value={<AnimatedNumber value={kpis.my_expenses_approved} />}
            iconClass="ri-checkbox-circle-line"
            gradient="linear-gradient(135deg,#0ab39c,#3dd6c3)"
            hint="Cleared end-to-end"
          />
        </Col>
        <Col xs={6} md={4} lg={2}>
          <KpiCard
            label="Rejected Claims"
            value={<AnimatedNumber value={kpis.my_expenses_rejected} />}
            iconClass="ri-close-circle-line"
            gradient="linear-gradient(135deg,#f06548,#ff9e7c)"
            hint="Returned with notes"
          />
        </Col>
        <Col xs={6} md={4} lg={2}>
          <KpiCard
            label="To Approve"
            value={<AnimatedNumber value={kpis.approvals_pending} />}
            iconClass="ri-shield-check-line"
            gradient="linear-gradient(135deg,#7c5cfc,#a993fd)"
            hint="As reporting manager"
            onClick={() => navigate('/hr/expense')}
          />
        </Col>
        <Col xs={6} md={4} lg={2}>
          <KpiCard
            label="Team Size"
            value={<AnimatedNumber value={kpis.team_size} />}
            iconClass="ri-team-line"
            gradient="linear-gradient(135deg,#405189,#6691e7)"
            hint="In your department"
          />
        </Col>
        <Col xs={6} md={4} lg={2}>
          <KpiCard
            label="Days at Company"
            value={kpis.days_since_joining == null ? '—' : <AnimatedNumber value={kpis.days_since_joining} />}
            iconClass="ri-calendar-line"
            gradient="linear-gradient(135deg,#299cdb,#63bcec)"
            hint={me.date_of_joining ? `Since ${fmtDate(me.date_of_joining)}` : 'Joining date not set'}
          />
        </Col>
      </Row>

      {/* ── Compensation strip (only if payroll enabled) ────────────────── */}
      {compensation && compensation.annual_salary != null && (
        <Card style={{ ...cardStyle, marginBottom: 16 }}>
          <CardBody style={{ padding: '14px 18px' }}>
            <Row className="g-2 align-items-center">
              <Col xs={12} md={3}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--vz-secondary-color)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                  Compensation
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--vz-secondary-color)' }}>Snapshot from your payroll record</div>
              </Col>
              <Col xs={6} md={3}>
                <div style={{ fontSize: 11, color: 'var(--vz-secondary-color)', fontWeight: 600, marginBottom: 2 }}>Annual</div>
                <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--vz-heading-color, var(--vz-body-color))' }}>
                  {formatINRCompact(compensation.annual_salary)}
                </div>
              </Col>
              {compensation.salary_frequency && (
                <Col xs={6} md={2}>
                  <div style={{ fontSize: 11, color: 'var(--vz-secondary-color)', fontWeight: 600, marginBottom: 2 }}>Frequency</div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{compensation.salary_frequency}</div>
                </Col>
              )}
              {compensation.salary_structure && (
                <Col xs={6} md={2}>
                  <div style={{ fontSize: 11, color: 'var(--vz-secondary-color)', fontWeight: 600, marginBottom: 2 }}>Structure</div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{compensation.salary_structure}</div>
                </Col>
              )}
              {compensation.tax_regime && (
                <Col xs={6} md={2}>
                  <div style={{ fontSize: 11, color: 'var(--vz-secondary-color)', fontWeight: 600, marginBottom: 2 }}>Tax Regime</div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{compensation.tax_regime}</div>
                </Col>
              )}
            </Row>
          </CardBody>
        </Card>
      )}

      {/* ── Row: My recent expenses + Pending approvals (as manager) ───── */}
      <Row className="g-3 mb-3">
        <Col xs={12} lg={6}>
          <Card style={cardStyle}>
            <div style={cardHeaderStyle}>
              <div>
                <h6 className="mb-0 fw-bold">My Recent Expenses</h6>
                <small className="text-muted">Last 5 claims you filed</small>
              </div>
              <button
                onClick={() => navigate('/hr/expense')}
                className="btn btn-sm fw-semibold rounded-pill px-3"
                style={{ fontSize: 11, background: 'rgba(64,81,137,0.10)', color: '#405189', border: 'none' }}
              >
                View all <i className="ri-arrow-right-s-line" />
              </button>
            </div>
            <CardBody style={{ padding: 0 }}>
              {recent_expenses.length === 0 ? (
                <EmptyState icon="ri-bill-line" text="No expense claims yet. Click 'Raise expense' to file one." />
              ) : (
                recent_expenses.map(c => (
                  <div key={c.id} className="d-flex align-items-center gap-2" style={{ padding: '12px 18px', borderBottom: '1px solid var(--vz-border-color)' }}>
                    <div style={{
                      width: 36, height: 36, borderRadius: 10, flexShrink: 0,
                      background: 'rgba(64,81,137,0.10)', color: '#405189',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <i className="ri-receipt-line" style={{ fontSize: 17 }} />
                    </div>
                    <div className="flex-grow-1 min-w-0">
                      <div className="d-flex align-items-center justify-content-between gap-2">
                        <div className="text-truncate fw-semibold" style={{ fontSize: 13, color: 'var(--vz-heading-color, var(--vz-body-color))' }}>
                          {c.title || c.category}
                        </div>
                        <div style={{ fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap' }}>
                          {formatINRCompact(c.amount)}
                        </div>
                      </div>
                      <div className="d-flex align-items-center gap-2 mt-1" style={{ fontSize: 11, color: 'var(--vz-secondary-color)' }}>
                        <span>{c.claim_no}</span>
                        <span>·</span>
                        <span>{c.category}</span>
                        <span>·</span>
                        <span>{fmtDateShort(c.expense_date)}</span>
                        <span className="ms-auto"><StatusPill status={c.status} /></span>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </CardBody>
          </Card>
        </Col>

        <Col xs={12} lg={6}>
          <Card style={cardStyle}>
            <div style={cardHeaderStyle}>
              <div>
                <h6 className="mb-0 fw-bold">Pending Your Approval</h6>
                <small className="text-muted">Claims filed by your team</small>
              </div>
              <button
                onClick={() => navigate('/hr/expense')}
                className="btn btn-sm fw-semibold rounded-pill px-3"
                style={{ fontSize: 11, background: 'rgba(124,92,252,0.10)', color: '#7c5cfc', border: 'none' }}
              >
                Review <i className="ri-arrow-right-s-line" />
              </button>
            </div>
            <CardBody style={{ padding: 0 }}>
              {pending_approvals.length === 0 ? (
                <EmptyState icon="ri-shield-check-line" text="Nothing waiting on your approval. " />
              ) : (
                pending_approvals.map(c => (
                  <div key={c.id} className="d-flex align-items-center gap-2" style={{ padding: '12px 18px', borderBottom: '1px solid var(--vz-border-color)' }}>
                    <div style={{
                      width: 36, height: 36, borderRadius: 10, flexShrink: 0,
                      background: 'rgba(124,92,252,0.10)', color: '#7c5cfc',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <i className="ri-user-line" style={{ fontSize: 17 }} />
                    </div>
                    <div className="flex-grow-1 min-w-0">
                      <div className="d-flex align-items-center justify-content-between gap-2">
                        <div className="text-truncate fw-semibold" style={{ fontSize: 13, color: 'var(--vz-heading-color, var(--vz-body-color))' }}>
                          {c.filed_by}
                        </div>
                        <div style={{ fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap' }}>
                          {formatINRCompact(c.amount)}
                        </div>
                      </div>
                      <div className="d-flex align-items-center gap-2 mt-1" style={{ fontSize: 11, color: 'var(--vz-secondary-color)' }}>
                        <span>{c.emp_code}</span>
                        <span>·</span>
                        <span>{c.category}</span>
                        <span>·</span>
                        <span>{c.title}</span>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </CardBody>
          </Card>
        </Col>
      </Row>

      {/* ── Row: Announcements + Upcoming events ────────────────────────── */}
      <Row className="g-3 mb-3">
        <Col xs={12} lg={7}>
          <Card style={cardStyle}>
            <div style={cardHeaderStyle}>
              <div>
                <h6 className="mb-0 fw-bold">Latest Announcements</h6>
                <small className="text-muted">From your organisation</small>
              </div>
              <i className="ri-megaphone-line" style={{ fontSize: 18, color: '#299cdb' }} />
            </div>
            <CardBody style={{ padding: 0 }}>
              {announcements.length === 0 ? (
                <EmptyState icon="ri-megaphone-line" text="No announcements yet." />
              ) : (
                announcements.map(a => (
                  <div key={a.id} style={{ padding: '14px 18px', borderBottom: '1px solid var(--vz-border-color)' }}>
                    <div className="d-flex align-items-start justify-content-between gap-2 mb-1">
                      <div className="fw-semibold" style={{ fontSize: 13.5, color: 'var(--vz-heading-color, var(--vz-body-color))' }}>{a.title}</div>
                      {a.created_at && (
                        <span style={{ fontSize: 11, color: 'var(--vz-secondary-color)', whiteSpace: 'nowrap', flexShrink: 0 }}>
                          {fmtDateShort(a.created_at)}
                        </span>
                      )}
                    </div>
                    <div className="text-muted" style={{ fontSize: 12, lineHeight: 1.55 }}>
                      {a.snippet}
                    </div>
                  </div>
                ))
              )}
            </CardBody>
          </Card>
        </Col>

        <Col xs={12} lg={5}>
          <Card style={cardStyle}>
            <div style={cardHeaderStyle}>
              <div>
                <h6 className="mb-0 fw-bold">Upcoming Celebrations</h6>
                <small className="text-muted">Next 30 days · birthdays & work anniversaries</small>
              </div>
              <i className="ri-cake-3-line" style={{ fontSize: 18, color: '#e83e8c' }} />
            </div>
            <CardBody style={{ padding: 0 }}>
              {upcoming_events.length === 0 ? (
                <EmptyState icon="ri-cake-3-line" text="No celebrations coming up." />
              ) : (
                upcoming_events.map((e, i) => (
                  <div key={`${e.employee_id}-${e.kind}-${i}`} className="d-flex align-items-center gap-2" style={{ padding: '12px 18px', borderBottom: '1px solid var(--vz-border-color)' }}>
                    <div style={{
                      width: 36, height: 36, borderRadius: 10, flexShrink: 0,
                      background: e.kind === 'birthday' ? 'rgba(232,62,140,0.12)' : 'rgba(247,184,75,0.14)',
                      color: e.kind === 'birthday' ? '#e83e8c' : '#c98308',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <i className={e.kind === 'birthday' ? 'ri-cake-2-line' : 'ri-medal-2-line'} style={{ fontSize: 17 }} />
                    </div>
                    <div className="flex-grow-1 min-w-0">
                      <div className="fw-semibold text-truncate" style={{ fontSize: 13, color: 'var(--vz-heading-color, var(--vz-body-color))' }}>
                        {e.name}
                      </div>
                      <div className="text-muted" style={{ fontSize: 11.5 }}>
                        {e.kind === 'birthday'
                          ? 'Birthday'
                          : `${e.years ? e.years + (e.years === 1 ? '-year ' : '-year ') : ''}Work anniversary`}
                      </div>
                    </div>
                    <div className="text-end" style={{ fontSize: 11.5, color: 'var(--vz-secondary-color)' }}>
                      {fmtDateShort(e.on)}
                    </div>
                  </div>
                ))
              )}
            </CardBody>
          </Card>
        </Col>
      </Row>

      {/* ── My Team (department peers) ──────────────────────────────────── */}
      {team_peers.length > 0 && (
        <Card style={cardStyle}>
          <div style={cardHeaderStyle}>
            <div>
              <h6 className="mb-0 fw-bold">My Team</h6>
              <small className="text-muted">{me.department_name || 'Department'} · {kpis.team_size} member{kpis.team_size === 1 ? '' : 's'}</small>
            </div>
            <i className="ri-team-line" style={{ fontSize: 18, color: '#405189' }} />
          </div>
          <CardBody style={{ padding: '14px 18px' }}>
            <Row className="g-3">
              {team_peers.map(p => (
                <Col key={p.id} xs={6} md={4} lg={2}>
                  <div
                    onClick={() => navigate(`/hr/employees/${p.id}/profile`)}
                    style={{
                      borderRadius: 12, padding: 14, textAlign: 'center',
                      border: '1px solid var(--vz-border-color)',
                      cursor: 'pointer', transition: 'transform .15s ease, border-color .15s ease',
                      background: 'var(--vz-card-bg)',
                    }}
                    onMouseEnter={e => {
                      const el = e.currentTarget as HTMLDivElement;
                      el.style.transform = 'translateY(-3px)';
                      el.style.borderColor = '#6691e7';
                    }}
                    onMouseLeave={e => {
                      const el = e.currentTarget as HTMLDivElement;
                      el.style.transform = 'translateY(0)';
                      el.style.borderColor = 'var(--vz-border-color)';
                    }}
                  >
                    <div className="mx-auto mb-2" style={{ width: 48, height: 48 }}>
                      <Avatar src={p.photo_url} name={p.display_name} size={48} />
                    </div>
                    <div className="fw-semibold text-truncate" style={{ fontSize: 12.5 }}>{p.display_name}</div>
                    <div className="text-muted text-truncate" style={{ fontSize: 11 }}>
                      {p.designation_name || p.emp_code}
                    </div>
                  </div>
                </Col>
              ))}
            </Row>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
