import { Suspense, lazy, memo, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import Tooltip from '../../../../components/ui/Tooltip';
import { Shimmer } from '../../../../components/ui/Shimmer';
import WorklistPager from '../../../../components/ui/WorklistPager';
import { useFitPageSize } from '../../../../hooks/useFitPageSize';
import { useToast } from '../../../../contexts/ToastContext';
import { useAuth } from '../../../../contexts/AuthContext';
import api from '../../../../api';
// Type-only: the Add Supplier form itself stays lazy-loaded (below).
import type { SupplierPrefill, VendorPayload } from '../../p2p-master-management/supplier-management/AddVendorModal';
import { apiErrorMessage } from './apiError';
import type { MapEdit } from './MapSupplierModal';
import {
  fromApi, progressOf, tatState, type ApiTargetRow, type SourcingTarget,
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
 * Route: /p2p/sourcing-tracker.
 *
 * The markup follows the Figma prototype element for element, and
 * sourcing-tracker.css carries the Figma's computed values. The list is
 * GET /p2p/sourcing-targets?tab=all|created|assigned: the server does the
 * tab, search and paging; data.counts fills the three badges. Bulk Sourcing
 * reads the same targets and is untouched.
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
   While a page is fetched the table shows skeleton rows in its own grid (same .sct-row class, so
   the header stays and the auto-fit page size keeps measuring). */

/** Typing in the search waits this long before asking the server. */
const SEARCH_DEBOUNCE_MS = 300;

type ListResponse = {
  data?: {
    rows?: ApiTargetRow[];
    counts?: Partial<Record<SubTab, number>>;
    pagination?: { page?: number; total?: number };
  };
};

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
const TargetRow = memo(function TargetRow({ row, sr, canEdit, onAction }: {
  row: SourcingTarget; sr: number;
  /** Only the target's creator may edit it (the API answers 403 to anyone else). */
  canEdit: boolean;
  onAction: (a: RowAction, row: SourcingTarget) => void;
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
          {canEdit ? (
            <Tooltip label="Edit Sourcing Target">
              <button type="button" className="sct-edit" aria-label={`Edit ${row.code}`} onClick={() => onAction('edit', row)}><IcoEdit size={15} sw={2.4} /></button>
            </Tooltip>
          ) : (
            // Kept in place (the column does not shift) but off: a disabled button gets no hover,
            // so the tooltip sits on a wrapper.
            <Tooltip label="Only the creator can edit this target">
              <span className="sct-frozen-wrap">
                <button type="button" className="sct-edit is-off" disabled aria-label={`Edit ${row.code} — only the creator can edit`}><IcoEdit size={15} sw={2.4} /></button>
              </span>
            </Tooltip>
          )}
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
  const { user } = useAuth();
  const myId = user?.id != null ? String(user.id) : null;
  const [mainTab, setMainTab] = useState<MainTab>('targets');
  const [sub, setSub] = useState<SubTab>('all');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  // The current page of the current tab, as the server returned it.
  const [pageRows, setPageRows] = useState<SourcingTarget[]>([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<Record<SubTab, number>>({ all: 0, created: 0, assigned: 0 });
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  // Bumped to fetch the same page again (Retry, after a save).
  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(() => setReloadKey(k => k + 1), []);
  const [assignOpen, setAssignOpen] = useState(false);
  const [editing, setEditing] = useState<SourcingTarget | null>(null);
  const [reportRow, setReportRow] = useState<SourcingTarget | null>(null);
  // Total Products → the read-only Product List popup ("View More").
  const [productsRow, setProductsRow] = useState<SourcingTarget | null>(null);
  /* Convert to Supplier (CS-2222): 1. GET /p2p/new-suppliers/{id}/convert pre-fills the real Add
     Supplier form (Supplier Management); 2. that form saves the supplier as usual; 3. POST
     /p2p/new-suppliers/{id}/convert { vendor_id } links it, and its mappings become Supplier Master
     rows. The report closes while the form is open (FR-2222-02) and comes back after. */
  const [converting, setConverting] = useState<{
    supplierId: number; name: string; row: SourcingTarget | null;
    scope: 'domestic' | 'international'; prefill: SupplierPrefill;
  } | null>(null);
  const [converted, setConverted] = useState<ReadonlySet<string>>(() => new Set());
  const [mapTarget, setMapTarget] = useState<{ row: SourcingTarget; product: ReportProduct; edit?: MapEdit } | null>(null);

  // Search goes to the server (q) once typing pauses.
  const [q, setQ] = useState('');
  useEffect(() => {
    // A new search starts on page 1; the page resets with the search itself, so typing fires no extra request.
    const t = window.setTimeout(() => {
      const next = query.trim();
      setQ(prev => { if (prev !== next) setPage(1); return next; });
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [query]);

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

  /* One request per tab / page / page size / search. A newer request wins: the answer of an older
     one that arrives late is dropped, so a fast tab switch never shows the wrong tab's rows. */
  const reqSeq = useRef(0);
  // What the last answer covered: when only the page size grows and that answer already held every
  // row, there is nothing new to ask for (the auto-fit re-measures once the real rows are in).
  const lastServed = useRef<{ key: string; complete: boolean } | null>(null);
  useEffect(() => {
    if (mainTab !== 'targets') return;
    const key = `${sub}|${q}|${reloadKey}`;
    if (page === 1 && lastServed.current?.key === key && lastServed.current.complete) { setLoading(false); return; }
    const seq = ++reqSeq.current;
    setLoading(true);
    setFailed(false);
    // A short wait folds the quick page-size changes of the first layout into one request.
    const t = window.setTimeout(() => {
      api.get<ListResponse>('/p2p/sourcing-targets', {
        params: { tab: sub, page, per_page: pageSize, ...(q ? { q } : {}) },
      })
        .then(res => {
          if (seq !== reqSeq.current) return;
          const d = res.data?.data;
          const list = d?.rows ?? [];
          const all = d?.pagination?.total ?? 0;
          setPageRows(list.map(fromApi));
          setTotal(all);
          setCounts({ all: d?.counts?.all ?? 0, created: d?.counts?.created ?? 0, assigned: d?.counts?.assigned ?? 0 });
          // The server clamps a page past the end (e.g. after the page size grew); follow it.
          const served = d?.pagination?.page ?? page;
          lastServed.current = { key, complete: served === 1 && list.length >= all };
          if (served !== page) setPage(served);
        })
        .catch(() => {
          if (seq !== reqSeq.current) return;
          lastServed.current = null;
          setPageRows([]); setTotal(0); setFailed(true);
        })
        .finally(() => { if (seq === reqSeq.current) setLoading(false); });
    }, 120);
    return () => window.clearTimeout(t);
  }, [mainTab, sub, page, pageSize, q, reloadKey]);

  // The badges read 0 only until the first answer arrives.
  const [booted, setBooted] = useState(false);
  useEffect(() => { if (!loading && !booted) setBooted(true); }, [loading, booted]);
  const start = (page - 1) * pageSize;
  // Re-fit on the real rows once the skeleton is gone (it has its own row height).
  useEffect(() => { if (!loading && pageRows.length) refit(); }, [loading, pageRows.length, refit]);
  const switchMain = (t: MainTab) => { if (t === mainTab) return; setMainTab(t); setPage(1); setQuery(''); setQ(''); };
  const switchSub = (t: SubTab) => { if (t === sub) return; setSub(t); setPage(1); setQuery(''); setQ(''); };

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
  // Cancelled: the supplier stays a New Supplier with its mapping (V-T46); the report comes back.
  const closeConvert = useCallback(() => {
    if (converting?.row) setReportRow(converting.row);
    setConverting(null);
  }, [converting]);
  const openMap = useCallback((row: SourcingTarget, product: ReportProduct) => setMapTarget({ row, product }), []);
  // Edit a mapped New Supplier: the same Map Supplier popup, opened on its form with the saved values.
  const openEditSupplier = useCallback((row: SourcingTarget, product: ReportProduct, edit: MapEdit) => setMapTarget({ row, product, edit }), []);
  // Saved on the server: Add switches to Created by Me (the new target is on top); then the list is
  // fetched again so it shows what the server holds.
  const saveTarget = useCallback((r: { code: string; count: number; assignee: string; isEdit: boolean }) => {
    if (r.isEdit) {
      toast.success(`${r.code} updated`, `${r.count} product(s) on this target.`);
    } else {
      setSub('created'); setPage(1); setQuery(''); setQ('');
      toast.success(`${r.code} created`, `${r.count} product(s) assigned to ${r.assignee || 'the team member'}.`);
    }
    setAssignOpen(false); setEditing(null);
    reload();
  }, [toast, reload]);
  // After a supplier is mapped the open report and the list load again (counts and status change).
  const [reportRefresh, setReportRefresh] = useState(0);
  const finishMap = useCallback((supplier: string) => {
    if (mapTarget) {
      if (mapTarget.edit) toast.success('Supplier updated', `${supplier} on ${mapTarget.product.name} is updated.`);
      else toast.info('Supplier mapped', `${supplier} mapped to ${mapTarget.product.name}.`);
    }
    setMapTarget(null);
    setReportRefresh(n => n + 1);
    reload();
  }, [mapTarget, toast, reload]);
  const finishConvert = useCallback(async (payload: VendorPayload) => {
    const c = converting;
    setConverting(null);
    if (!c) return;
    const back = () => { if (c.row) setReportRow(c.row); };
    if (!payload.vendorId) {
      toast.error('Supplier saved, not linked', `${payload.companyName || c.name} was saved, but its id did not come back. Open Convert to Supplier again to link it.`);
      back();
      return;
    }
    try {
      const r = await api.post<{ data?: { message?: string } }>(`/p2p/new-suppliers/${c.supplierId}/convert`, { vendor_id: payload.vendorId });
      setConverted(prev => new Set(prev).add(`new-${c.supplierId}`));
      toast.success('Converted to Supplier', r.data?.data?.message || `${payload.companyName || c.name} is now in the Supplier Master.`);
      setReportRefresh(n => n + 1);
      reload();
    } catch (e) {
      toast.error('Supplier saved, not linked', apiErrorMessage(e, 'The supplier was saved but could not be linked. Please try again.'));
    }
    back();
  }, [converting, toast, reload]);
  // FR-2222-02: the Mapped Suppliers popup and the report close, then the Add Supplier form opens.
  const startConvert = useCallback(async (supplierId: number, name: string) => {
    const row = reportRow;
    setReportRow(null);
    try {
      // The response is the shared Add Supplier prefill (the same one Bulk Sourcing uses), plus `converted`.
      const r = await api.get<{ data: Partial<SupplierPrefill> & { converted?: boolean } }>(`/p2p/new-suppliers/${supplierId}/convert`);
      const d = r.data?.data ?? {};
      if (d.converted) {
        toast.info(`${name} is already in the Supplier Master`, 'Its mappings show it as Master.');
        setReportRefresh(n => n + 1);
        if (row) setReportRow(row);
        return;
      }
      const origin = d.origin === 'international' ? 'international' : 'domestic';
      setConverting({
        supplierId, name, row, scope: origin,
        prefill: { origin, identity: { ...d.identity, company_name: d.identity?.company_name ?? name }, address: d.address ?? {} },
      });
    } catch (e) {
      toast.error('Couldn’t open Convert to Supplier', apiErrorMessage(e, 'Please try again.'));
      if (row) setReportRow(row);
    }
  }, [reportRow, toast]);

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
              <span className="sct-tab__ico"><IcoTarget /></span>Sourcing Target Management<span className="sct-tab__c">{booted ? counts.all : 0}</span>
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
              aria-label="Search sourcing targets" onChange={e => setQuery(e.target.value)} />
            {query && <button type="button" className="sct-search__clear" aria-label="Clear search" onClick={() => setQuery('')}><IcoX size={13} sw={2.4} /></button>}
          </div>
        </div>

        {isTargets && (
          <div className="sct-subrow">
            <div className="sct-subtabs" role="tablist">
              {SUB_TABS.map(t => (
                <button key={t.key} type="button" role="tab" aria-selected={sub === t.key}
                  className={`sct-subtab${sub === t.key ? ' is-active' : ''}`} onClick={() => switchSub(t.key)}>
                  <span className="sct-subtab__ico">{t.icon}</span>{t.label}<span className="sct-subtab__c">{booted ? counts[t.key] : 0}</span>
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
              : failed
                ? (
                  <div className="sct-empty sct-empty--list" role="row">
                    <span className="sct-empty__ico" aria-hidden><IcoX size={15} /></span>
                    <b role="cell">Couldn’t load sourcing targets</b>
                    <span role="cell">Check your connection and try again.</span>
                    <button type="button" className="sct-retry" onClick={reload}>Retry</button>
                  </div>
                )
              : pageRows.length === 0
                ? (
                  <div className="sct-empty sct-empty--list" role="row">
                    <span className="sct-empty__ico" aria-hidden><IcoSearch size={15} /></span>
                    <b role="cell">{q ? 'No results found' : 'No sourcing targets yet'}</b>
                    <span role="cell">{q ? 'Try a different search term.' : 'Use “Assign Sourcing Target” to create the first one.'}</span>
                  </div>
                )
                : pageRows.map((r, i) => <TargetRow key={r.code} row={r} sr={start + i + 1} canEdit={!!myId && r.createdById === myId} onAction={onAction} />)}
            </div>
          )}
        </div>

        {isTargets && (
          <WorklistPager
            className="wl-teal"
            total={total}
            page={page}
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
            initial={editing ?? undefined}
            onClose={closeAssign}
            onSaved={saveTarget}
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
            onEditSupplier={openEditSupplier}
            converted={converted}
            onConvert={startConvert}
            canMap={!!myId && reportRow.assigneeId === myId}
            refreshKey={reportRefresh}
          />
        </Suspense>
      )}
      {converting && (
        <Suspense fallback={null}>
          <AddVendorModal
            scope={converting.scope}
            prefill={converting.prefill}
            convertSupplierId={converting.supplierId}   // the server knows this New Supplier's email is not a duplicate
            canMapProducts={false}
            onClose={closeConvert}   // cancelled: stays New Supplier with its mapping (V-T46)
            onSubmit={p => { void finishConvert(p); }}
          />
        </Suspense>
      )}
      {mapTarget && (
        <Suspense fallback={null}>
          <MapSupplierModal
            targetCode={mapTarget.row.code}
            product={mapTarget.product}
            edit={mapTarget.edit}
            onClose={closeMap}
            onMapped={finishMap}
          />
        </Suspense>
      )}

    </div>
  );
}
