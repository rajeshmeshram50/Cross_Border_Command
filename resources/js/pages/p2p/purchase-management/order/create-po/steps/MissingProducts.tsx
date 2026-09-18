// Step 02 · Missing Product Details — PI quantities the PO doesn't cover.
// Nothing is entered here: every row falls out of the table above.
import { EditSelect } from '../form-fields';
import { PRODUCT_CATALOGUE } from '../sample-products';
import { computeLine, type PoLineRow } from './ProductTable';
import { IcoOk } from '../../icons';

type Props = {
  rows: PoLineRow[];
  stateCode: string;
  onChange: (index: number, patch: Partial<PoLineRow>) => void;
};

export default function MissingProducts({ rows, stateCode, onChange }: Props) {
  const names = rows.map((r) => r.pi.name);
  const missing = rows
    .map((row, index) => ({ row, index, line: computeLine(row, stateCode) }))
    .filter((m) => m.line.missing > 0);

  if (missing.length === 0) {
    return (
      <div className="cpd-miss-empty">
        <IcoOk /> No missing quantities — every PO quantity meets the PI quantity.
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
            <th>Quantity (PI)</th>
            <th className="cpd-th-left">Product Name (PO)</th>
            <th>Missing Qty</th>
          </tr>
        </thead>
        <tbody>
          {missing.map((m, i) => {
            const po = PRODUCT_CATALOGUE.find((p) => p.code === m.row.poCode) ?? m.row.pi;
            return (
              <tr key={m.row.pi.code}>
                <td>{i + 1}</td>
                <td><span className="cpd-code">{m.row.pi.code}</span></td>
                <td className="cpd-td-left cpd-name">{m.row.pi.name}</td>
                <td>{m.row.pi.qtyPi}</td>
                <td className="cpd-td-left">
                  <EditSelect
                    value={po.name}
                    options={names}
                    onChange={(name) => {
                      const match = rows.find((r) => r.pi.name === name);
                      if (match) onChange(m.index, { poCode: match.pi.code });
                    }}
                  />
                </td>
                <td><span className="cpd-missqty">{m.line.missing}</span></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export const missingCount = (rows: PoLineRow[], stateCode: string) =>
  rows.filter((r) => computeLine(r, stateCode).missing > 0).length;

