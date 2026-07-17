import { useEffect, useState } from 'react';
import api from '../../../api';
import { useToast } from '../../../contexts/ToastContext';
import { useNavigateContext } from '../../../components/App';
import LeadsKpiModal, { type KpiFilter } from './LeadsKpiModal';

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

export default function AssignedLeadsModal() {
  const toast = useToast();
  const { navigate } = useNavigateContext();
  const [rows, setRows] = useState<Row[]>([]);
  const [summary, setSummary] = useState<Summary>({
    total_sales_persons: 0, total_leads: 0, assigned_leads: 0, unassigned_leads: 0,
  });
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  /* KPI popup — clicking a lead-count card opens the prototype's
   * "Assigned Leads"-style modal scoped to that bucket. `null` = closed. */
  const [kpiModal, setKpiModal] = useState<{ title: string; filter: KpiFilter } | null>(null);

  const onClose = () => navigate('sales.workplace');
  /* Route to the dedicated Leads Details page (ports the SalesMatrix_v4_9
   * `#leadsDetailModal` design). The page reads the salesperson + meta
   * from the URL query string so a direct deep-link works too. */
  const onViewLeads = (sp: { id: number; name: string; emp?: string | null; mgr?: string | null }) => {
    navigate('sales.leads_details', {
      salespersonId:   sp.id,
      salespersonName: sp.name,
      salespersonEmp:  sp.emp ?? undefined,
      salespersonMgr:  sp.mgr ?? undefined,
    });
  };

  useEffect(() => {
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
  }, [toast]);

  /* Roster shows only salespeople who actually hold leads — an empty
   * salesperson adds noise to the distribution view. The TOTAL SALES
   * PERSONS KPI / header pill count these same rows so the number always
   * matches what's visible in the table (previously they counted every
   * active member, which read as "3 rows but says 6"). */
  const leadRows   = rows.filter(r => (r.total_assigned_leads ?? 0) > 0);
  const totalCount = leadRows.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const safePage   = Math.min(page, totalPages);
  const startIdx   = totalCount === 0 ? 0 : (safePage - 1) * pageSize;
  const endIdx     = Math.min(startIdx + pageSize, totalCount);
  const pageRows   = leadRows.slice(startIdx, endIdx);

  // Clamp page back into range whenever the dataset shrinks (search/filter).
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  return (
    <div className="ldp-page">
      <style>{LDP_CSS}</style>

      {/* ── Header card (standalone container) ─────────────────────── */}
      <div className="ldp-header-card">
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
              {totalCount} Sales Members
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
      </div>

      <div className="ldp-shell">
        {/* ── KPI cards ────────────────────────────────────────────── */}
        <div className="ldp-stats">
          <StatCard
            label="TOTAL SALES PERSONS"
            value={totalCount}
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
            onClick={() => setKpiModal({ title: 'Total Leads', filter: {} })}
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
            onClick={() => setKpiModal({ title: 'Assigned Leads', filter: { assigned: true } })}
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
            onClick={() => setKpiModal({ title: 'Unassigned Leads', filter: { assigned: false } })}
            icon={
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
            }
          />
        </div>

        {/* ── Table ────────────────────────────────────────────────── */}
        <div className="ldp-table-wrap">
          <div className="ldp-table-scroll">
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
              {loading && Array.from({ length: pageSize }).map((_, i) => (
                <tr key={`sk-${i}`} className="ldp-skel-row">
                  <td className="ldp-td-num"><span className="ldp-skel ldp-skel-sr" /></td>
                  <td>
                    <div className="ldp-person">
                      <span className="ldp-skel ldp-skel-avatar" />
                      <span className="ldp-skel ldp-skel-line" style={{ width: '70%' }} />
                    </div>
                  </td>
                  <td><span className="ldp-skel ldp-skel-chip" /></td>
                  <td><span className="ldp-skel ldp-skel-line" style={{ width: '75%' }} /></td>
                  <td><span className="ldp-skel ldp-skel-chip" /></td>
                  <td><span className="ldp-skel ldp-skel-chip" /></td>
                  <td><span className="ldp-skel ldp-skel-line" style={{ width: '80%' }} /></td>
                  <td className="ldp-td-num"><span className="ldp-skel ldp-skel-pill" /></td>
                  <td className="ldp-td-action"><span className="ldp-skel ldp-skel-btn" /></td>
                </tr>
              ))}
              {!loading && totalCount === 0 && (
                <tr>
                  <td colSpan={9} className="ldp-status">
                    No salespeople have leads assigned yet.
                  </td>
                </tr>
              )}
              {!loading && pageRows.map((r, i) => {
                return (
                <tr key={r.salesperson_id}>
                  <td className="ldp-td-num">
                    <span className="ldp-sr-badge">{startIdx + i + 1}</span>
                  </td>
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
                      ? <span className="ldp-chip ldp-chip-dept">{r.department}</span>
                      : <span className="ldp-muted">—</span>}
                  </td>
                  <td className="ldp-text">
                    {r.designation ?? <span className="ldp-muted">—</span>}
                  </td>
                  <td>
                    {r.primary_role
                      ? <span className="ldp-chip ldp-chip-primary">{r.primary_role}</span>
                      : <span className="ldp-muted">—</span>}
                  </td>
                  <td>
                    {r.ancillary_role
                      ? <span className="ldp-chip ldp-chip-ancillary">{r.ancillary_role}</span>
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
                      onClick={() => onViewLeads({ id: r.salesperson_id, name: r.salesperson_name, emp: r.salesperson_code, mgr: r.reporting_manager })}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                      View Leads
                    </button>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
          </div>

          {/* ── Pagination footer ──────────────────────────────────── */}
          {!loading && totalCount > 0 && (
            <div className="ldp-pagination">
              <div className="ldp-pagination-info">
                Showing {startIdx + 1}–{endIdx} of {totalCount}
              </div>
              <div className="ldp-pagination-controls">
                <label className="ldp-rows-per-page">
                  <span>Rows per page:</span>
                  <select
                    value={pageSize}
                    onChange={e => { setPageSize(Number(e.target.value)); setPage(1); }}
                  >
                    {[...new Set([pageSize, 10, 25, 50])].sort((a, b) => a - b).map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                </label>
                <div className="ldp-page-indicator">
                  {safePage}/{totalPages}
                </div>
                <button
                  type="button"
                  className="ldp-page-btn"
                  disabled={safePage <= 1}
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  aria-label="Previous page"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="15 18 9 12 15 6" />
                  </svg>
                </button>
                <button
                  type="button"
                  className="ldp-page-btn"
                  disabled={safePage >= totalPages}
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  aria-label="Next page"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* KPI popup — lists the leads behind the clicked card. */}
      <LeadsKpiModal
        open={kpiModal !== null}
        onClose={() => setKpiModal(null)}
        title={kpiModal?.title ?? ''}
        filter={kpiModal?.filter ?? {}}
      />
    </div>
  );
}

/* ─── Stat card primitive ─────────────────────────────────────────────
 * Matches the Figma KPI design: white surface with a 12px radius and a
 * tone-tinted border, a soft (light) icon tile carrying the tone-coloured
 * icon, a tone-coloured value + sub-line, and a thin accent stripe on the
 * left edge. Tone palette is driven by CSS custom properties (set per
 * `ldp-stat-<tone>` class) so light + dark modes can each retune the
 * exact hues without inline styles.
 * ───────────────────────────────────────────────────────────────────── */
function StatCard(props: {
  label: string;
  value: number;
  sub: string;
  tone: 'amber' | 'green' | 'red' | 'slate';
  icon: React.ReactNode;
  /* When provided the card becomes a button that opens the KPI popup. */
  onClick?: () => void;
}) {
  const clickable = typeof props.onClick === 'function';
  return (
    <div
      className={`ldp-stat ldp-stat-${props.tone}${clickable ? ' ldp-stat-clickable' : ''}`}
      onClick={props.onClick}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={clickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); props.onClick!(); } } : undefined}
    >
      <div className="ldp-stat-stripe" />
      <div className="ldp-stat-body">
        <div className="ldp-stat-text">
          <div className="ldp-stat-label">{props.label}</div>
          <div className="ldp-stat-value">{props.value.toLocaleString()}</div>
          <div className="ldp-stat-sub">{props.sub}</div>
        </div>
        <div className="ldp-stat-icon">
          {props.icon}
        </div>
      </div>
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

const LDP_CSS = `
/* Page wrapper — fills the in-app content area edge-to-edge. */
.ldp-page {
  animation: ldp-fade .18s ease-out;
  box-sizing: border-box;
  /* Counter the parent layout's gutters so the shell hugs the side rails,
     then re-inset with even padding so the header card clears the navbar
     (top) and sits with equal spacing on the left / right / bottom —
     mirrors the My Workplace worksheet (.lwp-root margin + padding). */
  margin: -1rem -0.75rem;
  padding: 12px 14px;
  /* Fixed available height (viewport minus the app header + horizontal menu)
     so the shell fills the screen, the table scrolls INSIDE it, and the
     header card + KPI cards + pagination stay pinned — mirrors the My
     Workplace worksheet layout (.lwp-root). */
  height: calc(100vh - 130px);
  overflow: hidden;
  display: flex; flex-direction: column;
}
@keyframes ldp-fade { from { opacity: 0; } to { opacity: 1; } }

.ldp-shell {
  width: 100%;
  background: #fff7ed;
  border-radius: 14px;
  border: 1px solid #fde68a;
  box-shadow: 0 6px 22px rgba(217,119,6,.10);
  overflow: hidden;
  /* Fill the remaining page height; KPI cards stay fixed, the table scrolls,
     the pagination stays pinned at the bottom. */
  display: flex; flex-direction: column; flex: 1; min-height: 0;
}

/* ── Header card (its own standalone container above the shell) ─── */
.ldp-header-card {
  width: 100%;
  flex-shrink: 0;
  margin-bottom: 12px;
  border-radius: 14px;
  border: 1px solid #fde68a;
  box-shadow: 0 6px 22px rgba(217,119,6,.10);
  overflow: hidden;
  background: #fffbeb;
}

/* ── Header ─────────────────────────────────────────────────────── */
.ldp-header {
  display: flex; align-items: center; justify-content: space-between;
  gap: 12px; padding: 12px 14px;
  background: linear-gradient(135deg, #fef9c3 0%, #fef3c7 50%, #fde68a 100%);
}
.ldp-header-left { display: flex; align-items: center; gap: 11px; min-width: 0; }
.ldp-header-icon {
  width: 34px; height: 34px; border-radius: 10px;
  background: linear-gradient(135deg, #f59e0b, #ea580c); color: #fff;
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 4px 12px rgba(234,88,12,.30);
  flex-shrink: 0;
}
.ldp-header-icon svg { width: 16px; height: 16px; }
.ldp-header-title { font-size: 14.5px; font-weight: 800; color: #1f2937; letter-spacing: -.2px; }
.ldp-header-sub   { font-size: 10.5px; color: #57534e; margin-top: 2px; }

.ldp-header-right { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
.ldp-header-pill {
  display: inline-flex; align-items: center; gap: 7px;
  padding: 6px 14px; border-radius: 999px;
  background: #ffffff; border: 1px solid #fde68a;
  font-size: 11px; font-weight: 700; color: #92400e;
  box-shadow: 0 1px 2px rgba(217,119,6,.06);
}
.ldp-header-pill-dot {
  width: 7px; height: 7px; border-radius: 50%; background: #f59e0b;
}
.ldp-back-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 8px 18px; border-radius: 9px; border: none;
  background: linear-gradient(135deg, #f59e0b, #ea580c); color: #fff;
  font-size: 11.5px; font-weight: 700; cursor: pointer;
  box-shadow: 0 4px 12px rgba(234,88,12,.32);
  transition: filter .15s, transform .12s, box-shadow .15s;
}
.ldp-back-btn:hover  {
  filter: brightness(1.07); transform: translateY(-1px);
  box-shadow: 0 6px 16px rgba(234,88,12,.38);
}
.ldp-back-btn:active { transform: translateY(0); }

/* ── Stats row — Admin Dashboard KPI card style ─────────────────── */
.ldp-stats {
  display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px;
  padding: 12px 18px 4px;
  flex-shrink: 0;
}
.ldp-stat {
  position: relative;
  background: #ffffff;
  /* Tone-tinted border (Figma look) — falls back to neutral. */
  border: 1.5px solid var(--ldp-tone-border, #e9ebec);
  border-radius: 12px;
  /* Extra left padding clears the 3px accent strip on that edge. */
  padding: 12px 14px 10px 16px;
  box-shadow: 0 2px 14px rgba(0,0,0,0.05);
  overflow: hidden;
  height: 100%;
  transition: transform .18s ease, box-shadow .18s ease, border-color .18s ease;
}
.ldp-stat:hover {
  transform: translateY(-3px);
  box-shadow:
    0 12px 24px -8px rgba(15, 23, 42, 0.16),
    0 6px 14px var(--ldp-tone-shadow, rgba(15, 23, 42, 0.08));
}
.ldp-stat-clickable { cursor: pointer; }
.ldp-stat-clickable:focus-visible {
  outline: 2px solid var(--ldp-tone-accent, #f59e0b); outline-offset: 2px;
}

/* Per-tone palette — Figma KPI colours. Each tone sets the accent
   (stripe + icon glyph), a soft icon-tile background, the tinted card
   border, the value colour, and the sub-line colour. */
.ldp-stat-slate {
  --ldp-tone-accent: #6366f1; --ldp-tone-border: #c7d2fe; --ldp-tone-icon-bg: #eef2ff;
  --ldp-tone-value: #1e293b;  --ldp-tone-sub: #6366f1;    --ldp-tone-shadow: rgba(99,102,241,.16);
}
.ldp-stat-amber {
  --ldp-tone-accent: #d97706; --ldp-tone-border: #fcd34d; --ldp-tone-icon-bg: #fef3c7;
  --ldp-tone-value: #1e293b;  --ldp-tone-sub: #b45309;    --ldp-tone-shadow: rgba(217,119,6,.16);
}
.ldp-stat-green {
  --ldp-tone-accent: #059669; --ldp-tone-border: #a7f3d0; --ldp-tone-icon-bg: #d1fae5;
  --ldp-tone-value: #047857;  --ldp-tone-sub: #059669;    --ldp-tone-shadow: rgba(5,150,105,.16);
}
.ldp-stat-red {
  --ldp-tone-accent: #dc2626; --ldp-tone-border: #fecaca; --ldp-tone-icon-bg: #fee2e2;
  --ldp-tone-value: #dc2626;  --ldp-tone-sub: #dc2626;    --ldp-tone-shadow: rgba(220,38,38,.16);
}
/* Accent strip — vertical bar on the left edge (was a top bar). */
.ldp-stat-stripe {
  position: absolute; top: 0; left: 0; bottom: 0; width: 3px;
  background: var(--ldp-tone-accent, #6366f1);
}
.ldp-stat-body {
  display: flex; align-items: flex-start; justify-content: space-between; gap: 10px;
}
.ldp-stat-text { flex: 1; min-width: 0; }
.ldp-stat-label {
  font-size: 10px; font-weight: 700;
  color: var(--vz-secondary-color, #878a99);
  letter-spacing: 0.06em; text-transform: uppercase;
  margin: 0 0 6px;
}
.ldp-stat-value {
  font-size: clamp(16px, 1.4vw, 22px);
  font-weight: 800;
  color: var(--ldp-tone-value, #1e293b);
  line-height: 1.1;
  word-break: break-word;
  font-variant-numeric: tabular-nums;
  margin: 0;
}
.ldp-stat-sub {
  margin-top: 6px;
  font-size: 10px; font-weight: 600;
  color: var(--ldp-tone-sub, #878a99);
  display: inline-flex; align-items: center; gap: 4px;
}
.ldp-stat-sub::after { content: "›"; font-size: 11px; line-height: 1; opacity: .8; }
.ldp-stat-icon {
  width: 34px; height: 34px; border-radius: 10px;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
  /* Soft tinted tile + tone-coloured glyph (Figma) — not a solid fill. */
  background: var(--ldp-tone-icon-bg, #f1f5f9);
  color: var(--ldp-tone-accent, #475569);
  transition: transform .18s ease, box-shadow .18s ease;
}
.ldp-stat:hover .ldp-stat-icon {
  transform: scale(1.06);
  box-shadow: 0 6px 14px var(--ldp-tone-shadow, rgba(0,0,0,0.12));
}
.ldp-stat-icon svg { width: 16px; height: 16px; color: inherit; }

/* ── Table ──────────────────────────────────────────────────────── */
.ldp-table-wrap {
  margin: 14px 18px 18px;
  background: #fff; border: 1px solid #fde68a; border-radius: 10px;
  overflow: hidden;
  /* Fill remaining shell height; the inner scroll handles overflow so the
     pagination footer stays pinned inside this card. */
  display: flex; flex-direction: column; flex: 1; min-height: 0;
}
/* Scroll area — the wide/tall table scrolls here (x + y); the sticky header
   stays pinned during vertical scroll. */
.ldp-table-scroll { overflow: auto; flex: 1; min-height: 0; }
.ldp-table { width: 100%; border-collapse: collapse; font-size: 11px; min-width: 1050px; }
.ldp-table thead { position: sticky; top: 0; z-index: 5; }
.ldp-table thead tr {
  background: linear-gradient(135deg, #92400e 0%, #b45309 50%, #d97706 100%);
}
.ldp-table thead th {
  color: #fff7ed; font-size: 9.5px; font-weight: 800;
  letter-spacing: .08em;
  text-align: left; padding: 10px 13px; white-space: nowrap;
}
.ldp-th-num    { text-align: center !important; }
.ldp-th-action { text-align: center !important; width: 120px; }

.ldp-table tbody tr {
  border-bottom: 1px solid #fef3c7; transition: background .12s;
}
.ldp-table tbody tr:nth-child(even) { background: #fffbeb; }
.ldp-table tbody tr:last-child      { border-bottom: none; }
.ldp-table tbody tr:hover           { background: #fef3c7; }
.ldp-table tbody td {
  padding: 9px 13px; color: #1f2937; vertical-align: middle;
}
.ldp-td-num    { text-align: center; }
.ldp-td-action { text-align: center; }
.ldp-text  { color: #44403c; font-size: 11px; }
.ldp-muted { color: #d6d3d1; font-style: italic; }

.ldp-person { display: flex; align-items: center; gap: 10px; }
.ldp-avatar {
  width: 28px; height: 28px; border-radius: 50%;
  color: #fff; font-size: 10.5px; font-weight: 800;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
  box-shadow: 0 3px 8px rgba(0,0,0,.10);
}
.ldp-person-name { font-size: 11.5px; font-weight: 700; color: #1f2937; }

.ldp-chip {
  display: inline-block; padding: 3px 12px; border-radius: 999px;
  font-size: 10.5px; font-weight: 700; border: 1.5px solid;
  white-space: nowrap;
}
/* Column-specific chip palettes — each column reads as one tonal
   family across rows (amber / rose / peach) instead of the old
   per-row hash that made adjacent rows look mismatched. */
.ldp-chip-dept {
  background: #fef3c7; color: #92400e; border-color: #fde68a;
}
.ldp-chip-primary {
  background: #ffe4e6; color: #9f1239; border-color: #fecdd3;
}
.ldp-chip-ancillary {
  background: #fce7f3; color: #9d174d; border-color: #fbcfe8;
}
/* Legacy classes — retained for any callers outside this file. */
.ldp-chip-green {
  background: #dcfce7; color: #166534; border-color: #bbf7d0;
}
.ldp-chip-outline {
  background: #fff; color: #b45309; border-color: #fde68a;
}

/* Total Leads badge — outlined amber pill (white surface, amber
   border, amber text). Matches the page's amber tonal family so it
   reads as part of the same accent set as the header/back button
   without competing with the red Unassigned KPI for attention. */
.ldp-total {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 30px; padding: 3px 12px;
  background: #ffffff; color: #b45309;
  border: 1.5px solid #fbbf24;
  border-radius: 999px;
  font-size: 11px; font-weight: 800;
  font-variant-numeric: tabular-nums;
}

/* SR NO badge — small outlined circle so the row index reads as a
   discrete chip instead of a loose number. Same outline recipe as
   the Total Leads pill (white surface, amber stroke) so the two
   numeric columns feel related. */
.ldp-sr-badge {
  display: inline-flex; align-items: center; justify-content: center;
  width: 24px; height: 24px;
  background: #ffffff; color: #b45309;
  border: 1.5px solid #fde68a;
  border-radius: 50%;
  font-size: 10.5px; font-weight: 800;
  font-variant-numeric: tabular-nums;
}

.ldp-view-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 5px 12px; border-radius: 7px;
  background: #ffffff; border: 1.5px solid #fed7aa; color: #ea580c;
  font-size: 10.5px; font-weight: 700; cursor: pointer;
  transition: background .15s, color .15s, border-color .15s, transform .12s, box-shadow .15s;
  white-space: nowrap;
}
.ldp-view-btn:hover {
  background: #fff7ed; border-color: #fdba74; color: #c2410c;
  transform: translateY(-1px);
  box-shadow: 0 4px 10px rgba(234,88,12,.15);
}
.ldp-view-btn:active { transform: translateY(0); }

.ldp-status {
  text-align: center; padding: 24px 14px;
  color: #a8a29e; font-style: italic; font-size: 11px;
}

/* ── Loading shimmer — skeleton rows shown while the roster loads ── */
.ldp-skel-row td { padding: 9px 13px; }
.ldp-skel {
  display: inline-block; vertical-align: middle;
  border-radius: 6px;
  background: linear-gradient(100deg, #fdf6e8 30%, #fce9c4 50%, #fdf6e8 70%);
  background-size: 200% 100%;
  animation: ldp-shimmer 1.2s ease-in-out infinite;
}
.ldp-skel-line   { height: 11px; width: 100%; }
.ldp-skel-sr     { width: 24px; height: 24px; border-radius: 50%; }
.ldp-skel-avatar { width: 28px; height: 28px; border-radius: 50%; flex-shrink: 0; }
.ldp-skel-chip   { width: 64px; height: 20px; border-radius: 999px; }
.ldp-skel-pill   { width: 36px; height: 22px; border-radius: 999px; }
.ldp-skel-btn    { width: 86px; height: 26px; border-radius: 7px; }
@keyframes ldp-shimmer {
  0%   { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
[data-bs-theme="dark"] .ldp-skel {
  background: linear-gradient(100deg, #2a1d10 30%, #3d2c16 50%, #2a1d10 70%);
  background-size: 200% 100%;
}

/* ── Pagination footer ──────────────────────────────────────────── */
.ldp-pagination {
  flex-shrink: 0;
  display: flex; align-items: center; justify-content: space-between;
  gap: 12px; padding: 10px 14px;
  background: #fffbeb; border-top: 1px solid #fde68a;
  font-size: 11px; color: #57534e;
  flex-wrap: wrap;
}
.ldp-pagination-info {
  font-weight: 600; color: #92400e;
  background: #fff; border: 1.5px solid #fde68a;
  padding: 4px 13px; border-radius: 999px;
}
.ldp-pagination-controls {
  display: flex; align-items: center; gap: 14px;
}
.ldp-rows-per-page {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 11px; color: #57534e; font-weight: 600;
}
.ldp-rows-per-page select {
  border: 1.5px solid #fde68a; border-radius: 999px;
  /* Amber-gradient pill to match the page-indicator / info pills. */
  background-color: transparent;
  background-image:
    url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2392400e' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E"),
    linear-gradient(135deg, #fef9c3, #fef3c7);
  background-repeat: no-repeat, no-repeat;
  background-position: right 9px center, center;
  background-size: 12px, 100% 100%;
  color: #78350f;
  padding: 4px 26px 4px 13px; font-size: 11px; font-weight: 800;
  cursor: pointer; outline: none;
  appearance: none;
}
.ldp-rows-per-page select:focus { border-color: #f59e0b; box-shadow: 0 0 0 3px rgba(245,158,11,.18); }
.ldp-page-indicator {
  font-size: 11px; font-weight: 700; color: #78350f;
  min-width: 36px; text-align: center;
  background: linear-gradient(135deg, #fef9c3, #fef3c7);
  border: 1.5px solid #fde68a;
  padding: 4px 12px; border-radius: 999px;
}
.ldp-page-btn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 27px; height: 27px; border-radius: 50%;
  background: #fff; border: 1.5px solid #fde68a; color: #b45309;
  cursor: pointer;
  transition: background .15s, color .15s, border-color .15s, transform .12s;
}
.ldp-page-btn:hover:not(:disabled) {
  background: linear-gradient(135deg, #fde68a, #fcd34d);
  color: #92400e; transform: translateY(-1px);
}
.ldp-page-btn:active:not(:disabled) { transform: translateY(0); }
.ldp-page-btn:disabled {
  opacity: .45; cursor: not-allowed;
}

/* ── Dark mode adaptation ───────────────────────────────────────── */
[data-bs-theme="dark"] .ldp-shell { background: #1c1410; }
[data-bs-theme="dark"] .ldp-header-card {
  background: #1c1410; border-color: #422006;
}
[data-bs-theme="dark"] .ldp-header {
  background: linear-gradient(135deg, #422006 0%, #78350f 60%, #92400e 100%);
}
[data-bs-theme="dark"] .ldp-header-title { color: #fef3c7; }
[data-bs-theme="dark"] .ldp-header-sub   { color: #fcd34d; }
[data-bs-theme="dark"] .ldp-header-pill  { background: rgba(0,0,0,.30); color: #fcd34d; border-color: #b45309; }
[data-bs-theme="dark"] .ldp-stat { background: #1f1611; color: #fef3c7; }
[data-bs-theme="dark"] .ldp-stat-label { color: #d6d3d1; }
/* Retune each tone for the dark surface — brighter accents, translucent
   tiles/borders so the cards read against #1f1611 without glare. */
[data-bs-theme="dark"] .ldp-stat-slate {
  --ldp-tone-accent: #a5b4fc; --ldp-tone-border: rgba(99,102,241,.40); --ldp-tone-icon-bg: rgba(99,102,241,.18);
  --ldp-tone-value: #e0e7ff;  --ldp-tone-sub: #a5b4fc;
}
[data-bs-theme="dark"] .ldp-stat-amber {
  --ldp-tone-accent: #fbbf24; --ldp-tone-border: rgba(217,119,6,.45); --ldp-tone-icon-bg: rgba(217,119,6,.18);
  --ldp-tone-value: #fde68a;  --ldp-tone-sub: #fbbf24;
}
[data-bs-theme="dark"] .ldp-stat-green {
  --ldp-tone-accent: #34d399; --ldp-tone-border: rgba(16,185,129,.40); --ldp-tone-icon-bg: rgba(16,185,129,.18);
  --ldp-tone-value: #6ee7b7;  --ldp-tone-sub: #34d399;
}
[data-bs-theme="dark"] .ldp-stat-red {
  --ldp-tone-accent: #f87171; --ldp-tone-border: rgba(239,68,68,.40); --ldp-tone-icon-bg: rgba(239,68,68,.18);
  --ldp-tone-value: #fca5a5;  --ldp-tone-sub: #f87171;
}
[data-bs-theme="dark"] .ldp-table-wrap { background: #1f1611; border-color: #422006; }
[data-bs-theme="dark"] .ldp-table tbody tr { border-color: #422006; }
[data-bs-theme="dark"] .ldp-table tbody tr:nth-child(even) { background: #28190e; }
[data-bs-theme="dark"] .ldp-table tbody tr:hover { background: #422006; }
[data-bs-theme="dark"] .ldp-table tbody td { color: #fef3c7; }
[data-bs-theme="dark"] .ldp-person-name   { color: #fef3c7; }
[data-bs-theme="dark"] .ldp-text          { color: #fde68a; }
[data-bs-theme="dark"] .ldp-chip-outline  { background: #1f1611; }
[data-bs-theme="dark"] .ldp-chip-dept {
  background: rgba(146, 64, 14, .25); color: #fcd34d; border-color: rgba(253, 230, 138, .35);
}
[data-bs-theme="dark"] .ldp-chip-primary {
  background: rgba(159, 18, 57, .25); color: #fda4af; border-color: rgba(254, 205, 211, .35);
}
[data-bs-theme="dark"] .ldp-chip-ancillary {
  background: rgba(157, 23, 77, .25); color: #f9a8d4; border-color: rgba(251, 207, 232, .35);
}
[data-bs-theme="dark"] .ldp-view-btn      { background: #1f1611; border-color: #7c2d12; color: #fdba74; }
[data-bs-theme="dark"] .ldp-view-btn:hover{ background: #28190e; border-color: #c2410c; color: #fed7aa; }
[data-bs-theme="dark"] .ldp-total {
  background: #1f1611; color: #fcd34d; border-color: #b45309;
}
[data-bs-theme="dark"] .ldp-sr-badge {
  background: #1f1611; color: #fcd34d; border-color: #422006;
}
[data-bs-theme="dark"] .ldp-pagination    { background: #28190e; border-color: #422006; color: #d6d3d1; }
[data-bs-theme="dark"] .ldp-pagination-info { background: #1f1611; color: #fde68a; border-color: #422006; }
[data-bs-theme="dark"] .ldp-rows-per-page { color: #d6d3d1; }
[data-bs-theme="dark"] .ldp-rows-per-page select {
  color: #fef3c7; border-color: #422006;
  background-image:
    url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23fcd34d' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E"),
    linear-gradient(135deg, #28190e, #1f1611);
}
[data-bs-theme="dark"] .ldp-page-indicator {
  color: #fcd34d; background: linear-gradient(135deg, #28190e, #1f1611); border-color: #422006;
}
[data-bs-theme="dark"] .ldp-page-btn { background: #1f1611; border-color: #422006; color: #fcd34d; }

/* Tablet — 2-up stats, header pills wrap below the back button */
@media (max-width: 1100px) {
  .ldp-stats { grid-template-columns: repeat(2, 1fr); }
  .ldp-header { flex-wrap: wrap; }
  .ldp-header-right { flex-wrap: wrap; justify-content: flex-end; width: 100%; }
}

/* Phone — full-width page, single-column stats, table scrolls
   horizontally, header collapses to a tighter stack. */
@media (max-width: 640px) {
  .ldp-page { padding: 0; }
  .ldp-header-card {
    border-radius: 0; border-left: none; border-right: none; margin-bottom: 10px;
  }
  .ldp-shell {
    width: 100%; border-radius: 0; border-left: none; border-right: none;
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
  .ldp-table-wrap { margin: 12px 16px 16px; }
  .ldp-pagination {
    flex-direction: column; align-items: stretch; gap: 8px; padding: 10px 12px;
  }
  .ldp-pagination-controls { justify-content: space-between; gap: 8px; }
  .ldp-table thead th, .ldp-table tbody td { padding: 10px 12px; font-size: 11.5px; }
  .ldp-person-name { font-size: 12px; }
  .ldp-avatar { width: 30px; height: 30px; font-size: 11px; }
}
`;
