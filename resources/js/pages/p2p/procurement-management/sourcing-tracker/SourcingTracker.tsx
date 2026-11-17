import { Suspense, lazy, memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Tooltip from '../../../../components/ui/Tooltip';
import { Shimmer } from '../../../../components/ui/Shimmer';
import WorklistPager from '../../../../components/ui/WorklistPager';
import { useFitPageSize } from '../../../../hooks/useFitPageSize';
import { useToast } from '../../../../contexts/ToastContext';
import {
  DUMMY_TARGETS, ME, isComplete, progressOf, tatState, type SourcingTarget, type TargetDraft,
} from './data';
import type { ReportProduct } from './targetProducts';
import { dmy, initials } from './format';
import './sourcing-tracker.css';
import { IcoBars, IcoClock, IcoEdit, IcoPen, IcoPlus, IcoSearch, IcoUser, IcoX, Svg } from './icons';

/* Every popup is lazy-loaded: each opens only on a click, so it (and its CSS) downloads the first
   time it is opened instead of with the page. Add Supplier (Convert to Supplier) is the big one,
   ~139 KB, and is only used for a New Supplier conversion. */
const AssignTargetModal = lazy(() => import('./AssignTargetModal'));
const SourcingTargetReport = lazy(() => import('./SourcingTargetReport'));
const ProductList = lazy(() => import('./ProductList'));
const MapSupplierModal = lazy(() => import('./MapSupplierModal'));
const AddVendorModal = lazy(() => import('../../p2p-master-management/supplier-management/AddVendorModal'));

/* ─────────────────────────────────────────────────────────────────────────
 * Sourcing Management Tracker — Procure to Pay (P2P) · Procurement Management.
 * Route: /p2p/sourcing-tracker. DESIGN BUILD on dummy data (./data.ts).
 *
 * The markup follows the Figma prototype element for element, and
 * sourcing-tracker.css carries the Figma's computed values, so the page
 * matches it pixel for pixel. The API is wired in after the design is
 * signed off. Bulk Sourcing is untouched.
 * ───────────────────────────────────────────────────────────────────────── */

type MainTab = 'targets' | 'rfq';
type SubTab = 'all' | 'created' | 'assigned';
type RowAction = 'edit' | 'report' | 'products';

const PAGE_SIZE_OPTIONS = [10, 25, 50];

/* ── Icons (the Figma's own glyphs) ─────────────────────────────────────── */
const IcoStrip = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /><polyline points="8 11 10 13 14 9" />
  </svg>
);
const IcoTarget = () => <Svg size={15}><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1.2" /></Svg>;
const IcoRfq = () => (
  <Svg size={15}>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" />
    <path d="M9.5 13a2.5 2.5 0 1 1 3.2 2.4c-.5.2-.7.6-.7 1.1" /><line x1="12" y1="19" x2="12.01" y2="19" />
  </Svg>
);
const IcoGrid = () => (
  <Svg size={14}>
    <rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" />
    <rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" />
  </Svg>
);

const SUB_TABS: { key: SubTab; label: string; icon: ReactNode }[] = [
  { key: 'all', label: 'All Sourcing Targets', icon: <IcoGrid /> },
  { key: 'created', label: 'Sourcing Target Created by Me', icon: <IcoPen size={14} /> },
  { key: 'assigned', label: 'Sourcing Target Assigned to Me', icon: <IcoUser size={14} /> },
];

/** RFQ Management is frozen (out of scope, BR 1.2); its count is a placeholder until it is built. */
const RFQ_COUNT = 129;

/* ── Loading ──────────────────────────────────────────────────────────────
   Page open and tab switch show skeleton rows in the table's own grid (same .sct-row class, so
   the header stays and the auto-fit page size keeps measuring). Design build: the data is dummy
   and would arrive in the same frame, so LOAD_PREVIEW_MS stands in for the API round trip —
   replace it with the real request when the API lands. */
const LOAD_PREVIEW_MS = 600;
const SWAP_PREVIEW_MS = 400;

/* One thin, even bar per column (like the CLM lists): calm while loading, and every column keeps
   its place so nothing jumps when the rows arrive. Widths are fixed per column, not random. */
const SKELETON_WIDTHS = ['45%', '70%', '75%', '70%', '80%', '80%', '75%', '45%', '85%', '85%'];

const SkeletonRows = memo(function SkeletonRows({ n }: { n: number }) {
  return (
    <>
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="sct-row sct-row--shim" aria-hidden>
          {SKELETON_WIDTHS.map((w, c) => <span key={c}><Shimmer width={w} height={12} radius={6} /></span>)}
        </div>
      ))}
    </>
  );
});

/* ── Row ────────────────────────────────────────────────────────────────── */
const TargetRow = memo(function TargetRow({ row, sr, onAction }: {
  row: SourcingTarget; sr: number; onAction: (a: RowAction, row: SourcingTarget) => void;
}) {
  const tat = tatState(row);
  const { done, pending, pct, full } = progressOf(row);
  const more = row.totalProducts - 1;

  return (
    <div className="sct-row" role="row">
      <span role="cell" className="sct-sr">{sr}</span>
      <span role="cell">
        <span className="sct-idcell">
          <span className="sct-idpill">{row.code}</span>
          <span className="sct-idcell__date">{dmy(row.startDate)}</span>
        </span>
      </span>
      <span role="cell" className="sct-srcs">
        {row.sources.map(s => (
          <span key={s} className={`sct-src${s === 'Manual Entry' ? ' sct-src--manual' : ''}`}>{s}</span>
        ))}
      </span>
      <span role="cell" className="sct-c">
        <span className={`sct-tat sct-tat--${tat}`}>
          <span className="sct-tat__date"><IcoClock size={12} sw={2.4} />{dmy(row.dueDate)}</span>
          {tat === 'overdue' && <span className="sct-tat__overdue">Overdue</span>}
        </span>
      </span>
      <span role="cell" className="sct-person">
        <span className="sct-av">{initials(row.createdBy)}</span>
        <span className="sct-person__name">{row.createdBy}</span>
      </span>
      <span role="cell" className="sct-person">
        <span className="sct-av">{initials(row.assignedTo)}</span>
        <span className="sct-person__name">{row.assignedTo}</span>
      </span>
      <span role="cell">
        <Tooltip label="View Products">
          <button type="button" className="sct-prod" aria-label={`${row.firstProduct}${more > 0 ? ` and ${more} more` : ''}: view products of ${row.code}`}
            onClick={() => onAction('products', row)}>
            <span className="sct-prod__name">{row.firstProduct}</span>
            {more > 0 && <span className="sct-prod__more">+{more}</span>}
          </button>
        </Tooltip>
      </span>
      <span role="cell" className="sct-c">
        {/* 0 mapped: a grey badge, not clickable (CS-2219 V-T82). */}
        {row.mappedSuppliers > 0 ? (
          <Tooltip label="View Sourcing Target Report">
            <button type="button" className="sct-pcount" aria-label={`${row.mappedSuppliers} mapped suppliers: view report of ${row.code}`}
              onClick={() => onAction('report', row)}>{row.mappedSuppliers}</button>
          </Tooltip>
        ) : <span className="sct-pcount is-zero"><span aria-hidden>0</span><span className="visually-hidden">No suppliers mapped</span></span>}
      </span>
      <span role="cell" className="sct-c">
        <span className="sct-prog">
          <span className="sct-prog__head">
            <span className={`sct-st${full ? ' sct-st--done' : ''}`}><span className="sct-st__dot" />{full ? 'Completed' : 'In Progress'}</span>
            <span className={`sct-prog__pct${full ? ' is-done' : ''}`}>{pct}%</span>
          </span>
          <span className={`sct-bar${full ? ' is-done' : ''}`} role="progressbar" aria-label="Sourcing progress" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <span className="sct-bar__fill" style={{ width: `${pct}%` }} />
          </span>
          <span className="sct-legend">
            <span className="sct-lg sct-lg--done"><i />{done} done</span>
            <span className={`sct-lg sct-lg--pend${pending === 0 ? ' is-zero' : ''}`}><i />{pending} pending</span>
          </span>
        </span>
      </span>
      <span role="cell" className="sct-c">
        <span className="sct-actions">
          <Tooltip label="Edit Sourcing Target">
            <button type="button" className="sct-edit" aria-label={`Edit ${row.code}`} onClick={() => onAction('edit', row)}><IcoEdit size={15} sw={2.4} /></button>
          </Tooltip>
          {/* On tablet and phone the label hides and the button is icon-only;
              the tooltip and aria-label still name it. */}
          <Tooltip label="Sourcing Target Report">
            <button type="button" className="sct-report" aria-label={`Sourcing Target Report — ${row.code}`} onClick={() => onAction('report', row)}>
              <IcoBars size={12} sw={2.4} /><span className="sct-report__lbl">Sourcing Target Report</span>
            </button>
          </Tooltip>
        </span>
      </span>
    </div>
  );
});

const HEAD = (
  <div className="sct-row sct-row--head" role="row">
    <span role="columnheader">Sr No</span>
    <span role="columnheader">Sourcing Target ID</span>
    <span role="columnheader">I Want to Source To</span>
    <span role="columnheader" className="sct-c">Sourcing TAT</span>
    <span role="columnheader">Created By</span>
    <span role="columnheader">Assigned To</span>
    <span role="columnheader">Total Products</span>
    <span role="columnheader" className="sct-c">Mapped Suppliers</span>
    <span role="columnheader" className="sct-c">Sourcing Progress Status</span>
    <span role="columnheader" className="sct-c">Action</span>
  </div>
);

/* ── Page ───────────────────────────────────────────────────────────────── */
export default function SourcingTracker() {
  const toast = useToast();
  const [mainTab, setMainTab] = useState<MainTab>('targets');
  const [sub, setSub] = useState<SubTab>('all');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [targets, setTargets] = useState<SourcingTarget[]>(DUMMY_TARGETS);
  const [assignOpen, setAssignOpen] = useState(false);
  const [editing, setEditing] = useState<SourcingTarget | null>(null);
  const [reportRow, setReportRow] = useState<SourcingTarget | null>(null);
  // Total Products → the read-only Product List popup ("View More").
  const [productsRow, setProductsRow] = useState<SourcingTarget | null>(null);
  // Convert to Supplier (CS-2222): the New Supplier being converted, and the ones already done.
  // The real Supplier Management form saves the supplier; our mapping side is dummy, so
  // "converted" is remembered on screen only (the card then reads Master). API later.
  const [converting, setConverting] = useState<{ key: string; name: string } | null>(null);
  const [converted, setConverted] = useState<ReadonlySet<string>>(() => new Set());
  const [mapTarget, setMapTarget] = useState<{ row: SourcingTarget; product: ReportProduct } | null>(null);

  /* As the Figma: "All" = created by me, then assigned to me, each target once. Built from the
     in-memory dummy data; the loading skeleton below covers the wait the API will add. */
  const { lists, counts } = useMemo(() => {
    const created = targets.filter(r => r.createdBy === ME);
    const assigned = targets.filter(r => r.assignedTo === ME);
    const seen = new Set<string>();
    const all = [...created, ...assigned].filter(r => (seen.has(r.code) ? false : (seen.add(r.code), true)));
    return {
      lists: { all, created, assigned },
      counts: { all: all.length, created: created.length, assigned: assigned.length } as Record<SubTab, number>,
    };
  }, [targets]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return lists[sub];
    return lists[sub].filter(r => [
      r.code, r.sources.join(' '), r.createdBy, r.assignedTo, r.firstProduct,
      isComplete(r) ? 'completed' : 'in progress', tatState(r) === 'overdue' ? 'overdue' : '',
      dmy(r.startDate), dmy(r.dueDate),
    ].join(' ').toLowerCase().includes(q));
  }, [lists, sub, query]);

  /* Rows per page fit the table area, as on every app list (useFitPageSize):
     no row is cut off at the bottom. The user's own pick in the pager sticks. */
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [pageSize, choosePageSize, refit] = useFitPageSize(scrollRef, {
    min: 4,
    rowSelector: '.sct-row:not(.sct-row--head)',
    headSelector: '.sct-row--head',
    deps: [mainTab, sub],
  });

  /* While the table scrolls, rows sliding under the mouse must not fire their
     hovers (buttons lifting, row tint, tooltips) — that is what made the
     scroll bounce. The mouse is ignored until 150ms after the last scroll.
     Refs and a class, not state: scroll fires many times a second and must
     not re-render. The CSS rule targets only the table element, so adding or
     removing the class restyles that one element, not the page. */
  const scrollTimer = useRef<number | undefined>(undefined);
  const onTableScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (!el.classList.contains('is-scrolling')) el.classList.add('is-scrolling');
    window.clearTimeout(scrollTimer.current);
    scrollTimer.current = window.setTimeout(() => el.classList.remove('is-scrolling'), 150);
  }, []);
  useEffect(() => () => window.clearTimeout(scrollTimer.current), []);

  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.min(page, pages);
  const start = (safePage - 1) * pageSize;
  const pageRows = rows.slice(start, start + pageSize);

  // Loading: the first open, then a short swap on every tab switch (skeleton rows meanwhile).
  const [booting, setBooting] = useState(true);
  const [swapping, setSwapping] = useState(false);
  const swapTimer = useRef<number | undefined>(undefined);
  useEffect(() => {
    const t = window.setTimeout(() => setBooting(false), LOAD_PREVIEW_MS);   // API call goes here
    return () => { window.clearTimeout(t); window.clearTimeout(swapTimer.current); };
  }, []);
  const swap = () => {
    setSwapping(true);
    window.clearTimeout(swapTimer.current);
    swapTimer.current = window.setTimeout(() => setSwapping(false), SWAP_PREVIEW_MS);   // API call goes here
  };
  const loading = booting || swapping;
  // Re-fit on the real rows once the skeleton is gone (it has its own row height).
  useEffect(() => { if (!loading && rows.length) refit(); }, [loading, rows.length, refit]);
  const switchMain = (t: MainTab) => { if (t === mainTab) return; setMainTab(t); setPage(1); setQuery(''); swap(); };
  const switchSub = (t: SubTab) => { if (t === sub) return; setSub(t); setPage(1); setQuery(''); swap(); };

  // Row actions open the popups. Callbacks are stable (useCallback) so a page re-render does not
  // re-run the popups' Esc and scroll-lock effects.
  const onAction = useCallback((a: RowAction, row: SourcingTarget) => {
    if (a === 'edit') setEditing(row);
    else if (a === 'report') setReportRow(row);
    else setProductsRow(row);
  }, []);
  const closeAssign = useCallback(() => { setAssignOpen(false); setEditing(null); }, []);
  const closeProducts = useCallback(() => setProductsRow(null), []);
  const closeReport = useCallback(() => setReportRow(null), []);
  const closeMap = useCallback(() => setMapTarget(null), []);
  const closeConvert = useCallback(() => setConverting(null), []);
  const openMap = useCallback((row: SourcingTarget, product: ReportProduct) => setMapTarget({ row, product }), []);
  // Add: the current user creates it, and the list switches to Created by Me. Edit: Created By is kept.
  const saveTarget = useCallback((t: TargetDraft) => {
    if (editing) {
      const updated = { ...t, createdBy: editing.createdBy };
      setTargets(prev => prev.map(r => (r.code === t.code ? updated : r)));
      toast.info(`${t.code} updated`, `${t.totalProducts} product(s) on this target.`);
    } else {
      setTargets(prev => [{ ...t, createdBy: ME }, ...prev]);
      setSub('created'); setPage(1); setQuery('');
      toast.info(`${t.code} created`, `${t.totalProducts} product(s) assigned to ${t.assignedTo}.`);
    }
    setAssignOpen(false); setEditing(null);
  }, [editing, toast]);
  const finishMap = useCallback((supplier: string) => {
    if (mapTarget) toast.info('Supplier mapped', `${supplier} mapped to ${mapTarget.product.name}.`);
    setMapTarget(null);
  }, [mapTarget, toast]);
  const finishConvert = useCallback((payload: { companyName: string }) => {
    if (converting) {
      setConverted(prev => new Set(prev).add(converting.key));
      toast.success(`${payload.companyName || converting.name} added to Supplier Master`, 'The mapping now shows this supplier as Master.');
    }
    setConverting(null);
  }, [converting, toast]);
  // FR-2222-02: the Mapped Suppliers popup and the report close, then the Add Supplier form opens.
  const startConvert = useCallback((key: string, name: string) => { setReportRow(null); setConverting({ key, name }); }, []);

  const isTargets = mainTab === 'targets';

  return (
    <div className="sct-page">

      <div className="sct-strip">
        <span className="sct-strip__accent" /><span className="sct-strip__glow" /><span className="sct-strip__sheen" />
        <div className="sct-strip__left">
          <div className="sct-strip__avatar-wrap">
            <div className="sct-strip__avatar"><IcoStrip /></div>
            <span className="sct-strip__dot" />
          </div>
          <div>
            <div className="sct-strip__title">Sourcing Management Tracker</div>
            <div className="sct-strip__sub">Manage Requests for Quotation (RFQ) and sourcing targets — in one place.</div>
          </div>
        </div>
        <div className="sct-strip__right">
          <button type="button" className="sct-strip__btn" onClick={() => setAssignOpen(true)}>
            <span className="sct-strip__btn-sheen" /><IcoPlus size={13} sw={2.8} />Assign Sourcing Target
          </button>
          {/* RFQ is out of scope for Sourcing Target Management (BR 1.2): frozen until its own build.
              A disabled button gets no hover, so the tooltip sits on a wrapper. */}
          <Tooltip label="RFQ Management — coming soon">
            <span className="sct-frozen-wrap">
              <button type="button" className="sct-strip__btn is-frozen" disabled aria-disabled="true">
                <span className="sct-strip__btn-sheen" /><IcoPlus size={13} sw={2.8} />Create RFQ
              </button>
            </span>
          </Tooltip>
        </div>
      </div>

      <div className="sct-card">
        <div className="sct-mainrow">
          <div className="sct-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={isTargets} className={`sct-tab${isTargets ? ' is-active' : ''}`} onClick={() => switchMain('targets')}>
              <span className="sct-tab__ico"><IcoTarget /></span>Sourcing Target Management<span className="sct-tab__c">{booting ? 0 : counts.all}</span>
            </button>
            {/* Frozen with Create RFQ (out of scope, BR 1.2): the tab shows but cannot be opened. */}
            <Tooltip label="RFQ Management — coming soon">
              <span className="sct-frozen-wrap">
                <button type="button" role="tab" aria-selected={false} aria-disabled="true" disabled className="sct-tab is-frozen">
                  <span className="sct-tab__ico"><IcoRfq /></span>Request for Quotation (RFQ) Management<span className="sct-tab__c">{RFQ_COUNT}</span>
                </button>
              </span>
            </Tooltip>
          </div>
          <div className="sct-search">
            <IcoSearch size={15} />
            <input type="text" autoComplete="off" value={query} placeholder="Search by ID, person, source or status..."
              aria-label="Search sourcing targets" onChange={e => { setQuery(e.target.value); setPage(1); }} />
            {query && <button type="button" className="sct-search__clear" aria-label="Clear search" onClick={() => { setQuery(''); setPage(1); }}><IcoX size={13} sw={2.4} /></button>}
          </div>
        </div>

        {isTargets && (
          <div className="sct-subrow">
            <div className="sct-subtabs" role="tablist">
              {SUB_TABS.map(t => (
                <button key={t.key} type="button" role="tab" aria-selected={sub === t.key}
                  className={`sct-subtab${sub === t.key ? ' is-active' : ''}`} onClick={() => switchSub(t.key)}>
                  <span className="sct-subtab__ico">{t.icon}</span>{t.label}<span className="sct-subtab__c">{booting ? 0 : counts[t.key]}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="sct-scroll sct-scroller" ref={scrollRef} onScroll={onTableScroll}>
          {!isTargets ? (
            <div className="sct-empty">
              <span className="sct-empty__ico"><IcoRfq /></span>
              <b>RFQ Management is designed next</b>
              <span>Requests for Quotation raised to the suppliers mapped on a sourcing target will be tracked here.</span>
            </div>
          ) : (
            <div className="sct-grid" role="table" aria-label="Sourcing targets" aria-busy={loading || undefined}>
              {HEAD}
              {loading ? <SkeletonRows n={pageSize} />
              : pageRows.length === 0
                ? (
                  <div className="sct-empty sct-empty--list" role="row">
                    <span className="sct-empty__ico" aria-hidden><IcoSearch size={15} /></span>
                    <b role="cell">{query ? 'No results found' : 'No sourcing targets yet'}</b>
                    <span role="cell">{query ? 'Try a different search term.' : 'Use “Assign Sourcing Target” to create the first one.'}</span>
                  </div>
                )
                : pageRows.map((r, i) => <TargetRow key={r.code} row={r} sr={start + i + 1} onAction={onAction} />)}
            </div>
          )}
        </div>

        {isTargets && (
          <WorklistPager
            className="wl-teal"
            total={rows.length}
            page={safePage}
            pageSize={pageSize}
            onPage={setPage}
            onPageSize={n => { choosePageSize(n); setPage(1); }}
            pageSizeOptions={PAGE_SIZE_OPTIONS}
          />
        )}
      </div>

      {/* One Suspense per popup: a popup whose chunk is still loading must not hide one that is
          already open (Map Supplier opens on top of the Report). */}
      {(assignOpen || editing) && (
        <Suspense fallback={null}>
          <AssignTargetModal
            existing={targets}
            initial={editing ?? undefined}
            onClose={closeAssign}
            onSave={saveTarget}
          />
        </Suspense>
      )}
      {productsRow && (
        <Suspense fallback={null}><ProductList row={productsRow} onClose={closeProducts} /></Suspense>
      )}
      {reportRow && (
        <Suspense fallback={null}>
          <SourcingTargetReport
            row={reportRow}
            onClose={closeReport}
            onMapSupplier={openMap}   // the report stays open behind
            converted={converted}
            onConvert={startConvert}
          />
        </Suspense>
      )}
      {converting && (
        <Suspense fallback={null}>
          <AddVendorModal
            canMapProducts={false}
            onClose={closeConvert}   // cancelled: stays New Supplier with its mapping (V-T46)
            onSubmit={finishConvert}
          />
        </Suspense>
      )}
      {mapTarget && (
        <Suspense fallback={null}>
          <MapSupplierModal
            product={mapTarget.product}
            onClose={closeMap}
            onMapped={finishMap}
          />
        </Suspense>
      )}

    </div>
  );
}
