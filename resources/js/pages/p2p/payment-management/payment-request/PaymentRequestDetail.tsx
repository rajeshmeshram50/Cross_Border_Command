// Payment Request Management → View Request. Opens full screen over the list,
// so Back returns to the queue with its tab, search and page untouched.
import { Suspense, lazy, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import Badge, { type BadgeVariant } from '../../../../components/ui/Badge';
import { useAuth } from '../../../../contexts/AuthContext';
import { useToast } from '../../../../contexts/ToastContext';
import { useConfirm } from '../../../../contexts/ConfirmContext';
import { useScrollLock } from '../../../../hooks/useScrollLock';
import { formatDmy } from '../../../../utils/formatDmy';
// Named apart from the inspection helper of the same name imported below.
import { downloadFile as downloadProofUrl } from '../../../../utils/downloadFile';
import { formatProductCode } from '../../../../utils/formatProductCode';
import { ORDER_COLUMNS, OrderRowBody, type OrderRow } from '../../purchase-management/order/po-list/Order';
import { Field } from '../../purchase-management/order/create-po/form-fields';
import GstNoticeModal, { type GstNotice } from '../../purchase-management/order/create-po/GstNoticeModal';
import {
  GST_STALE_MONTHS, SevIcon, cutoffDate, gstState, monthsAgo, riskItems, type Severity,
} from '../../purchase-management/order/create-po/supplier-checks';
import {
  LEGAL_PARAMS, RISK_GUIDELINES, isRiskMandatory, legalSections, legalTotals, toRiskSubject, type Supplier,
} from './payment-request-suppliers';
import {
  InspectionDescription, ProofChip, VERDICTS, downloadFile, openFile, saveBlob,
  type InspectionLine, type InspectionProduct, type ProofFile, type Verdict,
} from '../../purchase-management/order/physical-inspection/inspection-shared';
import InspectionAttachmentsModal from '../../purchase-management/order/physical-inspection/InspectionAttachmentsModal';
import InspectionProductView from '../../purchase-management/order/physical-inspection/InspectionProductView';
import {
  IcoAlert, IcoArrowL, IcoBriefcase, IcoBuilding, IcoCard, IcoCart, IcoCheck, IcoChevron,
  IcoCircleX, IcoClock, IcoDocSm, IcoDownload, IcoEye, IcoFile, IcoHistory, IcoLink, IcoLock, IcoOk,
  IcoPercent, IcoPin, IcoReceipt, IcoRupee, IcoScales, IcoSend, IcoShield, IcoShip, IcoStop, IcoTarget,
  IcoText, IcoTrend, IcoUser, IcoWallet, IcoWarn, IcoX,
  type IconProps,
} from '../../icons';
import { STATUS_LABEL, type RequestStatus } from './paymentRequestData';
import {
  fetchPaymentRequestDetail, type LinkedRequest, type PaymentRequestDetail as Detail,
} from './paymentRequestDetailData';
import TxnVaultModal from './TxnVaultModal';
import { PoApiError, poPaymentApi } from '../../purchase-management/order/api/po-api';
import api from '../../../../api';
import type { SupplierVaultTarget } from '../../p2p-master-management/supplier-management/SupplierEvidenceVaultModal';
// The supplier's own vault (KYC, DD, licences) — loaded only when opened.
const SupplierEvidenceVaultModal = lazy(() => import('../../p2p-master-management/supplier-management/SupplierEvidenceVaultModal'));
// Supplier master wizard, opened on its GST Scrutiny tab (supplier-maintenance permission only).
const AddVendorModal = lazy(() => import('../../p2p-master-management/supplier-management/AddVendorModal'));
import PaymentRequestDecisionModal, { type DecisionMode } from './PaymentRequestDecisionModal';
import type { PaymentRequestRow } from './paymentRequestData';
import '../../purchase-management/supplier-purchase-invoice/supplier-purchase-invoice.css';
import '../../purchase-management/order/po-list/order.css';
import '../../purchase-management/order/create-po/create-po.css';
import '../../purchase-management/order/physical-inspection/physical-inspection.css';
import './payment-request.css';
import '../../purchase-management/order/manage-payment/manage-payment-requests.css';
import './payment-request-detail.css';
import './payment-request-decision.css';
import { ccySymbol } from '../../../../utils/currency';
import { poInspectionApi } from '../../purchase-management/order/api/po-api';

/* An earlier order of this supplier opens the same two screens the PO list
   opens. They used to answer "coming soon" (CS-417). */
const PhysicalInspectionModal = lazy(() => import('../../purchase-management/order/physical-inspection/PhysicalInspectionModal'));
const ManagePaymentRequestsModal = lazy(() => import('../../purchase-management/order/manage-payment/ManagePaymentRequestsModal'));

type TxTab = 'current' | 'history';
type SubTab = 'supplier' | 'linked' | 'summary' | 'physical' | 'status';

type Icon = (p: IconProps) => ReactNode;

const SUBS: { k: SubTab; t: string; ico: Icon }[] = [
  { k: 'supplier', t: 'Supplier Details', ico: IcoBuilding },
  { k: 'linked', t: 'Linked Payment Requests', ico: IcoLink },
  { k: 'summary', t: 'Payment Summary', ico: IcoRupee },
  { k: 'physical', t: 'Physical Inspection', ico: IcoEye },
  { k: 'status', t: 'Current Transaction Status', ico: IcoClock },
];

/* Amounts print in the PO's OWN currency. An import is raised in the supplier's
   currency (AUD, USD …), so a hard-coded rupee sign said one thing while the PO
   said another (CS-436 / CS-437). */
const moneyOf = (ccy?: string | null) => (n: number) => `${ccySymbol(ccy)}${Math.round(n).toLocaleString('en-IN')}`;

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
const POPUP_LAYERS = '.spi-mdl-backdrop, .cgst-backdrop, .prd-detail-overlay, .prd-vault, .cev-overlay';

export default function PaymentRequestDetail({ requestId, onBack, onChanged }: {
  requestId: number;
  onBack: () => void;
  /** A request was approved or declined here — the list behind should reload. */
  onChanged?: () => void;
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
  /* The request id just decided here: the detail is re-read after a decision,
     and until it lands the buttons must already be closed (CS-433 / CS-434). */
  const [justDecided, setJustDecided] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  /* An earlier order opened from the history table. */
  const [histInspect, setHistInspect] = useState<OrderRow | null>(null);
  const [histManage, setHistManage] = useState<OrderRow | null>(null);

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

  /* The approver decides on their own screen; this one read the request once,
     when it opened, so it went on saying "Awaiting Approval" until the page was
     reloaded (CS-423). While the request is with an approver it is re-read every
     20s, and at once when this tab or window is looked at again. */
  const awaiting = detail?.row.status === 'awaiting';
  useEffect(() => {
    if (!awaiting) return;
    const reread = () => { if (!document.hidden) setVersion(v => v + 1); };
    const id = window.setInterval(reread, 20000);
    document.addEventListener('visibilitychange', reread);
    window.addEventListener('focus', reread);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', reread);
      window.removeEventListener('focus', reread);
    };
  }, [awaiting]);

  /* Somebody else's decision lands quietly otherwise — say what happened. */
  const lastStatus = useRef<string | null>(null);
  useEffect(() => {
    const now = detail?.row.status ?? null;
    const was = lastStatus.current;
    lastStatus.current = now;
    if (!now || was !== 'awaiting' || now === 'awaiting') return;
    if (justDecided === detail?.row.requestId) return;   // this screen said it already
    if (now === 'approved') toast.success(`${detail?.row.requestId} approved`, 'Payment can now be released.');
    else toast.warning(`${detail?.row.requestId} declined`, 'Nothing can be paid against it.');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail?.row.status]);

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
    // The re-read takes a moment; the buttons must close the instant it is decided.
    setJustDecided(r.requestId);
    setVersion(v => v + 1);
    onChanged?.();
    const amt = moneyOf(r.currency);
    if (r.status === 'approved') toast.success(`${r.requestId} approved for ${amt(r.approvedAmount ?? 0)}`, 'Payment can now be released');
    else toast.warning(`${r.requestId} declined`, `${amt(r.requestedAmount)} is back on the available balance`);
  };

  if (detail === undefined) {
    return createPortal(
      <DetailSkeleton onBack={onBack} />,
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
              <button type="button" className="prd-close" title="Back to Payment Request Management" onClick={onBack}><IcoArrowL size={13} stroke={2.6} /></button>
            </div>
          </div>
        </div>
      </div>,
      document.body,
    );
  }

  const { row, doc, ledger, supplier, po } = detail;
  const money = moneyOf(row.currency);
  const decided = row.status !== 'awaiting' || justDecided === row.requestId;
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
  const i9 = (I: Icon) => <I size={9} stroke={2.5} />;

  return createPortal(
    <div className="prd-root">
      {/* An earlier order opened from the history table — the same two screens
          the PO list opens, instead of a "coming soon" (CS-417). */}
      {histInspect && (
        <Suspense fallback={null}>
          <PhysicalInspectionModal
            row={histInspect}
            onClose={() => setHistInspect(null)}
            onChanged={() => setVersion(v => v + 1)}
            onContinueToPayment={() => { const r = histInspect; setHistInspect(null); setHistManage(r); }}
          />
        </Suspense>
      )}
      {histManage && (
        <Suspense fallback={null}>
          <ManagePaymentRequestsModal row={histManage} onClose={() => { setHistManage(null); setVersion(v => v + 1); }} />
        </Suspense>
      )}
      <div className="prd-shell">

        <div className="prd-head">
          <div className="prd-hrow">
            <div className="prd-titlewrap">
              <div className="prd-hicon"><IcoSend size={20} stroke={2.1} /></div>
              <div className="prd-titleblock">
                <div className="prd-titleline">
                  <h3 className="prd-title">{row.requestId}</h3>
                  <span className={`prd-badge ${badgeCls}`}><span className="prd-badge__dot" />{statusText(row)}</span>
                </div>
                <p className="prd-sub">
                  Request raised against <b className="prd-sub__doc">{doc.id}</b> · Requested {shortDate(row.requestDate)}
                </p>
              </div>
            </div>

            <div className="prd-right">
              <div className="prd-chips">
                {chip(i9(IcoFile), `${D} Number`, doc.id, longDate(doc.date))}
                {chip(i9(IcoBuilding), 'Supplier', supplier?.code ?? '—', row.supplier)}
{/* A PO raised without a shipment, opportunity or procurement reads "N/A",
                    the same as the PO list — a dash looked like the value had failed
                    to load (CS-427). */}
                {chip(i9(IcoShip), 'Shipment ID', row.shipment?.id ?? 'N/A', longDate(row.shipment?.date))}
                {chip(i9(IcoTarget), 'Opportunity ID', row.opportunity?.id ?? 'N/A', row.opportunity?.date ? longDate(row.opportunity.date) : '')}
                {chip(i9(IcoCart), 'Procurement ID', row.procurement?.id ?? 'N/A', row.procurement?.date ? longDate(row.procurement.date) : '')}
              </div>
              <div className="prd-hactions">
                <button
                  type="button"
                  className="prd-act prd-act--vault"
                  title="Every document behind this transaction — the purchase order, its trade documents and agreements, and the supplier invoices mapped to it"
                  onClick={() => setVaultOpen(true)}
                >
                  <IcoShield size={13} stroke={2.4} />Evidence Vault
                </button>
                <button type="button" className="prd-act prd-act--ok" disabled={decided || !canApprove} title={decidedTip} onClick={() => openDecision('approve', row)}>
                  <IcoCheck size={13} stroke={2.8} />Approve Request
                </button>
                <button type="button" className="prd-act prd-act--no" disabled={decided || !canApprove} title={decidedTip} onClick={() => openDecision('decline', row)}>
                  <IcoCircleX size={13} stroke={2.6} />
                  Reject / Decline Request
                </button>
                <button type="button" className="prd-close" title="Back to Payment Request Management" onClick={onBack}><IcoArrowL size={13} stroke={2.6} /></button>
              </div>
            </div>
          </div>

          <div className="prd-cols">
            <div className="prd-col">
              <div className="prd-col__hd">
                <div className="prd-col__ico"><IcoSend size={13} stroke={2.2} /></div>
                <span className="prd-col__t">Payment Request Details</span><span className="prd-col__rule" />
              </div>
              <div className="prd-col__grid">
                {card(i9(IcoText), 'Request ID', row.requestId)}
                {card(i9(IcoCard), 'Payment Type', row.paymentType)}
                {card(i9(IcoPercent), 'Payment (%)', `${row.percentOfTotal}%`)}
                {card(i9(IcoRupee), 'Requested Payment Amount', money(row.requestedAmount), 'is-amt')}
                {card(i9(IcoUser), 'Requested By', row.requestedBy.name)}
              </div>
            </div>
            <div className="prd-col">
              <div className="prd-col__hd">
                <div className="prd-col__ico"><IcoWallet size={13} stroke={2.2} /></div>
                <span className="prd-col__t">Payment Details (Till Current Date)</span><span className="prd-col__rule" />
              </div>
              <div className="prd-col__grid">
                {card(i9(IcoReceipt), `Total ${D} Amount`, money(ledger.total), 'is-amt')}
                {card(i9(IcoRupee), 'Total Paid Amount', money(ledger.paid), 'green is-amt')}
                {card(i9(IcoScales), 'Balance Amount', money(ledger.balance), 'amber is-amt')}
                {card(i9(IcoSend), 'Previously Requested Amount', money(ledger.prevRequested), 'is-amt')}
                {card(i9(IcoOk), 'Approved Amount', money(ledger.approvedTotal), 'green is-amt')}
                {card(i9(IcoWallet), 'Amount Open To Request', money(ledger.available), 'amber is-amt')}
              </div>
            </div>
          </div>
        </div>

        <div className="prd-body">
          <div className="prd-sticky">
            <div className="prd-txtabs">
              <div className="prd-seg" role="tablist" aria-label="Transaction views">
                <button type="button" role="tab" aria-selected={tx === 'current'} className={`prd-seg__tab${tx === 'current' ? ' is-active' : ''}`} onClick={() => setTx('current')}>
                  <IcoCard size={15} stroke={2.1} /><span className="prd-seg__lbl">Current Transaction</span><span className="prd-seg__cnt">1</span>
                </button>
                <button type="button" role="tab" aria-selected={tx === 'history'} className={`prd-seg__tab${tx === 'history' ? ' is-active' : ''}`} onClick={() => setTx('history')}>
                  <IcoHistory size={15} stroke={2.1} /><span className="prd-seg__lbl">All Previous Transaction History</span><span className="prd-seg__cnt">{detail.history.length}</span>
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
                      <span className="prd-subtab__ico"><s.ico size={15} stroke={2.1} /></span>
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
            <HistoryPanel detail={detail} onInspect={setHistInspect} onManage={setHistManage} />
          ) : sub === 'supplier' ? (
            <SupplierPanel supplier={supplier} vendorId={detail.row.vendorId} international={row.international}
              onSupplierChanged={() => setVersion(v => v + 1)} />
          ) : sub === 'linked' ? (
            <LinkedPanel detail={detail} canApprove={canApprove} onDecide={openDecision} onDecided={() => setVersion(v => v + 1)} />
          ) : sub === 'summary' ? (
            <SummaryPanel detail={detail} />
          ) : sub === 'physical' ? (
            <InspectionPanel key={requestId} detail={detail} />
          ) : (
            <StatusPanel po={po} onInspect={() => setSub('physical')} onManage={() => setSub('linked')} />
          )}
        </div>

        <div className="prd-foot">
          <div className="prd-foot__info">Payment request <b>{row.requestId}</b> raised against <b>{doc.id}</b></div>
          <button type="button" className="prd-backbtn" onClick={onBack}><IcoArrowL size={13} stroke={2.6} />Back to Payment Request Management</button>
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
function Empty({ ico: I, title, sub }: { ico: Icon; title: string; sub: string }) {
  return (
    <div className="prd-empty">
      <div className="prd-empty__ico"><I size={26} stroke={1.9} /></div>
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

function SupplierPanel({ supplier: s, vendorId, international, onSupplierChanged }: {
  supplier: Supplier | undefined; vendorId: number | null;
  /** An import: no GST applies, so nothing GST-related is shown or checked. */
  international: boolean;
  /** Re-load the request after the supplier's GST scrutiny is updated, so the check re-runs. */
  onSupplierChanged: () => void;
}) {
  const { user } = useAuth();
  // Only supplier maintainers get the shortcut into the supplier's GST Scrutiny.
  const canEditSupplier = user?.user_type === 'super_admin' || user?.user_type === 'client_admin'
    || !!user?.permissions?.['p2p.supplier']?.can_edit;
  const [scrutinyOpen, setScrutinyOpen] = useState(false);
  const [open, setOpen] = useState<Record<BoxKey, boolean>>({ basic: true, address: true, legal: true, gst: true, risk: true });
  const [notice, setNotice] = useState<GstNotice | null>(null);
  const [vault, setVault] = useState<SupplierVaultTarget | null>(null);
  const toggle = (k: BoxKey) => setOpen(o => ({ ...o, [k]: !o[k] }));

  const risks = useMemo(() => (s ? riskItems(toRiskSubject(s, international), false) : []), [s, international]);
  if (!s) {
    return <Empty ico={IcoBuilding} title="Supplier Details" sub="The supplier record could not be loaded." />;
  }

  // The vault is keyed on the supplier's DB id; match on company name (codes differ between masters).
  const openVault = async () => {
    let dbId: number | undefined;
    try {
      const res = await api.get('/vendors', { params: { light: 1 } });
      const rows = (res.data?.data ?? []) as { id: number; company_name?: string }[];
      const norm = (v?: string) => (v ?? '').trim().toLowerCase();
      dbId = rows.find(v => norm(v.company_name) === norm(s.legalName) || norm(v.company_name) === norm(s.key))?.id;
    } catch { /* opens with the vault's empty state */ }
    setVault({
      id: s.code, db_id: dbId, company: s.legalName, risk: s.risk, type: s.type,
      country: s.country, contact: s.contact, contactCity: s.city, email: s.email,
    });
  };

  const legal = legalTotals(s);
  const legalTone = legal.pct === 100 ? 'ok' : legal.pct >= 60 ? 'warn' : 'bad';
  const sections = legalSections(s);

  const scrutinyAge = monthsAgo(s.scrutiny);
  const filingAge = monthsAgo(s.filing);
  const gst = gstState(s.key, s.scrutiny, s.filing);
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
      {notice && (
        <GstNoticeModal notice={notice} onClose={() => setNotice(null)}
          onOpenScrutiny={canEditSupplier && vendorId ? () => setScrutinyOpen(true) : undefined} />
      )}
      {scrutinyOpen && vendorId && (
        <Suspense fallback={null}>
          <AddVendorModal vendorId={vendorId} initialStep={2} initialKycTab="gst" scope="domestic"
            onClose={() => { setScrutinyOpen(false); onSupplierChanged(); }}
            onSubmit={() => { setScrutinyOpen(false); onSupplierChanged(); }} />
        </Suspense>
      )}
      {vault && (
        <Suspense fallback={null}>
          <SupplierEvidenceVaultModal open supplier={vault} viewOnly onClose={() => setVault(null)} />
        </Suspense>
      )}

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
          <button type="button" className="cpf-vault" title={`Visit ${s.key}’s Evidence Vault`} onClick={() => void openVault()}>
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

      {/* An international supplier has no GSTIN, no returns and no scrutiny, so
          the whole block is left out rather than shown empty (CS-427). The risk
          checks say as much in their own words. */}
      {!international && (
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
            {/* Read-only here: this view reports the supplier's GST position, it
                does not act on it. Sending a PO for senior approval belongs to
                the PO itself, not to a payment request raised against it. */}
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
      )}

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
  const money = moneyOf(detail.row.currency);
  const { ledger, linked, doc } = detail;
  const D = doc.kind === 'spi' ? 'SPI' : 'PO';
  const requested = linked.reduce((s, r) => s + r.requestedAmount, 0);
  const pending = linked.filter(r => r.status === 'awaiting');
  const waiting = pending.reduce((s, r) => s + r.requestedAmount, 0);
  const pctPaid = ledger.net > 0 ? Math.round((ledger.paid / ledger.net) * 100) : 0;
  const n = linked.length;
  const stats: { mod: string; ico: Icon; lbl: string; val: string; sub: string }[] = [
    { mod: '', ico: IcoBriefcase, lbl: `Total ${D} Amount`, val: money(ledger.total), sub: `${money(ledger.net)} net payable${ledger.total > ledger.net ? ` · ${money(ledger.total - ledger.net)} TDS` : ''}` },
    { mod: 'base', ico: IcoSend, lbl: 'Total Requested Amount', val: money(requested), sub: `${n} request${n === 1 ? '' : 's'} raised to date` },
    { mod: 'bal', ico: IcoClock, lbl: 'Awaiting For Approval', val: money(waiting), sub: `${pending.length} with the approver now` },
    { mod: 'gst', ico: IcoCheck, lbl: 'Total Approved Amount', val: money(ledger.approvedTotal), sub: `${money(Math.max(0, ledger.approvedTotal - ledger.paid))} awaiting release` },
    { mod: 'paid', ico: IcoRupee, lbl: 'Total Paid Amount', val: money(ledger.paid), sub: `${pctPaid}% of net payable released` },
    { mod: 'tds', ico: IcoTrend, lbl: 'Balance Amount', val: money(ledger.balance), sub: ledger.balance <= 0 ? `${D} settled in full` : `${money(ledger.available)} open to request` },
  ];
  return (
    <div className="prd-stats">
      {stats.map(s => (
        <div key={s.lbl} className={`prd-stat${s.mod ? ` prd-stat--${s.mod}` : ''}`}>
          <div className="prd-stat__ico"><s.ico size={19} stroke={2} /></div>
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

/* A long table stays inside its own box: the first rows stand, the rest come on
   the scroll, under the header that is already sticky. Measured rather than a
   fixed height — a row grows with a wrapped supplier name or an extra chip. */
function RowWindow({ rows, count, className = '', children }: { rows: number; count: number; className?: string; children: ReactNode }) {
  const box = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = box.current;
    const table = el?.querySelector('table');
    if (!el || !table) return;
    const apply = () => {
      // The transaction table renders one tbody per row; the others, one tbody of rows.
      const bodies = Array.from(table.tBodies);
      const list = (bodies.length > 1 ? bodies : Array.from(bodies[0]?.rows ?? [])) as HTMLElement[];
      const want = list.length <= rows ? ''
        : `${Math.ceil((table.tHead?.getBoundingClientRect().height ?? 0)
          + list[rows - 1].getBoundingClientRect().bottom - list[0].getBoundingClientRect().top)}px`;
      if (el.style.maxHeight !== want) el.style.maxHeight = want;
    };
    apply();
    const ro = new ResizeObserver(apply);
    for (const n of Array.from(table.tBodies)) ro.observe(n);
    return () => ro.disconnect();
  }, [rows, count]);
  return <div ref={box} className={`ord-table-scroll prd-rowwin ${className}`.trim()}>{children}</div>;
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
  ['', 40], ['Sr No', 52], ['Payment Request ID', 124], ['Request Raised Against', 132], ['Payment Type', 118], ['Payment %', 76],
  ['Requested Payment Amount', 118], ['Requested By', 150], ['Requested To', 140], ['Request Approval Status', 148],
  ['Approved Amount', 104], ['Paid Amount', 96], ['Action', 410],
];
const LINKED_WIDTH = LINKED_COLS.reduce((s, [, w]) => s + w, 0);

function LinkedPanel({ detail, canApprove, onDecide, onDecided }: {
  detail: Detail; canApprove: boolean;
  onDecide: (mode: DecisionMode, request: PaymentRequestRow) => void;
  /** Something was decided here — the page reloads itself. */
  onDecided: () => void;
}) {
  const { linked, doc, row: current } = detail;
  const money = moneyOf(current.currency);
  const toast = useToast();
  const confirm = useConfirm();
  const [peek, setPeek] = useState<LinkedRequest | null>(null);

  /* Approving several linked requests at once (CS-436): the ones awaiting a
     decision from this user. The rest are not tickable — the server refuses
     anyone else's request anyway. */
  const [picked, setPicked] = useState<number[]>([]);
  const [approving, setApproving] = useState(false);
  const pickable = linked.filter(r => canApprove && r.canDecide && r.status === 'awaiting');
  const pickedRows = pickable.filter(r => picked.includes(r.id));
  const allPicked = pickable.length > 0 && pickedRows.length === pickable.length;
  const togglePick = (id: number) => setPicked(cur => (cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id]));

  const approvePicked = async () => {
    if (!pickedRows.length || approving) return;
    const ok = await confirm({
      title: `Approve ${pickedRows.length} payment request${pickedRows.length === 1 ? '' : 's'}?`,
      message: `${pickedRows.map(r => r.requestId).join(', ')} — each one is approved for the full amount requested. To approve part of an amount, decide that request on its own.`,
      confirmLabel: 'Approve',
      tone: 'teal',
      icon: 'check-double-line',
    });
    if (!ok) return;
    setApproving(true);
    try {
      const res = await poPaymentApi.decideMany({ ids: pickedRows.map(r => r.id), decision: 'approved' });
      setPicked([]);
      onDecided();
      if (res.failed.length) {
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

  return (
    <div className="prd-secwrap">
      <StatCards detail={detail} />
      {peek && <LinkedRequestPopup request={peek} doc={doc} onClose={() => setPeek(null)} />}
      <Panel title="All Payment Requests" count={linked.length} sub="Currently open request first, then in the order they were raised">
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
        <RowWindow rows={3} count={linked.length}>
          <table className="ord-table prd-table" style={{ minWidth: LINKED_WIDTH }}>
            <colgroup>{LINKED_COLS.map(([c, w], i) => <col key={c || `pick-${i}`} style={{ width: w }} />)}</colgroup>
            <thead>
              <tr>
                <th className="prm-pickcell">
                  <input type="checkbox" className="prm-pick" aria-label="Select every request you can approve"
                    title={pickable.length ? 'Select every request here you can approve' : 'No request here is yours to approve'}
                    disabled={!pickable.length || approving}
                    checked={allPicked}
                    ref={el => { if (el) el.indeterminate = pickedRows.length > 0 && !allPicked; }}
                    onChange={() => setPicked(allPicked ? [] : pickable.map(r => r.id))} />
                </th>
                {LINKED_COLS.slice(1).map(([c]) => <th key={c}>{c}</th>)}
              </tr>
            </thead>
            <tbody>
              {linked.map((r, i) => {
                const isCurrent = r.requestId === current.requestId;
                // Any request sent to this user can be decided from here (CS-436).
                const canDecide = r.status === 'awaiting' && canApprove && r.canDecide;
                const lockTip = r.status !== 'awaiting' ? `Already ${r.status === 'approved' ? 'approved' : 'declined'}`
                  : !canApprove ? NO_APPROVE_TIP
                    : !r.canDecide ? 'This request was sent to someone else' : undefined;
                return (
                  <tr key={r.requestId} className={`is-first is-last${isCurrent ? ' is-current' : ''}${r.flag === 'physical-inspection' ? ' is-physreq' : ''}${r.status === 'declined' ? ' is-closed' : ''}${picked.includes(r.id) ? ' is-picked' : ''}`}>
                    <td className="prm-pickcell">
                      <input type="checkbox" className="prm-pick"
                        aria-label={`Select ${r.requestId}`}
                        title={canDecide ? `Select ${r.requestId} to approve` : lockTip}
                        disabled={!canDecide || approving}
                        checked={picked.includes(r.id)}
                        onChange={() => togglePick(r.id)} />
                    </td>
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
                        <button type="button" className="ord-btn prm-viewbtn" title={`View ${r.requestId}`} onClick={() => setPeek(r)}>
                          <span className="prm-viewbtn__ico"><IcoEye size={9} /></span><span>View Request</span>
                        </button>
                        <button type="button" className="prd-rowact prd-rowact--ok" disabled={!canDecide} title={lockTip} onClick={() => onDecide('approve', r)}>
                          <IcoCheck size={13} stroke={2.5} />Approve Request
                        </button>
                        <button type="button" className="prd-rowact prd-rowact--no" disabled={!canDecide} title={lockTip} onClick={() => onDecide('decline', r)}>
                          <IcoCircleX size={13} stroke={2.5} />Reject Request
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </RowWindow>
      </Panel>
    </div>
  );
}

/* CS-436: one earlier request on this order, read-only, over the table. */
function LinkedRequestPopup({ request: r, doc, onClose }: {
  request: LinkedRequest; doc: Detail['doc']; onClose: () => void;
}) {
  const money = moneyOf(r.currency);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  const ro = (label: string, value: string, mod = '', sub?: string) => (
    <div className="prd-dec__field">
      <label>{label}</label>
      <div className={`prd-dec__ro${mod ? ' ' + mod : ''}`} title={value}>
        {value}{sub && <span className="prd-dec__rosub">{sub}</span>}
      </div>
    </div>
  );
  const decidedOn = r.decision?.on ?? r.decline?.on;
  return createPortal(
    <div className="spi-mdl-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="spi-mdl mpr-card prd-dec prd-peek" role="dialog" aria-modal="true" aria-label={`Payment request ${r.requestId}`}>
        <div className="mpr-hero">
          <div className="mpr-hero__icon"><IcoEye size={18} stroke={2.2} /></div>
          <div className="mpr-hero__titleblock">
            <div className="mpr-hero__titlerow">
              <span className="mpr-hero__title">Payment Request</span>
              <span className="mpr-hero__idpill">{r.requestId}</span>
              <span className="mpr-hero__badge"><span className="mpr-hero__bdot" />{statusText(r)}</span>
            </div>
            <div className="mpr-hero__sub">Raised against {doc.id} · read-only</div>
          </div>
          <button type="button" className="mpr-hero__close" onClick={onClose} aria-label="Close"><IcoX size={14} stroke={2.6} /></button>
        </div>
        <div className="mpr-bd prd-dec__bd">
          <div className="prd-dec__grid7 prd-peek__grid">
            {ro('Request ID', r.requestId, 'is-id')}
            {ro('Requested Date', formatDmy(r.requestDate))}
            {ro('Payment Type', r.paymentType)}
            {ro('Payment Percentage', `${r.percentOfTotal}%`, 'is-num')}
            {ro('Requested Payment Amount', money(r.requestedAmount), 'is-amt')}
            {ro('Requested By', r.requestedBy.name)}
            {ro('Requested To', r.requestedTo.name, '', r.requestedTo.role)}
            {ro('Decision', statusText(r), '', decidedOn ? `on ${formatDmy(decidedOn)}` : undefined)}
            {ro('Approved Amount', r.approvedAmount !== null ? money(r.approvedAmount) : '—', 'is-amt')}
            {ro('Paid Amount', r.paid > 0 ? money(r.paid) : '—', 'is-amt')}
          </div>
          {r.decision?.note && (
            <div className="prd-dec__field">
              <label>{r.status === 'declined' ? 'Rejection Reason' : 'Approval Remark'}</label>
              <div className="prd-dec__ro prd-peek__note">{r.decision.note}</div>
            </div>
          )}
        </div>
        <div className="spi-mdl-foot">
          <div className="spi-mdl-foot-btns"><button type="button" className="spi-mdl-cancel" onClick={onClose}>Close</button></div>
        </div>
      </div>
    </div>,
    document.body,
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
const PAY_COLS = ['Paid Against Request ID', 'Request Raised Against', 'Paid Amount', 'Bank Name',
  'UTR / Cheque Number', 'UTR / Cheque Date', 'Proof Of Payment'];

function SummaryPanel({ detail }: { detail: Detail }) {
  const money = moneyOf(detail.row.currency);
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
                {payments.map(p => {
                  const cheque = /cheque|draft/i.test(p.mode);
                  // The proof as filed. A name made up from the UTR named no real file.
                  const file = p.proofName || '';
                  return (
                    <tr key={`${p.requestId}-${p.ref}`} className="is-first is-last">
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
                        {p.proofUrl ? (
                          <span className="prd-file">
                            <span className="prd-file__ico"><IcoFile size={13} /></span>
                            <span className="prd-file__name" title={file}>{file}</span>
                            <span className="prd-file__sep" />
                            <a className="prd-fbtn prd-fbtn--view" href={p.proofUrl} target="_blank" rel="noopener noreferrer"
                              title={`View ${file}`}><IcoEye size={13} /></a>
                            <button type="button" className="prd-fbtn prd-fbtn--dl" title={`Download ${file}`}
                              onClick={() => void downloadProofUrl(p.proofUrl, file)}><IcoDownload size={13} /></button>
                          </span>
                        ) : <span className="prd-dash">—</span>}
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

function InspectionPanel({ detail }: { detail: Detail }) {
  const toast = useToast();
  const { po, inspection } = detail;
  const [attFor, setAttFor] = useState<InspectionProduct | null>(null);
  const [viewFor, setViewFor] = useState<InspectionProduct | null>(null);

  if (!po) {
    return <Empty ico={IcoEye} title="No inspection on this request"
      sub="This supplier invoice was raised without a purchase order behind it, so there is no physical inspection to answer to." />;
  }
  if (!inspection.required) {
    return <Empty ico={IcoEye} title="Inspection not required"
      sub={`Purchase order ${po.po} is not flagged for physical inspection, so payment does not wait on one.`} />;
  }

  const done = inspection.completed;
  /* Read from the record, never from this screen: the inspection is taken on the
     PO list, and here it is only reported. */
  const markOf = (code: string) => inspection.marks.find(m => m.code === code);
  const lineOf = (code: string): InspectionLine => {
    const m = markOf(code);
    return { verdict: (m?.verdict ?? null) as Verdict | null, files: m?.files ?? [] } as InspectionLine;
  };
  const viewFile = (f: ProofFile) => { if (!openFile(f)) toast.info('Preview', `${f.name} — logic coming soon`); };
  /* A stored proof is fetched through our own API and saved from there. Linking
     straight at the file only opens it once the disk is remote: on the server
     the proofs sit on Azure Blob, a different origin, where the browser drops
     the `download` hint and a fetch is refused by CORS (CS-567). */
  const dlFile = async (f: ProofFile, itemId: number | null) => {
    const poId = detail.row.poId;
    if (f.index === undefined || !poId) {
      if (!downloadFile(f)) toast.info('Download unavailable', f.name);
      return;
    }
    try {
      const blob = await poInspectionApi.proofFile(poId, itemId, f.index);
      saveBlob(blob, f.name);
    } catch {
      toast.error('Could not download the proof', f.name);
    }
  };

  return (
    <div className="prd-secwrap">
      {attFor && (
        <InspectionAttachmentsModal
          productName={attFor.name}
          productCode={attFor.code}
          files={lineOf(attFor.code).files}
          onView={ix => viewFile(lineOf(attFor.code).files[ix])}
          onDownload={ix => void dlFile(lineOf(attFor.code).files[ix], markOf(attFor.code)?.itemId ?? null)}
          onClose={() => setAttFor(null)}
        />
      )}
      {viewFor && <InspectionProductView product={viewFor} onClose={() => setViewFor(null)} />}

      <div className="prd-sechead">
        <span className="prd-sechead__t">Physical Inspection</span>
        <span className="prd-panel__c">{inspection.products.length}</span>
        <span className={`prd-state ${done ? 'is-done' : 'is-wait'}`}>{done ? 'Completed' : 'Pending'}</span>
        <span className="prd-sechead__s">Goods on {po.po} · as recorded on the Purchase Order list</span>
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
                      <span className="pins-code">{formatProductCode(p.code)}</span>
                      <span className="pins-kv">HSN <b>{p.hsn}</b></span>
                      <span className="pins-prod__dot" />
                      <span className="pins-kv">GST <b>{p.gst}%</b></span>
                    </div>
                  </td>
                  <td className="pins-desc">
                    <InspectionDescription text={p.desc} onOpen={() => setViewFor(p)} />
                  </td>
                  <td className="pins-td-c"><span className="pins-qty">{p.qty}</span></td>
                  <td className="pins-td-c">
                    <span className={`pins-tagv pins-tagv--${line.verdict || 'none'}`}>{tag?.ico}{tag ? tag.t : 'Not marked'}</span>
                  </td>
                  <td className="pins-td-proof">
                    {n > 0 ? (
                      <div className="pins-prooflist">
                        <ProofChip file={line.files[0]} onView={() => viewFile(line.files[0])} onDownload={() => void dlFile(line.files[0], markOf(p.code)?.itemId ?? null)} />
                        {n > 1 && (
                          <button type="button" className="pins-more" onClick={() => setAttFor(p)}>
                            <span className="pins-more__n">+{n - 1}</span>
                            <span className="pins-more__t">View more proof{n - 1 === 1 ? '' : 's'}</span>
                          </button>
                        )}
                      </div>
                    ) : (
                      <div className="pins-empty">No evidence on record for this product.</div>
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
/* The request view shows the order as it stands: no Action, and none of the
   cancellation columns, which belong to the Purchase Order list. */
const TX_DROP = ['Action', 'Advance Receipt Refund Adjustment', 'Payment Recovery Status', 'PO Status'];
const TX_COLUMNS = ORDER_COLUMNS.filter(c => !TX_DROP.includes(c.label));
const TX_WIDTH = TX_COLUMNS.reduce((s, c) => s + c.width, 0);

function OrderTable({ rows, onInspect, onManage, window: win = 0 }: {
  rows: OrderRow[]; onInspect: (row: OrderRow) => void; onManage: (row: OrderRow) => void;
  /** Rows to show before the rest go on the scroll; 0 shows them all. */
  window?: number;
}) {
  return (
    <RowWindow rows={win || rows.length} count={rows.length} className="prd-txscroll">
      <table className="ord-table" style={{ width: TX_WIDTH }}>
        <colgroup>{TX_COLUMNS.map(c => <col key={c.label} style={{ width: c.width }} />)}</colgroup>
        <thead>
          <tr>{TX_COLUMNS.map(c => <th key={c.label} className={c.groupEnd ? 'ord-table__group-end' : undefined}>{c.label}</th>)}</tr>
        </thead>
        {rows.map((r, i) => (
          <OrderRowBody key={r.po} row={r} sr={i + 1} inspected={r.inspectionDone} onInspect={() => onInspect(r)} onManage={() => onManage(r)} summary />
        ))}
      </table>
    </RowWindow>
  );
}

function StatusPanel({ po, onInspect, onManage }: { po: OrderRow | null; onInspect: (row: OrderRow) => void; onManage: (row: OrderRow) => void }) {
  if (!po) {
    return <Empty ico={IcoClock} title="No purchase order behind this request"
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
function HistoryPanel({ detail, onInspect, onManage }: {
  detail: Detail; onInspect: (row: OrderRow) => void; onManage: (row: OrderRow) => void;
}) {
  const rows = detail.history;
  if (!rows.length) {
    return <Empty ico={IcoHistory} title={`No earlier transactions with ${detail.row.supplier}`}
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
      {/* Four earlier orders stand; the rest scroll inside the table, so the page
          itself does not grow with the supplier's history. */}
      <OrderTable rows={rows} window={4} onInspect={onInspect} onManage={onManage} />
    </div>
  );
}

/* Shimmer while the request loads, laid out like the real page (header, chips, the two
   detail columns and the tables below) so nothing jumps when the data arrives. */
function DetailSkeleton({ onBack }: { onBack: () => void }) {
  const bar = (w: number | string, h = 12) => <span className="spi-sk-bar" style={{ width: w, height: h }} />;
  const field = (k: number) => (
    <div key={k} className="prd-sk-field">{bar('70px', 9)}{bar('90%', 13)}</div>
  );
  return (
    <div className="prd-root" aria-busy="true" aria-label="Loading payment request">
      <div className="prd-shell">
        <div className="prd-head">
          <div className="prd-hrow">
            <div className="prd-titlewrap">
              <span className="spi-sk-bar prd-sk-ico" />
              <div className="prd-titleblock prd-sk-title">{bar(220, 20)}{bar(320, 11)}</div>
            </div>
            <div className="prd-right">
              <div className="prd-chips">{[0, 1, 2, 3, 4].map((i) => <span key={i} className="spi-sk-bar prd-sk-chip" />)}</div>
              <div className="prd-hactions">
                {[0, 1, 2].map((i) => <span key={i} className="spi-sk-bar prd-sk-btn" />)}
                <button type="button" className="prd-close" title="Back to Payment Request Management" onClick={onBack}><IcoArrowL size={13} stroke={2.6} /></button>
              </div>
            </div>
          </div>
        </div>
        <div className="prd-cols">
          {[0, 1].map((c) => (
            <div key={c} className="prd-col">
              <div className="prd-col__hd">{bar(180, 14)}</div>
              <div className="prd-col__grid">{Array.from({ length: 8 }).map((_, i) => field(i))}</div>
            </div>
          ))}
        </div>
        <div className="prd-sk-block">
          {bar(200, 14)}
          {Array.from({ length: 4 }).map((_, i) => <span key={i} className="spi-sk-bar prd-sk-row" />)}
        </div>
      </div>
    </div>
  );
}
