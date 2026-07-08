import { useState } from 'react';

/* ─────────────────────────────────────────────────────────────────────────
 * SPI Detail wizard — Step 1 "PO Link Supplier Details" (DESIGN-ONLY static).
 * Opens after Confirm & Continue in the Map-SPI modal. Faithful teal port of
 * the P2P_Main prototype. No real data / save yet.
 * ───────────────────────────────────────────────────────────────────────── */

export default function SpiDetail({ onClose }: { onClose: () => void }) {
  const [poOpen, setPoOpen] = useState(true);
  const [supOpen, setSupOpen] = useState(true);
  const [legalOpen, setLegalOpen] = useState(true);
  const [physInsp, setPhysInsp] = useState(false);

  return (
    <div className="spi-dt">
      {/* Header + stepper live in ONE card (Figma) */}
      <div className="spi-dt-topcard">
      {/* ── Header ── */}
      <div className="spi-dt-head">
        <div className="spi-dt-head-l">
          <div className="spi-dt-head-ico"><IcoDoc /></div>
          <div>
            <div className="spi-dt-head-title">Supplier Purchase Invoice</div>
            <div className="spi-dt-head-sub"><span className="spi-dt-livedot" /> Draft · not yet mapped</div>
          </div>
        </div>
        <div className="spi-dt-pills">
          <HeadPill icon={<IcoHash />} label="INVOICE NO" value="SPI/2025-26/001" />
          <span className="spi-dt-dots">⋮</span>
          <HeadPill icon={<IcoDocSm />} label="PO NUMBER" value="PO/2025-26/040" />
          <span className="spi-dt-dots">⋮</span>
          <HeadPill icon={<IcoUser />} label="SUPPLIER" value="Havells India" />
          <span className="spi-dt-dots">⋮</span>
          <HeadPill icon={<IcoShield />} label="GSTIN" value="27AABCA1234F1Z5" />
        </div>
        <div className="spi-dt-head-r">
          <button type="button" className="spi-dt-btn-pay"><IcoCard /> SPI Payment</button>
          <button type="button" className="spi-dt-btn-close" onClick={onClose}><IcoX /> Close</button>
        </div>
      </div>

      {/* ── Step tabs ── */}
      <div className="spi-dt-steps">
        <div className="spi-dt-step is-active">
          <div className="spi-dt-step-top"><span className="spi-dt-step-lbl">STEP 01</span><span className="spi-dt-step-badge">ACTIVE</span></div>
          <div className="spi-dt-step-big">01</div>
          <div className="spi-dt-step-title">PO Link Supplier Details</div>
          <div className="spi-dt-step-desc">Link the PO and confirm supplier details</div>
          <span className="spi-dt-step-ghost">01</span>
        </div>
        <div className="spi-dt-step">
          <div className="spi-dt-step-top"><span className="spi-dt-step-lbl">STEP 02</span></div>
          <div className="spi-dt-step-big">02</div>
          <div className="spi-dt-step-title">Invoice &amp; Product Details (3-Way Match)</div>
          <div className="spi-dt-step-desc">Enter invoice details &amp; match products against the PO &amp; GRN</div>
          <span className="spi-dt-step-ghost">02</span>
        </div>
      </div>
      </div>

      {/* ── Body ── */}
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

      {/* ── Footer ── */}
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
          <button type="button" className="spi-dt-btn-next">Save &amp; Next <IcoChevronR /></button>
        </div>
      </div>
    </div>
  );
}

/* ── Small sub-components ── */
function HeadPill({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="spi-dt-pill">
      <span className="spi-dt-pill-ico">{icon}</span>
      <div><div className="spi-dt-pill-lbl">{label}</div><div className="spi-dt-pill-val">{value}</div></div>
    </div>
  );
}
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
