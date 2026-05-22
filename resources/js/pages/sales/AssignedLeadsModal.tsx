import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import api from '../../api';
import { useToast } from '../../contexts/ToastContext';

/* ─────────────────────────────────────────────────────────────────────────
 * Lead Distribution — full-screen "Assigned Leads" experience.
 *
 * Ports the SalesMatrix_v4_9 HTML prototype into our React SPA. The page
 * is rendered as a full-screen modal so the worksheet stays in the back-
 * stack and "Back to My Workplace" simply dismisses the overlay.
 *
 * Layout (top → bottom):
 *   1. Amber gradient header — title, sub, two stat pills, back button
 *   2. Four KPI cards — Total Salespersons / Total Leads / Assigned /
 *      Unassigned. The latter two are coloured (green / red) to highlight
 *      assignment health.
 *   3. Roster table — one row per salesperson with their department,
 *      designation, primary & ancillary role chips, reporting manager,
 *      lead total, and a View Leads action that filters the worksheet
 *      by that salesperson.
 *
 * The department / role chips colour-cycle from a small palette keyed by
 * a deterministic hash of the label so the same string always picks the
 * same colour across rows. Total Leads is shown as a bold amber pill.
 * ───────────────────────────────────────────────────────────────────────── */

type Row = {
  salesperson_id:        number;
  salesperson_name:      string;
  salesperson_code:      string;
  department:            string | null;
  designation:           string | null;
  primary_role:          string | null;
  ancillary_role:        string | null;
  reporting_manager:     string | null;
  email:                 string | null;
  total_assigned_leads:  number;
  platform_counts:       Record<string, number>;
};

type Summary = {
  total_sales_persons: number;
  total_leads:         number;
  assigned_leads:      number;
  unassigned_leads:    number;
};

type Props = {
  open: boolean;
  onClose: () => void;
  onViewLeads: (salesperson: { id: number; name: string }) => void;
};

export default function AssignedLeadsModal({ open, onClose, onViewLeads }: Props) {
  const toast = useToast();
  const [rows, setRows] = useState<Row[]>([]);
  const [summary, setSummary] = useState<Summary>({
    total_sales_persons: 0, total_leads: 0, assigned_leads: 0, unassigned_leads: 0,
  });
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!open) { setSearch(''); return; }
    setLoading(true);
    api.get<{ status: boolean; summary: Summary; platforms: string[]; data: Row[] }>(
      '/sales/leads/salesperson-summary',
    )
      .then(({ data }) => {
        setRows(data.data ?? []);
        /* Preserve the safe initial summary when the server response
         * doesn't include the `summary` field (or returns it as null).
         * Previously `setSummary(data.summary)` overwrote the seed with
         * `undefined`, and the header pill at line 117 crashed reading
         * `.total_sales_persons` on undefined. */
        if (data.summary && typeof data.summary === 'object') {
          setSummary(data.summary);
        }
      })
      .catch(() => toast.error('Load failed', 'Could not load assigned-leads summary'))
      .finally(() => setLoading(false));
  }, [open, toast]);

  const filtered = useMemo(() => {
    if (!search.trim()) return rows;
    const s = search.toLowerCase();
    return rows.filter(r =>
      r.salesperson_name.toLowerCase().includes(s) ||
      r.salesperson_code.toLowerCase().includes(s) ||
      (r.department ?? '').toLowerCase().includes(s) ||
      (r.designation ?? '').toLowerCase().includes(s) ||
      (r.primary_role ?? '').toLowerCase().includes(s) ||
      (r.ancillary_role ?? '').toLowerCase().includes(s),
    );
  }, [rows, search]);

  if (!open) return null;

  return createPortal((
    <div className="ldp-overlay">
      <style>{LDP_CSS}</style>
      <div className="ldp-shell">
        {/* ── Header ───────────────────────────────────────────────── */}
        <div className="ldp-header">
          <div className="ldp-header-left">
            <div className="ldp-header-icon">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
            </div>
            <div>
              <div className="ldp-header-title">Lead Distribution</div>
              <div className="ldp-header-sub">Track and manage leads assigned to your sales team</div>
            </div>
          </div>

          <div className="ldp-header-right">
            {/* Optional-chained so the pills never crash if `summary` is
             * unexpectedly null/undefined from a future API change.
             * Falls back to 0 so the layout still renders with a clear
             * "no data" reading instead of an error boundary. */}
            <span className="ldp-header-pill">
              <span className="ldp-header-pill-dot" />
              {summary?.total_sales_persons ?? 0} Sales Members
            </span>
            <span className="ldp-header-pill">
              <span className="ldp-header-pill-dot" />
              {summary?.total_leads ?? 0} Total Leads
            </span>
            <button className="ldp-back-btn" onClick={onClose}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
              Back to My Workplace
            </button>
          </div>
        </div>

        {/* ── KPI cards ────────────────────────────────────────────── */}
        <div className="ldp-stats">
          <StatCard
            label="TOTAL SALES PERSONS"
            value={summary?.total_sales_persons ?? 0}
            sub="Active members"
            tone="slate"
            icon={
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
              </svg>
            }
          />
          <StatCard
            label="TOTAL LEADS"
            value={summary?.total_leads ?? 0}
            sub="All leads"
            tone="amber"
            icon={
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
            }
          />
          <StatCard
            label="ASSIGNED LEADS"
            value={summary?.assigned_leads ?? 0}
            sub="Salesperson assigned"
            tone="green"
            icon={
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            }
          />
          <StatCard
            label="UNASSIGNED LEADS"
            value={summary?.unassigned_leads ?? 0}
            sub="Needs assignment"
            tone="red"
            icon={
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
            }
          />
        </div>

        {/* ── Search ───────────────────────────────────────────────── */}
        <div className="ldp-toolbar">
          <div className="ldp-search">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2.2">
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35" />
            </svg>
            <input
              type="text"
              placeholder="Search by name, EMP code, department, role…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
        </div>

        {/* ── Table ────────────────────────────────────────────────── */}
        <div className="ldp-table-wrap">
          <table className="ldp-table">
            <thead>
              <tr>
                <th className="ldp-th-num">SR NO</th>
                <th>SALES PERSON</th>
                <th>DEPARTMENT</th>
                <th>DESIGNATION</th>
                <th>PRIMARY ROLE</th>
                <th>ANCILLARY ROLE</th>
                <th>REPORTING MANAGER</th>
                <th className="ldp-th-num">TOTAL LEADS</th>
                <th className="ldp-th-action">ACTION</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={9} className="ldp-status">Loading salesperson summary…</td>
                </tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={9} className="ldp-status">
                    {rows.length === 0
                      ? 'No active salespeople yet for this tenant.'
                      : 'No salespeople match the search.'}
                  </td>
                </tr>
              )}
              {!loading && filtered.map((r, i) => (
                <tr key={r.salesperson_id}>
                  <td className="ldp-td-num">{i + 1}</td>
                  <td>
                    <div className="ldp-person">
                      <div
                        className="ldp-avatar"
                        style={{ background: avatarColor(r.salesperson_name) }}
                      >
                        {initials(r.salesperson_name)}
                      </div>
                      <div className="ldp-person-name">{r.salesperson_name}</div>
                    </div>
                  </td>
                  <td>
                    {r.department
                      ? <span className="ldp-chip" style={chipStyle(r.department)}>{r.department}</span>
                      : <span className="ldp-muted">—</span>}
                  </td>
                  <td className="ldp-text">
                    {r.designation ?? <span className="ldp-muted">—</span>}
                  </td>
                  <td>
                    {r.primary_role
                      ? <span className="ldp-chip ldp-chip-green">{r.primary_role}</span>
                      : <span className="ldp-muted">—</span>}
                  </td>
                  <td>
                    {r.ancillary_role
                      ? <span className="ldp-chip ldp-chip-outline">{r.ancillary_role}</span>
                      : <span className="ldp-muted">—</span>}
                  </td>
                  <td className="ldp-text">
                    {r.reporting_manager ?? <span className="ldp-muted">—</span>}
                  </td>
                  <td className="ldp-td-num">
                    <span className="ldp-total">{r.total_assigned_leads}</span>
                  </td>
                  <td className="ldp-td-action">
                    <button
                      className="ldp-view-btn"
                      onClick={() => onViewLeads({ id: r.salesperson_id, name: r.salesperson_name })}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                      View Leads
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  ), document.body);
}

/* ─── Stat card primitive ─────────────────────────────────────────── */
function StatCard(props: {
  label: string;
  value: number;
  sub: string;
  tone: 'amber' | 'green' | 'red' | 'slate';
  icon: React.ReactNode;
}) {
  return (
    <div className={`ldp-stat ldp-stat-${props.tone}`}>
      <div className="ldp-stat-row">
        <div className="ldp-stat-label">{props.label}</div>
        <div className="ldp-stat-icon">{props.icon}</div>
      </div>
      <div className="ldp-stat-value">{props.value.toLocaleString()}</div>
      <div className="ldp-stat-sub">{props.sub}</div>
    </div>
  );
}

/* ─── Helpers ─────────────────────────────────────────────────────── */

const initials = (name: string): string =>
  (name || '?')
    .split(' ')
    .filter(Boolean)
    .map(w => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

/* Stable hash → palette index. Same input always picks the same colour
 * across rows so a user instantly recognises e.g. "Digital Marketing"
 * across the table. Borrowed pattern from the legacy prototype. */
const hashStr = (s: string): number => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
};

const AVATAR_PALETTE = [
  'linear-gradient(135deg, #10b981, #047857)',  // emerald
  'linear-gradient(135deg, #8b5cf6, #6d28d9)',  // violet
  'linear-gradient(135deg, #f59e0b, #d97706)',  // amber
  'linear-gradient(135deg, #06b6d4, #0e7490)',  // cyan
  'linear-gradient(135deg, #ef4444, #b91c1c)',  // red
  'linear-gradient(135deg, #3b82f6, #1d4ed8)',  // blue
  'linear-gradient(135deg, #ec4899, #be185d)',  // pink
];

const avatarColor = (name: string): string =>
  AVATAR_PALETTE[hashStr(name) % AVATAR_PALETTE.length];

const CHIP_PALETTE = [
  { bg: '#fef3c7', color: '#92400e', border: '#fde68a' },  // amber
  { bg: '#dcfce7', color: '#166534', border: '#bbf7d0' },  // green
  { bg: '#fee2e2', color: '#991b1b', border: '#fecaca' },  // red
  { bg: '#dbeafe', color: '#1e40af', border: '#bfdbfe' },  // blue
  { bg: '#ede9fe', color: '#6d28d9', border: '#ddd6fe' },  // violet
  { bg: '#cffafe', color: '#155e75', border: '#a5f3fc' },  // cyan
  { bg: '#fce7f3', color: '#9d174d', border: '#fbcfe8' },  // pink
];

const chipStyle = (label: string): React.CSSProperties => {
  const p = CHIP_PALETTE[hashStr(label) % CHIP_PALETTE.length];
  return { background: p.bg, color: p.color, borderColor: p.border };
};

const LDP_CSS = `
.ldp-overlay {
  position: fixed; inset: 0; z-index: 1080;
  background: rgba(15, 23, 42, .65); backdrop-filter: blur(4px);
  overflow-y: auto;
  animation: ldp-fade .18s ease-out;
  padding: 24px;
}
@keyframes ldp-fade { from { opacity: 0; } to { opacity: 1; } }

.ldp-shell {
  width: min(1280px, 100%); margin: 0 auto;
  background: #fff7ed;
  border-radius: 18px;
  box-shadow: 0 22px 60px rgba(15,23,42,.32);
  overflow: hidden;
  animation: ldp-pop .22s cubic-bezier(.22,1,.36,1);
}
@keyframes ldp-pop {
  from { transform: scale(.97); opacity: 0; }
  to   { transform: scale(1);   opacity: 1; }
}

/* ── Header ─────────────────────────────────────────────────────── */
.ldp-header {
  display: flex; align-items: center; justify-content: space-between;
  gap: 16px; padding: 18px 22px;
  background: linear-gradient(135deg, #fef3c7 0%, #fde68a 60%, #fcd34d 100%);
  border-bottom: 1px solid #fbbf24;
}
.ldp-header-left { display: flex; align-items: center; gap: 14px; min-width: 0; }
.ldp-header-icon {
  width: 44px; height: 44px; border-radius: 12px;
  background: linear-gradient(135deg, #f59e0b, #ea580c); color: #fff;
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 6px 16px rgba(234,88,12,.30);
  flex-shrink: 0;
}
.ldp-header-title { font-size: 17px; font-weight: 700; color: #1f2937; letter-spacing: -.2px; }
.ldp-header-sub   { font-size: 12px; color: #57534e; margin-top: 3px; }

.ldp-header-right { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
.ldp-header-pill {
  display: inline-flex; align-items: center; gap: 7px;
  padding: 7px 14px; border-radius: 999px;
  background: rgba(255,255,255,.65); border: 1.5px solid #fcd34d;
  font-size: 12px; font-weight: 600; color: #b45309;
}
.ldp-header-pill-dot {
  width: 7px; height: 7px; border-radius: 50%; background: #f59e0b;
  box-shadow: 0 0 0 3px rgba(245,158,11,.22);
}
.ldp-back-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 9px 18px; border-radius: 10px; border: none;
  background: linear-gradient(135deg, #f59e0b, #ea580c); color: #fff;
  font-size: 12.5px; font-weight: 700; cursor: pointer;
  box-shadow: 0 6px 16px rgba(234,88,12,.32);
  transition: filter .15s, transform .12s;
}
.ldp-back-btn:hover  { filter: brightness(1.07); transform: translateY(-1px); }
.ldp-back-btn:active { transform: translateY(0); }

/* ── Stats row ──────────────────────────────────────────────────── */
.ldp-stats {
  display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px;
  padding: 18px 22px 4px;
}
.ldp-stat {
  background: #fff; border: 1.5px solid #f5e9d4;
  border-radius: 14px; padding: 14px 16px;
  box-shadow: 0 2px 8px rgba(217,119,6,.05);
  transition: box-shadow .15s, transform .15s;
}
.ldp-stat:hover { box-shadow: 0 8px 22px rgba(217,119,6,.10); transform: translateY(-1px); }
.ldp-stat-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.ldp-stat-label {
  font-size: 10px; font-weight: 700; color: #78716c;
  letter-spacing: .08em;
}
.ldp-stat-icon {
  width: 30px; height: 30px; border-radius: 8px;
  display: flex; align-items: center; justify-content: center;
}
.ldp-stat-value { font-size: 28px; font-weight: 800; color: #1f2937; margin-top: 8px; line-height: 1.1; }
.ldp-stat-sub   { font-size: 11.5px; margin-top: 6px; display: flex; align-items: center; gap: 5px; }
.ldp-stat-sub::after { content: "›"; font-size: 13px; line-height: 1; opacity: .8; }

.ldp-stat-slate .ldp-stat-icon { background: #f1f5f9; color: #475569; }
.ldp-stat-slate .ldp-stat-sub  { color: #475569; }

.ldp-stat-amber .ldp-stat-icon { background: #fef3c7; color: #b45309; }
.ldp-stat-amber .ldp-stat-sub  { color: #b45309; }

.ldp-stat-green {
  background: linear-gradient(135deg, #f0fdf4 0%, #ffffff 100%);
  border-color: #bbf7d0;
}
.ldp-stat-green .ldp-stat-icon { background: #bbf7d0; color: #15803d; }
.ldp-stat-green .ldp-stat-sub  { color: #15803d; }

.ldp-stat-red {
  background: linear-gradient(135deg, #fef2f2 0%, #ffffff 100%);
  border-color: #fecaca;
}
.ldp-stat-red .ldp-stat-icon { background: #fecaca; color: #b91c1c; }
.ldp-stat-red .ldp-stat-sub  { color: #b91c1c; }

/* ── Toolbar / search ───────────────────────────────────────────── */
.ldp-toolbar { padding: 14px 22px 10px; }
.ldp-search {
  max-width: 400px;
  display: flex; align-items: center; gap: 8px;
  padding: 0 12px; height: 38px;
  background: #fff; border: 1.5px solid #fde68a; border-radius: 10px;
  transition: border-color .15s, box-shadow .15s;
}
.ldp-search:focus-within { border-color: #f59e0b; box-shadow: 0 0 0 3px rgba(245,158,11,.18); }
.ldp-search input {
  flex: 1; border: none; outline: none; background: transparent;
  font-size: 12.5px; color: #1f2937;
}

/* ── Table ──────────────────────────────────────────────────────── */
.ldp-table-wrap {
  margin: 0 22px 22px;
  background: #fff; border: 1px solid #fde68a; border-radius: 12px;
  overflow: auto;
}
.ldp-table { width: 100%; border-collapse: collapse; font-size: 12px; min-width: 1100px; }
.ldp-table thead tr {
  background: linear-gradient(135deg, #92400e 0%, #b45309 50%, #d97706 100%);
}
.ldp-table thead th {
  color: #fff7ed; font-size: 10.5px; font-weight: 700;
  letter-spacing: .06em;
  text-align: left; padding: 13px 16px; white-space: nowrap;
}
.ldp-th-num    { text-align: center !important; }
.ldp-th-action { text-align: center !important; width: 130px; }

.ldp-table tbody tr {
  border-bottom: 1px solid #fef3c7; transition: background .12s;
}
.ldp-table tbody tr:nth-child(even) { background: #fffbeb; }
.ldp-table tbody tr:last-child      { border-bottom: none; }
.ldp-table tbody tr:hover           { background: #fef3c7; }
.ldp-table tbody td {
  padding: 12px 16px; color: #1f2937; vertical-align: middle;
}
.ldp-td-num    { text-align: center; }
.ldp-td-action { text-align: center; }
.ldp-text  { color: #44403c; font-size: 12px; }
.ldp-muted { color: #d6d3d1; font-style: italic; }

.ldp-person { display: flex; align-items: center; gap: 12px; }
.ldp-avatar {
  width: 34px; height: 34px; border-radius: 50%;
  color: #fff; font-size: 11.5px; font-weight: 700;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
  box-shadow: 0 3px 8px rgba(0,0,0,.10);
}
.ldp-person-name { font-size: 13px; font-weight: 700; color: #1f2937; }

.ldp-chip {
  display: inline-block; padding: 4px 12px; border-radius: 999px;
  font-size: 11px; font-weight: 600; border: 1.5px solid;
  white-space: nowrap;
}
.ldp-chip-green {
  background: #dcfce7; color: #166534; border-color: #bbf7d0;
}
.ldp-chip-outline {
  background: #fff; color: #b45309; border-color: #fde68a;
}

.ldp-total {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 36px; padding: 4px 12px;
  background: linear-gradient(135deg, #f59e0b, #ea580c); color: #fff;
  border-radius: 999px; font-size: 12px; font-weight: 700;
  box-shadow: 0 3px 8px rgba(234,88,12,.25);
}

.ldp-view-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 7px 14px; border-radius: 8px;
  background: #fff; border: 1.5px solid #fbbf24; color: #b45309;
  font-size: 11.5px; font-weight: 600; cursor: pointer;
  transition: background .15s, color .15s, transform .12s;
}
.ldp-view-btn:hover {
  background: linear-gradient(135deg, #fde68a, #fcd34d);
  color: #92400e; transform: translateY(-1px);
}
.ldp-view-btn:active { transform: translateY(0); }

.ldp-status {
  text-align: center; padding: 36px 14px;
  color: #a8a29e; font-style: italic; font-size: 12.5px;
}

/* ── Dark mode adaptation ───────────────────────────────────────── */
[data-bs-theme="dark"] .ldp-shell { background: #1c1410; }
[data-bs-theme="dark"] .ldp-header {
  background: linear-gradient(135deg, #422006 0%, #78350f 60%, #92400e 100%);
  border-color: #b45309;
}
[data-bs-theme="dark"] .ldp-header-title { color: #fef3c7; }
[data-bs-theme="dark"] .ldp-header-sub   { color: #fcd34d; }
[data-bs-theme="dark"] .ldp-header-pill  { background: rgba(0,0,0,.30); color: #fcd34d; border-color: #b45309; }
[data-bs-theme="dark"] .ldp-stat {
  background: #1f1611; border-color: #422006; color: #fef3c7;
}
[data-bs-theme="dark"] .ldp-stat-value { color: #fef3c7; }
[data-bs-theme="dark"] .ldp-stat-label { color: #d6d3d1; }
[data-bs-theme="dark"] .ldp-stat-slate .ldp-stat-icon { background: #1e293b; color: #cbd5e1; }
[data-bs-theme="dark"] .ldp-stat-green { background: linear-gradient(135deg, rgba(20,83,45,.30) 0%, #1f1611 100%); border-color: #166534; }
[data-bs-theme="dark"] .ldp-stat-red   { background: linear-gradient(135deg, rgba(127,29,29,.30) 0%, #1f1611 100%); border-color: #991b1b; }
[data-bs-theme="dark"] .ldp-search {
  background: #1f1611; border-color: #422006;
}
[data-bs-theme="dark"] .ldp-search input { color: #fef3c7; }
[data-bs-theme="dark"] .ldp-table-wrap { background: #1f1611; border-color: #422006; }
[data-bs-theme="dark"] .ldp-table tbody tr { border-color: #422006; }
[data-bs-theme="dark"] .ldp-table tbody tr:nth-child(even) { background: #28190e; }
[data-bs-theme="dark"] .ldp-table tbody tr:hover { background: #422006; }
[data-bs-theme="dark"] .ldp-table tbody td { color: #fef3c7; }
[data-bs-theme="dark"] .ldp-person-name   { color: #fef3c7; }
[data-bs-theme="dark"] .ldp-text          { color: #fde68a; }
[data-bs-theme="dark"] .ldp-chip-outline  { background: #1f1611; }
[data-bs-theme="dark"] .ldp-view-btn      { background: #1f1611; }
[data-bs-theme="dark"] .ldp-view-btn:hover{ color: #fef3c7; }

/* Tablet — 2-up stats, header pills wrap below the back button */
@media (max-width: 1100px) {
  .ldp-stats { grid-template-columns: repeat(2, 1fr); }
  .ldp-header { flex-wrap: wrap; }
  .ldp-header-right { flex-wrap: wrap; justify-content: flex-end; width: 100%; }
}

/* Phone — full-width overlay (no margin), single-column stats, table
   scrolls horizontally, header collapses to a tighter stack. */
@media (max-width: 640px) {
  .ldp-overlay { padding: 0; }
  .ldp-shell {
    width: 100%; border-radius: 0; min-height: 100vh;
  }
  .ldp-header {
    padding: 14px 16px; gap: 12px; flex-direction: column; align-items: flex-start;
  }
  .ldp-header-left { gap: 10px; }
  .ldp-header-icon { width: 38px; height: 38px; }
  .ldp-header-title { font-size: 15px; }
  .ldp-header-sub   { font-size: 11px; }
  .ldp-header-right { flex-wrap: wrap; gap: 8px; }
  .ldp-header-right .ldp-back-btn { flex: 1; justify-content: center; }
  .ldp-header-pill { flex: 1; justify-content: center; }
  .ldp-stats { grid-template-columns: 1fr; padding: 14px 16px 4px; gap: 10px; }
  .ldp-stat-value { font-size: 24px; }
  .ldp-toolbar { padding: 12px 16px 8px; }
  .ldp-search  { max-width: none; }
  .ldp-table-wrap { margin: 0 16px 16px; }
  .ldp-table thead th, .ldp-table tbody td { padding: 10px 12px; font-size: 11.5px; }
  .ldp-person-name { font-size: 12px; }
  .ldp-avatar { width: 30px; height: 30px; font-size: 11px; }
}
`;
