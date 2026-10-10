import { lazy, Suspense, useState, useCallback, useEffect, useMemo, useRef, useDeferredValue } from 'react';
import type { ReactNode } from 'react';
/* The P2P stylesheets, and NOTHING of our own.
   `p2p-common.css` carries the page chrome every P2P screen shares — the teal
   head strip, the "What We Are Doing Here" panel and its step cards, the
   segmented tabs, the sub-tabs and the search box. `order.css` carries the
   table and its cells. Between them there is nothing left for this page to
   define, which is why there is no invoice.css. */
import '../../p2p-common.css';
import '../order/po-list/order.css';
import { INVOICE_STEPS } from './steps';
import { INVOICE_ROWS, NEXT_INVOICE_NO, STORAGE_WAREHOUSES } from './data';
import { InvoiceTable } from './InvoiceTable';
import WorklistPager from '../../../../components/ui/WorklistPager';
import { useFitPageSize } from '../../../../hooks/useFitPageSize';
import MapInvoiceModal, { type InvoiceMapChoice } from './MapInvoiceModal';
import InvoicePaymentsModal from './InvoicePaymentsModal';
const PutawaySummary = lazy(() => import('./PutawaySummary'));
/* The row's document vault — lazy, and it carries a stylesheet of its own. */
const InvoiceEvidenceVault = lazy(() => import('./InvoiceEvidenceVault'));
import StorageSelectionModal, { type StorageChoice } from './StorageSelectionModal';
import InvoiceForm, { type InvoiceFormInput } from './InvoiceForm';
import type { InvoiceAction } from './cells/RowActions';
import type { InvoiceRow, InvoiceScope, InvoiceShipmentScope } from './types';

/* The sizes the PO list offers, so the two footers read the same. */
const PAGE_SIZE_OPTIONS = [10, 25, 50];

/**
 * Invoice (Supplier Purchase Invoice) — the list page.
 *
 * Every class here belongs to a shared P2P stylesheet. The page was first built
 * with its own `inv-*` namespace, which turned out to be a re-implementation of
 * rules that already existed: `.spi-head` is byte-identical to the teal strip
 * the design shows, down to the #9ce1ee border and the five-stop gradient.
 * That stylesheet is gone.
 *
 * This file owns the PAGE — head, brief, tabs, search. Anything inside a table
 * cell lives under `cells/`, so a keystroke in the search box re-renders rows
 * rather than the inside of every badge.
 */
export default function InvoiceList() {
  /* Closed on arrival. The five steps explain the module to someone meeting it
     for the first time; for everyone after that they are 100px of fixed text
     between the header and the work. */
  const [briefOpen, setBriefOpen] = useState(false);

  /* useCallback so the handler keeps the same identity across renders — the
     table of 60 rows below is memoised, and a new function each render is
     exactly what defeats that. */
  const toggleBrief = useCallback(() => setBriefOpen(o => !o), []);

  /* ── Tabs and search ────────────────────────────────────────────────────
     Three pieces of state, because they are three independent questions: which
     scope, which shipment split, and what was typed. */
  const [scope, setScope] = useState<InvoiceScope>('all');
  const [shipScope, setShipScope] = useState<InvoiceShipmentScope>('with-shipment');
  const [query, setQuery] = useState('');

  /* The query the LIST filters by, one step behind the input. Typing updates
     `query` immediately so the box stays responsive, while `deferredQuery` lags
     under load and lets React drop stale filtering work. */
  const deferredQuery = useDeferredValue(query);

  /* Switching scope resets the sub-tab and clears the search, as the design
     does. Both are deliberate: the sub-tab counts describe the scope you just
     left, and a search typed in one scope rarely means anything in another. */
  const changeScope = useCallback((next: InvoiceScope) => {
    setScope(next);
    setShipScope('with-shipment');
    setQuery('');
  }, []);

  /* The "Create Supplier Purchase Invoice" chooser. */
  const [mapOpen, setMapOpen] = useState(false);
  const openMap = useCallback(() => setMapOpen(true), []);
  const closeMap = useCallback(() => setMapOpen(false), []);

  /* The storage wizard that follows the chooser. It holds the whole choice, not
     just a label: step 3 will need the mode to decide what it writes, and the
     head chip needs the PO or supplier it was mapped to. Null means closed —
     one piece of state for "which invoice is being created", rather than a
     separate open flag that could disagree with it. */
  const [storageFor, setStorageFor] = useState<InvoiceMapChoice | null>(null);
  const closeStorage = useCallback(() => setStorageFor(null), []);

  /* Confirming the chooser does not create anything yet — it hands off to the
     storage wizard, which is the next question in the flow. */
  const confirmMap = useCallback((choice: InvoiceMapChoice) => {
    setMapOpen(false);
    setStorageFor(choice);
  }, []);

  /* The four-step form, opened once the storage wizard completes. Null means
     closed, and it holds everything the form needs, so the two dialogs never
     have to be open at once. */
  const [formFor, setFormFor] = useState<InvoiceFormInput | null>(null);
  const closeForm = useCallback(() => setFormFor(null), []);

  /* Hands the wizard's answers to the form and closes the wizard. The supplier
     is always known: with a PO it comes from the order, without one it is what
     the chooser asked for instead. */
  const confirmStorage = useCallback((choice: StorageChoice) => {
    if (!storageFor) return;
    const poRow = storageFor.poNo
      ? INVOICE_ROWS.find(r => r.poNo === storageFor.poNo)
      : undefined;
    setStorageFor(null);
    setFormFor({
      poNo: storageFor.poNo,
      supplier: poRow?.supplierName ?? storageFor.supplier ?? '—',
      storage: choice,
    });
  }, [storageFor]);

  /* One handler for every row control, stable so the rows stay memoised. */
  /* The row whose payment requests are open, or null. One piece of state
     rather than an open flag that could disagree with the row. */
  const [paymentsRow, setPaymentsRow] = useState<InvoiceRow | null>(null);
  /* The row whose putaway summary is open. Same shape as above, and separate
     from it so the two screens can never both be up. */
  const [summaryRow, setSummaryRow] = useState<InvoiceRow | null>(null);
  /* The row whose Evidence Vault is open. */
  const [vaultRow, setVaultRow] = useState<InvoiceRow | null>(null);

  const handleRowAction = useCallback((action: InvoiceAction, row: InvoiceRow) => {
    if (action === 'payment-requests') { setPaymentsRow(row); return; }
    if (action === 'summary') { setSummaryRow(row); return; }
    if (action === 'vault') { setVaultRow(row); return; }
    if (action === 'edit') {
      /* The same four-step form a new invoice opens, carrying this row's own
         answers — editing an entry and creating one are the same screen, so
         there is no second form to keep in step with this one.

         The storage wizard is skipped: this invoice already has a warehouse,
         and asking for it again would invite changing it by accident. */
      setFormFor({
        poNo: row.poNo,
        supplier: row.supplierName,
        storage: row.warehouseKind === 'own'
          ? {
            type: 'own',
            /* Matched by name against the master, so the form shows the real
               site with its location rather than a bare label. */
            warehouse: STORAGE_WAREHOUSES.find(w => w.name === row.warehouseName)
              ?? { id: row.warehouseName, name: row.warehouseName, location: '—' },
          }
          : { type: 'third-party' },
        /* Its own number, not the next free one — this is an edit. */
        invoiceNo: row.invoiceNo,
      });
      return;
    }
    /* The other detail screens do not exist yet. Logging rather than silently
       swallowing, so a click is visibly reaching the page. */
    // eslint-disable-next-line no-console
    console.info('[invoice] action', action, row.invoiceNo);
  }, []);

  /* Scope first, memoised on its own so a keystroke does not re-run it. */
  const scopedRows = useMemo(() => filterByScope(INVOICE_ROWS, scope), [scope]);

  /* Counts come from the scoped set, never the searched one — a count that
     shrinks as you type reads as data disappearing. */
  const shipCounts = useMemo(() => ({
    'with-shipment': scopedRows.filter(r => r.shipmentId).length,
    'without-shipment': scopedRows.filter(r => !r.shipmentId).length,
  }), [scopedRows]);

  const scopeCounts = useMemo(() => ({
    all: INVOICE_ROWS.length,
    'with-po': INVOICE_ROWS.filter(r => r.poNo).length,
    'without-po': INVOICE_ROWS.filter(r => !r.poNo).length,
  }), []);

  const visibleRows = useMemo(() => {
    const byShipment = scopedRows.filter(r =>
      shipScope === 'with-shipment' ? !!r.shipmentId : !r.shipmentId);
    return searchRows(byShipment, deferredQuery);
  }, [scopedRows, shipScope, deferredQuery]);

  /* ── Paging ───────────────────────────────────────────────────────────────
     As the PO list pages, and for the same reason: the footer is where a long
     worklist tells you how much of it you are looking at. The difference is
     that the PO asks the server for one page and this list still runs on
     fixtures, so the slice happens here — the footer and the arithmetic behind
     it are identical either way. */
  const [page, setPage] = useState(1);
  const scrollRef = useRef<HTMLDivElement>(null);
  /* Rows per page = as many as fit the table area, never fewer than 10, until
     the user picks a size. Measured off a real row, so it holds at any zoom. */
  const [pageSize, choosePageSize, refitPageSize] = useFitPageSize(scrollRef);

  /* The row set changed, so the fit is measured again — the first fit runs
     before any row exists and would otherwise stay at the minimum. */
  useEffect(() => { if (visibleRows.length) refitPageSize(); }, [visibleRows.length, refitPageSize]);

  /* A filter or a search leaves page 4 of a list that may now have one page.
     Back to the first page, which is what the user is looking at anyway. */
  useEffect(() => { setPage(1); }, [scope, shipScope, deferredQuery]);

  const total = visibleRows.length;
  const start = (page - 1) * pageSize;
  const pagedRows = useMemo(
    () => visibleRows.slice(start, start + pageSize),
    [visibleRows, start, pageSize],
  );

  /* Picking a size keeps you at the top rather than on a page number that
     means something different now. */
  const changePageSize = useCallback((n: number) => { choosePageSize(n); setPage(1); }, [choosePageSize]);

  return (
    /* `ord-page` and `ord-list` are not decoration — order.css scopes its
       Figma-exact refinements to them: `.ord-page .spi-head-btn` (40px, not the
       shared 35px) and `.ord-list .spi-segrow .spi-seg-btn` / `.spi-search`
       (38px tabs, 44px search). Without the hooks this page silently rendered
       the smaller shared defaults and did not match the PO list beside it. */
    <div className="spi-root ord-page">

      {/* ── Head strip ───────────────────────────────────────────────────── */}
      <div className="spi-head">
        <div className="spi-head-left">
          <div className="spi-head-icon"><ReceiptIcon size={19} /></div>
          <div>
            <div className="spi-head-title">Supplier Purchase Invoice (SPI)</div>
            <div className="spi-head-sub">
              Process and reconcile supplier invoices — capture invoice details, match
              against purchase orders, apply taxes, and track payment status.
            </div>
          </div>
        </div>
        {/* The strip's button CREATES; the dialog it opens is where the
            invoice is MAPPED, which is why the two carry different words. */}
        <button type="button" className="spi-head-btn" onClick={openMap}>
          <LinkIcon size={13} />
          Create Supplier Purchase Invoice
        </button>
      </div>

      {/* ── What We Are Doing Here ───────────────────────────────────────── */}
      <div className={`spi-bref ${briefOpen ? '' : 'is-collapsed'}`}>
        <div className="spi-bref-head" onClick={toggleBrief}>
          <div className="spi-bref-ico"><ReceiptIcon size={14} /></div>
          <div className="spi-bref-mid">
            <div className="spi-bref-row">
              <div className="spi-bref-label">Supplier Purchase Invoice</div>
              <div className="spi-bref-sep" />
              <div className="spi-bref-title">What We Are Doing Here</div>
            </div>
            <div className="spi-bref-sub">
              Link the purchase order, capture the supplier invoice, apply taxes, run a
              3-way match, and post the approved invoice to Zohobook — end to end in one place.
            </div>
          </div>
          <div className="spi-bref-toggle"><ChevronDownIcon /></div>
        </div>
        <div className="spi-bref-body">
          {INVOICE_STEPS.map(step => (
            <div className="spi-step" key={step.no}>
              <div className="spi-step-top">
                <span className="spi-step-ico">{step.icon}</span>
                <span className="spi-step-num">STEP {step.no}</span>
              </div>
              <div className="spi-step-title">{step.title}</div>
              <div className="spi-step-desc">{step.desc}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── List card: scope tabs, shipment sub-tabs, search, table ──────── */}
      <div className="spi-card ord-list">
        <div className="spi-segrow">
          <div className="spi-seg" role="tablist" aria-label="Invoice scope">
            {SCOPE_TABS.map(tab => (
              <button
                key={tab.key}
                type="button"
                role="tab"
                aria-selected={scope === tab.key}
                className={`spi-seg-btn${scope === tab.key ? ' is-active' : ''}`}
                onClick={() => changeScope(tab.key)}
              >
                <span className="spi-seg-ico">{tab.icon}</span>
                {tab.label}
                <span className="spi-seg-c">{scopeCounts[tab.key]}</span>
              </button>
            ))}
          </div>

          <div className="spi-search">
            <SearchIcon size={16} />
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search SPI, supplier, PO or status..."
              aria-label="Search invoices"
              /* Browsers autofill anything that looks like a form field; a list
                 filter is not one. */
              autoComplete="off"
            />
          </div>
        </div>

        {/* Sub-tabs on their own row. The search sits up on the scope row, as
            it does on the purchase order list, so both pages read the same. */}
        <div className="spi-sub">
          <div className="spi-subtabs" role="tablist" aria-label="Shipment">
            {SHIP_TABS.map(tab => (
              <button
                key={tab.key}
                type="button"
                role="tab"
                aria-selected={shipScope === tab.key}
                className={`spi-subtab ${shipScope === tab.key ? 'is-active' : ''}`}
                onClick={() => setShipScope(tab.key)}
              >
                {tab.icon} {tab.label}
                <span className="spi-subtab-c">{shipCounts[tab.key]}</span>
              </button>
            ))}
          </div>

        </div>

        {/* The table takes only its rows. Everything that changes per keystroke
            stays up here, so `memo` on the table means typing re-renders the
            input and not 22 x 60 cells. */}
        <InvoiceTable
          rows={pagedRows} onAction={handleRowAction}
          startSr={start} scrollRef={scrollRef}
        />

        {/* The footer the PO list carries, with the same band and the same
            controls: how much of the list is on screen, rows per page, and the
            page itself. Hidden when there is nothing to page — "No records"
            beneath an empty table says it twice. */}
        {total > 0 && (
          <WorklistPager
            className="wl-teal"
            total={total}
            page={page}
            pageSize={pageSize}
            onPage={setPage}
            onPageSize={changePageSize}
            pageSizeOptions={PAGE_SIZE_OPTIONS}
          />
        )}
      </div>

      {paymentsRow && (
        <InvoicePaymentsModal row={paymentsRow} onClose={() => setPaymentsRow(null)} />
      )}

      {vaultRow && (
        <Suspense fallback={null}>
          <InvoiceEvidenceVault row={vaultRow} onClose={() => setVaultRow(null)} />
        </Suspense>
      )}

      {/* Lazy: a read-only screen most visits never open, and it carries its
          own stylesheet. */}
      {summaryRow && (
        <Suspense fallback={null}>
          <PutawaySummary row={summaryRow} onClose={() => setSummaryRow(null)} />
        </Suspense>
      )}

      {mapOpen && <MapInvoiceModal onClose={closeMap} onConfirm={confirmMap} />}

      {/* The chooser closes as this opens, so only one dialog is ever mounted.
          The chip shows what the invoice was mapped to — the PO when there is
          one, otherwise the supplier that stands in for it. */}
      {storageFor && (
        <StorageSelectionModal
          reference={storageFor.poNo ?? storageFor.supplier ?? '—'}
          referenceKind={storageFor.mode === 'with-po' ? 'po' : 'supplier'}
          warehouses={STORAGE_WAREHOUSES}
          onClose={closeStorage}
          onNext={confirmStorage}
        />
      )}

      {/* An edit carries its own number; a new invoice takes the next free one. */}
      {formFor && (
        <InvoiceForm input={formFor} invoiceNo={formFor.invoiceNo ?? NEXT_INVOICE_NO} onClose={closeForm} />
      )}
    </div>
  );
}

/* ── Filtering ────────────────────────────────────────────────────────────────
   Plain functions outside the component: they depend only on their arguments,
   so there is no reason to redefine them on every render, and each one is
   testable on its own. */

function filterByScope(rows: InvoiceRow[], scope: InvoiceScope): InvoiceRow[] {
  if (scope === 'all') return rows;
  if (scope === 'with-po') return rows.filter(r => r.poNo);
  return rows.filter(r => !r.poNo);
}

/**
 * Free-text search across the fields the design says are searchable:
 * "Search SPI, supplier, PO or status...".
 *
 * The haystack is built per row per call. That is fine at 60 rows; if this ever
 * holds thousands, the fix is to precompute a lowercase search string once when
 * the data arrives, not to make this function cleverer.
 */
function searchRows(rows: InvoiceRow[], query: string): InvoiceRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter(r => [
    r.invoiceNo, r.poNo, r.shipmentId, r.opportunityId, r.procurementId,
    r.supplierName, r.grnId, r.qaId, r.warehouseName,
    r.zohoStatus, r.documentType, r.poType, r.riskLevel,
  ].join(' ').toLowerCase().includes(q));
}

/* ── Tab definitions ──────────────────────────────────────────────────────────
   Data, at module scope, for the same reason as the step cards: the labels and
   icons never change, so there is no reason to rebuild them per render. */

const SCOPE_TABS: Array<{ key: InvoiceScope; label: string; icon: ReactNode }> = [
  {
    key: 'all',
    label: "All SPI's",
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
        <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" />
        <line x1="8" y1="18" x2="21" y2="18" /><line x1="3" y1="6" x2="3.01" y2="6" />
        <line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" />
      </svg>
    ),
  },
  {
    key: 'with-po',
    label: 'With Purchase Order SPI',
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
      </svg>
    ),
  },
  {
    key: 'without-po',
    label: 'Without Purchase Order SPI (Direct SPI)',
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
        <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
        <line x1="12" y1="22.08" x2="12" y2="12" />
      </svg>
    ),
  },
];

const SHIP_TABS: Array<{ key: InvoiceShipmentScope; label: string; icon: ReactNode }> = [
  {
    key: 'with-shipment',
    label: 'With Shipment ID',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="1" y="3" width="15" height="13" />
        <polygon points="16 8 20 8 23 11 23 16 16 16 16 8" />
        <circle cx="5.5" cy="18.5" r="2.5" /><circle cx="18.5" cy="18.5" r="2.5" />
      </svg>
    ),
  },
  {
    key: 'without-shipment',
    label: 'All Other Transactions (Without Shipment ID)',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
        <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
        <line x1="12" y1="22.08" x2="12" y2="12" />
      </svg>
    ),
  },
];

/* ── Icons ────────────────────────────────────────────────────────────────── */

function ReceiptIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1-2-1z" />
      <line x1="8" y1="9" x2="16" y2="9" />
      <line x1="8" y1="13" x2="16" y2="13" />
    </svg>
  );
}

function LinkIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function SearchIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}
