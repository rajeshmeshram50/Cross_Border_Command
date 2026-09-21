// Create PO — Step 01: PO Link Supplier Details.
// Section 1: Purchase Order (basic details). Section 2: Supplier.
// The address, legal, GST and risk panels follow in the next sections.
import { lazy, Suspense, useMemo, useState } from 'react';
import { EditSelect, Field } from '../form-fields';
import { gstCheck } from '../gst-check';
// Only fetched when "+ Add Supplier" is clicked.
const AddSupplierFlow = lazy(() => import('../AddSupplierFlow'));
// The Supplier master's own Evidence Vault — fetched on first open, and on
// hover before that, so the click itself never waits for the download.
const SupplierEvidenceVaultModal = lazy(() => import('../../../../p2p-master-management/supplier-management/SupplierEvidenceVaultModal'));
const warmVault = () => { void import('../../../../p2p-master-management/supplier-management/SupplierEvidenceVaultModal'); };
import { SevIcon, riskItems, type Severity } from '../supplier-checks';
import { supplierFields, type PoDraft, type SetDraft } from '../po-draft';
import { MasterDatePicker } from '../../../../../../components/ui/MasterDatePicker';
import { formatDmy } from '../../../../../../utils/formatDmy';
import {
  LEGAL_PARAMS, RISK_GUIDELINES, RISK_LEVELS, SUPPLIER_CATEGORIES, SUPPLIER_OPTIONS, SUPPLIER_TYPES,
  isRiskMandatory, legalSections, legalTotals, supplierByOption, supplierVaultData, supplierVaultTarget, type Supplier,
} from '../sample-suppliers';
import { IcoAlert, IcoCheck, IcoChevron, IcoClock, IcoDocSm, IcoFile, IcoLock, IcoOk, IcoPin, IcoPlus, IcoShield, IcoStop, IcoUser, IcoWarn } from '../../icons';

// Dropdown choices — static until the masters API is wired in.
const PO_TYPES = ['Material / Goods', 'Services', 'FFD / Transporter'];
const DOC_TYPES = ['Domestics', 'International'];
const TRANSPORT_MODES = ['Road', 'Rail', 'Air', 'Sea', 'Courier', 'Multimodal'];
const PAYMENT_TYPES = ['Advance', 'Credit', 'Cash', 'Letter of Credit (LC)', 'Bank Transfer', 'On Delivery'];
const CURRENCIES = ['USD', 'EUR', 'GBP', 'AED', 'JPY', 'CNY', 'SGD', 'INR'];
const INCO_TERMS = ['FOB', 'CIF', 'EXW', 'DAP', 'DDP', 'CFR', 'FCA', 'CPT'];
const COUNTRIES = ['India', 'United Arab Emirates', 'United States', 'United Kingdom', 'Singapore', 'China', 'Germany'];
const STATES = ['Maharashtra', 'Gujarat', 'Karnataka', 'Tamil Nadu', 'Delhi', 'Telangana', 'West Bengal', 'Uttar Pradesh'];
const GST_STATUSES = ['Active', 'Inactive', 'Suspended', 'Cancelled', 'Provisional'];

export default function Step1LinkSupplier({ draft, set }: { draft: PoDraft; set: SetDraft }) {
  const [poOpen, setPoOpen] = useState(true);
  const [supOpen, setSupOpen] = useState(true);

  const poType = draft.poType;
  const setPoType = (v: string) => set({ poType: v });
  const docType = draft.docType;
  const setDocType = (v: string) => set({ docType: v });
  const transport = draft.transport;
  const setTransport = (v: string) => set({ transport: v });
  const deliveryDate = draft.deliveryDate;
  const setDeliveryDate = (v: string) => set({ deliveryDate: v });
  const deliveryLocation = draft.deliveryLocation;
  const setDeliveryLocation = (v: string) => set({ deliveryLocation: v });
  const paymentType = draft.paymentType;
  const setPaymentType = (v: string) => set({ paymentType: v });
  const physInsp = draft.physInsp;
  const setPhysInsp = (v: boolean) => set({ physInsp: v });

  // International POs need currency / shipping terms that a domestic PO doesn't.
  const currency = draft.currency;
  const setCurrency = (v: string) => set({ currency: v });
  const exchangeRate = draft.exchangeRate;
  const setExchangeRate = (v: string) => set({ exchangeRate: v });
  const incoTerm = draft.incoTerm;
  const setIncoTerm = (v: string) => set({ incoTerm: v });
  const portLoading = draft.portLoading;
  const setPortLoading = (v: string) => set({ portLoading: v });
  const portDischarge = draft.portDischarge;
  const setPortDischarge = (v: string) => set({ portDischarge: v });
  const finalDestination = draft.finalDestination;
  const setFinalDestination = (v: string) => set({ finalDestination: v });
  const countryOrigin = draft.countryOrigin;
  const setCountryOrigin = (v: string) => set({ countryOrigin: v });
  const isInternational = docType === 'International';

  // Supplier section — picking a supplier fills the rest of its fields.
  const supplier = draft.supplier;
  const setSupplier = (v: string) => set({ supplier: v });
  const legalName = draft.legalName;
  const setLegalName = (v: string) => set({ legalName: v });
  const supType = draft.supType;
  const setSupType = (v: string) => set({ supType: v });
  const risk = draft.risk;
  const setRisk = (v: string) => set({ risk: v });
  const category = draft.category;
  const setCategory = (v: string) => set({ category: v });

  // Address & contact — also filled from the chosen supplier, still editable.
  const address = draft.address;
  const setAddress = (v: string) => set({ address: v });
  const country = draft.country;
  const setCountry = (v: string) => set({ country: v });
  const state = draft.state;
  const setState = (v: string) => set({ state: v });
  const stateCode = draft.stateCode;
  const setStateCode = (v: string) => set({ stateCode: v });
  const city = draft.city;
  const setCity = (v: string) => set({ city: v });
  const contact = draft.contact;
  const setContact = (v: string) => set({ contact: v });
  const designation = draft.designation;
  const setDesignation = (v: string) => set({ designation: v });
  const phone = draft.phone;
  const setPhone = (v: string) => set({ phone: v });
  const email = draft.email;
  const setEmail = (v: string) => set({ email: v });

  // Every card collapses from its own header.
  const [supCardOpen, setSupCardOpen] = useState(true);
  // "+ Add Supplier": the Supplier master's own Domestic / International
  // chooser, then its onboarding wizard.
  const [addingSupplier, setAddingSupplier] = useState(false);
  const [vaultOpen, setVaultOpen] = useState(false);
  const [addrOpen, setAddrOpen] = useState(true);
  const [gstOpen, setGstOpen] = useState(true);
  const [legalOpen, setLegalOpen] = useState(true);

  // One update, from the same helper edit mode uses to pre-fill.
  const pickSupplier = (option: string) => {
    const s = supplierByOption(option);
    set(s ? { supplier: option, ...supplierFields(s) } : { supplier: option });
  };

  // GST scrutiny — filled from the supplier, still editable.
  const scrutinyDate = draft.scrutinyDate;
  const setScrutinyDate = (v: string) => set({ scrutinyDate: v });
  const gstNo = draft.gstNo;
  const setGstNo = (v: string) => set({ gstNo: v });
  const gstStatus = draft.gstStatus;
  const setGstStatus = (v: string) => set({ gstStatus: v });
  const filingDate = draft.filingDate;
  const setFilingDate = (v: string) => set({ filingDate: v });
  const remarks = draft.remarks;
  const setRemarks = (v: string) => set({ remarks: v });

  // Both dates are checked against the same 3-month window. The action it
  // calls for lives on Step 03, next to Submit PO — the banner only reports.
  const { state: gst, scrutinyAge, filingAge } = gstCheck(draft);

  // Risk alerts are re-derived from the chosen supplier, never stored.
  const [riskOpen, setRiskOpen] = useState(true);
  const picked = useMemo(() => supplierByOption(supplier), [supplier]);
  /* Everything the supplier master fills in is read-only once a master supplier
     is picked — the PO shows the master record, it doesn't edit it (the GST
     banner already says to refresh scrutiny on the supplier record). With no
     supplier, or one outside the master, the fields stay editable. */
  const locked = !!picked;
  // Only re-run the six checks when the supplier or the inspection flag moves,
  // not on every keystroke in the form.
  const risks = useMemo(() => (picked ? riskItems(picked, physInsp) : []), [picked, physInsp]);
  const nHigh = risks.filter((r) => r.sev === 'high').length;
  const nMed = risks.filter((r) => r.sev === 'med').length;
  const nOk = risks.filter((r) => r.sev === 'ok').length;
  const riskSev: Severity = nHigh ? 'high' : nMed ? 'med' : 'ok';
  // A high-risk supplier pins this PO: inspection is forced and terms are fixed.
  const mandatory = picked ? isRiskMandatory(picked) : false;
  const verdict = nHigh
    ? `${nHigh} critical issue${nHigh === 1 ? '' : 's'} need attention${nMed ? ` · ${nMed} warning${nMed === 1 ? '' : 's'}` : ''}`
    : nMed
      ? `${nMed} warning${nMed === 1 ? '' : 's'} to review before release`
      : 'All checks cleared — this supplier is safe to transact with';

  // Compliance totals drive the header bar, its colour and the two section cards.
  const legal = useMemo(() => (picked ? legalTotals(picked) : { done: 0, total: 0, pct: 0 }), [picked]);
  const legalTone = legal.pct === 100 ? 'ok' : legal.pct >= 60 ? 'warn' : 'bad';
  const sections = useMemo(() => (picked ? legalSections(picked) : []), [picked]);
  const vault = useMemo(() => (picked ? { supplier: supplierVaultTarget(picked), data: supplierVaultData(picked) } : null), [picked]);

  // The PO is raised today — shown read-only, never typed in.
  const today = formatDmy(new Date().toISOString().slice(0, 10));

  return (
    <>
    {addingSupplier && (
      <Suspense fallback={null}>
        <AddSupplierFlow onClose={() => setAddingSupplier(false)} />
      </Suspense>
    )}
    {/* View only: the PO shows the supplier's documents, the supplier
        master is where they get uploaded or changed. */}
    {vaultOpen && vault && (
      <Suspense fallback={null}>
        <SupplierEvidenceVaultModal
          open
          viewOnly
          supplier={vault.supplier}
          data={vault.data}
          onClose={() => setVaultOpen(false)}
        />
      </Suspense>
    )}

    <div className={`spi-dt-sec ${poOpen ? '' : 'is-collapsed'}`}>
      <div className="spi-dt-sec-head" onClick={() => setPoOpen((o) => !o)}>
        <div className="spi-dt-sec-ico"><IcoFile /></div>
        <div className="spi-dt-sec-mid">
          <div className="spi-dt-sec-row">
            <span className="spi-dt-sec-lbl">Purchase Order</span>
            <span className="spi-dt-sec-sep" />
            <span className="spi-dt-sec-title">Basic Purchase Order Details</span>
          </div>
          <div className="spi-dt-sec-sub">Core details that identify this purchase order.</div>
        </div>
        <div className="spi-dt-sec-toggle"><IcoChevron /></div>
      </div>

      <div className="spi-dt-sec-body">
        <div className="spi-dt-grid4">
          <Field label="PO Type">
            <EditSelect value={poType} options={PO_TYPES} onChange={setPoType} />
          </Field>
          <Field label="Document Type">
            <EditSelect value={docType} options={DOC_TYPES} onChange={setDocType} />
          </Field>
          <Field label="Mode of Transport">
            <EditSelect value={transport} options={TRANSPORT_MODES} onChange={setTransport} />
          </Field>
          <Field label="PO Date">
            <div className="spi-dt-inp-auto">
              <input className="spi-dt-inp" value={today} readOnly />
              <span className="spi-dt-auto"><IcoLock /> AUTO</span>
            </div>
          </Field>
          <Field label="Expected Delivery Date">
            <MasterDatePicker value={deliveryDate} onChange={setDeliveryDate} />
          </Field>
          <Field label="Delivery Location">
            <input className="spi-dt-inp" placeholder="Enter delivery location" value={deliveryLocation} onChange={(e) => setDeliveryLocation(e.target.value)} />
          </Field>
          <Field label="Payment Type">
            <EditSelect value={paymentType} options={PAYMENT_TYPES} onChange={setPaymentType} />
          </Field>
          <Field label="Physical Inspection Required">
            {/* A high-risk supplier forces this on — locked, with the reason shown. */}
            {mandatory ? (
              <div className="spi-dt-toggle is-readonly cpf-toggle-req" aria-disabled="true">
                <span className="spi-dt-toggle-sw on"><span className="spi-dt-toggle-knob" /></span>
                <span className="spi-dt-toggle-txt">Yes</span>
                <span className="cpf-req">Required</span>
              </div>
            ) : (
              <button type="button" className={`spi-dt-toggle ${physInsp ? 'cpf-toggle-req' : ''}`} onClick={() => setPhysInsp(!physInsp)}>
                <span className={`spi-dt-toggle-sw ${physInsp ? 'on' : ''}`}><span className="spi-dt-toggle-knob" /></span>
                <span className="spi-dt-toggle-txt">{physInsp ? 'Yes' : 'No'}</span>
                <span className={`cpf-req ${physInsp ? '' : 'cpf-req--off'}`}>{physInsp ? 'Required' : 'Not required'}</span>
              </button>
            )}
          </Field>

          {isInternational && (
            <>
              <Field label="Currency">
                <EditSelect value={currency} options={CURRENCIES} onChange={setCurrency} />
              </Field>
              <Field label="Exchange Rate">
                <input className="spi-dt-inp" placeholder="e.g. 83.25" value={exchangeRate} onChange={(e) => setExchangeRate(e.target.value)} />
              </Field>
              <Field label="INCO Term">
                <EditSelect value={incoTerm} options={INCO_TERMS} onChange={setIncoTerm} />
              </Field>
              <Field label="Port of Loading">
                <input className="spi-dt-inp" placeholder="e.g. Nhava Sheva" value={portLoading} onChange={(e) => setPortLoading(e.target.value)} />
              </Field>
              <Field label="Port of Discharge">
                <input className="spi-dt-inp" placeholder="e.g. Jebel Ali" value={portDischarge} onChange={(e) => setPortDischarge(e.target.value)} />
              </Field>
              <Field label="Final Destination">
                <input className="spi-dt-inp" placeholder="Enter final destination" value={finalDestination} onChange={(e) => setFinalDestination(e.target.value)} />
              </Field>
              <Field label="Country of Origin">
                <input className="spi-dt-inp" placeholder="e.g. India" value={countryOrigin} onChange={(e) => setCountryOrigin(e.target.value)} />
              </Field>
            </>
          )}
        </div>
      </div>
    </div>

    <div className={`spi-dt-sec ${supOpen ? '' : 'is-collapsed'}`}>
      <div className="spi-dt-sec-head" onClick={() => setSupOpen((o) => !o)}>
        <div className="spi-dt-sec-ico spi-dt-sec-ico-2"><IcoUser /></div>
        <div className="spi-dt-sec-mid">
          <div className="spi-dt-sec-row">
            <span className="spi-dt-sec-lbl">Supplier</span>
            <span className="spi-dt-sec-sep" />
            <span className="spi-dt-sec-title">Basic Supplier Details</span>
          </div>
          <div className="spi-dt-sec-sub">Primary information about the supplier this PO is issued to.</div>
        </div>
        <div className="spi-dt-sec-toggle"><IcoChevron /></div>
      </div>

      <div className="spi-dt-sec-body">
        <div className="spi-dt-card">
          <div className="spi-dt-card-head cpf-clickable" onClick={() => setSupCardOpen((o) => !o)}>
            <div className="spi-dt-card-title"><span className="spi-dt-card-ico"><IcoUser /></span> Supplier Details</div>
            {/* Onboard a supplier that isn't in the list yet. */}
            <button type="button" className="cpf-addbtn" title="Onboard a supplier that is not in this list" onClick={(e) => { e.stopPropagation(); setAddingSupplier(true); }}>
              <IcoPlus /> Add Supplier
            </button>
            <span className="spi-dt-fields-badge cpf-push">5 FIELDS</span>
            <span className={`cpf-chev ${supCardOpen ? '' : 'is-closed'}`}><IcoChevron /></span>
          </div>
          {supCardOpen && (
          <div className="spi-dt-grid4 cpf-grid5">
            <Field label="SELECT SUPPLIER">
              <EditSelect value={supplier} options={SUPPLIER_OPTIONS} onChange={pickSupplier} placeholder="— Select Supplier —" />
            </Field>
            <Field label="COMPANY LEGAL NAME">
              <input className="spi-dt-inp" placeholder="Registered legal entity name" value={legalName} onChange={(e) => setLegalName(e.target.value)} readOnly={locked} />
            </Field>
            <Field label="SUPPLIER TYPE">
              <EditSelect value={supType} options={SUPPLIER_TYPES} onChange={setSupType} readOnly={locked} />
            </Field>
            <Field label="RISK LEVEL">
              <EditSelect value={risk} options={RISK_LEVELS} onChange={setRisk} readOnly={locked} />
            </Field>
            <Field label="SUPPLIER CATEGORY">
              <EditSelect value={category} options={SUPPLIER_CATEGORIES} onChange={setCategory} readOnly={locked} />
            </Field>
          </div>
          )}
        </div>

        <div className="spi-dt-card">
          <div className="spi-dt-card-head cpf-clickable" onClick={() => setAddrOpen((o) => !o)}>
            <div className="spi-dt-card-title"><span className="spi-dt-card-ico spi-dt-card-ico-3"><IcoPin /></span> Address &amp; Contact Details</div>
            <span className="spi-dt-fields-badge cpf-push">9 FIELDS</span>
            <span className={`cpf-chev ${addrOpen ? '' : 'is-closed'}`}><IcoChevron /></span>
          </div>
          {addrOpen && (
          <div className="spi-dt-grid4">
            <Field label="REGISTERED OFFICE ADDRESS" full>
              <input className="spi-dt-inp" placeholder="Building / street / area / landmark, with PIN code" value={address} onChange={(e) => setAddress(e.target.value)} readOnly={locked} />
            </Field>
            <Field label="COUNTRY">
              <EditSelect value={country} options={COUNTRIES} onChange={setCountry} readOnly={locked} />
            </Field>
            <Field label="STATE">
              <EditSelect value={state} options={STATES} onChange={setState} readOnly={locked} />
            </Field>
            <Field label="STATE CODE">
              <input className="spi-dt-inp" placeholder="e.g. 27" value={stateCode} onChange={(e) => setStateCode(e.target.value)} readOnly={locked} />
            </Field>
            <Field label="CITY">
              <input className="spi-dt-inp" placeholder="Enter city" value={city} onChange={(e) => setCity(e.target.value)} readOnly={locked} />
            </Field>
            <Field label="CONTACT PERSON NAME">
              <input className="spi-dt-inp" placeholder="Full name" value={contact} onChange={(e) => setContact(e.target.value)} readOnly={locked} />
            </Field>
            <Field label="DESIGNATION">
              <input className="spi-dt-inp" placeholder="e.g. Procurement Manager" value={designation} onChange={(e) => setDesignation(e.target.value)} readOnly={locked} />
            </Field>
            <Field label="CONTACT NUMBER">
              <input className="spi-dt-inp" placeholder="+91 " value={phone} onChange={(e) => setPhone(e.target.value)} readOnly={locked} />
            </Field>
            <Field label="EMAIL ID">
              <input className="spi-dt-inp" type="email" placeholder="name@company.com" value={email} onChange={(e) => setEmail(e.target.value)} readOnly={locked} />
            </Field>
          </div>
          )}
        </div>

        <div className="spi-dt-card">
          <div className="spi-dt-card-head cpf-clickable cpf-lghead" onClick={() => setLegalOpen((o) => !o)}>
            <div className="spi-dt-card-title">
              <span className="spi-dt-card-ico spi-dt-card-ico-2"><IcoShield /></span> Supplier Legal Status
            </div>
            {picked ? (
              <>
                <span className={`cpf-push spi-dt-legal-badge ${legal.pct === 100 ? 'ok' : 'warn'}`}>{legal.pct === 100 ? '100% Compliant' : `${legal.pct}% · Needs Review`}</span>
                <button type="button" className="cpf-vault" onPointerEnter={warmVault} onClick={(e) => { e.stopPropagation(); setVaultOpen(true); }}>
                  <IcoShield /> <span>Visit Supplier Evidence Vault</span>
                </button>
                <span className="cpf-lgbar"><span className={`cpf-lgbar__fill cpf-fill-${legalTone}`} style={{ width: `${legal.pct}%` }} /></span>
                <span className="cpf-lgpct">{legal.pct}%</span>
              </>
            ) : (
              <>
                {/* No supplier yet: the badge's slot still shows, as a dash. */}
                <span className="cpf-push spi-dt-legal-badge cpf-lgbadge--none">–</span>
                <span className="cpf-lgbar"><span className="cpf-lgbar__fill is-empty" /></span>
                <span className="cpf-lgpct">0%</span>
              </>
            )}
            <span className={`cpf-chev ${legalOpen ? '' : 'is-closed'}`}><IcoChevron /></span>
          </div>
          {legalOpen && (
            <div className="cpf-lg">
              {picked ? (
                <div className="cpf-lg__tabs">
                  {sections.map((sec) => (
                    <div key={sec.name} className={`cpf-lg__tab cpf-lg__tab--${sec.tone}`} title={sec.params.map((i) => LEGAL_PARAMS[i].name).join(' · ')}>
                      <div className="cpf-lg__hd">
                        <span className="cpf-lg__ico">{sec.params.length > 2 ? <IcoShield /> : <IcoDocSm />}</span>
                        <span className="cpf-lg__txt">
                          <span className="cpf-lg__nm">{sec.name}</span>
                          <span className="cpf-lg__sub">{sec.sub}</span>
                        </span>
                        <span className="cpf-lg__cnt">{sec.done} / {sec.total}</span>
                        <span className="cpf-lg__pct">{sec.pct}%</span>
                      </div>
                      <div className="cpf-lg__bar"><span className="cpf-lg__fill" style={{ width: `${sec.pct}%` }} /></div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="spi-dt-legal-note">Select a supplier to view legal &amp; compliance status.</div>
              )}
            </div>
          )}
        </div>

        <div className="spi-dt-card">
          <div className="spi-dt-card-head cpf-clickable" onClick={() => setGstOpen((o) => !o)}>
            <div className="spi-dt-card-title">
              <span className="spi-dt-card-ico spi-dt-card-ico-4"><IcoDocSm /></span> GST Scrutiny Details
              {gst.tone === 'stop' && <span className="spi-dt-scrutiny-badge"><IcoWarn /> Scrutiny Overdue</span>}
            </div>
            <span className="spi-dt-fields-badge cpf-push">5 FIELDS</span>
            <span className={`cpf-chev ${gstOpen ? '' : 'is-closed'}`}><IcoChevron /></span>
          </div>

          {gstOpen && (<>
          {/* Compliance verdict for the two dates below. */}
          <div className={`cpf-gst cpf-gst--${gst.tone}`}>
            <span className="cpf-gst__ico">{gst.tone === 'ok' ? <IcoOk /> : gst.tone === 'stop' ? <IcoStop /> : gst.tone === 'warn' ? <IcoWarn /> : <IcoClock />}</span>
            <span className="cpf-gst__txt">
              <span className="cpf-gst__t">{gst.title}</span>
              <span className="cpf-gst__s">{gst.note}</span>
              {supplier && (
                <span className="cpf-gst__meta">
                  Scrutiny <b>{scrutinyDate ? formatDmy(scrutinyDate) : '—'}</b>
                  {scrutinyAge !== null && <span className="cpf-gst__age">{scrutinyAge.toFixed(1)} mo ago</span>}
                  <span className="cpf-gst__sep" />
                  Last filing <b>{filingDate ? formatDmy(filingDate) : '—'}</b>
                  {filingAge !== null && <span className="cpf-gst__age">{filingAge.toFixed(1)} mo ago</span>}
                </span>
              )}
            </span>
          </div>

          <div className="spi-dt-grid4">
            <Field label="SCRUTINY DATE">
              {locked
                ? <input className="spi-dt-inp" readOnly value={scrutinyDate ? formatDmy(scrutinyDate) : ''} placeholder="—" />
                : <MasterDatePicker value={scrutinyDate} onChange={setScrutinyDate} />}
            </Field>
            <Field label="GST NUMBER">
              <input className="spi-dt-inp" placeholder="15-digit GSTIN" value={gstNo} onChange={(e) => setGstNo(e.target.value)} readOnly={locked} />
            </Field>
            <Field label="GST STATUS">
              <EditSelect value={gstStatus} options={GST_STATUSES} onChange={setGstStatus} readOnly={locked} />
            </Field>
            <Field label="LAST FILING DATE">
              {locked
                ? <input className="spi-dt-inp" readOnly value={filingDate ? formatDmy(filingDate) : ''} placeholder="—" />
                : <MasterDatePicker value={filingDate} onChange={setFilingDate} />}
            </Field>
            <Field label="PREV. INVOICE / REMARKS" full>
              <textarea className="spi-dt-textarea" placeholder="Notes on previous invoices, filing history or scrutiny remarks…" value={remarks} onChange={(e) => setRemarks(e.target.value)} readOnly={locked} />
            </Field>
          </div>
          </>)}
        </div>

        <div className="spi-dt-card">
          <div className="spi-dt-card-head cpf-clickable" onClick={() => setRiskOpen((o) => !o)}>
            <div className="spi-dt-card-title"><span className="spi-dt-card-ico spi-dt-card-ico-2"><IcoAlert /></span> Supplier Risk Alert</div>
            {/* The badge only says something once a supplier is chosen. */}
            <span className={`cpf-risk__badge cpf-risk__badge--${riskSev} ${picked ? '' : 'cpf-hide'}`}>
              {!picked ? ''
                : nHigh ? `${nHigh} critical${nMed ? ` · ${nMed} warning` : ''}`
                  : nMed ? `${nMed} warning${nMed === 1 ? '' : 's'}`
                    : 'All clear'}
            </span>
            <span className={`cpf-chev ${riskOpen ? '' : 'is-closed'}`}><IcoChevron /></span>
          </div>
          {riskOpen && (
            <div className="cpf-risk">
              {picked ? (
                <>
                  <div className={`cpf-risk__sum cpf-risk__sum--${riskSev}`}>
                    <span className="cpf-risk__sum-ico"><SevIcon sev={riskSev} /></span>
                    <div className="cpf-risk__sum-txt">
                      <div className="cpf-risk__sum-t">{verdict}</div>
                      <div className="cpf-risk__sum-x">{nOk} of {risks.length} checks passed · risk rating, category, GST registration, filing, scrutiny and documents</div>
                    </div>
                  </div>
                  {mandatory && (
                    <div className="cpf-guide">
                      <div className="cpf-guide__hd">
                        <span className="cpf-guide__ico"><IcoLock /></span>
                        <span className="cpf-guide__t">Mandatory Guidelines</span>
                        <span className="cpf-guide__tag">Enforced on this PO</span>
                      </div>
                      <div className="cpf-guide__list">
                        {RISK_GUIDELINES.map((g) => (
                          <div key={g.title} className="cpf-guide__row">
                            <span className="cpf-guide__ck"><IcoCheck /></span>
                            <div>
                              <div className="cpf-guide__rt">{g.title}</div>
                              <div className="cpf-guide__rx">{g.note}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="cpf-risk__list">
                    {risks.map((r) => (
                      <div key={r.title} className={`cpf-risk__row cpf-risk__row--${r.sev}`}>
                        <span className="cpf-risk__dot"><SevIcon sev={r.sev} /></span>
                        <div className="cpf-risk__txt">
                          <div className="cpf-risk__t">{r.title}</div>
                          <div className="cpf-risk__d">{r.note}</div>
                        </div>
                        <span className="cpf-risk__tag">{r.tag}</span>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="cpf-risk__empty">Select a supplier to view risk alerts.</div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
    </>
  );
}
