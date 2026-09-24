// Create PO — Step 02: PO Product Details.
// Opens with the read-only recap of Step 01, then the PI vs PO product table,
// the additional charges and whatever the PO does not cover.
import { lazy, Suspense, useState } from 'react';
import ProductTable, { computeLine } from './ProductTable';
import ChargesSummary, { type Charges } from './ChargesSummary';
import MissingProducts, { missingCount } from './MissingProducts';
import StageSummary from './StageSummary';
import { FitTip } from '../form-fields';
import { manualRow, type PoDraft, type PoLineRow, type SetDraft } from '../po-draft';
import { CpfSpinner } from '../CreatePoForm';
import type { StepCtx } from '../CreatePoForm';
import { IcoAlert, IcoBox, IcoChevron, IcoLines, IcoPencil, IcoPin, IcoUser } from '../../shared/icons';
import { useAuth } from '../../../../../../contexts/AuthContext';
import { useToast } from '../../../../../../contexts/ToastContext';
// The supplier master's own wizard — mapping a product to the supplier from here
// is what clears a "Not mapped" line without leaving Step 02.
const AddVendorModal = lazy(() => import('../../../../p2p-master-management/supplier-management/AddVendorModal'));

export default function Step2ProductDetails({ draft, set, ctx }: { draft: PoDraft; set: SetDraft; ctx: StepCtx }) {
  const [prodOpen, setProdOpen] = useState(true);
  const { user } = useAuth();
  const toast = useToast();
  // Editing the supplier's own record — supplier maintainers only, same rule as Stage 01.
  const canEditSupplier = user?.user_type === 'super_admin' || user?.user_type === 'client_admin'
    || !!user?.permissions?.['p2p.supplier']?.can_edit;
  const [editingSupplier, setEditingSupplier] = useState(false);
  // Reload the supplier and the product list so a product mapped in the wizard
  // clears its "Not mapped" line here straight away.
  const closeSupplierEdit = async () => {
    setEditingSupplier(false);
    ctx.reloadSupplierList();
    ctx.lookups.reloadProducts();
    if (!draft.vendorId) return;
    const fresh = await ctx.reloadSupplier(draft.vendorId);
    if (fresh) toast.success('Supplier updated', fresh.code + ' — ' + fresh.name + ' details refreshed on this PO.');
  };
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
    {editingSupplier && draft.vendorId && (
      <Suspense fallback={null}>
        <AddVendorModal vendorId={draft.vendorId} scope={draft.docType === 'International' ? 'international' : 'domestic'}
          onClose={closeSupplierEdit} onSubmit={closeSupplierEdit} />
      </Suspense>
    )}
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
          <RefPill icon={<IcoUser />} label="SUPPLIER NAME" value={sup?.name ?? '—'}
            action={draft.vendorId && canEditSupplier ? {
              title: 'Edit this supplier — map a product to it without leaving this step',
              onClick: () => setEditingSupplier(true),
            } : undefined} />
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
          {' '}{ctx.taxMode === 'export' ? 'International supplier: no Indian GST — tax is 0 by default.' : ctx.taxMode === 'inter' ? 'Inter-state supplier: IGST applies.' : 'Intra-state supplier: CGST + SGST apply.'}
        </div>
        {ctx.linesGeneral && <div className="cpd-general-err" role="alert">{ctx.linesGeneral}</div>}
        {/* Why the PI has little or nothing left: its quantity sits on other POs (some maybe still with the senior). */}
        {!standalone && ctx.piHolders.length > 0 && (
          <div className={`cpd-held${lines.length === 0 ? ' cpd-held--empty' : ''}`}>
            <b>{lines.length === 0 ? 'Nothing left to order on this PI.' : 'Part of this PI is already on other POs.'}</b>{' '}
            Its products are on:{' '}
            {ctx.piHolders.map((h, i) => (
              <span key={h.id}>
                {i > 0 && ', '}
                <span className="cpd-held__po">{h.code}</span>{' '}
                <span className={`cpd-held__st cpd-held__st--${h.approval_status === 'pending' ? 'wait' : 'ok'}`}>
                  {h.approval_status === 'pending' ? 'awaiting senior approval'
                    : h.approval_status === 'approved' ? 'senior approved'
                      : h.status === 'draft' ? 'draft' : 'submitted'}
                </span>
              </span>
            ))}
            {ctx.piHolders.some((h) => h.approval_status === 'pending')
              ? '. That quantity is released back to this PI only if the senior rejects it or the PO is cancelled.'
              : '. Raise a standalone PO for anything extra.'}
          </div>
        )}
        <ProductTable rows={lines} products={products} taxMode={ctx.taxMode} ccy={draft.currency} onChange={patchLine} onRemove={removeLine}
          supplierSegments={draft.supplier?.segments ?? null}
          supplierProducts={draft.supplier?.mapped_product_ids ?? null}
          supplierRates={draft.supplier?.product_rates ?? null}
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
          taxLabel={ctx.taxMode === 'export' ? 'Tax' : 'GST'}
          ccy={draft.currency}
          base={base}
          gst={gst}
          charges={draft.charges}
          onChange={patchCharges}
          action={(
            <button type="button" className="spi-dt-btn-next" disabled={ctx.saving} onClick={() => { void ctx.saveLines(); }}>
              {ctx.saving && <CpfSpinner />} {ctx.saving ? 'Saving…' : 'Save'}
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

function RefPill({ icon, label, value, action }: {
  icon: React.ReactNode; label: string; value: string;
  /** A pencil at the end of the pill, e.g. to edit the supplier it names. */
  action?: { title: string; onClick: () => void };
}) {
  return (
    <div className="spi-dt-pill">
      <span className="spi-dt-pill-ico">{icon}</span>
      <div className="spi-dt-pill-txt">
        <div className="spi-dt-pill-lbl">{label}</div>
        <FitTip label={value}><div className="spi-dt-pill-val">{value}</div></FitTip>
      </div>
      {action && (
        <button type="button" className="spi-dt-pill-edit" title={action.title} aria-label={action.title} onClick={action.onClick}>
          <IcoPencil />
        </button>
      )}
    </div>
  );
}
