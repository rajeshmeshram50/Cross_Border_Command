import { useState, useEffect } from 'react';
import { Card, CardBody, Col, Row, Badge } from 'reactstrap';
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import api from '../../api';
import { ShimmerDashboard } from '../../components/ui/Shimmer';

interface DashboardData {
  counts: {
    total_clients: number; active_clients: number; inactive_clients: number;
    total_users: number; total_branches: number; total_payments: number;
    success_payments: number; pending_payments: number; failed_payments: number;
  };
  revenue: { total: number; monthly: number };
  plan_breakdown: { plan_name: string; count: number }[];
  revenue_trend: { month: string; short: string; revenue: number; count: number }[];
  client_growth: { month: string; clients: number }[];
  user_types: Record<string, number>;
  org_types: { org_type: string; count: number }[];
  recent_clients: any[];
  recent_payments: any[];
  top_clients: any[];
}

const COLORS = ['#405189', '#0ab39c', '#f7b84b', '#f06548', '#299cdb', '#9b72cf', '#6691e7'];

const methodLabels: Record<string, string> = {
  upi: 'UPI', credit_card: 'Credit Card', debit_card: 'Debit Card',
  net_banking: 'Net Banking', wallet: 'Wallet', cash: 'Cash', card: 'Card',
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
  color: string;
  gradient: string;
  changeText?: string;
  trend?: 'up' | 'down' | 'neutral';
  change?: string;
}

function KpiCard({ label, value, iconClass, color, gradient, changeText, trend = 'neutral', change }: KpiProps) {
  const trendColor = trend === 'up' ? '#0ab39c' : trend === 'down' ? '#f06548' : '#878a99';
  const arrow = trend === 'up' ? 'ri-arrow-up-line' : trend === 'down' ? 'ri-arrow-down-line' : 'ri-subtract-line';
  return (
    <div className="dashboard-surface" style={{
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
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, background: trendColor + '18', color: trendColor, borderRadius: 6, padding: '2px 7px', fontSize: 11, fontWeight: 700 }}>
                <i className={arrow} style={{ fontSize: 11 }}></i> {change}
              </span>
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

export default function AdminDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/dashboard/admin-stats').then(res => setData(res.data))
      .catch(() => {}).finally(() => setLoading(false));
  }, []);

  if (loading) return <ShimmerDashboard />;
  if (!data) return null;

  const { counts, revenue } = data;
  const successRate = counts.total_payments > 0
    ? Math.round((counts.success_payments / counts.total_payments) * 100) : 0;
  const activeRate = counts.total_clients > 0
    ? Math.round((counts.active_clients / counts.total_clients) * 100) : 0;

  return (
    <>
      <style>{`
        /* Force white card surface in light theme; auto-flip in dark theme */
        .dashboard-surface { background: #ffffff; }
        [data-bs-theme="dark"] .dashboard-surface { background: #1c2531; }
        .ad-list-row {
          transition: background 0.18s ease, box-shadow 0.18s ease;
          cursor: pointer;
          position: relative;
        }
        .ad-list-row:hover {
          background: rgba(124, 92, 252, 0.08);
          box-shadow: inset 3px 0 0 0 rgba(124, 92, 252, 0.7);
        }
        [data-bs-theme="dark"] .ad-list-row:hover,
        [data-layout-mode="dark"] .ad-list-row:hover {
          background: rgba(255, 255, 255, 0.05);
          box-shadow: inset 3px 0 0 0 rgba(124, 92, 252, 0.9);
        }
        .ad-list-row + .ad-list-row { border-top: 1px solid #f1f3f9; }
        [data-bs-theme="dark"] .ad-list-row + .ad-list-row,
        [data-layout-mode="dark"] .ad-list-row + .ad-list-row { border-top-color: rgba(255,255,255,0.06); }
      `}</style>
      {/* Page Title */}
      <Row className="mb-2">
        <Col xs={12}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 0 12px' }}>
            <div>
              <h4 style={{ fontWeight: 800, fontSize: 20, color: 'var(--vz-heading-color, var(--vz-body-color))', margin: 0 }}>Dashboard</h4>
              <p style={{ margin: 0, fontSize: 12, color: 'var(--vz-secondary-color)', marginTop: 2 }}>Welcome back! Here's what's happening today.</p>
            </div>
            <ol className="breadcrumb m-0" style={{ fontSize: 12 }}>
              <li className="breadcrumb-item"><a href="#" style={{ color: '#405189' }}>Velzon</a></li>
              <li className="breadcrumb-item active">Dashboard</li>
            </ol>
          </div>
        </Col>
      </Row>

      {/* KPI Cards */}
      <Row className="g-3 mb-3">
        <Col xl={2} md={4} xs={6}>
          <KpiCard label="Total Clients" value={<AnimatedNumber value={counts.total_clients} />}
            iconClass="ri-building-line" color="#405189" gradient="linear-gradient(135deg,#405189,#6691e7)"
            trend="up" change="+12%" changeText="vs last month" />
        </Col>
        <Col xl={2} md={4} xs={6}>
          <KpiCard label="Active Clients" value={<AnimatedNumber value={counts.active_clients} />}
            iconClass="ri-checkbox-circle-line" color="#0ab39c" gradient="linear-gradient(135deg,#0ab39c,#02c8a7)"
            trend="up" change={`${activeRate}%`} changeText="active rate" />
        </Col>
        <Col xl={2} md={4} xs={6}>
          <KpiCard label="Total Users" value={<AnimatedNumber value={counts.total_users} />}
            iconClass="ri-user-3-line" color="#299cdb" gradient="linear-gradient(135deg,#299cdb,#50c3e6)"
            trend="up" change="+8%" changeText="vs last month" />
        </Col>
        <Col xl={2} md={4} xs={6}>
          <KpiCard label="Branches" value={<AnimatedNumber value={counts.total_branches} />}
            iconClass="ri-git-branch-line" color="#f7b84b" gradient="linear-gradient(135deg,#f7b84b,#f1963b)"
            trend="up" change="+5%" changeText="vs last month" />
        </Col>
        <Col xl={2} md={4} xs={6}>
          <KpiCard label="Revenue" value={<>₹<AnimatedNumber value={Math.round(revenue.total / 1000)} suffix="K" /></>}
            iconClass="ri-money-rupee-circle-line" color="#0ab39c" gradient="linear-gradient(135deg,#0ab39c,#405189)"
            trend="up" change="+24%" changeText="vs last period" />
        </Col>
        <Col xl={2} md={4} xs={6}>
          <KpiCard label="Payments" value={<AnimatedNumber value={counts.total_payments} />}
            iconClass="ri-bank-card-line" color="#9b72cf" gradient="linear-gradient(135deg,#9b72cf,#865ce2)"
            trend={successRate > 80 ? 'up' : 'down'} change={`${successRate}%`} changeText="success rate" />
        </Col>
      </Row>

      {/* Revenue + Plan Distribution */}
      <Row className="g-3 mb-3">
        <Col xl={8}>
          <Card style={cardStyle}>
            <div style={cardHeaderStyle}>
              <div>
                <h5 style={{ fontWeight: 700, fontSize: 15, color: 'var(--vz-heading-color, var(--vz-body-color))', margin: 0 }}>Revenue Analytics</h5>
                <p style={{ margin: 0, fontSize: 11, color: 'var(--vz-secondary-color)', marginTop: 2 }}>Monthly revenue performance</p>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 18, fontWeight: 800, color: '#0ab39c' }}>₹{revenue.total.toLocaleString()}</div>
                  <div style={{ fontSize: 10, color: 'var(--vz-secondary-color)', fontWeight: 600 }}>TOTAL REVENUE</div>
                </div>
                <button type="button" style={{
                  background: 'linear-gradient(135deg,#405189,#6691e7)', color: '#fff', border: 'none',
                  borderRadius: 8, padding: '6px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                }}>
                  <i className="ri-file-list-3-line me-1"></i>Report
                </button>
              </div>
            </div>
            <CardBody style={{ padding: '12px 16px 8px' }}>
              {/* Mini stats strip */}
              <div style={{ display: 'flex', gap: 24, marginBottom: 16, paddingBottom: 12, borderBottom: '1px solid var(--vz-border-color)' }}>
                <div>
                  <div style={{ fontSize: 10, color: 'var(--vz-secondary-color)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Monthly</div>
                  <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--vz-heading-color, var(--vz-body-color))' }}>₹{revenue.monthly.toLocaleString()}</div>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: 'var(--vz-secondary-color)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Transactions</div>
                  <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--vz-heading-color, var(--vz-body-color))' }}>{counts.total_payments}</div>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: 'var(--vz-secondary-color)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Success Rate</div>
                  <div style={{ fontSize: 15, fontWeight: 800, color: '#0ab39c' }}>{successRate}%</div>
                </div>
              </div>
              <ResponsiveContainer width="100%" height={240}>
                <AreaChart data={data.revenue_trend} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="adminRevGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#405189" stopOpacity={0.25} />
                      <stop offset="100%" stopColor="#405189" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f3f8" vertical={false} />
                  <XAxis dataKey="short" tick={{ fontSize: 11, fill: '#a0aec0', fontWeight: 600 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: '#a0aec0' }} axisLine={false} tickLine={false} width={55} tickFormatter={v => `₹${(v / 1000).toFixed(0)}K`} />
                  <Tooltip content={<ChartTooltip prefix="₹" />} cursor={{ stroke: 'rgba(124,92,252,0.35)', strokeWidth: 1, strokeDasharray: '3 3' }} />
                  <Area type="monotone" dataKey="revenue" stroke="#405189" strokeWidth={2.5} fill="url(#adminRevGrad)" dot={{ r: 4, fill: '#405189', strokeWidth: 2, stroke: '#fff' }} activeDot={{ r: 6, fill: '#405189' }} />
                </AreaChart>
              </ResponsiveContainer>
            </CardBody>
          </Card>
        </Col>

        <Col xl={4}>
          <Card style={{ ...cardStyle, height: '100%' }}>
            <div style={cardHeaderStyle}>
              <div>
                <h5 style={{ fontWeight: 700, fontSize: 15, color: 'var(--vz-heading-color, var(--vz-body-color))', margin: 0 }}>Plan Distribution</h5>
                <p style={{ margin: 0, fontSize: 11, color: 'var(--vz-secondary-color)', marginTop: 2 }}>Clients by plan type</p>
              </div>
            </div>
            <CardBody style={{ padding: '8px 16px 16px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={data.plan_breakdown} dataKey="count" nameKey="plan_name" cx="50%" cy="45%" innerRadius={52} outerRadius={82} paddingAngle={4}>
                    {data.plan_breakdown.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip content={<ChartTooltip />} />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: '11px', fontWeight: 600, paddingTop: 8 }} />
                </PieChart>
              </ResponsiveContainer>
              <div style={{ textAlign: 'center', marginTop: 4 }}>
                <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--vz-heading-color, var(--vz-body-color))' }}>{counts.total_clients}</div>
                <div style={{ fontSize: 11, color: 'var(--vz-secondary-color)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Total Clients</div>
              </div>
            </CardBody>
          </Card>
        </Col>
      </Row>

      {/* Growth / Org Types / Payment Health */}
      <Row className="g-3 mb-3">
        <Col xl={4} md={6}>
          <Card style={cardStyle}>
            <div style={cardHeaderStyle}>
              <div>
                <h5 style={{ fontWeight: 700, fontSize: 15, color: 'var(--vz-heading-color, var(--vz-body-color))', margin: 0 }}>Client Growth</h5>
                <p style={{ margin: 0, fontSize: 11, color: 'var(--vz-secondary-color)', marginTop: 2 }}>New clients per month</p>
              </div>
            </div>
            <CardBody style={{ padding: '12px 16px' }}>
              <ResponsiveContainer width="100%" height={210}>
                <BarChart data={data.client_growth} barCategoryGap="30%">
                  <defs>
                    <linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#405189" stopOpacity={1} />
                      <stop offset="100%" stopColor="#6691e7" stopOpacity={0.8} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f3f8" vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#a0aec0', fontWeight: 600 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: '#a0aec0' }} axisLine={false} tickLine={false} allowDecimals={false} width={24} />
                  <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(124,92,252,0.08)', radius: 6 }} />
                  <Bar dataKey="clients" fill="url(#barGrad)" radius={[6, 6, 0, 0]} barSize={22} />
                </BarChart>
              </ResponsiveContainer>
            </CardBody>
          </Card>
        </Col>

        <Col xl={4} md={6}>
          <Card style={cardStyle}>
            <div style={cardHeaderStyle}>
              <div>
                <h5 style={{ fontWeight: 700, fontSize: 15, color: 'var(--vz-heading-color, var(--vz-body-color))', margin: 0 }}>Organization Types</h5>
                <p style={{ margin: 0, fontSize: 11, color: 'var(--vz-secondary-color)', marginTop: 2 }}>Client breakdown by type</p>
              </div>
            </div>
            <CardBody style={{ padding: '16px 20px' }}>
              {data.org_types.map((o, i) => {
                const pct = counts.total_clients > 0 ? (o.count / counts.total_clients) * 100 : 0;
                return (
                  <div key={o.org_type} style={{ marginBottom: 20 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{
                          width: 32, height: 32, borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center',
                          background: `linear-gradient(135deg,${COLORS[i % COLORS.length]},${COLORS[(i + 1) % COLORS.length]})`,
                          color: '#fff', fontWeight: 800, fontSize: 12,
                        }}>
                          {o.org_type.charAt(0)}
                        </div>
                        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--vz-heading-color, var(--vz-body-color))' }}>{o.org_type}</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 12, color: 'var(--vz-secondary-color)', fontWeight: 600 }}>{pct.toFixed(0)}%</span>
                        <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--vz-heading-color, var(--vz-body-color))' }}>{o.count}</span>
                      </div>
                    </div>
                    <div style={{ height: 6, borderRadius: 999, background: 'var(--vz-border-color)', overflow: 'hidden' }}>
                      <div style={{
                        height: '100%', borderRadius: 999, width: `${Math.max(pct, 6)}%`,
                        background: `linear-gradient(90deg,${COLORS[i % COLORS.length]},${COLORS[(i + 1) % COLORS.length]})`,
                        transition: 'width 0.8s ease',
                      }} />
                    </div>
                  </div>
                );
              })}
            </CardBody>
          </Card>
        </Col>

        <Col xl={4} md={12}>
          <Card style={cardStyle}>
            <div style={cardHeaderStyle}>
              <div>
                <h5 style={{ fontWeight: 700, fontSize: 15, color: 'var(--vz-heading-color, var(--vz-body-color))', margin: 0 }}>Payment Health</h5>
                <p style={{ margin: 0, fontSize: 11, color: 'var(--vz-secondary-color)', marginTop: 2 }}>Transaction status overview</p>
              </div>
            </div>
            <CardBody style={{ padding: '16px 20px' }}>
              <HealthRow label="Success" value={counts.success_payments} total={counts.total_payments} color="#0ab39c" iconClass="ri-checkbox-circle-line" />
              <HealthRow label="Pending" value={counts.pending_payments} total={counts.total_payments} color="#f7b84b" iconClass="ri-time-line" />
              <HealthRow label="Failed" value={counts.failed_payments} total={counts.total_payments} color="#f06548" iconClass="ri-close-circle-line" />

              <div style={{ height: 1, background: 'var(--vz-border-color)', margin: '16px 0' }} />

              <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--vz-secondary-color)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>User Roles</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {Object.entries(data.user_types).map(([type, count], i) => (
                  <div key={type} style={{
                    display: 'flex', alignItems: 'center', gap: 8, background: COLORS[i % COLORS.length] + '12',
                    borderRadius: 10, padding: '6px 12px', border: `1px solid ${COLORS[i % COLORS.length]}30`,
                  }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: COLORS[i % COLORS.length], flexShrink: 0 }} />
                    <span style={{ fontSize: 11, color: '#495057', textTransform: 'capitalize', fontWeight: 600 }}>
                      {type.replace(/_/g, ' ')}
                    </span>
                    <span style={{ fontSize: 13, fontWeight: 800, color: COLORS[i % COLORS.length] }}>{count as number}</span>
                  </div>
                ))}
              </div>
            </CardBody>
          </Card>
        </Col>
      </Row>

      {/* Recent Clients + Payments */}
      <Row className="g-3 mb-3">
        <Col xl={6}>
          <Card style={cardStyle}>
            <div style={cardHeaderStyle}>
              <div>
                <h5 style={{ fontWeight: 700, fontSize: 15, color: 'var(--vz-heading-color, var(--vz-body-color))', margin: 0 }}>Recent Clients</h5>
                <p style={{ margin: 0, fontSize: 11, color: 'var(--vz-secondary-color)', marginTop: 2 }}>Latest registered clients</p>
              </div>
              <button style={{
                background: 'transparent', border: '1.5px solid #e2e8f0', borderRadius: 8, padding: '5px 14px',
                fontSize: 12, fontWeight: 600, color: '#405189', cursor: 'pointer',
              }}>View All</button>
            </div>
            <CardBody style={{ padding: 0 }}>
              {data.recent_clients.map((c: any, i: number) => (
                <div key={c.id} className="ad-list-row" style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '12px 20px',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{
                      width: 38, height: 38, borderRadius: 11, display: 'flex', alignItems: 'center', justifyContent: 'center',
                      background: `linear-gradient(135deg,${COLORS[i % COLORS.length]},${COLORS[(i + 2) % COLORS.length]})`,
                      color: '#fff', fontWeight: 800, fontSize: 13, flexShrink: 0,
                    }}>
                      {c.org_name.charAt(0)}{c.org_name.split(' ')[1]?.charAt(0) || ''}
                    </div>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--vz-heading-color, var(--vz-body-color))' }}>{c.org_name}</div>
                      <div style={{ fontSize: 11, color: 'var(--vz-secondary-color)', marginTop: 1 }}>{c.email}</div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 20, textTransform: 'uppercase', letterSpacing: '0.04em',
                      background: c.status === 'active' ? '#0ab39c18' : '#f0654818',
                      color: c.status === 'active' ? '#0ab39c' : '#f06548',
                    }}>{c.status}</span>
                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 20,
                      background: '#40518912', color: '#405189',
                    }}>{c.plan?.name || 'Free'}</span>
                  </div>
                </div>
              ))}
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
              <button style={{
                background: 'transparent', border: '1.5px solid #e2e8f0', borderRadius: 8, padding: '5px 14px',
                fontSize: 12, fontWeight: 600, color: '#405189', cursor: 'pointer',
              }}>View All</button>
            </div>
            <CardBody style={{ padding: 0 }}>
              {data.recent_payments.map((p: any) => {
                const cfg = p.status === 'success'
                  ? { color: '#0ab39c', icon: 'ri-checkbox-circle-fill', bg: '#0ab39c18' }
                  : p.status === 'failed'
                  ? { color: '#f06548', icon: 'ri-close-circle-fill', bg: '#f0654818' }
                  : { color: '#f7b84b', icon: 'ri-time-fill', bg: '#f7b84b18' };
                return (
                  <div key={p.id} className="ad-list-row" style={{
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
                        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--vz-heading-color, var(--vz-body-color))' }}>{p.client?.org_name || 'Unknown'}</div>
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
            </CardBody>
          </Card>
        </Col>
      </Row>
    </>
  );
}

function HealthRow({ label, value, total, color, iconClass }: { label: string; value: number; total: number; color: string; iconClass: string }) {
  const pct = total > 0 ? (value / total) * 100 : 0;
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 30, height: 30, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: color + '18', color, fontSize: 14,
          }}>
            <i className={iconClass}></i>
          </div>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--vz-heading-color, var(--vz-body-color))' }}>{label}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, color: 'var(--vz-secondary-color)', fontWeight: 600 }}>{pct.toFixed(0)}%</span>
          <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--vz-heading-color, var(--vz-body-color))' }}>{value}</span>
        </div>
      </div>
      <div style={{ height: 6, borderRadius: 999, background: 'var(--vz-border-color)', overflow: 'hidden' }}>
        <div style={{
          height: '100%', borderRadius: 999, width: `${pct}%`, background: color,
          transition: 'width 0.8s ease',
        }} />
      </div>
    </div>
  );
}
