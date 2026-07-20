import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import api from '../../api';
import WorklistPager from '../../components/ui/WorklistPager';
import Tooltip from '../../components/ui/Tooltip';
import { useToast } from '../../contexts/ToastContext';
import './shipment-360.css';

/* ────────────────────────────────────────────────────────────────────────────
 * Shipment 360 (route /developers/shipment — the slug stays 'developers' so
 * existing permission grants survive the rename from the old "Dev Tools").
 *
 * Faithful port of the IDIMS "Shipment 360" prototype: teal header strip, the
 * collapsible 6-step "What We Are Doing Here" box, and an International /
 * Domestic tabbed worklist over the wide shipment-journey table.
 *
 * DATA — GET /sales/shipment-orders. The prototype's table is much wider than
 * that payload, so every column the API does not carry renders as an em-dash
 * placeholder rather than inventing data. Columns backed by real fields:
 * Shipment ID, Opportunity ID, PI Number, Customer, Consignee,
 * Shipping Liability, Cold Chain, Hazardous, INCO Term, Port of Loading /
 * Discharge (international) and Dispatch From / Deliver To (domestic).
 *
 * DOMESTIC vs INTERNATIONAL — the API stamps every row with is_domestic /
 * doc_type (derived from the PI's doc_type) and issues DSHP- codes for
 * domestic shipments vs SHP- for exports, each with its own per-branch
 * sequence (ShipmentOrderController::nextShipmentCode). The two tabs split
 * the same payload on that flag.
 * ──────────────────────────────────────────────────────────────────────────── */

type ShipmentRow = {
  id: number;
  shipment_code: string | null;
  created_at: string | null;
  opp_code: string | null;
  opp_date: string | null;
  customer_name: string | null;
  consignee_name: string | null;
  pi_no: string | null;
  pi_date: string | null;
  shipping_liability: string | null;
  cold_chain: boolean;
  /* Derived server-side from the PI's products: true when ANY product is
   * flagged Haz, false when all are Non-Haz, null when the PI has no
   * products to judge by. */
  hazardous: boolean | null;
  /* Flow flag — true for DSHP- (domestic) rows, false for SHP- (export). */
  is_domestic?: boolean;
  doc_type?: string | null;
  // International-only
  inco_term: string | null;
  port_of_loading: string | null;
  port_of_unloading: string | null;
  // Domestic-only
  place_of_dispatch?: string | null;
  place_of_delivery?: string | null;
};

type S360Tab = 'intl' | 'dom';

/* Starting rows-per-page; the auto-fit effect overrides it on first paint to
   whatever fills the viewport, unless the user picks a size by hand. */
const PAGE_SIZE = 10;

/* "15 Mar 2026" — the prototype's date format. */
const S360_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmtDate(s: string | null): string {
  if (!s) return '—';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return '—';
  return `${String(d.getDate()).padStart(2, '0')} ${S360_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/* ── Inline icons ─────────────────────────────────────────────────────────── */
const Ico = {
  route: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="5.5" cy="18.5" r="2.5" /><path d="M8 18.5h7a4 4 0 0 0 0-8H8a4 4 0 0 1 0-8h6" /><circle cx="18.5" cy="5.5" r="2.5" />
    </svg>
  ),
  download: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  ),
  truck: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1" y="3" width="15" height="13" /><polygon points="16 8 20 8 23 11 23 16 16 16 16 8" /><circle cx="5.5" cy="18.5" r="2.5" /><circle cx="18.5" cy="18.5" r="2.5" />
    </svg>
  ),
  globe: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  ),
  home: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  ),
  search: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  ),
  chevDown: (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  ),
  dots: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
      <circle cx="12" cy="5" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="12" cy="19" r="1.6" />
    </svg>
  ),
};

/* The 6 lifecycle steps of the "What We Are Doing Here" box. */
const STEPS: { n: string; ico: ReactNode; title: string; desc: string }[] = [
  {
    n: 'Step 01',
    ico: <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" /><rect x="9" y="3" width="6" height="4" rx="1" /><path d="m9 14 2 2 4-4" /></svg>,
    title: 'Sales Order Management',
    desc: 'Capture customer orders, quotations, contracts, and confirm shipments.',
  },
  {
    n: 'Step 02',
    ico: <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>,
    title: 'Procurement & Supplier Management',
    desc: 'Procure products through supplier selection, Purchase Orders, GRNs, and invoice validation.',
  },
  {
    n: 'Step 03',
    ico: <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /><polyline points="3.27 6.96 12 12.01 20.73 6.96" /><line x1="12" y1="22.08" x2="12" y2="12" /></svg>,
    title: 'Inventory & Quality Management',
    desc: 'Receive, inspect, approve, and prepare inventory for shipment.',
  },
  {
    n: 'Step 04',
    ico: <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></svg>,
    title: 'Shipment Planning & Documentation',
    desc: 'Plan shipments, packaging, schedules, and generate shipping and customs documents.',
  },
  {
    n: 'Step 05',
    ico: <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="3" width="15" height="13" /><polygon points="16 8 20 8 23 11 23 16 16 16 16 8" /><circle cx="5.5" cy="18.5" r="2.5" /><circle cx="18.5" cy="18.5" r="2.5" /></svg>,
    title: 'Logistics & Customs Execution',
    desc: 'Manage transportation, customs clearance, and real-time shipment movement.',
  },
  {
    n: 'Step 06',
    ico: <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 12 11 14 15 10" /></svg>,
    title: 'Delivery & Customer Fulfillment',
    desc: 'Complete delivery, capture proof of delivery, and close customer fulfillment.',
  },
];

/* ── Small cell builders (mirror the prototype's idc / txt / yn helpers) ──── */

/* Stacked ID pill over its date. */
function IdCell({ id, date, primary }: { id?: string | null; date?: string | null; primary?: boolean }) {
  if (!id) return <td><span className="rvtbl-dash">—</span></td>;
  return (
    <td>
      <div className="rvtbl-idcell">
        <span className={`s360-pill${primary ? ' is-primary' : ''}`}>{id}</span>
        <span className="rvtbl-iddate">{date ? fmtDate(date) : '—'}</span>
      </div>
    </td>
  );
}

/* INCO terms are stored/served as "FOB – Free On Board"; the column is narrow
 * and the code alone is what the desk reads, so keep just the code. The full
 * text still goes to the tooltip and the Excel export. */
function incoCode(v?: string | null): string {
  return String(v ?? '').split(/[–—-]/)[0].trim().split(/\s+/)[0] || '';
}

/* A column the API doesn't carry yet — rendered as an em-dash, never faked. */
function EmptyCell() {
  return <td><span className="rvtbl-dash">—</span></td>;
}

/* Truncated-text cell (2-line clamp, 100px cap) — the full value shows on the
 * shared themed Tooltip (same pill as the Lead Acknowledgement master's list),
 * replacing the old browser-native title bubble. */
function TxtCell({ v }: { v: string | null }) {
  const val = v ?? '—';
  return (
    <td className="rvtbl-txt">
      <Tooltip label={val} themed maxWidth={360} disabled={!v}>
        <span className="rvtbl-clip">{val}</span>
      </Tooltip>
    </td>
  );
}

function YnCell({ yes, warn }: { yes: boolean; warn?: boolean }) {
  return (
    <td>
      <span className={`s360-yn ${yes ? (warn ? 'is-warn' : 'is-yes') : 'is-no'}`}>{yes ? 'Yes' : 'No'}</span>
    </td>
  );
}

export default function DeveloperShipments() {
  const toast = useToast();
  const [tab, setTab] = useState<S360Tab>('intl');
  const [rows, setRows] = useState<ShipmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [rpp, setRpp] = useState(PAGE_SIZE);
  const [brefCollapsed, setBrefCollapsed] = useState(true);
  const [exporting, setExporting] = useState(false);

  // ── Auto-fit rows-per-page to the viewport so the pagination footer always
  // sits at the bottom of the screen without scrolling (mirrors the SPI / Debit
  // Note lists). Turns itself off as soon as the user picks a size by hand. ──
  const scrollRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const autoFitRef = useRef(true);
  const [fillH, setFillH] = useState<number | undefined>(undefined); // stretch the card to the viewport

  useEffect(() => {
    const recompute = () => {
      const el = scrollRef.current;
      if (!el) return;
      // Below the tablet breakpoint the page scrolls normally — a stretched
      // card and a forced row count would both fight the small viewport.
      if (window.innerWidth <= 768) { setFillH(undefined); return; }
      const THEAD = 46, ROW = 40, FOOTER = 96;
      const avail = window.innerHeight - el.getBoundingClientRect().top - THEAD - FOOTER;
      const fit = Math.max(4, Math.floor(avail / ROW));
      if (autoFitRef.current) setRpp(prev => (prev === fit ? prev : fit));
      // Stretch the list card down to just above Velzon's 60px fixed footer.
      const card = listRef.current;
      if (card) {
        const fh = Math.max(240, window.innerHeight - card.getBoundingClientRect().top - 68);
        setFillH(prev => (prev === fh ? prev : fh));
      }
    };
    recompute();
    const raf = requestAnimationFrame(recompute);
    let settle: ReturnType<typeof setTimeout> | null = null;
    const debounced = () => { if (settle) clearTimeout(settle); settle = setTimeout(recompute, 140); };
    window.addEventListener('resize', debounced);
    return () => {
      if (settle) clearTimeout(settle);
      window.removeEventListener('resize', debounced);
      cancelAnimationFrame(raf);
    };
    // Collapsing/expanding the bref box moves the table, so refit on that too.
  }, [brefCollapsed, tab]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api.get<{ status: boolean; data: ShipmentRow[] }>('/sales/shipment-orders')
      .then(r => { if (alive) setRows(r.data?.data ?? []); })
      .catch(() => { if (alive) toast.error('Load failed', 'Could not load shipment orders.'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [toast]);

  /* Split by flow — is_domestic is stamped by the API (from the PI's
   * doc_type); the DSHP- code prefix is the fallback for any payload
   * that predates the flag. Each tab lists ONLY its own flow, so a
   * DSHP- id can never appear under International or vice versa. */
  const isDom = (r: ShipmentRow) => r.is_domestic ?? !!r.shipment_code?.toUpperCase().startsWith('DSHP');
  const intlRows = useMemo(() => rows.filter(r => !isDom(r)), [rows]);
  const domRows  = useMemo(() => rows.filter(r =>  isDom(r)), [rows]);

  const filtered = useMemo(() => {
    const base = tab === 'dom' ? domRows : intlRows;
    const lo = q.trim().toLowerCase();
    if (!lo) return base;
    return base.filter(r =>
      [r.shipment_code, r.opp_code, r.customer_name, r.consignee_name, r.pi_no,
        r.inco_term, r.port_of_loading, r.port_of_unloading, r.shipping_liability,
        r.place_of_dispatch, r.place_of_delivery]
        .some(v => (v ?? '').toLowerCase().includes(lo)),
    );
  }, [intlRows, domRows, tab, q]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / rpp));
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice((safePage - 1) * rpp, safePage * rpp);
  const startIdx = filtered.length === 0 ? 0 : (safePage - 1) * rpp + 1;

  const switchTab = (t: S360Tab) => { setTab(t); setQ(''); setPage(1); };

  /* Export the ACTIVE tab's list — only the columns the API actually carries.
   * Domestic swaps the export-only block (INCO/ports) for Dispatch/Deliver. */
  const exportShipments = () => {
    if (!filtered.length) { toast.error('Nothing to export', 'No shipments match the current search.'); return; }
    setExporting(true);
    try {
      const data = filtered.map((r, i) => ({
        'Sr No': i + 1,
        'Shipment ID': r.shipment_code ?? '',
        'Shipment Date': fmtDate(r.created_at),
        'Type': tab === 'dom' ? 'Domestic' : 'International',
        'Opportunity ID': r.opp_code ?? '',
        'Opportunity Date': fmtDate(r.opp_date),
        'PI Number': r.pi_no ?? '',
        'PI Date': fmtDate(r.pi_date),
        'Customer': r.customer_name ?? '',
        'Consignee': r.consignee_name ?? '',
        'Shipping Liability': r.shipping_liability ?? '',
        'Cold Chain': r.cold_chain ? 'Yes' : 'No',
        'Hazardous': r.hazardous == null ? '' : (r.hazardous ? 'Yes' : 'No'),
        ...(tab === 'dom'
          ? {
              'Dispatch From': r.place_of_dispatch ?? '',
              'Deliver To':    r.place_of_delivery ?? '',
            }
          : {
              'INCO Term': r.inco_term ?? '',
              'Port of Loading': r.port_of_loading ?? '',
              'Port of Discharge': r.port_of_unloading ?? '',
            }),
      }));
      const ws = XLSX.utils.json_to_sheet(data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Shipment 360');
      const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      saveAs(new Blob([buf]), `Shipment_360_${new Date().toISOString().slice(0, 10)}.xlsx`);
      toast.success('Exported', `${filtered.length} shipment${filtered.length !== 1 ? 's' : ''} exported to Excel`);
    } catch {
      toast.error('Export Failed', 'Could not export shipment details');
    } finally {
      setExporting(false);
    }
  };

  // Full column counts, Sr No + Action inclusive — used for the empty/loading colSpan.
  const INTL_COLS = 27;
  const DOM_COLS = 23;

  return (
    <div className="s360m">
      {/* ── Header strip ── */}
      <div className="cstrip cstrip--teal">
        <span className="cstrip__accent" /><span className="cstrip__glow" /><span className="cstrip__sheen" />
        <div className="cstrip__left">
          <div className="cstrip__avatar-wrap">
            <div className="cstrip__avatar">{Ico.route}</div>
            <span className="cstrip__online-dot" />
          </div>
          <div>
            <div className="cstrip__title">Shipment 360</div>
            <div className="cstrip__sub">
              Track the end-to-end shipment journey — from order and dispatch through customs, transit, and final delivery — in one unified 360° view.
            </div>
          </div>
        </div>
        <div className="cstrip__right">
          <button type="button" className="cstrip__action-btn" onClick={exportShipments} disabled={exporting || loading}>
            <span className="cstrip__action-btn-sheen" />
            {Ico.download}
            {exporting ? 'Exporting…' : 'Export Shipment Details'}
          </button>
        </div>
      </div>

      {/* ── "What We Are Doing Here" ── */}
      <div className={`bref-box bref-box--teal${brefCollapsed ? ' is-collapsed' : ''}`}>
        <button type="button" className="bref-box__header" onClick={() => setBrefCollapsed(c => !c)}>
          <div className="bref-box__header-ico">{Ico.truck}</div>
          <div className="bref-box__header-mid">
            <div className="bref-box__header-row">
              <div className="bref-box__header-label">Shipment Management</div>
              <div className="bref-box__header-sep" />
              <div className="bref-box__header-title">What We Are Doing Here</div>
            </div>
            <div className="bref-box__header-sub">
              Manage the complete shipment lifecycle from customer order to final delivery through integrated sales, procurement, inventory, logistics, documentation, and compliance.
            </div>
          </div>
          <div className="bref-box__header-right">
            <div className="bref-box__toggle">{Ico.chevDown}</div>
          </div>
        </button>
        <div className="bref-box__body">
          {STEPS.map(s => (
            <div className="bref-item" key={s.n}>
              <div className="bref-item__top">
                <div className="bref-item__ico">{s.ico}</div>
                <span className="bref-item__num">{s.n}</span>
              </div>
              <div className="bref-item__title">{s.title}</div>
              <div className="bref-item__desc">{s.desc}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Worklist ── */}
      <div className="s360-list" ref={listRef} style={fillH ? { height: fillH } : undefined}>
        <div className="s360-toolbar">
          <div className="s360-tabs">
            <button type="button" className={`s360-tab${tab === 'intl' ? ' is-active' : ''}`} onClick={() => switchTab('intl')}>
              {Ico.globe}International Shipments <span className="s360-tab__cnt">{intlRows.length}</span>
            </button>
            <button type="button" className={`s360-tab${tab === 'dom' ? ' is-active' : ''}`} onClick={() => switchTab('dom')}>
              {Ico.home}Domestic Shipments <span className="s360-tab__cnt">{domRows.length}</span>
            </button>
          </div>
          <div className="s360-search">
            {Ico.search}
            <input
              type="text"
              value={q}
              onChange={e => { setQ(e.target.value); setPage(1); }}
              placeholder="Search shipment ID, customer, route, status..."
            />
          </div>
        </div>

        {/* ── International ── */}
        {tab === 'intl' && (
          <div className="s360-panel">
            <div className="rvtbl-wrap" ref={scrollRef}>
              <table className="rvtbl">
                <thead>
                  <tr>
                    <th className="rvtbl-sr">Sr.<br />No</th>
                    <th>Shipment<br />ID</th>
                    <th>Opportunity<br />ID</th>
                    <th>Procurement<br />ID</th>
                    <th>GRN<br />ID</th>
                    <th>QA<br />ID</th>
                    <th>Remittance<br />ID</th>
                    <th>FIRC</th>
                    <th>Export<br />Invoice</th>
                    <th>Outward<br />ID</th>
                    <th>PSD<br />ID</th>
                    <th>e-BRC<br />ID</th>
                    <th>PI<br />Number</th>
                    <th>PO<br />Number</th>
                    <th>SPI<br />Number</th>
                    <th>FFD PO<br />Number</th>
                    <th>Customer</th>
                    <th>Consignee</th>
                    <th>Supplier</th>
                    <th>FFD /<br />Transporter</th>
                    <th>Shipping<br />Liability</th>
                    <th>Cold<br />Chain</th>
                    <th>Hazardous</th>
                    <th>INCO<br />Term</th>
                    <th>Port of<br />Loading</th>
                    <th>Port of<br />Discharge</th>
                    <th className="rvtbl-actcell">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {loading && <tr><td colSpan={INTL_COLS} className="rvtbl-empty">Loading shipment orders…</td></tr>}
                  {!loading && pageRows.length === 0 && (
                    <tr><td colSpan={INTL_COLS} className="rvtbl-empty">No shipment orders found.</td></tr>
                  )}
                  {!loading && pageRows.map((r, i) => (
                    <tr className="rvtbl-row" key={r.id}>
                      <td className="rvtbl-sr">{startIdx + i}</td>
                      <IdCell id={r.shipment_code} date={r.created_at} primary />
                      <IdCell id={r.opp_code} date={r.opp_date} />
                      <EmptyCell /> {/* Procurement ID */}
                      <EmptyCell /> {/* GRN ID */}
                      <EmptyCell /> {/* QA ID */}
                      <EmptyCell /> {/* Remittance ID */}
                      <EmptyCell /> {/* FIRC */}
                      <EmptyCell /> {/* Export Invoice */}
                      <EmptyCell /> {/* Outward ID */}
                      <EmptyCell /> {/* PSD ID */}
                      <EmptyCell /> {/* e-BRC ID */}
                      <IdCell id={r.pi_no} date={r.pi_date} />
                      <EmptyCell /> {/* PO Number */}
                      <EmptyCell /> {/* SPI Number */}
                      <EmptyCell /> {/* FFD PO Number */}
                      <TxtCell v={r.customer_name} />
                      <TxtCell v={r.consignee_name} />
                      <EmptyCell /> {/* Supplier */}
                      <EmptyCell /> {/* FFD / Transporter */}
                      {r.shipping_liability
                        ? <td><span className="s360-tag">{r.shipping_liability}</span></td>
                        : <EmptyCell />}
                      <YnCell yes={r.cold_chain} />
                      {r.hazardous === null || r.hazardous === undefined
                        ? <EmptyCell /> /* PI has no products to judge by */
                        : <YnCell yes={r.hazardous} warn />}
                      {incoCode(r.inco_term)
                        ? (
                          <td>
                            <Tooltip label={r.inco_term ?? ''} themed maxWidth={320}>
                              <span className="s360-tag is-inco">{incoCode(r.inco_term)}</span>
                            </Tooltip>
                          </td>
                        )
                        : <EmptyCell />}
                      <td className="s360-port">{r.port_of_loading ?? '—'}</td>
                      <td className="s360-port">{r.port_of_unloading ?? '—'}</td>
                      <td className="rvtbl-actcell">
                        <div className="rvtbl-act">
                          <Tooltip label="More actions" themed>
                            <button
                              type="button"
                              className="rvtbl-actbtn"
                              aria-label="More actions"
                              onClick={() => toast.info('Development in progress', 'This action is not available yet.')}
                            >{Ico.dots}</button>
                          </Tooltip>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!loading && (
              <WorklistPager
                total={filtered.length}
                page={safePage}
                pageSize={rpp}
                onPage={setPage}
                onPageSize={n => { autoFitRef.current = false; setRpp(n); setPage(1); }}
                pageSizeOptions={[5, 10, 15, 25, 50]}
              />
            )}
          </div>
        )}

        {/* ── Domestic — DSHP- rows (is_domestic, from the PI's doc_type).
            Same journey table, with the domestic logistics columns
            (Dispatch From / Deliver To) in place of INCO/ports. ── */}
        {tab === 'dom' && (
          <div className="s360-panel">
            <div className="rvtbl-wrap" ref={scrollRef}>
              <table className="rvtbl">
                <thead>
                  <tr>
                    <th className="rvtbl-sr">Sr.<br />No</th>
                    <th>Domestic<br />Shipment ID</th>
                    <th>Opportunity<br />ID</th>
                    <th>Procurement<br />ID</th>
                    <th>GRN<br />ID</th>
                    <th>QA<br />ID</th>
                    <th>Domestic<br />Receipt No.</th>
                    <th>Domestic<br />GST Invoice</th>
                    <th>Outward<br />ID</th>
                    <th>PSD<br />ID</th>
                    <th>e-BRC<br />ID</th>
                    <th>PI<br />Number</th>
                    <th>PO<br />Number</th>
                    <th>SPI<br />Number</th>
                    <th>FFD PO<br />Number</th>
                    <th>Customer</th>
                    <th>Consignee</th>
                    <th>Supplier</th>
                    <th>FFD /<br />Transporter</th>
                    <th>Cold<br />Chain</th>
                    <th>Dispatch<br />From</th>
                    <th>Deliver<br />To</th>
                    <th className="rvtbl-actcell">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {loading && <tr><td colSpan={DOM_COLS} className="rvtbl-empty">Loading shipment orders…</td></tr>}
                  {!loading && pageRows.length === 0 && (
                    <tr>
                      <td colSpan={DOM_COLS} className="rvtbl-empty">
                        No domestic shipments. Domestic (DSHP) shipments are raised from a Domestic Proforma Invoice.
                      </td>
                    </tr>
                  )}
                  {!loading && pageRows.map((r, i) => (
                    <tr className="rvtbl-row" key={r.id}>
                      <td className="rvtbl-sr">{startIdx + i}</td>
                      <IdCell id={r.shipment_code} date={r.created_at} primary />
                      <IdCell id={r.opp_code} date={r.opp_date} />
                      <EmptyCell /> {/* Procurement ID */}
                      <EmptyCell /> {/* GRN ID */}
                      <EmptyCell /> {/* QA ID */}
                      <EmptyCell /> {/* Domestic Receipt No. */}
                      <EmptyCell /> {/* Domestic GST Invoice */}
                      <EmptyCell /> {/* Outward ID */}
                      <EmptyCell /> {/* PSD ID */}
                      <EmptyCell /> {/* e-BRC ID */}
                      <IdCell id={r.pi_no} date={r.pi_date} />
                      <EmptyCell /> {/* PO Number */}
                      <EmptyCell /> {/* SPI Number */}
                      <EmptyCell /> {/* FFD PO Number */}
                      <TxtCell v={r.customer_name} />
                      <TxtCell v={r.consignee_name} />
                      <EmptyCell /> {/* Supplier */}
                      <EmptyCell /> {/* FFD / Transporter */}
                      <YnCell yes={r.cold_chain} />
                      <td className="s360-port">{r.place_of_dispatch ?? '—'}</td>
                      <td className="s360-port">{r.place_of_delivery ?? '—'}</td>
                      <td className="rvtbl-actcell">
                        <div className="rvtbl-act">
                          <Tooltip label="More actions" themed>
                            <button
                              type="button"
                              className="rvtbl-actbtn"
                              aria-label="More actions"
                              onClick={() => toast.info('Development in progress', 'This action is not available yet.')}
                            >{Ico.dots}</button>
                          </Tooltip>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!loading && (
              <WorklistPager
                total={filtered.length}
                page={safePage}
                pageSize={rpp}
                onPage={setPage}
                onPageSize={n => { autoFitRef.current = false; setRpp(n); setPage(1); }}
                pageSizeOptions={[5, 10, 15, 25, 50]}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
