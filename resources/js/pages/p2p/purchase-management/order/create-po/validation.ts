// Inline validation for the Create PO form. The same rules the server enforces
// (CS-403), checked in the browser first so every problem shows on its field.
import type { PoDraft, PoLineRow } from './po-draft';
import { OPEN_PO_TYPE, PAYMENT_TYPE_OPTIONS } from './po-draft';
import type { ProductOpt } from './use-po-lookups';
import { gstOf } from './steps/ProductTable';

/** Stage 01 field → message. Keys are PoDraft fields (plus `supplier`). */
export type FieldErrors = Partial<Record<keyof PoDraft | 'supplier', string>>;

/** Stage 02 row key → the cell that is wrong. */
export type LineErrors = Record<string, { product?: string; qty?: string; rate?: string }>;

const blank = (v: string) => v.trim() === '';
const todayIso = () => new Date().toISOString().slice(0, 10);

export function validateStage1(d: PoDraft): FieldErrors {
  const e: FieldErrors = {};
  const need = (key: keyof PoDraft, label: string) => { if (blank(String(d[key] ?? ''))) e[key] = `${label} is required.`; };

  need('poType', 'PO Type');
  need('docType', 'Document Type');
  need('transport', 'Mode of Transport');
  need('deliveryDate', 'Expected Delivery Date');
  need('deliveryLocation', 'Delivery Location');
  need('paymentType', 'Payment Type');
  if (!e.poType && d.poType !== OPEN_PO_TYPE) e.poType = 'Only Material / Goods purchase orders can be raised for now.';
  if (!e.paymentType && !PAYMENT_TYPE_OPTIONS.includes(d.paymentType)) e.paymentType = 'Select Advanced Payment, Full Payment or Letter of Credit.';
  if (!e.deliveryDate && d.deliveryDate < todayIso()) e.deliveryDate = 'Expected delivery date cannot be earlier than today.';

  if (!d.vendorId) e.supplier = 'Select the supplier this PO is issued to.';
  // CS-403: the only hard block on Stage 01.
  else if ((d.supplier?.category ?? '').toLowerCase().includes('blacklist')) e.supplier = 'This supplier is blacklisted — a PO cannot be raised on it.';

  if (d.docType === 'International') {
    need('currency', 'Currency');
    need('exchangeRate', 'Exchange Rate');
    if (!e.exchangeRate && !(Number(d.exchangeRate) > 0)) e.exchangeRate = 'Exchange rate must be greater than 0.';
    need('incoTerm', 'INCO Term');
    need('portLoading', 'Port of Loading');
    need('portDischarge', 'Port of Discharge');
    if (!e.portLoading && d.portLoading.trim().length > 255) e.portLoading = 'Port of loading may not exceed 255 characters.';
    if (!e.portDischarge && d.portDischarge.trim().length > 255) e.portDischarge = 'Port of discharge may not exceed 255 characters.';
    need('finalDestination', 'Final Destination');
    need('countryOrigin', 'Country of Origin');
  }
  return e;
}

/** Per-row checks for Step 02, plus a message when nothing is ordered at all. */
/** Why a product can't go on this PO's supplier, or null when its segment is mapped. */
export function segmentMismatch(product: ProductOpt | undefined, supplierSegments: string[] | null | undefined): string | null {
  if (!product || !supplierSegments) return null;       // supplier not loaded yet — the server still checks
  const seg = product.segment.trim();
  if (!seg) return 'Segment mismatch — this product has no segment set in the product master.';
  if (supplierSegments.some((x) => x.trim().toLowerCase() === seg.toLowerCase())) return null;
  return `Segment mismatch — ${seg} is not mapped to this supplier. Add ${seg} to the supplier's segments.`;
}

export function validateLines(lines: PoLineRow[], products: ProductOpt[], supplierSegments?: string[] | null): { rows: LineErrors; general?: string } {
  const rows: LineErrors = {};
  const set = (key: string, cell: 'product' | 'qty' | 'rate', msg: string) => { rows[key] = { ...rows[key], [cell]: msg }; };

  for (const l of lines) {
    if (!l.pi && !l.productId) set(l.key, 'product', 'Pick a product, or remove the line.');
    if (!l.pi && l.qtyPo <= 0) set(l.key, 'qty', 'Enter a quantity.');
    if (l.pi && l.qtyPo > l.pi.pending_qty) set(l.key, 'qty', `Only ${l.pi.pending_qty} is still pending on the PI.`);
    // A PI line left at 0 is simply not ordered; any ordered line needs a price and GST.
    if (l.qtyPo > 0 && l.rate <= 0) set(l.key, 'rate', 'Enter a rate.');
    if (l.qtyPo > 0 && l.productId && gstOf(l, products) === null) set(l.key, 'product', 'No GST % on the product master — set it there first.');
    const seg = l.qtyPo > 0 ? segmentMismatch(products.find((p) => p.id === l.productId), supplierSegments) : null;
    if (seg) set(l.key, 'product', seg);
  }
  const ordered = lines.some((l) => l.qtyPo > 0);
  return { rows, general: ordered ? undefined : 'Enter a quantity on at least one line.' };
}

// Server field → draft field, for 422 errors from Stage 01.
const SERVER_FIELD: Record<string, keyof PoDraft | 'supplier'> = {
  po_type: 'poType', document_type: 'docType', mode_of_transport: 'transport',
  expected_delivery_date: 'deliveryDate', delivery_location: 'deliveryLocation', payment_type: 'paymentType',
  currency_code: 'currency', exchange_rate: 'exchangeRate', inco_term: 'incoTerm',
  port_of_loading: 'portLoading', port_of_discharge: 'portDischarge',
  final_destination: 'finalDestination', country_of_origin: 'countryOrigin', vendor_id: 'supplier',
};

export function stage1FromServer(fieldErrors: Record<string, string[]>): FieldErrors {
  const e: FieldErrors = {};
  for (const [k, msgs] of Object.entries(fieldErrors)) {
    const key = SERVER_FIELD[k];
    if (key && msgs[0]) e[key] = msgs[0];
  }
  return e;
}

/** Server `lines.N.cell` errors → the row that was sent at position N (only lines with a quantity are sent). */
export function linesFromServer(fieldErrors: Record<string, string[]>, lines: PoLineRow[]): LineErrors {
  const sent = lines.filter((l) => l.qtyPo > 0);
  const rows: LineErrors = {};
  for (const [k, msgs] of Object.entries(fieldErrors)) {
    const m = k.match(/^lines\.(\d+)\.(\w+)$/);
    const row = m ? sent[Number(m[1])] : undefined;
    if (!row || !msgs[0]) continue;
    const cell = m![2] === 'quantity' ? 'qty' : m![2] === 'rate' ? 'rate' : 'product';
    rows[row.key] = { ...rows[row.key], [cell]: msgs[0] };
  }
  return rows;
}

/** Brings the first highlighted field into view once the errors have rendered. */
export function scrollToFirstError() {
  requestAnimationFrame(() => {
    document.querySelector('.cpf-form .is-invalid, .cpf-form .invalid, .cpf-form .cpd-cell-err')
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
}
