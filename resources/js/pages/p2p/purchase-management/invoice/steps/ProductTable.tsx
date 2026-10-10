import { lazy, memo, Suspense, useCallback, useState } from 'react';
import { MasterSelect } from '../../../../../components/ui/MasterSelect';
import { useToast } from '../../../../../contexts/ToastContext';
import { IcoPencil, IcoPlus } from '../../../icons';
/* The product master's own wizard, which is what the pencil and the plus open
   on the purchase order's product table too. Lazy because it is a large form
   that most visits to this step never open. */
const AddProductModal = lazy(() => import('../../../p2p-master-management/product-management/AddProductModal'));
import ProductDescription, { ProductDetailView } from '../../order/shared/ProductDescription';
import { lineTotals, tableTotals, PRODUCT_CATALOGUE, type ProductLine, type TaxMode } from '../invoice-products';

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
  lines, onChange, taxMode = 'intra',
}: {
  lines: ProductLine[];
  onChange: (index: number, patch: Partial<ProductLine>) => void;

  /** How this supplier's GST splits — see `taxModeFor`. */
  taxMode?: TaxMode;
}) {
  const totals = tableTotals(lines, taxMode);
  /* The tax columns swap rather than a single column explaining itself, which
     is how the purchase order's own table reads: one IGST pair inter-state,
     a CGST + SGST pair intra-state, and one Tax pair at 0% on an import.
     create-po/steps/ProductTable.tsx does exactly this. */
  const exportSpi = taxMode === 'export';
  const inter = taxMode === 'inter' || exportSpi;
  /* Which product "Read more" opened. Null is closed — one piece of state
     rather than an open flag that could disagree with the id beside it. */
  const [detailId, setDetailId] = useState<number | null>(null);

  const toast = useToast();
  /* The product wizard has two entry points and one component: an id edits
     that product, no id creates one. Two pieces of state rather than one,
     because `null` already means "not editing" and would otherwise have to
     mean "adding" as well. */
  const [editing, setEditing] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);

  /* Stable, so the memoised rows are not re-rendered by the buttons they own. */
  const editProduct = useCallback((productId: number) => setEditing(productId), []);
  const addProduct = useCallback(() => setAdding(true), []);
  const closeProduct = useCallback(() => { setEditing(null); setAdding(false); }, []);

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

        {/* Saved straight into the product master, exactly as the purchase
            order's table saves it. The line is not re-pointed afterwards: the
            three-way match's rows come from the PI and the PO, so swapping the
            product a line refers to is the picker's job, not the wizard's. */}
        {(adding || editing != null) && (
          <Suspense fallback={null}>
            <AddProductModal
              productId={editing}
              onClose={closeProduct}
              onSaved={(_id, finalised) => {
                if (!finalised) return;
                toast.success(
                  editing != null ? 'Product updated' : 'Product added',
                  'Saved in the product master.',
                );
                closeProduct();
              }}
            />
          </Suspense>
        )}

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
              {/* Rate, cost-without-GST, the tax pair twice over (% then
                  amount), the GST total and the final cost. The tax pair is
                  one column inter-state and two intra, so the band has to
                  count them rather than assume. */}
              <th colSpan={4 + 2 * (inter ? 1 : 2)}>Supplier Invoice (SPI)</th>
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
              {inter
                ? <th>{exportSpi ? 'Tax (%)' : 'IGST (%)'}</th>
                : <><th>CGST (%)</th><th>SGST (%)</th></>}
              {inter
                ? <th className="cpd-th-amt cpd-th-amt--tax">{exportSpi ? 'Tax Amount' : 'IGST Amount'}</th>
                : <><th className="cpd-th-amt cpd-th-amt--tax">CGST Amount</th>
                  <th className="cpd-th-amt cpd-th-amt--tax">SGST Amount</th></>}
              <th className="cpd-th-amt cpd-th-amt--tax">Total GST Amount</th>
              <th className="cpd-th-amt cpd-th-final">Total Product Cost<span className="cpd-th-sub cpd-th-sub--w">With GST</span></th>
            </tr>
          </thead>

          <tbody>
            {lines.map((line, i) => (
              <Row
                key={line.code} line={line} index={i}
                onChange={onChange} taxMode={taxMode}
                onEditProduct={editProduct} onAddProduct={addProduct}
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
                {/* A rate has no total; the amounts beside it do. */}
                {inter
                  ? <><td /><td className="cpd-r">{money(totals.igst)}</td></>
                  : <><td /><td /><td className="cpd-r">{money(totals.cgst)}</td>
                    <td className="cpd-r">{money(totals.sgst)}</td></>}
                <td className="cpd-r">{money(totals.gstAmount)}</td>
                <td className="cpd-r cpd-foot-final">{money(totals.cost)}</td>
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
  line, index, onChange, onOpenDetail, onEditProduct, onAddProduct, taxMode,
}: {
  line: ProductLine;
  index: number;
  onChange: (index: number, patch: Partial<ProductLine>) => void;

  onOpenDetail: (productId: number) => void;
  /** Opens the product master's wizard on this line's product. */
  onEditProduct: (productId: number) => void;
  /** Opens the same wizard with nothing in it, to create a product. */
  onAddProduct: () => void;
  taxMode: TaxMode;
}) {
  const t = lineTotals(line, taxMode);
  /* Same join the header makes: an import rides the single-column path at 0%. */
  const inter = taxMode === 'inter' || taxMode === 'export';

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
            {/* Disabled rather than hidden when the line has no product
                behind it: there is nothing to edit, and a button that opens an
                empty edit form is worse than one that says it cannot. */}
            <button
              type="button" className="cpd-iconbtn"
              title={line.productId == null
                ? 'This line is not linked to a product in the master'
                : 'Edit this product in the product master'}
              disabled={line.productId == null}
              onClick={() => line.productId != null && onEditProduct(line.productId)}
            >
              <IcoPencil />
            </button>
          </div>
          <div className="cpd-prod__meta">
            <span className="cpd-kv">HSN <b>{line.hsn}</b></span>
            <span className="cpd-prod__dot" />
            <span className="cpd-kv">GST <b>{line.gst}%</b></span>
            <button
              type="button" className="cpd-addbtn"
              title="Add a new product to the product master"
              onClick={onAddProduct}
            >
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
      {inter
        ? <td className="cpd-c">{t.igstPct}%</td>
        : <><td className="cpd-c">{t.cgstPct}%</td><td className="cpd-c">{t.sgstPct}%</td></>}
      {inter
        ? <td className="cpd-r">{money(t.igst)}</td>
        : <><td className="cpd-r">{money(t.cgst)}</td><td className="cpd-r">{money(t.sgst)}</td></>}
      <td className="cpd-r">{money(t.gstAmount)}</td>
      <td className="cpd-r">{money(t.cost)}</td>
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
