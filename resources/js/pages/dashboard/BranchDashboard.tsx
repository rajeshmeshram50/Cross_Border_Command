import { useState, useEffect } from 'react';
import { Card, CardBody, Col, Row } from 'reactstrap';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import api from '../../api';
import { useAuth } from '../../contexts/AuthContext';
import { useBranchSwitcher } from '../../contexts/BranchSwitcherContext';
import { ShimmerDashboard } from '../../components/ui/Shimmer';

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

export default function BranchDashboard() {
  const { user } = useAuth();
  const { isMainBranchUser, selectedBranchId, selectedBranch } = useBranchSwitcher();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.get('/dashboard/client-stats', {
      params: selectedBranchId ? { branch_id: selectedBranchId } : {},
    })
      .then(res => setData(res.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [selectedBranchId]);

  if (loading) return <ShimmerDashboard />;
  if (!data) return null;

  const { counts, plan, branches: allBranches, recent_payments, payment_trend } = data;
  const branches = isMainBranchUser && !selectedBranchId
    ? allBranches
    : allBranches.filter((b: any) => b.id === (selectedBranchId || user?.branch_id));

  const displayName = selectedBranch?.name || (isMainBranchUser ? user?.client_name : user?.branch_name);
  const branchUsers = branches.reduce((s: number, b: any) => s + (b.users_count ?? 0), 0);
  const successRate = counts.total_payments > 0
    ? Math.round((counts.success_payments / counts.total_payments) * 100) : 0;

  return (
    <>
      <style>{`
        .dashboard-kpi-card { background: #ffffff; }
        [data-bs-theme="dark"] .dashboard-kpi-card { background: #1c2531; }
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

      {/* KPI Cards */}
      <Row className="g-3 mb-3">
        <Col md={3} xs={6}>
          <KpiCard label="Branches" value={<AnimatedNumber value={branches.length} />}
            iconClass="ri-git-branch-line" gradient="linear-gradient(135deg,#299cdb,#50c3e6)"
            changeText="visible" />
        </Col>
        <Col md={3} xs={6}>
          <KpiCard label="Users" value={<AnimatedNumber value={branchUsers} />}
            iconClass="ri-user-3-line" gradient="linear-gradient(135deg,#9b72cf,#865ce2)"
            changeText="branch staff" />
        </Col>
        <Col md={3} xs={6}>
          <KpiCard label="Total Paid" value={<>₹<AnimatedNumber value={Math.round(counts.total_paid / 1000)} suffix="K" /></>}
            iconClass="ri-money-rupee-circle-line" gradient="linear-gradient(135deg,#0ab39c,#02c8a7)"
            trend="up" change={`${counts.success_payments}`} changeText="payments" />
        </Col>
        <Col md={3} xs={6}>
          <KpiCard label="Payments" value={<AnimatedNumber value={counts.total_payments} />}
            iconClass="ri-bank-card-line" gradient="linear-gradient(135deg,#405189,#6691e7)"
            trend={successRate > 80 ? 'up' : 'down'} change={`${successRate}%`} changeText="success rate" />
        </Col>
      </Row>

      {/* Payment Trend */}
      <Row className="g-3 mb-3">
        <Col xs={12}>
          <Card style={cardStyle}>
            <div style={cardHeaderStyle}>
              <div>
                <h5 style={{ fontWeight: 700, fontSize: 15, color: 'var(--vz-heading-color, var(--vz-body-color))', margin: 0 }}>Payment Trend</h5>
                <p style={{ margin: 0, fontSize: 11, color: 'var(--vz-secondary-color)', marginTop: 2 }}>Monthly cash flow</p>
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

      {/* Branches + Recent Payments */}
      <Row className="g-3">
        <Col xl={6}>
          <Card style={cardStyle}>
            <div style={cardHeaderStyle}>
              <div>
                <h5 style={{ fontWeight: 700, fontSize: 15, color: 'var(--vz-heading-color, var(--vz-body-color))', margin: 0 }}>Branches</h5>
                <p style={{ margin: 0, fontSize: 11, color: 'var(--vz-secondary-color)', marginTop: 2 }}>{branches.length} accessible</p>
              </div>
            </div>
            <CardBody style={{ padding: 0 }}>
              {branches.map((b: any) => (
                <div key={b.id} className="bd-list-row" style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '12px 20px',
                }}>
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
                        {b.users_count} users
                      </div>
                    </div>
                  </div>
                  <span style={{
                    fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 20, textTransform: 'uppercase', letterSpacing: '0.04em',
                    background: b.status === 'active' ? '#0ab39c18' : '#f0654818',
                    color: b.status === 'active' ? '#0ab39c' : '#f06548',
                  }}>{b.status}</span>
                </div>
              ))}
              {branches.length === 0 && <div className="text-center text-muted py-4">No branches</div>}
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
    </>
  );
}
