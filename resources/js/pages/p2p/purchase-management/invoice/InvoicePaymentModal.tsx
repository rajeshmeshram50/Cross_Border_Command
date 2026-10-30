import { lazy, Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useScrollLock } from '../../../../hooks/useScrollLock';
import {
  Box, Stat, STAT_ICONS, ICON_X, money, initials, shortDate,
} from '../order/manage-payment/payment-shared';
import { InvoiceHeroChips } from './payment-chips';
import { downloadFile } from '../../../../utils/downloadFile';
import { useToast } from '../../../../contexts/ToastContext';
import type { InvoiceRow } from './types';
import type { InvoicePaymentRequest, SpiPayFigures } from './InvoicePaymentsModal';
import type { ReleasePayment } from '../order/manage-payment/MakePoPaymentModal';
import { PoApiError, poPaymentApi, type PoPaymentBody, type PoPaymentRow } from '../order/api/po-api';
import { spiPaymentApi } from './spi-api';

import '../../p2p-detail.css';
import '../order/manage-payment/manage-payment-requests.css';
import '../order/manage-payment/make-po-payment.css';

const AddPaymentModal = lazy(() => import('../order/manage-payment/AddPaymentModal'));

const toRelease = (p: PoPaymentRow): ReleasePayment => ({
  id: p.id, amount: p.amount, bank: p.bank_name ?? '', utr: p.utr_cheque_number ?? '',
  date: p.utr_cheque_date ?? '', file: p.proof_name ?? undefined, fileUrl: p.proof_url,
  zohoSynced: !!p.zoho_synced, zohoError: p.zoho_error ?? null,
});

const payBody = (p: ReleasePayment): PoPaymentBody => ({
  amount: p.amount, bank_name: p.bank || undefined, utr_cheque_number: p.utr || undefined,
  utr_cheque_date: p.date || undefined, proof: p.upload ?? null,
});

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

function Field({ label, mod, children }: { label: string; mod?: string; children: ReactNode }) {
  return (
    <div className={`cpay-f${mod ? ' ' + mod : ''}`}>
      <label>{label}</label>
      <div className={`cpay-v${mod === 'cpay-f--hi' ? ' cpay-v--hi' : ''}`}>{children}</div>
    </div>
  );
}

export default function InvoicePaymentModal({
  row, request, spiId, poId, figures, onChanged, onOpenTds, tdsSaved, onClose,
}: {
  row: InvoiceRow;
  request: InvoicePaymentRequest;
  spiId: number;
  poId: number | null;
  figures: SpiPayFigures;
  onChanged: () => Promise<void> | void;
  onOpenTds?: () => void;
  tdsSaved: boolean;
  onClose: () => void;
}) {
  useScrollLock(true, '.mpr-card--pay');
  const toast = useToast();

  const cardRef = useRef<HTMLDivElement>(null);
  useEffect(() => { cardRef.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const [releases, setReleases] = useState<ReleasePayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyIdx, setBusyIdx] = useState<number | null>(null);

  const loadReleases = useCallback(async () => {
    try {
      if (poId) {
        const res = await poPaymentApi.payments(poId, request.rid);
        setReleases(res.payments.map(toRelease));
      } else {
        const res = await poPaymentApi.detail(request.rid);
        setReleases(res.payments.filter(p => p.payment_request_id === request.rid).map(toRelease));
      }
    } catch (e) {
      toast.error('Could not load the payment history', e instanceof PoApiError ? e.firstError : 'Please try again.');
    } finally {
      setLoading(false);
    }
  }, [poId, request.rid, toast]);
  useEffect(() => { void loadReleases(); }, [loadReleases]);

  const afterChange = async () => {
    await loadReleases();
    await onChanged();
  };
  const rethrowFieldErrors = (e: unknown) => {
    if (e instanceof PoApiError && Object.keys(e.fieldErrors ?? {}).length) throw e;
  };
  const failToast = (what: string, e: unknown) =>
    toast.error(what, e instanceof PoApiError ? e.firstError : 'Please try again.');

  const record = async (p: ReleasePayment) => {
    try {
      await spiPaymentApi.addPayment(spiId, request.rid, payBody(p));
      toast.success('Payment recorded', `${money(p.amount)} released against ${request.id}.`);
      await afterChange();
      return true;
    } catch (e) { rethrowFieldErrors(e); failToast('Could not record the payment', e); return false; }
  };
  const update = async (i: number, p: ReleasePayment) => {
    const target = releases[i];
    if (!target?.id) return false;
    try {
      if (poId) await poPaymentApi.updatePayment(poId, request.rid, target.id, payBody(p));
      else await spiPaymentApi.updatePayment(spiId, request.rid, target.id, payBody(p));
      toast.success('Payment updated', `${request.id} now shows ${money(p.amount)} for this entry.`);
      await afterChange();
      return true;
    } catch (e) { rethrowFieldErrors(e); failToast('Could not update the payment', e); return false; }
  };
  const remove = async (i: number) => {
    const target = releases[i];
    if (!target?.id || busyIdx !== null) return;
    setBusyIdx(i);
    try {
      if (poId) await poPaymentApi.deletePayment(poId, request.rid, target.id);
      else await spiPaymentApi.deletePayment(spiId, request.rid, target.id);
      toast.success('Payment removed', `${money(target.amount)} is back in the balance.`);
      await afterChange();
    } catch (e) { failToast('Could not delete the payment', e); } finally { setBusyIdx(null); }
  };
  const [form, setForm] = useState<true | number | null>(null);
  const { base, gst, extra, total, paid, balance, pctPaid, tds } = figures;

  const approvedRequest = request.status === 'approved';
  const paidHere = releases.reduce((n, r) => n + r.amount, 0);
  const room = approvedRequest ? Math.max(0, request.approved - paidHere) : 0;
  const settled = approvedRequest && request.approved > 0 && room <= 0;
  const canEdit = approvedRequest;

  return createPortal(
    <div className="spi-mdl-backdrop">
      {form !== null && (
        <Suspense fallback={null}>
          <AddPaymentModal
            key={form === true ? 'new' : form}
            requestId={request.id}
            supplier={row.supplierName}
            poNumber={row.poNo || '—'}
            spiNumber={row.invoiceNo}
            spiCount={1}
            approved={request.approved}
            paid={paidHere}
            initial={form === true ? undefined : releases[form]}
            onClose={() => setForm(null)}
            onSave={async p => {
              const ok = form === true ? await record(p) : await update(form, p);
              if (ok !== false) setForm(null);
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
            headerExtra={onOpenTds ? (
              <div className="mpr-tds" onClick={e => e.stopPropagation()}>
                <button
                  type="button"
                  className={`mpr-tdsbtn${tdsSaved ? ' mpr-tdsbtn--edit' : ''}`}
                  title={tdsSaved ? `Revise the TDS withheld on the ${poId ? 'purchase order' : 'invoice'}`
                    : `Withhold tax at source on the ${poId ? 'purchase order' : 'invoice'}`}
                  onClick={onOpenTds}
                >
                  <span className="mpr-tdsbtn__ico">
                    <svg {...ic}><line x1="19" y1="5" x2="5" y2="19" /><circle cx="6.5" cy="6.5" r="2.5" /><circle cx="17.5" cy="17.5" r="2.5" /></svg>
                  </span>
                  <span>{tdsSaved ? 'Revise TDS' : 'Deduct TDS Here'}</span>
                </button>
              </div>
            ) : undefined}
          >
            <div className="mpr-stats">
              <Stat icon={STAT_ICONS.base} label="SPI Base Amount (Without GST)"
                value={money(base)} sub="Pre-tax invoice value" />
              <Stat mod="mpr-stat--base" icon={STAT_ICONS.trend} label="GST Amount"
                value={money(gst)} sub={base > 0 ? `${Math.round((gst / base) * 1000) / 10}% on the base amount` : 'No GST'} />
              <Stat mod="mpr-stat--bal" icon={STAT_ICONS.truck} label="Extra Charges"
                value={money(extra)} sub={extra > 0 ? 'Freight, packing & other charges' : 'None on this invoice'} />
              <Stat mod="mpr-stat--gst" icon={STAT_ICONS.coin} label="Total SPI Amount (Grand Total)"
                value={money(total)} sub={tds > 0 ? `${money(tds)} TDS on the PO` : 'No TDS withheld'} />
              <Stat mod="mpr-stat--paid" icon={STAT_ICONS.rupee} label="Total Paid Amount"
                value={money(paid)} sub={`${pctPaid}% of the SPI released`} />
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

              {loading ? (
                <div className="cpay-empty">
                  <div className="cpay-empty__t">Loading payment history…</div>
                </div>
              ) : releases.length === 0 ? (
                <div className="cpay-empty">
                  <div className="cpay-empty__ico">{ICON_CARD}</div>
                  <div className="cpay-empty__t">No payments recorded yet</div>
                  <div className="cpay-empty__s">Use Add New Payment to record a release against this request.</div>
                </div>
              ) : releases.map((p, i) => (
                <div className="cpay-cols cpay-row" key={p.id ?? `${p.utr}-${i}`}>
                  <span className="mpr-sr" data-l="Sr. No">{i + 1}</span>
                  <span data-l="Paid Against Request ID">
                    <span className="mpr-idcell">
                      <span className="mpr-idpill">{request.id}</span>
                      <span className="mpr-iddate">{request.date ? shortDate(request.date) : '—'}</span>
                    </span>
                  </span>
                  <span data-l="Request Raised Against">
                    <span className="mpr-idcell">
                      <span className="mpr-idpill">{row.invoiceNo}</span>
                      <span className="mpr-iddate">{row.invoiceDate ? shortDate(row.invoiceDate) : '—'}</span>
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
                        disabled={!canEdit || p.zohoSynced}
                        title={p.zohoSynced ? 'Posted to Zoho Books — it cannot be edited here'
                          : canEdit ? 'Edit this payment' : 'This request is not open for payment'}
                        onClick={() => setForm(i)}>{ICON_EDIT}</button>
                      <button type="button" className="cpay-act cpay-act--del"
                        disabled={!canEdit || busyIdx !== null || p.zohoSynced}
                        title={p.zohoSynced ? 'Posted to Zoho Books — it cannot be deleted here'
                          : canEdit ? 'Delete this payment' : 'This request is not open for payment'}
                        onClick={() => void remove(i)}>{ICON_TRASH}</button>
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
