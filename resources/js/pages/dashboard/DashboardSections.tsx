import { useState, useEffect } from 'react';
import { Card, CardBody, Col, Row } from 'reactstrap';
import {
  BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { formatCompact } from '../../utils/formatNumber';
import { useChartTheme } from '../../hooks/useChartTheme';

/* Shared business-analytics block (Sales, Procurement, CLM, Workforce) used
 * by BOTH the Branch and Client dashboards. Presentational only: receives the
 * already-fetched `data` and a `scope` ('branch' | 'client') that adjusts the
 * section subtitles. Pages own data fetching + their own Billing/Branches. */

export function AnimatedNumber({ value, prefix = '', suffix = '' }: { value: number; prefix?: string; suffix?: string }) {
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

export const ChartTooltip = ({ active, payload, label, prefix = '' }: any) => {
  if (!active || !payload?.length) return null;
  // Pie/donut segments carry no axis `label`; fall back to the hovered slice's
  // own name so the dark tooltip reads e.g. "Completed" + "14", not just "14".
  const header = label ?? payload[0]?.name;
  return (
    <div style={{ background: '#1e2a3a', borderRadius: 10, padding: '8px 14px', boxShadow: '0 4px 20px rgba(0,0,0,0.18)', border: 'none', fontSize: 12 }}>
      {header != null && header !== '' && <div style={{ color: '#a8b8c8', fontWeight: 600, marginBottom: 4, fontSize: 11 }}>{header}</div>}
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
  // Optional mini trend series + line colour — renders a full-bleed sparkline
  // along the bottom of the tile (the signature "analytics dashboard" look).
  spark?: number[];
  sparkColor?: string;
}

export function KpiCard({ label, value, iconClass, gradient, changeText, trend = 'neutral', change }: KpiProps) {
  const trendColor = trend === 'up' ? '#0ab39c' : trend === 'down' ? '#f06548' : '#878a99';
  const arrow = trend === 'up' ? 'ri-arrow-up-line' : trend === 'down' ? 'ri-arrow-down-line' : 'ri-subtract-line';
  return (
    <div className="dashboard-kpi-card" style={{
      borderRadius: 13,
      // Uniform compact padding — the per-card sparklines were removed so all
      // tiles are the same short height (no dead space from height:100% stretch).
      padding: '11px 14px',
      // Layered soft shadow — a tight contact shadow + a wide soft lift for
      // the premium "floating glass tile" feel.
      boxShadow: '0 1px 2px rgba(16,24,40,0.05), 0 14px 30px -16px rgba(64,81,137,0.28)',
      border: '1px solid var(--vz-border-color)',
      position: 'relative',
      overflow: 'hidden',
      height: '100%',
    }}>
      {/* Accent glow — a small, faint tint tucked tight into the top-right
          corner. Kept subtle so the tile reads clean, not "smoky". */}
      <div style={{
        position: 'absolute', top: -48, right: -42, width: 96, height: 96, borderRadius: '50%',
        background: gradient, opacity: 0.06, filter: 'blur(6px)', pointerEvents: 'none',
      }} />
      {/* Thin glossy accent rail down the left edge. */}
      <div style={{ position: 'absolute', top: 11, bottom: 11, left: 0, width: 3, borderRadius: '0 4px 4px 0', background: gradient }} />
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, position: 'relative', zIndex: 1 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 9.5, fontWeight: 700, color: 'var(--vz-secondary-color)', letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: 5 }}>{label}</p>
          <h3 style={{
            fontSize: 'clamp(17px, 1.4vw, 22px)',
            fontWeight: 800,
            color: 'var(--vz-heading-color, var(--vz-body-color))',
            margin: 0,
            lineHeight: 1,
            letterSpacing: '-0.02em',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}>{value}</h3>
          {(change || changeText) && (
            <div style={{ marginTop: 5, display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
              {change && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, background: trendColor + '1f', color: trendColor, borderRadius: 6, padding: '2px 7px', fontSize: 10.5, fontWeight: 800 }}>
                  <i className={arrow} style={{ fontSize: 10.5 }}></i> {change}
                </span>
              )}
              {changeText && <span style={{ fontSize: 10.5, color: 'var(--vz-secondary-color)', fontWeight: 500 }}>{changeText}</span>}
            </div>
          )}
        </div>
        <div className="dashboard-kpi-icon" style={{
          width: 36, height: 36, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: gradient, flexShrink: 0,
          // Coloured glow under the icon tile so it lifts off the card.
          boxShadow: '0 7px 14px -6px rgba(64,81,137,0.45), inset 0 1px 0 rgba(255,255,255,0.25)',
        }}>
          <i className={iconClass} style={{ fontSize: 16, color: '#fff' }}></i>
        </div>
      </div>
    </div>
  );
}

export const cardStyle: React.CSSProperties = {
  borderRadius: 18,
  border: '1px solid var(--vz-border-color)',
  // Same layered "floating glass" shadow as the KPI tiles so the whole page
  // reads as one premium surface system.
  boxShadow: '0 1px 2px rgba(16,24,40,0.05), 0 14px 34px -18px rgba(64,81,137,0.26)',
  overflow: 'hidden',
  marginBottom: 0,
  height: '100%',
};

export const cardHeaderStyle: React.CSSProperties = {
  // Faint top-down wash so the header reads as a distinct band without a hard
  // divider line — softer, more premium than a flat header + border.
  background: 'linear-gradient(180deg, rgba(64,81,137,0.045), rgba(64,81,137,0))',
  borderBottom: '1px solid var(--vz-border-color)',
  padding: '10px 16px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
};

/* Compact radial gauge — a donut filled to `value`% with the number in the
 * centre. Used for ratio metrics (conversion, win rate, qualified) to give the
 * dashboard the gauge widgets of a premium analytics layout. */
function MiniGauge({ value, color, label }: { value: number; color: string; label: string }) {
  const v = Math.max(0, Math.min(100, value));
  const data = [{ v }, { v: 100 - v }];
  return (
    <div style={{ textAlign: 'center', flex: 1, minWidth: 0 }}>
      <div style={{ position: 'relative', width: '100%', height: 92 }}>
        <ResponsiveContainer width="100%" height={92}>
          <PieChart>
            <Pie data={data} dataKey="v" cx="50%" cy="50%" innerRadius={29} outerRadius={42} startAngle={90} endAngle={-270} stroke="none" paddingAngle={0} isAnimationActive={false}>
              <Cell fill={color} />
              <Cell fill={color + '20'} />
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ fontSize: 16, fontWeight: 800, color: 'var(--vz-heading-color, var(--vz-body-color))', lineHeight: 1 }}>{v}%</span>
        </div>
      </div>
      <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--vz-secondary-color)', marginTop: 2, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
    </div>
  );
}

export default function DashboardSections({ data, scope }: { data: any; scope: 'branch' | 'client' }) {
  const ct = useChartTheme();
  // Workforce (HR) section is collapsed by default so the page leads with the
  // core Sales performance instead of an endless scroll.
  const [hrOpen, setHrOpen] = useState(false);
  // Subtitle wording differs per scope: a branch sees its own data, a client
  // admin sees the whole company.
  const forWhom = scope === 'client' ? 'across all branches' : 'for this branch';

  const { plan, employees: emp, sales, procurement: proc, clm } = data;

  // Plan status pill (mirrors ClientDashboard). Rendered inline at the right
  // of the section heading row instead of as its own band.
  const planPill = (() => {
    const isExpired = plan.status === 'expired';
    const isWarn = !isExpired && plan.days_remaining !== null && plan.days_remaining <= 30;
    const isAlert = isExpired || isWarn;
    const color = isExpired ? '#1a7927' : isWarn ? '#0c5a29' : '#0c695d';
    const label = isExpired ? 'EXPIRED' : isWarn ? 'EXPIRES SOON' : 'CURRENT';
    return (
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
    );
  })();

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
        /* Glossy glass sheen — a soft diagonal highlight across the top-left,
           plus a thin top edge highlight, so each tile reads as a polished
           glass surface. */
        .dashboard-kpi-card::before {
          content: '';
          position: absolute;
          inset: 0;
          border-radius: inherit;
          background:
            linear-gradient(155deg, rgba(255,255,255,0.65) 0%, rgba(255,255,255,0.18) 26%, rgba(255,255,255,0) 52%);
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.7);
          pointer-events: none;
          z-index: 0;
        }
        [data-bs-theme="dark"] .dashboard-kpi-card::before {
          background:
            linear-gradient(155deg, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0.03) 30%, rgba(255,255,255,0) 58%);
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.08);
        }
        /* Sweeping shine on hover — a light streak that glides across the tile. */
        .dashboard-kpi-card::after {
          content: '';
          position: absolute;
          top: 0; bottom: 0; left: -60%;
          width: 45%;
          background: linear-gradient(105deg, transparent 0%, rgba(255,255,255,0.45) 50%, transparent 100%);
          transform: skewX(-18deg);
          pointer-events: none;
          z-index: 0;
          opacity: 0;
          transition: none;
        }
        .dashboard-kpi-card:hover::after {
          animation: kpi-shine 0.85s ease-out;
        }
        [data-bs-theme="dark"] .dashboard-kpi-card::after {
          background: linear-gradient(105deg, transparent 0%, rgba(255,255,255,0.14) 50%, transparent 100%);
        }
        @keyframes kpi-shine {
          0%   { left: -60%; opacity: 0; }
          15%  { opacity: 1; }
          100% { left: 130%; opacity: 0; }
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

        /* Bounded scroll for list cards — when rows exceed the cap the body
           scrolls internally instead of stretching the page. Thin styled bar;
           overscroll contained so the page behind doesn't move. */
        .dash-scroll { overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin; scrollbar-color: rgba(124,92,252,0.35) transparent; }
        .dash-scroll::-webkit-scrollbar { width: 6px; }
        .dash-scroll::-webkit-scrollbar-track { background: transparent; }
        .dash-scroll::-webkit-scrollbar-thumb { background: rgba(124,92,252,0.28); border-radius: 999px; }
        .dash-scroll::-webkit-scrollbar-thumb:hover { background: rgba(124,92,252,0.5); }
        [data-bs-theme="dark"] .dash-scroll::-webkit-scrollbar-thumb,
        [data-layout-mode="dark"] .dash-scroll::-webkit-scrollbar-thumb { background: rgba(167,139,250,0.32); }

        /* Section collapse toggle (Workforce "Show details"). */
        .bd-section-toggle { transition: background .15s ease, border-color .15s ease, color .15s ease, transform .15s ease; }
        .bd-section-toggle:hover { background: rgba(124,92,252,0.08); border-color: rgba(124,92,252,0.40); color: #6d4ca8; transform: translateY(-1px); }
        [data-bs-theme="dark"] .bd-section-toggle:hover,
        [data-layout-mode="dark"] .bd-section-toggle:hover { background: rgba(124,92,252,0.18); color: #c4b5fd; }

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
      {/* ── Sales Performance ──────────────────────────────────────────
          The branch's core business: leads → quotations → proforma invoices.
          Branch-scoped server-side (same scope as the rest of the dashboard).
          Leads the page because the Sales Matrix is what a branch actually
          operates day to day. */}
      {sales && (() => {
        const st = sales.totals;
        const stageColor = (id: number) =>
          id >= 8 ? '#0ab39c' : id >= 6 ? '#405189' : id >= 4 ? '#299cdb'
          : id >= 3 ? '#9b72cf' : id >= 2 ? '#f7b84b' : '#878a99';
        return (
          <>
            <Row className="mb-1">
              <Col xs={12}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', padding: '2px 0 6px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 13 }}>
                    <div style={{
                      width: 36, height: 36, borderRadius: 11, flexShrink: 0,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      background: 'linear-gradient(135deg,#405189,#6691e7)', color: '#fff', fontSize: 17,
                      boxShadow: '0 10px 22px -8px rgba(64,81,137,0.6)',
                    }}>
                      <i className="ri-line-chart-line"></i>
                    </div>
                    <div>
                      <h5 style={{ fontWeight: 800, fontSize: 15, color: 'var(--vz-heading-color, var(--vz-body-color))', margin: 0, letterSpacing: '-0.01em' }}>Sales Performance</h5>
                      <p style={{ margin: 0, fontSize: 12, color: 'var(--vz-secondary-color)', marginTop: 2 }}>
                        Opportunity pipeline, quotations &amp; conversion {forWhom}
                      </p>
                    </div>
                  </div>
                  {/* The Client dashboard renders its own plan badge in its
                      header, so only show this one on the branch view. */}
                  {scope === 'branch' && planPill}
                </div>
              </Col>
            </Row>

            {/* Sales KPI cards */}
            <Row className="g-2 mb-2">
              <Col md={3} sm={6} xs={6}>
                <KpiCard label="Total Opportunities" value={<AnimatedNumber value={st.total_leads} />}
                  iconClass="ri-focus-2-line" gradient="linear-gradient(135deg,#405189,#6691e7)"
                  trend={st.new_this_month > 0 ? 'up' : 'neutral'} change={`+${st.new_this_month}`} changeText="this month"
                  spark={sales.spark?.leads} sparkColor="#6691e7" />
              </Col>
              <Col md={3} sm={6} xs={6}>
                <KpiCard label="Active Pipeline" value={<AnimatedNumber value={st.active_opps} />}
                  iconClass="ri-fire-line" gradient="linear-gradient(135deg,#f7b84b,#f1963b)"
                  changeText="open & qualified" />
              </Col>
              <Col md={3} sm={6} xs={6}>
                <KpiCard label="Quotations" value={<AnimatedNumber value={st.quotations} />}
                  iconClass="ri-file-list-3-line" gradient="linear-gradient(135deg,#6559d6,#865ce2)"
                  changeText="created" spark={sales.spark?.quotations} sparkColor="#865ce2" />
              </Col>
              <Col md={3} sm={6} xs={6}>
                <KpiCard label="Proforma Invoices" value={<AnimatedNumber value={st.pis} />}
                  iconClass="ri-file-paper-2-line" gradient="linear-gradient(135deg,#0ab39c,#02c8a7)"
                  changeText="issued" spark={sales.spark?.pis} sparkColor="#02c8a7" />
              </Col>
              <Col md={3} sm={6} xs={6}>
                <KpiCard label="Conversion Rate" value={<>{st.conversion_rate}<span style={{ fontSize: 16, fontWeight: 700 }}>%</span></>}
                  iconClass="ri-exchange-funds-line" gradient="linear-gradient(135deg,#1cbb8c,#0ab39c)"
                  trend={st.conversion_rate >= 30 ? 'up' : st.conversion_rate > 0 ? 'neutral' : 'down'}
                  changeText="quotation → PI" />
              </Col>
              <Col md={3} sm={6} xs={6}>
                <KpiCard label="Deals Won" value={<AnimatedNumber value={st.won} />}
                  iconClass="ri-trophy-line" gradient="linear-gradient(135deg,#f7b84b,#e89a1d)"
                  trend={st.won > 0 ? 'up' : 'neutral'} changeText="victory stage" />
              </Col>
              <Col md={3} sm={6} xs={6}>
                <KpiCard label="Quotation Value" value={<>{st.currency_symbol ?? '₹'}{formatCompact(st.quotation_value)}</>}
                  iconClass="ri-money-dollar-circle-line" gradient="linear-gradient(135deg,#299cdb,#50c3e6)"
                  changeText="quoted (ex-cancelled)" spark={sales.spark?.value} sparkColor="#50c3e6" />
              </Col>
              <Col md={3} sm={6} xs={6}>
                <KpiCard label="Key Opportunities" value={<AnimatedNumber value={st.key_opps} />}
                  iconClass="ri-star-line" gradient="linear-gradient(135deg,#9b72cf,#865ce2)"
                  changeText="flagged priority" />
              </Col>
            </Row>

            {/* Pipeline funnel + Leads trend + Funnel-health gauges */}
            <Row className="g-2 mb-2">
              <Col xl={5} lg={6} md={12}>
                <Card style={cardStyle}>
                  <div style={cardHeaderStyle}>
                    <div>
                      <h5 style={{ fontWeight: 700, fontSize: 14, color: 'var(--vz-heading-color, var(--vz-body-color))', margin: 0 }}>Lead Stages</h5>
                      <p style={{ margin: 0, fontSize: 11, color: 'var(--vz-secondary-color)', marginTop: 2 }}>How leads are spread across the 6 stages</p>
                    </div>
                  </div>
                  <CardBody style={{ padding: '8px 12px 4px' }}>
                    {st.total_leads === 0 ? (
                      <div className="text-center text-muted py-4">No opportunities yet</div>
                    ) : (
                      <ResponsiveContainer width="100%" height={195}>
                        <BarChart data={sales.pipeline} layout="vertical" margin={{ top: 5, right: 20, left: 8, bottom: 0 }}>
                          <defs>
                            <linearGradient id="branchPipeBar" x1="0" y1="0" x2="1" y2="0">
                              <stop offset="0%" stopColor="#6691e7" />
                              <stop offset="100%" stopColor="#405189" />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} horizontal={false} />
                          <XAxis type="number" tick={{ fontSize: 10, fill: ct.axisTickMuted }} axisLine={false} tickLine={false} allowDecimals={false} />
                          <YAxis type="category" dataKey="stage" tick={{ fontSize: 11, fill: ct.axisTick, fontWeight: 600 }} axisLine={false} tickLine={false} width={130} />
                          <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(64,81,137,0.06)' }} />
                          <Bar dataKey="count" fill="url(#branchPipeBar)" radius={[0, 6, 6, 0]} barSize={20} />
                        </BarChart>
                      </ResponsiveContainer>
                    )}
                  </CardBody>
                </Card>
              </Col>

              <Col xl={4} lg={6} md={6}>
                <Card style={cardStyle}>
                  <div style={cardHeaderStyle}>
                    <div>
                      <h5 style={{ fontWeight: 700, fontSize: 14, color: 'var(--vz-heading-color, var(--vz-body-color))', margin: 0 }}>Leads Trend</h5>
                      <p style={{ margin: 0, fontSize: 11, color: 'var(--vz-secondary-color)', marginTop: 2 }}>Inflow over the last 6 months</p>
                    </div>
                  </div>
                  <CardBody style={{ padding: '8px 12px 4px' }}>
                    <ResponsiveContainer width="100%" height={195}>
                      <BarChart data={sales.leads_trend} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                        <defs>
                          <linearGradient id="branchLeadsBar" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#9b72cf" />
                            <stop offset="100%" stopColor="#6d4ca8" />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} vertical={false} />
                        <XAxis dataKey="month" tick={{ fontSize: 11, fill: ct.axisTickMuted, fontWeight: 600 }} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fontSize: 10, fill: ct.axisTickMuted }} axisLine={false} tickLine={false} width={30} allowDecimals={false} />
                        <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(155,114,207,0.06)' }} />
                        <Bar dataKey="count" fill="url(#branchLeadsBar)" radius={[6, 6, 0, 0]} barSize={26} />
                      </BarChart>
                    </ResponsiveContainer>
                  </CardBody>
                </Card>
              </Col>

              {/* Funnel-health radial gauges — conversion, win rate, qualified. */}
              <Col xl={3} lg={12} md={6}>
                <Card style={cardStyle}>
                  <div style={cardHeaderStyle}>
                    <div>
                      <h5 style={{ fontWeight: 700, fontSize: 14, color: 'var(--vz-heading-color, var(--vz-body-color))', margin: 0 }}>Funnel Health</h5>
                      <p style={{ margin: 0, fontSize: 11, color: 'var(--vz-secondary-color)', marginTop: 2 }}>Key conversion ratios</p>
                    </div>
                  </div>
                  <CardBody style={{ padding: '20px 12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <MiniGauge value={st.conversion_rate} color="#0ab39c" label="Convert" />
                      <MiniGauge value={st.total_leads > 0 ? Math.round((st.engaged / st.total_leads) * 100) : 0} color="#6691e7" label="Engaged" />
                      <MiniGauge value={st.total_leads > 0 ? Math.round((st.won / st.total_leads) * 100) : 0} color="#f7b84b" label="Won" />
                    </div>
                    <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--vz-border-color)', display: 'flex', justifyContent: 'space-around', textAlign: 'center' }}>
                      <div>
                        <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--vz-heading-color, var(--vz-body-color))' }}>{st.won}</div>
                        <div style={{ fontSize: 10, color: 'var(--vz-secondary-color)', fontWeight: 600 }}>WON</div>
                      </div>
                      <div>
                        <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--vz-heading-color, var(--vz-body-color))' }}>{st.active_opps}</div>
                        <div style={{ fontSize: 10, color: 'var(--vz-secondary-color)', fontWeight: 600 }}>ACTIVE</div>
                      </div>
                      <div>
                        <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--vz-heading-color, var(--vz-body-color))' }}>{st.disqualified}</div>
                        <div style={{ fontSize: 10, color: 'var(--vz-secondary-color)', fontWeight: 600 }}>DISQUALIFIED</div>
                      </div>
                    </div>
                  </CardBody>
                </Card>
              </Col>
            </Row>

            {/* Recent opportunities + Top customers */}
            <Row className="g-2 mb-2">
              <Col xl={7} lg={7} md={12}>
                <Card style={cardStyle}>
                  <div style={cardHeaderStyle}>
                    <div>
                      <h5 style={{ fontWeight: 700, fontSize: 14, color: 'var(--vz-heading-color, var(--vz-body-color))', margin: 0 }}>Recent Opportunities</h5>
                      <p style={{ margin: 0, fontSize: 11, color: 'var(--vz-secondary-color)', marginTop: 2 }}>Latest leads in the pipeline</p>
                    </div>
                  </div>
                  <CardBody className="dash-scroll" style={{ padding: 0, maxHeight: 340 }}>
                    {sales.recent_leads.length === 0 ? (
                      <div className="text-center text-muted py-4">No opportunities yet</div>
                    ) : sales.recent_leads.map((l: any) => {
                      const badge = l.won
                        ? { color: '#0ab39c', label: 'Won', bg: '#0ab39c18' }
                        : l.disqualified
                        ? { color: '#f06548', label: 'Disqualified', bg: '#f0654818' }
                        : { color: stageColor(l.stage_id), label: l.stage, bg: stageColor(l.stage_id) + '18' };
                      return (
                        <div key={l.id} className="bd-list-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 16px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                            <div style={{
                              width: 30, height: 30, borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center',
                              background: `linear-gradient(135deg, ${stageColor(l.stage_id)}26, ${stageColor(l.stage_id)}0f)`,
                              color: stageColor(l.stage_id), flexShrink: 0, fontSize: 14,
                              border: `1px solid ${stageColor(l.stage_id)}33`,
                              boxShadow: `0 3px 8px ${stageColor(l.stage_id)}22`,
                            }}>
                              <i className="ri-briefcase-4-line"></i>
                            </div>
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--vz-heading-color, var(--vz-body-color))', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1.3 }}>{l.customer}</div>
                              <div style={{ fontSize: 10.5, color: 'var(--vz-secondary-color)', display: 'flex', alignItems: 'center', gap: 5, marginTop: 1 }}>
                                <span style={{ fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontWeight: 700, color: stageColor(l.stage_id), background: stageColor(l.stage_id) + '14', padding: '0 5px', borderRadius: 5 }}>{l.opp_code}</span>
                                {l.created_at && <span>{new Date(l.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}</span>}
                              </div>
                            </div>
                          </div>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10.5, fontWeight: 700, padding: '3px 10px', borderRadius: 20, background: badge.bg, color: badge.color, border: `1px solid ${badge.color}2e`, flexShrink: 0, whiteSpace: 'nowrap', maxWidth: 145, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            <span style={{ width: 6, height: 6, borderRadius: '50%', background: badge.color, flexShrink: 0 }} />
                            {badge.label}
                          </span>
                        </div>
                      );
                    })}
                  </CardBody>
                </Card>
              </Col>

              <Col xl={5} lg={5} md={12}>
                <Card style={cardStyle}>
                  <div style={cardHeaderStyle}>
                    <div>
                      <h5 style={{ fontWeight: 700, fontSize: 14, color: 'var(--vz-heading-color, var(--vz-body-color))', margin: 0 }}>Top Customers</h5>
                      <p style={{ margin: 0, fontSize: 11, color: 'var(--vz-secondary-color)', marginTop: 2 }}>By quotation value</p>
                    </div>
                  </div>
                  <CardBody className="dash-scroll" style={{ padding: 0, maxHeight: 340 }}>
                    {sales.top_customers.length === 0 ? (
                      <div className="text-center text-muted py-4">No quotations yet</div>
                    ) : sales.top_customers.map((c: any, i: number) => {
                      const max = sales.top_customers[0].value || 1;
                      const pct = Math.max(5, Math.round((c.value / max) * 100));
                      const tileGrad = ['linear-gradient(135deg,#fbc763,#e89a1d)', 'linear-gradient(135deg,#9aa7c4,#5b6da3)', 'linear-gradient(135deg,#e0b07a,#b9803f)', 'linear-gradient(135deg,#b58fe0,#7c5fb8)', 'linear-gradient(135deg,#5fb8ef,#1976c2)'][i % 5];
                      const barGrad  = ['linear-gradient(90deg,#fbc763,#e89a1d)', 'linear-gradient(90deg,#9aa7c4,#5b6da3)', 'linear-gradient(90deg,#e0b07a,#b9803f)', 'linear-gradient(90deg,#b58fe0,#7c5fb8)', 'linear-gradient(90deg,#5fb8ef,#1976c2)'][i % 5];
                      const accent   = ['#e89a1d', '#5b6da3', '#b9803f', '#7c5fb8', '#1976c2'][i % 5];
                      return (
                        <div key={i} className="bd-list-row" style={{ padding: '8px 16px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
                              <div style={{ position: 'relative', flexShrink: 0 }}>
                                <div style={{ width: 24, height: 24, borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', background: tileGrad, color: '#fff', fontWeight: 800, fontSize: 10.5, boxShadow: `0 4px 10px ${accent}59` }}>{i + 1}</div>
                                {i === 0 && <i className="ri-vip-crown-2-fill" style={{ position: 'absolute', top: -9, left: '50%', transform: 'translateX(-50%) rotate(-12deg)', fontSize: 12, color: '#f5b228', filter: 'drop-shadow(0 1px 1px rgba(0,0,0,0.2))' }} />}
                              </div>
                              <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--vz-heading-color, var(--vz-body-color))', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.customer}</div>
                            </div>
                            <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 8, display: 'flex', alignItems: 'baseline', gap: 6 }}>
                              <span style={{ fontSize: 13, fontWeight: 800, color: accent }}>{st.currency_symbol ?? '₹'}{formatCompact(c.value)}</span>
                              <span style={{ fontSize: 9.5, fontWeight: 600, color: 'var(--vz-secondary-color)' }}>{c.quotations} qt{c.quotations === 1 ? '' : 's'}</span>
                            </div>
                          </div>
                          <div style={{ height: 5, background: ct.grid, borderRadius: 999, overflow: 'hidden' }}>
                            <div style={{ width: `${pct}%`, height: '100%', background: barGrad, borderRadius: 999, transition: 'width 0.5s ease', boxShadow: `0 1px 4px ${accent}66` }} />
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
      })()}

      {/* ── Procurement & Vendors ──────────────────────────────────────
          Rendered as a SUB-BLOCK of the Sales section (small inline label,
          pulled tight) rather than its own full section. */}
      {proc && (
        <>
          <Row className="mb-1">
            <Col xs={12}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '0 0 3px', marginTop: -2 }}>
                <span style={{ width: 22, height: 22, borderRadius: 7, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(8,145,178,0.12)', color: '#0891b2', fontSize: 13 }}>
                  <i className="ri-shopping-cart-2-line"></i>
                </span>
                <span style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--vz-heading-color, var(--vz-body-color))', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Procurement &amp; Vendors</span>
                <span style={{ fontSize: 11, color: 'var(--vz-secondary-color)' }}>· product catalogue &amp; supplier onboarding</span>
              </div>
            </Col>
          </Row>

          <Row className="g-2 mb-2">
            <Col md={3} sm={6} xs={6}>
              <KpiCard label="Total Products" value={<AnimatedNumber value={proc.products.total} />}
                iconClass="ri-box-3-line" gradient="linear-gradient(135deg,#7c3aed,#a855f7)"
                trend={proc.products.new_this_month > 0 ? 'up' : 'neutral'} change={`+${proc.products.new_this_month}`} changeText="this month" />
            </Col>
            <Col md={3} sm={6} xs={6}>
              <KpiCard label="Active Products" value={<AnimatedNumber value={proc.products.active} />}
                iconClass="ri-checkbox-circle-line" gradient="linear-gradient(135deg,#0ab39c,#02c8a7)"
                changeText="vendor-mapped" />
            </Col>
            <Col md={3} sm={6} xs={6}>
              <KpiCard label="Total Vendors" value={<AnimatedNumber value={proc.vendors.total} />}
                iconClass="ri-store-2-line" gradient="linear-gradient(135deg,#0891b2,#22d3ee)"
                trend={proc.vendors.new_this_month > 0 ? 'up' : 'neutral'} change={`+${proc.vendors.new_this_month}`} changeText="this month" />
            </Col>
            <Col md={3} sm={6} xs={6}>
              <KpiCard label="Active Vendors" value={<AnimatedNumber value={proc.vendors.active} />}
                iconClass="ri-user-star-line" gradient="linear-gradient(135deg,#f59e0b,#f1963b)"
                changeText="onboarded" />
            </Col>
          </Row>

          <Row className="g-2 mb-2">
            <Col xl={4} md={6}>
              <Card style={cardStyle}>
                <div style={cardHeaderStyle}>
                  <div>
                    <h5 style={{ fontWeight: 700, fontSize: 14, color: 'var(--vz-heading-color, var(--vz-body-color))', margin: 0 }}>Product Onboarding</h5>
                    <p style={{ margin: 0, fontSize: 11, color: 'var(--vz-secondary-color)', marginTop: 2 }}>How far products got: core → vendors</p>
                  </div>
                </div>
                <CardBody style={{ padding: '8px 12px 4px' }}>
                  {proc.products.total === 0 ? (
                    <div className="text-center text-muted py-4">No products yet</div>
                  ) : (
                    <ResponsiveContainer width="100%" height={185}>
                      <BarChart data={proc.products.funnel} layout="vertical" margin={{ top: 5, right: 18, left: 8, bottom: 0 }}>
                        <defs>
                          <linearGradient id="procProdBar" x1="0" y1="0" x2="1" y2="0">
                            <stop offset="0%" stopColor="#a855f7" /><stop offset="100%" stopColor="#7c3aed" />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} horizontal={false} />
                        <XAxis type="number" tick={{ fontSize: 10, fill: ct.axisTickMuted }} axisLine={false} tickLine={false} allowDecimals={false} />
                        <YAxis type="category" dataKey="stage" tick={{ fontSize: 11, fill: ct.axisTick, fontWeight: 600 }} axisLine={false} tickLine={false} width={70} />
                        <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(124,58,237,0.06)' }} />
                        <Bar dataKey="count" fill="url(#procProdBar)" radius={[0, 6, 6, 0]} barSize={18} />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </CardBody>
              </Card>
            </Col>

            <Col xl={4} md={6}>
              <Card style={cardStyle}>
                <div style={cardHeaderStyle}>
                  <div>
                    <h5 style={{ fontWeight: 700, fontSize: 14, color: 'var(--vz-heading-color, var(--vz-body-color))', margin: 0 }}>Vendor Onboarding</h5>
                    <p style={{ margin: 0, fontSize: 11, color: 'var(--vz-secondary-color)', marginTop: 2 }}>Identity → contacts → KYC → products</p>
                  </div>
                </div>
                <CardBody style={{ padding: '8px 12px 4px' }}>
                  {proc.vendors.total === 0 ? (
                    <div className="text-center text-muted py-4">No vendors yet</div>
                  ) : (
                    <ResponsiveContainer width="100%" height={185}>
                      <BarChart data={proc.vendors.funnel} layout="vertical" margin={{ top: 5, right: 18, left: 8, bottom: 0 }}>
                        <defs>
                          <linearGradient id="procVenBar" x1="0" y1="0" x2="1" y2="0">
                            <stop offset="0%" stopColor="#22d3ee" /><stop offset="100%" stopColor="#0891b2" />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} horizontal={false} />
                        <XAxis type="number" tick={{ fontSize: 10, fill: ct.axisTickMuted }} axisLine={false} tickLine={false} allowDecimals={false} />
                        <YAxis type="category" dataKey="stage" tick={{ fontSize: 11, fill: ct.axisTick, fontWeight: 600 }} axisLine={false} tickLine={false} width={70} />
                        <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(8,145,178,0.06)' }} />
                        <Bar dataKey="count" fill="url(#procVenBar)" radius={[0, 6, 6, 0]} barSize={18} />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </CardBody>
              </Card>
            </Col>

            <Col xl={4} md={12}>
              <Card style={cardStyle}>
                <div style={cardHeaderStyle}>
                  <div>
                    <h5 style={{ fontWeight: 700, fontSize: 14, color: 'var(--vz-heading-color, var(--vz-body-color))', margin: 0 }}>Vendors by Type</h5>
                    <p style={{ margin: 0, fontSize: 11, color: 'var(--vz-secondary-color)', marginTop: 2 }}>Top categories</p>
                  </div>
                </div>
                <CardBody className="dash-scroll" style={{ padding: 0, maxHeight: 340 }}>
                  {proc.vendors.by_type.length === 0 ? (
                    <div className="text-center text-muted py-4">No vendors yet</div>
                  ) : proc.vendors.by_type.map((v: any, i: number) => {
                    const max = proc.vendors.by_type[0].count || 1;
                    const pct = Math.max(5, Math.round((v.count / max) * 100));
                    return (
                      <div key={i} className="bd-list-row" style={{ padding: '9px 16px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                            <div style={{ width: 26, height: 26, borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', background: ['linear-gradient(135deg,#22d3ee,#0891b2)', 'linear-gradient(135deg,#b58fe0,#7c5fb8)', 'linear-gradient(135deg,#22c8a9,#089d7a)', 'linear-gradient(135deg,#fbc763,#e89a1d)', 'linear-gradient(135deg,#5fb8ef,#1976c2)'][i % 5], color: '#fff', fontWeight: 800, fontSize: 10.5, flexShrink: 0 }}>{i + 1}</div>
                            <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--vz-heading-color, var(--vz-body-color))', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{v.name}</div>
                          </div>
                          <div style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--vz-heading-color, var(--vz-body-color))', flexShrink: 0, marginLeft: 8 }}>{v.count}</div>
                        </div>
                        <div style={{ height: 5, background: ct.grid, borderRadius: 999, overflow: 'hidden' }}>
                          <div style={{ width: `${pct}%`, height: '100%', background: ['linear-gradient(90deg,#22d3ee,#0891b2)', 'linear-gradient(90deg,#b58fe0,#7c5fb8)', 'linear-gradient(90deg,#22c8a9,#089d7a)', 'linear-gradient(90deg,#fbc763,#e89a1d)', 'linear-gradient(90deg,#5fb8ef,#1976c2)'][i % 5], borderRadius: 999 }} />
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

      {/* ── CLM & Compliance ───────────────────────────────────────────
          E-signature activity (branch-scoped) + the client's compliance
          document library. */}
      {clm && (() => {
        const sig = clm.signatures;
        const libIcon: Record<string, string> = {
          kyc: 'ri-user-search-line', dd: 'ri-search-eye-line', qc: 'ri-shield-check-line',
          tl: 'ri-bank-card-2-line', agr: 'ri-hand-coin-line', td: 'ri-file-list-3-line',
          clause: 'ri-double-quotes-l', tnc: 'ri-file-text-line',
        };
        const libGrad: Record<string, string> = {
          kyc: 'linear-gradient(135deg,#6691e7,#405189)', dd: 'linear-gradient(135deg,#9b72cf,#6d4ca8)',
          qc: 'linear-gradient(135deg,#0ab39c,#02c8a7)', tl: 'linear-gradient(135deg,#f59e0b,#d97706)',
          agr: 'linear-gradient(135deg,#0891b2,#22d3ee)', td: 'linear-gradient(135deg,#7c3aed,#a855f7)',
          clause: 'linear-gradient(135deg,#ec4899,#be185d)', tnc: 'linear-gradient(135deg,#64748b,#475569)',
        };
        const statusColors = ['#0ab39c', '#f7b84b', '#f06548', '#9b72cf', '#878a99'];
        return (
          <>
            <Row className="mb-1">
              <Col xs={12}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 13, padding: '2px 0 6px' }}>
                  <div style={{
                    width: 36, height: 36, borderRadius: 11, flexShrink: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: 'linear-gradient(135deg,#6d28d9,#4c1d95)', color: '#fff', fontSize: 18,
                    boxShadow: '0 10px 22px -8px rgba(109,40,217,0.6)',
                  }}>
                    <i className="ri-shield-check-line"></i>
                  </div>
                  <div>
                    <h5 style={{ fontWeight: 800, fontSize: 15, color: 'var(--vz-heading-color, var(--vz-body-color))', margin: 0, letterSpacing: '-0.01em' }}>CLM &amp; Compliance</h5>
                    <p style={{ margin: 0, fontSize: 12, color: 'var(--vz-secondary-color)', marginTop: 2 }}>E-signature activity &amp; the compliance document library</p>
                  </div>
                </div>
              </Col>
            </Row>

            <Row className="g-2 mb-2">
              <Col md={3} sm={6} xs={6}>
                <KpiCard label="Signatures Sent" value={<AnimatedNumber value={sig.total} />}
                  iconClass="ri-quill-pen-line" gradient="linear-gradient(135deg,#6d28d9,#8b5cf6)" changeText="e-sign requests" />
              </Col>
              <Col md={3} sm={6} xs={6}>
                <KpiCard label="Completed" value={<AnimatedNumber value={sig.completed} />}
                  iconClass="ri-checkbox-circle-line" gradient="linear-gradient(135deg,#0ab39c,#02c8a7)"
                  trend={sig.completion_rate >= 50 ? 'up' : sig.completion_rate > 0 ? 'neutral' : 'down'} change={`${sig.completion_rate}%`} changeText="signed" />
              </Col>
              <Col md={3} sm={6} xs={6}>
                <KpiCard label="In Progress" value={<AnimatedNumber value={sig.in_progress} />}
                  iconClass="ri-time-line" gradient="linear-gradient(135deg,#f7b84b,#f1963b)" changeText="awaiting signature" />
              </Col>
              <Col md={3} sm={6} xs={6}>
                <KpiCard label="Declined / Issues" value={<AnimatedNumber value={sig.declined} />}
                  iconClass="ri-error-warning-line" gradient="linear-gradient(135deg,#f06548,#fb6e52)" changeText="declined + expired" />
              </Col>
            </Row>

            <Row className="g-2 mb-2">
              <Col xl={4} md={6}>
                <Card style={cardStyle}>
                  <div style={cardHeaderStyle}>
                    <div>
                      <h5 style={{ fontWeight: 700, fontSize: 14, color: 'var(--vz-heading-color, var(--vz-body-color))', margin: 0 }}>E-Signature Status</h5>
                      <p style={{ margin: 0, fontSize: 11, color: 'var(--vz-secondary-color)', marginTop: 2 }}>Where requests stand</p>
                    </div>
                  </div>
                  <CardBody style={{ padding: '4px 2px 0' }}>
                    {sig.total === 0 ? (
                      <div className="text-center text-muted py-4">No e-signatures sent yet</div>
                    ) : (
                      <ResponsiveContainer width="100%" height={195}>
                        <PieChart>
                          <Pie data={sig.status.filter((s: any) => s.value > 0)} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={42} outerRadius={70} paddingAngle={0} stroke="none">
                            {sig.status.filter((s: any) => s.value > 0).map((_: any, i: number) => <Cell key={i} fill={statusColors[i % statusColors.length]} />)}
                          </Pie>
                          <Tooltip content={<ChartTooltip />} />
                          <Legend verticalAlign="bottom" iconType="circle" wrapperStyle={{ fontSize: 10.5, paddingTop: 2 }} />
                        </PieChart>
                      </ResponsiveContainer>
                    )}
                  </CardBody>
                </Card>
              </Col>

              <Col xl={4} md={6}>
                <Card style={cardStyle}>
                  <div style={cardHeaderStyle}>
                    <div>
                      <h5 style={{ fontWeight: 700, fontSize: 14, color: 'var(--vz-heading-color, var(--vz-body-color))', margin: 0 }}>Signatures by Document</h5>
                      <p style={{ margin: 0, fontSize: 11, color: 'var(--vz-secondary-color)', marginTop: 2 }}>Quotation · PI · agreement · trade doc</p>
                    </div>
                  </div>
                  <CardBody style={{ padding: '8px 12px 4px' }}>
                    {sig.total === 0 ? (
                      <div className="text-center text-muted py-4">No e-signatures sent yet</div>
                    ) : (
                      <ResponsiveContainer width="100%" height={195}>
                        <BarChart data={sig.by_type} layout="vertical" margin={{ top: 5, right: 18, left: 8, bottom: 0 }}>
                          <defs>
                            <linearGradient id="clmTypeBar" x1="0" y1="0" x2="1" y2="0">
                              <stop offset="0%" stopColor="#8b5cf6" /><stop offset="100%" stopColor="#6d28d9" />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} horizontal={false} />
                          <XAxis type="number" tick={{ fontSize: 10, fill: ct.axisTickMuted }} axisLine={false} tickLine={false} allowDecimals={false} />
                          <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: ct.axisTick, fontWeight: 600 }} axisLine={false} tickLine={false} width={90} />
                          <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(109,40,217,0.06)' }} />
                          <Bar dataKey="count" fill="url(#clmTypeBar)" radius={[0, 6, 6, 0]} barSize={18} />
                        </BarChart>
                      </ResponsiveContainer>
                    )}
                  </CardBody>
                </Card>
              </Col>

              <Col xl={4} md={12}>
                <Card style={cardStyle}>
                  <div style={cardHeaderStyle}>
                    <div>
                      <h5 style={{ fontWeight: 700, fontSize: 14, color: 'var(--vz-heading-color, var(--vz-body-color))', margin: 0 }}>Compliance Library</h5>
                      <p style={{ margin: 0, fontSize: 11, color: 'var(--vz-secondary-color)', marginTop: 2 }}>Document types configured</p>
                    </div>
                  </div>
                  <CardBody style={{ padding: '10px 12px' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                      {clm.library.map((l: any, i: number) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '7px 9px', borderRadius: 9, background: 'var(--vz-secondary-bg, #f3f3f9)', border: '1px solid var(--vz-border-color)' }}>
                          <div style={{ width: 26, height: 26, borderRadius: 7, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: libGrad[l.icon] || 'linear-gradient(135deg,#6691e7,#405189)', color: '#fff', fontSize: 13 }}>
                            <i className={libIcon[l.icon] || 'ri-file-line'}></i>
                          </div>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--vz-heading-color, var(--vz-body-color))', lineHeight: 1 }}>{l.count}</div>
                            <div style={{ fontSize: 9.5, color: 'var(--vz-secondary-color)', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.name}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardBody>
                </Card>
              </Col>
            </Row>
          </>
        );
      })()}

      {/* ── Workforce analytics ────────────────────────────────────────
          Headcount snapshot below the sales section, same branch scoping. */}
      {emp && (
        <>
          <Row className="mb-1">
            <Col xs={12}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', padding: '2px 0 6px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 13 }}>
                  <div style={{
                    width: 36, height: 36, borderRadius: 11, flexShrink: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: 'linear-gradient(135deg,#9b72cf,#865ce2)', color: '#fff', fontSize: 17,
                    boxShadow: '0 10px 22px -8px rgba(134,92,226,0.6)',
                  }}>
                    <i className="ri-team-line"></i>
                  </div>
                  <div>
                    <h5 style={{ fontWeight: 800, fontSize: 15, color: 'var(--vz-heading-color, var(--vz-body-color))', margin: 0, letterSpacing: '-0.01em' }}>Workforce Analytics</h5>
                    <p style={{ margin: 0, fontSize: 12, color: 'var(--vz-secondary-color)', marginTop: 2 }}>
                      Employee headcount, hiring activity and demographics
                      {!hrOpen && <> · <b>{emp.totals.total}</b> employees · <b>{emp.totals.active}</b> active</>}
                    </p>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  {/* Plan pill leads in the Sales header; fall back here only if
                      the sales block is absent (stale pre-deploy cache). */}
                  {!sales && planPill}
                  <button onClick={() => setHrOpen(o => !o)} className="bd-section-toggle" style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 15px', borderRadius: 10,
                    border: '1px solid var(--vz-border-color)', background: 'var(--vz-card-bg)',
                    color: 'var(--vz-secondary-color)', fontSize: 12, fontWeight: 700, cursor: 'pointer',
                  }}>
                    {hrOpen ? 'Hide details' : 'Show details'}
                    <i className={hrOpen ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} style={{ fontSize: 16 }}></i>
                  </button>
                </div>
              </div>
            </Col>
          </Row>

          {hrOpen && (
          <>
          {/* Workforce KPI cards */}
          <Row className="g-2 mb-2">
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
          <Row className="g-2 mb-2">
            <Col xl={4} md={6}>
              <Card style={cardStyle}>
                <div style={cardHeaderStyle}>
                  <div>
                    <h5 style={{ fontWeight: 700, fontSize: 14, color: 'var(--vz-heading-color, var(--vz-body-color))', margin: 0 }}>Status Breakdown</h5>
                    <p style={{ margin: 0, fontSize: 11, color: 'var(--vz-secondary-color)', marginTop: 2 }}>Where everyone stands</p>
                  </div>
                </div>
                <CardBody style={{ padding: '4px 2px 0' }}>
                  <ResponsiveContainer width="100%" height={195}>
                    <PieChart>
                      <Pie
                        data={emp.status.filter((s: any) => s.value > 0)}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        innerRadius={48}
                        outerRadius={80}
                        // Don't draw a stroke and don't gap the slices —
                        // a 100% segment becomes a perfectly clean ring,
                        // and multi-segment donuts have edges that touch
                        // directly instead of being separated by a thin
                        // white seam. The fill colors are already saturated
                        // enough to read as distinct slices.
                        paddingAngle={0}
                        stroke="none"
                      >
                        {emp.status.map((_: any, i: number) => (
                          <Cell key={i} fill={['#0ab39c', '#878a99', '#f7b84b', '#9b72cf', '#f06548', '#6c7080', '#dc3545'][i % 7]} />
                        ))}
                      </Pie>
                      <Tooltip content={<ChartTooltip />} />
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
                    <h5 style={{ fontWeight: 700, fontSize: 14, color: 'var(--vz-heading-color, var(--vz-body-color))', margin: 0 }}>Joining Trend</h5>
                    <p style={{ margin: 0, fontSize: 11, color: 'var(--vz-secondary-color)', marginTop: 2 }}>Last 6 months</p>
                  </div>
                </div>
                <CardBody style={{ padding: '8px 12px 4px' }}>
                  <ResponsiveContainer width="100%" height={195}>
                    <BarChart data={emp.joining_trend} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                      <defs>
                        {/* Glossy navy bar — full saturation at top fades
                           to 0.7 at bottom + 0.95 highlight at the very top
                           so the bar reads as a polished surface, not a
                           flat brick. */}
                        <linearGradient id="branchJoinBar" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%"   stopColor="#5b6da3" />
                          <stop offset="35%"  stopColor="#405189" />
                          <stop offset="100%" stopColor="#2c3a6a" />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} vertical={false} />
                      <XAxis dataKey="month" tick={{ fontSize: 11, fill: ct.axisTickMuted, fontWeight: 600 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 10, fill: ct.axisTickMuted }} axisLine={false} tickLine={false} width={30} allowDecimals={false} />
                      <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(64,81,137,0.06)' }} />
                      <Bar dataKey="count" fill="url(#branchJoinBar)" radius={[6, 6, 0, 0]} barSize={26} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardBody>
              </Card>
            </Col>

            <Col xl={4} md={12}>
              <Card style={cardStyle}>
                <div style={cardHeaderStyle}>
                  <div>
                    <h5 style={{ fontWeight: 700, fontSize: 14, color: 'var(--vz-heading-color, var(--vz-body-color))', margin: 0 }}>Gender Diversity</h5>
                    <p style={{ margin: 0, fontSize: 11, color: 'var(--vz-secondary-color)', marginTop: 2 }}>Composition</p>
                  </div>
                </div>
                <CardBody style={{ padding: '4px 2px 0' }}>
                  <ResponsiveContainer width="100%" height={195}>
                    <PieChart>
                      <Pie
                        data={emp.gender.filter((g: any) => g.value > 0)}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        innerRadius={46}
                        outerRadius={74}
                        paddingAngle={0}
                        stroke="none"
                      >
                        {emp.gender.filter((g: any) => g.value > 0).map((_: any, i: number) => (
                          <Cell key={i} fill={['#3577e5', '#f06548', '#9b72cf'][i % 3]} />
                        ))}
                      </Pie>
                      <Tooltip content={<ChartTooltip />} />
                      <Legend
                        verticalAlign="bottom"
                        iconType="circle"
                        wrapperStyle={{ fontSize: 11, paddingTop: 4 }}
                        formatter={(value: any, entry: any) => `${value}: ${entry?.payload?.value ?? ''}`}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </CardBody>
              </Card>
            </Col>
          </Row>

          {/* Department headcount + Top designations */}
          <Row className="g-2 mb-2">
            <Col xl={7} md={12}>
              <Card style={cardStyle}>
                <div style={cardHeaderStyle}>
                  <div>
                    <h5 style={{ fontWeight: 700, fontSize: 14, color: 'var(--vz-heading-color, var(--vz-body-color))', margin: 0 }}>Headcount by Department</h5>
                    <p style={{ margin: 0, fontSize: 11, color: 'var(--vz-secondary-color)', marginTop: 2 }}>Top {emp.by_department.length}</p>
                  </div>
                </div>
                <CardBody style={{ padding: '8px 12px 4px' }}>
                  {emp.by_department.length === 0 ? (
                    <div className="text-center text-muted py-4">No departments configured</div>
                  ) : (
                    <ResponsiveContainer width="100%" height={Math.max(170, emp.by_department.length * 30)}>
                      <BarChart data={emp.by_department} layout="vertical" margin={{ top: 5, right: 16, left: 8, bottom: 0 }}>
                        <defs>
                          {/* Horizontal bar — gradient runs left→right so
                             the "filled" end of the bar reads brightest. */}
                          <linearGradient id="branchDeptBar" x1="0" y1="0" x2="1" y2="0">
                            <stop offset="0%"   stopColor="#7c5fb8" />
                            <stop offset="100%" stopColor="#9b72cf" />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} horizontal={false} />
                        <XAxis type="number" tick={{ fontSize: 10, fill: ct.axisTickMuted }} axisLine={false} tickLine={false} allowDecimals={false} />
                        <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: ct.axisTick, fontWeight: 600 }} axisLine={false} tickLine={false} width={120} />
                        <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(155,114,207,0.06)' }} />
                        <Bar dataKey="count" fill="url(#branchDeptBar)" radius={[0, 6, 6, 0]} barSize={20} />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </CardBody>
              </Card>
            </Col>

            <Col xl={5} md={12}>
              <Card style={cardStyle}>
                <div style={cardHeaderStyle}>
                  <div>
                    <h5 style={{ fontWeight: 700, fontSize: 14, color: 'var(--vz-heading-color, var(--vz-body-color))', margin: 0 }}>Top Designations</h5>
                    <p style={{ margin: 0, fontSize: 11, color: 'var(--vz-secondary-color)', marginTop: 2 }}>Most common roles</p>
                  </div>
                </div>
                <CardBody className="dash-scroll" style={{ padding: 0, maxHeight: 340 }}>
                  {emp.by_designation.length === 0 ? (
                    <div className="text-center text-muted py-4">No designations configured</div>
                  ) : emp.by_designation.map((d: any, i: number) => {
                    const max = emp.by_designation[0].count || 1;
                    const pct = Math.round((d.count / max) * 100);
                    return (
                      <div key={i} className="bd-list-row" style={{ padding: '9px 16px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                            <div style={{
                              width: 28, height: 28, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center',
                              // Diagonal gradient + soft drop-shadow so the
                              // rank tile reads as a polished chip rather
                              // than a flat colour block.
                              background: [
                                'linear-gradient(135deg,#5b6da3,#2c3a6a)',
                                'linear-gradient(135deg,#22c8a9,#089d7a)',
                                'linear-gradient(135deg,#b58fe0,#7c5fb8)',
                                'linear-gradient(135deg,#fbc763,#e89a1d)',
                                'linear-gradient(135deg,#5fb8ef,#1976c2)',
                              ][i % 5],
                              color: '#fff', fontWeight: 800, fontSize: 11, flexShrink: 0,
                              boxShadow: '0 4px 10px rgba(15,23,42,0.18)',
                            }}>{i + 1}</div>
                            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--vz-heading-color, var(--vz-body-color))', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {d.name}
                            </div>
                          </div>
                          <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--vz-heading-color, var(--vz-body-color))', flexShrink: 0, marginLeft: 8 }}>{d.count}</div>
                        </div>
                        <div style={{ height: 6, background: ct.grid, borderRadius: 999, overflow: 'hidden' }}>
                          <div style={{
                            width: `${pct}%`,
                            height: '100%',
                            // Match the rank-tile gradient so the row reads
                            // as a single coloured object instead of two.
                            background: [
                              'linear-gradient(90deg,#5b6da3,#2c3a6a)',
                              'linear-gradient(90deg,#22c8a9,#089d7a)',
                              'linear-gradient(90deg,#b58fe0,#7c5fb8)',
                              'linear-gradient(90deg,#fbc763,#e89a1d)',
                              'linear-gradient(90deg,#5fb8ef,#1976c2)',
                            ][i % 5],
                            borderRadius: 999,
                            transition: 'width 0.4s ease',
                            boxShadow: '0 1px 4px rgba(15,23,42,0.12)',
                          }} />
                        </div>
                      </div>
                    );
                  })}
                </CardBody>
              </Card>
            </Col>
          </Row>

          {/* Tenure + Age + Upcoming events */}
          <Row className="g-2 mb-2">
            <Col xl={4} md={6}>
              <Card style={cardStyle}>
                <div style={cardHeaderStyle}>
                  <div>
                    <h5 style={{ fontWeight: 700, fontSize: 14, color: 'var(--vz-heading-color, var(--vz-body-color))', margin: 0 }}>Tenure Distribution</h5>
                    <p style={{ margin: 0, fontSize: 11, color: 'var(--vz-secondary-color)', marginTop: 2 }}>Time at company</p>
                  </div>
                </div>
                <CardBody style={{ padding: '8px 12px 4px' }}>
                  <ResponsiveContainer width="100%" height={185}>
                    <BarChart data={emp.tenure} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="branchTenureBar" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%"   stopColor="#22c8a9" />
                          <stop offset="100%" stopColor="#089d7a" />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} vertical={false} />
                      <XAxis dataKey="name" tick={{ fontSize: 10, fill: ct.axisTickMuted, fontWeight: 600 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 10, fill: ct.axisTickMuted }} axisLine={false} tickLine={false} width={30} allowDecimals={false} />
                      <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(10,179,156,0.06)' }} />
                      <Bar dataKey="count" fill="url(#branchTenureBar)" radius={[6, 6, 0, 0]} barSize={28} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardBody>
              </Card>
            </Col>

            <Col xl={4} md={6}>
              <Card style={cardStyle}>
                <div style={cardHeaderStyle}>
                  <div>
                    <h5 style={{ fontWeight: 700, fontSize: 14, color: 'var(--vz-heading-color, var(--vz-body-color))', margin: 0 }}>Age Distribution</h5>
                    <p style={{ margin: 0, fontSize: 11, color: 'var(--vz-secondary-color)', marginTop: 2 }}>Demographics</p>
                  </div>
                </div>
                <CardBody style={{ padding: '8px 12px 4px' }}>
                  <ResponsiveContainer width="100%" height={185}>
                    <BarChart data={emp.age_distribution} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="branchAgeBar" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%"   stopColor="#fbc763" />
                          <stop offset="100%" stopColor="#e89a1d" />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} vertical={false} />
                      <XAxis dataKey="name" tick={{ fontSize: 10, fill: ct.axisTickMuted, fontWeight: 600 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 10, fill: ct.axisTickMuted }} axisLine={false} tickLine={false} width={30} allowDecimals={false} />
                      <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(247,184,75,0.08)' }} />
                      <Bar dataKey="count" fill="url(#branchAgeBar)" radius={[6, 6, 0, 0]} barSize={28} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardBody>
              </Card>
            </Col>

            <Col xl={4} md={12}>
              <Card style={cardStyle}>
                <div style={cardHeaderStyle}>
                  <div>
                    <h5 style={{ fontWeight: 700, fontSize: 14, color: 'var(--vz-heading-color, var(--vz-body-color))', margin: 0 }}>Upcoming Events</h5>
                    <p style={{ margin: 0, fontSize: 11, color: 'var(--vz-secondary-color)', marginTop: 2 }}>Next 30 days</p>
                  </div>
                </div>
                <CardBody className="dash-scroll" style={{ padding: 0, maxHeight: 300 }}>
                  {emp.upcoming_events.length === 0 ? (
                    <div className="text-center text-muted py-4">Nothing in the next 30 days</div>
                  ) : emp.upcoming_events.map((e: any, i: number) => {
                    const cfg = e.kind === 'birthday'
                      ? { color: '#f06548', icon: 'ri-cake-2-line', bg: '#f0654818', label: 'Birthday' }
                      : { color: '#0ab39c', icon: 'ri-medal-line',  bg: '#0ab39c18', label: `${e.years || ''} yr${e.years === 1 ? '' : 's'}`.trim() };
                    return (
                      <div key={i} className="bd-list-row" style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '9px 16px',
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
        </>
      )}
    </>
  );
}
