import { useEffect, useMemo, useState } from 'react';
import { Card, CardBody, Col, Row } from 'reactstrap';
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line,
  PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import api from '../../api';
import { useBranchSwitcher } from '../../contexts/BranchSwitcherContext';
import { ShimmerDashboard } from '../../components/ui/Shimmer';
import { useChartTheme } from '../../hooks/useChartTheme';
import './HrOverview.css';

const PALETTE = ['#405189', '#0ab39c', '#f7b84b', '#f06548', '#299cdb', '#9b72cf', '#7c5cfc', '#0d8aff'];
const GENDER_COLORS: Record<string, string> = {
  Male: '#299cdb', Female: '#e83e8c', Other: '#9b72cf', Unspecified: '#878a99',
};
const STATUS_COLORS: Record<string, string> = {
  Approved: '#0ab39c', Pending: '#f7b84b', Rejected: '#f06548',
  'In Progress': '#299cdb', Completed: '#0ab39c', Cancelled: '#f06548',
  'On Hold': '#9b72cf', Open: '#299cdb',
};

interface OverviewData {
  kpis: {
    active_employees: number;
    new_hires_this_month: number;
    open_positions: number;
    pending_onboarding: number;
    active_exits: number;
    pending_expense_claims: number;
  };
  totals: { departments: number; designations: number; roles: number };
  by_department:   Array<{ id: number | null; name: string; count: number }>;
  by_gender:       Array<{ gender: string; count: number }>;
  by_status:       Array<{ status: string; count: number }>;
  joining_trend:   Array<{ month: string; label: string; count: number }>;
  exit_trend:      Array<{ month: string; label: string; count: number }>;
  recruitment_by_status: Array<{ status: string; count: number }>;
  expense_by_status:     Array<{ status: string; count: number }>;
  recent_joiners:  Array<{ id: number; emp_code: string; display_name: string; date_of_joining: string | null; department_name: string | null; designation_name: string | null }>;
  upcoming_joiners: Array<{ name: string; department_name: string | null; join_date: string; source: 'employee' | 'invite' }>;
  department_turnover: Array<{ id: number | null; name: string; headcount: number; exits: number; turnover_pct: number }>;
  probation_snapshot:  { in_progress: number; completed: number };
  expense_by_category: Array<{ category: string; amount: number; count: number }>;
}

function AnimatedNumber({ value }: { value: number }) {
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
  return <>{display.toLocaleString()}</>;
}

interface KpiProps {
  label: string;
  value: number;
  iconClass: string;
  gradient: string;
  hint?: string;
}

function KpiCard({ label, value, iconClass, gradient, hint }: KpiProps) {
  return (
    <div className="hr-ov-kpi-card">
      {/* Corner tint + top accent strip — the dashboard KPI tile treatment. */}
      <div className="hr-ov-kpi-glow" style={{ background: gradient }} />
      <div className="hr-ov-kpi-strip" style={{ background: gradient }} />
      <div className="hr-ov-kpi-head">
        <div style={{ flex: 1, minWidth: 0 }}>
          <p className="hr-ov-kpi-label">{label}</p>
          <h3 className="hr-ov-kpi-value">
            <AnimatedNumber value={value} />
          </h3>
          {hint && <div className="hr-ov-kpi-hint">{hint}</div>}
        </div>
        <div className="hr-ov-kpi-icon" style={{ background: gradient }}>
          <i className={iconClass} />
        </div>
      </div>
    </div>
  );
}

const ChartTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="hr-ov-tooltip">
      {label && <div className="hr-ov-tooltip-label">{label}</div>}
      {payload.map((p: any, i: number) => (
        <div key={i} className="hr-ov-tooltip-row">
          {p.name && <span className="hr-ov-tooltip-key">{p.name}:</span>}
          {typeof p.value === 'number' ? p.value.toLocaleString() : p.value}
        </div>
      ))}
    </div>
  );
};

function fmtDate(s: string | null): string {
  if (!s) return '—';
  try {
    return new Date(s + 'T00:00:00').toLocaleDateString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric',
    });
  } catch { return s; }
}

export default function HrOverview() {
  const { selectedBranchId } = useBranchSwitcher();
  const [data, setData]     = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState<string | null>(null);
  const ct = useChartTheme();

  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    api.get('/hrms/overview', {
      params: selectedBranchId ? { branch_id: selectedBranchId } : {},
      signal: ctrl.signal,
    })
      .then(r => {
        const raw = r.data || {};
        const arr = (v: any) => Array.isArray(v) ? v : [];
        setData({
          kpis: {
            active_employees:       Number(raw?.kpis?.active_employees       ?? 0),
            new_hires_this_month:   Number(raw?.kpis?.new_hires_this_month   ?? 0),
            open_positions:         Number(raw?.kpis?.open_positions         ?? 0),
            pending_onboarding:     Number(raw?.kpis?.pending_onboarding     ?? 0),
            active_exits:           Number(raw?.kpis?.active_exits           ?? 0),
            pending_expense_claims: Number(raw?.kpis?.pending_expense_claims ?? 0),
          },
          totals: {
            departments:  Number(raw?.totals?.departments  ?? 0),
            designations: Number(raw?.totals?.designations ?? 0),
            roles:        Number(raw?.totals?.roles        ?? 0),
          },
          by_department:         arr(raw.by_department),
          by_gender:             arr(raw.by_gender),
          by_status:             arr(raw.by_status),
          joining_trend:         arr(raw.joining_trend),
          exit_trend:            arr(raw.exit_trend),
          recruitment_by_status: arr(raw.recruitment_by_status),
          expense_by_status:     arr(raw.expense_by_status),
          recent_joiners:        arr(raw.recent_joiners),
          upcoming_joiners:      arr(raw.upcoming_joiners),
          department_turnover:   arr(raw.department_turnover),
          probation_snapshot: {
            in_progress: Number(raw?.probation_snapshot?.in_progress ?? 0),
            completed:   Number(raw?.probation_snapshot?.completed   ?? 0),
          },
          expense_by_category:   arr(raw.expense_by_category),
        });
      })
      .catch((err) => {
        if (err.name === 'CanceledError' || err.code === 'ERR_CANCELED') return;
        setError(err?.response?.data?.message || 'Could not load HR overview.');
      })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [selectedBranchId]);

  const departmentChart = useMemo(() => {
    const rows = Array.isArray(data?.by_department) ? data!.by_department : [];
    const sorted = [...rows].sort((a, b) => b.count - a.count);
    if (sorted.length <= 8) return sorted;
    const top = sorted.slice(0, 7);
    const rest = sorted.slice(7).reduce((acc, r) => acc + r.count, 0);
    return [...top, { id: null, name: 'Other', count: rest }];
  }, [data]);

  if (loading) return <ShimmerDashboard />;

  if (error) {
    return (
      <div className="p-4">
        <div className="hr-ov-card" style={{ padding: 32, textAlign: 'center' }}>
          <i className="ri-error-warning-line" style={{ fontSize: 40, color: '#f06548' }} />
          <h5 className="mt-3 fw-bold">Couldn't load HR overview</h5>
          <p className="text-muted mb-0">{error}</p>
        </div>
      </div>
    );
  }
  if (!data) return null;

  const k = data.kpis;
  const t = data.totals;

  return (
    <div>
      <div className="frm-cstrip mb-3">
        <span className="frm-cstrip-accent" />
        <div className="frm-cstrip-left">
          <div className="frm-cstrip-icon"><i className="ri-group-line" /></div>
          <div className="min-w-0">
            <div className="frm-cstrip-title">HRMS Overview</div>
            <div className="frm-cstrip-sub">Live headcount, hiring, onboarding and exit signals — all in one place.</div>
          </div>
        </div>
        <span
          className="badge rounded-pill flex-shrink-0"
          style={{
            background: 'rgba(10,179,156,0.12)', color: '#0ab39c',
            fontWeight: 700, padding: '6px 12px', fontSize: 11, letterSpacing: '0.04em',
          }}
        >
          <i className="ri-pulse-line me-1" /> LIVE
        </span>
      </div>

      <Row className="g-3 mb-3">
        <Col xs={6} md={4} lg={2}>
          <KpiCard
            label="Active Employees"
            value={k.active_employees}
            iconClass="ri-team-line"
            gradient="linear-gradient(135deg,#405189,#6691e7)"
            hint="Currently on rolls"
          />
        </Col>
        <Col xs={6} md={4} lg={2}>
          <KpiCard
            label="New Hires"
            value={k.new_hires_this_month}
            iconClass="ri-user-add-line"
            gradient="linear-gradient(135deg,#0ab39c,#3dd6c3)"
            hint="This month"
          />
        </Col>
        <Col xs={6} md={4} lg={2}>
          <KpiCard
            label="Open Positions"
            value={k.open_positions}
            iconClass="ri-briefcase-line"
            gradient="linear-gradient(135deg,#299cdb,#63bcec)"
            hint="In recruitment"
          />
        </Col>
        <Col xs={6} md={4} lg={2}>
          <KpiCard
            label="Pending Onboarding"
            value={k.pending_onboarding}
            iconClass="ri-mail-send-line"
            gradient="linear-gradient(135deg,#7c5cfc,#a993fd)"
            hint="Invitations sent"
          />
        </Col>
        <Col xs={6} md={4} lg={2}>
          <KpiCard
            label="Active Exits"
            value={k.active_exits}
            iconClass="ri-logout-box-line"
            gradient="linear-gradient(135deg,#f06548,#ff9e7c)"
            hint="On notice period"
          />
        </Col>
        <Col xs={6} md={4} lg={2}>
          <KpiCard
            label="Expense Claims"
            value={k.pending_expense_claims}
            iconClass="ri-bill-line"
            gradient="linear-gradient(135deg,#f7b84b,#fad07e)"
            hint="Awaiting approval"
          />
        </Col>
      </Row>

      <Card className="hr-ov-card" style={{ marginBottom: 16 }}>
        <CardBody style={{ padding: '14px 18px' }}>
          <Row className="g-2 align-items-center">
            <Col xs={12} md={3}>
              <div className="hr-ov-eyebrow">
                Org Structure
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--vz-secondary-color)' }}>Master records currently defined</div>
            </Col>
            {[
              { label: 'Departments',  count: t.departments,  icon: 'ri-building-line',     color: '#405189' },
              { label: 'Designations', count: t.designations, icon: 'ri-medal-line',        color: '#0ab39c' },
              { label: 'Roles',        count: t.roles,        icon: 'ri-shield-user-line',  color: '#7c5cfc' },
            ].map(item => (
              <Col key={item.label} xs={4} md={3}>
                <div className="d-flex align-items-center gap-2">
                  <div style={{
                    width: 36, height: 36, borderRadius: 10, flexShrink: 0,
                    background: item.color + '18',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <i className={item.icon} style={{ color: item.color, fontSize: 17 }} />
                  </div>
                  <div>
                    <div style={{ fontSize: 18, fontWeight: 800, lineHeight: 1, color: 'var(--vz-heading-color, var(--vz-body-color))' }}>
                      {item.count.toLocaleString()}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--vz-secondary-color)', marginTop: 2 }}>{item.label}</div>
                  </div>
                </div>
              </Col>
            ))}
          </Row>
        </CardBody>
      </Card>

      <Row className="g-3 mb-3">
        <Col xs={12} lg={8}>
          <Card className="hr-ov-card">
            <div className="hr-ov-card-head">
              <div>
                <h5 className="hr-ov-card-title">Headcount by Department</h5>
                <p className="hr-ov-card-sub">Top {Math.min(departmentChart.length, 8)} departments</p>
              </div>
              <i className="ri-building-line" style={{ fontSize: 18, color: '#405189' }} />
            </div>
            <CardBody style={{ padding: '12px 8px 8px' }}>
              {departmentChart.length === 0 ? (
                <EmptyState icon="ri-building-line" text="No employees grouped to departments yet." />
              ) : (
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={departmentChart} layout="vertical" margin={{ top: 8, right: 30, left: 10, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 11, fill: ct.axisTickMuted }} allowDecimals={false} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 11.5, fill: ct.axisTick }} width={120} />
                    <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(64,81,137,0.06)' }} />
                    <Bar dataKey="count" radius={[0, 8, 8, 0]}>
                      {departmentChart.map((_, i) => (
                        <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardBody>
          </Card>
        </Col>

        <Col xs={12} lg={4}>
          <Card className="hr-ov-card">
            <div className="hr-ov-card-head">
              <div>
                <h5 className="hr-ov-card-title">Gender Split</h5>
                <p className="hr-ov-card-sub">Across active employees</p>
              </div>
              <i className="ri-user-2-line" style={{ fontSize: 18, color: '#e83e8c' }} />
            </div>
            <CardBody style={{ padding: 12 }}>
              {data.by_gender.length === 0 ? (
                <EmptyState icon="ri-user-2-line" text="No employees on record yet." />
              ) : (
                <>
                  <ResponsiveContainer width="100%" height={220}>
                    <PieChart>
                      <Pie
                        data={data.by_gender}
                        dataKey="count"
                        nameKey="gender"
                        innerRadius={55}
                        outerRadius={85}
                        paddingAngle={0}
                        stroke="none"
                      >
                        {data.by_gender.map((g, i) => (
                          <Cell key={i} fill={GENDER_COLORS[g.gender] || PALETTE[i % PALETTE.length]} />
                        ))}
                      </Pie>
                      <Tooltip content={<ChartTooltip />} />
                    </PieChart>
                  </ResponsiveContainer>
                  <Legend items={data.by_gender.map((g, i) => ({
                    label: g.gender,
                    value: g.count,
                    color: GENDER_COLORS[g.gender] || PALETTE[i % PALETTE.length],
                  }))} />
                </>
              )}
            </CardBody>
          </Card>
        </Col>
      </Row>

      <Row className="g-3 mb-3">
        <Col xs={12} lg={6}>
          <Card className="hr-ov-card">
            <div className="hr-ov-card-head">
              <div>
                <h5 className="hr-ov-card-title">Joining Trend</h5>
                <p className="hr-ov-card-sub">Last 12 months</p>
              </div>
              <i className="ri-user-follow-line" style={{ fontSize: 18, color: '#0ab39c' }} />
            </div>
            <CardBody style={{ padding: 12 }}>
              <ResponsiveContainer width="100%" height={240}>
                <AreaChart data={data.joining_trend} margin={{ top: 8, right: 12, left: -10, bottom: 0 }}>
                  <defs>
                    <linearGradient id="joinGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%"   stopColor="#0ab39c" stopOpacity={0.45} />
                      <stop offset="55%"  stopColor="#0ab39c" stopOpacity={0.15} />
                      <stop offset="100%" stopColor="#0ab39c" stopOpacity={0} />
                    </linearGradient>
                    <filter id="joinGlow" x="-10%" y="-30%" width="120%" height="160%">
                      <feGaussianBlur in="SourceGraphic" stdDeviation="2.5" result="blur" />
                      <feFlood floodColor="#0ab39c" floodOpacity="0.35" result="flood" />
                      <feComposite in="flood" in2="blur" operator="in" result="glow" />
                      <feMerge>
                        <feMergeNode in="glow" />
                        <feMergeNode in="SourceGraphic" />
                      </feMerge>
                    </filter>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} />
                  <XAxis dataKey="label" tick={{ fontSize: 10.5, fill: ct.axisTickMuted }} />
                  <YAxis tick={{ fontSize: 10.5, fill: ct.axisTickMuted }} allowDecimals={false} />
                  <Tooltip content={<ChartTooltip />} />
                  <Area type="monotone" dataKey="count" name="Joinings" stroke="#0ab39c" strokeWidth={2.75} fill="url(#joinGrad)" filter="url(#joinGlow)" dot={{ r: 4, fill: '#0ab39c', strokeWidth: 2, stroke: ct.dotStroke }} activeDot={{ r: 6, fill: '#0ab39c' }} />
                </AreaChart>
              </ResponsiveContainer>
            </CardBody>
          </Card>
        </Col>

        <Col xs={12} lg={6}>
          <Card className="hr-ov-card">
            <div className="hr-ov-card-head">
              <div>
                <h5 className="hr-ov-card-title">Exit Trend</h5>
                <p className="hr-ov-card-sub">Last 12 months</p>
              </div>
              <i className="ri-logout-box-line" style={{ fontSize: 18, color: '#f06548' }} />
            </div>
            <CardBody style={{ padding: 12 }}>
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={data.exit_trend} margin={{ top: 8, right: 12, left: -10, bottom: 0 }}>
                  <defs>
                    <filter id="exitGlow" x="-10%" y="-30%" width="120%" height="160%">
                      <feGaussianBlur in="SourceGraphic" stdDeviation="2.5" result="blur" />
                      <feFlood floodColor="#f06548" floodOpacity="0.30" result="flood" />
                      <feComposite in="flood" in2="blur" operator="in" result="glow" />
                      <feMerge>
                        <feMergeNode in="glow" />
                        <feMergeNode in="SourceGraphic" />
                      </feMerge>
                    </filter>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} />
                  <XAxis dataKey="label" tick={{ fontSize: 10.5, fill: ct.axisTickMuted }} />
                  <YAxis tick={{ fontSize: 10.5, fill: ct.axisTickMuted }} allowDecimals={false} />
                  <Tooltip content={<ChartTooltip />} />
                  <Line type="monotone" dataKey="count" name="Exits" stroke="#f06548" strokeWidth={2.75} filter="url(#exitGlow)" dot={{ r: 4, fill: '#f06548', strokeWidth: 2, stroke: ct.dotStroke }} activeDot={{ r: 6, fill: '#f06548' }} />
                </LineChart>
              </ResponsiveContainer>
            </CardBody>
          </Card>
        </Col>
      </Row>

      <Row className="g-3 mb-3">
        <Col xs={12} lg={6}>
          <Card className="hr-ov-card">
            <div className="hr-ov-card-head">
              <div>
                <h5 className="hr-ov-card-title">Recruitment Status</h5>
                <p className="hr-ov-card-sub">All requisitions</p>
              </div>
              <i className="ri-search-line" style={{ fontSize: 18, color: '#299cdb' }} />
            </div>
            <CardBody style={{ padding: 12 }}>
              <StatusBreakdown rows={data.recruitment_by_status} />
            </CardBody>
          </Card>
        </Col>
        <Col xs={12} lg={6}>
          <Card className="hr-ov-card">
            <div className="hr-ov-card-head">
              <div>
                <h5 className="hr-ov-card-title">Expense Claims</h5>
                <p className="hr-ov-card-sub">By approval state</p>
              </div>
              <i className="ri-bill-line" style={{ fontSize: 18, color: '#f7b84b' }} />
            </div>
            <CardBody style={{ padding: 12 }}>
              <StatusBreakdown rows={data.expense_by_status} />
            </CardBody>
          </Card>
        </Col>
      </Row>

      <Row className="g-3 mb-3">
        <Col xs={12} lg={6}>
          <Card className="hr-ov-card">
            <div className="hr-ov-card-head">
              <div>
                <h5 className="hr-ov-card-title">Department Turnover</h5>
                <p className="hr-ov-card-sub">Exits last 12 months ÷ current headcount</p>
              </div>
              <i className="ri-fire-line" style={{ fontSize: 18, color: '#f06548' }} />
            </div>
            <CardBody style={{ padding: '12px 8px 8px' }}>
              <DepartmentTurnover rows={data.department_turnover} />
            </CardBody>
          </Card>
        </Col>

        <Col xs={12} md={6} lg={3}>
          <Card className="hr-ov-card">
            <div className="hr-ov-card-head">
              <div>
                <h5 className="hr-ov-card-title">Probation Snapshot</h5>
                <p className="hr-ov-card-sub">Current vs completed</p>
              </div>
              <i className="ri-time-line" style={{ fontSize: 18, color: '#f7b84b' }} />
            </div>
            <CardBody style={{ padding: 16 }}>
              <ProbationSnapshot data={data.probation_snapshot} />
            </CardBody>
          </Card>
        </Col>

        <Col xs={12} md={6} lg={3}>
          <Card className="hr-ov-card">
            <div className="hr-ov-card-head">
              <div>
                <h5 className="hr-ov-card-title">Top Expense Categories</h5>
                <p className="hr-ov-card-sub">By total amount</p>
              </div>
              <i className="ri-wallet-3-line" style={{ fontSize: 18, color: '#0ab39c' }} />
            </div>
            <CardBody style={{ padding: '12px 14px' }}>
              <ExpenseByCategory rows={data.expense_by_category} />
            </CardBody>
          </Card>
        </Col>
      </Row>

      <Row className="g-3">
        <Col xs={12} lg={6}>
          <Card className="hr-ov-card">
            <div className="hr-ov-card-head">
              <div>
                <h5 className="hr-ov-card-title">Recent Joiners</h5>
                <p className="hr-ov-card-sub">Last 5 employees</p>
              </div>
              <i className="ri-user-add-line" style={{ fontSize: 18, color: '#0ab39c' }} />
            </div>
            <CardBody style={{ padding: 0 }}>
              {data.recent_joiners.length === 0 ? (
                <EmptyState icon="ri-user-add-line" text="No recent joiners yet." />
              ) : (
                <div className="hr-ov-list">
                  {data.recent_joiners.map(e => (
                    <div key={e.id} className="hr-ov-list-row">
                      <div className="hr-ov-avatar" style={{ background: 'linear-gradient(135deg,#405189,#6691e7)' }}>
                        {(e.display_name || '?').trim().charAt(0).toUpperCase()}
                      </div>
                      <div className="ms-2 flex-grow-1 min-w-0">
                        <div className="fw-semibold" style={{ fontSize: 13, color: 'var(--vz-heading-color, var(--vz-body-color))' }}>
                          {e.display_name} <span className="text-muted fw-normal" style={{ fontSize: 11 }}>· {e.emp_code}</span>
                        </div>
                        <div className="text-muted" style={{ fontSize: 11.5 }}>
                          {[e.designation_name, e.department_name].filter(Boolean).join(' · ') || '—'}
                        </div>
                      </div>
                      <div className="text-end" style={{ fontSize: 11.5, color: 'var(--vz-secondary-color)' }}>
                        {fmtDate(e.date_of_joining)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardBody>
          </Card>
        </Col>

        <Col xs={12} lg={6}>
          <Card className="hr-ov-card">
            <div className="hr-ov-card-head">
              <div>
                <h5 className="hr-ov-card-title">Upcoming Joiners</h5>
                <p className="hr-ov-card-sub">Next 5 expected starts</p>
              </div>
              <i className="ri-calendar-event-line" style={{ fontSize: 18, color: '#7c5cfc' }} />
            </div>
            <CardBody style={{ padding: 0 }}>
              {data.upcoming_joiners.length === 0 ? (
                <EmptyState icon="ri-calendar-event-line" text="No future joiners scheduled." />
              ) : (
                <div className="hr-ov-list">
                  {data.upcoming_joiners.map((e, i) => (
                    <div key={i} className="hr-ov-list-row">
                      <div className="hr-ov-avatar" style={{
                        background: e.source === 'invite'
                          ? 'linear-gradient(135deg,#7c5cfc,#a993fd)'
                          : 'linear-gradient(135deg,#0ab39c,#3dd6c3)',
                      }}>
                        <i className={e.source === 'invite' ? 'ri-mail-line' : 'ri-user-add-line'} />
                      </div>
                      <div className="ms-2 flex-grow-1 min-w-0">
                        <div className="fw-semibold" style={{ fontSize: 13, color: 'var(--vz-heading-color, var(--vz-body-color))' }}>
                          {e.name}
                        </div>
                        <div className="text-muted" style={{ fontSize: 11.5 }}>
                          {e.department_name || '—'} · {e.source === 'invite' ? 'Onboarding invite' : 'Employee record'}
                        </div>
                      </div>
                      <div className="text-end" style={{ fontSize: 11.5, color: 'var(--vz-secondary-color)' }}>
                        {fmtDate(e.join_date)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardBody>
          </Card>
        </Col>
      </Row>
    </div>
  );
}

function StatusBreakdown({ rows }: { rows: Array<{ status: string; count: number }> }) {
  if (!rows.length || rows.every(r => r.count === 0)) {
    return <EmptyState icon="ri-pie-chart-line" text="No data yet." />;
  }
  const items = rows.map((r, i) => ({
    ...r,
    color: STATUS_COLORS[r.status] || PALETTE[i % PALETTE.length],
  }));
  return (
    <Row className="g-2 align-items-center">
      <Col xs={12} sm={6}>
        <ResponsiveContainer width="100%" height={200}>
          <PieChart>
            <Pie
              data={items}
              dataKey="count"
              nameKey="status"
              innerRadius={45}
              outerRadius={75}
              paddingAngle={0}
              stroke="none"
            >
              {items.map((it, i) => <Cell key={i} fill={it.color} />)}
            </Pie>
            <Tooltip content={<ChartTooltip />} />
          </PieChart>
        </ResponsiveContainer>
      </Col>
      <Col xs={12} sm={6}>
        <Legend items={items.map(it => ({ label: it.status, value: it.count, color: it.color }))} />
      </Col>
    </Row>
  );
}

function Legend({ items }: { items: Array<{ label: string; value: number; color: string }> }) {
  const total = items.reduce((a, b) => a + b.value, 0);
  return (
    <div className="d-flex flex-column gap-2 px-2">
      {items.map((it, i) => {
        const pct = total ? Math.round((it.value / total) * 100) : 0;
        return (
          <div key={i} className="d-flex align-items-center justify-content-between" style={{ fontSize: 12 }}>
            <div className="d-flex align-items-center gap-2 min-w-0">
              <span style={{ width: 10, height: 10, borderRadius: 3, background: it.color, flexShrink: 0 }} />
              <span style={{ color: 'var(--vz-body-color)', fontWeight: 500 }}>{it.label}</span>
            </div>
            <span style={{ color: 'var(--vz-heading-color, var(--vz-body-color))', fontWeight: 700 }}>
              {it.value.toLocaleString()}
              <span style={{ color: 'var(--vz-secondary-color)', fontWeight: 500, marginLeft: 6 }}>· {pct}%</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

function EmptyState({ icon, text }: { icon: string; text: string }) {
  return (
    <div className="text-center text-muted py-4">
      <i className={icon} style={{ fontSize: 36, opacity: 0.5 }} />
      <div className="mt-2" style={{ fontSize: 12.5 }}>{text}</div>
    </div>
  );
}

function DepartmentTurnover({ rows }: { rows: OverviewData['department_turnover'] }) {
  if (!rows.length) {
    return <EmptyState icon="ri-fire-line" text="No turnover data yet — needs at least one exit." />;
  }
  const top = rows.slice(0, 8);
  const colorFor = (pct: number) => pct >= 10 ? '#f06548' : pct >= 5 ? '#f7b84b' : '#0ab39c';
  const ct = useChartTheme();
  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={top} layout="vertical" margin={{ top: 8, right: 40, left: 10, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} horizontal={false} />
        <XAxis
          type="number"
          tick={{ fontSize: 11, fill: ct.axisTickMuted }}
          tickFormatter={(v: number) => `${v}%`}
          domain={[0, (max: number) => Math.max(10, Math.ceil(max * 1.1))]}
        />
        <YAxis type="category" dataKey="name" tick={{ fontSize: 11.5, fill: ct.axisTick }} width={120} />
        <Tooltip
          cursor={{ fill: 'rgba(240,101,72,0.06)' }}
          content={({ active, payload }: any) => {
            if (!active || !payload?.length) return null;
            const row = payload[0].payload;
            return (
              <div className="hr-ov-tooltip">
                <div className="hr-ov-tooltip-label">{row.name}</div>
                <div className="hr-ov-tooltip-row" style={{ fontSize: 14 }}>{row.turnover_pct}% turnover</div>
                <div className="hr-ov-tooltip-foot">
                  {row.exits} exit{row.exits === 1 ? '' : 's'} · {row.headcount} on rolls
                </div>
              </div>
            );
          }}
        />
        <Bar dataKey="turnover_pct" radius={[0, 8, 8, 0]}>
          {top.map((r, i) => <Cell key={i} fill={colorFor(r.turnover_pct)} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function ProbationSnapshot({ data }: { data: OverviewData['probation_snapshot'] }) {
  const total = data.in_progress + data.completed;
  if (total === 0) {
    return <EmptyState icon="ri-time-line" text="No probation data yet." />;
  }
  const pctInProgress = total ? Math.round((data.in_progress / total) * 100) : 0;
  return (
    <div>
      <div className="d-flex justify-content-between align-items-end mb-3">
        <div>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: '#f7b84b', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 4 }}>In Progress</div>
          <div style={{ fontSize: 28, fontWeight: 800, lineHeight: 1, color: 'var(--vz-heading-color, var(--vz-body-color))' }}>
            <AnimatedNumber value={data.in_progress} />
          </div>
        </div>
        <div className="text-end">
          <div style={{ fontSize: 10.5, fontWeight: 700, color: '#0ab39c', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 4 }}>Completed</div>
          <div style={{ fontSize: 28, fontWeight: 800, lineHeight: 1, color: 'var(--vz-heading-color, var(--vz-body-color))' }}>
            <AnimatedNumber value={data.completed} />
          </div>
        </div>
      </div>
      <div style={{
        height: 10, borderRadius: 999, background: 'var(--vz-border-color)',
        overflow: 'hidden', display: 'flex',
      }}>
        <div style={{ width: `${pctInProgress}%`, background: 'linear-gradient(90deg,#f7b84b,#fad07e)' }} />
        <div style={{ flex: 1, background: 'linear-gradient(90deg,#0ab39c,#3dd6c3)' }} />
      </div>
      <div className="d-flex justify-content-between mt-2" style={{ fontSize: 11, color: 'var(--vz-secondary-color)' }}>
        <span>{pctInProgress}% under review</span>
        <span>{100 - pctInProgress}% confirmed</span>
      </div>
    </div>
  );
}

function formatINRCompact(n: number): string {
  const v = Math.max(0, Number(n) || 0);
  if (v < 100000) return '₹' + v.toLocaleString('en-IN', { maximumFractionDigits: 0 });
  if (v < 10000000) return '₹' + (v / 100000).toFixed(2) + 'L';
  return '₹' + (v / 10000000).toFixed(2) + 'Cr';
}

function ExpenseByCategory({ rows }: { rows: OverviewData['expense_by_category'] }) {
  if (!rows.length) {
    return <EmptyState icon="ri-wallet-3-line" text="No expense claims yet." />;
  }
  const max = Math.max(...rows.map(r => r.amount), 1);
  const COLORS = ['#0ab39c', '#299cdb', '#7c5cfc', '#f7b84b', '#f06548'];
  return (
    <div className="d-flex flex-column gap-3" style={{ paddingTop: 4 }}>
      {rows.map((r, i) => {
        const pct = (r.amount / max) * 100;
        return (
          <div key={r.category}>
            <div className="d-flex justify-content-between align-items-baseline" style={{ fontSize: 12, marginBottom: 4 }}>
              <span style={{ color: 'var(--vz-body-color)', fontWeight: 600 }}>{r.category}</span>
              <span style={{ color: 'var(--vz-heading-color, var(--vz-body-color))', fontWeight: 700 }}>
                {formatINRCompact(r.amount)}
              </span>
            </div>
            <div style={{ height: 6, background: 'var(--vz-border-color)', borderRadius: 999, overflow: 'hidden' }}>
              <div style={{ width: `${pct}%`, height: '100%', background: COLORS[i % COLORS.length], borderRadius: 999 }} />
            </div>
            <div className="mt-1" style={{ fontSize: 10.5, color: 'var(--vz-secondary-color)' }}>
              {r.count} claim{r.count === 1 ? '' : 's'}
            </div>
          </div>
        );
      })}
    </div>
  );
}
