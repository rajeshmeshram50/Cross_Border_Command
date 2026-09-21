/* Static data behind the payment request view: the supplier record, the
   document's payment ledger, the releases made against it and the purchase
   orders it sits on. Shaped like the API response will be, so replacing
   `fetchPaymentRequestDetail` with the real GET is the only change needed. */
import type { OrderRow } from '../../purchase-management/order/po-list/Order';
import type { Supplier } from './payment-request-suppliers';
import type { InspectionProduct } from '../../purchase-management/order/physical-inspection/inspection-shared';
import { INSPECTION_PRODUCTS } from './payment-request-products';
import { fetchPaymentRequests, type PaymentRequestRow } from './paymentRequestData';

export type PaymentRelease = {
  requestId: string;
  requestDate: string;
  /** The PO or SPI the request was raised against. */
  doc: string;
  docDate: string;
  amount: number;
  bank: string;
  mode: string;
  /** UTR for a transfer, instrument number for a cheque. */
  ref: string;
  date: string;
};

export type LinkedRequest = PaymentRequestRow & { paid: number };

export type TradeDoc = {
  code: string;
  name: string;
  generated: string;
  valid: string;
  status: 'signed' | 'sent' | 'pending';
  attachment: string;
};

export type PaymentRequestDetail = {
  row: PaymentRequestRow;
  supplier: Supplier;
  /** The document the request was raised against — the SPI when there is one. */
  doc: { id: string; date: string; kind: 'po' | 'spi' };
  /** The document's position today, across every request raised on it. */
  ledger: {
    total: number; net: number; paid: number; balance: number;
    approvedTotal: number; available: number; prevRequested: number;
  };
  /** Every request on the same document, the open one first. */
  linked: LinkedRequest[];
  payments: PaymentRelease[];
  /** The order behind the request; null for an SPI raised without a PO. */
  po: OrderRow | null;
  inspection: { required: boolean; completed: boolean; products: InspectionProduct[] };
  /** Other orders with this supplier, most recent first. */
  history: OrderRow[];
  tradeDocs: TradeDoc[];
};

const SUPPLIERS: Record<string, Supplier> = {
  'Bosch India': {
    key: 'Bosch India', code: 'S-015', legalName: 'Bosch India Limited', type: 'Material / Goods',
    risk: 'Low Risk', category: 'Regular Supplier', segment: 'Capital Equipment',
    addr: 'Tower 7, Industrial Estate, Bengaluru', country: 'India', state: 'Karnataka', stateCode: '29', city: 'Bengaluru',
    contact: 'Ramesh Nair', desig: 'Key Account Manager', phone: '+91 98450 77001', email: 'ramesh.nair@boschindia.com',
    scrutiny: '2026-03-01', gstNo: '29AAACB7707D1ZT', gstStatus: 'Active', filing: '2026-06-11',
    remarks: 'Scrutiny last refreshed on 01 Mar 2026. Last GST return filed on 11 Jun 2026.',
    legalDone: [4, 4, 2, 4, 3],
  },
  'Reliance Industries': {
    key: 'Reliance Industries', code: 'S-001', legalName: 'Reliance Industries Limited', type: 'Material / Goods',
    risk: 'Low Risk', category: 'Star Supplier', segment: 'Raw Material',
    addr: 'Maker Chambers IV, 222 Nariman Point, Mumbai 400021', country: 'India', state: 'Maharashtra', stateCode: '27', city: 'Mumbai',
    contact: 'Anil Mehta', desig: 'Procurement Head', phone: '+91 98200 11223', email: 'anil.mehta@ril.com',
    scrutiny: '2026-08-14', gstNo: '27AAACR5055K1Z5', gstStatus: 'Active', filing: '2026-08-20',
    remarks: 'Scrutiny completed 14 Aug 2026. GSTR-3B filed 20 Aug 2026 — all current.',
    legalDone: [4, 4, 3, 4, 3],
  },
  'QuickShip Couriers': {
    key: 'QuickShip Couriers', code: 'S-021', legalName: 'QuickShip Couriers Private Limited', type: 'FFD / Transporter',
    risk: 'Low Risk', category: 'Regular Supplier', segment: 'Transport',
    addr: 'Unit 12, Andheri Logistics Park, Mumbai 400093', country: 'India', state: 'Maharashtra', stateCode: '27', city: 'Mumbai',
    contact: 'Neha Iyer', desig: 'Business Manager', phone: '+91 98670 44120', email: 'neha.iyer@quickshipcouriers.com',
    scrutiny: '2026-08-02', gstNo: '27AACCQ4471K1ZQ', gstStatus: 'Active', filing: '2026-08-18',
    remarks: 'Scrutiny refreshed 02 Aug 2026. Returns filed monthly and on time.',
    legalDone: [4, 4, 3, 4, 3],
  },
  'Godrej Industries': {
    key: 'Godrej Industries', code: 'S-032', legalName: 'Godrej Industries Limited', type: 'Material / Goods',
    risk: 'Low Risk', category: 'Star Supplier', segment: 'Raw Material',
    addr: 'Godrej One, Pirojshanagar, Vikhroli East, Mumbai 400079', country: 'India', state: 'Maharashtra', stateCode: '27', city: 'Mumbai',
    contact: 'Kavita Deshpande', desig: 'Sales Head', phone: '+91 98190 66231', email: 'kavita.deshpande@godrejinds.com',
    scrutiny: '2026-07-21', gstNo: '27AAACG1395D1ZU', gstStatus: 'Active', filing: '2026-08-11',
    remarks: 'Scrutiny current. Last GSTR-3B filed 11 Aug 2026.',
    legalDone: [4, 4, 3, 4, 3],
  },
  'Tata Chemicals': {
    key: 'Tata Chemicals', code: 'S-012', legalName: 'Tata Chemicals Limited', type: 'Material / Goods',
    risk: 'Medium Risk', category: 'Regular Supplier', segment: 'Raw Material',
    addr: 'Bombay House, 24 Homi Mody Street, Fort, Mumbai 400001', country: 'India', state: 'Maharashtra', stateCode: '27', city: 'Mumbai',
    contact: 'Sanjay Rao', desig: 'Regional Manager', phone: '+91 98330 27714', email: 'sanjay.rao@tatachemicals.com',
    scrutiny: '2026-07-09', gstNo: '27AAACT4059M1ZH', gstStatus: 'Active', filing: '2026-05-20',
    remarks: 'Scrutiny current, but no GST return filed since 20 May 2026.',
    legalDone: [4, 4, 3, 3, 2],
  },
  'Sunrise Packaging and Industrial Materials Manufacturing Company (India) Private Limited — Unit II, Export Division, Bhiwandi Logistics Park, Maharashtra, registered supplier for corrugated and flexible packaging materials': {
    key: 'Sunrise Packaging and Industrial Materials Manufacturing Company (India) Private Limited',
    code: 'S-034', legalName: 'Sunrise Packaging and Industrial Materials Manufacturing Company (India) Private Limited',
    type: 'Material / Goods', risk: 'High Risk', category: 'High Risk Supplier', segment: 'Packaging',
    addr: 'Unit II, Export Division, Bhiwandi Logistics Park, Bhiwandi 421302', country: 'India', state: 'Maharashtra', stateCode: '27', city: 'Bhiwandi',
    contact: 'Vikram Patel', desig: 'Business Manager', phone: '+91 97690 18842', email: 'vikram.patel@sunrisepack.com',
    scrutiny: '2026-01-14', gstNo: '27AAKCS8812P1ZD', gstStatus: 'Suspended', filing: '2026-04-30',
    remarks: 'GSTIN suspended pending reply to a notice. Scrutiny not refreshed since 14 Jan 2026.',
    legalDone: [3, 2, 1, 2, 1],
  },
};

/** Net payable per document (after TDS / deductions); the gross total lives on the row. */
const NET_PAYABLE: Record<string, number> = {
  'PO/2025-26/023': 98900,
  'SPI/2025-26/029': 58750,
  'PO/2025-26/013': 270480,
  'SPI/2025-26/059': 37000,
  'PO/2025-26/071': 404000,
  'SPI/2025-26/044': 185600,
  'SPI/2025-26/077': 64300,
};

type Release = Omit<PaymentRelease, 'requestId' | 'requestDate' | 'doc' | 'docDate'>;
const RELEASES: Record<string, Release[]> = {
  'PRQ-002': [
    { amount: 24700, bank: 'HDFC Bank', mode: 'Bank Transfer (NEFT)', ref: 'HDFC260628128944', date: '2026-06-28' },
  ],
  'PRQ-007': [
    { amount: 30000, bank: 'ICICI Bank', mode: 'Bank Transfer (RTGS)', ref: 'ICIC260703704412', date: '2026-07-03' },
    { amount: 20000, bank: 'State Bank of India', mode: 'Cheque', ref: '704412', date: '2026-07-10' },
  ],
};

const TRADE_DOCS: Record<string, TradeDoc[]> = {
  'PO/2025-26/023': [
    { code: 'DOC/2025-26/041', name: 'Purchase Order', generated: '2026-06-16', valid: '2027-06-15', status: 'signed', attachment: 'PO_2025-26_023.pdf' },
    { code: 'DOC/2025-26/042', name: 'Purchase Agreement', generated: '2026-06-16', valid: '2027-06-15', status: 'pending', attachment: 'Purchase_Agreement.pdf' },
  ],
  'PO/2025-26/029': [
    { code: 'DOC/2025-26/048', name: 'Purchase Order', generated: '2026-06-13', valid: '2027-06-12', status: 'signed', attachment: 'PO_2025-26_029.pdf' },
    { code: 'DOC/2025-26/049', name: 'Purchase Agreement', generated: '2026-06-13', valid: '2027-06-12', status: 'sent', attachment: 'Purchase_Agreement.pdf' },
  ],
  'PO/2025-26/013': [
    { code: 'DOC/2025-26/022', name: 'Purchase Order', generated: '2026-05-29', valid: '2027-05-28', status: 'signed', attachment: 'PO_2025-26_013.pdf' },
    { code: 'DOC/2025-26/023', name: 'Purchase Agreement', generated: '2026-05-29', valid: '2027-05-28', status: 'signed', attachment: 'Purchase_Agreement.pdf' },
  ],
  'PO/2025-26/071': [
    { code: 'DOC/2025-26/112', name: 'Purchase Order', generated: '2026-06-21', valid: '2027-06-20', status: 'sent', attachment: 'PO_2025-26_071.pdf' },
    { code: 'DOC/2025-26/113', name: 'Purchase Agreement', generated: '2026-06-21', valid: '2027-06-20', status: 'pending', attachment: 'Purchase_Agreement.pdf' },
  ],
  'PO/2025-26/044': [
    { code: 'DOC/2025-26/071', name: 'Purchase Order', generated: '2026-06-02', valid: '2027-06-01', status: 'signed', attachment: 'PO_2025-26_044.pdf' },
    { code: 'DOC/2025-26/072', name: 'Purchase Agreement', generated: '2026-06-02', valid: '2027-06-01', status: 'signed', attachment: 'Purchase_Agreement.pdf' },
  ],
};

/** A settled order: paid in full, inspected, one SPI with its GRN and QA. */
function settled(o: {
  po: string; poDate: string; supplier: string; category: OrderRow['supplierCategory']; risk: OrderRow['risk'];
  total: number; net: number; opp: string; proc: string; ship?: string; insp?: boolean; seq: string;
}): OrderRow {
  const shift = (days: number) => new Date(Date.parse(o.poDate) + days * 86400000).toISOString().slice(0, 10);
  return {
    po: o.po, poDate: o.poDate, physicalInspection: !!o.insp,
    type: 'materials', docType: 'Domestics',
    shipment: o.ship ?? null, shipmentDate: o.ship ? shift(-12) : '',
    opportunity: o.opp, opportunityDate: shift(-40),
    procurement: o.proc, procurementDate: shift(-25),
    supplier: o.supplier, supplierCategory: o.category, risk: o.risk,
    expectedDelivery: shift(35),
    total: o.total, net: o.net, paid: o.net, balance: 0,
    invoices: [{
      spi: `SPI/2025-26/${o.seq}`, spiDate: shift(14), amount: o.net, paid: o.net, due: 0, status: 'full',
      grn: `GRN-${o.seq}`, grnDate: shift(18), qa: `QA-${o.seq}`, qaDate: shift(20),
    }],
    zohoSynced: true, inspectionDone: !!o.insp, paymentRequests: 2,
  };
}

const PURCHASE_ORDERS: OrderRow[] = [
  {
    po: 'PO/2025-26/023', poDate: '2026-06-16', physicalInspection: true,
    type: 'materials', docType: 'Domestics',
    shipment: 'SHP-049', shipmentDate: '2026-06-04',
    opportunity: 'OPP-030', opportunityDate: '2026-05-07',
    procurement: 'PROC-040', procurementDate: '2026-05-22',
    supplier: 'Bosch India', supplierCategory: 'regular', risk: 'low',
    expectedDelivery: '2026-07-30',
    total: 103000, net: 98900, paid: 24700, balance: 74200,
    invoices: [{
      spi: 'SPI/2025-26/031', spiDate: '2026-07-02', amount: 98900, paid: 24700, due: 74200, status: 'partial',
      grn: 'GRN-031', grnDate: '2026-07-06', qa: 'QA-031', qaDate: '2026-07-08',
    }],
    zohoSynced: true, inspectionDone: false, paymentRequests: 2,
    paymentNote: { kind: 'waiting', amount: 27500 },
  },
  {
    po: 'PO/2025-26/029', poDate: '2026-06-13', physicalInspection: true,
    type: 'materials', docType: 'Domestics',
    shipment: null, shipmentDate: '',
    opportunity: 'OPP-038', opportunityDate: '2026-05-04',
    procurement: 'PROC-050', procurementDate: '2026-05-19',
    supplier: 'Bosch India', supplierCategory: 'regular', risk: 'low',
    expectedDelivery: '2026-07-24',
    total: 58750, net: 58750, paid: 0, balance: 58750,
    invoices: [{
      spi: 'SPI/2025-26/029', spiDate: '2026-06-01', amount: 58750, paid: 0, due: 58750, status: 'pending',
      grn: 'GRN-029', grnDate: '2026-06-24', qa: 'QA-029', qaDate: '2026-06-26',
    }],
    zohoSynced: true, inspectionDone: false, paymentRequests: 1,
  },
  {
    po: 'PO/2025-26/013', poDate: '2026-05-29', physicalInspection: false,
    type: 'materials', docType: 'International',
    shipment: null, shipmentDate: '',
    opportunity: 'OPP-018', opportunityDate: '2026-04-19',
    procurement: 'PROC-024', procurementDate: '2026-05-04',
    supplier: 'Reliance Industries', supplierCategory: 'star', risk: 'low',
    expectedDelivery: '2026-07-15',
    total: 276000, net: 270480, paid: 0, balance: 270480,
    invoices: [],
    zohoSynced: false, inspectionDone: false, paymentRequests: 1,
    paymentNote: { kind: 'waiting', amount: 31800 },
  },
  {
    po: 'PO/2025-26/071', poDate: '2026-06-21', physicalInspection: false,
    type: 'materials', docType: 'Domestics',
    shipment: null, shipmentDate: '',
    opportunity: 'OPP-082', opportunityDate: '2026-05-16',
    procurement: 'PROC-099', procurementDate: '2026-05-30',
    supplier: 'Godrej Industries', supplierCategory: 'star', risk: 'low',
    expectedDelivery: '2026-08-10',
    total: 412000, net: 404000, paid: 0, balance: 404000,
    invoices: [],
    zohoSynced: true, inspectionDone: false, paymentRequests: 1,
    paymentNote: { kind: 'waiting', amount: 96500 },
  },
  {
    po: 'PO/2025-26/044', poDate: '2026-06-02', physicalInspection: false,
    type: 'materials', docType: 'Domestics',
    shipment: 'SHP-061', shipmentDate: '2026-06-09',
    opportunity: 'OPP-044', opportunityDate: '2026-04-30',
    procurement: 'PROC-066', procurementDate: '2026-05-12',
    supplier: 'Tata Chemicals', supplierCategory: 'regular', risk: 'medium',
    expectedDelivery: '2026-07-06',
    total: 189400, net: 185600, paid: 50000, balance: 135600,
    invoices: [{
      spi: 'SPI/2025-26/044', spiDate: '2026-06-18', amount: 185600, paid: 50000, due: 135600, status: 'partial',
      grn: 'GRN-044', grnDate: '2026-06-22', qa: 'QA-044', qaDate: '2026-06-24',
    }],
    zohoSynced: true, inspectionDone: false, paymentRequests: 1,
  },
  // Earlier orders, closed out — they only appear in a request's history.
  settled({ po: 'PO/2025-26/017', poDate: '2026-05-10', supplier: 'Bosch India', category: 'regular', risk: 'low', total: 84200, net: 82500, opp: 'OPP-024', proc: 'PROC-031', ship: 'SHP-037', insp: true, seq: '019' }),
  settled({ po: 'PO/2025-26/006', poDate: '2026-03-18', supplier: 'Bosch India', category: 'regular', risk: 'low', total: 46800, net: 46800, opp: 'OPP-009', proc: 'PROC-012', seq: '007' }),
  settled({ po: 'PO/2025-26/004', poDate: '2026-04-02', supplier: 'Reliance Industries', category: 'star', risk: 'low', total: 318000, net: 311640, opp: 'OPP-006', proc: 'PROC-008', ship: 'SHP-014', seq: '005' }),
  settled({ po: 'PO/2025-26/002', poDate: '2026-03-12', supplier: 'Reliance Industries', category: 'star', risk: 'low', total: 142500, net: 139650, opp: 'OPP-003', proc: 'PROC-004', seq: '002' }),
  settled({ po: 'PO/2025-26/038', poDate: '2026-05-02', supplier: 'Godrej Industries', category: 'star', risk: 'low', total: 226000, net: 221480, opp: 'OPP-051', proc: 'PROC-058', seq: '040' }),
  settled({ po: 'PO/2025-26/021', poDate: '2026-04-26', supplier: 'Tata Chemicals', category: 'regular', risk: 'medium', total: 97300, net: 95350, opp: 'OPP-027', proc: 'PROC-035', seq: '023' }),
  settled({ po: 'PO/2025-26/010', poDate: '2026-03-05', supplier: 'Tata Chemicals', category: 'regular', risk: 'medium', total: 64900, net: 64900, opp: 'OPP-011', proc: 'PROC-015', seq: '011' }),
  settled({
    po: 'PO/2025-26/052', poDate: '2026-05-15', supplier: 'Sunrise Packaging and Industrial Materials Manufacturing Company (India) Private Limited — Unit II, Export Division, Bhiwandi Logistics Park, Maharashtra, registered supplier for corrugated and flexible packaging materials',
    category: 'high', risk: 'high', total: 38600, net: 38600, opp: 'OPP-066', proc: 'PROC-079', insp: true, seq: '054',
  }),
];

/** The document a request was raised against: the SPI when it has one. */
export function docOf(r: PaymentRequestRow): { id: string; date: string; kind: 'po' | 'spi' } {
  if (r.spi) return { id: r.spi.id, date: r.spi.date, kind: 'spi' };
  return { id: r.po!.id, date: r.po!.date, kind: 'po' };
}

/* Each order gets its own stable slice of the sample products, as the
   prototype does, so two POs never show the same inspection list. */
function productsFor(po: string): InspectionProduct[] {
  const base = INSPECTION_PRODUCTS;
  let h = 0;
  for (const ch of po) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const count = 2 + (h % Math.max(1, base.length - 1));
  const start = h % base.length;
  return Array.from({ length: count }, (_, k) => {
    const p = base[(start + k) % base.length];
    return { ...p, qty: p.qty * (1 + ((h >>> (k * 3)) % 4)) };
  });
}

const paidOf = (requestId: string) => (RELEASES[requestId] ?? []).reduce((s, p) => s + p.amount, 0);

/** Stands in for `GET /p2p/payment-requests/{id}` until the API lands. */
export async function fetchPaymentRequestDetail(requestId: string): Promise<PaymentRequestDetail | null> {
  const all = await fetchPaymentRequests();
  const row = all.find(r => r.requestId === requestId);
  if (!row) return null;

  const doc = docOf(row);
  const onDoc = all.filter(r => docOf(r).id === doc.id);
  const others = onDoc.filter(r => r !== row).sort((a, b) => a.requestId.localeCompare(b.requestId));
  const linked: LinkedRequest[] = [row, ...others].map(r => ({ ...r, paid: paidOf(r.requestId) }));

  const net = NET_PAYABLE[doc.id] ?? row.totalAmount;
  const paid = linked.reduce((s, r) => s + r.paid, 0);
  const approvedTotal = linked.reduce((s, r) => s + (r.approvedAmount ?? 0), 0);
  // A declined request no longer holds any of the document's value.
  const committed = linked.filter(r => r.status !== 'declined').reduce((s, r) => s + r.requestedAmount, 0);
  const prevRequested = others.reduce((s, r) => s + r.requestedAmount, 0);

  const payments: PaymentRelease[] = linked
    .flatMap(r => (RELEASES[r.requestId] ?? []).map(p => ({
      ...p, requestId: r.requestId, requestDate: r.requestDate, doc: doc.id, docDate: doc.date,
    })))
    .sort((a, b) => a.date.localeCompare(b.date));

  const po = row.po ? PURCHASE_ORDERS.find(o => o.po === row.po!.id) ?? null : null;
  const supplier = SUPPLIERS[row.supplier];
  const history = PURCHASE_ORDERS
    .filter(o => o.supplier === row.supplier && o.po !== po?.po && !o.cancelled)
    .sort((a, b) => b.poDate.localeCompare(a.poDate));

  return {
    row,
    supplier,
    doc,
    ledger: {
      total: row.totalAmount, net, paid, balance: net - paid,
      approvedTotal, available: Math.max(0, net - committed), prevRequested,
    },
    linked,
    payments,
    po,
    inspection: {
      required: !!po?.physicalInspection,
      completed: !!po?.inspectionDone,
      products: po ? productsFor(po.po) : [],
    },
    history,
    tradeDocs: po ? TRADE_DOCS[po.po] ?? [] : [],
  };
}
