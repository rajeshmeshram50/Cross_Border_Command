import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useScrollLock } from '../../../../hooks/useScrollLock';

/* ─────────────────────────────────────────────────────────────────────────
 * SPI Detail wizard — Step 1 "PO Link Supplier Details" (DESIGN-ONLY static).
 * Opens after Confirm & Continue in the Map-SPI modal. Faithful teal port of
 * the P2P_Main prototype. No real data / save yet.
 * ───────────────────────────────────────────────────────────────────────── */

const PRODUCTS = [
  { code: 'P-002', name: 'Whole Wheat Flour 50kg', qty: '150', hsn: '11010000', ratePo: '₹220.00', rateSpi: '220' },
  { code: 'P-003', name: 'GreenBoost Organic Fertilizer', qty: '50', hsn: '31010000', ratePo: '₹188.00', rateSpi: '188' },
  { code: 'P-004', name: 'Organic Mango Pulp', qty: '100', hsn: '20079100', ratePo: '₹75.00', rateSpi: '75' },
  { code: 'P-005', name: 'Quality Testing Service', qty: '1', hsn: '999899', ratePo: '₹3,200.00', rateSpi: '3200' },
];

const inr = (n: number) => '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function SpiDetail({ onClose, withPo = true }: { onClose: () => void; withPo?: boolean }) {
  useScrollLock();
  const [step, setStep] = useState(1);
  const [poOpen, setPoOpen] = useState(true);
  const [supOpen, setSupOpen] = useState(true);
  const [legalOpen, setLegalOpen] = useState(true);
  const [physInsp, setPhysInsp] = useState(false);
  const [sumOpen, setSumOpen] = useState(true);
  const [invOpen, setInvOpen] = useState(true);
  const [prodOpen, setProdOpen] = useState(true);

  return createPortal(
    <div className="spi-dt-overlay">
    <div className="spi-dt">
      {/* Header + stepper live in ONE card (Figma) */}
      <div className="spi-dt-topcard">
      {/* ── Header ── */}
      <div className="spi-dt-head">
        <div className="spi-dt-head-l">
          <div className="spi-dt-head-ico"><IcoDoc /><span className="spi-dt-head-dot" /></div>
          <div>
            <div className="spi-dt-head-title">Supplier Purchase Invoice</div>
            <div className="spi-dt-head-sub">Draft · not yet mapped</div>
          </div>
        </div>
        <div className="spi-dt-pills">
          <HeadPill icon={<IcoLines />} label="INVOICE NO" value="SPI/2025-26/001" mono />
          <span className="spi-dt-dots">⋮</span>
          <HeadPill icon={<IcoLines />} label="PO NUMBER" value="PO/2025-26/040" alt mono />
          <span className="spi-dt-dots">⋮</span>
          <HeadPill icon={<IcoUser />} label="SUPPLIER" value="Havells India" />
          <span className="spi-dt-dots">⋮</span>
          <HeadPill icon={<IcoLines />} label="GSTIN" value="27AABCA1234F1Z5" alt mono />
        </div>
        <div className="spi-dt-head-r">
          <span className="spi-dt-divider" />
          <button type="button" className="spi-dt-btn-pay"><IcoCard /> SPI Payment</button>
          <span className="spi-dt-divider" />
          <button type="button" className="spi-dt-btn-close" onClick={onClose}><IcoX /> Close</button>
        </div>
      </div>

      {/* ── Step tabs ── */}
      <div className="spi-dt-steps">
        <div className={`spi-dt-step ${step === 1 ? 'is-active' : 'is-done'}`}>
          <div className="spi-dt-step-top"><span className="spi-dt-step-lbl">STEP 01</span>
            {step === 1
              ? <span className="spi-dt-step-badge">ACTIVE</span>
              : <span className="spi-dt-step-badge spi-dt-step-badge-done"><IcoCheck /> DONE</span>}
          </div>
          <div className="spi-dt-step-big">01</div>
          <div className="spi-dt-step-title">PO Link Supplier Details</div>
          <div className="spi-dt-step-desc">Link the PO and confirm supplier details</div>
          <span className="spi-dt-step-ghost">01</span>
        </div>
        <div className={`spi-dt-step ${step === 2 ? 'is-active' : ''}`}>
          <div className="spi-dt-step-top"><span className="spi-dt-step-lbl">STEP 02</span>
            {step === 2 && <span className="spi-dt-step-badge">ACTIVE</span>}
          </div>
          <div className="spi-dt-step-big">02</div>
          <div className="spi-dt-step-title">Invoice &amp; Product Details (3-Way Match)</div>
          <div className="spi-dt-step-desc">Enter invoice details &amp; match products against the PO &amp; GRN</div>
          <span className="spi-dt-step-ghost">02</span>
        </div>
      </div>
      </div>

      {/* ── Body (Step 1) ── */}
      {step === 1 && (
      <div className="spi-dt-body">
        {/* Purchase Order section */}
        <div className={`spi-dt-sec ${poOpen ? '' : 'is-collapsed'}`}>
          <div className="spi-dt-sec-head" onClick={() => setPoOpen(o => !o)}>
            <div className="spi-dt-sec-ico"><IcoDocSm /></div>
            <div className="spi-dt-sec-mid">
              <div className="spi-dt-sec-row"><span className="spi-dt-sec-lbl">Purchase Order</span><span className="spi-dt-sec-sep" /><span className="spi-dt-sec-title">Basic Purchase Order Details</span></div>
              <div className="spi-dt-sec-sub">Core details that identify this purchase order.</div>
            </div>
            <div className="spi-dt-sec-toggle"><IcoChevron /></div>
          </div>
          <div className="spi-dt-sec-body">
            <div className="spi-dt-grid4">
              <Field label="PO TYPE"><Select value="Services" /></Field>
              <Field label="DOCUMENT TYPE"><Select value="Domestics" /></Field>
              <Field label="MODE OF TRANSPORT"><Select value="Road" /></Field>
              <Field label="PO DATE"><div className="spi-dt-inp-auto"><input className="spi-dt-inp" value="07/08/2026" readOnly /><span className="spi-dt-auto"><IcoLock /> AUTO</span></div></Field>
              <Field label="EXPECTED DELIVERY DATE"><input className="spi-dt-inp" type="date" defaultValue="2026-06-07" /></Field>
              <Field label="DELIVERY LOCATION"><input className="spi-dt-inp" placeholder="Enter delivery location" /></Field>
              <Field label="PAYMENT TYPE"><Select value="Advance" /></Field>
              <Field label="PHYSICAL INSPECTION REQUIRED">
                <button type="button" className="spi-dt-toggle" onClick={() => setPhysInsp(v => !v)}>
                  <span className={`spi-dt-toggle-sw ${physInsp ? 'on' : ''}`}><span className="spi-dt-toggle-knob" /></span>
                  <span className="spi-dt-toggle-txt">{physInsp ? 'Yes' : 'No'}</span>
                </button>
              </Field>
            </div>
          </div>
        </div>

        {/* Supplier section */}
        <div className={`spi-dt-sec ${supOpen ? '' : 'is-collapsed'}`}>
          <div className="spi-dt-sec-head" onClick={() => setSupOpen(o => !o)}>
            <div className="spi-dt-sec-ico spi-dt-sec-ico-2"><IcoUser /></div>
            <div className="spi-dt-sec-mid">
              <div className="spi-dt-sec-row"><span className="spi-dt-sec-lbl">Supplier</span><span className="spi-dt-sec-sep" /><span className="spi-dt-sec-title">Basic Supplier Details</span></div>
              <div className="spi-dt-sec-sub">Primary information about the supplier this PO is issued to.</div>
            </div>
            <div className="spi-dt-sec-toggle"><IcoChevron /></div>
          </div>
          <div className="spi-dt-sec-body">
            <div className="spi-dt-card">
              <div className="spi-dt-card-head">
                <div className="spi-dt-card-title"><span className="spi-dt-card-ico"><IcoUser /></span> Supplier Details</div>
                <span className="spi-dt-fields-badge">4 FIELDS</span>
              </div>
              <div className="spi-dt-grid4">
                <Field label="SELECT SUPPLIER"><Select value="— Select Supplier —" muted /></Field>
                <Field label="SUPPLIER CODE"><input className="spi-dt-inp" value="S-018" readOnly /></Field>
                <Field label="COMPANY NAME"><input className="spi-dt-inp spi-dt-inp-hl" value="Havells India" readOnly /></Field>
                <Field label="SUPPLIER TYPE"><Select value="Manufacturer" /></Field>
              </div>
            </div>
            <div className="spi-dt-card">
              <div className="spi-dt-card-head" style={{ cursor: 'pointer' }} onClick={() => setLegalOpen(o => !o)}>
                <div className="spi-dt-card-title"><span className="spi-dt-card-ico spi-dt-card-ico-2"><IcoShield /></span> Supplier Legal Status</div>
                <span className="spi-dt-minus">{legalOpen ? '–' : '+'}</span>
              </div>
              {legalOpen && (
                <div className="spi-dt-legal">
                  <div className="spi-dt-legal-bar"><span className="spi-dt-legal-fill" style={{ width: '0%' }} /></div>
                  <div className="spi-dt-legal-pct">0%</div>
                  <div className="spi-dt-legal-note">Select a supplier to view legal &amp; compliance status.</div>
                </div>
              )}
            </div>

            {/* Address & Contact Details */}
            <div className="spi-dt-card">
              <div className="spi-dt-card-head">
                <div className="spi-dt-card-title"><span className="spi-dt-card-ico spi-dt-card-ico-3"><IcoPin /></span> Address &amp; Contact Details</div>
                <span className="spi-dt-fields-badge">9 FIELDS</span>
              </div>
              <div className="spi-dt-grid4">
                <Field label="REGISTERED OFFICE ADDRESS" full><input className="spi-dt-inp" placeholder="Building / street / area / landmark, with PIN code" /></Field>
                <Field label="COUNTRY"><Select value="India" /></Field>
                <Field label="STATE"><Select value="Maharashtra" /></Field>
                <Field label="STATE CODE"><input className="spi-dt-inp" placeholder="e.g. 27" /></Field>
                <Field label="CITY"><input className="spi-dt-inp" placeholder="Enter city" /></Field>
                <Field label="CONTACT PERSON NAME"><input className="spi-dt-inp" placeholder="Full name" /></Field>
                <Field label="DESIGNATION"><input className="spi-dt-inp" placeholder="e.g. Procurement Manager" /></Field>
                <Field label="CONTACT NUMBER"><input className="spi-dt-inp" placeholder="+91" /></Field>
                <Field label="EMAIL ID"><input className="spi-dt-inp" placeholder="name@company.com" /></Field>
              </div>
            </div>

            {/* GST Scrutiny Details */}
            <div className="spi-dt-card">
              <div className="spi-dt-card-head">
                <div className="spi-dt-card-title"><span className="spi-dt-card-ico spi-dt-card-ico-4"><IcoDocSm /></span> GST Scrutiny Details</div>
                <span className="spi-dt-fields-badge">5 FIELDS</span>
              </div>
              <div className="spi-dt-grid4">
                <Field label="SCRUTINY DATE"><input className="spi-dt-inp" type="date" /></Field>
                <Field label="GST NUMBER"><input className="spi-dt-inp" placeholder="15-digit GSTIN" /></Field>
                <Field label="GST STATUS"><Select value="Active" /></Field>
                <Field label="LAST FILING DATE"><input className="spi-dt-inp" type="date" /></Field>
                <Field label="PREV. INVOICE / REMARKS" full><textarea className="spi-dt-textarea" placeholder="Notes on previous invoices, filing history or scrutiny remarks…" /></Field>
              </div>
            </div>
          </div>
        </div>
      </div>
      )}

      {/* ── Body (Step 2) — read-only summary of the completed Step 1 ── */}
      {step === 2 && (
      <div className="spi-dt-body">
        <div className={`spi-dt-sec ${sumOpen ? '' : 'is-collapsed'}`}>
          <div className="spi-dt-sec-head" onClick={() => setSumOpen(o => !o)}>
            <div className="spi-dt-sec-ico"><IcoHistory /></div>
            <div className="spi-dt-sec-mid">
              <div className="spi-dt-sec-row"><span className="spi-dt-sec-lbl">Summary</span><span className="spi-dt-sec-sep" /><span className="spi-dt-sec-title">What We Did in the Previous Stages</span></div>
              <div className="spi-dt-sec-sub">Read-only summary of all completed stages so far — 1 stage done.</div>
            </div>
            <div className="spi-dt-sec-toggle"><IcoChevron /></div>
          </div>
          <div className="spi-dt-sec-body">
            <div className="spi-dt-sumstep">
              <div className="spi-dt-sumstep-hd">
                <div className="spi-dt-sumstep-hd-l">
                  <span className="spi-dt-sumstep-num">01</span>
                  <span className="spi-dt-sumstep-title">PO Link Supplier Details</span>
                </div>
                <span className="spi-dt-sumstep-done"><IcoCheck /> COMPLETED</span>
              </div>
              <div className="spi-dt-sumstep-body">
                <ROGroup label="Basic Purchase Order Details">
                  <RO label="PO TYPE" value="Services" />
                  <RO label="DOCUMENT TYPE" value="Domestics" />
                  <RO label="MODE OF TRANSPORT" value="Road" />
                  <RO label="PO DATE" value="07/08/2026" />
                  <RO label="EXPECTED DELIVERY DATE" value="2026-07-01" />
                  <RO label="DELIVERY LOCATION" value="— Not provided" muted />
                  <RO label="PAYMENT TYPE" value="Advance" />
                  <RO label="PHYSICAL INSPECTION REQUIRED" value="No" />
                </ROGroup>
                <ROGroup label="Supplier Details">
                  <RO label="SELECT SUPPLIER" value="Havells India Ltd" />
                  <RO label="SUPPLIER CODE" value="S-018" />
                  <RO label="COMPANY NAME" value="Havells India" />
                  <RO label="SUPPLIER TYPE" value="Manufacturer" />
                </ROGroup>
                <ROGroup label="Supplier Legal Status">
                  <RO label="COMPLIANCE" value="100% — 18 of 18 documents completed across all 5 parameters" full />
                </ROGroup>
                <ROGroup label="Address & Contact Details">
                  <RO label="REGISTERED OFFICE ADDRESS" value="QRG Towers, Sector 90, Gurugram 122505" full />
                  <RO label="COUNTRY" value="India" />
                  <RO label="STATE" value="Haryana" />
                  <RO label="STATE CODE" value="06" />
                  <RO label="CITY" value="Gurugram" />
                  <RO label="CONTACT PERSON NAME" value="Anil Rai Gupta" />
                  <RO label="DESIGNATION" value="Procurement Manager" />
                  <RO label="CONTACT NUMBER" value="+91 98110 22334" />
                  <RO label="EMAIL ID" value="anil.gupta@havells.com" />
                </ROGroup>
                <ROGroup label="GST Scrutiny Details">
                  <RO label="SCRUTINY DATE" value="2026-03-15" />
                  <RO label="GST NUMBER" value="27AABCA1234F1Z5" />
                  <RO label="GST STATUS" value="Active" />
                  <RO label="LAST FILING DATE" value="2026-05-10" />
                  <RO label="PREV. INVOICE / REMARKS" value="Preferred supplier. All historical invoices cleared." full />
                </ROGroup>
              </div>
            </div>
          </div>
        </div>

        {/* Invoice section */}
        <div className={`spi-dt-sec ${invOpen ? '' : 'is-collapsed'}`}>
          <div className="spi-dt-sec-head" onClick={() => setInvOpen(o => !o)}>
            <div className="spi-dt-sec-ico"><IcoDocSm /></div>
            <div className="spi-dt-sec-mid">
              <div className="spi-dt-sec-row"><span className="spi-dt-sec-lbl">Invoice</span><span className="spi-dt-sec-sep" /><span className="spi-dt-sec-title">Supplier Purchase Invoice Details</span></div>
              <div className="spi-dt-sec-sub">Enter invoice number, date &amp; attachment</div>
            </div>
            <div className="spi-dt-sec-toggle"><IcoChevron /></div>
          </div>
          <div className="spi-dt-sec-body">
            <div className="spi-dt-grid3">
              <Field label="PURCHASE INVOICE NUMBER"><input className="spi-dt-inp" placeholder="e.g. INV-2025-001" /></Field>
              <Field label="PURCHASE INVOICE DATE"><input className="spi-dt-inp" type="date" /></Field>
              <Field label="PURCHASE INVOICE ATTACHMENT">
                <div className="spi-dt-file"><span className="spi-dt-file-txt"><IcoClip /> Choose file…</span><button type="button" className="spi-dt-file-btn">Browse</button></div>
              </Field>
            </div>
          </div>
        </div>

        {/* Products — 3-way match (With PO) OR standalone tax & cost (Direct/Without PO) */}
        {withPo ? (
        <div className={`spi-dt-sec ${prodOpen ? '' : 'is-collapsed'}`}>
          <div className="spi-dt-sec-head" onClick={() => setProdOpen(o => !o)}>
            <div className="spi-dt-sec-ico spi-dt-sec-ico-2"><IcoBox /></div>
            <div className="spi-dt-sec-mid">
              <div className="spi-dt-sec-row"><span className="spi-dt-sec-lbl">Products</span><span className="spi-dt-sec-sep" /><span className="spi-dt-sec-title">Product Details</span></div>
              <div className="spi-dt-sec-sub">PI vs PO vs SPI product mapping &amp; 3-way match</div>
            </div>
            <div className="spi-dt-secpills">
              <HeadPill icon={<IcoDocSm />} label="SUPPLIER CODE" value="S-018" mono />
              <span className="spi-dt-dots">⋮</span>
              <HeadPill icon={<IcoUser />} label="SUPPLIER NAME" value="Havells India" />
              <span className="spi-dt-dots">⋮</span>
              <HeadPill icon={<IcoPin />} label="STATE CODE" value="06" mono />
              <span className="spi-dt-dots">⋮</span>
              <HeadPill icon={<IcoDocSm />} label="PO NUMBER" value="PO/2025-26/040" mono />
              <span className="spi-dt-dots">⋮</span>
              <HeadPill icon={<IcoDocSm />} label="PI NUMBER" value="PI/2025-26/001" mono />
            </div>
            <div className="spi-dt-sec-toggle"><IcoChevron /></div>
          </div>
          <div className="spi-dt-sec-body">
            <div className="spi-dt-mtable-wrap">
              <table className="spi-dt-mtable">
                <colgroup>
                  <col style={{ width: '3.5%' }} /><col style={{ width: '6.5%' }} /><col style={{ width: '14%' }} /><col style={{ width: '14%' }} /><col style={{ width: '15%' }} />
                  <col style={{ width: '5%' }} /><col style={{ width: '5%' }} /><col style={{ width: '6.5%' }} /><col style={{ width: '6%' }} />
                  <col style={{ width: '8.5%' }} /><col style={{ width: '7.5%' }} /><col style={{ width: '8.5%' }} />
                </colgroup>
                <thead>
                  <tr>
                    <th className="spi-dt-mc-c">SR NO</th>
                    <th>PRODUCT CODE</th>
                    <th>PRODUCT NAME (PI)</th>
                    <th>PRODUCT NAME (PO)</th>
                    <th>PRODUCT NAME (SPI)</th>
                    <th>QUANTITY (PI)</th>
                    <th>QUANTITY (PO)</th>
                    <th>QUANTITY (SPI)</th>
                    <th>MISSING QTY</th>
                    <th>HSN CODE</th>
                    <th>RATE (PO)</th>
                    <th>RATE (SPI)</th>
                  </tr>
                </thead>
                <tbody>
                  {PRODUCTS.map((p, i) => (
                    <tr key={p.code}>
                      <td className="spi-dt-mc-c">{i + 1}</td>
                      <td><span className="spi-dt-mcode">{p.code}</span></td>
                      <td className="spi-dt-mname">{p.name}</td>
                      <td className="spi-dt-mname">{p.name}</td>
                      <td><input className="spi-dt-minp" defaultValue={p.name} /></td>
                      <td>{p.qty}</td>
                      <td>{p.qty}</td>
                      <td><input className="spi-dt-minp spi-dt-minp-sm" defaultValue={p.qty} /></td>
                      <td>0</td>
                      <td><input className="spi-dt-minp spi-dt-minp-sm" defaultValue={p.hsn} /></td>
                      <td className="spi-dt-amt">{p.ratePo}</td>
                      <td><input className="spi-dt-minp spi-dt-minp-sm" defaultValue={p.rateSpi} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
        ) : (
        <div className={`spi-dt-sec ${prodOpen ? '' : 'is-collapsed'}`}>
          <div className="spi-dt-sec-head" onClick={() => setProdOpen(o => !o)}>
            <div className="spi-dt-sec-ico spi-dt-sec-ico-2"><IcoBox /></div>
            <div className="spi-dt-sec-mid">
              <div className="spi-dt-sec-row"><span className="spi-dt-sec-lbl">Products</span><span className="spi-dt-sec-sep" /><span className="spi-dt-sec-title">Product Details</span></div>
              <div className="spi-dt-sec-sub">Supplier invoice products with tax &amp; cost computation</div>
            </div>
            <div className="spi-dt-secpills">
              <HeadPill icon={<IcoDocSm />} label="SUPPLIER CODE" value="S-001" mono />
              <span className="spi-dt-dots">⋮</span>
              <HeadPill icon={<IcoUser />} label="SUPPLIER NAME" value="Reliance Industries Ltd" />
              <span className="spi-dt-dots">⋮</span>
              <HeadPill icon={<IcoPin />} label="STATE CODE" value="27" mono />
            </div>
            <div className="spi-dt-sec-toggle"><IcoChevron /></div>
          </div>
          <div className="spi-dt-sec-body">
            <div className="spi-dt-mtable-wrap">
              <table className="spi-dt-mtable">
                <colgroup>
                  <col style={{ width: '5%' }} /><col style={{ width: '9%' }} /><col style={{ width: '22%' }} /><col style={{ width: '9%' }} /><col style={{ width: '11%' }} />
                  <col style={{ width: '11%' }} /><col style={{ width: '11%' }} /><col style={{ width: '11%' }} /><col style={{ width: '11%' }} />
                </colgroup>
                <thead>
                  <tr>
                    <th className="spi-dt-mc-c">SR NO</th>
                    <th>PRODUCT CODE</th>
                    <th>PRODUCT NAME</th>
                    <th>PRODUCT QUANTITY</th>
                    <th>HSN CODE</th>
                    <th>PRODUCT RATE</th>
                    <th className="spi-dt-mc-r">CGST</th>
                    <th className="spi-dt-mc-r">SGST</th>
                    <th className="spi-dt-mc-r">PRODUCT COST</th>
                  </tr>
                </thead>
                <tbody>
                  {PRODUCTS.map((p, i) => {
                    const base = Number(p.qty) * Number(p.rateSpi);
                    const cgst = base * 0.09;
                    const sgst = base * 0.09;
                    const cost = base + cgst + sgst;
                    return (
                    <tr key={p.code}>
                      <td className="spi-dt-mc-c">{i + 1}</td>
                      <td><span className="spi-dt-mcode">{p.code}</span></td>
                      <td><input className="spi-dt-minp" defaultValue={p.name} /></td>
                      <td><input className="spi-dt-minp spi-dt-minp-sm" defaultValue={p.qty} /></td>
                      <td><input className="spi-dt-minp spi-dt-minp-sm" defaultValue={p.hsn} /></td>
                      <td><input className="spi-dt-minp spi-dt-minp-sm" defaultValue={p.rateSpi} /></td>
                      <td className="spi-dt-amt spi-dt-mc-r">{inr(cgst)}</td>
                      <td className="spi-dt-amt spi-dt-mc-r">{inr(sgst)}</td>
                      <td className="spi-dt-amt spi-dt-mc-r">{inr(cost)}</td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
        )}
      </div>
      )}

      {/* ── Footer ── */}
      {step === 1 ? (
      <div className="spi-dt-foot">
        <div className="spi-dt-foot-l">
          <div>
            <div className="spi-dt-foot-step">STEP 01 OF 02</div>
            <div className="spi-dt-foot-name">PO Link Supplier Details</div>
          </div>
          <div className="spi-dt-dots"><span className="on" /><span /></div>
        </div>
        <div className="spi-dt-foot-r">
          <button type="button" className="spi-dt-btn-ghost" onClick={onClose}><IcoChevronL /> Change Selection</button>
          <button type="button" className="spi-dt-btn-next" onClick={() => setStep(2)}>Save &amp; Next <IcoChevronR /></button>
        </div>
      </div>
      ) : (
      <div className="spi-dt-foot">
        <div className="spi-dt-foot-l">
          <div>
            <div className="spi-dt-foot-step">STEP 02 OF 02</div>
            <div className="spi-dt-foot-name">Invoice &amp; Product Details (3-Way Match)</div>
          </div>
          <div className="spi-dt-dots"><span className="done" /><span className="on" /></div>
        </div>
        <div className="spi-dt-foot-r">
          <button type="button" className="spi-dt-btn-ghost" onClick={() => setStep(1)}><IcoChevronL /> Back</button>
          <button type="button" className="spi-dt-btn-map"><IcoCheck /> Map Invoice</button>
        </div>
      </div>
      )}
    </div>
    </div>,
    document.body,
  );
}

/* ── Small sub-components ── */
function HeadPill({ icon, label, value, alt, mono }: { icon: React.ReactNode; label: string; value: string; alt?: boolean; mono?: boolean }) {
  return (
    <div className="spi-dt-pill">
      <span className={`spi-dt-pill-ico ${alt ? 'spi-dt-pill-ico--alt' : ''}`}>{icon}</span>
      <div><div className="spi-dt-pill-lbl">{label}</div><div className={`spi-dt-pill-val ${mono ? 'spi-dt-pill-val--mono' : ''}`}>{value}</div></div>
    </div>
  );
}
function IcoLines() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7h16M4 12h10M4 17h7"/></svg>; }
function Field({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return <div className={`spi-dt-field ${full ? 'spi-dt-field-full' : ''}`}><label className="spi-dt-field-lbl">{label}</label>{children}</div>;
}
function Select({ value, muted }: { value: string; muted?: boolean }) {
  return (
    <div className={`spi-dt-select ${muted ? 'is-muted' : ''}`}>
      <span>{value}</span>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
    </div>
  );
}
/* read-only recap field + group (Step 2 Summary) */
function RO({ label, value, full, muted }: { label: string; value: string; full?: boolean; muted?: boolean }) {
  return <div className={`spi-dt-ro ${full ? 'spi-dt-ro-full' : ''}`}><div className="spi-dt-ro-lbl">{label}</div><div className={`spi-dt-ro-val ${muted ? 'is-muted' : ''}`}>{value}</div></div>;
}
function ROGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="spi-dt-rogroup"><div className="spi-dt-rogroup-hd">{label}</div><div className="spi-dt-robox"><div className="spi-dt-rogrid">{children}</div></div></div>;
}

/* ── Icons ── */
function IcoDoc() { return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/></svg>; }
function IcoDocSm() { return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>; }
function IcoHash() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/></svg>; }
function IcoUser() { return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>; }
function IcoShield() { return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>; }
function IcoCard() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>; }
function IcoX() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>; }
function IcoChevron() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>; }
function IcoChevronL() { return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>; }
function IcoChevronR() { return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>; }
function IcoLock() { return <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>; }
function IcoCal() { return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>; }
function IcoPin() { return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>; }
function IcoCheck() { return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>; }
function IcoHistory() { return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v5h5"/><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8"/><path d="M12 7v5l4 2"/></svg>; }
function IcoClip() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>; }
function IcoBox() { return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>; }
