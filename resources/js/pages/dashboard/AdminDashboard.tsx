import { useState, useEffect } from 'react';
import { Card, CardBody, Col, Row, Badge, Modal, ModalBody } from 'reactstrap';
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import api from '../../api';
import { ShimmerDashboard } from '../../components/ui/Shimmer';
import { formatCompact } from '../../utils/formatNumber';
import { useChartTheme } from '../../hooks/useChartTheme';
// Reuse the recruitment module's modal styling so the dashboard popups
// match the Hiring Requests modal exactly (rec-req-* classes).
import '../../../css/recruitment.css';

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
    <div className="dashboard-surface admin-kpi-card" style={{
      borderRadius: 16,
      padding: '20px 20px 16px',
      boxShadow: '0 2px 20px rgba(0,0,0,0.06)',
      border: '1px solid var(--vz-border-color)',
      position: 'relative',
      overflow: 'hidden',
      height: '100%',
      cursor: 'default',
    }}>
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 3,
        background: gradient,
      }} />
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 /* allow flex item to shrink so long values still render full */ }}>
          <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--vz-secondary-color)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 10 }}>{label}</p>
          {/* Render full value — earlier we ellipsised long INR figures like
              "₹8,398.82" into "₹8,3...", which lost information. The clamp()
              shrinks the font when the column is narrow (6-up KPI row) so the
              value still fits on one line at typical viewports, and wraps to
              a second line only on extremely narrow widths. */}
          <h3 style={{
            fontSize: 'clamp(16px, 1.6vw, 26px)',
            fontWeight: 800,
            color: 'var(--vz-heading-color, var(--vz-body-color))',
            margin: 0,
            lineHeight: 1.1,
            wordBreak: 'break-word',
            fontVariantNumeric: 'tabular-nums',
          }}>{value}</h3>
          {(change || changeText) && (
            <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
              {/* Hide the trend pill entirely when we don't have a
                  number to show — a lone arrow with no value looked
                  broken. The change-text label still renders so the
                  card describes what the count represents. */}
              {change && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, background: trendColor + '18', color: trendColor, borderRadius: 6, padding: '2px 7px', fontSize: 11, fontWeight: 700 }}>
                  <i className={arrow} style={{ fontSize: 11 }}></i> {change}
                </span>
              )}
              {changeText && <span style={{ fontSize: 11, color: 'var(--vz-secondary-color)' }}>{changeText}</span>}
            </div>
          )}
        </div>
        <div className="admin-kpi-icon" style={{
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

type DetailModal = 'clients' | 'payments' | 'revenue' | null;

export default function AdminDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [openModal, setOpenModal] = useState<DetailModal>(null);
  // Theme-aware chart palette — grid lines + tick text switch between
  // the pale wash that suits the white card and the translucent-white
  // wash that suits the dark surface. Recomputes when the user flips
  // the toggle (MutationObserver watches data-bs-theme).
  const ct = useChartTheme();

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

  /* Month-over-month deltas — computed from the trend datasets the
   * backend already ships. Previously the KPI cards showed hardcoded
   * "+12%" / "+8%" / "+5%" / "+24%" labels that never changed, which
   * misrepresented growth to anyone reading the dashboard.
   *
   *  - revenueChangePct: latest month's revenue vs the month before
   *    it (from data.revenue_trend, last two buckets).
   *  - clientChangePct: same shape on data.client_growth — new-client
   *    count current month vs previous month.
   * Both fall back to null when there isn't enough history (e.g. a
   * tenant in its first month), in which case the card simply hides
   * the change badge instead of showing a misleading 100%. */
  const pctDelta = (curr: number, prev: number): number | null => {
    if (!Number.isFinite(curr) || !Number.isFinite(prev)) return null;
    if (prev === 0) return curr > 0 ? 100 : null;
    return Math.round(((curr - prev) / prev) * 100);
  };
  const trend = Array.isArray(data.revenue_trend) ? data.revenue_trend : [];
  const growth = Array.isArray(data.client_growth) ? data.client_growth : [];
  const revenueChangePct = trend.length >= 2
    ? pctDelta(Number(trend[trend.length - 1]?.revenue ?? 0), Number(trend[trend.length - 2]?.revenue ?? 0))
    : null;
  const clientChangePct = growth.length >= 2
    ? pctDelta(Number(growth[growth.length - 1]?.count ?? 0), Number(growth[growth.length - 2]?.count ?? 0))
    : null;
  const fmtPct = (n: number | null) => n == null ? '—' : (n >= 0 ? `+${n}%` : `${n}%`);
  const pctTrend = (n: number | null): 'up' | 'down' => (n != null && n < 0) ? 'down' : 'up';

  return (
    <>
      <style>{`
        /* Force white card surface in light theme; auto-flip in dark theme */
        .dashboard-surface { background: #ffffff; }
        [data-bs-theme="dark"] .dashboard-surface { background: #1c2531; }

        /* KPI card hover — matches the .hr-emp-kpi-card / .myteam-kpi-tile
           pattern from HR Employees and My Team so the whole product
           lifts the same way: 4px translateY, richer violet shadow,
           violet border tint, and a 1.06x scale on the icon tile. */
        .admin-kpi-card {
          transition: transform .18s ease, box-shadow .18s ease, border-color .18s ease;
        }
        .admin-kpi-card:hover {
          transform: translateY(-4px);
          box-shadow:
            0 16px 32px -8px rgba(15, 23, 42, 0.18),
            0 4px 10px rgba(124, 92, 252, 0.10) !important;
          border-color: rgba(124, 92, 252, 0.45) !important;
        }
        [data-bs-theme="dark"] .admin-kpi-card:hover,
        [data-layout-mode="dark"] .admin-kpi-card:hover {
          box-shadow:
            0 18px 36px -8px rgba(0, 0, 0, 0.65),
            0 4px 12px rgba(124, 92, 252, 0.25) !important;
          border-color: rgba(124, 92, 252, 0.55) !important;
        }
        .admin-kpi-icon {
          transition: transform .18s ease, box-shadow .18s ease;
        }
        .admin-kpi-card:hover .admin-kpi-icon {
          transform: scale(1.06);
          box-shadow: 0 8px 18px rgba(0,0,0,0.18);
        }
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

        /* "View All" pill — styled to match the "Report" button next to
         * Revenue Analytics on this same dashboard, so every card-
         * header action chip on the page looks the same: indigo
         * gradient fill, white text, no border. Hover lifts the
         * button with the gradient's brand-shadow so the affordance
         * stays consistent with the page's other CTAs. Identical in
         * light and dark themes since the gradient is brand-coloured
         * not theme-coloured. */
        .ad-view-all-btn {
          background: linear-gradient(135deg, #405189, #6691e7);
          border: none;
          border-radius: 8px;
          padding: 6px 14px;
          font-size: 12px;
          font-weight: 600;
          color: #ffffff;
          cursor: pointer;
          transition: transform .15s ease, box-shadow .15s ease, filter .15s ease;
        }
        .ad-view-all-btn:hover {
          transform: translateY(-1px);
          filter: brightness(1.06);
          box-shadow: 0 6px 16px rgba(64, 81, 137, 0.34);
        }
        .ad-view-all-btn:active { transform: translateY(0); filter: brightness(0.98); }

        /* Generic hover lift for the small standalone buttons across the
         * dashboard (refresh / quick action chips). Picks up any button
         * tagged with the ad-hover-btn class so future additions stay
         * consistent (no backticks in this comment — the whole block is
         * a JS template literal and backticks would close it early). */
        .ad-hover-btn {
          transition: background .15s ease, color .15s ease, transform .15s ease, box-shadow .15s ease, border-color .15s ease;
        }
        .ad-hover-btn:hover {
          transform: translateY(-1px);
          box-shadow: 0 4px 12px rgba(64, 81, 137, 0.18);
        }
        .ad-hover-btn:active { transform: translateY(0); }

        /* User-role pill on the Payment Health card. Each pill reads its
         * accent from --role-c (set inline) so this rule covers every
         * role without per-role copies. Light mode keeps the original
         * 12-alpha tint; dark mode lifts the surface to a 22-alpha tint
         * + a stronger border so the pill stands out from the dark
         * card, and the count text uses near-white instead of the raw
         * saturated colour (which faded against the dark canvas). */
        .ad-role-pill {
          background: color-mix(in srgb, var(--role-c) 12%, transparent);
          border: 1px solid color-mix(in srgb, var(--role-c) 30%, transparent);
          border-radius: 10px;
          padding: 6px 12px;
        }
        .ad-role-pill .ad-role-dot {
          width: 8px; height: 8px; border-radius: 50%;
          background: var(--role-c); flex-shrink: 0;
        }
        .ad-role-pill .ad-role-label {
          font-size: 11px; font-weight: 600; text-transform: capitalize;
          color: var(--vz-body-color);
        }
        .ad-role-pill .ad-role-count {
          font-size: 13px; font-weight: 800;
          color: var(--role-c);
        }
        [data-bs-theme="dark"] .ad-role-pill,
        [data-layout-mode="dark"] .ad-role-pill {
          background: color-mix(in srgb, var(--role-c) 22%, rgba(0,0,0,0.35));
          border-color: color-mix(in srgb, var(--role-c) 55%, transparent);
        }
        [data-bs-theme="dark"] .ad-role-pill .ad-role-label,
        [data-layout-mode="dark"] .ad-role-pill .ad-role-label {
          color: #f1f5f9;
        }
        [data-bs-theme="dark"] .ad-role-pill .ad-role-count,
        [data-layout-mode="dark"] .ad-role-pill .ad-role-count {
          /* Mix the role colour with white so saturated mids (#405189
           * indigo / #f06548 coral) lift to readable values on the dark
           * pill surface — the raw colour blended into the bg before. */
          color: color-mix(in srgb, var(--role-c) 35%, #ffffff);
        }
      `}</style>
      {/* Page Title */}
      <Row className="mb-2">
        <Col xs={12}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 0 12px' }}>
            <div>
              <h4 style={{ fontWeight: 800, fontSize: 20, color: 'var(--vz-heading-color, var(--vz-body-color))', margin: 0 }}>Dashboard</h4>
              <p style={{ margin: 0, fontSize: 12, color: 'var(--vz-secondary-color)', marginTop: 2 }}>Welcome back! Here's what's happening today.</p>
            </div>
            {/* No breadcrumb on the dashboard — the page title already
                tells the user where they are, and the trail "IGC › Dashboard"
                was redundant noise. */}
          </div>
        </Col>
      </Row>

      {/* KPI Cards — each gradient stays within a single hue family so
          adjacent cards read as a harmonious palette instead of muddy
          colour clashes (the old Revenue gradient went teal → navy,
          which mixed two unrelated hues and looked broken in the
          middle). Change badges are derived from real data where the
          backend ships the source (revenue_trend, client_growth);
          tiles without a real source just show the count without a
          fake percentage. */}
      <Row className="g-3 mb-3">
        <Col xl={2} md={4} xs={6}>
          <KpiCard label="Total Clients" value={<AnimatedNumber value={counts.total_clients} />}
            iconClass="ri-building-line" color="#405189" gradient="linear-gradient(135deg,#3a4b85,#6691e7)"
            trend={pctTrend(clientChangePct)}
            change={clientChangePct == null ? '' : fmtPct(clientChangePct)}
            changeText={clientChangePct == null ? `${counts.total_clients} total` : 'new clients · mom'} />
        </Col>
        <Col xl={2} md={4} xs={6}>
          <KpiCard label="Active Clients" value={<AnimatedNumber value={counts.active_clients} />}
            iconClass="ri-checkbox-circle-line" color="#0ab39c" gradient="linear-gradient(135deg,#0a8f7e,#16d3b8)"
            trend="up" change={`${activeRate}%`} changeText="active rate" />
        </Col>
        <Col xl={2} md={4} xs={6}>
          <KpiCard label="Total Users" value={<AnimatedNumber value={counts.total_users} />}
            iconClass="ri-user-3-line" color="#299cdb" gradient="linear-gradient(135deg,#2186c2,#5fc8ff)"
            trend="up" change={`${counts.total_users}`} changeText="users on platform" />
        </Col>
        <Col xl={2} md={4} xs={6}>
          <KpiCard label="Branches" value={<AnimatedNumber value={counts.total_branches} />}
            iconClass="ri-git-branch-line" color="#f7b84b" gradient="linear-gradient(135deg,#e89a2e,#ffce6e)"
            trend="up" change={`${counts.total_branches}`} changeText="across clients" />
        </Col>
        <Col xl={2} md={4} xs={6}>
          <KpiCard label="Revenue" value={<>₹{formatCompact(revenue.total)}</>}
            iconClass="ri-money-dollar-circle-line" color="#22c55e" gradient="linear-gradient(135deg,#16a34a,#4ade80)"
            trend={pctTrend(revenueChangePct)}
            change={revenueChangePct == null ? '' : fmtPct(revenueChangePct)}
            changeText={revenueChangePct == null ? 'total revenue' : 'vs last month'} />
        </Col>
        <Col xl={2} md={4} xs={6}>
          <KpiCard label="Payments" value={<AnimatedNumber value={counts.total_payments} />}
            iconClass="ri-bank-card-line" color="#9b72cf" gradient="linear-gradient(135deg,#7c4dd1,#b794f6)"
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
                  <div style={{ fontSize: 18, fontWeight: 800, color: '#0ab39c' }} title={`₹${revenue.total.toLocaleString('en-IN')}`}>₹{formatCompact(revenue.total)}</div>
                  <div style={{ fontSize: 10, color: 'var(--vz-secondary-color)', fontWeight: 600 }}>TOTAL REVENUE</div>
                </div>
                <button type="button" onClick={() => setOpenModal('revenue')} style={{
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
                      <stop offset="0%"   stopColor="#405189" stopOpacity={0.45} />
                      <stop offset="55%"  stopColor="#405189" stopOpacity={0.15} />
                      <stop offset="100%" stopColor="#405189" stopOpacity={0} />
                    </linearGradient>
                    {/* Soft halo around the line so the curve lifts off
                       the background — same recipe as the branch chart. */}
                    <filter id="adminRevGlow" x="-10%" y="-30%" width="120%" height="160%">
                      <feGaussianBlur in="SourceGraphic" stdDeviation="2.5" result="blur" />
                      <feFlood floodColor="#405189" floodOpacity="0.4" result="flood" />
                      <feComposite in="flood" in2="blur" operator="in" result="glow" />
                      <feMerge>
                        <feMergeNode in="glow" />
                        <feMergeNode in="SourceGraphic" />
                      </feMerge>
                    </filter>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} vertical={false} />
                  <XAxis dataKey="short" tick={{ fontSize: 11, fill: ct.axisTickMuted, fontWeight: 600 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: ct.axisTickMuted }} axisLine={false} tickLine={false} width={55} tickFormatter={v => `₹${(v / 1000).toFixed(0)}K`} />
                  <Tooltip content={<ChartTooltip prefix="₹" />} cursor={{ stroke: 'rgba(124,92,252,0.35)', strokeWidth: 1, strokeDasharray: '3 3' }} />
                  <Area type="monotone" dataKey="revenue" stroke="#405189" strokeWidth={2.75} fill="url(#adminRevGrad)" filter="url(#adminRevGlow)" dot={{ r: 4, fill: '#405189', strokeWidth: 2, stroke: ct.dotStroke }} activeDot={{ r: 6, fill: '#405189' }} />
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
              {/* Pie + centered total. The previous version stacked the
                  "Total Clients" block below the pie, which left a big
                  empty donut hole and pushed the legend off the visible
                  area on shorter viewports. Position the total INSIDE
                  the donut hole via an absolute-positioned overlay so
                  the chart reads cleanly with no extra vertical space.
                  Also added a `paddingAngle` to separate the slices,
                  a `stroke` matching the surface so adjacent slices
                  stay visually distinct in dark mode, and a guard for
                  the empty-data case so the card doesn't render a
                  blank ring. */}
              {data.plan_breakdown && data.plan_breakdown.length > 0 ? (
                <div style={{ width: '100%', position: 'relative' }}>
                  <ResponsiveContainer width="100%" height={220}>
                    <PieChart>
                      <Pie
                        data={data.plan_breakdown}
                        dataKey="count"
                        nameKey="plan_name"
                        cx="50%"
                        cy="50%"
                        innerRadius={54}
                        outerRadius={84}
                        paddingAngle={2}
                        stroke="var(--vz-card-bg, #ffffff)"
                        strokeWidth={2}
                      >
                        {data.plan_breakdown.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                      </Pie>
                      <Tooltip content={<ChartTooltip />} />
                      <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: '11px', fontWeight: 600, paddingTop: 8 }} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div style={{
                    position: 'absolute', top: '40%', left: 0, right: 0,
                    transform: 'translateY(-50%)', textAlign: 'center', pointerEvents: 'none',
                  }}>
                    <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--vz-heading-color, var(--vz-body-color))', lineHeight: 1 }}>{counts.total_clients}</div>
                    <div style={{ fontSize: 10, color: 'var(--vz-secondary-color)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: 4 }}>Total Clients</div>
                  </div>
                </div>
              ) : (
                <div style={{
                  width: '100%', height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: 'var(--vz-secondary-color)', fontSize: 12, fontWeight: 600,
                }}>
                  No plan data yet
                </div>
              )}
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
                  <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: ct.axisTickMuted, fontWeight: 600 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: ct.axisTickMuted }} axisLine={false} tickLine={false} allowDecimals={false} width={24} />
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
                {Object.entries(data.user_types).map(([type, count], i) => {
                  const role = COLORS[i % COLORS.length];
                  return (
                    /* Pill styling is themed via the .ad-role-pill class
                       so dark mode can swap the surface + raise contrast
                       on the count text. Previously the bg was a 12-alpha
                       tint of the role colour, which on a near-black
                       canvas read as completely flat, and the saturated
                       indigo / amber counts disappeared against it. */
                    <div
                      key={type}
                      className="ad-role-pill"
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        // Pull the per-role accent through a CSS variable
                        // so the dark-mode override can layer a brighter
                        // background / border without re-stating the hue.
                        ['--role-c' as any]: role,
                      }}
                    >
                      <span className="ad-role-dot" />
                      <span className="ad-role-label">{type.replace(/_/g, ' ')}</span>
                      <span className="ad-role-count">{count as number}</span>
                    </div>
                  );
                })}
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
              <button
                onClick={() => setOpenModal('clients')}
                className="ad-view-all-btn"
              >View All</button>
            </div>
            <CardBody style={{ padding: 0 }}>
              {data.recent_clients.slice(0, 5).map((c: any, i: number) => (
                <div key={c.id} className="ad-list-row" style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '12px 20px',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    {/* Real logo when the client has uploaded one (backend
                        exposes it via the appended profile_photo_url
                        accessor on the Client model). Fallback stays the
                        gradient-initials avatar so brand-less clients
                        still render with a consistent thumb. */}
                    {c.profile_photo_url ? (
                      <img
                        src={c.profile_photo_url}
                        alt={`${c.org_name} logo`}
                        style={{
                          width: 38, height: 38, borderRadius: 11, objectFit: 'cover',
                          flexShrink: 0, background: 'var(--vz-secondary-bg)',
                          border: '1px solid var(--vz-border-color)',
                        }}
                      />
                    ) : (
                      <div style={{
                        width: 38, height: 38, borderRadius: 11, display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: `linear-gradient(135deg,${COLORS[i % COLORS.length]},${COLORS[(i + 2) % COLORS.length]})`,
                        color: '#fff', fontWeight: 800, fontSize: 13, flexShrink: 0,
                      }}>
                        {c.org_name.charAt(0)}{c.org_name.split(' ')[1]?.charAt(0) || ''}
                      </div>
                    )}
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
              <button
                onClick={() => setOpenModal('payments')}
                className="ad-view-all-btn"
              >View All</button>
            </div>
            <CardBody style={{ padding: 0 }}>
              {data.recent_payments.slice(0, 5).map((p: any) => {
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

      {/* ── Detail popups — read-only previews of recent_clients,
          recent_payments, and the revenue trend. Same gradient-header
          pattern the master / asset modals use, so the dashboard popups
          feel native to the rest of the app. Bodies scroll when content
          overflows; data already lives in `data` so no refetch fires. */}
      {/* Fixed medium height (540px) so all 3 popups feel the same size
          regardless of row count. The header pins; only the body scrolls. */}
      {/* Recent Clients — narrower (lg/800px). Doesn't need the wide
          rec-req-modal width since there are only 4 columns. */}
      <Modal isOpen={openModal === 'clients'} toggle={() => setOpenModal(null)} centered backdrop="static"
        size="lg" contentClassName="rec-req-content border-0">
        <ModalBody className="p-0 d-flex flex-column" style={{ height: 540 }}>
          <DashboardModalHeader
            icon="ri-team-line"
            title="Recent Clients"
            subtitle="Latest registered clients"
            onClose={() => setOpenModal(null)}
          />
          <div className="rec-req-table-wrap" style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
            <table className="rec-req-table table align-middle table-nowrap mb-0">
              <thead className="table-light" style={{ position: 'sticky', top: 0, zIndex: 1 }}>
                <tr>
                  <th className="ps-4">ORGANIZATION</th>
                  <th>EMAIL</th>
                  <th>PLAN</th>
                  <th className="pe-4">STATUS</th>
                </tr>
              </thead>
              <tbody>
                {data.recent_clients.map((c: any) => (
                  <tr key={c.id}>
                    <td className="ps-4 fw-semibold">{c.org_name}</td>
                    <td className="text-muted">{c.email}</td>
                    <td>{c.plan?.name || 'Free'}</td>
                    <td className="pe-4">
                      <span className="rec-pill fw-bold" style={{
                        background: c.status === 'active' ? '#0ab39c22' : '#f0654822',
                        color: c.status === 'active' ? '#067d6e' : '#c2410c',
                      }}>{c.status}</span>
                    </td>
                  </tr>
                ))}
                {data.recent_clients.length === 0 && (
                  <tr><td colSpan={4} className="text-center text-muted py-4">No recent clients</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </ModalBody>
      </Modal>

      <Modal isOpen={openModal === 'payments'} toggle={() => setOpenModal(null)} centered backdrop="static"
        modalClassName="rec-req-modal" contentClassName="rec-req-content border-0">
        <ModalBody className="p-0 d-flex flex-column" style={{ height: 540 }}>
          <DashboardModalHeader
            icon="ri-bank-card-line"
            title="Recent Payments"
            subtitle="Latest transactions"
            onClose={() => setOpenModal(null)}
          />
          <div className="rec-req-table-wrap" style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
            <table className="rec-req-table table align-middle table-nowrap mb-0">
              <thead className="table-light" style={{ position: 'sticky', top: 0, zIndex: 1 }}>
                <tr>
                  <th className="ps-4">CLIENT</th>
                  <th>INVOICE</th>
                  <th>METHOD</th>
                  <th className="text-end">AMOUNT</th>
                  <th>STATUS</th>
                  <th className="pe-4 text-end">DATE</th>
                </tr>
              </thead>
              <tbody>
                {data.recent_payments.map((p: any) => {
                  /* Status pill — uses dual light/dark colours via color-mix
                     so the chip stays readable on both themes. The previous
                     hard-coded 22-alpha tints washed out on dark canvases
                     and the saturated text colours (#067d6e etc.) blurred
                     into them. Also lifted Method / Invoice / Date from
                     `text-muted` to a theme variable so they don't read as
                     "faded" on dark mode. */
                  const role = p.status === 'success' ? '#0ab39c'
                    : p.status === 'failed' ? '#f06548'
                    : '#f7b84b';
                  return (
                    <tr key={p.id}>
                      <td className="ps-4 fw-semibold" style={{ color: 'var(--vz-body-color)' }}>{p.client?.org_name || 'Unknown'}</td>
                      <td style={{ color: 'var(--vz-secondary-color)', fontVariantNumeric: 'tabular-nums' }}>{p.invoice_number}</td>
                      <td style={{ color: 'var(--vz-body-color)' }}>{methodLabels[p.method] || p.method}</td>
                      <td className="text-end fw-bold" style={{ color: role, fontVariantNumeric: 'tabular-nums' }}>
                        ₹{parseFloat(p.total).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                      <td>
                        <span
                          className="fw-bold text-capitalize"
                          style={{
                            display: 'inline-block',
                            padding: '3px 10px',
                            borderRadius: 999,
                            fontSize: 11,
                            letterSpacing: '0.02em',
                            background: `color-mix(in srgb, ${role} 18%, transparent)`,
                            border: `1px solid color-mix(in srgb, ${role} 45%, transparent)`,
                            color: role,
                          }}
                        >
                          {p.status}
                        </span>
                      </td>
                      <td className="pe-4 text-end" style={{ color: 'var(--vz-secondary-color)', fontVariantNumeric: 'tabular-nums' }}>
                        {new Date(p.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                      </td>
                    </tr>
                  );
                })}
                {data.recent_payments.length === 0 && (
                  <tr><td colSpan={6} className="text-center py-4" style={{ color: 'var(--vz-secondary-color)' }}>No recent payments</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </ModalBody>
      </Modal>

      {/* Revenue Report — narrower (lg/800px). Three KPI tiles + a 3-col
          monthly table fit comfortably without the wide rec-req-modal. */}
      <Modal isOpen={openModal === 'revenue'} toggle={() => setOpenModal(null)} centered backdrop="static"
        size="lg" contentClassName="rec-req-content border-0">
        <ModalBody className="p-0 d-flex flex-column" style={{ height: 540 }}>
          <DashboardModalHeader
            icon="ri-line-chart-line"
            title="Revenue Report"
            subtitle="Monthly revenue breakdown"
            onClose={() => setOpenModal(null)}
          />
          <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
            <div className="px-3 pt-3">
              <Row className="g-3 mb-3">
                <Col md={4}>
                  <div className="rec-kpi-card h-100">
                    <span className="rec-kpi-strip" style={{ background: 'linear-gradient(90deg,#0ab39c,#22c8a9)' }} />
                    <div className="rec-kpi-text">
                      <span className="rec-kpi-label">Total Revenue</span>
                      <span className="rec-kpi-num" style={{ color: '#0ab39c' }}>₹{revenue.total.toLocaleString('en-IN')}</span>
                    </div>
                  </div>
                </Col>
                <Col md={4}>
                  <div className="rec-kpi-card h-100">
                    <span className="rec-kpi-strip" style={{ background: 'linear-gradient(90deg,#405189,#6691e7)' }} />
                    <div className="rec-kpi-text">
                      <span className="rec-kpi-label">This Month</span>
                      <span className="rec-kpi-num" style={{ color: '#405189' }}>₹{revenue.monthly.toLocaleString('en-IN')}</span>
                    </div>
                  </div>
                </Col>
                <Col md={4}>
                  <div className="rec-kpi-card h-100">
                    <span className="rec-kpi-strip" style={{ background: 'linear-gradient(90deg,#f7b84b,#f6c85a)' }} />
                    <div className="rec-kpi-text">
                      <span className="rec-kpi-label">Transactions</span>
                      <span className="rec-kpi-num" style={{ color: '#f7b84b' }}>{counts.total_payments}</span>
                    </div>
                  </div>
                </Col>
              </Row>
            </div>
            <table className="rec-req-table table align-middle table-nowrap mb-0">
              <thead className="table-light" style={{ position: 'sticky', top: 0, zIndex: 1 }}>
                <tr>
                  <th className="ps-4">MONTH</th>
                  <th className="text-end">TRANSACTIONS</th>
                  <th className="text-end pe-4">REVENUE</th>
                </tr>
              </thead>
              <tbody>
                {data.revenue_trend.map((r: any) => (
                  <tr key={r.month}>
                    <td className="ps-4 fw-semibold">{r.month}</td>
                    <td className="text-end">{r.count}</td>
                    <td className="text-end fw-bold pe-4" style={{ color: '#0ab39c' }}>₹{Number(r.revenue).toLocaleString('en-IN')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </ModalBody>
      </Modal>
    </>
  );
}

/**
 * Branded gradient header for the dashboard's read-only popups.
 * Reuses the .rec-req-header / .rec-close-btn classes from
 * recruitment.css so dashboard popups match the Hiring Requests modal
 * pixel-for-pixel. No bespoke CSS lives in this file.
 */
function DashboardModalHeader({ icon, title, subtitle, onClose }: {
  icon: string; title: string; subtitle: string; onClose: () => void;
}) {
  return (
    <div className="rec-req-header">
      <div className="d-flex align-items-center gap-3 min-w-0">
        <span style={{
          width: 44, height: 44, borderRadius: 12,
          background: 'rgba(255,255,255,0.18)',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>
          <i className={icon} style={{ fontSize: 22 }} />
        </span>
        <div className="min-w-0">
          <h5 className="fw-bold mb-0" style={{ color: '#fff', fontSize: 18 }}>{title}</h5>
          <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.85)' }}>{subtitle}</div>
        </div>
      </div>
      <button type="button" onClick={onClose} aria-label="Close" className="rec-close-btn">
        <i className="ri-close-line" />
      </button>
    </div>
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
