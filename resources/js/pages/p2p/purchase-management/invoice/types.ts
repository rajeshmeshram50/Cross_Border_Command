export type InvoiceRiskLevel = 'low' | 'medium' | 'high';

export type InvoiceSupplierCategory = 'star' | 'regular' | 'high-risk' | 'blacklisted';

export type InvoiceZohoStatus = 'synced' | 'not-synced';

export type InvoicePoType = 'material' | 'services';

export type InvoiceDocumentType = 'domestic' | 'international';

export type InvoiceInspectionStatus = 'completed' | 'pending' | 'not-applicable';

export type InvoiceWarehouseKind = 'own' | 'third-party';

export interface InvoiceRow {
  id: string;
  apiId?: number;
  status?: string;
  statusLabel?: string;

  invoiceNo: string;
  invoiceDate: string;

  poNo?: string;
  poDate?: string;
  poType?: InvoicePoType;
  poPhysicalInspection?: boolean;

  documentType: InvoiceDocumentType;

  shipmentId?: string;
  shipmentDate?: string;

  opportunityId?: string;
  opportunityDate?: string;
  procurementId?: string;
  procurementDate?: string;

  supplierName: string;
  supplierCategory?: InvoiceSupplierCategory;
  riskLevel?: InvoiceRiskLevel;

  expectedDeliveryDate?: string;

  totalPoAmount: number;
  netPayable: number;
  totalPaid: number;

  warehouseName?: string;
  warehouseKind?: InvoiceWarehouseKind;
  grnId?: string;
  grnDate?: string;
  qaId?: string;
  qaDate?: string;

  zohoStatus: InvoiceZohoStatus;
  inspectionStatus: InvoiceInspectionStatus;
  pendingPaymentRequests: number;
  approvedForPayment?: number;
}

export function invoiceBalance(row: InvoiceRow): number {
  return row.netPayable - row.totalPaid;
}

export function invoicePaidPercent(row: InvoiceRow): number {
  if (row.netPayable <= 0) return 0;
  return Math.round((row.totalPaid / row.netPayable) * 100);
}

export type InvoiceScope = 'all' | 'with-po' | 'without-po';

export type InvoiceShipmentScope = 'with-shipment' | 'without-shipment';

export interface StorageWarehouse {
  id: string;
  name: string;
  location: string;
}

export const SPI_EDITABLE_STATUSES = ['draft', 'mapped'];

export const SPI_STATUS_LABELS: Record<string, string> = {
  draft: 'Draft', mapped: 'Mapped', grn_pending: 'GRN Pending', closed: 'Closed', cancelled: 'Cancelled',
};

export function spiViewOnlyReason(status: string | null | undefined, label?: string | null): string | undefined {
  if (!status || SPI_EDITABLE_STATUSES.includes(status)) return undefined;
  return `This invoice is ${label || SPI_STATUS_LABELS[status] || status} — it opens view-only`;
}
