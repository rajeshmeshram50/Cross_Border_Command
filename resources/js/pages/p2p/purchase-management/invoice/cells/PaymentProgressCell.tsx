import { memo } from 'react';
import Tooltip from '../../../../../components/ui/Tooltip';
import { formatINR } from './MoneyCell';
import { invoiceBalance, invoicePaidPercent, invoiceSettled, type InvoiceRow } from '../types';
import type { InvoiceAction } from './RowActions';


type PayState = 'full' | 'partial' | 'pending';

const PAY_LABEL: Record<PayState, string> = {
  full: 'Fully Paid',
  partial: 'Partially Paid',
  pending: 'Payment Not Initiated',
};

function payState(row: InvoiceRow): PayState {
  if (row.totalPaid <= 0) return 'pending';
  return invoiceSettled(row) ? 'full' : 'partial';
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

function PaymentProgressCellBase({
  row, onAction,
}: {
  row: InvoiceRow;
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
