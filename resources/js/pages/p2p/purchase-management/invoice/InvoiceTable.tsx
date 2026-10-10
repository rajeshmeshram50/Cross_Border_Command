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

interface InvoiceTableProps {
  rows: InvoiceRow[];
  onAction: (action: InvoiceAction, row: InvoiceRow) => void;
  startSr?: number;
  scrollRef?: RefObject<HTMLDivElement | null>;
  loading?: boolean;
}

function InvoiceTableBase({
  rows, onAction, startSr = 0, scrollRef, loading = false,
}: InvoiceTableProps) {
  return (
    <div className="ord-table-scroll" ref={scrollRef}>
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

        {loading
          ? Array.from({ length: 4 }).map((_, r) => (
            <tbody key={r}>
              <tr className="ord-skel-tr">
                {INVOICE_COLUMNS.map(c => (
                  <td key={c.key} className={c.groupEnd ? 'ord-table__group-end' : undefined}>
                    <span className="spi-sk-bar" style={{ width: Math.round(c.width * 0.6) }} />
                  </td>
                ))}
              </tr>
            </tbody>
          ))
          : rows.map((row, i) => (
            <tbody key={row.id}>
              <InvoiceTableRow row={row} index={startSr + i} onAction={onAction} />
            </tbody>
          ))}
      </table>
    </div>
  );
}

export const InvoiceTable = memo(InvoiceTableBase);

function InvoiceTableRowBase({
  row, index, onAction,
}: {
  row: InvoiceRow;
  index: number;
  onAction: (action: InvoiceAction, row: InvoiceRow) => void;
}) {
  const balance = invoiceBalance(row);

  return (
    <tr className="is-first is-last">
      <td><span className="ord-srnum">{index + 1}</span></td>

      <td><IdCell id={row.invoiceNo} date={row.invoiceDate} /></td>

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
