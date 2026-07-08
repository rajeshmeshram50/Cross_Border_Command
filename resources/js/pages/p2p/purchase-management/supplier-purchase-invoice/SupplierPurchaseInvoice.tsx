import { useEffect, useMemo, useState } from 'react';
import './supplier-purchase-invoice.css';
import MapSupplierPurchaseInvoiceModal from './MapSupplierPurchaseInvoiceModal';
import SpiDetail from './SpiDetail';

/* ─────────────────────────────────────────────────────────────────────────
 * Supplier Purchase Invoice (SPI) — DESIGN-ONLY static page (teal theme).
 * Faithful port of the P2P_Main SPI prototype. Uses hard-coded demo data;
 * real data / Map-SPI submit / Zoho sync are wired in a later phase.
 * All classes are `spi-` prefixed → does not affect any other page.
 * ───────────────────────────────────────────────────────────────────────── */

type PoTab = 'with' | 'without';
type ShipTab = 'with' | 'without';

interface SpiRow {
  spiNo: string; spiDate: string;
  poNo: string;  poDate: string; poType: string;
  shipId: string; piNo: string; procId: string;
  customer: string; supplier: string;
  totalPo: number; netPayable: number; totalPaid: number; balance: number;
  attach: string; zoho: 'sync' | 'not';
}

const SUPPLIERS = ['Reliance Industries', 'Adani Enterprises', 'Mahindra Logistics', 'JSW Steel', 'Vedanta Ltd', 'Bharat Forge', 'Infosys Ltd', 'Tata Steel', 'Wipro Ltd', 'L&T', 'Hindalco', 'UltraTech', 'Godrej', 'Cipla', 'Dabur'];
const CUSTOMERS = ['Apollo Hospitals', 'Fortis Healthcare', 'Max Healthcare', 'Manipal Hospitals', 'Narayana Health', 'Medanta Medicity', 'Aster DM Healthcare', 'Medanta', 'Columbia Asia', 'KIMS', 'AIIMS', 'CMC Vellore', 'Ruby Hall', 'Lilavati', 'Kokilaben'];
const PO_TYPES = ['Material / Goods', 'Services', 'FFD / Transporter'];

/* Build 15 demo rows for a given (withPO, withShipment) combo, with number
 * ranges that mirror the prototype (With-PO 001.., Direct 051/066..). */
function buildRows(withPo: boolean, withShip: boolean): SpiRow[] {
  const base = withPo ? (withShip ? 1 : 16) : (withShip ? 51 : 66);
  const procBase = withPo ? (withShip ? 1 : 16) : (withShip ? 101 : 116);
  const shpBase = withShip ? (withPo ? 1 : 101) : 0;
  return Array.from({ length: 15 }, (_, i) => {
    const n = base + i;
    const nn = String(n).padStart(3, '0');
    const totalPo = 15000 + i * 2750;
    const netPayable = Math.round(totalPo * 0.98);
    const paid = i % 3 === 1 ? Math.round(netPayable * 0.5) : (i % 3 === 0 ? netPayable : 0);
    return {
      spiNo: `SPI/2025-26/${nn}`,
      spiDate: `2026-06-${String((i % 28) + 1).padStart(2, '0')}`,
      poNo: `PO/2025-26/${nn}`,
      poDate: `2026-05-${String((i % 28) + 1).padStart(2, '0')}`,
      poType: PO_TYPES[i % PO_TYPES.length],
      shipId: `SHP-${String(shpBase + i).padStart(3, '0')}`,
      piNo: `PI/2025-26/${nn}`,
      procId: `PROC-${String(procBase + i).padStart(3, '0')}`,
      customer: CUSTOMERS[i % CUSTOMERS.length],
      supplier: SUPPLIERS[i % SUPPLIERS.length],
      totalPo, netPayable, totalPaid: paid, balance: netPayable - paid,
      attach: `SPI-${nn}.pdf`,
      zoho: i % 2 === 1 ? 'not' : 'sync',
    };
  });
}

const DATA: Record<string, SpiRow[]> = {
  'with:with':       buildRows(true, true),
  'with:without':    buildRows(true, false),
  'without:with':    buildRows(false, true),
  'without:without': buildRows(false, false),
};

const STEPS = [
  { n: 'STEP 01', title: 'PO Link Supplier Details', desc: 'Link the purchase order and confirm supplier details.', ico: <IcoLink /> },
  { n: 'STEP 02', title: 'Supplier Purchase Invoice Details', desc: 'Enter the invoice number, date, and details.', ico: <IcoDoc /> },
  { n: 'STEP 03', title: 'Product Details (3-Way Match)', desc: 'Match products against the PO and GRN.', ico: <IcoBox /> },
  { n: 'STEP 04', title: 'Payment Processing', desc: 'Record advance and release the remaining payment.', ico: <IcoCard /> },
  { n: 'STEP 05', title: 'Sync with Zohobook', desc: 'Post the approved invoice and payment to Zohobook.', ico: <IcoSync /> },
];

const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`;
const PAGE_SIZE = 8;

export default function SupplierPurchaseInvoice() {
  const [stepsOpen, setStepsOpen] = useState(true);
  const [poTab, setPoTab] = useState<PoTab>('with');
  const [shipTab, setShipTab] = useState<ShipTab>('with');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [mapOpen, setMapOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);

  // Load DM Sans once (the Figma font) so the page + modal render crisp.
  useEffect(() => {
    const id = 'spi-dm-sans-font';
    if (document.getElementById(id)) return;
    const link = document.createElement('link');
    link.id = id; link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&display=swap';
    document.head.appendChild(link);
  }, []);

  const withPo = poTab === 'with';
  const withShip = shipTab === 'with';

  const rows = DATA[`${poTab}:${shipTab}`];
  const filtered = useMemo(() => {
    const lo = q.trim().toLowerCase();
    if (!lo) return rows;
    return rows.filter(r =>
      r.spiNo.toLowerCase().includes(lo) || r.supplier.toLowerCase().includes(lo) ||
      r.poNo.toLowerCase().includes(lo) || r.procId.toLowerCase().includes(lo) ||
      r.customer.toLowerCase().includes(lo) || r.zoho.includes(lo));
  }, [rows, q]);

  const totalRows = filtered.length;
  const pageCount = Math.max(1, Math.ceil(totalRows / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const start = (safePage - 1) * PAGE_SIZE;
  const pageRows = filtered.slice(start, start + PAGE_SIZE);

  const switchPo = (t: PoTab) => { setPoTab(t); setPage(1); setQ(''); };
  const switchShip = (t: ShipTab) => { setShipTab(t); setPage(1); };
  const onSearch = (v: string) => { setQ(v); setPage(1); };

  if (detailOpen) return <SpiDetail onClose={() => setDetailOpen(false)} />;

  return (
    <div className="spi-root">
      {/* ── Header banner ── */}
      <div className="spi-head">
        <div className="spi-head-left">
          <div className="spi-head-icon"><IcoDoc size={19} /></div>
          <div>
            <div className="spi-head-title">Supplier Purchase Invoice (SPI)</div>
            <div className="spi-head-sub">Process and reconcile supplier invoices — capture invoice details, match against purchase orders, apply taxes, and track payment status.</div>
          </div>
        </div>
        <button type="button" className="spi-head-btn" onClick={() => setMapOpen(true)}>
          <IcoLink size={13} /> Map Supplier Purchase Invoice
        </button>
      </div>

      {/* ── What We Are Doing Here ── */}
      <div className={`spi-bref ${stepsOpen ? '' : 'is-collapsed'}`}>
        <div className="spi-bref-head" onClick={() => setStepsOpen(o => !o)}>
          <div className="spi-bref-ico"><IcoDoc size={14} /></div>
          <div className="spi-bref-mid">
            <div className="spi-bref-row">
              <div className="spi-bref-label">Supplier Purchase Invoice</div>
              <div className="spi-bref-sep" />
              <div className="spi-bref-title">What We Are Doing Here</div>
            </div>
            <div className="spi-bref-sub">Link the purchase order, capture the supplier invoice, apply taxes, run a 3-way match, and post the approved invoice to Zohobook — end to end in one place.</div>
          </div>
          <div className="spi-bref-toggle"><IcoChevron /></div>
        </div>
        <div className="spi-bref-body">
          {STEPS.map(s => (
            <div className="spi-step" key={s.n}>
              <div className="spi-step-top"><span className="spi-step-ico">{s.ico}</span><span className="spi-step-num">{s.n}</span></div>
              <div className="spi-step-title">{s.title}</div>
              <div className="spi-step-desc">{s.desc}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── List card ── */}
      <div className="spi-card">
        {/* Segment pills: With / Without PO */}
        <div className="spi-seg">
          <button type="button" className={`spi-seg-btn ${withPo ? 'is-active' : ''}`} onClick={() => switchPo('with')}>
            <span className="spi-seg-ico"><IcoLink size={15} /></span> With Purchase Order SPI
            <span className="spi-seg-c">30</span>
          </button>
          <button type="button" className={`spi-seg-btn ${!withPo ? 'is-active' : ''}`} onClick={() => switchPo('without')}>
            <span className="spi-seg-ico"><IcoBox size={15} /></span> Without Purchase Order SPI (Direct SPI)
            <span className="spi-seg-c">30</span>
          </button>
        </div>

        {/* Sub-tabs + search */}
        <div className="spi-sub">
          <div className="spi-subtabs">
            <button type="button" className={`spi-subtab ${withShip ? 'is-active' : ''}`} onClick={() => switchShip('with')}>
              <IcoTruck /> With Shipment ID <span className="spi-subtab-c">15</span>
            </button>
            <button type="button" className={`spi-subtab ${!withShip ? 'is-active' : ''}`} onClick={() => switchShip('without')}>
              <IcoBox size={13} /> Without Shipment ID <span className="spi-subtab-c">15</span>
            </button>
          </div>
          <div className="spi-search">
            <IcoSearch />
            <input value={q} onChange={e => onSearch(e.target.value)} placeholder="Search SPI, supplier, PO or status..." />
          </div>
        </div>

        {/* Table */}
        <div className="spi-tablewrap">
          <table className="spi-table">
            <thead>
              <tr>
                <th className="spi-c-sr">SR NO</th>
                <th>SPI NUMBER</th>
                {withPo && <th>PO NUMBER</th>}
                {withPo && <th>PO TYPE</th>}
                {withShip && <th>SHIPMENT ID</th>}
                {withShip && <th>PI NUMBER</th>}
                <th>PROCUREMENT ID</th>
                {withShip && <th>CUSTOMER NAME</th>}
                <th>SUPPLIER NAME</th>
                <th className="spi-c-r">TOTAL PO AMOUNT</th>
                <th className="spi-c-r">NET PAYABLE AMOUNT</th>
                <th className="spi-c-r">TOTAL PAID AMOUNT</th>
                <th className="spi-c-r">BALANCE AMOUNT</th>
                <th>SPI ATTACHMENT</th>
                <th className="spi-c-c">ZOHOBOOK STATUS</th>
                <th className="spi-c-c">ACTION</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.length === 0 ? (
                <tr><td colSpan={16}>
                  <div className="spi-empty"><div className="spi-empty-t">No supplier invoices found</div><div className="spi-empty-s">Try a different search term.</div></div>
                </td></tr>
              ) : pageRows.map((r, i) => (
                <tr key={r.spiNo}>
                  <td className="spi-c-sr"><span className="spi-sr">{start + i + 1}</span></td>
                  <td>
                    <span className="spi-idstack"><span className="spi-pill spi-pill-spi">{r.spiNo}</span><span className="spi-date-sub">{r.spiDate}</span></span>
                  </td>
                  {withPo && <td><span className="spi-idstack"><span className="spi-pill spi-pill-po">{r.poNo}</span><span className="spi-date-sub">{r.poDate}</span></span></td>}
                  {withPo && <td>{r.poType}</td>}
                  {withShip && <td><span className="spi-pill spi-pill-shp">{r.shipId}</span></td>}
                  {withShip && <td><span className="spi-pill spi-pill-pi">{r.piNo}</span></td>}
                  <td><span className="spi-pill spi-pill-proc">{r.procId}</span></td>
                  {withShip && <td>{r.customer}</td>}
                  <td>{r.supplier}</td>
                  <td className="spi-c-r spi-amt">{inr(r.totalPo)}</td>
                  <td className="spi-c-r spi-amt">{inr(r.netPayable)}</td>
                  <td className="spi-c-r spi-amt">{inr(r.totalPaid)}</td>
                  <td className="spi-c-r spi-amt">{inr(r.balance)}</td>
                  <td><a className="spi-attach" onClick={e => e.preventDefault()} href="#"><IcoClip />{r.attach}</a></td>
                  <td className="spi-c-c">
                    <span className={`spi-zb ${r.zoho === 'sync' ? 'spi-zb-sync' : 'spi-zb-not'}`}><span className="spi-zb-dot" />{r.zoho === 'sync' ? 'Sync' : 'Not Sync'}</span>
                  </td>
                  <td className="spi-c-c">
                    <span className="spi-acts">
                      {r.zoho === 'sync'
                        ? <button type="button" className="spi-zohobtn is-synced"><IcoSync size={13} /> Synced</button>
                        : <button type="button" className="spi-zohobtn"><IcoSync size={13} /> Zoho Sync</button>}
                      <button type="button" className="spi-iconbtn" title="Edit"><IcoEdit /></button>
                      <button type="button" className="spi-iconbtn" title="Payment"><IcoRupee /></button>
                      <button type="button" className="spi-iconbtn" title="More"><IcoMore /></button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="spi-pag">
          <div className="spi-pag-info">Showing {totalRows === 0 ? 0 : start + 1}–{start + pageRows.length} of {totalRows}</div>
          <div className="spi-pag-btns">
            <button type="button" className="spi-pag-btn" disabled={safePage <= 1} onClick={() => setPage(safePage - 1)}>‹</button>
            {Array.from({ length: pageCount }, (_, i) => (
              <button type="button" key={i} className={`spi-pag-btn ${safePage === i + 1 ? 'is-on' : ''}`} onClick={() => setPage(i + 1)}>{i + 1}</button>
            ))}
            <button type="button" className="spi-pag-btn" disabled={safePage >= pageCount} onClick={() => setPage(safePage + 1)}>›</button>
          </div>
        </div>
      </div>

      {mapOpen && <MapSupplierPurchaseInvoiceModal onClose={() => setMapOpen(false)} onConfirm={() => { setMapOpen(false); setDetailOpen(true); }} />}
    </div>
  );
}

/* ── Inline icons (teal SVGs, no icon library) ── */
function IcoDoc({ size = 15 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/></svg>; }
function IcoLink({ size = 14 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>; }
function IcoBox({ size = 14 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>; }
function IcoCard() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>; }
function IcoSync({ size = 14 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>; }
function IcoTruck() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>; }
function IcoSearch() { return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>; }
function IcoChevron() { return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>; }
function IcoClip() { return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>; }
function IcoEdit() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>; }
function IcoRupee() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 3h12M6 8h12M6 13l8.5 8M6 8c9 0 9 5 0 5"/></svg>; }
function IcoMore() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><circle cx="12" cy="5" r="1" fill="currentColor"/><circle cx="12" cy="12" r="1" fill="currentColor"/><circle cx="12" cy="19" r="1" fill="currentColor"/></svg>; }
