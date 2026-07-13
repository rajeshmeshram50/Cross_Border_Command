import { useState, useRef, useEffect, useLayoutEffect, type ReactNode, type Dispatch, type SetStateAction } from 'react';
import { createPortal } from 'react-dom';
import { MasterDatePicker } from '../../../../components/ui/MasterDatePicker';
// Reuse the SPI wizard shell styling (.spi-dt-*) so Debit Note matches the SPI create flow 1:1.
import '../supplier-purchase-invoice/supplier-purchase-invoice.css';

/* ─────────────────────────────────────────────────────────────────────────
 * Debit Note — create/edit wizard (DESIGN ONLY, built piece-by-piece).
 * Piece 1: the shell — full-screen overlay, header (title + 5 chips + Close),
 * 2 step tabs, and the footer. Step bodies (Debit Note Details, Supplier,
 * Address, GST, SPI Details, Products, Reason, Terms) land in later pieces.
 * ──────────────────────────────────────────────────────────────────────── */

const DN_TYPES = ['Purchase Return', 'Rate Difference', 'Quantity Difference', 'Quality Rejection', 'GST Adjustment', 'Freight Recovery'];
const todayDisp = new Date().toLocaleDateString('en-US');
const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`;

// Static Step-2 product rows (design-only — mirrors the Figma prototype).
const DN_PRODUCTS = [
  { code: 'P-002', name: 'Whole Wheat Flour 50kg',       hsn: '11010000', qtyPo: 150, qtySpi: 150, debitQty: 10, rate: 220, cgstPct: 2.5, cgstAmt: 55, sgstPct: 2.5, sgstAmt: 55, cost: 2310 },
  { code: 'P-003', name: 'GreenBoost Organic Fertilizer', hsn: '31010000', qtyPo: 50,  qtySpi: 48,  debitQty: 2,  rate: 188, cgstPct: 2.5, cgstAmt: 9,  sgstPct: 2.5, sgstAmt: 9,  cost: 395 },
  { code: 'P-004', name: 'Organic Mango Pulp',            hsn: '20079100', qtyPo: 100, qtySpi: 100, debitQty: 5,  rate: 75,  cgstPct: 6,   cgstAmt: 23, sgstPct: 6,   sgstAmt: 23, cost: 420 },
];
const SPI_AUTO_FIELDS = ['SPI NUMBER', 'SPI DATE', 'PO NUMBER', 'PO DATE', 'GRN ID', 'WAREHOUSE', 'SUPPLIER NAME', 'SUPPLIER GSTIN', 'PAYMENT TERM', 'TOTAL INVOICE AMOUNT', 'PAID AMOUNT', 'TOTAL BALANCE AMOUNT'];

// Sample suppliers (design-only). Picking one auto-fills + locks the supplier fields
// below — mirrors the intended flow (data comes from the supplier master, read-only).
type ChargeRow = { amount: string; note: string };
type Supplier = { code: string; company: string; type: string; address: string; country: string; state: string; stateCode: string; city: string; contact: string; designation: string; phone: string; email: string; gstNo: string; gstStatus: string; scrutinyDate: string; filingDate: string };
const SUPPLIERS: Supplier[] = [
  { code: 'S-001', company: 'Reliance Industries Ltd', type: 'Manufacturer', address: 'Maker Chambers IV, Nariman Point, Mumbai 400021', country: 'India', state: 'Maharashtra', stateCode: '27', city: 'Mumbai', contact: 'Ramesh Shah', designation: 'Procurement Manager', phone: '+91 98200 11223', email: 'ramesh@relianceind.com', gstNo: '27AAACR5055K1Z5', gstStatus: 'Active', scrutinyDate: '2026-04-10', filingDate: '2026-06-30' },
  { code: 'S-002', company: 'Tata Steel Ltd', type: 'Manufacturer', address: 'Bombay House, 24 Homi Mody St, Fort, Mumbai 400001', country: 'India', state: 'Jharkhand', stateCode: '20', city: 'Jamshedpur', contact: 'Anil Kumar', designation: 'Sourcing Head', phone: '+91 96500 44556', email: 'anil.kumar@tatasteel.com', gstNo: '20AAACT2803M1ZH', gstStatus: 'Active', scrutinyDate: '2026-03-22', filingDate: '2026-06-28' },
  { code: 'S-004', company: 'Mahindra Logistics Ltd', type: 'Service Provider', address: 'Mahindra Towers, Worli, Mumbai 400018', country: 'India', state: 'Maharashtra', stateCode: '27', city: 'Mumbai', contact: 'Priya Nair', designation: 'Vendor Relations', phone: '+91 99300 77889', email: 'priya.nair@mahindralog.com', gstNo: '27AABCM8892F1Z3', gstStatus: 'Active', scrutinyDate: '2026-05-01', filingDate: '2026-07-05' },
];

export default function DebitNoteDetail({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState<1 | 2>(1);
  const [dnOpen, setDnOpen] = useState(true);
  const [supOpen, setSupOpen] = useState(true);
  const [legalOpen, setLegalOpen] = useState(true);
  const [sumOpen, setSumOpen] = useState(false);
  const [spiOpen, setSpiOpen] = useState(true);
  const [prodOpen, setProdOpen] = useState(true);
  const [reasonOpen, setReasonOpen] = useState(true);
  const [termsOpen, setTermsOpen] = useState(true);
  // Design-only form values (drives the app dropdowns + date pickers).
  const [f, setF] = useState<Record<string, string>>({ dnType: 'Purchase Return', supType: 'Manufacturer', country: 'India', state: 'Maharashtra', gstStatus: 'Active' });
  const set = (k: string) => (v: string) => setF(o => ({ ...o, [k]: v }));
  // Selected supplier — once picked, the supplier fields below auto-fill & lock (read-only AUTO).
  const [sel, setSel] = useState<Supplier | null>(null);
  // Additions / Deductions charge rows (add/remove; the lists scroll internally past ~3 rows
  // so the section height stays fixed and never pushes the totals panel out of alignment).
  const [additions, setAdditions] = useState<ChargeRow[]>([{ amount: '', note: '' }]);
  const [deductions, setDeductions] = useState<ChargeRow[]>([{ amount: '', note: '' }]);
  const sumAmt = (rows: ChargeRow[]) => rows.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);
  const addSum = sumAmt(additions);
  const dedSum = sumAmt(deductions);
  const PRODUCT_TOTAL = 3125;
  const grandTotal = PRODUCT_TOTAL + addSum - dedSum;

  return createPortal(
    <div className="spi-dt-overlay dn-scope">
      <div className="spi-dt">
        {/* Header + stepper share one card (Figma) */}
        <div className="spi-dt-topcard">
          {/* ── Header ── */}
          <div className="spi-dt-head">
            <div className="spi-dt-head-l">
              <div className="spi-dt-head-ico"><IcoDoc /><span className="spi-dt-head-dot" /></div>
              <div>
                <div className="spi-dt-head-title">Debit Note</div>
                <div className="spi-dt-head-sub">Draft · not yet issued</div>
              </div>
            </div>
            <div className="spi-dt-pills">
              <HeadPill icon={<IcoLines />} label="SHIPMENT ID" value="—" mono />
              <span className="spi-dt-dots">⋮</span>
              <HeadPill icon={<IcoLines />} label="PROCUREMENT ID" value="—" alt mono />
              <span className="spi-dt-dots">⋮</span>
              <HeadPill icon={<IcoLines />} label="SPI NUMBER" value="—" mono />
              <span className="spi-dt-dots">⋮</span>
              <HeadPill icon={<IcoLines />} label="PO NUMBER" value="—" alt mono />
              <span className="spi-dt-dots">⋮</span>
              <HeadPill icon={<IcoUser />} label="SUPPLIER" value="—" />
            </div>
            <div className="spi-dt-head-r">
              <button type="button" className="spi-dt-btn-close" onClick={onClose}><IcoX /> Close</button>
            </div>
          </div>

          {/* ── Step tabs ── */}
          <div className="spi-dt-steps">
            <div className={`spi-dt-step spi-dt-step--nav ${step === 1 ? 'is-active' : 'is-done'}`} role="button" tabIndex={0} title="Go to Step 1" onClick={() => setStep(1)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setStep(1); } }}>
              <div className="spi-dt-step-top"><span className="spi-dt-step-lbl">STEP 01</span>
                {step === 1
                  ? <span className="spi-dt-step-badge">ACTIVE</span>
                  : <span className="spi-dt-step-badge spi-dt-step-badge-done"><IcoCheck /> DONE</span>}
              </div>
              <div className="spi-dt-step-big">01</div>
              <div className="spi-dt-step-title">Basic Debit Note Details</div>
              <div className="spi-dt-step-desc">Core details that identify this debit note</div>
              <span className="spi-dt-step-ghost">01</span>
            </div>
            <div className={`spi-dt-step spi-dt-step--nav ${step === 2 ? 'is-active' : ''}`} role="button" tabIndex={0} title="Go to Step 2" onClick={() => setStep(2)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setStep(2); } }}>
              <div className="spi-dt-step-top"><span className="spi-dt-step-lbl">STEP 02</span>
                {step === 2 && <span className="spi-dt-step-badge">ACTIVE</span>}
              </div>
              <div className="spi-dt-step-big">02</div>
              <div className="spi-dt-step-title">SPI Details &amp; Debit Note Product Details</div>
              <div className="spi-dt-step-desc">Invoice details &amp; returned / adjusted items</div>
              <span className="spi-dt-step-ghost">02</span>
            </div>
          </div>
        </div>

        {/* ── Body (Step 1) ── */}
        {step === 1 && (
        <div className="spi-dt-body">
          {/* Section 1 — Debit Note Details */}
          <div className={`spi-dt-sec ${dnOpen ? '' : 'is-collapsed'}`}>
            <div className="spi-dt-sec-head" onClick={() => setDnOpen(o => !o)}>
              <div className="spi-dt-sec-ico"><IcoDocSm /></div>
              <div className="spi-dt-sec-mid">
                <div className="spi-dt-sec-row"><span className="spi-dt-sec-lbl">Debit Note</span><span className="spi-dt-sec-sep" /><span className="spi-dt-sec-title">Debit Note Details</span></div>
                <div className="spi-dt-sec-sub">Core details that identify this debit note.</div>
              </div>
              <div className="spi-dt-sec-toggle"><IcoChevron /></div>
            </div>
            <div className="spi-dt-sec-body">
              <div className="spi-dt-grid4">
                <Field label="DEBIT NOTE NO."><div className="spi-dt-inp-auto"><input className="spi-dt-inp" value="DN/2025-26/001" readOnly /><span className="spi-dt-auto"><IcoLock /> AUTO</span></div></Field>
                <Field label="DEBIT NOTE DATE"><div className="spi-dt-inp-auto"><input className="spi-dt-inp" value={todayDisp} readOnly /><span className="spi-dt-auto"><IcoLock /> AUTO</span></div></Field>
                <Field label="DEBIT NOTE TYPE"><DnSelect value={f.dnType} options={DN_TYPES} onChange={set('dnType')} /></Field>
                <Field label="EXPECTED DEBIT DATE"><MasterDatePicker value={f.expDate ?? ''} onChange={set('expDate')} placeholder="Select date" popupClassName="dncr-cal" /></Field>
                <Field label="SPI NUMBER"><DnSelect value={f.spiNum ?? ''} options={[]} placeholder="— Select SPI Number —" onChange={set('spiNum')} /></Field>
                <Field label="SPI DATE"><MasterDatePicker value={f.spiDate ?? ''} onChange={set('spiDate')} placeholder="Select date" popupClassName="dncr-cal" /></Field>
                <Field label="PO NUMBER"><DnSelect value={f.poNum ?? ''} options={[]} placeholder="— Select PO Number —" onChange={set('poNum')} /></Field>
                <Field label="PO DATE"><MasterDatePicker value={f.poDate ?? ''} onChange={set('poDate')} placeholder="Select date" popupClassName="dncr-cal" /></Field>
              </div>
            </div>
          </div>

          {/* Section 2 — Supplier */}
          <div className={`spi-dt-sec ${supOpen ? '' : 'is-collapsed'}`}>
            <div className="spi-dt-sec-head" onClick={() => setSupOpen(o => !o)}>
              <div className="spi-dt-sec-ico spi-dt-sec-ico-2"><IcoUser /></div>
              <div className="spi-dt-sec-mid">
                <div className="spi-dt-sec-row"><span className="spi-dt-sec-lbl">Supplier</span><span className="spi-dt-sec-sep" /><span className="spi-dt-sec-title">Supplier Details</span></div>
                <div className="spi-dt-sec-sub">Primary information about the supplier this debit note is issued to.</div>
              </div>
              <div className="spi-dt-sec-toggle"><IcoChevron /></div>
            </div>
            <div className="spi-dt-sec-body">
              {/* Supplier Details card */}
              <div className="spi-dt-card">
                <div className="spi-dt-card-head">
                  <div className="spi-dt-card-title"><span className="spi-dt-card-ico"><IcoUser /></span> Supplier Details</div>
                  <span className="spi-dt-fields-badge">4 FIELDS</span>
                </div>
                <div className="spi-dt-grid4">
                  <Field label="SELECT SUPPLIER"><DnSelect value={sel?.company ?? ''} options={SUPPLIERS.map(s => s.company)} placeholder="— Select Supplier —" onChange={v => setSel(SUPPLIERS.find(s => s.company === v) ?? null)} /></Field>
                  <SupField label="SUPPLIER CODE" value={sel?.code} edit={<input className="spi-dt-inp" placeholder="e.g. S-001" />} />
                  <SupField label="COMPANY NAME" value={sel?.company} edit={<input className="spi-dt-inp" placeholder="Enter company name" />} />
                  <SupField label="SUPPLIER TYPE" value={sel?.type} edit={<DnSelect value={f.supType} options={['Manufacturer', 'Trader', 'Service Provider', 'Distributor']} onChange={set('supType')} />} />
                </div>
              </div>

              {/* Supplier Legal Status card */}
              <div className="spi-dt-card">
                <div className="spi-dt-card-head" style={{ cursor: 'pointer' }} onClick={() => setLegalOpen(o => !o)}>
                  <div className="spi-dt-card-title"><span className="spi-dt-card-ico spi-dt-card-ico-2"><IcoShield /></span> Supplier Legal Status</div>
                  <span className="spi-dt-minus">{legalOpen ? '–' : '+'}</span>
                </div>
                {legalOpen && (
                  <div className="spi-dt-legal">
                    <div className="spi-dt-legal-top">
                      <div className="spi-dt-legal-bar"><span className="spi-dt-legal-fill" style={{ width: sel ? '100%' : '0%', background: sel ? 'linear-gradient(90deg,#0e7490,#0891b2 55%,#06b6d4)' : undefined }} /></div>
                      <div className="spi-dt-legal-pct">{sel ? '100%' : '0%'}</div>
                    </div>
                    <div className="spi-dt-legal-note">{sel ? `${sel.company} — legal & compliance documents verified.` : 'Select a supplier to view legal & compliance status.'}</div>
                  </div>
                )}
              </div>

              {/* Address & Contact Details card */}
              <div className="spi-dt-card">
                <div className="spi-dt-card-head">
                  <div className="spi-dt-card-title"><span className="spi-dt-card-ico spi-dt-card-ico-3"><IcoPin /></span> Address &amp; Contact Details</div>
                  <span className="spi-dt-fields-badge">9 FIELDS</span>
                </div>
                <div className="spi-dt-grid4">
                  <SupField label="REGISTERED OFFICE ADDRESS" full value={sel?.address} edit={<input className="spi-dt-inp" placeholder="Building / street / area / landmark, with PIN code" />} />
                  <SupField label="COUNTRY" value={sel?.country} edit={<DnSelect value={f.country} options={['India']} onChange={set('country')} />} />
                  <SupField label="STATE" value={sel?.state} edit={<DnSelect value={f.state} options={['Maharashtra', 'Jharkhand', 'Gujarat', 'Karnataka']} onChange={set('state')} />} />
                  <SupField label="STATE CODE" value={sel?.stateCode} edit={<input className="spi-dt-inp" placeholder="e.g. 27" />} />
                  <SupField label="CITY" value={sel?.city} edit={<input className="spi-dt-inp" placeholder="Enter city" />} />
                  <SupField label="CONTACT PERSON NAME" value={sel?.contact} edit={<input className="spi-dt-inp" placeholder="Full name" />} />
                  <SupField label="DESIGNATION" value={sel?.designation} edit={<input className="spi-dt-inp" placeholder="e.g. Procurement Manager" />} />
                  <SupField label="CONTACT NUMBER" value={sel?.phone} edit={<input className="spi-dt-inp" placeholder="+91" />} />
                  <SupField label="EMAIL ID" value={sel?.email} edit={<input className="spi-dt-inp" placeholder="name@company.com" />} />
                </div>
              </div>

              {/* GST Scrutiny Details card */}
              <div className="spi-dt-card">
                <div className="spi-dt-card-head">
                  <div className="spi-dt-card-title"><span className="spi-dt-card-ico spi-dt-card-ico-4"><IcoDocSm /></span> GST Scrutiny Details</div>
                  <span className="spi-dt-fields-badge">5 FIELDS</span>
                </div>
                <div className="spi-dt-grid4">
                  <SupField label="SCRUTINY DATE" value={sel?.scrutinyDate} edit={<MasterDatePicker value={f.scrutinyDate ?? ''} onChange={set('scrutinyDate')} placeholder="Select date" popupClassName="dncr-cal" />} />
                  <SupField label="GST NUMBER" value={sel?.gstNo} edit={<input className="spi-dt-inp" placeholder="15-digit GSTIN" />} />
                  <SupField label="GST STATUS" value={sel?.gstStatus} edit={<DnSelect value={f.gstStatus} options={['Active', 'Inactive']} onChange={set('gstStatus')} />} />
                  <SupField label="LAST FILING DATE" value={sel?.filingDate} edit={<MasterDatePicker value={f.lastFilingDate ?? ''} onChange={set('lastFilingDate')} placeholder="Select date" popupClassName="dncr-cal" />} />
                  <Field label="PREV. INVOICE / REMARKS" full><textarea className="spi-dt-textarea" placeholder="Notes on previous invoices, filing history or scrutiny remarks…" /></Field>
                </div>
              </div>
            </div>
          </div>
        </div>
        )}

        {/* ── Body (Step 2) ── */}
        {step === 2 && (
        <div className="spi-dt-body">
          {/* Summary (read-only, collapsed) */}
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
                    <span className="spi-dt-sumstep-title">Basic Debit Note Details</span>
                  </div>
                  <span className="spi-dt-sumstep-done"><IcoCheck /> COMPLETED</span>
                </div>
                <div className="spi-dt-sumstep-body">
                  <ROGroup label="Debit Note Details">
                    <RO label="DEBIT NOTE NO." value="DN/2025-26/001" />
                    <RO label="DEBIT NOTE DATE" value={todayDisp} />
                    <RO label="DEBIT NOTE TYPE" value={np(f.dnType)} muted={!f.dnType} />
                    <RO label="EXPECTED DEBIT DATE" value={np(f.expDate)} muted={!f.expDate} />
                    <RO label="SPI NUMBER" value={np(f.spiNum)} muted={!f.spiNum} />
                    <RO label="SPI DATE" value={np(f.spiDate)} muted={!f.spiDate} />
                    <RO label="PO NUMBER" value={np(f.poNum)} muted={!f.poNum} />
                    <RO label="PO DATE" value={np(f.poDate)} muted={!f.poDate} />
                  </ROGroup>
                  <ROGroup label="Supplier Details">
                    <RO label="SELECT SUPPLIER" value={np(sel?.company)} muted={!sel} />
                    <RO label="SUPPLIER CODE" value={np(sel?.code)} muted={!sel} />
                    <RO label="COMPANY NAME" value={np(sel?.company)} muted={!sel} />
                    <RO label="SUPPLIER TYPE" value={np(sel?.type ?? f.supType)} muted={!(sel?.type ?? f.supType)} />
                  </ROGroup>
                  <ROGroup label="Supplier Legal Status">
                    <RO label="COMPLIANCE" value={sel ? '100% — legal & compliance documents verified' : '— Not available'} muted={!sel} full />
                  </ROGroup>
                  <ROGroup label="Address & Contact Details">
                    <RO label="REGISTERED OFFICE ADDRESS" value={np(sel?.address)} muted={!sel} full />
                    <RO label="COUNTRY" value={np(sel?.country ?? f.country)} muted={!(sel?.country ?? f.country)} />
                    <RO label="STATE" value={np(sel?.state ?? f.state)} muted={!(sel?.state ?? f.state)} />
                    <RO label="STATE CODE" value={np(sel?.stateCode)} muted={!sel} />
                    <RO label="CITY" value={np(sel?.city)} muted={!sel} />
                    <RO label="CONTACT PERSON NAME" value={np(sel?.contact)} muted={!sel} />
                    <RO label="DESIGNATION" value={np(sel?.designation)} muted={!sel} />
                    <RO label="CONTACT NUMBER" value={np(sel?.phone)} muted={!sel} />
                    <RO label="EMAIL ID" value={np(sel?.email)} muted={!sel} />
                  </ROGroup>
                  <ROGroup label="GST Scrutiny Details">
                    <RO label="SCRUTINY DATE" value={np(sel?.scrutinyDate ?? f.scrutinyDate)} muted={!(sel?.scrutinyDate ?? f.scrutinyDate)} />
                    <RO label="GST NUMBER" value={np(sel?.gstNo)} muted={!sel} />
                    <RO label="GST STATUS" value={np(sel?.gstStatus ?? f.gstStatus)} muted={!(sel?.gstStatus ?? f.gstStatus)} />
                    <RO label="LAST FILING DATE" value={np(sel?.filingDate ?? f.lastFilingDate)} muted={!(sel?.filingDate ?? f.lastFilingDate)} />
                    <RO label="PREV. INVOICE / REMARKS" value="— Not provided" muted full />
                  </ROGroup>
                </div>
              </div>
            </div>
          </div>

          {/* SPI Details — 12 auto fields */}
          <div className={`spi-dt-sec ${spiOpen ? '' : 'is-collapsed'}`}>
            <div className="spi-dt-sec-head" onClick={() => setSpiOpen(o => !o)}>
              <div className="spi-dt-sec-ico"><IcoDocSm /></div>
              <div className="spi-dt-sec-mid">
                <div className="spi-dt-sec-row"><span className="spi-dt-sec-lbl">Supplier Invoice</span><span className="spi-dt-sec-sep" /><span className="spi-dt-sec-title">SPI Details</span></div>
                <div className="spi-dt-sec-sub">Details of the original supplier purchase invoice linked to this debit note.</div>
              </div>
              <div className="spi-dt-sec-toggle"><IcoChevron /></div>
            </div>
            <div className="spi-dt-sec-body">
              <div className="spi-dt-grid4">
                {SPI_AUTO_FIELDS.map(lbl => (
                  <Field key={lbl} label={lbl}><div className="spi-dt-inp-auto"><input className="spi-dt-inp" value="—" readOnly /><span className="spi-dt-auto"><IcoLock /> AUTO</span></div></Field>
                ))}
              </div>
            </div>
          </div>

          {/* Products */}
          <div className={`spi-dt-sec dncr-prodsec ${prodOpen ? '' : 'is-collapsed'}`}>
            <div className="spi-dt-sec-head" onClick={() => setProdOpen(o => !o)}>
              <div className="spi-dt-sec-ico spi-dt-sec-ico-3"><IcoBox /></div>
              <div className="spi-dt-sec-mid">
                <div className="spi-dt-sec-row"><span className="spi-dt-sec-lbl">Products</span><span className="spi-dt-sec-sep" /><span className="spi-dt-sec-title">Debit Note Product Details</span></div>
                <div className="spi-dt-sec-sub">Returned or adjusted items for this debit note.</div>
              </div>
              <div className="spi-dt-sec-toggle"><IcoChevron /></div>
            </div>
            <div className="spi-dt-sec-body">
              <div className="dncr-prodmeta">
                <span className="dncr-prodmeta-txt">{DN_PRODUCTS.length} products · from the linked SPI · edit any cell or remove a row</span>
              </div>
              <div className="spi-dt-mtable-wrap">
                <table className="spi-dt-mtable spi-dt-mtable--fixed">
                  <colgroup>
                    <col style={{ width: '52px' }} /><col style={{ width: '96px' }} /><col style={{ minWidth: '180px' }} />
                    <col style={{ width: '110px' }} /><col style={{ width: '84px' }} /><col style={{ width: '84px' }} /><col style={{ width: '84px' }} /><col style={{ width: '96px' }} />
                    <col style={{ width: '76px' }} /><col style={{ width: '104px' }} /><col style={{ width: '76px' }} /><col style={{ width: '104px' }} /><col style={{ width: '104px' }} /><col style={{ width: '54px' }} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th className="spi-dt-mc-c">SR NO</th><th>PRODUCT CODE</th><th>PRODUCT NAME (SPI)</th><th className="spi-dt-mc-c">HSN CODE</th>
                      <th className="spi-dt-mc-c">QTY (PO)</th><th className="spi-dt-mc-c">QTY (SPI)</th><th className="spi-dt-mc-c">DEBIT QTY</th><th className="spi-dt-mc-c">PRODUCT RATE</th>
                      <th className="spi-dt-mc-c">CGST(%)</th><th className="spi-dt-mc-c">CGST AMOUNT</th><th className="spi-dt-mc-c">SGST(%)</th><th className="spi-dt-mc-c">SGST AMOUNT</th><th className="spi-dt-mc-c">DEBIT COST</th><th className="spi-dt-mc-c">ACTION</th>
                    </tr>
                  </thead>
                  <tbody>
                    {DN_PRODUCTS.map((p, i) => (
                      <tr key={p.code}>
                        <td className="spi-dt-mc-c">{i + 1}</td>
                        <td><input className="spi-dt-minp spi-dt-minp-sm" defaultValue={p.code} /></td>
                        <td><input className="spi-dt-minp" defaultValue={p.name} /></td>
                        <td><input className="spi-dt-minp spi-dt-minp-sm" defaultValue={p.hsn} /></td>
                        <td><input className="spi-dt-minp spi-dt-minp-sm" type="number" defaultValue={p.qtyPo} /></td>
                        <td><input className="spi-dt-minp spi-dt-minp-sm" type="number" defaultValue={p.qtySpi} /></td>
                        <td><input className="spi-dt-minp spi-dt-minp-sm" type="number" defaultValue={p.debitQty} /></td>
                        <td><input className="spi-dt-minp spi-dt-minp-sm" type="number" defaultValue={p.rate} /></td>
                        <td><input className="spi-dt-minp spi-dt-minp-sm" type="number" defaultValue={p.cgstPct} /></td>
                        <td className="spi-dt-amt spi-dt-mc-c">{inr(p.cgstAmt)}</td>
                        <td><input className="spi-dt-minp spi-dt-minp-sm" type="number" defaultValue={p.sgstPct} /></td>
                        <td className="spi-dt-amt spi-dt-mc-c">{inr(p.sgstAmt)}</td>
                        <td className="spi-dt-amt spi-dt-mc-c">{inr(p.cost)}</td>
                        <td className="spi-dt-mc-c"><button type="button" className="spi-dt-rowdel" title="Remove product"><IcoX size={13} /></button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Additions / Deductions + totals */}
              <div className="spi-dt-sum">
                <div className="dncr-charges">
                  <ChargeBlock variant="add" label="ADDITIONS (+)" rows={additions} setRows={setAdditions} />
                  <ChargeBlock variant="ded" label="DEDUCTIONS (-)" rows={deductions} setRows={setDeductions} />
                </div>
                <div className="spi-dt-totbox">
                  <div className="spi-dt-totrow"><span className="spi-dt-totrow-k">Total Debit Cost</span><span className="spi-dt-totrow-v">{inr(PRODUCT_TOTAL)}</span></div>
                  <div className="spi-dt-totrow"><span className="spi-dt-totrow-k">Total CGST Amount</span><span className="spi-dt-totrow-v">{inr(87)}</span></div>
                  <div className="spi-dt-totrow"><span className="spi-dt-totrow-k">Total SGST Amount</span><span className="spi-dt-totrow-v">{inr(87)}</span></div>
                  <div className="spi-dt-totrow"><span className="spi-dt-totrow-k">Additions (+)</span><span className="spi-dt-totrow-v">{inr(addSum)}</span></div>
                  <div className="spi-dt-totrow"><span className="spi-dt-totrow-k">Deductions (–)</span><span className="spi-dt-totrow-v">– {inr(dedSum)}</span></div>
                  <div className="spi-dt-totrow spi-dt-totrow-grand"><span className="spi-dt-totrow-k">Grand Total</span><span className="spi-dt-totrow-v">{inr(grandTotal)}</span></div>
                </div>
              </div>
            </div>
          </div>

          {/* Reason */}
          <div className={`spi-dt-sec ${reasonOpen ? '' : 'is-collapsed'}`}>
            <div className="spi-dt-sec-head" onClick={() => setReasonOpen(o => !o)}>
              <div className="spi-dt-sec-ico spi-dt-sec-ico-2"><IcoChat /></div>
              <div className="spi-dt-sec-mid">
                <div className="spi-dt-sec-row"><span className="spi-dt-sec-lbl">Reason</span><span className="spi-dt-sec-sep" /><span className="spi-dt-sec-title">Debit Note Reason</span></div>
                <div className="spi-dt-sec-sub">Reason for raising this debit note.</div>
              </div>
              <div className="spi-dt-sec-toggle"><IcoChevron /></div>
            </div>
            <div className="spi-dt-sec-body">
              <div className="spi-dt-field spi-dt-field-full"><label className="spi-dt-field-lbl">REASON</label><input className="spi-dt-inp" placeholder="Enter debit note reason…" /></div>
            </div>
          </div>

          {/* Terms & Conditions */}
          <div className={`spi-dt-sec ${termsOpen ? '' : 'is-collapsed'}`}>
            <div className="spi-dt-sec-head" onClick={() => setTermsOpen(o => !o)}>
              <div className="spi-dt-sec-ico spi-dt-sec-ico-4"><IcoDocSm /></div>
              <div className="spi-dt-sec-mid">
                <div className="spi-dt-sec-row"><span className="spi-dt-sec-lbl">Terms</span><span className="spi-dt-sec-sep" /><span className="spi-dt-sec-title">Debit Note Terms &amp; Conditions</span></div>
                <div className="spi-dt-sec-sub">Define the terms &amp; conditions for this debit note.</div>
              </div>
              <div className="spi-dt-sec-toggle"><IcoChevron /></div>
            </div>
            <div className="spi-dt-sec-body">
              <div className="dncr-terms">
                <label className="dncr-terms-lbl">Terms &amp; Condition</label>
                <textarea className="dncr-terms-ta" placeholder="Enter debit note terms & conditions…" />
              </div>
            </div>
          </div>
        </div>
        )}

        {/* ── Footer ── */}
        {step === 1 ? (
          <div className="spi-dt-foot">
            <div className="spi-dt-foot-l">
              <div>
                <div className="spi-dt-foot-step">STEP 01 OF 02</div>
                <div className="spi-dt-foot-name">Basic Debit Note Details</div>
              </div>
              <div className="spi-dt-dots"><span className="on" /><span /></div>
            </div>
            <div className="spi-dt-foot-r">
              <button type="button" className="spi-dt-btn-ghost" onClick={onClose}><IcoChevronL /> Cancel</button>
              <button type="button" className="spi-dt-btn-next" onClick={() => setStep(2)}>Save &amp; Next <IcoChevronR /></button>
            </div>
          </div>
        ) : (
          <div className="spi-dt-foot">
            <div className="spi-dt-foot-l">
              <div>
                <div className="spi-dt-foot-step">STEP 02 OF 02</div>
                <div className="spi-dt-foot-name">SPI Details &amp; Debit Note Product Details</div>
              </div>
              <div className="spi-dt-dots"><span className="done" /><span className="on" /></div>
            </div>
            <div className="spi-dt-foot-r">
              <button type="button" className="spi-dt-btn-ghost" onClick={() => setStep(1)}><IcoChevronL /> Back</button>
              <button type="button" className="spi-dt-btn-map">Generate Debit Note <IcoChevronR /></button>
            </div>
          </div>
        )}
      </div>

      <style>{DNCR_CSS}</style>
    </div>,
    document.body,
  );
}

function HeadPill({ icon, label, value, alt, mono }: { icon: ReactNode; label: string; value: string; alt?: boolean; mono?: boolean }) {
  return (
    <div className="spi-dt-pill">
      <span className={`spi-dt-pill-ico ${alt ? 'spi-dt-pill-ico--alt' : ''}`}>{icon}</span>
      <div className="spi-dt-pill-txt"><div className="spi-dt-pill-lbl">{label}</div><div className={`spi-dt-pill-val ${mono ? 'spi-dt-pill-val--mono' : ''}`} title={value}>{value}</div></div>
    </div>
  );
}

function Field({ label, children, full, req }: { label: string; children: ReactNode; full?: boolean; req?: boolean }) {
  return <div className={`spi-dt-field ${full ? 'spi-dt-field-full' : ''}`}><label className="spi-dt-field-lbl">{label}{req && <span className="spi-dt-req">*</span>}</label>{children}</div>;
}

// "— Not provided" fallback for the Step-2 read-only recap.
const np = (v?: string | null) => (v && String(v).trim() !== '' ? String(v) : '— Not provided');

/* Read-only recap field + group (Step 2 "What We Did in the Previous Stages"). */
function RO({ label, value, full, muted }: { label: string; value: string; full?: boolean; muted?: boolean }) {
  return <div className={`spi-dt-ro ${full ? 'spi-dt-ro-full' : ''}`}><div className="spi-dt-ro-lbl">{label}</div><div className={`spi-dt-ro-val ${muted ? 'is-muted' : ''}`}>{value}</div></div>;
}
function ROGroup({ label, children }: { label: string; children: ReactNode }) {
  return <div className="spi-dt-rogroup"><div className="spi-dt-rogroup-hd">{label}</div><div className="spi-dt-robox"><div className="spi-dt-rogrid">{children}</div></div></div>;
}

/* Additions / Deductions charge block — header (label + "+ Add") stays fixed; the rows live in a
 * scroll container that caps at ~3 rows so the section never grows unbounded (senior-dev layout). */
function ChargeBlock({ variant, label, rows, setRows }: { variant: 'add' | 'ded'; label: string; rows: ChargeRow[]; setRows: Dispatch<SetStateAction<ChargeRow[]>> }) {
  const patch = (i: number, key: 'amount' | 'note', v: string) => setRows(rs => rs.map((r, idx) => idx === i ? { ...r, [key]: v } : r));
  return (
    <div className="dncr-charge-block">
      <div className="dncr-charge-hd">
        <span className={`dncr-charge-lbl dncr-${variant}`}>— {label}</span>
        <button type="button" className={`dncr-chgbtn dncr-chgbtn-${variant}`} onClick={() => setRows(rs => [...rs, { amount: '', note: '' }])}><IcoPlus size={12} /> Add</button>
      </div>
      <div className="dncr-charge-rows">
        {rows.map((row, i) => (
          <div className="dncr-charge-row" key={i}>
            <div className="dncr-amtwrap"><span className="dncr-cur">₹</span><input className="dncr-amtinp" type="number" placeholder="0.00" value={row.amount} onChange={e => patch(i, 'amount', e.target.value)} /></div>
            <input className="dncr-note" placeholder="Note against this charge…" value={row.note} onChange={e => patch(i, 'note', e.target.value)} />
            <button type="button" className="dncr-rowx" title="Remove" onClick={() => setRows(rs => rs.length > 1 ? rs.filter((_, idx) => idx !== i) : rs)}><IcoX size={13} /></button>
          </div>
        ))}
      </div>
    </div>
  );
}

/* Supplier-derived field: once a supplier is picked its value fills in READ-ONLY
 * (the greyed AUTO look, same as DEBIT NOTE DATE); before that, the editable control. */
function SupField({ label, value, full, edit }: { label: string; value?: string; full?: boolean; edit: ReactNode }) {
  return (
    <Field label={label} full={full}>
      {value
        ? <div className="spi-dt-inp-auto"><input className="spi-dt-inp" value={value} title={value} readOnly /><span className="spi-dt-auto"><IcoLock /> AUTO</span></div>
        : edit}
    </Field>
  );
}

/* App-style selective dropdown — same portal-popover pattern & .spi-dt-select styling
 * as the SPI wizard's EditSelect, so Debit Note dropdowns match the rest of the app. */
function DnSelect({ value, options, onChange, placeholder }: { value: string; options: string[]; onChange: (v: string) => void; placeholder?: string }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const [pos, setPos] = useState({ left: 0, top: 0, width: 0 });

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    const h = Math.min(224, Math.max(options.length, 1) * 38 + 10);
    const up = r.bottom + 6 + h > window.innerHeight && r.top - 6 - h > 4;
    setPos({ left: r.left, width: r.width, top: up ? r.top - 6 - h : r.bottom + 6 });
  }, [open, options.length]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (btnRef.current && !btnRef.current.contains(t) && !t.closest?.('.spi-dt-esel-pop')) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const close = () => setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', close);
    document.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', close);
      document.removeEventListener('scroll', close, true);
    };
  }, [open]);

  return (
    <>
      <button type="button" ref={btnRef} title={value || undefined} className={`spi-dt-select spi-dt-select-edit ${open ? 'is-open' : ''} ${!value ? 'is-muted' : ''}`} onClick={() => setOpen(o => !o)}>
        <span>{value || placeholder || '— Select —'}</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
      </button>
      {open && createPortal(
        <div className="spi-dt-esel-pop" style={{ left: pos.left, top: pos.top, width: pos.width }}>
          {options.length === 0
            ? <div className="spi-dt-esel-opt is-muted" style={{ color: '#94a3b8', cursor: 'default' }}>No options</div>
            : options.map(o => (
              <div key={o} className={`spi-dt-esel-opt ${o === value ? 'is-active' : ''}`} onClick={() => { onChange(o); setOpen(false); }}>{o}</div>
            ))}
        </div>,
        document.body,
      )}
    </>
  );
}

const DNCR_CSS = `
.dn-scope .dncr-placeholder { padding:60px 40px; text-align:center; color:#94a3b8; font-size:13px; font-weight:600; }
/* Figma header: chips grouped on the RIGHT, right next to Close. Only the pills carry the auto
 * margin — Close drops its own auto margin, else the free space splits and leaves a gap between them. */
.dn-scope .spi-dt-pills { margin-left:auto; }
.dn-scope .spi-dt-head-r { margin-left:0; }
/* Close button hover = same as the PO wizard (.cstrip__back-btn): gradient darkens + a small lift
 * (dev's default was only a faint brightness with no colour shift). */
.dn-scope .spi-dt-btn-close { background:linear-gradient(135deg,#06b6d4 0%,#0891b2 50%,#0e7490 100%) !important; transition:background .2s,transform .2s,box-shadow .2s !important; }
.dn-scope .spi-dt-btn-close:hover { background:linear-gradient(135deg,#0891b2 0%,#0e7490 50%,#155e75 100%) !important; transform:translateY(-1.5px) !important; filter:none !important; }
/* Figma "Generate Debit Note" CTA (.cpo-btn--p): 135deg teal gradient + top white sheen + soft shadow. */
.dn-scope .spi-dt-btn-map { background:linear-gradient(180deg,rgba(255,255,255,.2),rgba(255,255,255,0) 50%),linear-gradient(135deg,#0e7490,#0891b2 55%,#06b6d4) !important; box-shadow:0 8px 20px -4px rgba(8,145,178,.5) !important; }
/* Figma header chips: all icons are ONE uniform teal gradient (dev alternated bright/dark via
 * the --alt variant). Match the list-header icon gradient + a soft shadow. */
.dn-scope .spi-dt-pill-ico,
.dn-scope .spi-dt-pill-ico--alt { background:linear-gradient(140deg,#22d3ee,#0891b2 60%,#0e7490) !important; box-shadow:0 3px 9px -1px rgba(8,145,178,.5), inset 0 1px 0 rgba(255,255,255,.3) !important; }
/* Figma-strength drop shadow on the teal header/section/card icons (dev's was too subtle) —
 * bigger soft teal shadow + an inset white top highlight so the icons visibly lift off. */
.dn-scope .spi-dt-head-ico { box-shadow:0 8px 20px -4px rgba(8,145,178,.5), inset 0 1px 0 rgba(255,255,255,.42) !important; }
.dn-scope .spi-dt-sec-ico { box-shadow:0 7px 16px -3px rgba(8,145,178,.45), inset 0 1px 0 rgba(255,255,255,.35) !important; }
.dn-scope .spi-dt-card-ico { box-shadow:0 5px 13px -2px rgba(8,145,178,.42), inset 0 1px 0 rgba(255,255,255,.3) !important; }
/* Figma product table (.cpd-tbl) — dev was using the compact/responsive sizing, so it read
 * smaller than the Figma. Restore the Figma base scale: roomier header/cell padding + bigger font. */
/* Products section body is white (not the cyan #f0fbfd) so the whole table area reads clean white. */
.dn-scope .dncr-prodsec .spi-dt-sec-body { background:#fff; }
.dn-scope .spi-dt-mtable { font-size:12px; background:#fff; }
.dn-scope .spi-dt-mtable-wrap { background:#fff; }
.dn-scope .spi-dt-mtable thead th { padding:9px 12px; }
.dn-scope .spi-dt-mtable tbody td { padding:7px 12px; font-size:12px; }
/* Pure white table — kill the blue zebra + input tint so it reads clean white like the Figma. */
.dn-scope .spi-dt-mtable tbody tr,
.dn-scope .spi-dt-mtable tbody tr:nth-child(even),
.dn-scope .spi-dt-mtable tbody tr:nth-child(odd),
.dn-scope .spi-dt-mtable tbody td { background:#fff !important; }
.dn-scope .spi-dt-mtable tbody tr:hover,
.dn-scope .spi-dt-mtable tbody tr:hover td { background:#f6fdff !important; }
.dn-scope .spi-dt-mtable .spi-dt-minp { padding:6px 8px; font-size:11.5px; background:#fff !important; }
.dn-scope .spi-dt-mtable .spi-dt-minp::placeholder { color:#9fb0bf; }

/* Products meta row (count + Add Product) */
.dn-scope .dncr-prodmeta { display:flex; align-items:center; justify-content:space-between; gap:12px; margin:-4px 0 5px; }
.dn-scope .dncr-prodmeta-txt { font-size:11.5px; font-weight:600; color:#64748b; line-height:1.2; }
.dn-scope .dncr-addprod { display:inline-flex; align-items:center; gap:5px; padding:7px 13px; border:1.5px solid #cfe3ea; border-radius:9px; background:#fff; color:#0e7490; font-size:12px; font-weight:700; cursor:pointer; transition:background .15s,border-color .15s; }
.dn-scope .dncr-addprod:hover { background:#f0fbfe; border-color:#22d3ee; }

/* Additions / Deductions charge blocks (left of the totals panel) */
/* Additions | Deductions side by side (horizontal), not stacked — keeps the section short so it
 * balances against the totals panel instead of towering over it when rows are added. */
.dn-scope .dncr-charges { flex:1; display:flex; flex-direction:row; gap:18px; min-width:0; align-items:flex-start; }
.dn-scope .dncr-charge-block { flex:1 1 0; min-width:0; }
.dn-scope .dncr-charge-hd { display:flex; align-items:center; gap:12px; margin-bottom:8px; }
/* Figma .cpd-sum__hd — 9.5px DM Sans, weight 800, .07em, uppercase, teal for BOTH add & ded
 * (only the "+ Add" button turns amber for deductions, not the label). */
.dn-scope .dncr-charge-lbl { font-size:9.5px; font-weight:800; letter-spacing:.07em; text-transform:uppercase; }
.dn-scope .dncr-charge-lbl.dncr-add,
.dn-scope .dncr-charge-lbl.dncr-ded { color:#0891b2; }
.dn-scope .dncr-chgbtn { display:inline-flex; align-items:center; gap:4px; padding:4px 11px; border-radius:8px; font-size:11px; font-weight:700; cursor:pointer; border:1.5px solid transparent; background:#fff; transition:background .15s; }
.dn-scope .dncr-chgbtn-add { color:#0891b2; border-color:#bfe4ec; }
.dn-scope .dncr-chgbtn-add:hover { background:#f0fbfe; }
.dn-scope .dncr-chgbtn-ded { color:#d97706; border-color:#fde3ba; }
.dn-scope .dncr-chgbtn-ded:hover { background:#fffbf2; }
/* Rows scroll internally past ~4 so the block height is capped and the layout never blows up. */
.dn-scope .dncr-charge-rows { display:flex; flex-direction:column; gap:10px; max-height:204px; overflow-y:auto; padding:2px 4px 2px 2px; }
.dn-scope .dncr-charge-rows::-webkit-scrollbar { width:7px; }
.dn-scope .dncr-charge-rows::-webkit-scrollbar-thumb { background:#cfe3ea; border-radius:6px; }
.dn-scope .dncr-charge-rows::-webkit-scrollbar-thumb:hover { background:#a9d3df; }
.dn-scope .dncr-charge-rows::-webkit-scrollbar-track { background:transparent; }
.dn-scope .dncr-charge-row { display:flex; align-items:center; gap:10px; flex-shrink:0; }
.dn-scope .dncr-amtwrap { position:relative; flex:0 0 150px; display:flex; align-items:center; }
.dn-scope .dncr-cur { position:absolute; left:12px; color:#64748b; font-size:13px; font-weight:700; pointer-events:none; }
.dn-scope .dncr-amtinp { width:100%; height:40px; padding:0 12px 0 26px; border:1.5px solid #e3edf2; border-radius:10px; font-size:13px; font-weight:600; color:#0c4a6e; background:#fff; box-sizing:border-box; text-align:right; }
.dn-scope .dncr-note { flex:1; min-width:0; height:40px; padding:0 14px; border:1.5px solid #e3edf2; border-radius:10px; font-size:13px; font-weight:500; color:#0c4a6e; background:#fff; box-sizing:border-box; }
.dn-scope .dncr-amtinp:focus, .dn-scope .dncr-note:focus { outline:none; border-color:#22d3ee; box-shadow:0 0 0 3px rgba(34,211,238,.12); }
.dn-scope .dncr-rowx { flex:0 0 auto; width:34px; height:34px; display:flex; align-items:center; justify-content:center; border:1.5px solid #fecaca; border-radius:9px; background:#fef2f2; color:#dc2626; cursor:pointer; transition:background .15s; }
.dn-scope .dncr-rowx:hover { background:#fee2e2; }
/* Figma Terms block (.cpd-terms) — label 13px/800 + tall textarea (min 272px, radius 14px). */
.dn-scope .dncr-terms { display:flex; flex-direction:column; gap:9px; }
.dn-scope .dncr-terms-lbl { font-size:13px; font-weight:800; color:#1e3a5f; letter-spacing:.01em; }
.dn-scope .dncr-terms-ta { font-family:inherit; font-size:12.5px; font-weight:500; color:#0f172a; padding:14px 15px; border:1.5px solid #d9e2e8; border-radius:14px; background:#fff; min-height:272px; max-height:420px; resize:vertical; width:100%; box-sizing:border-box; line-height:1.6; transition:border-color .15s,box-shadow .15s; }
.dn-scope .dncr-terms-ta:focus { outline:none; border-color:#22d3ee; box-shadow:0 0 0 4px rgba(34,211,238,.12); }
.dn-scope .dncr-terms-ta::placeholder { color:#9fb0bf; }
[data-bs-theme="dark"] .dn-scope .dncr-terms-lbl { color:#cbd5e1; }
[data-bs-theme="dark"] .dn-scope .dncr-terms-ta { background:#0c1c24; border-color:rgba(34,211,238,.22); color:#e2e8f0; }
[data-bs-theme="dark"] .dn-scope .dncr-prodmeta-txt { color:#94a3b8; }
[data-bs-theme="dark"] .dn-scope .dncr-addprod { background:#0c1c24; border-color:rgba(34,211,238,.25); color:#67e8f9; }
[data-bs-theme="dark"] .dn-scope .dncr-amtinp, [data-bs-theme="dark"] .dn-scope .dncr-note { background:#0c1c24; border-color:rgba(34,211,238,.22); color:#e2e8f0; }
[data-bs-theme="dark"] .dn-scope .dncr-chgbtn-add, [data-bs-theme="dark"] .dn-scope .dncr-chgbtn-ded { background:#0c1c24; }

/* Calendar (MasterDatePicker) re-themed TEAL to match the wizard — default is indigo/violet.
 * The popup is portalled to <body>, so these use the .dncr-cal marker (not .dn-scope). */
.dn-scope .master-datepicker-toggle.open { border-color:#0891b2; }
.dn-scope .master-datepicker-icon { color:#0891b2; }
.master-datepicker-popup.dncr-cal .master-datepicker-title-btn.is-clickable { background:rgba(8,145,178,.08); border-color:rgba(8,145,178,.2); color:#0891b2; }
.master-datepicker-popup.dncr-cal .master-datepicker-title-btn.is-clickable:hover { background:rgba(8,145,178,.16); border-color:rgba(8,145,178,.4); color:#0e7490; }
.master-datepicker-popup.dncr-cal .master-datepicker-nav:hover { background:rgba(8,145,178,.1); color:#0891b2; border-color:rgba(8,145,178,.3); }
.master-datepicker-popup.dncr-cal .master-datepicker-day:hover:not(:disabled):not(.is-selected),
.master-datepicker-popup.dncr-cal .master-datepicker-cell:hover:not(.is-selected) { background:rgba(8,145,178,.1); color:#0891b2; }
.master-datepicker-popup.dncr-cal .master-datepicker-day.is-today,
.master-datepicker-popup.dncr-cal .master-datepicker-cell.is-today { background:rgba(8,145,178,.12); color:#0891b2; }
.master-datepicker-popup.dncr-cal .master-datepicker-day.is-selected,
.master-datepicker-popup.dncr-cal .master-datepicker-cell.is-selected { background:linear-gradient(135deg,#0891b2,#06b6d4); color:#fff; box-shadow:0 3px 8px rgba(8,145,178,.3); }
.master-datepicker-popup.dncr-cal .master-datepicker-footer .today-btn { color:#0891b2; }

/* ── Mobile ─────────────────────────────────────────────────────────────
 * Additions/Deductions sit side by side on wider screens; on phones they'd be
 * too cramped, so stack them and trim the amount box. (The 4-col field grids,
 * charges|totals split, steps and recap already respond via the reused SPI CSS.) */
@media (max-width:640px) {
  .dn-scope .dncr-charges { flex-direction:column; gap:16px; }
  .dn-scope .dncr-amtwrap { flex:0 0 104px; }
  .dn-scope .dncr-charge-hd { flex-wrap:wrap; }
  .dn-scope .dncr-prodmeta { flex-wrap:wrap; gap:6px; }
}
`;

/* ── Inline icons ── */
function IcoDoc({ size = 18 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/></svg>; }
function IcoLines({ size = 13 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="14" y2="18"/></svg>; }
function IcoUser({ size = 13 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>; }
function IcoX({ size = 15 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>; }
function IcoCheck({ size = 12 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>; }
function IcoChevronL({ size = 15 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>; }
function IcoChevronR({ size = 15 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>; }
function IcoDocSm({ size = 15 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/></svg>; }
function IcoShield({ size = 15 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>; }
function IcoPin({ size = 15 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>; }
function IcoChevron({ size = 16 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>; }
function IcoLock({ size = 11 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>; }
function IcoHistory({ size = 15 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v5h5"/><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8"/><path d="M12 7v5l4 2"/></svg>; }
function IcoBox({ size = 15 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>; }
function IcoChat({ size = 15 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>; }
function IcoPlus({ size = 13 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>; }
