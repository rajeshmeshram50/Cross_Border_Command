import { useEffect, useMemo, useState } from 'react';
import { formatDmy } from '../../../utils/formatDmy';
import { useLocation } from 'react-router-dom';
import api from '../../../api';
import { useToast } from '../../../contexts/ToastContext';
import { useNavigateContext } from '../../../components/App';
import SearchClear from '../../../components/ui/SearchClear';
import { Shimmer, ShimmerTableRows } from '../../../components/ui/Shimmer';

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
  const [pageSize, setPageSize] = useState(ROWS_PER_PAGE);
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
        per_page: pageSize,
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
  }, [spId, debouncedQ, page, pageSize, toast]);

  const onBack = () => navigate('sales.lead_distribution');

  const pages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, pages);
  const startIdx = (safePage - 1) * pageSize;
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
              {loading ? <Shimmer width={70} height={9} /> : <>{total} lead{total === 1 ? '' : 's'} found</>}
            </div>
          </div>
        </div>

        {/* Search, then the reference pills, then Back */}
        <div className="ldd-header-right">
          <div className="ldd-search ui-search-abs">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#0891b2" strokeWidth="2.2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
            <input
              type="text"
              autoComplete="off"
              placeholder="Search lead..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            <SearchClear show={search} onClear={() => { setSearch(''); }} />
          </div>
          {/* Meta chips */}
          <div className="ldd-meta">
            {spEmp && (
              <>
                <div className="ldd-hp">
                  <span className="ldd-hp-ico"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/></svg></span>
                  <div className="ldd-hp-txt">
                    <div className="ldd-hp-lbl">Employee ID</div>
                    <div className="ldd-hp-val ldd-hp-val--mono" title={spEmp}>{spEmp}</div>
                  </div>
                </div>
                <span className="ldd-hp-dots">⋮</span>
              </>
            )}
            <div className="ldd-hp">
              <span className="ldd-hp-ico ldd-hp-ico--alt"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></span>
              <div className="ldd-hp-txt">
                <div className="ldd-hp-lbl">Sales Person</div>
                <div className="ldd-hp-val" title={spName}>{spName}</div>
              </div>
            </div>
            {spMgr && (
              <>
                <span className="ldd-hp-dots">⋮</span>
                <div className="ldd-hp">
                  <span className="ldd-hp-ico"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg></span>
                  <div className="ldd-hp-txt">
                    <div className="ldd-hp-lbl">Reporting Manager</div>
                    <div className="ldd-hp-val" title={spMgr}>{spMgr}</div>
                  </div>
                </div>
              </>
            )}
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
              {/* Shimmer rows while the salesperson's leads load (not a bare "Loading…" line). */}
              {loading && <ShimmerTableRows rows={pageSize} cols={11} height={12} cellClassName="" keyPrefix="ldd-shim" />}
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
            <label className="ldd-rows-per-page">
              <span>Rows per page:</span>
              <select
                value={pageSize}
                onChange={e => { setPageSize(Number(e.target.value)); setPage(1); }}
              >
                {[10, 15, 25, 50].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
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

/* ─── Styles — the cyan palette of Lead Distribution / My Workplace. ──── */
const LDD_CSS = `
/* Leads Details — the My Workplace / Lead Distribution cyan (banner, toolbar
   button, table header, row tint, pager). Layout is unchanged. */
.ldd-page {
  box-sizing: border-box;
  margin: -1rem -0.75rem;
  background: linear-gradient(160deg, #f0fdfe 0%, #e8fafb 30%, #f5feff 60%, #ffffff 100%);
  height: calc(100vh - 130px);
  overflow: hidden;
  display: flex; flex-direction: column;
  padding: 14px 18px;
  gap: 8px;
  animation: ldd-fade .18s ease-out;
}
@keyframes ldd-fade { from { opacity: 0; } to { opacity: 1; } }

/* Header — the My Workplace banner */
.ldd-header {
  position: relative; overflow: hidden;
  background: linear-gradient(110deg, #f0fdff 0%, #e6fafe 25%, #d0f5fb 55%, #bef0f8 85%, #a8eaf5 100%);
  border: 1px solid #cef3f9;
  border-radius: 16px;
  min-height: 58px;
  padding: 9px 14px 9px 18px;
  display: flex; align-items: center; justify-content: space-between;
  gap: 14px; flex-shrink: 0;
  box-shadow: 0 2px 0 rgba(255,255,255,.9) inset, 0 4px 16px rgba(8,145,178,.1), 0 1px 4px rgba(0,0,0,.04);
}
.ldd-header::before {
  content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 4px;
  background: linear-gradient(180deg, #06b6d4, #0891b2, #0e7490);
}
.ldd-header-left { display: flex; align-items: center; gap: 13px; min-width: 0; }
.ldd-header-icon {
  width: 38px; height: 38px; border-radius: 12px;
  background: linear-gradient(135deg, #0891b2 0%, #0e7490 55%, #155e75 100%); color: #fff;
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 0 0 3px rgba(8,145,178,.25), 0 4px 14px rgba(14,116,144,.45);
  flex-shrink: 0;
}
.ldd-header-title {
  font-size: 14.5px; font-weight: 700; color: #0c4a6e;
  letter-spacing: -.3px; line-height: 1.2;
}
.ldd-header-sub  { font-size: 10px; color: #0e7490; margin-top: 2px; font-weight: 500; opacity: .85; }

.ldd-meta { display: flex; align-items: center; gap: 6px; min-width: 0; }
/* Header reference pills = the Create PO header (.spi-dt-pill): icon tile,
   small-caps label over a mono value, dotted separators. */
.ldd-hp { display: flex; align-items: center; gap: 9px; padding: 7px 14px; border-radius: 12px; min-width: 0;
  background: rgba(255,255,255,.65); border: 1.5px solid rgba(8,145,178,.3);
  box-shadow: 0 2px 8px rgba(6,182,212,.12), inset 0 1px 0 rgba(255,255,255,.95);
  backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); }
.ldd-hp-ico { width: 26px; height: 26px; border-radius: 8px; display: flex; align-items: center; justify-content: center; flex-shrink: 0;
  background: linear-gradient(135deg,#06b6d4,#0891b2); color: #fff; box-shadow: 0 3px 8px rgba(8,145,178,.45); }
.ldd-hp-ico--alt { background: linear-gradient(135deg,#0891b2,#0e7490); box-shadow: 0 3px 8px rgba(14,116,144,.4); }
.ldd-hp-txt { min-width: 0; }
.ldd-hp-lbl { font-size: 7px; font-weight: 800; letter-spacing: .14em; text-transform: uppercase; color: #22d3ee; line-height: 1; margin-bottom: 2px; }
.ldd-hp-val { font-size: 12.5px; font-weight: 600; letter-spacing: .05em; color: #0c4a6e; line-height: 1;
  max-width: 190px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ldd-hp-val--mono { font-family: 'Geist Mono', ui-monospace, monospace; }
.ldd-hp-dots { align-self: center; color: #0891b2; opacity: .4; font-size: 12px; line-height: 1; letter-spacing: -1px; padding: 0 1px; }
[data-bs-theme="dark"] .ldd-hp { background: rgba(12,38,48,.55); border-color: rgba(34,211,238,.28); box-shadow: 0 2px 8px rgba(0,0,0,.3), inset 0 1px 0 rgba(34,211,238,.08); }
[data-bs-theme="dark"] .ldd-hp-val { color: #e8f2f6; }
[data-bs-theme="dark"] .ldd-hp-lbl { color: #38d6f0; }

.ldd-header-right { display: flex; align-items: center; gap: 8px; margin-left: auto; min-width: 0; }
.ldd-search {
  display: flex; align-items: center; gap: 7px;
  background: #fff; border: 1.5px solid #a5f3fc; border-radius: 10px;
  padding: 0 12px; height: 40px;
  transition: border-color .15s, box-shadow .15s;
}
.ldd-search:focus-within { border-color: #0891b2; box-shadow: 0 0 0 3px rgba(8,145,178,.15); }
.ldd-search input {
  border: none; outline: none; background: transparent;
  font-family: inherit; font-size: 12px; color: #0c4a6e; width: 260px;
}
.ldd-search input::placeholder { color: #94a3b8; }
/* Back = the My Workplace toolbar button (.lwp-bact): cyan gradient, 40px, 11.5 / 700. */
.ldd-back-btn {
  display: inline-flex; align-items: center; gap: 7px;
  height: 40px; padding: 0 18px;
  background: linear-gradient(135deg, #06b6d4 0%, #0891b2 55%, #0e7490 100%); color: #fff;
  border: none; border-radius: 12px;
  font-family: inherit; font-size: 11.5px; font-weight: 700; letter-spacing: .02em;
  cursor: pointer; white-space: nowrap;
  text-shadow: 0 1px 2px rgba(0,0,0,.15);
  box-shadow: 0 4px 16px rgba(6,182,212,.45), 0 2px 6px rgba(8,145,178,.25), 0 1px 0 rgba(255,255,255,.22) inset;
  transition: all .22s;
}
.ldd-back-btn:hover {
  background: linear-gradient(135deg, #22d3ee 0%, #06b6d4 55%, #0891b2 100%);
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(6,182,212,.55), 0 3px 8px rgba(8,145,178,.3), 0 1px 0 rgba(255,255,255,.22) inset;
}

/* Table card — the My Workplace table card */
.ldd-table-card {
  background: #fff;
  border: 1.5px solid #a5f3fc;
  border-radius: 14px;
  overflow: hidden;
  box-shadow: 0 4px 20px rgba(8,145,178,.1), 0 1px 4px rgba(0,0,0,.04);
  display: flex; flex-direction: column;
  flex: 1; min-height: 0;
}
.ldd-table-wrap { position: relative; flex: 1; overflow: auto; scrollbar-width: thin; scrollbar-color: #a5f3fc transparent; }
.ldd-table { width: 100%; border-collapse: collapse; font-size: 11.5px; table-layout: fixed; }
.ldd-table thead { position: sticky; top: 0; z-index: 2; }
.ldd-table thead tr {
  background: linear-gradient(90deg, #155e75 0%, #0e7490 25%, #0891b2 55%, #06b6d4 80%, #22d3ee 100%);
  box-shadow: 0 2px 10px rgba(8,145,178,.3);
}
.ldd-table thead th {
  color: #fff;
  font-size: 8px; font-weight: 700;
  padding: 11px 8px;
  text-transform: uppercase; letter-spacing: .07em;
  text-align: left;
  text-shadow: 0 1px 3px rgba(0,0,0,.2);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.ldd-table thead th:first-child { padding-left: 16px; }
.ldd-table tbody tr { border-bottom: 1px solid #ecfeff; transition: background .1s; }
.ldd-table tbody tr:nth-child(even) { background: #f7fffe; }
.ldd-table tbody tr:hover           { background: #ecfeff; }
.ldd-table tbody td {
  padding: 0; height: 42px; vertical-align: middle;
  font-size: 11.5px; color: #475569;
  padding-left: 8px; padding-right: 8px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.ldd-table tbody td:first-child { padding-left: 14px; }

/* Sr No = the Customers list badge (.dt-serial): filled rounded square, white
   number — in this page's cyan. */
.ldd-sr {
  display: inline-flex; align-items: center; justify-content: center;
  width: 24px; height: 24px; border-radius: 7px;
  background: linear-gradient(135deg, #0891b2, #155e75);
  color: #fff;
  font-size: 11px; font-weight: 800;
  font-variant-numeric: tabular-nums;
  box-shadow: 0 2px 6px rgba(8,145,178,.30);
}
.ldd-type-badge {
  display: inline-flex; padding: 2px 8px; border-radius: 6px;
  font-size: 10px; font-weight: 700;
  background: #e0f2fe; color: #0369a1; border: 1px solid #bae6fd;
  white-space: nowrap;
}
/* Opp. ID as a chip — the Customers list ID chip (.dt-id-chip) shape, in cyan. */
.ldd-opp {
  display: inline-flex; align-items: center;
  padding: 2px 8px; border-radius: 6px;
  background: #ecfeff; border: 1px solid #a5f3fc; color: #0e7490;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px; font-weight: 600; letter-spacing: .02em;
  white-space: nowrap;
}
.ldd-muted  { color: #64748b; font-size: 11px; }
.ldd-strong { font-weight: 600; color: #0f172a; }
.ldd-na     { color: #cbd5e1; font-style: italic; font-size: 11px; }
/* Cell type = the Customers list (.smc-table-wrap): 11.5 / 500 for every data cell;
   the badges / ID / status pill keep their own sizes. */
.ldd-table tbody td,
.ldd-table tbody td *:not(i):not(svg):not(svg *) { font-size: 11.5px !important; font-weight: 500 !important; }
.ldd-table tbody td .ldd-sr.ldd-sr { font-size: 11px !important; font-weight: 800 !important; }
.ldd-table tbody td .ldd-opp.ldd-opp { font-family: 'JetBrains Mono', ui-monospace, monospace !important; font-size: 10px !important; font-weight: 600 !important; letter-spacing: .02em; }
.ldd-table tbody td .ldd-type-badge.ldd-type-badge { font-size: 10px !important; font-weight: 600 !important; }
.ldd-table tbody td .ldd-status-badge.ldd-status-badge,
.ldd-table tbody td .ldd-status-badge.ldd-status-badge * { font-size: 10px !important; font-weight: 700 !important; }

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
.ldd-status-dot { width: 5px; height: 5px; border-radius: 50%; flex-shrink: 0; }

/* Empty state centred in the whole table body, not pinned under the header. */
.ldd-table tbody td.ldd-status {
  position: absolute; inset: 0; height: auto; display: flex; align-items: center; justify-content: center;
  padding: 0 14px; border: none; background: transparent;
  color: #94a3b8; font-style: italic; font-size: 12px;
}

/* Pagination — the My Workplace pager */
.ldd-pag {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 16px;
  border-top: 2px solid #a5f3fc;
  background: linear-gradient(90deg, #ecfeff 0%, #cffafe 40%, #ecfeff 100%);
  flex-wrap: wrap; gap: 8px;
  flex-shrink: 0;
}
.ldd-pag-info {
  font-size: 11.5px; font-weight: 500; color: #0e7490;
  background: rgba(255,255,255,.8); border: 1.5px solid #a5f3fc;
  padding: 5px 14px; border-radius: 20px;
  box-shadow: 0 1px 4px rgba(8,145,178,.1), 0 1px 0 rgba(255,255,255,.9) inset;
}
.ldd-pag-info strong { color: #0891b2; font-weight: 800; }
.ldd-pag-ctrl { display: flex; align-items: center; gap: 6px; }
.ldd-rows-per-page {
  display: inline-flex; align-items: center; gap: 5px; margin-right: 2px;
  font-size: 11.5px; color: #0e7490; font-weight: 500;
  background: rgba(255,255,255,.8); border: 1.5px solid #a5f3fc;
  padding: 4px 12px; border-radius: 20px;
  box-shadow: 0 1px 4px rgba(8,145,178,.1), 0 1px 0 rgba(255,255,255,.9) inset;
}
.ldd-rows-per-page select {
  border: none; background: transparent; font-family: inherit;
  font-size: 11.5px; color: #0891b2; font-weight: 700; cursor: pointer; outline: none;
}
.ldd-pag-range {
  font-size: 11.5px; font-weight: 800; color: #fff;
  background: linear-gradient(135deg, #0891b2 0%, #0e7490 55%, #155e75 100%);
  border: none;
  padding: 5px 18px; border-radius: 20px; white-space: nowrap;
  box-shadow: 0 3px 12px rgba(8,145,178,.4), 0 1px 0 rgba(255,255,255,.2) inset;
}
.ldd-pag-btn {
  width: 32px; height: 32px; border-radius: 50%;
  border: 1.5px solid #a5f3fc; background: rgba(255,255,255,.8);
  display: flex; align-items: center; justify-content: center;
  color: #0891b2;
  cursor: pointer; transition: all .18s;
}
.ldd-pag-btn:hover:not(:disabled) { background: #fff; border-color: #0891b2; transform: translateY(-1px); box-shadow: 0 4px 12px rgba(8,145,178,.25); }
.ldd-pag-btn:disabled              { cursor: not-allowed; opacity: .4; }

/* Dark mode — the My Workplace dark cyan */
[data-bs-theme="dark"] .ldd-page         { background: transparent; }
[data-bs-theme="dark"] .ldd-header {
  background:
    radial-gradient(ellipse at top right, rgba(34,211,238,0.10), transparent 60%),
    radial-gradient(ellipse at bottom left, rgba(14,165,233,0.08), transparent 60%),
    linear-gradient(135deg, #0e2940 0%, #102a3a 50%, #0c1f2e 100%);
  border-color: rgba(34,211,238,0.18);
  box-shadow: 0 4px 16px rgba(0,0,0,.35);
}
[data-bs-theme="dark"] .ldd-header-title { color: #f0f9ff; }
[data-bs-theme="dark"] .ldd-header-sub   { color: #67e8f9; }
[data-bs-theme="dark"] .ldd-search       { background: #0f2233; border-color: rgba(103,232,249,.30); }
[data-bs-theme="dark"] .ldd-search input { color: #e2e8f0; }
[data-bs-theme="dark"] .ldd-table-card   { background: #0f2233; border-color: rgba(34,211,238,.25); box-shadow: 0 4px 20px rgba(0,0,0,.35); }
[data-bs-theme="dark"] .ldd-table tbody tr { border-color: rgba(34,211,238,.10); }
[data-bs-theme="dark"] .ldd-table tbody tr:nth-child(even) { background: rgba(8,145,178,.06); }
[data-bs-theme="dark"] .ldd-table tbody tr:hover           { background: rgba(8,145,178,.14); }
[data-bs-theme="dark"] .ldd-table tbody td { color: #cbd5e1; }
[data-bs-theme="dark"] .ldd-muted        { color: #94a3b8; }
[data-bs-theme="dark"] .ldd-strong       { color: #f0f9ff; }
[data-bs-theme="dark"] .ldd-sr           { color: #e2e8f0; }
[data-bs-theme="dark"] .ldd-type-badge   { background: rgba(3,105,161,.25); color: #7dd3fc; border-color: rgba(125,211,252,.35); }
[data-bs-theme="dark"] .ldd-opp          { color: #67e8f9; background: rgba(8,145,178,.16); border-color: rgba(103,232,249,.35); }
[data-bs-theme="dark"] .ldd-na           { color: #475569; }
[data-bs-theme="dark"] .ldd-status       { color: #94a3b8; }
[data-bs-theme="dark"] .ldd-status-q     { background: rgba(22,163,74,.18); color: #86efac; border-color: rgba(34,197,94,.40); }
[data-bs-theme="dark"] .ldd-status-d     { background: rgba(220,38,38,.18); color: #fca5a5; border-color: rgba(239,68,68,.40); }
[data-bs-theme="dark"] .ldd-pag          { background: rgba(8,145,178,.08); border-top-color: rgba(34,211,238,.25); }
[data-bs-theme="dark"] .ldd-pag-info     { background: rgba(15,34,51,.8); color: #67e8f9; border-color: rgba(103,232,249,.30); box-shadow: none; }
[data-bs-theme="dark"] .ldd-pag-info strong { color: #a5f3fc; }
[data-bs-theme="dark"] .ldd-rows-per-page { background: rgba(15,34,51,.8); color: #67e8f9; border-color: rgba(103,232,249,.30); box-shadow: none; }
[data-bs-theme="dark"] .ldd-rows-per-page select { color: #a5f3fc; }
[data-bs-theme="dark"] .ldd-pag-btn      { background: rgba(15,34,51,.8); border-color: rgba(103,232,249,.30); color: #67e8f9; }

/* Responsive */
@media (max-width: 1100px) {
  .ldd-header { flex-wrap: wrap; }
  .ldd-header-right { width: 100%; flex-wrap: wrap; justify-content: flex-end; }
}
@media (max-width: 640px) {
  .ldd-page { padding: 10px 12px; }
  .ldd-header { flex-direction: column; align-items: flex-start; gap: 10px; }
  .ldd-header-right { width: 100%; flex-wrap: wrap; }
  .ldd-search input { width: 100%; }
}
`;
