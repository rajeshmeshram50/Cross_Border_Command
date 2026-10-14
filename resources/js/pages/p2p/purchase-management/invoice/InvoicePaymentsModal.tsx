import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useScrollLock } from '../../../../hooks/useScrollLock';
import { useToast } from '../../../../contexts/ToastContext';
import {
  Box, Stat, STAT_ICONS, ICON_X, money, initials, shortDate,
} from '../order/manage-payment/payment-shared';
import { InvoiceHeroChips } from './payment-chips';
import { PoApiError, poPaymentApi, type PoPayRequest, type PoPaymentsPayload } from '../order/api/po-api';
import { spiPaymentApi, type SpiPaymentSummary, type SpiRaiseBody } from './spi-api';
import type { InvoiceRow } from './types';

const DeductTdsModal = lazy(() => import('../order/manage-payment/DeductTdsModal'));
const InvoicePaymentModal = lazy(() => import('./InvoicePaymentModal'));
const InvoiceRaiseRequestModal = lazy(() => import('./InvoiceRaiseRequestModal'));

import '../../p2p-detail.css';
import '../order/manage-payment/manage-payment-requests.css';

export interface InvoicePaymentRequest {
  rid: number;
  id: string;
  date: string;
  type: string;
  pct: number;
  amount: number;
  approver: string;
  role: string;
  status: 'approved' | 'pending' | 'declined';
  approved: number;
  paid: number;
}

export interface SpiPayFigures {
  base: number;
  gst: number;
  extra: number;
  total: number;
  paid: number;
  balance: number;
  pctPaid: number;
  tds: number;
}

export interface SpiRequestTotals {
  requested: number;
  approvedTotal: number;
  pendingAmt: number;
  pendingCount: number;
  approvedUnpaid: number;
  requestCount: number;
  available: number;
}

type RequestWithSpi = PoPayRequest & { supplier_invoice_id?: number | null };

const toRequest = (r: RequestWithSpi): InvoicePaymentRequest => ({
  rid: r.id,
  id: r.code,
  date: r.requested_at ?? '',
  type: r.payment_type,
  pct: r.percentage ?? 0,
  amount: r.requested_amount,
  approver: r.requested_to?.name ?? '—',
  role: r.requested_to?.role ?? 'Approver',
  status: r.status === 'approved' ? 'approved' : r.status === 'rejected' ? 'declined' : 'pending',
  approved: r.approved_amount ?? 0,
  paid: r.paid_amount,
});

const STATUS = {
  approved: { cls: 'mpr-st--done', label: 'Approved' },
  pending: { cls: 'mpr-st--wait', label: 'Awaiting Approval' },
  declined: { cls: 'mpr-st--stop', label: 'Declined' },
} as const;

const ic = {
  viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2.2,
  strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
};
const ICON_RUPEE = (
  <svg {...ic}><path d="M6 3h12" /><path d="M6 8h12" /><path d="m6 13 8.5 8" /><path d="M6 13h3" /><path d="M9 13c6.667 0 6.667-10 0-10" /></svg>
);
const ICON_EYE = (
  <svg {...ic}><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" /><circle cx="12" cy="12" r="3" /></svg>
);
const ICON_CHECK = <svg {...ic} strokeWidth={3}><path d="M20 6 9 17l-5-5" /></svg>;

export default function InvoicePaymentsModal({ row, onClose }: {
  row: InvoiceRow; onClose: () => void;
}) {
  useScrollLock(true, '.mpr-card--history');
  const toast = useToast();

  const [summary, setSummary] = useState<SpiPaymentSummary | null>(null);
  const [poData, setPoData] = useState<PoPaymentsPayload | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [loadError, setLoadError] = useState('');

  const [tdsOpen, setTdsOpen] = useState(false);
  const [tdsBusy, setTdsBusy] = useState(false);
  const [payForId, setPayForId] = useState<number | null>(null);
  const [raising, setRaising] = useState(false);

  const spiId = row.apiId ?? null;

  const load = useCallback(async () => {
    if (!spiId) { setState('failed'); setLoadError('This invoice has not been saved yet.'); return; }
    try {
      const s = await spiPaymentApi.summary(spiId);
      setSummary(s);
      setPoData(s.po ? await poPaymentApi.forPo(s.po.id) : null);
      setState('ready');
    } catch (e) {
      setState(st => (st === 'ready' ? st : 'failed'));
      setLoadError(e instanceof PoApiError ? e.firstError : 'Could not load the payment requests.');
    }
  }, [spiId]);
  useEffect(() => { void load(); }, [load]);

  const cardRef = useRef<HTMLDivElement>(null);
  useEffect(() => { cardRef.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !tdsBusy) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, tdsBusy]);

  const list = useMemo(
    () => (poData?.requests ?? [])
      .filter(r => (r as RequestWithSpi).supplier_invoice_id === spiId)
      .map(r => toRequest(r as RequestWithSpi)),
    [poData, spiId],
  );

  const spi = summary?.spi;
  const po = poData?.po ?? null;
  const total = spi?.grand_total ?? 0;
  const base = spi?.base_amount ?? 0;
  const gst = spi?.gst_amount ?? 0;
  const extra = Math.max(0, Math.round((total - base - gst) * 100) / 100);

  const requested = list.reduce((n, q) => n + q.amount, 0);
  const approvedAmt = list.filter(q => q.status === 'approved').reduce((n, q) => n + q.approved, 0);
  const paid = spi?.paid_amount ?? list.reduce((n, q) => n + q.paid, 0);
  const pendingAmt = list.filter(q => q.status === 'pending').reduce((n, q) => n + q.amount, 0);
  const approvedCount = list.filter(q => q.status === 'approved').length;
  const pendingCount = list.filter(q => q.status === 'pending').length;
  const readyToPay = list.filter(q => q.status === 'approved').reduce((n, q) => n + Math.max(0, q.approved - q.paid), 0);
  const balance = spi?.balance ?? Math.max(0, total - paid);
  const pctPaid = total > 0 ? Math.round((paid / total) * 100) : 0;
  const spiCommitted = pendingAmt + approvedAmt;
  const available = Math.max(0, Math.min(
    poData?.requests_summary.open_to_request ?? 0,
    Math.round((total - spiCommitted) * 100) / 100,
  ));

  const figures: SpiPayFigures = { base, gst, extra, total, paid, balance, pctPaid, tds: po?.tds_amount ?? 0 };
  const totals: SpiRequestTotals = {
    requested, approvedTotal: approvedAmt, pendingAmt, pendingCount,
    approvedUnpaid: readyToPay, requestCount: list.length, available,
  };

  const standalone = state === 'ready' && !summary?.po;
  const needsTds = !!po && po.tds_applies && !po.tds_saved;
  const whyNoRequest = state !== 'ready' ? 'Loading…'
    : standalone ? 'This is a standalone invoice — it has no purchase order to pay against.'
      : balance <= 0 ? 'This SPI is paid in full — nothing is left to request.'
        : available <= 0 ? 'Nothing left to request — the balance is already covered by open requests.'
          : undefined;

  const openRaise = () => {
    if (needsTds) {
      toast.warning('Deduct TDS first', `Save the TDS on ${po?.code} (even as 0) before raising a payment request.`);
      setTdsOpen(true);
      return;
    }
    setRaising(true);
  };

  const saveTds = async (amount: number) => {
    if (!po || tdsBusy) return;
    setTdsBusy(true);
    try {
      setPoData(await poPaymentApi.saveTds(po.id, { tds_amount: amount }));
      setTdsOpen(false);
      toast.success('TDS saved', `${money(amount)} withheld on ${po.code}.`);
      void load();
    } catch (e) {
      toast.error('Could not save the TDS', e instanceof PoApiError ? e.firstError : 'Please try again.');
    } finally {
      setTdsBusy(false);
    }
  };

  const raise = async (body: SpiRaiseBody, approverName: string) => {
    if (!spiId) return;
    await spiPaymentApi.raise(spiId, body);
    setRaising(false);
    toast.success('Payment request raised', `Sent to ${approverName} for approval.`);
    await load();
  };

  const payFor = payForId != null ? list.find(q => q.rid === payForId) ?? null : null;

  return createPortal(
    <div className="spi-mdl-backdrop">
      <div
        className="spi-mdl mpr-card mpr-card--history"
        role="dialog" aria-modal="true" aria-labelledby="inv-mpr-title"
        ref={cardRef} tabIndex={-1}
      >
        <div className="mpr-hero">
          <div className="mpr-hero__icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 3v5h5" /><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8" /><path d="M12 7v5l4 2" />
            </svg>
          </div>
          <div className="mpr-hero__titleblock">
            <div className="mpr-hero__titlerow">
              <span className="mpr-hero__title" id="inv-mpr-title">Payment Requests History</span>
              <span className="mpr-hero__badge">
                <span className="mpr-hero__bdot" />
                {list.length} request{list.length === 1 ? '' : 's'}
              </span>
            </div>
            <div className="mpr-hero__sub">All requests raised on this SPI</div>
          </div>

          <InvoiceHeroChips row={row} />

          <button type="button" className="mpr-hero__close" onClick={onClose} aria-label="Close">{ICON_X}</button>
        </div>

        <div className="mpr-bd">
          {state === 'failed' ? (
            <div className="mpr-empty">
              <div className="mpr-empty__t">Could not load the payment requests</div>
              <div className="mpr-empty__s">{loadError}</div>
            </div>
          ) : (
            <>
              <Box
                label="Summary" title="SPI Payment Details Summary"
                sub="How this SPI's value is made up and where it stands today · read-only"
                headerExtra={po?.tds_applies ? (
                  <div className="mpr-tds" onClick={e => e.stopPropagation()}>
                    <button
                      type="button"
                      className={`mpr-tdsbtn${po.tds_saved ? ' mpr-tdsbtn--edit' : ''}`}
                      title={po.tds_locked
                        ? `TDS on ${po.code} is fixed — ${po.tds_locked_by === 'approval'
                          ? 'a payment request has already been approved against this net'
                          : 'a payment is already recorded'}`
                        : po.tds_saved ? `Revise the TDS withheld on ${po.code}` : `Withhold tax at source on ${po.code}`}
                      onClick={() => setTdsOpen(true)}
                    >
                      <span className="mpr-tdsbtn__ico">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                          <line x1="19" y1="5" x2="5" y2="19" /><circle cx="6.5" cy="6.5" r="2.5" /><circle cx="17.5" cy="17.5" r="2.5" />
                        </svg>
                      </span>
                      <span>{po.tds_locked ? 'View TDS' : po.tds_saved ? 'Revise TDS' : 'Deduct TDS Here'}</span>
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
                    value={money(total)} sub={po ? `${money(po.tds_amount)} TDS on ${po.code}` : 'Standalone invoice'} />
                  <Stat mod="mpr-stat--paid" icon={STAT_ICONS.rupee} label="Total Paid Amount"
                    value={money(paid)} sub={`${pctPaid}% of the SPI released`} />
                  <Stat mod="mpr-stat--tds" icon={STAT_ICONS.wallet} label="Balance Amount"
                    value={money(balance)} sub={balance <= 0 ? 'Settled in full' : 'Still to be released'} />
                </div>
              </Box>

              <Box
                label="Summary" title="All Request Details Summary"
                sub="Running totals as on today, across every request raised on this SPI"
              >
                <div className="mpr-stats">
                  <Stat icon={STAT_ICONS.doc} label="Total Requests" value={String(list.length)}
                    sub={[approvedCount && `${approvedCount} approved`, pendingCount && `${pendingCount} awaiting`]
                      .filter(Boolean).join(' · ') || 'None raised yet'} />
                  <Stat mod="mpr-stat--base" icon={STAT_ICONS.send} label="Total Requested Amount"
                    value={money(requested)}
                    sub={`${list.length} request${list.length === 1 ? '' : 's'} raised to date`} />
                  <Stat mod="mpr-stat--bal" icon={STAT_ICONS.clock} label="Awaiting For Approval"
                    value={money(pendingAmt)} sub={`${pendingCount} with the approver now`} />
                  <Stat mod="mpr-stat--gst" icon={STAT_ICONS.check} label="Total Approved Amount"
                    value={money(approvedAmt)} sub={`${money(readyToPay)} awaiting release`} />
                  <Stat mod="mpr-stat--paid" icon={STAT_ICONS.rupee} label="Total Paid Amount"
                    value={money(paid)} sub={`${pctPaid}% of the SPI released`} />
                  <Stat mod="mpr-stat--tds" icon={STAT_ICONS.wallet} label="Open To Request"
                    value={money(available)} sub={available > 0 ? 'Can still be requested' : 'Nothing left to request'} />
                </div>
              </Box>

              <div className="mpr-panel">
                <div className="mpr-panel__hd">
                  <span className="mpr-panel__t">All Payment Requests</span>
                  <span className="mpr-panel__c">{list.length}</span>
                  <span className="mpr-panel__s">In the order they were raised</span>
                </div>

                {state === 'loading' ? (
                  <div className="mpr-empty">
                    <div className="mpr-empty__t">Loading payment requests…</div>
                  </div>
                ) : list.length === 0 ? (
                  <div className="mpr-empty">
                    <div className="mpr-empty__t">No payment requests yet</div>
                    <div className="mpr-empty__s">
                      {standalone
                        ? 'This is a standalone invoice with no purchase order, so payment requests cannot be raised on it.'
                        : 'Requests raised against this invoice will appear here with their approval decision and every payment released against them.'}
                    </div>
                  </div>
                ) : (
                  <div className="mpr-table">
                    <div className="mpr-row mpr-row--head">
                      {['Sr No', 'Payment Request ID', 'Payment Type', 'Payment %', 'Requested Payment Amount',
                        'Requested To', 'Request Approval Status', 'Approved Amount', 'Paid Amount', 'Action']
                        .map(h => <span className="mpr-c" key={h}>{h}</span>)}
                    </div>
                    {list.map((q, i) => {
                      const st = STATUS[q.status];
                      const due = q.approved - q.paid;
                      const settled = q.status === 'approved' && q.approved > 0 && due <= 0;
                      return (
                        <div className="mpr-row" key={q.rid}>
                          <span className="mpr-c mpr-sr" data-l="Sr No">{i + 1}</span>
                          <span className="mpr-c" data-l="Payment Request ID">
                            <span className="mpr-idcell">
                              <span className="mpr-idpill">{q.id}</span>
                              <span className="mpr-iddate">{q.date ? shortDate(q.date) : '—'}</span>
                            </span>
                          </span>
                          <span className="mpr-c" data-l="Payment Type"><span className="mpr-type">{q.type}</span></span>
                          <span className="mpr-c" data-l="Payment %"><span className="mpr-pct">{q.pct}%</span></span>
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
                              {q.status === 'approved' && (
                                <span className="mpr-substat">{due > 0 ? 'Payment pending' : 'Released'}</span>
                              )}
                            </span>
                          </span>
                          <span className="mpr-c" data-l="Approved Amount">
                            {q.status === 'approved'
                              ? <b className="mpr-amt">{money(q.approved)}</b>
                              : <b className="mpr-amt mpr-amt--none">&mdash;</b>}
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
                                <span className="mpr-paid" title={`Released in full against ${q.id}`}>
                                  {ICON_CHECK}Paid
                                </span>
                              ) : (
                                <button
                                  type="button"
                                  className="mpr-paybtn"
                                  disabled={q.status !== 'approved'}
                                  onClick={() => setPayForId(q.rid)}
                                  title={
                                    q.status === 'pending' ? 'Awaiting approval — payment opens once this request is approved'
                                      : q.status === 'declined' ? 'This request was declined — nothing to pay against it'
                                        : `Release ${money(due)} against ${q.id}`
                                  }
                                >
                                  {ICON_RUPEE}<span>Make SPI Payment</span>
                                </button>
                              )}
                              <button
                                type="button"
                                className="mpr-viewbtn"
                                title={`View Payment History — ${q.id}`}
                                aria-label={`View payment history for ${q.id}`}
                                onClick={() => setPayForId(q.rid)}
                              >
                                {ICON_EYE}
                              </button>
                            </span>
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        <div className="spi-mdl-foot">
          {readyToPay > 0 && (
            <div className="mpr-recap">
              <span className="mpr-recap__lbl">Ready To Pay</span>
              <b className="mpr-recap__val">{money(readyToPay)}</b>
              <span className="mpr-recap__sep" />
              <span className="mpr-recap__type">
                across {approvedCount} request{approvedCount === 1 ? '' : 's'}
              </span>
            </div>
          )}
          <div className="spi-mdl-foot-btns">
            <button type="button" className="spi-mdl-cancel" onClick={onClose}>Close</button>
            <button
              type="button"
              className="spi-mdl-confirm mpr-raise"
              disabled={!!whyNoRequest}
              title={whyNoRequest ?? `Raise a payment request for up to ${money(available)} on this SPI`}
              onClick={openRaise}
            >
              Raise New Request
            </button>
          </div>
        </div>
      </div>

      {payFor && spiId && po && (
        <Suspense fallback={null}>
          <InvoicePaymentModal
            row={row}
            request={payFor}
            spiId={spiId}
            poId={po.id}
            figures={figures}
            onChanged={load}
            onOpenTds={po.tds_applies ? () => setTdsOpen(true) : undefined}
            tdsSaved={po.tds_saved}
            onClose={() => setPayForId(null)}
          />
        </Suspense>
      )}
      {raising && (
        <Suspense fallback={null}>
          <InvoiceRaiseRequestModal
            row={row}
            figures={figures}
            totals={totals}
            onSubmit={raise}
            onClose={() => setRaising(false)}
          />
        </Suspense>
      )}
      {tdsOpen && po && (
        <Suspense fallback={null}>
          <DeductTdsModal
            po={po.code}
            docLabel="PO"
            base={po.base_amount}
            gst={po.gst_amount}
            extra={po.extra_charges}
            total={po.grand_total}
            room={Math.max(0, po.balance)}
            saved={po.tds_amount}
            firstSave={!po.tds_saved}
            readOnly={po.tds_locked}
            busy={tdsBusy}
            onSave={amount => { void saveTds(amount); }}
            onClose={() => setTdsOpen(false)}
          />
        </Suspense>
      )}
    </div>,
    document.body,
  );
}
