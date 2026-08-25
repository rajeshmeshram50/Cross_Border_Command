import { useState, useEffect, type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardBody, Col, Row } from 'reactstrap';
import { BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LabelList } from 'recharts';
import api from '../../api';
import { useBranchSwitcher } from '../../contexts/BranchSwitcherContext';
import { ShimmerDashboard } from '../../components/ui/Shimmer';
import { formatCompact } from '../../utils/formatNumber';
import { useChartTheme } from '../../hooks/useChartTheme';
import { readDashboardStats, writeDashboardStats } from './dashboardStatsCache';
import { AnimatedNumber, ChartTooltip } from './DashboardSections';

/* ── Minimal-enterprise design system ──────────────────────────────────────
 * Neutral slate surfaces, one indigo accent, NO gradients or glows, thin
 * borders, generous whitespace. Charts use a single muted indigo ramp so the
 * whole page reads calm and standard (Stripe / Linear style) rather than the
 * earlier colourful, glossy look. */
const ACCENT = '#4f46e5';
// Per-metric muted accents (KPI icon tints) — distinct but professional.
const KPI_ACCENTS = ['#2563eb', '#0d9488', '#7c3aed', '#059669', '#0891b2', '#d97706'];
// One muted hue-ramp per donut card so each chart is distinct yet cohesive.
const RAMP_TEAL   = ['#0d9488', '#2dd4bf', '#5eead4', '#99f6e4'];
const RAMP_INDIGO = ['#4f46e5', '#6366f1', '#818cf8', '#c7d2fe'];
const RAMP_BLUE   = ['#1d4ed8', '#3b82f6', '#60a5fa', '#bfdbfe'];
// Vivid "ultra-HD" gradient per KPI — used on the icon chips for a glassy,
// premium pop against the frosted cards.
const KPI_GRADIENTS = [
  'linear-gradient(135deg,#2563eb 0%,#06b6d4 100%)',  // blue → cyan
  'linear-gradient(135deg,#0d9488 0%,#34d399 100%)',  // teal → emerald
  'linear-gradient(135deg,#7c3aed 0%,#d946ef 100%)',  // violet → fuchsia
  'linear-gradient(135deg,#059669 0%,#10b981 100%)',  // emerald
  'linear-gradient(135deg,#0891b2 0%,#22d3ee 100%)',  // cyan
  'linear-gradient(135deg,#ea580c 0%,#f59e0b 100%)',  // orange → amber
];

// Frosted-glass card surface. Colours come from CSS vars defined per theme on
// the .cd-glass-page wrapper, so light/dark both look right.
const cardStyle: CSSProperties = {
  borderRadius: 18,
  border: '1px solid var(--cd-glass-border)',
  boxShadow: 'var(--cd-glass-shadow)',
  background: 'var(--cd-glass-bg)',
  overflow: 'hidden',
  marginBottom: 0,
  height: '100%',
};
const cardHeaderStyle: CSSProperties = {
  background: 'transparent',
  borderBottom: '1px solid var(--vz-border-color)',
  padding: '14px 18px',
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
};

/* Hero KPI tile — designed to sit ON the gradient banner. Solid card surface
 * that "lifts" off the band via a soft shadow, a bigger number, and a larger
 * tinted accent icon. Theme-aware (white in light mode, dark card in dark). */
function HeroKpi({ label, value, iconClass, accent = ACCENT, gradient, changeText, change }: {
  label: string; value: React.ReactNode; iconClass: string; accent?: string;
  gradient?: string; changeText?: string; change?: string;
}) {
  return (
    <div className="cd-hero-kpi" style={{
      position: 'relative',
      background: 'var(--cd-glass-bg)',
      border: '1px solid var(--cd-glass-border)',
      borderRadius: 16,
      padding: '12px 15px 11px',
      boxShadow: 'var(--cd-glass-shadow)',
      height: '100%',
      overflow: 'hidden',
    }}>
      {/* vivid accent wash in the corner for identity */}
      <div style={{ position: 'absolute', top: -26, right: -26, width: 66, height: 66, borderRadius: '50%', background: `${accent}22`, filter: 'blur(2px)', pointerEvents: 'none' }} />
      <div className="d-flex align-items-center justify-content-between" style={{ marginBottom: 7, position: 'relative' }}>
        <span style={{ fontSize: 9.5, fontWeight: 700, color: 'var(--vz-secondary-color)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</span>
        <span style={{ width: 26, height: 26, borderRadius: 8, background: gradient ?? accent, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: `0 4px 11px -2px ${accent}aa` }}>
          <i className={iconClass} style={{ fontSize: 13 }} />
        </span>
      </div>
      <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--vz-heading-color, var(--vz-body-color))', lineHeight: 1, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums', position: 'relative' }}>{value}</div>
      {(change || changeText) && (
        <div style={{ marginTop: 6, fontSize: 10.5, color: 'var(--vz-secondary-color)', position: 'relative' }}>
          {change && <span style={{ color: accent, fontWeight: 700 }}>{change}</span>}{change ? ' ' : ''}{changeText}
        </div>
      )}
    </div>
  );
}

const methodLabels: Record<string, string> = {
  upi: 'UPI', credit_card: 'Credit Card', debit_card: 'Debit Card',
  net_banking: 'Net Banking', wallet: 'Wallet', cash: 'Cash', cheque: 'Cheque',
};


export default function ClientDashboard() {
  const navigate = useNavigate();
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
  const access = data.access ?? { total_modules: 0, users: [] };
  const roleLabel = (r: string) => (r ? r.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : '—');

  // ── Donut slices — single muted indigo ramp (CHART) so the analytics row
  //    reads calm and consistent rather than rainbow-coloured. ──
  const headcountSlices = (by_branch ?? [])
    .filter((b: any) => b.employees > 0)
    .map((b: any, i: number) => ({ name: b.code || b.name, value: b.employees, color: RAMP_TEAL[i % RAMP_TEAL.length] }));

  const roleSlices = Object.entries(user_roles || {})
    .map(([k, v], i) => ({ name: roleLabel(k), value: Number(v), color: RAMP_INDIGO[i % RAMP_INDIGO.length] }))
    .filter(s => s.value > 0);

  const et = data.employees?.totals ?? {};
  const statusSlices = [
    { name: 'Active', value: Number(et.active || 0) },
    { name: 'On Leave', value: Number(et.on_leave || 0) },
    { name: 'Probation', value: Number(et.probation || 0) },
    { name: 'Notice', value: Number(et.notice_period || 0) },
    { name: 'Exited', value: Number(et.exited || 0) },
  ].filter(s => s.value > 0).map((s, i) => ({ ...s, color: RAMP_BLUE[i % RAMP_BLUE.length] }));

  const showDonuts = headcountSlices.length > 0 || roleSlices.length > 0 || statusSlices.length > 0;
  const successRate = counts.total_payments > 0
    ? Math.round((counts.success_payments / counts.total_payments) * 100) : 0;

  const orgName = data.client?.org_name ? String(data.client.org_name).charAt(0).toUpperCase() + String(data.client.org_name).slice(1) : '';
  const hr = new Date().getHours();
  const greeting = hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <div className="cd-glass-page" style={{ position: 'relative' }}>
      <style>{`
        .cd-glass-page {
          --cd-glass-bg: #ffffff;
          --cd-glass-border: rgba(15,23,42,0.06);
          --cd-glass-shadow: 0 1px 2px rgba(16,24,40,0.04), 0 16px 38px -18px rgba(16,24,40,0.18);
          background:
            radial-gradient(110% 70% at 50% -8%, rgba(99,102,241,0.05) 0%, transparent 58%),
            radial-gradient(90% 60% at 100% 0%, rgba(13,148,136,0.04) 0%, transparent 55%);
          padding-bottom: 4px;
        }
        [data-bs-theme="dark"] .cd-glass-page,
        [data-layout-mode="dark"] .cd-glass-page {
          --cd-glass-bg: #1b2434;
          --cd-glass-border: rgba(255,255,255,0.08);
          --cd-glass-shadow: 0 1px 2px rgba(0,0,0,0.35), 0 16px 38px -18px rgba(0,0,0,0.6);
          background:
            radial-gradient(110% 70% at 50% -8%, rgba(99,102,241,0.10) 0%, transparent 58%),
            radial-gradient(90% 60% at 100% 0%, rgba(13,148,136,0.07) 0%, transparent 55%);
        }
        /* Premium hover elevation on every card. */
        .cd-glass-page .card { transition: transform .24s cubic-bezier(.2,.8,.2,1), box-shadow .24s cubic-bezier(.2,.8,.2,1); }
        .cd-glass-page .card:hover { transform: translateY(-3px); box-shadow: 0 2px 4px rgba(16,24,40,0.05), 0 26px 54px -22px rgba(16,24,40,0.26) !important; }
        @keyframes cd-blob-float {
          0%, 100% { transform: translate(0, 0) scale(1); }
          50%      { transform: translate(18px, -22px) scale(1.06); }
        }
        .cd-blob { position: absolute; border-radius: 50%; pointer-events: none; will-change: transform; }
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
        .cd-hero-kpi { transition: transform .2s ease, box-shadow .2s ease; }
        .cd-hero-kpi:hover { transform: translateY(-3px); box-shadow: 0 16px 34px -12px rgba(15,23,42,0.6) !important; }
        .cd-insight { transition: transform .2s ease, box-shadow .2s ease; }
        .cd-insight:hover { transform: translateY(-3px); box-shadow: 0 16px 34px -12px rgba(15,23,42,0.55) !important; }
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
          background: rgba(79, 70, 229, 0.05);
        }
        [data-bs-theme="dark"] .cd-list-row:hover,
        [data-layout-mode="dark"] .cd-list-row:hover {
          background: rgba(255, 255, 255, 0.04);
        }
        /* Access & Permissions runs TWO users per line. One user per
           full-width line meant a 40-character name and a 6px bar had ~1400px
           to fill, so whatever the bar was given — 168px, 42%, the whole
           middle — the row still read as mostly nothing. Two columns let the
           content set the width instead of stretching to meet it.
           gap:1px over a border-coloured background draws every separator,
           horizontal AND vertical, without per-cell border bookkeeping. */
        .cd-access-grid {
          display: grid;
          grid-template-columns: 1fr;
          gap: 1px;
          background: #f1f3f9;
        }
        @media (min-width: 992px) {
          .cd-access-grid { grid-template-columns: 1fr 1fr; }
        }
        .cd-access-grid > .cd-list-row { background: var(--vz-card-bg); }
        /* The list-row rule above adds its own top border; inside the grid the
           gap already is the line, so cancel it or every seam doubles. */
        .cd-access-grid > .cd-list-row + .cd-list-row { border-top: none; }
        [data-bs-theme="dark"] .cd-access-grid,
        [data-layout-mode="dark"] .cd-access-grid { background: rgba(255,255,255,0.06); }

        .cd-list-row + .cd-list-row { border-top: 1px solid #f1f3f9; }
        [data-bs-theme="dark"] .cd-list-row + .cd-list-row,
        [data-layout-mode="dark"] .cd-list-row + .cd-list-row { border-top-color: rgba(255,255,255,0.06); }

        /* Bounded scroll for list cards — body scrolls internally instead of
           stretching the page. (Previously provided by DashboardSections,
           which the client dashboard no longer renders.) */
        .dash-scroll { overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin; scrollbar-color: rgba(100,116,139,0.4) transparent; }
        .dash-scroll::-webkit-scrollbar { width: 6px; }
        .dash-scroll::-webkit-scrollbar-track { background: transparent; }
        .dash-scroll::-webkit-scrollbar-thumb { background: rgba(100,116,139,0.3); border-radius: 999px; }
        .dash-scroll::-webkit-scrollbar-thumb:hover { background: rgba(100,116,139,0.5); }

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
      {/* Header strip — Workforce Analytics, with the plan badge on the right. */}
      <div className="frm-cstrip mb-3">
        <span className="frm-cstrip-accent" />
        <div className="frm-cstrip-left">
          <div className="frm-cstrip-icon"><i className="ri-group-line" /></div>
          <div className="min-w-0">
            <div className="frm-cstrip-title">Workforce Analytics</div>
            <div className="frm-cstrip-sub">Employee headcount, hiring activity and demographics</div>
          </div>
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

      {/* KPI strip */}
      <Row className="g-2 mb-2">
          <Col xl={2} md={4} xs={6}>
            <HeroKpi label="Branches" value={<AnimatedNumber value={counts.total_branches} />}
              iconClass="ri-git-branch-line" accent={KPI_ACCENTS[0]} gradient={KPI_GRADIENTS[0]}
              change={`${counts.active_branches}`} changeText="active" />
          </Col>
          <Col xl={2} md={4} xs={6}>
            <HeroKpi label="Employees" value={<AnimatedNumber value={counts.total_employees ?? 0} />}
              iconClass="ri-group-line" accent={KPI_ACCENTS[1]} gradient={KPI_GRADIENTS[1]}
              change={`${counts.active_employees ?? 0}`} changeText="active" />
          </Col>
          <Col xl={2} md={4} xs={6}>
            <HeroKpi label="Users" value={<AnimatedNumber value={counts.total_users} />}
              iconClass="ri-user-3-line" accent={KPI_ACCENTS[2]} gradient={KPI_GRADIENTS[2]}
              change={`${counts.active_users}`} changeText="active" />
          </Col>
          <Col xl={2} md={4} xs={6}>
            <HeroKpi
              label="Total Paid"
              value={<>₹{formatCompact(counts.total_paid)}</>}
              iconClass="ri-coins-line"
              accent={KPI_ACCENTS[3]} gradient={KPI_GRADIENTS[3]}
              change={`${counts.success_payments}`}
              changeText="payments"
            />
          </Col>
          <Col xl={2} md={4} xs={6}>
            <HeroKpi label="Payments" value={<AnimatedNumber value={counts.total_payments} />}
              iconClass="ri-bank-card-line" accent={KPI_ACCENTS[4]} gradient={KPI_GRADIENTS[4]}
              change={`${successRate}%`} changeText="success rate" />
          </Col>
          <Col xl={2} md={4} xs={6}>
            <HeroKpi label="Plan Days" value={<AnimatedNumber value={plan.days_remaining ?? 0} />}
              iconClass="ri-calendar-line"
              accent={plan.days_remaining !== null && plan.days_remaining <= 7 ? '#dc2626' : KPI_ACCENTS[5]}
              gradient={plan.days_remaining !== null && plan.days_remaining <= 7 ? 'linear-gradient(135deg,#dc2626,#f87171)' : KPI_GRADIENTS[5]}
              changeText={plan.status === 'expired' ? 'expired' : 'remaining'} />
          </Col>
        </Row>

      {/* Highlights bar — ONE slim strip of derived insights + plan summary,
          deliberately a single divided row (not another card grid) so the page
          doesn't read as two stacked KPI grids. Replaces the old standalone
          Subscription strip — plan renewal/validity/price now live here. */}
      {(() => {
        const isExpired = plan.status === 'expired';
        const isWarn = !isExpired && plan.days_remaining !== null && plan.days_remaining <= 30;
        const planColor = isExpired ? '#dc2626' : isWarn ? '#d97706' : '#0d9488';
        const top = by_branch?.[0];
        const wfTotal = counts.total_employees ?? 0;
        const wfPct = wfTotal ? Math.round(((counts.active_employees ?? 0) / wfTotal) * 100) : 0;
        const priceTxt = plan.price ? `₹${Number(plan.price).toLocaleString('en-IN')}/cycle` : '';
        const items: any[] = [
          {
            icon: isExpired ? 'ri-error-warning-line' : 'ri-vip-crown-2-line',
            grad: isExpired ? 'linear-gradient(135deg,#dc2626,#f87171)' : isWarn ? 'linear-gradient(135deg,#d97706,#fbbf24)' : 'linear-gradient(135deg,#7c3aed,#d946ef)',
            color: planColor,
            value: isExpired ? 'Plan expired' : `${plan.days_remaining ?? '—'} days left`,
            label: `${plan.name || 'Plan'}${plan.expires_at ? ` · till ${plan.expires_at}` : ''}${priceTxt ? ` · ${priceTxt}` : ''}`,
          },
          ...(top ? [{
            icon: 'ri-building-2-line', grad: KPI_GRADIENTS[0], color: '#2563eb',
            value: (top.name || '').length > 16 ? top.code : top.name,
            label: `Largest branch · ${top.users || 0} users, ${top.employees || 0} staff`,
          }] : []),
          {
            icon: 'ri-team-line', grad: KPI_GRADIENTS[1], color: '#0d9488',
            value: `${wfPct}% active`,
            label: `${counts.active_employees ?? 0} of ${wfTotal} employees`,
          },
          {
            icon: 'ri-bank-card-line', grad: KPI_GRADIENTS[4], color: '#0891b2',
            value: `${successRate}% success`,
            label: `${counts.success_payments} of ${counts.total_payments} payments`,
          },
        ];
        return (
          <Card style={{ ...cardStyle, marginBottom: 8 }}>
            <CardBody style={{ padding: '9px 4px' }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center' }}>
                {items.map((it, i) => (
                  <div key={i} style={{ flex: '1 1 210px', minWidth: 0, display: 'flex', alignItems: 'center', gap: 11, padding: '5px 16px', borderLeft: i > 0 ? '1px solid var(--vz-border-color)' : 'none' }}>
                    <span style={{ width: 34, height: 34, borderRadius: 9, background: it.grad, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: `0 5px 12px -4px ${it.color}aa` }}>
                      <i className={it.icon} style={{ fontSize: 16 }} />
                    </span>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--vz-heading-color, var(--vz-body-color))', lineHeight: 1.15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.value}</div>
                      <div style={{ fontSize: 10.5, color: 'var(--vz-secondary-color)', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.label}</div>
                    </div>
                  </div>
                ))}
              </div>
            </CardBody>
          </Card>
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
                    <div style={{ width: 34, height: 34, borderRadius: 9, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--vz-light)', color: 'var(--vz-secondary-color)', fontSize: 16, border: '1px solid var(--vz-border-color)' }}>
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
                    <div style={{ width: 34, height: 34, borderRadius: 9, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--vz-light)', color: 'var(--vz-secondary-color)', fontSize: 16, border: '1px solid var(--vz-border-color)' }}>
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
                    <div style={{ width: 34, height: 34, borderRadius: 9, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--vz-light)', color: 'var(--vz-secondary-color)', fontSize: 16, border: '1px solid var(--vz-border-color)' }}>
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

      {/* Branch Overview — a tenant view: branches ranked by headcount, with
          employees / users / status. (Sales metrics live in the Sales module
          dashboard, not on the tenant overview.) */}
      {by_branch && by_branch.length > 0 && (() => {
        const maxHead = Math.max(1, ...by_branch.map((b: any) => b.users || 0));
        const statusOf = (s: string) => {
          const active = (s || '').toLowerCase() === 'active';
          return { color: active ? '#0f766e' : '#b45309', label: active ? 'Active' : (s ? s.replace(/\b\w/g, c => c.toUpperCase()) : 'Inactive') };
        };
        return (
          <div className="mb-2">
            <div className="d-flex align-items-center gap-2 mb-2" style={{ padding: '0 2px' }}>
              <i className="ri-git-branch-line" style={{ fontSize: 17, color: 'var(--vz-secondary-color)' }} />
              <div>
                <h5 style={{ fontWeight: 700, fontSize: 15, color: 'var(--vz-heading-color, var(--vz-body-color))', margin: 0 }}>Branch Overview</h5>
                <p style={{ margin: 0, fontSize: 11.5, color: 'var(--vz-secondary-color)', marginTop: 1 }}>Branches ranked by users (login seats)</p>
              </div>
            </div>

            <Row className="g-2">
              {by_branch.slice(0, 3).map((b: any, i: number) => {
                const isLeader = i === 0;
                const st = statusOf(b.status);
                const place = [b.city, b.state].filter(Boolean).join(', ');
                return (
                  <Col xs={12} md={4} key={i}>
                    <Card style={{ ...cardStyle, borderColor: isLeader ? `${ACCENT}55` : 'var(--vz-border-color)' }}>
                      <CardBody style={{ padding: '16px 18px 14px' }}>
                        <div className="d-flex align-items-center justify-content-between" style={{ marginBottom: 14 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 11, minWidth: 0 }}>
                            <div style={{ width: 34, height: 34, borderRadius: 9, background: isLeader ? ACCENT : 'var(--vz-light)', color: isLeader ? '#fff' : 'var(--vz-secondary-color)', border: isLeader ? 'none' : '1px solid var(--vz-border-color)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 14, flexShrink: 0 }}>{i + 1}</div>
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--vz-heading-color, var(--vz-body-color))', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.name}</div>
                              <div style={{ fontSize: 10.5, color: 'var(--vz-secondary-color)', fontWeight: 600 }}>{b.code}{place ? ` · ${place}` : ''}</div>
                            </div>
                          </div>
                          <span style={{ fontSize: 10, fontWeight: 600, color: st.color, background: `${st.color}14`, border: `1px solid ${st.color}33`, borderRadius: 6, padding: '2px 8px', flexShrink: 0 }}>{st.label}</span>
                        </div>
                        <div className="d-flex align-items-baseline gap-2">
                          <div style={{ fontSize: 26, fontWeight: 800, color: 'var(--vz-heading-color, var(--vz-body-color))', lineHeight: 1, letterSpacing: '-0.02em' }}>{b.users || 0}</div>
                          <div style={{ fontSize: 11, color: 'var(--vz-secondary-color)', fontWeight: 600 }}>users</div>
                        </div>
                        <div className="d-flex" style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--vz-border-color)' }}>
                          {[{ v: b.employees || 0, l: 'Employees' }, { v: b.users || 0, l: 'Users' }].map((s, j) => (
                            <div key={j} style={{ flex: 1, textAlign: 'center', borderLeft: j > 0 ? '1px solid var(--vz-border-color)' : 'none' }}>
                              <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--vz-heading-color, var(--vz-body-color))', lineHeight: 1 }}>{s.v}</div>
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
                    const head = b.users || 0;
                    const pct = Math.max(3, Math.round((head / maxHead) * 100));
                    return (
                      <div key={i} className="cd-list-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 18px', flexWrap: 'wrap' }}>
                        <div className="d-flex align-items-center gap-2" style={{ minWidth: 0 }}>
                          <div style={{ width: 26, height: 26, borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--vz-light)', color: 'var(--vz-secondary-color)', fontWeight: 700, fontSize: 11, flexShrink: 0 }}>{i + 1}</div>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--vz-heading-color, var(--vz-body-color))', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.name}</div>
                            <div style={{ fontSize: 10.5, color: 'var(--vz-secondary-color)', fontWeight: 600 }}>{b.code} · {b.employees} employees · {b.users} users</div>
                          </div>
                        </div>
                        <div className="d-flex align-items-center gap-3" style={{ flexShrink: 0 }}>
                          <div style={{ width: 90, height: 5, background: 'var(--vz-border-color)', borderRadius: 999, overflow: 'hidden' }}>
                            <div style={{ width: `${pct}%`, height: '100%', background: ACCENT, borderRadius: 999 }} />
                          </div>
                          <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--vz-heading-color, var(--vz-body-color))', minWidth: 56, textAlign: 'right' }}>{head} users</span>
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
        const pageSize = 6;   // 3 lines of 2 — see .cd-access-grid
        const totalPages = Math.ceil(access.users.length / pageSize);
        const page = Math.min(accessPage, totalPages - 1);
        const start = page * pageSize;
        const pageUsers = access.users.slice(start, start + pageSize);
        return (
        <Row className="g-2 mb-2">
          <Col xs={12}>
            <Card style={cardStyle}>
              <CardHead icon="ri-shield-keyhole-line" gradient="linear-gradient(135deg,#7c5cfc,#a78bfa)" title="Access & Permissions" subtitle={`How many of ${access.total_modules} modules each user can access — click a user to edit`}
                right={(
                  <button type="button" onClick={() => navigate('/permissions')}
                    style={{ fontSize: 12, fontWeight: 600, color: ACCENT, background: `${ACCENT}12`, border: `1px solid ${ACCENT}33`, borderRadius: 8, padding: '5px 11px', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                    Manage Permissions <i className="ri-arrow-right-line" style={{ fontSize: 14 }} />
                  </button>
                )} />
              {/* Fixed height = 3 grid lines so the card stays the same size on
                  every page (no height jump when the last page is short). */}
              <CardBody style={{ padding: 0, minHeight: 222 }}>
                <div className="cd-access-grid">
                {pageUsers.map((u: any, j: number) => {
                  const i = start + j;
                  const total = access.total_modules || 1;
                  const pct = Math.max(2, Math.round((u.modules / total) * 100));
                  // High access (≥80%) flagged in muted red as a governance
                  // nudge; everything else uses the neutral accent.
                  const accent = pct >= 80 ? '#dc2626' : ACCENT;
                  const barGrad = accent;
                  const initial = (u.name || '?').trim().charAt(0).toUpperCase();
                  return (
                    <div key={i} className="cd-list-row"
                      onClick={() => navigate(u.user_id ? `/permissions?user=${u.user_id}` : '/permissions')}
                      title={`Edit ${u.name}'s permissions`}
                      style={{ padding: '11px 16px' }}>
                      {/* Line 1 — who, and the headline count. */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ width: 32, height: 32, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--vz-light)', color: 'var(--vz-secondary-color)', fontWeight: 700, fontSize: 12.5, flexShrink: 0, border: '1px solid var(--vz-border-color)' }}>{initial}</div>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--vz-heading-color, var(--vz-body-color))', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.name}</div>
                          <div style={{ fontSize: 10.5, color: 'var(--vz-secondary-color)', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{roleLabel(u.role)}{u.branch ? ` · ${u.branch}` : ''}</div>
                        </div>
                        <div style={{ flexShrink: 0, textAlign: 'right', whiteSpace: 'nowrap' }}>
                          <span style={{ fontSize: 15, fontWeight: 800, color: accent }}>{u.modules}</span>
                          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--vz-secondary-color)' }}> / {total}</span>
                          {pct >= 80 && <span style={{ marginLeft: 6, fontSize: 9, fontWeight: 700, color: '#dc2626', background: '#dc262615', border: '1px solid #dc262633', borderRadius: 5, padding: '1px 5px' }}>HIGH</span>}
                        </div>
                      </div>
                      {/* Line 2 — how much of the whole, then what kind of
                          access. Under the name rather than beside it: at half
                          the card's width there is no room for four columns,
                          and stacking is what keeps the bar a readable length
                          instead of a 700px rule with nothing on it. */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 7 }}>
                        <div style={{ flex: 1, height: 6, background: 'var(--vz-border-color)', borderRadius: 999, overflow: 'hidden', minWidth: 60 }}>
                          <div style={{ width: `${pct}%`, height: '100%', background: barGrad, borderRadius: 999 }} />
                        </div>
                        <span style={{ flexShrink: 0, fontSize: 11.5, fontWeight: 800, color: accent }}>{pct}%</span>
                        <span style={{ flexShrink: 0, fontSize: 10.5, color: 'var(--vz-secondary-color)', fontWeight: 600, display: 'flex', gap: 9 }}>
                          <span title="Modules this user can edit"><i className="ri-edit-2-line" style={{ fontSize: 11, verticalAlign: '-1px' }} /> {u.can_edit ?? 0}</span>
                          <span title="Modules this user can approve"><i className="ri-checkbox-circle-line" style={{ fontSize: 11, verticalAlign: '-1px' }} /> {u.can_approve ?? 0}</span>
                        </span>
                      </div>
                    </div>
                  );
                })}
                </div>
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
            <CardHead icon="ri-line-chart-line" title="Payment History" subtitle="Monthly payment trend"
              right={(
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--vz-heading-color, var(--vz-body-color))' }} title={`₹${counts.total_paid.toLocaleString('en-IN')}`}>₹{formatCompact(counts.total_paid)}</div>
                  <div style={{ fontSize: 10, color: 'var(--vz-secondary-color)', fontWeight: 600 }}>TOTAL PAID</div>
                </div>
              )} />
            <CardBody style={{ padding: '12px 16px 8px' }}>
              {/* Honest monthly bars — one bar per month. Months with no
                 payment simply show no bar, instead of a smooth area curve
                 inventing "growth" between a single data point and zero. */}
              <ResponsiveContainer width="100%" height={210}>
                <BarChart data={payment_trend} margin={{ top: 18, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: ct.axisTickMuted, fontWeight: 600 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: ct.axisTickMuted }} axisLine={false} tickLine={false} width={55} tickFormatter={v => `₹${(v / 1000).toFixed(0)}K`} />
                  <Tooltip content={<ChartTooltip prefix="₹" />} cursor={{ fill: `${ACCENT}10` }} />
                  <Bar dataKey="amount" fill={ACCENT} radius={[5, 5, 0, 0]} maxBarSize={46} isAnimationActive={false}>
                    <LabelList
                      dataKey="amount"
                      position="top"
                      formatter={(label) => {
                        const v = Number(label ?? 0);
                        if (!Number.isFinite(v) || v <= 0) return '';
                        return `₹${v >= 1000 ? `${(v / 1000).toFixed(1)}K` : v.toFixed(0)}`;
                      }}
                      style={{ fontSize: 10.5, fontWeight: 700, fill: ACCENT }}
                    />
                  </Bar>
                </BarChart>
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
                      width: 36, height: 36, borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center',
                      background: 'var(--vz-light)',
                      color: 'var(--vz-secondary-color)',
                      border: '1px solid var(--vz-border-color)',
                      fontWeight: 700, fontSize: 12, flexShrink: 0,
                    }}>
                      {b.code?.substring(0, 2).toUpperCase() || (b.name || '?').charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--vz-heading-color, var(--vz-body-color))', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        {b.name}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--vz-secondary-color)', marginTop: 1 }}>
                        {[b.city, b.state].filter(Boolean).join(', ') || 'No location'}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span className="d-inline-flex align-items-center gap-1" title="Employees" style={{ fontSize: 11.5, color: 'var(--vz-secondary-color)', fontWeight: 700 }}>
                      <i className="ri-group-line" style={{ fontSize: 13, color: 'var(--vz-secondary-color)' }} />
                      <span style={{ color: 'var(--vz-heading-color, var(--vz-body-color))' }}>{b.employees_count ?? 0}</span>
                    </span>
                    <span className="d-inline-flex align-items-center gap-1" title="Login users" style={{ fontSize: 11.5, color: 'var(--vz-secondary-color)', fontWeight: 700 }}>
                      <i className="ri-user-3-line" style={{ fontSize: 13, color: 'var(--vz-secondary-color)' }} />
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
    </div>
  );
}

/** Flat card header — a quiet monochrome icon + title/subtitle. */
function CardHead({ icon, title, subtitle, right }: { icon: string; gradient?: string; title: string; subtitle: string; right?: React.ReactNode }) {
  return (
    <div style={cardHeaderStyle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
        <i className={icon} style={{ fontSize: 17, color: 'var(--vz-secondary-color)', flexShrink: 0 }}></i>
        <div style={{ minWidth: 0 }}>
          <h5 style={{ fontWeight: 700, fontSize: 14, color: 'var(--vz-heading-color, var(--vz-body-color))', margin: 0 }}>{title}</h5>
          <p style={{ margin: 0, fontSize: 11, color: 'var(--vz-secondary-color)', marginTop: 1 }}>{subtitle}</p>
        </div>
      </div>
      {right}
    </div>
  );
}

/** Clean flat donut + legend list — muted fills, no gradients/glows, total in
 *  the centre, a tidy breakdown table beside it. */
function MiniDonut({ slices, gid }: { slices: Array<{ name: string; value: number; color: string }>; gid: string }) {
  void gid;
  const total = slices.reduce((s, x) => s + x.value, 0) || 1;
  return (
    <div className="d-flex align-items-center gap-3" style={{ width: '100%' }}>
      <div style={{ position: 'relative', width: 124, height: 124, flexShrink: 0 }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={slices} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={44} outerRadius={60} paddingAngle={1} cornerRadius={2} stroke="var(--vz-card-bg)" strokeWidth={2} isAnimationActive={false}>
              {slices.map((s, i) => <Cell key={i} fill={s.color} />)}
            </Pie>
            <Tooltip content={<ChartTooltip />} />
          </PieChart>
        </ResponsiveContainer>
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--vz-heading-color, var(--vz-body-color))', lineHeight: 1, letterSpacing: '-0.02em' }}>{total}</div>
          <div style={{ fontSize: 9, color: 'var(--vz-secondary-color)', textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 3 }}>Total</div>
        </div>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        {slices.map((s, i) => {
          const pct = Math.round((s.value / total) * 100);
          return (
            <div key={i} className="d-flex align-items-center justify-content-between" style={{ padding: '6px 0', borderBottom: i < slices.length - 1 ? '1px solid var(--vz-border-color)' : 'none' }}>
              <div className="d-flex align-items-center gap-2" style={{ minWidth: 0 }}>
                <span style={{ width: 10, height: 10, borderRadius: 3, background: s.color, flexShrink: 0 }} />
                <span style={{ fontSize: 12.5, color: 'var(--vz-body-color)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.name}</span>
              </div>
              <div className="d-flex align-items-center gap-2" style={{ flexShrink: 0 }}>
                <span style={{ fontSize: 11, color: 'var(--vz-secondary-color)', minWidth: 30, textAlign: 'right' }}>{pct}%</span>
                <span style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--vz-heading-color, var(--vz-body-color))', minWidth: 22, textAlign: 'right' }}>{s.value}</span>
              </div>
            </div>
          );
        })}
      </div>
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
