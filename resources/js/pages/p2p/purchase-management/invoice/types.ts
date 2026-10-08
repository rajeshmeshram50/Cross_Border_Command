/**
 * Invoice (Supplier Purchase Invoice) — the row shape.
 *
 * Taken from the design prototype's own data builder, so the UI is written
 * against the same fields the screens were designed with. When the API arrives
 * this is the contract it has to satisfy; nothing in the UI reads anything else.
 *
 * Two rules this file follows, both worth keeping:
 *
 *  1. NOTHING DERIVED IS STORED. Balance Amount is not a field — it is
 *     `netPayable - totalPaid`, computed where it is shown. A stored copy is a
 *     second source of truth that goes stale the moment a payment lands.
 *
 *  2. EVERY OPTIONAL FIELD IS `?`, NOT `''`. A direct invoice genuinely has no
 *     PO; a non-shipment invoice genuinely has no shipment. Typing those as
 *     optional makes the compiler force a decision at each use site — show a
 *     dash, or hide the cell — instead of letting an empty string slip through
 *     and render as a blank box.
 */

/** Supplier risk, as shown in the Risk Alert column. */
export type InvoiceRiskLevel = 'low' | 'medium' | 'high';

/** Supplier standing, the chip under the supplier's name. */
export type InvoiceSupplierCategory = 'star' | 'regular' | 'high-risk' | 'blacklisted';

/** Whether the invoice was posted to Zohobook. */
export type InvoiceZohoStatus = 'synced' | 'not-synced';

/** Goods vs services — drives the PO Type chip. */
export type InvoicePoType = 'material' | 'services';

/** Domestic vs international — drives the Document Type chip. */
export type InvoiceDocumentType = 'domestic' | 'international';

/** Physical inspection outcome, its own column. */
export type InvoiceInspectionStatus = 'completed' | 'pending' | 'not-applicable';

/** Who owns the warehouse the goods landed in. */
export type InvoiceWarehouseKind = 'own' | 'third-party';

/**
 * One invoice row.
 *
 * `po*` fields are absent on a Direct Invoice (no purchase order).
 * `shipment*` fields are absent on an "other transaction" (no shipment).
 * Those two absences are exactly what the two tab levels filter on, which is
 * why they are modelled as optional rather than as a `kind` discriminator —
 * a row can be direct AND have a shipment, so they are independent axes.
 */
export interface InvoiceRow {
  /** Stable key. Never render it; use `invoiceNo` for display. */
  id: string;

  /* ── Identity ─────────────────────────────────────────────────────────── */
  invoiceNo: string;          // SPI/2025-26/001
  invoiceDate: string;        // ISO yyyy-mm-dd

  /* ── Linked purchase order (absent on a Direct Invoice) ───────────────── */
  poNo?: string;
  poDate?: string;
  poType?: InvoicePoType;
  /** PO flagged for physical inspection — a small warning chip under the PO. */
  poPhysicalInspection?: boolean;

  documentType: InvoiceDocumentType;

  /* ── Linked shipment (absent on an "other transaction") ───────────────── */
  shipmentId?: string;
  shipmentDate?: string;

  /* ── Upstream references ──────────────────────────────────────────────── */
  opportunityId: string;
  opportunityDate: string;
  procurementId: string;
  procurementDate: string;

  /* ── Supplier ─────────────────────────────────────────────────────────── */
  supplierName: string;
  supplierCategory: InvoiceSupplierCategory;
  /** Stored, not derived from category: a regular supplier can still carry a
   *  high risk alert on a particular invoice. */
  riskLevel: InvoiceRiskLevel;

  expectedDeliveryDate: string;

  /* ── Money, in whole rupees ───────────────────────────────────────────────
     Integers, not floats: 0.1 + 0.2 !== 0.3 in binary floating point, and an
     invoice that reconciles to one paisa off is a support ticket. Formatting
     to "₹22,540" happens at the cell, never in the data. */
  totalPoAmount: number;
  netPayable: number;
  totalPaid: number;

  /* ── Receiving chain ──────────────────────────────────────────────────── */
  warehouseName: string;
  warehouseKind: InvoiceWarehouseKind;
  grnId: string;
  grnDate: string;
  qaId: string;
  qaDate: string;

  /* ── Status ───────────────────────────────────────────────────────────── */
  zohoStatus: InvoiceZohoStatus;
  inspectionStatus: InvoiceInspectionStatus;
  /** Open payment requests awaiting action — the count on the row's button. */
  pendingPaymentRequests: number;
  /** Amount approved and ready to pay, if any. */
  approvedForPayment?: number;
}

/**
 * Balance outstanding on an invoice.
 *
 * A function, not a field — see rule 1 above. Exported so the table cell and
 * any future summary read the same definition rather than each writing the
 * subtraction out again.
 */
export function invoiceBalance(row: InvoiceRow): number {
  return row.netPayable - row.totalPaid;
}

/**
 * How much of the invoice is settled, 0–100.
 *
 * Guards the zero case: a zero-value invoice would otherwise divide by zero and
 * render "NaN%" in the progress column.
 */
export function invoicePaidPercent(row: InvoiceRow): number {
  if (row.netPayable <= 0) return 0;
  return Math.round((row.totalPaid / row.netPayable) * 100);
}

/** The three top tabs. */
export type InvoiceScope = 'all' | 'with-po' | 'without-po';

/** The two sub-tabs under them. */
export type InvoiceShipmentScope = 'with-shipment' | 'without-shipment';

/** One of our own sites, as step 2 of the storage wizard lists it. */
export interface StorageWarehouse {
  id: string;
  name: string;
  /** Area and zone range, shown under the name. */
  location: string;
}
