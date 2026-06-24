import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import api from '../../../api';
import { useToast } from '../../../contexts/ToastContext';
import { useNavigateContext } from '../../../components/App';

/* ─────────────────────────────────────────────────────────────────────────
 * Sales Matrix → Lead Distribution → Leads Details
 *
 * Faithful port of the SalesMatrix_v4_9 prototype's #leadsDetailModal
 * (line 10246). Reached by clicking "View Leads" on the Lead Distribution
 * roster — the salesperson id is read from `?sp=<id>&sp_name=<name>`.
 *
 * Columns mirror the prototype exactly: Sr No · Lead Type · Lead Date ·
 * Lead Source · Assigned To · Opp. ID · Customer Name · Shipment ID ·
 * PI Number · Country · Status. Shipment ID and PI Number aren't on the
 * lead record (they live on PI/Shipment objects downstream) so they
 * always render as "N/A" until those relations are joined into the API.
 *
 * Empty cells show "N/A" rather than the legacy "—" dash so missing
 * data reads as deliberately-absent instead of pending.
 * ───────────────────────────────────────────────────────────────────────── */

type ServerLead = {
  id:                number;
  opp_code:          string;
  platform:          string | null;
  query_type:        string | null;
  query_time:        string | null;
  created_at:        string;
  sender_name:       string | null;
  sender_country_iso:string | null;
  qualified:         boolean;
  disqualified:      boolean;
  shipment_id?:      string | null;
  pi_number?:        string | null;
  salesperson?:      { id: number; name: string } | null;
};

type Lead = {
  id:        number;
  type:      string;
  date:      string;
  source:    string;
  assigned:  string;
  oppId:     string;
  customer:  string;
  shipment:  string;
  piNumber:  string;
  country:   string;
  status:    'qualified' | 'disqualified';
};

const ROWS_PER_PAGE = 15;

/* "N/A" sentinel — used as a fallback whenever a server field is null,
 * empty, or the legacy "—" placeholder. The check is intentionally narrow
 * so legitimate values like "0" don't get masked. */
const nullable = (v: string | null | undefined): string => {
  const s = (v ?? '').toString().trim();
  if (!s || s === '—') return 'N/A';
  return s;
};

/* IndiaMart query_type codes → friendly labels — MUST match the worksheet
 * (SalesLeadWorksheet.tsx LEAD_TYPE_LABEL) so the Lead Type column reads the
 * same here as in My Workplace ("Buy-Leads" not "B"). Unknown codes fall
 * through to whatever the server sent (or "Manual" for null). */
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

export default function SalesLeadsDetails() {
  const toast = useToast();
  const { navigate } = useNavigateContext();
  const location = useLocation();

  /* Salesperson context comes through the URL — `?sp=12&sp_name=Sakshi%20Kale`.
   * `sp_emp` and `sp_mgr` are passed by the Lead Distribution roster when
   * available so the header chips render without an extra round-trip. */
  const params = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const spId   = params.get('sp');
  const spName = params.get('sp_name') ?? 'Sales Person';
  const spEmp  = params.get('sp_emp')  ?? '';
  const spMgr  = params.get('sp_mgr')  ?? '';

  const [leads, setLeads]   = useState<Lead[]>([]);
  const [total, setTotal]   = useState(0);
  const [page, setPage]     = useState(1);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);

  /* Debounce search input so each keystroke doesn't fire a request. 220ms
   * is the same window used by the worksheet page; matches what users have
   * come to expect across the Sales section. */
  const [debouncedQ, setDebouncedQ] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(search.trim()), 220);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => { setPage(1); }, [debouncedQ]);

  useEffect(() => {
    if (!spId) return;
    setLoading(true);
    api.get<{
      status: boolean;
      data: ServerLead[];
      pagination: { current_page: number; last_page: number; per_page: number; total: number };
    }>('/sales/leads', {
      params: {
        status: 'all',
        salesperson_id: spId,
        search: debouncedQ || undefined,
        page,
        per_page: ROWS_PER_PAGE,
      },
    })
      .then(({ data }) => {
        setLeads((data.data ?? []).map(mapServerToLead));
        setTotal(data.pagination?.total ?? 0);
      })
      .catch((e: any) => {
        toast.error('Load failed', e?.response?.data?.message ?? 'Could not load leads');
        setLeads([]); setTotal(0);
      })
      .finally(() => setLoading(false));
  }, [spId, debouncedQ, page, toast]);

  const onBack = () => navigate('sales.lead_distribution');

  const pages = Math.max(1, Math.ceil(total / ROWS_PER_PAGE));
  const safePage = Math.min(page, pages);
  const startIdx = (safePage - 1) * ROWS_PER_PAGE;
  const endIdx   = Math.min(startIdx + leads.length, total);

  return (
    <div className="ldd-page">
      <style>{LDD_CSS}</style>

      {/* ── Header ───────────────────────────────────────────────── */}
      <div className="ldd-header">
        <div className="ldd-header-left">
          <div className="ldd-header-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
              <line x1="16" y1="13" x2="8" y2="13"/>
              <line x1="16" y1="17" x2="8" y2="17"/>
            </svg>
          </div>
          <div>
            <div className="ldd-header-title">Leads Details</div>
            <div className="ldd-header-sub">
              {total} lead{total === 1 ? '' : 's'} found
            </div>
          </div>
        </div>

        {/* Meta chips */}
        <div className="ldd-meta">
          {spEmp && (
            <span className="ldd-meta-chip ldd-meta-chip-dark">
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><rect x="2" y="7" width="20" height="15" rx="1"/><path d="M16 7V5a2 2 0 0 0-4 0v2"/></svg>
              {spEmp}
            </span>
          )}
          <span className="ldd-meta-chip">
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2.2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
            {spName}
          </span>
          {spMgr && (
            <span className="ldd-meta-chip">
              Manager: {spMgr}
            </span>
          )}
        </div>

        {/* Search + Back */}
        <div className="ldd-header-right">
          <div className="ldd-search">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2.2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
            <input
              type="text"
              placeholder="Search lead..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <button className="ldd-back-btn" onClick={onBack}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="15 18 9 12 15 6"/></svg>
            Back to Lead Distribution
          </button>
        </div>
      </div>

      {/* ── Table card ───────────────────────────────────────────── */}
      <div className="ldd-table-card">
        <div className="ldd-table-wrap">
          <table className="ldd-table">
            <colgroup>
              <col style={{ width: '5%' }} />
              <col style={{ width: '10%' }} />
              <col style={{ width: '9%' }} />
              <col style={{ width: '9%' }} />
              <col style={{ width: '11%' }} />
              <col style={{ width: '8%' }} />
              <col style={{ width: '13%' }} />
              <col style={{ width: '10%' }} />
              <col style={{ width: '10%' }} />
              <col style={{ width: '8%' }} />
              <col style={{ width: '7%' }} />
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
              {loading && (
                <tr><td colSpan={11} className="ldd-status">Loading leads…</td></tr>
              )}
              {!loading && leads.length === 0 && (
                <tr><td colSpan={11} className="ldd-status">No leads found</td></tr>
              )}
              {!loading && leads.map((r, i) => (
                <tr key={r.id}>
                  <td>
                    <span className="ldd-sr">{startIdx + i + 1}</span>
                  </td>
                  <td>
                    <span className="ldd-type-badge">{r.type}</span>
                  </td>
                  <td className="ldd-muted">{r.date}</td>
                  <td className="ldd-muted">{r.source}</td>
                  <td className="ldd-strong">{r.assigned}</td>
                  <td>
                    <span className="ldd-opp">{r.oppId}</span>
                  </td>
                  <td className="ldd-strong">{r.customer}</td>
                  <td className={r.shipment === 'N/A' ? 'ldd-na' : 'ldd-muted'}>{r.shipment}</td>
                  <td className={r.piNumber === 'N/A' ? 'ldd-na' : 'ldd-muted'}>{r.piNumber}</td>
                  <td className="ldd-muted">{r.country}</td>
                  <td style={{ textAlign: 'center' }}>
                    {r.status === 'qualified'
                      ? <span className="ldd-status-badge ldd-status-q"><span className="ldd-status-dot" />Qualified</span>
                      : <span className="ldd-status-badge ldd-status-d"><span className="ldd-status-dot" />Disqualified</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* ── Pagination ──────────────────────────────────────────── */}
        <div className="ldd-pag">
          <span className="ldd-pag-info">
            {total === 0
              ? 'No records'
              : <>Showing <strong>{startIdx + 1}–{endIdx}</strong> of <strong>{total}</strong></>}
          </span>
          <div className="ldd-pag-ctrl">
            <span className="ldd-pag-range">{safePage}/{pages}</span>
            <button
              className="ldd-pag-btn"
              disabled={safePage <= 1}
              onClick={() => setPage(Math.max(1, safePage - 1))}
            >
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
            <button
              className="ldd-pag-btn"
              disabled={safePage >= pages || total === 0}
              onClick={() => setPage(Math.min(pages, safePage + 1))}
            >
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Styles — amber/orange palette mirrors the prototype card. ──── */
const LDD_CSS = `
.ldd-page {
  margin: -1rem -0.75rem;
  background: #fffbeb;
  min-height: 100%;
  display: flex; flex-direction: column;
  padding: 10px 18px 16px;
  gap: 8px;
  animation: ldd-fade .18s ease-out;
}
@keyframes ldd-fade { from { opacity: 0; } to { opacity: 1; } }

/* Header */
.ldd-header {
  background: linear-gradient(135deg, #fef9c3 0%, #fef3c7 100%);
  border: 1px solid #fde68a;
  border-radius: 12px;
  padding: 9px 16px;
  display: flex; align-items: center; justify-content: space-between;
  gap: 14px; flex-shrink: 0;
}
.ldd-header-left { display: flex; align-items: center; gap: 12px; min-width: 0; }
.ldd-header-icon {
  width: 40px; height: 40px; border-radius: 10px;
  background: linear-gradient(135deg, #f59e0b, #d97706); color: #fff;
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 4px 10px rgba(245,158,11,.35);
  flex-shrink: 0;
}
.ldd-header-title {
  font-size: 16px; font-weight: 800; color: #451a03;
  letter-spacing: -.3px; line-height: 1.2;
}
.ldd-header-sub  { font-size: 10.5px; color: #b45309; margin-top: 1px; font-weight: 500; }

.ldd-meta {
  display: flex; align-items: center; gap: 6px;
  flex: 1; justify-content: center; flex-wrap: wrap;
}
.ldd-meta-chip {
  display: inline-flex; align-items: center; gap: 5px;
  background: #fff; border: 1px solid #fde68a; border-radius: 20px;
  padding: 4px 12px; font-size: 10.5px; font-weight: 700; color: #78350f;
}
.ldd-meta-chip-dark {
  background: rgba(255,255,255,.55); border-color: #fcd34d;
  color: #92400e;
}

.ldd-header-right { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.ldd-search {
  display: flex; align-items: center; gap: 7px;
  background: #fff; border: 1.5px solid #fde68a; border-radius: 9px;
  padding: 5px 12px; height: 34px;
  transition: border-color .15s;
}
.ldd-search:focus-within { border-color: #d97706; }
.ldd-search input {
  border: none; outline: none; background: transparent;
  font-family: inherit; font-size: 11.5px; color: #451a03; width: 160px;
}
.ldd-back-btn {
  display: inline-flex; align-items: center; gap: 6px;
  height: 34px; padding: 0 15px;
  background: linear-gradient(135deg, #f59e0b, #d97706); color: #fff;
  border: none; border-radius: 8px;
  font-family: inherit; font-size: 11.5px; font-weight: 700;
  cursor: pointer; white-space: nowrap;
  box-shadow: 0 3px 10px rgba(245,158,11,.35);
  transition: transform .15s;
}
.ldd-back-btn:hover { transform: translateY(-1px); }

/* Table card */
.ldd-table-card {
  background: #fff;
  border: 1px solid #fde68a;
  border-radius: 10px;
  overflow: hidden;
  box-shadow: 0 2px 8px rgba(245,158,11,.1);
  display: flex; flex-direction: column;
  flex: 1; min-height: 0;
}
.ldd-table-wrap { flex: 1; overflow: auto; }
.ldd-table { width: 100%; border-collapse: collapse; font-size: 11.5px; table-layout: fixed; }
.ldd-table thead {
  position: sticky; top: 0; z-index: 2;
}
.ldd-table thead tr {
  background: linear-gradient(90deg, #78350f 0%, #92400e 30%, #b45309 65%, #d97706 100%);
}
.ldd-table thead th {
  color: rgba(255,255,255,.85);
  font-size: 8px; font-weight: 700;
  padding: 11px 8px;
  text-transform: uppercase; letter-spacing: .09em;
  text-align: left;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.ldd-table thead th:first-child { padding-left: 16px; }

.ldd-table tbody tr {
  border-bottom: 1px solid #fef9c3;
  transition: background .1s;
}
.ldd-table tbody tr:nth-child(even) { background: #fffdf5; }
.ldd-table tbody tr:hover           { background: #fffbeb; }
.ldd-table tbody td {
  padding: 0; height: 42px; vertical-align: middle;
  font-size: 11.5px;
  padding-left: 8px; padding-right: 8px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.ldd-table tbody td:first-child { padding-left: 14px; }

.ldd-sr {
  display: inline-flex; align-items: center; justify-content: center;
  width: 22px; height: 22px; border-radius: 5px;
  background: #fff7ed; color: #c2410c;
  font-size: 10px; font-weight: 800;
  border: 1px solid #fed7aa;
}
.ldd-type-badge {
  display: inline-flex; padding: 2px 8px; border-radius: 6px;
  font-size: 10px; font-weight: 700;
  background: #eff6ff; color: #1d4ed8; border: 1px solid #bfdbfe;
  white-space: nowrap;
}
.ldd-opp {
  font-family: 'Geist Mono', monospace;
  font-size: 11px; font-weight: 700; color: #4f46e5;
}
.ldd-muted  { color: #64748b; font-size: 11px; }
.ldd-strong { font-weight: 700; color: #0f172a; }
.ldd-na     { color: #cbd5e1; font-style: italic; font-size: 11px; }

.ldd-status-badge {
  display: inline-flex; align-items: center; gap: 3px;
  padding: 2px 9px; border-radius: 20px;
  font-size: 10px; font-weight: 700;
  white-space: nowrap;
}
.ldd-status-q { background: #f0fdf4; color: #15803d; border: 1px solid #bbf7d0; }
.ldd-status-d { background: #fef2f2; color: #dc2626; border: 1px solid #fecaca; }
.ldd-status-q .ldd-status-dot { background: #22c55e; }
.ldd-status-d .ldd-status-dot { background: #ef4444; }
.ldd-status-dot {
  width: 5px; height: 5px; border-radius: 50%; flex-shrink: 0;
}

.ldd-status {
  text-align: center; padding: 40px 14px;
  color: #94a3b8; font-style: italic; font-size: 12px;
}

/* Pagination */
.ldd-pag {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 16px;
  border-top: 1.5px solid #fef3c7;
  background: #fffbeb;
  flex-wrap: wrap; gap: 6px;
  flex-shrink: 0;
}
.ldd-pag-info {
  font-size: 11px; font-weight: 600; color: #92400e;
  background: #fff; border: 1.5px solid #fde68a;
  padding: 3px 12px; border-radius: 20px;
}
.ldd-pag-info strong { color: #4f46e5; font-weight: 700; }
.ldd-pag-ctrl { display: flex; align-items: center; gap: 5px; }
.ldd-pag-range {
  font-size: 11px; font-weight: 700; color: #78350f;
  background: linear-gradient(135deg, #fef9c3, #fef3c7);
  border: 1.5px solid #fde68a;
  padding: 3px 12px; border-radius: 20px; white-space: nowrap;
}
.ldd-pag-btn {
  width: 27px; height: 27px; border-radius: 50%;
  border: 1.5px solid #fde68a; background: #fff;
  display: flex; align-items: center; justify-content: center;
  color: #d97706;
  cursor: pointer; transition: background .15s, color .15s;
}
.ldd-pag-btn:hover:not(:disabled) { background: #d97706; color: #fff; }
.ldd-pag-btn:disabled              { cursor: not-allowed; opacity: .45; }

/* Dark mode */
[data-bs-theme="dark"] .ldd-page         { background: #1c1410; }
[data-bs-theme="dark"] .ldd-header       { background: linear-gradient(135deg, #422006 0%, #78350f 100%); border-color: #b45309; }
[data-bs-theme="dark"] .ldd-header-title { color: #fef3c7; }
[data-bs-theme="dark"] .ldd-header-sub   { color: #fcd34d; }
[data-bs-theme="dark"] .ldd-meta-chip    { background: #1f1611; color: #fde68a; border-color: #b45309; }
[data-bs-theme="dark"] .ldd-meta-chip-dark { background: rgba(0,0,0,.30); color: #fcd34d; border-color: #b45309; }
[data-bs-theme="dark"] .ldd-search       { background: #1f1611; border-color: #422006; }
[data-bs-theme="dark"] .ldd-search input { color: #fef3c7; }
[data-bs-theme="dark"] .ldd-table-card   { background: #1f1611; border-color: #422006; }
[data-bs-theme="dark"] .ldd-table tbody tr { border-color: #422006; }
[data-bs-theme="dark"] .ldd-table tbody tr:nth-child(even) { background: #28190e; }
[data-bs-theme="dark"] .ldd-table tbody tr:hover           { background: #422006; }
[data-bs-theme="dark"] .ldd-table tbody td { color: #fef3c7; }
[data-bs-theme="dark"] .ldd-muted        { color: #fde68a; }
[data-bs-theme="dark"] .ldd-strong       { color: #fef3c7; }
[data-bs-theme="dark"] .ldd-pag          { background: #1c1410; border-color: #422006; }
[data-bs-theme="dark"] .ldd-pag-info     { background: #1f1611; color: #fde68a; border-color: #422006; }
/* Remaining light-surfaced cell bits — badges, links, status pills and the
   pagination controls — retuned for the dark #1c1410 surface so the page
   reads cohesively instead of flashing light-mode tints. */
[data-bs-theme="dark"] .ldd-sr {
  background: #2a1d10; color: #fdba74; border-color: #7c2d12;
}
[data-bs-theme="dark"] .ldd-type-badge {
  background: rgba(59,130,246,.18); color: #93c5fd; border-color: rgba(59,130,246,.40);
}
[data-bs-theme="dark"] .ldd-opp { color: #a5b4fc; }
[data-bs-theme="dark"] .ldd-na  { color: #78716c; }
[data-bs-theme="dark"] .ldd-status   { color: #a8a29e; }
[data-bs-theme="dark"] .ldd-status-q {
  background: rgba(22,163,74,.18); color: #86efac; border-color: rgba(34,197,94,.40);
}
[data-bs-theme="dark"] .ldd-status-d {
  background: rgba(220,38,38,.18); color: #fca5a5; border-color: rgba(239,68,68,.40);
}
[data-bs-theme="dark"] .ldd-pag-info strong { color: #a5b4fc; }
[data-bs-theme="dark"] .ldd-pag-range {
  color: #fcd34d; background: linear-gradient(135deg, #28190e, #1f1611); border-color: #422006;
}
[data-bs-theme="dark"] .ldd-pag-btn {
  background: #1f1611; border-color: #422006; color: #fcd34d;
}
[data-bs-theme="dark"] .ldd-pag-btn:hover:not(:disabled) {
  background: #d97706; color: #1c1410; border-color: #d97706;
}

/* Responsive */
@media (max-width: 1100px) {
  .ldd-header { flex-wrap: wrap; }
  .ldd-meta { width: 100%; justify-content: flex-start; order: 3; }
}
@media (max-width: 640px) {
  .ldd-page { padding: 10px 12px; }
  .ldd-header { flex-direction: column; align-items: flex-start; gap: 10px; }
  .ldd-header-right { width: 100%; flex-wrap: wrap; }
  .ldd-search input { width: 100%; }
}
`;
