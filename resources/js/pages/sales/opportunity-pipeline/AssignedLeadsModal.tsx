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
 * same colour across rows. Total Leads is shown as a bold cyan pill.
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
  /* False only for a deactivated user who still holds leads. They are listed
     so their leads can be handed on; the chip says why they are here. */
  is_active?:            boolean;
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
  /* Starts TRUE. The summary above is only a SHAPE, not an answer — every
   * count in it is zero until the API replies. With `loading` starting false
   * the first painted frame published those zeros as if they were real
   * ("Total Leads 0", "Assigned 0", "Unassigned 0") and then snapped to the
   * true figures, which is what QA #261–#263 saw. True here means the cards
   * show a shimmer until there is something honest to print. */
  const [loading, setLoading] = useState(true);
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

  /* Every salesperson in the roster, including those holding no leads yet.
   *
   * This used to filter to `total_assigned_leads > 0` on the grounds that an
   * empty salesperson is noise. On a page called Lead DISTRIBUTION they are
   * precisely the people being looked for: someone with zero leads is the
   * next person to hand one to, and hiding them made the team look like it
   * was three people (QA #10). The server already builds the roster this way
   * on purpose — "the table shows zero-lead salespeople too so the user can
   * see the whole team at a glance".
   *
   * The KPI and header pill still count these same rows, so the number keeps
   * matching what is visible in the table. */
  const leadRows   = rows;
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
        <span className="ldp-banner-accent" />
        <span className="ldp-banner-glow" />
        <span className="ldp-banner-sheen" />
        <div className="ldp-header">
          <div className="ldp-header-left">
            <div className="ldp-header-icon-wrap">
              <div className="ldp-header-icon">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                  <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
              </div>
              <span className="ldp-header-dot" />
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
              {loading ? <span className="ldp-skel ldp-skel-num" /> : totalCount} Sales Members
            </span>
            <span className="ldp-header-pill">
              <span className="ldp-header-pill-dot" />
              {loading ? <span className="ldp-skel ldp-skel-num" /> : (summary?.total_leads ?? 0)} Total Leads
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
            loading={loading}
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
            loading={loading}
            sub="All leads"
            tone="cyan"
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
            loading={loading}
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
            loading={loading}
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
                    <span className="ldp-skel ldp-skel-line" style={{ width: '70%' }} />
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
                      <div className="ldp-person-name">
                        {r.salesperson_name}
                        {r.is_active === false && (
                          <span
                            className="ldp-chip ldp-chip-inactive"
                            title="This user is deactivated — reassign their leads"
                          >
                            Inactive
                          </span>
                        )}
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
  tone: 'cyan' | 'green' | 'red' | 'slate';
  icon: React.ReactNode;
  /* While true the card prints a shimmer bar instead of `value`. A zero that
   * only means "not fetched yet" is a wrong answer, not a neutral one — see
   * the note on `loading` above. The card is also not clickable yet: the KPI
   * popup it opens is scoped to a bucket whose size isn't known. */
  loading?: boolean;
  /* When provided the card becomes a button that opens the KPI popup. */
  onClick?: () => void;
}) {
  const clickable = typeof props.onClick === 'function' && !props.loading;
  return (
    <div
      className={`ldp-stat ldp-stat-${props.tone}${clickable ? ' ldp-stat-clickable' : ''}`}
      onClick={clickable ? props.onClick : undefined}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={clickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); props.onClick!(); } } : undefined}
    >
      <div className="ldp-stat-stripe" />
      <div className="ldp-stat-body">
        <div className="ldp-stat-text">
          <div className="ldp-stat-label">{props.label}</div>
          <div className="ldp-stat-value">
            {props.loading
              ? <span className="ldp-skel ldp-skel-kpi" aria-label="Loading" />
              : props.value.toLocaleString()}
          </div>
          <div className="ldp-stat-sub">{props.sub}</div>
        </div>
        <div className="ldp-stat-icon">
          {props.icon}
        </div>
      </div>
    </div>
  );
}

const LDP_CSS = `
/* Lead Distribution — the My Workplace (Lead Worksheet) look: its cyan banner,
   toolbar button, table header, row tint and pager, so the two pages read as one. */
.ldp-page {
  animation: ldp-fade .18s ease-out;
  box-sizing: border-box;
  margin: -1rem -0.75rem;
  padding: 12px 14px;
  height: calc(100vh - 130px);
  overflow: hidden;
  display: flex; flex-direction: column;
  background: linear-gradient(160deg, #f0fdfe 0%, #e8fafb 30%, #f5feff 60%, #ffffff 100%);
}
@keyframes ldp-fade { from { opacity: 0; } to { opacity: 1; } }

.ldp-shell {
  width: 100%;
  background: #f5feff;
  border-radius: 14px;
  border: 1px solid #cef3f9;
  box-shadow: 0 4px 16px rgba(8,145,178,.08);
  overflow: hidden;
  display: flex; flex-direction: column; flex: 1; min-height: 0;
}

/* ── Header — the My Workplace banner (.lwp-banner) ── */
.ldp-header-card {
  position: relative; overflow: hidden;
  width: 100%; flex-shrink: 0;
  margin-bottom: 8px;
  border: 1px solid #cef3f9; border-radius: 16px;
  background: linear-gradient(110deg, #f0fdff 0%, #e6fafe 25%, #d0f5fb 55%, #bef0f8 85%, #a8eaf5 100%);
  box-shadow: 0 2px 0 rgba(255,255,255,.9) inset, 0 4px 16px rgba(8,145,178,.1), 0 1px 4px rgba(0,0,0,.04);
}
.ldp-banner-accent {
  position: absolute; left: 0; top: 0; bottom: 0; width: 4px; z-index: 2;
  background: linear-gradient(180deg, #06b6d4, #0891b2, #0e7490);
  border-radius: 16px 0 0 16px;
}
.ldp-banner-glow {
  position: absolute; inset: 0; pointer-events: none;
  background-image:
    radial-gradient(ellipse at 10% 50%, rgba(190,240,248,.35) 0%, transparent 50%),
    radial-gradient(ellipse at 90% 50%, rgba(168,234,245,.2) 0%, transparent 55%);
}
.ldp-banner-sheen {
  position: absolute; top: 0; left: 0; right: 0; height: 50%;
  pointer-events: none;
  background: linear-gradient(180deg, rgba(255,255,255,.5), transparent);
}
.ldp-header {
  position: relative; z-index: 1;
  display: flex; align-items: center; justify-content: space-between;
  gap: 12px; min-height: 58px; padding: 0 14px 0 18px;
}
.ldp-header-left { display: flex; align-items: center; gap: 13px; min-width: 0; }
.ldp-header-icon-wrap { position: relative; flex-shrink: 0; }
.ldp-header-icon {
  width: 38px; height: 38px; border-radius: 12px;
  display: flex; align-items: center; justify-content: center;
  background: linear-gradient(135deg, #0891b2 0%, #0e7490 55%, #155e75 100%);
  color: #fff;
  box-shadow: 0 0 0 3px rgba(8,145,178,.25), 0 4px 14px rgba(14,116,144,.45);
}
.ldp-header-icon svg { width: 17px; height: 17px; }
.ldp-header-dot {
  position: absolute; bottom: -1px; right: -1px;
  width: 10px; height: 10px; border-radius: 50%;
  background: linear-gradient(135deg, #4ade80, #22c55e);
  border: 2px solid #cffafe;
  box-shadow: 0 2px 4px rgba(34,197,94,.4);
}
.ldp-header-title { font-size: 14.5px; font-weight: 700; color: #0c4a6e; letter-spacing: -.3px; line-height: 1.2; }
.ldp-header-sub   { font-size: 10px; font-weight: 500; color: #0e7490; opacity: .85; margin-top: 2px; }

.ldp-header-right { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.ldp-header-pill {
  display: inline-flex; align-items: center; gap: 7px;
  padding: 6px 14px; border-radius: 999px;
  background: rgba(255,255,255,.8); border: 1.5px solid #a5f3fc;
  font-size: 11px; font-weight: 700; color: #0e7490;
  box-shadow: 0 1px 4px rgba(8,145,178,.1), 0 1px 0 rgba(255,255,255,.9) inset;
}
.ldp-header-pill-dot { width: 7px; height: 7px; border-radius: 50%; background: #06b6d4; }
/* Back = the My Workplace toolbar button (.lwp-bact): cyan gradient, 40px, 11.5 / 700. */
.ldp-back-btn {
  position: relative; overflow: hidden;
  display: inline-flex; align-items: center; gap: 7px;
  height: 40px; padding: 0 18px; border-radius: 12px; border: none;
  background: linear-gradient(135deg, #06b6d4 0%, #0891b2 55%, #0e7490 100%);
  color: #fff; font-family: inherit; font-size: 11.5px; font-weight: 700; letter-spacing: .02em;
  white-space: nowrap; cursor: pointer;
  text-shadow: 0 1px 2px rgba(0,0,0,.15);
  box-shadow: 0 4px 16px rgba(6,182,212,.45), 0 2px 6px rgba(8,145,178,.25), 0 1px 0 rgba(255,255,255,.22) inset;
  transition: all .22s;
}
.ldp-back-btn:hover {
  background: linear-gradient(135deg, #22d3ee 0%, #06b6d4 55%, #0891b2 100%);
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(6,182,212,.55), 0 3px 8px rgba(8,145,178,.3), 0 1px 0 rgba(255,255,255,.22) inset;
}
.ldp-back-btn:active { transform: translateY(0); }

/* ── KPI cards ── */
.ldp-stats {
  display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px;
  padding: 12px 18px 4px;
  flex-shrink: 0;
}
.ldp-stat {
  position: relative;
  background: #ffffff;
  border: 1.5px solid var(--ldp-tone-border, #e9ebec);
  border-radius: 12px;
  padding: 12px 14px 10px 16px;
  box-shadow: 0 2px 14px rgba(0,0,0,0.05);
  overflow: hidden;
  height: 100%;
  transition: transform .18s ease, box-shadow .18s ease, border-color .18s ease;
}
.ldp-stat:hover {
  transform: translateY(-3px);
  box-shadow: 0 12px 24px -8px rgba(15, 23, 42, 0.16), 0 6px 14px var(--ldp-tone-shadow, rgba(15, 23, 42, 0.08));
}
.ldp-stat-clickable { cursor: pointer; }
.ldp-stat-clickable:focus-visible { outline: 2px solid var(--ldp-tone-accent, #0891b2); outline-offset: 2px; }
/* KPI tones — all in the page's cyan family (sky / cyan / deep cyan / bright cyan). */
.ldp-stat-slate {
  --ldp-tone-accent: #0284c7; --ldp-tone-border: #bae6fd; --ldp-tone-icon-bg: #e0f2fe;
  --ldp-tone-value: #0c4a6e;  --ldp-tone-sub: #0369a1;    --ldp-tone-shadow: rgba(2,132,199,.16);
}
.ldp-stat-cyan {
  --ldp-tone-accent: #0891b2; --ldp-tone-border: #a5f3fc; --ldp-tone-icon-bg: #cffafe;
  --ldp-tone-value: #0c4a6e;  --ldp-tone-sub: #0e7490;    --ldp-tone-shadow: rgba(8,145,178,.16);
}
.ldp-stat-green {
  --ldp-tone-accent: #0e7490; --ldp-tone-border: #a5f3fc; --ldp-tone-icon-bg: #cffafe;
  --ldp-tone-value: #0c4a6e;  --ldp-tone-sub: #0e7490;    --ldp-tone-shadow: rgba(14,116,144,.16);
}
.ldp-stat-red {
  --ldp-tone-accent: #06b6d4; --ldp-tone-border: #a5f3fc; --ldp-tone-icon-bg: #ecfeff;
  --ldp-tone-value: #0c4a6e;  --ldp-tone-sub: #0891b2;    --ldp-tone-shadow: rgba(6,182,212,.16);
}
.ldp-stat-stripe {
  position: absolute; top: 0; left: 0; bottom: 0; width: 3px;
  background: var(--ldp-tone-accent, #6366f1);
}
.ldp-stat-body { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
.ldp-stat-text { flex: 1; min-width: 0; }
.ldp-stat-label {
  font-size: 10px; font-weight: 700;
  color: var(--vz-secondary-color, #878a99);
  letter-spacing: 0.06em; text-transform: uppercase;
  margin: 0 0 6px;
}
.ldp-stat-value {
  font-size: clamp(16px, 1.4vw, 22px);
  font-weight: 600;
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
  background: var(--ldp-tone-icon-bg, #f1f5f9);
  color: var(--ldp-tone-accent, #475569);
  transition: transform .18s ease, box-shadow .18s ease;
}
.ldp-stat:hover .ldp-stat-icon { transform: scale(1.06); box-shadow: 0 6px 14px var(--ldp-tone-shadow, rgba(0,0,0,0.12)); }
.ldp-stat-icon svg { width: 16px; height: 16px; color: inherit; }

/* ── Table — the My Workplace table card (.lwp-table-card / .lwp-table) ── */
.ldp-table-wrap {
  margin: 14px 18px 18px;
  background: #fff; border: 1.5px solid #a5f3fc; border-radius: 14px;
  box-shadow: 0 4px 20px rgba(8,145,178,.1), 0 1px 4px rgba(0,0,0,.04);
  overflow: hidden;
  display: flex; flex-direction: column; flex: 1; min-height: 0;
}
.ldp-table-scroll {
  overflow: auto; flex: 1; min-height: 0;
  scrollbar-width: thin; scrollbar-color: #a5f3fc transparent;
}
.ldp-table { width: 100%; border-collapse: collapse; font-size: 11px; min-width: 1050px; }
.ldp-table thead { position: sticky; top: 0; z-index: 5; }
.ldp-table thead tr {
  background: linear-gradient(90deg, #155e75 0%, #0e7490 25%, #0891b2 55%, #06b6d4 80%, #22d3ee 100%);
  box-shadow: 0 2px 10px rgba(8,145,178,.3);
}
.ldp-table thead th {
  color: #fff; font-size: 9.5px; font-weight: 700;
  letter-spacing: .07em; text-transform: uppercase;
  text-align: left; padding: 10px 13px; white-space: nowrap;
  text-shadow: 0 1px 3px rgba(0,0,0,.2);
}
.ldp-th-num    { text-align: center !important; }
.ldp-th-action { text-align: center !important; width: 120px; }
.ldp-table tbody tr { border-bottom: 1px solid #ecfeff; transition: background .12s; }
.ldp-table tbody tr:nth-child(even) { background: #f7fffe; }
.ldp-table tbody tr:last-child      { border-bottom: none; }
.ldp-table tbody tr:hover           { background: #ecfeff; }
.ldp-table tbody td { padding: 9px 13px; color: #475569; vertical-align: middle; }
.ldp-td-num    { text-align: center; }
.ldp-td-action { text-align: center; }
.ldp-text  { color: #475569; font-size: 11px; }
.ldp-muted { color: #cbd5e1; font-style: italic; }

.ldp-person-name { font-size: 11.5px; font-weight: 500; color: #0f172a; }

.ldp-chip {
  display: inline-block; padding: 3px 12px; border-radius: 999px;
  font-size: 10.5px; font-weight: 700; border: 1.5px solid;
  white-space: nowrap;
}
.ldp-chip-dept      { background: #ecfeff; color: #0e7490; border-color: #a5f3fc; }
.ldp-chip-inactive  { background: #e5e7eb; color: #4b5563; border-color: #d1d5db; margin-left: 6px; vertical-align: middle; }
.ldp-chip-primary   { background: #e0f2fe; color: #0369a1; border-color: #bae6fd; }
.ldp-chip-ancillary { background: #ccfbf1; color: #0f766e; border-color: #99f6e4; }
.ldp-chip-green     { background: #dcfce7; color: #166534; border-color: #bbf7d0; }
.ldp-chip-outline   { background: #fff; color: #0e7490; border-color: #a5f3fc; }

.ldp-total {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 30px; padding: 3px 12px;
  background: #ffffff; color: #0e7490;
  border: 1.5px solid #67e8f9;
  border-radius: 999px;
  font-size: 11px; font-weight: 800;
  font-variant-numeric: tabular-nums;
}
/* Sr No = the Customers list badge (.dt-serial): filled rounded square, white
   number — in this page's cyan. */
.ldp-sr-badge {
  display: inline-flex; align-items: center; justify-content: center;
  width: 24px; height: 24px; border-radius: 7px;
  background: linear-gradient(135deg, #0891b2, #155e75);
  color: #fff;
  font-size: 11px; font-weight: 800;
  font-variant-numeric: tabular-nums;
  box-shadow: 0 2px 6px rgba(8,145,178,.30);
}
.ldp-view-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 5px 12px; border-radius: 8px;
  background: #ffffff; border: 1.5px solid #a5f3fc; color: #0891b2;
  font-family: inherit; font-size: 10.5px; font-weight: 700; cursor: pointer;
  transition: background .15s, color .15s, border-color .15s, transform .12s, box-shadow .15s;
  white-space: nowrap;
}
.ldp-view-btn:hover {
  background: linear-gradient(135deg, #06b6d4 0%, #0891b2 55%, #0e7490 100%);
  border-color: transparent; color: #fff;
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(8,145,178,.35);
}
.ldp-view-btn:active { transform: translateY(0); }

/* Cell type = the Customers list (.smc-table-wrap): 11.5 / 500 for every data cell;
   badges keep their own sizes (chips at the Leads Details lead-type badge weight). */
.ldp-table tbody td,
.ldp-table tbody td *:not(i):not(svg):not(svg *) { font-size: 11.5px !important; font-weight: 500 !important; }
.ldp-table tbody td .ldp-sr-badge.ldp-sr-badge { font-size: 11px !important; font-weight: 800 !important; }
.ldp-table tbody td .ldp-chip.ldp-chip { font-size: 10px !important; font-weight: 600 !important; }
.ldp-table tbody td .ldp-total.ldp-total { font-size: 11px !important; font-weight: 800 !important; }
.ldp-table tbody td .ldp-view-btn.ldp-view-btn,
.ldp-table tbody td .ldp-view-btn.ldp-view-btn * { font-size: 10.5px !important; font-weight: 700 !important; }
.ldp-status { text-align: center; padding: 24px 14px; color: #94a3b8; font-style: italic; font-size: 11px; }

/* ── Loading shimmer ── */
.ldp-skel-row td { padding: 9px 13px; }
.ldp-skel {
  display: inline-block; vertical-align: middle;
  border-radius: 6px;
  background: linear-gradient(100deg, #ecfeff 30%, #cffafe 50%, #ecfeff 70%);
  background-size: 200% 100%;
  animation: ldp-shimmer 1.2s ease-in-out infinite;
}
.ldp-skel-line   { height: 11px; width: 100%; }
.ldp-skel-sr     { width: 24px; height: 24px; border-radius: 50%; }
.ldp-skel-chip   { width: 64px; height: 20px; border-radius: 999px; }
.ldp-skel-kpi    { width: 52px; height: 20px; border-radius: 6px; }
.ldp-skel-num    { width: 22px; height: 10px; border-radius: 4px; margin-right: 2px; }
.ldp-skel-pill   { width: 36px; height: 22px; border-radius: 999px; }
.ldp-skel-btn    { width: 86px; height: 26px; border-radius: 7px; }
@keyframes ldp-shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }

/* ── Pager — the My Workplace pager (.lwp-pagination) ── */
.ldp-pagination {
  flex-shrink: 0;
  display: flex; align-items: center; justify-content: space-between;
  gap: 8px; padding: 10px 16px;
  background: linear-gradient(90deg, #ecfeff 0%, #cffafe 40%, #ecfeff 100%);
  border-top: 2px solid #a5f3fc;
  flex-wrap: wrap;
}
.ldp-pagination-info {
  display: inline-flex; align-items: center; gap: 5px;
  font-size: 11.5px; font-weight: 500; color: #0e7490;
  background: rgba(255,255,255,.8); border: 1.5px solid #a5f3fc;
  padding: 5px 14px; border-radius: 20px;
  box-shadow: 0 1px 4px rgba(8,145,178,.1), 0 1px 0 rgba(255,255,255,.9) inset;
}
.ldp-pagination-controls { display: flex; align-items: center; gap: 8px; }
.ldp-rows-per-page {
  display: inline-flex; align-items: center; gap: 5px;
  font-size: 11.5px; color: #0e7490; font-weight: 500;
  background: rgba(255,255,255,.8); border: 1.5px solid #a5f3fc;
  padding: 4px 12px; border-radius: 20px;
  box-shadow: 0 1px 4px rgba(8,145,178,.1), 0 1px 0 rgba(255,255,255,.9) inset;
}
.ldp-rows-per-page select {
  border: none; background: transparent; font-family: inherit;
  font-size: 11.5px; color: #0891b2; font-weight: 700; cursor: pointer; outline: none;
}
.ldp-page-indicator {
  font-size: 11.5px; font-weight: 800; color: #fff;
  min-width: 36px; text-align: center;
  background: linear-gradient(135deg, #0891b2 0%, #0e7490 55%, #155e75 100%);
  border: none; padding: 5px 18px; border-radius: 20px;
  box-shadow: 0 3px 12px rgba(8,145,178,.4), 0 1px 0 rgba(255,255,255,.2) inset;
  white-space: nowrap;
}
.ldp-page-btn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 32px; height: 32px; border-radius: 50%;
  background: rgba(255,255,255,.8); border: 1.5px solid #a5f3fc; color: #0891b2;
  cursor: pointer;
  transition: all .18s;
}
.ldp-page-btn:hover:not(:disabled) {
  background: #fff; border-color: #0891b2;
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(8,145,178,.25);
}
.ldp-page-btn:active:not(:disabled) { transform: translateY(0); }
.ldp-page-btn:disabled { opacity: .4; cursor: not-allowed; }

/* ── Dark mode — the My Workplace dark cyan ── */
[data-bs-theme="dark"] .ldp-page { background: transparent; }
[data-bs-theme="dark"] .ldp-shell { background: #0c1f2e; border-color: rgba(34,211,238,.18); }
[data-bs-theme="dark"] .ldp-header-card {
  background:
    radial-gradient(ellipse at top right, rgba(34,211,238,0.10), transparent 60%),
    radial-gradient(ellipse at bottom left, rgba(14,165,233,0.08), transparent 60%),
    linear-gradient(135deg, #0e2940 0%, #102a3a 50%, #0c1f2e 100%);
  border-color: rgba(34,211,238,0.18);
  box-shadow: 0 2px 0 rgba(255,255,255,.04) inset, 0 4px 16px rgba(0,0,0,.35), 0 1px 4px rgba(0,0,0,.25);
}
[data-bs-theme="dark"] .ldp-banner-sheen { background: linear-gradient(180deg, rgba(255,255,255,.05), transparent); }
[data-bs-theme="dark"] .ldp-banner-glow {
  background-image:
    radial-gradient(ellipse at 10% 50%, rgba(34,211,238,.10) 0%, transparent 50%),
    radial-gradient(ellipse at 90% 50%, rgba(14,165,233,.08) 0%, transparent 55%);
}
[data-bs-theme="dark"] .ldp-header-title { color: #f0f9ff; }
[data-bs-theme="dark"] .ldp-header-sub   { color: #67e8f9; }
[data-bs-theme="dark"] .ldp-header-pill  { background: rgba(34,211,238,.10); color: #67e8f9; border-color: rgba(103,232,249,.35); box-shadow: none; }
[data-bs-theme="dark"] .ldp-stat { background: #0f2233; color: #e0f2fe; }
[data-bs-theme="dark"] .ldp-stat-label { color: #94a3b8; }
[data-bs-theme="dark"] .ldp-stat-slate {
  --ldp-tone-accent: #7dd3fc; --ldp-tone-border: rgba(56,189,248,.40); --ldp-tone-icon-bg: rgba(56,189,248,.16);
  --ldp-tone-value: #e0f2fe;  --ldp-tone-sub: #7dd3fc;
}
[data-bs-theme="dark"] .ldp-stat-cyan {
  --ldp-tone-accent: #67e8f9; --ldp-tone-border: rgba(34,211,238,.40); --ldp-tone-icon-bg: rgba(34,211,238,.16);
  --ldp-tone-value: #cffafe;  --ldp-tone-sub: #67e8f9;
}
[data-bs-theme="dark"] .ldp-stat-green {
  --ldp-tone-accent: #67e8f9; --ldp-tone-border: rgba(34,211,238,.40); --ldp-tone-icon-bg: rgba(34,211,238,.16);
  --ldp-tone-value: #cffafe;  --ldp-tone-sub: #67e8f9;
}
[data-bs-theme="dark"] .ldp-stat-red {
  --ldp-tone-accent: #67e8f9; --ldp-tone-border: rgba(34,211,238,.40); --ldp-tone-icon-bg: rgba(34,211,238,.16);
  --ldp-tone-value: #cffafe;  --ldp-tone-sub: #67e8f9;
}
[data-bs-theme="dark"] .ldp-table-wrap { background: #0f2233; border-color: rgba(34,211,238,.25); box-shadow: 0 4px 20px rgba(0,0,0,.35); }
[data-bs-theme="dark"] .ldp-table tbody tr { border-color: rgba(34,211,238,.10); }
[data-bs-theme="dark"] .ldp-table tbody tr:nth-child(even) { background: rgba(8,145,178,.06); }
[data-bs-theme="dark"] .ldp-table tbody tr:hover { background: rgba(8,145,178,.14); }
[data-bs-theme="dark"] .ldp-table tbody td { color: #cbd5e1; }
[data-bs-theme="dark"] .ldp-person-name   { color: #f0f9ff; }
[data-bs-theme="dark"] .ldp-text          { color: #cbd5e1; }
[data-bs-theme="dark"] .ldp-chip-outline  { background: transparent; }
[data-bs-theme="dark"] .ldp-chip-dept      { background: rgba(8,145,178,.18); color: #67e8f9; border-color: rgba(103,232,249,.35); }
[data-bs-theme="dark"] .ldp-chip-inactive  { background: rgba(75,85,99,.35); color: #d1d5db; border-color: rgba(209,213,219,.3); }
[data-bs-theme="dark"] .ldp-chip-primary   { background: rgba(3,105,161,.25); color: #7dd3fc; border-color: rgba(125,211,252,.35); }
[data-bs-theme="dark"] .ldp-chip-ancillary { background: rgba(15,118,110,.25); color: #5eead4; border-color: rgba(94,234,212,.35); }
[data-bs-theme="dark"] .ldp-view-btn      { background: transparent; border-color: rgba(103,232,249,.35); color: #67e8f9; }
[data-bs-theme="dark"] .ldp-total         { background: transparent; color: #67e8f9; border-color: rgba(103,232,249,.35); }
[data-bs-theme="dark"] .ldp-sr-badge      { color: #e2e8f0; }
[data-bs-theme="dark"] .ldp-skel { background: linear-gradient(100deg, #10293a 30%, #15384d 50%, #10293a 70%); background-size: 200% 100%; }
[data-bs-theme="dark"] .ldp-pagination { background: rgba(8,145,178,.08); border-top-color: rgba(34,211,238,.25); }
[data-bs-theme="dark"] .ldp-pagination-info,
[data-bs-theme="dark"] .ldp-rows-per-page { background: rgba(15,34,51,.8); color: #67e8f9; border-color: rgba(103,232,249,.30); box-shadow: none; }
[data-bs-theme="dark"] .ldp-rows-per-page select { color: #a5f3fc; }
[data-bs-theme="dark"] .ldp-page-btn { background: rgba(15,34,51,.8); border-color: rgba(103,232,249,.30); color: #67e8f9; }

/* Tablet — 2-up stats, header pills wrap below the back button */
@media (max-width: 1100px) {
  .ldp-stats { grid-template-columns: repeat(2, 1fr); }
  .ldp-header { flex-wrap: wrap; padding-top: 10px; padding-bottom: 10px; }
  .ldp-header-right { flex-wrap: wrap; justify-content: flex-end; width: 100%; }
}

/* Phone — full-width page, single-column stats, table scrolls horizontally. */
@media (max-width: 640px) {
  .ldp-page { padding: 0; }
  .ldp-header-card { border-radius: 0; border-left: none; border-right: none; margin-bottom: 10px; }
  .ldp-shell { width: 100%; border-radius: 0; border-left: none; border-right: none; }
  .ldp-header { padding: 14px 16px; gap: 12px; flex-direction: column; align-items: flex-start; }
  .ldp-header-left { gap: 10px; }
  .ldp-header-right { flex-wrap: wrap; gap: 8px; }
  .ldp-header-right .ldp-back-btn { flex: 1; justify-content: center; }
  .ldp-header-pill { flex: 1; justify-content: center; }
  .ldp-stats { grid-template-columns: 1fr; padding: 14px 16px 4px; gap: 10px; }
  .ldp-stat-value { font-size: 24px; }
  .ldp-table-wrap { margin: 12px 16px 16px; }
  .ldp-pagination { flex-direction: column; align-items: stretch; gap: 8px; padding: 10px 12px; }
  .ldp-pagination-controls { justify-content: space-between; gap: 8px; }
  .ldp-table thead th, .ldp-table tbody td { padding: 10px 12px; font-size: 11.5px; }
  .ldp-person-name { font-size: 12px; }
}
`;
