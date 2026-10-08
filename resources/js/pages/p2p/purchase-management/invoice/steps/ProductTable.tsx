import { memo, useCallback, useState } from 'react';
import { MasterSelect } from '../../../../../components/ui/MasterSelect';
import { IcoPencil, IcoPlus, IcoTrash } from '../../../icons';
import ProductDescription, { ProductDetailView } from '../../order/shared/ProductDescription';
import { lineTotals, tableTotals, PRODUCT_CATALOGUE, type ProductLine } from '../invoice-products';

/* Built once at module scope. `Intl.NumberFormat` is expensive to construct
   and this table formats roughly ten figures per row. */
const inr = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = (n: number) => `₹${inr.format(n)}`;

/**
 * The 3-way match: PI vs PO vs SPI, one row per product.
 *
 * Only three cells are editable — the SPI product, its quantity and its rate.
 * Everything else is carried from the PI or the PO, or derived, which is what
 * the legend above the table says and what the tinted columns mark.
 *
 * Every class is `cpd-*`, the shared P2P document table the Create PO form
 * already uses. `spi-prodtbl` is the one addition, and it carries only what a
 * three-way match needs that a purchase order does not: the pinned group band,
 * the missing / extra pills and the row delete.
 */
export default function ProductTable({
  lines, onChange, onRemove,
}: {
  lines: ProductLine[];
  onChange: (index: number, patch: Partial<ProductLine>) => void;
  onRemove: (index: number) => void;
}) {
  const totals = tableTotals(lines);
  /* Which product "Read more" opened. Null is closed — one piece of state
     rather than an open flag that could disagree with the id beside it. */
  const [detailId, setDetailId] = useState<number | null>(null);

  return (
    <>
      <div className="cpd-legend">
        <span className="cpd-legend__sw" />
        Tinted cells are editable — SPI product, quantity and rate. Everything else is
        carried from the PI or the PO, or calculated.
      </div>

      {/* The panel scrolls sideways with the first two columns pinned. No
          colgroup on purpose: the columns size to their content, exactly as
          the PO product table does. */}
      <div className="cpd-scroll">
        <ProductDetailView productId={detailId} onClose={() => setDetailId(null)} />
        <table className="cpd-tbl cpd-tbl--pd spi-prodtbl">
          <thead>
            <tr className="cpd-grp">
              <th rowSpan={2} className="cpd-stick cpd-stick--1">Sr. No</th>
              {/* The mapping band covers all three sides of the match, so it
                  starts on the pinned Product (PI) column and stays pinned
                  with it — otherwise its label would slide across a column
                  that is standing still. */}
              <th colSpan={3} className="cpd-stick cpd-grp-stick">3-Way Product Mapping</th>
              <th rowSpan={2} className="cpd-th-left">Description</th>
              <th colSpan={5}>Quantities</th>
              {/* The two sides being reconciled, labelled as such: one PO
                  column to match against, then what the supplier invoiced. */}
              <th colSpan={1}>Purchase Order (PO)</th>
              <th colSpan={5}>Supplier Invoice (SPI)</th>
              <th rowSpan={2}>Action</th>
            </tr>
            <tr>
              <th className="cpd-stick cpd-stick--2 cpd-th-left">Product (PI)</th>
              <th className="cpd-th-left">Product (PO)</th>
              <th className="cpd-th-left cpd-edh">Product (SPI)</th>
              <th>Qty (PI)</th>
              <th>Qty (PO)</th>
              <th className="cpd-c cpd-edh">Qty (SPI)</th>
              <th>Missing Qty</th>
              <th>Extra Qty</th>
              {/* `cpd-th-amt` is what lets a money header wrap. Every other
                  header in this row is held on one line and cut off at 88px,
                  which is why these long labels were reading as "Total Product
                  C" — the purchase order marks its money columns the same way. */}
              <th className="cpd-th-amt">Total Product Cost<span className="cpd-th-sub cpd-th-sub--w">With GST</span></th>
              <th className="cpd-th-amt cpd-c cpd-edh">Product Rate</th>
              <th className="cpd-th-amt">Product Cost<span className="cpd-th-sub cpd-th-sub--wo">Without GST</span></th>
              <th>GST (%)</th>
              <th className="cpd-th-amt cpd-th-amt--tax">Total GST Amount</th>
              <th className="cpd-th-amt cpd-th-final">Total Product Cost<span className="cpd-th-sub cpd-th-sub--w">With GST</span></th>
            </tr>
          </thead>

          <tbody>
            {lines.map((line, i) => (
              <Row
                key={line.code} line={line} index={i}
                onChange={onChange} onRemove={onRemove}
                /* A setState function keeps the same identity for the life of
                   the table, so passing it straight through leaves the rows'
                   memoisation intact. */
                onOpenDetail={setDetailId}
              />
            ))}
          </tbody>

          {lines.length > 0 && (
            <tfoot>
              <tr>
                <td className="cpd-foot-lbl cpd-stick cpd-stick--1" colSpan={2}>Totals</td>
                <td colSpan={3} />
                <td className="cpd-c">{totals.piQty}</td>
                <td className="cpd-c">{totals.poQty}</td>
                <td className="cpd-c">{totals.spiQty}</td>
                <td className="cpd-c">{totals.missing}</td>
                <td className="cpd-c">{totals.extra}</td>
                <td className="cpd-r">{money(totals.poCost)}</td>
                {/* A rate has no meaningful total — summing per-unit prices
                    across different products would be a number with no use. */}
                <td />
                <td className="cpd-r">{money(totals.base)}</td>
                <td />
                <td className="cpd-r">{money(totals.gstAmount)}</td>
                <td className="cpd-r cpd-foot-final">{money(totals.cost)}</td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </>
  );
}

/**
 * One product line.
 *
 * Memoised: the table re-renders on every keystroke in any cell, and without
 * this each of those keystrokes would re-render every other row too.
 */
const Row = memo(function Row({
  line, index, onChange, onRemove, onOpenDetail,
}: {
  line: ProductLine;
  index: number;
  onChange: (index: number, patch: Partial<ProductLine>) => void;
  onRemove: (index: number) => void;
  onOpenDetail: (productId: number) => void;
}) {
  const t = lineTotals(line);

  /* Bound to this row's index so the cells below pass only their value. */
  const patch = useCallback(
    (p: Partial<ProductLine>) => onChange(index, p),
    [index, onChange],
  );

  return (
    <tr>
      <td className="cpd-c cpd-stick cpd-stick--1">{index + 1}</td>
      <td className="cpd-prodcell cpd-stick cpd-stick--2">
        <ProdCell name={line.piName} code={line.code} hsn={line.hsn} gst={line.gst} />
      </td>
      <td className="cpd-prodcell">
        <ProdCell name={line.poName} code={line.code} hsn={line.hsn} gst={line.gst} />
      </td>

      {/* Product (SPI) — the one identity on the row the user may change. */}
      <td className="cpd-prodcell cpd-ed">
        <div className="cpd-prod cpd-prod--po">
          <div className="cpd-pick">
            <MasterSelect
              value={line.code}
              options={PRODUCT_CATALOGUE}
              onChange={() => { /* catalogue swap lands with the endpoint */ }}
            />
            <button type="button" className="cpd-iconbtn" title="Edit this product">
              <IcoPencil />
            </button>
          </div>
          <div className="cpd-prod__meta">
            <span className="cpd-kv">HSN <b>{line.hsn}</b></span>
            <span className="cpd-prod__dot" />
            <span className="cpd-kv">GST <b>{line.gst}%</b></span>
            <button type="button" className="cpd-addbtn" title="Add a product">
              <IcoPlus />
            </button>
          </div>
        </div>
      </td>

      {/* `cpd-td-desc` is the purchase order's own fixed-width description
          cell (260px, locked on all three sides). Without it the column is the
          only one with nothing holding it, so it stretches to the longest
          description and drags the table past the viewport — which is what
          made the text read as a cut-off sentence once the panel scrolled. */}
      <td className="cpd-td-left cpd-td-desc">
        <ProductDescription
          text={line.description}
          /* No product behind the line means nothing to open, so "Read more"
             is not offered rather than offered and dead. */
          onOpen={line.productId == null ? undefined : () => onOpenDetail(line.productId!)}
        />
      </td>

      <td className="cpd-c">{line.piQty}</td>
      <td className="cpd-c">{line.poQty}</td>
      <td className="cpd-c cpd-ed">
        <input
          className="cpd-in cpd-in--num" type="number" min={0}
          value={line.spiQty}
          onChange={e => patch({ spiQty: Number(e.target.value) || 0 })}
        />
      </td>

      {/* Neutral until there is something to flag, so a table of zeroes does
          not read as a table of warnings. */}
      <td className="cpd-c">
        <span className={`cpd-qtypill${t.missing > 0 ? ' cpd-qtypill--miss' : ''}`}>{t.missing}</span>
      </td>
      <td className="cpd-c">
        <span className={`cpd-qtypill${t.extra > 0 ? ' cpd-qtypill--extra' : ''}`}>{t.extra}</span>
      </td>

      <td className="cpd-r spi-pocost">{money(t.poCost)}</td>
      <td className="cpd-r cpd-ed">
        <input
          className="cpd-in cpd-in--num" type="number" min={0} step="0.01"
          value={line.spiRate}
          onChange={e => patch({ spiRate: Number(e.target.value) || 0 })}
        />
      </td>
      <td className="cpd-r">{money(t.base)}</td>
      <td className="cpd-c">{line.gst}%</td>
      <td className="cpd-r">{money(t.gstAmount)}</td>
      <td className="cpd-r">{money(t.cost)}</td>

      <td className="cpd-c">
        <button type="button" className="spi-delrow" title="Remove this line"
          onClick={() => onRemove(index)}>
          <IcoTrash />
        </button>
      </td>
    </tr>
  );
});

/** The PI and PO identity cells: name, then code, HSN and GST underneath. */
function ProdCell({ name, code, hsn, gst }: { name: string; code: string; hsn: string; gst: number }) {
  return (
    <div className="cpd-prod">
      <div className="cpd-prod__nm">{name}</div>
      <div className="cpd-prod__meta">
        <span className="cpd-code">{code}</span>
        <span className="cpd-kv">HSN <b>{hsn}</b></span>
        <span className="cpd-prod__dot" />
        <span className="cpd-kv">GST <b>{gst}%</b></span>
      </div>
    </div>
  );
}
