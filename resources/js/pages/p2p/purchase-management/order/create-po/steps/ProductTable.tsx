// Step 02 · Product Details — PI vs PO mapping with live tax and cost.
// Only three cells are editable (PO product, Qty PO, Rate); everything else is
// carried from the PI or calculated, which is what the legend line says.
import { useMemo, useState } from 'react';
import { EditSelect } from '../form-fields';
import { PRODUCT_CATALOGUE, gstSplit, productOption, type ProductLine } from '../sample-products';
import { IcoPencil, IcoPlus } from '../../icons';

export type PoLineRow = {
  pi: ProductLine;
  /** The PO may order a different product, quantity or rate than the PI. */
  poCode: string;
  qtyPo: number;
  rate: number;
};

export type LineTotals = {
  base: number;
  cgstAmt: number;
  sgstAmt: number;
  gstAmt: number;
  withGst: number;
  missing: number;
  cgstPct: number;
  sgstPct: number;
};

export function computeLine(row: PoLineRow, stateCode: string): LineTotals {
  const po = PRODUCT_CATALOGUE.find((p) => p.code === row.poCode) ?? row.pi;
  const { cgst, sgst } = gstSplit(po.gst, stateCode);
  const base = row.qtyPo * row.rate;
  const cgstAmt = (base * cgst) / 100;
  const sgstAmt = (base * sgst) / 100;
  return {
    base,
    cgstAmt,
    sgstAmt,
    gstAmt: cgstAmt + sgstAmt,
    withGst: base + cgstAmt + sgstAmt,
    missing: Math.max(0, row.pi.qtyPi - row.qtyPo),
    cgstPct: cgst,
    sgstPct: sgst,
  };
}

const money = (n: number) => '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 2 });

type Props = {
  rows: PoLineRow[];
  stateCode: string;
  onChange: (index: number, patch: Partial<PoLineRow>) => void;
  /** The summary on later steps shows the same table with plain values. */
  readOnly?: boolean;
};

export default function ProductTable({ rows, stateCode, onChange, readOnly }: Props) {
  const options = useMemo(() => PRODUCT_CATALOGUE.map(productOption), []);
  const lines = rows.map((r) => computeLine(r, stateCode));
  const totals = lines.reduce(
    (sum, l) => ({
      piQty: sum.piQty, poQty: sum.poQty, miss: sum.miss + l.missing,
      cgst: sum.cgst + l.cgstAmt, sgst: sum.sgst + l.sgstAmt,
      base: sum.base + l.base, gst: sum.gst + l.gstAmt, withGst: sum.withGst + l.withGst,
    }),
    {
      piQty: rows.reduce((t, r) => t + r.pi.qtyPi, 0),
      poQty: rows.reduce((t, r) => t + r.qtyPo, 0),
      miss: 0, cgst: 0, sgst: 0, base: 0, gst: 0, withGst: 0,
    },
  );

  return (
    <div className="cpd-scroll">
      <table className="cpd-tbl cpd-tbl--pd">
        <thead>
          <tr className="cpd-grp">
            <th rowSpan={2} className="cpd-stick cpd-stick--1">Sr. No</th>
            <th rowSpan={2} className="cpd-stick cpd-stick--2 cpd-th-left">Product (PI)</th>
            <th colSpan={2}>Purchase Order Entry</th>
            <th colSpan={3}>Quantities</th>
            <th colSpan={3}>Rate &amp; Tax</th>
            <th colSpan={5}>Amounts</th>
          </tr>
          <tr>
            <th className={`cpd-th-left ${readOnly ? '' : 'cpd-edh'}`}>Product (PO)</th>
            <th className="cpd-th-left">Description</th>
            <th>Qty (PI)</th>
            <th className={readOnly ? undefined : 'cpd-edh'}>Qty (PO)</th>
            <th>Missing Qty</th>
            <th className={readOnly ? undefined : 'cpd-edh'}>Product Rate</th>
            <th>CGST (%)</th>
            <th>SGST (%)</th>
            <th>CGST Amount</th>
            <th>SGST Amount</th>
            <th>Product Cost<span className="cpd-th-sub">Without GST</span></th>
            <th>Total GST Amount</th>
            <th className="cpd-th-final">Total Product Cost<span className="cpd-th-sub">With GST</span></th>
          </tr>
        </thead>

        <tbody>
          {rows.map((row, i) => {
            const line = lines[i];
            const po = PRODUCT_CATALOGUE.find((p) => p.code === row.poCode) ?? row.pi;
            return (
              <tr key={row.pi.code}>
                <td className="cpd-stick cpd-stick--1">{i + 1}</td>
                <td className="cpd-stick cpd-stick--2 cpd-td-left cpd-prodcell">
                  <div className="cpd-prod">
                  <div className="cpd-prod__nm">{row.pi.name}</div>
                  <div className="cpd-prod__meta">
                    <span className="cpd-code">{row.pi.code}</span>
                    <span className="cpd-kv">HSN <b>{row.pi.hsn}</b></span>
                    <span className="cpd-prod__dot" />
                    <span className="cpd-kv">GST <b>{line.cgstPct + line.sgstPct}%</b></span>
                  </div>
                  </div>
                </td>

                <td className={`cpd-td-left cpd-prodcell ${readOnly ? '' : 'cpd-ed'}`}>
                  <div className="cpd-prod">
                  {readOnly ? (
                    <div className="cpd-prod__nm">{po.name}</div>
                  ) : (
                    <div className="cpd-pick">
                      <EditSelect
                        value={productOption(po)}
                        options={options}
                        onChange={(v) => onChange(i, { poCode: v.split(' — ')[0] })}
                      />
                      <button type="button" className="cpd-iconbtn" title="Edit this product"><IcoPencil /></button>
                    </div>
                  )}
                  <div className="cpd-prod__meta">
                    {readOnly && <span className="cpd-code">{po.code}</span>}
                    <span className="cpd-kv">HSN <b>{po.hsn}</b></span>
                    <span className="cpd-prod__dot" />
                    <span className="cpd-kv">GST <b>{line.cgstPct + line.sgstPct}%</b></span>
                    {!readOnly && <button type="button" className="cpd-addbtn" title="Add another PO line"><IcoPlus /></button>}
                  </div>
                  </div>
                </td>

                <td className="cpd-td-left"><Description text={po.description} /></td>

                <td>{row.pi.qtyPi}</td>
                <td className={readOnly ? undefined : 'cpd-ed'}>
                  {readOnly ? row.qtyPo : (
                    <input
                      className="cpd-in"
                      value={row.qtyPo}
                      onChange={(e) => onChange(i, { qtyPo: Number(e.target.value.replace(/[^\d]/g, '')) || 0 })}
                    />
                  )}
                </td>
                <td className={line.missing > 0 ? 'cpd-miss' : ''}>{line.missing}</td>

                <td className={readOnly ? undefined : 'cpd-ed'}>
                  {readOnly ? money(row.rate) : (
                    <input
                      className="cpd-in"
                      value={row.rate}
                      onChange={(e) => onChange(i, { rate: Number(e.target.value.replace(/[^\d.]/g, '')) || 0 })}
                    />
                  )}
                </td>
                <td>{line.cgstPct}%</td>
                <td>{line.sgstPct}%</td>

                <td>{money(line.cgstAmt)}</td>
                <td>{money(line.sgstAmt)}</td>
                <td>{money(line.base)}</td>
                <td className="cpd-gst">{money(line.gstAmt)}</td>
                <td className="cpd-final">{money(line.withGst)}</td>
              </tr>
            );
          })}
        </tbody>

        <tfoot>
          <tr>
            <td className="cpd-foot-lbl cpd-stick cpd-stick--1" colSpan={2}>Totals</td>
            <td colSpan={2} />
            <td>{totals.piQty}</td>
            <td>{totals.poQty}</td>
            <td>{totals.miss}</td>
            <td colSpan={3} />
            <td>{money(totals.cgst)}</td>
            <td>{money(totals.sgst)}</td>
            <td>{money(totals.base)}</td>
            <td>{money(totals.gst)}</td>
            <td className="cpd-final">{money(totals.withGst)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/** Long trade descriptions are clipped to three lines until "Read more". */
function Description({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="cpd-desc">
      <span className={`cpd-desc__wrap ${open ? 'is-open' : ''}`}>
        {text}
        <button type="button" className="cpd-more" onClick={() => setOpen((o) => !o)}>
          {open ? 'Show less' : '… Read more'}
        </button>
      </span>
    </div>
  );
}

