import { useEffect, useMemo, useState } from 'react';
import api from '../../api';
import { useToast } from '../../contexts/ToastContext';

/* ────────────────────────────────────────────────────────────────────────────
 * Developers → Shipment (Business Task list)
 *
 * Read-only table of every shipment order (SHP-NNN) for the tenant, styled to
 * match the Customers page (violet header banner + "What We Are Doing Here"
 * collapsible + violet table). Data: GET /sales/shipment-orders.
 * ──────────────────────────────────────────────────────────────────────────── */

type ShipmentRow = {
  id: number;
  shipment_code: string | null;
  created_at: string | null;
  owner_name: string | null;
  opp_code: string | null;
  opp_date: string | null;
  customer_name: string | null;
  consignee_name: string | null;
  pi_no: string | null;
  pi_date: string | null;
  shipping_liability: string | null;
  cold_chain: boolean;
  inco_term: string | null;
  port_of_loading: string | null;
  port_of_unloading: string | null;
};

const PAGE_SIZE = 10;

function fmtDate(s: string | null): string {
  if (!s) return '—';
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-GB');
}

export default function DeveloperShipments() {
  const toast = useToast();
  const [rows, setRows] = useState<ShipmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [wdhOpen, setWdhOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api.get<{ status: boolean; data: ShipmentRow[] }>('/sales/shipment-orders')
      .then(r => { if (alive) setRows(r.data?.data ?? []); })
      .catch(() => { if (alive) toast.error('Load failed', 'Could not load shipment orders.'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [toast]);

  const filtered = useMemo(() => {
    const lo = q.trim().toLowerCase();
    if (!lo) return rows;
    return rows.filter(r =>
      [r.shipment_code, r.owner_name, r.opp_code, r.customer_name, r.consignee_name, r.pi_no]
        .some(v => (v ?? '').toLowerCase().includes(lo)),
    );
  }, [rows, q]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const startIdx = filtered.length === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1;
  const endIdx = Math.min(safePage * PAGE_SIZE, filtered.length);

  return (
    <div className="dsh-root">
      <style>{SCOPED_CSS}</style>

      {/* ── Header banner ── */}
      <div className="dsh-cstrip">
        <div className="dsh-cstrip-left">
          <div className="dsh-cstrip-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 17h4V5H2v12h3" /><path d="M20 17h2v-3.34a4 4 0 0 0-1.17-2.83L19 9h-5v8h1" />
              <circle cx="7.5" cy="17.5" r="2.5" /><circle cx="17.5" cy="17.5" r="2.5" />
            </svg>
          </div>
          <div>
            <div className="dsh-cstrip-title">Business Task</div>
            <div className="dsh-cstrip-sub">Track every shipment order (SHP) raised against won opportunities — owner, parties, PI and logistics at a glance.</div>
          </div>
        </div>
      </div>

      {/* ── What We Are Doing Here (collapsible) ── */}
      <div className="dsh-wdh-card">
        <button type="button" className="dsh-wdh-toggle-row" onClick={() => setWdhOpen(o => !o)}>
          <span className="dsh-wdh-left">
            <span className="dsh-wdh-bulb">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 17h4V5H2v12h3" /><circle cx="7.5" cy="17.5" r="2.5" /><circle cx="17.5" cy="17.5" r="2.5" /></svg>
            </span>
            Business Task — What We Are Doing Here:
          </span>
          <svg className={`dsh-wdh-chev${wdhOpen ? ' open' : ''}`} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><polyline points="6 9 12 15 18 9" /></svg>
        </button>
        <div className="dsh-wdh-body-wrap" style={{ maxHeight: wdhOpen ? 220 : 0 }}>
          <div className="dsh-wdh-body">
            Each row is a <strong>shipment order</strong> created in the Sales Matrix Victory Stage once a deal is won. The <strong>Shipment ID</strong> (SHP) is sequenced per branch. Use this list to monitor logistics — shipping liability, cold-chain, INCO term and the loading / unloading ports — across all opportunities, alongside their owner, customer, consignee and Proforma Invoice.
          </div>
        </div>
      </div>

      {/* ── Toolbar ── */}
      <div className="dsh-toolbar">
        <div className="dsh-search">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
          <input
            value={q}
            onChange={e => { setQ(e.target.value); setPage(1); }}
            placeholder="Search by Shipment ID, Owner, Opp ID, Customer…"
          />
        </div>
      </div>

      {/* ── Table ── */}
      <div className="dsh-table-wrap">
        <div className="dsh-table-scroll">
          <table className="dsh-table">
            <thead>
              <tr>
                <th className="ta-c" style={{ width: 56 }}>Sr No</th>
                <th>Shipment ID</th>
                <th>Shipment Date</th>
                <th>Owner Name</th>
                <th>Opp ID</th>
                <th>Opp Date</th>
                <th>Customer Name</th>
                <th>Consignee Name</th>
                <th>PI No</th>
                <th>PI Date</th>
                <th>Shipping Liability</th>
                <th className="ta-c">Cold Chain</th>
                <th>INCO Term</th>
                <th>Port Of Loading</th>
                <th>Port Of Unloading</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={15} className="dsh-empty">Loading shipment orders…</td></tr>
              )}
              {!loading && pageRows.length === 0 && (
                <tr><td colSpan={15} className="dsh-empty">No shipment orders found.</td></tr>
              )}
              {!loading && pageRows.map((r, i) => (
                <tr key={r.id}>
                  <td className="ta-c"><span className="dsh-srno">{startIdx + i}</span></td>
                  <td><span className="dsh-id-chip">{r.shipment_code ?? '—'}</span></td>
                  <td className="dsh-date">{fmtDate(r.created_at)}</td>
                  <td className="dsh-strong">{r.owner_name ?? '—'}</td>
                  <td>{r.opp_code ? <span className="dsh-opp-chip">{r.opp_code}</span> : <span className="dsh-em">—</span>}</td>
                  <td className="dsh-date">{fmtDate(r.opp_date)}</td>
                  <td className="dsh-strong">{r.customer_name ?? '—'}</td>
                  <td>{r.consignee_name ?? '—'}</td>
                  <td>{r.pi_no ? <span className="dsh-pi-chip">{r.pi_no}</span> : <span className="dsh-em">—</span>}</td>
                  <td className="dsh-date">{fmtDate(r.pi_date)}</td>
                  <td>
                    {r.shipping_liability
                      ? <span className={`dsh-pill ${r.shipping_liability.toLowerCase() === 'buyer' ? 'dsh-pill-buyer' : 'dsh-pill-seller'}`}>{r.shipping_liability}</span>
                      : <span className="dsh-em">—</span>}
                  </td>
                  <td className="ta-c"><span className={`dsh-pill ${r.cold_chain ? 'dsh-pill-yes' : 'dsh-pill-no'}`}>{r.cold_chain ? 'Yes' : 'No'}</span></td>
                  <td>{r.inco_term ?? '—'}</td>
                  <td className="dsh-link">{r.port_of_loading ?? '—'}</td>
                  <td className="dsh-link">{r.port_of_unloading ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* ── Footer / pagination ── */}
        <div className="dsh-foot">
          <span className="dsh-foot-count">
            {filtered.length === 0 ? '0 results' : `${startIdx} to ${endIdx} of ${filtered.length}`}
          </span>
          <div className="dsh-pager">
            <button type="button" className="dsh-pager-btn" disabled={safePage <= 1} onClick={() => setPage(p => Math.max(1, p - 1))} aria-label="Previous page">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6" /></svg>
            </button>
            <span className="dsh-pager-cur">{safePage} / {totalPages}</span>
            <button type="button" className="dsh-pager-btn" disabled={safePage >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))} aria-label="Next page">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="9 18 15 12 9 6" /></svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const SCOPED_CSS = `
.dsh-root { padding: 4px 2px 24px; font-family: inherit; }

/* Header banner — violet wash matching the Customers hero. */
.dsh-cstrip {
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 20px; border-radius: 16px; margin-bottom: 14px;
  background: linear-gradient(110deg, #faf7ff 0%, #f4eeff 45%, #efe8ff 75%, #ece4ff 100%);
  border: 1px solid #d6c5ff;
  box-shadow: 0 2px 14px rgba(124,58,237,.08);
}
.dsh-cstrip-left { display: flex; align-items: center; gap: 14px; }
.dsh-cstrip-icon {
  width: 44px; height: 44px; border-radius: 12px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  background: linear-gradient(135deg, #7c3aed, #6d28d9);
  box-shadow: 0 4px 12px rgba(124,58,237,.35);
}
.dsh-cstrip-title { font-size: 18px; font-weight: 800; color: #2e1065; letter-spacing: -.01em; }
.dsh-cstrip-sub   { font-size: 12.5px; color: #6d28d9; margin-top: 2px; max-width: 720px; }

/* "What We Are Doing Here" collapsible. */
.dsh-wdh-card {
  border-radius: 14px; margin-bottom: 14px; overflow: hidden;
  background: linear-gradient(135deg, #faf5ff 0%, #f3eaff 45%, #ede1ff 100%);
  border: 1px solid #d6c5ff;
}
.dsh-wdh-toggle-row {
  width: 100%; display: flex; align-items: center; justify-content: space-between;
  padding: 12px 18px; background: transparent; border: none; cursor: pointer;
  font-family: inherit; font-size: 13.5px; font-weight: 700; color: #4c1d95;
}
.dsh-wdh-left { display: inline-flex; align-items: center; gap: 10px; }
.dsh-wdh-bulb {
  width: 28px; height: 28px; border-radius: 8px; flex-shrink: 0;
  display: inline-flex; align-items: center; justify-content: center;
  background: linear-gradient(135deg, #7c3aed, #6d28d9);
  box-shadow: 0 3px 8px rgba(124,58,237,.3);
}
.dsh-wdh-chev { color: #6d28d9; transition: transform .2s; }
.dsh-wdh-chev.open { transform: rotate(180deg); }
.dsh-wdh-body-wrap { transition: max-height .25s ease; overflow: hidden; }
.dsh-wdh-body { padding: 0 20px 16px 58px; font-size: 12.5px; line-height: 1.6; color: #5b21b6; }
.dsh-wdh-body strong { color: #4c1d95; font-weight: 800; }

/* Toolbar + search. */
.dsh-toolbar {
  padding: 12px 14px; border-radius: 12px 12px 0 0;
  background: linear-gradient(110deg, #ede9fe 0%, #ddd6fe 50%, #c4b5fd 100%);
  border-bottom: 2px solid #a78bfa;
}
.dsh-search {
  display: flex; align-items: center; gap: 8px;
  background: rgba(255,255,255,.9); border: 1px solid rgba(124,58,237,.2);
  border-radius: 9px; padding: 8px 12px; color: #6d28d9;
  transition: border .15s, box-shadow .15s;
}
.dsh-search:focus-within { border-color: #7c3aed; box-shadow: 0 0 0 3px rgba(124,58,237,.15); }
.dsh-search input { flex: 1; border: none; outline: none; background: transparent; font-family: inherit; font-size: 13px; color: #1e1b4b; }
.dsh-search input::placeholder { color: #a78bfa; }

/* Table. */
.dsh-table-wrap {
  background: #fff; border: 1px solid #ede9fe; border-top: none;
  border-radius: 0 0 14px 14px; overflow: hidden;
  box-shadow: 0 2px 16px rgba(124,58,237,.07);
}
.dsh-table-scroll { overflow-x: auto; }
.dsh-table { width: 100%; border-collapse: separate; border-spacing: 0; font-size: 13px; min-width: 1500px; }
.dsh-table thead tr { background: linear-gradient(90deg, #6d28d9 0%, #5b21b6 60%, #4c1d95 100%); }
.dsh-table thead th {
  color: #fff; font-size: 11.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .03em;
  padding: 12px 14px; text-align: left; white-space: nowrap; position: sticky; top: 0; z-index: 2;
  background: transparent;
}
.dsh-table tbody td { padding: 11px 14px; border-bottom: 1px solid rgba(124,58,237,.08); color: #475569; white-space: nowrap; }
.dsh-table tbody tr:nth-child(even) td { background: #fdfaff; }
.dsh-table tbody tr:hover td { background: #f5f0ff; }
.ta-c { text-align: center !important; }
.dsh-empty { text-align: center; padding: 28px 0; color: #94a3b8; font-size: 13px; }

.dsh-srno { display: inline-flex; align-items: center; justify-content: center; min-width: 24px; height: 24px; border-radius: 7px; background: linear-gradient(135deg, #7c3aed, #6d28d9); color: #fff; font-size: 11px; font-weight: 700; }
.dsh-id-chip  { font-family: ui-monospace, monospace; font-size: 11.5px; font-weight: 800; color: #6d28d9; background: #f5f3ff; border: 1px solid #ddd6fe; border-radius: 6px; padding: 2px 8px; }
.dsh-opp-chip { font-family: ui-monospace, monospace; font-size: 11px; font-weight: 700; color: #7c3aed; background: #f5f3ff; border: 1px solid #e9d5ff; border-radius: 6px; padding: 2px 8px; }
.dsh-pi-chip  { font-family: ui-monospace, monospace; font-size: 11px; font-weight: 700; color: #0369a1; background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 6px; padding: 2px 8px; }
.dsh-strong { color: #1e1b4b; font-weight: 600; }
.dsh-date   { color: #64748b; font-variant-numeric: tabular-nums; }
.dsh-link   { color: #2563eb; }
.dsh-em     { color: #cbd5e1; }

.dsh-pill { display: inline-flex; align-items: center; padding: 2px 11px; border-radius: 999px; font-size: 10.5px; font-weight: 700; }
.dsh-pill-seller { background: #ede9fe; color: #6d28d9; }
.dsh-pill-buyer  { background: #cffafe; color: #0e7490; }
.dsh-pill-yes    { background: #dcfce7; color: #16a34a; }
.dsh-pill-no     { background: #fee2e2; color: #dc2626; }

/* Footer / pagination. */
.dsh-foot { display: flex; align-items: center; justify-content: space-between; padding: 10px 16px; border-top: 1px solid #ede9fe; background: #faf7ff; }
.dsh-foot-count { font-size: 12px; color: #6d28d9; font-weight: 600; }
.dsh-pager { display: inline-flex; align-items: center; gap: 8px; }
.dsh-pager-btn { width: 30px; height: 30px; border-radius: 8px; border: 1px solid #ddd6fe; background: #fff; color: #6d28d9; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; }
.dsh-pager-btn:hover:not(:disabled) { background: #f5f3ff; }
.dsh-pager-btn:disabled { opacity: .4; cursor: not-allowed; }
.dsh-pager-cur { font-size: 12px; font-weight: 700; color: #4c1d95; min-width: 46px; text-align: center; }

/* Neutral-grey scrollbar (matches the rest of the app). */
.dsh-table-scroll::-webkit-scrollbar { height: 9px; }
.dsh-table-scroll::-webkit-scrollbar-track { background: transparent; }
.dsh-table-scroll::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 999px; }
.dsh-table-scroll::-webkit-scrollbar-thumb:hover { background: #94a3b8; }

/* Dark mode. */
[data-bs-theme="dark"] .dsh-cstrip,
[data-bs-theme="dark"] .dsh-wdh-card { background: #14102a; border-color: rgba(167,139,250,.25); }
[data-bs-theme="dark"] .dsh-cstrip-title { color: #ede9fe; }
[data-bs-theme="dark"] .dsh-cstrip-sub,
[data-bs-theme="dark"] .dsh-wdh-toggle-row,
[data-bs-theme="dark"] .dsh-wdh-body { color: #c4b5fd; }
[data-bs-theme="dark"] .dsh-table-wrap { background: #14102a; border-color: rgba(167,139,250,.2); }
[data-bs-theme="dark"] .dsh-table tbody td { color: #cbd5e1; border-color: rgba(167,139,250,.12); }
[data-bs-theme="dark"] .dsh-table tbody tr:nth-child(even) td { background: #1a1538; }
[data-bs-theme="dark"] .dsh-table tbody tr:hover td { background: #221a45; }
[data-bs-theme="dark"] .dsh-foot { background: #14102a; border-color: rgba(167,139,250,.2); }
[data-bs-theme="dark"] .dsh-id-chip { background: rgba(167,139,250,.14); border-color: rgba(167,139,250,.3); color: #c4b5fd; }
[data-bs-theme="dark"] .dsh-strong { color: #ede9fe; }
[data-bs-theme="dark"] .dsh-search { background: rgba(20,16,42,.8); border-color: rgba(167,139,250,.3); }
[data-bs-theme="dark"] .dsh-search input { color: #ede9fe; }
[data-bs-theme="dark"] .dsh-pager-btn { background: #1a1538; border-color: rgba(167,139,250,.3); color: #c4b5fd; }
`;
