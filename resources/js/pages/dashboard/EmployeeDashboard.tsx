import { useEffect, useState } from 'react';
import { Card, CardBody, Col, Row, Modal, ModalBody, ModalFooter } from 'reactstrap';
import { PieChart, Pie, Cell, AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import api from '../../api';
import { useAuth } from '../../contexts/AuthContext';
import { ShimmerDashboard } from '../../components/ui/Shimmer';
import { formatCurrencyCompact as formatINRCompact } from '../../utils/formatNumber';
import { useChartTheme } from '../../hooks/useChartTheme';
import { ChartTooltip } from './DashboardSections';
// Announcement detail popup reuses the master form-modal shell (20px radius,
// gradient header, tinted body, pill Close) so it matches the master popups.
import { MasterFormStyles } from '../master/masterFormKit';

/* ───────────────────────────────────────────────────────────────────────────
 *  Employee Dashboard — personal landing page for `user_type === 'employee'`.
 *
 *  Mirrors the chrome of ClientDashboard / BranchDashboard (KPI cards, card
 *  styles, INR compaction, animated counts) so the three dashboards read as
 *  a single visual family. All data comes from /api/dashboard/employee-stats
 *  which is auto-scoped to the current logged-in employee.
 * ───────────────────────────────────────────────────────────────────────── */

function AnimatedNumber({ value, prefix = '', suffix = '' }: { value: number; prefix?: string; suffix?: string }) {
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    // Round defensively — counts must be whole numbers. A float (e.g. a
    // Carbon diffInDays of 131.404) would otherwise render "131.404".
    const target = Math.round(Number(value) || 0);
    if (target === 0) { setDisplay(0); return; }
    let start = 0;
    const duration = 1100;
    const ticks = 50;
    const step = Math.max(1, Math.ceil(target / ticks));
    const interval = duration / ticks;
    const id = setInterval(() => {
      start += step;
      if (start >= target) { setDisplay(target); clearInterval(id); }
      else setDisplay(start);
    }, interval);
    return () => clearInterval(id);
  }, [value]);
  return <>{prefix}{display.toLocaleString()}{suffix}</>;
}

interface KpiProps {
  label: string;
  value: React.ReactNode;
  iconClass: string;
  gradient: string;
  hint?: string;
}

/**
 * Stat-only KPI tile. Intentionally not clickable — employees have a
 * restricted nav, so routing them off the dashboard could land them on
 * a page they don't have permission to view. The hover effect is purely
 * visual polish (subtle lift + stronger shadow), no routing attached.
 *
 * Theme-aware white: `var(--vz-card-bg)` resolves to `#fff` in the light
 * theme and to the dark surface token in `[data-bs-theme="dark"]`.
 */
function KpiCard({ label, value, iconClass, gradient, hint }: KpiProps) {
  return (
    <div
      className="emp-kpi"
      style={{
        // Radius + shadow are kept identical to `cardStyle` (the shared surface
        // used by every other card on this dashboard) so the tiles sit in the
        // same visual system rather than looking like a separate component.
        borderRadius: 18,
        padding: '16px 18px 14px',
        boxShadow: '0 1px 2px rgba(16,24,40,0.05), 0 14px 34px -18px rgba(64,81,137,0.26)',
        border: '1px solid var(--vz-border-color)',
        // Surface colour is NOT set here on purpose — see the `.emp-kpi` rule in
        // the style block below. An inline background would beat the class, and
        // var(--vz-card-bg) does not resolve to white on a plain div (only
        // inside a .card), which is what left these tiles looking grey next to
        // the white Compensation card.
        position: 'relative',
        overflow: 'hidden',
        height: '100%',
        transition: 'transform .18s ease, box-shadow .18s ease, border-color .18s ease',
      }}
      onMouseEnter={e => {
        const el = e.currentTarget as HTMLDivElement;
        el.style.transform = 'translateY(-3px)';
        el.style.boxShadow = '0 1px 2px rgba(16,24,40,0.05), 0 20px 38px -14px rgba(64,81,137,0.4)';
        el.style.borderColor = 'rgba(102,145,231,0.45)';
      }}
      onMouseLeave={e => {
        const el = e.currentTarget as HTMLDivElement;
        el.style.transform = 'translateY(0)';
        el.style.boxShadow = '0 1px 2px rgba(16,24,40,0.05), 0 14px 30px -16px rgba(64,81,137,0.28)';
        el.style.borderColor = 'var(--vz-border-color)';
      }}
    >
      {/* Colour identity comes from the left rail and the icon tile only — the
          card surface itself stays flat var(--vz-card-bg) so it matches the
          other dashboard cards. A faint corner glow used to tint it here. */}
      {/* Glossy accent rail down the left edge (replaces the flat top border). */}
      <div style={{ position: 'absolute', top: 12, bottom: 12, left: 0, width: 3, borderRadius: '0 4px 4px 0', background: gradient }} />
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, position: 'relative', zIndex: 1 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--vz-secondary-color)', letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: 7 }}>{label}</p>
          <h3 style={{
            fontSize: 'clamp(20px, 1.8vw, 26px)',
            fontWeight: 800,
            color: 'var(--vz-heading-color, var(--vz-body-color))',
            margin: 0, lineHeight: 1, letterSpacing: '-0.02em',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {value}
          </h3>
          {hint && <div style={{ marginTop: 7, fontSize: 11, color: 'var(--vz-secondary-color)' }}>{hint}</div>}
        </div>
        <div style={{
          width: 40, height: 40, borderRadius: 11,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: gradient, flexShrink: 0,
          // Coloured glow + inset highlight so the icon lifts off the card.
          boxShadow: '0 7px 14px -6px rgba(64,81,137,0.45), inset 0 1px 0 rgba(255,255,255,0.25)',
        }}>
          <i className={iconClass} style={{ fontSize: 18, color: '#fff' }} />
        </div>
      </div>
    </div>
  );
}

const cardStyle: React.CSSProperties = {
  borderRadius: 18,
  border: '1px solid var(--vz-border-color)',
  // Layered "floating glass" shadow — a tight contact shadow plus a wide soft
  // lift, identical to the Branch/Client dashboards so all three read as one
  // premium surface system instead of a flat list of boxes.
  boxShadow: '0 1px 2px rgba(16,24,40,0.05), 0 14px 34px -18px rgba(64,81,137,0.26)',
  overflow: 'hidden',
  marginBottom: 0,
  height: '100%',
};
const cardHeaderStyle: React.CSSProperties = {
  // Faint top-down wash so the header reads as its own band without a hard
  // divider line — softer and more premium than a flat header.
  background: 'linear-gradient(180deg, rgba(64,81,137,0.05), rgba(64,81,137,0))',
  borderBottom: '1px solid var(--vz-border-color)',
  padding: '13px 18px',
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
};

interface OverviewMe {
  employee_id: number | null;
  display_name: string;
  emp_code: string | null;
  photo_url: string | null;
  status: string;
  department_name: string | null;
  designation_name: string | null;
  manager_id: number | null;
  manager_name: string | null;
  manager_photo: string | null;
  date_of_joining: string | null;
  email: string | null;
  mobile: string | null;
  profile_completion_pct: number;
}

interface OverviewData {
  me: OverviewMe;
  kpis: {
    my_expenses_pending: number;
    my_expenses_approved: number;
    my_expenses_rejected: number;
    approvals_pending: number;
    team_size: number;
    days_since_joining: number | null;
  };
  compensation: { annual_salary: number | null; salary_frequency: string | null; salary_structure: string | null; tax_regime: string | null; effective_from: string | null } | null;
  recent_expenses: Array<{ id: number; claim_no: string; title: string; category: string; amount: number; currency: string; expense_date: string | null; status: string }>;
  pending_approvals: Array<{ id: number; claim_no: string; title: string; category: string; amount: number; currency: string; filed_by: string | null; emp_code: string | null; created_at: string | null }>;
  team_kind: 'reports' | 'peers' | 'department' | 'none';
  team_peers: Array<{ id: number; emp_code: string; display_name: string; photo_url: string | null; designation_name: string | null }>;
  announcements: Array<{ id: number; title: string; snippet: string; body?: string; created_at: string | null }>;
  upcoming_events: Array<{ employee_id: number; name: string; kind: 'birthday' | 'anniversary'; on: string; years: number | null }>;
  onboarding: { current_stage: number; total_stages: number; percent: number; next_label: string | null } | null;
  analytics: {
    expense_status: { approved: number; pending: number; rejected: number };
    total_claimed: number;
    expense_trend: Array<{ month: string; amount: number }>;
    attendance: { month: string; present: number; leave: number; absent: number; half_day: number; total: number; working_days?: number } | null;
    leave_by_type: Array<{ type: string; days: number }>;
    leave_status: { approved: number; pending: number; rejected: number };
  };
}

function fmtDate(s: string | null): string {
  if (!s) return '—';
  try {
    return new Date(s + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch { return s; }
}

function fmtDateShort(s: string | null): string {
  if (!s) return '—';
  try {
    return new Date(s + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
  } catch { return s; }
}

// True when the date falls on the current local calendar day — drives the
// "NEW" pill, which only flags announcements released today. created_at arrives
// as a date-only string (YYYY-MM-DD); appending T00:00:00 parses it at LOCAL
// midnight (same as the fmtDate helpers) so the comparison is timezone-safe.
function isToday(s: string | null): boolean {
  if (!s) return false;
  const d = new Date((s.includes('T') ? s : s + 'T00:00:00'));
  if (isNaN(d.getTime())) return false;
  const now = new Date();
  return d.getFullYear() === now.getFullYear()
    && d.getMonth() === now.getMonth()
    && d.getDate() === now.getDate();
}

const STATUS_PILL: Record<string, { bg: string; fg: string }> = {
  Approved: { bg: 'rgba(10,179,156,0.12)',  fg: '#0ab39c' },
  Pending:  { bg: 'rgba(247,184,75,0.14)',  fg: '#c98308' },
  Rejected: { bg: 'rgba(240,101,72,0.14)',  fg: '#f06548' },
};

function StatusPill({ status }: { status: string }) {
  const p = STATUS_PILL[status] || { bg: 'rgba(135,138,153,0.14)', fg: '#878a99' };
  return (
    <span style={{
      fontSize: 10.5, fontWeight: 700, letterSpacing: '0.04em',
      padding: '3px 9px', borderRadius: 999,
      background: p.bg, color: p.fg,
    }}>{status.toUpperCase()}</span>
  );
}

function Avatar({ src, name, size = 40 }: { src: string | null | undefined; name: string; size?: number }) {
  if (src) {
    return <img src={src} alt={name} style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />;
  }
  const initial = (name || '?').trim().charAt(0).toUpperCase();
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0,
      background: 'linear-gradient(135deg,#405189,#6691e7)',
      color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontWeight: 700, fontSize: size * 0.4,
    }}>{initial}</div>
  );
}

function EmptyState({ icon, text }: { icon: string; text: string }) {
  return (
    <div className="text-center text-muted py-4">
      <i className={icon} style={{ fontSize: 32, opacity: 0.5 }} />
      <div className="mt-2" style={{ fontSize: 12.5 }}>{text}</div>
    </div>
  );
}

type Slice = { name: string; value: number; color: string };

/** Donut with a value + label floating in the hole, plus a centred legend.
 *  Segments use a vertical gradient + rounded caps for a modern, glossy look.
 *  `gid` must be unique per donut on the page (gradient defs share the DOM). */
function Donut({ slices, center, centerLabel, prefix = '', gid }: { slices: Slice[]; center: React.ReactNode; centerLabel: string; prefix?: string; gid: string }) {
  return (
    <>
      <div style={{ position: 'relative', width: '100%', height: 168 }}>
        <ResponsiveContainer width="100%" height={168}>
          <PieChart>
            <defs>
              {slices.map((s, i) => (
                <linearGradient key={i} id={`donut-${gid}-${i}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={s.color} stopOpacity={1} />
                  <stop offset="100%" stopColor={s.color} stopOpacity={0.68} />
                </linearGradient>
              ))}
            </defs>
            <Pie data={slices} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={50} outerRadius={72} paddingAngle={slices.length > 1 ? 3 : 0} cornerRadius={5} stroke="none">
              {slices.map((s, i) => <Cell key={i} fill={`url(#donut-${gid}-${i})`} />)}
            </Pie>
            <Tooltip content={<ChartTooltip prefix={prefix} />} />
          </PieChart>
        </ResponsiveContainer>
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
          <div style={{ fontSize: 25, fontWeight: 800, lineHeight: 1, color: 'var(--vz-heading-color, var(--vz-body-color))' }}>{center}</div>
          <div style={{ fontSize: 10, color: 'var(--vz-secondary-color)', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: 4 }}>{centerLabel}</div>
        </div>
      </div>
      <div className="d-flex flex-wrap justify-content-center gap-3 mt-1 px-2">
        {slices.map((s, i) => (
          <div key={i} className="d-flex align-items-center gap-1">
            <span style={{ width: 9, height: 9, borderRadius: 3, background: s.color, flexShrink: 0 }} />
            <span style={{ fontSize: 11.5, color: 'var(--vz-secondary-color)', fontWeight: 600 }}>{s.name}</span>
            <span style={{ fontSize: 11.5, fontWeight: 800, color: 'var(--vz-heading-color, var(--vz-body-color))' }}>{s.value}</span>
          </div>
        ))}
      </div>
    </>
  );
}

/** Card header with a gradient icon tile on the left — gives every section a
 *  designed, consistent look instead of a plain title + faint corner icon. */
function SectionHeader({ icon, gradient, title, subtitle, right }: { icon: string; gradient: string; title: string; subtitle: string; right?: React.ReactNode }) {
  return (
    <div style={cardHeaderStyle}>
      <div className="d-flex align-items-center gap-2" style={{ minWidth: 0 }}>
        <div style={{
          width: 34, height: 34, borderRadius: 10, flexShrink: 0,
          background: gradient, color: '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 7px 14px -6px rgba(64,81,137,0.5), inset 0 1px 0 rgba(255,255,255,0.25)',
        }}>
          <i className={icon} style={{ fontSize: 17 }} />
        </div>
        <div style={{ minWidth: 0 }}>
          <h6 className="mb-0 fw-bold text-truncate">{title}</h6>
          <small className="text-muted text-truncate d-block">{subtitle}</small>
        </div>
      </div>
      {right}
    </div>
  );
}

/** Translucent glass chip for the hero quick-stats strip. */
function HeroChip({ icon, text }: { icon: string; text: string }) {
  return (
    <span className="d-inline-flex align-items-center gap-1" style={{
      background: 'rgba(255,255,255,0.16)',
      border: '1px solid rgba(255,255,255,0.24)',
      backdropFilter: 'blur(4px)',
      padding: '4px 11px', borderRadius: 999,
      fontSize: 11.5, fontWeight: 600, color: '#fff',
    }}>
      <i className={icon} style={{ fontSize: 13, opacity: 0.9 }} />
      {text}
    </span>
  );
}

export default function EmployeeDashboard() {
  const { user } = useAuth();
  const ct = useChartTheme();
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  // Announcement clicked on the list → opens a modal with the full details.
  const [openAnn, setOpenAnn] = useState<OverviewData['announcements'][number] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    api.get('/dashboard/employee-stats', { signal: ctrl.signal })
      .then(r => {
        // Defensive normalization — guarantees every array is iterable
        // and every nested object has the keys the JSX touches.
        const raw = r.data || {};
        const arr = (v: any) => Array.isArray(v) ? v : [];
        setData({
          me: {
            employee_id: raw?.me?.employee_id ?? null,
            display_name: raw?.me?.display_name || user?.name || 'You',
            emp_code: raw?.me?.emp_code ?? null,
            photo_url: raw?.me?.photo_url ?? null,
            status: raw?.me?.status || 'Active',
            department_name: raw?.me?.department_name ?? null,
            designation_name: raw?.me?.designation_name ?? null,
            manager_id: raw?.me?.manager_id ?? null,
            manager_name: raw?.me?.manager_name ?? null,
            manager_photo: raw?.me?.manager_photo ?? null,
            date_of_joining: raw?.me?.date_of_joining ?? null,
            email: raw?.me?.email ?? null,
            mobile: raw?.me?.mobile ?? null,
            profile_completion_pct: Number(raw?.me?.profile_completion_pct ?? 0),
          },
          kpis: {
            my_expenses_pending:  Number(raw?.kpis?.my_expenses_pending  ?? 0),
            my_expenses_approved: Number(raw?.kpis?.my_expenses_approved ?? 0),
            my_expenses_rejected: Number(raw?.kpis?.my_expenses_rejected ?? 0),
            approvals_pending:    Number(raw?.kpis?.approvals_pending    ?? 0),
            team_size:            Number(raw?.kpis?.team_size            ?? 0),
            days_since_joining:   raw?.kpis?.days_since_joining == null ? null : Number(raw.kpis.days_since_joining),
          },
          compensation: raw?.compensation ?? null,
          recent_expenses:   arr(raw.recent_expenses),
          pending_approvals: arr(raw.pending_approvals),
          team_kind:         (raw?.team_kind === 'reports' || raw?.team_kind === 'peers' || raw?.team_kind === 'department')
                              ? raw.team_kind
                              : 'none',
          team_peers:        arr(raw.team_peers),
          announcements:     arr(raw.announcements),
          upcoming_events:   arr(raw.upcoming_events),
          onboarding:        raw?.onboarding ?? null,
          analytics: {
            expense_status: {
              approved: Number(raw?.analytics?.expense_status?.approved ?? 0),
              pending:  Number(raw?.analytics?.expense_status?.pending  ?? 0),
              rejected: Number(raw?.analytics?.expense_status?.rejected ?? 0),
            },
            total_claimed: Number(raw?.analytics?.total_claimed ?? 0),
            expense_trend: arr(raw?.analytics?.expense_trend),
            attendance:    raw?.analytics?.attendance ?? null,
            leave_by_type: arr(raw?.analytics?.leave_by_type),
            leave_status: {
              approved: Number(raw?.analytics?.leave_status?.approved ?? 0),
              pending:  Number(raw?.analytics?.leave_status?.pending  ?? 0),
              rejected: Number(raw?.analytics?.leave_status?.rejected ?? 0),
            },
          },
        });
      })
      .catch((err: any) => {
        if (err.name === 'CanceledError' || err.code === 'ERR_CANCELED') return;
        setError(err?.response?.data?.message || 'Could not load your dashboard.');
      })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [user?.id]);

  if (loading) return <ShimmerDashboard />;

  if (error) {
    return (
      <div className="p-4">
        <div style={{ ...cardStyle, padding: 32, textAlign: 'center' }}>
          <i className="ri-error-warning-line" style={{ fontSize: 40, color: '#f06548' }} />
          <h5 className="mt-3 fw-bold">Couldn't load your dashboard</h5>
          <p className="text-muted mb-0">{error}</p>
        </div>
      </div>
    );
  }
  if (!data) return null;

  const { me, kpis, compensation, recent_expenses, pending_approvals, team_kind, team_peers, announcements, upcoming_events, onboarding, analytics } = data;
  const firstName = (me.display_name || '').split(/\s+/)[0] || 'there';
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  // ── Derived chart data — each slice list drops zero buckets so the donut
  //    only draws segments that actually have a value. A card renders only
  //    when it has data, so an employee with no leave never sees an empty
  //    leave chart (show only what's valid). ────────────────────────────
  const exp = analytics.expense_status;
  const expTotal = exp.approved + exp.pending + exp.rejected;
  const expSlices: Slice[] = [
    { name: 'Approved', value: exp.approved, color: '#0ab39c' },
    { name: 'Pending',  value: exp.pending,  color: '#f7b84b' },
    { name: 'Rejected', value: exp.rejected, color: '#f06548' },
  ].filter(s => s.value > 0);

  const att = analytics.attendance;
  const attSlices: Slice[] = att ? [
    { name: 'Present',  value: att.present,  color: '#0ab39c' },
    { name: 'Leave',    value: att.leave,    color: '#7c5cfc' },
    { name: 'Half Day', value: att.half_day, color: '#f7b84b' },
    { name: 'Absent',   value: att.absent,   color: '#f06548' },
  ].filter(s => s.value > 0) : [];

  const trendHasData = analytics.expense_trend.some(t => Number(t.amount) > 0);
  const leaveByType = analytics.leave_by_type;
  const showAnalytics = expTotal > 0 || attSlices.length > 0 || trendHasData || leaveByType.length > 0;

  return (
    // No extra page padding here — the Velzon shell already wraps every page
    // in .page-content > .container-fluid. The Client/Branch dashboards add
    // none, so adding p-3/p-md-4 here would inset the employee view more than
    // its siblings. Keep the bare wrapper so all three dashboards align.
    <div>
      <style>{`
        /* Bounded scroll for list cards — when rows pile up the body scrolls
           inside the card instead of stretching the page. Thin styled bar,
           theme-aware, overscroll contained so the page behind doesn't move. */
        .emp-scroll { overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin; scrollbar-color: rgba(64,81,137,0.32) transparent; }
        .emp-scroll::-webkit-scrollbar { width: 6px; }
        .emp-scroll::-webkit-scrollbar-track { background: transparent; }
        .emp-scroll::-webkit-scrollbar-thumb { background: rgba(64,81,137,0.28); border-radius: 999px; }
        .emp-scroll::-webkit-scrollbar-thumb:hover { background: rgba(64,81,137,0.5); }
        [data-bs-theme="dark"] .emp-scroll::-webkit-scrollbar-thumb,
        [data-layout-mode="dark"] .emp-scroll::-webkit-scrollbar-thumb { background: rgba(102,145,231,0.4); }
        /* The list rows draw their own bottom border; drop it on the last row
           so a stray divider line doesn't hang under the final item. */
        .emp-list-body > div:last-child { border-bottom: none !important; }
        /* Row hover — subtle tint + left accent rail, matching the Branch /
           Client list rows so the whole dashboard family behaves the same. */
        .emp-list-body > div { transition: background .16s ease, box-shadow .16s ease; }
        .emp-list-body > div:hover { background: rgba(64,81,137,0.05); box-shadow: inset 3px 0 0 0 rgba(102,145,231,0.7); }
        [data-bs-theme="dark"] .emp-list-body > div:hover,
        [data-layout-mode="dark"] .emp-list-body > div:hover { background: rgba(255,255,255,0.04); box-shadow: inset 3px 0 0 0 rgba(102,145,231,0.9); }

        /* ── KPI tiles ─────────────────────────────────────────────────────
           Flat white surface, matching every other card on this dashboard.
           Two things used to make these read as grey: a diagonal
           white-to-transparent "glass" wash layered on top (removed), and an
           inline background of var(--vz-card-bg), which only resolves to white
           inside a .card — on a plain div it falls through to the page tint.
           Hence the literal #ffffff here with the themed surface under [dark].
           ::after is the light streak that sweeps across on hover only. */
        .emp-kpi { background: #ffffff; }
        [data-bs-theme="dark"] .emp-kpi,
        [data-layout-mode="dark"] .emp-kpi { background: var(--vz-card-bg, #1a1d29); }
        .emp-kpi::after {
          content: '';
          position: absolute;
          top: 0; bottom: 0; left: -60%;
          width: 45%;
          background: linear-gradient(105deg, transparent 0%, rgba(255,255,255,0.45) 50%, transparent 100%);
          transform: skewX(-18deg);
          pointer-events: none;
          z-index: 0;
          opacity: 0;
        }
        .emp-kpi:hover::after { animation: emp-kpi-shine 0.85s ease-out; }
        [data-bs-theme="dark"] .emp-kpi::after,
        [data-layout-mode="dark"] .emp-kpi::after {
          background: linear-gradient(105deg, transparent 0%, rgba(255,255,255,0.14) 50%, transparent 100%);
        }
        @keyframes emp-kpi-shine {
          0%   { left: -60%; opacity: 0; }
          18%  { opacity: 1; }
          100% { left: 130%; opacity: 0; }
        }
      `}</style>
      {/* ── Profile hero ───────────────────────────────────────────────── */}
      <Card style={{ ...cardStyle, marginBottom: 16, overflow: 'hidden' }}>
        <div style={{
          background: 'linear-gradient(120deg,#405189 0%,#6691e7 55%,#7c5cfc 100%)',
          color: '#fff',
          padding: '22px 24px',
          position: 'relative',
          overflow: 'hidden',
          // Glossy top edge highlight — the banner reads as polished glass.
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.35)',
        }}>
          {/* Decorative light washes — soft blurred circles bleeding off the
              top-right and bottom-left, giving the flat gradient banner depth. */}
          <div style={{ position: 'absolute', top: -60, right: -40, width: 220, height: 220, borderRadius: '50%', background: 'rgba(255,255,255,0.12)', filter: 'blur(10px)', pointerEvents: 'none' }} />
          <div style={{ position: 'absolute', bottom: -80, left: -50, width: 200, height: 200, borderRadius: '50%', background: 'rgba(124,92,252,0.30)', filter: 'blur(14px)', pointerEvents: 'none' }} />
          {/* Glossy diagonal sheen across the top-left, like light on glass. */}
          <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(158deg, rgba(255,255,255,0.20) 0%, rgba(255,255,255,0.05) 28%, rgba(255,255,255,0) 52%)', pointerEvents: 'none' }} />
          <Row className="align-items-center g-3" style={{ position: 'relative', zIndex: 1 }}>
            <Col xs="auto">
              <div style={{
                width: 84, height: 84, borderRadius: '50%',
                background: 'rgba(255,255,255,0.18)',
                border: '3px solid rgba(255,255,255,0.32)',
                padding: 3, flexShrink: 0,
                boxShadow: '0 8px 22px rgba(0,0,0,0.18)',
              }}>
                {me.photo_url ? (
                  <img src={me.photo_url} alt={me.display_name}
                    style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} />
                ) : (
                  <div style={{
                    width: '100%', height: '100%', borderRadius: '50%',
                    background: 'rgba(255,255,255,0.10)',
                    color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 32, fontWeight: 800, letterSpacing: '-0.02em',
                  }}>
                    {(me.display_name || '?').trim().charAt(0).toUpperCase()}
                  </div>
                )}
              </div>
            </Col>
            <Col>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.78)', fontWeight: 500, letterSpacing: '0.03em' }}>
                {greet}, {firstName}
              </div>
              <h3 className="text-white mb-1 fw-bold" style={{ fontSize: 22, letterSpacing: '-0.01em' }}>
                {me.display_name}
              </h3>
              <div className="d-flex flex-wrap align-items-center gap-2" style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.92)' }}>
                {me.emp_code && (
                  <span style={{ background: 'rgba(255,255,255,0.18)', padding: '3px 10px', borderRadius: 999, fontWeight: 600 }}>
                    {me.emp_code}
                  </span>
                )}
                {me.designation_name && <span>· {me.designation_name}</span>}
                {me.department_name && <span>· {me.department_name}</span>}
                {me.date_of_joining && <span>· Joined {fmtDate(me.date_of_joining)}</span>}
              </div>
              {/* Quick-stat glass chips — give the hero an at-a-glance,
                  engaging feel instead of just a name banner. */}
              {(() => {
                const chips = [
                  att && (att.working_days ?? 0) > 0 ? { icon: 'ri-calendar-check-line', text: `${Math.min(100, Math.round((att.present / (att.working_days as number)) * 100))}% present` } : null,
                  analytics.total_claimed > 0 ? { icon: 'ri-bill-line', text: `${formatINRCompact(analytics.total_claimed)} claimed` } : null,
                  kpis.team_size > 0 ? { icon: 'ri-team-line', text: `${kpis.team_size} in team` } : null,
                  kpis.days_since_joining != null ? { icon: 'ri-time-line', text: `${kpis.days_since_joining} days here` } : null,
                ].filter(Boolean) as Array<{ icon: string; text: string }>;
                return chips.length ? (
                  <div className="d-flex flex-wrap align-items-center gap-2 mt-3">
                    {chips.map((c, i) => <HeroChip key={i} icon={c.icon} text={c.text} />)}
                  </div>
                ) : null;
              })()}
            </Col>
          </Row>
        </div>

        {/* Manager strip — the profile-completion bar lived here too, but
            removed: the dedicated Onboarding strip below already shows a
            progress bar when setup is incomplete, so showing both reads
            as duplicate. */}
        {me.manager_name && (
          <div className="d-flex flex-wrap align-items-center gap-2" style={{ padding: '14px 22px', background: 'var(--vz-card-bg)' }}>
            <Avatar src={me.manager_photo} name={me.manager_name} size={36} />
            <div>
              <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--vz-secondary-color)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                Reporting Manager
              </div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--vz-heading-color, var(--vz-body-color))' }}>
                {me.manager_name}
              </div>
            </div>
          </div>
        )}
      </Card>

      {/* ── Onboarding progress (only while incomplete) ─────────────────── */}
      {onboarding && (
        <Card style={{
          ...cardStyle, marginBottom: 16,
          // Layer the violet tint on top of the theme-aware card bg so the
          // strip still reads as a card (and not as transparent body) in
          // dark mode where rgba(124,92,252,0.06) over dark renders ~black.
          background: 'linear-gradient(135deg, rgba(124,92,252,0.10), rgba(167,139,250,0.06)), var(--vz-card-bg)',
          border: '1px solid rgba(124,92,252,0.28)',
        }}>
          <CardBody>
            <div className="d-flex flex-wrap align-items-center justify-content-between gap-3">
              <div className="d-flex align-items-center gap-3">
                <div style={{
                  width: 44, height: 44, borderRadius: 12,
                  background: 'linear-gradient(135deg,#7c5cfc,#a78bfa)',
                  color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  boxShadow: '0 8px 18px rgba(124,92,252,0.30)',
                }}>
                  <i className="ri-rocket-2-line" style={{ fontSize: 20 }} />
                </div>
                <div>
                  <h6 className="mb-0 fw-bold">Finish setting up your profile</h6>
                  <small className="text-muted">
                    Stage {onboarding.current_stage} of {onboarding.total_stages}
                    {onboarding.next_label ? ` — next: ${onboarding.next_label}` : ''}
                  </small>
                </div>
              </div>
              <div style={{ minWidth: 200 }}>
                <div className="d-flex justify-content-between mb-1">
                  <span style={{ fontSize: 11, color: 'var(--vz-secondary-color)', fontWeight: 600 }}>Progress</span>
                  <span style={{ fontSize: 12, color: '#7c5cfc', fontWeight: 800 }}>{onboarding.percent}%</span>
                </div>
                <div style={{ height: 8, background: 'var(--vz-border-color)', borderRadius: 999, overflow: 'hidden' }}>
                  <div style={{ width: `${onboarding.percent}%`, height: '100%', background: 'linear-gradient(90deg,#7c5cfc,#a78bfa)' }} />
                </div>
              </div>
            </div>
          </CardBody>
        </Card>
      )}

      {/* ── KPI strip ───────────────────────────────────────────────────── */}
      <Row className="g-3 mb-3">
        <Col xs={6} md={4} lg={2}>
          <KpiCard
            label="Pending Claims"
            value={<AnimatedNumber value={kpis.my_expenses_pending} />}
            iconClass="ri-time-line"
            gradient="linear-gradient(135deg,#f7b84b,#fad07e)"
            hint="Mine awaiting approval"
          />
        </Col>
        <Col xs={6} md={4} lg={2}>
          <KpiCard
            label="Approved Claims"
            value={<AnimatedNumber value={kpis.my_expenses_approved} />}
            iconClass="ri-checkbox-circle-line"
            gradient="linear-gradient(135deg,#0ab39c,#3dd6c3)"
            hint="Cleared end-to-end"
          />
        </Col>
        <Col xs={6} md={4} lg={2}>
          <KpiCard
            label="Rejected Claims"
            value={<AnimatedNumber value={kpis.my_expenses_rejected} />}
            iconClass="ri-close-circle-line"
            gradient="linear-gradient(135deg,#f06548,#ff9e7c)"
            hint="Returned with notes"
          />
        </Col>
        <Col xs={6} md={4} lg={2}>
          <KpiCard
            label="To Approve"
            value={<AnimatedNumber value={kpis.approvals_pending} />}
            iconClass="ri-shield-check-line"
            gradient="linear-gradient(135deg,#7c5cfc,#a993fd)"
            hint="As reporting manager"
          />
        </Col>
        <Col xs={6} md={4} lg={2}>
          <KpiCard
            label="Team Size"
            value={<AnimatedNumber value={kpis.team_size} />}
            iconClass="ri-team-line"
            gradient="linear-gradient(135deg,#405189,#6691e7)"
            hint="In your department"
          />
        </Col>
        <Col xs={6} md={4} lg={2}>
          <KpiCard
            label="Days at Company"
            value={kpis.days_since_joining == null ? '—' : <AnimatedNumber value={kpis.days_since_joining} />}
            iconClass="ri-calendar-line"
            gradient="linear-gradient(135deg,#299cdb,#63bcec)"
            hint={me.date_of_joining ? `Since ${fmtDate(me.date_of_joining)}` : 'Joining date not set'}
          />
        </Col>
      </Row>

      {/* ── Compensation strip (only if payroll enabled) ────────────────── */}
      {compensation && compensation.annual_salary != null && (
        <Card style={{ ...cardStyle, marginBottom: 16 }}>
          <CardBody style={{ padding: '14px 18px' }}>
            <Row className="g-2 align-items-center">
              <Col xs={12} md={3}>
                <div className="d-flex align-items-center gap-2">
                  <div style={{
                    width: 40, height: 40, borderRadius: 12, flexShrink: 0,
                    background: 'linear-gradient(135deg,#0ab39c,#02c8a7)', color: '#fff',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    boxShadow: '0 7px 14px -6px rgba(10,179,156,0.5), inset 0 1px 0 rgba(255,255,255,0.25)',
                  }}>
                    <i className="ri-wallet-3-line" style={{ fontSize: 19 }} />
                  </div>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--vz-secondary-color)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                      Compensation
                    </div>
                    <div style={{ fontSize: 12.5, color: 'var(--vz-secondary-color)' }}>Snapshot from your payroll record</div>
                  </div>
                </div>
              </Col>
              <Col xs={12} md={9} className="text-md-end">
                <div style={{ fontSize: 11, color: 'var(--vz-secondary-color)', fontWeight: 600, marginBottom: 2 }}>Annual</div>
                <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--vz-heading-color, var(--vz-body-color))' }}>
                  {formatINRCompact(compensation.annual_salary)}
                </div>
              </Col>
            </Row>
          </CardBody>
        </Card>
      )}

      {/* ── Analytics charts — donuts + trend. Each card renders only when
           it has real data, so the row shows only what's valid for this
           employee (no empty leave/attendance charts). ──────────────────── */}
      {showAnalytics && (
        <Row className="g-3 mb-3">
          {/* Expense Claims — status donut */}
          {expTotal > 0 && (
            <Col xs={12} md={6} xl={4}>
              <Card style={cardStyle}>
                <SectionHeader
                  icon="ri-bill-line" gradient="linear-gradient(135deg,#0ab39c,#3dd6c3)"
                  title="Expense Claims" subtitle="Status of all your claims"
                  right={(
                    <div className="text-end">
                      <div style={{ fontSize: 15, fontWeight: 800, color: '#0ab39c' }}>{formatINRCompact(analytics.total_claimed)}</div>
                      <div style={{ fontSize: 10, color: 'var(--vz-secondary-color)', fontWeight: 600 }}>CLAIMED</div>
                    </div>
                  )}
                />
                <CardBody style={{ padding: '14px 14px 16px' }}>
                  <Donut slices={expSlices} center={expTotal} centerLabel="Claims" gid="exp" />
                </CardBody>
              </Card>
            </Col>
          )}

          {/* Attendance — this month donut */}
          {att && attSlices.length > 0 && (
            <Col xs={12} md={6} xl={4}>
              <Card style={cardStyle}>
                <SectionHeader
                  icon="ri-calendar-check-line" gradient="linear-gradient(135deg,#0ab39c,#02c8a7)"
                  title="Attendance" subtitle={att.month}
                />
                <CardBody style={{ padding: '14px 14px 16px' }}>
                  <Donut slices={attSlices} center={att.total} centerLabel="Days Marked" gid="att" />
                </CardBody>
              </Card>
            </Col>
          )}

          {/* Expense Spend Trend — last 6 months area */}
          {trendHasData && (
            <Col xs={12} md={12} xl={4}>
              <Card style={cardStyle}>
                <SectionHeader
                  icon="ri-line-chart-line" gradient="linear-gradient(135deg,#7c5cfc,#a78bfa)"
                  title="Expense Spend" subtitle="Last 6 months"
                />
                <CardBody style={{ padding: '10px 12px 6px' }}>
                  <ResponsiveContainer width="100%" height={196}>
                    <AreaChart data={analytics.expense_trend} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="empSpendGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#7c5cfc" stopOpacity={0.4} />
                          <stop offset="100%" stopColor="#7c5cfc" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} vertical={false} />
                      <XAxis dataKey="month" tick={{ fontSize: 11, fill: ct.axisTickMuted, fontWeight: 600 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 10, fill: ct.axisTickMuted }} axisLine={false} tickLine={false} width={46} tickFormatter={v => `₹${v >= 1000 ? `${(v / 1000).toFixed(0)}K` : v}`} />
                      <Tooltip content={<ChartTooltip prefix="₹" />} cursor={{ stroke: 'rgba(124,92,252,0.4)', strokeWidth: 1, strokeDasharray: '3 3' }} />
                      <Area type="monotone" dataKey="amount" stroke="#7c5cfc" strokeWidth={2.5} fill="url(#empSpendGrad)" dot={{ r: 3, fill: '#7c5cfc', strokeWidth: 2, stroke: ct.dotStroke }} activeDot={{ r: 5 }} />
                    </AreaChart>
                  </ResponsiveContainer>
                </CardBody>
              </Card>
            </Col>
          )}

          {/* Leave Taken — by type bar (only if any leave taken this year) */}
          {leaveByType.length > 0 && (
            <Col xs={12} md={6} xl={4}>
              <Card style={cardStyle}>
                <SectionHeader
                  icon="ri-calendar-todo-line" gradient="linear-gradient(135deg,#299cdb,#63bcec)"
                  title="Leave Taken" subtitle="This year, by type"
                />
                <CardBody style={{ padding: '10px 12px 6px' }}>
                  <ResponsiveContainer width="100%" height={196}>
                    <BarChart data={leaveByType} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} vertical={false} />
                      <XAxis dataKey="type" tick={{ fontSize: 11, fill: ct.axisTickMuted, fontWeight: 600 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 10, fill: ct.axisTickMuted }} axisLine={false} tickLine={false} width={30} allowDecimals={false} />
                      <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(41,156,219,0.08)' }} />
                      <Bar dataKey="days" fill="#299cdb" radius={[6, 6, 0, 0]} maxBarSize={46} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardBody>
              </Card>
            </Col>
          )}
        </Row>
      )}

      {/* ── Row: My recent expenses + Pending approvals (as manager) ───── */}
      <Row className="g-3 mb-3">
        <Col xs={12} lg={6}>
          <Card style={cardStyle}>
            <SectionHeader
              icon="ri-bill-line" gradient="linear-gradient(135deg,#405189,#6691e7)"
              title="My Recent Expenses" subtitle="Last 5 claims you filed"
            />
            <CardBody className="emp-list-body emp-scroll" style={{ padding: 0, maxHeight: 360 }}>
              {recent_expenses.length === 0 ? (
                <EmptyState icon="ri-bill-line" text="No expense claims yet." />
              ) : (
                recent_expenses.map(c => (
                  <div key={c.id} className="d-flex align-items-center gap-2" style={{ padding: '12px 18px', borderBottom: '1px solid var(--vz-border-color)' }}>
                    <div style={{
                      width: 36, height: 36, borderRadius: 10, flexShrink: 0,
                      background: 'rgba(64,81,137,0.10)', color: '#405189',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <i className="ri-receipt-line" style={{ fontSize: 17 }} />
                    </div>
                    <div className="flex-grow-1 min-w-0">
                      <div className="d-flex align-items-center justify-content-between gap-2">
                        <div className="text-truncate fw-semibold" style={{ fontSize: 13, color: 'var(--vz-heading-color, var(--vz-body-color))' }}>
                          {c.title || c.category}
                        </div>
                        <div style={{ fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap' }}>
                          {formatINRCompact(c.amount)}
                        </div>
                      </div>
                      <div className="d-flex align-items-center gap-2 mt-1" style={{ fontSize: 11, color: 'var(--vz-secondary-color)' }}>
                        <span>{c.claim_no}</span>
                        <span>·</span>
                        <span>{c.category}</span>
                        <span>·</span>
                        <span>{fmtDateShort(c.expense_date)}</span>
                        <span className="ms-auto"><StatusPill status={c.status} /></span>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </CardBody>
          </Card>
        </Col>

        <Col xs={12} lg={6}>
          <Card style={cardStyle}>
            <SectionHeader
              icon="ri-shield-check-line" gradient="linear-gradient(135deg,#7c5cfc,#a993fd)"
              title="Pending Your Approval" subtitle="Claims filed by your team"
            />
            <CardBody className="emp-list-body emp-scroll" style={{ padding: 0, maxHeight: 360 }}>
              {pending_approvals.length === 0 ? (
                <EmptyState icon="ri-shield-check-line" text="Nothing waiting on your approval. " />
              ) : (
                pending_approvals.map(c => (
                  <div key={c.id} className="d-flex align-items-center gap-2" style={{ padding: '12px 18px', borderBottom: '1px solid var(--vz-border-color)' }}>
                    <div style={{
                      width: 36, height: 36, borderRadius: 10, flexShrink: 0,
                      background: 'rgba(124,92,252,0.10)', color: '#7c5cfc',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <i className="ri-user-line" style={{ fontSize: 17 }} />
                    </div>
                    <div className="flex-grow-1 min-w-0">
                      <div className="d-flex align-items-center justify-content-between gap-2">
                        <div className="text-truncate fw-semibold" style={{ fontSize: 13, color: 'var(--vz-heading-color, var(--vz-body-color))' }}>
                          {c.filed_by}
                        </div>
                        <div style={{ fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap' }}>
                          {formatINRCompact(c.amount)}
                        </div>
                      </div>
                      <div className="d-flex align-items-center gap-2 mt-1" style={{ fontSize: 11, color: 'var(--vz-secondary-color)' }}>
                        <span>{c.emp_code}</span>
                        <span>·</span>
                        <span>{c.category}</span>
                        <span>·</span>
                        <span>{c.title}</span>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </CardBody>
          </Card>
        </Col>
      </Row>

      {/* ── Row: Announcements + Upcoming events ────────────────────────── */}
      <Row className="g-3 mb-3">
        <Col xs={12} lg={7}>
          <Card style={cardStyle}>
            <SectionHeader
              icon="ri-megaphone-line" gradient="linear-gradient(135deg,#299cdb,#63bcec)"
              title="Latest Announcements" subtitle="From your organisation"
            />
            <CardBody className="emp-list-body emp-scroll" style={{ padding: 0, maxHeight: 360 }}>
              {announcements.length === 0 ? (
                <EmptyState icon="ri-megaphone-line" text="No announcements yet." />
              ) : (
                announcements.map(a => (
                  <div key={a.id} role="button" tabIndex={0}
                       onClick={() => setOpenAnn(a)}
                       onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpenAnn(a); } }}
                       title="Click to read the full announcement"
                       style={{ padding: '14px 18px', borderBottom: '1px solid var(--vz-border-color)', cursor: 'pointer' }}>
                    <div className="d-flex align-items-start justify-content-between gap-2 mb-1">
                      <div className="d-flex align-items-center gap-2 min-w-0">
                        <div className="fw-semibold" style={{ fontSize: 13.5, color: 'var(--vz-heading-color, var(--vz-body-color))' }}>{a.title}</div>
                        {isToday(a.created_at) && (
                          <span style={{
                            flexShrink: 0, fontSize: 9.5, fontWeight: 700, letterSpacing: '0.04em',
                            padding: '2px 7px', borderRadius: 999, lineHeight: 1.4,
                            background: '#3577f1', color: '#fff', textTransform: 'uppercase',
                          }}>New</span>
                        )}
                      </div>
                      {a.created_at && (
                        <span style={{ fontSize: 11, color: 'var(--vz-secondary-color)', whiteSpace: 'nowrap', flexShrink: 0 }}>
                          {fmtDateShort(a.created_at)}
                        </span>
                      )}
                    </div>
                    <div className="text-muted" style={{ fontSize: 12, lineHeight: 1.55 }}>
                      {a.snippet}
                    </div>
                  </div>
                ))
              )}
            </CardBody>
          </Card>
        </Col>

        <Col xs={12} lg={5}>
          <Card style={cardStyle}>
            <SectionHeader
              icon="ri-cake-3-line" gradient="linear-gradient(135deg,#e83e8c,#f774ac)"
              title="Upcoming Celebrations" subtitle="Next 30 days · birthdays & work anniversaries"
            />
            <CardBody className="emp-list-body emp-scroll" style={{ padding: 0, maxHeight: 360 }}>
              {upcoming_events.length === 0 ? (
                <EmptyState icon="ri-cake-3-line" text="No celebrations coming up." />
              ) : (
                upcoming_events.map((e, i) => (
                  <div key={`${e.employee_id}-${e.kind}-${i}`} className="d-flex align-items-center gap-2" style={{ padding: '12px 18px', borderBottom: '1px solid var(--vz-border-color)' }}>
                    <div style={{
                      width: 36, height: 36, borderRadius: 10, flexShrink: 0,
                      background: e.kind === 'birthday' ? 'rgba(232,62,140,0.12)' : 'rgba(247,184,75,0.14)',
                      color: e.kind === 'birthday' ? '#e83e8c' : '#c98308',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <i className={e.kind === 'birthday' ? 'ri-cake-2-line' : 'ri-medal-2-line'} style={{ fontSize: 17 }} />
                    </div>
                    <div className="flex-grow-1 min-w-0">
                      <div className="fw-semibold text-truncate" style={{ fontSize: 13, color: 'var(--vz-heading-color, var(--vz-body-color))' }}>
                        {e.name}
                      </div>
                      <div className="text-muted" style={{ fontSize: 11.5 }}>
                        {e.kind === 'birthday'
                          ? 'Birthday'
                          : `${e.years ? e.years + (e.years === 1 ? '-year ' : '-year ') : ''}Work anniversary`}
                      </div>
                    </div>
                    <div className="text-end" style={{ fontSize: 11.5, color: 'var(--vz-secondary-color)' }}>
                      {fmtDateShort(e.on)}
                    </div>
                  </div>
                ))
              )}
            </CardBody>
          </Card>
        </Col>
      </Row>

      {/* ── My Team — title and subtitle adapt to which cohort the
           backend picked: direct reports for managers, sibling reports
           for ICs, falling back to department peers only at the top of
           the tree. Keeps the card honest about who's listed. */}
      {team_peers.length > 0 && (() => {
        const teamMeta = team_kind === 'reports'
          ? { title: 'My Team', subtitle: `Your direct reports · ${kpis.team_size} member${kpis.team_size === 1 ? '' : 's'}` }
          : team_kind === 'peers'
          ? { title: 'My Team', subtitle: `Peers under ${me.manager_name || 'your manager'} · ${kpis.team_size} member${kpis.team_size === 1 ? '' : 's'}` }
          : { title: 'My Team', subtitle: `${me.department_name || 'Department'} · ${kpis.team_size} member${kpis.team_size === 1 ? '' : 's'}` };
        return (
        <Card style={cardStyle}>
          <SectionHeader
            icon="ri-team-line" gradient="linear-gradient(135deg,#405189,#6691e7)"
            title={teamMeta.title} subtitle={teamMeta.subtitle}
          />
          <CardBody style={{ padding: '14px 18px' }}>
            <Row className="g-3">
              {team_peers.map(p => (
                <Col key={p.id} xs={6} md={4} lg={2}>
                  <div
                    style={{
                      borderRadius: 12, padding: 14, textAlign: 'center',
                      border: '1px solid var(--vz-border-color)',
                      background: 'var(--vz-card-bg)',
                    }}
                  >
                    <div className="mx-auto mb-2" style={{ width: 48, height: 48 }}>
                      <Avatar src={p.photo_url} name={p.display_name} size={48} />
                    </div>
                    <div className="fw-semibold text-truncate" style={{ fontSize: 12.5 }}>{p.display_name}</div>
                    <div className="text-muted text-truncate" style={{ fontSize: 11 }}>
                      {p.designation_name || p.emp_code}
                    </div>
                  </div>
                </Col>
              ))}
            </Row>
          </CardBody>
        </Card>
        );
      })()}

      {/* Announcement detail — opened by clicking a card in the list above.
          Built on the shared `.master-modal` shell (see masterFormKit) rather
          than a bare reactstrap ModalHeader, so it carries the same gradient
          header, 20px radius, tinted body and pill footer button as every
          master popup form. */}
      <MasterFormStyles />
      <Modal
        isOpen={!!openAnn}
        toggle={() => setOpenAnn(null)}
        centered
        scrollable
        size="lg"
        modalClassName="master-modal"
      >
        <div
          className="position-relative overflow-hidden"
          style={{
            background:
              'linear-gradient(135deg, #2b3a85 0%, #405189 28%, #5562c4 55%, #6e7eee 78%, #8b6fe8 100%)',
            padding: '22px 24px',
          }}
        >
          {/* Decorative glows + diagonal sheen — same recipe as the master header. */}
          <span
            aria-hidden
            style={{
              position: 'absolute', top: -50, right: -30, width: 200, height: 200, borderRadius: '50%',
              background: 'radial-gradient(circle, rgba(255,255,255,0.28) 0%, rgba(167,139,250,0.18) 35%, transparent 70%)',
              pointerEvents: 'none',
            }}
          />
          <span
            aria-hidden
            style={{
              position: 'absolute', bottom: -60, right: 80, width: 180, height: 180, borderRadius: '50%',
              background: 'radial-gradient(circle, rgba(102,145,231,0.45) 0%, transparent 70%)',
              pointerEvents: 'none',
            }}
          />
          <span
            aria-hidden
            style={{
              position: 'absolute', bottom: -50, left: -30, width: 160, height: 160, borderRadius: '50%',
              background: 'radial-gradient(circle, rgba(139,111,232,0.32) 0%, transparent 70%)',
              pointerEvents: 'none',
            }}
          />
          <span
            aria-hidden
            style={{
              position: 'absolute', inset: 0,
              background: 'linear-gradient(115deg, rgba(255,255,255,0.10) 0%, transparent 35%, transparent 65%, rgba(0,0,0,0.08) 100%)',
              pointerEvents: 'none',
            }}
          />
          <div className="d-flex align-items-center gap-3 position-relative">
            <span
              className="d-inline-flex align-items-center justify-content-center rounded-3 flex-shrink-0"
              style={{
                width: 44, height: 44,
                background: 'rgba(255,255,255,0.18)',
                border: '1px solid rgba(255,255,255,0.25)',
                backdropFilter: 'blur(6px)',
              }}
            >
              <i className="ri-megaphone-line" style={{ color: '#fff', fontSize: 20 }} />
            </span>
            <div className="flex-grow-1 min-w-0">
              <h4 className="mb-0 fw-bold text-truncate" style={{ color: '#fff', fontWeight: 800, letterSpacing: '0.01em' }}>
                {openAnn?.title}
              </h4>
              <small style={{ color: 'rgba(255,255,255,0.82)', fontSize: 12 }}>
                {openAnn?.created_at ? `Announced on ${fmtDateShort(openAnn.created_at)}` : 'Announcement details'}
              </small>
            </div>
          </div>
        </div>
        <ModalBody className="px-4 py-3">
          <div style={{ whiteSpace: 'pre-wrap', fontSize: 13.5, lineHeight: 1.6, color: 'var(--vz-body-color)' }}>
            {(openAnn?.body || openAnn?.snippet || '').trim() || 'No further details.'}
          </div>
        </ModalBody>
        <ModalFooter
          className="px-4 py-3 d-flex align-items-center justify-content-end flex-wrap gap-2"
          style={{ borderTop: '1px solid var(--vz-border-color)' }}
        >
          <button type="button" className="master-modal-cancel" onClick={() => setOpenAnn(null)}>
            Close
          </button>
        </ModalFooter>
      </Modal>
    </div>
  );
}
