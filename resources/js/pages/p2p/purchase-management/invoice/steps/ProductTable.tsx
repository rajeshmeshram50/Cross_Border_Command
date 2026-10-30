import { lazy, memo, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Tooltip from '../../../../../components/ui/Tooltip';
import { MasterSelect } from '../../../../../components/ui/MasterSelect';
import { useToast } from '../../../../../contexts/ToastContext';
import { useConfirm } from '../../../../../contexts/ConfirmContext';
import { IcoPencil, IcoPlus, IcoTrash } from '../../../icons';
const AddProductModal = lazy(() => import('../../../p2p-master-management/product-management/AddProductModal'));
import ProductDescription, { ProductDetailView } from '../../order/shared/ProductDescription';
import { formatProductCode, lineTotals, MATCH_NAME_MAX, openQtyOf, tableTotals, truncate, withoutCodePrefix, type ProductLine, type TaxMode } from '../invoice-products';
import { spiApi } from '../spi-api';
import { poLookupApi } from '../../order/api/po-api';
import { toProduct, type ProductOpt } from '../../order/create-po/use-po-lookups';

const inr = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = (n: number) => `₹${inr.format(n)}`;

export default function ProductTable({
  lines, onChange, onRemove, taxMode = 'intra', readOnly = false, twoWay = false, matched = true, sourceNote, hasPi = true,
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
  /* Whether there is a proforma invoice on the other side of this table.
     An "All Other's" Direct SPI belongs to no shipment, so there is no PI to
     match against and the match columns - the PI product, its quantity, and
     the missing/extra it implies - have nothing to put in them. Showing them
     empty reads as a match that found nothing rather than a match that was
     never possible. */
  matched?: boolean;
  hasPi?: boolean;
  /** What the untinted cells came from, named in the legend. */
  sourceNote?: string;
}) {
  const totals = tableTotals(lines, taxMode, twoWay);
  /* The column exists only when there is something behind it and the invoice
     can still be changed — a view-only SPI showing a dead bin is worse than
     no column at all. The last line stays: an invoice with no products is
     not a state this form can save. */
  const canRemove = !!onRemove && !readOnly;
  /* Product columns before the SPI one: the PI's, and the PO's on a 3-way.
     The group header spans this many plus the SPI column itself, and the
     footer skips this many plus Description before the first figure — writing
     the count once is what keeps the three in step when a column is dropped. */
  const showPi = matched && hasPi;
  const matchCols = (showPi ? 1 : 0) + (twoWay ? 0 : 1);

  /* The line comes off the invoice and, with it, out of the boxes and the
     put-away that are built from these lines downstream — so it asks first,
     naming the product and what the totals become, the way the box step asks
     before unpacking one.
     It is no longer irreversible: the banner under the table restores it, and
     the dialog says so rather than sending the reader off to reopen the
     invoice against the PI, which is what it used to advise. */
  const confirm = useConfirm();
  /* Declared here, not further down with the modal state: `askRemove` names it
     in its dependency array, and a `const` read above its own declaration
     throws on render rather than on the click. */
  const toast = useToast();
  const askRemove = useCallback(async (index: number) => {
    const line = lines[index];
    if (!line || !onRemove) return;
    const name = line.spiName || line.piName;
    const after = tableTotals(lines.filter((_, i) => i !== index), taxMode, twoWay);
    const ok = await confirm({
      title: `Remove ${name} from this invoice?`,
      message: <>It comes off the product match, and the invoice total drops from{' '}
        <strong>{money(totals.cost)}</strong> to <strong>{money(after.cost)}</strong>.{' '}
        You can put it back with <strong>Restore</strong>, under the table.</>,
      tone: 'danger',
      confirmLabel: 'Remove it',
    });
    if (!ok) return;
    onRemove(index);
    /* Names what left. The banner says how many are missing; this says which
       one just went, which is the half a count cannot carry. */
    toast.info('Removed', name);
  }, [confirm, lines, onRemove, taxMode, toast, twoWay, totals.cost]);
  /* The product master, for lines that are not on the table.
   *
   * The catalogue below used to be built from `lines` alone, which works only
   * while every product you could want is already on a row. It stopped working
   * the moment the Action column could remove one: the removed product left
   * the catalogue with it, so "Add Product" would have offered a list without
   * the very thing you were trying to put back. A line added from scratch has
   * no product at all, and would have had nothing to choose from.
   *
   * Not loaded when read-only — nothing can be picked there. */
  const [master, setMaster] = useState<ProductOpt[]>([]);
  const needsNames = lines.some(l => l.productId != null && !l.code);
  const wantMaster = !readOnly || needsNames;
  useEffect(() => {
    if (!wantMaster) return;
    let live = true;
    poLookupApi.products()
      .then(rows => { if (live) setMaster(rows.map(toProduct).filter(p => p.id && p.name)); })
      /* A master that will not load leaves the lines' own products, which is
         what this table had before and is enough to remap an existing row. */
      .catch(() => {});
    return () => { live = false; };
  }, [wantMaster]);

  const catalogue = useMemo(() => {
    const seen = new Map<string, { value: string; label: string; name: string; productId?: number; master?: ProductOpt }>();
    for (const l of lines) {
      const lineName = l.poName || l.spiName;
      if (l.productId == null || (!l.code && !lineName)) continue;
      const value = String(l.productId);
      /* The label is cut at the same 30 the PI column beside it uses. The
         select is a fixed-width control in a sticky column, so a long name
         did not wrap or ellipsise — it simply ran past the control. `name`
         stays whole: it is what the line records when a product is picked,
         and what the tooltip has to show. */
      if (!seen.has(value)) {
        seen.set(value, {
          value,
          label: `${formatProductCode(l.code)} — ${truncate(lineName, MATCH_NAME_MAX)}`,
          name: lineName,
          productId: l.productId,
        });
      }
    }
    /* The lines go in first and keep their entry: their label is the one the
       rest of the row is already showing. The master only adds what is
       missing — and carries the row it came from, so a blank line can fill
       its code, HSN, GST and description from the same pick. */
    for (const p of master) {
      const value = String(p.id);
      const existing = seen.get(value);
      if (existing) { existing.master = p; continue; }
      seen.set(value, {
        value,
        /* The lines above arrive with the code already stripped from their
           name (withoutCodePrefix, where they are built from the PI/PO). The
           master's own names have not been through that, and some of them do
           carry their code — "P-01 – Cooking Oil" — which would print it
           twice here and make the two halves of this one dropdown disagree. */
        label: `${formatProductCode(p.code)} — ${truncate(withoutCodePrefix(p.name, p.code), MATCH_NAME_MAX)}`,
        name: p.name,
        productId: p.id,
        master: p,
      });
    }
    return [...seen.values()];
  }, [lines, master]);

  useEffect(() => {
    if (!master.length) return;
    const byId = new Map(master.map(p => [p.id, p]));
    lines.forEach((l, i) => {
      if (l.productId == null || l.code) return;
      const p = byId.get(l.productId);
      if (!p || !p.code) return;
      const name = withoutCodePrefix(p.name, p.code);
      onChange(i, {
        code: formatProductCode(p.code),
        hsn: l.hsn || p.hsn,
        piName: l.piName || name, poName: l.poName || name, spiName: l.spiName || name,
        description: l.description || p.description,
      });
    });
  }, [master, lines, onChange]);
  const duplicateOf = useCallback(
    (productId: number, at: number) => lines.some((l, j) => j !== at && l.productId === productId),
    [lines],
  );
  const exportSpi = taxMode === 'export';
  const inter = taxMode === 'inter' || exportSpi;
  const [detailId, setDetailId] = useState<number | null>(null);

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
        {/* With no PI there is nothing the untinted cells are "carried from",
            so the sentence would have named a document this invoice has no
            connection to. They are calculated, and that is all. */}
        {matched
          ? <>Tinted cells are editable — SPI product, quantity and rate. Everything else is
            carried from {sourceNote ?? (twoWay ? 'the PI' : 'the PI or the PO')}, or calculated.</>
          : <>Tinted cells are editable — SPI product, quantity and rate. Costs and GST are calculated.</>}
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
              {/* The band is split so the PINNED half is exactly as wide as
                  the column that is actually pinned.
                  It carries `position: sticky; left: 42px`, but it used to
                  span every product column while only ONE of them - the
                  Product column at .cpd-stick--2 - is pinned. A sticky cell
                  keeps the width of its whole span, so on scroll it stood
                  still at some 470px while just 232px of column stood still
                  beneath it, and the surplus painted straight over the next
                  group: "QUANTITIES" lost its first six letters.
                  The trailing cell holds no label and scrolls with the columns
                  it covers, so unscrolled the band still reads as one bar. */}
              <th colSpan={1} className="cpd-stick cpd-grp-stick">
                {/* No mapping to name when there is nothing on the other
                    side: one product column is a list, not a match. */}
                {!matched ? 'Product' : twoWay || !showPi ? '2-Way Product Mapping' : '3-Way Product Mapping'}
              </th>
              {matchCols > 0 && <th colSpan={matchCols} className="cpd-grp-tail" />}
              {/* Description belongs to no group, but it is NOT a rowSpan of 2.
                  Spanning both rows makes it a cell of its own whose text can
                  only be centred, topped or bottomed against the PAIR of rows,
                  never against the second one — centred it floated above the
                  product headings, bottomed it fell below them. As an ordinary
                  row-two cell under an empty group cell it is simply on the
                  same line as PRODUCT (PI) and PRODUCT (SPI), which is what it
                  sits beside. */}
              <th className="cpd-grp-tail" />
              <th colSpan={matched ? (showPi ? 1 : 0) + (twoWay ? 0 : 1) + 3 : 1}>{matched ? 'Quantities' : 'Quantity'}</th>
              {/* Without a purchase order there is nothing to show under it:
                  the group goes rather than standing empty over the rows. */}
              {!twoWay && <th colSpan={1}>Purchase Order (PO)</th>}
              {/* 2-way: Rate, Cost, GST (%), Total GST Amount, Total Cost.
                  3-way: the same, with the tax split into its own columns. */}
              <th colSpan={twoWay ? 5 : 4 + 2 * (inter ? 1 : 2)}>Supplier Invoice (SPI)</th>
              {/* Belongs to no group, so it spans both header rows the way
                  Sr. No and Description do. */}
              {canRemove && <th rowSpan={2} className="cpd-c cpd-th-act">Action</th>}
            </tr>
            <tr>
              {showPi && <th className="cpd-stick cpd-stick--2 cpd-th-left">Product (PI)</th>}
              {!twoWay && <th className={`cpd-th-left${showPi ? '' : ' cpd-stick cpd-stick--2'}`}>Product (PO)</th>}
              <th className={`cpd-th-left cpd-edh${showPi || !twoWay ? '' : ' cpd-stick cpd-stick--2'}`}>Product (SPI)</th>
              <th className="cpd-th-left">Description</th>
              {showPi && <th>Qty (PI)</th>}
              {!twoWay && <th>Qty (PO)</th>}
              <th className="cpd-c cpd-edh">Qty (SPI)</th>
              {matched && <><th>Missing Qty</th><th>Extra Qty</th></>}
              {!twoWay && <th className="cpd-th-amt">Total Product Cost<span className="cpd-th-sub cpd-th-sub--w">With GST</span></th>}
              <th className="cpd-th-amt cpd-c cpd-edh">Product Rate (SPI)</th>
              <th className="cpd-th-amt">Product Cost<span className="cpd-th-sub cpd-th-sub--wo">Without GST</span></th>
              {/* The percent headers were the only ones in the row with no
                  width floor of their own, so they were sized by content and
                  "IGST (%)" came out clipped to "GST (%)" — a different tax
                  entirely, and one nobody would question on sight. */}
              {/* A 2-way match carries one GST column, as the design has it:
                  the rate for the line and the amount it comes to. The split
                  into CGST and SGST (or IGST) is what a 3-way match shows,
                  where the figures are being reconciled against a purchase
                  order and each half has to be checked on its own. Here the
                  question is only whether the supplier's tax agrees with the
                  PI, and four columns to answer it is three too many. */}
              {twoWay
                ? <th className="cpd-th-pct">GST (%)</th>
                : inter
                  ? <th className="cpd-th-pct">{exportSpi ? 'Tax (%)' : 'IGST (%)'}</th>
                  : <><th className="cpd-th-pct">CGST (%)</th><th className="cpd-th-pct">SGST (%)</th></>}
              {!twoWay && (inter
                ? <th className="cpd-th-amt cpd-th-amt--tax">{exportSpi ? 'Tax Amount' : 'IGST Amount'}</th>
                : <><th className="cpd-th-amt cpd-th-amt--tax">CGST Amount</th>
                  <th className="cpd-th-amt cpd-th-amt--tax">SGST Amount</th></>)}
              <th className="cpd-th-amt cpd-th-amt--tax">Total GST Amount</th>
              <th className="cpd-th-amt cpd-th-final">Total Product Cost<span className="cpd-th-sub cpd-th-sub--w">With GST</span></th>
            </tr>
          </thead>

          <tbody>
            {/* An invoice with no PI behind it starts with nothing in this
                table, so the first thing the user meets is a row of headers
                over blank space — which reads as a table that failed to load
                rather than one waiting to be filled. */}
            {lines.length === 0 && (
              <tr className="cpd-emptyrow">
                <td colSpan={60}>
                  <div className="cpd-empty">
                    <span className="cpd-empty__ico"><IcoPlus /></span>
                    <b>No products on this invoice yet</b>
                    <span>{matched
                      ? 'The products from the PI could not be loaded — reopen the invoice to try again.'
                      : 'There is no shipment behind this invoice, so nothing is carried in. Add the products the supplier billed for.'}</span>
                  </div>
                </td>
              </tr>
            )}
            {lines.map((line, i) => (
              <Row
                key={line.key ?? line.code} line={line} index={i} twoWay={twoWay} matched={matched} showPi={showPi}
                onChange={onChange} taxMode={taxMode} catalogue={catalogue} readOnly={readOnly}
                duplicateOf={twoWay ? duplicateOf : undefined}
                onEditProduct={editProduct} onAddProduct={addProduct}
                onOpenDetail={setDetailId}
                onRemove={canRemove && lines.length > 1 ? askRemove : undefined}
                showAction={canRemove}
              />
            ))}
          </tbody>

          {lines.length > 0 && (
            <tfoot>
              <tr>
                <td className="cpd-foot-lbl cpd-stick cpd-stick--1" colSpan={2}>Totals</td>
                {/* matchCols + 1: the extra one is Description.
                    "Totals" above covers Sr. No and the first product column,
                    this covers the remaining product columns AND Description,
                    and the first figure then lands on Qty (PI). Skipping only
                    matchCols left the row one cell short of the head, so every
                    total sat one column to the left of its own heading - the
                    quantity total printed under Description. */}
                <td colSpan={matchCols + 1} />
                {showPi && <td className="cpd-c">{totals.piQty}</td>}
                {!twoWay && <td className="cpd-c">{totals.poQty}</td>}
                <td className="cpd-c">{totals.spiQty}</td>
                {matched && <><td className="cpd-c">{totals.missing}</td>
                <td className="cpd-c">{totals.extra}</td></>}
                {!twoWay && <td className="cpd-r">{money(totals.poCost)}</td>}
                <td />
                <td className="cpd-r">{money(totals.base)}</td>
                {twoWay
                  ? <td />
                  : inter
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
  matched, onRemove, showAction, duplicateOf, showPi = matched,
}: {
  showPi?: boolean;
  duplicateOf?: (productId: number, index: number) => boolean;
  line: ProductLine;
  index: number;
  /** Matches the header: no purchase order columns. */
  twoWay: boolean;
  /** Matches the header: no PI columns, and no match to compute against. */
  matched: boolean;
  onChange: (index: number, patch: Partial<ProductLine>) => void;

  onOpenDetail: (productId: number) => void;
  onEditProduct: (productId: number) => void;
  onAddProduct: () => void;
  taxMode: TaxMode;
  catalogue: Array<{ value: string; label: string; name: string; productId?: number; master?: ProductOpt }>;
  readOnly: boolean;
  /* Undefined on the last remaining line, so the button is drawn but refuses
     - the column stays aligned and the reason is on the hover. */
  onRemove?: (index: number) => void;
  showAction: boolean;
}) {
  const rowToast = useToast();
  const t = lineTotals(line, taxMode, twoWay);
  const inter = taxMode === 'inter' || taxMode === 'export';

  const patch = useCallback(
    (p: Partial<ProductLine>) => onChange(index, p),
    [index, onChange],
  );

  return (
    <tr>
      <td className="cpd-c cpd-stick cpd-stick--1">{index + 1}</td>
      {showPi && (
        <td className="cpd-prodcell cpd-td-left cpd-stick cpd-stick--2">
          <ProdCell name={line.piName} code={line.piCode ?? line.code} hsn={line.hsn} gst={line.gst} />
        </td>
      )}
      {!twoWay && (
        <td className={`cpd-prodcell cpd-td-left${showPi ? '' : ' cpd-stick cpd-stick--2'}`}>
          <ProdCell name={line.poName} code={line.code} hsn={line.hsn} gst={line.gst} />
        </td>
      )}

      <td className={`cpd-prodcell cpd-ed${showPi || !twoWay ? '' : ' cpd-stick cpd-stick--2'}`}>
        <div className="cpd-prod cpd-prod--po">
          <div className="cpd-pick">
            <MasterSelect
              value={line.productId != null ? String(line.productId) : ''}
              options={catalogue}
              disabled={readOnly}
              onChange={v => {
                const pick = catalogue.find(c => c.value === v);
                if (!pick) return;
                if (pick.productId != null && duplicateOf?.(pick.productId, index)) {
                  rowToast.warning('Product already added', `${pick.label} is already on this invoice — change its quantity instead.`);
                  return;
                }
                /* A line that came from the PI already carries its code, HSN,
                   GST and description from that document, and they are what
                   the match is being made against — picking a product here
                   remaps the SPI side only, and must not rewrite them.
                   A line added by hand has none of that, so the same pick is
                   also where it gets them. `code` is the tell: every carried
                   line has one, a blank one does not. */
                const fresh = !line.code && pick.master;
                onChange(index, fresh
                  ? {
                    productId: pick.master!.id,
                    spiName: pick.master!.name,
                    code: formatProductCode(pick.master!.code),
                    hsn: pick.master!.hsn,
                    gst: pick.master!.gst ?? 0,
                    description: pick.master!.description,
                    /* Only as a starting figure: what the supplier actually
                       charged is the point of this column, so a rate already
                       typed stands. */
                    spiRate: line.spiRate || pick.master!.price,
                  }
                  : { productId: pick.productId, spiName: pick.name });
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

      {showPi && <td className="cpd-c">{line.piQty}</td>}
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

      {/* Missing and extra are differences FROM the PI. With no PI they are
          not zero, they are undefined — and a column of zeros would read as
          a clean match on an invoice nothing was ever matched against. */}
      {matched && (
        <>
          <td className="cpd-c">
            <span className={`cpd-qtypill${t.missing > 0 ? ' cpd-qtypill--miss' : ''}`}>{t.missing}</span>
          </td>
          <td className="cpd-c">
            <span className={`cpd-qtypill${t.extra > 0 ? ' cpd-qtypill--extra' : ''}`}>{t.extra}</span>
          </td>
        </>
      )}

      {!twoWay && <td className="cpd-r spi-pocost">{money(t.poCost)}</td>}
      <td className="cpd-r cpd-ed">
        <input
          className="cpd-in cpd-in--num" type="number" min={0} step="0.01" readOnly={readOnly}
          value={line.spiRate}
          onChange={e => patch({ spiRate: Number(e.target.value) || 0 })}
        />
      </td>
      <td className="cpd-r">{money(t.base)}</td>
      {/* The whole rate, summed from whichever halves apply rather than read
          off the line: on an export `lineTotals` zeroes the tax, and the
          product's own `gst` would still print 18% against ₹0 of it. */}
      {twoWay
        ? <td className="cpd-c">{t.cgstPct + t.sgstPct + t.igstPct}%</td>
        : inter
          ? <td className="cpd-c">{t.igstPct}%</td>
          : <><td className="cpd-c">{t.cgstPct}%</td><td className="cpd-c">{t.sgstPct}%</td></>}
      {!twoWay && (inter
        ? <td className="cpd-r">{money(t.igst)}</td>
        : <><td className="cpd-r">{money(t.cgst)}</td><td className="cpd-r">{money(t.sgst)}</td></>)}
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
        <span className="cpd-code">{formatProductCode(code)}</span>
        <span className="cpd-kv">HSN <b>{hsn}</b></span>
        <span className="cpd-prod__dot" />
        <span className="cpd-kv">GST <b>{gst}%</b></span>
      </div>
    </div>
  );
}
