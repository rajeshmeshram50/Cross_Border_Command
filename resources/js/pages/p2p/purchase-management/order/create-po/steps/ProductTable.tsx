// Step 02 · Product Details — PI vs PO mapping with live tax and cost.
// Only three cells are editable (PO product, Qty PO, Rate); everything else is
// carried from the PI or calculated, which is what the legend line says.
import { lazy, Suspense, useMemo, useState } from 'react';
import { EditSelect, FitInput, FitText } from '../form-fields';
import { PRODUCT_CATALOGUE, detailProduct, gstSplit, productOption, type ProductLine } from '../sample-products';
import { IcoPencil, IcoPlus } from '../../icons';
import api from '../../../../../../api';
import { useToast } from '../../../../../../contexts/ToastContext';
// The Product Management detail view, opened by "Read more" on a description.
const InspectionProductView = lazy(() => import('../../InspectionProductView'));
// The product master's Add / Edit wizard, opened by the cell's two buttons.
const AddProductModal = lazy(() => import('../../../../p2p-master-management/product-management/AddProductModal'));
/* Hovering "Read more" starts the same downloads the click needs, so the view
   is already in memory when the click lands. BOTH modules are warmed: the
   wrapper lazy-loads ProductView inside itself, and ProductView (with its
   stylesheet and the master kit it pulls) is nearly all of the weight — warming
   only the wrapper leaves the wait exactly where it was.
   Fire-and-forget: the imports are idempotent and React.lazy reuses the very
   same promise, so an in-flight prefetch is awaited, never repeated. */
const warmProductView = () => {
  void import('../../InspectionProductView');
  void import('../../../../p2p-master-management/product-management/ProductView');
};

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

/** "P-002" and "P-02" are the same product — compare prefix + number. */
const codeKey = (code: string) => {
  const m = code.trim().toUpperCase().match(/^(.*?)(\d+)$/);
  return m ? `${m[1]}${Number(m[2])}` : code.trim().toUpperCase();
};

/* No visible limit: long values end in "…" and show in full on hover
   (FitText / FitInput). The 12-digit ceiling is only a safety net — past ~15
   digits a JavaScript number can't hold the value exactly and quietly rounds
   it, and qty x rate at that size turns into 1.0e+42 notation. */
const QTY_DIGITS = 12;
const RATE_DIGITS = 12;
const plain = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 2 });
const cleanQty = (raw: string) => Number(raw.replace(/\D/g, '').slice(0, QTY_DIGITS)) || 0;
const cleanRate = (raw: string) => {
  const [whole = '', frac] = raw.replace(/[^\d.]/g, '').split('.');
  const n = Number(`${whole.slice(0, RATE_DIGITS)}${frac !== undefined ? `.${frac.slice(0, 2)}` : ''}`);
  return Number.isFinite(n) ? n : 0;
};

type Props = {
  rows: PoLineRow[];
  stateCode: string;
  onChange: (index: number, patch: Partial<PoLineRow>) => void;
  /** The summary on later steps shows the same table with plain values. */
  readOnly?: boolean;
};

export default function ProductTable({ rows, stateCode, onChange, readOnly }: Props) {
  const options = useMemo(() => PRODUCT_CATALOGUE.map(productOption), []);
  // The product whose detail view is open, from "Read more" on its description.
  const [detail, setDetail] = useState<ProductLine | null>(null);
  /* The product master's own Add / Edit wizard, opened from the two buttons in
     the PO product cell. `editing` holds the product master id the pencil
     resolved; `adding` is the blank Add Product form. */
  const [editing, setEditing] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [busyCode, setBusyCode] = useState<string | null>(null);
  const toast = useToast();

  /* These PO lines carry a product CODE, not a master id, and the codes are
     padded for display (P-002 is the master's P-02). So the pencil asks the
     products API for the code and opens the wizard on whatever it matches. */
  const openEditor = async (line: ProductLine) => {
    setBusyCode(line.code);
    try {
      const res = await api.get('/products', { params: { lite: 1, q: line.code.replace(/-0+/, '-'), per_page: 50 } });
      const rows: { id: number; product_code?: string }[] = res.data?.data ?? res.data ?? [];
      const wanted = codeKey(line.code);
      const hit = rows.find((r) => codeKey(r.product_code ?? '') === wanted);
      if (hit) setEditing(hit.id);
      else toast.info('Not in the product master', `${line.code} has no product record to edit yet.`);
    } catch {
      toast.error('Could not open the product', 'The product master did not respond.');
    } finally {
      setBusyCode(null);
    }
  };
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
      {detail && (
        <Suspense fallback={null}>
          <InspectionProductView product={detailProduct(detail)} onClose={() => setDetail(null)} />
        </Suspense>
      )}
      {/* One wizard, two entry points: with an id it edits that product, with
          none it creates one. It saves to the product master itself, so the PO
          lines here are untouched either way. */}
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
            }}
          />
        </Suspense>
      )}
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
            <th className={`cpd-th-num ${readOnly ? '' : 'cpd-edh'}`}>Qty (PO)</th>
            <th>Missing Qty</th>
            <th className={`cpd-th-num ${readOnly ? '' : 'cpd-edh'}`}>Product Rate</th>
            <th>CGST (%)</th>
            <th>SGST (%)</th>
            <th className="cpd-th-amt cpd-th-amt--tax">CGST Amount</th>
            <th className="cpd-th-amt cpd-th-amt--tax">SGST Amount</th>
            <th className="cpd-th-amt">Product Cost<span className="cpd-th-sub cpd-th-sub--wo">Without GST</span></th>
            <th className="cpd-th-amt">Total GST Amount</th>
            <th className="cpd-th-amt cpd-th-final">Total Product Cost<span className="cpd-th-sub cpd-th-sub--w">With GST</span></th>
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
                      <button
                        type="button"
                        className="cpd-iconbtn"
                        title="Edit this product in the product master"
                        disabled={busyCode === po.code}
                        onClick={() => void openEditor(po)}
                      >
                        <IcoPencil />
                      </button>
                    </div>
                  )}
                  <div className="cpd-prod__meta">
                    {readOnly && <span className="cpd-code">{po.code}</span>}
                    <span className="cpd-kv">HSN <b>{po.hsn}</b></span>
                    <span className="cpd-prod__dot" />
                    <span className="cpd-kv">GST <b>{line.cgstPct + line.sgstPct}%</b></span>
                    {!readOnly && (
                      <button type="button" className="cpd-addbtn" title="Add a new product to the master" onClick={() => setAdding(true)}>
                        <IcoPlus />
                      </button>
                    )}
                  </div>
                  </div>
                </td>

                <td className="cpd-td-left"><Description text={po.description} onOpen={() => setDetail(po)} /></td>

                <td>{row.pi.qtyPi}</td>
                <td className={readOnly ? undefined : 'cpd-ed'}>
                  {readOnly ? <FitText text={plain(row.qtyPo)} /> : (
                    <FitInput
                      className="cpd-in"
                      inputMode="numeric"
                      maxLength={QTY_DIGITS}
                      tooltip={plain(row.qtyPo)}
                      value={row.qtyPo}
                      onChange={(e) => onChange(i, { qtyPo: cleanQty(e.target.value) })}
                    />
                  )}
                </td>
                <td className={line.missing > 0 ? 'cpd-miss' : ''}>{line.missing}</td>

                <td className={readOnly ? undefined : 'cpd-ed'}>
                  {readOnly ? <FitText text={money(row.rate)} /> : (
                    <FitInput
                      className="cpd-in"
                      inputMode="decimal"
                      maxLength={RATE_DIGITS + 3}
                      tooltip={money(row.rate)}
                      value={row.rate}
                      onChange={(e) => onChange(i, { rate: cleanRate(e.target.value) })}
                    />
                  )}
                </td>
                <td>{line.cgstPct}%</td>
                <td>{line.sgstPct}%</td>

                <td><FitText text={money(line.cgstAmt)} /></td>
                <td><FitText text={money(line.sgstAmt)} /></td>
                <td><FitText text={money(line.base)} /></td>
                <td className="cpd-gst"><FitText text={money(line.gstAmt)} /></td>
                <td className="cpd-final"><FitText text={money(line.withGst)} /></td>
              </tr>
            );
          })}
        </tbody>

        <tfoot>
          <tr>
            <td className="cpd-foot-lbl cpd-stick cpd-stick--1" colSpan={2}>Totals</td>
            <td colSpan={2} />
            <td>{totals.piQty}</td>
            <td><FitText text={plain(totals.poQty)} /></td>
            <td>{totals.miss}</td>
            <td colSpan={3} />
            <td><FitText text={money(totals.cgst)} /></td>
            <td><FitText text={money(totals.sgst)} /></td>
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
function Description({ text, onOpen }: { text: string; onOpen: () => void }) {
  return (
    <div className="cpd-desc">
      <span className="cpd-desc__wrap">
        {text}
        <button type="button" className="cpd-more" onClick={onOpen} onPointerEnter={warmProductView} title="Open the product details">
          … Read more
        </button>
      </span>
    </div>
  );
}

