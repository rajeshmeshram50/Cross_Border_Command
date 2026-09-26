// P2P → Payment Request Management: every payment request raised on a PO or an SPI.
// Rows, tab counts and paging come from GET /p2p/orders/payment-requests; the layout reuses the shared P2P styles.
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useDebouncedValue } from '../../../../hooks/useDebouncedValue';
import { useToast } from '../../../../contexts/ToastContext';
import { useConfirm } from '../../../../contexts/ConfirmContext';
import { PoApiError, poPaymentApi, type PayRequestListMeta } from '../../purchase-management/order/api/po-api';
import WorklistPager from '../../../../components/ui/WorklistPager';
import { useFitPageSize } from '../../../../hooks/useFitPageSize';
import Badge, { type BadgeVariant } from '../../../../components/ui/Badge';
import { IcoAlert, IcoArrowR, IcoCard, IcoStar, IcoChat, IcoCheck, IcoChevron, IcoCircleX, IcoClock, IcoEye, IcoFile, IcoList, IcoScales, IcoSearch, IcoSend } from '../../icons';
import DeclineReasonModal from './DeclineReasonModal';
// The request view is a screen of its own, loaded only when one is opened.
const PaymentRequestDetail = lazy(() => import('./PaymentRequestDetail'));
import {
  fetchPaymentRequests, STATUS_LABEL, SUPPLIER_TAG_LABEL,
  type DocRef, type PartyRef, type PaymentRequestRow, type RequestStatus, type SupplierTag,
} from './paymentRequestData';
import '../../purchase-management/supplier-purchase-invoice/supplier-purchase-invoice.css';
import '../../purchase-management/order/po-list/order.css';
import './payment-request.css';

const GUIDE_STEPS: { num: string; title: string; desc: string; icon: ReactNode }[] = [
  {
    num: 'Step 01', title: 'Pick Up The Request', desc: 'Open a request raised on a PO or an SPI.',
    icon: <IcoSend size={11} stroke={2.4} />,
  },
  {
    num: 'Step 02', title: 'Check The Document', desc: 'Verify the order, invoice, supplier and terms behind it.',
    icon: <IcoFile size={11} stroke={2.4} />,
  },
  {
    num: 'Step 03', title: 'Weigh The Amount', desc: 'Confirm what is still open once other requests are counted.',
    icon: <IcoScales size={11} stroke={2.4} />,
  },
  {
    num: 'Step 04', title: 'Approve Or Decline', desc: 'Sanction in full, sanction in part, or decline with a reason.',
    icon: <IcoCheck size={11} stroke={2.4} />,
  },
  {
    num: 'Step 05', title: 'Track The Release', desc: 'Follow the payment released against the approval to closure.',
    icon: <IcoCard size={11} stroke={2.4} />,
  },
];

type TabKey = 'all' | 'awaiting' | 'approved' | 'declined';

const TABS: { key: TabKey; label: string; icon: ReactNode }[] = [
  {
    key: 'all', label: 'All Requests',
    icon: <IcoList size={11} stroke={2.4} />,
  },
  {
    key: 'awaiting', label: 'Awaiting for Approval Requests',
    icon: <IcoClock size={11} stroke={2.4} />,
  },
  {
    key: 'approved', label: 'Approved Requests',
    icon: <IcoCheck size={11} stroke={2.4} />,
  },
  {
    key: 'declined', label: 'Rejected / Declined Requests',
    icon: <IcoCircleX size={11} stroke={2.4} />,
  },
];

type Column = { label: string; width: number; groupEnd?: boolean };

const COLUMNS: Column[] = [
  { label: 'Sr. No', width: 52 },
  { label: 'Payment Request ID', width: 140 },
  { label: 'Request Raised Against', width: 210 },
  { label: 'Shipment ID', width: 104 },
  { label: 'Opportunity ID', width: 104 },
  { label: 'Procurement ID', width: 108, groupEnd: true },
  { label: 'Supplier', width: 150 },
  { label: 'Total PO / SPI Amount', width: 148 },
  { label: 'Requested Payment Amount', width: 186 },
  { label: 'Approved Amount', width: 140, groupEnd: true },
  { label: 'Requested Payment Type', width: 170 },
  { label: 'Requested By', width: 140 },
  { label: 'Requested To', width: 140 },
  // View Request (~132px) + gap + the 36px reason button + cell padding.
  { label: 'Action', width: 212 },
];

/* The Awaiting tab leads with a tick box, so several requests can be approved in
   one go instead of opening each one (CS-429), and drops Approved Amount, which
   nothing awaiting has yet. */
const PICK_COL: Column = { label: '', width: 44 };

const columnsFor = (tab: TabKey): Column[] => (tab !== 'awaiting'
  ? COLUMNS
  : [PICK_COL, ...COLUMNS.filter(c => c.label !== 'Approved Amount')
    .map(c => (c.label === 'Requested Payment Amount' ? { ...c, groupEnd: true } : c))]);

const tableWidth = (cols: Column[]) => cols.reduce((sum, c) => sum + c.width, 0);
// Eight rows a page, per CS-428.
const PAGE_SIZES = [10, 25, 50];

const STATUS_VARIANT: Record<RequestStatus, BadgeVariant> = {
  awaiting: 'gold', approved: 'success', declined: 'danger',
};
/* Figma .po-supcat: star gold, regular blue, high risk red, blacklisted slate. */
const SUPPLIER_VARIANT: Record<SupplierTag, BadgeVariant> = {
  star: 'gold', regular: 'info', high: 'danger', blacklisted: 'dark',
};
const SUPPLIER_ICON: Record<SupplierTag, ReactNode> = {
  star: <IcoStar size={9} stroke={2.4} />, regular: <IcoCheck size={9} stroke={2.8} />,
  high: <IcoAlert size={9} stroke={2.6} />, blacklisted: <IcoCircleX size={9} stroke={2.6} />,
};

const fmtDate = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toISOString().slice(0, 10).split('-').reverse().join('-');
};
const fmtMoney = (n: number) => `₹${n.toLocaleString('en-IN')}`;

function IdCell({ doc, none = '—' }: { doc: DocRef | null; none?: string }) {
  if (!doc) return <span className="prm-dash">{none}</span>;
  return (
    <div className="ord-idcell">
      <span className="ord-idpill">{doc.id}</span>
      {doc.date && <span className="ord-idcell__date">{fmtDate(doc.date)}</span>}
    </div>
  );
}

function Party({ party }: { party: PartyRef }) {
  return (
    <div className="prm-party">
      <span className="prm-party__code">{party.code}</span>
      <span className="prm-party__name" title={party.name}>{party.name}</span>
    </div>
  );
}

/* What the request sits on: a PO, an SPI, or an SPI mapped to its PO. The flag
   below (physical inspection / direct SPI) is what the approver checks first. */
function RaisedAgainst({ row }: { row: PaymentRequestRow }) {
  return (
    <div className="prm-against">
      <div className="prm-against__docs">
        {row.po && <IdCell doc={row.po} />}
        {row.po && row.spi && <span className="prm-against__arrow"><IcoArrowR /></span>}
        {row.spi && <IdCell doc={row.spi} />}
      </div>
      {row.flag === 'physical-inspection' && (
        <Badge appearance="outline" variant="danger" icon={<IcoAlert size={9} stroke={2.6} />} className="prm-flag">Physical Inspection</Badge>
      )}
      {row.flag === 'direct-spi' && (
        <Badge appearance="outline" variant="info" className="prm-flag">Direct SPI</Badge>
      )}
    </div>
  );
}

export default function PaymentRequestManagement() {
  const toast = useToast();
  const confirm = useConfirm();
  const [rows, setRows] = useState<PaymentRequestRow[]>([]);
  const [meta, setMeta] = useState<PayRequestListMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [guideOpen, setGuideOpen] = useState(true);
  const [tab, setTab] = useState<TabKey>('all');
  // Awaiting requests have nothing approved yet, so that column is left out (CS-429).
  const columns = useMemo(() => columnsFor(tab), [tab]);
  const showApproved = tab !== 'awaiting';
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  // Rows per page as in the Segment Master: what fits the table, never fewer than 10.
  const tableRef = useRef<HTMLDivElement>(null);
  const [pageSize, setPageSize, refitSize] = useFitPageSize(tableRef);
  const [reasonRow, setReasonRow] = useState<PaymentRequestRow | null>(null);
  const [viewId, setViewId] = useState<number | null>(null);
  const closeView = useCallback(() => setViewId(null), []);

  // Tabs, search and paging run on the server; a newer request wins over a slower older one.
  const debouncedSearch = useDebouncedValue(search.trim(), 400);
  const [reload, setReload] = useState(0);
  const latest = useRef(0);
  /* Which query the rows on screen answer. While a different one is in flight
     the list shimmers rather than showing the previous tab's rows (CS-430). */
  const queryKey = `${tab}|${debouncedSearch}|${page}|${pageSize}`;
  const [shownKey, setShownKey] = useState('');
  useEffect(() => {
    const ticket = ++latest.current;
    setLoading(true);
    fetchPaymentRequests({ tab, search: debouncedSearch, page, per_page: pageSize })
      .then(({ rows: list, meta: m }) => { if (ticket === latest.current) { setRows(list); setMeta(m); setShownKey(`${tab}|${debouncedSearch}|${page}|${pageSize}`); } })
      .catch(e => { if (ticket === latest.current) toast.error('Could not load payment requests', e instanceof PoApiError ? e.firstError : 'Please refresh the page.'); })
      .finally(() => { if (ticket === latest.current) setLoading(false); });
  }, [tab, debouncedSearch, page, pageSize, reload, toast]);
  const refresh = useCallback(() => setReload(n => n + 1), []);
  // Re-measure once real rows are on screen; a larger fit fetches that many.
  useEffect(() => { if (rows.length) refitSize(); }, [rows.length, refitSize]);

  const counts = meta?.counts ?? { all: 0, awaiting: 0, approved: 0, declined: 0 };
  const total = meta?.total ?? 0;

  // Page 1 whenever the result set changes underneath the pager.
  useEffect(() => { setPage(1); }, [tab, debouncedSearch, pageSize]);

  const start = (page - 1) * pageSize;
  const pageRows = rows;

  /* ── Approving several at once (CS-429) ──────────────────────────────────
     Only the Awaiting tab, and only rows this user may decide: the server
     refuses anyone else's, so they are not offered a tick box. */
  const [picked, setPicked] = useState<number[]>([]);
  const [approving, setApproving] = useState(false);
  const pickable = useMemo(
    () => (tab === 'awaiting' ? pageRows.filter(r => r.canDecide && r.status === 'awaiting') : []),
    [tab, pageRows],
  );
  const pickedRows = pickable.filter(r => picked.includes(r.id));
  const allPicked = pickable.length > 0 && pickedRows.length === pickable.length;
  // A tick belongs to the rows on screen; changing tab, page or search clears it.
  useEffect(() => { setPicked([]); }, [tab, debouncedSearch, page, pageSize, shownKey]);
  const togglePick = (id: number) => setPicked(cur => (cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id]));
  const toggleAll = () => setPicked(allPicked ? [] : pickable.map(r => r.id));

  const approvePicked = async () => {
    const list = pickedRows;
    if (!list.length || approving) return;
    const ok = await confirm({
      title: `Approve ${list.length} payment request${list.length === 1 ? '' : 's'}?`,
      message: `${list.map(r => r.requestId).join(', ')} — each one is approved for the full amount requested. To approve part of an amount, open that request on its own.`,
      confirmLabel: 'Approve',
      tone: 'teal',
      icon: 'check-double-line',
    });
    if (!ok) return;
    setApproving(true);
    try {
      const res = await poPaymentApi.decideMany({ ids: list.map(r => r.id), decision: 'approved' });
      setPicked([]);
      refresh();
      if (res.failed.length) {
        // Each refusal has its own reason — the headroom left on the PO, usually.
        toast.warning(res.message || 'Some requests could not be approved',
          res.failed.map(f => `${f.code ?? f.id}: ${f.message}`).join(' · '));
      } else {
        toast.success('Payment requests approved', res.message);
      }
    } catch (e) {
      toast.error('Could not approve the selected requests', e instanceof PoApiError ? e.firstError : 'Please try again.');
    } finally {
      setApproving(false);
    }
  };

  const toggleGuide = () => setGuideOpen(v => !v);
  const onGuideKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleGuide(); }
  };

  return (
    <div className="ord-page prm-page">

      <div className="spi-head">
        <div className="spi-head-left">
          <div className="spi-head-icon">
            <IcoSend size={19} />
          </div>
          <div>
            <div className="spi-head-title">Payment Request Management</div>
            <div className="spi-head-sub">
              Payment requests raised against a purchase order or a supplier invoice — approve, part-approve or decline the ones sent to you,
              then track the release.
            </div>
          </div>
        </div>
      </div>

      <div className={`spi-bref${guideOpen ? '' : ' is-collapsed'}`}>
        <div className="spi-bref-head" role="button" tabIndex={0} aria-expanded={guideOpen} onClick={toggleGuide} onKeyDown={onGuideKey}>
          <div className="spi-bref-ico">
            <IcoSend size={14} stroke={2.4} />
          </div>
          <div className="spi-bref-mid">
            <div className="spi-bref-row">
              <div className="spi-bref-label">Payment Request Management</div>
              <div className="spi-bref-sep" />
              <div className="spi-bref-title">What We Are Doing Here</div>
            </div>
            <div className="spi-bref-sub">
              Every request raised on a PO or an SPI lands here: check what it is against, decide it in full or in
              part, then watch the release close it out — end to end in one place.
            </div>
          </div>
          <div className="spi-bref-toggle">
            <IcoChevron size={10} stroke={2.8} />
          </div>
        </div>

        <div className="spi-bref-body">
          {GUIDE_STEPS.map(step => (
            <div className="spi-step" key={step.num}>
              <div className="spi-step-top">
                <span className="spi-step-ico">{step.icon}</span>
                <span className="spi-step-num">{step.num}</span>
              </div>
              <div className="spi-step-title">{step.title}</div>
              <div className="spi-step-desc">{step.desc}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="spi-card ord-list">
        <div className="spi-segrow">
          <div className="spi-seg" role="tablist" aria-label="Payment request views">
            {TABS.map(t => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={t.key === tab}
                className={`spi-seg-btn${t.key === tab ? ' is-active' : ''}`}
                onClick={() => setTab(t.key)}
              >
                <span className="spi-seg-ico">{t.icon}</span>
                {t.label}
                <span className="spi-seg-c">{counts[t.key]}</span>
              </button>
            ))}
          </div>

          <div className="spi-search">
            <IcoSearch />
            <input
              type="text"
              aria-label="Search payment requests"
              placeholder="Search request ID, PO, SPI, supplier or status..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
        </div>

        {/* What is ticked, and the one action on it. It only shows once something
            is selected, so the list looks no different until then. */}
        {pickedRows.length > 0 && (
          <div className="prm-bulkbar" role="status">
            <span className="prm-bulkbar__n">{pickedRows.length}</span>
            <span className="prm-bulkbar__t">
              request{pickedRows.length === 1 ? '' : 's'} selected — approving releases the full amount requested on each
            </span>
            <button type="button" className="prm-bulkbar__clear" disabled={approving} onClick={() => setPicked([])}>Clear</button>
            <button type="button" className="prm-bulkbar__ok" disabled={approving} onClick={() => void approvePicked()}>
              {approving ? <span className="prm-bulkbar__ring" aria-hidden /> : <IcoCheck size={13} stroke={2.6} />}
              {approving ? 'Approving…' : `Approve ${pickedRows.length} request${pickedRows.length === 1 ? '' : 's'}`}
            </button>
          </div>
        )}

        {loading && (!rows.length || shownKey !== queryKey) ? (
          <PrmListSkeleton columns={columns} />
        ) : pageRows.length === 0 ? (
          <div className="ord-empty">
            {search.trim() ? 'No payment requests match your search.' : 'No payment requests in this category.'}
          </div>
        ) : (
          <div className={`ord-table-scroll${loading ? ' is-refreshing' : ''}`} ref={tableRef}>
            {/* Columns keep their widths, but the table still fills a wide screen. */}
            <table className="ord-table" style={{ minWidth: tableWidth(columns), width: '100%' }}>
              <colgroup>
                {columns.map(c => <col key={c.label} style={{ width: c.width }} />)}
              </colgroup>
              <thead>
                <tr>
                  {columns.map(c => (c === PICK_COL ? (
                    <th key="pick" className="prm-pickcell">
                      <input type="checkbox" className="prm-pick" aria-label="Select every request on this page"
                        title={pickable.length ? 'Select every request on this page you can approve' : 'No request here is yours to approve'}
                        disabled={!pickable.length || approving}
                        checked={allPicked}
                        ref={el => { if (el) el.indeterminate = pickedRows.length > 0 && !allPicked; }}
                        onChange={toggleAll} />
                    </th>
                  ) : (
                    <th key={c.label} className={c.groupEnd ? 'ord-table__group-end' : undefined}>{c.label}</th>
                  )))}
                </tr>
              </thead>
              <tbody>
                {pageRows.map((row, i) => (
                  <tr
                    key={row.id}
                    className={`is-first is-last prm-row${row.flag === 'physical-inspection' ? ' is-physreq' : ''}${row.status === 'declined' ? ' is-closed' : ''}${picked.includes(row.id) ? ' is-picked' : ''}`}
                  >
                    {tab === 'awaiting' && (
                      <td className="prm-pickcell">
                        <input type="checkbox" className="prm-pick"
                          aria-label={`Select ${row.requestId}`}
                          title={row.canDecide ? `Select ${row.requestId} to approve` : 'This request was sent to someone else'}
                          disabled={!row.canDecide || approving}
                          checked={picked.includes(row.id)}
                          onChange={() => togglePick(row.id)} />
                      </td>
                    )}
                    <td><span className="ord-srnum">{start + i + 1}</span></td>

                    <td>
                      <div className="ord-idcell">
                        <span className="ord-idpill">{row.requestId}</span>
                        <span className="ord-idcell__date">{fmtDate(row.requestDate)}</span>
                        <Badge variant={STATUS_VARIANT[row.status]} dot className="prm-status">
                          {STATUS_LABEL[row.status]}
                        </Badge>
                      </div>
                    </td>

                    <td><RaisedAgainst row={row} /></td>

                    <td>{row.shipment ? <IdCell doc={row.shipment} /> : <span className="prm-dash">—</span>}</td>
                    <td><IdCell doc={row.opportunity} /></td>
                    <td className="ord-table__group-end"><IdCell doc={row.procurement} none="NA" /></td>

                    <td>
                      <div className="ord-supplier">
                        <span className="ord-supplier__name">{row.supplier}</span>
                        <Badge variant={SUPPLIER_VARIANT[row.supplierTag]} icon={SUPPLIER_ICON[row.supplierTag]} className={`ord-supplier__cat prm-supcat prm-supcat--${row.supplierTag}`}>
                          {SUPPLIER_TAG_LABEL[row.supplierTag]}
                        </Badge>
                      </div>
                    </td>

                    <td><span className="ord-amt">{fmtMoney(row.totalAmount)}</span></td>
                    <td className={showApproved ? undefined : 'ord-table__group-end'}>
                      <span className="ord-amt ord-amt--net">{fmtMoney(row.requestedAmount)}</span>
                    </td>

                    {showApproved && (
                    <td className="ord-table__group-end">
                      {row.approvedAmount === null ? (
                        <div className="prm-amtcell">
                          <span className="prm-dash">—</span>
                          <span className="prm-amtcell__note">{row.approvedNote ?? 'not decided yet'}</span>
                        </div>
                      ) : (
                        <div className="prm-amtcell">
                          <span className="ord-amt ord-amt--paid">{fmtMoney(row.approvedAmount)}</span>
                          {row.approvedNote && <span className="prm-amtcell__note">{row.approvedNote}</span>}
                        </div>
                      )}
                    </td>
                    )}

                    <td><span className="prm-paytype">{row.paymentType}</span></td>
                    <td><Party party={row.requestedBy} /></td>
                    <td><Party party={row.requestedTo} /></td>

                    <td>
                      <div className="prm-acts">
                        <button type="button" className={`ord-btn prm-viewbtn${row.status === 'declined' ? ' is-muted' : ''}`} title={`View ${row.requestId}`} onClick={() => setViewId(row.id)}>
                          <span className="prm-viewbtn__ico"><IcoEye size={9} /></span>
                          <span>View Request</span>
                        </button>
                        {row.status === 'declined' && (
                          <button type="button" className="prm-reasonbtn" title={`Decline reason — ${row.requestId}`} aria-label={`Decline reason for ${row.requestId}`} onClick={() => setReasonRow(row)}>
                            <IcoChat size={14} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {total > 0 && (
          <WorklistPager
            className="wl-teal"
            total={total}
            page={page}
            pageSize={pageSize}
            onPage={setPage}
            onPageSize={setPageSize}
            pageSizeOptions={PAGE_SIZES}
          />
        )}
      </div>

      {reasonRow && <DeclineReasonModal row={reasonRow} onClose={() => setReasonRow(null)} />}
      {viewId && (
        <Suspense fallback={null}>
          <PaymentRequestDetail requestId={viewId} onBack={closeView} onChanged={refresh} />
        </Suspense>
      )}
    </div>
  );
}

/* The list while it loads (QA #87): the table it is about to become, with bars
   where the values will be, instead of the line "Loading payment requests…".
   Same bars (.spi-sk-bar) and the same column widths the PO list uses, so the
   two lists wait in the same way. */
/* Takes the ACTIVE tab's columns, not the full COLUMNS list.
   The width came from a bare `TABLE_WIDTH`, which is a module-level const over
   in the PO list (Order.tsx) and does not exist here — so this component threw
   ReferenceError the moment it rendered, and since it renders on every first
   load of the page, the error boundary replaced the whole screen. Widths now
   come from this module's own tableWidth() helper, which the real table two
   hundred lines up already uses.
   Passing the columns in also settles a smaller mismatch: the Awaiting tab
   drops the "Approved Amount" column, so the skeleton was laying out a column
   the table it becomes would not have. */
function PrmListSkeleton({ columns }: { columns: Column[] }) {
  return (
    <div className="ord-table-scroll">
      <table className="ord-table" style={{ minWidth: tableWidth(columns), width: '100%' }}>
        <colgroup>
          {columns.map(c => <col key={c.label} style={{ width: c.width }} />)}
        </colgroup>
        <thead>
          <tr>
            {columns.map(c => (
              <th key={c.label} className={c.groupEnd ? 'ord-table__group-end' : undefined}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: 6 }).map((_, row) => (
            <tr key={row} className="ord-skel-tr">
              {columns.map(c => (
                <td key={c.label} className={c.groupEnd ? 'ord-table__group-end' : undefined}>
                  <span className="spi-sk-bar" style={{ width: Math.round(c.width * 0.6) }} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
