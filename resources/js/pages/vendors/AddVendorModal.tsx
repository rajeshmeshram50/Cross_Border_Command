import { useEffect, useState, type ChangeEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import api from '../../api';
import { useToast } from '../../contexts/ToastContext';
import { MasterSelect } from '../../components/ui/MasterSelect';

/* ────────────────────────────────────────────────────────────────────────────
 * Add Vendor — 4-step wizard
 *
 * Step 1: Vendor Legal Identity (Company, GST, PAN & contact)
 *   • Vendor Identification — basic company details
 *   • Address & Contact Persons — registered office + extra contacts
 *
 * Step 2: Vendor KYC / Due Diligence (Docs, identity & compliance)
 *   • Company Due Diligence — incorporation, MOA/AOA, financials
 *   • Owner KYC Details — PAN/Aadhaar/passport of directors
 *   • Trade License Details — IEC, FSSAI, agmark etc.
 *   • Vendor Bank Details — bank + UPI + cancelled cheque
 *   • GST Scrutiny — GST profile + filing status
 *
 * Step 3: Trade Document Management
 *   • KYC / Due Diligence Documents — Owner KYC, Company DD, Trade License
 *   • Trade Documents — quotations, contracts, agreements
 *
 * Step 4: Map Products — links the vendor to one or more products with pricing
 *
 * Front-end only; submit fires onSubmit(payload). No API calls yet.
 * ──────────────────────────────────────────────────────────────────────── */

export type VendorPayload = {
  // Identity
  companyName: string;
  legalName: string;
  vendorType: string;
  website: string;
  riskLevel: string;
  vendorBehaviour: string;
  segment: string;
  complianceBehaviour: string;
  // Address
  registeredOffice: string;
  country: string;
  state: string;
  stateCode: string;
  city: string;
  pincode: string;
  // Primary contact
  contactName: string;
  designation: string;
  contactNo: string;
  email: string;
  whatsappEnabled: boolean;
  // Step 4 mappings (count only for the parent list)
  mappedProductCodes: string[];
};

type StepKey = 1 | 2 | 3 | 4;
type IdTab = 'identification' | 'address';
type KycTab = 'company' | 'owner' | 'license' | 'bank' | 'gst';
type TradeTab = 'kyc' | 'trade';
type KycSubTab = 'owner' | 'company' | 'license';

/* ─── Static option lists ─── */
// Vendor Behaviour stays frontend-only (4 fixed rating buckets). All other
// classification dropdowns are loaded from their masters via the API loader
// effect inside the component.
const BEHAVIOURS = ['Excellent', 'Good', 'Medium', 'Poor'];
const COUNTRIES  = ['India', 'United Arab Emirates', 'Singapore', 'United States', 'United Kingdom'];
const STATES_BY_COUNTRY: Record<string, { name: string; code: string }[]> = {
  India: [
    { name: 'Maharashtra', code: 'MH' },
    { name: 'Gujarat',     code: 'GJ' },
    { name: 'Delhi',       code: 'DL' },
    { name: 'Karnataka',   code: 'KA' },
    { name: 'Tamil Nadu',  code: 'TN' },
    { name: 'Telangana',   code: 'TS' },
    { name: 'Rajasthan',   code: 'RJ' },
    { name: 'West Bengal', code: 'WB' },
  ],
};

/* ─── Mock master document lists for steps 2 & 3 ─── */
const DD_DOCS = [
  { code: 'DD-001', name: 'Certificate of Incorporation',           authority: 'Registrar of Companies (ROC)',  expiry: 'N/A',     mandatory: true  },
  { code: 'DD-002', name: 'Memorandum & Articles of Association (MOA/AOA)', authority: 'Registrar of Companies (ROC)',  expiry: 'N/A',     mandatory: true  },
  { code: 'DD-003', name: 'Board Resolution for Authorized Signatory',      authority: 'Company Board',                 expiry: '12/2026', mandatory: true  },
  { code: 'DD-004', name: 'Financial Statements (Last 2-3 Years)',          authority: 'Statutory Auditor',             expiry: '03/2026', mandatory: true  },
  { code: 'DD-005', name: 'Auditor’s Report',                          authority: 'Statutory Auditor',             expiry: '03/2026', mandatory: false },
  { code: 'DD-006', name: 'Tax Returns (Last 2 Years)',                     authority: 'Income Tax Department',         expiry: '03/2026', mandatory: false },
];

const OWNER_KYC = [
  { code: 'KYC-001', name: 'PAN Card',                            authority: 'Income Tax Department',  expiry: 'N/A'    },
  { code: 'KYC-002', name: 'Aadhaar Card',                        authority: 'UIDAI',                   expiry: 'N/A'    },
  { code: 'KYC-003', name: 'Address Proof',                       authority: 'Bank / Utility / Govt Authority', expiry: 'N/A' },
  { code: 'KYC-004', name: 'Identity Proof (Passport / DL / Voter ID)', authority: 'GOI / RTO / ECI',     expiry: 'Varies' },
  { code: 'KYC-005', name: 'Company Registration Certificate',    authority: 'Registrar of Companies (ROC)', expiry: 'N/A' },
  { code: 'KYC-006', name: 'GST Certificate',                     authority: 'GST Department',          expiry: '09/2030' },
];

const TRADE_LICENSE = [
  { code: 'TRL-001', name: 'IEC Code (Importer Exporter)', authority: 'DGFT',     expiry: 'N/A'    },
  { code: 'TRL-002', name: 'FSSAI License',                authority: 'FSSAI',    expiry: '11/2027' },
  { code: 'TRL-003', name: 'AGMARK Certification',         authority: 'Agmark',   expiry: '06/2028' },
  { code: 'TRL-004', name: 'Spices Board Registration',    authority: 'Spices Board of India', expiry: '04/2029' },
];

const TRADE_DOCS = [
  { code: 'TD-001', name: 'Vendor Quotation',          authority: 'Issued by Vendor', expiry: 'N/A' },
  { code: 'TD-002', name: 'Purchase Agreement',        authority: 'Mutual',           expiry: '12/2027' },
  { code: 'TD-003', name: 'Non-Disclosure Agreement',  authority: 'Mutual',           expiry: 'N/A' },
  { code: 'TD-004', name: 'Service Level Agreement',   authority: 'Mutual',           expiry: '06/2027' },
];

const MOCK_PRODUCTS = [
  { code: 'P-01', name: 'Cashew W320 Premium',     segment: 'Dry Fruits',    uom: 'Kg' },
  { code: 'P-02', name: 'Basmati Rice 1121',       segment: 'Rice & Grains', uom: 'Kg' },
  { code: 'P-03', name: 'Turmeric Powder',         segment: 'Spices',        uom: 'Kg' },
  { code: 'P-04', name: 'Cold-Pressed Coconut Oil', segment: 'Coconut Oil', uom: 'L'  },
];

/* ──────────────────────────────────────────────────────────────────────────
 * Component
 * ────────────────────────────────────────────────────────────────────── */
export default function AddVendorModal(props: { onClose: () => void; onSubmit: (payload: VendorPayload) => void }) {
  const { onClose, onSubmit } = props;
  const toast = useToast();

  /* ─── Wizard navigation ─── */
  const [step, setStep] = useState<StepKey>(1);
  const [idTab,    setIdTab]    = useState<IdTab>('identification');
  const [kycTab,   setKycTab]   = useState<KycTab>('company');
  const [tradeTab, setTradeTab] = useState<TradeTab>('kyc');
  const [kycSub,   setKycSub]   = useState<KycSubTab>('owner');
  const [prevOpen, setPrevOpen] = useState(true);

  /* ─── Master option lists (fetched once on mount) ─── */
  type Opt = { value: string; label: string };
  const [vendorTypeOpts, setVendorTypeOpts]     = useState<Opt[]>([]);
  const [riskLevelOpts,  setRiskLevelOpts]      = useState<Opt[]>([]);
  const [segmentOpts,    setSegmentOpts]        = useState<Opt[]>([]);
  const [complianceOpts, setComplianceOpts]     = useState<Opt[]>([]);

  /* ─── Step 1: Identification ─── */
  const [companyName, setCompanyName] = useState('');
  const [legalName,   setLegalName]   = useState('');
  const [vendorType,  setVendorType]  = useState('');
  const [website,     setWebsite]     = useState('');
  const [riskLevel,   setRiskLevel]   = useState('');
  const [vendorBehaviour, setVendorBehaviour] = useState('Medium');
  const [segment,     setSegment]     = useState('');
  const [complianceBehaviour, setComplianceBehaviour] = useState('');

  /* ─── Step 1: Address + primary contact ─── */
  const [registeredOffice, setRegisteredOffice] = useState('');
  const [country,   setCountry]   = useState('India');
  const [state,     setState]     = useState('');
  const [stateCode, setStateCode] = useState('');
  const [city,      setCity]      = useState('');
  const [pincode,   setPincode]   = useState('');
  const [contactName, setContactName] = useState('');
  const [designation, setDesignation] = useState('');
  const [contactNo,   setContactNo]   = useState('');
  const [email,       setEmail]       = useState('');
  const [whatsappEnabled, setWhatsappEnabled] = useState(true);
  const [attachment, setAttachment] = useState<File | null>(null);

  type ContactRow = {
    id: number;
    name: string;
    designation: string;
    phone: string;
    email: string;
    whatsapp: boolean;
    attachmentName: string;
  };
  const [extraContacts, setExtraContacts] = useState<ContactRow[]>([]);

  /* Contact-person popup (mirrors the QcAddPopup pattern used in the
     Add Product wizard). The popup lives outside the main scroll area
     so it always stays centred when the form is long. */
  const [contactPopupOpen, setContactPopupOpen] = useState(false);
  const [contactDraft, setContactDraft] = useState<Omit<ContactRow, 'id'>>({
    name: '', designation: '', phone: '', email: '', whatsapp: true, attachmentName: '',
  });


  /* ─── Step 2: KYC / Due Diligence — track uploaded doc codes per category ─── */
  const [uploadedDdCodes,    setUploadedDdCodes]    = useState<string[]>([]);
  const [uploadedOwnerCodes, setUploadedOwnerCodes] = useState<string[]>([]);
  const [uploadedLicenseCodes, setUploadedLicenseCodes] = useState<string[]>([]);

  /* ─── Step 2: Bank + GST ─── */
  const [bankName, setBankName]     = useState('');
  const [bankAcc,  setBankAcc]      = useState('');
  const [ifsc,     setIfsc]         = useState('');
  const [branch,   setBranch]       = useState('');
  const [gstNumber, setGstNumber]   = useState('');
  const [gstStatus, setGstStatus]   = useState('Active');

  /* ─── Step 4: Map Products ─── */
  const [selectedProductCodes, setSelectedProductCodes] = useState<string[]>([]);

  /* ─── Body scroll lock ─── */
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  /* ─── Master loader — Vendor Type / Risk Level / Segment / Compliance Behaviour
   *
   * Vendor Type            → customer_types       (label: `name`)
   * Risk Level             → risk_levels          (label: `name`)
   * Vendor Segment         → segments             (label: `title`)
   * Compliance Behaviour   → compliance_behaviours (label: `name`)
   * ──────────────────────────────────────────────────────────── */
  useEffect(() => {
    type Row = Record<string, unknown> & { id: number | string; status?: string };
    const fetchMaster = async (slug: string, labelKey: string): Promise<Opt[]> => {
      try {
        const res = await api.get<Row[]>(`/master/${slug}`);
        return (res.data || [])
          .filter(r => String(r.status ?? '').toLowerCase() !== 'inactive')
          .map(r => ({ value: String(r[labelKey] ?? ''), label: String(r[labelKey] ?? '') }))
          .filter(o => o.value !== '');
      } catch {
        return [];
      }
    };
    (async () => {
      const [vt, rl, sg, cb] = await Promise.all([
        fetchMaster('customer_types',        'name'),
        fetchMaster('risk_levels',           'name'),
        fetchMaster('segments',              'title'),
        fetchMaster('compliance_behaviours', 'name'),
      ]);
      setVendorTypeOpts(vt);
      setRiskLevelOpts(rl);
      setSegmentOpts(sg);
      setComplianceOpts(cb);
    })();
  }, []);

  const stateOpts = STATES_BY_COUNTRY[country] ?? [];

  /* ──────────────────────────────────────────────────────────────────
   * Navigation
   * ────────────────────────────────────────────────────────────── */
  const validateStep1 = (): string[] => {
    const m: string[] = [];
    if (!companyName.trim()) m.push('Company Name');
    if (!vendorType)         m.push('Vendor Type');
    if (!vendorBehaviour)    m.push('Vendor Behaviour');
    if (!segment)            m.push('Vendor Segment');
    if (!complianceBehaviour)m.push('Compliance Behaviour');
    if (!registeredOffice.trim()) m.push('Registered Office');
    if (!country)            m.push('Country');
    if (!state)              m.push('State');
    if (!city.trim())        m.push('City');
    if (!contactName.trim()) m.push('Contact Person');
    if (!designation.trim()) m.push('Designation');
    if (!contactNo.trim())   m.push('Contact No');
    if (!email.trim())       m.push('Email');
    return m;
  };

  const goNext = () => {
    if (step === 1) {
      const m = validateStep1();
      if (m.length) {
        toast.error('Missing required fields', `Please fill: ${m.slice(0, 3).join(', ')}${m.length > 3 ? ` +${m.length - 3} more` : ''}`);
        return;
      }
      toast.success('Identity saved', 'Vendor identity details captured');
      setStep(2);
    } else if (step === 2) {
      toast.success('KYC saved', 'Due-diligence details captured');
      setStep(3);
    } else if (step === 3) {
      toast.success('Documents saved', 'Trade documents captured');
      setStep(4);
    }
  };

  const goPrev = () => {
    if (step > 1) setStep((step - 1) as StepKey);
  };

  const submitAll = () => {
    onSubmit({
      companyName, legalName, vendorType, website, riskLevel,
      vendorBehaviour, segment, complianceBehaviour,
      registeredOffice, country, state, stateCode, city, pincode,
      contactName, designation, contactNo, email, whatsappEnabled,
      mappedProductCodes: selectedProductCodes,
    });
  };

  /* ──────────────────────────────────────────────────────────────────
   * Helpers — DocTable + Uploaders
   * ────────────────────────────────────────────────────────────── */
  const toggleUpload = (code: string, list: string[], setList: (l: string[]) => void) => {
    setList(list.includes(code) ? list.filter(c => c !== code) : [...list, code]);
  };

  const openContactPopup = () => {
    setContactDraft({ name: '', designation: '', phone: '', email: '', whatsapp: true, attachmentName: '' });
    setContactPopupOpen(true);
  };
  const saveContactDraft = () => {
    const missing: string[] = [];
    if (!contactDraft.name.trim())        missing.push('Contact Person Name');
    if (!contactDraft.designation.trim()) missing.push('Designation');
    if (!contactDraft.phone.trim())       missing.push('Contact No');
    if (!contactDraft.email.trim())       missing.push('Email');
    if (missing.length) {
      toast.error('Missing required fields', `Please fill: ${missing.join(', ')}`);
      return;
    }
    setExtraContacts(prev => [...prev, { id: Date.now(), ...contactDraft }]);
    setContactPopupOpen(false);
    toast.success('Contact added', `${contactDraft.name} added to the list`);
  };
  const removeExtraContact = (id: number) => setExtraContacts(prev => prev.filter(c => c.id !== id));


  return createPortal((
    <div className="avm-backdrop" onClick={onClose}>
      <style>{SCOPED_CSS}</style>
      <div className="avm-modal" onClick={(e) => e.stopPropagation()}>
        {/* ─── Header ─── */}
        <div className="avm-head">
          <div className="avm-head-left">
            <div className="avm-head-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
            </div>
            <div className="min-w-0">
              <div className="avm-title">Add Vendor</div>
              <div className="avm-sub">Capture, verify, and onboard vendors with complete compliance and sourcing readiness.</div>
            </div>
          </div>
          <div className="avm-head-right">
            <button className="avm-map-btn">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><rect x="2" y="4" width="20" height="16" rx="2" /><line x1="2" y1="9" x2="22" y2="9" /></svg>
              Map Products
            </button>
            <button className="avm-close" onClick={onClose} aria-label="Close">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            </button>
          </div>
        </div>

        {/* ─── Stepper strip ─── */}
        <div className="avm-stepper-wrap">
          <div className="avm-stepper">
            <StepperItem n={1} title="Vendor Legal Identity"     sub="Company, GST, PAN & contact"            current={step} tone="violet" />
            <div className="avm-step-arrow">›</div>
            <StepperItem n={2} title="Vendor KYC / Due Diligence" sub="Docs, identity & compliance"            current={step} tone="teal" />
            <div className="avm-step-arrow">›</div>
            <StepperItem n={3} title="Trade Document Management"  sub="Manage trade docs, contracts & agreements" current={step} tone="purple" />
            <div className="avm-step-arrow">›</div>
            <StepperItem n={4} title="Map Products"               sub="Link products & pricing"                current={step} tone="green" />
          </div>
        </div>

        {/* ─── Body ─── */}
        <div className="avm-body">
          {step > 1 && (
            <div className="avm-prev">
              <div className="avm-prev-head">
                <div className="avm-prev-title">
                  <span className="avm-prev-check"><i className="ri-check-line" /></span>
                  What you did in the previous stage
                  <span className="avm-prev-chip">Step 1{step > 2 ? `–${step - 1}` : ''} Complete</span>
                </div>
                <button className="avm-prev-toggle" onClick={() => setPrevOpen(o => !o)}>{prevOpen ? 'Hide' : 'Show'}</button>
              </div>
              {prevOpen && (
                <div className="avm-prev-body">
                  <PrevField k="Company Name" v={companyName || '—'} />
                  <PrevField k="Vendor Type"  v={vendorType || '—'} />
                  <PrevField k="Segment"      v={segment || '—'} />
                  <PrevField k="State / City" v={`${state || '—'} / ${city || '—'}`} />
                  <PrevField k="Contact"      v={contactName ? `${contactName} (${designation})` : '—'} />
                  <PrevField k="Email"        v={email || '—'} />
                </div>
              )}
            </div>
          )}

          {/* ─── STEP 1 ─── */}
          {step === 1 && (
            <>
              <div className="avm-tabs">
                <button className={`avm-tab ${idTab === 'identification' ? 'on' : ''}`} onClick={() => setIdTab('identification')}>Vendor Identification</button>
                <button className={`avm-tab ${idTab === 'address' ? 'on' : ''}`}        onClick={() => setIdTab('address')}>Address &amp; Contact Persons</button>
              </div>

              {idTab === 'identification' && (
                <SectionCard tone="violet" icon={<i className="ri-building-line" />} title="Basic Company Details" subtitle="Identity, classification & sourcing readiness">
                  <div className="avm-grid-2">
                    <Field label="Company Name" required>
                      <input className="avm-input" placeholder="e.g. ABC Logistics" value={companyName} onChange={e => setCompanyName(e.target.value)} />
                    </Field>
                    <Field label="Company Legal Name">
                      <input className="avm-input" placeholder="ABC Logistics Pvt Ltd" value={legalName} onChange={e => setLegalName(e.target.value)} />
                    </Field>
                  </div>
                  <div className="avm-grid-3">
                    <Field label="Vendor Type" required addNew>
                      <SelectInput value={vendorType} onChange={setVendorType} placeholder="Select" options={vendorTypeOpts} />
                    </Field>
                    <Field label="Company Website">
                      <input className="avm-input" placeholder="https://abclogistics.com" value={website} onChange={e => setWebsite(e.target.value)} />
                    </Field>
                    <Field label="Risk Level" required addNew>
                      <SelectInput value={riskLevel} onChange={setRiskLevel} placeholder="Select" options={riskLevelOpts} />
                    </Field>
                  </div>
                  <div className="avm-grid-3">
                    <Field label="Vendor Behaviour" required addNew>
                      <SelectInput value={vendorBehaviour} onChange={setVendorBehaviour} placeholder="Select" options={BEHAVIOURS} />
                    </Field>
                    <Field label="Vendor Segment" required>
                      <SelectInput value={segment} onChange={setSegment} placeholder="Select Segment" options={segmentOpts} />
                    </Field>
                    <Field label="Compliance Behaviour" required addNew>
                      <SelectInput value={complianceBehaviour} onChange={setComplianceBehaviour} placeholder="Select" options={complianceOpts} />
                    </Field>
                  </div>
                </SectionCard>
              )}

              {idTab === 'identification' && (
                <SectionCard tone="amber" icon={<i className="ri-map-pin-line" />} title="Company Address & Contact Person Details" subtitle="Registered office and primary KYC contact">
                  <Field label="Registered Office Address" required>
                    <input className="avm-input" placeholder="Plot 21, Industrial Area" value={registeredOffice} onChange={e => setRegisteredOffice(e.target.value)} />
                  </Field>
                  <div className="avm-grid-4">
                    <Field label="Country" required>
                      <SelectInput
                        value={country}
                        onChange={(v) => { setCountry(v); setState(''); setStateCode(''); }}
                        placeholder="India"
                        options={COUNTRIES}
                      />
                    </Field>
                    <Field label="State" required>
                      <SelectInput
                        value={state}
                        onChange={(v) => {
                          setState(v);
                          const sc = stateOpts.find(s => s.name === v)?.code ?? '';
                          setStateCode(sc);
                        }}
                        placeholder="Maharashtra"
                        options={stateOpts.map(s => ({ value: s.name, label: s.name }))}
                      />
                    </Field>
                    <Field label="State Code" required>
                      <input className="avm-input" placeholder="MH" value={stateCode} onChange={e => setStateCode(e.target.value)} />
                    </Field>
                    <Field label="City" required>
                      <input className="avm-input" placeholder="PUNE" value={city} onChange={e => setCity(e.target.value)} />
                    </Field>
                  </div>
                  <div className="avm-grid-4">
                    <Field label="Contact Person Name" required>
                      <input className="avm-input" placeholder="Rahul Sharma" value={contactName} onChange={e => setContactName(e.target.value)} />
                    </Field>
                    <Field label="Designation" required>
                      <input className="avm-input" placeholder="admin" value={designation} onChange={e => setDesignation(e.target.value)} />
                    </Field>
                    <Field label="Contact No" required>
                      <input className="avm-input" placeholder="9876543210" value={contactNo} onChange={e => setContactNo(e.target.value)} />
                    </Field>
                    <Field label="Email" required>
                      <input className="avm-input" placeholder="rahul@abclogistics.com" value={email} onChange={e => setEmail(e.target.value)} />
                    </Field>
                  </div>
                  <div className="avm-grid-2">
                    <Field label="WhatsApp Enabled ?">
                      <div className="avm-radio-row">
                        <label className="avm-radio">
                          <input type="radio" checked={whatsappEnabled} onChange={() => setWhatsappEnabled(true)} />
                          <span>Yes</span>
                        </label>
                        <label className="avm-radio">
                          <input type="radio" checked={!whatsappEnabled} onChange={() => setWhatsappEnabled(false)} />
                          <span>No</span>
                        </label>
                      </div>
                    </Field>
                    <Field label="Attachment (Business Card)" required>
                      <FileChooser
                        file={attachment}
                        onPick={(f) => setAttachment(f)}
                        placeholder="No files attached"
                      />
                    </Field>
                  </div>
                </SectionCard>
              )}

              {idTab === 'address' && (
                <>
                  {/* ── Additional Contact Persons ── */}
                  <SectionCard tone="violet" icon={<i className="ri-contacts-book-line" />} title="Additional Contact Persons" subtitle="Secondary contacts beyond the primary KYC contact" headerAction={
                    <button className="avm-section-add-btn" onClick={openContactPopup}>+ Add More Contact Person</button>
                  }>
                    {extraContacts.length === 0 ? (
                      <div className="avm-empty">No contact persons added yet.</div>
                    ) : (
                      <div className="table-responsive table-card border rounded">
                        <table className="table align-middle table-nowrap mb-0">
                          <thead className="table-light">
                            <tr>
                              <th>Sr No</th>
                              <th>Name</th>
                              <th>Designation</th>
                              <th>Phone</th>
                              <th>Email</th>
                              <th>WhatsApp</th>
                              <th>Attachment</th>
                              <th>Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {extraContacts.map((c, idx) => (
                              <tr key={c.id}>
                                <td>{idx + 1}</td>
                                <td><strong>{c.name}</strong></td>
                                <td>{c.designation}</td>
                                <td><span className="font-monospace fs-13">{c.phone}</span></td>
                                <td>{c.email}</td>
                                <td>
                                  <span className={`badge ${c.whatsapp ? 'bg-success-subtle text-success' : 'bg-light text-muted'}`} style={{ padding: '4px 10px' }}>
                                    {c.whatsapp ? '✓ Yes' : '— No'}
                                  </span>
                                </td>
                                <td>
                                  {c.attachmentName
                                    ? <span className="fs-13"><i className="ri-attachment-line text-muted me-1" />{c.attachmentName}</span>
                                    : <span className="text-muted fs-13">—</span>}
                                </td>
                                <td>
                                  <div className="hstack gap-1">
                                    <button type="button" className="btn btn-sm btn-soft-danger" onClick={() => removeExtraContact(c.id)} title="Remove">
                                      <i className="ri-delete-bin-line" />
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </SectionCard>
                </>
              )}
            </>
          )}

          {/* ─── STEP 2 ─── */}
          {step === 2 && (
            <SectionCard tone="teal" icon={<i className="ri-shield-check-line" />} title="KYC / Due Diligence Details" subtitle="Upload statutory & identity proofs" headerAction={
              <button className="avm-section-add-btn">+ Add More Due Diligence</button>
            }>
              <div className="avm-pill-tabs">
                <button className={`avm-pill ${kycTab === 'company' ? 'on' : ''}`} onClick={() => setKycTab('company')}>Company Due Diligence Details</button>
                <button className={`avm-pill ${kycTab === 'owner'   ? 'on' : ''}`} onClick={() => setKycTab('owner')}>Owner KYC Details</button>
                <button className={`avm-pill ${kycTab === 'license' ? 'on' : ''}`} onClick={() => setKycTab('license')}>Trade License Details</button>
                <button className={`avm-pill ${kycTab === 'bank'    ? 'on' : ''}`} onClick={() => setKycTab('bank')}>Vendor Bank Details</button>
                <button className={`avm-pill ${kycTab === 'gst'     ? 'on' : ''}`} onClick={() => setKycTab('gst')}>GST Scrutiny</button>
              </div>

              {kycTab === 'company' && (
                <DocTable
                  banner={{ tone: 'amber', label: 'COMPANY DUE DILIGENCE', sub: 'Licenses, statutory documents, and compliance proofs' }}
                  countLabel={`${DD_DOCS.length} documents`}
                  rows={DD_DOCS}
                  uploaded={uploadedDdCodes}
                  onUpload={(code) => toggleUpload(code, uploadedDdCodes, setUploadedDdCodes)}
                  showMandatory
                />
              )}
              {kycTab === 'owner' && (
                <DocTable
                  banner={{ tone: 'amber', label: 'OWNER KYC', sub: 'PAN, Aadhaar, ID & address proofs for directors / proprietors' }}
                  countLabel={`${OWNER_KYC.length} documents`}
                  rows={OWNER_KYC}
                  uploaded={uploadedOwnerCodes}
                  onUpload={(code) => toggleUpload(code, uploadedOwnerCodes, setUploadedOwnerCodes)}
                />
              )}
              {kycTab === 'license' && (
                <DocTable
                  banner={{ tone: 'amber', label: 'TRADE LICENSE', sub: 'Import-Export licenses, FSSAI, Agmark, Spices Board etc.' }}
                  countLabel={`${TRADE_LICENSE.length} documents`}
                  rows={TRADE_LICENSE}
                  uploaded={uploadedLicenseCodes}
                  onUpload={(code) => toggleUpload(code, uploadedLicenseCodes, setUploadedLicenseCodes)}
                />
              )}
              {kycTab === 'bank' && (
                <div className="avm-bank-grid">
                  <Field label="Bank Name" required>
                    <input className="avm-input" placeholder="HDFC Bank" value={bankName} onChange={e => setBankName(e.target.value)} />
                  </Field>
                  <Field label="Account Number" required>
                    <input className="avm-input" placeholder="50100123456789" value={bankAcc} onChange={e => setBankAcc(e.target.value)} />
                  </Field>
                  <Field label="IFSC Code" required>
                    <input className="avm-input" placeholder="HDFC0000123" value={ifsc} onChange={e => setIfsc(e.target.value)} />
                  </Field>
                  <Field label="Branch">
                    <input className="avm-input" placeholder="Andheri East" value={branch} onChange={e => setBranch(e.target.value)} />
                  </Field>
                  <Field label="Cancelled Cheque">
                    <FileChooser file={null} onPick={() => {}} placeholder="Upload cancelled cheque" />
                  </Field>
                </div>
              )}
              {kycTab === 'gst' && (
                <div className="avm-grid-3">
                  <Field label="GST Number" required>
                    <input className="avm-input" placeholder="27ABCDE1234F1Z5" value={gstNumber} onChange={e => setGstNumber(e.target.value)} />
                  </Field>
                  <Field label="GST Status">
                    <SelectInput value={gstStatus} onChange={setGstStatus} placeholder="Active" options={['Active', 'Suspended', 'Cancelled']} />
                  </Field>
                  <Field label="Last Return Filed">
                    <input className="avm-input" type="date" />
                  </Field>
                </div>
              )}
            </SectionCard>
          )}

          {/* ─── STEP 3 ─── */}
          {step === 3 && (
            <SectionCard tone="violet" icon={<i className="ri-file-text-line" />} title="Trade Document Management" subtitle="KYC & trade documents repository">
              <div className="avm-tabs">
                <button className={`avm-tab ${tradeTab === 'kyc'   ? 'on' : ''}`} onClick={() => setTradeTab('kyc')}>
                  <i className="ri-file-list-3-line me-1" /> KYC / Due Diligence Documents
                </button>
                <button className={`avm-tab ${tradeTab === 'trade' ? 'on' : ''}`} onClick={() => setTradeTab('trade')}>
                  <i className="ri-send-plane-line me-1" /> Trade Documents
                </button>
              </div>

              {tradeTab === 'kyc' && (
                <>
                  <div className="avm-sub-pills">
                    <button className={`avm-sub-pill ${kycSub === 'owner' ? 'on' : ''}`}   onClick={() => setKycSub('owner')}>Owner KYC</button>
                    <button className={`avm-sub-pill ${kycSub === 'company' ? 'on' : ''}`} onClick={() => setKycSub('company')}>Company Due Diligence</button>
                    <button className={`avm-sub-pill ${kycSub === 'license' ? 'on' : ''}`} onClick={() => setKycSub('license')}>Trade License</button>
                  </div>
                  {kycSub === 'owner'   && <DocTable countLabel={`${OWNER_KYC.length} documents`}   rows={OWNER_KYC}     uploaded={uploadedOwnerCodes}   onUpload={(c) => toggleUpload(c, uploadedOwnerCodes, setUploadedOwnerCodes)} />}
                  {kycSub === 'company' && <DocTable countLabel={`${DD_DOCS.length} documents`}     rows={DD_DOCS}       uploaded={uploadedDdCodes}      onUpload={(c) => toggleUpload(c, uploadedDdCodes, setUploadedDdCodes)} showMandatory />}
                  {kycSub === 'license' && <DocTable countLabel={`${TRADE_LICENSE.length} documents`} rows={TRADE_LICENSE} uploaded={uploadedLicenseCodes} onUpload={(c) => toggleUpload(c, uploadedLicenseCodes, setUploadedLicenseCodes)} />}
                </>
              )}
              {tradeTab === 'trade' && (
                <DocTable
                  banner={{ tone: 'amber', label: 'TRADE DOCUMENTS', sub: 'Quotations, contracts and signed agreements' }}
                  countLabel={`${TRADE_DOCS.length} documents`}
                  rows={TRADE_DOCS}
                  uploaded={[]}
                  onUpload={() => {}}
                />
              )}
            </SectionCard>
          )}

          {/* ─── STEP 4 ─── */}
          {step === 4 && (
            <SectionCard tone="green" icon={<i className="ri-links-line" />} title="Map Products" subtitle="Link this vendor to one or more products with pricing">
              <div className="avm-product-list">
                {MOCK_PRODUCTS.map(p => {
                  const checked = selectedProductCodes.includes(p.code);
                  return (
                    <label key={p.code} className={`avm-product-row ${checked ? 'on' : ''}`}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => setSelectedProductCodes(prev => checked ? prev.filter(c => c !== p.code) : [...prev, p.code])}
                      />
                      <div className="avm-product-meta">
                        <div className="avm-product-code">{p.code}</div>
                        <div className="avm-product-name">{p.name}</div>
                      </div>
                      <div className="avm-product-info">
                        <span className="avm-product-tag">{p.segment}</span>
                        <span className="avm-product-tag">UOM: {p.uom}</span>
                      </div>
                    </label>
                  );
                })}
              </div>
              {selectedProductCodes.length === 0 && (
                <div className="avm-empty">Pick at least one product to link this vendor.</div>
              )}
            </SectionCard>
          )}
        </div>

        {/* ─── Footer ─── */}
        <div className="avm-foot">
          <button className="avm-btn-ghost" onClick={onClose}>Cancel</button>
          <div className="avm-foot-right">
            {step > 1 && <button className="avm-btn-outline" onClick={goPrev}>← Previous</button>}
            {step < 4 ? (
              <button className="avm-btn-primary" onClick={goNext}>Save &amp; Next →</button>
            ) : (
              <button className="avm-btn-primary" onClick={submitAll}>
                <i className="ri-check-line" /> Save Vendor
              </button>
            )}
          </div>
        </div>
      </div>

      {contactPopupOpen && (
        <ContactAddPopup
          draft={contactDraft}
          setDraft={setContactDraft}
          onClose={() => setContactPopupOpen(false)}
          onSave={saveContactDraft}
        />
      )}
    </div>
  ), document.body);
}

/* ──────────────────────────────────────────────────────────────────────────
 * Contact Person popup — small modal that overlays the wizard so the user
 * can capture a single secondary contact in one focused form. Mirrors the
 * QC popup pattern in Add Product.
 * ────────────────────────────────────────────────────────────────────── */
type ContactDraft = {
  name: string;
  designation: string;
  phone: string;
  email: string;
  whatsapp: boolean;
  attachmentName: string;
};
function ContactAddPopup(props: {
  draft: ContactDraft;
  setDraft: (next: ContactDraft) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const { draft, setDraft, onClose, onSave } = props;
  const set = <K extends keyof ContactDraft>(k: K, v: ContactDraft[K]) => setDraft({ ...draft, [k]: v });
  const onPickFile = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) set('attachmentName', f.name);
  };
  return createPortal((
    <div className="avm-cp-backdrop" onClick={onClose}>
      <div className="avm-cp-popup" onClick={(e) => e.stopPropagation()}>
        <div className="avm-cp-head">
          <div className="avm-cp-title">Add Contact Person</div>
          <button className="avm-cp-close" onClick={onClose} aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>

        <div className="avm-cp-body">
          <div className="avm-grid-4">
            <Field label="Contact Person Name" required>
              <input className="avm-input" placeholder="Enter name" value={draft.name} onChange={e => set('name', e.target.value)} />
            </Field>
            <Field label="Designation" required>
              <input className="avm-input" placeholder="Enter designation" value={draft.designation} onChange={e => set('designation', e.target.value)} />
            </Field>
            <Field label="Contact No" required>
              <input className="avm-input" placeholder="Enter 10-15 digit mobile number" value={draft.phone} onChange={e => set('phone', e.target.value)} />
            </Field>
            <Field label="Email" required>
              <input className="avm-input" placeholder="Enter email" value={draft.email} onChange={e => set('email', e.target.value)} />
            </Field>
          </div>

          <div className="avm-grid-2">
            <Field label="WhatsApp Enabled?" required>
              <div className="avm-radio-row">
                <label className="avm-radio">
                  <input type="radio" checked={draft.whatsapp} onChange={() => set('whatsapp', true)} /> Yes
                </label>
                <label className="avm-radio">
                  <input type="radio" checked={!draft.whatsapp} onChange={() => set('whatsapp', false)} /> No
                </label>
              </div>
            </Field>
            <Field label="Attachments">
              <div className="avm-filechooser">
                <input type="file" className="avm-filechooser-input" onChange={onPickFile} />
                <span className="avm-filechooser-icon"><i className="ri-attachment-line" /></span>
                <span className="avm-filechooser-text">{draft.attachmentName || 'No files attached'}</span>
              </div>
            </Field>
          </div>
        </div>

        <div className="avm-cp-foot">
          <button className="avm-cp-cancel" onClick={onClose}>Cancel</button>
          <button className="avm-cp-save" onClick={onSave}>Save</button>
        </div>
      </div>
    </div>
  ), document.body);
}

/* ──────────────────────────────────────────────────────────────────────────
 * Sub-components
 * ────────────────────────────────────────────────────────────────────── */
function StepperItem(props: {
  n: number; title: string; sub: string; current: number;
  tone: 'violet' | 'teal' | 'purple' | 'green';
}) {
  const state = props.current > props.n ? 'done' : props.current === props.n ? 'active' : 'idle';
  return (
    <div className={`avm-step avm-step-${state} avm-step-${props.tone}`}>
      <div className="avm-step-num">
        {state === 'done' ? <i className="ri-check-line" /> : props.n}
      </div>
      <div className="avm-step-text">
        <div className="avm-step-title">{props.title}</div>
        <div className="avm-step-sub">{props.sub}</div>
      </div>
    </div>
  );
}

function SectionCard(props: {
  tone: 'violet' | 'amber' | 'teal' | 'green' | 'purple';
  icon: ReactNode;
  title: string;
  subtitle: string;
  headerAction?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={`avm-section avm-section-${props.tone}`}>
      <div className="avm-section-head">
        <div className="avm-section-head-left">
          <div className="avm-section-icon">{props.icon}</div>
          <div>
            <div className="avm-section-title">{props.title}</div>
            <div className="avm-section-sub">{props.subtitle}</div>
          </div>
        </div>
        {props.headerAction}
      </div>
      <div className="avm-section-body">{props.children}</div>
    </div>
  );
}

function Field(props: { label: string; required?: boolean; addNew?: boolean; children: ReactNode }) {
  return (
    <label className="avm-field">
      <span className="avm-field-label">
        {props.label}{props.required && <span className="avm-req">*</span>}
        {props.addNew && <button type="button" className="avm-field-plus" tabIndex={-1} onClick={(e) => e.preventDefault()}>+</button>}
      </span>
      {props.children}
    </label>
  );
}

function SelectInput(props: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  options: Array<string | { value: string; label: string }>;
}) {
  const normalized = props.options.map(o => typeof o === 'string' ? { value: o, label: o } : o);
  return (
    <div className="avm-master-select">
      <MasterSelect
        value={props.value}
        options={normalized}
        placeholder={props.placeholder ?? 'Select'}
        onChange={props.onChange}
      />
    </div>
  );
}

function FileChooser(props: { file: File | null; onPick: (f: File | null) => void; placeholder?: string }) {
  const onChange = (e: ChangeEvent<HTMLInputElement>) => props.onPick(e.target.files?.[0] ?? null);
  return (
    <div className="avm-filechooser">
      <input id={`fc-${Math.random()}`} type="file" className="avm-filechooser-input" onChange={onChange} />
      <span className="avm-filechooser-icon"><i className="ri-attachment-line" /></span>
      <span className="avm-filechooser-text">{props.file ? props.file.name : (props.placeholder ?? 'Choose file')}</span>
    </div>
  );
}

function PrevField(props: { k: string; v: string }) {
  return (
    <div className="avm-prev-field">
      <div className="avm-prev-field-key">{props.k}</div>
      <div className="avm-prev-field-val">{props.v}</div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
 * Doc table — used by KYC step (Company DD, Owner KYC, Trade License)
 * ────────────────────────────────────────────────────────────────────── */
function DocTable(props: {
  banner?: { tone: 'amber' | 'teal' | 'violet'; label: string; sub: string };
  countLabel: string;
  rows: Array<{ code: string; name: string; authority: string; expiry: string; mandatory?: boolean }>;
  uploaded: string[];
  onUpload: (code: string) => void;
  showMandatory?: boolean;
}) {
  return (
    <div className="avm-doctable-wrap">
      {props.banner && (
        <div className={`avm-doctable-banner tone-${props.banner.tone}`}>
          <span className="avm-doctable-icon"><i className="ri-file-text-line" /></span>
          <span className="avm-doctable-banner-label">{props.banner.label}</span>
          <span className="avm-doctable-banner-sub">| {props.banner.sub}</span>
        </div>
      )}
      <div className="avm-doctable-toolbar">
        <div className="avm-doctable-search">
          <i className="ri-search-line" />
          <input placeholder="Search DD document name…" />
        </div>
        <span className="avm-doctable-count">{props.countLabel}</span>
      </div>
      <div className="table-responsive table-card border rounded">
        <table className="table align-middle table-nowrap mb-0">
          <thead className="table-light">
            <tr>
              <th>SR NO</th>
              <th>AUTO CODE</th>
              <th>DD DOCUMENT NAME</th>
              <th>ISSUING AUTHORITY</th>
              <th>EXPIRY</th>
              {props.showMandatory && <th>STATUS</th>}
              <th>ACTIONS</th>
            </tr>
          </thead>
          <tbody>
            {props.rows.map((r, i) => {
              const done = props.uploaded.includes(r.code);
              const expiryDanger = /^\d{2}\/\d{4}$/.test(r.expiry); // bare MM/YYYY → highlight as upcoming
              return (
                <tr key={r.code}>
                  <td>{String(i + 1).padStart(2, '0')}</td>
                  <td><span className="badge bg-light text-warning-emphasis border" style={{ fontFamily: 'monospace', padding: '4px 10px' }}>{r.code}</span></td>
                  <td><strong>{r.name}</strong></td>
                  <td>{r.authority}</td>
                  <td>
                    <span className={`badge ${expiryDanger ? 'bg-danger-subtle text-danger' : 'bg-light text-muted'} border`} style={{ padding: '4px 10px' }}>
                      {r.expiry}
                    </span>
                  </td>
                  {props.showMandatory && (
                    <td>
                      <span className={`badge ${r.mandatory ? 'bg-success-subtle text-success' : 'bg-light text-muted'} border`} style={{ padding: '4px 10px' }}>
                        {r.mandatory ? '✓ Mandatory' : 'Optional'}
                      </span>
                    </td>
                  )}
                  <td>
                    <div className="hstack gap-1">
                      <button type="button" className={`btn btn-sm ${done ? 'btn-soft-success' : 'btn-soft-primary'}`} onClick={() => props.onUpload(r.code)} title={done ? 'Uploaded' : 'Upload'}>
                        <i className={done ? 'ri-checkbox-circle-line' : 'ri-upload-2-line'} />
                      </button>
                      <button type="button" className="btn btn-sm btn-soft-secondary" title="Download" disabled={!done}>
                        <i className="ri-download-2-line" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
 * Scoped CSS — light + dark mode
 * ────────────────────────────────────────────────────────────────────── */
const SCOPED_CSS = `
.avm-backdrop {
  position: fixed; inset: 0; z-index: 1090;
  background: rgba(15, 23, 42, .55);
  backdrop-filter: blur(3px);
  display: flex; align-items: flex-start; justify-content: center;
  padding: 24px 20px;
  overflow-y: auto;
  font-family: 'DM Sans', 'Inter', system-ui, sans-serif;
}
.avm-modal {
  width: 100%; max-width: 1200px;
  max-height: calc(100vh - 48px);
  margin: auto;
  background: #fff;
  border-radius: 18px;
  overflow: hidden;
  display: flex; flex-direction: column;
  box-shadow: 0 30px 80px rgba(15, 23, 42, .45);
  color: #1e1b4b;
}
.avm-modal *, .avm-modal *::before, .avm-modal *::after { box-sizing: border-box; }

/* Header — Velzon primary gradient, same family the Legal Entities master uses */
.avm-head {
  display: flex; align-items: center; justify-content: space-between; gap: 16px;
  padding: 18px 22px;
  background:
    linear-gradient(115deg, rgba(255,255,255,0.10) 0%, transparent 35%, transparent 65%, rgba(0,0,0,0.08) 100%),
    linear-gradient(135deg, #2b3a85 0%, #405189 28%, #5562c4 55%, #6e7eee 78%, #8b6fe8 100%);
  color: #fff;
}
.avm-head-left { display: flex; align-items: center; gap: 14px; min-width: 0; }
.avm-head-icon {
  width: 44px; height: 44px; border-radius: 12px; flex-shrink: 0;
  background: rgba(255,255,255,.18);
  border: 1px solid rgba(255,255,255,.25);
  display: flex; align-items: center; justify-content: center;
}
.avm-title { font-size: 18px; font-weight: 800; }
.avm-sub   { font-size: 12px; color: rgba(255,255,255,.85); margin-top: 2px; }
.avm-head-right { display: inline-flex; align-items: center; gap: 8px; }
.avm-map-btn {
  display: inline-flex; align-items: center; gap: 6px;
  height: 34px; padding: 0 12px;
  background: rgba(255,255,255,.15); border: 1px solid rgba(255,255,255,.25);
  color: #fff; border-radius: 9px;
  font-family: inherit; font-size: 12.5px; font-weight: 700; cursor: pointer;
  transition: background .15s, transform .12s;
}
.avm-map-btn:hover { background: rgba(255,255,255,.25); transform: translateY(-1px); }
.avm-close {
  width: 32px; height: 32px; border-radius: 9px;
  border: 1px solid rgba(255,255,255,.25);
  background: rgba(255,255,255,.12); color: #fff;
  display: inline-flex; align-items: center; justify-content: center; cursor: pointer;
  transition: background .15s, transform .12s;
}
.avm-close:hover { background: rgba(255,255,255,.22); transform: rotate(90deg); }

/* Stepper */
.avm-stepper-wrap { padding: 14px 22px; background: #faf5ff; border-bottom: 1px solid #ede9fe; }
.avm-stepper { display: flex; align-items: stretch; gap: 6px; flex-wrap: wrap; }
.avm-step {
  flex: 1; min-width: 200px;
  display: flex; align-items: center; gap: 10px;
  padding: 12px 14px;
  background: #fff; border: 1.5px solid transparent; border-radius: 10px;
}
.avm-step-num {
  width: 26px; height: 26px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  background: #e2e8f0; color: #6b7280;
  font-size: 12px; font-weight: 800;
}
.avm-step-title { font-size: 12.5px; font-weight: 800; color: #1e1b4b; }
.avm-step-sub   { font-size: 10.5px; color: #6b7280; }

.avm-step-violet.avm-step-active { border-color: #405189; }
.avm-step-violet.avm-step-active .avm-step-num { background: linear-gradient(135deg, #405189, #6691e7); color: #fff; }
.avm-step-teal.avm-step-active   { border-color: #0ab39c; }
.avm-step-teal.avm-step-active   .avm-step-num { background: linear-gradient(135deg, #0ab39c, #22c8a9); color: #fff; }
.avm-step-purple.avm-step-active { border-color: #6691e7; }
.avm-step-purple.avm-step-active .avm-step-num { background: linear-gradient(135deg, #6691e7, #a8c0f5); color: #fff; }
.avm-step-green.avm-step-active  { border-color: #16a34a; }
.avm-step-green.avm-step-active  .avm-step-num { background: linear-gradient(135deg, #16a34a, #4ade80); color: #fff; }

.avm-step-done .avm-step-num { background: #16a34a; color: #fff; }
.avm-step-done .avm-step-title { color: #15803d; }

.avm-step-arrow { display: flex; align-items: center; padding: 0 4px; color: #c0cffb; font-size: 18px; font-weight: 700; }

/* Body — plain white surface like the Client / Master forms */
.avm-body {
  flex: 1; overflow-y: auto;
  padding: 18px 22px 22px;
  background: #fff;
  scrollbar-width: thin; scrollbar-color: #c0cffb transparent;
}
.avm-body::-webkit-scrollbar { width: 8px; }
.avm-body::-webkit-scrollbar-thumb { background: #c0cffb; border-radius: 99px; }

/* Previous-stage summary */
.avm-prev {
  background: #ecfdf5; border: 1.5px solid #86efac; border-radius: 12px;
  margin-bottom: 14px; overflow: hidden;
}
.avm-prev-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 14px;
  background: linear-gradient(135deg, #dcfce7, #ecfdf5);
  border-bottom: 1px solid #bbf7d0;
}
.avm-prev-title { display: inline-flex; align-items: center; gap: 8px; font-size: 12.5px; font-weight: 800; color: #166534; }
.avm-prev-check { width: 22px; height: 22px; border-radius: 50%; background: linear-gradient(135deg, #22c55e, #16a34a); color: #fff; display: inline-flex; align-items: center; justify-content: center; }
.avm-prev-chip { padding: 3px 10px; border-radius: 99px; background: #fff; color: #166534; font-size: 11px; font-weight: 700; border: 1px solid #bbf7d0; }
.avm-prev-toggle { height: 28px; padding: 0 12px; background: #fff; border: 1px solid #bbf7d0; color: #166534; border-radius: 7px; font-family: inherit; font-size: 11.5px; font-weight: 800; cursor: pointer; }
.avm-prev-body { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 8px; padding: 12px 14px; }
.avm-prev-field { padding: 8px 12px; background: #fff; border: 1px solid #bbf7d0; border-radius: 8px; }
.avm-prev-field-key { font-size: 9.5px; font-weight: 800; letter-spacing: .06em; color: #94a3b8; text-transform: uppercase; }
.avm-prev-field-val { font-size: 12.5px; font-weight: 700; color: #1e1b4b; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

/* Tabs */
.avm-tabs {
  display: flex; gap: 4px; margin-bottom: 14px;
  border-bottom: 1.5px solid #d8e3fa;
}
.avm-tab {
  background: none; border: none; padding: 10px 16px;
  font-family: inherit; font-size: 13px; font-weight: 700;
  color: #94a3b8; cursor: pointer;
  border-bottom: 2.5px solid transparent;
  margin-bottom: -1.5px;
  transition: color .15s, border-color .15s;
}
.avm-tab:hover { color: #405189; }
.avm-tab.on { color: #405189; border-bottom-color: #405189; }

/* Pill tabs (Step 2 sub-tabs) */
.avm-pill-tabs { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 14px; }
.avm-pill {
  background: #eef2ff; color: #405189;
  border: 1px solid #d8e3fa; border-radius: 99px;
  padding: 7px 14px; font-family: inherit; font-size: 12px; font-weight: 700; cursor: pointer;
  transition: background .15s, border-color .15s;
}
.avm-pill:hover { background: #dbe5fc; border-color: #c0cffb; }
.avm-pill.on { background: linear-gradient(120deg, #405189, #6691e7); color: #fff; border-color: transparent; }
.avm-sub-pills { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 14px; }
.avm-sub-pill {
  display: inline-flex; align-items: center; gap: 6px;
  background: #fff; color: #475569;
  border: 1.5px solid #e2e8f0; border-radius: 8px;
  padding: 6px 14px; font-family: inherit; font-size: 12px; font-weight: 700; cursor: pointer;
}
.avm-sub-pill::before { content: ''; width: 8px; height: 8px; border-radius: 50%; background: #cbd5e1; display: inline-block; }
.avm-sub-pill.on { color: #15803d; border-color: #86efac; background: #ecfdf5; }
.avm-sub-pill.on::before { background: #16a34a; }

/* Section card */
.avm-section {
  background: #fff;
  border: 1.5px solid transparent; border-left-width: 4px;
  border-radius: 14px; margin-bottom: 14px; overflow: hidden;
}
.avm-section-violet { border-color: #c0cffb; border-left-color: #405189; }
.avm-section-amber  { border-color: #fde68a; border-left-color: #f59e0b; }
.avm-section-teal   { border-color: #99f6e4; border-left-color: #14b8a6; }
.avm-section-green  { border-color: #bbf7d0; border-left-color: #16a34a; }
.avm-section-purple { border-color: #c0cffb; border-left-color: #6691e7; }

.avm-section-head {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 12px 16px;
}
/* Subtle tinted section heads — keep the coloured left-border accent but
   use a near-white head so it doesn't fight the white form surface. */
.avm-section-violet .avm-section-head { background: #f8f9fa; }
.avm-section-amber  .avm-section-head { background: #f8f9fa; }
.avm-section-teal   .avm-section-head { background: #f8f9fa; }
.avm-section-green  .avm-section-head { background: #f8f9fa; }
.avm-section-purple .avm-section-head { background: #f8f9fa; }
.avm-section-head-left { display: flex; align-items: center; gap: 10px; }
.avm-section-icon {
  width: 32px; height: 32px; border-radius: 9px;
  display: flex; align-items: center; justify-content: center;
  color: #fff; font-size: 16px;
}
.avm-section-violet .avm-section-icon { background: linear-gradient(135deg, #405189, #2b3a85); }
.avm-section-amber  .avm-section-icon { background: linear-gradient(135deg, #f59e0b, #d97706); }
.avm-section-teal   .avm-section-icon { background: linear-gradient(135deg, #14b8a6, #0f766e); }
.avm-section-green  .avm-section-icon { background: linear-gradient(135deg, #16a34a, #0f8a3e); }
.avm-section-purple .avm-section-icon { background: linear-gradient(135deg, #6691e7, #405189); }
.avm-section-title { font-size: 13.5px; font-weight: 800; color: #1e1b4b; }
.avm-section-sub   { font-size: 11px; color: #6b7280; margin-top: 1px; }
.avm-section-amber .avm-section-title { color: #92400e; }
.avm-section-amber .avm-section-sub   { color: #b45309; }
.avm-section-body { padding: 14px 16px 16px; display: flex; flex-direction: column; gap: 12px; }

.avm-section-add-btn {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 7px 14px; border-radius: 8px;
  background: linear-gradient(120deg, #405189 0%, #6691e7 100%); color: #fff; border: none;
  font-family: inherit; font-size: 12px; font-weight: 800; cursor: pointer;
  transition: transform .12s, box-shadow .15s;
}
.avm-section-add-btn:hover { transform: translateY(-1px); box-shadow: 0 4px 12px rgba(64,81,137,.35); }

/* Form */
.avm-grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.avm-grid-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
.avm-grid-4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }

.avm-field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.avm-field-label {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 12.5px; font-weight: 600;
  color: var(--vz-body-color, #495057);
  margin-bottom: 2px;
}
.avm-req { color: #ef4444; font-weight: 700; }
.avm-field-plus {
  width: 18px; height: 18px;
  border: none; border-radius: 5px;
  background: #405189; color: #fff;
  font-size: 14px; font-weight: 700; line-height: 1; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
}
/* Inputs — Velzon form-control look (white surface, light border, 6px
   radius). Focus uses the project's primary navy. */
.avm-input {
  height: 38px; width: 100%;
  padding: 0 12px;
  border: 1px solid var(--vz-border-color, #e9ebec);
  border-radius: 6px;
  background: var(--vz-card-bg, #fff); color: var(--vz-body-color, #495057);
  font-family: inherit; font-size: 13px; outline: none;
  transition: border-color .15s, box-shadow .15s;
}
.avm-input::placeholder { color: #b3b3b3; }
.avm-input:focus { border-color: #405189; box-shadow: 0 0 0 3px rgba(64,81,137,.15); }

/* MasterSelect inside this modal — match Velzon form-select chrome */
.avm-master-select .master-select-wrap .master-select-toggle {
  min-height: 38px !important; height: 38px;
  padding: 0 32px 0 12px !important;
  font-size: 13px !important;
  background: var(--vz-card-bg, #fff) !important;
  border: 1px solid var(--vz-border-color, #e9ebec) !important;
  border-radius: 6px !important;
  color: var(--vz-body-color, #495057) !important;
}
.avm-master-select .master-select-wrap.show .master-select-toggle {
  border-color: #405189 !important;
  box-shadow: 0 0 0 3px rgba(64,81,137,.15) !important;
}

/* Radios */
.avm-radio-row { display: inline-flex; align-items: center; gap: 16px; height: 38px; }
.avm-radio { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; color: #1e1b4b; cursor: pointer; }
.avm-radio input { width: 16px; height: 16px; accent-color: #405189; }

/* File chooser — same chrome as the inputs, dashed border to signal upload */
.avm-filechooser {
  position: relative;
  height: 38px; padding: 0 12px;
  border: 1px dashed var(--vz-border-color, #e9ebec); border-radius: 6px;
  background: var(--vz-card-bg, #fff); color: #6b7280;
  display: inline-flex; align-items: center; gap: 8px;
  font-size: 12.5px; font-weight: 500; cursor: pointer;
  width: 100%;
}
.avm-filechooser:hover { border-color: #405189; }
.avm-filechooser-input { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
.avm-filechooser-icon { color: #405189; font-size: 15px; flex-shrink: 0; }
.avm-filechooser-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* Extra contact rows */
.avm-extra-contacts { display: flex; flex-direction: column; gap: 12px; }
.avm-extra-contact { padding: 10px 12px; border: 1px solid #e2e8f0; border-radius: 10px; background: #f8fafc; }
.avm-extra-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; font-size: 12px; color: #405189; }
.avm-extra-remove {
  width: 28px; height: 28px; border-radius: 7px;
  border: 1px solid #fecaca; background: #fef2f2; color: #b91c1c;
  cursor: pointer; display: inline-flex; align-items: center; justify-content: center;
}

.avm-empty { padding: 22px; text-align: center; color: #94a3b8; font-size: 12.5px; border: 1.5px dashed #e2e8f0; border-radius: 10px; background: #fff; }

/* Doc table */
.avm-doctable-wrap { display: flex; flex-direction: column; gap: 10px; }
.avm-doctable-banner {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 8px 14px; border-radius: 8px;
  font-size: 12.5px; font-weight: 800; letter-spacing: .04em;
  align-self: flex-start;
}
.avm-doctable-banner.tone-amber { background: linear-gradient(135deg, #fef3c7, #fef9c3); color: #92400e; border: 1px solid #fde68a; }
.avm-doctable-banner.tone-teal  { background: linear-gradient(135deg, #ccfbf1, #f0fdfa); color: #0f766e; border: 1px solid #99f6e4; }
.avm-doctable-icon {
  width: 24px; height: 24px; border-radius: 6px;
  background: linear-gradient(135deg, #f59e0b, #d97706); color: #fff;
  display: inline-flex; align-items: center; justify-content: center;
}
.avm-doctable-banner-label { color: inherit; }
.avm-doctable-banner-sub { font-weight: 600; letter-spacing: 0; color: #b45309; }
.avm-doctable-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.avm-doctable-search {
  flex: 1; max-width: 360px;
  position: relative;
  height: 36px;
  background: #fff; border: 1.5px solid #e2e8f0; border-radius: 10px;
  display: inline-flex; align-items: center; padding: 0 12px 0 36px;
}
.avm-doctable-search i { position: absolute; left: 12px; color: #94a3b8; font-size: 14px; }
.avm-doctable-search input { flex: 1; height: 100%; border: none; outline: none; background: transparent; font-size: 13px; }
.avm-doctable-count { font-size: 12px; color: #405189; font-weight: 700; }

/* Doc tables — keep the plain Velzon table-light header (same as the
   Clients master) so the chrome stays consistent across the app. */
.avm-doctable-wrap .table thead th {
  font-size: 11.5px; letter-spacing: .04em; font-weight: 700;
}

/* Bank grid */
.avm-bank-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }

/* Product list (Step 4) */
.avm-product-list { display: flex; flex-direction: column; gap: 8px; }
.avm-product-row {
  display: grid; grid-template-columns: auto 1fr auto; gap: 12px; align-items: center;
  padding: 12px 14px;
  background: #fff; border: 1.5px solid #e2e8f0; border-radius: 10px;
  cursor: pointer;
  transition: border-color .15s, background .15s;
}
.avm-product-row.on { border-color: #16a34a; background: #ecfdf5; }
.avm-product-row input { width: 18px; height: 18px; accent-color: #16a34a; }
.avm-product-code { font-size: 11px; font-weight: 800; color: #405189; letter-spacing: .06em; }
.avm-product-name { font-size: 13px; font-weight: 700; color: #1e1b4b; }
.avm-product-info { display: inline-flex; gap: 6px; }
.avm-product-tag { padding: 3px 9px; border-radius: 99px; background: #eef2ff; color: #405189; font-size: 10.5px; font-weight: 700; }

/* Footer */
.avm-foot {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 22px;
  background: #fff; border-top: 1px solid #d8e3fa;
}
.avm-foot-right { display: flex; align-items: center; gap: 8px; }
.avm-btn-ghost, .avm-btn-outline, .avm-btn-primary {
  display: inline-flex; align-items: center; gap: 6px;
  height: 40px; padding: 0 18px;
  font-family: inherit; font-size: 13px; font-weight: 800; cursor: pointer;
  border-radius: 10px;
  transition: transform .12s, background .15s, box-shadow .15s, border-color .15s;
}
.avm-btn-ghost { background: #fff; border: 1.5px solid #e2e8f0; color: #475569; }
.avm-btn-ghost:hover { background: #f1f5f9; border-color: #cbd5e1; }
.avm-btn-outline { background: #fff; border: 1.5px solid #c0cffb; color: #405189; }
.avm-btn-outline:hover { background: #eef2ff; border-color: #405189; }
.avm-btn-primary {
  background: linear-gradient(120deg, #405189 0%, #6691e7 100%); color: #fff; border: none;
  box-shadow: 0 4px 12px rgba(64,81,137,.4);
}
.avm-btn-primary:hover { transform: translateY(-1px); box-shadow: 0 6px 18px rgba(64,81,137,.5); }

@media (max-width: 880px) {
  .avm-grid-2, .avm-grid-3, .avm-grid-4 { grid-template-columns: 1fr 1fr; }
  .avm-bank-grid { grid-template-columns: 1fr 1fr; }
  .avm-stepper { flex-direction: column; }
  .avm-step-arrow { display: none; }
}
@media (max-width: 540px) {
  .avm-grid-2, .avm-grid-3, .avm-grid-4 { grid-template-columns: 1fr; }
  .avm-bank-grid { grid-template-columns: 1fr; }
}

/* ════════════════════════════════════════════════════════════════════════
 * Dark mode
 * ════════════════════════════════════════════════════════════════════ */
[data-bs-theme="dark"] .avm-modal { background: #14102a; color: #ede9fe; }
[data-bs-theme="dark"] .avm-stepper-wrap { background: #1a1430; border-bottom-color: #3b2a6b; }
[data-bs-theme="dark"] .avm-step { background: #221852; }
[data-bs-theme="dark"] .avm-step-title { color: #ede9fe; }
[data-bs-theme="dark"] .avm-step-sub   { color: #a89fc7; }
[data-bs-theme="dark"] .avm-step-num   { background: #2a1d5c; color: #a89fc7; }
[data-bs-theme="dark"] .avm-body { background: #110c25; scrollbar-color: #4c1d95 transparent; }
[data-bs-theme="dark"] .avm-body::-webkit-scrollbar-thumb { background: #4c1d95; }
[data-bs-theme="dark"] .avm-section { background: #1a1430; }
[data-bs-theme="dark"] .avm-section-violet { border-color: #3b2a6b; border-left-color: #a78bfa; }
[data-bs-theme="dark"] .avm-section-amber  { border-color: #78350f; border-left-color: #f59e0b; }
[data-bs-theme="dark"] .avm-section-teal   { border-color: #0f766e; border-left-color: #14b8a6; }
[data-bs-theme="dark"] .avm-section-green  { border-color: #14532d; border-left-color: #4ade80; }
[data-bs-theme="dark"] .avm-section-violet .avm-section-head,
[data-bs-theme="dark"] .avm-section-purple .avm-section-head { background: linear-gradient(135deg, #221852, #2a1d5c); }
[data-bs-theme="dark"] .avm-section-amber  .avm-section-head { background: linear-gradient(135deg, #3f2c0a, #4a3408); }
[data-bs-theme="dark"] .avm-section-teal   .avm-section-head { background: linear-gradient(135deg, #0c2522, #133e3a); }
[data-bs-theme="dark"] .avm-section-green  .avm-section-head { background: linear-gradient(135deg, #14241a, #1a3225); }
[data-bs-theme="dark"] .avm-section-title { color: #ede9fe; }
[data-bs-theme="dark"] .avm-section-sub   { color: #a89fc7; }
[data-bs-theme="dark"] .avm-section-amber .avm-section-title { color: #fde68a; }
[data-bs-theme="dark"] .avm-section-amber .avm-section-sub   { color: #fcd34d; }
[data-bs-theme="dark"] .avm-field-label { color: #c4b5fd; }
[data-bs-theme="dark"] .avm-input { background: #110c25; border-color: #3b2a6b; color: #ede9fe; }
[data-bs-theme="dark"] .avm-input:focus { background: #1a1430; border-color: #a78bfa; box-shadow: 0 0 0 3px rgba(167,139,250,.18); }
[data-bs-theme="dark"] .avm-master-select .master-select-wrap .master-select-toggle {
  background: color-mix(in srgb, #a78bfa 12%, #110c25) !important;
  border-color: #3b2a6b !important; color: #ede9fe !important;
}
[data-bs-theme="dark"] .avm-filechooser { background: #110c25; border-color: #4c1d95; color: #a89fc7; }
[data-bs-theme="dark"] .avm-pill { background: #221852; color: #c4b5fd; border-color: #3b2a6b; }
[data-bs-theme="dark"] .avm-pill.on { background: linear-gradient(135deg, #6366f1, #4338ca); color: #fff; }
[data-bs-theme="dark"] .avm-sub-pill { background: #1a1430; border-color: #3b2a6b; color: #a89fc7; }
[data-bs-theme="dark"] .avm-sub-pill.on { background: #14241a; border-color: #14532d; color: #4ade80; }
[data-bs-theme="dark"] .avm-tabs { border-bottom-color: #3b2a6b; }
[data-bs-theme="dark"] .avm-tab { color: #6d6391; }
[data-bs-theme="dark"] .avm-tab.on { color: #c4b5fd; border-bottom-color: #a78bfa; }
[data-bs-theme="dark"] .avm-extra-contact { background: #110c25; border-color: #3b2a6b; }
[data-bs-theme="dark"] .avm-empty { background: #110c25; border-color: #3b2a6b; color: #6d6391; }
[data-bs-theme="dark"] .avm-foot { background: #14102a; border-top-color: #3b2a6b; }
[data-bs-theme="dark"] .avm-btn-ghost { background: #1a1430; border-color: #3b2a6b; color: #c4b5fd; }
[data-bs-theme="dark"] .avm-btn-outline { background: #1a1430; border-color: #4c1d95; color: #c4b5fd; }
[data-bs-theme="dark"] .avm-product-row { background: #110c25; border-color: #3b2a6b; }
[data-bs-theme="dark"] .avm-product-row.on { background: #14241a; border-color: #14532d; }
[data-bs-theme="dark"] .avm-product-name { color: #ede9fe; }
[data-bs-theme="dark"] .avm-product-tag { background: #2a1d5c; color: #c4b5fd; }
[data-bs-theme="dark"] .avm-doctable-search { background: #110c25; border-color: #3b2a6b; }
[data-bs-theme="dark"] .avm-doctable-search input { color: #ede9fe; }
[data-bs-theme="dark"] .avm-doctable-count { color: #c4b5fd; }
[data-bs-theme="dark"] .avm-prev { background: #14241a; border-color: #14532d; }
[data-bs-theme="dark"] .avm-prev-head { background: linear-gradient(135deg, #14241a, #1a3225); border-bottom-color: #14532d; }
[data-bs-theme="dark"] .avm-prev-title { color: #bbf7d0; }
[data-bs-theme="dark"] .avm-prev-toggle { background: #14241a; color: #bbf7d0; border-color: #166534; }
[data-bs-theme="dark"] .avm-prev-chip { background: #14241a; border-color: #166534; color: #bbf7d0; }
[data-bs-theme="dark"] .avm-prev-field { background: #110c25; border-color: #14532d; }
[data-bs-theme="dark"] .avm-prev-field-val { color: #ede9fe; }
`;
