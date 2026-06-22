import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import api from '../../api';
import { useToast } from '../../contexts/ToastContext';

/* ─────────────────────────────────────────────────────────────────────────
 * Lead Distribution → KPI popup.
 *
 * Opens when a KPI card on the Lead Distribution page is clicked. Renders
 * the SalesMatrix_v4_9 prototype's "Assigned Leads" modal (#assignedLeads
 * style) as a centred overlay — amber header, the 11-column lead table,
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
  const date = dateSrc ? new Date(dateSrc).toLocaleDateString('en-GB') : 'N/A';
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
  const [loading, setLoading] = useState(false);

  // Serialise the filter so the effect re-runs when the caller switches
  // which KPI opened the modal without adding the object to deps directly.
  const filterKey = JSON.stringify(filter);

  // Reset to page 1 every time the modal (re)opens or the filter changes.
  useEffect(() => { if (open) setPage(1); }, [open, filterKey]);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    const params: Record<string, unknown> = {
      status: 'all',
      page,
      per_page: ROWS_PER_PAGE,
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
  }, [open, filterKey, page, toast]);

  const pages    = Math.max(1, Math.ceil(total / ROWS_PER_PAGE));
  const safePage = Math.min(page, pages);
  const startIdx = (safePage - 1) * ROWS_PER_PAGE;
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
              <div className="lkm-head-sub">{total} record{total === 1 ? '' : 's'} found</div>
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
              {loading && Array.from({ length: ROWS_PER_PAGE }).map((_, i) => (
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
                  <td className="lkm-strong">{r.assigned}</td>
                  <td><span className="lkm-opp">{r.oppId}</span></td>
                  <td className="lkm-strong">{r.customer}</td>
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
            {total === 0
              ? 'No records'
              : <>Showing <strong>{startIdx + 1}–{endIdx}</strong> of <strong>{total}</strong></>}
          </span>
          <div className="lkm-pag-ctrl">
            <span className="lkm-pag-range">{safePage} / {pages}</span>
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

/* ─── Styles — amber palette mirrors the Leads Details port / prototype. ── */
const LKM_CSS = `
.lkm-backdrop {
  position: fixed; inset: 0; z-index: 1085;
  background: rgba(28, 20, 16, 0.55); backdrop-filter: blur(3px);
  display: flex; align-items: center; justify-content: center;
  padding: 24px;
  animation: lkm-fade .15s ease-out;
}
@keyframes lkm-fade { from { opacity: 0; } to { opacity: 1; } }
.lkm-modal {
  width: 1500px; max-width: 96vw; max-height: 88vh;
  background: #fffbeb;
  border-radius: 14px; border: 1px solid #fde68a;
  box-shadow: 0 24px 60px rgba(28,20,16,.35);
  display: flex; flex-direction: column; overflow: hidden;
  animation: lkm-pop .18s ease-out;
}
@keyframes lkm-pop { from { transform: scale(.96); opacity: 0; } to { transform: scale(1); opacity: 1; } }

/* Header */
.lkm-head {
  display: flex; align-items: center; justify-content: space-between;
  gap: 14px; padding: 12px 18px;
  background: linear-gradient(135deg, #fef9c3 0%, #fef3c7 100%);
  border-bottom: 1px solid #fde68a;
  flex-shrink: 0;
}
.lkm-head-left { display: flex; align-items: center; gap: 12px; min-width: 0; }
.lkm-head-icon {
  width: 38px; height: 38px; border-radius: 10px;
  background: linear-gradient(135deg, #f59e0b, #d97706); color: #fff;
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 4px 10px rgba(245,158,11,.35); flex-shrink: 0;
}
.lkm-head-title { font-size: 16px; font-weight: 800; color: #451a03; letter-spacing: -.3px; line-height: 1.2; }
.lkm-head-sub   { font-size: 10.5px; color: #b45309; margin-top: 1px; font-weight: 600; }
.lkm-close {
  width: 30px; height: 30px; border: none; border-radius: 8px;
  background: rgba(180,83,9,.12); color: #92400e; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: background .15s; flex-shrink: 0;
}
.lkm-close:hover { background: rgba(180,83,9,.22); }

/* Table */
.lkm-table-wrap { flex: 1; overflow: auto; min-height: 0; }
.lkm-table { width: 100%; border-collapse: collapse; font-size: 11.5px; table-layout: fixed; }
.lkm-table thead { position: sticky; top: 0; z-index: 2; }
.lkm-table thead tr {
  background: linear-gradient(90deg, #78350f 0%, #92400e 30%, #b45309 65%, #d97706 100%);
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
.lkm-table tbody tr { border-bottom: 1px solid #fef9c3; transition: background .1s; }
.lkm-table tbody tr:nth-child(even) { background: #fffdf5; }
.lkm-table tbody tr:hover           { background: #fffbeb; }
.lkm-table tbody td {
  height: 42px; vertical-align: middle; font-size: 11.5px;
  padding: 0 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.lkm-table tbody td:first-child { padding-left: 14px; }
.lkm-table tbody td:last-child  { padding-right: 14px; }

.lkm-sr {
  display: inline-flex; align-items: center; justify-content: center;
  width: 22px; height: 22px; border-radius: 5px;
  background: #fff7ed; color: #c2410c; font-size: 10px; font-weight: 800;
  border: 1px solid #fed7aa;
}
.lkm-type-badge {
  display: inline-flex; padding: 2px 8px; border-radius: 6px;
  font-size: 10px; font-weight: 700;
  background: #eff6ff; color: #1d4ed8; border: 1px solid #bfdbfe; white-space: nowrap;
}
.lkm-opp { font-family: 'Geist Mono', monospace; font-size: 11px; font-weight: 700; color: #4f46e5; }
.lkm-muted  { color: #64748b; font-size: 11px; }
/* Dark/strong fields (Assigned To, Customer) — softened from near-black
   #0f172a to slate-700 so the table reads less heavy, kept at weight 700. */
.lkm-strong { font-weight: 700; color: #334155; }
.lkm-na     { color: #cbd5e1; font-style: italic; font-size: 11px; }

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
  background: linear-gradient(100deg, #fdf6e8 30%, #fce9c4 50%, #fdf6e8 70%);
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
  background: linear-gradient(100deg, #2a1d10 30%, #3d2c16 50%, #2a1d10 70%);
  background-size: 200% 100%;
}

/* Pagination */
.lkm-pag {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 16px; border-top: 1.5px solid #fef3c7; background: #fffbeb;
  flex-wrap: wrap; gap: 6px; flex-shrink: 0;
}
.lkm-pag-info {
  font-size: 11px; font-weight: 600; color: #92400e;
  background: #fff; border: 1.5px solid #fde68a; padding: 3px 12px; border-radius: 20px;
}
.lkm-pag-info strong { color: #4f46e5; font-weight: 700; }
.lkm-pag-ctrl { display: flex; align-items: center; gap: 5px; }
.lkm-pag-range {
  font-size: 11px; font-weight: 700; color: #78350f;
  background: linear-gradient(135deg, #fef9c3, #fef3c7);
  border: 1.5px solid #fde68a; padding: 3px 12px; border-radius: 20px; white-space: nowrap;
}
.lkm-pag-btn {
  width: 27px; height: 27px; border-radius: 50%;
  border: 1.5px solid #fde68a; background: #fff;
  display: flex; align-items: center; justify-content: center; color: #d97706;
  cursor: pointer; transition: background .15s, color .15s;
}
.lkm-pag-btn:hover:not(:disabled) { background: #d97706; color: #fff; }
.lkm-pag-btn:disabled { cursor: not-allowed; opacity: .45; }

/* Dark mode */
[data-bs-theme="dark"] .lkm-modal     { background: #1c1410; border-color: #422006; }
[data-bs-theme="dark"] .lkm-head      { background: linear-gradient(135deg, #422006 0%, #78350f 100%); border-color: #b45309; }
[data-bs-theme="dark"] .lkm-head-title{ color: #fef3c7; }
[data-bs-theme="dark"] .lkm-head-sub  { color: #fcd34d; }
[data-bs-theme="dark"] .lkm-close     { background: rgba(0,0,0,.30); color: #fcd34d; }
[data-bs-theme="dark"] .lkm-table tbody tr { border-color: #422006; }
[data-bs-theme="dark"] .lkm-table tbody tr:nth-child(even) { background: #28190e; }
[data-bs-theme="dark"] .lkm-table tbody tr:hover           { background: #422006; }
[data-bs-theme="dark"] .lkm-table tbody td { color: #fef3c7; }
[data-bs-theme="dark"] .lkm-muted     { color: #fde68a; }
[data-bs-theme="dark"] .lkm-strong    { color: #fef3c7; }
[data-bs-theme="dark"] .lkm-pag       { background: #1c1410; border-color: #422006; }
[data-bs-theme="dark"] .lkm-pag-info  { background: #1f1611; color: #fde68a; border-color: #422006; }
/* Remaining light-surfaced cell bits — badges, links, status pills and the
   pagination controls — retuned so the whole popup reads cohesively against
   the dark #1c1410 surface instead of flashing light-mode tints. */
[data-bs-theme="dark"] .lkm-sr {
  background: #2a1d10; color: #fdba74; border-color: #7c2d12;
}
[data-bs-theme="dark"] .lkm-type-badge {
  background: rgba(59,130,246,.18); color: #93c5fd; border-color: rgba(59,130,246,.40);
}
[data-bs-theme="dark"] .lkm-opp { color: #a5b4fc; }
[data-bs-theme="dark"] .lkm-na  { color: #78716c; }
[data-bs-theme="dark"] .lkm-status   { color: #a8a29e; }
[data-bs-theme="dark"] .lkm-status-q {
  background: rgba(22,163,74,.18); color: #86efac; border-color: rgba(34,197,94,.40);
}
[data-bs-theme="dark"] .lkm-status-d {
  background: rgba(220,38,38,.18); color: #fca5a5; border-color: rgba(239,68,68,.40);
}
[data-bs-theme="dark"] .lkm-pag-info strong { color: #a5b4fc; }
[data-bs-theme="dark"] .lkm-pag-range {
  color: #fcd34d; background: linear-gradient(135deg, #28190e, #1f1611); border-color: #422006;
}
[data-bs-theme="dark"] .lkm-pag-btn {
  background: #1f1611; border-color: #422006; color: #fcd34d;
}
[data-bs-theme="dark"] .lkm-pag-btn:hover:not(:disabled) {
  background: #d97706; color: #1c1410; border-color: #d97706;
}

@media (max-width: 640px) {
  .lkm-backdrop { padding: 10px; }
  .lkm-modal { max-height: 92vh; }
}
`;
