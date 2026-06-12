import { useState, useEffect } from 'react';
import { Card, CardBody, Col, Row } from 'reactstrap';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import api from '../../api';
import { useBranchSwitcher } from '../../contexts/BranchSwitcherContext';
import { ShimmerDashboard } from '../../components/ui/Shimmer';
import { formatCompact } from '../../utils/formatNumber';
import { useChartTheme } from '../../hooks/useChartTheme';
import { readDashboardStats, writeDashboardStats } from './dashboardStatsCache';
import DashboardSections, { KpiCard, AnimatedNumber, ChartTooltip, cardStyle, cardHeaderStyle } from './DashboardSections';

/* Branch dashboard — fetches branch-scoped stats and renders the shared
 * business-analytics sections (Sales · Procurement · CLM · Workforce) plus
 * its own Billing block (visible only to main-branch / billing-enabled users). */

const methodLabels: Record<string, string> = {
  upi: 'UPI', credit_card: 'Credit Card', debit_card: 'Debit Card',
  net_banking: 'Net Banking', wallet: 'Wallet', cash: 'Cash', cheque: 'Cheque',
};

export default function BranchDashboard() {
  const { selectedBranchId } = useBranchSwitcher();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const ct = useChartTheme();

  useEffect(() => {
    const controller = new AbortController();
    // Cache key includes branch_id so each branch's view caches separately.
    const variant = `branch${selectedBranchId ? `:${selectedBranchId}` : ''}`;
    const cached = readDashboardStats<any>(variant);
    if (cached) {
      setData(cached);
      setLoading(false);
      return () => controller.abort();
    }
    setLoading(true);
    api.get('/dashboard/client-stats', {
      params: selectedBranchId ? { branch_id: selectedBranchId } : {},
      signal: controller.signal,
    })
      .then(res => {
        setData(res.data);
        writeDashboardStats(variant, res.data);
      })
      .catch(err => {
        if (err?.name !== 'CanceledError' && err?.code !== 'ERR_CANCELED') {
          // swallow — keep current data on screen
        }
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [selectedBranchId]);

  if (loading) return <ShimmerDashboard />;
  if (!data) return null;

  const { counts, recent_payments, payment_trend, can_view_payments } = data;
  const successRate = counts.total_payments > 0
    ? Math.round((counts.success_payments / counts.total_payments) * 100) : 0;

  return (
    <>
      {/* Shared business analytics — Sales, Procurement, CLM, Workforce. */}
      <DashboardSections data={data} scope="branch" />

      {/* Billing — Total Paid / Payments / trend / recent. Hidden for users
          without billing access (non-main-branch). */}
      {can_view_payments && (
        <Row className="g-2 mb-2">
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

      {can_view_payments && (
        <Row className="g-2 mb-2">
          <Col xs={12}>
            <Card style={cardStyle}>
              <div style={cardHeaderStyle}>
                <div>
                  <h5 style={{ fontWeight: 700, fontSize: 14, color: 'var(--vz-heading-color, var(--vz-body-color))', margin: 0 }}>Payment Trend</h5>
                  <p style={{ margin: 0, fontSize: 11, color: 'var(--vz-secondary-color)', marginTop: 2 }}>Monthly cash flow</p>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 18, fontWeight: 800, color: '#0ab39c' }} title={`₹${counts.total_paid.toLocaleString('en-IN')}`}>₹{formatCompact(counts.total_paid)}</div>
                  <div style={{ fontSize: 10, color: 'var(--vz-secondary-color)', fontWeight: 600 }}>TOTAL PAID</div>
                </div>
              </div>
              <CardBody style={{ padding: '8px 12px 4px' }}>
                <ResponsiveContainer width="100%" height={205}>
                  <AreaChart data={payment_trend} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="branchRevGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%"   stopColor="#0ab39c" stopOpacity={0.45} />
                        <stop offset="55%"  stopColor="#0ab39c" stopOpacity={0.15} />
                        <stop offset="100%" stopColor="#0ab39c" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} vertical={false} />
                    <XAxis dataKey="month" tick={{ fontSize: 11, fill: ct.axisTickMuted, fontWeight: 600 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 10, fill: ct.axisTickMuted }} axisLine={false} tickLine={false} width={55} tickFormatter={v => `₹${(v / 1000).toFixed(0)}K`} />
                    <Tooltip content={<ChartTooltip prefix="₹" />} cursor={{ stroke: 'rgba(10,179,156,0.4)', strokeWidth: 1, strokeDasharray: '3 3' }} />
                    <Area type="monotone" dataKey="amount" stroke="#0ab39c" strokeWidth={2.75} fill="url(#branchRevGrad)" dot={{ r: 4, fill: '#0ab39c', strokeWidth: 2, stroke: ct.dotStroke }} activeDot={{ r: 6, fill: '#0ab39c' }} />
                  </AreaChart>
                </ResponsiveContainer>
              </CardBody>
            </Card>
          </Col>
        </Row>
      )}

      {can_view_payments && (
        <Row className="g-2">
          <Col xs={12}>
            <Card style={cardStyle}>
              <div style={cardHeaderStyle}>
                <div>
                  <h5 style={{ fontWeight: 700, fontSize: 14, color: 'var(--vz-heading-color, var(--vz-body-color))', margin: 0 }}>Recent Payments</h5>
                  <p style={{ margin: 0, fontSize: 11, color: 'var(--vz-secondary-color)', marginTop: 2 }}>Latest transactions</p>
                </div>
              </div>
              <CardBody className="dash-scroll" style={{ padding: 0, maxHeight: 400 }}>
                {recent_payments.map((p: any) => {
                  const cfg = p.status === 'success'
                    ? { color: '#0ab39c', icon: 'ri-checkbox-circle-fill', bg: '#0ab39c18' }
                    : p.status === 'failed'
                    ? { color: '#f06548', icon: 'ri-close-circle-fill', bg: '#f0654818' }
                    : { color: '#f7b84b', icon: 'ri-time-fill', bg: '#f7b84b18' };
                  return (
                    <div key={p.id} className="bd-list-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 16px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <div style={{ width: 38, height: 38, borderRadius: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', background: cfg.bg, color: cfg.color, flexShrink: 0, fontSize: 16 }}>
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
