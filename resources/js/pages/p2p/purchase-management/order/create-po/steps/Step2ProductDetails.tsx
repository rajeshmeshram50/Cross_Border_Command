// Create PO — Step 02: PO Product Details.
// Opens with a read-only recap of Step 01, then the PI vs PO product table.
import { useState } from 'react';
import ProductTable, { computeLine, type PoLineRow } from './ProductTable';
import ChargesSummary, { EMPTY_CHARGES, type Charges } from './ChargesSummary';
import MissingProducts, { missingCount } from './MissingProducts';
import { PI_PRODUCTS } from '../sample-products';
import { formatDmy } from '../../../../../../utils/formatDmy';
import { LEGAL_PARAMS, legalSections, legalTotals, supplierByOption } from '../sample-suppliers';
import type { PoDraft } from '../po-draft';
import { IcoBox, IcoCheck, IcoChevron, IcoHistory, IcoLines, IcoPin, IcoUser, IcoWarn } from '../../icons';

const dash = (v: string) => (v && v.trim() !== '' ? v : '— Not provided');

export default function Step2ProductDetails({ draft }: { draft: PoDraft }) {
  const [summaryOpen, setSummaryOpen] = useState(true);
  const [prodOpen, setProdOpen] = useState(true);
  const picked = supplierByOption(draft.supplier);

  // PO lines start as a copy of the PI: same product, quantity and rate.
  const [lines, setLines] = useState<PoLineRow[]>(
    () => PI_PRODUCTS.map((pi) => ({ pi, poCode: pi.code, qtyPo: pi.qtyPi, rate: pi.rate })),
  );
  const patchLine = (index: number, patch: Partial<PoLineRow>) =>
    setLines((all) => all.map((l, i) => (i === index ? { ...l, ...patch } : l)));

  const [charges, setCharges] = useState<Charges>(EMPTY_CHARGES);
  const [missOpen, setMissOpen] = useState(true);
  const stateCode = draft.stateCode || '27';

  // The totals box adds up the same lines the table shows.
  const computed = lines.map((l) => computeLine(l, stateCode));
  const base = computed.reduce((sum, l) => sum + l.base, 0);
  const gst = computed.reduce((sum, l) => sum + l.gstAmt, 0);
  const missing = missingCount(lines, stateCode);

  return (
    <>
    <div className={`spi-dt-sec ${summaryOpen ? '' : 'is-collapsed'}`}>
      <div className="spi-dt-sec-head cpf-clickable" onClick={() => setSummaryOpen((o) => !o)}>
        <div className="spi-dt-sec-ico"><IcoHistory /></div>
        <div className="spi-dt-sec-mid">
          <div className="spi-dt-sec-row">
            <span className="spi-dt-sec-lbl">Summary</span>
            <span className="spi-dt-sec-sep" />
            <span className="spi-dt-sec-title">What We Did in the Previous Stages</span>
          </div>
          <div className="spi-dt-sec-sub">Read-only summary of all completed stages so far — 1 stage done.</div>
        </div>
        <span className={`cpf-chev ${summaryOpen ? '' : 'is-closed'}`}><IcoChevron /></span>
      </div>

      <div className="spi-dt-sec-body">
        <div className="spi-dt-sumstep">
          <div className="spi-dt-sumstep-hd">
            <div className="spi-dt-sumstep-hd-l">
              <span className="spi-dt-sumstep-num">01</span>
              <span className="spi-dt-sumstep-title">PO Link Supplier Details</span>
            </div>
            <span className="spi-dt-sumstep-done"><IcoCheck /> Completed</span>
          </div>

          <div className="spi-dt-sumstep-body">
            <Group label="Basic Purchase Order Details">
              <RO label="PO Type" value={dash(draft.poType)} />
              <RO label="Document Type" value={dash(draft.docType)} />
              <RO label="Mode of Transport" value={dash(draft.transport)} />
              <RO label="PO Date" value={formatDmy(new Date().toISOString().slice(0, 10))} />
              <RO label="Expected Delivery Date" value={draft.deliveryDate ? formatDmy(draft.deliveryDate) : dash('')} />
              <RO label="Delivery Location" value={dash(draft.deliveryLocation)} />
              <RO label="Payment Type" value={dash(draft.paymentType)} />
              <RO label="Physical Inspection Required" value={draft.physInsp ? 'Yes' : 'No'} />
              {draft.docType === 'International' && (
                <>
                  <RO label="Currency" value={dash(draft.currency)} />
                  <RO label="Exchange Rate" value={dash(draft.exchangeRate)} />
                  <RO label="INCO Term" value={dash(draft.incoTerm)} />
                  <RO label="Port of Loading" value={dash(draft.portLoading)} />
                  <RO label="Port of Discharge" value={dash(draft.portDischarge)} />
                  <RO label="Final Destination" value={dash(draft.finalDestination)} />
                  <RO label="Country of Origin" value={dash(draft.countryOrigin)} />
                </>
              )}
            </Group>

            <Group label="Supplier Details">
              <RO label="Select Supplier" value={dash(draft.supplier)} />
              <RO label="Company Legal Name" value={dash(draft.legalName)} />
              <RO label="Supplier Type" value={dash(draft.supType)} />
              <RO label="Risk Level" value={dash(draft.risk)} />
              <RO label="Supplier Category" value={dash(draft.category)} />
            </Group>

            <Group label="Address & Contact Details">
              <RO label="Registered Office Address" value={dash(draft.address)} full />
              <RO label="Country" value={dash(draft.country)} />
              <RO label="State" value={dash(draft.state)} />
              <RO label="State Code" value={dash(draft.stateCode)} />
              <RO label="City" value={dash(draft.city)} />
              <RO label="Contact Person Name" value={dash(draft.contact)} />
              <RO label="Designation" value={dash(draft.designation)} />
              <RO label="Contact Number" value={dash(draft.phone)} />
              <RO label="Email ID" value={dash(draft.email)} />
            </Group>

            <Group label="Supplier Legal Status">
              {picked ? (
                <>
                  <RO label="Overall" value={`${legalTotals(picked).pct}% · ${legalTotals(picked).done} of ${legalTotals(picked).total} documents`} />
                  {legalSections(picked).map((sec) => (
                    <RO key={sec.name} label={sec.name} value={`${sec.done} / ${sec.total} · ${sec.pct}%`} />
                  ))}
                  <RO label="Parameters" value={LEGAL_PARAMS.map((p) => p.name).join(', ')} full />
                </>
              ) : (
                <RO label="" value={dash('')} full />
              )}
            </Group>

            <Group label="GST Scrutiny Details">
              <RO label="Scrutiny Date" value={draft.scrutinyDate ? formatDmy(draft.scrutinyDate) : dash('')} />
              <RO label="GST Number" value={dash(draft.gstNo)} />
              <RO label="GST Status" value={dash(draft.gstStatus)} />
              <RO label="Last Filing Date" value={draft.filingDate ? formatDmy(draft.filingDate) : dash('')} />
              <RO label="Prev. Invoice / Remarks" value={dash(draft.remarks)} full />
            </Group>

            <Group label="Supplier Risk Alert">
              <RO label="Risk Level" value={dash(draft.risk)} />
              <RO label="Supplier Category" value={dash(draft.category)} />
              <RO label="GST Registration" value={dash(draft.gstStatus)} />
            </Group>
          </div>
        </div>
      </div>
    </div>

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
        <ChargesSummary
          base={base}
          gst={gst}
          charges={charges}
          onChange={(patch) => setCharges((c) => ({ ...c, ...patch }))}
        />
      </div>
    </div>

    <div className={`spi-dt-sec ${missOpen ? '' : 'is-collapsed'}`}>
      <div className="spi-dt-sec-head cpf-clickable" onClick={() => setMissOpen((o) => !o)}>
        <div className="spi-dt-sec-ico cpf-ico-risk"><IcoWarn /></div>
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
        <div className="spi-dt-pill-val" title={value}>{value}</div>
      </div>
    </div>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="spi-dt-rogroup-hd"><span className="cpf-ro-dash" />{label}</div>
      <div className="spi-dt-robox"><div className="spi-dt-rogrid">{children}</div></div>
    </div>
  );
}

function RO({ label, value, full }: { label: string; value: string; full?: boolean }) {
  const missing = value.startsWith('—');
  return (
    <div className={`spi-dt-ro ${full ? 'spi-dt-ro-full' : ''}`}>
      <div className="spi-dt-ro-lbl">{label}</div>
      <div className={`spi-dt-ro-val ${missing ? 'is-muted' : ''}`}>{value}</div>
    </div>
  );
}

