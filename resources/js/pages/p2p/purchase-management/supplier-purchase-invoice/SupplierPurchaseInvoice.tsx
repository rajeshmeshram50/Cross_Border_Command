import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './supplier-purchase-invoice.css';
import MapSupplierPurchaseInvoiceModal, { type MapConfirmPayload } from './MapSupplierPurchaseInvoiceModal';
import SpiDetail from './SpiDetail';
import PoPaymentModal from '../../procurement-management/purchase-order/PoPaymentModal';
import WorklistPager from '../../../../components/ui/WorklistPager';
import Tooltip from '../../../../components/ui/Tooltip';
import { useScrollLock } from '../../../../hooks/useScrollLock';
import { formatDmy } from '../../../../utils/formatDmy';
import { useToast } from '../../../../contexts/ToastContext';
import api from '../../../../api';

/* ─────────────────────────────────────────────────────────────────────────
 * Supplier Purchase Invoice (SPI) list — server-driven (teal theme).
 * Rows, tab counts, search, pagination and row actions all hit the SPI API.
 * All classes are `spi-` prefixed → does not affect any other page.
 * ───────────────────────────────────────────────────────────────────────── */

type PoTab = 'with' | 'without';
type ShipTab = 'with' | 'without';

interface SpiRow {
  id: number;
  poId?: number | null;   // linked PO id — enables paying the PO from the SPI screen
  spiNo: string; spiDate: string;
  poNo: string;  poDate?: string; poType: string;
  shipId: string; piNo: string; procId: string;
  customer: string; supplier: string;
  totalPo: number; netPayable: number; totalPaid: number; balance: number;
  attach: string | null; zoho: 'sync' | 'not';
  po_fully_utilized?: boolean;   // linked PO fully paid — gates the Zoho sync
  docAttached?: boolean;         // uploaded invoice doc already pushed to the Zoho PO/Bill
}

// State for the Zoho-sync confirm + speedometer modal (mirrors the PO screen).
type SyncState = { id: number; spiNo: string; supplier?: string; busy: boolean; progress: number; attempt: number; failed: boolean; errorMsg?: string };

const STEPS = [
  { n: 'STEP 01', title: 'PO Link Supplier Details', desc: 'Link the purchase order and confirm supplier details.', ico: <IcoLink /> },
  { n: 'STEP 02', title: 'Supplier Purchase Invoice Details', desc: 'Enter the invoice number, date, and details.', ico: <IcoDoc /> },
  { n: 'STEP 03', title: 'Product Details (3-Way Match)', desc: 'Match products against the PO and GRN.', ico: <IcoBox /> },
  { n: 'STEP 04', title: 'Payment Processing', desc: 'Record advance and release the remaining payment.', ico: <IcoCard /> },
  { n: 'STEP 05', title: 'Sync with Zohobook', desc: 'Post the approved invoice and payment to Zohobook.', ico: <IcoSync /> },
];

const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`;

export default function SupplierPurchaseInvoice() {
  const [stepsOpen, setStepsOpen] = useState(true);
  const [poTab, setPoTab] = useState<PoTab>('with');
  const [shipTab, setShipTab] = useState<ShipTab>('with');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [rpp, setRpp] = useState(10);
  const [mapOpen, setMapOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  // Context chosen in the Map modal (with/without PO + the picked PO/supplier).
  const [mapCtx, setMapCtx] = useState<MapConfirmPayload | null>(null);
  const [editId, setEditId] = useState<number | null>(null); // set when editing an existing SPI
  const [menu, setMenu] = useState<{ row: SpiRow; x: number; y: number } | null>(null);
  // Freeze background scroll while the More Actions menu is open — it's
  // positioned off the trigger's rect, so a background scroll would detach it.
  useScrollLock(!!menu);
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const autoFitRef = useRef(true); // false once the user picks a rows-per-page manually
  const [fillH, setFillH] = useState<number | undefined>(undefined); // stretch the card to the viewport
  const toast = useToast();

  // Server-driven list state.
  const [rows, setRows] = useState<SpiRow[]>([]);
  // "Payment Summary Against PO" popup target (paid against the SPI's linked PO).
  const [payRow, setPayRow] = useState<SpiRow | null>(null);
  // With-PO SPI → pay the linked PO; Direct SPI → pay the SPI itself. The modal
  // picks the flow from (poId, spiId).
  const openPoPayment = (r: SpiRow) => setPayRow(r);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [counts, setCounts] = useState({ poWith: 0, poWithout: 0, shipWith: 0, shipWithout: 0 });
  const [reloadKey, setReloadKey] = useState(0);
  const reload = () => setReloadKey(k => k + 1);
  const [debQ, setDebQ] = useState('');

  const openMenu = (e: React.MouseEvent, r: SpiRow) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMenu({ row: r, x: rect.right, y: rect.bottom + 6 });
  };

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
  // Shipment / PI / Customer columns show whenever the "With Shipment ID" sub-tab is
  // active — in BOTH With-PO and Direct (Without-PO) SPI, since a Direct SPI can also
  // be linked to a shipment (matches the design).
  const showShipCols = withShip;

  // Debounce the search box so we don't hit the API on every keystroke.
  useEffect(() => { const t = setTimeout(() => { setDebQ(q); setPage(1); }, 300); return () => clearTimeout(t); }, [q]);

  // Fetch the current page of invoices.
  useEffect(() => {
    let alive = true;
    setLoading(true);
    api.get('/p2p/supplier-purchase-invoices', {
      // Direct (Without-PO) SPI also splits by shipment now, so send ship_tab for both PO tabs.
      params: { po_tab: poTab, ship_tab: shipTab, page, per_page: rpp, q: debQ || undefined },
    })
      .then(r => { if (!alive) return; setRows((r.data?.data ?? []) as SpiRow[]); setTotal(r.data?.pagination?.total ?? 0); })
      .catch(() => { if (alive) { setRows([]); setTotal(0); } })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [poTab, shipTab, page, rpp, debQ, reloadKey]);

  // Tab counts (tiny per_page=1 calls; refresh on PO-tab change or after a save).
  useEffect(() => {
    let alive = true;
    const c = (params: Record<string, string>) =>
      api.get('/p2p/supplier-purchase-invoices', { params: { ...params, per_page: 1 } })
        .then(r => r.data?.pagination?.total ?? 0).catch(() => 0);
    Promise.all([
      c({ po_tab: 'with' }), c({ po_tab: 'without' }),
      c({ po_tab: poTab, ship_tab: 'with' }), c({ po_tab: poTab, ship_tab: 'without' }),
    ]).then(([poWith, poWithout, shipWith, shipWithout]) => {
      if (alive) setCounts({ poWith, poWithout, shipWith, shipWithout });
    });
    return () => { alive = false; };
  }, [poTab, reloadKey]);

  // Auto-fit rows-per-page to the viewport so the pagination footer always sits
  // at the bottom of the screen without scrolling (mirrors the CLM Segment page).
  useEffect(() => {
    const recompute = () => {
      const el = scrollRef.current;
      if (!el) return;
      // On mobile the natural (scrolling) layout is correct — don't auto-fit or
      // stretch the card, which otherwise leaves a big empty gap.
      if (window.innerWidth <= 768) { setFillH(undefined); return; }
      const top = el.getBoundingClientRect().top;   // viewport-relative top of the table
      const THEAD = 44, ROW = 58, FOOTER = 96;        // header + reserve for the pager/footer
      const avail = window.innerHeight - top - THEAD - FOOTER;
      const fit = Math.max(4, Math.floor(avail / ROW));
      if (autoFitRef.current) setRpp(prev => (prev === fit ? prev : fit));
      // Stretch the list card down to the viewport bottom so the pager sits at the bottom.
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
  }, [poTab, shipTab, stepsOpen]);

  const totalRows = total;
  const pageCount = Math.max(1, Math.ceil(totalRows / rpp));
  const safePage = Math.min(page, pageCount);
  const start = (safePage - 1) * rpp;
  const pageRows = rows;

  const switchPo = (t: PoTab) => { setPoTab(t); setPage(1); setQ(''); setDebQ(''); };
  const switchShip = (t: ShipTab) => { setShipTab(t); setPage(1); };
  const onSearch = (v: string) => setQ(v);

  // The invoice whose Zoho-sync confirm + speedometer modal is open.
  const [sync, setSync] = useState<SyncState | null>(null);

  // Push THIS invoice's uploaded document to the linked PO's Zoho PO + Bill
  // attachment section (alongside the PO PDF). Available once the PO is synced but
  // before a payment exists — the bill/payment syncs queue this automatically, so
  // this button is the manual fallback for a PO synced before the invoice existed.
  const [attaching, setAttaching] = useState<number | null>(null);
  const syncAttachment = async (r: SpiRow) => {
    setMenu(null);
    if (!r.id || attaching) return;
    setAttaching(r.id);
    try {
      const res = await api.post(`/p2p/supplier-purchase-invoices/${r.id}/sync-attachment`);
      toast.success('Attachment synced', res?.data?.message ?? `${r.spiNo}'s document was attached to the Zoho purchase order.`);
      reload();
    } catch (e: any) {
      toast.error('Attachment sync failed', e?.response?.data?.message ?? 'Could not attach the invoice document to Zoho Books.');
    } finally {
      setAttaching(null);
    }
  };

  // Open the sync confirm dialog. Full utilisation is NOT required — payments are
  // synced separately (entry-wise). The bill-sync rules (TDS must be deducted;
  // With-PO invoices go through the linked PO, which enforces the PO's TDS cut)
  // are enforced by the backend, which returns a clear 422 the sync modal surfaces.
  const syncRow = (r: SpiRow) => {
    setMenu(null);
    setSync({ id: r.id, spiNo: r.spiNo, supplier: r.supplier, busy: false, progress: 0, attempt: 0, failed: false });
  };

  // Run the Zoho sync with a live speedometer. Zoho gives no real progress, so
  // the gauge eases toward ~90 while in flight and snaps to 100 on success. A
  // transient failure (network / 5xx) is retried up to MAX_ATTEMPTS; a business
  // error (4xx — e.g. "utilise the full amount") is not retried and surfaces a
  // "Try Again" button. A 409 (already syncing) is treated as success-ish.
  const SYNC_MAX_ATTEMPTS = 3;
  const doSync = () => {
    if (!sync) return;
    const { id, spiNo } = sync;

    const run = (attempt: number) => {
      setSync(s => (s ? { ...s, busy: true, failed: false, attempt, progress: 6 } : s));
      let p = 6;
      const timer = window.setInterval(() => {
        p = Math.min(90, p + Math.random() * 7 + 2);
        setSync(s => (s && s.busy ? { ...s, progress: Math.round(p) } : s));
      }, 380);

      api.post(`/p2p/supplier-purchase-invoices/${id}/sync`).then((res) => {
        window.clearInterval(timer);
        setSync(s => (s ? { ...s, progress: 100 } : s));
        window.setTimeout(() => {
          setSync(null);
          toast.success(`${spiNo} synced with Zohobook`, res?.data?.message);
          reload();
        }, 550);
      }).catch((e: any) => {
        window.clearInterval(timer);
        const status = e?.response?.status;
        // 409 = a sync for this invoice is already running — not a real failure.
        if (status === 409) {
          window.clearInterval(timer);
          setSync(null);
          toast.warning('Sync already in progress', e?.response?.data?.message ?? 'This invoice is already being synced — try again in a moment.');
          reload();
          return;
        }
        const retriable = !status || status >= 500; // network / server error only
        if (retriable && attempt < SYNC_MAX_ATTEMPTS) {
          toast.info(`Sync hiccup — retrying (${attempt}/${SYNC_MAX_ATTEMPTS})…`);
          setSync(s => (s ? { ...s, progress: 0 } : s));
          window.setTimeout(() => run(attempt + 1), 800);
        } else {
          const msg = e?.response?.data?.message;
          setSync(s => (s ? { ...s, busy: false, failed: true, progress: 0, errorMsg: msg } : s));
          toast.error('Sync failed', msg ?? 'Could not sync this invoice.');
        }
      });
    };

    toast.info(`Syncing ${spiNo} with Zohobook…`);
    run(1);
  };

  // Semicircular 0→100 gauge shown while an SPI syncs to Zohobook.
  const Speedometer = ({ value }: { value: number }) => {
    const v = Math.max(0, Math.min(100, value));
    const R = 52, cx = 60, cy = 58;
    const polar = (deg: number) => [cx + R * Math.cos((deg * Math.PI) / 180), cy + R * Math.sin((deg * Math.PI) / 180)] as const;
    const [sx, sy] = polar(180);
    const [ex, ey] = polar(180 + (v / 100) * 180);
    const [tx, ty] = polar(360);
    return (
      <div className="spisp">
        <svg viewBox="0 0 120 64" className="spisp-svg">
          <path d={`M ${sx} ${sy} A ${R} ${R} 0 0 1 ${tx} ${ty}`} className="spisp-track" />
          {v > 0.5 && <path d={`M ${sx} ${sy} A ${R} ${R} 0 0 1 ${ex} ${ey}`} className="spisp-fill" />}
        </svg>
        <div className="spisp-num">{Math.round(v)}<span>%</span></div>
      </div>
    );
  };

  // View / download the attachment by STREAMING it through the backend
  // (same-origin, works on the Azure-Blob server where a direct blob fetch is
  // CORS-blocked and the raw /storage path 404s). Same pattern the CLM/vault
  // downloads use — fetch the bytes via our authed endpoint, then open or save.
  const viewRow = async (r: SpiRow) => {
    if (!r.attach) { toast.info('View SPI', 'No attachment on this invoice.'); return; }
    try {
      const resp = await api.get('/p2p/supplier-purchase-invoices/download', { params: { path: r.attach, disposition: 'inline' }, responseType: 'blob' });
      const url = URL.createObjectURL(resp.data as Blob);
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch { toast.error('Could not open', 'Failed to open the attachment.'); }
  };
  const downloadRow = async (r: SpiRow) => {
    setMenu(null);
    if (!r.attach) { toast.info('Download SPI', 'No attachment on this invoice.'); return; }
    try {
      const resp = await api.get('/p2p/supplier-purchase-invoices/download', { params: { path: r.attach }, responseType: 'blob' });
      const url = URL.createObjectURL(resp.data as Blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = r.attach.split('/').pop() || `${r.spiNo}-attachment`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
    } catch { toast.error('Download failed', 'Could not download the attachment.'); }
  };

  // The detail wizard's mode comes from the Map modal choice (falls back to the active list tab).
  if (detailOpen) return <SpiDetail editId={editId ?? undefined} withPo={mapCtx ? mapCtx.mode === 'with' : withPo} poId={mapCtx?.mode === 'with' ? mapCtx.poId : undefined} supplierId={mapCtx?.mode === 'without' ? mapCtx.supplierId : undefined} onSaved={reload} onClose={() => { setDetailOpen(false); setMapCtx(null); setEditId(null); }} onChangeSelection={() => { setDetailOpen(false); setMapCtx(null); setEditId(null); setMapOpen(true); }} />;

  return (
    <div className="spi-root" ref={rootRef}>
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
      <div className="spi-card" style={{ minHeight: fillH }}>
        {/* Segment pills: With / Without PO. */}
        <div className="spi-segrow">
          <div className="spi-seg">
            <button type="button" className={`spi-seg-btn ${withPo ? 'is-active' : ''}`} onClick={() => switchPo('with')}>
              <span className="spi-seg-ico"><IcoLink size={15} /></span> With Purchase Order SPI
              <span className="spi-seg-c">{counts.poWith}</span>
            </button>
            <button type="button" className={`spi-seg-btn ${!withPo ? 'is-active' : ''}`} onClick={() => switchPo('without')}>
              <span className="spi-seg-ico"><IcoBox size={15} /></span> Without Purchase Order SPI (Direct SPI)
              <span className="spi-seg-c">{counts.poWithout}</span>
            </button>
          </div>
        </div>

        {/* Sub-tabs (With / Without Shipment ID) + search — shown for BOTH PO tabs:
            a Direct SPI can also be linked to a shipment (matches the design). */}
        <div className="spi-sub">
          <div className="spi-subtabs">
            <button type="button" className={`spi-subtab ${withShip ? 'is-active' : ''}`} onClick={() => switchShip('with')}>
              <IcoTruck /> With Shipment ID <span className="spi-subtab-c">{counts.shipWith}</span>
            </button>
            <button type="button" className={`spi-subtab ${!withShip ? 'is-active' : ''}`} onClick={() => switchShip('without')}>
              <IcoBox size={13} /> Without Shipment ID <span className="spi-subtab-c">{counts.shipWithout}</span>
            </button>
          </div>
          <div className="spi-search">
            <IcoSearch />
            <input value={q} onChange={e => onSearch(e.target.value)} placeholder="Search SPI, supplier, PO or status..." />
          </div>
        </div>

        {/* Table */}
        <div className="spi-tablewrap" ref={scrollRef}>
          <table className="spi-table">
            <thead>
              <tr>
                <th className="spi-c-sr">SR NO</th>
                <th>SPI NUMBER</th>
                {withPo && <th>PO NUMBER</th>}
                {withPo && <th>PO TYPE</th>}
                {showShipCols && <th>SHIPMENT ID</th>}
                {showShipCols && <th>PI NUMBER</th>}
                <th>PROCUREMENT ID</th>
                {showShipCols && <th>CUSTOMER NAME</th>}
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
              {loading ? (
                Array.from({ length: Math.max(3, Math.min(rpp, 10)) }).map((_, i) => (
                  <tr key={`sk-${i}`} className="spi-sk-row">
                    <td className="spi-c-sr"><span className="spi-sk-bar" style={{ width: 18 }} /></td>
                    <td><span className="spi-sk-bar" style={{ width: 96 }} /></td>
                    {withPo && <td><span className="spi-sk-bar" style={{ width: 84 }} /></td>}
                    {withPo && <td><span className="spi-sk-bar" style={{ width: 88 }} /></td>}
                    {showShipCols && <td><span className="spi-sk-bar" style={{ width: 58 }} /></td>}
                    {showShipCols && <td><span className="spi-sk-bar" style={{ width: 68 }} /></td>}
                    <td><span className="spi-sk-bar" style={{ width: 40 }} /></td>
                    {showShipCols && <td><span className="spi-sk-bar" style={{ width: 78 }} /></td>}
                    <td><span className="spi-sk-bar" style={{ width: 120 }} /></td>
                    <td className="spi-c-r"><span className="spi-sk-bar" style={{ width: 72, marginLeft: 'auto' }} /></td>
                    <td className="spi-c-r"><span className="spi-sk-bar" style={{ width: 72, marginLeft: 'auto' }} /></td>
                    <td className="spi-c-r"><span className="spi-sk-bar" style={{ width: 48, marginLeft: 'auto' }} /></td>
                    <td className="spi-c-r"><span className="spi-sk-bar" style={{ width: 72, marginLeft: 'auto' }} /></td>
                    <td><span className="spi-sk-bar" style={{ width: 104 }} /></td>
                    <td className="spi-c-c"><span className="spi-sk-bar" style={{ width: 72, margin: '0 auto' }} /></td>
                    <td className="spi-c-c"><span className="spi-sk-bar" style={{ width: 130, margin: '0 auto' }} /></td>
                  </tr>
                ))
              ) : pageRows.length === 0 ? (
                <tr><td colSpan={16}>
                  <div className="spi-empty"><div className="spi-empty-t">No supplier invoices found</div><div className="spi-empty-s">Map a supplier invoice to get started, or try a different search.</div></div>
                </td></tr>
              ) : pageRows.map((r, i) => (
                <tr key={r.id}>
                  <td className="spi-c-sr"><span className="spi-sr">{start + i + 1}</span></td>
                  <td>
                    <span className="spi-idstack"><span className="spi-pill spi-pill-spi">{r.spiNo}</span><span className="spi-date-sub">{r.spiDate ? formatDmy(r.spiDate) : ''}</span></span>
                  </td>
                  {withPo && <td><span className="spi-idstack"><span className="spi-pill spi-pill-po">{r.poNo}</span><span className="spi-date-sub">{r.poDate ? formatDmy(r.poDate) : ''}</span></span></td>}
                  {withPo && <td>{r.poType}</td>}
                  {showShipCols && <td><span className="spi-pill spi-pill-shp">{r.shipId}</span></td>}
                  {showShipCols && <td><span className="spi-pill spi-pill-pi">{r.piNo}</span></td>}
                  <td><span className="spi-pill spi-pill-proc">{r.procId}</span></td>
                  {showShipCols && <td>{r.customer}</td>}
                  <td><Tooltip label={r.supplier} disabled={!r.supplier || r.supplier.length <= 25} position="bottom" zIndex={2999999}><span>{r.supplier && r.supplier.length > 25 ? r.supplier.slice(0, 25) + '…' : r.supplier}</span></Tooltip></td>
                  <td className="spi-c-r spi-amt">{inr(r.totalPo)}</td>
                  <td className="spi-c-r spi-amt">{inr(r.netPayable)}</td>
                  <td className="spi-c-r spi-amt">{inr(r.totalPaid)}</td>
                  <td className="spi-c-r spi-amt">{inr(r.balance)}</td>
                  <td>{r.attach ? <Tooltip label={`View ${r.attach.split('/').pop()}`} position="bottom" zIndex={2999999}><button type="button" className="spi-attach" onClick={() => void viewRow(r)}><IcoClip /><span className="spi-attach-name">{r.attach.split('/').pop()}</span></button></Tooltip> : <span className="spi-date-sub">—</span>}</td>
                  <td className="spi-c-c">
                    <span className={`spi-zb ${r.zoho === 'sync' ? 'spi-zb-sync' : 'spi-zb-not'}`}><span className="spi-zb-dot" />{r.zoho === 'sync' ? 'Sync' : 'Not Sync'}</span>
                  </td>
                  <td className="spi-c-c">
                    <span className="spi-acts">
                      {r.zoho === 'sync'
                        ? <Tooltip label="Already synced to Zohobook"><button type="button" className="spi-zohobtn is-synced"><IcoSync size={13} /> Synced</button></Tooltip>
                        : <Tooltip label={withPo ? 'Sync the linked PO — creates its bill and posts all payments' : 'Sync this invoice to Zohobook'}><button type="button" className="spi-zohobtn" onClick={() => syncRow(r)}><IcoSync size={13} /> Zoho Sync</button></Tooltip>}
                      {/* Invoice synced (bill exists) with a file not yet in Zoho → offer to push it.
                          With-PO attaches to the PO + bill; Direct attaches to its own bill. */}
                      {r.zoho === 'sync' && !!r.attach && !r.docAttached && (
                        <Tooltip label={withPo ? "Attach this invoice's document to the Zoho purchase order & bill" : "Attach this invoice's document to the Zoho bill"}>
                          <button type="button" className="spi-zohobtn" disabled={attaching === r.id} onClick={() => void syncAttachment(r)}>
                            <IcoClip /> {attaching === r.id ? 'Attaching…' : 'Sync Attachment'}
                          </button>
                        </Tooltip>
                      )}
                      <Tooltip label="View invoice"><button type="button" className="spi-iconbtn" onClick={() => { setEditId(r.id); setMapCtx(null); setDetailOpen(true); }}><IcoEye /></button></Tooltip>
                      <Tooltip label="Record payment"><button type="button" className="spi-iconbtn" onClick={() => openPoPayment(r)}><IcoRupee /></button></Tooltip>
                      <Tooltip label="More actions"><button type="button" className="spi-iconbtn" onClick={e => openMenu(e, r)}><IcoMore /></button></Tooltip>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination with a Rows-per-page selector (5 / 10 / 15) */}
        <WorklistPager
          total={totalRows}
          page={safePage}
          pageSize={rpp}
          onPage={setPage}
          onPageSize={n => { autoFitRef.current = false; setRpp(n); setPage(1); }}
          pageSizeOptions={[5, 10, 15]}
        />
      </div>

      {mapOpen && <MapSupplierPurchaseInvoiceModal onClose={() => setMapOpen(false)} onConfirm={(payload) => { setMapCtx(payload); setMapOpen(false); setDetailOpen(true); }} />}

      {/* Payment Summary Against PO — pays the SPI's LINKED PO (amount subtracts
          from the PO balance, never a separate SPI amount). spiId traces the
          entry point. */}
      <PoPaymentModal
        open={!!payRow}
        poId={payRow?.poId ?? null}
        spiId={payRow?.id ?? null}
        onClose={() => setPayRow(null)}
        onChanged={reload}
      />

      {/* ── More Actions dropdown (3-dot) ── */}
      {menu && createPortal(
        <div className="spi-menu-backdrop" onMouseDown={() => setMenu(null)}>
          <div className="spi-menu" style={{ top: menu.y, left: Math.max(8, menu.x - 280) }} onMouseDown={e => e.stopPropagation()}>
            <div className="spi-menu-head">
              <div className="spi-menu-head-l"><span className="spi-menu-head-ico"><IcoMore /></span> More Actions</div>
              <button type="button" className="spi-menu-x" onClick={() => setMenu(null)}><IcoX /></button>
            </div>
            <div className="spi-menu-info">
              <span className="spi-pill spi-pill-spi">{menu.row.spiNo}</span>
              <div className="spi-menu-sup">Supplier: <Tooltip label={menu.row.supplier} disabled={!menu.row.supplier || menu.row.supplier.length <= 25} position="bottom" zIndex={2999999}><span>{menu.row.supplier}</span></Tooltip></div>
            </div>
            <div className="spi-menu-items">
              <button type="button" className="spi-menu-item is-teal" onClick={() => syncRow(menu.row)}><span className="spi-menu-item-ico"><IcoSync size={15} /></span> Sync with Zohobook</button>
              <button type="button" className="spi-menu-item" onClick={() => void downloadRow(menu.row)}><span className="spi-menu-item-ico spi-menu-item-ico-dl"><IcoDownload /></span> Download SPI</button>
              <button type="button" className="spi-menu-item" onClick={() => { const row = menu.row; setMenu(null); openPoPayment(row); }}><span className="spi-menu-item-ico spi-menu-item-ico-pay"><IcoCard /></span> SPI Payment</button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {/* ── ZOHO SYNC CONFIRM + SPEEDOMETER ──────────────────────────── */}
      {sync && (
        <div className="spicfm-overlay is-open" onClick={e => { if (e.target === e.currentTarget && !sync.busy) setSync(null); }}>
          <div className="spicfm-card" role="dialog" aria-modal="true">
            <div className="spicfm-bd">
              {sync.busy ? (
                <>
                  <Speedometer value={sync.progress} />
                  <div className="spicfm-t">Syncing with Zohobook…</div>
                  <div className="spicfm-msg">{sync.attempt > 1
                    ? `Retry attempt ${sync.attempt} of ${SYNC_MAX_ATTEMPTS} — hang tight.`
                    : 'Posting the supplier invoice, bill and payments to your Zohobook account.'}</div>
                </>
              ) : (
                <>
                  <div className={`spicfm-ico${sync.failed ? ' spicfm-ico--fail' : ''}`}><IcoSync size={26} /></div>
                  <div className="spicfm-t">{sync.failed ? 'Sync failed' : 'Sync with Zohobook?'}</div>
                  <div className="spicfm-msg">{sync.failed
                    ? (sync.errorMsg || 'Something went wrong pushing this invoice to Zohobook. You can try again.')
                    : 'This will post the approved invoice, its bill and payments to your Zohobook account and update its sync status.'}</div>
                </>
              )}
              <div className="spicfm-chip"><span className="spi">{sync.spiNo}</span>{sync.supplier && (
                <Tooltip label={sync.supplier} disabled={sync.supplier.length <= 30} position="bottom" zIndex={2999999}>
                  <span className="sup">· {sync.supplier.length > 30 ? `${sync.supplier.slice(0, 30)}…` : sync.supplier}</span>
                </Tooltip>
              )}</div>
            </div>
            {!sync.busy && (
              <div className="spicfm-actions">
                <button type="button" className="spicfm-btn spicfm-btn--ghost" onClick={() => setSync(null)}>{sync.failed ? 'Close' : 'Cancel'}</button>
                <button type="button" className="spicfm-btn spicfm-btn--go" onClick={doSync}>
                  {sync.failed ? 'Try Again' : 'Yes, Sync'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Inline icons (teal SVGs, no icon library) ── */
function IcoDoc({ size = 15 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/></svg>; }
function IcoLink({ size = 14 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>; }
function IcoBox({ size = 14 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>; }
function IcoCard() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>; }
function IcoSync({ size = 14 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>; }
function IcoTruck() { return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.62l-3.48-4.35A1 1 0 0 0 17.52 8H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/></svg>; }
function IcoSearch() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>; }
function IcoChevron() { return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>; }
function IcoClip() { return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>; }
function IcoEdit() { return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>; }
function IcoEye() { return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>; }
function IcoRupee() { return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 3h12M6 8h12M6 13l8.5 8M6 8c9 0 9 5 0 5"/></svg>; }
function IcoMore() { return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><circle cx="12" cy="5" r="1" fill="currentColor"/><circle cx="12" cy="12" r="1" fill="currentColor"/><circle cx="12" cy="19" r="1" fill="currentColor"/></svg>; }
function IcoX() { return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>; }
function IcoDownload() { return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>; }
