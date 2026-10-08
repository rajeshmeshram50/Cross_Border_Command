import { memo } from 'react';
import Tooltip from '../../../../../components/ui/Tooltip';
import { formatINR } from './MoneyCell';
import { invoiceBalance, invoicePaidPercent, type InvoiceRow } from '../types';
import type { InvoiceAction } from './RowActions';

/**
 * Payment progress, built on the Order module's classes.
 *
 * `.ord-paycell`, `.ord-progress`, `.ord-pill`, `.ord-paynote` — the PO list's
 * Payment Progress column is the same column showing the same thing, so this
 * renders the same markup rather than a second set of rules that looks almost
 * identical and then drifts. Nothing in invoice.css styles this cell.
 */

/**
 * How far through payment an invoice is.
 *
 * The three values are the Order module's own state names, so they drop
 * straight into `is-${state}` and `ord-pill--${state}` with no lookup table in
 * between. 'pending', not 'none' — matching PO is the whole point.
 */
type PayState = 'full' | 'partial' | 'pending';

const PAY_LABEL: Record<PayState, string> = {
  full: 'Fully Paid',
  partial: 'Partially Paid',
  pending: 'Payment Not Initiated',
};

/**
 * Derived from the money, never stored.
 *
 * Note it keys off `totalPaid` against `netPayable` rather than off the
 * percentage: at 99.6% paid the rounded percentage reads 100 while a rupee is
 * still outstanding, and an invoice that says "Fully Paid" with a balance due
 * is the kind of bug nobody notices until reconciliation.
 */
function payState(row: InvoiceRow): PayState {
  if (row.totalPaid <= 0) return 'pending';
  return row.totalPaid >= row.netPayable ? 'full' : 'partial';
}

const HistoryIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><polyline points="3 3 3 8 8 8" />
    <polyline points="12 7.5 12 12 15 13.6" />
  </svg>
);

const EyeIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" />
  </svg>
);

const TickIcon = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

/**
 * The button changes identity, not just its label, once the invoice is settled:
 * with a zero balance there is nothing left to manage — no request can be
 * raised and none released — so it becomes "View Request Details" on the
 * `.is-record` variant the Order module already ships. It stays live, because
 * the record is still worth opening.
 */
function PaymentProgressCellBase({
  row, onAction,
}: {
  row: InvoiceRow;
  /* The same (action, row) handler every other cell takes. A narrower prop
     would force the table to wrap it in an inline arrow, which is a new value
     on every render and defeats the memo on this component. */
  onAction: (action: InvoiceAction, row: InvoiceRow) => void;
}) {
  const state = payState(row);
  const pct = Math.min(100, invoicePaidPercent(row));
  const balance = invoiceBalance(row);
  const settled = state === 'full';
  const readyAmount = row.approvedForPayment;

  return (
    <div className="ord-paycell">
      <div className={`ord-progress is-${state}`}>
        <div className="ord-progress__top">
          <span className={`ord-pill ord-pill--${state}`}>
            <span className="ord-pill__dot" />{PAY_LABEL[state]}
          </span>
          <span className="ord-progress__pct">{pct}%</span>
        </div>

        {/* role=progressbar so the bar is not just a coloured div to a screen
            reader. The visible percentage and the announced one come from the
            same number, so they cannot disagree. */}
        <div
          className="ord-progress__bar"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${PAY_LABEL[state]}, ${pct} percent`}
        >
          <div className="ord-progress__fill" style={{ width: `${pct}%` }}>
            <span className="ord-progress__sheen" />
          </div>
        </div>

        <div className="ord-progress__meta">
          <span className="ord-progress__paid">
            <span className="ord-progress__mdot" />{formatINR(row.totalPaid)} paid
          </span>
          <span className="ord-progress__due">
            <span className="ord-progress__mdot" />{formatINR(balance)} due
          </span>
        </div>

        {/* Money cleared by an approver and waiting to be released. Without this
            line the only clue that payment is unblocked is inside a modal. */}
        {readyAmount != null && readyAmount > 0 && (
          <span
            className="ord-paynote ord-paynote--ready"
            title={`${formatINR(readyAmount)} approved · ready to pay`}
          >
            <TickIcon />{formatINR(readyAmount)} approved · ready to pay
          </span>
        )}
      </div>

      <Tooltip label={settled
        ? 'The full invoice value has been paid — open the record of its requests'
        : `Manage the payment requests raised against ${row.invoiceNo}`}>
        <button
          type="button"
          className={`ord-btn ord-btn--hist${settled ? ' is-record' : ''}`}
          onClick={() => onAction('payment-requests', row)}
        >
          {settled ? <EyeIcon /> : <HistoryIcon />}
          <span>{settled ? 'View Request Details' : 'Manage Payment Requests'}</span>
          {row.pendingPaymentRequests > 0 && (
            <i className="ord-btn__count">{row.pendingPaymentRequests}</i>
          )}
        </button>
      </Tooltip>
    </div>
  );
}

export const PaymentProgressCell = memo(PaymentProgressCellBase);
