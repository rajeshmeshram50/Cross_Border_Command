import { lazy, Suspense, useState, useCallback, useEffect, useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import '../../p2p-common.css';
import '../order/po-list/order.css';
import { INVOICE_STEPS } from './steps';
import { NEXT_INVOICE_NO, STORAGE_WAREHOUSES } from './data';
import { InvoiceTable } from './InvoiceTable';
import WorklistPager from '../../../../components/ui/WorklistPager';
import SearchClear from '../../../../components/ui/SearchClear';
import { useFitPageSize } from '../../../../hooks/useFitPageSize';
import { useServerList } from '../../../../hooks/useServerList';
import { useDebouncedValue } from '../../../../hooks/useDebouncedValue';
import { useToast } from '../../../../contexts/ToastContext';
import { PoApiError } from '../order/api/po-api';
import { spiApi, toInvoiceRow } from './spi-api';
import MapInvoiceModal, { type InvoiceMapChoice } from './MapInvoiceModal';
import InvoicePaymentsModal from './InvoicePaymentsModal';
const PutawaySummary = lazy(() => import('./PutawaySummary'));
const InvoiceEvidenceVault = lazy(() => import('./InvoiceEvidenceVault'));
import StorageSelectionModal, { type StorageChoice } from './StorageSelectionModal';
import InvoiceForm, { type InvoiceFormInput } from './InvoiceForm';
import type { InvoiceAction } from './cells/RowActions';
import type { InvoiceRow, InvoiceScope, InvoiceShipmentScope } from './types';

const PAGE_SIZE_OPTIONS = [10, 25, 50];

export default function InvoiceList() {
  const [briefOpen, setBriefOpen] = useState(false);

  const toggleBrief = useCallback(() => setBriefOpen(o => !o), []);

  const [scope, setScope] = useState<InvoiceScope>('all');
  const [shipScope, setShipScope] = useState<InvoiceShipmentScope>('with-shipment');
  const [query, setQuery] = useState('');

  const debouncedQuery = useDebouncedValue(query.trim(), 400);

  const toast = useToast();

  const scrollRef = useRef<HTMLDivElement>(null);
  const [pageSize, choosePageSize, refitPageSize] = useFitPageSize(scrollRef);

  const list = useServerList(
    (q) => {
      const [sc, sh] = (q.tab ?? '').split('|') as [InvoiceScope, InvoiceShipmentScope];
      return spiApi.list({ scope: sc, shipScope: sh, search: q.search, page: q.page, per_page: q.per_page })
        .then(({ rows, meta }) => ({ rows: rows.map(toInvoiceRow), meta }));
    },
    { perPage: pageSize, search: debouncedQuery, tab: `${scope}|${shipScope}` },
    (e) => toast.error('Could not load supplier purchase invoices',
      e instanceof PoApiError ? e.firstError : 'Please refresh the page.'),
  );

  const changeScope = useCallback((next: InvoiceScope) => {
    setScope(next);
    setShipScope('with-shipment');
    setQuery('');
  }, []);

  const [mapOpen, setMapOpen] = useState(false);
  const openMap = useCallback(() => setMapOpen(true), []);
  const closeMap = useCallback(() => setMapOpen(false), []);

  const [storageFor, setStorageFor] = useState<InvoiceMapChoice | null>(null);
  const closeStorage = useCallback(() => setStorageFor(null), []);

  const confirmMap = useCallback((choice: InvoiceMapChoice) => {
    setMapOpen(false);
    setStorageFor(choice);
  }, []);

  const [formFor, setFormFor] = useState<InvoiceFormInput | null>(null);
  const reloadList = list.reload;
  const closeForm = useCallback(() => { setFormFor(null); reloadList(); }, [reloadList]);

  const confirmStorage = useCallback((choice: StorageChoice) => {
    if (!storageFor) return;
    setStorageFor(null);
    setFormFor({
      poId: storageFor.poId,
      poNo: storageFor.poNo,
      supplier: storageFor.supplier ?? '—',
      storage: choice,
    });
  }, [storageFor]);

  const [paymentsRow, setPaymentsRow] = useState<InvoiceRow | null>(null);
  const [summaryRow, setSummaryRow] = useState<InvoiceRow | null>(null);
  const [vaultRow, setVaultRow] = useState<InvoiceRow | null>(null);

  const handleRowAction = useCallback((action: InvoiceAction, row: InvoiceRow) => {
    if (action === 'payment-requests') { setPaymentsRow(row); return; }
    if (action === 'summary') { setSummaryRow(row); return; }
    if (action === 'vault') { setVaultRow(row); return; }
    if (action === 'edit') {
      setFormFor({
        spiId: row.apiId,
        poNo: row.poNo,
        supplier: row.supplierName,
        storage: row.warehouseKind === 'third-party'
          ? { type: 'third-party' }
          : {
            type: 'own',
            warehouse: row.warehouseName
              ? STORAGE_WAREHOUSES.find(w => w.name === row.warehouseName)
                ?? { id: row.warehouseName, name: row.warehouseName, location: '—' }
              : undefined,
          },
        invoiceNo: row.invoiceNo,
      });
      return;
    }
    // eslint-disable-next-line no-console
    console.info('[invoice] action', action, row.invoiceNo);
  }, []);

  const tabs = list.meta?.tabs;
  const scopeCounts = useMemo(() => ({
    all: tabs?.all_spi ?? 0,
    'with-po': tabs?.with_po ?? 0,
    'without-po': tabs?.direct_spi ?? 0,
  }), [tabs]);
  const shipCounts = useMemo(() => ({
    'with-shipment': tabs?.with_shipment ?? 0,
    'without-shipment': tabs?.without_shipment ?? 0,
  }), [tabs]);

  const rowCount = list.rows.length;
  useEffect(() => { if (rowCount) refitPageSize(); }, [rowCount, refitPageSize]);

  const changePageSize = useCallback((n: number) => choosePageSize(n), [choosePageSize]);

  const total = list.meta?.total ?? 0;
  const page = list.page;
  const start = (page - 1) * pageSize;

  return (
    <div className="spi-root ord-page">

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
        <button type="button" className="spi-head-btn" onClick={openMap}>
          <LinkIcon size={13} />
          Create Supplier Purchase Invoice
        </button>
      </div>

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
              autoComplete="off"
            />
            {/* The PO list's own × . Without it, emptying the box means
                selecting the text and deleting it, and until that is done a
                filtered table reads as "no invoices". */}
            <SearchClear show={query} onClear={() => setQuery('')} />
          </div>
        </div>

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

        {!(list.loading || list.replacing) && total === 0 ? (
          <div className="ord-empty">
            {debouncedQuery
              ? 'No supplier purchase invoices match your search.'
              : 'No supplier purchase invoices to display in this category.'}
          </div>
        ) : (
          <InvoiceTable
            rows={list.rows} onAction={handleRowAction}
            startSr={start} scrollRef={scrollRef}
            loading={list.loading || list.replacing}
          />
        )}

        {/* Shown on an empty list too: it reads "No records" there, and the
            rows-per-page choice stays where it was rather than vanishing with
            the last row. Without it the card loses its bottom edge and simply
            ends in white. */}
        <WorklistPager
          className="wl-teal"
          total={total}
          page={page}
          pageSize={pageSize}
          onPage={list.goTo}
          onPageSize={changePageSize}
          pageSizeOptions={PAGE_SIZE_OPTIONS}
        />
      </div>

      {paymentsRow && (
        <InvoicePaymentsModal row={paymentsRow} onClose={() => setPaymentsRow(null)} />
      )}

      {vaultRow && (
        <Suspense fallback={null}>
          <InvoiceEvidenceVault row={vaultRow} onClose={() => setVaultRow(null)} />
        </Suspense>
      )}

      {summaryRow && (
        <Suspense fallback={null}>
          <PutawaySummary row={summaryRow} onClose={() => setSummaryRow(null)} />
        </Suspense>
      )}

      {mapOpen && <MapInvoiceModal onClose={closeMap} onConfirm={confirmMap} />}

      {storageFor && (
        <StorageSelectionModal
          reference={storageFor.poNo ?? storageFor.supplier ?? '—'}
          referenceKind={storageFor.mode === 'with-po' ? 'po' : 'supplier'}
          warehouses={STORAGE_WAREHOUSES}
          onClose={closeStorage}
          onNext={confirmStorage}
        />
      )}

      {formFor && (
        <InvoiceForm input={formFor} invoiceNo={formFor.invoiceNo ?? NEXT_INVOICE_NO} onClose={closeForm} />
      )}
    </div>
  );
}

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
