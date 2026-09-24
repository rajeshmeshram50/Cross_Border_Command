import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useScrollLock } from '../../../../../hooks/useScrollLock';
import { useConfirm } from '../../../../../contexts/ConfirmContext';
import { downloadFile } from '../../../../../utils/downloadFile';
import type { OrderRow } from '../po-list/Order';
import {
  Box, HeroRefChips, ICON_X, PoSummaryCards, TdsStrip, initials, moneyIn, rowBreakdown, shortDate,
} from './payment-shared';
import { FitTip } from '../create-po/form-fields';
import '../../supplier-purchase-invoice/supplier-purchase-invoice.css';
import './manage-payment-requests.css';
import './make-po-payment.css';

const AddPaymentModal = lazy(() => import('./AddPaymentModal'));

export type ReleasePayment = {
  /** Database id, once saved. */
  id?: number;
  amount: number;
  bank: string;
  utr: string;
  date: string;
  /** Proof file name, and its link once stored. */
  file?: string;
  fileUrl?: string | null;
  /** A newly chosen proof file, sent with the save. */
  upload?: File | null;
  /** Posted to the Zoho bill already; the row then shows Synced instead of the button. */
  zohoSynced?: boolean;
  zohoError?: string | null;
};

export type MakePoPaymentProps = {
  row: OrderRow;
  requestId: string;
  requestDate: string;
  requestType: string;
  requestedAmount: number;
  approved: number;
  approver: string;
  approverRole: string;
  /** The request's real approval status — a pending one opens read-only. */
  requestStatus?: 'approved' | 'pending' | 'rejected';
  alreadyPaid: number;
  payments: ReleasePayment[];
  tds: number;
  /** Resolve true once saved, so the form closes; false keeps it open. */
  onRecord: (p: ReleasePayment) => Promise<boolean> | void;
  onUpdate: (index: number, p: ReleasePayment) => Promise<boolean> | void;
  onDelete: (index: number) => void;
  /** Posts that one payment to the Zoho bill. */
  onZohoSync: (index: number) => Promise<void> | void;
  onOpenTds: () => void;
  onClose: () => void;
};

const ic = {
  viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
  strokeWidth: 2.2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
};

const ICON_CARD = (
  <svg {...ic}><rect x="2" y="5" width="20" height="14" rx="2.5" /><line x1="2" y1="10" x2="22" y2="10" /></svg>
);
const ICON_PLUS = (
  <svg {...ic} strokeWidth={2.6}><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
);
const ICON_TICK = <svg {...ic} strokeWidth={3.2} className="cpay-tick"><path d="M20 6 9 17l-5-5" /></svg>;
const ICON_DOC = (
  <svg {...ic}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
);
const ICON_EYE = (
  <svg {...ic} strokeWidth={2.4}><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" /><circle cx="12" cy="12" r="3" /></svg>
);
const ICON_DL = (
  <svg {...ic} strokeWidth={2.4}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
);
const ICON_SYNC = (
  <svg {...ic}><path d="M21 12a9 9 0 0 1-15 6.7L3 16" /><path d="M3 12a9 9 0 0 1 15-6.7L21 8" /><polyline points="21 3 21 8 16 8" /><polyline points="3 21 3 16 8 16" /></svg>
);
const ICON_TICK_SM = <svg {...ic} strokeWidth={3}><path d="M20 6 9 17l-5-5" /></svg>;
const ICON_MAIL = (
  <svg {...ic} strokeWidth={2.4}><rect x="2" y="4" width="20" height="16" rx="2" /><path d="m22 6-10 7L2 6" /></svg>
);
const ICON_EDIT = (
  <svg {...ic} strokeWidth={2.4}><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1z" /></svg>
);
const ICON_DEL = (
  <svg {...ic} strokeWidth={2.4}>
    <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    <path d="M10 11v6M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
  </svg>
);

/** Same wording and colours as the request list's own status chip. */
const REQ_STATUS = {
  approved: { cls: 'mpr-st--done', label: 'Approved' },
  pending: { cls: 'mpr-st--wait', label: 'Awaiting Approval' },
  rejected: { cls: 'mpr-st--stop', label: 'Declined' },
} as const;

function Field({ label, mod, children }: { label: string; mod?: string; children: React.ReactNode }) {
  return (
    <div className={`cpay-f${mod ? ' ' + mod : ''}`}>
      <label>{label}</label>
      <div className={`cpay-v${mod === 'cpay-f--hi' ? ' cpay-v--hi' : ''}`}>{children}</div>
    </div>
  );
}

export default function MakePoPaymentModal({
  row, requestId, requestDate, requestType, requestedAmount, approved, approver, approverRole,
  alreadyPaid, payments, tds, requestStatus = 'approved', onRecord, onUpdate, onDelete, onZohoSync, onOpenTds, onClose,
}: MakePoPaymentProps) {
  useScrollLock(true, '.mpr-card--pay');
  // Every figure on this screen is in the PO's own currency.
  const money = moneyIn(row.currency);
  const confirm = useConfirm();

  // A payment already posted to Zoho Books cannot be pulled back, so it cannot be deleted here.
  const askDelete = async (index: number, amount: number) => {
    const ok = await confirm({
      title: 'Delete this payment?',
      message: `The ${money(amount)} released on this request will be removed and returned to the PO balance. This cannot be undone.`,
      tone: 'danger',
      confirmLabel: 'Delete Payment',
      cancelLabel: 'Keep It',
    });
    if (ok) onDelete(index);
  };

  const cardRef = useRef<HTMLDivElement>(null);
  useEffect(() => { cardRef.current?.focus(); }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [syncing, setSyncing] = useState<number | null>(null);

  const syncRow = async (i: number) => {
    if (syncing !== null) return;
    setSyncing(i);
    try { await onZohoSync(i); } finally { setSyncing(null); }
  };

  const closeForm = () => { setAdding(false); setEditing(null); };

  const approvedRequest = requestStatus === 'approved';
  const released = payments.reduce((s, p) => s + (p.amount || 0), 0);
  const paidOnRequest = alreadyPaid + released;
  const room = Math.max(0, approved - paidOnRequest);
  /* CS-423 — this is how far THIS request has been paid, so a request settled in full
     reads 100%. Before approval there is nothing to pay against, so it stays at 0. */
  const pct = approved > 0 ? Math.min(100, Math.round((paidOnRequest / approved) * 1000) / 10) : 0;
  /* CS-423 — a settled or unapproved request is a record, not a form: nothing on it can
     be added, edited or deleted, whichever button was used to open it. */
  const settled = approvedRequest && approved > 0 && room <= 0;
  const readOnly = !approvedRequest || settled;

  // The row carries the PO's stored paid / balance, which already include these payments.
  const poPaid = row.paid;
  const poBalance = Math.max(0, row.balance);

  return createPortal(
    <div className="spi-mdl-backdrop">
      {(adding || editing !== null) && (
        <Suspense fallback={null}>
          <AddPaymentModal
            key={editing ?? 'new'}
            requestId={requestId}
            supplier={row.supplier}
            poNumber={row.po}
            spiNumber={row.invoices[0]?.spi}
            spiCount={row.invoices.length}
            approved={approved}
            paid={paidOnRequest}
            ccy={row.currency}
            initial={editing !== null ? payments[editing] : undefined}
            onClose={closeForm}
            onSave={async (p) => {
              const ok = editing !== null ? await onUpdate(editing, p) : await onRecord(p);
              if (ok !== false) closeForm();
            }}
          />
        </Suspense>
      )}

      <div className="spi-mdl mpr-card mpr-card--pay" role="dialog" aria-modal="true" aria-labelledby="cpay-title" tabIndex={-1} ref={cardRef}>

        <div className="mpr-hero">
          <div className="mpr-hero__icon">{ICON_CARD}</div>
          <div className="mpr-hero__titleblock">
            <div className="mpr-hero__titlerow">
              <span className="mpr-hero__title" id="cpay-title">Payment Against Request ID</span>
              <span className="mpr-hero__idpill">{requestId}</span>
            </div>
            <div className="mpr-hero__sub">{settled ? 'Paid in full — this request is a record now'
              : approvedRequest ? 'Release the approved amount on this request'
                : requestStatus === 'rejected' ? 'Read-only — this request was declined' : 'Read-only — this request is awaiting approval'}</div>
          </div>
          <HeroRefChips row={row} />
          <button type="button" className="mpr-hero__close" onClick={onClose} aria-label="Close">{ICON_X}</button>
        </div>

        <div className="mpr-bd">

          <Box
            label="Request"
            title={`Current Request Details (${requestId})`}
            sub="The request this release is being made against · read-only"
          >
            <div className="cpay-grid">
              <Field label="Payment Request ID"><span className="cpay-id">{requestId}</span></Field>
              <Field label="Payment Type"><span className="cpay-type">{requestType}</span></Field>
              <Field label="Payment % (of this request)" mod="cpay-f--pct">
                <span className="cpay-pct">{pct}%</span>
                <span className="cpay-bar"><i style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} /></span>
              </Field>
              <Field label="Requested Payment Amount">{money(requestedAmount)}</Field>
              <Field label="Requested To" mod="cpay-f--who">
                <span className="cpay-av">{initials(approver)}</span>
                <span className="cpay-whotxt">
                  {approver}
                  <span className="cpay-role">{approverRole}</span>
                </span>
              </Field>
              <Field label="Request Approval Status" mod="cpay-f--st">
                <span className={`mpr-st ${REQ_STATUS[requestStatus].cls}`}>
                  <span className="mpr-st__dot" />{REQ_STATUS[requestStatus].label}
                </span>
              </Field>
              <Field label="Approved Amount" mod="cpay-f--hi">
                {requestStatus !== 'approved' ? <span className="cpay-none">—</span> : <>{money(approved)}{ICON_TICK}</>}
              </Field>
            </div>
          </Box>

          <Box
            label="Summary"
            title="PO Payment Details Summary"
            sub="How this PO’s value is made up and where it stands today · read-only"
            headerExtra={!row.cancelled && (
              <TdsStrip tds={tds} total={row.total} supplier={row.supplier} onOpen={onOpenTds} locked={row.paid > 0}
                ccy={row.currency} international={row.docType === 'International'} />
            )}
          >
            <PoSummaryCards
              total={row.total}
              paid={poPaid}
              balance={poBalance}
              net={row.net}
              complete={poBalance <= 0}
              split={rowBreakdown(row)}
              ccy={row.currency}
            />
          </Box>

          <div className="mpr-panel">
            <div className="mpr-panel__hd">
              <span className="mpr-panel__t">Payment History</span>
              <span className="mpr-panel__c">{payments.length}</span>
              <span className="cpay-panel__s">Released against {requestId}</span>
              <button
                type="button"
                className="cpay-add"
                disabled={readOnly || room <= 0}
                onClick={() => setAdding(true)}
                title={!approvedRequest
                  ? (requestStatus === 'pending'
                    ? 'This request is still awaiting approval — pay once it is approved'
                    : 'This request was declined — nothing can be paid against it')
                  : room > 0
                    ? 'Record a payment against this request'
                    : 'Fully released — nothing left approved on this request'}
              >
                {ICON_PLUS}<span>Add New Payment</span>
              </button>
            </div>

            <div className="mpr-table">
              <div className="cpay-cols cpay-cols--head">
                <span>Sr. No</span>
                <span>Paid Against Request ID</span>
                <span>Request Raised Against</span>
                <span>Paid Amount</span>
                <span>Bank Name</span>
                <span>UTR / Cheque Number</span>
                <span>UTR / Cheque Date</span>
                <span>Proof Of Payment</span>
                <span>Action</span>
              </div>

              {payments.length === 0 ? (
                <div className="cpay-empty">
                  <div className="cpay-empty__ico">{ICON_CARD}</div>
                  <div className="cpay-empty__t">No payments recorded yet</div>
                  <div className="cpay-empty__s">Use Add New Payment to record a release against this request.</div>
                </div>
              ) : payments.map((p, i) => (
                <div className="cpay-cols cpay-row" key={`${p.utr}-${i}`}>
                  <span className="mpr-sr" data-l="Sr. No">{i + 1}</span>
                  <span data-l="Paid Against Request ID">
                    <span className="mpr-idcell">
                      <span className="mpr-idpill">{requestId}</span>
                      <span className="mpr-iddate">{shortDate(requestDate)}</span>
                    </span>
                  </span>
                  <span data-l="Request Raised Against">
                    <span className="mpr-idcell">
                      <span className="mpr-idpill">{row.po}</span>
                      <span className="mpr-iddate">{shortDate(row.poDate)}</span>
                    </span>
                  </span>
                  <span data-l="Paid Amount"><b className="cpay-amt">{money(p.amount)}</b></span>
                  <span data-l="Bank Name"><span className="cpay-bank">{p.bank || '—'}</span></span>
                  <span data-l="UTR / Cheque Number">
                    {/* Cut with "…" when it doesn't fit; the tooltip then shows it whole. */}
                    <FitTip label={p.utr || '—'}><span className="cpay-utr">{p.utr || '—'}</span></FitTip>
                  </span>
                  <span data-l="UTR / Cheque Date"><span className="cpay-date">{p.date || '—'}</span></span>
                  <span data-l="Proof Of Payment">
                    {p.file ? (
                      <span className="cpay-file">
                        <span className="cpay-file__ico">{ICON_DOC}</span>
                        <span className="cpay-file__name" title={p.file}>{p.file}</span>
                        <span className="cpay-file__sep" />
                        <span className="cpay-fbtns">
                          <button type="button" className="cpay-fbtn cpay-fbtn--view" title="View proof of payment" disabled={!p.fileUrl}
                            onClick={() => p.fileUrl && window.open(p.fileUrl, '_blank', 'noopener')}>{ICON_EYE}</button>
                          <button type="button" className="cpay-fbtn cpay-fbtn--dl" title="Download proof of payment"
                            disabled={!p.fileUrl} onClick={() => void downloadFile(p.fileUrl, p.file)}>{ICON_DL}</button>
                        </span>
                      </span>
                    ) : <span className="cpay-noproof">Not attached</span>}
                  </span>
                  <span data-l="Action">
                    <span className="cpay-acts">
                      {/* A posted payment can no longer be edited or deleted — the bill in Zoho already has it. */}
                      {p.zohoSynced ? (
                        <span className="cpay-zoho cpay-zoho--ok" title="Posted against the bill in Zoho Books">{ICON_TICK_SM}Synced</span>
                      ) : (
                        <button type="button" className="cpay-zoho cpay-zoho--btn" disabled={syncing !== null || !p.id}
                          title={p.zohoError ?? 'Post this payment against the bill in Zoho Books'}
                          onClick={() => void syncRow(i)}>
                          {ICON_SYNC}<span>{syncing === i ? 'Syncing…' : 'Zoho Sync'}</span>
                        </button>
                      )}
                      <button
                        type="button"
                        className="cpay-act cpay-act--mail"
                        disabled={!p.file}
                        title={p.file
                          ? `Send ${p.file} to the supplier by email`
                          : 'No proof attached to send — attach one first'}
                      >
                        {ICON_MAIL}
                      </button>
                      <button type="button" className="cpay-act cpay-act--edit" disabled={p.zohoSynced || readOnly}
                        title={p.zohoSynced ? 'Posted to Zoho Books — this payment can no longer be changed'
                          : settled ? 'This request is paid in full — its payments are a record now'
                            : readOnly ? 'This request is not open for payment' : 'Edit payment'}
                        onClick={() => setEditing(i)}>{ICON_EDIT}</button>
                      <button type="button" className="cpay-act cpay-act--del" disabled={p.zohoSynced || readOnly}
                        title={p.zohoSynced ? 'Posted to Zoho Books — this payment can no longer be deleted'
                          : settled ? 'This request is paid in full — its payments are a record now'
                            : readOnly ? 'This request is not open for payment' : 'Delete payment'}
                        onClick={() => void askDelete(i, p.amount)}>
                        {ICON_DEL}
                      </button>
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="spi-mdl-foot">
          <div className="spi-mdl-foot-btns">
            <button type="button" className="spi-mdl-cancel" onClick={onClose}>Previous</button>
            <button type="button" className="spi-mdl-confirm" onClick={onClose}>Submit</button>
          </div>
        </div>

      </div>
    </div>,
    document.body,
  );
}
