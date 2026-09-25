// Step 02 · Product Details — PI vs PO mapping with live tax and cost.
// Only three cells are editable (PO product, Qty PO, Rate); everything else is
// carried from the PI or calculated, which is what the legend line says.
// Tax is worked out exactly as the server does on save, so the totals match.
import { Fragment, lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { EditSelect, FitInput, FitText } from '../form-fields';
import type { PoLineRow } from '../po-draft';
import type { ProductOpt } from '../use-po-lookups';
import type { TaxMode } from '../../api/po-api';
import { inactiveProduct, piSegmentMismatch, segmentMismatch, type LineErrors } from '../validation';
import { IcoPencil, IcoPlus, IcoTrash } from '../../shared/icons';
import { useToast } from '../../../../../../contexts/ToastContext';
import { formatProductCode, productNameWithoutCode } from '../../../../../../utils/formatProductCode';
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
  // An import carries no Indian GST on the PO — tax is 0 until the duty is known.
  const gstPct = taxMode === 'export' ? 0 : gstOf(row, products);
  const pct = gstPct ?? 0;
  const base = round2(row.qtyPo * row.rate);
  const gstAmt = round2((base * pct) / 100);
  const inter = taxMode === 'inter' || taxMode === 'export';
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

export const productLabel = (p: ProductOpt) => `${formatProductCode(p.code)} — ${p.name}`;

/** What a freshly picked product costs on this PO: the supplier's own rate, else the master price. */
const rateFor = (p: ProductOpt, rates?: Record<number, number> | null) => {
  const own = rates?.[p.id];
  return own != null && own > 0 ? own : p.price;
};

import { ccyCode, ccySymbol } from '../../../../../../utils/currency';

const moneyIn2 = (ccy?: string | null) => (n: number) =>
  ccySymbol(ccy) + n.toLocaleString(ccyCode(ccy) === 'INR' ? 'en-IN' : 'en-US', { maximumFractionDigits: 2 });

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
  /** The supplier's segments; products outside them are shown locked. Null = not loaded (no lock). */
  supplierSegments?: string[] | null;
  /** Products mapped straight to the supplier — orderable even outside its segments. */
  supplierProducts?: number[] | null;
  /** The supplier's own rate per product; a picked line takes it over the master price. */
  supplierRates?: Record<number, number> | null;
  /** The summary on later steps shows the same table with plain values. */
  readOnly?: boolean;
  /** The PO's own currency — an import prints its own, not ₹. */
  ccy?: string | null;
};

export default function ProductTable({ rows, products, taxMode, onChange, onRemove, onProductsChanged, errors = {}, standalone = false, supplierSegments = null, supplierProducts = null, supplierRates = null, readOnly, ccy }: Props) {
  const money = moneyIn2(ccy);
  const options = useMemo(() => products.map(productLabel), [products]);
  // Every product is listed with its segment; only those whose segment — or the product itself —
  // is mapped to the supplier can be picked. The rest are locked with the reason.
  const lockedProducts = useMemo(() => {
    const out: Record<string, string> = {};
    for (const p of products) {
      const why = inactiveProduct(p) ?? segmentMismatch(p, supplierSegments, supplierProducts);
      if (why) out[productLabel(p)] = why;
    }
    return out;
  }, [products, supplierSegments, supplierProducts]);
  /* On a PI line the replacement has to stay in the PI product's own segment, so
     each segment gets its own locked map — built once per segment, not per row. */
  const lockedBySegment = useMemo(() => {
    const cache = new Map<string, Record<string, string>>();
    return (piSegment: string | null | undefined) => {
      const seg = (piSegment ?? '').trim();
      if (!seg) return lockedProducts;
      const hit = cache.get(seg.toLowerCase());
      if (hit) return hit;
      const out: Record<string, string> = { ...lockedProducts };
      for (const p of products) {
        const label = productLabel(p);
        if (!out[label]) {
          const why = piSegmentMismatch(p, seg);
          if (why) out[label] = why;
        }
      }
      cache.set(seg.toLowerCase(), out);
      return out;
    };
  }, [products, lockedProducts]);
  // The list shows each product's segment; one this supplier can't be given is red.
  const segmentBadges = useMemo(() => {
    const out: Record<string, { text: string; tone: 'green' | 'red' }> = {};
    for (const p of products) {
      const dead = inactiveProduct(p);
      out[productLabel(p)] = {
        text: dead ? 'Inactive' : (p.segment.trim() || 'No segment'),
        tone: lockedProducts[productLabel(p)] ? 'red' : 'green',
      };
    }
    return out;
  }, [products, lockedProducts]);
  // The product whose detail view is open, from "Read more" on its description.
  const [detailId, setDetailId] = useState<number | null>(null);
  /* The product master's own Add / Edit wizard, opened from the two buttons in
     the PO product cell: the pencil edits the line's product, + adds a new one. */
  const [editing, setEditing] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  /* The row whose + opened the wizard, and the product it created: once the
     reloaded list carries that product, it is picked onto that very row. */
  const [addFor, setAddFor] = useState<number | null>(null);
  const [justAdded, setJustAdded] = useState<{ row: number; id: number } | null>(null);
  const toast = useToast();
  // Inter-state is one IGST pair; intra-state splits into CGST + SGST; an import is one Tax pair at 0%.
  const exportPo = taxMode === 'export';
  const inter = taxMode === 'inter' || exportPo;
  const withPi = !standalone;
  // Inter-state is one IGST pair; intra-state splits into CGST + SGST.
  const taxCols = inter ? 1 : 2;
  const colCount = 1 + (withPi ? 1 : 0) + 2 + (withPi ? 3 : 1) + 1 + taxCols + taxCols + 1;
  // Read-only recaps show only what is ordered.
  const shown = readOnly ? rows.filter((r) => r.qtyPo > 0) : rows;
  // Every line this supplier can't be given, named once above the table instead of a note per row.
  const unmapped = useMemo(() => (readOnly ? [] : shown
    .map((r) => productOf(r, products))
    .filter((p): p is ProductOpt => !!p && !!segmentMismatch(p, supplierSegments, supplierProducts))
    .map((p) => ({ code: p.code || p.name, segment: p.segment.trim() }))),
  [readOnly, shown, products, supplierSegments, supplierProducts]);
  /* A product created from a line's + goes straight onto that line, as long as it
     may be ordered here: active, mapped to the supplier, and — on a PI line — in
     the PI product's own segment. Otherwise it stays in the master and we say why. */
  useEffect(() => {
    if (!justAdded) return;
    const p = products.find((x) => x.id === justAdded.id);
    if (!p) return;                       // the reloaded list hasn't landed yet
    const row = rows[justAdded.row];
    setJustAdded(null);
    if (!row) return;
    const piProduct = row.pi ? products.find((x) => x.id === row.pi?.product_id) : undefined;
    const why = inactiveProduct(p)
      ?? segmentMismatch(p, supplierSegments, supplierProducts)
      ?? piSegmentMismatch(p, piProduct?.segment);
    if (why) {
      toast.warning(`${formatProductCode(p.code)} saved, but not selected`, why);
      return;
    }
    onChange(justAdded.row, { productId: p.id, rate: rateFor(p, supplierRates) });
    toast.success('Product added', `${formatProductCode(p.code)} — ${p.name} is now on this line.`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [justAdded, products, supplierSegments, supplierProducts]);

  const lines = shown.map((r) => computeLine(r, products, taxMode));
  const totals = lines.reduce(
    (sum, l, i) => ({
      piQty: sum.piQty + (shown[i].pi?.pending_qty ?? 0), poQty: sum.poQty + shown[i].qtyPo, miss: sum.miss + l.missing,
      cgst: sum.cgst + l.cgstAmt, sgst: sum.sgst + l.sgstAmt, igst: sum.igst + l.igstAmt,
      base: sum.base + l.base, gst: sum.gst + l.gstAmt, withGst: sum.withGst + l.withGst,
    }),
    { piQty: 0, poQty: 0, miss: 0, cgst: 0, sgst: 0, igst: 0, base: 0, gst: 0, withGst: 0 },
  );

  return (
    <>
      {unmapped.length > 0 && (
        <div className="cpd-nomap-note">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
          <span>
            <b>{unmapped.length === 1 ? '1 product is' : `${unmapped.length} products are`} not mapped to this supplier:</b>{' '}
            {unmapped.map((u, n) => (
              <Fragment key={u.code + n}>
                {n > 0 && ', '}
                <b className="cpd-nomap-note__code">{formatProductCode(u.code)}</b>{u.segment ? ` (${u.segment})` : ' (no segment)'}
              </Fragment>
            ))}
            . Map {unmapped.length === 1 ? 'it' : 'them'} to the supplier in Product Master → Vendors, or map the supplier to the segment, then come back to {unmapped.length === 1 ? 'this line' : 'these lines'}.
          </span>
        </div>
      )}
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
          {/* Supplier mapping stays available here: a product added for this PO has
              to be mapped to its supplier, or the line can't use it. */}
          <AddProductModal
            productId={editing}
            onClose={() => { setAdding(false); setEditing(null); setAddFor(null); }}
            onSaved={(id, finalised) => {
              if (!finalised) return;
              if (editing != null) toast.success('Product updated', 'Saved in the product master.');
              else if (addFor == null) toast.success('Product added', 'Saved in the product master.');
              // A product added from a row is picked onto it once the list reloads.
              if (editing == null && addFor != null && id) setJustAdded({ row: addFor, id });
              setAdding(false);
              setEditing(null);
              setAddFor(null);
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
            {inter ? <th>{exportPo ? 'Tax (%)' : 'IGST (%)'}</th> : <><th>CGST (%)</th><th>SGST (%)</th></>}
            {inter
              ? <th className="cpd-th-amt cpd-th-amt--tax">{exportPo ? 'Tax Amount' : 'IGST Amount'}</th>
              : <><th className="cpd-th-amt cpd-th-amt--tax">CGST Amount</th><th className="cpd-th-amt cpd-th-amt--tax">SGST Amount</th></>}
            <th className="cpd-th-amt cpd-th-final">Product Cost</th>
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
            const poName = po?.name ?? (row.pi && row.productId === row.pi.product_id ? productNameWithoutCode(row.pi.product_name, row.pi.product_code) : '') ?? '';
            const hsn = po?.hsn || row.pi?.hsn_code || '—';
            const desc = po?.description || row.pi?.description || '';
            const rowErr = readOnly ? {} : (errors[row.key] ?? {});
            // Product outside the supplier's segments: the whole line is locked until the segment is mapped.
            const piProduct = row.pi ? products.find((p) => p.id === row.pi?.product_id) : undefined;
            const segLock = !readOnly && po
              ? (inactiveProduct(po) ?? segmentMismatch(po, supplierSegments, supplierProducts) ?? piSegmentMismatch(po, piProduct?.segment))
              : null;
            const seg = po?.segment.trim() ?? '';
            const locked = () => toast.warning('Segment not mapped', seg
              ? `${seg} is not mapped to this supplier — map it in the Supplier Master first.`
              : 'This product has no segment in the product master — set it first.');
            // Quantity and rate belong to a product: nothing to enter until one is picked.
            const noProduct = !readOnly && row.productId == null;
            const cellLock = !!segLock || noProduct;
            const lockedCell = () => (segLock ? locked() : toast.warning('Pick the product first',
              withPi ? 'Choose the PO product for this PI line before entering quantity or rate.'
                : 'Choose the product on this line before entering quantity or rate.'));
            /* The chip always shows the product master's own GST, even on an import
               where the PO charges no Indian GST — the Tax columns stay 0, this is
               only what the product is registered at. */
            const masterGst = gstOf(row, products) ?? (row.pi?.gst_pct ?? null);
            const gstCell = masterGst === null
              ? <span className="cpd-miss" title="Set the GST % on the product master">GST not set</span>
              : (
                <span title={exportPo ? 'The product master\'s GST — an import is not charged Indian GST, so the Tax columns stay 0.' : undefined}>
                  GST <b>{masterGst}%</b>
                </span>
              );
            return (
              <Fragment key={row.key}>
              <tr className={segLock ? 'cpd-row--seglock' : undefined} title={segLock ?? undefined}>
                <td className="cpd-stick cpd-stick--1">{i + 1}</td>
                {withPi && (
                  <td className="cpd-stick cpd-stick--2 cpd-td-left cpd-prodcell">
                    <div className="cpd-prod">
                      {row.pi ? (
                        <>
                          <div className="cpd-prod__nm cpd-prod__nm--clamp" title={row.pi.product_name ?? undefined}>
                            {productNameWithoutCode(row.pi.product_name, row.pi.product_code)}
                          </div>
                          <div className="cpd-prod__meta">
                            {row.pi.product_code && <span className="cpd-code">{formatProductCode(row.pi.product_code)}</span>}
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
                        readOnly={!!segLock}
                        locked={lockedBySegment(piProduct?.segment)}
                        badges={segmentBadges}
                        listBadgesOnly
                        onLockedClick={(label) => (label ? toast.warning('Segment mismatch', lockedProducts[label] ?? 'This product is not in a segment this supplier deals in.') : locked())}
                        placeholder="— Select product —"
                        onChange={(label) => {
                          const picked = products.find((p) => productLabel(p) === label);
                          // The rate follows the product: the supplier's purchase price, GST excluded.
                          if (picked) onChange(index, { productId: picked.id, rate: rateFor(picked, supplierRates) });
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
                    {readOnly && po?.code && <span className="cpd-code">{formatProductCode(po.code)}</span>}
                    {/* The whole reason lives in the badge; the line above the table names them all. */}
                    {segLock && (
                      <span className="cpd-nomap" title={segLock}>
                        {inactiveProduct(po) ? 'Inactive' : piProduct && piSegmentMismatch(po, piProduct.segment) ? 'Other segment' : 'Not mapped'}
                      </span>
                    )}
                    {po && (
                      <>
                        <span className="cpd-kv">HSN <b>{hsn}</b></span>
                        <span className="cpd-prod__dot" />
                        <span className="cpd-kv">{gstCell}</span>
                      </>
                    )}
                    {!readOnly && (
                      <button type="button" className="cpd-addbtn"
                        title="Add a new product — it goes on this line if it can be ordered from this supplier"
                        onClick={() => { setAddFor(index); setAdding(true); }}>
                        <IcoPlus />
                      </button>
                    )}
                  </div>
                  {rowErr.product && <div className="cpd-cell-msg">{rowErr.product}</div>}
                  </div>
                </td>

                <td className="cpd-td-left cpd-td-desc">
                  {desc
                    ? <Description text={desc} onOpen={row.productId ? () => setDetailId(row.productId) : undefined} />
                    : <span className="cpd-dash">—</span>}
                </td>

                {/* What is still open on the PI after earlier POs, so Qty (PI) − Qty (PO) = Missing Qty. */}
                {withPi && (
                  <td title={row.pi ? `PI quantity ${plain(row.pi.pi_quantity)}${row.pi.ordered_qty > 0 ? ` · ${plain(row.pi.ordered_qty)} already on other POs` : ''} · ${plain(row.pi.pending_qty)} pending` : undefined}>
                    {row.pi ? plain(row.pi.pending_qty) : '—'}
                  </td>
                )}
                <td className={readOnly ? undefined : `${noProduct ? '' : 'cpd-ed'}${rowErr.qty ? ' cpd-cell-err' : ''}`}>
                  {readOnly ? <FitText text={plain(row.qtyPo)} /> : (
                    <FitInput
                      className="cpd-in"
                      inputMode="decimal"
                      maxLength={QTY_DIGITS + 4}
                      tooltip={plain(row.qtyPo)}
                      readOnly={cellLock}
                      onClick={cellLock ? lockedCell : undefined}
                      value={row.qtyPo}
                      onChange={(e) => onChange(index, { qtyPo: cleanQty(e.target.value) })}
                    />
                  )}
                  {rowErr.qty && <div className="cpd-cell-msg">{rowErr.qty}</div>}
                </td>
                {withPi && <td className={line.missing > 0 ? 'cpd-miss' : ''}>{row.pi ? plain(line.missing) : '—'}</td>}

                <td className={readOnly ? undefined : `${noProduct ? '' : 'cpd-ed'}${rowErr.rate ? ' cpd-cell-err' : ''}`}>
                  {readOnly ? <FitText text={money(row.rate)} /> : (
                    <FitInput
                      className="cpd-in"
                      inputMode="decimal"
                      maxLength={RATE_DIGITS + 3}
                      tooltip={money(row.rate)}
                      readOnly={cellLock}
                      onClick={cellLock ? lockedCell : undefined}
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
                <td className="cpd-final"><FitText text={money(line.base)} /></td>
              </tr>
              </Fragment>
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
            <td className="cpd-final"><FitText text={money(totals.base)} /></td>
          </tr>
        </tfoot>
      </table>
    </div>
    </>
  );
}

/** Long trade descriptions are clipped to three lines; "Read more" opens the
    product's own detail view rather than unfolding the cell. */
function Description({ text, onOpen }: { text: string; onOpen?: () => void }) {
  // Clamped only when the text really runs past 3 lines; then "Read more" ends the 3rd line.
  const ref = useRef<HTMLSpanElement>(null);
  const [clamped, setClamped] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setClamped(el.scrollHeight > el.clientHeight + 1);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text]);
  return (
    <div className="cpd-desc">
      <span ref={ref} className={`cpd-desc__wrap${clamped ? ' is-clamped' : ''}`}>
        {text}
        {onOpen && (
          <button type="button" className="cpd-more" onClick={onOpen} onPointerEnter={warmProductView} title="Open the product details">
            {clamped ? '… Read more' : 'Read more'}
          </button>
        )}
      </span>
    </div>
  );
}
