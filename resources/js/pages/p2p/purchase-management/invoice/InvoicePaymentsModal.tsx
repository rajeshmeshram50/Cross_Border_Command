import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useScrollLock } from '../../../../hooks/useScrollLock';
import {
  Box, Stat, STAT_ICONS, ICON_X, money, initials, shortDate,
} from '../order/manage-payment/payment-shared';
import { InvoiceHeroChips } from './payment-chips';
import { invoiceBalance, invoicePaidPercent, type InvoiceRow } from './types';

/* The purchase order's own TDS card, opened against this invoice. Lazy: it is
   a dialog most visits never open. */
const DeductTdsModal = lazy(() => import('../order/manage-payment/DeductTdsModal'));
/* The release screen for one request, opened by a row's eye. Lazy for the same
   reason: most visits only read this table. */
const InvoicePaymentModal = lazy(() => import('./InvoicePaymentModal'));
/* The raise form, opened by the footer button. Lazy for the same reason. */
const InvoiceRaiseRequestModal = lazy(() => import('./InvoiceRaiseRequestModal'));

/* No stylesheet of its own. The purchase order's payments screen is the same
   screen with a PO where this has an SPI, so it wears that screen's markup and
   its stylesheet rather than a second copy of 1,468 rules. */
import '../../p2p-detail.css';
import '../order/manage-payment/manage-payment-requests.css';

/** One request raised against this invoice. */
export interface InvoicePaymentRequest {
  id: string;
  date: string;
  type: string;
  /** Share of the net payable this request asks for. */
  pct: number;
  amount: number;
  approver: string;
  role: string;
  status: 'approved' | 'pending' | 'declined';
  approved: number;
  paid: number;
}

/**
 * Stand-in requests for a row, until the endpoint exists.
 *
 * Derived from the row rather than hard-coded, so the figures on this screen
 * add up to the ones the list is already showing — a summary that disagrees
 * with the row it opened from is worse than no summary.
 */
function requestsFor(row: InvoiceRow): InvoicePaymentRequest[] {
  if (row.pendingPaymentRequests === 0 && !row.approvedForPayment) return [];
  const net = row.netPayable;
  const approved = row.approvedForPayment ?? 0;
  const out: InvoicePaymentRequest[] = [];
  if (approved > 0) {
    out.push({
      id: 'PRQ-001', date: row.invoiceDate, type: 'Advance Payment',
      pct: Math.round((approved / net) * 1000) / 10,
      amount: approved, approver: 'Sunita Rao', role: 'Finance Controller',
      /* Part-released, not settled. The invoice's own paid figure is 50% of
         net against an approved 35%, so capping at `approved` left every
         request fully released — which disabled Add New Payment on the
         release screen and left no headroom anywhere to demonstrate. */
      status: 'approved', approved, paid: Math.min(row.totalPaid, Math.round(approved / 2)),
    });
  }
  for (let i = out.length; i < row.pendingPaymentRequests; i++) {
    const amount = Math.round((net - approved) / Math.max(1, row.pendingPaymentRequests));
    out.push({
      id: `PRQ-${String(i + 1).padStart(3, '0')}`, date: row.invoiceDate,
      type: 'Part Payment', pct: Math.round((amount / net) * 1000) / 10,
      amount, approver: 'Sunita Rao', role: 'Finance Controller',
      status: 'pending', approved: 0, paid: 0,
    });
  }
  return out;
}

/** The rate the stand-in figures are built on, until the invoice carries one. */
const GST_PCT = 18;

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

/**
 * Payment Requests History — every request raised against one supplier invoice.
 *
 * Opened by the row's "Manage Payment Requests" button, which until now only
 * logged. It is the purchase order's own payments screen pointed at an SPI:
 * same hero, same summary blocks, same request table, same stylesheet.
 */
export default function InvoicePaymentsModal({ row, onClose }: {
  row: InvoiceRow; onClose: () => void;
}) {
  useScrollLock(true, '.mpr-card--history');

  /* The TDS withheld on this invoice, and whether its card is open. Held here
     because the summary above has to show the figure the card saves. */
  const [tds, setTds] = useState(0);
  const [tdsOpen, setTdsOpen] = useState(false);
  /* The request whose release screen is open — the request itself rather than a
     flag, because that screen is titled by it and reads its figures. */
  const [payFor, setPayFor] = useState<InvoicePaymentRequest | null>(null);
  const [raising, setRaising] = useState(false);
  /* State, not a value derived each render: a request raised here has to join
     the table it was raised from. */
  const [list, setList] = useState(() => requestsFor(row));

  const cardRef = useRef<HTMLDivElement>(null);
  useEffect(() => { cardRef.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const balance = invoiceBalance(row);
  /* Every total is summed from the same list the table prints, so the cards and
     the rows can never disagree. */
  const requested = list.reduce((n, q) => n + q.amount, 0);
  const approvedAmt = list.reduce((n, q) => n + q.approved, 0);
  const paid = list.reduce((n, q) => n + q.paid, 0);
  const pendingAmt = list.filter(q => q.status === 'pending').reduce((n, q) => n + q.amount, 0);
  const approvedCount = list.filter(q => q.status === 'approved').length;
  const pendingCount = list.filter(q => q.status === 'pending').length;
  const readyToPay = approvedAmt - paid;
  const pctPaid = invoicePaidPercent(row);
  /* What is still open to ask for: the net payable less everything already
     requested, approved or not — an open request has that money spoken for. */
  const available = Math.max(0, row.netPayable - requested);
  /* The grand total is base + GST + charges, so the base is derived from the
     total rather than guessed — gross minus net is the deduction, not the tax,
     which is what made the GST card read 570 against the design's 4,271. */
  const extra = 0;
  const base = Math.round((row.totalPoAmount - extra) / (1 + GST_PCT / 100));
  const gst = row.totalPoAmount - extra - base;

  return createPortal(
    <div className="spi-mdl-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
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

          {/* The same six references the purchase order screen carries, with
              the SPI where the PO had its own number. */}
          <InvoiceHeroChips row={row} />

          <button type="button" className="mpr-hero__close" onClick={onClose} aria-label="Close">{ICON_X}</button>
        </div>

        <div className="mpr-bd">
          <Box
            label="Summary" title="SPI Payment Details Summary"
            sub="How this SPI's value is made up and where it stands today · read-only"
            /* The strip the design puts in this header. Built from the
               purchase order's own `mpr-tds` markup rather than TdsStrip
               itself, which takes a PO and its currency. The dialog it opens
               is the next piece. */
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
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                      <line x1="19" y1="5" x2="5" y2="19" /><circle cx="6.5" cy="6.5" r="2.5" /><circle cx="17.5" cy="17.5" r="2.5" />
                    </svg>
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
                value={money(paid)} sub={`${pctPaid}% of net payable released`} />
              <Stat mod="mpr-stat--tds" icon={STAT_ICONS.wallet} label="Balance Amount"
                value={money(balance)} sub={balance === 0 ? 'Settled in full' : 'Open to request'} />
            </div>
          </Box>

          <div className="mpr-panel">
            <div className="mpr-panel__hd">
              <span className="mpr-panel__t">All Payment Requests</span>
              <span className="mpr-panel__c">{list.length}</span>
              <span className="mpr-panel__s">In the order they were raised</span>
            </div>

            {list.length === 0 ? (
              <div className="mpr-empty">
                <div className="mpr-empty__t">No payment requests yet</div>
                <div className="mpr-empty__s">
                  Requests raised against this invoice will appear here with their approval
                  decision and every payment released against them.
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
                  <div className="mpr-row" key={q.id}>
                    <span className="mpr-c mpr-sr" data-l="Sr No">{i + 1}</span>
                    <span className="mpr-c" data-l="Payment Request ID">
                      <span className="mpr-idcell">
                        <span className="mpr-idpill">{q.id}</span>
                        <span className="mpr-iddate">{shortDate(q.date)}</span>
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
                      {q.approved > 0
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
                        {/* Settled rows state the fact; the rest offer the
                            release, disabled until the request is approved —
                            disabled rather than hidden, so a row that cannot
                            be paid still says why on hover. */}
                        {settled ? (
                          <span className="mpr-paid" title={`Released in full against ${q.id}`}>
                            {ICON_CHECK}Paid
                          </span>
                        ) : (
                          <button
                            type="button"
                            className="mpr-paybtn"
                            disabled={q.status !== 'approved'}
                            /* The same screen the eye opens: paying against a
                               request and reading what has been paid against
                               it are the same page, arrived at two ways. */
                            onClick={() => setPayFor(q)}
                            title={
                              q.status === 'pending' ? 'Awaiting approval — payment opens once this request is approved'
                                : q.status === 'declined' ? 'This request was declined — nothing to pay against it'
                                  : `Release ${money(due)} against ${q.id}`
                            }
                          >
                            {ICON_RUPEE}<span>Make SPI Payment</span>
                          </button>
                        )}
                        {/* Always offered: the release history of a request is
                            worth reading whether or not anything is left to pay. */}
                        <button
                          type="button"
                          className="mpr-viewbtn"
                          title={`View Payment History — ${q.id}`}
                          aria-label={`View payment history for ${q.id}`}
                          onClick={() => setPayFor(q)}
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
              disabled={available <= 0}
              title={available > 0
                ? `Raise a payment request for up to ${money(available)} on this SPI`
                : 'Nothing left to request — the balance is already covered by open requests'}
              onClick={() => setRaising(true)}
            >
              Raise New Request
            </button>
          </div>
        </div>
      </div>
      {tdsOpen && (
        <Suspense fallback={null}>
          <DeductTdsModal
            po={row.invoiceNo}
            docLabel="SPI"
            base={base}
            gst={gst}
            extra={extra}
            total={row.totalPoAmount}
            /* What is still unreleased is the ceiling: tax cannot be withheld
               from money already paid out. */
            room={balance}
            saved={tds}
            firstSave={tds === 0}
            onSave={amount => { setTds(amount); setTdsOpen(false); }}
            onClose={() => setTdsOpen(false)}
          />
        </Suspense>
      )}
      {payFor && (
        <Suspense fallback={null}>
          <InvoicePaymentModal row={row} request={payFor} onClose={() => setPayFor(null)} />
        </Suspense>
      )}
      {raising && (
        <Suspense fallback={null}>
          <InvoiceRaiseRequestModal
            row={row}
            nextId={`PRQ-${String(list.length + 1).padStart(3, '0')}`}
            requested={requested}
            approvedTotal={approvedAmt}
            pendingAmt={pendingAmt}
            pendingCount={pendingCount}
            approvedUnpaid={readyToPay}
            requestCount={list.length}
            available={available}
            onSubmit={q => { setList(l => [...l, q]); setRaising(false); }}
            onClose={() => setRaising(false)}
          />
        </Suspense>
      )}
    </div>,
    document.body,
  );
}
