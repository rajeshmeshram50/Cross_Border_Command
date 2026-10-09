import { Chip, shortDate, supplierCode } from '../order/manage-payment/payment-shared';
import type { InvoiceRow } from './types';

/**
 * The six references an invoice's payment screens are raised against.
 *
 * One component rather than a copy in each of the three screens — requests
 * history, the release screen and the raise form all show the same strip, and
 * when it was written out three times a change to it only ever landed in one.
 * This is the purchase order's own `HeroRefChips`, pointed at an invoice.
 */
export function InvoiceHeroChips({ row }: { row: InvoiceRow }) {
  return (
    <div className="mpr-hero__chips">
      {/* The supplier's code sits under the name, as it does on the purchase
          order. `InvoiceRow` carries no code of its own yet, so it falls back
          to the shared allocator — the same one the PO falls back to, so a
          supplier reads the same on both screens. */}
      <Chip label="Supplier" value={row.supplierName} meta={supplierCode(row.supplierName)} mod="mpr-hero__chip--sup" />
      <Chip label="PO Number" value={row.poNo || 'NA'} meta={row.poDate ? shortDate(row.poDate) : undefined} />
      <Chip label="SPI Number" value={row.invoiceNo} meta={shortDate(row.invoiceDate)} />
      <Chip label="Shipment ID" value={row.shipmentId || 'NA'} meta={row.shipmentDate ? shortDate(row.shipmentDate) : undefined} />
      <Chip label="Opportunity ID" value={row.opportunityId} meta={shortDate(row.opportunityDate)} />
      <Chip label="Procurement ID" value={row.procurementId} meta={shortDate(row.procurementDate)} />
    </div>
  );
}
