// Step 02 · Product Details — PI vs PO mapping with live tax and cost.
// Only three cells are editable (PO product, Qty PO, Rate); everything else is
// carried from the PI or calculated, which is what the legend line says.
// Tax is worked out exactly as the server does on save, so the totals match.
import { lazy, Suspense, useMemo, useState } from 'react';
import { EditSelect, FitInput, FitText } from '../form-fields';
import type { PoLineRow } from '../po-draft';
import type { ProductOpt } from '../use-po-lookups';
import type { TaxMode } from '../../api/po-api';
import type { LineErrors } from '../validation';
import { IcoPencil, IcoPlus, IcoTrash } from '../../shared/icons';
import { useToast } from '../../../../../../contexts/ToastContext';
// The Product Management detail view, opened by "Read more" on a description.
const InspectionProductView = lazy(() => import('../../physical-inspection/InspectionProductView'));
// The product master's Add / Edit wizard, opened by the cell's two buttons.
const AddProductModal = lazy(() => import('../../../../p2p-master-management/product-management/AddProductModal'));
/* Hovering "Read more" starts the same downloads the click needs, so the view
   is already in memory when the click lands. */
const warmProductView = () => {
  void import('../../physical-inspection/InspectionProductView');
  void import('../../../../p2p-master-management/product-management/ProductView');
};

export type LineTotals = {
  base: number;
  cgstAmt: number;
  sgstAmt: number;
  igstAmt: number;
  gstAmt: number;
  withGst: number;
  /** PI quantity still open that this line doesn't cover. */
  missing: number;
  gstPct: number | null;
  cgstPct: number;
  sgstPct: number;
  igstPct: number;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/** The PO product of a row, from the product master. */
export const productOf = (row: PoLineRow, products: ProductOpt[]) =>
  (row.productId != null ? products.find((p) => p.id === row.productId) : undefined);

/** GST % of the ordered product — the product master's, else the PI line's (also from the master). */
export function gstOf(row: PoLineRow, products: ProductOpt[]): number | null {
  const p = productOf(row, products);
  if (p) return p.gst;
  return row.pi && row.productId === row.pi.product_id ? row.pi.gst_pct : null;
}

export function computeLine(row: PoLineRow, products: ProductOpt[], taxMode: TaxMode): LineTotals {
  const gstPct = gstOf(row, products);
  const pct = gstPct ?? 0;
  const base = round2(row.qtyPo * row.rate);
  const gstAmt = round2((base * pct) / 100);
  const inter = taxMode === 'inter';
  const cgstAmt = inter ? 0 : round2(gstAmt / 2);
  const sgstAmt = inter ? 0 : round2(gstAmt - cgstAmt);
  return {
    base,
    cgstAmt,
    sgstAmt,
    igstAmt: inter ? gstAmt : 0,
    gstAmt,
    withGst: round2(base + gstAmt),
    missing: row.pi ? Math.max(0, row.pi.pending_qty - row.qtyPo) : 0,
    gstPct,
    cgstPct: inter ? 0 : pct / 2,
    sgstPct: inter ? 0 : pct / 2,
    igstPct: inter ? pct : 0,
  };
}

export const productLabel = (p: ProductOpt) => `${p.code} — ${p.name}`;

const money = (n: number) => '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 2 });

/* No visible limit: long values end in "…" and show in full on hover
   (FitText / FitInput). The 12-digit ceiling is only a safety net — past ~15
   digits a JavaScript number can't hold the value exactly. */
const QTY_DIGITS = 12;
const RATE_DIGITS = 12;
const plain = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 3 });
const cleanQty = (raw: string) => {
  const [whole = '', frac] = raw.replace(/[^\d.]/g, '').split('.');
  const n = Number(`${whole.slice(0, QTY_DIGITS)}${frac !== undefined ? `.${frac.slice(0, 3)}` : ''}`);
  return Number.isFinite(n) ? n : 0;
};
const cleanRate = (raw: string) => {
  const [whole = '', frac] = raw.replace(/[^\d.]/g, '').split('.');
  const n = Number(`${whole.slice(0, RATE_DIGITS)}${frac !== undefined ? `.${frac.slice(0, 2)}` : ''}`);
  return Number.isFinite(n) ? n : 0;
};

type Props = {
  rows: PoLineRow[];
  products: ProductOpt[];
  taxMode: TaxMode;
  onChange: (index: number, patch: Partial<PoLineRow>) => void;
  onRemove?: (index: number) => void;
  /** A product was added or edited in the master — reload the picker list. */
  onProductsChanged?: () => void;
  /** Per-row cell errors, keyed by row key. */
  errors?: LineErrors;
  /** A PO without a shipment has no PI: its PI columns are left out. */
  standalone?: boolean;
  /** The summary on later steps shows the same table with plain values. */
  readOnly?: boolean;
};

export default function ProductTable({ rows, products, taxMode, onChange, onRemove, onProductsChanged, errors = {}, standalone = false, readOnly }: Props) {
  const options = useMemo(() => products.map(productLabel), [products]);
  // The product whose detail view is open, from "Read more" on its description.
  const [detailId, setDetailId] = useState<number | null>(null);
  /* The product master's own Add / Edit wizard, opened from the two buttons in
     the PO product cell: the pencil edits the line's product, + adds a new one. */
  const [editing, setEditing] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const toast = useToast();
  const inter = taxMode === 'inter';
  const withPi = !standalone;
  // Inter-state is one IGST pair; intra-state splits into CGST + SGST.
  const taxCols = inter ? 1 : 2;
  const colCount = 1 + (withPi ? 1 : 0) + 2 + (withPi ? 3 : 1) + 1 + taxCols + taxCols + 3;
  // Read-only recaps show only what is ordered.
  const shown = readOnly ? rows.filter((r) => r.qtyPo > 0) : rows;
  const lines = shown.map((r) => computeLine(r, products, taxMode));
  const totals = lines.reduce(
    (sum, l, i) => ({
      piQty: sum.piQty + (shown[i].pi?.pi_quantity ?? 0), poQty: sum.poQty + shown[i].qtyPo, miss: sum.miss + l.missing,
      cgst: sum.cgst + l.cgstAmt, sgst: sum.sgst + l.sgstAmt, igst: sum.igst + l.igstAmt,
      base: sum.base + l.base, gst: sum.gst + l.gstAmt, withGst: sum.withGst + l.withGst,
    }),
    { piQty: 0, poQty: 0, miss: 0, cgst: 0, sgst: 0, igst: 0, base: 0, gst: 0, withGst: 0 },
  );

  return (
    <div className="cpd-scroll">
      {detailId != null && (
        <Suspense fallback={null}>
          <InspectionProductView productId={detailId} onClose={() => setDetailId(null)} />
        </Suspense>
      )}
      {/* One wizard, two entry points: with an id it edits that product, with
          none it creates one. It saves to the product master itself. */}
      {(adding || editing != null) && (
        <Suspense fallback={null}>
          <AddProductModal
            productId={editing}
            hideSupplierMapping
            onClose={() => { setAdding(false); setEditing(null); }}
            onSaved={(_id, finalised) => {
              if (!finalised) return;
              toast.success(editing != null ? 'Product updated' : 'Product added', 'Saved in the product master.');
              setAdding(false);
              setEditing(null);
              onProductsChanged?.();
            }}
          />
        </Suspense>
      )}
      <table className={`cpd-tbl cpd-tbl--pd${withPi ? '' : ' cpd-tbl--nopi'}`}>
        <thead>
          <tr className="cpd-grp">
            <th rowSpan={2} className="cpd-stick cpd-stick--1">Sr. No</th>
            {withPi && <th rowSpan={2} className="cpd-stick cpd-stick--2 cpd-th-left">Product (PI)</th>}
            <th colSpan={2}>Purchase Order Entry</th>
            <th colSpan={withPi ? 3 : 1}>{withPi ? 'Quantities' : 'Quantity'}</th>
            <th colSpan={1 + taxCols}>Rate &amp; Tax</th>
            <th colSpan={taxCols + 3}>Amounts</th>
          </tr>
          <tr>
            <th className={`cpd-th-left ${readOnly ? '' : 'cpd-edh'}`}>{withPi ? 'Product (PO)' : 'Product'}</th>
            <th className="cpd-th-left">Description</th>
            {withPi && <th>Qty (PI)</th>}
            <th className={`cpd-th-num ${readOnly ? '' : 'cpd-edh'}`}>{withPi ? 'Qty (PO)' : 'Qty'}</th>
            {withPi && <th>Missing Qty</th>}
            <th className={`cpd-th-num ${readOnly ? '' : 'cpd-edh'}`}>Product Rate</th>
            {inter ? <th>IGST (%)</th> : <><th>CGST (%)</th><th>SGST (%)</th></>}
            {inter
              ? <th className="cpd-th-amt cpd-th-amt--tax">IGST Amount</th>
              : <><th className="cpd-th-amt cpd-th-amt--tax">CGST Amount</th><th className="cpd-th-amt cpd-th-amt--tax">SGST Amount</th></>}
            <th className="cpd-th-amt">Product Cost<span className="cpd-th-sub cpd-th-sub--wo">Without GST</span></th>
            <th className="cpd-th-amt">Total GST Amount</th>
            <th className="cpd-th-amt cpd-th-final">Total Product Cost<span className="cpd-th-sub cpd-th-sub--w">With GST</span></th>
          </tr>
        </thead>

        <tbody>
          {shown.length === 0 && (
            <tr><td colSpan={colCount} className="cpd-empty">No product lines yet{readOnly ? '.' : ' — add one with "+ Add Product Line".'}</td></tr>
          )}
          {shown.map((row, i) => {
            const line = lines[i];
            const po = productOf(row, products);
            const index = rows.indexOf(row);
            const poName = po?.name ?? (row.pi && row.productId === row.pi.product_id ? row.pi.product_name : '') ?? '';
            const hsn = po?.hsn || row.pi?.hsn_code || '—';
            const desc = po?.description || row.pi?.description || '';
            const rowErr = readOnly ? {} : (errors[row.key] ?? {});
            const gstCell = line.gstPct === null
              ? <span className="cpd-miss" title="Set the GST % on the product master">GST not set</span>
              : <>GST <b>{line.gstPct}%</b></>;
            return (
              <tr key={row.key}>
                <td className="cpd-stick cpd-stick--1">{i + 1}</td>
                {withPi && (
                  <td className="cpd-stick cpd-stick--2 cpd-td-left cpd-prodcell">
                    <div className="cpd-prod">
                      {row.pi ? (
                        <>
                          <div className="cpd-prod__nm">{row.pi.product_name}</div>
                          <div className="cpd-prod__meta">
                            {row.pi.product_code && <span className="cpd-code">{row.pi.product_code}</span>}
                            <span className="cpd-kv">HSN <b>{row.pi.hsn_code || '—'}</b></span>
                          </div>
                        </>
                      ) : (
                        <div className="cpd-prod__nm cpd-dash">Not on PI</div>
                      )}
                    </div>
                  </td>
                )}

                <td className={`cpd-td-left cpd-prodcell ${readOnly ? '' : 'cpd-ed'}${rowErr.product ? ' cpd-cell-err' : ''}`}>
                  <div className="cpd-prod">
                  {readOnly ? (
                    <div className="cpd-prod__nm">{poName || '—'}</div>
                  ) : (
                    <div className="cpd-pick">
                      <EditSelect
                        value={po ? productLabel(po) : poName}
                        options={options}
                        placeholder="— Select product —"
                        onChange={(label) => {
                          const picked = products.find((p) => productLabel(p) === label);
                          if (picked) onChange(index, { productId: picked.id, ...(row.pi ? {} : { rate: picked.price }) });
                        }}
                      />
                      <button type="button" className="cpd-iconbtn" title="Edit this product in the product master"
                        disabled={row.productId == null} onClick={() => row.productId != null && setEditing(row.productId)}>
                        <IcoPencil />
                      </button>
                      {!row.pi && onRemove && (
                        <button type="button" className="cpd-iconbtn" title="Remove this line" onClick={() => onRemove(index)}><IcoTrash /></button>
                      )}
                    </div>
                  )}
                  <div className="cpd-prod__meta">
                    {readOnly && po?.code && <span className="cpd-code">{po.code}</span>}
                    <span className="cpd-kv">HSN <b>{hsn}</b></span>
                    <span className="cpd-prod__dot" />
                    <span className="cpd-kv">{gstCell}</span>
                    {!readOnly && (
                      <button type="button" className="cpd-addbtn" title="Add a new product to the master" onClick={() => setAdding(true)}>
                        <IcoPlus />
                      </button>
                    )}
                  </div>
                  {rowErr.product && <div className="cpd-cell-msg">{rowErr.product}</div>}
                  </div>
                </td>

                <td className="cpd-td-left">
                  {desc
                    ? <Description text={desc} onOpen={row.productId ? () => setDetailId(row.productId) : undefined} />
                    : <span className="cpd-dash">—</span>}
                </td>

                {withPi && (
                  <td title={row.pi && row.pi.ordered_qty > 0 ? `${plain(row.pi.ordered_qty)} already on other POs · ${plain(row.pi.pending_qty)} pending` : undefined}>
                    {row.pi ? plain(row.pi.pi_quantity) : '—'}
                  </td>
                )}
                <td className={readOnly ? undefined : `cpd-ed${rowErr.qty ? ' cpd-cell-err' : ''}`}>
                  {readOnly ? <FitText text={plain(row.qtyPo)} /> : (
                    <FitInput
                      className="cpd-in"
                      inputMode="decimal"
                      maxLength={QTY_DIGITS + 4}
                      tooltip={plain(row.qtyPo)}
                      value={row.qtyPo}
                      onChange={(e) => onChange(index, { qtyPo: cleanQty(e.target.value) })}
                    />
                  )}
                  {rowErr.qty && <div className="cpd-cell-msg">{rowErr.qty}</div>}
                </td>
                {withPi && <td className={line.missing > 0 ? 'cpd-miss' : ''}>{row.pi ? plain(line.missing) : '—'}</td>}

                <td className={readOnly ? undefined : `cpd-ed${rowErr.rate ? ' cpd-cell-err' : ''}`}>
                  {readOnly ? <FitText text={money(row.rate)} /> : (
                    <FitInput
                      className="cpd-in"
                      inputMode="decimal"
                      maxLength={RATE_DIGITS + 3}
                      tooltip={money(row.rate)}
                      value={row.rate}
                      onChange={(e) => onChange(index, { rate: cleanRate(e.target.value) })}
                    />
                  )}
                  {rowErr.rate && <div className="cpd-cell-msg">{rowErr.rate}</div>}
                </td>
                {inter ? <td>{line.igstPct}%</td> : <><td>{line.cgstPct}%</td><td>{line.sgstPct}%</td></>}

                {inter
                  ? <td><FitText text={money(line.igstAmt)} /></td>
                  : <><td><FitText text={money(line.cgstAmt)} /></td><td><FitText text={money(line.sgstAmt)} /></td></>}
                <td><FitText text={money(line.base)} /></td>
                <td className="cpd-gst"><FitText text={money(line.gstAmt)} /></td>
                <td className="cpd-final"><FitText text={money(line.withGst)} /></td>
              </tr>
            );
          })}
        </tbody>

        <tfoot>
          <tr>
            {withPi
              ? <><td className="cpd-foot-lbl cpd-stick cpd-stick--1" colSpan={2}>Totals</td><td colSpan={2} /></>
              : <td className="cpd-foot-lbl" colSpan={3}>Totals</td>}
            {withPi && <td>{plain(totals.piQty)}</td>}
            <td><FitText text={plain(totals.poQty)} /></td>
            {withPi && <td>{plain(totals.miss)}</td>}
            <td colSpan={1 + taxCols} />
            {inter
              ? <td><FitText text={money(totals.igst)} /></td>
              : <><td><FitText text={money(totals.cgst)} /></td><td><FitText text={money(totals.sgst)} /></td></>}
            <td><FitText text={money(totals.base)} /></td>
            <td><FitText text={money(totals.gst)} /></td>
            <td className="cpd-final"><FitText text={money(totals.withGst)} /></td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/** Long trade descriptions are clipped to three lines; "Read more" opens the
    product's own detail view rather than unfolding the cell. */
function Description({ text, onOpen }: { text: string; onOpen?: () => void }) {
  return (
    <div className="cpd-desc">
      <span className="cpd-desc__wrap">
        {text}
        {onOpen && (
          <button type="button" className="cpd-more" onClick={onOpen} onPointerEnter={warmProductView} title="Open the product details">
            … Read more
          </button>
        )}
      </span>
    </div>
  );
}
