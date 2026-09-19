// Payment Request Management → View Request. Opens full screen over the list,
// so Back returns to the queue with its tab, search and page untouched.
import { useEffect, useMemo, useState, type ChangeEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import Badge, { type BadgeVariant } from '../../../../components/ui/Badge';
import { useAuth } from '../../../../contexts/AuthContext';
import { useToast } from '../../../../contexts/ToastContext';
import { useScrollLock } from '../../../../hooks/useScrollLock';
import { formatDmy } from '../../../../utils/formatDmy';
import { ORDER_COLUMNS, OrderRowBody, type OrderRow } from '../../purchase-management/order/Order';
import { Field } from '../../purchase-management/order/create-po/form-fields';
import GstNoticeModal, { type GstNotice } from '../../purchase-management/order/create-po/GstNoticeModal';
import {
  GST_STALE_MONTHS, SevIcon, cutoffDate, gstState, monthsAgo, riskItems, type Severity,
} from '../../purchase-management/order/create-po/supplier-checks';
import {
  LEGAL_PARAMS, RISK_GUIDELINES, isRiskMandatory, legalSections, legalTotals, type Supplier,
} from '../../purchase-management/order/create-po/sample-suppliers';
import {
  ProofChip, VERDICTS, downloadFile, openFile, toProofFiles,
  type InspectionLine, type InspectionProduct, type ProofFile, type Verdict,
} from '../../purchase-management/order/inspection-shared';
import InspectionAttachmentsModal from '../../purchase-management/order/InspectionAttachmentsModal';
import InspectionProductView from '../../purchase-management/order/InspectionProductView';
import {
  IcoAlert, IcoCheck, IcoChevron, IcoCircleX, IcoDocSm, IcoDownload, IcoEye, IcoFile, IcoLock, IcoOk,
  IcoPin, IcoShield, IcoStop, IcoUser, IcoWarn, IcoClock,
} from '../../icons';
import { STATUS_LABEL, type RequestStatus } from './paymentRequestData';
import {
  fetchPaymentRequestDetail, type LinkedRequest, type PaymentRequestDetail as Detail,
} from './paymentRequestDetailData';
import TxnVaultModal from './TxnVaultModal';
import PaymentRequestDecisionModal, { type DecisionMode } from './PaymentRequestDecisionModal';
import type { PaymentRequestRow } from './paymentRequestData';
import '../../purchase-management/supplier-purchase-invoice/supplier-purchase-invoice.css';
import '../../purchase-management/order/order.css';
import '../../purchase-management/order/create-po/create-po.css';
import '../../purchase-management/order/physical-inspection.css';
import './payment-request.css';
import './payment-request-detail.css';

type TxTab = 'current' | 'history';
type SubTab = 'supplier' | 'linked' | 'summary' | 'physical' | 'status';

/** Glyphs the shared icon set doesn't carry, drawn the prototype's way. */
function G({ d, size = 13, stroke = 2.2 }: { d: ReactNode; size?: number; stroke?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round">
      {d}
    </svg>
  );
}
const P = {
  send: <><path d="M22 2 11 13" /><path d="M22 2 15 22l-4-9-9-4z" /></>,
  back: <><line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" /></>,
  doc: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></>,
  building: <><path d="M3 21h18" /><path d="M5 21V7l8-4v18" /><path d="M19 21V11l-6-4" /></>,
  truck: <><rect x="1" y="3" width="15" height="13" rx="2" /><path d="M16 8h4l3 5v3h-7V8z" /><circle cx="5.5" cy="18.5" r="2.5" /><circle cx="18.5" cy="18.5" r="2.5" /></>,
  target: <><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="3" fill="currentColor" stroke="none" /></>,
  cart: <><circle cx="9" cy="21" r="1.6" /><circle cx="19" cy="21" r="1.6" /><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" /></>,
  ref: <><path d="M4 7V4h16v3" /><path d="M9 20h6" /><path d="M12 4v16" /></>,
  card: <><rect x="2" y="5" width="20" height="14" rx="2.5" /><line x1="2" y1="10" x2="22" y2="10" /></>,
  pct: <><line x1="19" y1="5" x2="5" y2="19" /><circle cx="6.5" cy="6.5" r="2.5" /><circle cx="17.5" cy="17.5" r="2.5" /></>,
  rupee: <><path d="M6 3h12" /><path d="M6 8h12" /><path d="m6 13 8.5 8" /><path d="M6 13h3" /><path d="M9 13c6.667 0 6.667-10 0-10" /></>,
  user: <><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /></>,
  receipt: <><path d="M4 2h16v20l-3-1.8-3 1.8-3-1.8-3 1.8L4 22V2z" /><line x1="8" y1="8" x2="16" y2="8" /><line x1="8" y1="12" x2="16" y2="12" /></>,
  scale: <><path d="M12 3v18" /><path d="M6 7h12" /><path d="M6 7l-3 6a3 3 0 0 0 6 0z" /><path d="M18 7l-3 6a3 3 0 0 0 6 0z" /></>,
  badge: <><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></>,
  wallet: <><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" /><path d="M3 5v14a2 2 0 0 0 2 2h16v-5" /><path d="M18 12a2 2 0 0 0 0 4h4v-4z" /></>,
  history: <><path d="M3 3v5h5" /><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8" /><path d="M12 7v5l4 2" /></>,
  link: <><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" /><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" /></>,
  eye: <><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" /><circle cx="12" cy="12" r="3" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 15.5 14" /></>,
  vault: <><path d="M12 2l8 4v6c0 5-3.5 8-8 10-4.5-2-8-5-8-10V6z" /><path d="M9 12l2 2 4-4" /></>,
  bag: <><rect x="2" y="7" width="20" height="14" rx="2.5" /><path d="M16 7V5a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v2" /></>,
  chart: <><path d="M3 3v18h18" /><polyline points="7 14 11 9 15 12 20 6" /></>,
  up: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></>,
  cam: <><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" /></>,
};

const SUBS: { k: SubTab; t: string; d: ReactNode }[] = [
  { k: 'supplier', t: 'Supplier Details', d: P.building },
  { k: 'linked', t: 'Linked Payment Requests', d: P.link },
  { k: 'summary', t: 'Payment Summary', d: P.rupee },
  { k: 'physical', t: 'Physical Inspection', d: P.eye },
  { k: 'status', t: 'Current Transaction Status', d: P.clock },
];

const money = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;

/** 20/07/2026 — the stamp under the request id. */
function shortDate(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}
/** 16 Jun 2026 — the second line of a header chip. */
function longDate(iso?: string | null) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

const STATUS_VARIANT: Record<RequestStatus, BadgeVariant> = { awaiting: 'gold', approved: 'success', declined: 'danger' };
const statusText = (r: LinkedRequest | Detail['row']) =>
  r.status === 'approved' && r.approvedAmount !== null && r.approvedAmount < r.requestedAmount
    ? 'Approved In Part' : STATUS_LABEL[r.status];

const NO_APPROVE_TIP = 'You need Approve permission on Payment Request Management to decide requests';

// A popup opened from this page owns Esc while it is up.
const POPUP_LAYERS = '.spi-mdl-backdrop, .cgst-backdrop, .prd-detail-overlay, .prd-vault';

export default function PaymentRequestDetail({ requestId, onBack, onOpenRequest, onChanged }: {
  requestId: string;
  onBack: () => void;
  /** A request was approved or declined here — the list behind should reload. */
  onChanged?: () => void;
  /** Opens another request from the Linked Payment Requests tab. */
  onOpenRequest: (requestId: string) => void;
}) {
  useScrollLock(true, '.prd-root');
  const toast = useToast();
  const { user } = useAuth();
  // Deciding a request needs Approve on this module; viewing it only needs View.
  const canApprove = user?.user_type === 'super_admin' || !!user?.permissions?.['p2p.payment_request']?.can_approve;

  const [detail, setDetail] = useState<Detail | null | undefined>(undefined);
  const [tx, setTx] = useState<TxTab>('current');
  const [sub, setSub] = useState<SubTab>('supplier');
  const [vaultOpen, setVaultOpen] = useState(false);
  const [decide, setDecide] = useState<{ mode: DecisionMode; request: PaymentRequestRow } | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    setDetail(undefined);
    setTx('current');
    setSub('supplier');
  }, [requestId]);
  useEffect(() => {
    let live = true;
    void fetchPaymentRequestDetail(requestId).then(d => { if (live) setDetail(d); });
    return () => { live = false; };
  }, [requestId, version]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || document.querySelector(POPUP_LAYERS)) return;
      onBack();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onBack]);

  const soon = (what: string) => toast.info(what, 'Logic coming soon');
  // Only a request still awaiting approval can be decided.
  const openDecision = (mode: DecisionMode, request: PaymentRequestRow) => {
    if (request.status !== 'awaiting') {
      toast.warning(`${request.requestId} has already been ${request.status === 'approved' ? 'approved' : 'declined'}`);
      return;
    }
    setDecide({ mode, request });
  };
  const onDecided = (r: PaymentRequestRow) => {
    setDecide(null);
    setVersion(v => v + 1);
    onChanged?.();
    if (r.status === 'approved') toast.success(`${r.requestId} approved for ₹${(r.approvedAmount ?? 0).toLocaleString('en-IN')}`, 'Payment can now be released');
    else toast.warning(`${r.requestId} declined`, `₹${r.requestedAmount.toLocaleString('en-IN')} is back on the available balance`);
  };

  if (detail === undefined) {
    return createPortal(
      <div className="prd-root"><div className="prd-shell prd-shell--empty"><span className="spinner-border text-info" role="status" /></div></div>,
      document.body,
    );
  }

  if (detail === null) {
    return createPortal(
      <div className="prd-root">
        <div className="prd-shell">
          <div className="prd-head">
            <div className="prd-hrow">
              <div className="prd-titleblock">
                <h3 className="prd-title">Request not found</h3>
                <p className="prd-sub">This payment request is no longer available.</p>
              </div>
              <button type="button" className="prd-close" title="Back to Payment Request Management" onClick={onBack}><G d={P.back} stroke={2.6} /></button>
            </div>
          </div>
        </div>
      </div>,
      document.body,
    );
  }

  const { row, doc, ledger, supplier, po } = detail;
  const decided = row.status !== 'awaiting';
  const decidedTip = decided
    ? `This request was already ${row.status === 'approved' ? 'approved' : 'declined'} — no further decision can be taken on it`
    : !canApprove ? NO_APPROVE_TIP : undefined;
  const D = doc.kind === 'spi' ? 'SPI' : 'PO';
  const badgeCls = row.status === 'approved' ? 'done' : row.status === 'declined' ? 'no' : 'prog';

  const chip = (ico: ReactNode, lbl: string, val: string, subText: string) => (
    <div className="prd-chip">
      <div className="prd-chip__lbl">{ico}{lbl}</div>
      <div className="prd-chip__val" title={val}>{val}</div>
      <div className="prd-chip__sub" title={subText}>{subText}</div>
    </div>
  );
  const card = (ico: ReactNode, lbl: string, val: string, cls = '') => (
    <div className="prd-refcard">
      <div className="prd-refcard__lbl">{ico}{lbl}</div>
      <div className={`prd-refcard__val ${cls}`} title={val}>{val}</div>
    </div>
  );
  const i9 = (d: ReactNode) => <G d={d} size={9} stroke={2.5} />;

  return createPortal(
    <div className="prd-root">
      <div className="prd-shell">

        <div className="prd-head">
          <div className="prd-hrow">
            <div className="prd-titlewrap">
              <div className="prd-hicon"><G d={P.send} size={20} stroke={2.1} /></div>
              <div className="prd-titleblock">
                <div className="prd-titleline">
                  <h3 className="prd-title">{row.requestId}</h3>
                  <span className={`prd-badge ${badgeCls}`}><span className="prd-badge__dot" />{statusText(row)}</span>
                </div>
                <p className="prd-sub">
                  Request raised against <b className="prd-sub__doc">{doc.id}</b> Requested {shortDate(row.requestDate)}
                </p>
              </div>
            </div>

            <div className="prd-right">
              <div className="prd-chips">
                {chip(i9(P.doc), `${D} Number`, doc.id, longDate(doc.date))}
                {chip(i9(P.building), 'Supplier', supplier?.code ?? '—', row.supplier)}
                {chip(i9(P.truck), 'Shipment ID', row.shipment?.id ?? '—', longDate(row.shipment?.date))}
                {chip(i9(P.target), 'Opportunity ID', row.opportunity.id, longDate(row.opportunity.date))}
                {chip(i9(P.cart), 'Procurement ID', row.procurement.id, longDate(row.procurement.date))}
              </div>
              <div className="prd-hactions">
                <button
                  type="button"
                  className="prd-act prd-act--vault"
                  title="Every document behind this transaction — the purchase order, its trade documents and agreements, and the supplier invoices mapped to it"
                  onClick={() => setVaultOpen(true)}
                >
                  <G d={P.vault} stroke={2.4} />Evidence Vault
                </button>
                <button type="button" className="prd-act prd-act--ok" disabled={decided || !canApprove} title={decidedTip} onClick={() => openDecision('approve', row)}>
                  <G d={<path d="M20 6 9 17l-5-5" />} stroke={2.8} />Approve Request
                </button>
                <button type="button" className="prd-act prd-act--no" disabled={decided || !canApprove} title={decidedTip} onClick={() => openDecision('decline', row)}>
                  <G d={<><circle cx="12" cy="12" r="9" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></>} stroke={2.6} />
                  Reject / Decline Request
                </button>
                <button type="button" className="prd-close" title="Back to Payment Request Management" onClick={onBack}><G d={P.back} stroke={2.6} /></button>
              </div>
            </div>
          </div>

          <div className="prd-cols">
            <div className="prd-col">
              <div className="prd-col__hd">
                <div className="prd-col__ico"><G d={P.send} /></div>
                <span className="prd-col__t">Payment Request Details</span><span className="prd-col__rule" />
              </div>
              <div className="prd-col__grid">
                {card(i9(P.ref), 'Request ID', row.requestId)}
                {card(i9(P.card), 'Payment Type', row.paymentType)}
                {card(i9(P.pct), 'Payment (%)', `${row.percentOfTotal}%`)}
                {card(i9(P.rupee), 'Requested Payment Amount', money(row.requestedAmount), 'is-amt')}
                {card(i9(P.user), 'Requested By', row.requestedBy.name)}
              </div>
            </div>
            <div className="prd-col">
              <div className="prd-col__hd">
                <div className="prd-col__ico"><G d={P.wallet} /></div>
                <span className="prd-col__t">Payment Details (Till Current Date)</span><span className="prd-col__rule" />
              </div>
              <div className="prd-col__grid">
                {card(i9(P.receipt), `Total ${D} Amount`, money(ledger.total), 'is-amt')}
                {card(i9(P.rupee), 'Total Paid Amount', money(ledger.paid), 'green is-amt')}
                {card(i9(P.scale), 'Balance Amount', money(ledger.balance), 'amber is-amt')}
                {card(i9(P.send), 'Previously Request Amount', money(ledger.prevRequested), 'is-amt')}
                {card(i9(P.badge), 'Approved Amount', money(ledger.approvedTotal), 'green is-amt')}
                {card(i9(P.wallet), 'Amount that Open to Request', money(ledger.available), 'amber is-amt')}
              </div>
            </div>
          </div>
        </div>

        <div className="prd-body">
          <div className="prd-sticky">
            <div className="prd-txtabs">
              <div className="prd-seg" role="tablist" aria-label="Transaction views">
                <button type="button" role="tab" aria-selected={tx === 'current'} className={`prd-seg__tab${tx === 'current' ? ' is-active' : ''}`} onClick={() => setTx('current')}>
                  <G d={P.card} size={15} stroke={2.1} /><span className="prd-seg__lbl">Current Transaction</span><span className="prd-seg__cnt">1</span>
                </button>
                <button type="button" role="tab" aria-selected={tx === 'history'} className={`prd-seg__tab${tx === 'history' ? ' is-active' : ''}`} onClick={() => setTx('history')}>
                  <G d={P.history} size={15} stroke={2.1} /><span className="prd-seg__lbl">All Previous Transaction History</span><span className="prd-seg__cnt">{detail.history.length}</span>
                </button>
              </div>
            </div>
            {tx === 'current' && (
              <div className="prd-subrow" role="tablist" aria-label="Current transaction sections">
                {SUBS.map(s => {
                  const req = s.k === 'physical' && detail.inspection.required;
                  return (
                    <button
                      key={s.k}
                      type="button"
                      role="tab"
                      aria-selected={sub === s.k}
                      className={`prd-subtab${sub === s.k ? ' is-active' : ''}${req ? ' has-req' : ''}`}
                      onClick={() => setSub(s.k)}
                    >
                      <span className="prd-subtab__ico"><G d={s.d} size={15} stroke={2.1} /></span>
                      {s.t}
                      {s.k === 'physical' && (
                        <span className={`prd-subreq${req ? '' : ' is-not'}`}>{req ? 'Required' : 'Not Required'}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {tx === 'history' ? (
            <HistoryPanel detail={detail} onSoon={soon} />
          ) : sub === 'supplier' ? (
            <SupplierPanel supplier={supplier} onSoon={soon} />
          ) : sub === 'linked' ? (
            <LinkedPanel detail={detail} canApprove={canApprove} onOpenRequest={onOpenRequest} onDecide={openDecision} />
          ) : sub === 'summary' ? (
            <SummaryPanel detail={detail} onSoon={soon} />
          ) : sub === 'physical' ? (
            <InspectionPanel key={requestId} detail={detail} />
          ) : (
            <StatusPanel po={po} onInspect={() => setSub('physical')} onManage={() => setSub('linked')} />
          )}
        </div>

        <div className="prd-foot">
          <div className="prd-foot__info">Payment request <b>{row.requestId}</b> raised against <b>{doc.id}</b></div>
          <button type="button" className="prd-backbtn" onClick={onBack}><G d={P.back} stroke={2.6} />Back to Payment Request Management</button>
        </div>
      </div>

      {vaultOpen && <TxnVaultModal detail={detail} onClose={() => setVaultOpen(false)} />}
      {decide && (
        <PaymentRequestDecisionModal
          mode={decide.mode}
          detail={detail}
          request={decide.request}
          onClose={() => setDecide(null)}
          onDecided={onDecided}
        />
      )}
    </div>,
    document.body,
  );
}

/* ── Empty state, shared by every tab that has nothing to show ── */
function Empty({ d, title, sub }: { d: ReactNode; title: string; sub: string }) {
  return (
    <div className="prd-empty">
      <div className="prd-empty__ico"><G d={d} size={26} stroke={1.9} /></div>
      <div className="prd-empty__t">{title}</div>
      <div className="prd-empty__s">{sub}</div>
    </div>
  );
}

/* ══ Supplier Details ══
   The Create PO supplier stage, read-only: an approver reads this record,
   they don't maintain it. Every box still collapses from its header. */
type BoxKey = 'basic' | 'address' | 'legal' | 'gst' | 'risk';

function SupBox({ open, onToggle, icon, title, extras, children }: {
  open: boolean; onToggle: () => void; icon: ReactNode; title: string; extras?: ReactNode; children: ReactNode;
}) {
  return (
    <div className={`spi-dt-card prd-supbox${open ? '' : ' is-collapsed'}`}>
      <div className="spi-dt-card-head cpf-clickable" onClick={onToggle} title={`Show / hide ${title}`}>
        <div className="spi-dt-card-title"><span className="spi-dt-card-ico">{icon}</span> {title}</div>
        <span className="prd-supbox__x" onClick={e => e.stopPropagation()}>{extras}</span>
        <span className={`cpf-chev ${open ? '' : 'is-closed'}`}><IcoChevron /></span>
      </div>
      {open && children}
    </div>
  );
}

function RO({ label, value, full }: { label: string; value: string; full?: boolean }) {
  return (
    <Field label={label} full={full}>
      <input className="spi-dt-inp" value={value} readOnly tabIndex={-1} title={value} />
    </Field>
  );
}

function SupplierPanel({ supplier: s, onSoon }: { supplier: Supplier | undefined; onSoon: (what: string) => void }) {
  const [open, setOpen] = useState<Record<BoxKey, boolean>>({ basic: true, address: true, legal: true, gst: true, risk: true });
  const [notice, setNotice] = useState<GstNotice | null>(null);
  const toggle = (k: BoxKey) => setOpen(o => ({ ...o, [k]: !o[k] }));

  const risks = useMemo(() => (s ? riskItems(s, false) : []), [s]);
  if (!s) {
    return <Empty d={P.building} title="Supplier Details" sub="The supplier record could not be loaded." />;
  }

  const legal = legalTotals(s);
  const legalTone = legal.pct === 100 ? 'ok' : legal.pct >= 60 ? 'warn' : 'bad';
  const sections = legalSections(s);

  const scrutinyAge = monthsAgo(s.scrutiny);
  const filingAge = monthsAgo(s.filing);
  const gst = gstState(s.key, scrutinyAge, filingAge);
  const openNotice = () => {
    if (gst.tone !== 'stop' && gst.tone !== 'warn') return;
    setNotice({
      tone: gst.tone, supplier: s.key, code: s.code, scrutiny: s.scrutiny, filing: s.filing,
      scrutinyAge, filingAge, cutoff: cutoffDate(), months: GST_STALE_MONTHS,
    });
  };

  const nHigh = risks.filter(r => r.sev === 'high').length;
  const nMed = risks.filter(r => r.sev === 'med').length;
  const nOk = risks.filter(r => r.sev === 'ok').length;
  const riskSev: Severity = nHigh ? 'high' : nMed ? 'med' : 'ok';
  const verdict = nHigh
    ? `${nHigh} critical issue${nHigh === 1 ? '' : 's'} need attention${nMed ? ` · ${nMed} warning${nMed === 1 ? '' : 's'}` : ''}`
    : nMed
      ? `${nMed} warning${nMed === 1 ? '' : 's'} to review before release`
      : 'All checks cleared — this supplier is safe to transact with';

  return (
    <div className="prd-secwrap cpf-form prd-sup">
      {notice && <GstNoticeModal notice={notice} onClose={() => setNotice(null)} />}

      <SupBox open={open.basic} onToggle={() => toggle('basic')} icon={<IcoUser />} title="Supplier Basic Details"
        extras={<span className="spi-dt-fields-badge">5 Fields</span>}>
        <div className="spi-dt-grid4 cpf-grid5">
          <RO label="SELECT SUPPLIER" value={`${s.code} — ${s.key}`} />
          <RO label="COMPANY LEGAL NAME" value={s.legalName} />
          <RO label="SUPPLIER TYPE" value={s.type} />
          <RO label="RISK LEVEL" value={s.risk} />
          <RO label="SUPPLIER CATEGORY" value={s.category} />
        </div>
      </SupBox>

      <SupBox open={open.address} onToggle={() => toggle('address')} icon={<IcoPin />} title="Supplier Address & Contact Details"
        extras={<span className="spi-dt-fields-badge">9 Fields</span>}>
        <div className="spi-dt-grid4">
          <RO label="REGISTERED OFFICE ADDRESS" value={s.addr} full />
          <RO label="COUNTRY" value={s.country} />
          <RO label="STATE" value={s.state} />
          <RO label="STATE CODE" value={s.stateCode} />
          <RO label="CITY" value={s.city} />
          <RO label="CONTACT PERSON NAME" value={s.contact} />
          <RO label="DESIGNATION" value={s.desig} />
          <RO label="CONTACT NUMBER" value={s.phone} />
          <RO label="EMAIL ID" value={s.email} />
        </div>
      </SupBox>

      <SupBox open={open.legal} onToggle={() => toggle('legal')} icon={<IcoShield />} title="Supplier Legal Status"
        extras={<>
          <span className={`spi-dt-legal-badge ${legal.pct === 100 ? 'ok' : 'warn'}`}>{legal.pct === 100 ? '100% Compliant' : `${legal.pct}% · Needs Review`}</span>
          <button type="button" className="cpf-vault" title={`Visit ${s.key}’s Evidence Vault`} onClick={() => onSoon('Supplier Evidence Vault')}>
            <IcoShield /> <span>Visit Supplier Evidence Vault</span>
          </button>
          <span className="cpf-lgbar"><span className={`cpf-lgbar__fill cpf-fill-${legalTone}`} style={{ width: `${legal.pct}%` }} /></span>
          <span className="cpf-lgpct">{legal.pct}%</span>
        </>}>
        <div className="cpf-lg">
          <div className="cpf-lg__tabs">
            {sections.map(sec => (
              <div key={sec.name} className={`cpf-lg__tab cpf-lg__tab--${sec.tone}`} title={sec.params.map(i => LEGAL_PARAMS[i].name).join(' · ')}>
                <div className="cpf-lg__hd">
                  <span className="cpf-lg__ico">{sec.params.length > 2 ? <IcoShield /> : <IcoDocSm />}</span>
                  <span className="cpf-lg__txt">
                    <span className="cpf-lg__nm">{sec.name}</span>
                    <span className="cpf-lg__sub">{sec.sub}</span>
                  </span>
                  <span className="cpf-lg__cnt">{sec.done} / {sec.total}</span>
                  <span className="cpf-lg__pct">{sec.pct}%</span>
                </div>
                <div className="cpf-lg__bar"><span className="cpf-lg__fill" style={{ width: `${sec.pct}%` }} /></div>
              </div>
            ))}
          </div>
        </div>
      </SupBox>

      <SupBox open={open.gst} onToggle={() => toggle('gst')} icon={<IcoDocSm />} title="Supplier GST Scrutiny Details"
        extras={<span className="spi-dt-fields-badge">5 Fields</span>}>
        <div className="prd-gstbd">
          <div className={`cpf-gst cpf-gst--${gst.tone}`}>
            <span className="cpf-gst__ico">{gst.tone === 'ok' ? <IcoOk /> : gst.tone === 'stop' ? <IcoStop /> : gst.tone === 'warn' ? <IcoWarn /> : <IcoClock />}</span>
            <span className="cpf-gst__txt">
              <span className="cpf-gst__t">{gst.title}</span>
              <span className="cpf-gst__s">{gst.note}</span>
              <span className="cpf-gst__meta">
                Scrutiny <b>{formatDmy(s.scrutiny)}</b>
                {scrutinyAge !== null && <span className="cpf-gst__age">{scrutinyAge.toFixed(1)} mo ago</span>}
                <span className="cpf-gst__sep" />
                Last filing <b>{formatDmy(s.filing)}</b>
                {filingAge !== null && <span className="cpf-gst__age">{filingAge.toFixed(1)} mo ago</span>}
              </span>
            </span>
            {gst.action && <button type="button" className="cpf-gst__btn" onClick={openNotice}>{gst.action}</button>}
          </div>
          <div className="spi-dt-grid4">
            <RO label="SCRUTINY DATE" value={formatDmy(s.scrutiny)} />
            <RO label="GST NUMBER" value={s.gstNo} />
            <RO label="GST STATUS" value={s.gstStatus} />
            <RO label="LAST FILING DATE" value={formatDmy(s.filing)} />
            <Field label="PREV. INVOICE / REMARKS" full>
              <textarea className="spi-dt-textarea" value={s.remarks} readOnly tabIndex={-1} />
            </Field>
          </div>
        </div>
      </SupBox>

      <SupBox open={open.risk} onToggle={() => toggle('risk')} icon={<IcoAlert />} title="Supplier Risk Alerts"
        extras={
          <span className={`cpf-risk__badge cpf-risk__badge--${riskSev}`}>
            {nHigh ? `${nHigh} critical${nMed ? ` · ${nMed} warning` : ''}` : nMed ? `${nMed} warning${nMed === 1 ? '' : 's'}` : 'All clear'}
          </span>
        }>
        <div className="cpf-risk">
          <div className={`cpf-risk__sum cpf-risk__sum--${riskSev}`}>
            <span className="cpf-risk__sum-ico"><SevIcon sev={riskSev} /></span>
            <div className="cpf-risk__sum-txt">
              <div className="cpf-risk__sum-t">{verdict}</div>
              <div className="cpf-risk__sum-x">{nOk} of {risks.length} checks passed · risk rating, category, GST registration, filing, scrutiny and documents</div>
            </div>
            <span className="cpf-risk__sum-score">{nOk}/{risks.length}</span>
          </div>
          {isRiskMandatory(s) && (
            <div className="cpf-guide">
              <div className="cpf-guide__hd">
                <span className="cpf-guide__ico"><IcoLock /></span>
                <span className="cpf-guide__t">Mandatory Guidelines</span>
                <span className="cpf-guide__tag">Enforced on this PO</span>
              </div>
              <div className="cpf-guide__list">
                {RISK_GUIDELINES.map(g => (
                  <div key={g.title} className="cpf-guide__row">
                    <span className="cpf-guide__ck"><IcoCheck /></span>
                    <div><div className="cpf-guide__rt">{g.title}</div><div className="cpf-guide__rx">{g.note}</div></div>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="cpf-risk__list">
            {risks.map(r => (
              <div key={r.title} className={`cpf-risk__row cpf-risk__row--${r.sev}`}>
                <span className="cpf-risk__dot"><SevIcon sev={r.sev} /></span>
                <div className="cpf-risk__txt">
                  <div className="cpf-risk__t">{r.title}</div>
                  <div className="cpf-risk__d">{r.note}</div>
                </div>
                <span className="cpf-risk__tag">{r.tag}</span>
              </div>
            ))}
          </div>
        </div>
      </SupBox>
    </div>
  );
}

/* ── Running totals, shared by Linked Payment Requests and Payment Summary ── */
function StatCards({ detail }: { detail: Detail }) {
  const { ledger, linked, doc } = detail;
  const D = doc.kind === 'spi' ? 'SPI' : 'PO';
  const requested = linked.reduce((s, r) => s + r.requestedAmount, 0);
  const pending = linked.filter(r => r.status === 'awaiting');
  const waiting = pending.reduce((s, r) => s + r.requestedAmount, 0);
  const pctPaid = ledger.net > 0 ? Math.round((ledger.paid / ledger.net) * 100) : 0;
  const n = linked.length;
  const stats: { mod: string; d: ReactNode; lbl: string; val: string; sub: string }[] = [
    { mod: '', d: P.bag, lbl: `Total ${D} Amount`, val: money(ledger.total), sub: `${money(ledger.net)} net payable` },
    { mod: 'base', d: P.send, lbl: 'Total Requested Amount', val: money(requested), sub: `${n} request${n === 1 ? '' : 's'} raised to date` },
    { mod: 'bal', d: P.clock, lbl: 'Awaiting For Approval', val: money(waiting), sub: `${pending.length} with the approver now` },
    { mod: 'gst', d: <path d="M20 6 9 17l-5-5" />, lbl: 'Total Approved Amount', val: money(ledger.approvedTotal), sub: `${money(Math.max(0, ledger.approvedTotal - ledger.paid))} awaiting release` },
    { mod: 'paid', d: P.rupee, lbl: 'Total Paid Amount', val: money(ledger.paid), sub: `${pctPaid}% of net payable released` },
    { mod: 'tds', d: P.chart, lbl: 'Balance Amount', val: money(ledger.balance), sub: ledger.balance <= 0 ? `${D} settled in full` : `${money(ledger.available)} open to request` },
  ];
  return (
    <div className="prd-stats">
      {stats.map(s => (
        <div key={s.lbl} className={`prd-stat${s.mod ? ` prd-stat--${s.mod}` : ''}`}>
          <div className="prd-stat__ico"><G d={s.d} size={19} stroke={2} /></div>
          <div>
            <div className="prd-stat__lbl">{s.lbl}</div>
            <div className="prd-stat__val">{s.val}</div>
            <div className="prd-stat__sub">{s.sub}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function IdCell({ id, date, extra }: { id: string; date: string; extra?: ReactNode }) {
  return (
    <div className="ord-idcell">
      <span className="ord-idpill">{id}</span>
      <span className="ord-idcell__date">{formatDmy(date)}</span>
      {extra}
    </div>
  );
}

function Panel({ title, count, sub, children }: { title: string; count: number; sub: string; children: ReactNode }) {
  return (
    <div className="prd-panel">
      <div className="prd-panel__hd">
        <span className="prd-panel__t">{title}</span>
        <span className="prd-panel__c">{count}</span>
        <span className="prd-panel__s">{sub}</span>
      </div>
      {children}
    </div>
  );
}

/* ══ Linked Payment Requests ══ every request on the same document, the open one pinned first. */
// The action well is fixed: three labelled buttons never shrink.
const LINKED_COLS: [string, number][] = [
  ['Sr No', 52], ['Payment Request ID', 124], ['Request Raised Against', 132], ['Payment Type', 118], ['Payment %', 76],
  ['Requested Payment Amount', 118], ['Requested By', 150], ['Requested To', 140], ['Request Approval Status', 148],
  ['Approved Amount', 104], ['Paid Amount', 96], ['Action', 410],
];
const LINKED_WIDTH = LINKED_COLS.reduce((s, [, w]) => s + w, 0);

function LinkedPanel({ detail, canApprove, onOpenRequest, onDecide }: {
  detail: Detail; canApprove: boolean; onOpenRequest: (id: string) => void;
  onDecide: (mode: DecisionMode, request: PaymentRequestRow) => void;
}) {
  const { linked, doc, row: current } = detail;
  return (
    <div className="prd-secwrap">
      <StatCards detail={detail} />
      <Panel title="All Payment Requests" count={linked.length} sub="Currently open request first, then in the order they were raised">
        <div className="ord-table-scroll">
          <table className="ord-table prd-table" style={{ minWidth: LINKED_WIDTH }}>
            <colgroup>{LINKED_COLS.map(([c, w]) => <col key={c} style={{ width: w }} />)}</colgroup>
            <thead><tr>{LINKED_COLS.map(([c]) => <th key={c}>{c}</th>)}</tr></thead>
            <tbody>
              {linked.map((r, i) => {
                const isCurrent = r.requestId === current.requestId;
                // Once money has gone out there is nothing left to decide.
                const settled = r.paid > 0;
                return (
                  <tr key={r.requestId} className={`is-first is-last${isCurrent ? ' is-current' : ''}${r.flag === 'physical-inspection' ? ' is-physreq' : ''}${r.status === 'declined' ? ' is-closed' : ''}`}>
                    <td><span className="prd-sr">{i + 1}</span></td>
                    <td><IdCell id={r.requestId} date={r.requestDate} extra={isCurrent ? <span className="prd-now">Currently open</span> : null} /></td>
                    <td><IdCell id={doc.id} date={doc.date} /></td>
                    <td><span className="prm-paytype">{r.paymentType}</span></td>
                    <td><span className="ord-amt">{r.percentOfTotal}%</span></td>
                    <td><span className="ord-amt ord-amt--net">{money(r.requestedAmount)}</span></td>
                    <td><Person name={r.requestedBy.name} /></td>
                    <td><Person name={r.requestedTo.name} /></td>
                    <td><Badge variant={STATUS_VARIANT[r.status]} dot>{statusText(r)}</Badge></td>
                    <td><span className="ord-amt ord-amt--paid">{r.status === 'approved' && r.approvedAmount !== null ? money(r.approvedAmount) : '—'}</span></td>
                    <td><span className={`ord-amt${r.paid > 0 ? ' ord-amt--paid' : ''}`}>{r.paid > 0 ? money(r.paid) : '—'}</span></td>
                    <td>
                      <div className="prd-rowacts">
                        <button type="button" className="ord-btn prm-viewbtn" title={`View ${r.requestId}`} onClick={() => onOpenRequest(r.requestId)}>
                          <span className="prm-viewbtn__ico"><IcoEye size={9} /></span><span>View Request</span>
                        </button>
                        <button type="button" className="prd-rowact prd-rowact--ok" disabled={settled || !canApprove} title={canApprove ? undefined : NO_APPROVE_TIP} onClick={() => onDecide('approve', r)}>
                          <IcoCheck size={13} stroke={2.5} />Approve Request
                        </button>
                        <button type="button" className="prd-rowact prd-rowact--no" disabled={settled || !canApprove} title={canApprove ? undefined : NO_APPROVE_TIP} onClick={() => onDecide('decline', r)}>
                          <IcoCircleX size={13} stroke={2.5} />Reject Request
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

function Person({ name }: { name: string }) {
  const initials = name.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
  return (
    <div className="prd-person">
      <span className="prd-person__av">{initials}</span>
      <span className="prd-person__n" title={name}>{name}</span>
    </div>
  );
}

/* ══ Payment Summary ══ the running totals, then every release made against the document. */
const PAY_COLS = ['Sr. No', 'Paid Against Request ID', 'Request Raised Against', 'Paid Amount', 'Bank Name',
  'UTR / Cheque Number', 'UTR / Cheque Date', 'Proof Of Payment'];

function SummaryPanel({ detail, onSoon }: { detail: Detail; onSoon: (what: string) => void }) {
  const { payments, doc } = detail;
  const D = doc.kind === 'spi' ? 'SPI' : 'PO';
  return (
    <div className="prd-secwrap">
      <StatCards detail={detail} />
      <Panel title="Payments Released" count={payments.length} sub={`Against every request raised on this ${D}, oldest first`}>
        {payments.length === 0 ? (
          <div className="prd-panel__empty">
            <div className="prd-panel__empty-t">No payment released yet</div>
            <div className="prd-panel__empty-s">Once a payment is released against an approved request it will be listed here with its bank, reference and proof.</div>
          </div>
        ) : (
          <div className="ord-table-scroll">
            <table className="ord-table prd-table prd-table--pay">
              <thead><tr>{PAY_COLS.map(c => <th key={c}>{c}</th>)}</tr></thead>
              <tbody>
                {payments.map((p, i) => {
                  const cheque = /cheque|draft/i.test(p.mode);
                  const file = `POP_${p.ref}.pdf`;
                  return (
                    <tr key={`${p.requestId}-${p.ref}`} className="is-first is-last">
                      <td><span className="prd-sr">{i + 1}</span></td>
                      <td><IdCell id={p.requestId} date={p.requestDate} /></td>
                      <td><IdCell id={p.doc} date={p.docDate} /></td>
                      <td><span className="ord-amt ord-amt--net">{money(p.amount)}</span></td>
                      <td><span className="prd-bank">{p.bank}</span></td>
                      <td>
                        <div className="prd-ref">
                          <span className="ord-idpill prd-utr" title={`${cheque ? 'Cheque No' : 'UTR No'} ${p.ref}`}>{p.ref}</span>
                          <span className="prd-mode">{p.mode}</span>
                        </div>
                      </td>
                      <td><span className="prd-date">{formatDmy(p.date)}</span></td>
                      <td>
                        <span className="prd-file">
                          <span className="prd-file__ico"><IcoFile size={13} /></span>
                          <span className="prd-file__name" title={file}>{file}</span>
                          <span className="prd-file__sep" />
                          <button type="button" className="prd-fbtn prd-fbtn--view" title="View proof of payment" onClick={() => onSoon(`View ${file}`)}><IcoEye size={13} /></button>
                          <button type="button" className="prd-fbtn prd-fbtn--dl" title="Download proof of payment" onClick={() => onSoon(`Download ${file}`)}><IcoDownload size={13} /></button>
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}

/* ══ Physical Inspection ══
   The PO module's inspection table against the order behind this request:
   mark each line and attach its proof. A direct SPI has no order, so no gate. */
const blankLine = (): InspectionLine => ({ verdict: '', files: [] });

function InspectionPanel({ detail }: { detail: Detail }) {
  const toast = useToast();
  const { po, inspection } = detail;
  const [lines, setLines] = useState<Record<string, InspectionLine>>({});
  const [attFor, setAttFor] = useState<InspectionProduct | null>(null);
  const [viewFor, setViewFor] = useState<InspectionProduct | null>(null);

  if (!po) {
    return <Empty d={P.eye} title="No inspection on this request"
      sub="This supplier invoice was raised without a purchase order behind it, so there is no physical inspection to answer to." />;
  }
  if (!inspection.required) {
    return <Empty d={P.eye} title="Inspection not required"
      sub={`Purchase order ${po.po} is not flagged for physical inspection, so payment does not wait on one.`} />;
  }

  const done = inspection.completed;
  const lineOf = (code: string) => lines[code] ?? (done ? { verdict: 'correct' as Verdict, files: [] } : blankLine());
  const setLine = (code: string, next: Partial<InspectionLine>) =>
    setLines(cur => ({ ...cur, [code]: { ...(cur[code] ?? blankLine()), ...next } }));

  const addFiles = async (code: string, e: ChangeEvent<HTMLInputElement>) => {
    const added = await toProofFiles(e.target.files);
    e.target.value = '';
    if (added.length) setLine(code, { files: [...lineOf(code).files, ...added] });
  };
  const removeFile = (code: string, i: number) => {
    const f = lineOf(code).files[i];
    if (f?.url) URL.revokeObjectURL(f.url);
    if (f?.thumb) URL.revokeObjectURL(f.thumb);
    setLine(code, { files: lineOf(code).files.filter((_, ix) => ix !== i) });
  };
  const viewFile = (f: ProofFile) => { if (!openFile(f)) toast.info('Preview', `${f.name} — logic coming soon`); };
  const dlFile = (f: ProofFile) => { if (!downloadFile(f)) toast.info('Download', `${f.name} — logic coming soon`); };

  return (
    <div className="prd-secwrap">
      {attFor && (
        <InspectionAttachmentsModal
          productName={attFor.name}
          productCode={attFor.code}
          files={lineOf(attFor.code).files}
          onView={ix => viewFile(lineOf(attFor.code).files[ix])}
          onDownload={ix => dlFile(lineOf(attFor.code).files[ix])}
          onRemove={ix => removeFile(attFor.code, ix)}
          onClose={() => setAttFor(null)}
        />
      )}
      {viewFor && <InspectionProductView product={viewFor} onClose={() => setViewFor(null)} />}

      <div className="prd-sechead">
        <span className="prd-sechead__t">Physical Inspection</span>
        <span className="prd-panel__c">{inspection.products.length}</span>
        <span className={`prd-state ${done ? 'is-done' : 'is-wait'}`}>{done ? 'Completed' : 'Pending'}</span>
        <span className="prd-sechead__s">Goods on {po.po} · mark every line and attach its proof</span>
      </div>

      <div className="pins-scroll">
        <table className="pins-tbl">
          <colgroup>
            <col className="pins-col-sr" /><col className="pins-col-prod" /><col className="pins-col-desc" />
            <col className="pins-col-qty" /><col className="pins-col-rmk" /><col className="pins-col-proof" />
          </colgroup>
          <thead>
            <tr>
              <th>Sr. No</th>
              <th className="pins-th-left">Product (PO)</th>
              <th className="pins-th-left">Description</th>
              <th>Quantity (PO)</th>
              <th>Inspection Remark</th>
              <th>Proof of Inspection</th>
            </tr>
          </thead>
          <tbody>
            {inspection.products.map((p, i) => {
              const line = lineOf(p.code);
              const tag = VERDICTS.find(v => v.k === line.verdict);
              const n = line.files.length;
              return (
                <tr key={p.code} className={`pins-tr${line.verdict ? ' is-' + line.verdict : ''}`}>
                  <td className="pins-td-sr">{i + 1}</td>
                  <td>
                    <div className="pins-prod__nm">{p.name}</div>
                    <div className="pins-prod__meta">
                      <span className="pins-code">{p.code}</span>
                      <span className="pins-kv">HSN <b>{p.hsn}</b></span>
                      <span className="pins-prod__dot" />
                      <span className="pins-kv">GST <b>{p.gst}%</b></span>
                    </div>
                  </td>
                  <td className="pins-desc">
                    <span className="pins-desc__txt">{p.desc}</span>
                    <button type="button" className="pins-desc__more" onClick={() => setViewFor(p)}>… Read more</button>
                  </td>
                  <td className="pins-td-c"><span className="pins-qty">{p.qty}</span></td>
                  <td className="pins-td-c">
                    {done ? (
                      <span className={`pins-tagv pins-tagv--${line.verdict || 'none'}`}>{tag?.ico}{tag ? tag.t : '—'}</span>
                    ) : (
                      <span className="pins-seg">
                        {VERDICTS.map(v => (
                          <button type="button" key={v.k} className={`pins-seg__b pins-seg__b--${v.k}${line.verdict === v.k ? ' is-on' : ''}`} onClick={() => setLine(p.code, { verdict: v.k })}>
                            {v.ico}<span>{v.t}</span>
                          </button>
                        ))}
                      </span>
                    )}
                  </td>
                  <td className="pins-td-proof">
                    {done ? (
                      <span className={`pins-cnt${n ? ' is-on' : ''}`}>{n} file{n === 1 ? '' : 's'}</span>
                    ) : (
                      <div className="pins-attach">
                        <div className="pins-attach__row">
                          <label className="pins-btn" htmlFor={`prd-up-${p.code}`} title="Upload photos or videos"><G d={P.up} stroke={2.4} /><span>Upload</span></label>
                          <label className="pins-btn pins-btn--cam" htmlFor={`prd-cam-${p.code}`} title="Capture with camera"><G d={P.cam} stroke={2.3} /><span>Camera</span></label>
                          <span className={`pins-files${n ? ' is-on' : ''}`}>{n} file{n === 1 ? '' : 's'}</span>
                        </div>
                        <input id={`prd-up-${p.code}`} className="pins-file-in" type="file" multiple accept="image/*,video/*,application/pdf" onChange={e => addFiles(p.code, e)} />
                        <input id={`prd-cam-${p.code}`} className="pins-file-in" type="file" accept="image/*,video/*" capture="environment" onChange={e => addFiles(p.code, e)} />
                        {n > 0 ? (
                          <div className="pins-prooflist">
                            <ProofChip file={line.files[0]} onView={() => viewFile(line.files[0])} onDownload={() => dlFile(line.files[0])} onRemove={() => removeFile(p.code, 0)} />
                            {n > 1 && (
                              <button type="button" className="pins-more" onClick={() => setAttFor(p)}>
                                <span className="pins-more__n">+{n - 1}</span>
                                <span className="pins-more__t">View more proof{n - 1 === 1 ? '' : 's'}</span>
                              </button>
                            )}
                          </div>
                        ) : (
                          <div className="pins-empty">No evidence attached for this product yet.</div>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ══ Current Transaction Status / History ══
   The Purchase Order list's own row, Action column dropped — actions belong
   on the PO list, not here. */
const TX_COLUMNS = ORDER_COLUMNS.filter(c => c.label !== 'Action');
const TX_WIDTH = TX_COLUMNS.reduce((s, c) => s + c.width, 0);

function OrderTable({ rows, onInspect, onManage }: { rows: OrderRow[]; onInspect: () => void; onManage: () => void }) {
  return (
    <div className="ord-table-scroll prd-txscroll">
      <table className="ord-table" style={{ width: TX_WIDTH }}>
        <colgroup>{TX_COLUMNS.map(c => <col key={c.label} style={{ width: c.width }} />)}</colgroup>
        <thead>
          <tr>{TX_COLUMNS.map(c => <th key={c.label} className={c.groupEnd ? 'ord-table__group-end' : undefined}>{c.label}</th>)}</tr>
        </thead>
        {rows.map((r, i) => (
          <OrderRowBody key={r.po} row={r} sr={i + 1} inspected={r.inspectionDone} onInspect={onInspect} onManage={onManage} showActions={false} />
        ))}
      </table>
    </div>
  );
}

function StatusPanel({ po, onInspect, onManage }: { po: OrderRow | null; onInspect: () => void; onManage: () => void }) {
  if (!po) {
    return <Empty d={P.clock} title="No purchase order behind this request"
      sub="This supplier invoice was raised on its own, so there is no purchase order row to show here." />;
  }
  return (
    <div className="prd-secwrap">
      <div className="prd-sechead">
        <span className="prd-sechead__t">Current Transaction Status</span>
        <span className="prd-sechead__s">Purchase order {po.po} as it stands on the Purchase Order list</span>
      </div>
      <OrderTable rows={[po]} onInspect={onInspect} onManage={onManage} />
    </div>
  );
}

// One purchase order is one transaction: every other order with this supplier.
function HistoryPanel({ detail, onSoon }: { detail: Detail; onSoon: (what: string) => void }) {
  const rows = detail.history;
  if (!rows.length) {
    return <Empty d={P.history} title={`No earlier transactions with ${detail.row.supplier}`}
      sub="This is the first purchase order raised on this supplier, so there is no prior history to compare against." />;
  }
  return (
    <div className="prd-secwrap">
      <div className="prd-sechead">
        <span className="prd-sechead__t">All Previous Transaction History</span>
        <span className="prd-sechead__s">
          {rows.length} earlier purchase order{rows.length === 1 ? '' : 's'} raised on {detail.row.supplier} · one order is one transaction
        </span>
      </div>
      <OrderTable rows={rows} onInspect={() => onSoon('Physical Inspection')} onManage={() => onSoon('Payment Requests')} />
    </div>
  );
}
