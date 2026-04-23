import { useState, useEffect } from 'react';
import { Card, CardBody, Col, Row } from 'reactstrap';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import api from '../../api';
import { useAuth } from '../../contexts/AuthContext';
import { ShimmerDashboard } from '../../components/ui/Shimmer';

const COLORS = ['#405189', '#0ab39c', '#f7b84b', '#f06548', '#299cdb', '#9b72cf'];

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
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div style={{ flex: 1 }}>
          <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--vz-secondary-color)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 10 }}>{label}</p>
          <h3 style={{ fontSize: 28, fontWeight: 800, color: 'var(--vz-heading-color, var(--vz-body-color))', margin: 0, lineHeight: 1 }}>{value}</h3>
          {(change || changeText) && (
            <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 5 }}>
              {change && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, background: trendColor + '18', color: trendColor, borderRadius: 6, padding: '2px 7px', fontSize: 11, fontWeight: 700 }}>
                  <i className={arrow} style={{ fontSize: 11 }}></i> {change}
                </span>
              )}
              {changeText && <span style={{ fontSize: 11, color: 'var(--vz-secondary-color)' }}>{changeText}</span>}
            </div>
          )}
        </div>
        <div style={{
          width: 46, height: 46, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: gradient, flexShrink: 0,
        }}>
          <i className={iconClass} style={{ fontSize: 20, color: '#fff' }}></i>
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

export default function ClientDashboard() {
  const { user } = useAuth();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/dashboard/client-stats').then(res => setData(res.data))
      .catch(() => {}).finally(() => setLoading(false));
  }, []);

  if (loading) return <ShimmerDashboard />;
  if (!data) return null;

  const { counts, plan, branches, recent_payments, payment_trend, user_roles } = data;
  const successRate = counts.total_payments > 0
    ? Math.round((counts.success_payments / counts.total_payments) * 100) : 0;

  return (
    <>
      <style>{`
        .dashboard-kpi-card { background: #ffffff; }
        [data-bs-theme="dark"] .dashboard-kpi-card { background: #1c2531; }
        @keyframes cd-plan-pulse {
          0%, 100% { transform: scale(1); box-shadow: 0 0 0 0 var(--cd-plan-color); }
          50% { transform: scale(1.15); box-shadow: 0 0 0 4px transparent; }
        }
      `}</style>
      {/* Page Title */}
      <Row className="mb-3">
        <Col xs={12}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 0 12px', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <h4 style={{ fontWeight: 800, fontSize: 20, color: 'var(--vz-heading-color, var(--vz-body-color))', margin: 0 }}>Dashboard</h4>
              <p style={{ margin: 0, fontSize: 12, color: 'var(--vz-secondary-color)', marginTop: 2 }}>Welcome back! Here's your organization overview.</p>
            </div>
            <div className="d-flex align-items-center gap-2 flex-wrap">
              {(() => {
                const isExpired = plan.status === 'expired';
                const isWarn = !isExpired && plan.days_remaining !== null && plan.days_remaining <= 30;
                const color = isExpired ? '#f06548' : isWarn ? '#f7b84b' : '#0ab39c';
                const label = isExpired ? 'EXPIRED' : isWarn ? 'EXPIRES SOON' : 'CURRENT';
                return (
                  <span
                    className="d-inline-flex align-items-center gap-1 rounded-pill px-2 py-1 fw-semibold"
                    style={{
                      background: `${color}15`,
                      color,
                      border: `1px solid ${color}40`,
                      fontSize: 10.5,
                      letterSpacing: '0.04em',
                      ['--cd-plan-color' as any]: `${color}66`,
                    }}
                    title={isExpired ? `Expired ${plan.expires_at}` : `Valid until ${plan.expires_at}`}
                  >
                    <span
                      className="rounded-circle"
                      style={{
                        width: 6, height: 6,
                        background: color,
                        animation: 'cd-plan-pulse 1.8s ease-in-out infinite',
                      }}
                    />
                    {label}: {plan.name?.toUpperCase()}
                    {isWarn && (
                      <span className="fw-normal ms-1" style={{ opacity: 0.85 }}>· {plan.days_remaining}d</span>
                    )}
                    <span className="fw-normal ms-1" style={{ opacity: 0.75 }}>· {plan.expires_at}</span>
                  </span>
                );
              })()}
              <ol className="breadcrumb m-0" style={{ fontSize: 12 }}>
                <li className="breadcrumb-item"><a href="#" style={{ color: '#405189' }}>{user?.client_name}</a></li>
                <li className="breadcrumb-item active">Overview</li>
              </ol>
            </div>
          </div>
        </Col>
      </Row>

      {/* KPI Cards */}
      <Row className="g-3 mb-3 ">
        <Col xl={2} md={4} xs={6}>
          <KpiCard label="Branches" value={<AnimatedNumber value={counts.total_branches} />}
            iconClass="ri-git-branch-line" gradient="linear-gradient(135deg,#299cdb,#50c3e6)"
            trend="up" change={`${counts.active_branches}`} changeText="active" />
        </Col>
        <Col xl={2} md={4} xs={6}>
          <KpiCard label="Users" value={<AnimatedNumber value={counts.total_users} />}
            iconClass="ri-user-3-line" gradient="linear-gradient(135deg,#9b72cf,#865ce2)"
            trend="up" change={`${counts.active_users}`} changeText="active" />
        </Col>
        <Col xl={2} md={4} xs={6}>
          <KpiCard label="Total Paid" value={<>₹<AnimatedNumber value={Math.round(counts.total_paid / 1000)} suffix="K" /></>}
            iconClass="ri-money-rupee-circle-line" gradient="linear-gradient(135deg,#0ab39c,#02c8a7)"
            trend="up" change={`${counts.success_payments}`} changeText="payments" />
        </Col>
        <Col xl={2} md={4} xs={6}>
          <KpiCard label="Payments" value={<AnimatedNumber value={counts.total_payments} />}
            iconClass="ri-bank-card-line" gradient="linear-gradient(135deg,#405189,#6691e7)"
            trend={successRate > 80 ? 'up' : 'down'} change={`${successRate}%`} changeText="success rate" />
        </Col>
        <Col xl={2} md={4} xs={6}>
          <KpiCard label="Pending" value={<AnimatedNumber value={counts.pending_payments} />}
            iconClass="ri-time-line" gradient="linear-gradient(135deg,#f7b84b,#f1963b)"
            changeText="awaiting" />
        </Col>
        <Col xl={2} md={4} xs={6}>
          <KpiCard label="Plan Days" value={<AnimatedNumber value={plan.days_remaining ?? 0} />}
            iconClass="ri-calendar-line"
            gradient={plan.days_remaining !== null && plan.days_remaining <= 7
              ? 'linear-gradient(135deg,#f06548,#f4907b)'
              : 'linear-gradient(135deg,#0ab39c,#02c8a7)'}
            changeText={plan.status === 'expired' ? 'expired' : 'remaining'} />
        </Col>
      </Row>

      {/* Payment History + Success Ring */}
      <Row className="g-3 mb-3">
        <Col xl={8}>
          <Card style={cardStyle}>
            <div style={cardHeaderStyle}>
              <div>
                <h5 style={{ fontWeight: 700, fontSize: 15, color: 'var(--vz-heading-color, var(--vz-body-color))', margin: 0 }}>Payment History</h5>
                <p style={{ margin: 0, fontSize: 11, color: 'var(--vz-secondary-color)', marginTop: 2 }}>Monthly payment trend</p>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 18, fontWeight: 800, color: '#0ab39c' }}>₹{counts.total_paid.toLocaleString()}</div>
                <div style={{ fontSize: 10, color: 'var(--vz-secondary-color)', fontWeight: 600 }}>TOTAL PAID</div>
              </div>
            </div>
            <CardBody style={{ padding: '12px 16px 8px' }}>
              <ResponsiveContainer width="100%" height={260}>
                <AreaChart data={payment_trend} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="clientRevGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#0ab39c" stopOpacity={0.25} />
                      <stop offset="100%" stopColor="#0ab39c" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f3f8" vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#a0aec0', fontWeight: 600 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: '#a0aec0' }} axisLine={false} tickLine={false} width={55} tickFormatter={v => `₹${(v / 1000).toFixed(0)}K`} />
                  <Tooltip content={<ChartTooltip prefix="₹" />} />
                  <Area type="monotone" dataKey="amount" stroke="#0ab39c" strokeWidth={2.5} fill="url(#clientRevGrad)" dot={{ r: 4, fill: '#0ab39c', strokeWidth: 2, stroke: '#fff' }} activeDot={{ r: 6, fill: '#0ab39c' }} />
                </AreaChart>
              </ResponsiveContainer>
            </CardBody>
          </Card>
        </Col>
        <Col xl={4}>
          <Card style={{ ...cardStyle, height: '100%' }}>
            <div style={cardHeaderStyle}>
              <div>
                <h5 style={{ fontWeight: 700, fontSize: 15, color: 'var(--vz-heading-color, var(--vz-body-color))', margin: 0 }}>Payment Success</h5>
                <p style={{ margin: 0, fontSize: 11, color: 'var(--vz-secondary-color)', marginTop: 2 }}>Transaction health</p>
              </div>
            </div>
            <CardBody className="text-center py-4">
              <SuccessRing percent={successRate} />
              <p className="mt-3 mb-1" style={{ fontSize: 13, fontWeight: 700, color: 'var(--vz-heading-color, var(--vz-body-color))' }}>
                {successRate >= 80 ? 'Healthy' : successRate >= 50 ? 'Moderate' : 'Needs attention'}
              </p>
              <p style={{ fontSize: 11, color: 'var(--vz-secondary-color)', margin: 0, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {counts.success_payments} of {counts.total_payments}
              </p>
            </CardBody>
          </Card>
        </Col>
      </Row>

      {/* Branches + Recent Payments */}
      <Row className="g-3 mb-3">
        <Col xl={6}>
          <Card style={cardStyle}>
            <div style={cardHeaderStyle}>
              <div>
                <h5 style={{ fontWeight: 700, fontSize: 15, color: 'var(--vz-heading-color, var(--vz-body-color))', margin: 0 }}>Branches</h5>
                <p style={{ margin: 0, fontSize: 11, color: 'var(--vz-secondary-color)', marginTop: 2 }}>{branches.length} total</p>
              </div>
            </div>
            <CardBody style={{ padding: 0 }}>
              {branches.map((b: any, i: number) => (
                <div key={b.id} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '12px 20px', borderBottom: i < branches.length - 1 ? '1px solid #f8f9fa' : 'none',
                  transition: 'background 0.15s',
                }}
                  onMouseEnter={e => (e.currentTarget.style.background = '#f8faff')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{
                      width: 38, height: 38, borderRadius: 11, display: 'flex', alignItems: 'center', justifyContent: 'center',
                      background: b.is_main
                        ? 'linear-gradient(135deg,#f7b84b,#f1963b)'
                        : 'linear-gradient(135deg,#299cdb,#50c3e6)',
                      color: '#fff', fontWeight: 800, fontSize: 12, flexShrink: 0,
                    }}>
                      {b.code?.substring(0, 2).toUpperCase() || b.name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--vz-heading-color, var(--vz-body-color))', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        {b.name}
                        {b.is_main && <i className="ri-star-fill" style={{ color: '#f7b84b', fontSize: 12 }}></i>}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--vz-secondary-color)', marginTop: 1 }}>
                        {[b.city, b.state].filter(Boolean).join(', ') || 'No location'}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 11, color: 'var(--vz-secondary-color)', fontWeight: 600 }}>{b.users_count} users</span>
                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 20, textTransform: 'uppercase', letterSpacing: '0.04em',
                      background: b.status === 'active' ? '#0ab39c18' : '#f0654818',
                      color: b.status === 'active' ? '#0ab39c' : '#f06548',
                    }}>{b.status}</span>
                  </div>
                </div>
              ))}
              {branches.length === 0 && <div className="text-center text-muted py-4">No branches yet</div>}
            </CardBody>
          </Card>
        </Col>

        <Col xl={6}>
          <Card style={cardStyle}>
            <div style={cardHeaderStyle}>
              <div>
                <h5 style={{ fontWeight: 700, fontSize: 15, color: 'var(--vz-heading-color, var(--vz-body-color))', margin: 0 }}>Recent Payments</h5>
                <p style={{ margin: 0, fontSize: 11, color: 'var(--vz-secondary-color)', marginTop: 2 }}>Latest transactions</p>
              </div>
            </div>
            <CardBody style={{ padding: 0 }}>
              {recent_payments.map((p: any, i: number) => {
                const cfg = p.status === 'success'
                  ? { color: '#0ab39c', icon: 'ri-checkbox-circle-fill', bg: '#0ab39c18' }
                  : p.status === 'failed'
                  ? { color: '#f06548', icon: 'ri-close-circle-fill', bg: '#f0654818' }
                  : { color: '#f7b84b', icon: 'ri-time-fill', bg: '#f7b84b18' };
                return (
                  <div key={p.id} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '12px 20px', borderBottom: i < recent_payments.length - 1 ? '1px solid #f8f9fa' : 'none',
                    transition: 'background 0.15s',
                  }}
                    onMouseEnter={e => (e.currentTarget.style.background = '#f8faff')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  >
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

      {/* Team Roles */}
      <Row className="g-3">
        <Col xs={12}>
          <Card style={cardStyle}>
            <div style={cardHeaderStyle}>
              <div>
                <h5 style={{ fontWeight: 700, fontSize: 15, color: 'var(--vz-heading-color, var(--vz-body-color))', margin: 0 }}>Team Roles</h5>
                <p style={{ margin: 0, fontSize: 11, color: 'var(--vz-secondary-color)', marginTop: 2 }}>Staff breakdown by role</p>
              </div>
            </div>
            <CardBody style={{ padding: '16px 20px' }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                {Object.entries(user_roles).map(([role, count], i) => (
                  <div key={role} style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    background: COLORS[i % COLORS.length] + '12',
                    borderRadius: 10, padding: '8px 14px', border: `1px solid ${COLORS[i % COLORS.length]}30`,
                  }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: COLORS[i % COLORS.length], flexShrink: 0 }} />
                    <span style={{ fontSize: 12, color: '#495057', textTransform: 'capitalize', fontWeight: 600 }}>
                      {role.replace(/_/g, ' ')}
                    </span>
                    <span style={{ fontSize: 14, fontWeight: 800, color: COLORS[i % COLORS.length] }}>{count as number}</span>
                  </div>
                ))}
              </div>
            </CardBody>
          </Card>
        </Col>
      </Row>
    </>
  );
}

function SuccessRing({ percent }: { percent: number }) {
  const size = 130;
  const strokeWidth = 12;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percent / 100) * circumference;
  const color = percent >= 80 ? '#0ab39c' : percent >= 50 ? '#f7b84b' : '#f06548';
  return (
    <div className="position-relative d-inline-block" style={{ width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#f0f3f8" strokeWidth={strokeWidth} />
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={color} strokeWidth={strokeWidth}
          strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 1s ease-out' }} />
      </svg>
      <div className="position-absolute top-50 start-50 translate-middle">
        <h3 className="fw-bold mb-0" style={{ color, fontSize: 26, fontWeight: 800 }}>{percent}%</h3>
      </div>
    </div>
  );
}
