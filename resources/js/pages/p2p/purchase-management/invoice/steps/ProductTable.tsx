import { lazy, memo, Suspense, useCallback, useMemo, useState } from 'react';
import Tooltip from '../../../../../components/ui/Tooltip';
import { MasterSelect } from '../../../../../components/ui/MasterSelect';
import { useToast } from '../../../../../contexts/ToastContext';
import { IcoPencil, IcoPlus } from '../../../icons';
const AddProductModal = lazy(() => import('../../../p2p-master-management/product-management/AddProductModal'));
import ProductDescription, { ProductDetailView } from '../../order/shared/ProductDescription';
import { formatProductCode, lineTotals, tableTotals, type ProductLine, type TaxMode } from '../invoice-products';
import { spiApi } from '../spi-api';

const inr = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = (n: number) => `₹${inr.format(n)}`;

export default function ProductTable({
  lines, onChange, taxMode = 'intra', readOnly = false,
}: {
  lines: ProductLine[];
  onChange: (index: number, patch: Partial<ProductLine>) => void;
  readOnly?: boolean;

  taxMode?: TaxMode;
}) {
  const totals = tableTotals(lines, taxMode);
  const catalogue = useMemo(() => {
    const seen = new Map<string, { value: string; label: string; name: string; productId?: number }>();
    for (const l of lines) {
      if (l.productId == null) continue;
      const value = String(l.productId);
      if (!seen.has(value)) seen.set(value, { value, label: `${l.code} — ${l.poName}`, name: l.poName, productId: l.productId });
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
        carried from the PI or the PO, or calculated.
      </div>

      <div className="cpd-scroll">
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
              <th colSpan={3} className="cpd-stick cpd-grp-stick">3-Way Product Mapping</th>
              <th rowSpan={2} className="cpd-th-left">Description</th>
              <th colSpan={5}>Quantities</th>
              <th colSpan={1}>Purchase Order (PO)</th>
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
                key={line.key ?? line.code} line={line} index={i}
                onChange={onChange} taxMode={taxMode} catalogue={catalogue} readOnly={readOnly}
                onEditProduct={editProduct} onAddProduct={addProduct}
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
                <td />
                <td className="cpd-r">{money(totals.base)}</td>
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

const Row = memo(function Row({
  line, index, onChange, onOpenDetail, onEditProduct, onAddProduct, taxMode, catalogue, readOnly,
}: {
  line: ProductLine;
  index: number;
  onChange: (index: number, patch: Partial<ProductLine>) => void;

  onOpenDetail: (productId: number) => void;
  onEditProduct: (productId: number) => void;
  onAddProduct: () => void;
  taxMode: TaxMode;
  catalogue: Array<{ value: string; label: string; name: string; productId?: number }>;
  readOnly: boolean;
}) {
  const t = lineTotals(line, taxMode);
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
      <td className="cpd-prodcell cpd-td-left">
        <ProdCell name={line.poName} code={line.code} hsn={line.hsn} gst={line.gst} />
      </td>

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
      <td className="cpd-c">{line.poQty}</td>
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

      <td className="cpd-r spi-pocost">{money(t.poCost)}</td>
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
    </tr>
  );
});

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
