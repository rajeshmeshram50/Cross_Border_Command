// Advance Receipt Refund Adjustment — the screen shape of an API row, option lists
// and the figures every screen reads. All data comes from refundApi (po-api.ts).
import type { BadgeVariant } from '../../../../components/ui/Badge';
import type { RefundDetail, RefundPo, RefundRow, RefundStatus } from '../../purchase-management/order/api/po-api';

/** One proof stored on a recovered payment. `path` identifies it on a save. */
export type RecoveryProof = { path: string; name: string; url: string };

export type RefundRecovery = {
  id: number;
  amount: number;
  date: string;
  /** Cheque / UTR number the refund came in on. */
  reference?: string;
  file?: string;
  fileUrl?: string;
  /** Every proof attached to this recovery, first one first. */
  proofs: RecoveryProof[];
  zohoStatus: 'synced' | 'failed' | null;
  zohoError: string | null;
};

/** The purchase order a refund is raised against. */
export type RefundPoInfo = {
  id: number; po: string; poDate: string; poType: string | null; docType: string;
  expectedDelivery: string; transport: string; paymentType: string; physicalInspection: boolean;
  total: number; tds: number; net: number; paid: number; balance: number;
  shipment: string | null; shipmentDate: string; opportunity: string | null; opportunityDate: string; procurement: string | null;
  supplier: string; supplierCode: string; vendorId: number | null;
  cancelled: boolean; cancelReason: string; cancelStage: 'initiated' | 'closed' | null; zohoBill: string | null;
};

export type RefundAdjustment = {
  id: number;
  no: string;
  date: string;
  po: string;
  poInfo: RefundPoInfo | null;
  supplierRef: string;
  attachment?: string;
  attachmentUrl?: string;
  type: string;
  reason: string;
  paid: number;
  /** Amount the supplier owes back. Whatever is paid above it stays with them. */
  amount: number;
  retainedType: string;
  retainedRemark: string;
  recovered: number;
  balance: number;
  status: RefundStatus;
  recoveriesCount: number;
  recoveries: RefundRecovery[];
  zohoStatus: 'synced' | 'failed' | null;
  zohoError: string | null;
  zohoNumber: string | null;
  /** Recoveries not yet refunded in Zoho Books. */
  zohoPending: number;
  /** The vendor credit is in Zoho — the refund amount can no longer change. */
  amountsLocked: boolean;
  payments: NonNullable<RefundDetail['payments']>;
  documents: NonNullable<RefundDetail['documents']>;
};

/* The refund is either the whole amount paid or part of it; the reason it is
   raised is written in the adjustment reason, not picked from a list. */
export const REFUND_TYPES = ['Full Refund', 'Partial Refund'];

export const RETAIN_REASONS = [
  'Cancellation Charges', 'Restocking Fee', 'Freight / Logistics Already Incurred',
  'Bank & Remittance Charges', 'Non-Recoverable GST', 'Customs / Duty Already Paid',
  'Work Already Completed', 'Contractual Retention', 'Other',
];

export const TYPE_VARIANT: Record<string, BadgeVariant> = {
  'Full Refund': 'success',
  'Partial Refund': 'warning',
};

export const typeLabel = (t: string) => t;

/**
 * Money has started coming back, so the adjustment is closed to edits and only
 * opens to be read. The list, the row and the form all read it from here, and
 * the server refuses the save on the same rule (CS-588).
 */
export const isSettled = (r: RefundAdjustment) =>
  r.status === 'recovered' || r.recovered > 0 || r.recoveriesCount > 0;

const DOC_LABEL: Record<string, string> = { domestic: 'Domestic', international: 'International' };

export function toPoInfo(p: RefundPo): RefundPoInfo {
  return {
    id: p.id, po: p.code, poDate: p.po_date ?? '', poType: p.po_type, docType: DOC_LABEL[p.document_type ?? ''] ?? '—',
    expectedDelivery: p.expected_delivery_date ?? '', transport: p.mode_of_transport ?? '', paymentType: p.payment_type ?? '',
    physicalInspection: p.physical_inspection,
    total: p.grand_total, tds: p.tds_amount, net: p.net_payable, paid: p.paid_amount, balance: p.balance_amount,
    shipment: p.shipment_code, shipmentDate: p.shipment_date ?? '', opportunity: p.opportunity_code, opportunityDate: p.opportunity_date ?? '',
    procurement: p.procurement_code,
    supplier: p.supplier_name ?? '—', supplierCode: p.supplier_code ?? '—', vendorId: p.vendor_id,
    cancelled: p.status === 'cancelled', cancelReason: p.cancel_reason ?? '', cancelStage: p.cancel_stage, zohoBill: p.zoho_bill_number,
  };
}

export function toRefund(r: RefundRow | RefundDetail): RefundAdjustment {
  const d = r as RefundDetail;
  return {
    id: r.id, no: r.code, date: r.refund_date ?? '', po: r.po?.code ?? '—', poInfo: r.po ? toPoInfo(r.po) : null,
    supplierRef: r.supplier_ref_no ?? '', attachment: r.attachment_name ?? undefined, attachmentUrl: r.attachment_url ?? undefined,
    type: r.refund_type, reason: r.reason,
    paid: r.paid_amount, amount: r.refund_amount, retainedType: r.retained_type ?? '', retainedRemark: r.retained_remark ?? '',
    recovered: r.recovered_amount, balance: r.balance_amount, status: r.status, recoveriesCount: r.recoveries_count,
    recoveries: (d.recoveries ?? []).map((x) => ({
      id: x.id, amount: x.amount, date: x.recovered_date ?? '', reference: x.reference_no ?? undefined,
      file: x.proof_name ?? undefined, fileUrl: x.proof_url ?? undefined,
      // A row saved before several proofs were allowed only has the single one.
      proofs: (x.proofs ?? []).map((p) => ({ path: p.path, name: p.name, url: p.url })),
      zohoStatus: x.zoho_sync_status, zohoError: x.zoho_error,
    })),
    zohoStatus: r.zoho_sync_status, zohoError: r.zoho_error, zohoNumber: r.zoho_vendorcredit_number,
    zohoPending: r.zoho_pending_recoveries ?? 0,
    amountsLocked: r.amounts_locked,
    payments: d.payments ?? [], documents: d.documents ?? [],
  };
}

export type RefundFigures = {
  paid: number; toRefund: number; notRefunded: number;
  recovered: number; pending: number; pct: number;
  status: 'full' | 'partial' | 'pending';
};

/** The stored figures (rebuilt on the server on every recovery), in the shape the screens read. */
export function refundFigures(r: RefundAdjustment): RefundFigures {
  const pct = r.amount > 0 ? Math.min(100, Math.round((r.recovered / r.amount) * 100)) : 0;
  return {
    paid: r.paid,
    toRefund: r.amount,
    notRefunded: Math.max(0, r.paid - r.amount),
    recovered: r.recovered,
    pending: r.balance,
    pct,
    status: r.status === 'recovered' ? 'full' : r.status,
  };
}

/** Today in the user's local timezone (toISOString would give the UTC date). */
export const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
