import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useScrollLock } from '../../../../hooks/useScrollLock';
import {
  Box, Stat, STAT_ICONS, ICON_X, money, initials, shortDate,
} from '../order/manage-payment/payment-shared';
import { InvoiceHeroChips } from './payment-chips';
import { downloadFile } from '../../../../utils/downloadFile';
import { invoiceBalance, invoicePaidPercent, type InvoiceRow } from './types';
import type { InvoicePaymentRequest } from './InvoicePaymentsModal';
import type { ReleasePayment } from '../order/manage-payment/MakePoPaymentModal';

/* No stylesheet of its own: this is the purchase order's payment screen with
   an SPI where it has a PO, so it wears that screen's markup and its CSS. */
import '../../p2p-detail.css';
import '../order/manage-payment/manage-payment-requests.css';
import '../order/manage-payment/make-po-payment.css';

const DeductTdsModal = lazy(() => import('../order/manage-payment/DeductTdsModal'));
/* Add New Payment and the row's pencil open the same dialog — the purchase
   order's own, which titles itself "Edit Payment" when handed an `initial`.
   Its props are plain values, not an OrderRow, so it needed no changes. */
const AddPaymentModal = lazy(() => import('../order/manage-payment/AddPaymentModal'));

/**
 * The releases already recorded against a request.
 *
 * Derived from the request rather than hard-coded, so this table agrees with
 * the Paid Amount the requests list is already showing for it. The bank and
 * reference are stand-ins until the endpoint exists; the figure is real.
 */
function releasesFor(request: InvoicePaymentRequest): ReleasePayment[] {
  if (request.paid <= 0) return [];
  return [{
    amount: request.paid,
    bank: 'Axis Bank',
    utr: 'CHQ119852',
    date: request.date,
    file: `Payment_Proof_${request.id}.pdf`,
  }];
}

const ic = {
  viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2.2,
  strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
};
const ICON_CARD = <svg {...ic}><rect x="2" y="5" width="20" height="14" rx="2.5" /><path d="M2 10h20" /></svg>;
const ICON_PLUS = <svg {...ic}><path d="M12 5v14M5 12h14" /></svg>;
const ICON_TICK = <svg {...ic} strokeWidth={3} className="cpay-tick"><path d="M20 6 9 17l-5-5" /></svg>;
const ICON_DOC = <svg {...ic}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></svg>;
const ICON_EYE = <svg {...ic}><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" /><circle cx="12" cy="12" r="3" /></svg>;
const ICON_DL = <svg {...ic}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>;
const ICON_MAIL = <svg {...ic}><rect x="2" y="4" width="20" height="16" rx="2" /><path d="m22 6-10 7L2 6" /></svg>;
const ICON_EDIT = <svg {...ic}><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4z" /></svg>;
const ICON_TRASH = <svg {...ic}><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>;

const REQ_STATUS = {
  approved: { cls: 'mpr-st--done', label: 'Approved' },
  pending: { cls: 'mpr-st--wait', label: 'Awaiting Approval' },
  declined: { cls: 'mpr-st--stop', label: 'Declined' },
} as const;

/** One labelled read-only value in the request grid. */
function Field({ label, mod, children }: { label: string; mod?: string; children: ReactNode }) {
  return (
    <div className={`cpay-f${mod ? ' ' + mod : ''}`}>
      <label>{label}</label>
      <div className={`cpay-v${mod === 'cpay-f--hi' ? ' cpay-v--hi' : ''}`}>{children}</div>
    </div>
  );
}

/**
 * Payment Against Request ID — releasing against one payment request.
 *
 * Opened by the eye on a row of Payment Requests History. It is the purchase
 * order's own payment screen pointed at an SPI: same hero, same read-only
 * request grid, same summary, same release table.
 */
export default function InvoicePaymentModal({ row, request, onClose }: {
  row: InvoiceRow;
  request: InvoicePaymentRequest;
  onClose: () => void;
}) {
  useScrollLock(true, '.mpr-card--pay');

  const cardRef = useRef<HTMLDivElement>(null);
  useEffect(() => { cardRef.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const [releases, setReleases] = useState<ReleasePayment[]>(() => releasesFor(request));
  /* Which release the dialog is on: `true` for a new one, an index to edit it.
     One piece of state rather than two, so the two can never both be open. */
  const [form, setForm] = useState<true | number | null>(null);
  const [tds, setTds] = useState(0);
  const [tdsOpen, setTdsOpen] = useState(false);

  const balance = invoiceBalance(row);
  const pctPaid = invoicePaidPercent(row);
  const GST_PCT = 18;
  const extra = 0;
  const base = Math.round((row.totalPoAmount - extra) / (1 + GST_PCT / 100));
  const gst = row.totalPoAmount - extra - base;

  const approvedRequest = request.status === 'approved';
  const paidHere = releases.reduce((n, r) => n + r.amount, 0);
  const room = approvedRequest ? Math.max(0, request.approved - paidHere) : 0;
  const settled = approvedRequest && request.approved > 0 && room <= 0;
  /* Nothing can be released against a request that was never approved. A
     settled one still allows its own releases to be corrected — the dialog
     adds the row's own amount back when working out what is payable, which
     is what the design shows on a fully-released request. */
  const canEdit = approvedRequest;

  return createPortal(
    <div className="spi-mdl-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      {form !== null && (
        <Suspense fallback={null}>
          <AddPaymentModal
            /* Remounts between rows, so the fields reload from the row being
               edited instead of keeping the previous one's values. */
            key={form === true ? 'new' : form}
            requestId={request.id}
            supplier={row.supplierName}
            poNumber={row.poNo || '—'}
            spiNumber={row.invoiceNo}
            spiCount={1}
            approved={request.approved}
            /* Everything released so far, the row being edited included: the
               dialog adds `initial.amount` back on itself when working out
               what is payable, so subtracting it here counted it twice. */
            paid={paidHere}
            initial={form === true ? undefined : releases[form]}
            onClose={() => setForm(null)}
            onSave={p => {
              setReleases(rs => (form === true ? [...rs, p] : rs.map((r, n) => (n === form ? p : r))));
              setForm(null);
            }}
          />
        </Suspense>
      )}
      <div
        className="spi-mdl mpr-card mpr-card--pay"
        role="dialog" aria-modal="true" aria-labelledby="inv-cpay-title"
        tabIndex={-1} ref={cardRef}
      >
        <div className="mpr-hero">
          <div className="mpr-hero__icon">{ICON_CARD}</div>
          <div className="mpr-hero__titleblock">
            <div className="mpr-hero__titlerow">
              <span className="mpr-hero__title" id="inv-cpay-title">Payment Against Request ID</span>
              <span className="mpr-hero__idpill">{request.id}</span>
            </div>
            <div className="mpr-hero__sub">
              {settled ? 'Paid in full — this request is a record now'
                : approvedRequest ? 'Release the approved amount on this request'
                  : request.status === 'declined' ? 'Read-only — this request was declined'
                    : 'Read-only — this request is awaiting approval'}
            </div>
          </div>
          <InvoiceHeroChips row={row} />
          <button type="button" className="mpr-hero__close" onClick={onClose} aria-label="Close">{ICON_X}</button>
        </div>

        <div className="mpr-bd">
          <Box
            label="Request"
            title={`Current Request Details (${request.id})`}
            sub="The request this release is being made against · read-only"
          >
            <div className="cpay-grid">
              <Field label="Payment Request ID"><span className="cpay-id">{request.id}</span></Field>
              <Field label="Payment Type"><span className="cpay-type">{request.type}</span></Field>
              <Field label="Payment %" mod="cpay-f--pct">
                <span className="cpay-pct">{request.pct}%</span>
                <span className="cpay-bar"><i style={{ width: `${Math.max(0, Math.min(100, request.pct))}%` }} /></span>
              </Field>
              <Field label="Requested Payment Amount">{money(request.amount)}</Field>
              <Field label="Requested To" mod="cpay-f--who">
                <span className="cpay-av">{initials(request.approver)}</span>
                <span className="cpay-whotxt">
                  {request.approver}
                  <span className="cpay-role">{request.role}</span>
                </span>
              </Field>
              <Field label="Request Approval Status" mod="cpay-f--st">
                <span className={`mpr-st ${REQ_STATUS[request.status].cls}`}>
                  <span className="mpr-st__dot" />{REQ_STATUS[request.status].label}
                </span>
              </Field>
              <Field label="Approved Amount" mod="cpay-f--hi">
                {!approvedRequest ? <span className="cpay-none">—</span> : <>{money(request.approved)}{ICON_TICK}</>}
              </Field>
            </div>
          </Box>

          <Box
            label="Summary" title="SPI Payment Details Summary"
            sub="How this SPI's value is made up and where it stands today · read-only"
            headerExtra={(
              <div className="mpr-tds" onClick={e => e.stopPropagation()}>
                <button
                  type="button"
                  className={`mpr-tdsbtn${tds > 0 ? ' mpr-tdsbtn--edit' : ''}`}
                  title={tds > 0 ? 'Revise the tax deducted at source on this invoice'
                    : 'Withhold tax at source against this invoice'}
                  onClick={() => setTdsOpen(true)}
                >
                  <span className="mpr-tdsbtn__ico">
                    <svg {...ic}><line x1="19" y1="5" x2="5" y2="19" /><circle cx="6.5" cy="6.5" r="2.5" /><circle cx="17.5" cy="17.5" r="2.5" /></svg>
                  </span>
                  <span>{tds > 0 ? 'Revise TDS' : 'Deduct TDS Here'}</span>
                </button>
              </div>
            )}
          >
            <div className="mpr-stats">
              <Stat icon={STAT_ICONS.base} label="SPI Base Amount (Without GST)"
                value={money(base)} sub="Pre-tax order value" />
              <Stat mod="mpr-stat--base" icon={STAT_ICONS.trend} label="GST Amount"
                value={money(gst)} sub={`${GST_PCT}% on the base amount`} />
              <Stat mod="mpr-stat--bal" icon={STAT_ICONS.truck} label="Extra Charges"
                value={money(extra)} sub={extra > 0 ? 'Handling & documentation' : 'None on this invoice'} />
              <Stat mod="mpr-stat--gst" icon={STAT_ICONS.coin} label="Total SPI Amount (Grand Total)"
                value={money(row.totalPoAmount)} sub={`${money(row.netPayable)} net payable`} />
              <Stat mod="mpr-stat--paid" icon={STAT_ICONS.rupee} label="Total Paid Amount"
                value={money(row.totalPaid)} sub={`${pctPaid}% of net payable released`} />
              <Stat mod="mpr-stat--tds" icon={STAT_ICONS.wallet} label="Balance Amount"
                value={money(balance)} sub={balance === 0 ? 'Settled in full' : 'Still to be released'} />
            </div>
          </Box>

          <div className="mpr-panel">
            <div className="mpr-panel__hd">
              <span className="mpr-panel__t">Payment History</span>
              <span className="mpr-panel__c">{releases.length}</span>
              <span className="cpay-panel__s">Released against {request.id}</span>
              <button
                type="button"
                className="cpay-add"
                disabled={!approvedRequest || room <= 0}
                onClick={() => setForm(true)}
                title={!approvedRequest
                  ? (request.status === 'pending'
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

              {releases.length === 0 ? (
                <div className="cpay-empty">
                  <div className="cpay-empty__ico">{ICON_CARD}</div>
                  <div className="cpay-empty__t">No payments recorded yet</div>
                  <div className="cpay-empty__s">Use Add New Payment to record a release against this request.</div>
                </div>
              ) : releases.map((p, i) => (
                <div className="cpay-cols cpay-row" key={`${p.utr}-${i}`}>
                  <span className="mpr-sr" data-l="Sr. No">{i + 1}</span>
                  <span data-l="Paid Against Request ID">
                    <span className="mpr-idcell">
                      <span className="mpr-idpill">{request.id}</span>
                      <span className="mpr-iddate">{shortDate(request.date)}</span>
                    </span>
                  </span>
                  <span data-l="Request Raised Against">
                    <span className="mpr-idcell">
                      <span className="mpr-idpill">{row.invoiceNo}</span>
                      <span className="mpr-iddate">{shortDate(row.invoiceDate)}</span>
                    </span>
                  </span>
                  <span data-l="Paid Amount"><b className="cpay-amt">{money(p.amount)}</b></span>
                  <span data-l="Bank Name"><span className="cpay-bank">{p.bank || '—'}</span></span>
                  <span data-l="UTR / Cheque Number"><span className="cpay-utr">{p.utr || '—'}</span></span>
                  <span data-l="UTR / Cheque Date"><span className="cpay-date">{p.date || '—'}</span></span>
                  <span data-l="Proof Of Payment">
                    {p.file ? (
                      <span className="cpay-file">
                        <span className="cpay-file__ico">{ICON_DOC}</span>
                        <span className="cpay-file__name">{p.file}</span>
                        <span className="cpay-file__sep" />
                        <span className="cpay-fbtns">
                          <button type="button" className="cpay-fbtn cpay-fbtn--view"
                            disabled={!p.fileUrl}
                            title={p.fileUrl ? 'View proof of payment' : 'The proof has not been uploaded yet'}
                            onClick={() => p.fileUrl && window.open(p.fileUrl, '_blank', 'noopener')}>{ICON_EYE}</button>
                          <button type="button" className="cpay-fbtn cpay-fbtn--dl"
                            disabled={!p.fileUrl}
                            title={p.fileUrl ? 'Download proof of payment' : 'The proof has not been uploaded yet'}
                            onClick={() => void downloadFile(p.fileUrl, p.file)}>{ICON_DL}</button>
                        </span>
                      </span>
                    ) : <span className="cpay-noproof">Not attached</span>}
                  </span>
                  <span data-l="Action">
                    <span className="cpay-acts">
                      <button type="button" className="cpay-act cpay-act--mail"
                        disabled={!p.file}
                        title={p.file ? `Send ${p.file} to the supplier by email`
                          : 'No proof attached to send — attach one first'}>{ICON_MAIL}</button>
                      <button type="button" className="cpay-act cpay-act--edit"
                        disabled={!canEdit}
                        title={canEdit ? 'Edit this payment' : 'This request is not open for payment'}
                        onClick={() => setForm(i)}>{ICON_EDIT}</button>
                      <button type="button" className="cpay-act cpay-act--del"
                        disabled={!canEdit}
                        title={canEdit ? 'Delete this payment' : 'This request is not open for payment'}
                        onClick={() => setReleases(rs => rs.filter((_, n) => n !== i))}>{ICON_TRASH}</button>
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

      {tdsOpen && (
        <Suspense fallback={null}>
          <DeductTdsModal
            po={row.invoiceNo}
            docLabel="SPI"
            base={base} gst={gst} extra={extra} total={row.totalPoAmount}
            room={balance} saved={tds} firstSave={tds === 0}
            onSave={amount => { setTds(amount); setTdsOpen(false); }}
            onClose={() => setTdsOpen(false)}
          />
        </Suspense>
      )}
    </div>,
    document.body,
  );
}
