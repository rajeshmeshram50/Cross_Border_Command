import { useState, type ReactNode } from 'react';
import Tooltip from '../../../../components/ui/Tooltip';
import WorklistPager from '../../../../components/ui/WorklistPager';
import { useToast } from '../../../../contexts/ToastContext';
import DebitNoteDetail from './DebitNoteDetail';
// Reuse the SPI list styling so Debit Note matches the SPI / PO design 1:1.
import '../supplier-purchase-invoice/supplier-purchase-invoice.css';

/* ─────────────────────────────────────────────────────────────────────────
 * Debit Note — list view (DESIGN ONLY). Mirrors the Supplier Purchase Invoice
 * list: header banner, "what we are doing" step strip, and a worklist table.
 * Data is static for now (from the P2P prototype); the create/map wizard and
 * backend wiring land in later phases.
 * ──────────────────────────────────────────────────────────────────────── */

const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`;

type DnRow = {
  no: string; dnDate: string; type: string;
  ship: string; proc: string;
  spi: string; spiDate: string; po: string; poDate: string;
  supplier: string; exp: string; total: number;
  status: 'Unpaid' | 'Partially Paid' | 'Fully Paid' | 'Payment Overdue';
  zoho: 'sync' | 'not';
};

const DN_DATA: DnRow[] = [
  { no: 'DN/2025-26/001', dnDate: '2026-05-12', type: 'Purchase Return',     ship: 'SHP-001', proc: 'PRC-001', spi: 'SPI/2025-26/001', spiDate: '2026-05-10', po: 'PO/2025-26/001', poDate: '2026-04-15', supplier: 'Reliance Industries Ltd', exp: '15 May 2026', total: 3125,  status: 'Unpaid',          zoho: 'not'  },
  { no: 'DN/2025-26/002', dnDate: '2026-05-20', type: 'Rate Difference',     ship: 'SHP-014', proc: 'PRC-009', spi: 'SPI/2025-26/002', spiDate: '2026-05-18', po: 'PO/2025-26/002', poDate: '2026-04-22', supplier: 'Tata Steel Ltd',          exp: '22 May 2026', total: 18750, status: 'Partially Paid',  zoho: 'not'  },
  { no: 'DN/2025-26/003', dnDate: '2026-05-28', type: 'Quantity Difference', ship: 'SHP-021', proc: 'PRC-015', spi: 'SPI/2025-26/003', spiDate: '2026-05-25', po: 'PO/2025-26/003', poDate: '2026-05-01', supplier: 'Adani Enterprises Ltd',    exp: '01 Jun 2026', total: 9420,  status: 'Fully Paid',      zoho: 'sync' },
  { no: 'DN/2025-26/004', dnDate: '2026-06-05', type: 'Quality Rejection',   ship: 'SHP-025', proc: 'PRC-018', spi: 'SPI/2025-26/004', spiDate: '2026-06-02', po: 'PO/2025-26/004', poDate: '2026-05-12', supplier: 'Mahindra Logistics Ltd',  exp: '12 Jun 2026', total: 26500, status: 'Payment Overdue', zoho: 'not'  },
  { no: 'DN/2025-26/005', dnDate: '2026-06-08', type: 'GST Adjustment',      ship: 'SHP-031', proc: 'PRC-022', spi: 'SPI/2025-26/005', spiDate: '2026-06-04', po: 'PO/2025-26/005', poDate: '2026-05-15', supplier: 'JSW Steel Ltd',           exp: '18 Jun 2026', total: 14200, status: 'Fully Paid',      zoho: 'sync' },
  { no: 'DN/2025-26/006', dnDate: '2026-06-10', type: 'Freight Recovery',    ship: 'SHP-034', proc: 'PRC-025', spi: 'SPI/2025-26/006', spiDate: '2026-06-08', po: 'PO/2025-26/006', poDate: '2026-05-20', supplier: 'Vedanta Ltd',             exp: '20 Jun 2026', total: 7800,  status: 'Partially Paid',  zoho: 'not'  },
];

const STEPS = [
  { n: '01', ico: <StepIco1 />, title: 'Link Supplier & Invoice',   desc: 'Select the supplier and the reference invoice or PO.' },
  { n: '02', ico: <StepIco2 />, title: 'Debit Note Details',        desc: 'Enter the debit note number, date, and reason.' },
  { n: '03', ico: <StepIco3 />, title: 'Returned / Adjusted Items', desc: 'Add the items with quantities and debit values.' },
  { n: '04', ico: <StepIco4 />, title: 'Tax Reversal & Adjustment', desc: 'Reverse applicable tax and compute the net amount.' },
  { n: '05', ico: <StepIco5 />, title: 'Sync with Zohobook',        desc: 'Post the approved debit note to Zohobook.' },
];

const statusClass = (s: DnRow['status']) =>
  s === 'Fully Paid' ? 'dn-st-paid'
  : s === 'Partially Paid' ? 'dn-st-partial'
  : s === 'Payment Overdue' ? 'dn-st-overdue'
  : 'dn-st-unpaid';

export default function DebitNote() {
  const toast = useToast();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [rpp, setRpp] = useState(10);
  const [menu, setMenu] = useState<{ row: DnRow; x: number; y: number } | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const lo = q.trim().toLowerCase();
  const filtered = lo
    ? DN_DATA.filter(r => `${r.no} ${r.type} ${r.spi} ${r.po} ${r.supplier} ${r.status}`.toLowerCase().includes(lo))
    : DN_DATA;
  const total = filtered.length;
  const pageCount = Math.max(1, Math.ceil(total / rpp));
  const curPage = Math.min(page, pageCount);
  const start = (curPage - 1) * rpp;
  const rows = filtered.slice(start, start + rpp);

  const soon = () => toast.info('Coming soon', 'Debit Note actions are in development.');

  return (
    <div className="spi-root dn-scope">
      {/* ── Header banner ── */}
      <div className="spi-head">
        <div className="spi-head-left">
          <div className="spi-head-icon"><IcoDoc size={19} /></div>
          <div>
            <div className="spi-head-title">Debit Note</div>
            <div className="spi-head-sub">Issue and track supplier debit notes for returns, rejected goods, and price or quantity adjustments — from creation to tax reversal and accounting sync.</div>
          </div>
        </div>
        <button type="button" className="spi-head-btn" onClick={() => setCreateOpen(true)}>
          <IcoPlus size={15} /> Create Debit Note
        </button>
      </div>

      {/* ── What We Are Doing Here ── */}
      <div className="spi-bref">
        <div className="spi-bref-head">
          <div className="spi-bref-ico"><IcoDoc size={14} /></div>
          <div className="spi-bref-mid">
            <div className="spi-bref-row">
              <div className="spi-bref-label">Debit Note</div>
              <div className="spi-bref-sep" />
              <div className="spi-bref-title">What We Are Doing Here</div>
            </div>
            <div className="spi-bref-sub">Link the supplier invoice, capture the debit note, add the returned or adjusted items, reverse the applicable tax, and post the approved note to Zohobook — end to end in one place.</div>
          </div>
        </div>
        <div className="spi-bref-body">
          {STEPS.map(s => (
            <div className="spi-step" key={s.n}>
              <div className="spi-step-top"><span className="spi-step-ico">{s.ico}</span><span className="spi-step-num">STEP {s.n}</span></div>
              <div className="spi-step-title">{s.title}</div>
              <div className="spi-step-desc">{s.desc}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── List card ── */}
      <div className="spi-card">
        {/* Figma ".dnlh" list header: teal icon + title + records pill + subtitle, search on the right. */}
        <div className="polist-top dnlh">
          <div className="dnlh-left">
            <span className="dnlh-ico"><IcoList size={20} /></span>
            <div className="dnlh-txt">
              <div className="dnlh-titrow">
                <span className="dnlh-title">All Debit Notes</span>
                <span className="dnlh-count">{DN_DATA.length} records</span>
              </div>
              <div className="dnlh-sub">Track returns, rate &amp; quantity adjustments, and payment recovery</div>
            </div>
          </div>
          <div className="spi-search dnlh-search">
            <IcoSearch />
            <input value={q} onChange={e => { setQ(e.target.value); setPage(1); }} placeholder="Search debit note, supplier, status..." />
          </div>
        </div>

        {/* Table */}
        <div className="spi-tablewrap">
          <table className="spi-table">
            <thead>
              <tr>
                <th className="spi-c-sr">SR NO</th>
                <th>DEBIT NOTE NO.</th>
                <th>DEBIT NOTE TYPE</th>
                <th>SHIPMENT ID</th>
                <th>PROCUREMENT ID</th>
                <th>SPI NUMBER</th>
                <th>PO NUMBER</th>
                <th>SUPPLIER</th>
                <th>EXPECTED DEBIT DATE</th>
                <th className="spi-c-r">TOTAL DEBIT AMOUNT</th>
                <th className="spi-c-c">DEBIT NOTE STATUS</th>
                <th className="spi-c-c">ZOHOBOOK STATUS</th>
                <th className="spi-c-c">ACTION</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={13}>
                  <div className="spi-empty"><div className="spi-empty-t">No debit notes found</div><div className="spi-empty-s">Create a debit note to get started, or try a different search.</div></div>
                </td></tr>
              ) : rows.map((r, i) => (
                <tr key={r.no}>
                  <td className="spi-c-sr"><span className="spi-sr">{start + i + 1}</span></td>
                  <td><span className="spi-idstack"><span className="spi-pill spi-pill-spi">{r.no}</span><span className="spi-date-sub">{r.dnDate}</span></span></td>
                  <td><span className="dn-type">{r.type}</span></td>
                  <td><span className="spi-pill spi-pill-shp">{r.ship}</span></td>
                  <td><span className="spi-pill spi-pill-proc">{r.proc}</span></td>
                  <td><span className="spi-idstack"><span className="spi-pill spi-pill-pi">{r.spi}</span><span className="spi-date-sub">{r.spiDate}</span></span></td>
                  <td><span className="spi-idstack"><span className="spi-pill spi-pill-po">{r.po}</span><span className="spi-date-sub">{r.poDate}</span></span></td>
                  <td title={r.supplier}>{r.supplier.length > 25 ? r.supplier.slice(0, 25) + '…' : r.supplier}</td>
                  <td><span className="spi-date-sub">{r.exp}</span></td>
                  <td className="spi-c-r spi-amt">{inr(r.total)}</td>
                  <td className="spi-c-c"><span className={`dn-st ${statusClass(r.status)}`}>{r.status}</span></td>
                  <td className="spi-c-c">
                    <span className={`spi-zb ${r.zoho === 'sync' ? 'spi-zb-sync' : 'spi-zb-not'}`}><span className="spi-zb-dot" />{r.zoho === 'sync' ? 'Synced' : 'Not Synced'}</span>
                  </td>
                  <td className="spi-c-c">
                    <span className="spi-acts">
                      {r.zoho === 'sync'
                        ? <Tooltip label="Already synced to Zohobook"><button type="button" className="spi-zohobtn is-synced"><IcoSync size={13} /> Synced</button></Tooltip>
                        : <Tooltip label="Sync this debit note to Zohobook"><button type="button" className="spi-zohobtn" onClick={soon}><IcoSync size={13} /> Zoho Sync</button></Tooltip>}
                      <Tooltip label="Edit debit note"><button type="button" className="spi-iconbtn" onClick={soon}><IcoEdit /></button></Tooltip>
                      <Tooltip label="Email debit note"><button type="button" className="spi-iconbtn" onClick={soon}><IcoMail /></button></Tooltip>
                      <Tooltip label="Record payment"><button type="button" className="spi-iconbtn" onClick={soon}><IcoRupee /></button></Tooltip>
                      <Tooltip label="More actions"><button type="button" className="spi-iconbtn" onClick={e => { const b = (e.currentTarget as HTMLElement).getBoundingClientRect(); setMenu({ row: r, x: b.right, y: b.bottom + 6 }); }}><IcoMore /></button></Tooltip>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <WorklistPager total={total} page={curPage} pageSize={rpp} onPage={setPage} onPageSize={n => { setRpp(n); setPage(1); }} pageSizeOptions={[5, 10, 25, 50]} />
      </div>

      {menu && (
        <div className="spi-menu-backdrop" onMouseDown={() => setMenu(null)}>
          <div className="spi-menu" style={{ top: menu.y, left: Math.max(8, menu.x - 280) }} onMouseDown={e => e.stopPropagation()}>
            <div className="spi-menu-head">
              <div className="spi-menu-head-l"><span className="spi-menu-head-ico"><IcoMore /></span> More Actions</div>
              <button type="button" className="spi-menu-x" onClick={() => setMenu(null)}><IcoX /></button>
            </div>
            <div className="spi-menu-info">
              <span className="spi-pill spi-pill-spi">{menu.row.no}</span>
              <div className="spi-menu-sup">Supplier: {menu.row.supplier}</div>
            </div>
            <div className="spi-menu-items">
              <button type="button" className="spi-menu-item is-teal" onClick={() => { setMenu(null); soon(); }}><span className="spi-menu-item-ico"><IcoSync size={15} /></span> Sync with Zohobook</button>
              <button type="button" className="spi-menu-item" onClick={() => { setMenu(null); soon(); }}><span className="spi-menu-item-ico"><IcoDoc size={15} /></span> Download Debit Note</button>
              <button type="button" className="spi-menu-item" onClick={() => { setMenu(null); soon(); }}><span className="spi-menu-item-ico"><IcoRupee /></span> Record Payment</button>
            </div>
          </div>
        </div>
      )}

      {createOpen && <DebitNoteDetail onClose={() => setCreateOpen(false)} />}

      <style>{DN_CSS}</style>
    </div>
  );
}

/* Debit-note-specific bits layered on top of the reused SPI CSS: the type pill
 * and the four payment-status pills, PLUS exact values from the P2P Figma
 * prototype (.polist-* classes) so the table reads pixel-for-pixel like the design. */
const DN_CSS = `
/* Exact Figma table cell — DM Sans 11.5px, #3a5161, centred, 12px 7px padding. */
.dn-scope .spi-table tbody td { padding:12px 7px; border-bottom:1px solid #eef3f6; color:#3a5161; font-weight:600; font-size:11.5px; text-align:center; vertical-align:middle; line-height:1.35; white-space:normal; }
.dn-scope .spi-table thead th { text-align:center; }
/* Figma uniform teal id-pill (DN / SPI / PO / SHP / PRC all identical). */
.dn-scope .spi-pill { display:inline-block; padding:3px 8px; border:1px solid #cfe3ea; border-radius:7px; background:#f4fafc; color:#0e7490; font-family:'Geist Mono',ui-monospace,Menlo,Consolas,monospace !important; font-size:10px !important; font-weight:700 !important; white-space:nowrap; }
/* Figma date sub-text — DM Sans 11px, #64748b. */
.dn-scope .spi-date-sub { font-size:11px; color:#64748b; font-weight:600; white-space:nowrap; }
.dn-scope .spi-idstack { align-items:center; gap:3px; }
/* Figma Total Debit Amount — bold dark teal (font-weight 800, #0c4a6e). */
.dn-scope .spi-amt { font-weight:800; color:#0c4a6e; }
[data-bs-theme="dark"] .dn-scope .spi-amt { color:#7dd3fc; }
[data-bs-theme="dark"] .dn-scope .spi-table tbody td { color:#cbd5e1; border-bottom-color:rgba(148,163,184,.12); }
[data-bs-theme="dark"] .dn-scope .spi-pill { background:rgba(34,211,238,.1); border-color:rgba(34,211,238,.3); color:#67e8f9; }
[data-bs-theme="dark"] .dn-scope .spi-date-sub { color:#94a3b8; }
/* Figma "All Debit Notes" list header (.dnlh) — icon + title + records pill + subtitle. */
.dn-scope .polist-top { display:flex; align-items:center; justify-content:space-between; gap:14px; flex-wrap:wrap; padding:14px 16px; }
.dn-scope .dnlh { background:#fff; border-bottom:1px solid #e3eef3; }
.dn-scope .dnlh-left { display:flex; align-items:center; gap:13px; min-width:0; }
.dn-scope .dnlh-ico { width:42px; height:42px; border-radius:13px; flex-shrink:0; display:flex; align-items:center; justify-content:center; color:#fff; background:linear-gradient(140deg,#22d3ee,#0891b2 60%,#0e7490); box-shadow:0 8px 18px -5px rgba(8,145,178,.55), inset 0 1px 0 rgba(255,255,255,.35); }
.dn-scope .dnlh-txt { min-width:0; }
.dn-scope .dnlh-titrow { display:flex; align-items:center; gap:10px; }
.dn-scope .dnlh-title { font-size:16px; font-weight:800; color:#0c4a6e; letter-spacing:-.01em; line-height:1.15; }
.dn-scope .dnlh-count { display:inline-flex; align-items:center; height:21px; padding:0 10px; border-radius:20px; font-size:10.5px; font-weight:800; color:#0e7490; background:#eafaff; border:1px solid #bfe9f3; white-space:nowrap; }
.dn-scope .dnlh-sub { margin-top:3px; font-size:11.5px; font-weight:600; color:#5b8aa0; line-height:1.2; }
/* Figma debit-note search — EXACT clone of .dnlh .polist-search: the visible box lives on the
 * INPUT (border, radius, padding, shadow), the container is just a transparent positioning wrapper.
 * (SPI reuse puts the box on the container, which rendered taller/bulkier than the Figma.) */
.dn-scope .dnlh-search { flex:0 0 auto; width:760px; max-width:62%; min-width:240px; margin:0; height:auto; background:transparent; border:0; border-radius:0; padding:0; box-shadow:none; }
.dn-scope .dnlh-search input { width:100%; height:auto; padding:11px 14px 11px 40px; border:1.5px solid #e3edf2; border-radius:13px; background:#fff; font-size:13px; font-weight:600; color:#0c4a6e; box-shadow:0 2px 8px rgba(8,80,110,.05); box-sizing:border-box; }
.dn-scope .dnlh-search:focus-within { box-shadow:none; }
.dn-scope .dnlh-search input:focus { border-color:#22d3ee; box-shadow:0 0 0 3px rgba(34,211,238,.12); }
.dn-scope .dnlh-search svg { left:13px; }
[data-bs-theme="dark"] .dn-scope .dnlh-search { background:transparent; border:0; }
[data-bs-theme="dark"] .dn-scope .dnlh-search input { background:#0c1c24; border-color:rgba(34,211,238,.22); color:#e2e8f0; }
[data-bs-theme="dark"] .dn-scope .dnlh { background:#0e1b24; border-bottom-color:rgba(34,211,238,.18); }
[data-bs-theme="dark"] .dn-scope .dnlh-title { color:#e8f2f6; }
[data-bs-theme="dark"] .dn-scope .dnlh-count { background:rgba(34,211,238,.12); border-color:rgba(34,211,238,.3); color:#67e8f9; }
[data-bs-theme="dark"] .dn-scope .dnlh-sub { color:#7c9fb0; }

/* Figma DEBIT NOTE TYPE — plain text, inherits the td font (11.5px DM Sans, #3a5161, 600), wraps normally. */
.dn-type { color:#3a5161; font-weight:600; }
.dn-st { display:inline-flex; align-items:center; gap:6px; padding:4px 11px; border-radius:20px; font-size:11px; font-weight:700; white-space:nowrap; }
.dn-st::before { content:''; width:6px; height:6px; border-radius:50%; background:currentColor; }
.dn-st-paid    { background:#ecfdf5; color:#059669; }
.dn-st-partial { background:#fffbeb; color:#b45309; }
.dn-st-overdue { background:#fef2f2; color:#dc2626; }
.dn-st-unpaid  { background:#f1f5f9; color:#64748b; }
[data-bs-theme="dark"] .dn-type { color:#cbd5e1; }
[data-bs-theme="dark"] .dn-st-paid    { background:rgba(5,150,105,.16); color:#6ee7b7; }
[data-bs-theme="dark"] .dn-st-partial { background:rgba(180,83,9,.18); color:#fcd34d; }
[data-bs-theme="dark"] .dn-st-overdue { background:rgba(220,38,38,.18); color:#fca5a5; }
[data-bs-theme="dark"] .dn-st-unpaid  { background:rgba(148,163,184,.16); color:#cbd5e1; }
`;

/* ── Inline icons ── */
function IcoDoc({ size = 15 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/></svg>; }
function IcoList({ size = 20 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>; }
function IcoBox({ size = 14 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>; }
function IcoCard({ size = 14 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>; }
function IcoSearch({ size = 15 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>; }
function IcoSync({ size = 14 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>; }
function IcoEdit({ size = 14 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z"/></svg>; }
function IcoRupee({ size = 14 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><path d="M6 3h12M6 8h12M6 13l8.5 8M6 13h3a5 5 0 0 0 5-5"/></svg>; }
function IcoMore({ size = 16 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/></svg>; }
function IcoPlus({ size = 15 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>; }
function IcoMail({ size = 14 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/></svg>; }

/* ── Step-strip icons — EXACT Figma clones (.bref-item__ico): 11px glyph, stroke-width 2.4. ── */
function StepSvg({ size = 11, children }: { size?: number; children: ReactNode }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">{children}</svg>; }
function StepIco1() { return <StepSvg><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 11l-3 3-2-2"/></StepSvg>; }
function StepIco2() { return <StepSvg><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="15" x2="16" y2="15"/></StepSvg>; }
function StepIco3() { return <StepSvg><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></StepSvg>; }
function StepIco4() { return <StepSvg><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></StepSvg>; }
function StepIco5() { return <StepSvg><path d="M21 12a9 9 0 0 1-9 9 9 9 0 0 1-6.7-3M3 12a9 9 0 0 1 9-9 9 9 0 0 1 6.7 3"/><polyline points="21 3 18.7 6 15.6 5.4"/><polyline points="3 21 5.3 18 8.4 18.6"/></StepSvg>; }
function IcoX({ size = 15 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>; }
