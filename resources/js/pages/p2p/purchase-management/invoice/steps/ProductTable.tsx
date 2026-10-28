import { lazy, memo, Suspense, useCallback, useMemo, useState } from 'react';
import Tooltip from '../../../../../components/ui/Tooltip';
import { MasterSelect } from '../../../../../components/ui/MasterSelect';
import { useToast } from '../../../../../contexts/ToastContext';
import { IcoPencil, IcoPlus, IcoTrash } from '../../../icons';
const AddProductModal = lazy(() => import('../../../p2p-master-management/product-management/AddProductModal'));
import ProductDescription, { ProductDetailView } from '../../order/shared/ProductDescription';
import { formatProductCode, lineTotals, MATCH_NAME_MAX, openQtyOf, tableTotals, truncate, type ProductLine, type TaxMode } from '../invoice-products';
import { spiApi } from '../spi-api';

const inr = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = (n: number) => `₹${inr.format(n)}`;

export default function ProductTable({
  lines, onChange, onRemove, taxMode = 'intra', readOnly = false, twoWay = false, sourceNote,
}: {
  lines: ProductLine[];
  onChange: (index: number, patch: Partial<ProductLine>) => void;
  /** Drop a line the supplier did not invoice. Without it the Action column
   *  has nothing to do, so it is not drawn at all. */
  onRemove?: (index: number) => void;
  readOnly?: boolean;

  taxMode?: TaxMode;
  /* Drop the purchase order's three columns — its product, its quantity and
     its cost. A Direct SPI has no purchase order to match against, so the
     match is the shipment's proforma invoice against the supplier's own. */
  twoWay?: boolean;
  /** What the untinted cells came from, named in the legend. */
  sourceNote?: string;
}) {
  const totals = tableTotals(lines, taxMode, twoWay);
  /* The column exists only when there is something behind it and the invoice
     can still be changed — a view-only SPI showing a dead bin is worse than
     no column at all. The last line stays: an invoice with no products is
     not a state this form can save. */
  const canRemove = !!onRemove && !readOnly;
  const catalogue = useMemo(() => {
    const seen = new Map<string, { value: string; label: string; name: string; productId?: number }>();
    for (const l of lines) {
      if (l.productId == null) continue;
      const value = String(l.productId);
      /* The label is cut at the same 30 the PI column beside it uses. The
         select is a fixed-width control in a sticky column, so a long name
         did not wrap or ellipsise — it simply ran past the control. `name`
         stays whole: it is what the line records when a product is picked,
         and what the tooltip has to show. */
      if (!seen.has(value)) {
        seen.set(value, {
          value,
          label: `${l.code} — ${truncate(l.poName, MATCH_NAME_MAX)}`,
          name: l.poName,
          productId: l.productId,
        });
      }
    }
    return [...seen.values()];
  }, [lines]);
  const exportSpi = taxMode === 'export';
  const inter = taxMode === 'inter' || exportSpi;
  const [detailId, setDetailId] = useState<number | null>(null);

  const toast = useToast();
  const [editing, setEditing] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);

  const editProduct = useCallback((productId: number) => setEditing(productId), []);
  const addProduct = useCallback(() => setAdding(true), []);
  const closeProduct = useCallback(() => { setEditing(null); setAdding(false); }, []);

  const refreshProduct = async (productId: number) => {
    try {
      const p = await spiApi.product(productId);
      let touched = 0;
      lines.forEach((l, i) => {
        const patch: Partial<ProductLine> = {};
        if (l.poProductId === productId) {
          Object.assign(patch, {
            code: formatProductCode(p.code) || l.code,
            poName: p.name || l.poName,
            description: p.description,
            hsn: p.hsn || l.hsn,
            gst: p.gst,
            ...(p.uom ? { uom: p.uom } : {}),
          });
        }
        if (l.productId === productId) patch.spiName = p.name || l.spiName;
        if (Object.keys(patch).length) { onChange(i, patch); touched++; }
      });
      toast.success('Product updated', touched
        ? `${formatProductCode(p.code)} — ${p.name} refreshed on this invoice.`
        : 'Saved in the product master.');
    } catch {
      toast.error('Could not refresh the product', 'The changes were saved, but this table could not reload them — reopen the invoice to see them.');
    }
  };

  return (
    <>
      <div className="cpd-legend">
        <span className="cpd-legend__sw" />
        Tinted cells are editable — SPI product, quantity and rate. Everything else is
        carried from {sourceNote ?? (twoWay ? 'the PI' : 'the PI or the PO')}, or calculated.
      </div>

      {/* `--rows` caps the height at about five lines and scrolls the rest.
          Only the invoice's copy of this table takes it; the PO wizard's own
          ProductTable shares the stylesheet but not this modifier. */}
      <div className="cpd-scroll cpd-scroll--rows">
        <ProductDetailView productId={detailId} onClose={() => setDetailId(null)} />

        {(adding || editing != null) && (
          <Suspense fallback={null}>
            <AddProductModal
              productId={editing}
              onClose={closeProduct}
              onSaved={(_id, finalised) => {
                if (!finalised) return;
                const editedId = editing;
                closeProduct();
                if (editedId == null) {
                  toast.success('Product added', 'Saved in the product master.');
                  return;
                }
                void refreshProduct(editedId);
              }}
            />
          </Suspense>
        )}

        <table className="cpd-tbl cpd-tbl--pd spi-prodtbl">
          <thead>
            <tr className="cpd-grp">
              <th rowSpan={2} className="cpd-stick cpd-stick--1">Sr. No</th>
              <th colSpan={twoWay ? 2 : 3} className="cpd-stick cpd-grp-stick">
                {twoWay ? '2-Way Product Mapping' : '3-Way Product Mapping'}
              </th>
              <th rowSpan={2} className="cpd-th-left">Description</th>
              <th colSpan={twoWay ? 4 : 5}>Quantities</th>
              {/* Without a purchase order there is nothing to show under it:
                  the group goes rather than standing empty over the rows. */}
              {!twoWay && <th colSpan={1}>Purchase Order (PO)</th>}
              <th colSpan={4 + 2 * (inter ? 1 : 2)}>Supplier Invoice (SPI)</th>
              {/* Belongs to no group, so it spans both header rows the way
                  Sr. No and Description do. */}
              {canRemove && <th rowSpan={2} className="cpd-c cpd-th-act">Action</th>}
            </tr>
            <tr>
              <th className="cpd-stick cpd-stick--2 cpd-th-left">Product (PI)</th>
              {!twoWay && <th className="cpd-th-left">Product (PO)</th>}
              <th className="cpd-th-left cpd-edh">Product (SPI)</th>
              <th>Qty (PI)</th>
              {!twoWay && <th>Qty (PO)</th>}
              <th className="cpd-c cpd-edh">Qty (SPI)</th>
              <th>Missing Qty</th>
              <th>Extra Qty</th>
              {!twoWay && <th className="cpd-th-amt">Total Product Cost<span className="cpd-th-sub cpd-th-sub--w">With GST</span></th>}
              <th className="cpd-th-amt cpd-c cpd-edh">Product Rate (SPI)</th>
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
                key={line.key ?? line.code} line={line} index={i} twoWay={twoWay}
                onChange={onChange} taxMode={taxMode} catalogue={catalogue} readOnly={readOnly}
                onEditProduct={editProduct} onAddProduct={addProduct}
                onOpenDetail={setDetailId}
                onRemove={canRemove && lines.length > 1 ? onRemove : undefined}
                showAction={canRemove}
              />
            ))}
          </tbody>

          {lines.length > 0 && (
            <tfoot>
              <tr>
                <td className="cpd-foot-lbl cpd-stick cpd-stick--1" colSpan={2}>Totals</td>
                <td colSpan={twoWay ? 2 : 3} />
                <td className="cpd-c">{totals.piQty}</td>
                {!twoWay && <td className="cpd-c">{totals.poQty}</td>}
                <td className="cpd-c">{totals.spiQty}</td>
                <td className="cpd-c">{totals.missing}</td>
                <td className="cpd-c">{totals.extra}</td>
                {!twoWay && <td className="cpd-r">{money(totals.poCost)}</td>}
                <td />
                <td className="cpd-r">{money(totals.base)}</td>
                {inter
                  ? <><td /><td className="cpd-r">{money(totals.igst)}</td></>
                  : <><td /><td /><td className="cpd-r">{money(totals.cgst)}</td>
                    <td className="cpd-r">{money(totals.sgst)}</td></>}
                <td className="cpd-r">{money(totals.gstAmount)}</td>
                <td className="cpd-r cpd-foot-final">{money(totals.cost)}</td>
                {canRemove && <td />}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </>
  );
}

const Row = memo(function Row({
  line, index, onChange, onOpenDetail, onEditProduct, onAddProduct, taxMode, catalogue, readOnly, twoWay,
  onRemove, showAction,
}: {
  line: ProductLine;
  index: number;
  /** Matches the header: no purchase order columns. */
  twoWay: boolean;
  onChange: (index: number, patch: Partial<ProductLine>) => void;

  onOpenDetail: (productId: number) => void;
  onEditProduct: (productId: number) => void;
  onAddProduct: () => void;
  taxMode: TaxMode;
  catalogue: Array<{ value: string; label: string; name: string; productId?: number }>;
  readOnly: boolean;
  /* Undefined on the last remaining line, so the button is drawn but refuses
     - the column stays aligned and the reason is on the hover. */
  onRemove?: (index: number) => void;
  showAction: boolean;
}) {
  const t = lineTotals(line, taxMode, twoWay);
  const inter = taxMode === 'inter' || taxMode === 'export';

  const patch = useCallback(
    (p: Partial<ProductLine>) => onChange(index, p),
    [index, onChange],
  );

  return (
    <tr>
      <td className="cpd-c cpd-stick cpd-stick--1">{index + 1}</td>
      <td className="cpd-prodcell cpd-td-left cpd-stick cpd-stick--2">
        <ProdCell name={line.piName} code={line.piCode ?? line.code} hsn={line.hsn} gst={line.gst} />
      </td>
      {!twoWay && (
        <td className="cpd-prodcell cpd-td-left">
          <ProdCell name={line.poName} code={line.code} hsn={line.hsn} gst={line.gst} />
        </td>
      )}

      <td className="cpd-prodcell cpd-ed">
        <div className="cpd-prod cpd-prod--po">
          <div className="cpd-pick">
            <MasterSelect
              value={line.productId != null ? String(line.productId) : ''}
              options={catalogue}
              disabled={readOnly}
              onChange={v => {
                const pick = catalogue.find(c => c.value === v);
                if (pick) onChange(index, { productId: pick.productId, spiName: pick.name });
              }}
            />
            <Tooltip label={line.productId == null
              ? 'This line is not linked to a product in the master'
              : 'Edit this product in the product master'}>
              <button
                type="button" className="cpd-iconbtn"
                disabled={readOnly || line.productId == null}
                onClick={() => line.productId != null && onEditProduct(line.productId)}
              >
                <IcoPencil />
              </button>
            </Tooltip>
          </div>
          <div className="cpd-prod__meta">
            <span className="cpd-kv">HSN <b>{line.hsn}</b></span>
            <span className="cpd-prod__dot" />
            <span className="cpd-kv">GST <b>{line.gst}%</b></span>
            <Tooltip label="Add a new product to the product master">
              <button
                type="button" className="cpd-addbtn"
                disabled={readOnly}
                onClick={onAddProduct}
              >
                <IcoPlus />
              </button>
            </Tooltip>
          </div>
        </div>
      </td>

      <td className="cpd-td-left cpd-td-desc">
        <ProductDescription
          text={line.description}
          onOpen={line.productId == null ? undefined : () => onOpenDetail(line.productId!)}
        />
      </td>

      <td className="cpd-c">{line.piQty}</td>
      {/* What is still open, not what the order asked for once — a line an
          earlier invoice already covered must not read as outstanding here.
          An over-supply from an earlier invoice shows as 0 open and is named
          in the title: it belongs to the invoice that caused it, not to this
          one. */}
      {!twoWay && (
        <td
          className="cpd-c"
          title={line.poOpenQty !== undefined && line.poBilledQty
            ? `${line.poQty} ordered, ${line.poBilledQty} billed on earlier invoices`
              + (line.poOverQty ? ` — ${line.poOverQty} over` : '')
            : undefined}
        >
          {openQtyOf(line)}
        </td>
      )}
      <td className="cpd-c cpd-ed">
        <input
          className="cpd-in cpd-in--num" type="number" min={0} readOnly={readOnly}
          value={line.spiQty}
          onChange={e => patch({ spiQty: Number(e.target.value) || 0 })}
        />
      </td>

      <td className="cpd-c">
        <span className={`cpd-qtypill${t.missing > 0 ? ' cpd-qtypill--miss' : ''}`}>{t.missing}</span>
      </td>
      <td className="cpd-c">
        <span className={`cpd-qtypill${t.extra > 0 ? ' cpd-qtypill--extra' : ''}`}>{t.extra}</span>
      </td>

      {!twoWay && <td className="cpd-r spi-pocost">{money(t.poCost)}</td>}
      <td className="cpd-r cpd-ed">
        <input
          className="cpd-in cpd-in--num" type="number" min={0} step="0.01" readOnly={readOnly}
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
      {showAction && (
        <td className="cpd-c cpd-td-act">
          <Tooltip label={onRemove
            ? `Remove ${line.spiName || line.piName} from this invoice`
            : 'An invoice needs at least one product'}>
            <button
              type="button" className="cpd-del"
              aria-label={`Remove ${line.spiName || line.piName}`}
              disabled={!onRemove}
              onClick={() => onRemove?.(index)}
            >
              <IcoTrash />
            </button>
          </Tooltip>
        </td>
      )}
    </tr>
  );
});

function ProdCell({ name, code, hsn, gst }: { name: string; code: string; hsn: string; gst: number }) {
  /* Cut long names rather than let them set the column's width. The cell
     wraps on spaces, which is no help at all for the names that cause the
     trouble — the ones written as a single unbroken run. */
  const short = truncate(name, MATCH_NAME_MAX);
  return (
    <div className="cpd-prod">
      <Tooltip label={name} disabled={short === name}>
        <div className="cpd-prod__nm">{short}</div>
      </Tooltip>
      <div className="cpd-prod__meta">
        <span className="cpd-code">{code}</span>
        <span className="cpd-kv">HSN <b>{hsn}</b></span>
        <span className="cpd-prod__dot" />
        <span className="cpd-kv">GST <b>{gst}%</b></span>
      </div>
    </div>
  );
}
