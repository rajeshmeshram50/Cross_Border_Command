import { useEffect, useMemo, useState } from 'react';
import { useToast } from '../../contexts/ToastContext';

/* ────────────────────────────────────────────────────────────────────────────
 * Add Consignee — two-phase wizard
 *
 * Phase A: small "Add New Consignee" picker — select the customer this
 *          consignee will be linked to.
 * Phase B: full-page wizard with 3 stages
 *          1. Consignee Legal Identity (forms)
 *          2. KYC / Due Diligence (forms)
 *          3. Evidence Vault (KYC + Trade Documents)
 *
 * No DB yet — the page collects state in memory and "Save Consignee" just
 * fires a toast. Replace handleSave with api.post('/consignees', form) once
 * the backend lands.
 * ──────────────────────────────────────────────────────────────────────── */

export type ConsigneeRow = {
  id: string;
  customerId: string;
  company: string;
  segment: string;
  risk: 'Low' | 'Medium' | 'High';
  contact: string;
  email: string;
  phone: string;
  country: string;
  countryDetail: string;
};

// Stub of the customers the picker offers — same shape SalesCustomers uses
// for its mock dataset. Real flow will fetch from /customers.
type CustomerOption = {
  id: string;        // C-027
  initials: string;  // AF
  name: string;
  legalName: string;
  segment: string;
  type: string;
  classification: string;
  country: string;
  state: string;
  city: string;
  pin: string;
  contactPerson: string;
  phone: string;
  email: string;
  whatsapp: 'Yes' | 'No';
};

const CUSTOMER_OPTIONS: CustomerOption[] = [
  { id: 'C-001', initials: 'SE', name: 'Shree Exports Pvt Ltd',     legalName: 'Shree Exports Private Limited', segment: 'Dry Fruits',      type: 'Retailer',   classification: 'Standard', country: 'India',  state: 'Maharashtra', city: 'Mumbai',     pin: '400001', contactPerson: 'Yash Mote',     phone: '+91-9011033444', email: 'yash@shreeexports.com',    whatsapp: 'Yes' },
  { id: 'C-002', initials: 'GH', name: 'GreenHarvest Global',        legalName: 'GreenHarvest Global Limited',   segment: 'Agro',            type: 'Exporter',   classification: 'Standard', country: 'India',  state: 'Punjab',      city: 'Ludhiana',   pin: '141001', contactPerson: 'Ravi Vardhan',  phone: '+91-9123456789', email: 'ravi@greenharvestglobal.com', whatsapp: 'Yes' },
  { id: 'C-004', initials: 'IB', name: 'International Buyer LLC',    legalName: 'International Buyer LLC',       segment: 'Spices',          type: 'Wholesaler', classification: 'Premium',  country: 'UAE',    state: 'Dubai',       city: 'Dubai',      pin: '00000',  contactPerson: 'Ahmed Al-Farsi',phone: '+971-501234567', email: 'ahmed@intlbuyer.ae',       whatsapp: 'Yes' },
  { id: 'C-027', initials: 'AF', name: 'Agro Fresh Ltd',             legalName: 'Agro Fresh Limited',            segment: 'Organic Spices',  type: 'Retailer',   classification: 'Standard', country: 'India',  state: 'Tamil Nadu',  city: 'Coimbatore', pin: '641001', contactPerson: '—',             phone: '+91-9678901235', email: 'priya@agrofresh.in',       whatsapp: 'Yes' },
  { id: 'C-028', initials: 'GT', name: 'Gulf Food Traders LLC',      legalName: 'Gulf Food Traders LLC',         segment: 'Dry Fruits',      type: 'Wholesaler', classification: 'Standard', country: 'UAE',    state: 'Dubai',       city: 'Dubai',      pin: '00000',  contactPerson: 'Omar Al-Rashid',phone: '+971-571234567', email: 'omar@gulffood.ae',         whatsapp: 'Yes' },
  { id: 'C-029', initials: 'NA', name: 'Nwosu Agro Industries',      legalName: 'Nwosu Agro Industries Ltd',     segment: 'Cashew',          type: 'Exporter',   classification: 'Standard', country: 'Nigeria',state: 'Lagos',       city: 'Lagos',      pin: '100001', contactPerson: 'Amara Nwosu',   phone: '+234-8012345678',email: 'amara@nwosuagro.ng',       whatsapp: 'No' },
];

/* ─── KYC Documents mock dataset (Step 3) ─── */
type KycDoc = {
  id: string;       // DD-001
  name: string;
  authority: string;
  expiry: string;   // 12/2026, N/A
  expired: boolean; // drives red expiry pill
  mandatory: boolean;
};
const KYC_DOCS: KycDoc[] = [
  { id: 'DD-001', name: 'Certificate of Incorporation',         authority: 'Registrar of Companies (ROC)', expiry: 'N/A',     expired: false, mandatory: true },
  { id: 'DD-002', name: 'Memorandum & Articles of Association (MOA/AOA)', authority: 'Registrar of Companies (ROC)', expiry: 'N/A', expired: false, mandatory: true },
  { id: 'DD-003', name: 'Board Resolution for Authorized Signatory',     authority: 'Company Board',           expiry: '12/2026', expired: true,  mandatory: true },
  { id: 'DD-004', name: 'Financial Statements (Last 2-3 Years)',         authority: 'Statutory Auditor',       expiry: '03/2026', expired: true,  mandatory: true },
  { id: 'DD-005', name: 'Bank Account Verification Letter / Cancelled Cheque', authority: 'Authorized Dealer Bank', expiry: 'N/A', expired: false, mandatory: true },
  { id: 'DD-006', name: 'Tax Registration Certificate',                  authority: 'Income Tax Department',   expiry: 'N/A',     expired: false, mandatory: false },
];

interface Props {
  open: boolean;
  consignee: ConsigneeRow | null; // null = create; non-null = edit (skip phase A)
  onClose: () => void;
}

type Phase = 'pick-customer' | 'wizard';
type Stage = 1 | 2 | 3;
type IdentityTab = 'identification' | 'contact';
type VaultTab = 'kyc' | 'trade';

export default function AddConsigneeModal({ open, consignee, onClose }: Props) {
  const toast = useToast();

  const [phase, setPhase]   = useState<Phase>('pick-customer');
  const [stage, setStage]   = useState<Stage>(1);
  const [customer, setCustomer] = useState<CustomerOption | null>(null);
  const [search, setSearch]     = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [linkedHidden, setLinkedHidden] = useState(false);

  // Stage 1 — Consignee Legal Identity
  const [idTab, setIdTab]         = useState<IdentityTab>('identification');
  const [form1, setForm1] = useState({
    companyName: '', legalName: '', website: '', segment: '', classification: '', risk: '',
    addressType: 'Register Office Address', address: '', country: '', state: '', city: '', pin: '',
    contactName: '', designation: '', contactNo: '', email: '', whatsapp: 'Yes',
  });

  // Stage 2 — KYC / Due Diligence
  const [form2, setForm2] = useState({
    pan: '', tan: '', gstin: '', iec: '', incorpDate: '',
    ownerName: '', ownerDesignation: '', ownerPan: '', ownerEmail: '',
    sanctionsCheck: 'No', pepCheck: 'No', adverseMedia: 'No',
  });

  // Stage 3 — Evidence Vault
  const [vaultTab, setVaultTab] = useState<VaultTab>('kyc');

  // Reset everything when modal opens fresh.
  useEffect(() => {
    if (!open) return;
    if (consignee) {
      // Edit mode — skip the customer picker; preload what we know.
      const found = CUSTOMER_OPTIONS.find(c => c.id === consignee.customerId) || null;
      setCustomer(found);
      setPhase('wizard');
    } else {
      setCustomer(null);
      setPhase('pick-customer');
    }
    setStage(1);
    setSearch('');
    setSearchOpen(false);
    setLinkedHidden(false);
    setIdTab('identification');
    setVaultTab('kyc');
  }, [open, consignee]);

  // useMemo MUST come before any conditional return — React enforces a
  // stable hook order across renders. Putting `if (!open) return null;`
  // before this trips "change in the order of Hooks called by
  // AddConsigneeModal" the first time the modal opens.
  const filteredCustomers = useMemo(() => {
    if (!search) return CUSTOMER_OPTIONS;
    const lo = search.toLowerCase();
    return CUSTOMER_OPTIONS.filter(c =>
      c.name.toLowerCase().includes(lo) ||
      c.id.toLowerCase().includes(lo) ||
      c.segment.toLowerCase().includes(lo),
    );
  }, [search]);

  if (!open) return null;

  const confirmCustomer = () => {
    if (!customer) {
      toast.warning('Pick a customer', 'Select the customer this consignee will be linked to.');
      return;
    }
    setPhase('wizard');
    setStage(1);
  };

  const goNext = () => setStage(s => (s < 3 ? (s + 1) as Stage : s));
  const goBack = () => setStage(s => (s > 1 ? (s - 1) as Stage : s));

  const handleSave = () => {
    toast.success('Consignee saved', `${form1.companyName || 'Consignee'} linked to ${customer?.name || 'customer'}`);
    onClose();
  };

  /* ─── Render: phase A — customer picker ─── */
  if (phase === 'pick-customer') {
    return (
      <div className="acm-overlay" onMouseDown={onClose}>
        <style>{SCOPED_CSS}</style>
        <div className="acm-pick" onMouseDown={e => e.stopPropagation()}>
          <div className="acm-pick-header">
            <button className="acm-close" onClick={onClose} aria-label="Close"><IconClose /></button>
            <div className="acm-pick-icon"><IconTruck size={28} /></div>
            <div className="acm-pick-title">Add New Consignee</div>
            <div className="acm-pick-sub">Select the customer account to which this consignee will be linked for shipment and export execution.</div>
          </div>
          <div className="acm-pick-body">
            <label className="acm-label">
              <IconUser /> CUSTOMER ACCOUNT <span className="acm-req">*</span>
            </label>
            <div className="acm-picker" onClick={() => setSearchOpen(true)}>
              <IconSearch />
              <input
                type="text"
                placeholder={customer ? 'Customer selected' : 'Search by name, ID, or segment...'}
                value={search}
                onChange={(e) => { setSearch(e.target.value); setSearchOpen(true); }}
                onFocus={() => setSearchOpen(true)}
              />
              <IconChevronDown />
            </div>

            {searchOpen && (
              <div className="acm-picker-list">
                {filteredCustomers.length === 0 && (
                  <div className="acm-picker-empty">No customers match — try a different search</div>
                )}
                {filteredCustomers.map(c => (
                  <button
                    key={c.id}
                    className="acm-picker-option"
                    onClick={() => { setCustomer(c); setSearch(''); setSearchOpen(false); }}
                  >
                    <div className="acm-pop-avatar">{c.initials}</div>
                    <div className="acm-pop-info">
                      <div className="acm-pop-name">{c.name}</div>
                      <div className="acm-pop-meta">{c.id} • {c.segment} • {c.country}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {customer && (
              <div className="acm-picked">
                <div className="acm-picked-avatar">{customer.initials}</div>
                <div className="acm-picked-info">
                  <div className="acm-picked-name">{customer.name}</div>
                  <div className="acm-picked-meta">{customer.id} • {customer.segment} • {customer.country}</div>
                </div>
                <button className="acm-picked-clear" onClick={() => setCustomer(null)} aria-label="Clear selection"><IconClose size={14} /></button>
              </div>
            )}

            <div className="acm-info">
              <div className="acm-info-icon"><IconInfo /></div>
              <div>
                The consignee will be <strong>linked to the selected customer</strong> and used for shipment delivery, export documentation, and traceability across all trade workflows.
              </div>
            </div>
          </div>
          <div className="acm-pick-footer">
            <button className="acm-btn acm-btn-light" onClick={onClose}><IconClose size={14} /> Cancel</button>
            <button
              className={`acm-btn acm-btn-primary ${customer ? '' : 'acm-btn-disabled'}`}
              onClick={confirmCustomer}
              disabled={!customer}
            >
              <IconCheck /> Confirm &amp; Continue
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* ─── Render: phase B — full-page wizard ─── */
  return (
    <div className="acm-overlay" onMouseDown={onClose}>
      <style>{SCOPED_CSS}</style>
      <div className="acm-wiz" onMouseDown={e => e.stopPropagation()}>
        {/* Header */}
        <div className="acm-wiz-header">
          <div className="acm-wiz-hicon"><IconTruck size={20} /></div>
          <div className="acm-wiz-htxt">
            <div className="acm-wiz-htitle">Add Consignee</div>
            <div className="acm-wiz-hsub">Capture consignee identity, customer linkage, compliance, and shipment readiness for export execution.</div>
          </div>
          <button className="acm-close" onClick={onClose} aria-label="Close"><IconClose /></button>
        </div>

        <div className="acm-wiz-body">
          {/* Linked Customer summary */}
          {customer && (
            <div className="acm-linked">
              <div className="acm-linked-bar">
                <div className="acm-linked-bar-left">
                  <div className="acm-linked-icon"><IconUser /></div>
                  <span className="acm-linked-label">LINKED CUSTOMER</span>
                  <span className="acm-linked-id">{customer.id}</span>
                  <span className="acm-linked-name">{customer.name}</span>
                </div>
                <button className="acm-linked-hide" onClick={() => setLinkedHidden(h => !h)}>
                  {linkedHidden ? 'Show' : 'Hide'} {linkedHidden ? <IconChevronDown /> : <IconChevronUp />}
                </button>
              </div>
              {!linkedHidden && (
                <div className="acm-linked-grid">
                  <LinkedField label="Company Name"       value={customer.name} />
                  <LinkedField label="Company Legal Name" value={customer.legalName} />
                  <LinkedField label="Customer Type"      value={<span className="acm-pill-blue">{customer.type}</span>} />
                  <LinkedField label="Segment"            value={customer.segment} />
                  <LinkedField label="Risk Level"         value="—" />
                  <LinkedField label="Classification"     value={customer.classification} />
                  <LinkedField label="Country"            value={customer.country} />
                  <LinkedField label="State"              value={customer.state} />
                  <LinkedField label="City"               value={customer.city} />
                  <LinkedField label="Pin / Postal Code"  value={customer.pin} />
                  <LinkedField label="Contact Person"     value={customer.contactPerson} />
                  <LinkedField label="Contact No"         value={customer.phone} />
                  <LinkedField label="Email"              value={customer.email} />
                  <LinkedField label="Whatsapp"           value={customer.whatsapp} />
                </div>
              )}
            </div>
          )}

          {/* 3-step indicator */}
          <div className="acm-steps">
            <StepNode
              n={1}
              title="Consignee Legal Identity"
              sub="Company, address & contact"
              status={stage > 1 ? 'done' : stage === 1 ? 'active' : 'idle'}
              icon={<IconHome />}
            />
            <div className="acm-steps-arrow"><IconChevronRight /></div>
            <StepNode
              n={2}
              title="KYC / Due Diligence"
              sub="Docs, identity & compliance"
              status={stage > 2 ? 'done' : stage === 2 ? 'active' : 'idle'}
              icon={<IconDoc />}
            />
            <div className="acm-steps-arrow"><IconChevronRight /></div>
            <StepNode
              n={3}
              title="Evidence Vault"
              sub="Trade documents & archive"
              status={stage === 3 ? 'active' : 'idle'}
              icon={<IconVault />}
            />
          </div>

          {/* Stage panes */}
          {stage === 1 && (
            <Stage1
              tab={idTab}
              setTab={setIdTab}
              form={form1}
              setForm={setForm1}
            />
          )}
          {stage === 2 && (
            <Stage2
              form={form2}
              setForm={setForm2}
            />
          )}
          {stage === 3 && (
            <Stage3
              vaultTab={vaultTab}
              setVaultTab={setVaultTab}
              form1={form1}
              form2={form2}
            />
          )}
        </div>

        {/* Footer */}
        <div className="acm-wiz-footer">
          <button className="acm-btn acm-btn-light" onClick={onClose}><IconClose size={14} /> Cancel</button>
          <div className="acm-footer-right">
            {stage > 1 && (
              <button className="acm-btn acm-btn-light" onClick={goBack}>
                <IconChevronLeft /> Previous
              </button>
            )}
            {stage < 3 && (
              <button className="acm-btn acm-btn-primary" onClick={goNext}>
                Save &amp; Next <IconChevronRight />
              </button>
            )}
            {stage === 3 && (
              <button className="acm-btn acm-btn-primary" onClick={handleSave}>
                <IconCheck /> Save Consignee
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Sub-components ─── */

const LinkedField = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <div className="acm-linked-field">
    <div className="acm-linked-flabel">{label.toUpperCase()}</div>
    <div className="acm-linked-fvalue">{value}</div>
  </div>
);

const StepNode = ({ n, title, sub, status, icon }: {
  n: number; title: string; sub: string;
  status: 'idle' | 'active' | 'done';
  icon: React.ReactNode;
}) => (
  <div className={`acm-step ${status === 'active' ? 'acm-step-active' : ''} ${status === 'done' ? 'acm-step-done' : ''}`}>
    <div className="acm-step-badge">
      {status === 'done' ? <IconCheck /> : status === 'active' ? icon : <span>{n}</span>}
    </div>
    <div className="acm-step-text">
      <div className="acm-step-title">{title}</div>
      <div className="acm-step-sub">{sub}</div>
    </div>
    {status === 'done' && <div className="acm-step-done-mark"><IconCheck size={12} /></div>}
  </div>
);

const SectionHeader = ({ icon, title, sub, accent }: { icon: React.ReactNode; title: string; sub: string; accent?: string }) => (
  <div className="acm-sec-header" style={accent ? { borderTopColor: accent } : undefined}>
    <div className="acm-sec-icon" style={accent ? { background: accent } : undefined}>{icon}</div>
    <div>
      <div className="acm-sec-title">{title}</div>
      <span className="acm-sec-sep">|</span>
      <span className="acm-sec-sub">{sub}</span>
    </div>
  </div>
);

const Field = ({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) => (
  <div className="acm-field">
    <label className="acm-field-label">
      {label.toUpperCase()} {required && <span className="acm-req">*</span>}
    </label>
    {children}
  </div>
);

/* ─── Stage 1 — Consignee Legal Identity ─── */
const Stage1 = ({ tab, setTab, form, setForm }: {
  tab: IdentityTab;
  setTab: (t: IdentityTab) => void;
  form: any;
  setForm: (next: any) => void;
}) => {
  const set = (k: string, v: any) => setForm({ ...form, [k]: v });
  return (
    <>
      <div className="acm-id-tabs">
        <button className={`acm-id-tab ${tab === 'identification' ? 'on' : ''}`} onClick={() => setTab('identification')}>
          <IconTruck size={14} /> Consignee Identification Details
        </button>
        <button className={`acm-id-tab ${tab === 'contact' ? 'on' : ''}`} onClick={() => setTab('contact')}>
          <IconUser /> Contact Person Details
        </button>
      </div>

      {tab === 'identification' && (
        <>
          <SectionHeader icon={<IconHome />} title="Basic Company Details"     sub="Company identity, segment, and risk classification" accent="#10b981" />
          <div className="acm-grid-2 acm-sec-pad">
            <Field label="Company Name" required>
              <input className="acm-input" placeholder="Enter company name" value={form.companyName} onChange={e => set('companyName', e.target.value)} />
            </Field>
            <Field label="Company Legal Name" required>
              <input className="acm-input" placeholder="Enter legal name" value={form.legalName} onChange={e => set('legalName', e.target.value)} />
            </Field>
            <Field label="Company Website">
              <input className="acm-input" placeholder="https://example.com" value={form.website} onChange={e => set('website', e.target.value)} />
            </Field>
            <Field label="Consignee Segment" required>
              <select className="acm-input" value={form.segment} onChange={e => set('segment', e.target.value)}>
                <option value="">Select Segment</option>
                <option>Agro</option><option>Dry Fruits</option><option>Spices</option>
                <option>Rice &amp; Grains</option><option>Coffee Beans</option><option>Organic Spices</option>
              </select>
            </Field>
            <Field label="Classification &amp; Flags">
              <select className="acm-input" value={form.classification} onChange={e => set('classification', e.target.value)}>
                <option value="">Select Classification</option>
                <option>Standard</option><option>Premium</option><option>Strategic</option>
              </select>
            </Field>
            <Field label="Risk Level" required>
              <select className="acm-input" value={form.risk} onChange={e => set('risk', e.target.value)}>
                <option value="">Select Risk Level</option>
                <option>Low</option><option>Medium</option><option>High</option>
              </select>
            </Field>
          </div>

          <SectionHeader icon={<IconPin />} title="Company Address &amp; Primary Contact" sub="Registered office location and primary contact details" accent="#3b82f6" />
          <div className="acm-sec-pad">
            <div className="acm-grid-2">
              <Field label="Address Type">
                <select className="acm-input" value={form.addressType} onChange={e => set('addressType', e.target.value)}>
                  <option>Register Office Address</option><option>Warehouse Address</option><option>Billing Address</option><option>Shipping Address</option>
                </select>
              </Field>
              <Field label="Address" required>
                <input className="acm-input" placeholder="Enter full address" value={form.address} onChange={e => set('address', e.target.value)} />
              </Field>
            </div>
            <div className="acm-grid-4 acm-mt-12">
              <Field label="Country" required>
                <select className="acm-input" value={form.country} onChange={e => set('country', e.target.value)}>
                  <option value="">Select Country</option><option>India</option><option>UAE</option><option>USA</option><option>UK</option><option>Singapore</option>
                </select>
              </Field>
              <Field label="State" required>
                <input className="acm-input" placeholder="Select country first" value={form.state} onChange={e => set('state', e.target.value)} disabled={!form.country} />
              </Field>
              <Field label="City" required>
                <input className="acm-input" placeholder="Enter city" value={form.city} onChange={e => set('city', e.target.value)} />
              </Field>
              <Field label="Pin / Postal Code" required>
                <input className="acm-input" placeholder="Enter PIN code" value={form.pin} onChange={e => set('pin', e.target.value)} />
              </Field>
            </div>
          </div>

          <SectionHeader icon={<IconUser />} title="Primary Contact Details" sub="Key contact person for this consignee" accent="#10b981" />
          <div className="acm-sec-pad">
            <div className="acm-grid-4">
              <Field label="Contact Person Name" required>
                <input className="acm-input" placeholder="Enter contact name" value={form.contactName} onChange={e => set('contactName', e.target.value)} />
              </Field>
              <Field label="Designation" required>
                <input className="acm-input" placeholder="Enter designation" value={form.designation} onChange={e => set('designation', e.target.value)} />
              </Field>
              <Field label="Contact No" required>
                <input className="acm-input" placeholder="Enter phone number" value={form.contactNo} onChange={e => set('contactNo', e.target.value)} />
              </Field>
              <Field label="Email ID" required>
                <input className="acm-input" placeholder="Enter email address" value={form.email} onChange={e => set('email', e.target.value)} />
              </Field>
            </div>
            <div className="acm-mt-12">
              <Field label="Whatsapp Enabled?" required>
                <div className="acm-radio-row">
                  <label className="acm-radio">
                    <input type="radio" name="acm-wa" checked={form.whatsapp === 'Yes'} onChange={() => set('whatsapp', 'Yes')} />
                    <span /> Yes
                  </label>
                  <label className="acm-radio">
                    <input type="radio" name="acm-wa" checked={form.whatsapp === 'No'} onChange={() => set('whatsapp', 'No')} />
                    <span /> No
                  </label>
                </div>
              </Field>
            </div>
          </div>
        </>
      )}

      {tab === 'contact' && (
        <div className="acm-sec-pad">
          <SectionHeader icon={<IconUser />} title="Contact Person Details" sub="Designate authorised signatories and escalation contacts" accent="#10b981" />
          <div className="acm-grid-2">
            <Field label="Primary Contact Name" required>
              <input className="acm-input" placeholder="Enter contact name" value={form.contactName} onChange={e => set('contactName', e.target.value)} />
            </Field>
            <Field label="Designation" required>
              <input className="acm-input" placeholder="Enter designation" value={form.designation} onChange={e => set('designation', e.target.value)} />
            </Field>
            <Field label="Contact No" required>
              <input className="acm-input" placeholder="Enter phone number" value={form.contactNo} onChange={e => set('contactNo', e.target.value)} />
            </Field>
            <Field label="Email ID" required>
              <input className="acm-input" placeholder="Enter email address" value={form.email} onChange={e => set('email', e.target.value)} />
            </Field>
          </div>
        </div>
      )}
    </>
  );
};

/* ─── Stage 2 — KYC / Due Diligence ─── */
const Stage2 = ({ form, setForm }: { form: any; setForm: (next: any) => void }) => {
  const set = (k: string, v: any) => setForm({ ...form, [k]: v });
  return (
    <>
      <SectionHeader icon={<IconDoc />} title="Statutory Identifiers" sub="Tax & regulatory registration numbers" accent="#10b981" />
      <div className="acm-grid-3 acm-sec-pad">
        <Field label="PAN" required>
          <input className="acm-input" placeholder="ABCDE1234F" value={form.pan} onChange={e => set('pan', e.target.value)} />
        </Field>
        <Field label="TAN">
          <input className="acm-input" placeholder="ABCD12345E" value={form.tan} onChange={e => set('tan', e.target.value)} />
        </Field>
        <Field label="GSTIN">
          <input className="acm-input" placeholder="22AAAAA0000A1Z5" value={form.gstin} onChange={e => set('gstin', e.target.value)} />
        </Field>
        <Field label="IEC">
          <input className="acm-input" placeholder="Import-Export Code" value={form.iec} onChange={e => set('iec', e.target.value)} />
        </Field>
        <Field label="Date of Incorporation">
          <input className="acm-input" type="date" value={form.incorpDate} onChange={e => set('incorpDate', e.target.value)} />
        </Field>
      </div>

      <SectionHeader icon={<IconUser />} title="Authorised Signatory" sub="Primary owner / director on record" accent="#3b82f6" />
      <div className="acm-grid-2 acm-sec-pad">
        <Field label="Owner / Director Name" required>
          <input className="acm-input" placeholder="Enter name" value={form.ownerName} onChange={e => set('ownerName', e.target.value)} />
        </Field>
        <Field label="Designation">
          <input className="acm-input" placeholder="Director / Partner / Proprietor" value={form.ownerDesignation} onChange={e => set('ownerDesignation', e.target.value)} />
        </Field>
        <Field label="Owner PAN">
          <input className="acm-input" placeholder="ABCDE1234F" value={form.ownerPan} onChange={e => set('ownerPan', e.target.value)} />
        </Field>
        <Field label="Owner Email">
          <input className="acm-input" placeholder="owner@company.com" value={form.ownerEmail} onChange={e => set('ownerEmail', e.target.value)} />
        </Field>
      </div>

      <SectionHeader icon={<IconShield />} title="Compliance Screening" sub="Sanctions, PEP, and adverse media checks" accent="#f59e0b" />
      <div className="acm-grid-3 acm-sec-pad">
        <Field label="Sanctions List Hit?" required>
          <YesNoRadio name="acm-sanctions" value={form.sanctionsCheck} onChange={(v) => set('sanctionsCheck', v)} />
        </Field>
        <Field label="PEP Match?" required>
          <YesNoRadio name="acm-pep" value={form.pepCheck} onChange={(v) => set('pepCheck', v)} />
        </Field>
        <Field label="Adverse Media?" required>
          <YesNoRadio name="acm-media" value={form.adverseMedia} onChange={(v) => set('adverseMedia', v)} />
        </Field>
      </div>
    </>
  );
};

const YesNoRadio = ({ name, value, onChange }: { name: string; value: string; onChange: (v: string) => void }) => (
  <div className="acm-radio-row">
    <label className="acm-radio">
      <input type="radio" name={name} checked={value === 'Yes'} onChange={() => onChange('Yes')} />
      <span /> Yes
    </label>
    <label className="acm-radio">
      <input type="radio" name={name} checked={value === 'No'} onChange={() => onChange('No')} />
      <span /> No
    </label>
  </div>
);

/* ─── Stage 3 — Evidence Vault ─── */
const Stage3 = ({ vaultTab, setVaultTab, form1, form2 }: {
  vaultTab: VaultTab;
  setVaultTab: (t: VaultTab) => void;
  form1: any; form2: any;
}) => {
  const [recapHidden, setRecapHidden] = useState(false);
  return (
    <>
      {/* "What you did in the previous stage" recap */}
      <div className="acm-recap">
        <div className="acm-recap-header">
          <div className="acm-recap-head-left">
            <span className="acm-recap-check"><IconCheck size={14} /></span>
            <span className="acm-recap-title">What you did in the previous stage</span>
          </div>
          <div className="acm-recap-head-right">
            <span className="acm-recap-tag">Step 1–2 Complete</span>
            <button className="acm-recap-toggle" onClick={() => setRecapHidden(h => !h)}>
              {recapHidden ? 'Show' : 'Hide'} {recapHidden ? <IconChevronDown /> : <IconChevronUp />}
            </button>
          </div>
        </div>
        {!recapHidden && (
          <div className="acm-recap-body">
            <div className="acm-recap-stage">
              <div className="acm-recap-stage-head">
                <span className="acm-recap-stage-icon"><IconHome /></span>
                <span className="acm-recap-stage-title">Step 1 — Consignee Legal Identity</span>
                <span className="acm-recap-done">✓ Done</span>
              </div>
              <div className="acm-recap-card">
                <div className="acm-recap-sec-title"><IconHome size={12} /> COMPANY DETAILS</div>
                <div className="acm-recap-grid">
                  <RecapField label="Company Name" value={form1.companyName} />
                  <RecapField label="Legal Name"   value={form1.legalName} />
                  <RecapField label="Segment"      value={form1.segment} />
                  <RecapField label="Risk Level"   value={form1.risk} />
                  <RecapField label="Website"      value={form1.website} />
                  <RecapField label="Classification" value={form1.classification} />
                </div>
              </div>
              <div className="acm-recap-card">
                <div className="acm-recap-sec-title"><IconPin size={12} /> ADDRESS &amp; CONTACT</div>
                <div className="acm-recap-grid">
                  <RecapField label="Country" value={form1.country} />
                  <RecapField label="State"   value={form1.state} />
                  <RecapField label="City"    value={form1.city} />
                  <RecapField label="Pin"     value={form1.pin} />
                  <RecapField label="Address Type" value={form1.addressType} />
                  <RecapField label="Address" value={form1.address} />
                </div>
              </div>
            </div>

            <div className="acm-recap-stage">
              <div className="acm-recap-stage-head">
                <span className="acm-recap-stage-icon"><IconDoc /></span>
                <span className="acm-recap-stage-title">Step 2 — KYC / Due Diligence</span>
                <span className="acm-recap-done">✓ Done</span>
              </div>
              <div className="acm-recap-card">
                <div className="acm-recap-sec-title"><IconCheck size={12} /> KYC SUMMARY</div>
                <div className="acm-recap-pills">
                  <span className="acm-recap-pill">✓ {form2.pan ? '1' : '0'} docs</span>
                  <span className="acm-recap-pill">✓ {form2.ownerName ? '1' : '0'} owners</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Vault tabs */}
      <div className="acm-id-tabs">
        <button className={`acm-id-tab ${vaultTab === 'kyc' ? 'on' : ''}`} onClick={() => setVaultTab('kyc')}>
          <IconDoc /> KYC Documents
        </button>
        <button className={`acm-id-tab ${vaultTab === 'trade' ? 'on' : ''}`} onClick={() => setVaultTab('trade')}>
          <IconVault /> Trade Documents
        </button>
      </div>

      {vaultTab === 'kyc' && (
        <>
          <SectionHeader icon={<IconCheck />} title="KYC Documents" sub="Verified licenses and compliance documents (read-only)" accent="#3b82f6" />
          <div className="acm-vault-tabs">
            <button className="acm-vault-tab on"><IconHome size={12} /> Company Due Diligence</button>
            <button className="acm-vault-tab"><IconUser /> Owner KYC</button>
            <button className="acm-vault-tab"><IconDoc /> Trade License</button>
          </div>
          <div className="acm-vault-table-wrap">
            <table className="acm-vault-table">
              <thead>
                <tr>
                  <th>SR NO</th>
                  <th>AUTO CODE</th>
                  <th>DD DOCUMENT NAME</th>
                  <th>ISSUING AUTHORITY</th>
                  <th>EXPIRY</th>
                  <th>STATUS</th>
                  <th>ATTACHMENT</th>
                </tr>
              </thead>
              <tbody>
                {KYC_DOCS.map((d, i) => (
                  <tr key={d.id}>
                    <td className="acm-vault-srno">{i + 1}</td>
                    <td><span className="acm-vault-code">{d.id}</span></td>
                    <td className="acm-vault-name">{d.name}</td>
                    <td className="acm-vault-auth">{d.authority}</td>
                    <td><span className={`acm-vault-exp ${d.expired ? 'expired' : ''}`}>{d.expiry}</span></td>
                    <td>
                      {d.mandatory
                        ? <span className="acm-vault-status acm-vault-mand">✓ Mandatory</span>
                        : <span className="acm-vault-status acm-vault-opt">Optional</span>}
                    </td>
                    <td>
                      <a className="acm-vault-attach" href="#" onClick={e => e.preventDefault()}>
                        <IconAttach /> View Attachment
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {vaultTab === 'trade' && (
        <>
          <SectionHeader icon={<IconVault />} title="Trade Documents" sub="Shipping bills, BL/AWB, packing lists & export evidence" accent="#10b981" />
          <div className="acm-trade-empty">
            <IconVault size={32} />
            <div className="acm-trade-empty-title">No trade documents yet</div>
            <div className="acm-trade-empty-sub">Trade documents will populate automatically as PI/Invoice/Shipping flows execute against this consignee.</div>
          </div>
        </>
      )}
    </>
  );
};

const RecapField = ({ label, value }: { label: string; value?: string }) => (
  <div className="acm-recap-field">
    <div className="acm-recap-flabel">{label.toUpperCase()}</div>
    <div className="acm-recap-fvalue">{value || '—'}</div>
  </div>
);

/* ─── Icons ─── */
const IconTruck = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10 17h4V5H2v12h3" /><path d="M20 17h2v-3.34a4 4 0 0 0-1.17-2.83L19 9h-5" />
    <path d="M14 17h1" /><circle cx="7.5" cy="17.5" r="2.5" /><circle cx="17.5" cy="17.5" r="2.5" />
  </svg>
);
const IconUser = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
  </svg>
);
const IconHome = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
    <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" />
  </svg>
);
const IconPin = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
    <path d="M20 10c0 7-8 12-8 12s-8-5-8-12a8 8 0 0 1 16 0z" /><circle cx="12" cy="10" r="3" />
  </svg>
);
const IconDoc = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" />
    <line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" />
  </svg>
);
const IconVault = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
    <rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="12" cy="12" r="4" /><circle cx="12" cy="12" r="1" />
  </svg>
);
const IconShield = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
  </svg>
);
const IconSearch = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2.2" strokeLinecap="round">
    <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
  </svg>
);
const IconClose = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);
const IconCheck = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);
const IconChevronDown = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
    <polyline points="6 9 12 15 18 9" />
  </svg>
);
const IconChevronUp = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
    <polyline points="18 15 12 9 6 15" />
  </svg>
);
const IconChevronLeft = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
    <polyline points="15 18 9 12 15 6" />
  </svg>
);
const IconChevronRight = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
    <polyline points="9 18 15 12 9 6" />
  </svg>
);
const IconInfo = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#1d4ed8" strokeWidth="2.2" strokeLinecap="round">
    <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12" y2="8" />
  </svg>
);
const IconAttach = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
    <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
  </svg>
);

/* ─── Scoped CSS ─── */
const SCOPED_CSS = `
.acm-overlay {
  position: fixed; inset: 0;
  background: rgba(15, 42, 35, 0.55);
  backdrop-filter: blur(6px);
  display: flex; align-items: center; justify-content: center;
  z-index: 1080;
  font-family: 'DM Sans', 'Inter', system-ui, -apple-system, sans-serif;
  padding: 24px;
  overflow-y: auto;
}
.acm-overlay *, .acm-overlay *::before, .acm-overlay *::after { box-sizing: border-box; }

.acm-close {
  position: absolute; top: 14px; right: 14px;
  width: 32px; height: 32px; border-radius: 50%;
  background: rgba(255,255,255,.16); border: 1px solid rgba(255,255,255,.30);
  color: #fff; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: background .15s;
}
.acm-close:hover { background: rgba(255,255,255,.30); }

/* ─── Phase A — Customer picker ─── */
.acm-pick {
  width: 100%; max-width: 460px;
  background: #fff; border-radius: 18px; overflow: hidden;
  box-shadow: 0 30px 80px rgba(0,0,0,.30);
  display: flex; flex-direction: column;
}
.acm-pick-header {
  position: relative; padding: 28px 20px 24px;
  background: linear-gradient(135deg, #10b981 0%, #059669 50%, #047857 100%);
  color: #fff; text-align: center;
}
.acm-pick-icon {
  width: 48px; height: 48px; border-radius: 12px;
  background: rgba(255,255,255,.18); border: 1px solid rgba(255,255,255,.30);
  display: inline-flex; align-items: center; justify-content: center;
  color: #fff; margin-bottom: 12px;
}
.acm-pick-title { font-size: 19px; font-weight: 800; letter-spacing: -0.4px; }
.acm-pick-sub   { font-size: 12px; color: rgba(255,255,255,.85); margin-top: 6px; line-height: 1.45; padding: 0 14px; }
.acm-pick-body  { padding: 22px 20px 18px; display: flex; flex-direction: column; gap: 12px; }
.acm-label {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 11px; font-weight: 800; color: #047857;
  letter-spacing: 0.08em; text-transform: uppercase;
}
.acm-req { color: #ef4444; }

.acm-picker {
  display: flex; align-items: center; gap: 10px;
  background: #ecfdf5; border: 1.5px solid #a7f3d0; border-radius: 12px;
  padding: 11px 14px; cursor: text;
}
.acm-picker input {
  flex: 1; border: none; outline: none; background: transparent;
  font-family: inherit; font-size: 13px; color: #064e3b; font-weight: 500;
}
.acm-picker input::placeholder { color: #6b7280; }
.acm-picker-list {
  border: 1.5px solid #a7f3d0; border-radius: 12px;
  max-height: 280px; overflow-y: auto;
  background: #fff;
}
.acm-picker-option {
  display: flex; align-items: center; gap: 10px;
  width: 100%; padding: 10px 14px;
  background: transparent; border: none; cursor: pointer;
  text-align: left; transition: background .12s;
  border-bottom: 1px solid #f0fdf4;
}
.acm-picker-option:last-child { border-bottom: none; }
.acm-picker-option:hover { background: #f0fdf4; }
.acm-pop-avatar {
  width: 36px; height: 36px; border-radius: 10px;
  background: linear-gradient(135deg, #10b981, #047857);
  color: #fff; font-size: 12px; font-weight: 800;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.acm-pop-info  { min-width: 0; flex: 1; }
.acm-pop-name  { font-size: 13px; font-weight: 700; color: #064e3b; }
.acm-pop-meta  { font-size: 11px; color: #6b7280; margin-top: 1px; }
.acm-picker-empty { padding: 16px; text-align: center; font-size: 12px; color: #6b7280; }

.acm-picked {
  display: flex; align-items: center; gap: 12px;
  background: #ecfdf5; border: 1.5px solid #10b981; border-radius: 12px;
  padding: 12px 14px;
}
.acm-picked-avatar {
  width: 40px; height: 40px; border-radius: 10px;
  background: linear-gradient(135deg, #10b981, #047857);
  color: #fff; font-size: 13px; font-weight: 800;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.acm-picked-info { flex: 1; min-width: 0; }
.acm-picked-name { font-size: 14px; font-weight: 700; color: #064e3b; }
.acm-picked-meta { font-size: 11.5px; color: #6b7280; margin-top: 2px; }
.acm-picked-clear {
  width: 28px; height: 28px; border-radius: 50%;
  background: #fef2f2; color: #b91c1c; border: 1px solid #fecaca;
  cursor: pointer; display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.acm-picked-clear:hover { background: #fee2e2; }

.acm-info {
  display: flex; align-items: flex-start; gap: 10px;
  background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 10px;
  padding: 11px 13px; font-size: 12px; color: #1e40af; line-height: 1.5;
}
.acm-info-icon { flex-shrink: 0; margin-top: 1px; }

.acm-pick-footer {
  display: flex; align-items: center; gap: 10px;
  padding: 14px 20px 18px;
  border-top: 1px solid #f0fdf4;
}
.acm-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 7px;
  height: 42px; padding: 0 18px;
  border-radius: 11px;
  font-family: inherit; font-size: 13px; font-weight: 700;
  cursor: pointer; transition: all .18s;
  border: 1.5px solid transparent;
}
.acm-btn-light {
  background: #fff; color: #1f2937; border-color: #e5e7eb;
}
.acm-btn-light:hover { background: #f9fafb; border-color: #d1d5db; }
.acm-btn-primary {
  flex: 1;
  background: linear-gradient(135deg, #10b981, #047857);
  color: #fff;
  box-shadow: 0 4px 14px rgba(5,150,105,.30);
}
.acm-btn-primary:hover { box-shadow: 0 6px 20px rgba(5,150,105,.45); transform: translateY(-1px); }
.acm-btn-disabled,
.acm-btn:disabled {
  opacity: .60; cursor: not-allowed; transform: none !important; box-shadow: none !important;
}

/* ─── Phase B — Wizard ─── */
.acm-wiz {
  width: 100%; max-width: 1280px;
  max-height: calc(100vh - 48px);
  background: #f0fdf4; border-radius: 16px; overflow: hidden;
  box-shadow: 0 30px 80px rgba(0,0,0,.40);
  display: flex; flex-direction: column;
}
.acm-wiz-header {
  position: relative;
  display: flex; align-items: center; gap: 14px;
  padding: 18px 56px 18px 22px;
  background: linear-gradient(110deg, #10b981 0%, #059669 50%, #047857 100%);
  color: #fff;
  flex-shrink: 0;
}
.acm-wiz-hicon {
  width: 36px; height: 36px; border-radius: 10px;
  background: rgba(255,255,255,.18); border: 1px solid rgba(255,255,255,.30);
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.acm-wiz-htitle { font-size: 18px; font-weight: 800; letter-spacing: -0.3px; }
.acm-wiz-hsub   { font-size: 11.5px; color: rgba(255,255,255,.85); margin-top: 2px; line-height: 1.4; max-width: 860px; }

.acm-wiz-body {
  flex: 1; min-height: 0; overflow-y: auto;
  padding: 16px 20px;
  display: flex; flex-direction: column; gap: 14px;
}

/* Linked customer summary */
.acm-linked {
  background: linear-gradient(110deg, #ecfdf5 0%, #d1fae5 50%, #a7f3d0 100%);
  border: 1px solid rgba(16,185,129,.40); border-radius: 12px;
  overflow: hidden;
}
.acm-linked-bar {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 14px;
}
.acm-linked-bar-left { display: flex; align-items: center; gap: 10px; }
.acm-linked-icon {
  width: 26px; height: 26px; border-radius: 7px;
  background: linear-gradient(135deg, #10b981, #047857);
  color: #fff; display: flex; align-items: center; justify-content: center;
}
.acm-linked-label { font-size: 10.5px; font-weight: 800; color: #047857; letter-spacing: 0.10em; }
.acm-linked-id {
  font-family: 'JetBrains Mono', monospace;
  font-size: 11.5px; font-weight: 800; color: #047857;
  background: #fff; border: 1px solid #a7f3d0; border-radius: 6px;
  padding: 2px 7px;
}
.acm-linked-name { font-size: 13px; font-weight: 700; color: #064e3b; }
.acm-linked-hide {
  display: inline-flex; align-items: center; gap: 5px;
  height: 28px; padding: 0 12px;
  background: #fff; border: 1px solid #a7f3d0; border-radius: 999px;
  font-size: 11px; font-weight: 600; color: #047857; cursor: pointer;
}
.acm-linked-grid {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 1px;
  background: rgba(16,185,129,.25);
  border-top: 1px solid rgba(16,185,129,.25);
}
.acm-linked-field {
  background: #fff;
  padding: 9px 12px;
}
.acm-linked-flabel { font-size: 9.5px; font-weight: 700; color: #047857; letter-spacing: 0.08em; }
.acm-linked-fvalue { font-size: 12px; font-weight: 700; color: #064e3b; margin-top: 2px; }
.acm-pill-blue {
  display: inline-block; padding: 1px 8px; border-radius: 999px;
  background: #ecfdf5; color: #047857; border: 1px solid #a7f3d0;
  font-size: 10.5px; font-weight: 700;
}

/* Step indicator */
.acm-steps {
  display: flex; align-items: center; gap: 6px;
  padding: 4px 0;
}
.acm-step {
  position: relative;
  flex: 1;
  display: flex; align-items: center; gap: 12px;
  padding: 12px 14px;
  background: #fff; border: 1.5px solid #e5e7eb; border-radius: 12px;
}
.acm-step-active {
  background: #ecfdf5;
  border-color: #10b981;
  box-shadow: 0 0 0 3px rgba(16,185,129,.18);
}
.acm-step-done {
  background: #ecfdf5;
  border-color: #a7f3d0;
}
.acm-step-badge {
  width: 36px; height: 36px; border-radius: 10px;
  display: flex; align-items: center; justify-content: center;
  background: #f3f4f6; color: #6b7280;
  font-size: 13px; font-weight: 800;
  flex-shrink: 0;
}
.acm-step-active .acm-step-badge {
  background: linear-gradient(135deg, #10b981, #047857); color: #fff;
}
.acm-step-done .acm-step-badge {
  background: linear-gradient(135deg, #10b981, #047857); color: #fff;
}
.acm-step-text { min-width: 0; flex: 1; }
.acm-step-title { font-size: 13px; font-weight: 700; color: #1f2937; }
.acm-step-active .acm-step-title { color: #064e3b; }
.acm-step-sub { font-size: 11px; color: #6b7280; margin-top: 2px; }
.acm-step-active .acm-step-sub { color: #047857; }
.acm-step-done-mark {
  position: absolute; right: 10px; bottom: 8px;
  width: 18px; height: 18px; border-radius: 50%;
  background: #10b981; color: #fff;
  display: flex; align-items: center; justify-content: center;
}
.acm-steps-arrow {
  flex-shrink: 0;
  width: 22px; height: 22px; border-radius: 50%;
  background: #fff; border: 1.5px solid #a7f3d0;
  display: flex; align-items: center; justify-content: center;
  color: #10b981;
}

/* Identification / vault tabs */
.acm-id-tabs {
  display: flex; align-items: center; gap: 10px;
  padding: 4px 0 2px;
}
.acm-id-tab {
  display: inline-flex; align-items: center; gap: 7px;
  height: 38px; padding: 0 16px;
  background: #fff; border: 1.5px solid #e5e7eb; border-radius: 999px;
  font-family: inherit; font-size: 12.5px; font-weight: 700; color: #1f2937;
  cursor: pointer; transition: all .18s;
}
.acm-id-tab.on {
  background: linear-gradient(135deg, #10b981, #047857);
  color: #fff;
  border-color: transparent;
  box-shadow: 0 3px 10px rgba(5,150,105,.30);
}

/* Section header */
.acm-sec-header {
  display: flex; align-items: center; gap: 10px;
  background: #fff;
  border: 1px solid #e5e7eb;
  border-top: 3px solid #10b981;
  border-radius: 12px 12px 0 0;
  padding: 9px 14px;
  margin-top: 4px;
}
.acm-sec-icon {
  width: 28px; height: 28px; border-radius: 8px;
  background: #10b981; color: #fff;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.acm-sec-title { font-size: 13px; font-weight: 800; color: #064e3b; display: inline; }
.acm-sec-sep   { color: #d1d5db; margin: 0 8px; font-weight: 400; }
.acm-sec-sub   { font-size: 11.5px; color: #6b7280; font-weight: 500; }

/* Forms */
.acm-sec-pad { background: #fff; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px; padding: 14px; }
.acm-grid-2  { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.acm-grid-3  { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.acm-grid-4  { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
.acm-mt-12   { margin-top: 12px; }
.acm-field   { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
.acm-field-label {
  font-size: 10.5px; font-weight: 800; color: #047857;
  letter-spacing: 0.08em;
}
.acm-input {
  height: 40px; padding: 0 12px;
  background: #fff;
  border: 1.5px solid #e5e7eb; border-radius: 9px;
  font-family: inherit; font-size: 13px; color: #1f2937;
  outline: none; transition: border-color .15s, box-shadow .15s;
}
.acm-input:focus {
  border-color: #10b981;
  box-shadow: 0 0 0 3px rgba(16,185,129,.18);
}
.acm-input::placeholder { color: #9ca3af; }
.acm-input:disabled { background: #f9fafb; color: #9ca3af; cursor: not-allowed; }
select.acm-input { appearance: none; background-image: linear-gradient(45deg, transparent 50%, #9ca3af 50%), linear-gradient(135deg, #9ca3af 50%, transparent 50%); background-position: calc(100% - 16px) 17px, calc(100% - 11px) 17px; background-size: 5px 5px; background-repeat: no-repeat; padding-right: 28px; }

.acm-radio-row { display: flex; align-items: center; gap: 16px; height: 40px; }
.acm-radio {
  display: inline-flex; align-items: center; gap: 7px;
  font-size: 13px; font-weight: 600; color: #1f2937; cursor: pointer;
}
.acm-radio input { display: none; }
.acm-radio span {
  width: 18px; height: 18px; border-radius: 50%;
  border: 1.5px solid #d1d5db;
  display: inline-block; position: relative; transition: all .15s;
}
.acm-radio input:checked + span {
  border-color: #10b981;
  background: radial-gradient(circle, #10b981 40%, transparent 45%);
}

/* Stage 3 — recap */
.acm-recap {
  background: #f0fdf4;
  border: 1px solid #a7f3d0; border-radius: 12px;
  overflow: hidden;
}
.acm-recap-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 11px 16px;
  background: linear-gradient(110deg, #047857, #059669);
  color: #fff;
}
.acm-recap-head-left  { display: flex; align-items: center; gap: 10px; }
.acm-recap-head-right { display: flex; align-items: center; gap: 8px; }
.acm-recap-check {
  width: 22px; height: 22px; border-radius: 50%;
  background: rgba(255,255,255,.20); border: 1px solid rgba(255,255,255,.30);
  display: flex; align-items: center; justify-content: center;
}
.acm-recap-title { font-size: 13px; font-weight: 700; }
.acm-recap-tag {
  display: inline-block; padding: 3px 10px; border-radius: 999px;
  background: rgba(255,255,255,.18); border: 1px solid rgba(255,255,255,.30);
  font-size: 11px; font-weight: 600;
}
.acm-recap-toggle {
  display: inline-flex; align-items: center; gap: 5px;
  height: 26px; padding: 0 10px;
  background: rgba(255,255,255,.18); border: 1px solid rgba(255,255,255,.30); border-radius: 999px;
  color: #fff; font-size: 11px; font-weight: 600; cursor: pointer;
}
.acm-recap-body  { padding: 14px; display: flex; flex-direction: column; gap: 14px; }
.acm-recap-stage { display: flex; flex-direction: column; gap: 10px; }
.acm-recap-stage-head { display: flex; align-items: center; gap: 8px; }
.acm-recap-stage-icon {
  width: 24px; height: 24px; border-radius: 7px;
  background: #10b981; color: #fff;
  display: flex; align-items: center; justify-content: center;
}
.acm-recap-stage-title { font-size: 13px; font-weight: 800; color: #064e3b; }
.acm-recap-done {
  display: inline-block; padding: 2px 9px; border-radius: 999px;
  background: #ecfdf5; color: #047857; border: 1px solid #a7f3d0;
  font-size: 11px; font-weight: 700;
}
.acm-recap-card {
  background: #fff; border: 1px solid #d1fae5; border-radius: 10px;
  padding: 12px 14px;
}
.acm-recap-sec-title {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 10.5px; font-weight: 800; color: #047857;
  letter-spacing: 0.08em; margin-bottom: 8px;
}
.acm-recap-grid {
  display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px;
}
.acm-recap-field { display: flex; flex-direction: column; gap: 2px; }
.acm-recap-flabel { font-size: 9.5px; font-weight: 700; color: #6b7280; letter-spacing: 0.08em; }
.acm-recap-fvalue { font-size: 12.5px; font-weight: 700; color: #064e3b; }
.acm-recap-pills { display: flex; gap: 8px; }
.acm-recap-pill {
  display: inline-block; padding: 3px 12px; border-radius: 999px;
  background: #ecfdf5; color: #047857; border: 1px solid #a7f3d0;
  font-size: 11.5px; font-weight: 700;
}

/* Stage 3 — vault */
.acm-vault-tabs { display: flex; gap: 16px; padding: 4px 0 0; border-bottom: 1px solid #e5e7eb; }
.acm-vault-tab {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 8px 4px; background: transparent; border: none;
  font-size: 12px; font-weight: 700; color: #6b7280;
  cursor: pointer; border-bottom: 2px solid transparent;
  transition: color .15s, border-color .15s;
}
.acm-vault-tab.on { color: #047857; border-bottom-color: #10b981; }
.acm-vault-table-wrap {
  background: #fff; border: 1px solid #d1fae5; border-radius: 10px;
  overflow: auto;
}
.acm-vault-table {
  width: 100%; border-collapse: collapse; min-width: 900px;
}
.acm-vault-table thead tr {
  background: linear-gradient(110deg, #047857, #059669);
}
.acm-vault-table thead th {
  padding: 10px; text-align: left; white-space: nowrap;
  font-size: 9.5px; font-weight: 800; color: rgba(255,255,255,.95);
  text-transform: uppercase; letter-spacing: 0.08em;
  text-shadow: 0 1px 2px rgba(0,0,0,.20);
}
.acm-vault-table tbody td {
  padding: 11px 10px; border-bottom: 1px solid #f0fdf4;
  font-size: 12px; color: #064e3b;
}
.acm-vault-table tbody tr:last-child td { border-bottom: none; }
.acm-vault-srno  { font-weight: 700; color: #047857; }
.acm-vault-code  {
  display: inline-block; padding: 2px 9px; border-radius: 6px;
  background: #ecfdf5; color: #047857; border: 1px solid #a7f3d0;
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px; font-weight: 800;
}
.acm-vault-name  { font-weight: 700; color: #064e3b; }
.acm-vault-auth  { color: #4b5563; }
.acm-vault-exp {
  display: inline-block; padding: 2px 10px; border-radius: 999px;
  background: #f3f4f6; color: #6b7280;
  font-size: 11px; font-weight: 700;
}
.acm-vault-exp.expired {
  background: #fef2f2; color: #b91c1c; border: 1px solid #fecaca;
}
.acm-vault-status {
  display: inline-block; padding: 2px 11px; border-radius: 999px;
  font-size: 11px; font-weight: 700;
}
.acm-vault-mand { background: #ecfdf5; color: #047857; border: 1px solid #a7f3d0; }
.acm-vault-opt  { background: #f3f4f6; color: #6b7280; border: 1px solid #e5e7eb; }
.acm-vault-attach {
  display: inline-flex; align-items: center; gap: 5px;
  color: #047857; font-size: 12px; font-weight: 600;
  text-decoration: none;
}
.acm-vault-attach:hover { color: #064e3b; }

.acm-trade-empty {
  background: #fff; border: 1px dashed #a7f3d0; border-radius: 12px;
  padding: 36px 20px; text-align: center;
  color: #10b981;
  display: flex; flex-direction: column; align-items: center; gap: 6px;
}
.acm-trade-empty-title { font-size: 14px; font-weight: 800; color: #047857; margin-top: 4px; }
.acm-trade-empty-sub   { font-size: 12px; color: #6b7280; max-width: 480px; line-height: 1.5; }

/* Footer */
.acm-wiz-footer {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 20px;
  background: #fff;
  border-top: 1px solid #e5e7eb;
  flex-shrink: 0;
}
.acm-footer-right { display: flex; align-items: center; gap: 10px; }

/* ─── Dark mode ─── */
[data-bs-theme="dark"] .acm-overlay { background: rgba(0,0,0,.65); }
[data-bs-theme="dark"] .acm-pick    { background: #103129; }
[data-bs-theme="dark"] .acm-pick-body  { background: #103129; }
[data-bs-theme="dark"] .acm-picker     { background: rgba(255,255,255,.04); border-color: rgba(16,185,129,.30); }
[data-bs-theme="dark"] .acm-picker input { color: #ecfdf5; }
[data-bs-theme="dark"] .acm-picker input::placeholder { color: #6b8a7e; }
[data-bs-theme="dark"] .acm-picker-list { background: #0f2a23; border-color: rgba(16,185,129,.30); }
[data-bs-theme="dark"] .acm-picker-option { border-bottom-color: rgba(16,185,129,.12); }
[data-bs-theme="dark"] .acm-picker-option:hover { background: rgba(16,185,129,.10); }
[data-bs-theme="dark"] .acm-pop-name   { color: #ecfdf5; }
[data-bs-theme="dark"] .acm-pop-meta,
[data-bs-theme="dark"] .acm-picker-empty { color: #94a3b8; }
[data-bs-theme="dark"] .acm-picked     { background: rgba(16,185,129,.12); border-color: #10b981; }
[data-bs-theme="dark"] .acm-picked-name { color: #ecfdf5; }
[data-bs-theme="dark"] .acm-picked-meta { color: #94a3b8; }
[data-bs-theme="dark"] .acm-info       { background: rgba(30,64,175,.20); border-color: rgba(96,165,250,.30); color: #93c5fd; }
[data-bs-theme="dark"] .acm-pick-footer { border-top-color: rgba(16,185,129,.20); background: #103129; }
[data-bs-theme="dark"] .acm-btn-light  { background: #1a3d34; color: #ecfdf5; border-color: rgba(16,185,129,.30); }
[data-bs-theme="dark"] .acm-btn-light:hover { background: #234d42; }

[data-bs-theme="dark"] .acm-wiz        { background: #0f2a23; }
[data-bs-theme="dark"] .acm-wiz-body   { background: #0a1f1a; }
[data-bs-theme="dark"] .acm-linked     { background: linear-gradient(110deg, #0f2a23, #103129, #134e3a); border-color: rgba(16,185,129,.30); }
[data-bs-theme="dark"] .acm-linked-label { color: #6ee7b7; }
[data-bs-theme="dark"] .acm-linked-id  { background: rgba(255,255,255,.06); border-color: rgba(16,185,129,.30); color: #6ee7b7; }
[data-bs-theme="dark"] .acm-linked-name { color: #ecfdf5; }
[data-bs-theme="dark"] .acm-linked-hide { background: rgba(255,255,255,.04); border-color: rgba(16,185,129,.30); color: #6ee7b7; }
[data-bs-theme="dark"] .acm-linked-grid { background: rgba(16,185,129,.15); border-top-color: rgba(16,185,129,.15); }
[data-bs-theme="dark"] .acm-linked-field { background: #103129; }
[data-bs-theme="dark"] .acm-linked-flabel { color: #6ee7b7; }
[data-bs-theme="dark"] .acm-linked-fvalue { color: #ecfdf5; }
[data-bs-theme="dark"] .acm-pill-blue  { background: rgba(16,185,129,.15); color: #6ee7b7; border-color: rgba(16,185,129,.30); }

[data-bs-theme="dark"] .acm-step       { background: #103129; border-color: rgba(16,185,129,.20); }
[data-bs-theme="dark"] .acm-step-active { background: rgba(16,185,129,.15); border-color: #10b981; }
[data-bs-theme="dark"] .acm-step-done  { background: rgba(16,185,129,.10); border-color: rgba(16,185,129,.30); }
[data-bs-theme="dark"] .acm-step-badge { background: #1a3d34; color: #94a3b8; }
[data-bs-theme="dark"] .acm-step-title { color: #ecfdf5; }
[data-bs-theme="dark"] .acm-step-sub   { color: #94a3b8; }
[data-bs-theme="dark"] .acm-step-active .acm-step-title { color: #ecfdf5; }
[data-bs-theme="dark"] .acm-step-active .acm-step-sub   { color: #6ee7b7; }
[data-bs-theme="dark"] .acm-steps-arrow { background: #103129; border-color: rgba(16,185,129,.30); color: #6ee7b7; }

[data-bs-theme="dark"] .acm-id-tab     { background: #103129; border-color: rgba(16,185,129,.20); color: #ecfdf5; }
[data-bs-theme="dark"] .acm-sec-header { background: #103129; border-color: rgba(16,185,129,.20); }
[data-bs-theme="dark"] .acm-sec-pad    { background: #103129; border-color: rgba(16,185,129,.20); }
[data-bs-theme="dark"] .acm-sec-title  { color: #ecfdf5; }
[data-bs-theme="dark"] .acm-sec-sub    { color: #94a3b8; }
[data-bs-theme="dark"] .acm-sec-sep    { color: rgba(16,185,129,.40); }
[data-bs-theme="dark"] .acm-field-label { color: #6ee7b7; }
[data-bs-theme="dark"] .acm-input      { background: #0a1f1a; border-color: rgba(16,185,129,.25); color: #ecfdf5; }
[data-bs-theme="dark"] .acm-input::placeholder { color: #6b8a7e; }
[data-bs-theme="dark"] .acm-input:disabled { background: #14241f; color: #6b8a7e; }
[data-bs-theme="dark"] .acm-radio span { border-color: rgba(255,255,255,.30); }

[data-bs-theme="dark"] .acm-recap      { background: rgba(16,185,129,.10); border-color: rgba(16,185,129,.25); }
[data-bs-theme="dark"] .acm-recap-card { background: #103129; border-color: rgba(16,185,129,.20); }
[data-bs-theme="dark"] .acm-recap-sec-title { color: #6ee7b7; }
[data-bs-theme="dark"] .acm-recap-stage-title { color: #ecfdf5; }
[data-bs-theme="dark"] .acm-recap-done { background: rgba(16,185,129,.15); border-color: rgba(16,185,129,.30); color: #6ee7b7; }
[data-bs-theme="dark"] .acm-recap-flabel { color: #94a3b8; }
[data-bs-theme="dark"] .acm-recap-fvalue { color: #ecfdf5; }
[data-bs-theme="dark"] .acm-recap-pill { background: rgba(16,185,129,.15); color: #6ee7b7; border-color: rgba(16,185,129,.30); }

[data-bs-theme="dark"] .acm-vault-tabs { border-bottom-color: rgba(16,185,129,.20); }
[data-bs-theme="dark"] .acm-vault-tab  { color: #94a3b8; }
[data-bs-theme="dark"] .acm-vault-tab.on { color: #6ee7b7; }
[data-bs-theme="dark"] .acm-vault-table-wrap { background: #103129; border-color: rgba(16,185,129,.20); }
[data-bs-theme="dark"] .acm-vault-table tbody td { border-bottom-color: rgba(16,185,129,.15); color: #ecfdf5; }
[data-bs-theme="dark"] .acm-vault-srno  { color: #6ee7b7; }
[data-bs-theme="dark"] .acm-vault-code  { background: rgba(16,185,129,.15); color: #6ee7b7; border-color: rgba(16,185,129,.30); }
[data-bs-theme="dark"] .acm-vault-name  { color: #ecfdf5; }
[data-bs-theme="dark"] .acm-vault-auth  { color: #94a3b8; }
[data-bs-theme="dark"] .acm-vault-exp   { background: rgba(255,255,255,.06); color: #94a3b8; }
[data-bs-theme="dark"] .acm-vault-exp.expired { background: rgba(239,68,68,.18); color: #fca5a5; border-color: rgba(239,68,68,.30); }
[data-bs-theme="dark"] .acm-vault-mand  { background: rgba(16,185,129,.15); color: #6ee7b7; border-color: rgba(16,185,129,.30); }
[data-bs-theme="dark"] .acm-vault-opt   { background: rgba(255,255,255,.06); color: #94a3b8; border-color: rgba(255,255,255,.10); }
[data-bs-theme="dark"] .acm-vault-attach { color: #6ee7b7; }

[data-bs-theme="dark"] .acm-trade-empty { background: rgba(255,255,255,.04); border-color: rgba(16,185,129,.30); }
[data-bs-theme="dark"] .acm-trade-empty-title { color: #ecfdf5; }
[data-bs-theme="dark"] .acm-trade-empty-sub   { color: #94a3b8; }
[data-bs-theme="dark"] .acm-wiz-footer  { background: #103129; border-top-color: rgba(16,185,129,.20); }
`;
