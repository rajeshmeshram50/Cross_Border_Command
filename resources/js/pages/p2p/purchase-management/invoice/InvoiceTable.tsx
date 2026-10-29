import { memo, useMemo, type RefObject } from 'react';
import { formatDmy } from '../../../../utils/formatDmy';
import { INVOICE_COLUMNS, invoiceTableWidth, type InvoiceColumn } from './columns';
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

interface InvoiceTableProps {
  rows: InvoiceRow[];
  onAction: (action: InvoiceAction, row: InvoiceRow) => void;
  startSr?: number;
  scrollRef?: RefObject<HTMLDivElement | null>;
  loading?: boolean;
  /** The tab's columns. Defaults to all of them. */
  columns?: InvoiceColumn[];
  /** Shown in the body when there are no rows. The reason differs by tab and
   *  by whether a search is running, so the caller supplies the words. */
  emptyTitle?: string;
  emptyNote?: string;
}

function InvoiceTableBase({
  rows, onAction, startSr = 0, scrollRef, loading = false, columns = INVOICE_COLUMNS,
  emptyTitle, emptyNote,
}: InvoiceTableProps) {
  /* The head, the colgroup, the width and every row's cells all read this one
     set. Letting the body decide separately is how a table ends up with its
     values one column left of their headings. */
  const shown = useMemo(() => new Set(columns.map(c => c.key)), [columns]);
  const width = useMemo(() => invoiceTableWidth(columns), [columns]);

  return (
    <div className="ord-table-scroll" ref={scrollRef}>
      <table className={`ord-table${rows.length === 0 && !loading ? ' ord-table--empty' : ''}`} style={{ width }}>
        <colgroup>
          {columns.map(c => <col key={c.key} style={{ width: c.width }} />)}
        </colgroup>

        <thead>
                <tr>
            {columns.map(c => (
              <th key={c.key} className={c.groupEnd ? 'ord-table__group-end' : undefined} scope="col">
                {c.header}
              </th>
            ))}
          </tr>
        </thead>

        {loading
          ? Array.from({ length: 4 }).map((_, r) => (
            <tbody key={r}>
              <tr className="ord-skel-tr">
                {columns.map(c => (
                  <td key={c.key} className={c.groupEnd ? 'ord-table__group-end' : undefined}>
                    <span className="spi-sk-bar" style={{ width: Math.round(c.width * 0.6) }} />
                  </td>
                ))}
              </tr>
            </tbody>
          ))
          : rows.length === 0
            ? (
              /* The empty state belongs INSIDE the table, not in place of it.
                 Replacing the whole table left a sentence floating in white
                 space with no column headings and nothing to say what was
                 empty — the list looked broken rather than unfilled. Keeping
                 the head and the pager, and putting the message in the body,
                 is how every other list in the app reads when it has nothing
                 to show. */
              <tbody>
                <tr className="ord-emptyrow">
                  <td colSpan={columns.length}>
                    <div className="ord-emptybox">
                      <b>{emptyTitle ?? 'No entries yet'}</b>
                      {emptyNote && <span>{emptyNote}</span>}
                    </div>
                  </td>
                </tr>
              </tbody>
            )
            : rows.map((row, i) => (
              <tbody key={row.id}>
                <InvoiceTableRow row={row} index={startSr + i} onAction={onAction} shown={shown} />
              </tbody>
            ))}
      </table>
    </div>
  );
}

export const InvoiceTable = memo(InvoiceTableBase);

function InvoiceTableRowBase({
  row, index, onAction, shown,
}: {
  row: InvoiceRow;
  index: number;
  onAction: (action: InvoiceAction, row: InvoiceRow) => void;
  /** The column keys this tab draws — the same set the head was built from. */
  shown: Set<string>;
}) {
  const balance = invoiceBalance(row);
  const on = (key: string) => shown.has(key);

  return (
    <tr className="is-first is-last">
      <td><span className="ord-srnum">{index + 1}</span></td>

      <td><IdCell id={row.invoiceNo} date={row.invoiceDate} /></td>

      {on('poNo') && (
        <td>
          <IdCell id={row.poNo} date={row.poDate} />
          {row.poPhysicalInspection && <PhysInspBadge />}
        </td>
      )}

      {on('poType') && <td><PoTypePill type={row.poType} /></td>}
      <td><DocTypePill type={row.documentType} /></td>

      {on('shipmentId') && <td><IdCell id={row.shipmentId} date={row.shipmentDate} /></td>}
      {on('opportunityId') && <td><IdCell id={row.opportunityId} date={row.opportunityDate} /></td>}
      {on('procurementId') && <td><IdCell id={row.procurementId} date={row.procurementDate} /></td>}

      <td><SupplierCell name={row.supplierName} category={row.supplierCategory} /></td>
      <td><RiskPill level={row.riskLevel} /></td>

      {on('edd') && <td><span className="ord-edd">{formatDmy(row.expectedDeliveryDate)}</span></td>}

      {on('totalPo') && <td><MoneyCell value={row.totalPoAmount} /></td>}
      {on('netPayable') && <td><MoneyCell value={row.netPayable} tone="net" /></td>}
      {on('totalPaid') && <td><MoneyCell value={row.totalPaid} tone="paid" /></td>}
      {on('balance') && <td className="ord-table__group-end"><MoneyCell value={balance} tone="bal" /></td>}

      <td><WarehouseCell name={row.warehouseName} kind={row.warehouseKind} /></td>

      <td className="ord-doc ord-doc--grn"><ChainCell kind="grn" id={row.grnId} date={row.grnDate} against={row.invoiceNo} /></td>
      <td className="ord-doc ord-doc--qa"><ChainCell kind="qa" id={row.qaId} date={row.qaDate} against={row.grnId} /></td>

      <td><ZohoCell row={row} onAction={onAction} /></td>
      {on('inspection') && <td><InspectionStatusPill status={row.inspectionStatus} /></td>}

      <td><PaymentProgressCell row={row} onAction={onAction} /></td>
      <td><RowActions row={row} onAction={onAction} /></td>
    </tr>
  );
}

const InvoiceTableRow = memo(InvoiceTableRowBase);
