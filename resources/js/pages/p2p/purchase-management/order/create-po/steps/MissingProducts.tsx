// Step 02 · Missing Product Details — PI quantities the PO doesn't cover.
// Nothing is entered here: every row falls out of the table above.
import { computeLine, productOf } from './ProductTable';
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
            <th className="cpd-th-left">Product Name (PO)</th>
            <th>Missing Qty</th>
          </tr>
        </thead>
        <tbody>
          {missing.map(({ row, line }, i) => {
            const pi = row.pi!;
            const poName = productOf(row, products)?.name ?? (row.productId === pi.product_id ? pi.product_name : null);
            return (
              <tr key={row.key}>
                <td>{i + 1}</td>
                <td><span className="cpd-code">{pi.product_code || '—'}</span></td>
                <td className="cpd-td-left cpd-name">{pi.product_name}</td>
                <td>{pi.pending_qty}</td>
                <td className="cpd-td-left">{row.qtyPo > 0 ? (poName || '—') : <span className="cpd-dash">Not ordered</span>}</td>
                <td><span className="cpd-missqty">{line.missing}</span></td>
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
