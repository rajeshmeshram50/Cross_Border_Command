// What the user has filled in so far. The form shell owns it so a later step
// can read earlier answers — each step opens with a recap of the ones before.
// It also converts to and from the API: a saved PO loads into a draft, and a
// draft becomes the Stage 01 / Stage 02 request bodies.
import { useState } from 'react';
import type { DocTypeKey, PiLine, PoDetail, PoItemsBody, PoStage1Body, PoTypeKey, SupplierDetail, YesNo } from '../api/po-api';
import type { LegalView } from './supplier-checks';
import { EMPTY_CHARGES, type Charges } from './steps/ChargesSummary';

export const PO_TYPE_OPTIONS: { key: PoTypeKey; label: string }[] = [
  { key: 'material_goods', label: 'Material / Goods' },
  { key: 'services', label: 'Services' },
  { key: 'ffd_transporter', label: 'FFD / Transporter' },
];
/** Same list the server accepts (PurchaseOrder::PAYMENT_TYPES). */
export const PAYMENT_TYPE_OPTIONS = ['Advanced Payment', 'Full Payment', 'Letter of Credit'];
/** Only Material / Goods POs can be raised for now; the rest are listed but locked. */
export const OPEN_PO_TYPE = 'Material / Goods';
export const DOC_TYPE_OPTIONS: { key: DocTypeKey; label: string }[] = [
  { key: 'domestic', label: 'Domestics' },
  { key: 'international', label: 'International' },
];

/** One row of the Step 02 table: a PI line (pi set) or a manual line (pi null). */
export type PoLineRow = {
  key: string;
  pi: PiLine | null;
  /** The product ordered — the PI's own unless a replacement is picked. */
  productId: number | null;
  qtyPo: number;
  rate: number;
};

export type PoDraft = {
  // Step 01 · basic purchase order details
  poType: string;
  docType: string;
  transport: string;
  deliveryDate: string;
  deliveryLocation: string;
  paymentType: string;
  physInsp: boolean;
  // International only
  currency: string;
  exchangeRate: string;
  incoTerm: string;
  portLoading: string;
  portDischarge: string;
  finalDestination: string;
  countryOrigin: string;
  // Step 01 · supplier, read from the supplier master (never edited here)
  vendorId: number | null;
  supplier: SupplierDetail | null;
  vault: Record<string, unknown> | null;
  legal: LegalView | null;
  // Step 02 · product lines and the extra charges
  lines: PoLineRow[];
  charges: Charges;
  // Step 03 · terms
  terms: string;
};

export const EMPTY_DRAFT: PoDraft = {
  poType: 'Material / Goods',
  docType: 'Domestics',
  transport: '',
  deliveryDate: '',
  deliveryLocation: '',
  paymentType: '',
  physInsp: false,
  currency: '',
  exchangeRate: '',
  incoTerm: '',
  portLoading: '',
  portDischarge: '',
  finalDestination: '',
  countryOrigin: '',
  vendorId: null,
  supplier: null,
  vault: null,
  legal: null,
  lines: [],
  charges: EMPTY_CHARGES,
  terms: '',
};

export type SetDraft = (patch: Partial<PoDraft>) => void;

export function usePoDraft(): { draft: PoDraft; set: SetDraft; replace: (d: PoDraft) => void } {
  const [draft, setDraft] = useState<PoDraft>(EMPTY_DRAFT);
  const set: SetDraft = (patch) => setDraft((current) => ({ ...current, ...patch }));
  return { draft, set, replace: setDraft };
}

/* ══ Lines ══ */

let manualSeq = 0;

/** A PI line as a table row: its own product, the still-pending qty and the PI rate. */
/* Nothing is pre-filled: a PO covers only the PI lines it is actually for, and
   whatever is left over goes on the next PO. The buyer picks the product and the
   quantity for each line they want on this one. */
/* No rate until the PO product is picked: what we pay the supplier is its own
   purchase price, not the PI's selling rate. */
export const rowFromPi = (pi: PiLine): PoLineRow => ({
  key: `pi:${pi.pi_item_id}`, pi, productId: null, qtyPo: 0, rate: 0,
});

/** A blank line for a product the PI doesn't carry. */
export const manualRow = (): PoLineRow => ({ key: `m:${++manualSeq}`, pi: null, productId: null, qtyPo: 1, rate: 0 });

/* ══ Saved PO → draft ══ */

const labelOf = <K extends string>(opts: { key: K; label: string }[], key: K | null, fallback: string) =>
  opts.find((o) => o.key === key)?.label ?? fallback;
const s = (v: string | null | undefined) => v ?? '';

/** Every PI line of the shipment, with this PO's quantities on the ones it orders; manual lines after. */
function linesFromDetail(d: PoDetail, piLines: PiLine[]): PoLineRow[] {
  const byPi = new Map(d.items.filter((it) => it.pi_item_id).map((it) => [it.pi_item_id as number, it]));
  // Lines fully ordered on other POs stay out, unless this PO is the one ordering them.
  const piRows = piLines.filter((pi) => byPi.has(pi.pi_item_id) || pi.pending_qty > 0).map((pi) => {
    const it = byPi.get(pi.pi_item_id);
    return it
      ? { key: `pi:${pi.pi_item_id}`, pi, productId: it.product_id, qtyPo: Number(it.quantity), rate: Number(it.rate) }
      : { ...rowFromPi(pi), qtyPo: 0 };
  });
  const manual = d.items.filter((it) => !it.pi_item_id).map((it) => ({
    key: `m:${++manualSeq}`, pi: null, productId: it.product_id, qtyPo: Number(it.quantity), rate: Number(it.rate),
  }));
  return [...piRows, ...manual];
}

const money = (v: string) => (Number(v) ? String(Number(v)) : '');

export function draftFromDetail(d: PoDetail, piLines: PiLine[]): PoDraft {
  return {
    ...EMPTY_DRAFT,
    poType: labelOf(PO_TYPE_OPTIONS, d.po_type, EMPTY_DRAFT.poType),
    docType: labelOf(DOC_TYPE_OPTIONS, d.document_type, EMPTY_DRAFT.docType),
    transport: s(d.mode_of_transport),
    deliveryDate: s(d.expected_delivery_date),
    deliveryLocation: s(d.delivery_location),
    paymentType: s(d.payment_type),
    physInsp: d.physical_inspection === 'yes',
    currency: d.document_type === 'international' ? s(d.currency_code) : '',
    exchangeRate: d.exchange_rate ? String(Number(d.exchange_rate)) : '',
    incoTerm: s(d.inco_term),
    portLoading: s(d.port_of_loading),
    portDischarge: s(d.port_of_discharge),
    finalDestination: s(d.final_destination),
    countryOrigin: s(d.country_of_origin),
    vendorId: d.vendor_id,
    lines: linesFromDetail(d, piLines),
    charges: { ship: money(d.shipping_charges), pack: money(d.packaging_charges), other: money(d.other_charges) },
    terms: s(d.terms),
  };
}

/* ══ Draft → request bodies ══ */

const orNull = (v: string) => (v.trim() === '' ? null : v.trim());

export function stage1Body(d: PoDraft, shipmentId: number | null): PoStage1Body {
  const intl = d.docType === 'International';
  return {
    po_type: PO_TYPE_OPTIONS.find((o) => o.label === d.poType)?.key ?? 'material_goods',
    document_type: intl ? 'international' : 'domestic',
    mode_of_transport: orNull(d.transport),
    expected_delivery_date: orNull(d.deliveryDate),
    delivery_location: orNull(d.deliveryLocation),
    payment_type: orNull(d.paymentType),
    physical_inspection: (d.physInsp ? 'yes' : 'no') as YesNo,
    currency_code: intl ? orNull(d.currency) : null,
    exchange_rate: intl ? orNull(d.exchangeRate) : null,
    inco_term: intl ? orNull(d.incoTerm) : null,
    port_of_loading: intl ? orNull(d.portLoading) : null,
    port_of_discharge: intl ? orNull(d.portDischarge) : null,
    final_destination: intl ? orNull(d.finalDestination) : null,
    country_of_origin: intl ? orNull(d.countryOrigin) : null,
    link_type: shipmentId ? 'with_shipment' : 'standalone',
    shipment_order_id: shipmentId,
    // The procurement request module isn't built yet, so nothing is linked.
    link_procurement: shipmentId ? 'no' : null,
    vendor_id: d.vendorId as number,
  };
}

/** Lines with a quantity are ordered; a PI line left at 0 stays out of the PO. */
export function itemsBody(d: PoDraft): PoItemsBody {
  return {
    lines: d.lines.filter((l) => l.qtyPo > 0).map((l) => ({
      pi_item_id: l.pi?.pi_item_id ?? null,
      product_id: l.productId,
      quantity: l.qtyPo,
      rate: l.rate,
    })),
    shipping_charges: Number(d.charges.ship) || 0,
    packaging_charges: Number(d.charges.pack) || 0,
    other_charges: Number(d.charges.other) || 0,
  };
}
