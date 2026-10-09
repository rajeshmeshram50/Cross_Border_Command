import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useScrollLock } from '../../../../hooks/useScrollLock';
import {
  Box, Chip, Stat, STAT_ICONS, ICON_X, money, initials, shortDate,
} from '../order/manage-payment/payment-shared';
import { invoiceBalance, invoicePaidPercent, type InvoiceRow } from './types';

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
      status: 'approved', approved, paid: Math.min(row.totalPaid, approved),
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
  approved: { cls: 'is-approved', label: 'Approved' },
  pending: { cls: 'is-pending', label: 'Awaiting Approval' },
  declined: { cls: 'is-declined', label: 'Declined' },
} as const;

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

  const cardRef = useRef<HTMLDivElement>(null);
  useEffect(() => { cardRef.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const list = requestsFor(row);
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
          <div className="mpr-hero__chips">
            <Chip label="Supplier" value={row.supplierName} mod="mpr-hero__chip--sup" />
            <Chip label="PO Number" value={row.poNo || 'NA'} meta={row.poDate ? shortDate(row.poDate) : undefined} />
            <Chip label="SPI Number" value={row.invoiceNo} meta={shortDate(row.invoiceDate)} />
            <Chip label="Shipment ID" value={row.shipmentId || 'NA'} meta={row.shipmentDate ? shortDate(row.shipmentDate) : undefined} />
            <Chip label="Opportunity ID" value={row.opportunityId} meta={shortDate(row.opportunityDate)} />
            <Chip label="Procurement ID" value={row.procurementId} meta={shortDate(row.procurementDate)} />
          </div>

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
                  className="mpr-tdsbtn"
                  title="Withhold tax at source against this invoice"
                >
                  <span className="mpr-tdsbtn__ico">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                      <line x1="19" y1="5" x2="5" y2="19" /><circle cx="6.5" cy="6.5" r="2.5" /><circle cx="17.5" cy="17.5" r="2.5" />
                    </svg>
                  </span>
                  <span>Deduct TDS Here</span>
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
                        {/* Releasing is the next screen; this one only lists. */}
                        {q.status === 'approved' && due > 0 && (
                          <button type="button" className="mpr-paybtn">Make SPI Payment</button>
                        )}
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
            <button type="button" className="spi-mdl-confirm mpr-raise">Raise New Request</button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
