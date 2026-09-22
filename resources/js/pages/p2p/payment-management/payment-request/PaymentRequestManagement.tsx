// P2P → Payment Request Management: every payment request raised on a PO or an SPI.
// Rows, tab counts and paging come from GET /p2p/orders/payment-requests; the layout reuses the shared P2P styles.
import { lazy, Suspense, useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useDebouncedValue } from '../../../../hooks/useDebouncedValue';
import { useToast } from '../../../../contexts/ToastContext';
import { PoApiError, type PayRequestListMeta } from '../../purchase-management/order/api/po-api';
import WorklistPager from '../../../../components/ui/WorklistPager';
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

const COLUMNS: { label: string; width: number; groupEnd?: boolean }[] = [
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

const TABLE_WIDTH = COLUMNS.reduce((sum, c) => sum + c.width, 0);
// Eight rows a page, per CS-428.
const PAGE_SIZES = [8, 16, 24];

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

function IdCell({ doc }: { doc: DocRef | null }) {
  if (!doc) return <span className="prm-dash">—</span>;
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
  const [rows, setRows] = useState<PaymentRequestRow[]>([]);
  const [meta, setMeta] = useState<PayRequestListMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [guideOpen, setGuideOpen] = useState(true);
  const [tab, setTab] = useState<TabKey>('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZES[0]);
  const [reasonRow, setReasonRow] = useState<PaymentRequestRow | null>(null);
  const [viewId, setViewId] = useState<number | null>(null);
  const closeView = useCallback(() => setViewId(null), []);

  // Tabs, search and paging run on the server; a newer request wins over a slower older one.
  const debouncedSearch = useDebouncedValue(search.trim(), 400);
  const [reload, setReload] = useState(0);
  const latest = useRef(0);
  useEffect(() => {
    const ticket = ++latest.current;
    setLoading(true);
    fetchPaymentRequests({ tab, search: debouncedSearch, page, per_page: pageSize })
      .then(({ rows: list, meta: m }) => { if (ticket === latest.current) { setRows(list); setMeta(m); } })
      .catch(e => { if (ticket === latest.current) toast.error('Could not load payment requests', e instanceof PoApiError ? e.firstError : 'Please refresh the page.'); })
      .finally(() => { if (ticket === latest.current) setLoading(false); });
  }, [tab, debouncedSearch, page, pageSize, reload, toast]);
  const refresh = useCallback(() => setReload(n => n + 1), []);

  const counts = meta?.counts ?? { all: 0, awaiting: 0, approved: 0, declined: 0 };
  const total = meta?.total ?? 0;

  // Page 1 whenever the result set changes underneath the pager.
  useEffect(() => { setPage(1); }, [tab, debouncedSearch, pageSize]);

  const start = (page - 1) * pageSize;
  const pageRows = rows;

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
              Review and action every pending payment request raised against a purchase order or a supplier
              invoice — approve, part-approve or decline, then track the release.
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

        {loading && !rows.length ? (
          <div className="ord-empty">Loading payment requests…</div>
        ) : pageRows.length === 0 ? (
          <div className="ord-empty">
            {search.trim() ? 'No payment requests match your search.' : 'No payment requests in this category.'}
          </div>
        ) : (
          <div className={`ord-table-scroll${loading ? ' is-refreshing' : ''}`}>
            {/* Columns keep their widths, but the table still fills a wide screen. */}
            <table className="ord-table" style={{ minWidth: TABLE_WIDTH, width: '100%' }}>
              <colgroup>
                {COLUMNS.map(c => <col key={c.label} style={{ width: c.width }} />)}
              </colgroup>
              <thead>
                <tr>
                  {COLUMNS.map(c => (
                    <th key={c.label} className={c.groupEnd ? 'ord-table__group-end' : undefined}>{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pageRows.map((row, i) => (
                  <tr
                    key={row.id}
                    className={`is-first is-last prm-row${row.flag === 'physical-inspection' ? ' is-physreq' : ''}${row.status === 'declined' ? ' is-closed' : ''}`}
                  >
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
                    <td className="ord-table__group-end"><IdCell doc={row.procurement} /></td>

                    <td>
                      <div className="ord-supplier">
                        <span className="ord-supplier__name">{row.supplier}</span>
                        <Badge variant={SUPPLIER_VARIANT[row.supplierTag]} icon={SUPPLIER_ICON[row.supplierTag]} className={`ord-supplier__cat prm-supcat prm-supcat--${row.supplierTag}`}>
                          {SUPPLIER_TAG_LABEL[row.supplierTag]}
                        </Badge>
                      </div>
                    </td>

                    <td><span className="ord-amt">{fmtMoney(row.totalAmount)}</span></td>
                    <td><span className="ord-amt ord-amt--net">{fmtMoney(row.requestedAmount)}</span></td>

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
