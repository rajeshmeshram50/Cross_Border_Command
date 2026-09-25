/* Payment Request Management list data: the API rows (GET /p2p/orders/payment-requests)
   mapped into the shape the page renders. Requests are raised on POs; SPI requests come later. */
import { poPaymentApi, type PayRequestListMeta, type PayRequestListRow, type PayRequestTab } from '../../purchase-management/order/api/po-api';
import { categoryKeyOf } from '../../purchase-management/order/po-list/Order';
import { ccySymbol } from '../../../../utils/currency';

export type RequestStatus = 'awaiting' | 'approved' | 'declined';
export type PaymentType = string;
export type SupplierTag = 'star' | 'regular' | 'high' | 'blacklisted';
export type RaisedAgainstKind = 'po' | 'spi' | 'po-spi';
export type RequestFlag = 'physical-inspection' | 'direct-spi' | null;

export type PartyRef = { code: string; name: string; role?: string };

/** Recorded on a declined request; the popup is read-only. */
export type DeclineRecord = { on: string; by: PartyRef; reason: string };

export type DocRef = {
  /** Document number as printed on the chip, e.g. PO/2025-26/023. */
  id: string;
  date: string;
};

export type PaymentRequestRow = {
  /** Database ids: the request, its PO and the PO's supplier. */
  id: number;
  poId: number;
  vendorId: number | null;
  requestId: string;
  requestDate: string;
  status: RequestStatus;
  /** What the request was raised on: a PO, an SPI, or an SPI mapped to a PO. */
  raisedAgainst: RaisedAgainstKind;
  po: DocRef | null;
  spi: DocRef | null;
  flag: RequestFlag;
  shipment: DocRef | null;
  opportunity: DocRef | null;
  procurement: DocRef | null;
  supplier: string;
  supplierCode: string | null;
  supplierTag: SupplierTag;
  totalAmount: number;
  requestedAmount: number;
  /** The PO's currency: every amount on this request prints in it. */
  currency: string;
  /** An import — no GST applies to it, and the GST checks are not run. */
  international: boolean;
  /** Null until the request is decided. */
  approvedAmount: number | null;
  /** Free line under the approved amount: "released in full", "₹20,700 due". */
  approvedNote: string | null;
  paymentType: PaymentType;
  requestedBy: PartyRef;
  requestedTo: PartyRef;
  /** Share of the PO/SPI value this request asks for. */
  percentOfTotal: number;
  /** Set only when status is 'declined'. */
  decline: DeclineRecord | null;
  /** Remark recorded with an approve / decline decision. */
  decision?: { on: string; by: PartyRef; note: string; files: string[] };
  /** Only the person the request was sent to may decide it, and only while it waits. */
  canDecide: boolean;
};

export const STATUS_LABEL: Record<RequestStatus, string> = {
  awaiting: 'Awaiting Approval',
  approved: 'Approved',
  declined: 'Declined',
};

export const SUPPLIER_TAG_LABEL: Record<SupplierTag, string> = {
  star: 'Star Supplier',
  regular: 'Regular Supplier',
  high: 'High Risk Supplier',
  blacklisted: 'Blacklisted',
};

const STATUS_OF = { pending: 'awaiting', approved: 'approved', rejected: 'declined' } as const;

const initials = (name: string | null) =>
  (name ?? '').split(/\s+/).filter(Boolean).map((s) => s[0]).join('').slice(0, 2).toUpperCase() || '?';
const party = (p: { name: string | null; role: string | null }): PartyRef =>
  ({ code: initials(p.name), name: p.name ?? '—', role: p.role ?? undefined });
const inr = (n: number, ccy = 'INR') => `${ccySymbol(ccy)}${n.toLocaleString('en-IN')}`;

/** One API row → the row the page renders. */
export function toRequestRow(r: PayRequestListRow): PaymentRequestRow {
  const status = STATUS_OF[r.status];
  const by = party(r.requested_to);
  const note = status === 'awaiting' ? null
    : status === 'declined' ? 'declined'
      : (r.due ?? 0) > 0 ? `${inr(r.due ?? 0, r.currency_code)} due` : 'released in full';
  return {
    id: r.id, poId: r.purchase_order_id, vendorId: r.vendor_id,
    requestId: r.code, requestDate: r.requested_at ?? '', status,
    raisedAgainst: 'po',
    po: { id: r.po_code, date: r.po_date ?? '' }, spi: null,
    flag: r.physical_inspection === 'yes' && r.inspection_status !== 'completed' ? 'physical-inspection' : null,
    shipment: r.shipment_code ? { id: r.shipment_code, date: r.shipment_date ?? '' } : null,
    opportunity: r.opportunity_code ? { id: r.opportunity_code, date: r.opportunity_date ?? '' } : null,
    procurement: r.procurement_code ? { id: r.procurement_code, date: '' } : null,
    supplier: r.supplier_name ?? '—', supplierCode: r.supplier_code,
    supplierTag: categoryKeyOf(r.supplier_category) ?? 'regular',
    totalAmount: r.po_total, requestedAmount: r.requested_amount,
    currency: r.currency_code || 'INR',
    international: r.document_type === 'international',
    approvedAmount: r.status === 'approved' ? r.approved_amount : null,
    approvedNote: note,
    paymentType: r.payment_type,
    requestedBy: party(r.requested_by), requestedTo: by,
    percentOfTotal: r.percentage ?? (r.po_total > 0 ? Math.round((r.requested_amount / r.po_total) * 1000) / 10 : 0),
    decline: status === 'declined' ? { on: r.decided_at ?? '', by, reason: r.decision_note ?? '' } : null,
    decision: status !== 'awaiting' && r.decided_at
      ? { on: r.decided_at, by, note: r.decision_note ?? '', files: [] } : undefined,
    canDecide: r.can_decide,
  };
}

/** One page of requests for a tab, with every tab's count (server-paged, 10 by default). */
export async function fetchPaymentRequests(q: { tab?: PayRequestTab; search?: string; page?: number; per_page?: number } = {}):
  Promise<{ rows: PaymentRequestRow[]; meta: PayRequestListMeta }> {
  const { rows, meta } = await poPaymentApi.list(q);
  return { rows: rows.map(toRequestRow), meta };
}

export type Decision =
  | { kind: 'approve'; amount: number; note: string; files: string[]; by: PartyRef }
  | { kind: 'decline'; reason: string; files: string[]; by: PartyRef };

/** Approve (full or part) or decline; only a request still awaiting approval can be decided. */
export async function decidePaymentRequest(id: number, d: Decision): Promise<PaymentRequestRow> {
  const res = await poPaymentApi.decide(id, d.kind === 'approve'
    ? { decision: 'approved', approved_amount: d.amount, note: d.note || undefined }
    : { decision: 'rejected', note: d.reason });
  return toRequestRow(res.request);
}
