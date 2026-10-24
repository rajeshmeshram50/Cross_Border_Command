import { useEffect, useMemo, useState } from 'react';
import { formatDmy } from '../../../utils/formatDmy';
import { createPortal } from 'react-dom';
import api from '../../../api';
import { useToast } from '../../../contexts/ToastContext';
import { FitTip } from '../../p2p/purchase-management/order/create-po/form-fields';

/* ─────────────────────────────────────────────────────────────────────────
 * Lead Distribution → KPI popup.
 *
 * Opens when a KPI card on the Lead Distribution page is clicked. Renders
 * the SalesMatrix_v4_9 prototype's "Assigned Leads" modal (#assignedLeads
 * style) as a centred overlay — cyan header, the 11-column lead table,
 * and a paginated footer ("Showing 1–10 of N", "page/totalPages").
 *
 * The same modal serves all three lead-count KPIs; the caller passes a
 * `filter` describing which leads to pull:
 *   - {}                 → Total Leads      (every lead, status=all)
 *   - { assigned: true } → Assigned Leads   (has a salesperson)
 *   - { assigned: false }→ Unassigned Leads (no salesperson yet)
 *
 * Columns mirror the prototype: Sr No · Lead Type · Lead Date · Lead
 * Source · Assigned To · Opp. ID · Customer Name · Shipment ID · PI
 * Number · Country · Status. Shipment ID / PI Number live on downstream
 * objects, so they render "N/A" until those relations are joined in.
 * ───────────────────────────────────────────────────────────────────────── */

type ServerLead = {
  id:                 number;
  opp_code:           string;
  platform:           string | null;
  query_type:         string | null;
  query_time:         string | null;
  created_at:         string;
  sender_name:        string | null;
  sender_country_iso: string | null;
  qualified:          boolean;
  disqualified:       boolean;
  shipment_id?:       string | null;
  pi_number?:         string | null;
  salesperson?:       { id: number; name: string } | null;
};

type Lead = {
  id:       number;
  type:     string;
  date:     string;
  source:   string;
  assigned: string;
  oppId:    string;
  customer: string;
  shipment: string;
  piNumber: string;
  country:  string;
  status:   'qualified' | 'disqualified';
};

const ROWS_PER_PAGE = 10;

/* "N/A" sentinel — narrow check so a legitimate "0" isn't masked. */
const nullable = (v: string | null | undefined): string => {
  const s = (v ?? '').toString().trim();
  if (!s || s === '—') return 'N/A';
  return s;
};

/* IndiaMart query_type codes → friendly labels — MUST match the worksheet so
 * the Lead Type column reads "Buy-Leads" not "B". Unknown codes fall through. */
const LEAD_TYPE_LABEL: Record<string, string> = {
  BUY:               'Buy Leads',
  P:                 'PNS Calls',
  W:                 'Direct Enquiries',
  BIZ:               'Catalog-View Leads',
  'Product Inquiry': 'Product Inquiry',
  WA:                'WhatsApp-Enquiries',
  B:                 'Buy-Leads',
};
const prettyLeadType = (t: string | null | undefined): string =>
  LEAD_TYPE_LABEL[t ?? ''] ?? (t || 'Manual');

const mapServerToLead = (r: ServerLead): Lead => {
  const dateSrc = r.query_time ?? r.created_at;
  const date = dateSrc ? formatDmy(dateSrc) : 'N/A';
  return {
    id:       r.id,
    type:     prettyLeadType(nullable(r.query_type) === 'N/A' ? null : r.query_type),
    date,
    source:   nullable(r.platform),
    assigned: r.salesperson?.name ?? 'Unassigned',
    oppId:    r.opp_code,
    customer: nullable(r.sender_name),
    shipment: nullable(r.shipment_id),
    piNumber: nullable(r.pi_number),
    country:  nullable(r.sender_country_iso),
    status:   r.disqualified ? 'disqualified' : 'qualified',
  };
};

export type KpiFilter = { assigned?: boolean };

export default function LeadsKpiModal(props: {
  open: boolean;
  onClose: () => void;
  title: string;
  filter: KpiFilter;
}) {
  const { open, onClose, title, filter } = props;
  const toast = useToast();

  const [leads, setLeads]     = useState<Lead[]>([]);
  const [total, setTotal]     = useState(0);
  const [page, setPage]       = useState(1);
  const [pageSize, setPageSize] = useState(ROWS_PER_PAGE);
  const [loading, setLoading] = useState(false);

  // Serialise the filter so the effect re-runs when the caller switches
  // which KPI opened the modal without adding the object to deps directly.
  const filterKey = JSON.stringify(filter);

  // Reset to page 1 every time the modal (re)opens or the filter changes.
  useEffect(() => { if (open) setPage(1); }, [open, filterKey]);

  useEffect(() => {
    if (!open) return;
    /* Drop the previous answer before asking a new question.
     *
     * `total` survived between opens, so the header printed the LAST KPI's
     * figure while this one loaded — click Assigned after Total Leads and it
     * opened claiming 274 records before settling on its own number. On a
     * first open it printed the seeded 0 instead ("0 records found" over a
     * loading table), which reads as an empty bucket rather than a busy one.
     * Both are the same fault: a number shown before it is known. */
    setLeads([]);
    setTotal(0);
    setLoading(true);
    const params: Record<string, unknown> = {
      status: 'all',
      page,
      per_page: pageSize,
      with_counts: 0,
    };
    if (filter.assigned !== undefined) params.assigned = filter.assigned ? 1 : 0;

    api.get<{
      status: boolean;
      data: ServerLead[];
      pagination: { current_page: number; last_page: number; per_page: number; total: number };
    }>('/sales/leads', { params })
      .then(({ data }) => {
        setLeads((data.data ?? []).map(mapServerToLead));
        setTotal(data.pagination?.total ?? 0);
      })
      .catch((e: any) => {
        toast.error('Load failed', e?.response?.data?.message ?? 'Could not load leads');
        setLeads([]); setTotal(0);
      })
      .finally(() => setLoading(false));
  }, [open, filterKey, page, pageSize, toast]);

  const pages    = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, pages);
  const startIdx = (safePage - 1) * pageSize;
  const endIdx   = Math.min(startIdx + leads.length, total);

  // Lock background scroll while the overlay is open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  const colWidths = useMemo(
    () => ['5%', '10%', '9%', '9%', '11%', '8%', '13%', '10%', '10%', '8%', '7%'],
    [],
  );

  if (!open) return null;

  return createPortal((
    <div className="lkm-backdrop" onClick={onClose}>
      <style>{LKM_CSS}</style>
      <div className="lkm-modal" onClick={(e) => e.stopPropagation()}>
        {/* ── Header ─────────────────────────────────────────────── */}
        <div className="lkm-head">
          <div className="lkm-head-left">
            <div className="lkm-head-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <div>
              <div className="lkm-head-title">{title}</div>
              {/* No count until there IS one. "0 records found" over a table
                  that is still loading states the opposite of what is true. */}
              <div className="lkm-head-sub">
                {loading ? 'Loading records…' : <>{total} record{total === 1 ? '' : 's'} found</>}
              </div>
            </div>
          </div>
          <button className="lkm-close" onClick={onClose} aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* ── Table ──────────────────────────────────────────────── */}
        <div className="lkm-table-wrap">
          <table className="lkm-table">
            <colgroup>
              {colWidths.map((w, i) => <col key={i} style={{ width: w }} />)}
            </colgroup>
            <thead>
              <tr>
                <th>Sr No</th>
                <th>Lead Type</th>
                <th>Lead Date</th>
                <th>Lead Source</th>
                <th>Assigned To</th>
                <th>Opp. ID</th>
                <th>Customer Name</th>
                <th>Shipment ID</th>
                <th>PI Number</th>
                <th>Country</th>
                <th style={{ textAlign: 'center' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {loading && Array.from({ length: pageSize }).map((_, i) => (
                <tr key={`sk-${i}`} className="lkm-skel-row">
                  <td><span className="lkm-skel lkm-skel-sr" /></td>
                  <td><span className="lkm-skel lkm-skel-chip" /></td>
                  <td><span className="lkm-skel lkm-skel-line" style={{ width: '80%' }} /></td>
                  <td><span className="lkm-skel lkm-skel-line" style={{ width: '70%' }} /></td>
                  <td><span className="lkm-skel lkm-skel-line" style={{ width: '85%' }} /></td>
                  <td><span className="lkm-skel lkm-skel-line" style={{ width: '75%' }} /></td>
                  <td><span className="lkm-skel lkm-skel-line" style={{ width: '90%' }} /></td>
                  <td><span className="lkm-skel lkm-skel-line" style={{ width: '50%' }} /></td>
                  <td><span className="lkm-skel lkm-skel-line" style={{ width: '50%' }} /></td>
                  <td><span className="lkm-skel lkm-skel-line" style={{ width: '45%' }} /></td>
                  <td style={{ textAlign: 'center' }}><span className="lkm-skel lkm-skel-badge" /></td>
                </tr>
              ))}
              {!loading && leads.length === 0 && (
                <tr><td colSpan={11} className="lkm-status">No leads found</td></tr>
              )}
              {!loading && leads.map((r, i) => (
                <tr key={r.id}>
                  <td><span className="lkm-sr">{startIdx + i + 1}</span></td>
                  <td><span className="lkm-type-badge">{r.type}</span></td>
                  <td className="lkm-muted">{r.date}</td>
                  <td className="lkm-muted">{r.source}</td>
                  <td className="lkm-strong"><FitTip label={r.assigned}><span className="lkm-fit">{r.assigned}</span></FitTip></td>
                  <td><span className="lkm-opp">{r.oppId}</span></td>
                  <td className="lkm-strong"><FitTip label={r.customer}><span className="lkm-fit">{r.customer}</span></FitTip></td>
                  <td className={r.shipment === 'N/A' ? 'lkm-na' : 'lkm-muted'}>{r.shipment}</td>
                  <td className={r.piNumber === 'N/A' ? 'lkm-na' : 'lkm-muted'}>{r.piNumber}</td>
                  <td className="lkm-muted">{r.country}</td>
                  <td style={{ textAlign: 'center' }}>
                    {r.status === 'qualified'
                      ? <span className="lkm-status-badge lkm-status-q"><span className="lkm-status-dot" />Qualified</span>
                      : <span className="lkm-status-badge lkm-status-d"><span className="lkm-status-dot" />Disqualified</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* ── Pagination ─────────────────────────────────────────── */}
        <div className="lkm-pag">
          <span className="lkm-pag-info">
            {/* "No records" is an ANSWER, and while the rows are still loading
                there isn't one — same reason the header holds its count back. */}
            {loading
              ? 'Loading…'
              : total === 0
                ? 'No records'
                : <>Showing <strong>{startIdx + 1}–{endIdx}</strong> of <strong>{total}</strong></>}
          </span>
          <div className="lkm-pag-ctrl">
            <label className="lkm-rows-per-page">
              <span>Rows per page:</span>
              <select
                value={pageSize}
                onChange={e => { setPageSize(Number(e.target.value)); setPage(1); }}
              >
                {[10, 15, 25, 50].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <span className="lkm-pag-range">{safePage}/{pages}</span>
            <button
              className="lkm-pag-btn"
              disabled={safePage <= 1}
              onClick={() => setPage(Math.max(1, safePage - 1))}
              aria-label="Previous page"
            >
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
            </button>
            <button
              className="lkm-pag-btn"
              disabled={safePage >= pages || total === 0}
              onClick={() => setPage(Math.min(pages, safePage + 1))}
              aria-label="Next page"
            >
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  ), document.body);
}

/* ─── Styles — the cyan palette of Lead Distribution / Leads Details (My Workplace). ── */
const LKM_CSS = `
.lkm-backdrop {
  position: fixed; inset: 0; z-index: 1085;
  background: rgba(12, 31, 46, 0.55); backdrop-filter: blur(3px);
  display: flex; align-items: center; justify-content: center;
  padding: 24px;
  animation: lkm-fade .15s ease-out;
}
@keyframes lkm-fade { from { opacity: 0; } to { opacity: 1; } }
.lkm-modal {
  width: 1500px; max-width: 96vw; max-height: 88vh;
  background: #ecfeff;
  border-radius: 14px; border: 1px solid #a5f3fc;
  box-shadow: 0 24px 60px rgba(12,31,46,.35);
  display: flex; flex-direction: column; overflow: hidden;
  animation: lkm-pop .18s ease-out;
}
@keyframes lkm-pop { from { transform: scale(.96); opacity: 0; } to { transform: scale(1); opacity: 1; } }

/* Header */
.lkm-head {
  display: flex; align-items: center; justify-content: space-between;
  gap: 14px; padding: 12px 18px;
  background: linear-gradient(135deg, #f0fdff 0%, #cffafe 100%);
  border-bottom: 1px solid #a5f3fc;
  flex-shrink: 0;
}
.lkm-head-left { display: flex; align-items: center; gap: 12px; min-width: 0; }
.lkm-head-icon {
  width: 38px; height: 38px; border-radius: 10px;
  background: linear-gradient(135deg, #06b6d4, #0891b2); color: #fff;
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 4px 10px rgba(6,182,212,.35); flex-shrink: 0;
}
.lkm-head-title { font-size: 15px; font-weight: 600; color: #0c4a6e; letter-spacing: -.3px; line-height: 1.2; }
.lkm-head-sub   { font-size: 10.5px; color: #0e7490; margin-top: 1px; font-weight: 500; }
.lkm-close {
  width: 30px; height: 30px; border: none; border-radius: 8px;
  background: rgba(14,116,144,.12); color: #155e75; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: background .15s; flex-shrink: 0;
}
.lkm-close:hover { background: rgba(14,116,144,.22); }

/* Table */
.lkm-table-wrap { flex: 1; overflow: auto; min-height: 0; }
.lkm-table { width: 100%; border-collapse: collapse; font-size: 11.5px; table-layout: fixed; }
.lkm-table thead { position: sticky; top: 0; z-index: 2; }
.lkm-table thead tr {
  background: linear-gradient(90deg, #0c4a6e 0%, #155e75 30%, #0e7490 65%, #0891b2 100%);
}
.lkm-table thead th {
  color: rgba(255,255,255,.85); font-size: 8px; font-weight: 700;
  padding: 11px 8px; text-transform: uppercase; letter-spacing: .09em;
  text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.lkm-table thead th:first-child { padding-left: 16px; }
/* Status is the last column. Fix it wide enough for the longer "Disqualified"
   badge AND a right gap. It holds a fixed badge (not truncatable text), so turn
   off overflow clipping — otherwise text-overflow renders a stray "…" next to
   the badge when it's a hair wider than the cell's content box. */
.lkm-table thead th:last-child,
.lkm-table tbody td:last-child  { width: 140px; overflow: visible; text-overflow: clip; }
.lkm-table thead th:last-child  { padding-right: 16px; }
.lkm-table tbody tr { border-bottom: 1px solid #f0fdff; transition: background .1s; }
.lkm-table tbody tr:nth-child(even) { background: #f7fffe; }
.lkm-table tbody tr:hover           { background: #ecfeff; }
.lkm-table tbody td {
  height: 42px; vertical-align: middle; font-size: 11.5px; font-weight: 500;
  color: #475569; line-height: 1.45;
  padding: 0 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.lkm-table tbody td:first-child { padding-left: 14px; }
.lkm-table tbody td:last-child  { padding-right: 14px; }

.lkm-sr {
  display: inline-flex; align-items: center; justify-content: center;
  width: 24px; height: 24px; border-radius: 7px;
  background: linear-gradient(135deg, #0891b2, #155e75);
  color: #fff; font-size: 11px; font-weight: 800;
  font-variant-numeric: tabular-nums;
  box-shadow: 0 2px 6px rgba(8,145,178,.30);
}
.lkm-type-badge {
  display: inline-flex; padding: 2px 8px; border-radius: 6px;
  font-size: 10px; font-weight: 700;
  background: #eff6ff; color: #1d4ed8; border: 1px solid #bfdbfe; white-space: nowrap;
}
.lkm-opp {
  display: inline-flex; align-items: center; padding: 2px 8px; border-radius: 6px;
  background: #ecfeff; border: 1px solid #a5f3fc; color: #0e7490;
  font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 10px; font-weight: 600;
  letter-spacing: .02em; white-space: nowrap;
}
.lkm-table tbody td,
.lkm-table tbody td *:not(i):not(svg):not(svg *) { font-size: 11.5px !important; font-weight: 500 !important; }
.lkm-table tbody td .lkm-sr.lkm-sr { font-size: 11px !important; font-weight: 500 !important; }
.lkm-table tbody td .lkm-opp.lkm-opp { font-size: 11px !important; font-weight: 500 !important; }
.lkm-table tbody td .lkm-type-badge.lkm-type-badge { font-size: 10px !important; font-weight: 500 !important; }
.lkm-table tbody td .lkm-status-badge.lkm-status-badge,
.lkm-table tbody td .lkm-status-badge.lkm-status-badge * { font-size: 10px !important; font-weight: 500 !important; }
/* Every data cell reads like the Customers list (.smc-table-wrap): one colour,
   11.5 / 500 — no muted / strong split between columns. */
.lkm-muted, .lkm-strong { color: inherit; }
/* Long names end in "…" and show whole in the app tooltip (FitTip, only when cut). */
.lkm-fit { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lkm-na     { color: #cbd5e1; font-style: italic; }

.lkm-status-badge {
  display: inline-flex; align-items: center; gap: 3px;
  padding: 2px 9px; border-radius: 20px; font-size: 10px; font-weight: 700; white-space: nowrap;
}
.lkm-status-q { background: #f0fdf4; color: #15803d; border: 1px solid #bbf7d0; }
.lkm-status-d { background: #fef2f2; color: #dc2626; border: 1px solid #fecaca; }
.lkm-status-q .lkm-status-dot { background: #22c55e; }
.lkm-status-d .lkm-status-dot { background: #ef4444; }
.lkm-status-dot { width: 5px; height: 5px; border-radius: 50%; flex-shrink: 0; }

.lkm-status { text-align: center; padding: 40px 14px; color: #94a3b8; font-style: italic; font-size: 12px; }

/* Loading shimmer — skeleton list rows shown while leads load. */
.lkm-skel-row td { height: 42px; vertical-align: middle; }
.lkm-skel {
  display: inline-block; vertical-align: middle; border-radius: 6px;
  background: linear-gradient(100deg, #ecfeff 30%, #cffafe 50%, #ecfeff 70%);
  background-size: 200% 100%;
  animation: lkm-shimmer 1.2s ease-in-out infinite;
}
.lkm-skel-line  { height: 11px; width: 100%; }
.lkm-skel-sr    { width: 22px; height: 22px; border-radius: 5px; }
.lkm-skel-chip  { width: 54px; height: 18px; border-radius: 6px; }
.lkm-skel-badge { width: 70px; height: 18px; border-radius: 999px; }
@keyframes lkm-shimmer {
  0%   { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
[data-bs-theme="dark"] .lkm-skel {
  background: linear-gradient(100deg, #10293a 30%, #15384d 50%, #10293a 70%);
  background-size: 200% 100%;
}

/* Pagination */
/* Pager = the Leads Details / Lead Distribution footer: info pill, rows per
   page, filled page indicator, round prev / next. */
.lkm-pag {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 16px;
  border-top: 2px solid #a5f3fc;
  background: linear-gradient(90deg, #ecfeff 0%, #cffafe 40%, #ecfeff 100%);
  flex-wrap: wrap; gap: 8px; flex-shrink: 0;
}
.lkm-pag-info {
  font-size: 11.5px; font-weight: 500; color: #0e7490;
  background: rgba(255,255,255,.8); border: 1.5px solid #a5f3fc;
  padding: 5px 14px; border-radius: 20px;
  box-shadow: 0 1px 4px rgba(8,145,178,.1), 0 1px 0 rgba(255,255,255,.9) inset;
}
.lkm-pag-info strong { color: #0891b2; font-weight: 800; }
.lkm-pag-ctrl { display: flex; align-items: center; gap: 6px; }
.lkm-rows-per-page {
  display: inline-flex; align-items: center; gap: 5px; margin: 0 2px 0 0;
  font-size: 11.5px; color: #0e7490; font-weight: 500;
  background: rgba(255,255,255,.8); border: 1.5px solid #a5f3fc;
  padding: 4px 12px; border-radius: 20px;
  box-shadow: 0 1px 4px rgba(8,145,178,.1), 0 1px 0 rgba(255,255,255,.9) inset;
}
.lkm-rows-per-page select {
  border: none; background: transparent; font-family: inherit;
  font-size: 11.5px; color: #0891b2; font-weight: 700; cursor: pointer; outline: none;
}
.lkm-pag-range {
  font-size: 11.5px; font-weight: 800; color: #fff;
  background: linear-gradient(135deg, #0891b2 0%, #0e7490 55%, #155e75 100%);
  padding: 5px 18px; border-radius: 20px; white-space: nowrap;
  box-shadow: 0 3px 12px rgba(8,145,178,.4), 0 1px 0 rgba(255,255,255,.2) inset;
}
.lkm-pag-btn {
  width: 32px; height: 32px; border-radius: 50%;
  border: 1.5px solid #a5f3fc; background: rgba(255,255,255,.8);
  display: flex; align-items: center; justify-content: center; color: #0891b2;
  cursor: pointer; transition: all .18s;
}
.lkm-pag-btn:hover:not(:disabled) { background: #fff; border-color: #0891b2; transform: translateY(-1px); box-shadow: 0 4px 12px rgba(8,145,178,.25); }
.lkm-pag-btn:disabled { cursor: not-allowed; opacity: .4; }

/* Dark mode */
[data-bs-theme="dark"] .lkm-modal     { background: #0c1f2e; border-color: #164e63; }
[data-bs-theme="dark"] .lkm-head      { background: linear-gradient(135deg, #164e63 0%, #0c4a6e 100%); border-color: #0e7490; }
[data-bs-theme="dark"] .lkm-head-title{ color: #cffafe; }
[data-bs-theme="dark"] .lkm-head-sub  { color: #67e8f9; }
[data-bs-theme="dark"] .lkm-close     { background: rgba(0,0,0,.30); color: #67e8f9; }
[data-bs-theme="dark"] .lkm-table tbody tr { border-color: #164e63; }
[data-bs-theme="dark"] .lkm-table tbody tr:nth-child(even) { background: #10293a; }
[data-bs-theme="dark"] .lkm-table tbody tr:hover           { background: #164e63; }
[data-bs-theme="dark"] .lkm-pag       { background: rgba(8,145,178,.08); border-top-color: rgba(34,211,238,.25); }
[data-bs-theme="dark"] .lkm-pag-info  { background: rgba(15,34,51,.8); color: #67e8f9; border-color: rgba(103,232,249,.30); box-shadow: none; }
/* Remaining light-surfaced cell bits — badges, links, status pills and the
   pagination controls — retuned so the whole popup reads cohesively against
   the dark #0c1f2e surface instead of flashing light-mode tints. */
[data-bs-theme="dark"] .lkm-sr { color: #e2e8f0; }
[data-bs-theme="dark"] .lkm-type-badge {
  background: rgba(59,130,246,.18); color: #93c5fd; border-color: rgba(59,130,246,.40);
}
[data-bs-theme="dark"] .lkm-opp { background: rgba(6,182,212,.12); border-color: rgba(103,232,249,.30); color: #67e8f9; }
[data-bs-theme="dark"] .lkm-table tbody td { color: #cbd5e1; }
[data-bs-theme="dark"] .lkm-na  { color: #64748b; }
[data-bs-theme="dark"] .lkm-status   { color: #94a3b8; }
[data-bs-theme="dark"] .lkm-status-q {
  background: rgba(22,163,74,.18); color: #86efac; border-color: rgba(34,197,94,.40);
}
[data-bs-theme="dark"] .lkm-status-d {
  background: rgba(220,38,38,.18); color: #fca5a5; border-color: rgba(239,68,68,.40);
}
[data-bs-theme="dark"] .lkm-pag-info strong { color: #67e8f9; }
[data-bs-theme="dark"] .lkm-rows-per-page { background: rgba(15,34,51,.8); color: #67e8f9; border-color: rgba(103,232,249,.30); box-shadow: none; }
[data-bs-theme="dark"] .lkm-rows-per-page select { color: #a5f3fc; }
[data-bs-theme="dark"] .lkm-pag-btn {
  background: rgba(15,34,51,.8); border-color: rgba(103,232,249,.30); color: #67e8f9;
}

@media (max-width: 640px) {
  .lkm-backdrop { padding: 10px; }
  .lkm-modal { max-height: 92vh; }
}
`;
