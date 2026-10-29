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
 *
 * Takes the columns rather than reading the full list, because a tab that
 * drops columns has to drop their width with them or the table reserves room
 * for cells it never draws.
 */
export const invoiceTableWidth = (cols: InvoiceColumn[]) =>
  cols.reduce((sum, c) => sum + c.width, 0);

/* What a Direct SPI has nothing to put in.
 *
 * It is raised against no purchase order, so the order's number, its type,
 * the delivery it promised and the four money columns that reconcile against
 * it are all permanently blank — and a blank column still costs its width,
 * pushing the columns that DO say something off the right of the screen.
 * Physical inspection goes with them: it is a status of the order's goods
 * inspection, which is the PO's workflow.
 *
 * Shipment and Opportunity are not in this list, because a Direct SPI may
 * still carry a shipment; they are dropped by the tab that is defined by not
 * having one, whether or not there is a purchase order. */
const DIRECT_HIDDEN = [
  'poNo', 'poType', 'edd', 'totalPo', 'netPayable', 'totalPaid', 'balance', 'inspection',
] as const;

/* Without a shipment there is no shipment to name and no opportunity behind
   it, so these two print "—" in every row on that tab by definition.
   Procurement stays: it is raised before a shipment exists, so a row can
   carry one without carrying a shipment. */
const NO_SHIPMENT_HIDDEN = ['shipmentId', 'opportunityId'] as const;

/**
 * The columns this tab should show.
 *
 * The two tab rows narrow independently and both can apply at once: the scope
 * drops what has no purchase order behind it, the sub-tab drops what has no
 * shipment behind it.
 *
 * The result is the single source for the colgroup, the head, the width AND
 * which cells a row draws — the keys have to be read from one place or the
 * body quietly drifts out of step with the head it is sitting under.
 */
export function invoiceColumnsFor(
  scope: 'all' | 'with-po' | 'without-po',
  shipScope: 'with-shipment' | 'without-shipment',
): InvoiceColumn[] {
  const hidden = new Set<string>();
  if (scope === 'without-po') DIRECT_HIDDEN.forEach(k => hidden.add(k));
  if (shipScope === 'without-shipment') NO_SHIPMENT_HIDDEN.forEach(k => hidden.add(k));
  if (!hidden.size) return INVOICE_COLUMNS;
  return INVOICE_COLUMNS.filter(c => !hidden.has(c.key));
}
