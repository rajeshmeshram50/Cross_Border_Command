// Create PO — Step 02: PO Product Details.
// Opens with the read-only recap of Step 01, then the PI vs PO product table,
// the additional charges and whatever the PO does not cover.
import { useState } from 'react';
import ProductTable, { computeLine } from './ProductTable';
import ChargesSummary, { type Charges } from './ChargesSummary';
import MissingProducts, { missingCount } from './MissingProducts';
import StageSummary from './StageSummary';
import { FitTip } from '../form-fields';
import { manualRow, type PoDraft, type PoLineRow, type SetDraft } from '../po-draft';
import type { StepCtx } from '../CreatePoForm';
import { IcoAlert, IcoBox, IcoChevron, IcoLines, IcoPin, IcoUser } from '../../shared/icons';

export default function Step2ProductDetails({ draft, set, ctx }: { draft: PoDraft; set: SetDraft; ctx: StepCtx }) {
  const [prodOpen, setProdOpen] = useState(true);
  const [missOpen, setMissOpen] = useState(true);
  const { products } = ctx.lookups;
  const sup = draft.supplier;
  const standalone = ctx.detail?.link_type === 'standalone';

  const lines = draft.lines;
  const patchLine = (index: number, patch: Partial<PoLineRow>) =>
    set({ lines: lines.map((l, i) => (i === index ? { ...l, ...patch } : l)) });
  const addLine = () => set({ lines: [...lines, manualRow()] });
  const removeLine = (index: number) => set({ lines: lines.filter((_, i) => i !== index) });
  const patchCharges = (patch: Partial<Charges>) => set({ charges: { ...draft.charges, ...patch } });

  // The totals box adds up the same lines the table shows.
  const computed = lines.map((l) => computeLine(l, products, ctx.taxMode));
  const base = computed.reduce((sum, l) => sum + l.base, 0);
  const gst = computed.reduce((sum, l) => sum + l.gstAmt, 0);
  // Computed from the saved lines — typing a quantity doesn't change it until Save.
  const saved = ctx.savedLines;
  const missing = saved ? missingCount(saved, products, ctx.taxMode) : 0;

  return (
    <>
    <StageSummary draft={draft} ctx={ctx} upto={1} />

    <div className={`spi-dt-sec ${prodOpen ? '' : 'is-collapsed'}`}>
      <div className="spi-dt-sec-head cpf-clickable" onClick={() => setProdOpen((o) => !o)}>
        <div className="spi-dt-sec-ico spi-dt-sec-ico-2"><IcoBox /></div>
        <div className="spi-dt-sec-mid">
          <div className="spi-dt-sec-row">
            <span className="spi-dt-sec-lbl">Products</span>
            <span className="spi-dt-sec-sep" />
            <span className="spi-dt-sec-title">Product Details</span>
          </div>
          <div className="spi-dt-sec-sub">PI vs PO product mapping with live tax &amp; cost computation</div>
        </div>
        <div className="spi-dt-secpills" onClick={(e) => e.stopPropagation()}>
          <RefPill icon={<IcoLines />} label="SUPPLIER CODE" value={sup?.code ?? '—'} />
          <span className="spi-dt-dots">⋮</span>
          <RefPill icon={<IcoUser />} label="SUPPLIER NAME" value={sup?.name ?? '—'} />
          <span className="spi-dt-dots">⋮</span>
          <RefPill icon={<IcoPin />} label="STATE CODE" value={sup?.stateCode ?? '—'} />
          {!standalone && (
            <>
              <span className="spi-dt-dots">⋮</span>
              <RefPill icon={<IcoLines />} label="PI NUMBER" value={ctx.piCode ?? '—'} />
            </>
          )}
        </div>
        <span className={`cpf-chev ${prodOpen ? '' : 'is-closed'}`}><IcoChevron /></span>
      </div>

      <div className="spi-dt-sec-body cpd-body">
        <div className="cpd-legend">
          <span className="cpd-legend__sw" />
          {standalone
            ? 'Tinted cells are editable — product, quantity and rate. Everything else is calculated.'
            : 'Tinted cells are editable — PO product, quantity and rate. Everything else is carried from the PI or calculated.'}
          {' '}{ctx.taxMode === 'inter' ? 'Inter-state supplier: IGST applies.' : 'Intra-state supplier: CGST + SGST apply.'}
        </div>
        {ctx.linesGeneral && <div className="cpd-general-err" role="alert">{ctx.linesGeneral}</div>}
        <ProductTable rows={lines} products={products} taxMode={ctx.taxMode} onChange={patchLine} onRemove={removeLine}
          supplierSegments={draft.supplier?.segments ?? null}
          onProductsChanged={ctx.lookups.reloadProducts} errors={ctx.lineErrors} standalone={standalone} />
        {/* A product the PI doesn't carry goes on its own line. */}
        {/* A shipment PO orders only its PI lines; extra products go on a standalone PO. */}
        {ctx.detail?.link_type !== 'with_shipment' && (
          <button type="button" className="cpf-addbtn cpd-addfirst" onClick={addLine}>+ Add Product Line</button>
        )}
        {/* The wizard footer moves to the next step; this Save banks the lines
            and charges without leaving Step 02. It rides in the summary row so
            it sits beside the Grand Total. */}
        <ChargesSummary
          base={base}
          gst={gst}
          charges={draft.charges}
          onChange={patchCharges}
          action={(
            <button type="button" className="spi-dt-btn-next" disabled={ctx.saving} onClick={() => { void ctx.saveLines(); }}>
              {ctx.saving ? 'Saving…' : 'Save'}
            </button>
          )}
        />
      </div>
    </div>

    {/* Only a saved PO against a PI can leave PI quantity uncovered. */}
    {saved && saved.some((l) => l.pi) && (
    <div className={`spi-dt-sec ${missOpen ? '' : 'is-collapsed'}`}>
      <div className="spi-dt-sec-head cpf-clickable" onClick={() => setMissOpen((o) => !o)}>
        <div className="spi-dt-sec-ico spi-dt-sec-ico-2"><IcoAlert /></div>
        <div className="spi-dt-sec-mid">
          <div className="spi-dt-sec-row">
            <span className="spi-dt-sec-lbl">Products</span>
            <span className="spi-dt-sec-sep" />
            <span className="spi-dt-sec-title">Missing Product Details</span>
          </div>
          <div className="spi-dt-sec-sub">PI quantities not fully covered by the purchase order</div>
        </div>
        <span className={`cpd-misscount cpf-push ${missing === 0 ? 'is-zero' : ''}`}>{missing} Missing</span>
        <span className={`cpf-chev ${missOpen ? '' : 'is-closed'}`}><IcoChevron /></span>
      </div>
      <div className="spi-dt-sec-body">
        <MissingProducts rows={saved} products={products} taxMode={ctx.taxMode} />
      </div>
    </div>
    )}
    </>
  );
}

function RefPill({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="spi-dt-pill">
      <span className="spi-dt-pill-ico">{icon}</span>
      <div className="spi-dt-pill-txt">
        <div className="spi-dt-pill-lbl">{label}</div>
        <FitTip label={value}><div className="spi-dt-pill-val">{value}</div></FitTip>
      </div>
    </div>
  );
}
