import { useState, useEffect } from 'react';
import { Card, CardBody, Col, Row } from 'reactstrap';
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import api from '../../api';
import { useAuth } from '../../contexts/AuthContext';
import { useBranchSwitcher } from '../../contexts/BranchSwitcherContext';
import { ShimmerDashboard } from '../../components/ui/Shimmer';
import { formatCompact } from '../../utils/formatNumber';

const methodLabels: Record<string, string> = {
  upi: 'UPI', credit_card: 'Credit Card', debit_card: 'Debit Card',
  net_banking: 'Net Banking', wallet: 'Wallet', cash: 'Cash', cheque: 'Cheque',
};

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

const ChartTooltip = ({ active, payload, label, prefix = '' }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: '#1e2a3a', borderRadius: 10, padding: '8px 14px', boxShadow: '0 4px 20px rgba(0,0,0,0.18)', border: 'none', fontSize: 12 }}>
      <div style={{ color: '#a8b8c8', fontWeight: 600, marginBottom: 4, fontSize: 11 }}>{label}</div>
      {payload.map((p: any, i: number) => (
        <div key={i} style={{ color: '#fff', fontWeight: 700, fontSize: 13 }}>
          {prefix}{typeof p.value === 'number' ? p.value.toLocaleString() : p.value}
        </div>
      ))}
    </div>
  );
};

interface KpiProps {
  label: string;
  value: React.ReactNode;
  iconClass: string;
  gradient: string;
  changeText?: string;
  trend?: 'up' | 'down' | 'neutral';
  change?: string;
}

function KpiCard({ label, value, iconClass, gradient, changeText, trend = 'neutral', change }: KpiProps) {
  const trendColor = trend === 'up' ? '#0ab39c' : trend === 'down' ? '#f06548' : '#878a99';
  const arrow = trend === 'up' ? 'ri-arrow-up-line' : trend === 'down' ? 'ri-arrow-down-line' : 'ri-subtract-line';
  return (
    <div className="dashboard-kpi-card" style={{
      borderRadius: 16,
      padding: '20px 20px 16px',
      boxShadow: '0 2px 20px rgba(0,0,0,0.06)',
      border: '1px solid var(--vz-border-color)',
      position: 'relative',
      overflow: 'hidden',
      height: '100%',
    }}>
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 3,
        background: gradient,
      }} />
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--vz-secondary-color)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 10 }}>{label}</p>
          <h3 style={{
            fontSize: 'clamp(20px, 1.8vw, 28px)',
            fontWeight: 800,
            color: 'var(--vz-heading-color, var(--vz-body-color))',
            margin: 0,
            lineHeight: 1.05,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}>{value}</h3>
          {(change || changeText) && (
            <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
              {change && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, background: trendColor + '18', color: trendColor, borderRadius: 6, padding: '2px 7px', fontSize: 11, fontWeight: 700 }}>
                  <i className={arrow} style={{ fontSize: 11 }}></i> {change}
                </span>
              )}
              {changeText && <span style={{ fontSize: 11, color: 'var(--vz-secondary-color)' }}>{changeText}</span>}
            </div>
          )}
        </div>
        <div className="dashboard-kpi-icon" style={{
          width: 42, height: 42, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: gradient, flexShrink: 0,
        }}>
          <i className={iconClass} style={{ fontSize: 19, color: '#fff' }}></i>
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
  padding: '16px 20px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
};

export default function BranchDashboard() {
  const { user } = useAuth();
  const { isMainBranchUser, selectedBranchId, selectedBranch } = useBranchSwitcher();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    api.get('/dashboard/client-stats', {
      params: selectedBranchId ? { branch_id: selectedBranchId } : {},
      signal: controller.signal,
    })
      .then(res => setData(res.data))
      .catch(err => {
        if (err?.name !== 'CanceledError' && err?.code !== 'ERR_CANCELED') {
          // swallow other errors silently — keep current data on screen
        }
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [selectedBranchId]);

  if (loading) return <ShimmerDashboard />;
  if (!data) return null;

  const { counts, plan, recent_payments, payment_trend, can_view_payments, employees: emp } = data;
  const displayName = selectedBranch?.name || (isMainBranchUser ? user?.client_name : user?.branch_name);
  const successRate = counts.total_payments > 0
    ? Math.round((counts.success_payments / counts.total_payments) * 100) : 0;

  return (
    <>
      <style>{`
        .dashboard-kpi-card {
          background: #ffffff;
          transition:
            transform 220ms cubic-bezier(0.34, 1.56, 0.64, 1),
            box-shadow 220ms ease,
            border-color 220ms ease;
          will-change: transform;
          cursor: default;
        }
        .dashboard-kpi-card:hover {
          transform: translateY(-4px);
          box-shadow:
            0 18px 36px -8px rgba(64, 81, 137, 0.28),
            0 8px 16px -4px rgba(64, 81, 137, 0.18),
            0 2px 4px rgba(0, 0, 0, 0.06) !important;
          border-color: rgba(64, 81, 137, 0.35) !important;
        }
        .dashboard-kpi-card:hover .dashboard-kpi-icon {
          transform: scale(1.08) rotate(-3deg);
          box-shadow: 0 10px 22px rgba(0, 0, 0, 0.22);
        }
        .dashboard-kpi-icon {
          transition:
            transform 220ms cubic-bezier(0.34, 1.56, 0.64, 1),
            box-shadow 220ms ease;
        }
        [data-bs-theme="dark"] .dashboard-kpi-card { background: #1c2531; }
        [data-bs-theme="dark"] .dashboard-kpi-card:hover {
          box-shadow:
            0 18px 36px -8px rgba(0, 0, 0, 0.65),
            0 8px 16px -4px rgba(0, 0, 0, 0.45),
            0 2px 4px rgba(0, 0, 0, 0.30) !important;
          border-color: rgba(124, 92, 252, 0.50) !important;
        }
        .bd-list-row {
          transition: background 0.18s ease, box-shadow 0.18s ease;
          cursor: pointer;
          position: relative;
        }
        .bd-list-row:hover {
          background: rgba(124, 92, 252, 0.08);
          box-shadow: inset 3px 0 0 0 rgba(124, 92, 252, 0.7);
        }
        [data-bs-theme="dark"] .bd-list-row:hover,
        [data-layout-mode="dark"] .bd-list-row:hover {
          background: rgba(255, 255, 255, 0.05);
          box-shadow: inset 3px 0 0 0 rgba(124, 92, 252, 0.9);
        }
        .bd-list-row + .bd-list-row { border-top: 1px solid #f1f3f9; }
        [data-bs-theme="dark"] .bd-list-row + .bd-list-row,
        [data-layout-mode="dark"] .bd-list-row + .bd-list-row { border-top-color: rgba(255,255,255,0.06); }

        /* ── Plan status pill (mirrors ClientDashboard) ── */
        @keyframes bd-dot-core-pulse {
          0%, 100% { transform: scale(1);    box-shadow: 0 0 0 0 var(--bd-dot-color), 0 0 8px 1px var(--bd-dot-color); }
          50%      { transform: scale(1.15); box-shadow: 0 0 0 3px color-mix(in srgb, var(--bd-dot-color) 35%, transparent), 0 0 14px 2px var(--bd-dot-color); }
        }
        @keyframes bd-dot-ripple {
          0%   { transform: translate(-50%, -50%) scale(1);   opacity: 0.55; }
          100% { transform: translate(-50%, -50%) scale(2.8); opacity: 0;    }
        }
        @keyframes bd-plan-blink {
          0%, 100% {
            box-shadow:
              0 0 0 0 var(--bd-plan-ring),
              0 1px 4px var(--bd-plan-shadow),
              0 4px 14px var(--bd-plan-shadow),
              0 8px 28px var(--bd-plan-glow);
            filter: brightness(1);
          }
          50% {
            box-shadow:
              0 0 0 4px var(--bd-plan-ring-soft),
              0 2px 8px var(--bd-plan-shadow),
              0 6px 22px var(--bd-plan-shadow),
              0 14px 42px var(--bd-plan-glow);
            filter: brightness(1.08);
          }
        }
        @keyframes bd-plan-sweep {
          0%   { transform: translateX(-140%); }
          60%  { transform: translateX(140%); }
          100% { transform: translateX(140%); }
        }
        @keyframes bd-plan-vibrate {
          0%, 88%, 100% { transform: translate(0, 0) rotate(0); }
          89% { transform: translate(-1px, 0) rotate(-0.4deg); }
          90% { transform: translate( 1px, 0) rotate( 0.4deg); }
          91% { transform: translate(-1px, 1px) rotate(-0.3deg); }
          92% { transform: translate( 1px,-1px) rotate( 0.3deg); }
          93% { transform: translate(-1px, 0) rotate(-0.2deg); }
          94% { transform: translate( 1px, 0) rotate( 0.2deg); }
          95% { transform: translate(0, 0) rotate(0); }
        }
        .bd-plan-pill {
          position: relative;
          overflow: hidden;
          animation:
            bd-plan-blink 1.8s ease-in-out infinite,
            bd-plan-vibrate 4.5s ease-in-out infinite;
        }
        .bd-plan-pill.bd-plan-pill-calm {
          animation: none;
        }
        .bd-plan-pill::after {
          content: '';
          position: absolute;
          inset: 0;
          background: linear-gradient(110deg, transparent 40%, rgba(255,255,255,0.55) 50%, transparent 60%);
          transform: translateX(-140%);
          animation: bd-plan-sweep 2.6s ease-in-out infinite;
          pointer-events: none;
        }
        .bd-plan-pill.bd-plan-pill-calm::after {
          display: none;
        }
        /* Dark-mode adjustments — stronger tint, tamer halo, brighter text. */
        [data-bs-theme="dark"] .bd-plan-pill,
        [data-layout-mode="dark"] .bd-plan-pill {
          background-image: linear-gradient(135deg,
            color-mix(in srgb, currentColor 22%, transparent) 0%,
            color-mix(in srgb, currentColor 14%, transparent) 100%) !important;
          filter: brightness(1.08);
        }
        [data-bs-theme="dark"] .bd-plan-pill .bd-plan-dot-ripple,
        [data-layout-mode="dark"] .bd-plan-pill .bd-plan-dot-ripple {
          opacity: 0.7;
        }
        .bd-plan-dot-wrap {
          position: relative;
          display: inline-block;
          width: 11px;
          height: 11px;
          flex-shrink: 0;
        }
        .bd-plan-dot-core {
          position: absolute;
          inset: 0;
          border-radius: 50%;
          background: var(--bd-dot-color);
          animation: bd-dot-core-pulse 1.4s ease-in-out infinite;
        }
        .bd-plan-dot-ripple {
          position: absolute;
          top: 50%;
          left: 50%;
          width: 11px;
          height: 11px;
          border-radius: 50%;
          background: var(--bd-dot-color);
          transform: translate(-50%, -50%) scale(1);
          opacity: 0.5;
          animation: bd-dot-ripple 1.6s ease-out infinite;
          pointer-events: none;
        }
        .bd-plan-dot-ripple-2 { animation-delay: 0.8s; }
      `}</style>
      {/* Page Title */}
      <Row className="mb-2">
        <Col xs={12}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 0 12px' }}>
            <div>
              <h4 style={{ fontWeight: 800, fontSize: 20, color: 'var(--vz-heading-color, var(--vz-body-color))', margin: 0 }}>Dashboard</h4>
              <p style={{ margin: 0, fontSize: 12, color: 'var(--vz-secondary-color)', marginTop: 2 }}>
                {isMainBranchUser && !selectedBranchId ? 'All branches overview' : 'Branch operations summary'}
              </p>
            </div>
            <ol className="breadcrumb m-0" style={{ fontSize: 12 }}>
              <li className="breadcrumb-item"><a href="#" style={{ color: '#405189' }}>{displayName}</a></li>
              <li className="breadcrumb-item active">{isMainBranchUser && !selectedBranchId ? 'All Branches' : 'Overview'}</li>
            </ol>
          </div>
        </Col>
      </Row>

      {/* Plan status pill (mirrors ClientDashboard) */}
      {(() => {
        const isExpired = plan.status === 'expired';
        const isWarn = !isExpired && plan.days_remaining !== null && plan.days_remaining <= 30;
        const isAlert = isExpired || isWarn;
        const color = isExpired ? '#1a7927' : isWarn ? '#0c5a29' : '#0c695d';
        const label = isExpired ? 'EXPIRED' : isWarn ? 'EXPIRES SOON' : 'CURRENT';
        return (
          <div style={{ marginBottom: 16 }}>
            <span
              className={`bd-plan-pill d-inline-flex align-items-center gap-2 rounded-pill ${isAlert ? '' : 'bd-plan-pill-calm'}`}
              style={{
                background: `linear-gradient(135deg, ${color}1f 0%, ${color}12 100%)`,
                color,
                border: `1px solid ${color}`,
                fontSize: 12.5,
                fontWeight: 500,
                letterSpacing: '0.03em',
                padding: '5px 13px',
                ['--bd-plan-ring' as any]: `${color}00`,
                ['--bd-plan-ring-soft' as any]: `${color}33`,
                ['--bd-plan-shadow' as any]: `${color}66`,
                ['--bd-plan-glow' as any]: `${color}33`,
                ['--bd-dot-color' as any]: color,
              }}
              title={isExpired ? `Expired ${plan.expires_at ?? ''}` : `Valid until ${plan.expires_at ?? ''}`}
            >
              <span className="bd-plan-dot-wrap">
                <span className="bd-plan-dot-ripple" />
                <span className="bd-plan-dot-ripple bd-plan-dot-ripple-2" />
                <span className="bd-plan-dot-core" />
              </span>
              {label}: {plan.name?.toUpperCase()}
              {isWarn && plan.days_remaining !== null && (
                <span className="ms-1" style={{ opacity: 0.9 }}>· {plan.days_remaining}d</span>
              )}
              {plan.expires_at && (
                <span className="ms-1" style={{ opacity: 0.8 }}>· {plan.expires_at}</span>
              )}
            </span>
          </div>
        );
      })()}

      {/* ── Workforce analytics ────────────────────────────────────────
          Promoted above the billing tiles per request — gives branch users
          the headcount snapshot first, with the same branch-scoping logic
          as the rest of the dashboard. */}
      {emp && (
        <>
          <Row className="mb-2">
            <Col xs={12}>
              <div style={{ padding: '4px 0 8px' }}>
                <h5 style={{ fontWeight: 800, fontSize: 16, color: 'var(--vz-heading-color, var(--vz-body-color))', margin: 0 }}>Workforce Analytics</h5>
                <p style={{ margin: 0, fontSize: 12, color: 'var(--vz-secondary-color)', marginTop: 2 }}>
                  Employee headcount, hiring activity and demographics
                </p>
              </div>
            </Col>
          </Row>

          {/* Workforce KPI cards */}
          <Row className="g-3 mb-3">
            <Col md={3} sm={6} xs={6}>
              <KpiCard label="Total Employees" value={<AnimatedNumber value={emp.totals.total} />}
                iconClass="ri-team-line" gradient="linear-gradient(135deg,#405189,#6691e7)"
                changeText="on payroll" />
            </Col>
            <Col md={3} sm={6} xs={6}>
              <KpiCard label="Active" value={<AnimatedNumber value={emp.totals.active} />}
                iconClass="ri-user-follow-line" gradient="linear-gradient(135deg,#0ab39c,#02c8a7)"
                trend="up"
                change={emp.totals.total > 0 ? `${Math.round((emp.totals.active / emp.totals.total) * 100)}%` : '0%'}
                changeText="of total" />
            </Col>
            <Col md={3} sm={6} xs={6}>
              <KpiCard label="On Leave" value={<AnimatedNumber value={emp.totals.on_leave} />}
                iconClass="ri-calendar-event-line" gradient="linear-gradient(135deg,#f7b84b,#f1963b)"
                changeText="away today" />
            </Col>
            <Col md={3} sm={6} xs={6}>
              <KpiCard label="Probation" value={<AnimatedNumber value={emp.totals.probation} />}
                iconClass="ri-hourglass-2-line" gradient="linear-gradient(135deg,#9b72cf,#865ce2)"
                changeText="under review" />
            </Col>
            <Col md={3} sm={6} xs={6}>
              <KpiCard label="Notice Period" value={<AnimatedNumber value={emp.totals.notice_period} />}
                iconClass="ri-logout-box-r-line" gradient="linear-gradient(135deg,#f06548,#fb6e52)"
                changeText="leaving" />
            </Col>
            <Col md={3} sm={6} xs={6}>
              <KpiCard label="New Joiners" value={<AnimatedNumber value={emp.totals.new_this_month} />}
                iconClass="ri-user-add-line" gradient="linear-gradient(135deg,#299cdb,#50c3e6)"
                trend={emp.totals.new_this_month > 0 ? 'up' : 'neutral'}
                change={`+${emp.totals.new_last_30d}`} changeText="last 30 days" />
            </Col>
            <Col md={3} sm={6} xs={6}>
              <KpiCard label="Avg Tenure" value={<>{emp.totals.avg_tenure_yrs} <span style={{ fontSize: 14, fontWeight: 700 }}>yrs</span></>}
                iconClass="ri-time-line" gradient="linear-gradient(135deg,#1cbb8c,#0ab39c)"
                changeText="across active staff" />
            </Col>
            <Col md={3} sm={6} xs={6}>
              <KpiCard label="Exited" value={<AnimatedNumber value={emp.totals.exited} />}
                iconClass="ri-user-unfollow-line" gradient="linear-gradient(135deg,#878a99,#6c7080)"
                changeText="resigned + terminated" />
            </Col>
          </Row>

          {/* Charts row: Status donut + Joining trend + Gender split */}
          <Row className="g-3 mb-3">
            <Col xl={4} md={6}>
              <Card style={cardStyle}>
                <div style={cardHeaderStyle}>
                  <div>
                    <h5 style={{ fontWeight: 700, fontSize: 15, color: 'var(--vz-heading-color, var(--vz-body-color))', margin: 0 }}>Status Breakdown</h5>
                    <p style={{ margin: 0, fontSize: 11, color: 'var(--vz-secondary-color)', marginTop: 2 }}>Where everyone stands</p>
                  </div>
                </div>
                <CardBody style={{ padding: '8px 4px 0' }}>
                  <ResponsiveContainer width="100%" height={250}>
                    <PieChart>
                      <Pie
                        data={emp.status.filter((s: any) => s.value > 0)}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        innerRadius={48}
                        outerRadius={80}
                        paddingAngle={2}
                      >
                        {emp.status.map((_: any, i: number) => (
                          <Cell key={i} fill={['#0ab39c', '#878a99', '#f7b84b', '#9b72cf', '#f06548', '#6c7080', '#dc3545'][i % 7]} />
                        ))}
                      </Pie>
                      <Tooltip />
                      <Legend
                        verticalAlign="bottom"
                        iconType="circle"
                        wrapperStyle={{ fontSize: 11, paddingTop: 4 }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </CardBody>
              </Card>
            </Col>

            <Col xl={4} md={6}>
              <Card style={cardStyle}>
                <div style={cardHeaderStyle}>
                  <div>
                    <h5 style={{ fontWeight: 700, fontSize: 15, color: 'var(--vz-heading-color, var(--vz-body-color))', margin: 0 }}>Joining Trend</h5>
                    <p style={{ margin: 0, fontSize: 11, color: 'var(--vz-secondary-color)', marginTop: 2 }}>Last 6 months</p>
                  </div>
                </div>
                <CardBody style={{ padding: '12px 16px 8px' }}>
                  <ResponsiveContainer width="100%" height={250}>
                    <BarChart data={emp.joining_trend} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f3f8" vertical={false} />
                      <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#a0aec0', fontWeight: 600 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 10, fill: '#a0aec0' }} axisLine={false} tickLine={false} width={30} allowDecimals={false} />
                      <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(64,81,137,0.06)' }} />
                      <Bar dataKey="count" fill="#405189" radius={[6, 6, 0, 0]} barSize={26} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardBody>
              </Card>
            </Col>

            <Col xl={4} md={12}>
              <Card style={cardStyle}>
                <div style={cardHeaderStyle}>
                  <div>
                    <h5 style={{ fontWeight: 700, fontSize: 15, color: 'var(--vz-heading-color, var(--vz-body-color))', margin: 0 }}>Gender Diversity</h5>
                    <p style={{ margin: 0, fontSize: 11, color: 'var(--vz-secondary-color)', marginTop: 2 }}>Composition</p>
                  </div>
                </div>
                <CardBody style={{ padding: '8px 4px 0' }}>
                  <ResponsiveContainer width="100%" height={250}>
                    <PieChart>
                      <Pie
                        data={emp.gender.filter((g: any) => g.value > 0)}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        outerRadius={80}
                        label={(entry: any) => `${entry.name}: ${entry.value}`}
                        labelLine={false}
                        style={{ fontSize: 11 }}
                      >
                        {emp.gender.map((_: any, i: number) => (
                          <Cell key={i} fill={['#299cdb', '#f06548', '#9b72cf'][i % 3]} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </CardBody>
              </Card>
            </Col>
          </Row>

          {/* Department headcount + Top designations */}
          <Row className="g-3 mb-3">
            <Col xl={7}>
              <Card style={cardStyle}>
                <div style={cardHeaderStyle}>
                  <div>
                    <h5 style={{ fontWeight: 700, fontSize: 15, color: 'var(--vz-heading-color, var(--vz-body-color))', margin: 0 }}>Headcount by Department</h5>
                    <p style={{ margin: 0, fontSize: 11, color: 'var(--vz-secondary-color)', marginTop: 2 }}>Top {emp.by_department.length}</p>
                  </div>
                </div>
                <CardBody style={{ padding: '12px 16px 8px' }}>
                  {emp.by_department.length === 0 ? (
                    <div className="text-center text-muted py-4">No departments configured</div>
                  ) : (
                    <ResponsiveContainer width="100%" height={Math.max(220, emp.by_department.length * 36)}>
                      <BarChart data={emp.by_department} layout="vertical" margin={{ top: 5, right: 16, left: 8, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f3f8" horizontal={false} />
                        <XAxis type="number" tick={{ fontSize: 10, fill: '#a0aec0' }} axisLine={false} tickLine={false} allowDecimals={false} />
                        <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: '#5f6975', fontWeight: 600 }} axisLine={false} tickLine={false} width={120} />
                        <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(155,114,207,0.06)' }} />
                        <Bar dataKey="count" fill="#9b72cf" radius={[0, 6, 6, 0]} barSize={20} />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </CardBody>
              </Card>
            </Col>

            <Col xl={5}>
              <Card style={cardStyle}>
                <div style={cardHeaderStyle}>
                  <div>
                    <h5 style={{ fontWeight: 700, fontSize: 15, color: 'var(--vz-heading-color, var(--vz-body-color))', margin: 0 }}>Top Designations</h5>
                    <p style={{ margin: 0, fontSize: 11, color: 'var(--vz-secondary-color)', marginTop: 2 }}>Most common roles</p>
                  </div>
                </div>
                <CardBody style={{ padding: 0 }}>
                  {emp.by_designation.length === 0 ? (
                    <div className="text-center text-muted py-4">No designations configured</div>
                  ) : emp.by_designation.map((d: any, i: number) => {
                    const max = emp.by_designation[0].count || 1;
                    const pct = Math.round((d.count / max) * 100);
                    return (
                      <div key={i} className="bd-list-row" style={{ padding: '12px 20px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                            <div style={{
                              width: 28, height: 28, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center',
                              background: ['#405189', '#0ab39c', '#9b72cf', '#f7b84b', '#299cdb'][i % 5],
                              color: '#fff', fontWeight: 800, fontSize: 11, flexShrink: 0,
                            }}>{i + 1}</div>
                            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--vz-heading-color, var(--vz-body-color))', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {d.name}
                            </div>
                          </div>
                          <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--vz-heading-color, var(--vz-body-color))', flexShrink: 0, marginLeft: 8 }}>{d.count}</div>
                        </div>
                        <div style={{ height: 5, background: '#f0f3f8', borderRadius: 3, overflow: 'hidden' }}>
                          <div style={{ width: `${pct}%`, height: '100%', background: ['#405189', '#0ab39c', '#9b72cf', '#f7b84b', '#299cdb'][i % 5], transition: 'width 0.4s ease' }} />
                        </div>
                      </div>
                    );
                  })}
                </CardBody>
              </Card>
            </Col>
          </Row>

          {/* Tenure + Age + Upcoming events */}
          <Row className="g-3 mb-3">
            <Col xl={4} md={6}>
              <Card style={cardStyle}>
                <div style={cardHeaderStyle}>
                  <div>
                    <h5 style={{ fontWeight: 700, fontSize: 15, color: 'var(--vz-heading-color, var(--vz-body-color))', margin: 0 }}>Tenure Distribution</h5>
                    <p style={{ margin: 0, fontSize: 11, color: 'var(--vz-secondary-color)', marginTop: 2 }}>Time at company</p>
                  </div>
                </div>
                <CardBody style={{ padding: '12px 16px 8px' }}>
                  <ResponsiveContainer width="100%" height={230}>
                    <BarChart data={emp.tenure} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f3f8" vertical={false} />
                      <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#a0aec0', fontWeight: 600 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 10, fill: '#a0aec0' }} axisLine={false} tickLine={false} width={30} allowDecimals={false} />
                      <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(10,179,156,0.06)' }} />
                      <Bar dataKey="count" fill="#0ab39c" radius={[6, 6, 0, 0]} barSize={28} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardBody>
              </Card>
            </Col>

            <Col xl={4} md={6}>
              <Card style={cardStyle}>
                <div style={cardHeaderStyle}>
                  <div>
                    <h5 style={{ fontWeight: 700, fontSize: 15, color: 'var(--vz-heading-color, var(--vz-body-color))', margin: 0 }}>Age Distribution</h5>
                    <p style={{ margin: 0, fontSize: 11, color: 'var(--vz-secondary-color)', marginTop: 2 }}>Demographics</p>
                  </div>
                </div>
                <CardBody style={{ padding: '12px 16px 8px' }}>
                  <ResponsiveContainer width="100%" height={230}>
                    <BarChart data={emp.age_distribution} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f3f8" vertical={false} />
                      <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#a0aec0', fontWeight: 600 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 10, fill: '#a0aec0' }} axisLine={false} tickLine={false} width={30} allowDecimals={false} />
                      <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(247,184,75,0.08)' }} />
                      <Bar dataKey="count" fill="#f7b84b" radius={[6, 6, 0, 0]} barSize={28} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardBody>
              </Card>
            </Col>

            <Col xl={4} md={12}>
              <Card style={cardStyle}>
                <div style={cardHeaderStyle}>
                  <div>
                    <h5 style={{ fontWeight: 700, fontSize: 15, color: 'var(--vz-heading-color, var(--vz-body-color))', margin: 0 }}>Upcoming Events</h5>
                    <p style={{ margin: 0, fontSize: 11, color: 'var(--vz-secondary-color)', marginTop: 2 }}>Next 30 days</p>
                  </div>
                </div>
                <CardBody style={{ padding: 0, maxHeight: 260, overflowY: 'auto' }}>
                  {emp.upcoming_events.length === 0 ? (
                    <div className="text-center text-muted py-4">Nothing in the next 30 days</div>
                  ) : emp.upcoming_events.map((e: any, i: number) => {
                    const cfg = e.kind === 'birthday'
                      ? { color: '#f06548', icon: 'ri-cake-2-line', bg: '#f0654818', label: 'Birthday' }
                      : { color: '#0ab39c', icon: 'ri-medal-line',  bg: '#0ab39c18', label: `${e.years || ''} yr${e.years === 1 ? '' : 's'}`.trim() };
                    return (
                      <div key={i} className="bd-list-row" style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '11px 20px',
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                          <div style={{
                            width: 34, height: 34, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center',
                            background: cfg.bg, color: cfg.color, flexShrink: 0, fontSize: 16,
                          }}>
                            <i className={cfg.icon}></i>
                          </div>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--vz-heading-color, var(--vz-body-color))', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.name}</div>
                            <div style={{ fontSize: 11, color: 'var(--vz-secondary-color)', marginTop: 1 }}>
                              {cfg.label}{e.emp_code ? ` · ${e.emp_code}` : ''}
                            </div>
                          </div>
                        </div>
                        <div style={{
                          fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20,
                          background: cfg.bg, color: cfg.color, flexShrink: 0,
                        }}>
                          {new Date(e.on).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                        </div>
                      </div>
                    );
                  })}
                </CardBody>
              </Card>
            </Col>
          </Row>
        </>
      )}

      {/* Billing KPIs — Total Paid / Payments. Hidden entirely for users
          without payment access. (Branches / Users tiles were removed; that
          info is still shown in the Branches list and Workforce KPIs above.) */}
      {can_view_payments && (
        <Row className="g-3 mb-3">
          <Col md={6} xs={6}>
            <KpiCard label="Total Paid" value={<>₹{formatCompact(counts.total_paid)}</>}
              iconClass="ri-money-dollar-circle-line" gradient="linear-gradient(135deg,#0ab39c,#02c8a7)"
              trend="up" change={`${counts.success_payments}`} changeText="payments" />
          </Col>
          <Col md={6} xs={6}>
            <KpiCard label="Payments" value={<AnimatedNumber value={counts.total_payments} />}
              iconClass="ri-bank-card-line" gradient="linear-gradient(135deg,#405189,#6691e7)"
              trend={successRate > 80 ? 'up' : 'down'} change={`${successRate}%`} changeText="success rate" />
          </Col>
        </Row>
      )}

      {/* Payment Trend — billing data, gated like Recent Payments */}
      {can_view_payments && (
      <Row className="g-3 mb-3">
        <Col xs={12}>
          <Card style={cardStyle}>
            <div style={cardHeaderStyle}>
              <div>
                <h5 style={{ fontWeight: 700, fontSize: 15, color: 'var(--vz-heading-color, var(--vz-body-color))', margin: 0 }}>Payment Trend</h5>
                <p style={{ margin: 0, fontSize: 11, color: 'var(--vz-secondary-color)', marginTop: 2 }}>Monthly cash flow</p>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 18, fontWeight: 800, color: '#0ab39c' }} title={`₹${counts.total_paid.toLocaleString('en-IN')}`}>₹{formatCompact(counts.total_paid)}</div>
                <div style={{ fontSize: 10, color: 'var(--vz-secondary-color)', fontWeight: 600 }}>TOTAL PAID</div>
              </div>
            </div>
            <CardBody style={{ padding: '12px 16px 8px' }}>
              <ResponsiveContainer width="100%" height={260}>
                <AreaChart data={payment_trend} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="branchRevGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#0ab39c" stopOpacity={0.25} />
                      <stop offset="100%" stopColor="#0ab39c" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f3f8" vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#a0aec0', fontWeight: 600 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: '#a0aec0' }} axisLine={false} tickLine={false} width={55} tickFormatter={v => `₹${(v / 1000).toFixed(0)}K`} />
                  <Tooltip content={<ChartTooltip prefix="₹" />} cursor={{ stroke: 'rgba(10,179,156,0.4)', strokeWidth: 1, strokeDasharray: '3 3' }} />
                  <Area type="monotone" dataKey="amount" stroke="#0ab39c" strokeWidth={2.5} fill="url(#branchRevGrad)" dot={{ r: 4, fill: '#0ab39c', strokeWidth: 2, stroke: '#fff' }} activeDot={{ r: 6, fill: '#0ab39c' }} />
                </AreaChart>
              </ResponsiveContainer>
            </CardBody>
          </Card>
        </Col>
      </Row>
      )}

      {/* Recent Payments — only for users with billing access. The Branches
          list card was removed per request; branch info still surfaces in
          the Workforce KPIs above and the branch switcher in the navbar. */}
      {can_view_payments && (
      <Row className="g-3">
        <Col xs={12}>
          <Card style={cardStyle}>
            <div style={cardHeaderStyle}>
              <div>
                <h5 style={{ fontWeight: 700, fontSize: 15, color: 'var(--vz-heading-color, var(--vz-body-color))', margin: 0 }}>Recent Payments</h5>
                <p style={{ margin: 0, fontSize: 11, color: 'var(--vz-secondary-color)', marginTop: 2 }}>Latest transactions</p>
              </div>
            </div>
            <CardBody style={{ padding: 0 }}>
              {recent_payments.map((p: any) => {
                const cfg = p.status === 'success'
                  ? { color: '#0ab39c', icon: 'ri-checkbox-circle-fill', bg: '#0ab39c18' }
                  : p.status === 'failed'
                  ? { color: '#f06548', icon: 'ri-close-circle-fill', bg: '#f0654818' }
                  : { color: '#f7b84b', icon: 'ri-time-fill', bg: '#f7b84b18' };
                return (
                  <div key={p.id} className="bd-list-row" style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '12px 20px',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div style={{
                        width: 38, height: 38, borderRadius: 11, display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: cfg.bg, color: cfg.color, flexShrink: 0, fontSize: 16,
                      }}>
                        <i className={cfg.icon}></i>
                      </div>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--vz-heading-color, var(--vz-body-color))' }}>{p.plan?.name || 'Payment'}</div>
                        <div style={{ fontSize: 11, color: 'var(--vz-secondary-color)', marginTop: 1 }}>
                          {p.invoice_number} · {methodLabels[p.method] || p.method}
                        </div>
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 14, fontWeight: 800, color: cfg.color }}>₹{parseFloat(p.total).toLocaleString()}</div>
                      <div style={{ fontSize: 10, color: 'var(--vz-secondary-color)', marginTop: 2 }}>
                        {new Date(p.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                      </div>
                    </div>
                  </div>
                );
              })}
              {recent_payments.length === 0 && <div className="text-center text-muted py-4">No payments yet</div>}
            </CardBody>
          </Card>
        </Col>
      </Row>
      )}
    </>
  );
}
