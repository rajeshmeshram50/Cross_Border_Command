// Create PO — Step 02: PO Product Details.
// Opens with the read-only recap of Step 01, then the PI vs PO product table,
// the additional charges and whatever the PO does not cover.
import { useState } from 'react';
import ProductTable, { computeLine, type PoLineRow } from './ProductTable';
import ChargesSummary, { type Charges } from './ChargesSummary';
import MissingProducts, { missingCount } from './MissingProducts';
import StageSummary from './StageSummary';
import { FitTip } from '../form-fields';
import { supplierByOption } from '../sample-suppliers';
import type { PoDraft, SetDraft } from '../po-draft';
import { useToast } from '../../../../../../contexts/ToastContext';
import { IcoAlert, IcoBox, IcoChevron, IcoLines, IcoPin, IcoUser } from '../../icons';

export default function Step2ProductDetails({ draft, set }: { draft: PoDraft; set: SetDraft }) {
  const [prodOpen, setProdOpen] = useState(true);
  const [missOpen, setMissOpen] = useState(true);
  const picked = supplierByOption(draft.supplier);
  const stateCode = draft.stateCode || '27';

  const lines = draft.lines;
  const patchLine = (index: number, patch: Partial<PoLineRow>) =>
    set({ lines: lines.map((l, i) => (i === index ? { ...l, ...patch } : l)) });
  const patchCharges = (patch: Partial<Charges>) => set({ charges: { ...draft.charges, ...patch } });

  // The totals box adds up the same lines the table shows.
  const computed = lines.map((l) => computeLine(l, stateCode));
  const base = computed.reduce((sum, l) => sum + l.base, 0);
  const gst = computed.reduce((sum, l) => sum + l.gstAmt, 0);
  const missing = missingCount(lines, stateCode);

  /* Static data for now, so there is nothing to post — the toast reports what
     was banked, and this is the one place to call the API from later. */
  const toast = useToast();
  const saveProducts = () =>
    toast.success('Product details saved', `${lines.length} product${lines.length === 1 ? '' : 's'} on this PO.`);

  return (
    <>
    <StageSummary draft={draft} upto={1} />

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
          <RefPill icon={<IcoLines />} label="SUPPLIER CODE" value={picked?.code ?? 'S-001'} />
          <span className="spi-dt-dots">⋮</span>
          <RefPill icon={<IcoUser />} label="SUPPLIER NAME" value={picked?.key ?? 'AgroSource Materials Pvt Ltd'} />
          <span className="spi-dt-dots">⋮</span>
          <RefPill icon={<IcoPin />} label="STATE CODE" value={draft.stateCode || '27'} />
          <span className="spi-dt-dots">⋮</span>
          <RefPill icon={<IcoLines />} label="PI NUMBER" value="PI/2025-26/001" />
        </div>
        <span className={`cpf-chev ${prodOpen ? '' : 'is-closed'}`}><IcoChevron /></span>
      </div>

      <div className="spi-dt-sec-body cpd-body">
        <div className="cpd-legend"><span className="cpd-legend__sw" />Tinted cells are editable — PO product, quantity and rate. Everything else is carried from the PI or calculated.</div>
        <ProductTable rows={lines} stateCode={stateCode} onChange={patchLine} />
        {/* The wizard footer moves to the next step; this Save banks the lines
            and charges without leaving Step 02. It rides in the summary row so
            it sits beside the Grand Total. */}
        <ChargesSummary
          base={base}
          gst={gst}
          charges={draft.charges}
          onChange={patchCharges}
          action={(
            <button type="button" className="spi-dt-btn-next" onClick={saveProducts}>
              Save
            </button>
          )}
        />
      </div>
    </div>

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
        <MissingProducts rows={lines} stateCode={stateCode} onChange={patchLine} />
      </div>
    </div>
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



