import { useState, useEffect, useRef, type ReactNode } from 'react';
import Tooltip from '../../../../components/ui/Tooltip';
import WorklistPager from '../../../../components/ui/WorklistPager';
import { useToast } from '../../../../contexts/ToastContext';
import { useConfirm } from '../../../../contexts/ConfirmContext';
import api from '../../../../api';
import DebitNoteDetail from './DebitNoteDetail';
// Reuse the SPI list styling so Debit Note matches the SPI / PO design 1:1.
import '../supplier-purchase-invoice/supplier-purchase-invoice.css';

/* ─────────────────────────────────────────────────────────────────────────
 * Debit Note — list view (server-driven). Mirrors the Supplier Purchase
 * Invoice list: header banner, "what we are doing" step strip, and a worklist
 * table. Rows, search, pagination and row actions all hit the Debit Note API.
 * ──────────────────────────────────────────────────────────────────────── */

const inr = (n: number) => `₹${(n ?? 0).toLocaleString('en-IN')}`;

type DnStatus = 'Unpaid' | 'Partially Paid' | 'Fully Paid' | 'Payment Overdue';
type DnRow = {
  id: number;
  no: string; dnDate: string; type: string;
  ship: string; proc: string;
  spi: string; spiDate: string; po: string; poDate: string;
  supplier: string; exp: string; total: number;
  status: DnStatus;
  zoho: 'sync' | 'not';
};

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
  const confirm = useConfirm();
  const [q, setQ] = useState('');
  const [debQ, setDebQ] = useState('');
  const [page, setPage] = useState(1);
  const [rpp, setRpp] = useState(10);
  const [menu, setMenu] = useState<{ row: DnRow; x: number; y: number } | null>(null);
  const [payRow, setPayRow] = useState<DnRow | null>(null);   // Payment Recovery popup
  const [syncConfirm, setSyncConfirm] = useState<DnRow | null>(null);   // "Sync with Zohobook?" confirm
  const [detailOpen, setDetailOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);

  const [rows, setRows] = useState<DnRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const reload = () => setReloadKey(k => k + 1);

  const rootRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const autoFitRef = useRef(true); // false once the user picks a rows-per-page manually
  const [fillH, setFillH] = useState<number | undefined>(undefined); // stretch the card to the viewport

  const pageCount = Math.max(1, Math.ceil(total / rpp));
  const curPage = Math.min(page, pageCount);
  const start = (curPage - 1) * rpp;

  // Debounce the search box.
  useEffect(() => { const t = setTimeout(() => { setDebQ(q); setPage(1); }, 300); return () => clearTimeout(t); }, [q]);

  // Auto-fit rows-per-page to the viewport so the pagination footer always sits
  // at the bottom of the screen without scrolling (mirrors the SPI list).
  useEffect(() => {
    const recompute = () => {
      const el = scrollRef.current;
      if (!el) return;
      if (window.innerWidth <= 768) { setFillH(undefined); return; }
      const top = el.getBoundingClientRect().top;
      const THEAD = 44, ROW = 58, FOOTER = 96;
      const avail = window.innerHeight - top - THEAD - FOOTER;
      const fit = Math.max(4, Math.floor(avail / ROW));
      if (autoFitRef.current) setRpp(prev => (prev === fit ? prev : fit));
      const card = scrollRef.current?.closest('.spi-card') as HTMLElement | null;
      if (card) {
        const fh = Math.max(0, window.innerHeight - card.getBoundingClientRect().top - 20);
        setFillH(prev => (prev === fh ? prev : fh));
      }
    };
    recompute();
    const raf = requestAnimationFrame(recompute);
    let settleTimer: ReturnType<typeof setTimeout> | null = null;
    const recomputeDebounced = () => { if (settleTimer) clearTimeout(settleTimer); settleTimer = setTimeout(recompute, 140); };
    window.addEventListener('resize', recomputeDebounced);
    return () => { if (settleTimer) clearTimeout(settleTimer); window.removeEventListener('resize', recomputeDebounced); cancelAnimationFrame(raf); };
  }, []);

  // Fetch the current page of debit notes.
  useEffect(() => {
    let alive = true;
    setLoading(true);
    api.get('/p2p/debit-notes', { params: { page, per_page: rpp, q: debQ || undefined } })
      .then(r => { if (!alive) return; setRows((r.data?.data ?? []) as DnRow[]); setTotal(r.data?.pagination?.total ?? 0); })
      .catch(() => { if (alive) { setRows([]); setTotal(0); } })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [page, rpp, debQ, reloadKey]);

  const openCreate = () => { setEditId(null); setDetailOpen(true); };
  const openEdit = (r: DnRow) => { setEditId(r.id); setDetailOpen(true); };

  const syncRow = async (r: DnRow) => {
    try { await api.post(`/p2p/debit-notes/${r.id}/sync`); toast.success(`${r.no} synced with Zohobook`); reload(); }
    catch { toast.error('Sync failed', 'Could not sync this debit note.'); }
  };

  const delRow = async (r: DnRow) => {
    const ok = await confirm({ title: 'Delete debit note', message: `Delete ${r.no}? This cannot be undone.`, tone: 'danger', confirmLabel: 'Delete' });
    if (!ok) return;
    try { await api.delete(`/p2p/debit-notes/${r.id}`); toast.success(`${r.no} deleted`); reload(); }
    catch { toast.error('Delete failed', 'Could not delete this debit note.'); }
  };

  const soon = () => toast.info('Coming soon', 'This action is in development.');

  return (
    <div className="spi-root dn-scope" ref={rootRef}>
      {/* ── Header banner ── */}
      <div className="spi-head">
        <div className="spi-head-left">
          <div className="spi-head-icon"><IcoDoc size={19} /></div>
          <div>
            <div className="spi-head-title">Debit Note</div>
            <div className="spi-head-sub">Issue and track supplier debit notes for returns, rejected goods, and price or quantity adjustments — from creation to tax reversal and accounting sync.</div>
          </div>
        </div>
        <button type="button" className="spi-head-btn" onClick={openCreate}>
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
      <div className="spi-card" style={{ minHeight: fillH }}>
        {/* Figma ".dnlh" list header: teal icon + title + records pill + subtitle, search on the right. */}
        <div className="polist-top dnlh">
          <div className="dnlh-left">
            <span className="dnlh-ico"><IcoList size={20} /></span>
            <div className="dnlh-txt">
              <div className="dnlh-titrow">
                <span className="dnlh-title">All Debit Notes</span>
                <span className="dnlh-count">{total} records</span>
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
        <div className="spi-tablewrap" ref={scrollRef}>
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
              {loading ? (
                <tr><td colSpan={13}><div className="spi-empty"><div className="spi-empty-t">Loading…</div></div></td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={13}>
                  <div className="spi-empty"><div className="spi-empty-t">No debit notes found</div><div className="spi-empty-s">Create a debit note to get started, or try a different search.</div></div>
                </td></tr>
              ) : rows.map((r, i) => (
                <tr key={r.id}>
                  <td className="spi-c-sr"><span className="spi-sr">{start + i + 1}</span></td>
                  <td><span className="spi-idstack"><span className="spi-pill spi-pill-spi">{r.no}</span><span className="spi-date-sub">{r.dnDate}</span></span></td>
                  <td><span className="dn-type">{r.type || '—'}</span></td>
                  <td>{r.ship ? <span className="spi-pill spi-pill-shp">{r.ship}</span> : '—'}</td>
                  <td>{r.proc ? <span className="spi-pill spi-pill-proc">{r.proc}</span> : '—'}</td>
                  <td>{r.spi ? <span className="spi-idstack"><span className="spi-pill spi-pill-pi">{r.spi}</span><span className="spi-date-sub">{r.spiDate}</span></span> : '—'}</td>
                  <td>{r.po ? <span className="spi-idstack"><span className="spi-pill spi-pill-po">{r.po}</span><span className="spi-date-sub">{r.poDate}</span></span> : '—'}</td>
                  <td title={r.supplier ?? ''}>{r.supplier ? (r.supplier.length > 25 ? r.supplier.slice(0, 25) + '…' : r.supplier) : '—'}</td>
                  <td><span className="spi-date-sub">{r.exp || '—'}</span></td>
                  <td className="spi-c-r spi-amt">{inr(r.total)}</td>
                  <td className="spi-c-c"><span className={`dn-st ${statusClass(r.status)}`}>{r.status}</span></td>
                  <td className="spi-c-c">
                    <span className={`spi-zb ${r.zoho === 'sync' ? 'spi-zb-sync' : 'spi-zb-not'}`}><span className="spi-zb-dot" />{r.zoho === 'sync' ? 'Synced' : 'Not Synced'}</span>
                  </td>
                  <td className="spi-c-c">
                    <span className="spi-acts">
                      {r.zoho === 'sync'
                        ? <Tooltip label="Already synced to Zohobook"><button type="button" className="spi-zohobtn is-synced"><IcoSync size={13} /> Synced</button></Tooltip>
                        : <Tooltip label="Sync this debit note to Zohobook"><button type="button" className="spi-zohobtn" onClick={() => setSyncConfirm(r)}><IcoSync size={13} /> Zoho Sync</button></Tooltip>}
                      <Tooltip label="Edit debit note"><button type="button" className="spi-iconbtn" onClick={() => openEdit(r)}><IcoEdit /></button></Tooltip>
                      <Tooltip label="Email debit note"><button type="button" className="spi-iconbtn" onClick={soon}><IcoMail /></button></Tooltip>
                      <Tooltip label="Payment recovery"><button type="button" className="spi-iconbtn" onClick={() => setPayRow(r)}><IcoRupee /></button></Tooltip>
                      <Tooltip label="More actions"><button type="button" className="spi-iconbtn" onClick={e => { const b = (e.currentTarget as HTMLElement).getBoundingClientRect(); setMenu({ row: r, x: b.right, y: b.bottom + 6 }); }}><IcoMore /></button></Tooltip>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <WorklistPager total={total} page={curPage} pageSize={rpp} onPage={setPage} onPageSize={n => { autoFitRef.current = false; setRpp(n); setPage(1); }} pageSizeOptions={[5, 10, 15]} />
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
              <div className="spi-menu-sup">Supplier: {menu.row.supplier ?? '—'}</div>
            </div>
            <div className="spi-menu-items">
              <button type="button" className="spi-menu-item is-teal" onClick={() => { const r = menu.row; setMenu(null); setSyncConfirm(r); }}><span className="spi-menu-item-ico"><IcoSync size={15} /></span> Sync with Zohobook</button>
              <div className="dn-menu-grouplbl"><IcoEye size={13} /> VIEW</div>
              <button type="button" className="spi-menu-item" onClick={() => { setMenu(null); soon(); }}><span className="spi-menu-item-ico spi-menu-item-ico-pay"><IcoEye /></span> With Signature</button>
              <button type="button" className="spi-menu-item" onClick={() => { setMenu(null); soon(); }}><span className="spi-menu-item-ico spi-menu-item-ico-pay"><IcoEye /></span> Without Signature</button>
              <div className="dn-menu-grouplbl dn-menu-grouplbl-dl"><IcoDownload size={13} /> DOWNLOAD</div>
              <button type="button" className="spi-menu-item" onClick={() => { setMenu(null); soon(); }}><span className="spi-menu-item-ico spi-menu-item-ico-dl"><IcoDownload /></span> With Signature</button>
              <button type="button" className="spi-menu-item" onClick={() => { setMenu(null); soon(); }}><span className="spi-menu-item-ico spi-menu-item-ico-dl"><IcoDownload /></span> Without Signature</button>
              <button type="button" className="spi-menu-item is-danger" onClick={() => { const r = menu.row; setMenu(null); delRow(r); }}><span className="spi-menu-item-ico"><IcoTrash /></span> Delete Debit Note</button>
            </div>
          </div>
        </div>
      )}

      {syncConfirm && (
        <div className="dn-modal-backdrop" onMouseDown={() => setSyncConfirm(null)}>
          <div className="dn-sync" onMouseDown={e => e.stopPropagation()}>
            <span className="dn-sync-ico"><IcoSync size={22} /></span>
            <div className="dn-sync-title">Sync with Zohobook?</div>
            <div className="dn-sync-sub">This will push the latest debit note data to your Zohobook account and update its sync status.</div>
            <div className="dn-sync-dn"><span className="spi-pill spi-pill-spi">{syncConfirm.no}</span> · {syncConfirm.supplier ?? '—'}</div>
            <div className="dn-sync-foot">
              <button type="button" className="dn-pay-cancel" onClick={() => setSyncConfirm(null)}>Cancel</button>
              <button type="button" className="dn-pay-record" onClick={() => { const r = syncConfirm; setSyncConfirm(null); syncRow(r); }}><IcoSync size={14} /> Yes, Sync</button>
            </div>
          </div>
        </div>
      )}

      {payRow && (
        <div className="dn-modal-backdrop" onMouseDown={() => setPayRow(null)}>
          <div className="dn-pay" onMouseDown={e => e.stopPropagation()}>
            <div className="dn-pay-head">
              <span className="dn-pay-ico"><IcoRupee size={18} /></span>
              <div>
                <div className="dn-pay-title">Payment Recovery</div>
                <div className="dn-pay-sub">Record recovered amount &amp; attach proof of payment</div>
              </div>
            </div>
            <div className="dn-pay-dn"><span className="spi-pill spi-pill-spi">{payRow.no}</span> · {payRow.supplier ?? '—'}</div>
            <div className="dn-pay-stats">
              <div className="dn-pay-stat"><div className="dn-pay-stat-k">TOTAL DEBIT</div><div className="dn-pay-stat-v">{inr(payRow.total)}</div></div>
              <div className="dn-pay-stat"><div className="dn-pay-stat-k">ALREADY PAID</div><div className="dn-pay-stat-v">{inr(0)}</div></div>
              <div className="dn-pay-stat"><div className="dn-pay-stat-k">BALANCE</div><div className="dn-pay-stat-v">{inr(payRow.total)}</div></div>
            </div>
            <label className="dn-pay-lbl">AMOUNT RECOVERED (₹)</label>
            <input className="dn-pay-input" type="number" placeholder="Enter recovered / debit amount" />
            <label className="dn-pay-lbl">PROOF OF PAYMENT</label>
            <button type="button" className="dn-pay-attach"><IcoUpload size={15} /> Click to attach proof (PDF, JPG, PNG)</button>
            <div className="dn-pay-foot">
              <button type="button" className="dn-pay-cancel" onClick={() => setPayRow(null)}>Cancel</button>
              <button type="button" className="dn-pay-record" onClick={() => { setPayRow(null); soon(); }}><IcoRupee size={14} /> Record Payment</button>
            </div>
          </div>
        </div>
      )}

      {detailOpen && <DebitNoteDetail editId={editId} onClose={() => setDetailOpen(false)} onSaved={reload} />}

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
/* Mobile: let the wide worklist table scroll horizontally instead of overflowing the card. */
.dn-scope .spi-tablewrap { overflow-x:auto; }
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

/* More-Actions menu group labels — VIEW = purple, DOWNLOAD = teal (matches the
 * per-group icon tints below). */
.dn-scope .dn-menu-grouplbl { display:flex; align-items:center; gap:6px; padding:9px 12px 4px; font-size:9.5px; font-weight:800; letter-spacing:.08em; text-transform:uppercase; color:#8b5cf6; }
.dn-scope .dn-menu-grouplbl.dn-menu-grouplbl-dl { color:#0891b2; }
[data-bs-theme="dark"] .dn-scope .dn-menu-grouplbl { color:#c4b5fd; }
[data-bs-theme="dark"] .dn-scope .dn-menu-grouplbl.dn-menu-grouplbl-dl { color:#67e8f9; }

/* ── Payment Recovery popup (₹ action) ── */
.dn-modal-backdrop { position:fixed; inset:0; z-index:100000; background:rgba(15,23,42,.45); backdrop-filter:blur(2px); display:flex; align-items:center; justify-content:center; padding:20px; }
.dn-pay { width:420px; max-width:100%; background:#fff; border-radius:18px; overflow:hidden; box-shadow:0 24px 60px -12px rgba(8,47,73,.4); }
.dn-pay-head { display:flex; align-items:center; gap:12px; padding:18px 20px 14px; }
.dn-pay-ico { width:40px; height:40px; border-radius:12px; flex-shrink:0; display:flex; align-items:center; justify-content:center; color:#fff; background:linear-gradient(140deg,#22d3ee,#0891b2 60%,#0e7490); box-shadow:0 6px 16px -3px rgba(8,145,178,.5), inset 0 1px 0 rgba(255,255,255,.3); }
.dn-pay-title { font-size:15px; font-weight:800; color:#0c4a6e; letter-spacing:-.01em; }
.dn-pay-sub { font-size:11.5px; font-weight:600; color:#5b8aa0; margin-top:2px; }
.dn-pay-dn { margin:0 20px 14px; display:flex; align-items:center; gap:8px; font-size:12px; font-weight:600; color:#334155; }
.dn-pay-stats { display:grid; grid-template-columns:repeat(3,1fr); gap:10px; padding:0 20px 16px; }
.dn-pay-stat { border:1px solid #e3eef3; border-radius:11px; background:#f7fdff; padding:9px 10px; text-align:center; }
.dn-pay-stat-k { font-size:8.5px; font-weight:800; letter-spacing:.06em; text-transform:uppercase; color:#5b7585; }
.dn-pay-stat-v { font-size:14px; font-weight:800; color:#0c4a6e; margin-top:3px; }
.dn-pay-lbl { display:block; margin:0 20px 5px; font-size:9.5px; font-weight:800; letter-spacing:.06em; text-transform:uppercase; color:#5b7585; }
.dn-pay-input { display:block; width:calc(100% - 40px); margin:0 20px 14px; height:42px; padding:0 14px; border:1.5px solid #e3edf2; border-radius:11px; font-size:13px; font-weight:600; color:#0c4a6e; background:#fff; box-sizing:border-box; }
.dn-pay-input:focus { outline:none; border-color:#22d3ee; box-shadow:0 0 0 3px rgba(34,211,238,.12); }
.dn-pay-attach { display:flex; align-items:center; gap:8px; width:calc(100% - 40px); margin:0 20px 18px; padding:11px 14px; border:1.5px dashed #cfe3ea; border-radius:11px; background:#f7fdff; color:#0e7490; font-size:12.5px; font-weight:700; cursor:pointer; transition:background .15s,border-color .15s; }
.dn-pay-attach:hover { background:#eefaff; border-color:#22d3ee; }
.dn-pay-foot { display:flex; justify-content:flex-end; gap:10px; padding:0 20px 20px; }
.dn-pay-cancel { padding:9px 18px; border:1.5px solid #e3edf2; border-radius:11px; background:#fff; color:#475569; font-size:12.5px; font-weight:700; cursor:pointer; }
.dn-pay-cancel:hover { background:#f4f7f9; }
.dn-pay-record { display:inline-flex; align-items:center; gap:7px; padding:9px 18px; border:none; border-radius:11px; color:#fff; font-size:12.5px; font-weight:800; cursor:pointer; background:linear-gradient(135deg,#0e7490,#0891b2 55%,#06b6d4); box-shadow:0 6px 16px -4px rgba(8,145,178,.5); }
.dn-pay-record:hover { filter:brightness(1.05); transform:translateY(-1px); }
[data-bs-theme="dark"] .dn-pay { background:#0e1b24; }
[data-bs-theme="dark"] .dn-pay-title { color:#e8f2f6; }
[data-bs-theme="dark"] .dn-pay-dn { color:#cbd5e1; }
[data-bs-theme="dark"] .dn-pay-stat { background:#0c1c24; border-color:rgba(34,211,238,.2); }
[data-bs-theme="dark"] .dn-pay-stat-v { color:#7dd3fc; }
[data-bs-theme="dark"] .dn-pay-input, [data-bs-theme="dark"] .dn-pay-attach { background:#0c1c24; border-color:rgba(34,211,238,.22); color:#e2e8f0; }
[data-bs-theme="dark"] .dn-pay-cancel { background:#0c1c24; border-color:rgba(148,163,184,.25); color:#cbd5e1; }

/* ── "Sync with Zohobook?" confirm popup (centered) ── */
.dn-sync { width:400px; max-width:100%; background:#fff; border-radius:20px; padding:26px 26px 22px; text-align:center; box-shadow:0 24px 60px -12px rgba(8,47,73,.4); }
.dn-sync-ico { width:56px; height:56px; margin:0 auto 16px; border-radius:16px; display:flex; align-items:center; justify-content:center; color:#fff; background:linear-gradient(140deg,#22d3ee,#0891b2 60%,#0e7490); box-shadow:0 10px 22px -5px rgba(8,145,178,.55), inset 0 1px 0 rgba(255,255,255,.35); }
.dn-sync-title { font-size:17px; font-weight:800; color:#0c4a6e; letter-spacing:-.01em; }
.dn-sync-sub { font-size:12.5px; font-weight:500; color:#5b7585; line-height:1.5; margin:8px auto 16px; max-width:320px; }
.dn-sync-dn { display:inline-flex; align-items:center; gap:8px; font-size:12px; font-weight:600; color:#334155; margin-bottom:20px; }
.dn-sync-foot { display:flex; justify-content:center; gap:12px; }
.dn-sync-foot .dn-pay-cancel, .dn-sync-foot .dn-pay-record { padding:10px 22px; }
[data-bs-theme="dark"] .dn-sync { background:#0e1b24; }
[data-bs-theme="dark"] .dn-sync-title { color:#e8f2f6; }
[data-bs-theme="dark"] .dn-sync-sub { color:#7c9fb0; }
[data-bs-theme="dark"] .dn-sync-dn { color:#cbd5e1; }
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
function IcoTrash({ size = 15 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>; }

/* ── Step-strip icons — EXACT Figma clones (.bref-item__ico): 11px glyph, stroke-width 2.4. ── */
function StepSvg({ size = 11, children }: { size?: number; children: ReactNode }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">{children}</svg>; }
function StepIco1() { return <StepSvg><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 11l-3 3-2-2"/></StepSvg>; }
function StepIco2() { return <StepSvg><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="15" x2="16" y2="15"/></StepSvg>; }
function StepIco3() { return <StepSvg><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></StepSvg>; }
function StepIco4() { return <StepSvg><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></StepSvg>; }
function StepIco5() { return <StepSvg><path d="M21 12a9 9 0 0 1-9 9 9 9 0 0 1-6.7-3M3 12a9 9 0 0 1 9-9 9 9 0 0 1 6.7 3"/><polyline points="21 3 18.7 6 15.6 5.4"/><polyline points="3 21 5.3 18 8.4 18.6"/></StepSvg>; }
function IcoX({ size = 15 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>; }
function IcoEye({ size = 14 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>; }
function IcoDownload({ size = 14 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>; }
function IcoUpload({ size = 15 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>; }
