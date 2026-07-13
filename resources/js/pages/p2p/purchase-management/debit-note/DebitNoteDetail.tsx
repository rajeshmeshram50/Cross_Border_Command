import { useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
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
              <span className="spi-dt-divider" />
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
                <Field label="DEBIT NOTE TYPE"><select className="spi-dt-inp dncr-native" defaultValue={DN_TYPES[0]}>{DN_TYPES.map(t => <option key={t}>{t}</option>)}</select></Field>
                <Field label="EXPECTED DEBIT DATE"><input type="date" className="spi-dt-inp dncr-native" /></Field>
                <Field label="SPI NUMBER"><select className="spi-dt-inp dncr-native"><option>— Select SPI Number —</option></select></Field>
                <Field label="SPI DATE"><input type="date" className="spi-dt-inp dncr-native" /></Field>
                <Field label="PO NUMBER"><select className="spi-dt-inp dncr-native"><option>— Select PO Number —</option></select></Field>
                <Field label="PO DATE"><input type="date" className="spi-dt-inp dncr-native" /></Field>
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
                  <Field label="SELECT SUPPLIER"><select className="spi-dt-inp dncr-native"><option>— Select Supplier —</option></select></Field>
                  <Field label="SUPPLIER CODE"><input className="spi-dt-inp" placeholder="e.g. S-001" /></Field>
                  <Field label="COMPANY NAME"><input className="spi-dt-inp" placeholder="Enter company name" /></Field>
                  <Field label="SUPPLIER TYPE"><select className="spi-dt-inp dncr-native" defaultValue="Manufacturer"><option>Manufacturer</option><option>Trader</option><option>Service Provider</option><option>Distributor</option></select></Field>
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
                      <div className="spi-dt-legal-bar"><span className="spi-dt-legal-fill" style={{ width: '0%' }} /></div>
                      <div className="spi-dt-legal-pct">0%</div>
                    </div>
                    <div className="spi-dt-legal-note">Select a supplier to view legal &amp; compliance status.</div>
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
                  <Field label="REGISTERED OFFICE ADDRESS" full><input className="spi-dt-inp" placeholder="Building / street / area / landmark, with PIN code" /></Field>
                  <Field label="COUNTRY"><select className="spi-dt-inp dncr-native" defaultValue="India"><option>India</option></select></Field>
                  <Field label="STATE"><select className="spi-dt-inp dncr-native" defaultValue="Maharashtra"><option>Maharashtra</option></select></Field>
                  <Field label="STATE CODE"><input className="spi-dt-inp" placeholder="e.g. 27" /></Field>
                  <Field label="CITY"><input className="spi-dt-inp" placeholder="Enter city" /></Field>
                  <Field label="CONTACT PERSON NAME"><input className="spi-dt-inp" placeholder="Full name" /></Field>
                  <Field label="DESIGNATION"><input className="spi-dt-inp" placeholder="e.g. Procurement Manager" /></Field>
                  <Field label="CONTACT NUMBER"><input className="spi-dt-inp" placeholder="+91" /></Field>
                  <Field label="EMAIL ID"><input className="spi-dt-inp" placeholder="name@company.com" /></Field>
                </div>
              </div>

              {/* GST Scrutiny Details card */}
              <div className="spi-dt-card">
                <div className="spi-dt-card-head">
                  <div className="spi-dt-card-title"><span className="spi-dt-card-ico spi-dt-card-ico-4"><IcoDocSm /></span> GST Scrutiny Details</div>
                  <span className="spi-dt-fields-badge">5 FIELDS</span>
                </div>
                <div className="spi-dt-grid4">
                  <Field label="SCRUTINY DATE"><input type="date" className="spi-dt-inp dncr-native" /></Field>
                  <Field label="GST NUMBER"><input className="spi-dt-inp" placeholder="15-digit GSTIN" /></Field>
                  <Field label="GST STATUS"><select className="spi-dt-inp dncr-native" defaultValue="Active"><option>Active</option><option>Inactive</option><option>Suspended</option><option>Cancelled</option></select></Field>
                  <Field label="LAST FILING DATE"><input type="date" className="spi-dt-inp dncr-native" /></Field>
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
            <div className="spi-dt-sec-body"><div className="dncr-placeholder">Step 01 — Basic Debit Note Details completed.</div></div>
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
          <div className={`spi-dt-sec ${prodOpen ? '' : 'is-collapsed'}`}>
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
                <span className="dncr-prodmeta-txt">{DN_PRODUCTS.length} products · edit any cell, add or remove rows</span>
                <button type="button" className="dncr-addprod"><IcoPlus /> Add Product</button>
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
                  <div className="dncr-charge-block">
                    <div className="dncr-charge-hd"><span className="dncr-charge-lbl dncr-add">— ADDITIONS (+)</span><button type="button" className="dncr-chgbtn dncr-chgbtn-add"><IcoPlus size={12} /> Add</button></div>
                    <div className="dncr-charge-row">
                      <div className="dncr-amtwrap"><span className="dncr-cur">₹</span><input className="dncr-amtinp" type="number" placeholder="0.00" /></div>
                      <input className="dncr-note" placeholder="Note against this charge…" />
                      <button type="button" className="dncr-rowx"><IcoX size={13} /></button>
                    </div>
                  </div>
                  <div className="dncr-charge-block">
                    <div className="dncr-charge-hd"><span className="dncr-charge-lbl dncr-ded">— DEDUCTIONS (-)</span><button type="button" className="dncr-chgbtn dncr-chgbtn-ded"><IcoPlus size={12} /> Add</button></div>
                    <div className="dncr-charge-row">
                      <div className="dncr-amtwrap"><span className="dncr-cur">₹</span><input className="dncr-amtinp" type="number" placeholder="0.00" /></div>
                      <input className="dncr-note" placeholder="Note against this charge…" />
                      <button type="button" className="dncr-rowx"><IcoX size={13} /></button>
                    </div>
                  </div>
                </div>
                <div className="spi-dt-totbox">
                  <div className="spi-dt-totrow"><span className="spi-dt-totrow-k">Total Debit Cost</span><span className="spi-dt-totrow-v">{inr(3125)}</span></div>
                  <div className="spi-dt-totrow"><span className="spi-dt-totrow-k">Total CGST Amount</span><span className="spi-dt-totrow-v">{inr(87)}</span></div>
                  <div className="spi-dt-totrow"><span className="spi-dt-totrow-k">Total SGST Amount</span><span className="spi-dt-totrow-v">{inr(87)}</span></div>
                  <div className="spi-dt-totrow"><span className="spi-dt-totrow-k">Additions (+)</span><span className="spi-dt-totrow-v">{inr(0)}</span></div>
                  <div className="spi-dt-totrow"><span className="spi-dt-totrow-k">Deductions (–)</span><span className="spi-dt-totrow-v">– {inr(0)}</span></div>
                  <div className="spi-dt-totrow spi-dt-totrow-grand"><span className="spi-dt-totrow-k">Grand Total</span><span className="spi-dt-totrow-v">{inr(3125)}</span></div>
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

const DNCR_CSS = `
.dn-scope .dncr-placeholder { padding:60px 40px; text-align:center; color:#94a3b8; font-size:13px; font-weight:600; }
/* Figma header: chips are grouped on the RIGHT (next to Close), not packed after the title. */
.dn-scope .spi-dt-pills { margin-left:auto; }
/* Native select / date controls styled to match the .spi-dt-inp look with a custom chevron. */
.dn-scope select.dncr-native { -webkit-appearance:none; -moz-appearance:none; appearance:none; padding-right:34px; cursor:pointer;
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%230891b2' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E");
  background-repeat:no-repeat; background-position:right 12px center; }
.dn-scope input[type=date].dncr-native::-webkit-calendar-picker-indicator { cursor:pointer; opacity:.55; }

/* Products meta row (count + Add Product) */
.dn-scope .dncr-prodmeta { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:12px; }
.dn-scope .dncr-prodmeta-txt { font-size:11.5px; font-weight:600; color:#64748b; }
.dn-scope .dncr-addprod { display:inline-flex; align-items:center; gap:5px; padding:7px 13px; border:1.5px solid #cfe3ea; border-radius:9px; background:#fff; color:#0e7490; font-size:12px; font-weight:700; cursor:pointer; transition:background .15s,border-color .15s; }
.dn-scope .dncr-addprod:hover { background:#f0fbfe; border-color:#22d3ee; }

/* Additions / Deductions charge blocks (left of the totals panel) */
.dn-scope .dncr-charges { flex:1; display:flex; flex-direction:column; gap:16px; min-width:0; }
.dn-scope .dncr-charge-hd { display:flex; align-items:center; justify-content:space-between; margin-bottom:8px; }
.dn-scope .dncr-charge-lbl { font-size:11.5px; font-weight:800; letter-spacing:.02em; }
.dn-scope .dncr-charge-lbl.dncr-add { color:#0891b2; }
.dn-scope .dncr-charge-lbl.dncr-ded { color:#d97706; }
.dn-scope .dncr-chgbtn { display:inline-flex; align-items:center; gap:4px; padding:4px 11px; border-radius:8px; font-size:11px; font-weight:700; cursor:pointer; border:1.5px solid transparent; background:#fff; transition:background .15s; }
.dn-scope .dncr-chgbtn-add { color:#0891b2; border-color:#bfe4ec; }
.dn-scope .dncr-chgbtn-add:hover { background:#f0fbfe; }
.dn-scope .dncr-chgbtn-ded { color:#d97706; border-color:#fde3ba; }
.dn-scope .dncr-chgbtn-ded:hover { background:#fffbf2; }
.dn-scope .dncr-charge-row { display:flex; align-items:center; gap:10px; }
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
