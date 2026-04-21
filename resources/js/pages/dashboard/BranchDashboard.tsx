import { useState, useEffect } from 'react';
import { Card, CardBody, CardHeader, Col, Row, Badge, Alert } from 'reactstrap';
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

const ChartTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border rounded px-3 py-2 shadow-sm" style={{ fontSize: 11 }}>
      <div className="fw-bold text-dark mb-1">{label}</div>
      <div className="text-muted fw-semibold">₹{payload[0]?.value?.toLocaleString()}</div>
    </div>
  );
};

function KpiCard({ label, value, iconClass, iconBg, changeText }: { label: string; value: React.ReactNode; iconClass: string; iconBg: string; changeText?: string }) {
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
            <h4 className="fs-22 fw-semibold ff-secondary mb-0">{value}</h4>
            {changeText && <p className="mb-0 text-muted mt-2 fs-12">{changeText}</p>}
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

export default function BranchDashboard() {
  const { user } = useAuth();
  const { isMainBranchUser, selectedBranchId, selectedBranch } = useBranchSwitcher();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/dashboard/client-stats').then(res => setData(res.data))
      .catch(() => {}).finally(() => setLoading(false));
  }, []);

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
      <Row>
        <Col xs={12}>
          <div className="page-title-box d-sm-flex align-items-center justify-content-between">
            <h4 className="mb-sm-0">Dashboard</h4>
            <div className="page-title-right">
              <ol className="breadcrumb m-0">
                <li className="breadcrumb-item"><a href="#">{displayName}</a></li>
                <li className="breadcrumb-item active">{isMainBranchUser && !selectedBranchId ? 'All Branches' : 'Branch Overview'}</li>
              </ol>
            </div>
          </div>
        </Col>
      </Row>

      {plan.status === 'expired' ? (
        <Alert color="danger" className="d-flex align-items-center">
          <i className="ri-error-warning-line me-2 fs-4"></i>
          <div className="flex-grow-1">
            <strong>Plan Expired — Access Restricted</strong>
            <div className="fs-13">Contact your admin to renew the {plan.name} plan.</div>
          </div>
        </Alert>
      ) : (
        <Alert color="primary" className="d-flex align-items-center">
          <i className="ri-shield-check-line me-2 fs-4"></i>
          <div className="flex-grow-1">
            <strong>{plan.name} Plan</strong>
            <div className="fs-13">
              {plan.days_remaining !== null ? `${plan.days_remaining} days remaining` : 'Active'}
            </div>
          </div>
          {plan.days_remaining !== null && plan.days_remaining <= 30 && (
            <Badge color="warning">{plan.days_remaining}d left</Badge>
          )}
        </Alert>
      )}

      <Row>
        <Col md={3} xs={6}>
          <KpiCard label="Branches" value={<AnimatedNumber value={branches.length} />}
            iconClass="ri-git-branch-line" iconBg="#299cdb" changeText={`${branches.length} visible`} />
        </Col>
        <Col md={3} xs={6}>
          <KpiCard label="Users" value={<AnimatedNumber value={branchUsers} />}
            iconClass="ri-user-3-line" iconBg="#9b72cf" changeText="branch staff" />
        </Col>
        <Col md={3} xs={6}>
          <KpiCard label="Total Paid" value={<>₹<AnimatedNumber value={Math.round(counts.total_paid / 1000)} suffix="K" /></>}
            iconClass="ri-money-rupee-circle-line" iconBg="#0ab39c" changeText={`${counts.success_payments} payments`} />
        </Col>
        <Col md={3} xs={6}>
          <KpiCard label="Payments" value={<AnimatedNumber value={counts.total_payments} />}
            iconClass="ri-bank-card-line" iconBg="#405189" changeText={`${successRate}% ok`} />
        </Col>
      </Row>

      <Row>
        <Col xs={12}>
          <Card>
            <CardHeader className="align-items-center d-flex">
              <h4 className="card-title mb-0 flex-grow-1">Payment Trend</h4>
              <span className="text-success fw-semibold">₹{counts.total_paid.toLocaleString()}</span>
            </CardHeader>
            <CardBody>
              <ResponsiveContainer width="100%" height={280}>
                <AreaChart data={payment_trend} margin={{ top: 5, right: 15, left: 5, bottom: 0 }}>
                  <defs>
                    <linearGradient id="branchRevGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#0ab39c" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="#0ab39c" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e9ebec" vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#878a99' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: '#878a99' }} axisLine={false} tickLine={false} width={55} tickFormatter={v => `₹${(v / 1000).toFixed(0)}K`} />
                  <Tooltip content={<ChartTooltip />} />
                  <Area type="monotone" dataKey="amount" stroke="#0ab39c" strokeWidth={2} fill="url(#branchRevGrad)" dot={{ r: 3, fill: '#0ab39c' }} />
                </AreaChart>
              </ResponsiveContainer>
            </CardBody>
          </Card>
        </Col>
      </Row>

      <Row>
        <Col xl={6}>
          <Card>
            <CardHeader><h4 className="card-title mb-0">Branches</h4></CardHeader>
            <div className="table-responsive table-card">
              <table className="table align-middle table-borderless mb-0">
                <tbody>
                  {branches.map((b: any) => (
                    <tr key={b.id}>
                      <td>
                        <div className="d-flex align-items-center gap-2">
                          <div className="avatar-xs rounded d-flex align-items-center justify-content-center text-white fw-bold" style={{ backgroundColor: b.is_main ? '#f7b84b' : '#299cdb', fontSize: 10 }}>
                            {b.code?.substring(0, 2) || b.name.charAt(0)}
                          </div>
                          <div>
                            <h6 className="mb-0 fs-14 d-inline-flex align-items-center gap-1">
                              {b.name}
                              {b.is_main && <i className="ri-star-fill text-warning fs-12"></i>}
                            </h6>
                            <p className="mb-0 text-muted fs-12">{b.users_count} users</p>
                          </div>
                        </div>
                      </td>
                      <td className="text-end">
                        <Badge color={b.status === 'active' ? 'success' : 'danger'} pill className="text-uppercase">{b.status}</Badge>
                      </td>
                    </tr>
                  ))}
                  {branches.length === 0 && <tr><td className="text-center text-muted py-4">No branches</td></tr>}
                </tbody>
              </table>
            </div>
          </Card>
        </Col>

        <Col xl={6}>
          <Card>
            <CardHeader><h4 className="card-title mb-0">Recent Payments</h4></CardHeader>
            <div className="table-responsive table-card">
              <table className="table align-middle table-borderless mb-0">
                <tbody>
                  {recent_payments.map((p: any) => {
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
                              <h6 className="mb-0 fs-14">{p.plan?.name || 'Payment'}</h6>
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
                  {recent_payments.length === 0 && <tr><td className="text-center text-muted py-4">No payments yet</td></tr>}
                </tbody>
              </table>
            </div>
          </Card>
        </Col>
      </Row>
    </>
  );
}
