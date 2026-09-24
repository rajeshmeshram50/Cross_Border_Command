import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useScrollLock } from '../../../../../hooks/useScrollLock';
import type { OrderRow } from '../po-list/Order';
import type { NewRequest } from './RaisePaymentRequestModal';
import type { ReleasePayment } from './MakePoPaymentModal';
import { useToast } from '../../../../../contexts/ToastContext';
import { PoApiError, poPaymentApi, type PoPaymentBody, type PoPaymentsPayload, type PoPayRequest } from '../api/po-api';
import {
  Box, HeroRefChips, ICON_X, PoSummaryCards, STAT_ICONS, Stat, TdsStrip,
  initials, moneyIn, rowBreakdown, shortDate,
} from './payment-shared';

import '../../supplier-purchase-invoice/supplier-purchase-invoice.css';
import './manage-payment-requests.css';

const DeductTdsModal = lazy(() => import('./DeductTdsModal'));
const RaisePaymentRequestModal = lazy(() => import('./RaisePaymentRequestModal'));
const MakePoPaymentModal = lazy(() => import('./MakePoPaymentModal'));

type ReqStatus = 'approved' | 'pending' | 'rejected';

/** A request row as the table shows it; `id` is the request code, `rid` the database id. */
type PaymentRequest = {
  rid: number;
  id: string;
  pct: number | null;
  date: string;
  type: string;
  amount: number;
  approver: string;
  role: string;
  status: ReqStatus;
  approved: number;
  paid: number;
};


function toRow(q: PoPayRequest): PaymentRequest {
  return {
    rid: q.id, id: q.code, pct: q.percentage, date: q.requested_at ?? '', type: q.payment_type,
    amount: q.requested_amount, approver: q.requested_to.name ?? '—', role: q.requested_to.role ?? '',
    status: q.status, approved: q.approved_amount ?? 0, paid: q.paid_amount,
  };
}

const ic = {
  viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
  strokeWidth: 2.2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
};

const ICON_HISTORY = (
  <svg {...ic} strokeWidth={2.2}>
    <path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><polyline points="3 3 3 8 8 8" /><polyline points="12 7.5 12 12 15 13.6" />
  </svg>
);
const ICON_RUPEE = (
  <svg {...ic}><path d="M6 3h12" /><path d="M6 8h12" /><path d="m6 13 8.5 8" /><path d="M6 13h3" /><path d="M9 13c6.667 0 6.667-10 0-10" /></svg>
);
const ICON_EYE = (
  <svg {...ic}><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" /><circle cx="12" cy="12" r="3" /></svg>
);
const ICON_CHECK = <svg {...ic} strokeWidth={3}><path d="M20 6 9 17l-5-5" /></svg>;

const STATUS: Record<ReqStatus, { cls: string; label: string }> = {
  approved: { cls: 'mpr-st--done', label: 'Approved' },
  pending: { cls: 'mpr-st--wait', label: 'Awaiting Approval' },
  rejected: { cls: 'mpr-st--stop', label: 'Declined' },
};

function payLabel(q: PaymentRequest): string {
  if (q.paid <= 0) return 'Payment pending';
  return q.paid >= q.approved ? 'Paid in full' : 'Partially paid';
}

function RequestRow({ q, index, net, onPay, ccy }: {
  q: PaymentRequest; index: number; net: number; onPay: (q: PaymentRequest) => void;
  /** The PO's own currency. */
  ccy?: string | null;
}) {
  const money = moneyIn(ccy);
  const due = Math.max(0, q.approved - q.paid);
  const st = STATUS[q.status];
  const pct = q.pct ?? (net > 0 ? Math.round((q.amount / net) * 1000) / 10 : 0);
  const settled = q.status === 'approved' && q.approved > 0 && due <= 0;

  return (
    <div className={`mpr-row${q.status === 'rejected' ? ' is-closed' : ''}`}>
      <span className="mpr-c mpr-sr" data-l="Sr No">{index + 1}</span>

      <span className="mpr-c" data-l="Payment Request ID">
        <span className="mpr-idcell">
          <span className="mpr-idpill">{q.id}</span>
          <span className="mpr-iddate">{shortDate(q.date)}</span>
        </span>
      </span>

      <span className="mpr-c" data-l="Payment Type"><span className="mpr-type">{q.type}</span></span>
      <span className="mpr-c" data-l="Payment %"><span className="mpr-pct">{pct}%</span></span>
      <span className="mpr-c" data-l="Requested Payment Amount"><b className="mpr-amt">{money(q.amount)}</b></span>

      <span className="mpr-person" data-l="Requested To">
        <span className="mpr-av">{initials(q.approver)}</span>
        <span className="mpr-who">
          <span className="mpr-who__name">{q.approver}</span>
          <span className="mpr-who__role">{q.role}</span>
        </span>
      </span>

      <span className="mpr-c" data-l="Request Approval Status">
        <span className="mpr-stack">
          <span className={`mpr-st ${st.cls}`}><span className="mpr-st__dot" />{st.label}</span>
          {q.status === 'approved' && <span className="mpr-substat">{payLabel(q)}</span>}
        </span>
      </span>

      <span className="mpr-c" data-l="Approved Amount">
        {q.status === 'pending'
          ? <b className="mpr-amt mpr-amt--none">&mdash;</b>
          : <b className={`mpr-amt${q.approved > 0 ? ' is-ok' : ''}`}>{money(q.approved)}</b>}
      </span>

      <span className="mpr-c" data-l="Paid Amount">
        <span className="mpr-stack">
          {q.paid > 0
            ? <b className="mpr-amt is-paid">{money(q.paid)}</b>
            : <b className="mpr-amt mpr-amt--none">&mdash;</b>}
          {due > 0 && q.status === 'approved' && <span className="mpr-substat">{money(due)} due</span>}
        </span>
      </span>

      <span className="mpr-c" data-l="Action">
        <span className="mpr-acts">
          {settled ? (
            <span className="mpr-paid" title={`Released in full against ${q.id}`}>{ICON_CHECK}Paid</span>
          ) : (
            <button
              type="button"
              className="mpr-paybtn"
              disabled={q.status !== 'approved'}
              onClick={() => onPay(q)}
              title={
                q.status === 'pending' ? 'Awaiting approval — payment opens once this request is approved'
                  : q.status === 'rejected' ? 'This request was declined — nothing to pay against it'
                    : `Release ${money(due)} against ${q.id}`
              }
            >
              {ICON_RUPEE}<span>Make PO Payment</span>
            </button>
          )}
          <button
            type="button"
            className="mpr-viewbtn"
            onClick={() => onPay(q)}
            title={`View Payment History — ${q.id}`}
            aria-label={`View payment history for ${q.id}`}
          >
            {ICON_EYE}
          </button>
        </span>
      </span>
    </div>
  );
}

function TdsLoading() {
  return createPortal(
    <div className="spi-mdl-backdrop">
      <div className="mpr-tdsload">
        <span className="spi-sk-bar mpr-tdsload__hd" />
        <div className="mpr-tdsload__grid">
          {Array.from({ length: 6 }, (_, i) => <span className="spi-sk-bar mpr-tdsload__cell" key={i} />)}
        </div>
      </div>
    </div>,
    document.body,
  );
}

export default function ManagePaymentRequestsModal({ row, startWithRaise = false, onClose }: {
  row: OrderRow; startWithRaise?: boolean; onClose: () => void;
}) {
  useScrollLock(true, '.mpr-card--history');
  // Every figure on this screen is in the PO's own currency.
  const money = moneyIn(row.currency);

  const cardRef = useRef<HTMLDivElement>(null);
  useEffect(() => { cardRef.current?.focus(); }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const toast = useToast();
  const [data, setData] = useState<PoPaymentsPayload | null>(null);
  const [tdsOpen, setTdsOpen] = useState(false);
  const [raiseOpen, setRaiseOpen] = useState(false);
  const [payReq, setPayReq] = useState<PaymentRequest | null>(null);
  const [releases, setReleases] = useState<ReleasePayment[]>([]);
  const [busy, setBusy] = useState(false);

  const failToast = (what: string, e: unknown) => toast.error(what, e instanceof PoApiError ? e.firstError : 'Please try again.');

  const load = useCallback(async () => {
    if (!row.id) return;
    try { setData(await poPaymentApi.forPo(row.id)); } catch (e) { failToast('Could not load the payment requests', e); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row.id]);
  useEffect(() => { load(); }, [load]);
  // Opened straight on "raise": wait for the PO figures, then apply the TDS-first rule.
  const autoRaise = useRef(startWithRaise);
  useEffect(() => {
    if (!autoRaise.current || !data) return;
    autoRaise.current = false;
    if (data.po.tds_applies && !data.po.tds_saved) setTdsOpen(true); else setRaiseOpen(true);
  }, [data]);

  const po = data?.po;
  const sum = data?.requests_summary;
  const list = useMemo(() => (data?.requests ?? []).map(toRow), [data]);
  const tds = po?.tds_amount ?? 0;

  // The PO's figures as stored on the server; the child popups read them from this row.
  const live: OrderRow = po ? {
    ...row, total: po.grand_total, net: po.net_payable, paid: po.paid, balance: po.balance,
    breakdown: { base: po.base_amount, gst: po.gst_amount, extra: po.extra_charges },
  } : row;

  const f = {
    requested: sum?.requested_amount ?? 0,
    approved: sum?.approved_amount ?? 0,
    paid: sum?.paid ?? 0,
    pendingAmt: sum?.awaiting_amount ?? 0,
    pendingCount: sum?.pending_count ?? 0,
    approvedCount: sum?.approved_count ?? 0,
    declinedCount: sum?.rejected_count ?? 0,
    approvedUnpaid: sum?.approved_unpaid ?? 0,
    readyCount: sum?.ready_count ?? 0,
    openToRequest: sum?.open_to_request ?? 0,
    complete: !!po?.complete,
  };

  const split = rowBreakdown(live);
  const { base, gst, extra } = split;
  const pctPaid = po?.paid_pct ?? 0;

  const canPay = f.approvedUnpaid > 0 && !row.cancelled;
  const canRequest = !!po && f.openToRequest > 0 && !row.cancelled && !f.complete;

  // TDS: one per PO, fixed once the first payment is recorded.
  const openTds = () => { if (po) setTdsOpen(true); };
  // A domestic PO settles its TDS (even as 0) before any request is raised.
  const needsTds = !!po && po.tds_applies && !po.tds_saved;
  const openRaise = () => {
    if (needsTds) {
      toast.warning('Deduct TDS first', 'Save the TDS on this PO (even as 0) before raising a payment request.');
      setTdsOpen(true);
      return;
    }
    setRaiseOpen(true);
  };
  const saveTds = async (amount: number) => {
    if (!row.id || busy) return;
    setBusy(true);
    try {
      setData(await poPaymentApi.saveTds(row.id, { tds_amount: amount }));
      setTdsOpen(false);
      toast.success('TDS saved', `${money(amount)} withheld on ${row.po}.`);
    } catch (e) { failToast('Could not save the TDS', e); } finally { setBusy(false); }
  };

  const raise = async (req: NewRequest) => {
    if (!row.id || busy) return;
    setBusy(true);
    try {
      setData(await poPaymentApi.raise(row.id, {
        payment_type: req.type, percentage: req.pct || undefined, requested_amount: req.amount,
        reason: req.reason, requested_to: req.approverId,
      }));
      setRaiseOpen(false);
      toast.success('Payment request raised', `Sent to ${req.approver} for approval.`);
    } catch (e) { failToast('Could not raise the request', e); } finally { setBusy(false); }
  };

  // Payment History of one request, fetched when its Make PO Payment popup opens.
  const openPay = async (q: PaymentRequest) => {
    if (!row.id) return;
    try {
      const res = await poPaymentApi.payments(row.id, q.rid);
      setReleases(res.payments.map((p) => ({
        id: p.id, amount: p.amount, bank: p.bank_name ?? '', utr: p.utr_cheque_number ?? '',
        date: p.utr_cheque_date ?? '', file: p.proof_name ?? undefined, fileUrl: p.proof_url,
        zohoSynced: !!p.zoho_synced, zohoError: p.zoho_error ?? null,
      })));
      setPayReq(q);
    } catch (e) { failToast('Could not load the payment history', e); }
  };
  const payBody = (p: ReleasePayment): PoPaymentBody => ({
    amount: p.amount, bank_name: p.bank || undefined, utr_cheque_number: p.utr || undefined,
    utr_cheque_date: p.date || undefined, proof: p.upload ?? null,
  });
  const afterPayment = async (q: PaymentRequest, summary: PoPaymentsPayload) => {
    setData(summary);
    const fresh = summary.requests.find((r) => r.id === q.rid);
    if (fresh) await openPay(toRow(fresh));
  };
  const recordPayment = async (p: ReleasePayment) => {
    if (!row.id || !payReq) return false;
    try {
      const res = await poPaymentApi.addPayment(row.id, payReq.rid, payBody(p));
      toast.success('Payment recorded', `${money(p.amount)} released against ${payReq.id}.`);
      await afterPayment(payReq, res.summary);
      return true;
    } catch (e) { failToast('Could not record the payment', e); return false; }
  };
  const updatePayment = async (i: number, p: ReleasePayment) => {
    const target = releases[i];
    if (!row.id || !payReq || !target?.id) return false;
    try {
      const res = await poPaymentApi.updatePayment(row.id, payReq.rid, target.id, payBody(p));
      toast.success('Payment updated', `${payReq.id} now shows ${money(p.amount)} for this entry.`);
      await afterPayment(payReq, res.summary);
      return true;
    } catch (e) { failToast('Could not update the payment', e); return false; }
  };
  // The PO and its bill are created in Zoho first if they are not there yet.
  const syncPayment = async (i: number) => {
    const target = releases[i];
    if (!row.id || !payReq || !target?.id) return;
    try {
      const res = await poPaymentApi.zohoSyncPayment(row.id, payReq.rid, target.id);
      toast.success('Posted to Zoho Books', res.message ?? `${money(target.amount)} against ${row.po}.`);
      await afterPayment(payReq, res.summary);
    } catch (e) { failToast('Zoho Books sync failed', e); }
  };
  const deletePayment = async (i: number) => {
    const target = releases[i];
    if (!row.id || !payReq || !target?.id) return;
    try {
      const res = await poPaymentApi.deletePayment(row.id, payReq.rid, target.id);
      toast.success('Payment removed', `${money(target.amount)} is back in the balance.`);
      await afterPayment(payReq, res.summary);
    } catch (e) { failToast('Could not delete the payment', e); }
  };

  return createPortal(

    <div className="spi-mdl-backdrop">
      {payReq && (
        <Suspense fallback={<TdsLoading />}>
          <MakePoPaymentModal
            row={live}
            requestId={payReq.id}
            requestDate={payReq.date}
            requestType={payReq.type}
            requestedAmount={payReq.amount}
            approved={payReq.approved}
            requestStatus={payReq.status}
            approver={payReq.approver}
            approverRole={payReq.role}
            alreadyPaid={0}
            payments={releases}
            tds={tds}
            onOpenTds={openTds}
            onClose={() => setPayReq(null)}
            onRecord={recordPayment}
            onUpdate={updatePayment}
            onDelete={deletePayment}
            onZohoSync={syncPayment}
          />
        </Suspense>
      )}

      {raiseOpen && po && (
        <Suspense fallback={<TdsLoading />}>
          <RaisePaymentRequestModal
            row={live}
            nextId="Assigned on submit"
            requested={f.requested}
            approvedTotal={f.approved}
            pendingAmt={f.pendingAmt}
            pendingCount={f.pendingCount}
            approvedUnpaid={f.approvedUnpaid}
            requestCount={list.length}
            available={f.openToRequest}
            complete={f.complete}
            busy={busy}
            onClose={() => setRaiseOpen(false)}
            onSubmit={raise}
          />
        </Suspense>
      )}

      {tdsOpen && po && (
        <Suspense fallback={<TdsLoading />}>
          <DeductTdsModal
            po={row.po}
            base={base}
            gst={gst}
            extra={extra}
            total={po.grand_total}
            room={base}
            saved={tds}
            firstSave={!po.tds_saved}
            readOnly={po.tds_locked}
            onSave={saveTds}
            onClose={() => setTdsOpen(false)}
          />
        </Suspense>
      )}

      <div className="spi-mdl mpr-card mpr-card--history" role="dialog" aria-modal="true" aria-labelledby="mpr-title" tabIndex={-1} ref={cardRef}>

        <div className="mpr-hero">
          <div className="mpr-hero__icon">{ICON_HISTORY}</div>
          <div className="mpr-hero__titleblock">
            <div className="mpr-hero__titlerow">
              <span className="mpr-hero__title" id="mpr-title">Payment Requests History</span>
              <span className="mpr-hero__badge">
                <span className="mpr-hero__bdot" />
                {f.complete ? 'Payment Completed' : `${list.length} request${list.length === 1 ? '' : 's'}`}
              </span>
            </div>
            <div className="mpr-hero__sub">All requests raised on this PO</div>
          </div>

          <HeroRefChips row={row} />

          <button type="button" className="mpr-hero__close" onClick={onClose} aria-label="Close">{ICON_X}</button>
        </div>

        <div className="mpr-bd">
          {f.complete && (
            <div className="mpr-done">
              <span className="mpr-done__ico">{ICON_CHECK}</span>
              <span>
                <b>Payment Completed</b> — the full net payable of {money(live.net)} has been released against this PO.
                No further requests can be raised.
              </span>
            </div>
          )}

          <Box
            label="Summary"
            title="PO Payment Details Summary"
            sub="How this PO’s value is made up and where it stands today · read-only"
            headerExtra={!row.cancelled && !!po && (
              <TdsStrip tds={tds} total={live.total} supplier={row.supplier} onOpen={openTds} locked={po.tds_locked}
                ccy={row.currency} international={!po.tds_applies} />
            )}
          >
            <PoSummaryCards total={live.total} paid={live.paid} balance={live.balance} net={live.net} complete={f.complete} split={split} ccy={row.currency} />
          </Box>

          <Box
            label="Summary"
            title="All Request Details Summary"
            sub="Running totals as on today, across every request raised on this PO · click to hide"
          >
            <div className="mpr-stats">
              <Stat
                icon={STAT_ICONS.doc}
                label="Total Requests" value={String(list.length)}
                sub={list.length
                  ? [f.approvedCount && `${f.approvedCount} approved`, f.pendingCount && `${f.pendingCount} awaiting`, f.declinedCount && `${f.declinedCount} declined`]
                    .filter(Boolean).join(' · ')
                  : 'None raised yet'}
              />
              <Stat
                mod="mpr-stat--base"
                icon={<><path d="M22 2 11 13" /><path d="M22 2 15 22l-4-9-9-4z" /></>}
                label="Total Requested Amount" value={money(f.requested)}
                sub={`${list.length} request${list.length === 1 ? '' : 's'} raised to date`}
              />
              <Stat
                mod="mpr-stat--bal"
                icon={<><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></>}
                label="Awaiting For Approval" value={money(f.pendingAmt)}
                sub={`${f.pendingCount} with the approver now`}
              />
              <Stat
                mod="mpr-stat--gst"
                icon={<path d="M20 6 9 17l-5-5" />}
                label="Total Approved Amount" value={money(f.approved)}
                sub={`${money(f.approvedUnpaid)} awaiting release`}
              />
              <Stat
                mod="mpr-stat--paid"
                icon={<><path d="M6 3h12" /><path d="M6 8h12" /><path d="m6 13 8.5 8" /><path d="M6 13h3" /><path d="M9 13c6.667 0 6.667-10 0-10" /></>}
                label="Total Paid Amount" value={money(f.paid)} sub={`${pctPaid}% of net payable released`}
              />
              <Stat
                mod="mpr-stat--tds"
                icon={<><path d="M3 3v18h18" /><polyline points="7 14 11 9 15 12 20 6" /></>}
                label="Balance Amount" value={money(f.openToRequest)}
                sub={f.complete ? 'PO settled in full' : 'Open to request'}
              />
            </div>
          </Box>

          <div className="mpr-panel">
            <div className="mpr-panel__hd">
              <span className="mpr-panel__t">All Payment Requests</span>
              <span className="mpr-panel__c">{list.length}</span>
              <span className="mpr-panel__s">In the order they were raised</span>
            </div>

            {!data ? (
              <div className="mpr-empty">
                <div className="mpr-empty__t"><span className="spinner-border spinner-border-sm me-2" role="status" />Loading payment requests…</div>
              </div>
            ) : list.length === 0 ? (
              <div className="mpr-empty">
                <div className="mpr-empty__ico">{ICON_HISTORY}</div>
                <div className="mpr-empty__t">No payment requests yet</div>
                <div className="mpr-empty__s">
                  Requests raised from Request for PO Payment will appear here with their approval
                  decision and every payment released against them.
                </div>
              </div>
            ) : (
              <div className="mpr-table">
                <div className="mpr-row mpr-row--head">
                  <span className="mpr-c">Sr No</span>
                  <span className="mpr-c">Payment Request ID</span>
                  <span className="mpr-c">Payment Type</span>
                  <span className="mpr-c">Payment %</span>
                  <span className="mpr-c">Requested Payment Amount</span>
                  <span>Requested To</span>
                  <span className="mpr-c">Request Approval Status</span>
                  <span className="mpr-c">Approved Amount</span>
                  <span className="mpr-c">Paid Amount</span>
                  <span className="mpr-c">Action</span>
                </div>
                {list.map((q, i) => <RequestRow key={q.rid} q={q} index={i} net={live.net} onPay={openPay} ccy={row.currency} />)}
              </div>
            )}
          </div>
        </div>

        <div className="spi-mdl-foot">
          {canPay && (
            <div className="mpr-recap">
              <span className="mpr-recap__lbl">Ready To Pay</span>
              <b className="mpr-recap__val">{money(f.approvedUnpaid)}</b>
              <span className="mpr-recap__sep" />
              <span className="mpr-recap__type">across {f.readyCount} request{f.readyCount === 1 ? '' : 's'}</span>
            </div>
          )}
          <div className="spi-mdl-foot-btns">
            <button type="button" className="spi-mdl-cancel" onClick={onClose}>Close</button>
            {canRequest && (
              <button type="button" className="spi-mdl-confirm mpr-raise" onClick={openRaise}
                title={needsTds ? 'Deduct the TDS on this PO first' : undefined}>
                Raise New Request
              </button>
            )}
          </div>
        </div>

      </div>
    </div>,
    document.body,
  );
}
