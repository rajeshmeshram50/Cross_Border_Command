import { useState, useEffect } from 'react';
import { Card, CardBody, CardHeader, Col, Row, Badge } from 'reactstrap';
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
    <div className="bg-white border rounded px-3 py-2 shadow-sm" style={{ fontSize: 11 }}>
      <div className="fw-bold text-dark mb-1">{label}</div>
      {payload.map((p: any, i: number) => (
        <div key={i} className="text-muted fw-semibold">
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
  iconBg: string;
  changeText?: string;
  trend?: 'up' | 'down' | 'neutral';
  change?: string;
}

function KpiCard({ label, value, iconClass, iconBg, changeText, trend = 'neutral', change }: KpiProps) {
  const trendColor = trend === 'up' ? 'text-success' : trend === 'down' ? 'text-danger' : 'text-muted';
  const arrow = trend === 'up' ? 'ri-arrow-right-up-line' : trend === 'down' ? 'ri-arrow-right-down-line' : 'ri-arrow-right-line';
  return (
    <Card className="card-animate">
      <CardBody>
        <div className="d-flex align-items-center">
          <div className="flex-grow-1">
            <p className="text-uppercase fw-semibold fs-12 text-muted mb-0">{label}</p>
          </div>
        </div>
        <div className="d-flex align-items-end justify-content-between mt-4">
          <div>
            <h4 className="fs-22 fw-semibold ff-secondary mb-0"><span className="counter-value">{value}</span></h4>
            {(change || changeText) && (
              <p className="mb-0 text-muted mt-2">
                {change && <span className={`badge bg-light ${trendColor} mb-0 me-1`}><i className={`${arrow} align-middle`}></i> {change}</span>}
                {changeText && <span className="fs-12">{changeText}</span>}
              </p>
            )}
          </div>
          <div className="avatar-sm flex-shrink-0">
            <span className="avatar-title rounded fs-3" style={{ backgroundColor: iconBg + '29', color: iconBg }}>
              <i className={iconClass}></i>
            </span>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}

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
      {/* Page title */}
      <Row>
        <Col xs={12}>
          <div className="page-title-box d-sm-flex align-items-center justify-content-between">
            <h4 className="mb-sm-0">Dashboard</h4>
            <div className="page-title-right">
              <ol className="breadcrumb m-0">
                <li className="breadcrumb-item"><a href="#">Velzon</a></li>
                <li className="breadcrumb-item active">Dashboard</li>
              </ol>
            </div>
          </div>
        </Col>
      </Row>

      {/* KPI row */}
      <Row>
        <Col xl={2} md={4}>
          <KpiCard label="Total Clients" value={<AnimatedNumber value={counts.total_clients} />}
            iconClass="ri-building-line" iconBg="#405189" trend="up" change="+12%" changeText="vs last month" />
        </Col>
        <Col xl={2} md={4}>
          <KpiCard label="Active Clients" value={<AnimatedNumber value={counts.active_clients} />}
            iconClass="ri-checkbox-circle-line" iconBg="#0ab39c" trend="up" change={`${activeRate}%`} changeText="active rate" />
        </Col>
        <Col xl={2} md={4}>
          <KpiCard label="Total Users" value={<AnimatedNumber value={counts.total_users} />}
            iconClass="ri-user-3-line" iconBg="#299cdb" trend="up" change="+8%" changeText="vs last month" />
        </Col>
        <Col xl={2} md={4}>
          <KpiCard label="Branches" value={<AnimatedNumber value={counts.total_branches} />}
            iconClass="ri-git-branch-line" iconBg="#f7b84b" trend="up" change="+5%" changeText="vs last month" />
        </Col>
        <Col xl={2} md={4}>
          <KpiCard label="Revenue" value={<>₹<AnimatedNumber value={Math.round(revenue.total / 1000)} suffix="K" /></>}
            iconClass="ri-money-rupee-circle-line" iconBg="#0ab39c" trend="up" change="+24%" changeText="vs last period" />
        </Col>
        <Col xl={2} md={4}>
          <KpiCard label="Payments" value={<AnimatedNumber value={counts.total_payments} />}
            iconClass="ri-bank-card-line" iconBg="#9b72cf" trend={successRate > 80 ? 'up' : 'down'}
            change={`${successRate}%`} changeText="success rate" />
        </Col>
      </Row>

      {/* Revenue Analytics + Plan Distribution */}
      <Row>
        <Col xl={8}>
          <Card>
            <CardHeader className="align-items-center d-flex">
              <h4 className="card-title mb-0 flex-grow-1">Revenue Analytics</h4>
              <div className="flex-shrink-0">
                <span className="text-success fw-semibold me-2">₹{revenue.total.toLocaleString()}</span>
                <button type="button" className="btn btn-soft-primary btn-sm"><i className="ri-file-list-3-line align-middle me-1"></i> Report</button>
              </div>
            </CardHeader>
            <CardBody>
              <ResponsiveContainer width="100%" height={300}>
                <AreaChart data={data.revenue_trend} margin={{ top: 5, right: 15, left: 5, bottom: 0 }}>
                  <defs>
                    <linearGradient id="adminRevGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#405189" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="#405189" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e9ebec" vertical={false} />
                  <XAxis dataKey="short" tick={{ fontSize: 11, fill: '#878a99' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: '#878a99' }} axisLine={false} tickLine={false} width={55} tickFormatter={v => `₹${(v / 1000).toFixed(0)}K`} />
                  <Tooltip content={<ChartTooltip prefix="₹" />} />
                  <Area type="monotone" dataKey="revenue" stroke="#405189" strokeWidth={2} fill="url(#adminRevGrad)" dot={{ r: 3, fill: '#405189' }} />
                </AreaChart>
              </ResponsiveContainer>
            </CardBody>
          </Card>
        </Col>
        <Col xl={4}>
          <Card>
            <CardHeader>
              <h4 className="card-title mb-0">Plan Distribution</h4>
            </CardHeader>
            <CardBody>
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie data={data.plan_breakdown} dataKey="count" nameKey="plan_name" cx="50%" cy="45%" innerRadius={55} outerRadius={90} paddingAngle={3}>
                    {data.plan_breakdown.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip content={<ChartTooltip />} />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: '11px', fontWeight: 500 }} />
                </PieChart>
              </ResponsiveContainer>
            </CardBody>
          </Card>
        </Col>
      </Row>

      {/* Growth / Org Types / User Roles */}
      <Row>
        <Col xl={4} md={6}>
          <Card>
            <CardHeader><h4 className="card-title mb-0">Client Growth</h4></CardHeader>
            <CardBody>
              <ResponsiveContainer width="100%" height={230}>
                <BarChart data={data.client_growth}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e9ebec" vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#878a99' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: '#878a99' }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar dataKey="clients" fill="#405189" radius={[4, 4, 0, 0]} barSize={26} />
                </BarChart>
              </ResponsiveContainer>
            </CardBody>
          </Card>
        </Col>

        <Col xl={4} md={6}>
          <Card>
            <CardHeader><h4 className="card-title mb-0">Organization Types</h4></CardHeader>
            <CardBody>
              {data.org_types.map((o, i) => {
                const pct = counts.total_clients > 0 ? (o.count / counts.total_clients) * 100 : 0;
                return (
                  <div key={o.org_type} className="mb-3">
                    <div className="d-flex justify-content-between align-items-center mb-1">
                      <div className="d-flex align-items-center gap-2">
                        <span className="avatar-xs rounded d-flex align-items-center justify-content-center text-white fw-bold" style={{ backgroundColor: COLORS[i % COLORS.length], fontSize: 10, width: 24, height: 24 }}>
                          {o.org_type.charAt(0)}
                        </span>
                        <span className="fs-13 fw-semibold">{o.org_type}</span>
                      </div>
                      <span className="fs-13 fw-bold">{o.count}</span>
                    </div>
                    <div className="progress" style={{ height: 5 }}>
                      <div className="progress-bar" role="progressbar" style={{ width: `${Math.max(pct, 6)}%`, backgroundColor: COLORS[i % COLORS.length] }} />
                    </div>
                  </div>
                );
              })}
            </CardBody>
          </Card>
        </Col>

        <Col xl={4} md={12}>
          <Card>
            <CardHeader><h4 className="card-title mb-0">Payment Health</h4></CardHeader>
            <CardBody>
              <HealthRow label="Success" value={counts.success_payments} total={counts.total_payments} color="#0ab39c" iconClass="ri-checkbox-circle-line" />
              <HealthRow label="Pending" value={counts.pending_payments} total={counts.total_payments} color="#f7b84b" iconClass="ri-time-line" />
              <HealthRow label="Failed"  value={counts.failed_payments}  total={counts.total_payments} color="#f06548" iconClass="ri-close-circle-line" />
              <hr className="my-3" />
              <p className="text-muted text-uppercase fs-12 fw-bold mb-2">User Roles</p>
              <div className="d-flex flex-wrap gap-2">
                {Object.entries(data.user_types).map(([type, count], i) => (
                  <div key={type} className="px-2 py-1 rounded d-flex align-items-center gap-2 border-start border-3" style={{ backgroundColor: '#f3f6f9', borderLeftColor: COLORS[i % COLORS.length] + ' !important' }}>
                    <span className="text-muted text-capitalize fs-11">{type.replace(/_/g, ' ')}</span>
                    <span className="fw-bold fs-12">{count as number}</span>
                  </div>
                ))}
              </div>
            </CardBody>
          </Card>
        </Col>
      </Row>

      {/* Recent Clients + Payments */}
      <Row>
        <Col xl={6}>
          <Card>
            <CardHeader className="align-items-center d-flex">
              <h4 className="card-title mb-0 flex-grow-1">Recent Clients</h4>
              <button className="btn btn-sm btn-soft-primary">View All</button>
            </CardHeader>
            <div className="table-responsive table-card">
              <table className="table align-middle table-borderless mb-0">
                <tbody>
                  {data.recent_clients.map((c: any, i: number) => (
                    <tr key={c.id}>
                      <td>
                        <div className="d-flex align-items-center gap-2">
                          <div className="flex-shrink-0">
                            <div className="avatar-xs rounded-circle d-flex align-items-center justify-content-center text-white fw-bold" style={{ backgroundColor: COLORS[i % COLORS.length], fontSize: 11 }}>
                              {c.org_name.charAt(0)}{c.org_name.split(' ')[1]?.charAt(0) || ''}
                            </div>
                          </div>
                          <div className="flex-grow-1">
                            <h6 className="mb-0 fs-14">{c.org_name}</h6>
                            <p className="mb-0 text-muted fs-12">{c.email}</p>
                          </div>
                        </div>
                      </td>
                      <td>
                        <Badge color={c.status === 'active' ? 'success' : 'danger'} pill className="text-uppercase">{c.status}</Badge>
                      </td>
                      <td><Badge color="primary-subtle" className="text-primary">{c.plan?.name || 'Free'}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </Col>

        <Col xl={6}>
          <Card>
            <CardHeader className="align-items-center d-flex">
              <h4 className="card-title mb-0 flex-grow-1">Recent Payments</h4>
              <button className="btn btn-sm btn-soft-primary">View All</button>
            </CardHeader>
            <div className="table-responsive table-card">
              <table className="table align-middle table-borderless mb-0">
                <tbody>
                  {data.recent_payments.map((p: any) => {
                    const cfg = p.status === 'success' ? { color: '#0ab39c', icon: 'ri-checkbox-circle-line' }
                      : p.status === 'failed' ? { color: '#f06548', icon: 'ri-close-circle-line' }
                      : { color: '#f7b84b', icon: 'ri-time-line' };
                    return (
                      <tr key={p.id}>
                        <td>
                          <div className="d-flex align-items-center gap-2">
                            <div className="avatar-xs rounded-circle d-flex align-items-center justify-content-center" style={{ backgroundColor: cfg.color + '20', color: cfg.color }}>
                              <i className={cfg.icon}></i>
                            </div>
                            <div>
                              <h6 className="mb-0 fs-14">{p.client?.org_name || 'Unknown'}</h6>
                              <p className="mb-0 text-muted fs-12">{p.invoice_number} · {methodLabels[p.method] || p.method}</p>
                            </div>
                          </div>
                        </td>
                        <td className="text-end">
                          <h6 className="mb-0 fs-14" style={{ color: cfg.color }}>₹{parseFloat(p.total).toLocaleString()}</h6>
                          <small className="text-muted">{new Date(p.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}</small>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </Col>
      </Row>
    </>
  );
}

function HealthRow({ label, value, total, color, iconClass }: { label: string; value: number; total: number; color: string; iconClass: string }) {
  const pct = total > 0 ? (value / total) * 100 : 0;
  return (
    <div className="mb-3">
      <div className="d-flex justify-content-between align-items-center mb-1">
        <div className="d-flex align-items-center gap-2">
          <span className="avatar-xs rounded d-flex align-items-center justify-content-center" style={{ backgroundColor: color + '20', color, width: 24, height: 24 }}>
            <i className={iconClass}></i>
          </span>
          <span className="fs-13 fw-semibold">{label}</span>
        </div>
        <span className="fs-13 fw-bold">{value}</span>
      </div>
      <div className="progress" style={{ height: 5 }}>
        <div className="progress-bar" role="progressbar" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}
