import { useState, useEffect } from 'react';
import { Card, CardBody, Col, Row } from 'reactstrap';
import { AreaChart, Area, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LabelList } from 'recharts';
import api from '../../api';
import { useBranchSwitcher } from '../../contexts/BranchSwitcherContext';
import { ShimmerDashboard } from '../../components/ui/Shimmer';
import { formatCompact } from '../../utils/formatNumber';
import { useChartTheme } from '../../hooks/useChartTheme';
import { readDashboardStats, writeDashboardStats } from './dashboardStatsCache';
import { KpiCard, AnimatedNumber, ChartTooltip, cardStyle, cardHeaderStyle } from './DashboardSections';

const COLORS = ['#405189', '#0ab39c', '#f7b84b', '#f06548', '#299cdb', '#9b72cf'];

const methodLabels: Record<string, string> = {
  upi: 'UPI', credit_card: 'Credit Card', debit_card: 'Debit Card',
  net_banking: 'Net Banking', wallet: 'Wallet', cash: 'Cash', cheque: 'Cheque',
};


export default function ClientDashboard() {
  const { selectedBranchId } = useBranchSwitcher();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [accessPage, setAccessPage] = useState(0);
  const ct = useChartTheme();

  useEffect(() => {
    const controller = new AbortController();
    // Cache key includes branch_id so admin's "all branches" view and a
    // sub-branch view don't share entries — different slices of stats.
    const variant = `client${selectedBranchId ? `:branch:${selectedBranchId}` : ''}`;
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
          // swallow other errors silently — keep current data on screen
        }
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [selectedBranchId]);

  if (loading) return <ShimmerDashboard />;
  if (!data) return null;

  const { counts, plan, branches, recent_payments, payment_trend, user_roles, by_branch } = data;
  const curSym = data.sales?.totals?.currency_symbol ?? '₹';
  const access = data.access ?? { total_modules: 0, users: [] };
  const roleLabel = (r: string) => (r ? r.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : '—');

  // ── Donut slices for the analytics row (circular charts, not bars) ──
  const branchPalette = ['#f7b84b', '#405189', '#0ab39c', '#9b72cf', '#299cdb', '#f06548'];
  const headcountSlices = (by_branch ?? [])
    .filter((b: any) => b.employees > 0)
    .map((b: any, i: number) => ({ name: b.code || b.name, value: b.employees, color: branchPalette[i % branchPalette.length] }));

  const roleSlices = Object.entries(user_roles || {})
    .map(([k, v], i) => ({ name: roleLabel(k), value: Number(v), color: COLORS[i % COLORS.length] }))
    .filter(s => s.value > 0);

  const et = data.employees?.totals ?? {};
  const statusSlices = [
    { name: 'Active', value: Number(et.active || 0), color: '#0ab39c' },
    { name: 'On Leave', value: Number(et.on_leave || 0), color: '#f7b84b' },
    { name: 'Probation', value: Number(et.probation || 0), color: '#299cdb' },
    { name: 'Notice', value: Number(et.notice_period || 0), color: '#f06548' },
    { name: 'Exited', value: Number(et.exited || 0), color: '#878a99' },
  ].filter(s => s.value > 0);

  const showDonuts = headcountSlices.length > 0 || roleSlices.length > 0 || statusSlices.length > 0;
  const successRate = counts.total_payments > 0
    ? Math.round((counts.success_payments / counts.total_payments) * 100) : 0;

  return (
    <>
      <style>{`
        .dashboard-kpi-card {
          background: #ffffff;
          transition: transform .22s ease, box-shadow .22s ease, border-color .22s ease;
          cursor: default;
        }
        .dashboard-kpi-card:hover {
          transform: translateY(-3px);
          box-shadow: 0 12px 28px rgba(13,38,76,0.14) !important;
          border-color: rgba(29,79,196,0.25) !important;
        }
        [data-bs-theme="dark"] .dashboard-kpi-card { background: #1c2531; }
        [data-bs-theme="dark"] .dashboard-kpi-card:hover {
          box-shadow: 0 12px 28px rgba(0,0,0,0.55) !important;
          border-color: rgba(96,165,250,0.35) !important;
        }
        @keyframes cd-plan-dot {
          0%, 100% { transform: scale(1); box-shadow: 0 0 0 0 var(--cd-plan-color); }
          50%      { transform: scale(1.25); box-shadow: 0 0 0 5px transparent; }
        }
        /* ── Highlighted status dot (radar-ping effect) ── */
        @keyframes cd-dot-core-pulse {
          0%, 100% { transform: scale(1);    box-shadow: 0 0 0 0 var(--cd-dot-color), 0 0 8px 1px var(--cd-dot-color); }
          50%      { transform: scale(1.15); box-shadow: 0 0 0 3px color-mix(in srgb, var(--cd-dot-color) 35%, transparent), 0 0 14px 2px var(--cd-dot-color); }
        }
        @keyframes cd-dot-ripple {
          0%   { transform: translate(-50%, -50%) scale(1);   opacity: 0.55; }
          100% { transform: translate(-50%, -50%) scale(2.8); opacity: 0;    }
        }
        .cd-plan-dot-wrap {
          position: relative;
          display: inline-block;
          width: 11px;
          height: 11px;
          flex-shrink: 0;
        }
        .cd-plan-dot-core {
          position: absolute;
          inset: 0;
          border-radius: 50%;
          background: var(--cd-dot-color);
          animation: cd-dot-core-pulse 1.4s ease-in-out infinite;
        }
        .cd-plan-dot-ripple {
          position: absolute;
          top: 50%;
          left: 50%;
          width: 11px;
          height: 11px;
          border-radius: 50%;
          background: var(--cd-dot-color);
          transform: translate(-50%, -50%) scale(1);
          opacity: 0.5;
          animation: cd-dot-ripple 1.6s ease-out infinite;
          pointer-events: none;
        }
        .cd-plan-dot-ripple-2 {
          animation-delay: 0.8s;
        }
        @keyframes cd-plan-blink {
          0%, 100% {
            box-shadow:
              0 0 0 0 var(--cd-plan-ring),
              0 1px 4px var(--cd-plan-shadow),
              0 4px 14px var(--cd-plan-shadow),
              0 8px 28px var(--cd-plan-glow);
            filter: brightness(1);
          }
          50% {
            box-shadow:
              0 0 0 4px var(--cd-plan-ring-soft),
              0 2px 8px var(--cd-plan-shadow),
              0 6px 22px var(--cd-plan-shadow),
              0 14px 42px var(--cd-plan-glow);
            filter: brightness(1.08);
          }
        }
        @keyframes cd-plan-sweep {
          0%   { transform: translateX(-140%); }
          60%  { transform: translateX(140%); }
          100% { transform: translateX(140%); }
        }
        @keyframes cd-plan-vibrate {
          0%, 88%, 100% { transform: translate(0, 0) rotate(0); }
          89% { transform: translate(-1px, 0) rotate(-0.4deg); }
          90% { transform: translate( 1px, 0) rotate( 0.4deg); }
          91% { transform: translate(-1px, 1px) rotate(-0.3deg); }
          92% { transform: translate( 1px,-1px) rotate( 0.3deg); }
          93% { transform: translate(-1px, 0) rotate(-0.2deg); }
          94% { transform: translate( 1px, 0) rotate( 0.2deg); }
          95% { transform: translate(0, 0) rotate(0); }
        }
        .cd-plan-pill {
          position: relative;
          overflow: hidden;
          animation:
            cd-plan-blink 1.8s ease-in-out infinite,
            cd-plan-vibrate 4.5s ease-in-out infinite;
        }
        /* Dark-mode adjustments — stronger tint, brighter text. */
        [data-bs-theme="dark"] .cd-plan-pill,
        [data-layout-mode="dark"] .cd-plan-pill {
          background-image: linear-gradient(135deg,
            color-mix(in srgb, currentColor 22%, transparent) 0%,
            color-mix(in srgb, currentColor 14%, transparent) 100%) !important;
          filter: brightness(1.08);
        }
        [data-bs-theme="dark"] .cd-plan-pill .cd-plan-dot-ripple,
        [data-layout-mode="dark"] .cd-plan-pill .cd-plan-dot-ripple {
          opacity: 0.7;
        }
        .cd-plan-pill::after {
          content: '';
          position: absolute;
          inset: 0;
          background: linear-gradient(110deg, transparent 40%, rgba(255,255,255,0.55) 50%, transparent 60%);
          transform: translateX(-140%);
          animation: cd-plan-sweep 2.6s ease-in-out infinite;
          pointer-events: none;
        }
        /* Theme-aware row hover (branches / recent payments lists) */
        .cd-list-row {
          transition: background 0.18s ease, box-shadow 0.18s ease;
          cursor: pointer;
          position: relative;
        }
        .cd-list-row:hover {
          background: rgba(124, 92, 252, 0.08);
          box-shadow: inset 3px 0 0 0 rgba(124, 92, 252, 0.7);
        }
        [data-bs-theme="dark"] .cd-list-row:hover,
        [data-layout-mode="dark"] .cd-list-row:hover {
          background: rgba(255, 255, 255, 0.05);
          box-shadow: inset 3px 0 0 0 rgba(124, 92, 252, 0.9);
        }
        .cd-list-row + .cd-list-row { border-top: 1px solid #f1f3f9; }
        [data-bs-theme="dark"] .cd-list-row + .cd-list-row,
        [data-layout-mode="dark"] .cd-list-row + .cd-list-row { border-top-color: rgba(255,255,255,0.06); }

        /* Bounded scroll for list cards — body scrolls internally instead of
           stretching the page. (Previously provided by DashboardSections,
           which the client dashboard no longer renders.) */
        .dash-scroll { overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin; scrollbar-color: rgba(124,92,252,0.35) transparent; }
        .dash-scroll::-webkit-scrollbar { width: 6px; }
        .dash-scroll::-webkit-scrollbar-track { background: transparent; }
        .dash-scroll::-webkit-scrollbar-thumb { background: rgba(124,92,252,0.28); border-radius: 999px; }
        .dash-scroll::-webkit-scrollbar-thumb:hover { background: rgba(124,92,252,0.5); }
        [data-bs-theme="dark"] .dash-scroll::-webkit-scrollbar-thumb,
        [data-layout-mode="dark"] .dash-scroll::-webkit-scrollbar-thumb { background: rgba(167,139,250,0.32); }

        /* Team Roles chips hover */
        .cd-role-chip {
          transition: transform 0.18s ease, box-shadow 0.18s ease, filter 0.18s ease;
          cursor: default;
        }
        .cd-role-chip:hover {
          transform: translateY(-2px);
          box-shadow: 0 6px 14px rgba(15, 23, 42, 0.08);
          filter: brightness(1.05);
        }
        [data-bs-theme="dark"] .cd-role-chip:hover,
        [data-layout-mode="dark"] .cd-role-chip:hover {
          box-shadow: 0 6px 14px rgba(0, 0, 0, 0.35);
          filter: brightness(1.15);
        }
      `}</style>
      {/* Page Title */}
      <Row className="mb-2">
        <Col xs={12}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '2px 0 4px', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <h5 style={{ fontWeight: 800, fontSize: 16, color: 'var(--vz-heading-color, var(--vz-body-color))', margin: 0 }}>Workforce Analytics</h5>
              <p style={{ margin: 0, fontSize: 12, color: 'var(--vz-secondary-color)', marginTop: 2 }}>
                Employee headcount, hiring activity and demographics
              </p>
            </div>
              {(() => {
                const isExpired = plan.status === 'expired';
                const isWarn = !isExpired && plan.days_remaining !== null && plan.days_remaining <= 30;
                const color = isExpired ? '#00fb43' : isWarn ? '#057154' : '#096e60';
                const label = isExpired ? 'EXPIRED' : isWarn ? 'EXPIRES SOON' : 'CURRENT';
                return (
                  <span
                    className="cd-plan-pill d-inline-flex align-items-center gap-2 rounded-pill"
                    style={{
                      background: `linear-gradient(135deg, ${color}1f 0%, ${color}12 100%)`,
                      color,
                      border: `1px solid ${color}`,
                      fontSize: 12.5,
                      fontWeight: 500,
                      letterSpacing: '0.03em',
                      padding: '5px 13px',
                      ['--cd-plan-color' as any]: `${color}66`,
                      ['--cd-plan-ring' as any]: `${color}00`,
                      ['--cd-plan-ring-soft' as any]: `${color}33`,
                      ['--cd-plan-shadow' as any]: `${color}66`,
                      ['--cd-plan-glow' as any]: `${color}33`,
                    }}
                    title={isExpired ? `Expired ${plan.expires_at}` : `Valid until ${plan.expires_at}`}
                  >
                    <span
                      className="cd-plan-dot-wrap"
                      style={{
                        ['--cd-dot-color' as any]: color,
                      }}
                    >
                      <span className="cd-plan-dot-ripple" />
                      <span className="cd-plan-dot-ripple cd-plan-dot-ripple-2" />
                      <span className="cd-plan-dot-core" />
                    </span>
                    {label}: {plan.name?.toUpperCase()}
                    {isWarn && plan.days_remaining !== null && (
                      <span className="ms-1" style={{ opacity: 0.9 }}>· {plan.days_remaining}d</span>
                    )}
                    <span className="ms-1" style={{ opacity: 0.8 }}>· {plan.expires_at}</span>
                  </span>
                );
              })()}
          </div>
        </Col>
      </Row>

      {/* KPI Cards */}
      <Row className="g-2 mb-2">
        <Col xl={2} md={4} xs={6}>
          <KpiCard label="Branches" value={<AnimatedNumber value={counts.total_branches} />}
            iconClass="ri-git-branch-line" gradient="linear-gradient(135deg,#299cdb,#50c3e6)"
            trend="up" change={`${counts.active_branches}`} changeText="active" />
        </Col>
        <Col xl={2} md={4} xs={6}>
          <KpiCard label="Employees" value={<AnimatedNumber value={counts.total_employees ?? 0} />}
            iconClass="ri-group-line" gradient="linear-gradient(135deg,#0ab39c,#02c8a7)"
            trend="up" change={`${counts.active_employees ?? 0}`} changeText="active" />
        </Col>
        <Col xl={2} md={4} xs={6}>
          <KpiCard label="Users" value={<AnimatedNumber value={counts.total_users} />}
            iconClass="ri-user-3-line" gradient="linear-gradient(135deg,#9b72cf,#865ce2)"
            trend="up" change={`${counts.active_users}`} changeText="active" />
        </Col>
        <Col xl={2} md={4} xs={6}>
          <KpiCard
            label="Total Paid"
            value={<>₹{formatCompact(counts.total_paid)}</>}
            iconClass="ri-coins-line"
            gradient="linear-gradient(135deg,#0ab39c,#02c8a7)"
            trend="up"
            change={`${counts.success_payments}`}
            changeText="payments"
          />
        </Col>
        <Col xl={2} md={4} xs={6}>
          <KpiCard label="Payments" value={<AnimatedNumber value={counts.total_payments} />}
            iconClass="ri-bank-card-line" gradient="linear-gradient(135deg,#405189,#6691e7)"
            trend={successRate > 80 ? 'up' : 'down'} change={`${successRate}%`} changeText="success rate" />
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

      {/* ── Subscription / Plan — the SaaS heart of a tenant dashboard.
          Operational analytics (Sales/Procurement/CLM/Workforce) live in
          their own module dashboards, not here. */}
      {(() => {
        const isExpired = plan.status === 'expired';
        const isWarn = !isExpired && plan.days_remaining !== null && plan.days_remaining <= 30;
        const color = isExpired ? '#f06548' : isWarn ? '#f7b84b' : '#0ab39c';
        const statusLabel = isExpired ? 'Expired' : isWarn ? 'Expires Soon' : 'Active';
        return (
          <Row className="g-2 mb-2">
            <Col xs={12}>
              <Card style={cardStyle}>
                <CardBody style={{ padding: '9px 18px' }}>
                  <Row className="g-2 align-items-center">
                    <Col xs={12} md={4}>
                      <div className="d-flex align-items-center gap-2">
                        <div style={{
                          width: 40, height: 40, borderRadius: 11, flexShrink: 0,
                          background: 'linear-gradient(135deg,#7c5cfc,#a78bfa)', color: '#fff',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          boxShadow: '0 8px 18px -8px rgba(124,92,252,0.6), inset 0 1px 0 rgba(255,255,255,0.3)',
                        }}>
                          <i className="ri-vip-crown-2-line" style={{ fontSize: 20 }} />
                        </div>
                        <div style={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <div>
                            <div style={{ fontSize: 9.5, fontWeight: 700, color: 'var(--vz-secondary-color)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Subscription Plan</div>
                            <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--vz-heading-color, var(--vz-body-color))', lineHeight: 1.1 }}>{plan.name || '—'}</div>
                          </div>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10.5, fontWeight: 700, color, background: `${color}1f`, padding: '2px 9px', borderRadius: 999 }}>
                            <span style={{ width: 6, height: 6, borderRadius: '50%', background: color }} />
                            {statusLabel}
                          </span>
                        </div>
                      </div>
                    </Col>
                    {[
                      { label: 'Days Remaining', value: plan.days_remaining ?? '—', accent: color, big: true },
                      { label: 'Valid Until', value: plan.expires_at || '—' },
                      { label: 'Plan Price', value: plan.price ? `₹${Number(plan.price).toLocaleString('en-IN')}` : '—', sub: '/ cycle' },
                    ].map((s, i) => (
                      <Col key={i} xs={4} md={i === 0 ? 2 : 3}>
                        <div style={{ fontSize: 9.5, fontWeight: 700, color: 'var(--vz-secondary-color)', letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: 2 }}>{s.label}</div>
                        <div style={{ fontSize: s.big ? 19 : 14.5, fontWeight: 800, color: s.accent || 'var(--vz-heading-color, var(--vz-body-color))', lineHeight: 1 }}>
                          {s.value}{s.sub && <span style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--vz-secondary-color)' }}> {s.sub}</span>}
                        </div>
                      </Col>
                    ))}
                  </Row>
                </CardBody>
              </Card>
            </Col>
          </Row>
        );
      })()}

      {/* Analytics donuts — circular charts (headcount split, roles, workforce
          status) so the page isn't all horizontal bars. */}
      {showDonuts && (
        <Row className="g-2 mb-2">
          {headcountSlices.length > 0 && (
            <Col xs={12} md={6} xl={4}>
              <Card style={cardStyle}>
                <div style={cardHeaderStyle}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                    <div style={{ width: 34, height: 34, borderRadius: 10, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg,#0ab39c,#02c8a7)', color: '#fff', fontSize: 16, boxShadow: '0 8px 18px -8px rgba(10,179,156,0.6)' }}>
                      <i className="ri-group-line"></i>
                    </div>
                    <div>
                      <h5 style={{ fontWeight: 700, fontSize: 15, color: 'var(--vz-heading-color, var(--vz-body-color))', margin: 0 }}>Headcount by Branch</h5>
                      <p style={{ margin: 0, fontSize: 11, color: 'var(--vz-secondary-color)', marginTop: 2 }}>Employees across branches</p>
                    </div>
                  </div>
                </div>
                <CardBody style={{ padding: '8px 14px 14px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                  <MiniDonut slices={headcountSlices} gid="hc" />
                </CardBody>
              </Card>
            </Col>
          )}
          {roleSlices.length > 0 && (
            <Col xs={12} md={6} xl={4}>
              <Card style={cardStyle}>
                <div style={cardHeaderStyle}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                    <div style={{ width: 34, height: 34, borderRadius: 10, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg,#9b72cf,#865ce2)', color: '#fff', fontSize: 16, boxShadow: '0 8px 18px -8px rgba(155,114,207,0.6)' }}>
                      <i className="ri-team-line"></i>
                    </div>
                    <div>
                      <h5 style={{ fontWeight: 700, fontSize: 15, color: 'var(--vz-heading-color, var(--vz-body-color))', margin: 0 }}>Team Roles</h5>
                      <p style={{ margin: 0, fontSize: 11, color: 'var(--vz-secondary-color)', marginTop: 2 }}>User distribution by role</p>
                    </div>
                  </div>
                </div>
                <CardBody style={{ padding: '8px 14px 14px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                  <MiniDonut slices={roleSlices} gid="role" />
                </CardBody>
              </Card>
            </Col>
          )}
          {statusSlices.length > 0 && (
            <Col xs={12} md={12} xl={4}>
              <Card style={cardStyle}>
                <div style={cardHeaderStyle}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                    <div style={{ width: 34, height: 34, borderRadius: 10, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg,#405189,#6691e7)', color: '#fff', fontSize: 16, boxShadow: '0 8px 18px -8px rgba(64,81,137,0.6)' }}>
                      <i className="ri-user-heart-line"></i>
                    </div>
                    <div>
                      <h5 style={{ fontWeight: 700, fontSize: 15, color: 'var(--vz-heading-color, var(--vz-body-color))', margin: 0 }}>Workforce Status</h5>
                      <p style={{ margin: 0, fontSize: 11, color: 'var(--vz-secondary-color)', marginTop: 2 }}>Employee lifecycle split</p>
                    </div>
                  </div>
                </div>
                <CardBody style={{ padding: '8px 14px 14px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                  <MiniDonut slices={statusSlices} gid="stat" />
                </CardBody>
              </Card>
            </Col>
          )}
        </Row>
      )}

      {/* Branch Performance — a "top performers" podium grid (rank medals,
          big value, mini-stats) instead of flat bars. Top 3 as cards; any
          remaining branches fall into a compact list below. */}
      {by_branch && by_branch.length > 0 && (() => {
        const medals = [
          { grad: 'linear-gradient(135deg,#fbc763,#e89a1d)', color: '#e0941b', ring: 'rgba(224,148,27,0.45)' },
          { grad: 'linear-gradient(135deg,#cdd4e1,#8b97b3)', color: '#7a86a3', ring: 'rgba(122,134,163,0.4)' },
          { grad: 'linear-gradient(135deg,#dca074,#b06f3f)', color: '#b06f3f', ring: 'rgba(176,111,63,0.4)' },
        ];
        const max = by_branch[0].value || 1;
        return (
          <div className="mb-2">
            {/* Standalone leaderboard header (the cards below float as a grid). */}
            <div className="d-flex align-items-center gap-2 mb-2" style={{ padding: '0 2px' }}>
              <div style={{ width: 38, height: 38, borderRadius: 11, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg,#fbc763,#e89a1d)', color: '#fff', fontSize: 19, boxShadow: '0 8px 18px -8px rgba(232,154,29,0.7)' }}>
                <i className="ri-trophy-line"></i>
              </div>
              <div>
                <h5 style={{ fontWeight: 700, fontSize: 15.5, color: 'var(--vz-heading-color, var(--vz-body-color))', margin: 0 }}>Branch Performance</h5>
                <p style={{ margin: 0, fontSize: 11.5, color: 'var(--vz-secondary-color)', marginTop: 2 }}>Top branches ranked by quoted value</p>
              </div>
            </div>

            <Row className="g-2">
              {by_branch.slice(0, 3).map((b: any, i: number) => {
                const m = medals[i] ?? medals[2];
                const isLeader = i === 0;
                return (
                  <Col xs={12} md={4} key={i}>
                    <Card style={{
                      ...cardStyle, position: 'relative', overflow: 'hidden',
                      border: isLeader ? `1.5px solid ${m.color}55` : '1px solid var(--vz-border-color)',
                      // Faint colour wash from the top-left fading into the card
                      // surface — gives each card life without the harsh strips.
                      background: `linear-gradient(155deg, ${m.color}16, transparent 46%), var(--vz-card-bg)`,
                      boxShadow: isLeader ? `0 1px 2px rgba(16,24,40,0.05), 0 18px 38px -16px ${m.ring}` : cardStyle.boxShadow,
                    }}>
                      {/* Soft corner glow — subtle, blurred, low-opacity. */}
                      <div style={{ position: 'absolute', top: -45, right: -35, width: 130, height: 130, borderRadius: '50%', background: m.grad, opacity: 0.16, filter: 'blur(18px)', pointerEvents: 'none' }} />
                      <CardBody style={{ padding: '16px 18px 14px', position: 'relative' }}>
                        <div className="d-flex align-items-center justify-content-between" style={{ marginBottom: 14 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 11, minWidth: 0 }}>
                            <div style={{ width: 42, height: 42, borderRadius: 13, background: m.grad, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 18, flexShrink: 0, boxShadow: `0 8px 18px -6px ${m.ring}, inset 0 1px 0 rgba(255,255,255,0.35)` }}>{i + 1}</div>
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--vz-heading-color, var(--vz-body-color))', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.name}</div>
                              <div style={{ fontSize: 10.5, color: 'var(--vz-secondary-color)', fontWeight: 600 }}>{b.code}</div>
                            </div>
                          </div>
                          <div style={{ width: 30, height: 30, borderRadius: '50%', background: `${m.color}1f`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                            {isLeader
                              ? <i className="ri-vip-crown-2-fill" style={{ color: m.color, fontSize: 16 }} title="Top branch" />
                              : <i className="ri-medal-2-fill" style={{ color: m.color, fontSize: 15 }} />}
                          </div>
                        </div>
                        <div style={{ fontSize: 26, fontWeight: 800, color: m.color, lineHeight: 1, letterSpacing: '-0.02em' }}>{curSym}{formatCompact(b.value)}</div>
                        <div style={{ fontSize: 9.5, color: 'var(--vz-secondary-color)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700, marginTop: 3 }}>Quoted Value</div>
                        <div className="d-flex" style={{ marginTop: 14, padding: '11px 6px', borderRadius: 12, background: 'var(--vz-light)' }}>
                          {[{ v: b.leads, l: 'Leads' }, { v: b.quotations, l: 'Quotes' }, { v: b.employees, l: 'Staff' }].map((s, j) => (
                            <div key={j} style={{ flex: 1, textAlign: 'center', borderLeft: j > 0 ? '1px solid var(--vz-border-color)' : 'none' }}>
                              <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--vz-heading-color, var(--vz-body-color))', lineHeight: 1 }}>{s.v}</div>
                              <div style={{ fontSize: 9, color: 'var(--vz-secondary-color)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600, marginTop: 4 }}>{s.l}</div>
                            </div>
                          ))}
                        </div>
                      </CardBody>
                    </Card>
                  </Col>
                );
              })}
            </Row>

            {/* Ranks 4+ — compact rows for the long tail. */}
            {by_branch.length > 3 && (
              <Card style={{ ...cardStyle, marginTop: 12 }}>
                <CardBody className="dash-scroll" style={{ padding: 0, maxHeight: 260 }}>
                  {by_branch.slice(3).map((b: any, idx: number) => {
                    const i = idx + 3;
                    const pct = Math.max(3, Math.round((b.value / max) * 100));
                    return (
                      <div key={i} className="cd-list-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 18px', flexWrap: 'wrap' }}>
                        <div className="d-flex align-items-center gap-2" style={{ minWidth: 0 }}>
                          <div style={{ width: 26, height: 26, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--vz-light)', color: 'var(--vz-secondary-color)', fontWeight: 800, fontSize: 11, flexShrink: 0 }}>{i + 1}</div>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--vz-heading-color, var(--vz-body-color))', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.name}</div>
                            <div style={{ fontSize: 10.5, color: 'var(--vz-secondary-color)', fontWeight: 600 }}>{b.code} · {b.leads} leads · {b.employees} staff</div>
                          </div>
                        </div>
                        <div className="d-flex align-items-center gap-3" style={{ flexShrink: 0 }}>
                          <div style={{ width: 90, height: 5, background: 'var(--vz-border-color)', borderRadius: 999, overflow: 'hidden' }}>
                            <div style={{ width: `${pct}%`, height: '100%', background: 'linear-gradient(90deg,#5fb8ef,#1976c2)', borderRadius: 999 }} />
                          </div>
                          <span style={{ fontWeight: 800, fontSize: 13, color: 'var(--vz-heading-color, var(--vz-body-color))', minWidth: 56, textAlign: 'right' }}>{curSym}{formatCompact(b.value)}</span>
                        </div>
                      </div>
                    );
                  })}
                </CardBody>
              </Card>
            )}
          </div>
        );
      })()}

      {/* Access & Permissions — who can reach how many modules. Governance
          view for the client admin: high access = redder bar (a nudge to
          review over-privileged accounts). */}
      {access.users.length > 0 && (() => {
        const pageSize = 5;
        const totalPages = Math.ceil(access.users.length / pageSize);
        const page = Math.min(accessPage, totalPages - 1);
        const start = page * pageSize;
        const pageUsers = access.users.slice(start, start + pageSize);
        return (
        <Row className="g-2 mb-2">
          <Col xs={12}>
            <Card style={cardStyle}>
              <CardHead icon="ri-shield-keyhole-line" gradient="linear-gradient(135deg,#7c5cfc,#a78bfa)" title="Access & Permissions" subtitle={`Module access by user · out of ${access.total_modules} modules`} />
              {/* Fixed height = 5 rows so the card stays the same size on every
                  page (no height jump when the last page has fewer rows). */}
              <CardBody style={{ padding: 0, minHeight: 275 }}>
                {pageUsers.map((u: any, j: number) => {
                  const i = start + j;
                  const total = access.total_modules || 1;
                  const pct = Math.max(2, Math.round((u.modules / total) * 100));
                  const accent = pct >= 80 ? '#f06548' : pct >= 40 ? '#f7b84b' : '#0ab39c';
                  const barGrad = pct >= 80 ? 'linear-gradient(90deg,#f06548,#ff9e7c)' : pct >= 40 ? 'linear-gradient(90deg,#f7b84b,#fad07e)' : 'linear-gradient(90deg,#0ab39c,#3dd6c3)';
                  const initial = (u.name || '?').trim().charAt(0).toUpperCase();
                  return (
                    <div key={i} className="cd-list-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '10px 18px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}>
                        <div style={{ width: 34, height: 34, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg,#405189,#6691e7)', color: '#fff', fontWeight: 700, fontSize: 13, flexShrink: 0 }}>{initial}</div>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--vz-heading-color, var(--vz-body-color))', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.name}</div>
                          <div style={{ fontSize: 10.5, color: 'var(--vz-secondary-color)', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{roleLabel(u.role)}{u.branch ? ` · ${u.branch}` : ''}</div>
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                        <div className="d-none d-md-block" style={{ width: 90, height: 6, background: 'var(--vz-border-color)', borderRadius: 999, overflow: 'hidden' }}>
                          <div style={{ width: `${pct}%`, height: '100%', background: barGrad, borderRadius: 999 }} />
                        </div>
                        <span style={{ fontSize: 13, fontWeight: 800, color: accent, minWidth: 58, textAlign: 'right' }}>{u.modules}<span style={{ fontSize: 11, fontWeight: 600, color: 'var(--vz-secondary-color)' }}>/{access.total_modules}</span></span>
                      </div>
                    </div>
                  );
                })}
              </CardBody>
              {totalPages > 1 && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 18px', borderTop: '1px solid var(--vz-border-color)' }}>
                  <span style={{ fontSize: 11.5, color: 'var(--vz-secondary-color)', fontWeight: 600 }}>
                    Showing {start + 1}–{Math.min(start + pageSize, access.users.length)} of {access.users.length}
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <button type="button" onClick={() => setAccessPage(Math.max(0, page - 1))} disabled={page === 0}
                      style={{ width: 30, height: 30, borderRadius: 8, border: '1px solid var(--vz-border-color)', background: 'var(--vz-card-bg)', color: 'var(--vz-body-color)', cursor: page === 0 ? 'not-allowed' : 'pointer', opacity: page === 0 ? 0.45 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <i className="ri-arrow-left-s-line" style={{ fontSize: 18 }} />
                    </button>
                    <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--vz-heading-color, var(--vz-body-color))', minWidth: 48, textAlign: 'center' }}>{page + 1} / {totalPages}</span>
                    <button type="button" onClick={() => setAccessPage(Math.min(totalPages - 1, page + 1))} disabled={page >= totalPages - 1}
                      style={{ width: 30, height: 30, borderRadius: 8, border: '1px solid var(--vz-border-color)', background: 'var(--vz-card-bg)', color: 'var(--vz-body-color)', cursor: page >= totalPages - 1 ? 'not-allowed' : 'pointer', opacity: page >= totalPages - 1 ? 0.45 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <i className="ri-arrow-right-s-line" style={{ fontSize: 18 }} />
                    </button>
                  </div>
                </div>
              )}
            </Card>
          </Col>
        </Row>
        );
      })()}

      {/* Payment History + Success Ring */}
      <Row className="g-2 mb-2">
        <Col xl={8}>
          <Card style={cardStyle}>
            <CardHead icon="ri-line-chart-line" gradient="linear-gradient(135deg,#0ab39c,#02c8a7)" title="Payment History" subtitle="Monthly payment trend"
              right={(
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 18, fontWeight: 800, color: '#0ab39c' }} title={`₹${counts.total_paid.toLocaleString('en-IN')}`}>₹{formatCompact(counts.total_paid)}</div>
                  <div style={{ fontSize: 10, color: 'var(--vz-secondary-color)', fontWeight: 600 }}>TOTAL PAID</div>
                </div>
              )} />
            <CardBody style={{ padding: '12px 16px 8px' }}>
              <ResponsiveContainer width="100%" height={260}>
                {/* AreaChart with type="linear" instead of "monotone" —
                   monotone smooths a single non-zero value into a
                   misleading "growth ramp" curve. Linear draws straight
                   segments between data points, so a flat ₹0 baseline
                   that suddenly jumps to ₹12K in May looks like an
                   honest sharp spike (which it is) instead of gradual
                   growth that never happened. Dots + value labels make
                   each month's actual amount readable at a glance. */}
                <AreaChart data={payment_trend} margin={{ top: 18, right: 18, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="clientRevGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%"   stopColor="#0ab39c" stopOpacity={0.45} />
                      <stop offset="55%"  stopColor="#0ab39c" stopOpacity={0.15} />
                      <stop offset="100%" stopColor="#0ab39c" stopOpacity={0} />
                    </linearGradient>
                    <filter id="clientRevGlow" x="-10%" y="-30%" width="120%" height="160%">
                      <feGaussianBlur in="SourceGraphic" stdDeviation="2.5" result="blur" />
                      <feFlood floodColor="#0ab39c" floodOpacity="0.35" result="flood" />
                      <feComposite in="flood" in2="blur" operator="in" result="glow" />
                      <feMerge>
                        <feMergeNode in="glow" />
                        <feMergeNode in="SourceGraphic" />
                      </feMerge>
                    </filter>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: ct.axisTickMuted, fontWeight: 600 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: ct.axisTickMuted }} axisLine={false} tickLine={false} width={55} tickFormatter={v => `₹${(v / 1000).toFixed(0)}K`} />
                  <Tooltip content={<ChartTooltip prefix="₹" />} cursor={{ stroke: 'rgba(10,179,156,0.4)', strokeWidth: 1, strokeDasharray: '3 3' }} />
                  <Area
                    type="monotone"
                    dataKey="amount"
                    stroke="#0ab39c"
                    strokeWidth={2.75}
                    fill="url(#clientRevGrad)"
                    filter="url(#clientRevGlow)"
                    dot={{ r: 4, fill: '#0ab39c', strokeWidth: 2, stroke: ct.dotStroke }}
                    activeDot={{ r: 6, fill: '#0ab39c' }}
                  >
                    <LabelList
                      dataKey="amount"
                      position="top"
                      // Suppress labels on ₹0 months so the X-axis baseline
                      // doesn't get cluttered with five "₹0" tags. Only
                      // months with an actual payment get a label.
                      formatter={(label) => {
                        const v = Number(label ?? 0);
                        if (!Number.isFinite(v) || v <= 0) return '';
                        return `₹${v >= 1000 ? `${(v / 1000).toFixed(1)}K` : v.toFixed(0)}`;
                      }}
                      style={{ fontSize: 10.5, fontWeight: 700, fill: '#0ab39c' }}
                    />
                  </Area>
                </AreaChart>
              </ResponsiveContainer>
            </CardBody>
          </Card>
        </Col>
        <Col xl={4}>
          <Card style={{ ...cardStyle, height: '100%' }}>
            <CardHead icon="ri-heart-pulse-line" gradient="linear-gradient(135deg,#0ab39c,#3dd6c3)" title="Payment Success" subtitle="Transaction health" />
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
      <Row className="g-2 mb-2">
        <Col xl={6}>
          <Card style={cardStyle}>
            <CardHead icon="ri-git-branch-line" gradient="linear-gradient(135deg,#299cdb,#50c3e6)" title="Branches" subtitle={`${branches.length} total`} />
            <CardBody className="dash-scroll" style={{ padding: 0, maxHeight: 400 }}>
              {branches.map((b: any) => (
                <div key={b.id} className="cd-list-row" style={{
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
                      {b.code?.substring(0, 2).toUpperCase() || (b.name || '?').charAt(0).toUpperCase()}
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
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span className="d-inline-flex align-items-center gap-1" title="Employees" style={{ fontSize: 11.5, color: 'var(--vz-secondary-color)', fontWeight: 700 }}>
                      <i className="ri-group-line" style={{ fontSize: 13, color: '#0ab39c' }} />
                      <span style={{ color: 'var(--vz-heading-color, var(--vz-body-color))' }}>{b.employees_count ?? 0}</span>
                    </span>
                    <span className="d-inline-flex align-items-center gap-1" title="Login users" style={{ fontSize: 11.5, color: 'var(--vz-secondary-color)', fontWeight: 700 }}>
                      <i className="ri-user-3-line" style={{ fontSize: 13, color: '#9b72cf' }} />
                      <span style={{ color: 'var(--vz-heading-color, var(--vz-body-color))' }}>{b.users_count}</span>
                    </span>
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
            <CardHead icon="ri-bank-card-line" gradient="linear-gradient(135deg,#9b72cf,#865ce2)" title="Recent Payments" subtitle="Latest transactions" />
            <CardBody className="dash-scroll" style={{ padding: 0, maxHeight: 400 }}>
              {recent_payments.map((p: any) => {
                const cfg = p.status === 'success'
                  ? { color: '#0ab39c', icon: 'ri-checkbox-circle-fill', bg: '#0ab39c18' }
                  : p.status === 'failed'
                  ? { color: '#f06548', icon: 'ri-close-circle-fill', bg: '#f0654818' }
                  : { color: '#f7b84b', icon: 'ri-time-fill', bg: '#f7b84b18' };
                return (
                  <div key={p.id} className="cd-list-row" style={{
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

/** Card header with a gradient icon tile — keeps every section's header
 *  consistent across the dashboard. `right` is optional trailing content. */
function CardHead({ icon, gradient, title, subtitle, right }: { icon: string; gradient: string; title: string; subtitle: string; right?: React.ReactNode }) {
  return (
    <div style={cardHeaderStyle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 11, minWidth: 0 }}>
        <div style={{ width: 34, height: 34, borderRadius: 10, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: gradient, color: '#fff', fontSize: 16, boxShadow: '0 8px 18px -8px rgba(64,81,137,0.5)' }}>
          <i className={icon}></i>
        </div>
        <div style={{ minWidth: 0 }}>
          <h5 style={{ fontWeight: 700, fontSize: 15, color: 'var(--vz-heading-color, var(--vz-body-color))', margin: 0 }}>{title}</h5>
          <p style={{ margin: 0, fontSize: 11, color: 'var(--vz-secondary-color)', marginTop: 2 }}>{subtitle}</p>
        </div>
      </div>
      {right}
    </div>
  );
}

/** A row of radial gauges — one per slice, each a % ring with the number in
 *  the centre and the name + count below. Fills the card width cleanly. */
function MiniDonut({ slices, gid }: { slices: Array<{ name: string; value: number; color: string }>; gid: string }) {
  const total = slices.reduce((s, x) => s + x.value, 0) || 1;
  return (
    <div className="d-flex justify-content-around align-items-start" style={{ width: '100%', gap: 6 }}>
      {slices.map((s, i) => {
        const pct = Math.round((s.value / total) * 100);
        const data = [{ v: pct }, { v: 100 - pct }];
        return (
          <div key={i} style={{ textAlign: 'center', flex: 1, minWidth: 0 }}>
            <div style={{ position: 'relative', width: '100%', height: 108 }}>
              <ResponsiveContainer width="100%" height={108}>
                <PieChart>
                  <defs>
                    <linearGradient id={`cd-gauge-${gid}-${i}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={s.color} stopOpacity={1} />
                      <stop offset="100%" stopColor={s.color} stopOpacity={0.7} />
                    </linearGradient>
                  </defs>
                  <Pie data={data} dataKey="v" cx="50%" cy="50%" innerRadius={33} outerRadius={48} startAngle={90} endAngle={-270} stroke="none" cornerRadius={6} isAnimationActive={false}>
                    <Cell fill={`url(#cd-gauge-${gid}-${i})`} />
                    <Cell fill={`${s.color}1f`} />
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
                <span style={{ fontSize: 17, fontWeight: 800, color: 'var(--vz-heading-color, var(--vz-body-color))', lineHeight: 1 }}>{pct}%</span>
              </div>
            </div>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--vz-heading-color, var(--vz-body-color))', marginTop: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.name}</div>
            <div style={{ fontSize: 12, color: s.color, fontWeight: 800, marginTop: 1 }}>{s.value}</div>
          </div>
        );
      })}
    </div>
  );
}

function SuccessRing({ percent }: { percent: number }) {
  const size = 130;
  const strokeWidth = 12;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percent / 100) * circumference;
  const color = percent >= 80 ? '#0ab39c' : percent >= 50 ? '#f7b84b' : '#f06548';
  // Background track must read against both card surfaces — the previous
  // #f0f3f8 vanished on the dark card, leaving the ring sitting on
  // nothing. Theme-aware translucent slate works in both.
  const ct = useChartTheme();
  return (
    <div className="position-relative d-inline-block" style={{ width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={ct.grid} strokeWidth={strokeWidth} />
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
