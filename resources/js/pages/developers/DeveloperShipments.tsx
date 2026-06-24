import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
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

/* A "New Supplier" directory entry — created inline from the Map Supplier
   Directory "New Supplier" flow (p2p_suppliers), NOT the Vendor master. */
type NewSupplierRow = {
  id: number;
  name: string | null;
  segment: string | null;
  contact: string | null;
  mobile: string | null;
  email: string | null;
  address: string | null;
  country: string | null;
  state: string | null;
  state_code: string | null;
  city: string | null;
  gmaps: string | null;
  sourcing_count: number;
  created_at: string | null;
};

/* A sourcing target that used a given new supplier (drill-down). */
type SupplierSourcing = { code: string; due_date: string | null; products: string[] };

type DevTab = 'shipments' | 'suppliers';

const PAGE_SIZE = 10;

function fmtDate(s: string | null): string {
  if (!s) return '—';
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-GB');
}

export default function DeveloperShipments() {
  const toast = useToast();
  const [tab, setTab] = useState<DevTab>('shipments');
  const [rows, setRows] = useState<ShipmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [wdhOpen, setWdhOpen] = useState(false);

  // ── New Suppliers tab (lazy-loaded on first open) ──
  const [supRows, setSupRows] = useState<NewSupplierRow[]>([]);
  const [supLoading, setSupLoading] = useState(false);
  const [supLoaded, setSupLoaded] = useState(false);
  const [supQ, setSupQ] = useState('');
  const [supPage, setSupPage] = useState(1);
  const [sourcingFor, setSourcingFor] = useState<NewSupplierRow | null>(null);

  useEffect(() => {
    if (tab !== 'suppliers' || supLoaded) return;
    let alive = true;
    setSupLoading(true);
    api.get<{ status: boolean; data: NewSupplierRow[] }>('/p2p/new-suppliers')
      .then(r => { if (alive) { setSupRows(r.data?.data ?? []); setSupLoaded(true); } })
      .catch(() => { if (alive) toast.error('Load failed', 'Could not load new suppliers.'); })
      .finally(() => { if (alive) setSupLoading(false); });
    return () => { alive = false; };
  }, [tab, supLoaded, toast]);

  const supFiltered = useMemo(() => {
    const lo = supQ.trim().toLowerCase();
    if (!lo) return supRows;
    return supRows.filter(r =>
      [r.name, r.segment, r.contact, r.mobile, r.email, r.city, r.state, r.country]
        .some(v => (v ?? '').toLowerCase().includes(lo)),
    );
  }, [supRows, supQ]);

  const supTotalPages = Math.max(1, Math.ceil(supFiltered.length / PAGE_SIZE));
  const supSafePage = Math.min(supPage, supTotalPages);
  const supPageRows = supFiltered.slice((supSafePage - 1) * PAGE_SIZE, supSafePage * PAGE_SIZE);
  const supStartIdx = supFiltered.length === 0 ? 0 : (supSafePage - 1) * PAGE_SIZE + 1;
  const supEndIdx = Math.min(supSafePage * PAGE_SIZE, supFiltered.length);

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

      {/* ── Tabs ── */}
      <div className="dsh-tabs">
        <button type="button" className={`dsh-tab${tab === 'shipments' ? ' is-active' : ''}`} onClick={() => setTab('shipments')}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 17h4V5H2v12h3" /><path d="M20 17h2v-3.34a4 4 0 0 0-1.17-2.83L19 9h-5v8h1" /><circle cx="7.5" cy="17.5" r="2.5" /><circle cx="17.5" cy="17.5" r="2.5" /></svg>
          Shipment Tracker
        </button>
        <button type="button" className={`dsh-tab${tab === 'suppliers' ? ' is-active' : ''}`} onClick={() => setTab('suppliers')}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
          New Suppliers
        </button>
      </div>

      {tab === 'shipments' && (
      <>
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
            <div className="dsh-cstrip-title">Shipment Tracker</div>
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
            Shipment Tracker — What We Are Doing Here:
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
      </>
      )}

      {tab === 'suppliers' && (
      <>
      {/* ── Header banner ── */}
      <div className="dsh-cstrip">
        <div className="dsh-cstrip-left">
          <div className="dsh-cstrip-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
          </div>
          <div>
            <div className="dsh-cstrip-title">New Suppliers</div>
            <div className="dsh-cstrip-sub">Every supplier registered inline through the Map Supplier Directory “New Supplier” flow — kept separate from the Vendor master.</div>
          </div>
        </div>
      </div>

      {/* ── Toolbar ── */}
      <div className="dsh-toolbar">
        <div className="dsh-search">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
          <input
            value={supQ}
            onChange={e => { setSupQ(e.target.value); setSupPage(1); }}
            placeholder="Search by name, segment, contact, city…"
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
                <th>Supplier Name</th>
                <th>Segment</th>
                <th>Contact Person</th>
                <th>Mobile</th>
                <th>Email</th>
                <th>City</th>
                <th>State</th>
                <th>Country</th>
                <th className="ta-c">Sourcings</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {supLoading && (
                <tr><td colSpan={11} className="dsh-empty">Loading new suppliers…</td></tr>
              )}
              {!supLoading && supPageRows.length === 0 && (
                <tr><td colSpan={11} className="dsh-empty">No new suppliers yet. They appear here once registered via “New Supplier” when mapping.</td></tr>
              )}
              {!supLoading && supPageRows.map((r, i) => (
                <tr key={r.id}>
                  <td className="ta-c"><span className="dsh-srno">{supStartIdx + i}</span></td>
                  <td className="dsh-strong">{r.name ?? '—'}</td>
                  <td>{r.segment ? <span className="dsh-opp-chip">{r.segment}</span> : <span className="dsh-em">—</span>}</td>
                  <td>{r.contact ?? '—'}</td>
                  <td className="dsh-date">{r.mobile ?? '—'}</td>
                  <td className="dsh-link">{r.email ?? '—'}</td>
                  <td>{r.city ?? '—'}</td>
                  <td>{r.state ?? '—'}{r.state_code ? ` (${r.state_code})` : ''}</td>
                  <td>{r.country ?? '—'}</td>
                  <td className="ta-c">
                    {r.sourcing_count > 0
                      ? <button type="button" className="dsh-srcq-chip" title="View sourcings using this supplier" onClick={() => setSourcingFor(r)}>{r.sourcing_count}</button>
                      : <span className="dsh-srcq-zero">0</span>}
                  </td>
                  <td className="dsh-date">{fmtDate(r.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="dsh-foot">
          <span className="dsh-foot-count">
            {supFiltered.length === 0 ? '0 results' : `${supStartIdx} to ${supEndIdx} of ${supFiltered.length}`}
          </span>
          <div className="dsh-pager">
            <button type="button" className="dsh-pager-btn" disabled={supSafePage <= 1} onClick={() => setSupPage(p => Math.max(1, p - 1))} aria-label="Previous page">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6" /></svg>
            </button>
            <span className="dsh-pager-cur">{supSafePage} / {supTotalPages}</span>
            <button type="button" className="dsh-pager-btn" disabled={supSafePage >= supTotalPages} onClick={() => setSupPage(p => Math.min(supTotalPages, p + 1))} aria-label="Next page">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="9 18 15 12 9 6" /></svg>
            </button>
          </div>
        </div>
      </div>
      </>
      )}

      {sourcingFor && <SupplierSourcingsModal supplier={sourcingFor} onClose={() => setSourcingFor(null)} />}
    </div>
  );
}

/* Drill-down: the sourcing targets that mapped a given new supplier. */
function SupplierSourcingsModal({ supplier, onClose }: { supplier: NewSupplierRow; onClose: () => void }) {
  const [rows, setRows] = useState<SupplierSourcing[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api.get<{ status: boolean; data: SupplierSourcing[] }>(`/p2p/new-suppliers/${supplier.id}/sourcings`)
      .then(r => { if (alive) setRows(r.data?.data ?? []); })
      .catch(() => { if (alive) setRows([]); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [supplier.id]);

  return createPortal(
    <div className="dssm-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dssm-box">
        <div className="dssm-head">
          <div className="dssm-head-main">
            <div className="dssm-title">Sourcings using this supplier</div>
            <div className="dssm-sub">{supplier.name ?? 'Supplier'} · {rows.length} sourcing{rows.length !== 1 ? 's' : ''}</div>
          </div>
          <button type="button" className="dssm-close" onClick={onClose} aria-label="Close">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>
        <div className="dssm-body">
          {loading ? (
            <div className="dssm-empty">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="dssm-empty">Not mapped to any sourcing.</div>
          ) : rows.map((s, i) => (
            <div className="dssm-row" key={s.code + i}>
              <span className="dssm-code">{s.code}</span>
              <div className="dssm-prods">
                {s.products.length ? s.products.map((p, pi) => <span className="dssm-prod" key={pi}>{p}</span>) : <span className="dssm-em">—</span>}
              </div>
              <span className="dssm-due">{fmtDate(s.due_date)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}

const SCOPED_CSS = `
.dsh-root { padding: 4px 2px 24px; font-family: inherit; }

/* Tabs */
.dsh-tabs {
  display: inline-flex; gap: 6px; margin-bottom: 14px; padding: 4px;
  background: #f3eaff; border: 1px solid #d6c5ff; border-radius: 12px;
}
.dsh-tab {
  display: inline-flex; align-items: center; gap: 8px;
  font-family: inherit; font-size: 13px; font-weight: 700; color: #6d28d9;
  background: transparent; border: none; border-radius: 9px; padding: 9px 18px;
  cursor: pointer; transition: all .15s; white-space: nowrap;
}
.dsh-tab:hover { background: #ede4ff; }
.dsh-tab.is-active {
  color: #fff; background: linear-gradient(135deg, #7c3aed, #6d28d9);
  box-shadow: 0 4px 12px rgba(124,58,237,.35);
}
[data-bs-theme="dark"] .dsh-tabs { background: var(--color-surface-2); border-color: var(--color-border); }
[data-bs-theme="dark"] .dsh-tab { color: #c4b5fd; }
[data-bs-theme="dark"] .dsh-tab:hover { background: rgba(124,58,237,.16); }
[data-bs-theme="dark"] .dsh-tab.is-active { color: #fff; }

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

/* ── Dark mode — uses the app's own theme variables (--color-surface etc.)
   so this page matches the rest of the app's neutral dark theme instead of a
   clashing purple. Violet is kept only for brand accents (header gradient,
   chips, pills, icons). ── */
[data-bs-theme="dark"] .dsh-cstrip,
[data-bs-theme="dark"] .dsh-wdh-card,
[data-bs-theme="dark"] .dsh-table-wrap,
[data-bs-theme="dark"] .dsh-foot {
  background: var(--color-surface);
  border-color: var(--color-border);
  box-shadow: 0 2px 16px rgba(0,0,0,.35);
}
[data-bs-theme="dark"] .dsh-cstrip-title { color: var(--color-text); }
[data-bs-theme="dark"] .dsh-cstrip-sub,
[data-bs-theme="dark"] .dsh-wdh-toggle-row,
[data-bs-theme="dark"] .dsh-wdh-body { color: #c4b5fd; }
[data-bs-theme="dark"] .dsh-wdh-body strong,
[data-bs-theme="dark"] .dsh-wdh-chev { color: #ddd6fe; }

/* Toolbar + search */
[data-bs-theme="dark"] .dsh-toolbar {
  background: var(--color-surface-2);
  border-bottom-color: rgba(124,58,237,.5);
}
[data-bs-theme="dark"] .dsh-search { background: var(--color-surface); border-color: var(--color-border); color: var(--color-text); }
[data-bs-theme="dark"] .dsh-search input { color: var(--color-text); }
[data-bs-theme="dark"] .dsh-search input::placeholder { color: var(--color-muted); }

/* Table rows */
[data-bs-theme="dark"] .dsh-table tbody td { color: var(--color-text); border-color: var(--color-border); }
[data-bs-theme="dark"] .dsh-table tbody tr:nth-child(even) td { background: var(--color-surface-2); }
[data-bs-theme="dark"] .dsh-table tbody tr:hover td { background: rgba(124,58,237,.14); }
[data-bs-theme="dark"] .dsh-empty { color: var(--color-muted); }

/* Cell content */
[data-bs-theme="dark"] .dsh-strong { color: var(--color-text); }
[data-bs-theme="dark"] .dsh-date { color: var(--color-muted); }
[data-bs-theme="dark"] .dsh-link { color: #7dd3fc; }
[data-bs-theme="dark"] .dsh-em { color: var(--color-muted); }
[data-bs-theme="dark"] .dsh-id-chip,
[data-bs-theme="dark"] .dsh-opp-chip { background: rgba(167,139,250,.16); border-color: rgba(167,139,250,.32); color: #ddd6fe; }
[data-bs-theme="dark"] .dsh-pi-chip  { background: rgba(56,189,248,.14); border-color: rgba(56,189,248,.3); color: #7dd3fc; }

/* Status pills — translucent so they read on the dark surface */
[data-bs-theme="dark"] .dsh-pill-seller { background: rgba(167,139,250,.18); color: #c4b5fd; }
[data-bs-theme="dark"] .dsh-pill-buyer  { background: rgba(34,211,238,.16);  color: #67e8f9; }
[data-bs-theme="dark"] .dsh-pill-yes    { background: rgba(34,197,94,.18);  color: #86efac; }
[data-bs-theme="dark"] .dsh-pill-no     { background: rgba(244,63,94,.18);  color: #fda4af; }

/* Footer + pager */
[data-bs-theme="dark"] .dsh-foot-count { color: #c4b5fd; }
[data-bs-theme="dark"] .dsh-pager-cur { color: var(--color-text); }
[data-bs-theme="dark"] .dsh-pager-btn { background: var(--color-surface-2); border-color: var(--color-border); color: #c4b5fd; }
[data-bs-theme="dark"] .dsh-pager-btn:hover:not(:disabled) { background: rgba(124,58,237,.16); }

/* Scrollbar */
[data-bs-theme="dark"] .dsh-table-scroll::-webkit-scrollbar-thumb { background: rgba(148,163,184,.45); }
[data-bs-theme="dark"] .dsh-table-scroll::-webkit-scrollbar-thumb:hover { background: rgba(148,163,184,.65); }

/* Sourcings count chip (clickable) */
.dsh-srcq-chip {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 28px; height: 26px; padding: 0 9px; cursor: pointer;
  font-family: inherit; font-size: 12px; font-weight: 800; color: #fff;
  background: linear-gradient(135deg, #7c3aed, #6d28d9); border: none; border-radius: 8px;
  box-shadow: 0 3px 9px rgba(124,58,237,.4); transition: transform .12s, box-shadow .12s;
}
.dsh-srcq-chip:hover { transform: translateY(-1px); box-shadow: 0 6px 14px rgba(124,58,237,.5); }
.dsh-srcq-zero { color: #cbd5e1; font-weight: 700; }

/* Sourcings drill-down modal (portalled to body). */
.dssm-overlay {
  position: fixed; inset: 0; z-index: 1200; display: flex; align-items: center; justify-content: center;
  background: rgba(15,23,42,.55); backdrop-filter: blur(4px); padding: 20px;
}
.dssm-box {
  width: min(540px, calc(100vw - 24px)); max-height: 80vh; display: flex; flex-direction: column;
  background: #fff; border-radius: 16px; overflow: hidden; box-shadow: 0 24px 60px rgba(15,23,42,.4);
}
.dssm-head {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 16px 18px; background: linear-gradient(135deg, #6d28d9, #5b21b6); color: #fff;
}
.dssm-title { font-size: 15px; font-weight: 800; }
.dssm-sub { font-size: 11.5px; opacity: .85; margin-top: 2px; }
.dssm-close {
  width: 30px; height: 30px; border-radius: 9px; flex-shrink: 0; border: none; cursor: pointer;
  background: rgba(255,255,255,.18); color: #fff; display: flex; align-items: center; justify-content: center;
}
.dssm-close:hover { background: rgba(255,255,255,.3); }
.dssm-body { padding: 12px 14px; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; background: #faf7ff; }
.dssm-empty { text-align: center; padding: 28px 0; color: #94a3b8; font-size: 13px; }
.dssm-row {
  display: flex; align-items: center; gap: 12px; padding: 10px 12px;
  background: #fff; border: 1px solid #ede9fe; border-radius: 10px;
}
.dssm-code {
  font-family: ui-monospace, monospace; font-size: 12px; font-weight: 800; color: #6d28d9;
  background: #f5f3ff; border: 1px solid #ddd6fe; border-radius: 6px; padding: 3px 9px; flex-shrink: 0;
}
.dssm-prods { flex: 1; display: flex; flex-wrap: wrap; gap: 5px; min-width: 0; }
.dssm-prod { font-size: 11px; font-weight: 600; color: #475569; background: #f1f5f9; border-radius: 6px; padding: 2px 8px; }
.dssm-due { font-size: 11.5px; color: #94a3b8; font-variant-numeric: tabular-nums; flex-shrink: 0; }
.dssm-em { color: #cbd5e1; }
[data-bs-theme="dark"] .dssm-box { background: var(--color-surface); }
[data-bs-theme="dark"] .dssm-body { background: var(--color-surface-2); }
[data-bs-theme="dark"] .dssm-row { background: var(--color-surface); border-color: var(--color-border); }
[data-bs-theme="dark"] .dssm-code { background: rgba(167,139,250,.16); border-color: rgba(167,139,250,.32); color: #ddd6fe; }
[data-bs-theme="dark"] .dssm-prod { background: rgba(255,255,255,.06); color: var(--color-text); }
`;
