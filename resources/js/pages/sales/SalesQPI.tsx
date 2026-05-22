import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import api from '../../api';
import { useToast } from '../../contexts/ToastContext';
import Tooltip from '../../components/ui/Tooltip';

/* ────────────────────────────────────────────────────────────────────────────
 * Sales Matrix → Quotations V/S Proforma Invoice (QPI)
 *
 * Faithful port of the prototype's `#qpiPage`. Purple-palette page with a
 * Quotation / Proforma Invoice tab switch, a 4-step "What We Are Doing Here"
 * stepper, list cards per tab (Quotation table; PI sub-tabs With/Without
 * Shipment), and two multi-step Create modals (Create Quotation, Create PI).
 *
 * Data is mock for now; the dataset mirrors the screenshots from the
 * SalesMatrix_v4_9 prototype.
 * ──────────────────────────────────────────────────────────────────────── */

type QPITab = 'quotation' | 'pi';
type PISubTab = 'with' | 'without';

type Quotation = {
  qtNo: string;        // QT/2026-27/3
  qtDate: string;      // dd/mm/yyyy
  oppId: string;       // 436670875
  oppDate: string;
  customer: string;
  consignee: string;
  docType: 'International' | 'Domestic';
  currency: string;    // $, ₹, €
  salesManager: string;
};

type PI = {
  piNo: string;
  piDate: string;
  btId: string | null;   // BT-13 (null for Without Shipment row variants)
  btDate: string | null;
  convertFrom: string | null;
  oppId: string;
  oppDate: string;
  customer: string;
  consignee: string;
  docType: 'International' | 'Domestic';
  currency: string;
  salesManager: string;
};

/* ─── Seed: Quotation list (matches screenshot 1) ─── */
const QUOTATIONS: Quotation[] = [
  { qtNo:'QT/2026-27/3',  qtDate:'20/04/2026', oppId:'436670875', oppDate:'10/04/2026', customer:'GreenHarvest Global',  consignee:'GreenHarvest Global',           docType:'International', currency:'$', salesManager:'Shreeyash Rajaram Mote' },
  { qtNo:'QT/2026-27/2',  qtDate:'12/04/2026', oppId:'437711416', oppDate:'07/04/2026', customer:'Shree',                consignee:'Shree',                          docType:'International', currency:'$', salesManager:'—' },
  { qtNo:'QT/2026-27/1',  qtDate:'11/04/2026', oppId:'436670875', oppDate:'10/04/2026', customer:'GreenHarvest Global',  consignee:'GreenHarvest Global',           docType:'International', currency:'$', salesManager:'Shreeyash Rajaram Mote' },
  { qtNo:'QT/2025-26/20', qtDate:'26/03/2026', oppId:'317901722', oppDate:'26/03/2026', customer:'shree',                consignee:'shree',                          docType:'International', currency:'$', salesManager:'—' },
  { qtNo:'QT/2025-26/19', qtDate:'26/03/2026', oppId:'999205647', oppDate:'26/03/2026', customer:'shree',                consignee:'shree',                          docType:'International', currency:'$', salesManager:'—' },
  { qtNo:'QT/2025-26/18', qtDate:'26/03/2026', oppId:'857701344', oppDate:'24/03/2026', customer:'SunGrow Bio-Refineries', consignee:'Infinty Private Limited',     docType:'International', currency:'$', salesManager:'—' },
  { qtNo:'QT/2025-26/17', qtDate:'26/03/2026', oppId:'674064391', oppDate:'25/03/2026', customer:'Apex Food Processors', consignee:'Apex Food Processors',          docType:'International', currency:'$', salesManager:'—' },
  { qtNo:'QT/2025-26/16', qtDate:'26/03/2026', oppId:'271658082', oppDate:'25/03/2026', customer:'FreshMart Retailers',  consignee:'FreshMart Northern Hub – Gurugram', docType:'International', currency:'$', salesManager:'—' },
  { qtNo:'QT/2025-26/15', qtDate:'26/03/2026', oppId:'271658082', oppDate:'25/03/2026', customer:'FreshMart Retailers',  consignee:'FreshMart Northern Hub – Gurugram', docType:'International', currency:'$', salesManager:'—' },
  { qtNo:'QT/2025-26/14', qtDate:'25/03/2026', oppId:'271658082', oppDate:'25/03/2026', customer:'FreshMart Retailers',  consignee:'FreshMart Northern Hub – Gurugram', docType:'International', currency:'$', salesManager:'—' },
];

/* ─── Seed: PI list — With Shipment (matches screenshot 3) ─── */
const PI_WITH: PI[] = [
  { piNo:'INV/2026-27/3',  piDate:'15/04/2026', btId:'BT-13', btDate:'17/04/2026', convertFrom:null,            oppId:'866295612',  oppDate:'15/04/2026', customer:'Shree',                                       consignee:'Shree',                                       docType:'International', currency:'$', salesManager:'Shreeyash Rajaram Mote' },
  { piNo:'INV/2026-27/2',  piDate:'11/04/2026', btId:'BT-12', btDate:'11/04/2026', convertFrom:'QT/2026-27/1',  oppId:'436670875',  oppDate:'10/04/2026', customer:'GreenHarvest Global',                         consignee:'GreenHarvest Global',                         docType:'International', currency:'$', salesManager:'Shreeyash Rajaram Mote' },
  { piNo:'INV/2025-26/13', piDate:'26/03/2026', btId:'BT-10', btDate:'26/03/2026', convertFrom:'QT/2025-26/19', oppId:'999205647',  oppDate:'26/03/2026', customer:'shree',                                       consignee:'shree',                                       docType:'International', currency:'$', salesManager:'—' },
  { piNo:'INV/2025-26/12', piDate:'26/03/2026', btId:'BT-09', btDate:'26/03/2026', convertFrom:'QT/2025-26/18', oppId:'857701344',  oppDate:'24/03/2026', customer:'SunGrow Bio-Refineries',                      consignee:'Infinty Private Limited',                     docType:'International', currency:'$', salesManager:'—' },
  { piNo:'INV/2025-26/11', piDate:'26/03/2026', btId:'BT-08', btDate:'26/03/2026', convertFrom:null,            oppId:'674064391',  oppDate:'25/03/2026', customer:'Apex Food Processors',                        consignee:'Apex Food Processors',                        docType:'International', currency:'$', salesManager:'—' },
  { piNo:'INV/2025-26/10', piDate:'26/03/2026', btId:'BT-07', btDate:'26/03/2026', convertFrom:'QT/2025-26/16', oppId:'271658082',  oppDate:'25/03/2026', customer:'FreshMart Retailers',                         consignee:'FreshMart Northern Hub – Gurugram',           docType:'International', currency:'$', salesManager:'—' },
  { piNo:'INV/2025-26/9',  piDate:'26/03/2026', btId:'BT-06', btDate:'26/03/2026', convertFrom:null,            oppId:'778047737',  oppDate:'25/03/2026', customer:'yash Agro Exports',                           consignee:'yash Agro Exports',                           docType:'International', currency:'$', salesManager:'—' },
  { piNo:'INV/2025-26/8',  piDate:'25/03/2026', btId:'BT-05', btDate:'25/03/2026', convertFrom:null,            oppId:'894968715',  oppDate:'25/03/2026', customer:'International Buyer',                         consignee:'International Buyer',                         docType:'International', currency:'',  salesManager:'—' },
  { piNo:'INV/2025-26/7',  piDate:'25/03/2026', btId:'BT-04', btDate:'25/03/2026', convertFrom:'QT/2025-26/11', oppId:'908049656',  oppDate:'25/03/2026', customer:'yash Agro Exports',                           consignee:'yash Agro Exports',                           docType:'International', currency:'$', salesManager:'—' },
  { piNo:'INV/2025-26/4',  piDate:'25/03/2026', btId:'BT-03', btDate:'25/03/2026', convertFrom:'QT/2025-26/5',  oppId:'3119841446', oppDate:'25/03/2026', customer:'Manoj Jacob',                                 consignee:'Manoj Jacob',                                 docType:'Domestic',      currency:'',  salesManager:'Shreeyash Rajaram Mote' },
  { piNo:'INV/2025-26/2',  piDate:'24/03/2026', btId:'BT-02', btDate:'24/03/2026', convertFrom:'QT/2025-26/2',  oppId:'228574667',  oppDate:'24/03/2026', customer:'GreenField Agricultural Products & Services Pv', consignee:'GreenField Agricultural Products & Services Pvt Ltd', docType:'International', currency:'$', salesManager:'—' },
  { piNo:'INV/2025-26/1',  piDate:'24/03/2026', btId:'BT-01', btDate:'24/03/2026', convertFrom:'QT/2025-26/1',  oppId:'731113287',  oppDate:'24/03/2026', customer:'GJ Enterprises Limited',                      consignee:'GJ Enterprises Limited',                      docType:'International', currency:'$', salesManager:'—' },
];

/* ─── Seed: PI list — Without Shipment (matches screenshot 5) ─── */
const PI_WITHOUT: PI[] = [
  { piNo:'INV/2026-27/1', piDate:'10/04/2026', btId:null, btDate:null, convertFrom:null,            oppId:'437711416',  oppDate:'07/04/2026', customer:'Shree',                       consignee:'Shree',                          docType:'Domestic',      currency:'',  salesManager:'—' },
  { piNo:'INV/2025-26/6', piDate:'25/03/2026', btId:null, btDate:null, convertFrom:'QT/2025-26/10', oppId:'273493051',  oppDate:'25/03/2026', customer:'Fit nation',                  consignee:'Fit nation',                     docType:'International', currency:'',  salesManager:'—' },
  { piNo:'INV/2025-26/5', piDate:'25/03/2026', btId:null, btDate:null, convertFrom:'QT/2025-26/8',  oppId:'3119841446', oppDate:'25/03/2026', customer:'Manoj Jacob',                 consignee:'Manoj Jacob',                    docType:'Domestic',      currency:'',  salesManager:'—' },
  { piNo:'INV/2025-26/3', piDate:'24/03/2026', btId:null, btDate:null, convertFrom:'QT/2025-26/3',  oppId:'228574667',  oppDate:'24/03/2026', customer:'GreenField Agricultural P…',  consignee:'GreenTech – Pune Distribution Hub', docType:'International', currency:'',  salesManager:'—' },
];

const ROWS_PER_PAGE = 10;

/* ════════════════════════════════════════════════════════════════════════════
 * PI PDF preview — opens the Proforma Invoice in a new tab.
 *
 * Used by the More Options dropdown on both the Quotation and PI tables.
 * POSTs the row fields to /sales/pi/preview-pdf, gets back a PDF blob,
 * and opens it via blob URL. The `withSignature` flag picks between the
 * stamped and blank variants of the same template.
 * ════════════════════════════════════════════════════════════════════════ */
async function openPiPreview(payload: Record<string, unknown>, withSignature: boolean): Promise<void> {
  const res = await api.post('/sales/pi/preview-pdf', { ...payload, withSignature }, {
    responseType: 'blob',
  });
  const blob = new Blob([res.data as BlobPart], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const win = window.open(url, '_blank', 'noopener,noreferrer');
  // Revoke after a short delay so the browser has time to read the blob
  // before we drop the reference; we can't revoke immediately or the new
  // tab gets a broken/blank document.
  if (win) setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function piPayloadFromQuotation(q: Quotation) {
  return {
    piNo: q.qtNo, piDate: q.qtDate,
    oppId: q.oppId, oppDate: q.oppDate,
    customer: q.customer, consignee: q.consignee,
    docType: q.docType, currency: q.currency,
    salesManager: q.salesManager,
  };
}

function piPayloadFromPI(p: PI) {
  return {
    piNo: p.piNo, piDate: p.piDate,
    btId: p.btId ?? '0', btDate: p.btDate ?? 'NA',
    oppId: p.oppId, oppDate: p.oppDate,
    customer: p.customer, consignee: p.consignee,
    docType: p.docType, currency: p.currency,
    salesManager: p.salesManager,
  };
}

/* ────────────────────────────────────────────────────────────────────────────
 * MoreOptionsMenu — dropdown anchored next to the kebab button.
 *
 * Rendered via portal at document.body so it escapes the table-wrap's
 * overflow:auto clip. Position is computed from the anchor button's rect
 * each open. Closes on outside-click, Escape, scroll, and resize.
 * ──────────────────────────────────────────────────────────────────────── */
function MoreOptionsMenu(props: {
  anchor: HTMLElement;
  payload: Record<string, unknown>;
  onClose: () => void;
  onError: (msg: string) => void;
}) {
  const { anchor, payload, onClose, onError } = props;
  const menuRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState<'with' | 'without' | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // Measure the anchor + menu before paint to avoid a one-frame flash at
  // the wrong coordinates. Re-measure if window resizes; close on scroll
  // so the menu doesn't drift away from a moving anchor.
  useLayoutEffect(() => {
    const place = () => {
      const r = anchor.getBoundingClientRect();
      const menuW = menuRef.current?.offsetWidth ?? 200;
      const menuH = menuRef.current?.offsetHeight ?? 90;
      // Default: open below the kebab, aligned to its right edge.
      let top  = r.bottom + 6;
      let left = r.right - menuW;
      // Flip up if not enough room below.
      if (top + menuH > window.innerHeight - 8) top = r.top - 6 - menuH;
      // Clamp horizontally so the menu stays on-screen.
      if (left < 8) left = 8;
      if (left + menuW > window.innerWidth - 8) left = window.innerWidth - menuW - 8;
      setPos({ top, left });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [anchor]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t)) return;
      if (anchor.contains(t)) return; // clicking the kebab again toggles via parent
      onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const onScroll = () => onClose();
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [anchor, onClose]);

  const pick = async (withSignature: boolean) => {
    setBusy(withSignature ? 'with' : 'without');
    try {
      await openPiPreview(payload, withSignature);
      onClose();
    } catch (err: any) {
      onError(err?.response?.data?.message || 'Could not generate PDF');
    } finally {
      setBusy(null);
    }
  };

  return createPortal(
    <div
      ref={menuRef}
      className="qpi-moremenu"
      role="menu"
      style={pos ? { top: pos.top, left: pos.left } : { top: -9999, left: -9999 }}
    >
      <button
        type="button" role="menuitem"
        className="qpi-moremenu-item"
        disabled={busy !== null}
        onClick={() => pick(true)}
      >
        <IconFileSignSm />
        <span>PI with Signature</span>
        {busy === 'with' && <span className="qpi-moremenu-spinner" />}
      </button>
      <button
        type="button" role="menuitem"
        className="qpi-moremenu-item"
        disabled={busy !== null}
        onClick={() => pick(false)}
      >
        <IconFileSm />
        <span>PI without Signature</span>
        {busy === 'without' && <span className="qpi-moremenu-spinner" />}
      </button>
    </div>,
    document.body
  );
}

const IconFileSignSm = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><path d="M9 18c1-2 2-3 3-3s2 1 3 2" /></svg>
);

const STEPS = [
  { n:1, title:'Create Quotation',          desc:'Prepare quotation using opportunity, buyer, product, pricing, currency, and bank details.', tag:'FOUNDATION STEP' },
  { n:2, title:'Share & Track Response',    desc:'Send quotation to buyer and track response status.',                                          tag:'SALES TRACKING' },
  { n:3, title:'Convert to Proforma Invoice', desc:'Convert accepted quotation into PI with shipment, payment, and document details.',        tag:'CONVERSION STEP' },
  { n:4, title:'Sales Readiness',           desc:'Prepare quotation and PI records for CLM, order confirmation, and export execution.',        tag:'FINAL EXECUTION' },
];

export default function SalesQPI() {
  const toast = useToast();
  const [tab, setTab] = useState<QPITab>('quotation');
  const [piSub, setPiSub] = useState<PISubTab>('with');
  const [wdhOpen, setWdhOpen] = useState(true);
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState<number>(ROWS_PER_PAGE);

  const [createQtOpen, setCreateQtOpen] = useState(false);
  const [createPiOpen, setCreatePiOpen] = useState(false);
  const [piSourceQuotation, setPiSourceQuotation] = useState<Quotation | null>(null);

  useEffect(() => {
    const id = 'sm-qpi-fonts';
    if (document.getElementById(id)) return;
    const link = document.createElement('link');
    link.id = id; link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700;800&family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&display=swap';
    document.head.appendChild(link);
  }, []);

  /* ─── Filter + paginate ─── */
  const filtered = useMemo(() => {
    const lo = q.trim().toLowerCase();
    if (tab === 'quotation') {
      const src = QUOTATIONS;
      if (!lo) return src;
      return src.filter(r => (
        r.qtNo.toLowerCase().includes(lo) ||
        r.oppId.toLowerCase().includes(lo) ||
        r.customer.toLowerCase().includes(lo) ||
        r.consignee.toLowerCase().includes(lo) ||
        r.salesManager.toLowerCase().includes(lo)
      ));
    }
    const src = piSub === 'with' ? PI_WITH : PI_WITHOUT;
    if (!lo) return src;
    return src.filter(r => (
      r.piNo.toLowerCase().includes(lo) ||
      r.oppId.toLowerCase().includes(lo) ||
      r.customer.toLowerCase().includes(lo) ||
      r.consignee.toLowerCase().includes(lo) ||
      (r.convertFrom ?? '').toLowerCase().includes(lo) ||
      (r.btId ?? '').toLowerCase().includes(lo)
    ));
  }, [tab, piSub, q]);

  const total = filtered.length;
  const pages = Math.max(1, Math.ceil(total / rowsPerPage));
  const safePage = Math.min(page, pages);
  const startIdx = (safePage - 1) * rowsPerPage;
  const rows = filtered.slice(startIdx, startIdx + rowsPerPage);

  /* ─── Helpers ─── */
  const switchTab = (next: QPITab) => { setTab(next); setPage(1); setQ(''); };
  const switchPiSub = (next: PISubTab) => { setPiSub(next); setPage(1); setQ(''); };
  const soon = (label: string) => toast.info(label, 'Coming in next phase');

  const onConvertToPi = (qt: Quotation) => {
    setPiSourceQuotation(qt);
    setCreatePiOpen(true);
  };

  return (
    <div className="qpi-root">
      <style>{SCOPED_CSS}</style>

      {/* ─── Header strip ─── */}
      <div className="qpi-header">
        <span className="qpi-accent" />
        <span className="qpi-glow" />
        <div className="qpi-header-left">
          <div className="qpi-avatar-wrap">
            <div className="qpi-header-icon"><IconUsers /></div>
            <span className="qpi-online-dot" />
          </div>
          <div>
            <div className="qpi-header-title">Quotations V/S Proforma Invoice</div>
            <div className="qpi-header-sub">Manage quotation creation, buyer approval and PI conversion</div>
          </div>
        </div>
        <div className="qpi-tab-switch">
          <button className={`qpi-tab ${tab === 'quotation' ? 'active' : ''}`} onClick={() => switchTab('quotation')}>
            <IconFile /> Quotation
          </button>
          <button className={`qpi-tab ${tab === 'pi' ? 'active' : ''}`} onClick={() => switchTab('pi')}>
            <IconMonitor /> Proforma Invoice
          </button>
        </div>
      </div>

      {/* ─── What We Are Doing Here ─── */}
      <div className="qpi-wdh">
        <div className="qpi-wdh-header" onClick={() => setWdhOpen(o => !o)} role="button">
          <div className="qpi-wdh-title">
            <div className="qpi-wdh-icon"><IconUsers /></div>
            <span>Quotations V/S Proforma Invoice — What We Are Doing Here:</span>
          </div>
          <button className="qpi-wdh-toggle" onClick={(e) => { e.stopPropagation(); setWdhOpen(o => !o); }}>
            {wdhOpen ? <IconChevronUpThin /> : <IconChevronDownThin />}
          </button>
        </div>
        {wdhOpen && (
          <div className="qpi-wdh-body">
            {STEPS.map((s, i) => (
              <Fragment key={s.n}>
                <div className="qpi-wdh-step">
                  <div className="qpi-wdh-step-head">
                    <div className="qpi-wdh-step-num">{s.n}</div>
                    <span className="qpi-wdh-step-title">{s.title}</span>
                  </div>
                  <p className="qpi-wdh-step-desc">{s.desc}</p>
                  <span className="qpi-wdh-step-tag"><span className="qpi-wdh-step-dot" />{s.tag}</span>
                </div>
                {i < STEPS.length - 1 && (
                  <div className="qpi-wdh-arrow"><div className="qpi-wdh-arrow-dot"><IconChevronRight /></div></div>
                )}
              </Fragment>
            ))}
          </div>
        )}
      </div>

      {/* ─── Table card ─── */}
      <div className="qpi-card">
        {/* Top bar: list pill / sub-tabs + search + create button */}
        <div className="qpi-tablebar">
          {tab === 'quotation' ? (
            <div className="qpi-listpill">
              <span className="qpi-listpill-icon"><IconFileSm /></span>
              Quotation List
            </div>
          ) : (
            <div className="qpi-pi-subtabs">
              <button className={`qpi-pi-subtab ${piSub === 'with' ? 'on' : ''}`} onClick={() => switchPiSub('with')}>
                <IconShip /> With Shipment
              </button>
              <button className={`qpi-pi-subtab ${piSub === 'without' ? 'on' : ''}`} onClick={() => switchPiSub('without')}>
                <IconFileSm /> Without Shipment
              </button>
            </div>
          )}

          <div className="qpi-search">
            <IconSearch />
            <input
              type="text"
              placeholder="Search by name, ID, company, email, segment..."
              value={q}
              onChange={(e) => { setQ(e.target.value); setPage(1); }}
            />
          </div>

          {tab === 'quotation' ? (
            <button className="qpi-create-btn" onClick={() => { setPiSourceQuotation(null); setCreateQtOpen(true); }}>
              <IconPlus /> Create Quotation
            </button>
          ) : (
            <button className="qpi-create-btn" onClick={() => { setPiSourceQuotation(null); setCreatePiOpen(true); }}>
              <IconPlus /> Create PI
            </button>
          )}
        </div>

        {/* Table */}
        <div className="qpi-table-wrap">
          {tab === 'quotation' ? (
            <QuotationTable
              rows={rows as Quotation[]} startIdx={startIdx}
              onConvert={onConvertToPi}
              onMail={() => soon('Mail Quotation')}
              onEdit={() => soon('Edit Quotation')}
              onDelete={() => soon('Delete Quotation')}
              onMenuError={(msg) => toast.error('Preview failed', msg)}
            />
          ) : (
            <PITable
              rows={rows as PI[]} startIdx={startIdx} sub={piSub}
              onEdit={() => soon('Edit PI')}
              onDelete={() => soon('Delete PI')}
              onMenuError={(msg) => toast.error('Preview failed', msg)}
            />
          )}
        </div>

        {/* Pagination */}
        <div className="qpi-pagination">
          <span className="qpi-pag-info">
            {total === 0 ? 'No records' : `Showing ${startIdx + 1}–${Math.min(startIdx + rowsPerPage, total)} of ${total} quotations`}
          </span>
          <div className="qpi-pag-right">
            <span className="qpi-pag-rpp">Rows per page:</span>
            <select
              className="qpi-pag-select"
              value={rowsPerPage}
              onChange={(e) => { setRowsPerPage(Number(e.target.value)); setPage(1); }}
            >
              <option value={5}>5</option>
              <option value={10}>10</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
            </select>
            <span className="qpi-pag-range">{safePage} / {pages}</span>
            <button className="qpi-pag-btn" disabled={safePage <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>
              <IconChevronLeft />
            </button>
            <button className="qpi-pag-btn" disabled={safePage >= pages || total === 0} onClick={() => setPage(p => Math.min(pages, p + 1))}>
              <IconChevronRight />
            </button>
          </div>
        </div>
      </div>

      {/* ─── Modals ─── */}
      {createQtOpen && (
        <CreateQuotationModal
          onClose={() => setCreateQtOpen(false)}
          onSubmit={() => { setCreateQtOpen(false); toast.success('Quotation Created', 'Saved as draft for review'); }}
        />
      )}
      {createPiOpen && (
        <CreatePIModal
          source={piSourceQuotation}
          onClose={() => { setCreatePiOpen(false); setPiSourceQuotation(null); }}
          onSubmit={() => { setCreatePiOpen(false); setPiSourceQuotation(null); toast.success('Proforma Invoice Created', 'PI generated successfully'); }}
        />
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════════
 * Quotation Table
 * ════════════════════════════════════════════════════════════════════════ */

function QuotationTable(props: {
  rows: Quotation[]; startIdx: number;
  onConvert: (q: Quotation) => void;
  onMail: () => void; onEdit: () => void; onDelete: () => void;
  onMenuError: (msg: string) => void;
}) {
  const { rows, startIdx, onConvert, onMail, onEdit, onDelete, onMenuError } = props;
  const [menuFor, setMenuFor] = useState<{ id: string; anchor: HTMLElement } | null>(null);
  return (
    <table className="qpi-table">
      <thead>
        <tr>
          <th>Sr No</th>
          <th>Quotation No</th>
          <th>Quotation Date</th>
          <th>Opp ID</th>
          <th>Opp Date</th>
          <th>Customer</th>
          <th>Consignee</th>
          <th>Document Type</th>
          <th>Currency</th>
          <th>Sales Manager</th>
          <th>Action</th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 && (
          <tr><td colSpan={11} className="qpi-empty">No quotations found</td></tr>
        )}
        {rows.map((r, i) => (
          <tr key={r.qtNo}>
            <td><span className="qpi-srno">{startIdx + i + 1}</span></td>
            <td><a className="qpi-link">{r.qtNo}</a></td>
            <td className="qpi-date">{r.qtDate}</td>
            <td><a className="qpi-link">{r.oppId}</a></td>
            <td className="qpi-date">{r.oppDate}</td>
            <td className="qpi-strong">{r.customer}</td>
            <td>{r.consignee}</td>
            <td>{r.docType}</td>
            <td className="qpi-currency">{r.currency}</td>
            <td className="qpi-sm">{r.salesManager}</td>
            <td>
              <div className="qpi-actions">
                <button className="qpi-convert-btn" onClick={() => onConvert(r)}>
                  <IconRepeatSm /> <span className="qpi-convert-btn-label">Convert to PI</span>
                </button>
                <Tooltip label="Email Quotation">
                  <button className="qpi-act qpi-act-mail" onClick={onMail} aria-label="Email Quotation"><IconMail /></button>
                </Tooltip>
                <Tooltip label="Edit Quotation">
                  <button className="qpi-act qpi-act-edit" onClick={onEdit} aria-label="Edit Quotation"><IconEdit /></button>
                </Tooltip>
                <Tooltip label="More Options">
                  <button
                    className="qpi-act qpi-act-menu"
                    onClick={(e) => {
                      const el = e.currentTarget;
                      setMenuFor(prev => prev?.id === r.qtNo ? null : { id: r.qtNo, anchor: el });
                    }}
                    aria-haspopup="menu"
                    aria-expanded={menuFor?.id === r.qtNo}
                    aria-label="More Options"
                  ><IconKebab /></button>
                </Tooltip>
                {menuFor?.id === r.qtNo && (
                  <MoreOptionsMenu
                    anchor={menuFor.anchor}
                    payload={piPayloadFromQuotation(r)}
                    onClose={() => setMenuFor(null)}
                    onError={onMenuError}
                  />
                )}
                <Tooltip label="Delete Quotation">
                  <button className="qpi-act qpi-act-del" onClick={onDelete} aria-label="Delete Quotation"><IconTrash /></button>
                </Tooltip>
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* ════════════════════════════════════════════════════════════════════════════
 * PI Table (handles both With/Without Shipment sub-tabs)
 * ════════════════════════════════════════════════════════════════════════ */

function PITable(props: {
  rows: PI[]; startIdx: number; sub: PISubTab;
  onEdit: () => void; onDelete: () => void;
  onMenuError: (msg: string) => void;
}) {
  const { rows, startIdx, sub, onEdit, onDelete, onMenuError } = props;
  const withShipment = sub === 'with';
  const [menuFor, setMenuFor] = useState<{ id: string; anchor: HTMLElement } | null>(null);
  return (
    <table className="qpi-table">
      <thead>
        <tr>
          <th>Sr No</th>
          <th>PI No</th>
          <th>PI Date</th>
          {withShipment && <th>BT ID</th>}
          {withShipment && <th>BT Date</th>}
          <th>Convert From (Quotation No)</th>
          <th>Opp ID</th>
          <th>Opp Date</th>
          <th>Customer</th>
          <th>Consignee</th>
          <th>Document Type</th>
          <th>Currency</th>
          <th>Sales Manager</th>
          <th>Action</th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 && (
          <tr><td colSpan={withShipment ? 14 : 12} className="qpi-empty">No proforma invoices found</td></tr>
        )}
        {rows.map((r, i) => (
          <tr key={r.piNo}>
            <td><span className="qpi-srno">{startIdx + i + 1}</span></td>
            <td><a className="qpi-link">{r.piNo}</a></td>
            <td className="qpi-date">{r.piDate}</td>
            {withShipment && <td>{r.btId ? <span className="qpi-bt-badge">{r.btId}</span> : <span className="qpi-em">—</span>}</td>}
            {withShipment && <td className="qpi-date">{r.btDate ?? <span className="qpi-em">—</span>}</td>}
            <td>{r.convertFrom ? <span className="qpi-qt-badge">{r.convertFrom}</span> : <span className="qpi-em">—</span>}</td>
            <td><a className="qpi-link">{r.oppId}</a></td>
            <td className="qpi-date">{r.oppDate}</td>
            <td className="qpi-strong">{r.customer}</td>
            <td>{r.consignee}</td>
            <td>{r.docType}</td>
            <td className="qpi-currency">{r.currency || <span className="qpi-em">—</span>}</td>
            <td className="qpi-sm">{r.salesManager}</td>
            <td>
              <div className="qpi-actions">
                <Tooltip label="Edit PI">
                  <button className="qpi-act qpi-act-edit" onClick={onEdit} aria-label="Edit PI"><IconEdit /></button>
                </Tooltip>
                <Tooltip label="More Options">
                  <button
                    className="qpi-act qpi-act-menu"
                    onClick={(e) => {
                      const el = e.currentTarget;
                      setMenuFor(prev => prev?.id === r.piNo ? null : { id: r.piNo, anchor: el });
                    }}
                    aria-haspopup="menu"
                    aria-expanded={menuFor?.id === r.piNo}
                    aria-label="More Options"
                  ><IconKebab /></button>
                </Tooltip>
                {menuFor?.id === r.piNo && (
                  <MoreOptionsMenu
                    anchor={menuFor.anchor}
                    payload={piPayloadFromPI(r)}
                    onClose={() => setMenuFor(null)}
                    onError={onMenuError}
                  />
                )}
                <Tooltip label="Delete PI">
                  <button className="qpi-act qpi-act-del" onClick={onDelete} aria-label="Delete PI"><IconTrash /></button>
                </Tooltip>
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* ════════════════════════════════════════════════════════════════════════════
 * Shared Modal building blocks
 * ════════════════════════════════════════════════════════════════════════ */

type BasicFormState = {
  docType: string; opportunity: string; opportunityDate: string;
  customer: string; consignee: string; bankName: string;
  currency: string; exchangeRate: string; incoTerm: string;
  portOfLoading: string; portOfDischarge: string; finalDestination: string;
  originCountry: string;
};

const EMPTY_BASIC: BasicFormState = {
  docType:'International', opportunity:'436670875', opportunityDate:'10/04/2026',
  customer:'C-012 – GreenHarvest Global', consignee:'CSG-016 – GreenHarvest Global', bankName:'SBI (State Bank of India)',
  currency:'USD', exchangeRate:'', incoTerm:'FOB',
  portOfLoading:'Chennai Port', portOfDischarge:'OMAN', finalDestination:'OMAN',
  originCountry:'INDIA',
};

type ProductRow = {
  id: number;
  name: string;
  qty: number;
  rate: number;
  taxPct: number;
};

function calcRow(p: ProductRow) {
  const sub = p.qty * p.rate;
  const taxAmt = sub * (p.taxPct / 100);
  const rateWithTax = p.rate * (1 + p.taxPct / 100);
  const amount = sub + taxAmt;
  return { sub, taxAmt, rateWithTax, amount };
}

/* ════════════════════════════════════════════════════════════════════════════
 * Create Quotation Modal (2-step wizard)
 * ════════════════════════════════════════════════════════════════════════ */

function CreateQuotationModal(props: { onClose: () => void; onSubmit: () => void }) {
  const { onClose, onSubmit } = props;
  const [step, setStep] = useState<1 | 2>(1);
  const [form, setForm] = useState<BasicFormState>(EMPTY_BASIC);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [terms, setTerms] = useState('');
  const [shipping, setShipping] = useState<number>(0);
  const [draft, setDraft] = useState<ProductRow>({ id:0, name:'', qty:0, rate:0, taxPct:0 });

  const addProduct = () => {
    if (!draft.name || draft.qty <= 0 || draft.rate <= 0) return;
    setProducts(p => [...p, { ...draft, id: Date.now() }]);
    setDraft({ id:0, name:'', qty:0, rate:0, taxPct:0 });
  };
  const removeProduct = (id: number) => setProducts(p => p.filter(x => x.id !== id));

  const subTotal = products.reduce((s, p) => s + calcRow(p).amount, 0);
  const grandTotal = subTotal + (Number(shipping) || 0);

  return (
    /* Backdrop is purely visual — closing only via the X / Cancel button
     * so accidental outside-clicks don't wipe an in-progress quote. */
    <div className="qpi-modal-backdrop">
      <div className="qpi-modal qpi-modal-teal">
        {/* Header (teal) */}
        <div className="qpi-modal-head qpi-modal-head-teal">
          <div className="qpi-modal-head-left">
            <div className="qpi-modal-head-icon"><IconFile /></div>
            <div>
              <div className="qpi-modal-title">Create Quotation</div>
              <div className="qpi-modal-sub">Fill in the details to generate a new quotation</div>
            </div>
          </div>
          <div className="qpi-modal-head-right">
            <div className="qpi-modal-pill">
              <span className="qpi-modal-pill-label">Quotation ID</span>
              <span className="qpi-modal-pill-value">QT/2025-26/5</span>
            </div>
            <div className="qpi-modal-pill">
              <span className="qpi-modal-pill-label">Quotation Date</span>
              <span className="qpi-modal-pill-value">18/05/2026</span>
            </div>
            <button className="qpi-modal-close" onClick={onClose} aria-label="Close"><IconClose /></button>
          </div>
        </div>

        {/* Stepper */}
        <div className="qpi-modal-stepper">
          <StepBadge n={1} title="Basic Quotation Details" subtitle="Document & party info" state={step >= 1 ? (step === 1 ? 'active' : 'done') : 'idle'} theme="teal" />
          <div className="qpi-modal-step-divider" />
          <StepBadge n={2} title="Product Details" subtitle="Items, pricing & totals" state={step === 2 ? 'active' : 'idle'} theme="teal" />
        </div>

        {/* Body */}
        <div className="qpi-modal-body">
          {step === 1 && (
            <BasicForm form={form} setForm={setForm} theme="teal" titleLabel="Basic Quotation Details" partyKind="Quotation" />
          )}

          {step === 2 && (
            <ProductsStep
              form={form}
              products={products}
              setProducts={setProducts}
              removeProduct={removeProduct}
              draft={draft}
              setDraft={setDraft}
              addProduct={addProduct}
              terms={terms} setTerms={setTerms}
              shipping={shipping} setShipping={setShipping}
              subTotal={subTotal} grandTotal={grandTotal}
              theme="teal"
              titleLabel="Quotation"
            />
          )}
        </div>

        {/* Footer */}
        <div className="qpi-modal-foot">
          <div className="qpi-modal-req">* Required fields</div>
          <div className="qpi-modal-foot-actions">
            <button className="qpi-btn-cancel" onClick={onClose}>Cancel</button>
            {step === 2 && (
              <button className="qpi-btn-back" onClick={() => setStep(1)}>
                ← Back
              </button>
            )}
            {step === 1 ? (
              <button className="qpi-btn-next qpi-btn-next-teal" onClick={() => setStep(2)}>
                Save &amp; Next →
              </button>
            ) : (
              <button className="qpi-btn-submit qpi-btn-submit-teal" onClick={onSubmit}>
                ✓ Submit Quotation
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════════
 * Create Proforma Invoice (PI) Modal (2-step wizard, purple theme)
 * ════════════════════════════════════════════════════════════════════════ */

function CreatePIModal(props: { source: Quotation | null; onClose: () => void; onSubmit: () => void }) {
  const { source, onClose, onSubmit } = props;
  const [step, setStep] = useState<1 | 2>(1);

  const seeded: BasicFormState = source ? {
    ...EMPTY_BASIC,
    opportunity: `OPP-001 – ${source.customer}`,
    opportunityDate: source.oppDate,
    customer: `C-012 – ${source.customer}`,
    consignee: `CSG-016 – ${source.consignee}`,
  } : { ...EMPTY_BASIC, opportunity: 'OPP-001 – GreenHarvest Global' };
  const [form, setForm] = useState<BasicFormState>(seeded);

  const [products, setProducts] = useState<ProductRow[]>([]);
  const [terms, setTerms] = useState('');
  const [shipping, setShipping] = useState<number>(0);
  const [draft, setDraft] = useState<ProductRow>({ id:0, name:'', qty:0, rate:0, taxPct:0 });

  const addProduct = () => {
    if (!draft.name || draft.qty <= 0 || draft.rate <= 0) return;
    setProducts(p => [...p, { ...draft, id: Date.now() }]);
    setDraft({ id:0, name:'', qty:0, rate:0, taxPct:0 });
  };
  const removeProduct = (id: number) => setProducts(p => p.filter(x => x.id !== id));

  const subTotal = products.reduce((s, p) => s + calcRow(p).amount, 0);
  const grandTotal = subTotal + (Number(shipping) || 0);

  return (
    /* Backdrop is purely visual — closing only via the X / Cancel button
     * so accidental outside-clicks don't wipe an in-progress quote. */
    <div className="qpi-modal-backdrop">
      <div className="qpi-modal qpi-modal-purple">
        {/* Header (purple) */}
        <div className="qpi-modal-head qpi-modal-head-purple">
          <div className="qpi-modal-head-left">
            <div className="qpi-modal-head-icon"><IconFile /></div>
            <div>
              <div className="qpi-modal-title">Create Proforma Invoice (PI)</div>
              <div className="qpi-modal-sub">Fill in the details to generate a new proforma invoice</div>
            </div>
          </div>
          <div className="qpi-modal-head-right">
            <div className="qpi-modal-pill qpi-modal-pill-purple">
              <span className="qpi-modal-pill-label">PI No</span>
              <span className="qpi-modal-pill-value">PI/2026-27/004</span>
            </div>
            <div className="qpi-modal-pill qpi-modal-pill-purple">
              <span className="qpi-modal-pill-label">PI Date</span>
              <span className="qpi-modal-pill-value">18/05/2026</span>
            </div>
            <button className="qpi-modal-close" onClick={onClose} aria-label="Close"><IconClose /></button>
          </div>
        </div>

        {/* Stepper */}
        <div className="qpi-modal-stepper">
          <StepBadge n={1} title="Basic PI Details" subtitle="Document & party info" state={step >= 1 ? (step === 1 ? 'active' : 'done') : 'idle'} theme="purple" />
          <div className="qpi-modal-step-divider" />
          <StepBadge n={2} title="Product Details" subtitle="Items, pricing & totals" state={step === 2 ? 'active' : 'idle'} theme="purple" />
        </div>

        {/* Body */}
        <div className="qpi-modal-body">
          {step === 1 && (
            <BasicForm form={form} setForm={setForm} theme="purple" titleLabel="Basic PI Details" partyKind="PI" />
          )}

          {step === 2 && (
            <ProductsStep
              form={form}
              products={products}
              setProducts={setProducts}
              removeProduct={removeProduct}
              draft={draft}
              setDraft={setDraft}
              addProduct={addProduct}
              terms={terms} setTerms={setTerms}
              shipping={shipping} setShipping={setShipping}
              subTotal={subTotal} grandTotal={grandTotal}
              theme="purple"
              titleLabel="PI"
            />
          )}
        </div>

        {/* Footer */}
        <div className="qpi-modal-foot">
          <div className="qpi-modal-req">* Required fields</div>
          <div className="qpi-modal-foot-actions">
            <button className="qpi-btn-cancel" onClick={onClose}>Cancel</button>
            {step === 2 && (
              <button className="qpi-btn-back" onClick={() => setStep(1)}>
                ← Back
              </button>
            )}
            {step === 1 ? (
              <button className="qpi-btn-next qpi-btn-next-purple" onClick={() => setStep(2)}>
                Save &amp; Next →
              </button>
            ) : (
              <button className="qpi-btn-submit qpi-btn-submit-purple" onClick={onSubmit} disabled={products.length === 0}>
                ✓ Submit PI
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Step badge (1 or 2) ─── */
function StepBadge(props: { n: number; title: string; subtitle: string; state: 'idle' | 'active' | 'done'; theme: 'teal' | 'purple' }) {
  const { n, title, subtitle, state, theme } = props;
  return (
    <div className={`qpi-step-badge qpi-step-${state} qpi-step-${theme}`}>
      <div className="qpi-step-badge-num">
        {state === 'done' ? <IconCheck /> : n}
      </div>
      <div>
        <div className="qpi-step-badge-title">{title}</div>
        <div className="qpi-step-badge-sub">{subtitle}</div>
      </div>
    </div>
  );
}

/* ─── Basic form (Step 1) ─── */
function BasicForm(props: {
  form: BasicFormState; setForm: (f: BasicFormState) => void;
  theme: 'teal' | 'purple'; titleLabel: string; partyKind: 'Quotation' | 'PI';
}) {
  const { form, setForm, theme, partyKind } = props;
  const set = <K extends keyof BasicFormState>(k: K, v: BasicFormState[K]) => setForm({ ...form, [k]: v });

  return (
    <>
      <div className={`qpi-form-heading qpi-form-heading-${theme}`}>BASIC {partyKind === 'PI' ? 'PI' : 'QUOTATION'} DETAILS</div>

      <div className="qpi-form-grid">
        <Field label="Document Type" required>
          <select className="qpi-input" value={form.docType} onChange={(e) => set('docType', e.target.value)}>
            <option>International</option>
            <option>Domestic</option>
          </select>
        </Field>
        <Field label="Opportunity" required>
          <input className="qpi-input" value={form.opportunity} onChange={(e) => set('opportunity', e.target.value)} />
        </Field>
        <Field label="Opportunity Date">
          <input className="qpi-input qpi-input-readonly" value={form.opportunityDate} readOnly />
        </Field>

        <Field label="Customer" required>
          <input className="qpi-input" value={form.customer} onChange={(e) => set('customer', e.target.value)} />
        </Field>
        <Field label="Consignee" required>
          <input className="qpi-input" value={form.consignee} onChange={(e) => set('consignee', e.target.value)} />
        </Field>
        <Field label="Bank Name" required>
          <input className="qpi-input" value={form.bankName} onChange={(e) => set('bankName', e.target.value)} />
        </Field>

        <Field label="Currency" required>
          <input className="qpi-input" value={form.currency} onChange={(e) => set('currency', e.target.value)} />
        </Field>
        <Field label="Exchange Rate">
          <input className="qpi-input" placeholder="Enter exchange rate" value={form.exchangeRate} onChange={(e) => set('exchangeRate', e.target.value)} />
        </Field>
        <Field label="INCO Term" required>
          <input className="qpi-input" value={form.incoTerm} onChange={(e) => set('incoTerm', e.target.value)} />
        </Field>

        <Field label="Port of Loading" required>
          <input className="qpi-input" value={form.portOfLoading} onChange={(e) => set('portOfLoading', e.target.value)} />
        </Field>
        <Field label="Port of Discharge" required>
          <input className="qpi-input" placeholder="Enter port of discharge" value={form.portOfDischarge} onChange={(e) => set('portOfDischarge', e.target.value)} />
        </Field>
        <Field label="Final Destination" required>
          <input className="qpi-input" placeholder="Enter final destination" value={form.finalDestination} onChange={(e) => set('finalDestination', e.target.value)} />
        </Field>

        <Field label="Origin Country" required>
          <input className="qpi-input" value={form.originCountry} onChange={(e) => set('originCountry', e.target.value)} />
        </Field>
      </div>

      <div className={`qpi-note qpi-note-${theme}`}>
        <span className="qpi-note-icon"><IconWarn /></span>
        <div className="qpi-note-body">
          <div className="qpi-note-line"><strong>Note</strong></div>
          <div className="qpi-note-line">
            <strong>Without Opportunity:</strong> You can create a general {partyKind === 'PI' ? 'PI' : 'quotation'} by directly selecting the customer; ensure the customer is fully created in the system. You do not need to select an Opportunity.
          </div>
          <div className="qpi-note-line">
            <strong>With Opportunity:</strong> Customer and Consignee must be mapped to the selected Opportunity (mandatory).
          </div>
        </div>
      </div>
    </>
  );
}

function Field(props: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="qpi-field">
      <label className="qpi-field-label">
        {props.label}
        {props.required && <span className="qpi-req-star"> *</span>}
      </label>
      {props.children}
    </div>
  );
}

/* ─── Products step (Step 2) ─── */
function ProductsStep(props: {
  form: BasicFormState;
  products: ProductRow[];
  setProducts: (p: ProductRow[]) => void;
  removeProduct: (id: number) => void;
  draft: ProductRow; setDraft: (d: ProductRow) => void;
  addProduct: () => void;
  terms: string; setTerms: (s: string) => void;
  shipping: number; setShipping: (n: number) => void;
  subTotal: number; grandTotal: number;
  theme: 'teal' | 'purple';
  titleLabel: string;
}) {
  const { form, products, removeProduct, draft, setDraft, addProduct, terms, setTerms, shipping, setShipping, subTotal, grandTotal, theme } = props;

  return (
    <>
      <div className={`qpi-form-heading qpi-form-heading-${theme}`}>ORDER SUMMARY</div>

      <div className={`qpi-order-summary qpi-order-summary-${theme}`}>
        <SummaryItem label="Opportunity ID" value={form.opportunity.split(' – ')[0] || 'OPP-001'} />
        <SummaryItem label="Opportunity Date" value={form.opportunityDate} />
        <SummaryItem label="Customer ID" value={form.customer.split(' – ')[0]} />
        <SummaryItem label="Customer Name" value={form.customer.split(' – ')[1] || form.customer} />
        <SummaryItem label="Customer Country" value="India" />
        <SummaryItem label="Consignee ID" value={form.consignee.split(' – ')[0]} />
        <SummaryItem label="Consignee Name" value={form.consignee.split(' – ')[1] || form.consignee} />
        <SummaryItem label="Document Type" value={form.docType} />
        <SummaryItem label="INCO Term" value={form.incoTerm} />
        <SummaryItem label="Bank Name" value={form.bankName} />
        <SummaryItem label="Currency" value={form.currency} />
        <SummaryItem label="Port of Loading" value={form.portOfLoading} />
      </div>

      {products.length === 0 && (
        <div className="qpi-product-warn">
          <span className="qpi-product-warn-icon"><IconWarn /></span>
          At least 1 product is required to proceed
        </div>
      )}

      <div className="qpi-products-wrap">
        <table className="qpi-products-table">
          <thead>
            <tr>
              <th>Product Name</th>
              <th>Qty</th>
              <th>Product Rate</th>
              <th>Tax %</th>
              <th>Tax Amount</th>
              <th>Rate with Tax</th>
              <th>Amount</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {products.map(p => {
              const c = calcRow(p);
              return (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td>{p.qty}</td>
                  <td>{p.rate.toFixed(2)}</td>
                  <td>{p.taxPct}</td>
                  <td>{c.taxAmt.toFixed(2)}</td>
                  <td>{c.rateWithTax.toFixed(2)}</td>
                  <td className="qpi-amt">{c.amount.toFixed(2)}</td>
                  <td>
                    <button className="qpi-prod-remove" onClick={() => removeProduct(p.id)} aria-label="Remove product"><IconTrash /></button>
                  </td>
                </tr>
              );
            })}
            <tr className="qpi-products-input-row">
              <td>
                <select
                  className="qpi-input"
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                >
                  <option value="">— Select Product —</option>
                  <option value="Cashew W320">Cashew W320</option>
                  <option value="Basmati Rice 1121">Basmati Rice 1121</option>
                  <option value="Turmeric Powder">Turmeric Powder</option>
                  <option value="Sesame Seeds">Sesame Seeds</option>
                  <option value="Coconut Oil">Coconut Oil</option>
                </select>
              </td>
              <td><input className="qpi-input qpi-input-num" type="number" min="0" value={draft.qty || ''} onChange={(e) => setDraft({ ...draft, qty: Number(e.target.value) })} /></td>
              <td><input className="qpi-input qpi-input-num" type="number" min="0" value={draft.rate || ''} onChange={(e) => setDraft({ ...draft, rate: Number(e.target.value) })} /></td>
              <td><input className="qpi-input qpi-input-num" type="number" min="0" value={draft.taxPct || 0} onChange={(e) => setDraft({ ...draft, taxPct: Number(e.target.value) })} /></td>
              <td className="qpi-em-center">—</td>
              <td className="qpi-em-center">—</td>
              <td className="qpi-em-center">—</td>
              <td>
                <button className={`qpi-prod-add qpi-prod-add-${theme}`} onClick={addProduct}>
                  <IconPlus /> Add
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="qpi-totals-row">
        <div className="qpi-terms">
          <div className={`qpi-form-heading qpi-form-heading-${theme}`}>TERMS &amp; CONDITIONS</div>
          <textarea
            className="qpi-textarea"
            placeholder="Enter terms and conditions..."
            value={terms}
            onChange={(e) => setTerms(e.target.value)}
          />
        </div>

        <div className={`qpi-summary qpi-summary-${theme}`}>
          <div className="qpi-summary-heading">SUMMARY</div>
          <div className="qpi-summary-line">
            <span>Sub Total</span>
            <span className="qpi-summary-val">{subTotal.toFixed(2)}</span>
          </div>
          <div className="qpi-summary-line">
            <span>Shipping Cost</span>
            <input
              className="qpi-input qpi-summary-input"
              type="number" min="0"
              value={shipping || 0}
              onChange={(e) => setShipping(Number(e.target.value))}
            />
          </div>
          <div className="qpi-summary-grand">
            <span>GRAND TOTAL</span>
            <span className="qpi-summary-val">{grandTotal.toFixed(2)}</span>
          </div>
        </div>
      </div>
    </>
  );
}

function SummaryItem(props: { label: string; value: string }) {
  return (
    <div className="qpi-summary-item">
      <div className="qpi-summary-item-label">{props.label}</div>
      <div className="qpi-summary-item-value">{props.value || '—'}</div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════════
 * Icons (inline SVG, Lucide-style stroke)
 * ════════════════════════════════════════════════════════════════════════ */

const IconUsers = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
    <path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);
const IconFile = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" />
  </svg>
);
const IconFileSm = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" />
  </svg>
);
const IconMonitor = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
    <rect x="2" y="3" width="20" height="14" rx="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" />
  </svg>
);
const IconShip = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 17l9-5 9 5" /><path d="M5 21l1.5-4h11L19 21" /><path d="M12 7v5" /><path d="M9 7h6" />
  </svg>
);
const IconChevronUpThin = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#7c3aed" strokeWidth="2.5">
    <polyline points="7 14 12 9 17 14" />
  </svg>
);
const IconChevronDownThin = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#7c3aed" strokeWidth="2.5">
    <polyline points="7 10 12 15 17 10" />
  </svg>
);
const IconChevronLeft = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
    <polyline points="15 18 9 12 15 6" />
  </svg>
);
const IconChevronRight = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
    <polyline points="9 18 15 12 9 6" />
  </svg>
);
const IconPlus = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8">
    <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);
const IconSearch = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" strokeWidth="2.2" strokeLinecap="round">
    <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
  </svg>
);
const IconMail = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3">
    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
    <polyline points="22,6 12,13 2,6" />
  </svg>
);
const IconEdit = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3">
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4z" />
  </svg>
);
const IconKebab = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
    <circle cx="12" cy="5" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="12" cy="19" r="1.5" />
  </svg>
);
const IconTrash = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    <path d="M10 11v6M14 11v6" />
    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
  </svg>
);
const IconRepeatSm = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
    <polyline points="17 1 21 5 17 9" /><path d="M3 11V9a4 4 0 0 1 4-4h14" />
    <polyline points="7 23 3 19 7 15" /><path d="M21 13v2a4 4 0 0 1-4 4H3" />
  </svg>
);
const IconClose = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);
const IconCheck = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);
const IconWarn = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);

/* ════════════════════════════════════════════════════════════════════════════
 * Scoped CSS (all rules under .qpi-root or .qpi-modal-backdrop)
 * ════════════════════════════════════════════════════════════════════════ */

const SCOPED_CSS = `
.qpi-root {
  font-family: 'DM Sans', 'Inter', system-ui, -apple-system, sans-serif;
  background: linear-gradient(160deg, #faf5ff 0%, #f3e8ff 40%, #ede9fe 100%);
  padding: 14px 18px 20px;
  margin: -1rem -0.75rem;
  min-height: calc(100vh - 70px);
  color: #1e1b4b;
  display: flex; flex-direction: column; gap: 12px;
}
.qpi-root *, .qpi-root *::before, .qpi-root *::after { box-sizing: border-box; }

/* ─── Header strip ─── */
.qpi-header {
  position: relative; overflow: hidden;
  display: flex; align-items: center; justify-content: space-between; gap: 14px; flex-wrap: wrap;
  padding: 12px 18px; min-height: 64px;
  background: linear-gradient(110deg, #f5f3ff 0%, #ede9fe 40%, #ddd6fe 100%);
  border: 1px solid #c4b5fd; border-radius: 16px;
  box-shadow: 0 2px 0 rgba(255,255,255,.85) inset, 0 8px 28px rgba(139,92,246,.2);
}
.qpi-accent { position: absolute; left: 0; top: 0; bottom: 0; width: 4px; background: linear-gradient(180deg, #a78bfa, #7c3aed, #5b21b6); border-radius: 16px 0 0 16px; }
.qpi-glow   { position: absolute; right: -20px; top: -20px; width: 120px; height: 120px; border-radius: 50%; background: rgba(167,139,250,.15); pointer-events: none; }
.qpi-header-left { display: flex; align-items: center; gap: 12px; z-index: 1; padding-left: 6px; }
.qpi-avatar-wrap { position: relative; flex-shrink: 0; }
.qpi-header-icon {
  width: 40px; height: 40px; border-radius: 12px;
  background: linear-gradient(135deg, #8b5cf6 0%, #7c3aed 55%, #5b21b6 100%);
  display: flex; align-items: center; justify-content: center; color: #fff;
  box-shadow: 0 4px 12px rgba(124,58,237,.35), 0 0 0 3px rgba(139,92,246,.18);
}
.qpi-online-dot { position: absolute; bottom: -1px; right: -1px; width: 10px; height: 10px; border-radius: 50%; background: linear-gradient(135deg,#4ade80,#22c55e); border: 2px solid #f3e8ff; }
.qpi-header-title { font-size: 14.5px; font-weight: 800; color: #3b0764; letter-spacing: -.3px; }
.qpi-header-sub   { font-size: 11px; color: #7c3aed; margin-top: 2px; font-weight: 500; }

.qpi-tab-switch {
  display: flex; gap: 4px; padding: 4px;
  background: rgba(255,255,255,.7);
  border: 1px solid rgba(124,58,237,.2);
  border-radius: 10px; z-index: 1;
}
.qpi-tab {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 8px 14px; border-radius: 7px; border: none;
  background: transparent; color: #7c3aed;
  font-family: inherit; font-size: 12px; font-weight: 700; cursor: pointer;
  white-space: nowrap;
  transition: all .15s;
}
.qpi-tab:hover { background: rgba(124,58,237,.08); }
.qpi-tab.active { background: linear-gradient(135deg, #8b5cf6, #7c3aed); color: #fff; box-shadow: 0 2px 8px rgba(124,58,237,.4); }

/* ─── What We Are Doing Here ─── */
.qpi-wdh {
  position: relative;
  background: linear-gradient(110deg, #f5f3ff 0%, #ede9fe 50%, #ddd6fe 100%);
  border: 1px solid #c4b5fd; border-radius: 14px;
  overflow: hidden;
  box-shadow: 0 2px 8px rgba(139,92,246,.1);
}
.qpi-wdh-header { display: flex; align-items: center; justify-content: space-between; padding: 9px 14px; cursor: pointer; user-select: none; }
.qpi-wdh-title { display: flex; align-items: center; gap: 9px; font-size: 13px; font-weight: 800; color: #3b0764; }
.qpi-wdh-icon { width: 28px; height: 28px; border-radius: 8px; background: linear-gradient(135deg, #8b5cf6, #7c3aed); display: flex; align-items: center; justify-content: center; color: #fff; }
.qpi-wdh-toggle { width: 28px; height: 28px; border-radius: 50%; border: 1.5px solid rgba(124,58,237,.25); background: rgba(255,255,255,.75); display: flex; align-items: center; justify-content: center; cursor: pointer; }

.qpi-wdh-body {
  display: grid;
  grid-template-columns: 1fr auto 1fr auto 1fr auto 1fr;
  align-items: stretch;
  gap: 6px; padding: 6px 14px 12px;
}
.qpi-wdh-step {
  background: #fff; border: 1.5px solid #e8e4f9;
  border-radius: 10px;
  padding: 10px 12px;
  display: flex; flex-direction: column; gap: 6px;
  min-height: 110px;
}
.qpi-wdh-step-head { display: flex; align-items: center; gap: 8px; }
.qpi-wdh-step-num {
  width: 22px; height: 22px; border-radius: 50%;
  background: linear-gradient(135deg, #a78bfa, #7c3aed); color: #fff;
  font-size: 11px; font-weight: 800;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.qpi-wdh-step-title { font-size: 12px; font-weight: 800; color: #3b0764; }
.qpi-wdh-step-desc { font-size: 10.5px; color: #6b7280; line-height: 1.45; margin: 0; flex: 1; }
.qpi-wdh-step-tag {
  display: inline-flex; align-items: center; gap: 5px;
  font-size: 9.5px; font-weight: 800; color: #7c3aed;
  letter-spacing: .04em; text-transform: uppercase;
  margin-top: auto;
}
.qpi-wdh-step-dot { width: 6px; height: 6px; border-radius: 50%; background: #7c3aed; }

.qpi-wdh-arrow { display: flex; align-items: center; justify-content: center; }
.qpi-wdh-arrow-dot {
  width: 22px; height: 22px; border-radius: 50%;
  background: rgba(255,255,255,.7); border: 1.5px solid #c4b5fd;
  display: flex; align-items: center; justify-content: center;
  color: #7c3aed;
}

/* ─── Table card ─── */
.qpi-card {
  background: #fff;
  border: 1px solid #ddd6fe;
  border-radius: 14px;
  overflow: hidden;
  box-shadow: 0 2px 8px rgba(124,58,237,.08);
}
.qpi-tablebar {
  display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
  padding: 12px 14px;
  background: linear-gradient(110deg, #f5f3ff 0%, #ede9fe 100%);
  border-bottom: 1px solid #ddd6fe;
}
.qpi-listpill {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 9px 14px; border-radius: 10px;
  background: #fff; border: 1.5px solid #ddd6fe;
  color: #5b21b6; font-size: 12.5px; font-weight: 800;
  white-space: nowrap;
  flex-shrink: 0;
}
.qpi-listpill-icon {
  width: 24px; height: 24px; border-radius: 7px;
  background: linear-gradient(135deg, #8b5cf6, #7c3aed); color: #fff;
  display: inline-flex; align-items: center; justify-content: center;
}

.qpi-pi-subtabs { display: inline-flex; gap: 6px; flex-shrink: 0; }
.qpi-pi-subtab {
  display: inline-flex; align-items: center; gap: 7px;
  padding: 9px 14px; border-radius: 10px;
  background: #fff; border: 1.5px solid #ddd6fe;
  color: #5b21b6; font-family: inherit; font-size: 12px; font-weight: 700; cursor: pointer;
  white-space: nowrap;
  transition: all .15s;
}
.qpi-pi-subtab:hover { background: #f5f3ff; }
.qpi-pi-subtab.on {
  background: linear-gradient(135deg, #8b5cf6, #7c3aed); color: #fff;
  border-color: transparent;
  box-shadow: 0 4px 12px rgba(124,58,237,.4);
}

.qpi-search {
  flex: 1; position: relative;
  display: flex; align-items: center;
  background: #fff; border: 1.5px solid #ddd6fe;
  border-radius: 10px;
  padding: 0 12px 0 36px;
  height: 40px;
}
.qpi-search svg { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); }
.qpi-search input { flex: 1; height: 100%; border: none; outline: none; background: transparent; font-family: inherit; font-size: 12px; color: #1e1b4b; }
.qpi-search input::placeholder { color: #94a3b8; }

.qpi-create-btn {
  display: inline-flex; align-items: center; gap: 7px;
  padding: 10px 16px; border-radius: 10px; border: none;
  background: linear-gradient(135deg, #8b5cf6, #7c3aed); color: #fff;
  font-family: inherit; font-size: 12.5px; font-weight: 700; cursor: pointer;
  box-shadow: 0 4px 12px rgba(124,58,237,.4);
  white-space: nowrap;
  flex-shrink: 0;
  transition: transform .15s, box-shadow .15s;
}
.qpi-create-btn:hover { transform: translateY(-1px); box-shadow: 0 6px 16px rgba(124,58,237,.5); }

/* ─── Table ─── */
.qpi-table-wrap { overflow-x: auto; }
.qpi-table { width: 100%; border-collapse: collapse; font-size: 12px; min-width: 1100px; }
.qpi-table thead tr {
  background: linear-gradient(90deg, #6d28d9, #7c3aed);
}
.qpi-table thead th {
  color: #fff; font-size: 10px; font-weight: 800;
  padding: 12px 14px; text-align: left;
  text-transform: uppercase; letter-spacing: .06em;
  white-space: nowrap;
}
.qpi-table tbody tr { border-bottom: 1px solid #f1f0fc; transition: background .12s; }
.qpi-table tbody tr:hover { background: #faf5ff; }
.qpi-table tbody td { padding: 11px 14px; color: #475569; vertical-align: middle; }
.qpi-empty { text-align: center; padding: 24px; color: #94a3b8; }

.qpi-srno {
  display: inline-flex; align-items: center; justify-content: center;
  width: 26px; height: 26px; border-radius: 8px;
  background: linear-gradient(135deg, #ede9fe, #ddd6fe);
  color: #6d28d9; font-size: 11px; font-weight: 800;
}
.qpi-link {
  color: #7c3aed; font-weight: 700; text-decoration: underline;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11.5px; cursor: pointer;
}
.qpi-strong { font-weight: 700; color: #1e1b4b; }
.qpi-date { color: #475569; font-variant-numeric: tabular-nums; }
.qpi-currency { font-weight: 800; color: #0f172a; }
.qpi-sm { color: #475569; }
.qpi-em { color: #cbd5e1; }
.qpi-em-center { text-align: center; color: #cbd5e1; }

.qpi-bt-badge {
  display: inline-flex; align-items: center;
  padding: 4px 12px; border-radius: 20px;
  border: 1.5px solid #5eead4; background: #f0fdfa;
  color: #0f766e; font-size: 11px; font-weight: 800;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
}
.qpi-qt-badge {
  display: inline-flex; align-items: center;
  padding: 4px 10px; border-radius: 20px;
  border: 1.5px solid #ddd6fe; background: #faf5ff;
  color: #6d28d9; font-size: 11px; font-weight: 700;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
}

.qpi-actions { display: inline-flex; align-items: center; gap: 6px; flex-wrap: nowrap; }
.qpi-convert-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 7px 12px; border-radius: 8px; border: none;
  background: linear-gradient(135deg, #8b5cf6, #7c3aed); color: #fff;
  font-family: inherit; font-size: 11px; font-weight: 800; cursor: pointer;
  box-shadow: 0 2px 6px rgba(124,58,237,.4);
  white-space: nowrap;
  transition: transform .15s;
}
.qpi-convert-btn:hover { transform: translateY(-1px); }
.qpi-act {
  width: 30px; height: 30px; border-radius: 8px;
  border: 1.5px solid; background: #fff;
  display: inline-flex; align-items: center; justify-content: center;
  cursor: pointer; transition: transform .15s, background .15s;
  flex-shrink: 0;
}
.qpi-act:hover { transform: translateY(-1px); }
.qpi-act-mail { color: #2563eb; border-color: #bfdbfe; background: #eff6ff; }
.qpi-act-edit { color: #15803d; border-color: #bbf7d0; background: #f0fdf4; }
.qpi-act-menu { color: #475569; border-color: #e2e8f0; background: #fff; }
.qpi-act-del  { color: #dc2626; border-color: #fecaca; background: #fef2f2; }

/* ─── More-Options dropdown (portal'd into <body>; positioned via inline style) ─── */
.qpi-moremenu {
  position: fixed;
  z-index: 9999;
  min-width: 200px;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  box-shadow: 0 14px 32px rgba(15,23,42,.20), 0 4px 10px rgba(15,23,42,.08);
  padding: 6px;
  display: flex; flex-direction: column; gap: 2px;
  font-family: 'Inter', system-ui, -apple-system, sans-serif;
  animation: qpi-moremenu-in .12s ease-out;
}
@keyframes qpi-moremenu-in { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }
.qpi-moremenu-item {
  display: inline-flex; align-items: center; gap: 10px;
  padding: 9px 12px; border-radius: 7px;
  background: transparent; border: none; cursor: pointer;
  font-family: inherit; font-size: 13px; font-weight: 600;
  color: #1e293b;
  text-align: left;
  transition: background .12s, color .12s;
}
.qpi-moremenu-item:hover:not(:disabled) { background: #eff6ff; color: #0369a1; }
.qpi-moremenu-item:disabled { opacity: .65; cursor: wait; }
.qpi-moremenu-item svg { flex-shrink: 0; color: #0ea5e9; }
.qpi-moremenu-item span { flex: 1; white-space: nowrap; }
.qpi-moremenu-spinner {
  width: 12px; height: 12px; border-radius: 50%;
  border: 2px solid rgba(14,165,233,.30); border-top-color: #0ea5e9;
  animation: qpi-moremenu-spin .7s linear infinite;
}
@keyframes qpi-moremenu-spin { to { transform: rotate(360deg); } }
[data-bs-theme="dark"] .qpi-moremenu {
  background: #2a2342;
  border-color: rgba(167,139,250,.45);
  box-shadow: 0 14px 32px rgba(0,0,0,.60), 0 4px 10px rgba(0,0,0,.40);
}
[data-bs-theme="dark"] .qpi-moremenu-item { color: #f1f5f9; }
[data-bs-theme="dark"] .qpi-moremenu-item:hover:not(:disabled) {
  background: rgba(14,165,233,.20);
  color: #e0f2fe;
}
[data-bs-theme="dark"] .qpi-moremenu-item svg { color: #38bdf8; }

/* ─── Pagination ─── */
.qpi-pagination {
  display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px;
  padding: 12px 16px;
  background: linear-gradient(110deg, #f5f3ff 0%, #ede9fe 100%);
  border-top: 1px solid #ddd6fe;
}
.qpi-pag-info {
  display: inline-flex; align-items: center;
  padding: 6px 12px; border-radius: 8px;
  background: #fff; border: 1.5px solid #ddd6fe;
  color: #5b21b6; font-size: 11.5px; font-weight: 700;
}
.qpi-pag-right { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.qpi-pag-rpp { font-size: 12px; color: #475569; font-weight: 600; }
.qpi-pag-select {
  padding: 5px 10px; border-radius: 7px;
  background: #fff; border: 1.5px solid #ddd6fe;
  color: #5b21b6; font-family: inherit; font-size: 12px; font-weight: 700; cursor: pointer;
}
.qpi-pag-range {
  display: inline-flex; align-items: center;
  padding: 5px 12px; border-radius: 7px;
  background: #fff; border: 1.5px solid #ddd6fe;
  color: #5b21b6; font-size: 11.5px; font-weight: 700;
}
.qpi-pag-btn {
  width: 30px; height: 30px; border-radius: 8px;
  background: #fff; border: 1.5px solid #ddd6fe;
  color: #7c3aed; display: inline-flex; align-items: center; justify-content: center;
  cursor: pointer; transition: all .15s;
}
.qpi-pag-btn:hover:not(:disabled) { background: #faf5ff; }
.qpi-pag-btn:disabled { opacity: .4; cursor: not-allowed; }

/* ════════════════════════════════════════════════════════════════════════════
 * Modal styles (shared between Create Quotation and Create PI)
 * ════════════════════════════════════════════════════════════════════════ */
.qpi-modal-backdrop {
  position: fixed; inset: 0; z-index: 9999;
  background: rgba(15, 23, 42, .55);
  backdrop-filter: blur(2px);
  display: flex; align-items: center; justify-content: center;
  padding: 24px;
  overflow-y: auto;
  font-family: 'DM Sans', 'Inter', sans-serif;
}
.qpi-modal-backdrop *, .qpi-modal-backdrop *::before, .qpi-modal-backdrop *::after { box-sizing: border-box; }
.qpi-modal {
  width: 100%; max-width: 1100px;
  background: #fff; border-radius: 16px;
  box-shadow: 0 25px 60px rgba(15, 23, 42, .35);
  display: flex; flex-direction: column;
  max-height: calc(100vh - 48px);
  overflow: hidden;
}
.qpi-modal-head {
  padding: 18px 22px;
  display: flex; align-items: center; justify-content: space-between; gap: 14px; flex-wrap: wrap;
  color: #fff;
}
.qpi-modal-head-right { flex-wrap: wrap; }
.qpi-modal-head-teal   { background: linear-gradient(110deg, #0f4c5c 0%, #0d3b48 60%, #042f36 100%); }
.qpi-modal-head-purple { background: linear-gradient(110deg, #6d28d9 0%, #5b21b6 60%, #4c1d95 100%); }
.qpi-modal-head-left { display: flex; align-items: center; gap: 14px; }
.qpi-modal-head-icon {
  width: 42px; height: 42px; border-radius: 12px;
  background: rgba(255,255,255,.15); border: 1.5px solid rgba(255,255,255,.25);
  display: flex; align-items: center; justify-content: center; color: #fff;
}
.qpi-modal-title { font-size: 17px; font-weight: 800; letter-spacing: -.3px; }
.qpi-modal-sub   { font-size: 12px; opacity: .85; margin-top: 2px; }

.qpi-modal-head-right { display: flex; align-items: center; gap: 10px; }
.qpi-modal-pill {
  background: rgba(255,255,255,.08);
  border: 1.5px solid rgba(255,255,255,.2);
  border-radius: 8px;
  padding: 5px 14px;
  display: flex; flex-direction: column;
}
.qpi-modal-pill-label { font-size: 9.5px; opacity: .75; letter-spacing: .05em; text-transform: uppercase; font-weight: 700; }
.qpi-modal-pill-value { font-size: 12px; font-weight: 800; font-family: 'JetBrains Mono', ui-monospace, monospace; }
.qpi-modal-pill-purple { background: rgba(255,255,255,.1); }
.qpi-modal-close {
  width: 32px; height: 32px; border-radius: 8px;
  background: rgba(255,255,255,.1); border: 1.5px solid rgba(255,255,255,.2);
  color: #fff; display: inline-flex; align-items: center; justify-content: center;
  cursor: pointer; transition: background .15s;
}
.qpi-modal-close:hover { background: rgba(255,255,255,.2); }

/* Stepper */
.qpi-modal-stepper {
  display: flex; align-items: center; gap: 0;
  padding: 18px 22px 14px;
  background: #f8fafc;
  border-bottom: 1px solid #e2e8f0;
}
.qpi-modal-step-divider {
  flex: 0 0 60px;
  height: 2px;
  background: #e2e8f0;
  margin: 0 0;
}
.qpi-step-badge {
  display: flex; align-items: center; gap: 12px;
  padding: 12px 18px; border-radius: 12px;
  border: 1.5px solid transparent;
  background: #fff;
  flex: 1;
  transition: all .15s;
}
.qpi-step-badge-num {
  width: 34px; height: 34px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 14px; font-weight: 800;
  flex-shrink: 0;
}
.qpi-step-badge-title { font-size: 13.5px; font-weight: 800; }
.qpi-step-badge-sub   { font-size: 11px; color: #94a3b8; margin-top: 1px; }
/* idle */
.qpi-step-idle { background: #fff; border-color: #e2e8f0; }
.qpi-step-idle .qpi-step-badge-num { background: #f1f5f9; color: #94a3b8; }
.qpi-step-idle .qpi-step-badge-title { color: #94a3b8; }
/* active */
.qpi-step-active.qpi-step-teal   { background: #ecfeff; border-color: #67e8f9; box-shadow: 0 4px 12px rgba(8, 145, 178, .15); }
.qpi-step-active.qpi-step-teal   .qpi-step-badge-num { background: linear-gradient(135deg, #0e7490, #0891b2); color: #fff; }
.qpi-step-active.qpi-step-teal   .qpi-step-badge-title { color: #0e7490; }
.qpi-step-active.qpi-step-purple { background: #f5f3ff; border-color: #c4b5fd; box-shadow: 0 4px 12px rgba(124,58,237,.15); }
.qpi-step-active.qpi-step-purple .qpi-step-badge-num { background: linear-gradient(135deg, #8b5cf6, #7c3aed); color: #fff; }
.qpi-step-active.qpi-step-purple .qpi-step-badge-title { color: #6d28d9; }
/* done */
.qpi-step-done .qpi-step-badge-num { background: linear-gradient(135deg, #4ade80, #22c55e); color: #fff; }
.qpi-step-done .qpi-step-badge-title { color: #15803d; }
.qpi-step-done.qpi-step-teal   { background: #f0fdfa; border-color: #99f6e4; }
.qpi-step-done.qpi-step-purple { background: #f0fdf4; border-color: #bbf7d0; }

/* Body */
.qpi-modal-body {
  padding: 18px 22px;
  overflow-y: auto;
  flex: 1;
  background: #fff;
}
.qpi-form-heading {
  font-size: 11.5px; font-weight: 800; letter-spacing: .05em;
  margin-bottom: 12px;
  padding-left: 8px;
  border-left: 3px solid;
  text-transform: uppercase;
}
.qpi-form-heading-teal   { color: #0e7490; border-color: #0891b2; }
.qpi-form-heading-purple { color: #6d28d9; border-color: #7c3aed; }

.qpi-form-grid {
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px 18px;
}
.qpi-field { display: flex; flex-direction: column; gap: 5px; }
.qpi-field-label { font-size: 10.5px; font-weight: 800; color: #64748b; letter-spacing: .05em; text-transform: uppercase; }
.qpi-req-star { color: #ef4444; }
.qpi-input {
  width: 100%; height: 38px;
  padding: 0 12px;
  border: 1.5px solid #e2e8f0; border-radius: 8px;
  background: #fff;
  font-family: inherit; font-size: 12.5px; color: #1e1b4b;
  outline: none; transition: border .15s, box-shadow .15s;
}
.qpi-input:focus { border-color: #7c3aed; box-shadow: 0 0 0 3px rgba(124,58,237,.12); }
.qpi-input-readonly { background: #f8fafc; color: #64748b; cursor: not-allowed; }
.qpi-input-num { text-align: right; }

/* Note panel */
.qpi-note {
  margin-top: 18px;
  padding: 14px 16px;
  background: linear-gradient(110deg, #fffbeb 0%, #fef3c7 100%);
  border: 1.5px solid #fde68a; border-radius: 10px;
  display: flex; gap: 12px; align-items: flex-start;
}
.qpi-note-icon { color: #d97706; flex-shrink: 0; margin-top: 1px; }
.qpi-note-body { flex: 1; }
.qpi-note-line { font-size: 11.5px; color: #78350f; line-height: 1.55; }
.qpi-note-line + .qpi-note-line { margin-top: 4px; }
.qpi-note-line strong { color: #92400e; font-weight: 800; }

/* Order summary card (step 2) */
.qpi-order-summary {
  display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px 18px;
  padding: 14px 16px;
  border-radius: 10px;
  border: 1.5px solid;
  background: #faf5ff;
  margin-bottom: 16px;
}
.qpi-order-summary-purple { background: #faf5ff; border-color: #ddd6fe; }
.qpi-order-summary-teal   { background: #ecfeff; border-color: #a5f3fc; }
.qpi-summary-item {}
.qpi-summary-item-label { font-size: 9.5px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; color: #6d28d9; }
.qpi-order-summary-teal .qpi-summary-item-label { color: #0e7490; }
.qpi-summary-item-value { font-size: 12.5px; font-weight: 700; color: #1e1b4b; margin-top: 2px; }

/* Product warning */
.qpi-product-warn {
  display: flex; align-items: center; gap: 8px;
  padding: 11px 14px;
  background: #fef2f2; border: 1.5px solid #fecaca;
  color: #b91c1c;
  border-radius: 8px;
  font-size: 12px; font-weight: 700;
  margin-bottom: 14px;
}
.qpi-product-warn-icon { color: #dc2626; display: inline-flex; }

/* Products table */
.qpi-products-wrap { overflow-x: auto; margin-bottom: 18px; }
.qpi-products-table { width: 100%; border-collapse: separate; border-spacing: 0; font-size: 12px; min-width: 800px; }
.qpi-products-table thead tr { background: linear-gradient(90deg, #312e81, #4c1d95); }
.qpi-products-table thead th { color: #fff; font-size: 9.5px; font-weight: 800; padding: 11px 12px; text-transform: uppercase; letter-spacing: .06em; text-align: left; }
.qpi-products-table tbody td { padding: 10px 12px; border-bottom: 1px solid #f1f0fc; vertical-align: middle; color: #475569; }
.qpi-products-table tbody tr:last-child td { border-bottom: none; }
.qpi-products-input-row td { background: #faf5ff; }
.qpi-amt { font-weight: 800; color: #0f172a; font-variant-numeric: tabular-nums; }
.qpi-prod-remove {
  width: 30px; height: 30px; border-radius: 8px;
  border: 1.5px solid #fecaca; background: #fef2f2;
  color: #dc2626; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
}
.qpi-prod-add {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 8px 14px; border-radius: 8px; border: none;
  color: #fff; font-family: inherit; font-size: 12px; font-weight: 800; cursor: pointer;
  box-shadow: 0 3px 10px rgba(124,58,237,.35);
}
.qpi-prod-add-teal   { background: linear-gradient(135deg, #0891b2, #0e7490); box-shadow: 0 3px 10px rgba(14,116,144,.35); }
.qpi-prod-add-purple { background: linear-gradient(135deg, #8b5cf6, #7c3aed); }

/* Totals row */
.qpi-totals-row {
  display: grid; grid-template-columns: 1fr 320px; gap: 18px;
}
.qpi-terms { display: flex; flex-direction: column; }
.qpi-textarea {
  width: 100%; min-height: 130px;
  padding: 10px 12px;
  border: 1.5px solid #e2e8f0; border-radius: 8px;
  background: #fff;
  font-family: inherit; font-size: 12px; color: #1e1b4b;
  resize: vertical;
  outline: none;
}
.qpi-textarea:focus { border-color: #7c3aed; box-shadow: 0 0 0 3px rgba(124,58,237,.12); }

.qpi-summary {
  padding: 14px 16px;
  border-radius: 10px;
  border: 1.5px solid;
  background: #fff;
}
.qpi-summary-teal   { border-color: #a5f3fc; background: #ecfeff; }
.qpi-summary-purple { border-color: #ddd6fe; background: #faf5ff; }
.qpi-summary-heading {
  font-size: 11px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase;
  color: #6d28d9; margin-bottom: 10px;
}
.qpi-summary-teal .qpi-summary-heading { color: #0e7490; }
.qpi-summary-line {
  display: flex; align-items: center; justify-content: space-between;
  padding: 7px 0; font-size: 12.5px; color: #475569; font-weight: 600;
}
.qpi-summary-val { font-weight: 800; color: #1e1b4b; font-variant-numeric: tabular-nums; }
.qpi-summary-input { width: 110px; height: 32px; padding: 0 10px; font-size: 12px; }
.qpi-summary-grand {
  display: flex; align-items: center; justify-content: space-between;
  margin-top: 6px; padding-top: 10px;
  border-top: 1.5px solid;
  font-size: 14px; font-weight: 800; color: #1e1b4b;
}
.qpi-summary-teal   .qpi-summary-grand { border-top-color: #a5f3fc; color: #0e7490; }
.qpi-summary-purple .qpi-summary-grand { border-top-color: #ddd6fe; color: #6d28d9; }

/* Footer */
.qpi-modal-foot {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 22px;
  background: #fff;
  border-top: 1px solid #e2e8f0;
}
.qpi-modal-req { font-size: 11.5px; color: #ef4444; font-weight: 600; }
.qpi-modal-foot-actions { display: flex; align-items: center; gap: 10px; }
.qpi-btn-cancel {
  padding: 9px 22px; border-radius: 9px;
  border: 1.5px solid #e2e8f0; background: #fff;
  color: #475569; font-family: inherit; font-size: 12.5px; font-weight: 700; cursor: pointer;
}
.qpi-btn-cancel:hover { background: #f8fafc; }
.qpi-btn-back {
  padding: 9px 18px; border-radius: 9px;
  border: 1.5px solid #c4b5fd; background: #fff;
  color: #6d28d9; font-family: inherit; font-size: 12.5px; font-weight: 700; cursor: pointer;
}
.qpi-btn-back:hover { background: #faf5ff; }
.qpi-btn-next, .qpi-btn-submit {
  padding: 9px 22px; border-radius: 9px;
  border: none; color: #fff;
  font-family: inherit; font-size: 12.5px; font-weight: 800; cursor: pointer;
  display: inline-flex; align-items: center; gap: 7px;
  transition: transform .15s, box-shadow .15s;
}
.qpi-btn-next-teal,   .qpi-btn-submit-teal   { background: linear-gradient(135deg, #0891b2, #0e7490); box-shadow: 0 4px 12px rgba(14,116,144,.4); }
.qpi-btn-next-purple, .qpi-btn-submit-purple { background: linear-gradient(135deg, #8b5cf6, #7c3aed); box-shadow: 0 4px 12px rgba(124,58,237,.4); }
.qpi-btn-next:hover, .qpi-btn-submit:hover { transform: translateY(-1px); }
.qpi-btn-submit:disabled { opacity: .55; cursor: not-allowed; transform: none; }

/* ════════════════════════════════════════════════════════════════════════════
 * Dark mode — mirrors the SalesLeadAckMaster palette so the two Sales-Matrix
 * pages feel consistent. Page bg #14101d, cards #1a1530, body bg #221a3a,
 * inputs #0f0c19, text #e9d5ff / #c4b5fd, borders rgba(167,139,250,.25–.45).
 * ════════════════════════════════════════════════════════════════════════ */
[data-bs-theme="dark"] .qpi-root {
  background: linear-gradient(160deg, #14101d 0%, #1a1530 60%, #1c1432 100%);
  color: #e9d5ff;
}

/* Header strip */
[data-bs-theme="dark"] .qpi-header {
  background: linear-gradient(110deg, #1c1432 0%, #221839 50%, #2a1d49 100%);
  border-color: rgba(167,139,250,.30);
  box-shadow: 0 2px 0 rgba(255,255,255,.04) inset, 0 8px 28px rgba(0,0,0,.55);
}
[data-bs-theme="dark"] .qpi-header-title { color: #e9d5ff; }
[data-bs-theme="dark"] .qpi-header-sub   { color: #c4b5fd; }
[data-bs-theme="dark"] .qpi-online-dot   { border-color: #1a1530; }
[data-bs-theme="dark"] .qpi-tab-switch {
  background: rgba(255,255,255,.04);
  border-color: rgba(167,139,250,.25);
}
[data-bs-theme="dark"] .qpi-tab        { color: #c4b5fd; }
[data-bs-theme="dark"] .qpi-tab:hover  { background: rgba(167,139,250,.12); }

/* What We Are Doing Here */
[data-bs-theme="dark"] .qpi-wdh {
  background: linear-gradient(110deg, #1c1432 0%, #221839 50%, #2a1d49 100%);
  border-color: rgba(167,139,250,.30);
  box-shadow: 0 2px 8px rgba(0,0,0,.45);
}
[data-bs-theme="dark"] .qpi-wdh-title  { color: #e9d5ff; }
[data-bs-theme="dark"] .qpi-wdh-toggle {
  background: rgba(255,255,255,.06);
  border-color: rgba(167,139,250,.35);
  color: #c4b5fd;
}
[data-bs-theme="dark"] .qpi-wdh-step {
  background: #1a1530;
  border-color: rgba(167,139,250,.25);
}
[data-bs-theme="dark"] .qpi-wdh-step-title { color: #e9d5ff; }
[data-bs-theme="dark"] .qpi-wdh-step-desc  { color: #9aa0b4; }
[data-bs-theme="dark"] .qpi-wdh-step-tag   { color: #c4b5fd; }
[data-bs-theme="dark"] .qpi-wdh-arrow-dot  {
  background: rgba(255,255,255,.06);
  border-color: rgba(167,139,250,.30);
  color: #c4b5fd;
}

/* Table card */
[data-bs-theme="dark"] .qpi-card {
  background: #1a1530;
  border-color: rgba(167,139,250,.25);
  box-shadow: 0 8px 32px rgba(0,0,0,.45);
}
[data-bs-theme="dark"] .qpi-tablebar {
  background: linear-gradient(110deg, #1c1432 0%, #221839 100%);
  border-bottom-color: rgba(167,139,250,.25);
}
[data-bs-theme="dark"] .qpi-listpill {
  background: rgba(255,255,255,.05);
  border-color: rgba(167,139,250,.30);
  color: #e9d5ff;
}
[data-bs-theme="dark"] .qpi-pi-subtab {
  background: rgba(255,255,255,.05);
  border-color: rgba(167,139,250,.30);
  color: #e9d5ff;
}
[data-bs-theme="dark"] .qpi-pi-subtab:hover { background: rgba(167,139,250,.12); }
[data-bs-theme="dark"] .qpi-search {
  background: rgba(255,255,255,.04);
  border-color: rgba(167,139,250,.30);
}
[data-bs-theme="dark"] .qpi-search input { color: #e9d5ff; }
[data-bs-theme="dark"] .qpi-search input::placeholder { color: #7a6b9a; }

/* Table */
[data-bs-theme="dark"] .qpi-table thead tr {
  background: linear-gradient(90deg, #4c2d8a, #6d28d9);
}
[data-bs-theme="dark"] .qpi-table tbody tr {
  background: #1a1530;
  border-bottom-color: rgba(167,139,250,.15);
}
[data-bs-theme="dark"] .qpi-table tbody tr:hover { background: rgba(76,45,138,.30); }
[data-bs-theme="dark"] .qpi-table tbody td       { color: #d4d1de; }
[data-bs-theme="dark"] .qpi-strong               { color: #e9d5ff; }
[data-bs-theme="dark"] .qpi-currency             { color: #f1f5f9; }
[data-bs-theme="dark"] .qpi-link                 { color: #c4b5fd; }
[data-bs-theme="dark"] .qpi-sm                   { color: #c4b5fd; }
[data-bs-theme="dark"] .qpi-date                 { color: #d4d1de; }
[data-bs-theme="dark"] .qpi-em,
[data-bs-theme="dark"] .qpi-em-center            { color: #6b6481; }
[data-bs-theme="dark"] .qpi-empty                { color: #7a6b9a; }
[data-bs-theme="dark"] .qpi-srno {
  background: linear-gradient(135deg, rgba(76,45,138,.45), rgba(45,27,86,.55));
  color: #c4b5fd;
}
[data-bs-theme="dark"] .qpi-bt-badge {
  background: rgba(13,148,136,.20); color: #5eead4; border-color: rgba(13,148,136,.40);
}
[data-bs-theme="dark"] .qpi-qt-badge {
  background: rgba(124,58,237,.22); color: #c4b5fd; border-color: rgba(167,139,250,.40);
}

/* Action buttons */
[data-bs-theme="dark"] .qpi-act-mail {
  background: rgba(37,99,235,.18); color: #93c5fd; border-color: rgba(59,130,246,.40);
}
[data-bs-theme="dark"] .qpi-act-edit {
  background: rgba(34,197,94,.18); color: #86efac; border-color: rgba(34,197,94,.40);
}
[data-bs-theme="dark"] .qpi-act-menu {
  background: rgba(255,255,255,.06); color: #c4b5fd; border-color: rgba(167,139,250,.30);
}
[data-bs-theme="dark"] .qpi-act-del {
  background: rgba(220,38,38,.18); color: #fca5a5; border-color: rgba(239,68,68,.40);
}

/* Pagination */
[data-bs-theme="dark"] .qpi-pagination {
  background: linear-gradient(110deg, #14101d, #1a1530);
  border-top-color: rgba(167,139,250,.25);
}
[data-bs-theme="dark"] .qpi-pag-info,
[data-bs-theme="dark"] .qpi-pag-range,
[data-bs-theme="dark"] .qpi-pag-select,
[data-bs-theme="dark"] .qpi-pag-btn {
  background: rgba(255,255,255,.05);
  border-color: rgba(167,139,250,.30);
  color: #e9d5ff;
}
[data-bs-theme="dark"] .qpi-pag-rpp { color: #c4b5fd; }
[data-bs-theme="dark"] .qpi-pag-select option { background: #1a1530; color: #e9d5ff; }
[data-bs-theme="dark"] .qpi-pag-btn:hover:not(:disabled) {
  background: rgba(167,139,250,.18); color: #fff;
}

/* Modals — backdrop is already dark enough; we just need to dark-mode
   the modal shell, stepper, body, inputs, totals card, and footer. */
[data-bs-theme="dark"] .qpi-modal {
  background: #1a1530;
  box-shadow: 0 25px 60px rgba(0,0,0,.65);
}
[data-bs-theme="dark"] .qpi-modal-stepper {
  background: #14101d;
  border-bottom-color: rgba(167,139,250,.20);
}
[data-bs-theme="dark"] .qpi-step-idle {
  background: rgba(255,255,255,.04);
  border-color: rgba(167,139,250,.20);
}
[data-bs-theme="dark"] .qpi-step-idle .qpi-step-badge-num { background: #2a2342; color: #7a6b9a; }
[data-bs-theme="dark"] .qpi-step-idle .qpi-step-badge-title { color: #9aa0b4; }
[data-bs-theme="dark"] .qpi-step-active.qpi-step-teal,
[data-bs-theme="dark"] .qpi-step-done.qpi-step-teal {
  background: rgba(14,165,233,.12); border-color: rgba(14,165,233,.45);
}
[data-bs-theme="dark"] .qpi-step-active.qpi-step-purple,
[data-bs-theme="dark"] .qpi-step-done.qpi-step-purple {
  background: rgba(124,58,237,.18); border-color: rgba(167,139,250,.45);
}
[data-bs-theme="dark"] .qpi-step-active.qpi-step-teal .qpi-step-badge-title   { color: #67e8f9; }
[data-bs-theme="dark"] .qpi-step-active.qpi-step-purple .qpi-step-badge-title { color: #c4b5fd; }
[data-bs-theme="dark"] .qpi-step-done .qpi-step-badge-title                   { color: #86efac; }
[data-bs-theme="dark"] .qpi-step-badge-sub { color: #7a6b9a; }
[data-bs-theme="dark"] .qpi-modal-step-divider { background: rgba(167,139,250,.20); }

[data-bs-theme="dark"] .qpi-modal-body { background: #221a3a; color: #e9d5ff; }
[data-bs-theme="dark"] .qpi-field-label { color: #c4b5fd; }
[data-bs-theme="dark"] .qpi-input,
[data-bs-theme="dark"] .qpi-textarea {
  background: #0f0c19;
  border-color: rgba(167,139,250,.25);
  color: #e9d5ff;
}
[data-bs-theme="dark"] .qpi-input::placeholder,
[data-bs-theme="dark"] .qpi-textarea::placeholder { color: #7a6b9a; }
[data-bs-theme="dark"] .qpi-input:focus,
[data-bs-theme="dark"] .qpi-textarea:focus {
  border-color: #a78bfa;
  box-shadow: 0 0 0 3px rgba(167,139,250,.20);
}
[data-bs-theme="dark"] .qpi-input-readonly {
  background: rgba(255,255,255,.04); color: #9aa0b4;
}
[data-bs-theme="dark"] .qpi-form-heading-teal   { color: #67e8f9; border-color: #0891b2; }
[data-bs-theme="dark"] .qpi-form-heading-purple { color: #c4b5fd; border-color: #a78bfa; }

/* Note panel — keep amber theme but darken */
[data-bs-theme="dark"] .qpi-note {
  background: rgba(180,83,9,.18); border-color: rgba(217,119,6,.45);
}
[data-bs-theme="dark"] .qpi-note-line   { color: #fde68a; }
[data-bs-theme="dark"] .qpi-note-line strong { color: #fcd34d; }

/* Order summary + product table + totals + summary card */
[data-bs-theme="dark"] .qpi-order-summary-purple { background: rgba(124,58,237,.15); border-color: rgba(167,139,250,.35); }
[data-bs-theme="dark"] .qpi-order-summary-teal   { background: rgba(14,165,233,.12); border-color: rgba(14,165,233,.35); }
[data-bs-theme="dark"] .qpi-summary-item-label   { color: #c4b5fd; }
[data-bs-theme="dark"] .qpi-order-summary-teal .qpi-summary-item-label { color: #67e8f9; }
[data-bs-theme="dark"] .qpi-summary-item-value   { color: #e9d5ff; }

[data-bs-theme="dark"] .qpi-product-warn {
  background: rgba(220,38,38,.15); border-color: rgba(239,68,68,.40); color: #fca5a5;
}
[data-bs-theme="dark"] .qpi-products-table tbody td {
  border-bottom-color: rgba(167,139,250,.15); color: #d4d1de;
}
[data-bs-theme="dark"] .qpi-products-input-row td { background: rgba(124,58,237,.12); }
[data-bs-theme="dark"] .qpi-amt { color: #f1f5f9; }
[data-bs-theme="dark"] .qpi-prod-remove {
  background: rgba(220,38,38,.18); border-color: rgba(239,68,68,.40); color: #fca5a5;
}

[data-bs-theme="dark"] .qpi-summary-teal   { background: rgba(14,165,233,.12); border-color: rgba(14,165,233,.35); }
[data-bs-theme="dark"] .qpi-summary-purple { background: rgba(124,58,237,.15); border-color: rgba(167,139,250,.35); }
[data-bs-theme="dark"] .qpi-summary-heading { color: #c4b5fd; }
[data-bs-theme="dark"] .qpi-summary-teal .qpi-summary-heading { color: #67e8f9; }
[data-bs-theme="dark"] .qpi-summary-line { color: #c4b5fd; }
[data-bs-theme="dark"] .qpi-summary-val  { color: #e9d5ff; }
[data-bs-theme="dark"] .qpi-summary-grand { color: #e9d5ff; }
[data-bs-theme="dark"] .qpi-summary-teal   .qpi-summary-grand { border-top-color: rgba(14,165,233,.45); color: #67e8f9; }
[data-bs-theme="dark"] .qpi-summary-purple .qpi-summary-grand { border-top-color: rgba(167,139,250,.45); color: #c4b5fd; }

/* Modal footer + secondary buttons */
[data-bs-theme="dark"] .qpi-modal-foot {
  background: #1a1530;
  border-top-color: rgba(167,139,250,.20);
}
[data-bs-theme="dark"] .qpi-modal-req { color: #fca5a5; }
[data-bs-theme="dark"] .qpi-btn-cancel {
  background: rgba(255,255,255,.05);
  border-color: rgba(167,139,250,.40);
  color: #e9d5ff;
}
[data-bs-theme="dark"] .qpi-btn-cancel:hover { background: rgba(167,139,250,.15); }
[data-bs-theme="dark"] .qpi-btn-back {
  background: rgba(167,139,250,.10);
  border-color: rgba(167,139,250,.45);
  color: #c4b5fd;
}
[data-bs-theme="dark"] .qpi-btn-back:hover { background: rgba(167,139,250,.20); }

/* ═══════════════════════════════════════════════════════════════════════════
 * Responsive ladder
 *  ≤1100px  — drop wizard stepper / order-summary / form grid to 2 cols, WDH stacks
 *  ≤ 900px  — header tabs wrap below title, WDH cards lose min-height
 *  ≤ 680px  — tablebar stacks (search full-width, list pill + Create on row 2),
 *             form grids drop to 1 col, modal stepper + head collapse
 *  ≤ 520px  — pagination rows split, action chips & row text shrink, page padding tightens
 *  ≤ 400px  — modal backdrop padding minimised, modal pills reduce, Convert-to-PI button
 *             shrinks so 4-button action group fits on one row
 * ═══════════════════════════════════════════════════════════════════════ */
@media (max-width: 1100px) {
  .qpi-wdh-body { grid-template-columns: 1fr; }
  .qpi-wdh-arrow { display: none; }
  .qpi-form-grid { grid-template-columns: repeat(2, 1fr); }
  .qpi-order-summary { grid-template-columns: repeat(2, 1fr); }
  .qpi-totals-row { grid-template-columns: 1fr; }
}

@media (max-width: 900px) {
  .qpi-header { padding: 12px 14px; }
  .qpi-tab-switch { width: 100%; justify-content: flex-start; }
  .qpi-tab { flex: 1; justify-content: center; }
  .qpi-wdh-step { min-height: 0; }
  .qpi-wdh-body { padding: 6px 12px 10px; gap: 10px; }
}

@media (max-width: 680px) {
  .qpi-root { padding: 12px 10px 18px; }
  .qpi-header-title { font-size: 13.5px; }
  .qpi-header-sub   { font-size: 10.5px; }

  /* Tablebar stacks: search full-width on its own row */
  .qpi-tablebar { padding: 10px 12px; gap: 10px; }
  .qpi-search { order: -1; flex: 1 1 100%; min-width: 0; }
  .qpi-listpill, .qpi-pi-subtabs { flex: 1 1 auto; }
  .qpi-pi-subtabs { display: flex; }
  .qpi-pi-subtab { flex: 1; justify-content: center; }
  .qpi-create-btn { flex: 1 1 auto; justify-content: center; }

  /* Form / order-summary / wizard stepper / modal head all collapse */
  .qpi-form-grid { grid-template-columns: 1fr; }
  .qpi-order-summary { grid-template-columns: 1fr; }
  .qpi-modal-stepper { flex-direction: column; gap: 8px; padding: 14px 16px 10px; }
  .qpi-modal-step-divider { display: none; }
  .qpi-modal-head { flex-direction: column; align-items: flex-start; gap: 12px; padding: 14px 16px; }
  .qpi-modal-head-right { width: 100%; justify-content: space-between; }
  .qpi-modal-body { padding: 14px 16px; }
  .qpi-modal-foot { padding: 12px 16px; flex-wrap: wrap; gap: 10px; }
  .qpi-modal-foot-actions { flex: 1 1 100%; justify-content: flex-end; }
}

@media (max-width: 520px) {
  .qpi-root { padding: 10px 8px 16px; gap: 10px; }
  .qpi-header { padding: 10px 12px; gap: 10px; }
  .qpi-header-icon { width: 36px; height: 36px; }
  .qpi-header-title { font-size: 13px; }

  /* "What we are doing here" — tighter padding so it doesn't dominate */
  .qpi-wdh-header { padding: 8px 10px; }
  .qpi-wdh-body   { padding: 4px 10px 10px; }
  .qpi-wdh-step   { padding: 9px 10px; }

  /* Pagination split: info on row 1, rpp/range/arrows on row 2 */
  .qpi-pagination { padding: 10px 12px; gap: 8px; }
  .qpi-pag-info   { width: 100%; justify-content: center; }
  .qpi-pag-right  { width: 100%; justify-content: space-between; }
  .qpi-pag-rpp    { display: none; }

  /* Action buttons compress — Convert label hides, icon stays */
  .qpi-convert-btn-label { display: none; }
  .qpi-convert-btn { padding: 7px 9px; }

  /* Modal backdrop hugs the edge — give the modal more breathing room */
  .qpi-modal-backdrop { padding: 8px; }
  .qpi-modal { max-height: calc(100vh - 16px); border-radius: 12px; }
  .qpi-modal-head { padding: 12px 14px; gap: 10px; }
  .qpi-modal-pill { padding: 4px 10px; }
  .qpi-modal-pill-value { font-size: 11px; }
  .qpi-modal-body { padding: 12px 14px; }
  .qpi-modal-foot { padding: 10px 14px; }
  .qpi-btn-cancel, .qpi-btn-back, .qpi-btn-next, .qpi-btn-submit {
    padding: 9px 14px; font-size: 12px;
  }

  /* More-options portal'd menu fits within viewport */
  .qpi-moremenu { min-width: 180px; }
}

@media (max-width: 400px) {
  .qpi-root { font-size: 12px; }
  .qpi-modal-pill { padding: 3px 8px; }
  .qpi-modal-pill-label { font-size: 9px; }
  .qpi-modal-pill-value { font-size: 10.5px; }
  .qpi-actions { gap: 4px; }
  .qpi-act { width: 28px; height: 28px; }
  .qpi-convert-btn { padding: 6px 8px; }
  .qpi-listpill { padding: 8px 12px; font-size: 12px; }
  .qpi-products-table { min-width: 700px; }
}
`;
