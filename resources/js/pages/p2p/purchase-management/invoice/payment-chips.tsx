import { Chip, shortDate, supplierCode } from '../order/manage-payment/payment-shared';
import type { InvoiceRow } from './types';

export function InvoiceHeroChips({ row }: { row: InvoiceRow }) {
  const noShip = !row.poNo && !row.shipmentId;
  return (
    <div className="mpr-hero__chips">
      <Chip label="Supplier" value={row.supplierName} meta={supplierCode(row.supplierName)} mod="mpr-hero__chip--sup" />
      {row.poNo && <Chip label="PO Number" value={row.poNo} meta={row.poDate ? shortDate(row.poDate) : undefined} />}
      <Chip label="SPI Number" value={row.invoiceNo} meta={shortDate(row.invoiceDate)} />
      {!noShip && <Chip label="Shipment ID" value={row.shipmentId || 'NA'} meta={row.shipmentDate ? shortDate(row.shipmentDate) : undefined} />}
      {!noShip && <Chip label="Opportunity ID" value={row.opportunityId || 'NA'} meta={row.opportunityDate ? shortDate(row.opportunityDate) : undefined} />}
      <Chip label="Procurement ID" value={row.procurementId || 'NA'} meta={row.procurementDate ? shortDate(row.procurementDate) : undefined} />
    </div>
  );
}
