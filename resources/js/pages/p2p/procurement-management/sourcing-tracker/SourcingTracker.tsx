import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Tooltip from '../../../../components/ui/Tooltip';
import WorklistPager from '../../../../components/ui/WorklistPager';
import { useFitPageSize } from '../../../../hooks/useFitPageSize';
import { useToast } from '../../../../contexts/ToastContext';
import {
  DUMMY_TARGETS, ME, TODAY, isComplete, progressPct, type SourcingTarget,
} from './data';
import AssignTargetModal from './AssignTargetModal';
import './sourcing-tracker.css';

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
const Svg = ({ size, sw = 2.2, children }: { size: number; sw?: number; children: ReactNode }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">{children}</svg>
);
const IcoStrip = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /><polyline points="8 11 10 13 14 9" />
  </svg>
);
const IcoPlus = () => <Svg size={13} sw={2.8}><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></Svg>;
const IcoTarget = () => <Svg size={15}><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1.2" /></Svg>;
const IcoRfq = () => (
  <Svg size={15}>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" />
    <path d="M9.5 13a2.5 2.5 0 1 1 3.2 2.4c-.5.2-.7.6-.7 1.1" /><line x1="12" y1="19" x2="12.01" y2="19" />
  </Svg>
);
const IcoSearch = () => <Svg size={15}><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></Svg>;
const IcoX = () => <Svg size={13} sw={2.4}><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></Svg>;
const IcoGrid = () => (
  <Svg size={14}>
    <rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" />
    <rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" />
  </Svg>
);
const IcoPen = () => <Svg size={14}><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" /></Svg>;
const IcoUser = () => <Svg size={14}><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></Svg>;
const IcoClock = () => <Svg size={12} sw={2.4}><circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 15.5 14" /></Svg>;
const IcoEdit = () => (
  <Svg size={15} sw={2.4}>
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z" />
  </Svg>
);
const IcoBars = () => <Svg size={12} sw={2.4}><path d="M18 20V10" /><path d="M12 20V4" /><path d="M6 20v-6" /><path d="M3 20h18" /></Svg>;

const SUB_TABS: { key: SubTab; label: string; icon: ReactNode }[] = [
  { key: 'all', label: 'All Sourcing Targets', icon: <IcoGrid /> },
  { key: 'created', label: 'Sourcing Target Created by Me', icon: <IcoPen /> },
  { key: 'assigned', label: 'Sourcing Target Assigned to Me', icon: <IcoUser /> },
];

/* ── Helpers ────────────────────────────────────────────────────────────── */
/** 2026-03-31 → 31/03/2026, the Figma's date format. */
const dmy = (iso: string) => { const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; };
const initials = (name: string) => name.split(/\s+/).filter(Boolean).map(w => w[0]).slice(0, 2).join('').toUpperCase();

/** On track / at risk (due within 7 days) / overdue — a finished target is always on track. */
function tatState(r: SourcingTarget): 'ontrack' | 'atrisk' | 'overdue' {
  if (isComplete(r)) return 'ontrack';
  const days = Math.round((Date.parse(r.dueDate) - Date.parse(TODAY)) / 86400000);
  if (days < 0) return 'overdue';
  return days <= 7 ? 'atrisk' : 'ontrack';
}

/* ── Row ────────────────────────────────────────────────────────────────── */
const TargetRow = memo(function TargetRow({ row, sr, onAction }: {
  row: SourcingTarget; sr: number; onAction: (a: RowAction, row: SourcingTarget) => void;
}) {
  const tat = tatState(row);
  const done = Math.min(row.completedProducts, row.totalProducts);
  const pending = row.totalProducts - done;
  const pct = progressPct(row);
  const full = isComplete(row);
  const more = row.totalProducts - 1;

  return (
    <div className="sct-row" role="row">
      <span className="sct-sr">{sr}</span>
      <span>
        <span className="sct-idcell">
          <span className="sct-idpill">{row.code}</span>
          <span className="sct-idcell__date">{dmy(row.startDate)}</span>
        </span>
      </span>
      <span className="sct-srcs">
        {row.sources.map(s => (
          <span key={s} className={`sct-src${s === 'Manual Entry' ? ' sct-src--manual' : ''}`}>{s}</span>
        ))}
      </span>
      <span className="sct-c">
        <span className={`sct-tat sct-tat--${tat}`}>
          <span className="sct-tat__date"><IcoClock />{dmy(row.dueDate)}</span>
          {tat === 'overdue' && <span className="sct-tat__overdue">Overdue</span>}
        </span>
      </span>
      <span className="sct-person">
        <span className="sct-av">{initials(row.createdBy)}</span>
        <span className="sct-person__name">{row.createdBy}</span>
      </span>
      <span className="sct-person">
        <span className="sct-av">{initials(row.assignedTo)}</span>
        <span className="sct-person__name">{row.assignedTo}</span>
      </span>
      <span>
        <Tooltip label="View Products">
          <button type="button" className="sct-prod" onClick={() => onAction('products', row)}>
            <span className="sct-prod__name">{row.firstProduct}</span>
            {more > 0 && <span className="sct-prod__more">+{more}</span>}
          </button>
        </Tooltip>
      </span>
      <span className="sct-c">
        <Tooltip label="View Sourcing Target Report">
          <button type="button" className="sct-pcount" onClick={() => onAction('report', row)}>{row.mappedSuppliers}</button>
        </Tooltip>
      </span>
      <span className="sct-c">
        <span className="sct-prog">
          <span className="sct-prog__head">
            <span className={`sct-st${full ? ' sct-st--done' : ''}`}><span className="sct-st__dot" />{full ? 'Completed' : 'In Progress'}</span>
            <span className={`sct-prog__pct${full ? ' is-done' : ''}`}>{pct}%</span>
          </span>
          <span className={`sct-bar${full ? ' is-done' : ''}`} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <span className="sct-bar__fill" style={{ width: `${pct}%` }} />
          </span>
          <span className="sct-legend">
            <span className="sct-lg sct-lg--done"><i />{done} done</span>
            <span className={`sct-lg sct-lg--pend${pending === 0 ? ' is-zero' : ''}`}><i />{pending} pending</span>
          </span>
        </span>
      </span>
      <span className="sct-c">
        <span className="sct-actions">
          <Tooltip label="Edit Sourcing Target">
            <button type="button" className="sct-edit" aria-label={`Edit ${row.code}`} onClick={() => onAction('edit', row)}><IcoEdit /></button>
          </Tooltip>
          {/* On tablet and phone the label hides and the button is icon-only;
              the tooltip and aria-label still name it. */}
          <Tooltip label="Sourcing Target Report">
            <button type="button" className="sct-report" aria-label={`Sourcing Target Report — ${row.code}`} onClick={() => onAction('report', row)}>
              <IcoBars /><span className="sct-report__lbl">Sourcing Target Report</span>
            </button>
          </Tooltip>
        </span>
      </span>
    </div>
  );
});

const HEAD = (
  <div className="sct-row sct-row--head" role="row">
    <span>Sr No</span>
    <span>Sourcing Target ID</span>
    <span>I Want to Source To</span>
    <span className="sct-c">Sourcing TAT</span>
    <span>Created By</span>
    <span>Assigned To</span>
    <span>Total Products</span>
    <span className="sct-c">Mapped Suppliers</span>
    <span className="sct-c">Sourcing Progress Status</span>
    <span className="sct-c">Action</span>
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

  /* As the Figma: "All" = created by me, then assigned to me, each target once.
     Built once — the dummy data is in memory, so there is no load to wait for
     (no fake delay). The loading skeleton is added with the API step. */
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
  useEffect(() => { if (rows.length) refit(); }, [rows.length, refit]);

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

  const switchMain = (t: MainTab) => { setMainTab(t); setPage(1); setQuery(''); };
  const switchSub = (t: SubTab) => { setSub(t); setPage(1); setQuery(''); };

  // The popups are the next design steps; until then each button says so.
  const onAction = useCallback((a: RowAction, row: SourcingTarget) => {
    if (a === 'edit') { setEditing(row); return; }
    const what = a === 'edit' ? 'Edit Sourcing Target' : a === 'report' ? 'Sourcing Target Report' : 'Product list';
    toast.info(`${what} — ${row.code}`, 'This popup is designed in the next step.');
  }, [toast]);
  const soon = (what: string) => toast.info(what, 'This popup is designed in the next step.');

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
            <span className="sct-strip__btn-sheen" /><IcoPlus />Assign Sourcing Target
          </button>
          <button type="button" className="sct-strip__btn" onClick={() => soon('Create RFQ')}>
            <span className="sct-strip__btn-sheen" /><IcoPlus />Create RFQ
          </button>
        </div>
      </div>

      <div className="sct-card">
        <div className="sct-mainrow">
          <div className="sct-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={isTargets} className={`sct-tab${isTargets ? ' is-active' : ''}`} onClick={() => switchMain('targets')}>
              <span className="sct-tab__ico"><IcoTarget /></span>Sourcing Target Management<span className="sct-tab__c">{counts.all}</span>
            </button>
            <button type="button" role="tab" aria-selected={!isTargets} className={`sct-tab${!isTargets ? ' is-active' : ''}`} onClick={() => switchMain('rfq')}>
              <span className="sct-tab__ico"><IcoRfq /></span>Request for Quotation (RFQ) Management<span className="sct-tab__c">129</span>
            </button>
          </div>
          <div className="sct-search">
            <IcoSearch />
            <input type="text" autoComplete="off" value={query} placeholder="Search by ID, person, source or status..."
              aria-label="Search sourcing targets" onChange={e => { setQuery(e.target.value); setPage(1); }} />
            {query && <button type="button" className="sct-search__clear" aria-label="Clear search" onClick={() => { setQuery(''); setPage(1); }}><IcoX /></button>}
          </div>
        </div>

        {isTargets && (
          <div className="sct-subrow">
            <div className="sct-subtabs" role="tablist">
              {SUB_TABS.map(t => (
                <button key={t.key} type="button" role="tab" aria-selected={sub === t.key}
                  className={`sct-subtab${sub === t.key ? ' is-active' : ''}`} onClick={() => switchSub(t.key)}>
                  <span className="sct-subtab__ico">{t.icon}</span>{t.label}<span className="sct-subtab__c">{counts[t.key]}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="sct-scroll" ref={scrollRef} onScroll={onTableScroll}>
          {!isTargets ? (
            <div className="sct-empty">
              <span className="sct-empty__ico"><IcoRfq /></span>
              <b>RFQ Management is designed next</b>
              <span>Requests for Quotation raised to the suppliers mapped on a sourcing target will be tracked here.</span>
            </div>
          ) : (
            <div role="table" aria-label="Sourcing targets">
              {HEAD}
              {pageRows.length === 0
                ? (
                  <div className="sct-empty" style={{ minHeight: 320 }}>
                    <span className="sct-empty__ico"><IcoSearch /></span>
                    <b>{query ? 'No results found' : 'No sourcing targets yet'}</b>
                    <span>{query ? 'Try a different search term.' : 'Use “Assign Sourcing Target” to create the first one.'}</span>
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

      {(assignOpen || editing) && (
        <AssignTargetModal
          existing={targets}
          initial={editing ?? undefined}
          onClose={() => { setAssignOpen(false); setEditing(null); }}
          onSave={t => {
            if (editing) {
              setTargets(prev => prev.map(r => (r.code === t.code ? t : r)));
              toast.info(`${t.code} updated`, `${t.totalProducts} product(s) on this target.`);
            } else {
              setTargets(prev => [{ ...t, createdBy: ME }, ...prev]);
              setSub('created'); setPage(1); setQuery('');
              toast.info(`${t.code} created`, `${t.totalProducts} product(s) assigned to ${t.assignedTo}.`);
            }
            setAssignOpen(false); setEditing(null);
          }}
        />
      )}
    </div>
  );
}
