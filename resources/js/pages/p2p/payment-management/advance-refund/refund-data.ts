// Advance Receipt Refund Adjustment — types, option lists and the figures every
// screen derives from a refund. Rows are raised against the Order module's
// purchase orders (static sample data until the API is connected).
import type { BadgeVariant } from '../../../../components/ui/Badge';
import type { OrderRow } from '../../purchase-management/order/po-list/Order';
import { SAMPLE_ROWS } from './refund-sample-orders';

export type RefundRecovery = {
  amount: number;
  date: string;
  /** Cheque / UTR number the refund came in on. */
  reference?: string;
  /** File name of the proof of payment. */
  file?: string;
};

export type RefundAdjustment = {
  no: string;
  date: string;
  po: string;
  supplierRef: string;
  /** File name of the supplier's refund reference document, if attached. */
  attachment?: string;
  type: string;
  reason: string;
  /** Amount the supplier owes back. Whatever is paid above it stays with them. */
  amount: number;
  retainedType: string;
  retainedRemark: string;
  recoveries: RefundRecovery[];
};

export const REFUND_TYPES = [
  'Purchase Order Cancellation', 'Full Refund', 'Partial Refund', 'Rate Difference',
  'Quantity Difference', 'Quality Rejection', 'GST Adjustment', 'Short Supply', 'Other',
];

export const RETAIN_REASONS = [
  'Cancellation Charges', 'Restocking Fee', 'Freight / Logistics Already Incurred',
  'Bank & Remittance Charges', 'Non-Recoverable GST', 'Customs / Duty Already Paid',
  'Work Already Completed', 'Contractual Retention', 'Other',
];

export const TYPE_VARIANT: Record<string, BadgeVariant> = {
  'Purchase Order Cancellation': 'danger',
  'Rate Difference': 'warning',
  'Quantity Difference': 'info',
  'Quality Rejection': 'dark',
  'Short Supply': 'primary',
  'GST Adjustment': 'success',
};

/** The one long label is shortened on screen; the full wording stays in the tooltip. */
export const typeLabel = (t: string) => (t === 'Purchase Order Cancellation' ? 'PO Cancellation' : t);

export const isCancellation = (r: RefundAdjustment) => r.type === 'Purchase Order Cancellation';

/** Only orders with money released against them can carry a refund. */
export const REFUNDABLE_POS: OrderRow[] = SAMPLE_ROWS.filter((r) => r.paid > 0);

export const findPo = (po: string) => SAMPLE_ROWS.find((r) => r.po === po);

export type RefundFigures = {
  paid: number; toRefund: number; notRefunded: number;
  recovered: number; pending: number; pct: number;
  status: 'full' | 'partial' | 'pending';
};

export function refundFigures(r: RefundAdjustment): RefundFigures {
  const paid = findPo(r.po)?.paid ?? 0;
  const recovered = r.recoveries.reduce((s, x) => s + x.amount, 0);
  const pending = Math.max(0, r.amount - recovered);
  const pct = r.amount > 0 ? Math.min(100, Math.round((recovered / r.amount) * 100)) : 0;
  return {
    paid,
    toRefund: r.amount,
    notRefunded: Math.max(0, paid - r.amount),
    recovered,
    pending,
    pct,
    status: pending === 0 ? 'full' : recovered > 0 ? 'partial' : 'pending',
  };
}

export const nextRefundNo = (list: RefundAdjustment[]) =>
  `ADR/2025-26/${String(list.length + 1).padStart(3, '0')}`;

/** Today in the user's local timezone (toISOString would give the UTC date). */
export const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const SEED_REFUNDS: RefundAdjustment[] = [
  {
    no: 'ADR/2025-26/001', date: '2026-06-28', po: 'PO/2025-26/005', supplierRef: 'CN-7781',
    type: 'Purchase Order Cancellation', reason: 'PO cancelled — recovery of amount already paid',
    amount: 60000, retainedType: 'Cancellation Charges', retainedRemark: 'Supplier cancellation fee as per contract',
    recoveries: [{ amount: 30000, date: '2026-07-06', reference: 'UTR884120', file: 'Refund_Advice_ADR_001.pdf' }],
  },
  {
    no: 'ADR/2025-26/002', date: '2026-06-15', po: 'PO/2025-26/020', supplierRef: '',
    type: 'Purchase Order Cancellation', reason: 'Supplier pricing revised beyond approved limit',
    amount: 263600, retainedType: '', retainedRemark: '',
    recoveries: [
      { amount: 150000, date: '2026-06-22', reference: 'UTR771034', file: 'Bank_Advice_771034.pdf' },
      { amount: 113600, date: '2026-07-01', reference: 'CHQ004512' },
    ],
  },
  {
    no: 'ADR/2025-26/003', date: '2026-05-02', po: 'PO/2025-26/054', supplierRef: 'SUP-RF-19',
    type: 'Rate Difference', reason: 'Rate billed above the agreed purchase order rate',
    amount: 8400, retainedType: 'Work Already Completed', retainedRemark: 'Goods delivered — only the rate excess comes back',
    recoveries: [],
  },
];
