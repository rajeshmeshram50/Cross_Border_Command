/* Static list data for Payment Request Management.
   Shaped exactly like the API response will be, so swapping `fetchPaymentRequests`
   for the real GET is the only change the page needs. */

export type RequestStatus = 'awaiting' | 'approved' | 'declined';
export type PaymentType = 'Advance Payment' | 'Partial Payment' | 'Balance Payment' | 'Full Payment';
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
  requestId: string;
  requestDate: string;
  status: RequestStatus;
  /** What the request was raised on: a PO, an SPI, or an SPI mapped to a PO. */
  raisedAgainst: RaisedAgainstKind;
  po: DocRef | null;
  spi: DocRef | null;
  flag: RequestFlag;
  shipment: DocRef | null;
  opportunity: DocRef;
  procurement: DocRef;
  supplier: string;
  supplierTag: SupplierTag;
  totalAmount: number;
  requestedAmount: number;
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
  /** Remark and files recorded with an approve / decline decision. */
  decision?: { on: string; by: PartyRef; note: string; files: string[] };
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

const ROWS: PaymentRequestRow[] = [
  {
    requestId: 'PRQ-001', requestDate: '2026-07-20', status: 'awaiting',
    raisedAgainst: 'po',
    po: { id: 'PO/2025-26/023', date: '2026-06-16' }, spi: null, flag: 'physical-inspection',
    shipment: { id: 'SHP-049', date: '2026-06-04' },
    opportunity: { id: 'OPP-030', date: '2026-05-07' },
    procurement: { id: 'PROC-040', date: '2026-05-22' },
    supplier: 'Bosch India', supplierTag: 'regular',
    totalAmount: 103000, requestedAmount: 27500, approvedAmount: null, approvedNote: null,
    paymentType: 'Balance Payment',
    requestedBy: { code: 'RH', name: 'Rajesh Healthcare' },
    requestedTo: { code: 'RM', name: 'Rajiv Menon' },
    percentOfTotal: 26.7, decline: null,
  },
  {
    requestId: 'PRQ-002', requestDate: '2026-06-25', status: 'approved',
    raisedAgainst: 'po',
    po: { id: 'PO/2025-26/023', date: '2026-06-16' }, spi: null, flag: 'physical-inspection',
    shipment: { id: 'SHP-049', date: '2026-06-04' },
    opportunity: { id: 'OPP-030', date: '2026-05-07' },
    procurement: { id: 'PROC-040', date: '2026-05-22' },
    supplier: 'Bosch India', supplierTag: 'regular',
    totalAmount: 103000, requestedAmount: 24700, approvedAmount: 24700, approvedNote: 'released in full',
    paymentType: 'Partial Payment',
    requestedBy: { code: 'RH', name: 'Rajesh Healthcare' },
    requestedTo: { code: 'SR', name: 'Sunita Rao' },
    percentOfTotal: 24, decline: null,
  },
  {
    requestId: 'PRQ-003', requestDate: '2026-07-05', status: 'declined',
    raisedAgainst: 'po-spi',
    po: { id: 'PO/2025-26/029', date: '2026-06-13' },
    spi: { id: 'SPI/2025-26/029', date: '2026-06-01' },
    flag: 'physical-inspection',
    shipment: null,
    opportunity: { id: 'OPP-038', date: '2026-05-04' },
    procurement: { id: 'PROC-050', date: '2026-05-19' },
    supplier: 'Bosch India', supplierTag: 'regular',
    totalAmount: 58750, requestedAmount: 20200, approvedAmount: null, approvedNote: 'declined',
    paymentType: 'Balance Payment',
    requestedBy: { code: 'RH', name: 'Rajesh Healthcare' },
    requestedTo: { code: 'SR', name: 'Sunita Rao' },
    percentOfTotal: 34.4,
    decline: {
      on: '2026-07-09',
      by: { code: 'SR', name: 'Sunita Rao', role: 'Finance Controller' },
      reason: 'Declined — raise again after inspection closure.',
    },
  },
  {
    requestId: 'PRQ-004', requestDate: '2026-07-02', status: 'awaiting',
    raisedAgainst: 'po',
    po: { id: 'PO/2025-26/013', date: '2026-05-29' }, spi: null, flag: null,
    shipment: null,
    opportunity: { id: 'OPP-018', date: '2026-04-19' },
    procurement: { id: 'PROC-024', date: '2026-05-04' },
    supplier: 'Reliance Industries', supplierTag: 'star',
    totalAmount: 276000, requestedAmount: 31800, approvedAmount: null, approvedNote: null,
    paymentType: 'Partial Payment',
    requestedBy: { code: 'RH', name: 'Rajesh Healthcare' },
    requestedTo: { code: 'SR', name: 'Sunita Rao' },
    percentOfTotal: 11.5, decline: null,
  },
  {
    requestId: 'PRQ-005', requestDate: '2026-06-15', status: 'approved',
    raisedAgainst: 'spi',
    po: null, spi: { id: 'SPI/2025-26/059', date: '2026-06-03' }, flag: 'direct-spi',
    shipment: { id: 'SHP-109', date: '2026-05-25' },
    opportunity: { id: 'OPP-109', date: '2026-04-25' },
    procurement: { id: 'PROC-109', date: '2026-05-02' },
    supplier: 'QuickShip Couriers', supplierTag: 'regular',
    totalAmount: 37000, requestedAmount: 20700, approvedAmount: 20700, approvedNote: '₹20,700 due',
    paymentType: 'Balance Payment',
    requestedBy: { code: 'RH', name: 'Rajesh Healthcare' },
    requestedTo: { code: 'SR', name: 'Sunita Rao' },
    percentOfTotal: 55.9, decline: null,
  },
  {
    requestId: 'PRQ-006', requestDate: '2026-07-11', status: 'awaiting',
    raisedAgainst: 'po',
    po: { id: 'PO/2025-26/071', date: '2026-06-21' }, spi: null, flag: null,
    shipment: null,
    opportunity: { id: 'OPP-082', date: '2026-05-16' },
    procurement: { id: 'PROC-099', date: '2026-05-30' },
    supplier: 'Godrej Industries', supplierTag: 'star',
    totalAmount: 412000, requestedAmount: 96500, approvedAmount: null, approvedNote: null,
    paymentType: 'Advance Payment',
    requestedBy: { code: 'RH', name: 'Rajesh Healthcare' },
    requestedTo: { code: 'RM', name: 'Rajiv Menon' },
    percentOfTotal: 23.4, decline: null,
  },
  {
    requestId: 'PRQ-007', requestDate: '2026-06-30', status: 'approved',
    raisedAgainst: 'po-spi',
    po: { id: 'PO/2025-26/044', date: '2026-06-02' },
    spi: { id: 'SPI/2025-26/044', date: '2026-06-18' },
    flag: null,
    shipment: { id: 'SHP-061', date: '2026-06-09' },
    opportunity: { id: 'OPP-044', date: '2026-04-30' },
    procurement: { id: 'PROC-066', date: '2026-05-12' },
    supplier: 'Tata Chemicals', supplierTag: 'regular',
    totalAmount: 189400, requestedAmount: 75000, approvedAmount: 50000, approvedNote: '₹25,000 held back',
    paymentType: 'Partial Payment',
    requestedBy: { code: 'RH', name: 'Rajesh Healthcare' },
    requestedTo: { code: 'SR', name: 'Sunita Rao' },
    percentOfTotal: 39.6, decline: null,
  },
  {
    requestId: 'PRQ-008', requestDate: '2026-07-14', status: 'declined',
    raisedAgainst: 'spi',
    po: null, spi: { id: 'SPI/2025-26/077', date: '2026-06-27' }, flag: 'direct-spi',
    shipment: null,
    opportunity: { id: 'OPP-091', date: '2026-05-21' },
    procurement: { id: 'PROC-118', date: '2026-06-01' },
    supplier: 'Sunrise Packaging and Industrial Materials Manufacturing Company (India) Private Limited — Unit II, Export Division, Bhiwandi Logistics Park, Maharashtra, registered supplier for corrugated and flexible packaging materials', supplierTag: 'high',
    totalAmount: 64300, requestedAmount: 64300, approvedAmount: null, approvedNote: 'declined',
    paymentType: 'Full Payment',
    requestedBy: { code: 'RH', name: 'Rajesh Healthcare' },
    requestedTo: { code: 'RM', name: 'Rajiv Menon' },
    percentOfTotal: 100,
    decline: {
      on: '2026-07-18',
      by: { code: 'RM', name: 'Rajiv Menon', role: 'Head of Procurement' },
      reason: 'Declined — the supplier is under an open risk review after the last two consignments failed incoming quality checks, the revised bank mandate has not been verified by finance, and the purchase order still carries an unresolved physical inspection. Raise the request again once the risk case is closed and the inspection report is attached.',
    },
  },
];

/** Stands in for `GET /p2p/payment-requests` until the API lands. */
export async function fetchPaymentRequests(): Promise<PaymentRequestRow[]> {
  return ROWS.map(r => ({ ...r }));
}

export type Decision =
  | { kind: 'approve'; amount: number; note: string; files: string[]; by: PartyRef }
  | { kind: 'decline'; reason: string; files: string[]; by: PartyRef };

/** Stands in for `POST /p2p/payment-requests/{id}/approve|decline`. Only a
    request still awaiting approval can be decided. */
export async function decidePaymentRequest(requestId: string, d: Decision): Promise<PaymentRequestRow> {
  const row = ROWS.find(r => r.requestId === requestId);
  if (!row) throw new Error('This request is no longer available.');
  if (row.status !== 'awaiting') throw new Error(`${requestId} has already been ${row.status}.`);
  const on = new Date().toISOString().slice(0, 10);
  if (d.kind === 'approve') {
    row.status = 'approved';
    row.approvedAmount = d.amount;
    row.approvedNote = d.amount < row.requestedAmount
      ? `₹${(row.requestedAmount - d.amount).toLocaleString('en-IN')} held back`
      : `₹${d.amount.toLocaleString('en-IN')} due`;
    row.decision = { on, by: d.by, note: d.note, files: d.files };
  } else {
    row.status = 'declined';
    row.approvedAmount = null;
    row.approvedNote = 'declined';
    row.decline = { on, by: d.by, reason: d.reason };
    row.decision = { on, by: d.by, note: d.reason, files: d.files };
  }
  return { ...row };
}
