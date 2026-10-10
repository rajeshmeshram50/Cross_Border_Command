import { memo, type RefObject } from 'react';
import { formatDmy } from '../../../../utils/formatDmy';
import { INVOICE_COLUMNS, INVOICE_TABLE_WIDTH } from './columns';
import { invoiceBalance, type InvoiceRow } from './types';
import { IdCell } from './cells/IdCell';
import { MoneyCell } from './cells/MoneyCell';
import {
  PoTypePill, DocTypePill, RiskPill, PhysInspBadge, InspectionStatusPill,
} from './cells/Pills';
import { SupplierCell } from './cells/SupplierCell';
import { WarehouseCell } from './cells/WarehouseCell';
import { ChainCell } from './cells/ChainCell';
import { PaymentProgressCell } from './cells/PaymentProgressCell';
import { RowActions, type InvoiceAction } from './cells/RowActions';
import { ZohoCell } from './cells/ZohoCell';

/**
 * The invoice list table.
 *
 * Separate from the page because the page owns state that changes on every
 * keystroke (the search box's value) and the table does not care about it —
 * only about the rows it is handed. Split this way, `memo` on the table means
 * typing re-renders the input, not 22 columns x 60 rows.
 *
 * Step 3 of the build: the plain columns are finished. The composed cells —
 * risk, warehouse, chain ids, statuses, payment progress, actions — render
 * their raw value for now and become real widgets in step 4.
 */
interface InvoiceTableProps {
  rows: InvoiceRow[];
  /**
   * One handler for every row control.
   *
   * It MUST be stable — wrapped in useCallback by the caller. A fresh arrow
   * function on each render would be a new prop value for all 60 rows, which
   * defeats the `memo` on the row and re-renders the whole table on every
   * keystroke. The memoisation and this requirement are one decision.
   */
  onAction: (action: InvoiceAction, row: InvoiceRow) => void;
  /**
   * How many rows came before this page, so the serial number counts on from
   * the previous one instead of restarting at 1. The PO list numbers its own
   * pages the same way.
   */
  startSr?: number;
  /**
   * The scroll box, handed up to the page so `useFitPageSize` can measure it.
   * A ref object keeps the same identity for the life of the page, so passing
   * it through costs the row memoisation nothing.
   */
  scrollRef?: RefObject<HTMLDivElement | null>;
}

function InvoiceTableBase({ rows, onAction, startSr = 0, scrollRef }: InvoiceTableProps) {
  return (
    <div className="ord-table-scroll" ref={scrollRef}>
      {/* `table-layout: fixed` + an explicit width + a colgroup is the whole
          trick behind a 22-column table that does not reflow. The browser lays
          it out from the colgroup alone, without measuring any cell, so one
          long supplier name can never widen a column. */}
      <table className="ord-table" style={{ width: INVOICE_TABLE_WIDTH }}>
        <colgroup>
          {INVOICE_COLUMNS.map(c => <col key={c.key} style={{ width: c.width }} />)}
        </colgroup>

        <thead>
                <tr>
            {INVOICE_COLUMNS.map(c => (
              <th key={c.key} className={c.groupEnd ? 'ord-table__group-end' : undefined} scope="col">
                {c.header}
              </th>
            ))}
          </tr>
        </thead>

        {/* ONE <tbody> PER ROW, which is how the Order list stripes: it shades
            alternate tbody groups with `tbody:nth-of-type(even)`. PO renders a
            tbody per purchase order; an invoice is its own group, so the same
            rule alternates per row and this page needs no striping CSS. */}
        {/* No empty case here on purpose: the page renders its message in
            place of this whole table. A `colSpan` cell inside a fixed-layout
            table 1500px wide centres itself across that width, which puts it
            off-screen and under the horizontal scrollbar. */}
        {rows.map((row, i) => (
          <tbody key={row.id}>
            <InvoiceTableRow row={row} index={startSr + i} onAction={onAction} />
          </tbody>
        ))}
      </table>
    </div>
  );
}

export const InvoiceTable = memo(InvoiceTableBase);

/**
 * One row.
 *
 * Its own memoised component, which is the single most useful optimisation on
 * this page: when the row set changes, React re-renders only the rows whose
 * `row` object actually changed. Rows that survived the filter keep their
 * identity (same object from the same array) and are skipped entirely.
 *
 * `index` is passed for the serial number only. It is deliberately NOT used as
 * the React key — filtering reorders rows, and an index key would make React
 * reuse row 3's DOM for a different invoice.
 */
function InvoiceTableRowBase({
  row, index, onAction,
}: {
  row: InvoiceRow;
  index: number;
  onAction: (action: InvoiceAction, row: InvoiceRow) => void;
}) {
  const balance = invoiceBalance(row);

  /* `is-first is-last`, as the Order list marks a single-line group. Each
     invoice is its own <tbody>, so every row is both the first and the last of
     its group — which is what earns it `.ord-table tr.is-first td`'s 10px top
     padding and the closing border on the chain cells. PO renders a
     one-invoice purchase order exactly this way. */
  return (
    <tr className="is-first is-last">
      <td><span className="ord-srnum">{index + 1}</span></td>

      <td><IdCell id={row.invoiceNo} date={row.invoiceDate} /></td>

      {/* The inspection flag hangs under the PO it belongs to, not in a column
          of its own — it qualifies that order, and the design puts it there. */}
      <td>
        <IdCell id={row.poNo} date={row.poDate} />
        {row.poPhysicalInspection && <PhysInspBadge />}
      </td>

      <td><PoTypePill type={row.poType} /></td>
      <td><DocTypePill type={row.documentType} /></td>

      <td><IdCell id={row.shipmentId} date={row.shipmentDate} /></td>
      <td><IdCell id={row.opportunityId} date={row.opportunityDate} /></td>
      <td><IdCell id={row.procurementId} date={row.procurementDate} /></td>

      <td><SupplierCell name={row.supplierName} category={row.supplierCategory} /></td>
      <td><RiskPill level={row.riskLevel} /></td>

      <td><span className="ord-edd">{formatDmy(row.expectedDeliveryDate)}</span></td>

      <td><MoneyCell value={row.totalPoAmount} /></td>
      <td><MoneyCell value={row.netPayable} tone="net" /></td>
      <td><MoneyCell value={row.totalPaid} tone="paid" /></td>
      <td className="ord-table__group-end"><MoneyCell value={balance} tone="bal" /></td>

      <td><WarehouseCell name={row.warehouseName} kind={row.warehouseKind} /></td>

      {/* The chain reads downstream: the GRN was raised against the invoice,
          the QA against the GRN. */}
      <td className="ord-doc ord-doc--grn"><ChainCell kind="grn" id={row.grnId} date={row.grnDate} against={row.invoiceNo} /></td>
      <td className="ord-doc ord-doc--qa"><ChainCell kind="qa" id={row.qaId} date={row.qaDate} against={row.grnId} /></td>

      <td><ZohoCell row={row} onAction={onAction} /></td>
      <td><InspectionStatusPill status={row.inspectionStatus} /></td>

      <td><PaymentProgressCell row={row} onAction={onAction} /></td>
      <td><RowActions row={row} onAction={onAction} /></td>
    </tr>
  );
}

const InvoiceTableRow = memo(InvoiceTableRowBase);
