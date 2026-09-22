// Step 02 · Missing Product Details — PI quantities the PO doesn't cover.
// Nothing is entered here: every row falls out of the table above.
import { computeLine } from './ProductTable';
import type { PoLineRow } from '../po-draft';
import type { ProductOpt } from '../use-po-lookups';
import type { TaxMode } from '../../api/po-api';
import { IcoOk } from '../../shared/icons';

type Props = { rows: PoLineRow[]; products: ProductOpt[]; taxMode: TaxMode };

export default function MissingProducts({ rows, products, taxMode }: Props) {
  const missing = rows
    .map((row) => ({ row, line: computeLine(row, products, taxMode) }))
    .filter((m) => m.row.pi && m.line.missing > 0);

  if (missing.length === 0) {
    return (
      <div className="cpd-miss-empty">
        <IcoOk /> No missing quantities — every pending PI quantity is on this PO.
      </div>
    );
  }

  return (
    <div className="cpd-scroll">
      <table className="cpd-tbl cpd-tbl--miss">
        <thead>
          <tr>
            <th>Sr. No</th>
            <th>Product Code</th>
            <th className="cpd-th-left">Product Name (PI)</th>
            <th>Pending Qty (PI)</th>
          </tr>
        </thead>
        <tbody>
          {missing.map(({ row, line }, i) => {
            const pi = row.pi!;
            return (
              <tr key={row.key}>
                <td>{i + 1}</td>
                <td><span className="cpd-code">{pi.product_code || '—'}</span></td>
                <td className="cpd-td-left cpd-name">{pi.product_name}</td>
                {/* Still not ordered on the PI after this PO and earlier POs. */}
                <td title={`PI quantity ${pi.pi_quantity} · pending before this PO ${pi.pending_qty} · on this PO ${row.qtyPo}`}>
                  <span className="cpd-missqty">{line.missing}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export const missingCount = (rows: PoLineRow[], products: ProductOpt[], taxMode: TaxMode) =>
  rows.filter((r) => r.pi && computeLine(r, products, taxMode).missing > 0).length;
