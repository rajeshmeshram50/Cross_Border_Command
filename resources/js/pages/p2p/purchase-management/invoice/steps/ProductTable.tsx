import { lazy, memo, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { segmentMismatch } from '../../order/create-po/validation';

const inr = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = (n: number) => `₹${inr.format(n)}`;

export default function ProductTable({
  lines, onChange, onRemove, taxMode = 'intra', readOnly = false, twoWay = false, matched = true, sourceNote, hasPi = true, rowIssues,
  supplierSegments = null, supplierProducts = null,
}: {
  lines: ProductLine[];
  /** Cells a refused Update & Next flagged, by line index. */
  rowIssues?: Record<number, { product?: string; qty?: string }>;
  onChange: (index: number, patch: Partial<ProductLine>) => void;
  onRemove?: (index: number) => void;
  readOnly?: boolean;

  taxMode?: TaxMode;
  twoWay?: boolean;
  matched?: boolean;
  hasPi?: boolean;
  sourceNote?: string;
  /** The Stage 01 supplier's segments; products outside them are listed but locked. Null = not loaded. */
  supplierSegments?: string[] | null;
  /** Products mapped straight to the supplier, pickable even outside its segments. */
  supplierProducts?: number[] | null;
}) {
  const totals = tableTotals(lines, taxMode, twoWay);
  const canRemove = !!onRemove && !readOnly;
  const showPi = matched && hasPi;
  const matchCols = (showPi ? 1 : 0) + (twoWay ? 0 : 1);

  const confirm = useConfirm();
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
    toast.info('Removed', name);
  }, [confirm, lines, onRemove, taxMode, toast, twoWay, totals.cost]);
  const [master, setMaster] = useState<ProductOpt[]>([]);
  const needsNames = lines.some(l => l.productId != null && !l.code);
  const wantMaster = !readOnly || needsNames;
  useEffect(() => {
    if (!wantMaster) return;
    let live = true;
    poLookupApi.products()
      .then(rows => { if (live) setMaster(rows.map(toProduct).filter(p => p.id && p.name)); })
      .catch(() => {});
    return () => { live = false; };
  }, [wantMaster]);

  const catalogue = useMemo(() => {
    const seen = new Map<string, {
      value: string; label: string; name: string; productId?: number; master?: ProductOpt;
      disabled?: boolean; disabledReason?: string; badge?: { text: string; tone: 'green' | 'red'; lock?: boolean; listOnly?: boolean };
    }>();
    for (const l of lines) {
      const lineName = l.poName || l.spiName;
      if (l.productId == null || (!l.code && !lineName)) continue;
      const value = String(l.productId);
      if (!seen.has(value)) {
        seen.set(value, {
          value,
          label: `${formatProductCode(l.code)} — ${truncate(lineName, MATCH_NAME_MAX)}`,
          name: lineName,
          productId: l.productId,
        });
      }
    }
    for (const p of master) {
      const value = String(p.id);
      const existing = seen.get(value);
      if (existing) { existing.master = p; continue; }
      seen.set(value, {
        value,
        label: `${formatProductCode(p.code)} — ${truncate(withoutCodePrefix(p.name, p.code), MATCH_NAME_MAX)}`,
        name: p.name,
        productId: p.id,
        master: p,
      });
    }
    for (const c of seen.values()) {
      if (!c.master) continue;
      const why = segmentMismatch(c.master, supplierSegments, supplierProducts);
      c.badge = { text: c.master.segment.trim() || 'No segment', tone: why ? 'red' : 'green', lock: !!why, listOnly: true };
      if (why) { c.disabled = true; c.disabledReason = why; }
    }
    return [...seen.values()];
  }, [lines, master, supplierSegments, supplierProducts]);

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

  /* Whether the rows overflow the box's 500px cap. The scrollbar lane
     (scrollbar-gutter) is reserved only then: reserved always, a table with a
     row or two had an empty 8px white strip down its right edge, beside the
     Action column, with no scrollbar ever coming to fill it.
     It also hands the CSS the sticky header's and totals row's heights, and
     the horizontal bar's: the vertical track is inset by the first two so the
     scrollbar runs beside the rows only, not up past the header or down past
     the totals. They are whatever the text makes them, so they are measured. */
  const scrollRef = useRef<HTMLDivElement>(null);
  const [rowsOverflow, setRowsOverflow] = useState(false);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const check = () => {
      setRowsOverflow(el.scrollHeight > el.clientHeight + 1);
      const cs = getComputedStyle(el);
      const borders = parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
      el.style.setProperty('--spi-th', `${el.querySelector('thead')?.offsetHeight ?? 0}px`);
      el.style.setProperty('--spi-tf', `${el.querySelector('tfoot')?.offsetHeight ?? 0}px`);
      el.style.setProperty('--spi-hb', `${Math.max(0, el.offsetHeight - el.clientHeight - borders)}px`);
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    const table = el.querySelector('table');
    if (table) ro.observe(table);
    return () => ro.disconnect();
  }, []);

  return (
    <>
      <div className="cpd-legend">
        <span className="cpd-legend__sw" />
        {matched
          ? <>Tinted cells are editable — SPI product, quantity and rate. Everything else is
            carried from {sourceNote ?? (twoWay ? 'the PI' : 'the PI or the PO')}, or calculated.</>
          : <>Tinted cells are editable — SPI product, quantity and rate. Costs and GST are calculated.</>}
      </div>

      <div ref={scrollRef} className={`cpd-scroll cpd-scroll--rows${rowsOverflow ? ' is-overflowing' : ''}`}>
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
              <th colSpan={1} className="cpd-stick cpd-grp-stick">
                {!matched ? 'Product' : twoWay || !showPi ? '2-Way Product Mapping' : '3-Way Product Mapping'}
              </th>
              {matchCols > 0 && <th colSpan={matchCols} className="cpd-grp-tail" />}
              <th className="cpd-grp-tail" />
              <th colSpan={matched ? (showPi ? 1 : 0) + (twoWay ? 0 : 1) + 3 : 1}>{matched ? 'Quantities' : 'Quantity'}</th>
              {!twoWay && <th colSpan={1}>Purchase Order (PO)</th>}
              <th colSpan={twoWay ? 5 : 4 + 2 * (inter ? 1 : 2)}>Supplier Invoice (SPI)</th>
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
                duplicateOf={duplicateOf}
                onEditProduct={editProduct} onAddProduct={addProduct}
                onOpenDetail={setDetailId}
                onRemove={canRemove && lines.length > 1 ? askRemove : undefined}
                showAction={canRemove}
                issue={rowIssues?.[i]}
              />
            ))}
          </tbody>

          {lines.length > 0 && (
            <tfoot>
              <tr>
                <td className="cpd-foot-lbl cpd-stick cpd-stick--1" colSpan={2}>Totals</td>
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
  matched, onRemove, showAction, duplicateOf, showPi = matched, issue,
}: {
  showPi?: boolean;
  duplicateOf?: (productId: number, index: number) => boolean;
  /** This line's flagged cells — the same red cell and note the PO table uses. */
  issue?: { product?: string; qty?: string };
  line: ProductLine;
  index: number;
  twoWay: boolean;
  matched: boolean;
  onChange: (index: number, patch: Partial<ProductLine>) => void;

  onOpenDetail: (productId: number) => void;
  onEditProduct: (productId: number) => void;
  onAddProduct: () => void;
  taxMode: TaxMode;
  catalogue: Array<{
    value: string; label: string; name: string; productId?: number; master?: ProductOpt;
    disabled?: boolean; disabledReason?: string; badge?: { text: string; tone: 'green' | 'red'; lock?: boolean; listOnly?: boolean };
  }>;
  readOnly: boolean;
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

      <td className={`cpd-prodcell cpd-ed${showPi || !twoWay ? '' : ' cpd-stick cpd-stick--2'}${issue?.product ? ' cpd-cell-err' : ''}`}>
        <div className="cpd-prod cpd-prod--po">
          <div className="cpd-pick">
            <MasterSelect
              value={line.productId != null ? String(line.productId) : ''}
              options={catalogue}
              disabled={readOnly}
              onDisabledClick={opt => rowToast.warning('Segment mismatch',
                opt.disabledReason ?? 'This product is not in a segment this supplier deals in.')}
              onChange={v => {
                const pick = catalogue.find(c => c.value === v);
                if (pick?.disabled) return;
                if (!pick) return;
                if (pick.productId != null && duplicateOf?.(pick.productId, index)) {
                  rowToast.warning('Product already added', `${pick.label} is already on this invoice — change its quantity instead.`);
                  return;
                }
                const fresh = !line.code && pick.master;
                onChange(index, fresh
                  ? {
                    productId: pick.master!.id,
                    spiName: pick.master!.name,
                    code: formatProductCode(pick.master!.code),
                    hsn: pick.master!.hsn,
                    gst: pick.master!.gst ?? 0,
                    description: pick.master!.description,
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
          {issue?.product && <div className="cpd-cell-msg">{issue.product}</div>}
        </div>
      </td>

      <td className="cpd-td-left cpd-td-desc">
        <ProductDescription
          text={line.description}
          onOpen={line.productId == null ? undefined : () => onOpenDetail(line.productId!)}
        />
      </td>

      {showPi && <td className="cpd-c">{line.piQty}</td>}
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
      <td className={`cpd-c cpd-ed${issue?.qty ? ' cpd-cell-err' : ''}`}>
        <input
          className="cpd-in cpd-in--num" type="number" min={0} readOnly={readOnly}
          aria-invalid={!!issue?.qty || undefined}
          value={line.spiQty}
          onChange={e => patch({ spiQty: Number(e.target.value) || 0 })}
        />
        {issue?.qty && <div className="cpd-cell-msg">{issue.qty}</div>}
      </td>

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
