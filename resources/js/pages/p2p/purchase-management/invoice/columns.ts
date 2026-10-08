/**
 * The 22 columns, and their widths.
 *
 * ONE definition, read by three things: the <colgroup>, the <thead>, and the
 * table's own width. Written out separately they drift — a column added to the
 * head but not the colgroup silently shifts every width after it.
 *
 * The widths are the design's, measured per column against the widest content it
 * holds. They are what make `table-layout: fixed` possible, and fixed layout is
 * what stops one long supplier name from stretching a column and shoving the
 * other 21 sideways. Without it the browser measures all 60 rows before it can
 * paint anything.
 */

export interface InvoiceColumn {
  /** Stable key — also the React key for the header cell. */
  key: string;
  header: string;
  width: number;
  /** Draws the dashed rule that closes the money group. */
  groupEnd?: boolean;
}

export const INVOICE_COLUMNS: InvoiceColumn[] = [
  { key: 'sr',          header: 'Sr. No',                     width: 44 },
  { key: 'invoiceNo',   header: 'SPI Number',                 width: 150 },
  { key: 'poNo',        header: 'PO Number',                  width: 150 },
  { key: 'poType',      header: 'PO Type',                    width: 132 },
  { key: 'documentType', header: 'Document Type',             width: 108 },
  { key: 'shipmentId',  header: 'Shipment ID',                width: 112 },
  { key: 'opportunityId', header: 'Opportunity ID',           width: 112 },
  { key: 'procurementId', header: 'Procurement ID',           width: 112 },
  { key: 'supplier',    header: 'Supplier',                   width: 164 },
  { key: 'risk',        header: 'Risk Alert',                 width: 100 },
  { key: 'edd',         header: 'Expected Delivery Date',     width: 104 },
  { key: 'totalPo',     header: 'Total PO Amount',            width: 106 },
  { key: 'netPayable',  header: 'Net Payable Amount',         width: 112 },
  { key: 'totalPaid',   header: 'Total Paid Amount',          width: 110 },
  { key: 'balance',     header: 'Balance Amount',             width: 106, groupEnd: true },
  { key: 'warehouse',   header: 'Warehouse',                  width: 176 },
  { key: 'grn',         header: "GRN ID's",                   width: 158 },
  { key: 'qa',          header: "QA ID's",                    width: 158 },
  { key: 'zoho',        header: 'Zohobook Status',            width: 134 },
  { key: 'inspection',  header: 'Physical Inspection Status', width: 190 },
  { key: 'payment',     header: 'Payment Progress Status',    width: 246 },
  { key: 'action',      header: 'Action',                     width: 392 },
];

/**
 * The table's pixel width — the sum of the columns.
 *
 * Computed, never typed out. A hard-coded 3176 would be wrong the first time
 * anyone changes a width, and wrong silently: the table would simply stop
 * lining up with its own colgroup.
 */
export const INVOICE_TABLE_WIDTH = INVOICE_COLUMNS.reduce((sum, c) => sum + c.width, 0);
