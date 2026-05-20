import { useEffect, useMemo, useRef, useState } from 'react';
import { useToast } from '../../contexts/ToastContext';
import api from '../../api';
import { MasterSelect, MasterDatePicker } from '../master/masterFormKit';
import Tooltip from '../../components/ui/Tooltip';
import DeleteConfirmModal from '../../components/ui/DeleteConfirmModal';

/* Each row in the Address & Contact Details table — mirrors the
 * shape used by AddCustomerModal so the JSX patterns line up. */
interface LocationRow {
  id: string;
  type: string; line: string; country: string; state: string; city: string; pin: string;
  cpName: string; cpDesignation: string; cpContact: string; cpEmail: string; cpWhatsapp: 'yes' | 'no' | '';
}
/* Stage 2 KYC rows. Company Due Diligence + Trade Licence share the
 * same shape (distinguished by `kind`). Owner KYC has its own. */
interface KycDocRow {
  id: string;
  kind: 'dd' | 'tl';
  name: string;
  license_number?: string;
  issuing_authority?: string;
  issue_date?: string;        // YYYY-MM-DD
  expiry_date?: string;       // YYYY-MM-DD
  attachment_name?: string;
  status: 'Active' | 'Inactive';
}
interface KycOwnerRow {
  id: string;
  owner_name: string;
  designation?: string;
  official_email?: string;
  phone_number?: string;
  id_proof_name?: string;
  address_proof_name?: string;
  photograph_name?: string;
  status: 'Active' | 'Inactive';
}
type KycSubTab = 'company-dd' | 'owner-kyc' | 'trade-licence';
type EvSubTab  = 'dd' | 'kyc' | 'tl';

/* Master value — must match the seeded address_types row exactly so
 * the dropdown selects it instead of inserting a synthetic fallback. */
const DEFAULT_ADDRESS_TYPE = 'Registered Office';
const newLocId = () => `loc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
const newKycId = (prefix: string) => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

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

/* Customer option shape consumed by the consignee picker. Fields
 * are sourced from the live /api/customers response (the one
 * populated by SalesCustomers' Add Customer flow), so creating a
 * customer there makes them selectable here. */
type CustomerOption = {
  id: string;        // C-001 (display code from server)
  db_id?: number;    // numeric PK — needed if/when the consignee POST stores customer_id
  initials: string;  // SE
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

/* Derive two-letter initials from a company name — used by the
 * picker's avatar tile when the API response doesn't carry one. */
const initialsOf = (name: string): string => {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '—';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

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
type IdentityTab = 'identification' | 'address-contact';
type VaultTab = 'kyc' | 'trade';

export default function AddConsigneeModal({ open, consignee, onClose }: Props) {
  const toast = useToast();

  const [phase, setPhase]   = useState<Phase>('pick-customer');
  const [stage, setStage]   = useState<Stage>(1);
  const [customer, setCustomer] = useState<CustomerOption | null>(null);
  const [search, setSearch]     = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [linkedHidden, setLinkedHidden] = useState(false);
  /* Live customer list pulled from /api/customers when the modal
   * opens. This is the same endpoint SalesCustomers populates via
   * its Add Customer flow, so a freshly-created customer shows up
   * here without a refresh on the consignee side. */
  const [customerOptions, setCustomerOptions] = useState<CustomerOption[]>([]);
  const [customersLoading, setCustomersLoading] = useState(false);

  /* Master-data backed dropdowns. Pulled in parallel on modal open.
   * Each list is normalized to { value, label } for MasterSelect.
   * Segments use `title`; the rest use `name`. */
  type Opt = { value: string; label: string };
  type StateOpt = Opt & { countryId: number };
  const [mSegments,        setMSegments]        = useState<Opt[]>([]);
  const [mClassifications, setMClassifications] = useState<Opt[]>([]);
  const [mRiskLevels,      setMRiskLevels]      = useState<Opt[]>([]);
  const [mAddressTypes,    setMAddressTypes]    = useState<Opt[]>([]);
  const [mCountries,       setMCountries]       = useState<(Opt & { id: number })[]>([]);
  const [mStates,          setMStates]          = useState<StateOpt[]>([]);
  const [mDesignations,    setMDesignations]    = useState<Opt[]>([]);

  // Stage 1 — Consignee Legal Identity
  const [idTab, setIdTab]         = useState<IdentityTab>('identification');
  /* Inline validation errors for Stage 1 fields. Keyed by form1 field
   * name. Each `goNext` from Stage 1 runs validateStage1() and refuses
   * to advance if any required field is empty/invalid; the error map
   * drives the red border + helper text under each affected Field. */
  const [errors1, setErrors1] = useState<Record<string, string>>({});
  const [form1, setForm1] = useState({
    /* Basic company */
    companyName: '', legalName: '', website: '', segment: '', classification: '', risk: '',
    /* Primary address (registered office) */
    addressType: 'Registered Office', address: '', country: '', state: '', city: '', pin: '',
    /* Primary contact at the registered office */
    contactName: '', designation: '', contactNo: '', email: '', whatsapp: 'Yes',
  });

  /* Address & Contact table — each row carries an address plus the
   * contact person who is authoritative at that location. Mirrors
   * AddCustomerModal so the JSX stays uniform. */
  const [locations, setLocations] = useState<LocationRow[]>([]);
  const [locModal, setLocModal]   = useState<{ open: boolean; editing: string | null }>({ open: false, editing: null });
  const [delModal, setDelModal]   = useState<{ open: boolean; id: string | null }>({ open: false, id: null });

  /* Stage 2 — KYC / Due Diligence
   * Table-driven now (matches AddCustomerModal): docs covers both
   * Company DD and Trade Licence (filtered by `kind`); owners are
   * separate. All state is in-memory until the backend lands. */
  const [kycSub, setKycSub]       = useState<KycSubTab>('company-dd');
  const [kycSearch, setKycSearch] = useState('');
  const [kycDocs, setKycDocs]     = useState<KycDocRow[]>([]);
  const [kycOwners, setKycOwners] = useState<KycOwnerRow[]>([]);
  const [docModal, setDocModal]   = useState<{ open: boolean; sub: KycSubTab; editingId: string | null }>({ open: false, sub: 'company-dd', editingId: null });
  const [ownerModal, setOwnerModal] = useState<{ open: boolean; editingId: string | null }>({ open: false, editingId: null });
  const [kycDelModal, setKycDelModal] = useState<{ open: boolean; kind: 'doc' | 'owner' | null; id: string | null; label?: string }>({ open: false, kind: null, id: null });

  /* Stage 3 — Evidence Vault. Outer tab = KYC vs Trade. Inner sub-tab
   * (when on KYC) = which KYC kind to view. */
  const [vaultTab, setVaultTab] = useState<VaultTab>('kyc');
  const [evSub, setEvSub]       = useState<EvSubTab>('dd');

  // Reset everything when modal opens fresh.
  useEffect(() => {
    if (!open) return;
    if (consignee) {
      // Edit mode — skip the customer picker. The matching customer
      // is populated by the fetch effect below once it lands; until
      // then we keep `customer` null but jump straight to the wizard.
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
    setErrors1({});
    setVaultTab('kyc');
    setEvSub('dd');
    setLocations([]);
    setLocModal({ open: false, editing: null });
    setDelModal({ open: false, id: null });
    setKycSub('company-dd');
    setKycSearch('');
    setKycDocs([]);
    setKycOwners([]);
    setDocModal({ open: false, sub: 'company-dd', editingId: null });
    setOwnerModal({ open: false, editingId: null });
    setKycDelModal({ open: false, kind: null, id: null });
  }, [open, consignee]);

  /* Fetch the live customer list when the modal opens. Maps the API
   * response (the same shape SalesCustomers consumes) into the
   * picker's CustomerOption type. On edit mode the matching row is
   * also resolved here so the linked-customer card prefills. */
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setCustomersLoading(true);
    api.get('/customers')
      .then(r => {
        if (cancelled) return;
        const rows: any[] = Array.isArray(r.data?.data) ? r.data.data : [];
        const opts: CustomerOption[] = rows.map(c => ({
          id:            String(c.id ?? ''),
          db_id:         typeof c.db_id === 'number' ? c.db_id : undefined,
          initials:      initialsOf(c.company || ''),
          name:          c.company    ?? '',
          legalName:     c.legalName  ?? c.company ?? '',
          segment:       c.segment    ?? '',
          type:          c.type       ?? '',
          classification:c.classification ?? '',
          country:       c.country    ?? '',
          state:         c.state      ?? '',
          city:          c.city       ?? '',
          pin:           c.pin        ?? '',
          contactPerson: c.contact    ?? '',
          phone:         c.phone      ?? '',
          email:         c.email      ?? '',
          whatsapp:      c.whatsapp === 'Yes' ? 'Yes' : 'No',
        }));
        setCustomerOptions(opts);
        // Resolve the linked customer for edit mode now that we have the list.
        if (consignee) {
          const found = opts.find(o => o.id === consignee.customerId) || null;
          setCustomer(found);
        }
      })
      .catch(() => { if (!cancelled) setCustomerOptions([]); })
      .finally(() => { if (!cancelled) setCustomersLoading(false); });
    return () => { cancelled = true; };
  }, [open, consignee]);

  /* Fetch the masters that back this modal's dropdowns. Same endpoint
   * pattern AddCustomerModal uses — segments, customer_classifications,
   * risk_levels, address_types, countries, states, designations. Each
   * call is independent so one failing master doesn't break the rest. */
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const pickName = (rows: any[], key = 'name'): Opt[] => (rows ?? [])
      .filter(r => !r.status || String(r.status).toLowerCase() === 'active')
      .map(r => ({ value: String(r[key] ?? ''), label: String(r[key] ?? '') }))
      .filter(o => o.value);
    const pickCountries = (rows: any[]): (Opt & { id: number })[] => (rows ?? [])
      .filter(r => !r.status || String(r.status).toLowerCase() === 'active')
      .map(r => ({ id: Number(r.id), value: String(r.name ?? ''), label: String(r.name ?? '') }))
      .filter(o => o.value);
    const pickStates = (rows: any[]): StateOpt[] => (rows ?? [])
      .filter(r => !r.status || String(r.status).toLowerCase() === 'active')
      .map(r => ({ countryId: Number(r.country_id), value: String(r.name ?? ''), label: String(r.name ?? '') }))
      .filter(o => o.value);

    Promise.allSettled([
      api.get('/master/segments').then(r => { if (!cancelled) setMSegments(pickName(r.data ?? [], 'title')); }),
      api.get('/master/customer_classifications').then(r => { if (!cancelled) setMClassifications(pickName(r.data ?? [])); }),
      api.get('/master/risk_levels').then(r => { if (!cancelled) setMRiskLevels(pickName(r.data ?? [])); }),
      api.get('/master/address_types').then(r => { if (!cancelled) setMAddressTypes(pickName(r.data ?? [])); }),
      api.get('/master/countries').then(r => {
        if (cancelled) return;
        const sorted = [...(r.data ?? [])].sort((a: any, b: any) => String(a.name).localeCompare(String(b.name)));
        setMCountries(pickCountries(sorted));
      }),
      api.get('/master/states').then(r => { if (!cancelled) setMStates(pickStates(r.data ?? [])); }),
      api.get('/master/designations').then(r => { if (!cancelled) setMDesignations(pickName(r.data ?? [])); }),
    ]);
    return () => { cancelled = true; };
  }, [open]);

  // useMemo MUST come before any conditional return — React enforces a
  // stable hook order across renders. Putting `if (!open) return null;`
  // before this trips "change in the order of Hooks called by
  // AddConsigneeModal" the first time the modal opens.
  const filteredCustomers = useMemo(() => {
    if (!search) return customerOptions;
    const lo = search.toLowerCase();
    return customerOptions.filter(c =>
      c.name.toLowerCase().includes(lo) ||
      c.id.toLowerCase().includes(lo) ||
      c.segment.toLowerCase().includes(lo) ||
      c.legalName.toLowerCase().includes(lo) ||
      (c.country || '').toLowerCase().includes(lo),
    );
  }, [search, customerOptions]);

  if (!open) return null;

  const confirmCustomer = () => {
    if (!customer) {
      toast.warning('Pick a customer', 'Select the customer this consignee will be linked to.');
      return;
    }
    setPhase('wizard');
    setStage(1);
  };

  /* Validate every required Stage 1 field. Returns the error map (empty
   * when valid). The map keys match form1 field names so we can wire
   * inline error display via the Field's `error` prop in Stage1. */
  const validateStage1 = (): Record<string, string> => {
    const e: Record<string, string> = {};
    const f = form1;
    if (!f.companyName.trim())                                e.companyName = 'Company name is required';
    if (!f.legalName.trim())                                  e.legalName   = 'Company legal name is required';
    if (!f.segment)                                           e.segment     = 'Select a segment';
    if (!f.risk)                                              e.risk        = 'Select a risk level';
    if (!f.addressType)                                       e.addressType = 'Select address type';
    if (!f.address.trim())                                    e.address     = 'Address is required';
    if (!f.country)                                           e.country     = 'Select country';
    if (!f.state)                                             e.state       = 'Select state';
    if (!f.city.trim())                                       e.city        = 'City is required';
    if (!f.pin.trim())                                        e.pin         = 'PIN is required';
    else if (!/^[A-Za-z0-9\-\s]{3,12}$/.test(f.pin))          e.pin         = 'PIN looks invalid';
    if (!f.contactName.trim())                                e.contactName = 'Contact name is required';
    if (!f.designation.trim())                                e.designation = 'Designation is required';
    if (!f.contactNo.trim())                                  e.contactNo   = 'Contact number is required';
    else if (!/^\+?[0-9\s-]{7,15}$/.test(f.contactNo))        e.contactNo   = 'Phone must be 7-15 digits';
    if (!f.email.trim())                                      e.email       = 'Email is required';
    else if (!/^\S+@\S+\.\S+$/.test(f.email))                 e.email       = 'Enter a valid email';
    if (!f.whatsapp)                                          e.whatsapp    = 'Select WhatsApp preference';
    return e;
  };

  const goNext = () => {
    if (stage === 1) {
      const e = validateStage1();
      setErrors1(e);
      if (Object.keys(e).length > 0) {
        /* Surface the first error in a toast and bounce focus to the
         * identification tab if any field there is missing — the
         * Primary Address & Contact sections live alongside it on the
         * same tab so a single focus shift is enough. */
        const firstKey = Object.keys(e)[0];
        toast.error('Please complete required fields', e[firstKey]);
        setIdTab('identification');
        return;
      }
    }
    setStage(s => (s < 3 ? (s + 1) as Stage : s));
  };
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
                {customersLoading && customerOptions.length === 0 && (
                  <div className="acm-picker-empty">Loading customers…</div>
                )}
                {!customersLoading && customerOptions.length === 0 && (
                  <div className="acm-picker-empty">No customers found. Add one from Sales Matrix → Customers first.</div>
                )}
                {!customersLoading && customerOptions.length > 0 && filteredCustomers.length === 0 && (
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
  /* Blur the parent wizard whenever a sub-modal is open on top of it
   * (Add/Edit Location, or the Delete confirm). Pure visual cue —
   * pointer events also turn off so stray clicks don't reach the
   * fields behind the popup. */
  const subOpen = locModal.open || delModal.open || docModal.open || ownerModal.open || kycDelModal.open;
  return (
    <>
    <div className="acm-overlay" onMouseDown={onClose}>
      <style>{SCOPED_CSS}</style>
      <div className={`acm-wiz ${subOpen ? 'acm-wiz-blurred' : ''}`} onMouseDown={e => e.stopPropagation()}>
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
              errors={errors1}
              clearErr={(k) => setErrors1(prev => { if (!prev[k]) return prev; const n = { ...prev }; delete n[k]; return n; })}
              locations={locations}
              onAddLocation={() => setLocModal({ open: true, editing: null })}
              onEditLocation={(id) => setLocModal({ open: true, editing: id })}
              onDeleteLocation={(id) => setDelModal({ open: true, id })}
              masters={{
                segments: mSegments,
                classifications: mClassifications,
                riskLevels: mRiskLevels,
                addressTypes: mAddressTypes,
                countries: mCountries,
                states: mStates,
                designations: mDesignations,
              }}
            />
          )}
          {stage === 2 && (
            <Stage2
              sub={kycSub}
              setSub={(s) => { setKycSub(s); setKycSearch(''); }}
              search={kycSearch}
              setSearch={setKycSearch}
              docs={kycDocs}
              owners={kycOwners}
              onAddDoc={(s) => setDocModal({ open: true, sub: s, editingId: null })}
              onEditDoc={(id) => {
                const row = kycDocs.find(d => d.id === id);
                if (!row) return;
                setDocModal({ open: true, sub: row.kind === 'dd' ? 'company-dd' : 'trade-licence', editingId: id });
              }}
              onDeleteDoc={(id) => {
                const row = kycDocs.find(d => d.id === id);
                setKycDelModal({ open: true, kind: 'doc', id, label: row?.name });
              }}
              onAddOwner={() => setOwnerModal({ open: true, editingId: null })}
              onEditOwner={(id) => setOwnerModal({ open: true, editingId: id })}
              onDeleteOwner={(id) => {
                const row = kycOwners.find(o => o.id === id);
                setKycDelModal({ open: true, kind: 'owner', id, label: row?.owner_name });
              }}
            />
          )}
          {stage === 3 && (
            <Stage3
              vaultTab={vaultTab}
              setVaultTab={setVaultTab}
              evSub={evSub}
              setEvSub={setEvSub}
              form1={form1}
              kycDocs={kycDocs}
              kycOwners={kycOwners}
              locations={locations}
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

    {locModal.open && (
      <LocationSubModal
        editing={locModal.editing ? locations.find(l => l.id === locModal.editing) ?? null : null}
        masters={{
          addressTypes: mAddressTypes,
          countries: mCountries,
          states: mStates,
          designations: mDesignations,
        }}
        onClose={() => setLocModal({ open: false, editing: null })}
        onSave={(rec) => {
          if (locModal.editing) {
            setLocations(prev => prev.map(l => l.id === locModal.editing ? { ...rec, id: l.id } : l));
          } else {
            setLocations(prev => [...prev, { ...rec, id: newLocId() }]);
          }
          setLocModal({ open: false, editing: null });
        }}
      />
    )}

    <DeleteConfirmModal
      open={delModal.open}
      title="Delete Address & Contact"
      itemName={delModal.id ? (locations.find(l => l.id === delModal.id)?.type || 'this location') : undefined}
      subMessage="This will remove the address and its contact person from this consignee. The action cannot be undone."
      onClose={() => setDelModal({ open: false, id: null })}
      onConfirm={() => {
        if (delModal.id) setLocations(prev => prev.filter(l => l.id !== delModal.id));
        setDelModal({ open: false, id: null });
      }}
    />

    {docModal.open && (
      <KycDocSubModal
        sub={docModal.sub}
        editing={docModal.editingId ? kycDocs.find(d => d.id === docModal.editingId) ?? null : null}
        onClose={() => setDocModal({ open: false, sub: 'company-dd', editingId: null })}
        onSave={(rec) => {
          const kind: 'dd' | 'tl' = docModal.sub === 'company-dd' ? 'dd' : 'tl';
          if (docModal.editingId) {
            setKycDocs(prev => prev.map(d => d.id === docModal.editingId ? { ...d, ...rec, id: d.id, kind } : d));
          } else {
            setKycDocs(prev => [...prev, { ...rec, kind, id: newKycId(kind) }]);
          }
          setDocModal({ open: false, sub: 'company-dd', editingId: null });
        }}
      />
    )}

    {ownerModal.open && (
      <KycOwnerSubModal
        editing={ownerModal.editingId ? kycOwners.find(o => o.id === ownerModal.editingId) ?? null : null}
        onClose={() => setOwnerModal({ open: false, editingId: null })}
        onSave={(rec) => {
          if (ownerModal.editingId) {
            setKycOwners(prev => prev.map(o => o.id === ownerModal.editingId ? { ...o, ...rec, id: o.id } : o));
          } else {
            setKycOwners(prev => [...prev, { ...rec, id: newKycId('own') }]);
          }
          setOwnerModal({ open: false, editingId: null });
        }}
      />
    )}

    <DeleteConfirmModal
      open={kycDelModal.open}
      title={kycDelModal.kind === 'owner' ? 'Delete Owner' : 'Delete KYC Document'}
      itemName={kycDelModal.label}
      subMessage={kycDelModal.kind === 'owner'
        ? 'This will remove the owner KYC record from this consignee. The action cannot be undone.'
        : 'This will remove the document from this consignee. The action cannot be undone.'}
      onClose={() => setKycDelModal({ open: false, kind: null, id: null })}
      onConfirm={() => {
        if (kycDelModal.id) {
          if (kycDelModal.kind === 'owner') {
            setKycOwners(prev => prev.filter(o => o.id !== kycDelModal.id));
          } else if (kycDelModal.kind === 'doc') {
            setKycDocs(prev => prev.filter(d => d.id !== kycDelModal.id));
          }
        }
        setKycDelModal({ open: false, kind: null, id: null });
      }}
    />
    </>
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

const Field = ({ label, required, error, children }: { label: string; required?: boolean; error?: string; children: React.ReactNode }) => (
  <div className="acm-field">
    <label className="acm-field-label">
      {label.toUpperCase()} {required && <span className="acm-req">*</span>}
    </label>
    {children}
    {error && <span className="acm-err-text">{error}</span>}
  </div>
);

/* ─── Stage 1 — Consignee Legal Identity ─── */
type Stage1Masters = {
  segments:        { value: string; label: string }[];
  classifications: { value: string; label: string }[];
  riskLevels:      { value: string; label: string }[];
  addressTypes:    { value: string; label: string }[];
  countries:       { value: string; label: string; id: number }[];
  states:          { value: string; label: string; countryId: number }[];
  designations:    { value: string; label: string }[];
};

/* Append the current value as a fallback option when it isn't in the
 * fetched list yet — keeps already-saved values visible during edit. */
const optsWith = (
  opts: { value: string; label: string }[],
  current?: string,
): { value: string; label: string }[] => {
  if (!current) return opts;
  return opts.some(o => o.value === current)
    ? opts
    : [...opts, { value: current, label: current }];
};

const Stage1 = ({
  tab, setTab, form, setForm, masters, errors, clearErr,
  locations, onAddLocation, onEditLocation, onDeleteLocation,
}: {
  tab: IdentityTab;
  setTab: (t: IdentityTab) => void;
  form: any;
  setForm: (next: any) => void;
  masters: Stage1Masters;
  errors: Record<string, string>;
  clearErr: (k: string) => void;
  locations: LocationRow[];
  onAddLocation: () => void;
  onEditLocation: (id: string) => void;
  onDeleteLocation: (id: string) => void;
}) => {
  const set = (k: string, v: any) => { setForm({ ...form, [k]: v }); clearErr(k); };
  const selectedCountry = masters.countries.find(c => c.value === form.country);
  const filteredStates = selectedCountry
    ? masters.states.filter(s => s.countryId === selectedCountry.id)
    : [];
  return (
    <>
      <div className="acm-id-tabs">
        <button className={`acm-id-tab ${tab === 'identification' ? 'on' : ''}`} onClick={() => setTab('identification')}>
          <IconTruck size={14} /> Consignee Identification Details
        </button>
        <button className={`acm-id-tab ${tab === 'address-contact' ? 'on' : ''}`} onClick={() => setTab('address-contact')}>
          <IconPin /> Address &amp; Contact Details
        </button>
      </div>

      {tab === 'identification' && (
        <>
          <SectionHeader icon={<IconHome />} title="Basic Company Details"     sub="Company identity, segment, and risk classification" accent="#10b981" />
          <div className="acm-grid-2 acm-sec-pad">
            <Field label="Company Name" required error={errors.companyName}>
              <input className={`acm-input ${errors.companyName ? 'acm-input-error' : ''}`} placeholder="Enter company name" value={form.companyName} onChange={e => set('companyName', e.target.value)} />
            </Field>
            <Field label="Company Legal Name" required error={errors.legalName}>
              <input className={`acm-input ${errors.legalName ? 'acm-input-error' : ''}`} placeholder="Enter legal name" value={form.legalName} onChange={e => set('legalName', e.target.value)} />
            </Field>
            <Field label="Company Website">
              <input className="acm-input" placeholder="https://example.com" value={form.website} onChange={e => set('website', e.target.value)} />
            </Field>
            <Field label="Consignee Segment" required error={errors.segment}>
              <MasterSelect
                value={form.segment}
                options={optsWith(masters.segments, form.segment)}
                placeholder="Select Segment"
                invalid={!!errors.segment}
                onChange={v => set('segment', v)}
              />
            </Field>
            <Field label="Classification &amp; Flags">
              <MasterSelect
                value={form.classification}
                options={optsWith(masters.classifications, form.classification)}
                placeholder="Select Classification"
                onChange={v => set('classification', v)}
              />
            </Field>
            <Field label="Risk Level" required error={errors.risk}>
              <MasterSelect
                value={form.risk}
                options={optsWith(masters.riskLevels, form.risk)}
                placeholder="Select Risk Level"
                invalid={!!errors.risk}
                onChange={v => set('risk', v)}
              />
            </Field>
          </div>

          <SectionHeader icon={<IconPin />} title="Primary Address &amp; Contact Person" sub="Registered office and primary contact at this location" accent="#3b82f6" />
          <div className="acm-sec-pad">
            <div className="acm-grid-2">
              <Field label="Address Type" required error={errors.addressType}>
                <MasterSelect
                  value={form.addressType}
                  options={optsWith(masters.addressTypes, form.addressType)}
                  placeholder="Select Address Type"
                  invalid={!!errors.addressType}
                  onChange={v => set('addressType', v)}
                />
              </Field>
              <Field label="Address" required error={errors.address}>
                <input className={`acm-input ${errors.address ? 'acm-input-error' : ''}`} placeholder="Street, building, area" value={form.address} onChange={e => set('address', e.target.value)} />
              </Field>
            </div>
            <div className="acm-grid-4 acm-mt-12">
              <Field label="Country" required error={errors.country}>
                <MasterSelect
                  value={form.country}
                  options={optsWith(masters.countries, form.country)}
                  placeholder="Select Country"
                  invalid={!!errors.country}
                  onChange={v => { setForm({ ...form, country: v, state: '' }); clearErr('country'); }}
                />
              </Field>
              <Field label="State" required error={errors.state}>
                <MasterSelect
                  value={form.state}
                  options={optsWith(filteredStates, form.state)}
                  placeholder={form.country ? 'Select State' : 'Select country first'}
                  disabled={!form.country}
                  invalid={!!errors.state}
                  onChange={v => set('state', v)}
                />
              </Field>
              <Field label="City" required error={errors.city}>
                <input className={`acm-input ${errors.city ? 'acm-input-error' : ''}`} placeholder="City name" value={form.city} onChange={e => set('city', e.target.value)} />
              </Field>
              <Field label="Pin / Postal Code" required error={errors.pin}>
                <input className={`acm-input ${errors.pin ? 'acm-input-error' : ''}`} placeholder="6-digit PIN" maxLength={12} value={form.pin} onChange={e => set('pin', e.target.value)} />
              </Field>
            </div>
            <div className="acm-grid-4 acm-mt-12">
              <Field label="Contact Person Name" required error={errors.contactName}>
                <input className={`acm-input ${errors.contactName ? 'acm-input-error' : ''}`} placeholder="Full name" value={form.contactName} onChange={e => set('contactName', e.target.value)} />
              </Field>
              <Field label="Designation" required error={errors.designation}>
                <MasterSelect
                  value={form.designation}
                  options={optsWith(masters.designations, form.designation)}
                  placeholder="Select Designation"
                  invalid={!!errors.designation}
                  onChange={v => set('designation', v)}
                />
              </Field>
              <Field label="Contact No" required error={errors.contactNo}>
                <input className={`acm-input ${errors.contactNo ? 'acm-input-error' : ''}`} type="tel" placeholder="7-15 digit number" value={form.contactNo} onChange={e => set('contactNo', e.target.value)} />
              </Field>
              <Field label="Email" required error={errors.email}>
                <input className={`acm-input ${errors.email ? 'acm-input-error' : ''}`} type="email" placeholder="name@company.com" value={form.email} onChange={e => set('email', e.target.value)} />
              </Field>
            </div>
            <div className="acm-mt-12">
              <Field label="Whatsapp Enabled?" required error={errors.whatsapp}>
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

      {tab === 'address-contact' && (
        <LocationsTable
          locations={locations}
          onAdd={onAddLocation}
          onEdit={onEditLocation}
          onDel={onDeleteLocation}
        />
      )}
    </>
  );
};

/* ─── Stage 1 — Address & Contact table ─── */
const LocationsTable = ({ locations, onAdd, onEdit, onDel }: {
  locations: LocationRow[];
  onAdd: () => void;
  onEdit: (id: string) => void;
  onDel: (id: string) => void;
}) => (
  <div className="acm-loc-card">
    <div className="acm-loc-head">
      <div className="acm-loc-head-row">
        <div className="acm-loc-head-icon"><IconPin /></div>
        <div className="acm-loc-head-text">
          <span className="acm-loc-head-title">ADDRESS &amp; CONTACT DETAILS</span>
          <span className="acm-loc-head-sub">| All addresses with their authorized contact person</span>
        </div>
        <button type="button" className="acm-add-pill" onClick={onAdd}>
          <IconPlus /> Add More Address &amp; Contact
        </button>
      </div>
    </div>
    <div className="acm-loc-body">
      <div className="acm-loc-table-wrap">
        <table className="acm-loc-table">
          <thead>
            <tr>
              <th>SR NO</th><th>ADDRESS TYPE</th><th>ADDRESS</th><th>CITY / STATE / COUNTRY</th>
              <th>CONTACT PERSON</th><th>PHONE</th><th>EMAIL</th><th>WHATSAPP</th><th>ACTIONS</th>
            </tr>
          </thead>
          <tbody>
            {locations.length === 0 ? (
              <tr className="acm-loc-empty">
                <td colSpan={9}>
                  No additional locations yet. Click <strong>+ Add More Address &amp; Contact</strong> to capture a
                  warehouse, billing, or shipping address with its contact person.
                </td>
              </tr>
            ) : locations.map((l, i) => {
              const place = [l.city, l.state, l.country].filter(Boolean).join(' • ');
              return (
                <tr key={l.id}>
                  <td>{i + 1}</td>
                  <td>{l.type}</td>
                  <td title={l.line}>{l.line.length > 36 ? l.line.slice(0, 33) + '…' : l.line}</td>
                  <td>{place}</td>
                  <td>{l.cpName}{l.cpDesignation ? <span style={{ color: '#6b7280', fontWeight: 500 }}> ({l.cpDesignation})</span> : null}</td>
                  <td>{l.cpContact}</td>
                  <td>{l.cpEmail}</td>
                  <td>{l.cpWhatsapp === 'yes' ? <span className="acm-pill-yes">✓ Yes</span> : <span className="acm-pill-no">✕ No</span>}</td>
                  <td>
                    <div className="acm-loc-actions">
                      <Tooltip label="Edit">
                        <button type="button" className="acm-loc-btn" aria-label="Edit" onClick={() => onEdit(l.id)}>
                          <IconPencil />
                        </button>
                      </Tooltip>
                      <Tooltip label="Delete">
                        <button type="button" className="acm-loc-btn acm-loc-btn-del" aria-label="Delete" onClick={() => onDel(l.id)}>
                          <IconTrash />
                        </button>
                      </Tooltip>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  </div>
);

/* ─── Stage 2 — KYC / Due Diligence ─── */
/* ─── Stage 2 — KYC / Due Diligence (table-driven) ─── */
const KYC_SUB_META: Record<KycSubTab, { title: string; sub: string; nameCol: string; placeholder: string; addLabel: string }> = {
  'company-dd':   { title: 'COMPANY DUE DILIGENCE', sub: '| Licenses, statutory documents, and compliance proofs', nameCol: 'DD Document Name',  placeholder: 'Search DD document name…',    addLabel: 'Add Document / License' },
  'owner-kyc':    { title: 'OWNER KYC DETAILS',     sub: '| Owner identity proofs, address proofs, and photographs', nameCol: 'KYC Document Name', placeholder: 'Search owner name…',          addLabel: 'Add Owner KYC' },
  'trade-licence':{ title: 'TRADE LICENCE',         sub: '| Trade licence documents and regulatory approvals',     nameCol: 'Document Name',       placeholder: 'Search trade licence…',       addLabel: 'Add Trade Licence' },
};

const Stage2 = ({
  sub, setSub, search, setSearch, docs, owners,
  onAddDoc, onEditDoc, onDeleteDoc, onAddOwner, onEditOwner, onDeleteOwner,
}: {
  sub: KycSubTab;
  setSub: (s: KycSubTab) => void;
  search: string;
  setSearch: (s: string) => void;
  docs: KycDocRow[];
  owners: KycOwnerRow[];
  onAddDoc: (s: KycSubTab) => void;
  onEditDoc: (id: string) => void;
  onDeleteDoc: (id: string) => void;
  onAddOwner: () => void;
  onEditOwner: (id: string) => void;
  onDeleteOwner: (id: string) => void;
}) => {
  const meta = KYC_SUB_META[sub];
  const isOwners = sub === 'owner-kyc';
  const kind: 'dd' | 'tl' = sub === 'company-dd' ? 'dd' : 'tl';
  const q = search.toLowerCase().trim();
  const filteredDocs = (docs || []).filter(d => d.kind === kind).filter(d => {
    if (!q) return true;
    return (d.name || '').toLowerCase().includes(q)
        || (d.license_number || '').toLowerCase().includes(q)
        || (d.issuing_authority || '').toLowerCase().includes(q);
  });
  const filteredOwners = (owners || []).filter(o => {
    if (!q) return true;
    return (o.owner_name || '').toLowerCase().includes(q)
        || (o.designation || '').toLowerCase().includes(q)
        || (o.official_email || '').toLowerCase().includes(q);
  });
  const totalRows = isOwners ? filteredOwners.length : filteredDocs.length;
  const codeFor = (k: string, sr: number) => `${k.toUpperCase()}-${String(sr).padStart(3, '0')}`;
  const fmtMy = (s?: string) => {
    if (!s) return 'N/A';
    const [y, m] = s.split('-');
    return m && y ? `${m}/${y}` : s;
  };

  return (
    <>
      <div className="acm-kyc-subtabs">
        {(['company-dd', 'owner-kyc', 'trade-licence'] as KycSubTab[]).map(s => (
          <button
            key={s}
            type="button"
            className={`acm-kyc-subtab ${sub === s ? 'on' : ''}`}
            onClick={() => setSub(s)}
          >
            {s === 'company-dd' ? <IconHome size={12} /> : s === 'owner-kyc' ? <IconUser /> : <IconDoc />}
            {s === 'company-dd' ? 'Company Due Diligence' : s === 'owner-kyc' ? 'Owner KYC' : 'Trade Licence'}
          </button>
        ))}
      </div>

      <div className="acm-kyc-card">
        <div className="acm-kyc-head">
          <div className="acm-kyc-head-row">
            <div className="acm-kyc-head-icon"><IconDoc /></div>
            <div className="acm-kyc-head-text">
              <span className="acm-kyc-head-title">{meta.title}</span>
              <span className="acm-kyc-head-sub">{meta.sub}</span>
            </div>
            <button
              type="button"
              className="acm-add-pill"
              onClick={() => (isOwners ? onAddOwner() : onAddDoc(sub))}
            >
              <IconPlus /> {meta.addLabel}
            </button>
          </div>
        </div>

        <div className="acm-kyc-toolbar">
          <div className="acm-kyc-search">
            <IconSearch />
            <input
              type="search"
              placeholder={meta.placeholder}
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <div className="acm-kyc-count">
            {totalRows} {isOwners ? `owner${totalRows === 1 ? '' : 's'}` : `document${totalRows === 1 ? '' : 's'}`}
          </div>
        </div>

        <div className="acm-kyc-body">
          <div className="acm-loc-table-wrap">
            {isOwners ? (
              <table className="acm-loc-table">
                <thead>
                  <tr>
                    <th>SR NO</th><th>OWNER NAME</th><th>DESIGNATION</th><th>EMAIL</th><th>PHONE</th>
                    <th>ID PROOF</th><th>ADDRESS PROOF</th><th>PHOTOGRAPH</th><th>STATUS</th><th>ACTIONS</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredOwners.length === 0 ? (
                    <tr className="acm-loc-empty"><td colSpan={10}>{q ? 'No owners match your search.' : 'No owners captured yet. Click "+ Add Owner KYC" to add one.'}</td></tr>
                  ) : filteredOwners.map((o, i) => (
                    <tr key={o.id}>
                      <td>{String(i + 1).padStart(2, '0')}</td>
                      <td style={{ fontWeight: 700 }}>{o.owner_name}</td>
                      <td>{o.designation || '—'}</td>
                      <td>{o.official_email || '—'}</td>
                      <td>{o.phone_number || '—'}</td>
                      <td>{o.id_proof_name ? <span className="acm-kyc-attach">{o.id_proof_name}</span> : '—'}</td>
                      <td>{o.address_proof_name ? <span className="acm-kyc-attach">{o.address_proof_name}</span> : '—'}</td>
                      <td>{o.photograph_name ? <span className="acm-kyc-attach">{o.photograph_name}</span> : '—'}</td>
                      <td>{o.status === 'Active' ? <span className="acm-pill-yes">✓ Active</span> : <span className="acm-pill-no">Inactive</span>}</td>
                      <td>
                        <div className="acm-loc-actions">
                          <Tooltip label="Edit">
                            <button type="button" className="acm-loc-btn" aria-label="Edit" onClick={() => onEditOwner(o.id)}><IconPencil /></button>
                          </Tooltip>
                          <Tooltip label="Delete">
                            <button type="button" className="acm-loc-btn acm-loc-btn-del" aria-label="Delete" onClick={() => onDeleteOwner(o.id)}><IconTrash /></button>
                          </Tooltip>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <table className="acm-loc-table">
                <thead>
                  <tr>
                    <th>SR NO</th><th>AUTO CODE</th><th>{meta.nameCol.toUpperCase()}</th><th>LICENSE #</th>
                    <th>ISSUING AUTHORITY</th><th>ISSUE DATE</th><th>EXPIRY</th><th>STATUS</th><th>ATTACHMENT</th><th>ACTIONS</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredDocs.length === 0 ? (
                    <tr className="acm-loc-empty"><td colSpan={10}>{q ? 'No documents match your search.' : `No ${kind === 'dd' ? 'DD' : 'trade licence'} documents yet. Click "+ ${meta.addLabel}" to add one.`}</td></tr>
                  ) : filteredDocs.map((d, i) => {
                    const sr = i + 1;
                    return (
                      <tr key={d.id}>
                        <td>{String(sr).padStart(2, '0')}</td>
                        <td><span className="acm-kyc-code">{codeFor(kind, sr)}</span></td>
                        <td style={{ fontWeight: 700 }}>{d.name}</td>
                        <td>{d.license_number || '—'}</td>
                        <td>{d.issuing_authority || '—'}</td>
                        <td><span className={d.issue_date ? 'acm-kyc-exp' : 'acm-kyc-exp na'}>{fmtMy(d.issue_date)}</span></td>
                        <td><span className={d.expiry_date ? 'acm-kyc-exp' : 'acm-kyc-exp na'}>{fmtMy(d.expiry_date)}</span></td>
                        <td>{d.status === 'Active' ? <span className="acm-pill-yes">✓ Active</span> : <span className="acm-pill-no">Inactive</span>}</td>
                        <td>{d.attachment_name ? <span className="acm-kyc-attach">{d.attachment_name}</span> : '—'}</td>
                        <td>
                          <div className="acm-loc-actions">
                            <Tooltip label="Edit">
                              <button type="button" className="acm-loc-btn" aria-label="Edit" onClick={() => onEditDoc(d.id)}><IconPencil /></button>
                            </Tooltip>
                            <Tooltip label="Delete">
                              <button type="button" className="acm-loc-btn acm-loc-btn-del" aria-label="Delete" onClick={() => onDeleteDoc(d.id)}><IconTrash /></button>
                            </Tooltip>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </>
  );
};

/* ─── Stage 3 — Evidence Vault ─── */
const Stage3 = ({ vaultTab, setVaultTab, evSub, setEvSub, form1, kycDocs, kycOwners, locations }: {
  locations: LocationRow[];
  vaultTab: VaultTab;
  setVaultTab: (t: VaultTab) => void;
  evSub: EvSubTab;
  setEvSub: (s: EvSubTab) => void;
  form1: any;
  kycDocs: KycDocRow[];
  kycOwners: KycOwnerRow[];
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
                <div className="acm-recap-sec-title"><IconPin size={12} /> PRIMARY ADDRESS &amp; CONTACT</div>
                <div className="acm-recap-grid">
                  <RecapField label="Address Type" value={form1.addressType} />
                  <RecapField label="Address"      value={form1.address} />
                  <RecapField label="Country"      value={form1.country} />
                  <RecapField label="State"        value={form1.state} />
                  <RecapField label="City"         value={form1.city} />
                  <RecapField label="Pin"          value={form1.pin} />
                  <RecapField label="Contact"      value={form1.contactName} />
                  <RecapField label="Designation"  value={form1.designation} />
                </div>
              </div>
              {locations.length > 0 && (
                <div className="acm-recap-card">
                  <div className="acm-recap-sec-title"><IconPin size={12} /> ADDITIONAL ADDRESSES ({locations.length})</div>
                  <div className="acm-recap-grid">
                    {locations.map(l => (
                      <RecapField
                        key={l.id}
                        label={l.type || 'Address'}
                        value={[l.line, [l.city, l.state, l.country].filter(Boolean).join(', '), l.cpName ? `Contact: ${l.cpName}` : '']
                          .filter(Boolean).join(' • ')}
                      />
                    ))}
                  </div>
                </div>
              )}
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
                  <span className="acm-recap-pill">✓ {kycDocs.filter(d => d.kind === 'dd').length} DD docs</span>
                  <span className="acm-recap-pill">✓ {kycOwners.length} owners</span>
                  <span className="acm-recap-pill">✓ {kycDocs.filter(d => d.kind === 'tl').length} trade licences</span>
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
          <div className="acm-vault-tabs">
            {(['dd', 'kyc', 'tl'] as EvSubTab[]).map(s => (
              <button key={s} type="button" className={`acm-vault-tab ${evSub === s ? 'on' : ''}`} onClick={() => setEvSub(s)}>
                {s === 'dd' ? <IconHome size={12} /> : s === 'kyc' ? <IconUser /> : <IconDoc />}
                {s === 'dd' ? 'Company Due Diligence' : s === 'kyc' ? 'Owner KYC' : 'Trade Licence'}
              </button>
            ))}
          </div>

          {evSub === 'kyc' ? (
            <VaultOwnersTable owners={kycOwners} />
          ) : (
            <VaultDocsTable docs={kycDocs.filter(d => d.kind === (evSub === 'dd' ? 'dd' : 'tl'))} kind={evSub === 'dd' ? 'dd' : 'tl'} />
          )}
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

/* ─── Polished file-upload field ─────
 * Replaces the bare `<input type="file">` (which renders the
 * browser's grey "Choose File / No file chosen" — looks out of place
 * inside the emerald sub-modal). This is a clickable dropzone with
 * an icon, accent border on hover, and a filename chip + remove
 * button once a file is picked. Keeps the existing API: the parent
 * just gets the picked filename string back. */
function FileUploadField({ value, onPick, accept }: { value?: string; onPick: (name: string) => void; accept?: string }) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  return (
    <div className="acm-file-zone">
      {value ? (
        <div className="acm-file-chip">
          <div className="acm-file-chip-icon">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
          </div>
          <span className="acm-file-chip-name" title={value}>{value}</span>
          <button
            type="button"
            className="acm-file-chip-x"
            aria-label="Remove file"
            onClick={() => { onPick(''); if (inputRef.current) inputRef.current.value = ''; }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
          <button
            type="button"
            className="acm-file-chip-replace"
            onClick={() => inputRef.current?.click()}
          >
            Replace
          </button>
        </div>
      ) : (
        <button type="button" className="acm-file-drop" onClick={() => inputRef.current?.click()}>
          <span className="acm-file-drop-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
          </span>
          <span className="acm-file-drop-text">
            <span className="acm-file-drop-title">Click to upload</span>
            <span className="acm-file-drop-sub">PDF, JPG, PNG — max 10 MB</span>
          </span>
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        style={{ display: 'none' }}
        onChange={e => {
          const f = e.target.files?.[0];
          if (f) onPick(f.name);
        }}
      />
    </div>
  );
}

/* ─── Stage 3 — read-only Evidence Vault tables ─── */
const VaultDocsTable = ({ docs, kind }: { docs: KycDocRow[]; kind: 'dd' | 'tl' }) => {
  const codeFor = (k: string, sr: number) => `${k.toUpperCase()}-${String(sr).padStart(3, '0')}`;
  const fmtMy = (s?: string) => {
    if (!s) return 'N/A';
    const [y, m] = s.split('-');
    return m && y ? `${m}/${y}` : s;
  };
  return (
    <div className="acm-kyc-card" style={{ marginTop: 12 }}>
      <div className="acm-loc-table-wrap">
        <table className="acm-loc-table">
          <thead>
            <tr>
              <th>SR NO</th><th>AUTO CODE</th><th>DOCUMENT NAME</th>
              <th>LICENSE #</th><th>ISSUING AUTHORITY</th>
              <th>ISSUE</th><th>EXPIRY</th><th>STATUS</th><th>ATTACHMENT</th>
            </tr>
          </thead>
          <tbody>
            {docs.length === 0 ? (
              <tr className="acm-loc-empty"><td colSpan={9}>No {kind === 'dd' ? 'company DD' : 'trade licence'} documents captured in Stage 2.</td></tr>
            ) : docs.map((d, i) => (
              <tr key={d.id}>
                <td>{String(i + 1).padStart(2, '0')}</td>
                <td><span className="acm-kyc-code">{codeFor(kind, i + 1)}</span></td>
                <td style={{ fontWeight: 700 }}>{d.name}</td>
                <td>{d.license_number || '—'}</td>
                <td>{d.issuing_authority || '—'}</td>
                <td><span className={d.issue_date ? 'acm-kyc-exp' : 'acm-kyc-exp na'}>{fmtMy(d.issue_date)}</span></td>
                <td><span className={d.expiry_date ? 'acm-kyc-exp' : 'acm-kyc-exp na'}>{fmtMy(d.expiry_date)}</span></td>
                <td>{d.status === 'Active' ? <span className="acm-pill-yes">✓ Active</span> : <span className="acm-pill-no">Inactive</span>}</td>
                <td>{d.attachment_name ? <span className="acm-kyc-attach">{d.attachment_name}</span> : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const VaultOwnersTable = ({ owners }: { owners: KycOwnerRow[] }) => (
  <div className="acm-kyc-card" style={{ marginTop: 12 }}>
    <div className="acm-loc-table-wrap">
      <table className="acm-loc-table">
        <thead>
          <tr>
            <th>SR NO</th><th>OWNER NAME</th><th>DESIGNATION</th><th>EMAIL</th><th>PHONE</th>
            <th>ID PROOF</th><th>ADDRESS PROOF</th><th>PHOTOGRAPH</th><th>STATUS</th>
          </tr>
        </thead>
        <tbody>
          {owners.length === 0 ? (
            <tr className="acm-loc-empty"><td colSpan={9}>No owners captured in Stage 2.</td></tr>
          ) : owners.map((o, i) => (
            <tr key={o.id}>
              <td>{String(i + 1).padStart(2, '0')}</td>
              <td style={{ fontWeight: 700 }}>{o.owner_name}</td>
              <td>{o.designation || '—'}</td>
              <td>{o.official_email || '—'}</td>
              <td>{o.phone_number || '—'}</td>
              <td>{o.id_proof_name ? <span className="acm-kyc-attach">{o.id_proof_name}</span> : '—'}</td>
              <td>{o.address_proof_name ? <span className="acm-kyc-attach">{o.address_proof_name}</span> : '—'}</td>
              <td>{o.photograph_name ? <span className="acm-kyc-attach">{o.photograph_name}</span> : '—'}</td>
              <td>{o.status === 'Active' ? <span className="acm-pill-yes">✓ Active</span> : <span className="acm-pill-no">Inactive</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </div>
);

/* ─── Stage 2 — Add/Edit KYC Document sub-modal (DD + Trade Licence) ─── */
function KycDocSubModal({ sub, editing, onClose, onSave }: {
  sub: KycSubTab;
  editing: KycDocRow | null;
  onClose: () => void;
  onSave: (rec: Omit<KycDocRow, 'id' | 'kind'>) => void;
}) {
  const titleLabel = sub === 'company-dd' ? 'DD Document / License' : 'Trade Licence';
  const [d, setD] = useState<Omit<KycDocRow, 'id' | 'kind'>>(() => editing ? {
    name: editing.name,
    license_number: editing.license_number ?? '',
    issuing_authority: editing.issuing_authority ?? '',
    issue_date: editing.issue_date ?? '',
    expiry_date: editing.expiry_date ?? '',
    attachment_name: editing.attachment_name ?? '',
    status: editing.status,
  } : {
    name: '', license_number: '', issuing_authority: '',
    issue_date: '', expiry_date: '', attachment_name: '', status: 'Active',
  });
  const [errs, setErrs] = useState<Record<string, string>>({});
  const set = <K extends keyof typeof d>(k: K, v: (typeof d)[K]) => {
    setD(prev => ({ ...prev, [k]: v }));
    setErrs(prev => { if (!prev[k as string]) return prev; const n = { ...prev }; delete n[k as string]; return n; });
  };
  const submit = () => {
    const next: Record<string, string> = {};
    if (!d.name.trim()) next.name = 'Document name is required';
    setErrs(next);
    if (Object.keys(next).length === 0) onSave(d);
  };
  return (
    <div className="acm-loc-sub-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="acm-loc-sub-card" onMouseDown={e => e.stopPropagation()}>
        <div className="acm-loc-sub-header">
          <div className="acm-loc-sub-title">{editing ? 'Edit' : 'Add'} {titleLabel}</div>
          <button type="button" className="acm-loc-sub-close" onClick={onClose} aria-label="Close"><IconClose /></button>
        </div>
        <div className="acm-loc-sub-body">
          <div className="acm-loc-grid-2">
            <div className="acm-field">
              <label className="acm-field-label">{titleLabel.toUpperCase()} NAME <span className="acm-req">*</span></label>
              <input
                className={`acm-input ${errs.name ? 'acm-input-error' : ''}`}
                placeholder={`Enter ${titleLabel.toLowerCase()} name`}
                value={d.name}
                onChange={e => set('name', e.target.value)}
              />
              {errs.name && <span className="acm-err-text">{errs.name}</span>}
            </div>
            <div className="acm-field">
              <label className="acm-field-label">LICENSE / DOCUMENT NUMBER</label>
              <input
                className="acm-input"
                placeholder="e.g. ABC123456789"
                value={d.license_number ?? ''}
                onChange={e => set('license_number', e.target.value)}
              />
            </div>
          </div>
          <div className="acm-loc-grid-2 acm-mt-12">
            <div className="acm-field">
              <label className="acm-field-label">ISSUING AUTHORITY</label>
              <input
                className="acm-input"
                placeholder="e.g. Registrar of Companies"
                value={d.issuing_authority ?? ''}
                onChange={e => set('issuing_authority', e.target.value)}
              />
            </div>
            <div className="acm-field">
              <label className="acm-field-label">STATUS</label>
              <MasterSelect
                value={d.status}
                options={[{ value: 'Active', label: 'Active' }, { value: 'Inactive', label: 'Inactive' }]}
                placeholder="Select status"
                onChange={(v) => set('status', (v as 'Active' | 'Inactive'))}
              />
            </div>
          </div>
          <div className="acm-loc-grid-2 acm-mt-12">
            <div className="acm-field">
              <label className="acm-field-label">ISSUE DATE</label>
              <MasterDatePicker
                value={d.issue_date ?? ''}
                maxDate={d.expiry_date || undefined}
                placeholder="DD/MM/YYYY"
                onChange={(v: string) => {
                  set('issue_date', v);
                  if (d.expiry_date && v && d.expiry_date < v) set('expiry_date', '');
                }}
              />
            </div>
            <div className="acm-field">
              <label className="acm-field-label">EXPIRY DATE</label>
              <MasterDatePicker
                value={d.expiry_date ?? ''}
                minDate={d.issue_date || undefined}
                placeholder="DD/MM/YYYY"
                onChange={(v: string) => set('expiry_date', v)}
              />
            </div>
          </div>
          <div className="acm-mt-12">
            <div className="acm-field">
              <label className="acm-field-label">ATTACHMENT</label>
              <FileUploadField
                value={d.attachment_name}
                onPick={(name) => set('attachment_name', name)}
                accept=".pdf,.jpg,.jpeg,.png"
              />
            </div>
          </div>
        </div>
        <div className="acm-loc-sub-footer">
          <button type="button" className="acm-btn acm-btn-light" onClick={onClose}>Cancel</button>
          <button type="button" className="acm-btn acm-btn-primary" onClick={submit}>{editing ? 'Update' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}

/* ─── Stage 2 — Add/Edit Owner KYC sub-modal ─── */
function KycOwnerSubModal({ editing, onClose, onSave }: {
  editing: KycOwnerRow | null;
  onClose: () => void;
  onSave: (rec: Omit<KycOwnerRow, 'id'>) => void;
}) {
  const [d, setD] = useState<Omit<KycOwnerRow, 'id'>>(() => editing ? {
    owner_name: editing.owner_name,
    designation: editing.designation ?? '',
    official_email: editing.official_email ?? '',
    phone_number: editing.phone_number ?? '',
    id_proof_name: editing.id_proof_name ?? '',
    address_proof_name: editing.address_proof_name ?? '',
    photograph_name: editing.photograph_name ?? '',
    status: editing.status,
  } : {
    owner_name: '', designation: '', official_email: '', phone_number: '',
    id_proof_name: '', address_proof_name: '', photograph_name: '', status: 'Active',
  });
  const [errs, setErrs] = useState<Record<string, string>>({});
  const set = <K extends keyof typeof d>(k: K, v: (typeof d)[K]) => {
    setD(prev => ({ ...prev, [k]: v }));
    setErrs(prev => { if (!prev[k as string]) return prev; const n = { ...prev }; delete n[k as string]; return n; });
  };
  const submit = () => {
    const next: Record<string, string> = {};
    if (!d.owner_name.trim())                                    next.owner_name     = 'Owner name is required';
    if (d.official_email && !/^\S+@\S+\.\S+$/.test(d.official_email)) next.official_email = 'Enter a valid email';
    if (d.phone_number && !/^\+?[0-9\s-]{7,15}$/.test(d.phone_number)) next.phone_number = 'Phone must be 7-15 digits';
    setErrs(next);
    if (Object.keys(next).length === 0) onSave(d);
  };
  return (
    <div className="acm-loc-sub-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="acm-loc-sub-card" onMouseDown={e => e.stopPropagation()}>
        <div className="acm-loc-sub-header">
          <div className="acm-loc-sub-title">{editing ? 'Edit' : 'Add'} Owner KYC</div>
          <button type="button" className="acm-loc-sub-close" onClick={onClose} aria-label="Close"><IconClose /></button>
        </div>
        <div className="acm-loc-sub-body">
          <div className="acm-loc-grid-2">
            <div className="acm-field">
              <label className="acm-field-label">OWNER / DIRECTOR NAME <span className="acm-req">*</span></label>
              <input
                className={`acm-input ${errs.owner_name ? 'acm-input-error' : ''}`}
                placeholder="Full name"
                value={d.owner_name}
                onChange={e => set('owner_name', e.target.value)}
              />
              {errs.owner_name && <span className="acm-err-text">{errs.owner_name}</span>}
            </div>
            <div className="acm-field">
              <label className="acm-field-label">DESIGNATION</label>
              <input
                className="acm-input"
                placeholder="Director / Partner / Proprietor"
                value={d.designation ?? ''}
                onChange={e => set('designation', e.target.value)}
              />
            </div>
          </div>
          <div className="acm-loc-grid-2 acm-mt-12">
            <div className="acm-field">
              <label className="acm-field-label">OFFICIAL EMAIL</label>
              <input
                className={`acm-input ${errs.official_email ? 'acm-input-error' : ''}`}
                type="email"
                placeholder="owner@company.com"
                value={d.official_email ?? ''}
                onChange={e => set('official_email', e.target.value)}
              />
              {errs.official_email && <span className="acm-err-text">{errs.official_email}</span>}
            </div>
            <div className="acm-field">
              <label className="acm-field-label">PHONE NUMBER</label>
              <input
                className={`acm-input ${errs.phone_number ? 'acm-input-error' : ''}`}
                type="tel"
                placeholder="7-15 digit number"
                value={d.phone_number ?? ''}
                onChange={e => set('phone_number', e.target.value)}
              />
              {errs.phone_number && <span className="acm-err-text">{errs.phone_number}</span>}
            </div>
          </div>
          <div className="acm-loc-grid-2 acm-mt-12">
            <div className="acm-field">
              <label className="acm-field-label">ID PROOF</label>
              <FileUploadField
                value={d.id_proof_name}
                onPick={(name) => set('id_proof_name', name)}
                accept=".pdf,.jpg,.jpeg,.png"
              />
            </div>
            <div className="acm-field">
              <label className="acm-field-label">ADDRESS PROOF</label>
              <FileUploadField
                value={d.address_proof_name}
                onPick={(name) => set('address_proof_name', name)}
                accept=".pdf,.jpg,.jpeg,.png"
              />
            </div>
          </div>
          <div className="acm-loc-grid-2 acm-mt-12">
            <div className="acm-field">
              <label className="acm-field-label">PHOTOGRAPH</label>
              <FileUploadField
                value={d.photograph_name}
                onPick={(name) => set('photograph_name', name)}
                accept="image/*"
              />
            </div>
            <div className="acm-field">
              <label className="acm-field-label">STATUS</label>
              <MasterSelect
                value={d.status}
                options={[{ value: 'Active', label: 'Active' }, { value: 'Inactive', label: 'Inactive' }]}
                placeholder="Select status"
                onChange={(v) => set('status', (v as 'Active' | 'Inactive'))}
              />
            </div>
          </div>
        </div>
        <div className="acm-loc-sub-footer">
          <button type="button" className="acm-btn acm-btn-light" onClick={onClose}>Cancel</button>
          <button type="button" className="acm-btn acm-btn-primary" onClick={submit}>{editing ? 'Update' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}

/* ─── Add/Edit Location & Contact sub-modal ─── */
type LocSubModalMasters = {
  addressTypes: { value: string; label: string }[];
  countries:    { value: string; label: string; id: number }[];
  states:       { value: string; label: string; countryId: number }[];
  designations: { value: string; label: string }[];
};

function LocationSubModal({ editing, masters, onClose, onSave }: {
  editing: LocationRow | null;
  masters: LocSubModalMasters;
  onClose: () => void;
  onSave: (rec: Omit<LocationRow, 'id'>) => void;
}) {
  const [d, setD] = useState<Omit<LocationRow, 'id'>>(() => editing ? { ...editing } : {
    type: DEFAULT_ADDRESS_TYPE, line: '', country: '', state: '', city: '', pin: '',
    cpName: '', cpDesignation: '', cpContact: '', cpEmail: '', cpWhatsapp: '' as 'yes' | 'no' | '',
  });
  const [errs, setErrs] = useState<Record<string, string>>({});
  const set = <K extends keyof typeof d>(k: K, v: (typeof d)[K]) => {
    setD(prev => ({ ...prev, [k]: v }));
    setErrs(prev => { if (!prev[k as string]) return prev; const n = { ...prev }; delete n[k as string]; return n; });
  };

  /* Defensive local refetch — the parent fires the same masters on
   * modal open, but if the user clicks Add before that lands (or one
   * of those calls failed silently), the dropdowns would render empty.
   * Holding a local copy and merging keeps the popup self-sufficient. */
  const [local, setLocal] = useState<LocSubModalMasters>({ addressTypes: [], countries: [], states: [], designations: [] });
  useEffect(() => {
    let cancelled = false;
    const isActive = (r: any) => !r.status || String(r.status).toLowerCase() === 'active';
    const byName = (rows: any[], key = 'name') => (rows ?? []).filter(isActive)
      .map((r: any) => ({ value: String(r[key] ?? ''), label: String(r[key] ?? '') }))
      .filter((o: any) => o.value);
    Promise.allSettled([
      api.get('/master/address_types').then(r => { if (!cancelled) setLocal(s => ({ ...s, addressTypes: byName(r.data ?? []) })); }),
      api.get('/master/countries').then(r => {
        if (cancelled) return;
        const rows = (r.data ?? []).filter(isActive)
          .map((row: any) => ({ id: Number(row.id), value: String(row.name ?? ''), label: String(row.name ?? '') }))
          .filter((o: any) => o.value)
          .sort((a: any, b: any) => a.label.localeCompare(b.label));
        setLocal(s => ({ ...s, countries: rows }));
      }),
      api.get('/master/states').then(r => {
        if (cancelled) return;
        const rows = (r.data ?? []).filter(isActive)
          .map((row: any) => ({ countryId: Number(row.country_id), value: String(row.name ?? ''), label: String(row.name ?? '') }))
          .filter((o: any) => o.value);
        setLocal(s => ({ ...s, states: rows }));
      }),
      api.get('/master/designations').then(r => { if (!cancelled) setLocal(s => ({ ...s, designations: byName(r.data ?? []) })); }),
    ]);
    return () => { cancelled = true; };
  }, []);

  /* Effective lists — prefer whichever side actually has data so the
   * dropdown is populated as soon as either fetch resolves. */
  const addressTypes = masters.addressTypes.length ? masters.addressTypes : local.addressTypes;
  const countries    = masters.countries.length    ? masters.countries    : local.countries;
  const states       = masters.states.length       ? masters.states       : local.states;
  const designations = masters.designations.length ? masters.designations : local.designations;

  const selectedCountry = countries.find(c => c.value === d.country);
  const filteredStates = selectedCountry ? states.filter(s => s.countryId === selectedCountry.id) : [];

  const submit = () => {
    const next: Record<string, string> = {};
    if (!d.type)                                       next.type          = 'Select address type';
    if (!d.line.trim())                                next.line          = 'Address is required';
    if (!d.country)                                    next.country       = 'Select country';
    if (!d.state)                                      next.state         = 'Select state';
    if (!d.city.trim())                                next.city          = 'City is required';
    if (!d.pin.trim())                                 next.pin           = 'PIN is required';
    else if (!/^[A-Za-z0-9-\s]{3,12}$/.test(d.pin))    next.pin           = 'PIN looks invalid';
    if (!d.cpName.trim())                              next.cpName        = 'Contact name required';
    if (!d.cpDesignation.trim())                       next.cpDesignation = 'Designation required';
    if (!d.cpContact.trim())                           next.cpContact     = 'Phone required';
    else if (!/^\+?[0-9\s-]{7,15}$/.test(d.cpContact)) next.cpContact     = 'Phone must be 7-15 digits';
    if (!d.cpEmail.trim())                             next.cpEmail       = 'Email required';
    else if (!/^\S+@\S+\.\S+$/.test(d.cpEmail))        next.cpEmail       = 'Enter a valid email';
    if (!d.cpWhatsapp)                                 next.cpWhatsapp    = 'Select WhatsApp preference';
    setErrs(next);
    if (Object.keys(next).length === 0) onSave(d);
  };

  return (
    <div className="acm-loc-sub-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="acm-loc-sub-card" onMouseDown={e => e.stopPropagation()}>
        <div className="acm-loc-sub-header">
          <div className="acm-loc-sub-title">{editing ? 'Edit' : 'Add New'} Location &amp; Contact</div>
          <button type="button" className="acm-loc-sub-close" onClick={onClose} aria-label="Close"><IconClose /></button>
        </div>
        <div className="acm-loc-sub-body">
          <div className="acm-loc-grid-2">
            <div className="acm-field">
              <label className="acm-field-label">ADDRESS TYPE <span className="acm-req">*</span></label>
              <MasterSelect
                value={d.type}
                options={optsWith(addressTypes, d.type)}
                placeholder="Select address type"
                invalid={!!errs.type}
                onChange={v => set('type', v)}
              />
              {errs.type && <span className="acm-err-text">{errs.type}</span>}
            </div>
            <div className="acm-field">
              <label className="acm-field-label">ADDRESS <span className="acm-req">*</span></label>
              <input
                className={`acm-input ${errs.line ? 'acm-input-error' : ''}`}
                placeholder="Enter complete address"
                value={d.line}
                onChange={e => set('line', e.target.value)}
              />
              {errs.line && <span className="acm-err-text">{errs.line}</span>}
            </div>
          </div>
          <div className="acm-loc-grid-4 acm-mt-12">
            <div className="acm-field">
              <label className="acm-field-label">COUNTRY <span className="acm-req">*</span></label>
              <MasterSelect
                value={d.country}
                options={optsWith(countries, d.country)}
                placeholder="Select country"
                invalid={!!errs.country}
                onChange={v => { setD(prev => ({ ...prev, country: v, state: '' })); setErrs(prev => { if (!prev.country) return prev; const n = { ...prev }; delete n.country; return n; }); }}
              />
              {errs.country && <span className="acm-err-text">{errs.country}</span>}
            </div>
            <div className="acm-field">
              <label className="acm-field-label">STATE <span className="acm-req">*</span></label>
              <MasterSelect
                value={d.state}
                options={optsWith(filteredStates, d.state)}
                placeholder={d.country ? 'Select state' : 'Select country first'}
                disabled={!d.country}
                invalid={!!errs.state}
                onChange={v => set('state', v)}
              />
              {errs.state && <span className="acm-err-text">{errs.state}</span>}
            </div>
            <div className="acm-field">
              <label className="acm-field-label">CITY <span className="acm-req">*</span></label>
              <input
                className={`acm-input ${errs.city ? 'acm-input-error' : ''}`}
                placeholder="Enter City"
                value={d.city}
                onChange={e => set('city', e.target.value)}
              />
              {errs.city && <span className="acm-err-text">{errs.city}</span>}
            </div>
            <div className="acm-field">
              <label className="acm-field-label">PIN / POSTAL CODE <span className="acm-req">*</span></label>
              <input
                className={`acm-input ${errs.pin ? 'acm-input-error' : ''}`}
                placeholder="Enter PIN"
                maxLength={12}
                value={d.pin}
                onChange={e => set('pin', e.target.value)}
              />
              {errs.pin && <span className="acm-err-text">{errs.pin}</span>}
            </div>
          </div>
          <div className="acm-loc-grid-4 acm-mt-12">
            <div className="acm-field">
              <label className="acm-field-label">CONTACT PERSON NAME <span className="acm-req">*</span></label>
              <input
                className={`acm-input ${errs.cpName ? 'acm-input-error' : ''}`}
                placeholder="Full name"
                value={d.cpName}
                onChange={e => set('cpName', e.target.value)}
              />
              {errs.cpName && <span className="acm-err-text">{errs.cpName}</span>}
            </div>
            <div className="acm-field">
              <label className="acm-field-label">DESIGNATION <span className="acm-req">*</span></label>
              <MasterSelect
                value={d.cpDesignation}
                options={optsWith(designations, d.cpDesignation)}
                placeholder="Select designation"
                invalid={!!errs.cpDesignation}
                onChange={v => set('cpDesignation', v)}
              />
              {errs.cpDesignation && <span className="acm-err-text">{errs.cpDesignation}</span>}
            </div>
            <div className="acm-field">
              <label className="acm-field-label">CONTACT NO <span className="acm-req">*</span></label>
              <input
                className={`acm-input ${errs.cpContact ? 'acm-input-error' : ''}`}
                type="tel"
                placeholder="7-15 digit mobile"
                value={d.cpContact}
                onChange={e => set('cpContact', e.target.value)}
              />
              {errs.cpContact && <span className="acm-err-text">{errs.cpContact}</span>}
            </div>
            <div className="acm-field">
              <label className="acm-field-label">EMAIL ID <span className="acm-req">*</span></label>
              <input
                className={`acm-input ${errs.cpEmail ? 'acm-input-error' : ''}`}
                type="email"
                placeholder="name@company.com"
                value={d.cpEmail}
                onChange={e => set('cpEmail', e.target.value)}
              />
              {errs.cpEmail && <span className="acm-err-text">{errs.cpEmail}</span>}
            </div>
          </div>
          <div className="acm-mt-12">
            <div className="acm-field">
              <label className="acm-field-label">WHATSAPP ENABLED? <span className="acm-req">*</span></label>
              <div className="acm-loc-radio-row">
                <label className={`acm-loc-radio ${d.cpWhatsapp === 'yes' ? 'on' : ''}`}>
                  <input type="radio" name="locWa" value="yes" checked={d.cpWhatsapp === 'yes'} onChange={() => set('cpWhatsapp', 'yes')} />
                  <span /> YES
                </label>
                <label className={`acm-loc-radio ${d.cpWhatsapp === 'no' ? 'on' : ''}`}>
                  <input type="radio" name="locWa" value="no" checked={d.cpWhatsapp === 'no'} onChange={() => set('cpWhatsapp', 'no')} />
                  <span /> NO
                </label>
              </div>
              {errs.cpWhatsapp && <span className="acm-err-text">{errs.cpWhatsapp}</span>}
            </div>
          </div>
        </div>
        <div className="acm-loc-sub-footer">
          <button type="button" className="acm-btn acm-btn-light" onClick={onClose}>Cancel</button>
          <button type="button" className="acm-btn acm-btn-primary" onClick={submit}>{editing ? 'Update' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}

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
const IconPlus = ({ size = 11 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
    <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);
const IconPencil = ({ size = 12 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
    <path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
  </svg>
);
const IconTrash = ({ size = 12 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    <path d="M10 11v6M14 11v6" />
    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
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
.acm-recap-empty {
  padding: 8px 4px; font-size: 12px; color: #6b7280; font-style: italic;
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

/* When a popup-on-popup is open, blur the wizard underneath so the
 * focus is squarely on the sub-modal. Disable pointer events too so
 * clicks intended for the sub-modal don't accidentally hit fields
 * behind it. The sub-modal sits in its own overlay outside .acm-wiz,
 * so it isn't affected by this filter. */
.acm-wiz-blurred {
  filter: blur(4px) saturate(.85);
  pointer-events: none;
  user-select: none;
  transition: filter .18s ease;
}

/* ─── Polished file upload ─── */
.acm-file-zone { width: 100%; }
.acm-file-drop {
  display: flex; align-items: center; gap: 12px;
  width: 100%;
  padding: 14px 14px;
  background: #f9fafb;
  border: 1.5px dashed #d1d5db;
  border-radius: 10px;
  cursor: pointer;
  text-align: left;
  transition: all .15s ease;
}
.acm-file-drop:hover,
.acm-file-drop:focus-visible {
  border-color: #10b981;
  background: #ecfdf5;
  outline: none;
}
.acm-file-drop-icon {
  width: 36px; height: 36px;
  flex-shrink: 0;
  display: inline-flex; align-items: center; justify-content: center;
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  color: #10b981;
}
.acm-file-drop:hover .acm-file-drop-icon {
  border-color: #10b981; background: #10b981; color: #fff;
}
.acm-file-drop-text { display: flex; flex-direction: column; min-width: 0; }
.acm-file-drop-title { font-size: 12.5px; font-weight: 600; color: #065f46; }
.acm-file-drop-sub   { font-size: 11px; color: #6b7280; margin-top: 2px; }

.acm-file-chip {
  display: flex; align-items: center; gap: 8px;
  width: 100%;
  padding: 8px 10px;
  background: #ecfdf5;
  border: 1px solid rgba(16,185,129,.30);
  border-radius: 10px;
}
.acm-file-chip-icon {
  width: 28px; height: 28px;
  flex-shrink: 0;
  display: inline-flex; align-items: center; justify-content: center;
  background: #10b981; color: #fff;
  border-radius: 6px;
}
.acm-file-chip-name {
  flex: 1; min-width: 0;
  font-size: 12.5px; font-weight: 600; color: #065f46;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.acm-file-chip-replace {
  flex-shrink: 0;
  font-size: 11px; font-weight: 600;
  padding: 4px 10px;
  background: #fff; color: #047857;
  border: 1px solid rgba(16,185,129,.40);
  border-radius: 999px;
  cursor: pointer; transition: all .15s ease;
}
.acm-file-chip-replace:hover { background: #10b981; color: #fff; border-color: #10b981; }
.acm-file-chip-x {
  flex-shrink: 0;
  width: 24px; height: 24px;
  display: inline-flex; align-items: center; justify-content: center;
  background: #fff; color: #b91c1c;
  border: 1px solid #fecaca;
  border-radius: 6px;
  cursor: pointer; transition: all .15s ease;
}
.acm-file-chip-x:hover { background: #fee2e2; border-color: #ef4444; }

/* ─── Stage 2 — KYC sub-tabs + card ─── */
.acm-kyc-subtabs {
  display: flex; gap: 8px; flex-wrap: wrap;
  margin-bottom: 12px;
}
.acm-kyc-subtab {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 8px 16px; border-radius: 999px;
  background: #fff; color: #4b5563;
  border: 1px solid #e5e7eb;
  font-weight: 600; font-size: 12.5px; letter-spacing: .01em;
  cursor: pointer; transition: all .15s ease;
}
.acm-kyc-subtab:hover { border-color: #10b981; color: #047857; }
.acm-kyc-subtab.on {
  background: linear-gradient(135deg, #10b981 0%, #059669 100%);
  border-color: transparent; color: #fff;
  box-shadow: 0 4px 10px rgba(16,185,129,.30);
}
.acm-kyc-card {
  background: #fff;
  border: 1px solid rgba(16,185,129,.25);
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 1px 2px rgba(15,42,35,.04);
}
.acm-kyc-head {
  background: linear-gradient(180deg, #ecfdf5 0%, #d1fae5 100%);
  border-bottom: 1px solid rgba(16,185,129,.25);
  padding: 12px 16px;
}
.acm-kyc-head-row { display: flex; align-items: center; gap: 12px; width: 100%; }
.acm-kyc-head-icon {
  width: 28px; height: 28px;
  display: inline-flex; align-items: center; justify-content: center;
  background: #10b981; color: #fff; border-radius: 8px;
}
.acm-kyc-head-text { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; }
.acm-kyc-head-title { color: #065f46; font-weight: 700; font-size: 12.5px; letter-spacing: .04em; }
.acm-kyc-head-sub   { color: #047857; font-weight: 500; font-size: 12px; }
.acm-kyc-toolbar {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 16px;
  background: #f9fafb;
  border-bottom: 1px solid #e5e7eb;
  gap: 12px;
}
.acm-kyc-search {
  flex: 1; max-width: 380px;
  position: relative;
  display: flex; align-items: center;
}
.acm-kyc-search svg { position: absolute; left: 10px; color: #9ca3af; }
.acm-kyc-search input {
  width: 100%;
  padding: 7px 12px 7px 32px;
  border: 1px solid #d1d5db; border-radius: 8px;
  font-size: 13px; background: #fff;
}
.acm-kyc-search input:focus { outline: none; border-color: #10b981; box-shadow: 0 0 0 3px rgba(16,185,129,.12); }
.acm-kyc-count {
  font-size: 12px; color: #6b7280; font-weight: 600;
  padding: 4px 10px; background: #fff; border: 1px solid #e5e7eb; border-radius: 999px;
}
.acm-kyc-body { padding: 0; }
.acm-kyc-code {
  display: inline-block;
  padding: 2px 8px; border-radius: 4px;
  background: #ecfdf5; color: #047857;
  border: 1px solid rgba(16,185,129,.30);
  font-family: ui-monospace, monospace; font-size: 11px; font-weight: 600;
}
.acm-kyc-exp {
  display: inline-block; padding: 2px 8px; border-radius: 4px;
  background: #f3f4f6; color: #374151;
  font-size: 11px; font-weight: 600;
}
.acm-kyc-exp.na { color: #9ca3af; }
.acm-kyc-attach {
  font-size: 11.5px; color: #047857; font-weight: 600;
  word-break: break-all;
}

/* ─── Address & Contact table card ─── */
.acm-loc-card {
  background: #fff;
  border: 1px solid rgba(16,185,129,.25);
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 1px 2px rgba(15,42,35,.04);
}
.acm-loc-head {
  background: linear-gradient(180deg, #ecfdf5 0%, #d1fae5 100%);
  border-bottom: 1px solid rgba(16,185,129,.25);
  padding: 12px 16px;
}
.acm-loc-head-row { display: flex; align-items: center; gap: 12px; width: 100%; }
.acm-loc-head-icon {
  width: 28px; height: 28px;
  display: inline-flex; align-items: center; justify-content: center;
  background: #10b981; color: #fff; border-radius: 8px;
}
.acm-loc-head-text { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; }
.acm-loc-head-title { color: #065f46; font-weight: 700; font-size: 12.5px; letter-spacing: .04em; }
.acm-loc-head-sub   { color: #047857; font-weight: 500; font-size: 12px; }
.acm-add-pill {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 7px 14px; border-radius: 999px;
  background: #fff; color: #065f46;
  border: 1px solid rgba(16,185,129,.40);
  font-weight: 600; font-size: 12.5px;
  cursor: pointer; transition: all .15s ease;
}
.acm-add-pill:hover { background: #10b981; color: #fff; border-color: #10b981; }
.acm-loc-body { padding: 0; }
.acm-loc-table-wrap { overflow-x: auto; }
.acm-loc-table {
  width: 100%; border-collapse: collapse;
  font-size: 13px; color: #1f2937;
}
.acm-loc-table thead tr {
  background: #f9fafb;
  border-bottom: 1px solid #e5e7eb;
}
.acm-loc-table thead th {
  padding: 10px 12px; text-align: left;
  font-weight: 700; font-size: 11px; letter-spacing: .04em;
  color: #6b7280; text-transform: uppercase;
  white-space: nowrap;
}
.acm-loc-table tbody td {
  padding: 12px; border-bottom: 1px solid #f3f4f6;
  vertical-align: middle;
}
.acm-loc-table tbody tr:hover { background: #f0fdf4; }
.acm-loc-empty td {
  text-align: center; padding: 32px 16px !important;
  color: #6b7280; font-size: 13px;
}
.acm-pill-yes {
  display: inline-flex; align-items: center;
  padding: 3px 10px; border-radius: 999px;
  background: #d1fae5; color: #065f46;
  font-weight: 600; font-size: 12px;
}
.acm-pill-no {
  display: inline-flex; align-items: center;
  padding: 3px 10px; border-radius: 999px;
  background: #fee2e2; color: #991b1b;
  font-weight: 600; font-size: 12px;
}
.acm-loc-actions { display: inline-flex; gap: 6px; }
.acm-loc-btn {
  width: 30px; height: 30px; border-radius: 8px;
  display: inline-flex; align-items: center; justify-content: center;
  background: #fff; color: #6b7280;
  border: 1px solid #e5e7eb;
  cursor: pointer; transition: all .15s ease;
}
.acm-loc-btn:hover { background: #ecfdf5; border-color: #10b981; color: #047857; }
.acm-loc-btn-del:hover { background: #fef2f2; border-color: #ef4444; color: #b91c1c; }

/* ─── Add/Edit Location & Contact sub-modal ─── */
/* z-index 10001 = above the wizard overlay (1080) but BELOW the
 * MasterSelect portal (11000) and MasterDatePicker portal (11100),
 * so dropdowns + calendars opened from inside the sub-modal aren't
 * clipped by this overlay. DeleteConfirmModal (11050) layers on top
 * correctly without further adjustment. */
.acm-loc-sub-overlay {
  position: fixed; inset: 0;
  background: rgba(15,42,35,.55);
  z-index: 10001;
  display: flex; align-items: center; justify-content: center;
  padding: 20px;
}
.acm-loc-sub-card {
  width: min(900px, 100%);
  max-height: calc(100vh - 40px);
  background: #fff;
  border-radius: 14px;
  overflow: hidden;
  display: flex; flex-direction: column;
  box-shadow: 0 24px 60px rgba(15,42,35,.30);
}
.acm-loc-sub-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 20px;
  background: linear-gradient(135deg, #10b981 0%, #059669 100%);
  color: #fff;
}
.acm-loc-sub-title { font-size: 16px; font-weight: 700; letter-spacing: .01em; }
.acm-loc-sub-close {
  width: 30px; height: 30px; border-radius: 50%;
  display: inline-flex; align-items: center; justify-content: center;
  background: rgba(255,255,255,.18); color: #fff; border: none;
  cursor: pointer; transition: background .15s ease;
}
.acm-loc-sub-close:hover { background: rgba(255,255,255,.30); }
.acm-loc-sub-body { padding: 20px; overflow-y: auto; }
.acm-loc-grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.acm-loc-grid-4 { display: grid; grid-template-columns: repeat(4, minmax(0,1fr)); gap: 14px; }
.acm-loc-sub-footer {
  display: flex; align-items: center; justify-content: flex-end; gap: 10px;
  padding: 14px 20px;
  background: #f9fafb;
  border-top: 1px solid #e5e7eb;
}
.acm-loc-radio-row { display: flex; gap: 10px; }
.acm-loc-radio {
  flex: 0 0 auto; min-width: 90px;
  display: inline-flex; align-items: center; gap: 8px;
  padding: 8px 14px; border-radius: 8px;
  background: #fff; border: 1px solid #d1d5db;
  font-weight: 600; font-size: 12.5px; color: #374151;
  cursor: pointer; transition: all .15s ease;
}
.acm-loc-radio input { accent-color: #10b981; margin: 0; }
.acm-loc-radio.on { background: #ecfdf5; border-color: #10b981; color: #065f46; }
.acm-input-error { border-color: #ef4444 !important; background: #fef2f2 !important; }
.acm-err-text { display: block; margin-top: 4px; color: #b91c1c; font-size: 11.5px; font-weight: 500; }

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

/* Address & Contact table — dark */
[data-bs-theme="dark"] .acm-loc-card     { background: #0f2a23; border-color: rgba(16,185,129,.25); }
[data-bs-theme="dark"] .acm-loc-head     { background: linear-gradient(180deg, rgba(16,185,129,.18) 0%, rgba(16,185,129,.10) 100%); border-bottom-color: rgba(16,185,129,.25); }
[data-bs-theme="dark"] .acm-loc-head-title { color: #6ee7b7; }
[data-bs-theme="dark"] .acm-loc-head-sub   { color: #34d399; }
[data-bs-theme="dark"] .acm-add-pill     { background: #103129; color: #6ee7b7; border-color: rgba(16,185,129,.40); }
[data-bs-theme="dark"] .acm-add-pill:hover { background: #10b981; color: #fff; }
[data-bs-theme="dark"] .acm-loc-table thead tr { background: #103129; border-bottom-color: rgba(16,185,129,.20); }
[data-bs-theme="dark"] .acm-loc-table thead th { color: #94a3b8; }
[data-bs-theme="dark"] .acm-loc-table tbody td { color: #ecfdf5; border-bottom-color: rgba(16,185,129,.15); }
[data-bs-theme="dark"] .acm-loc-table tbody tr:hover { background: rgba(16,185,129,.10); }
[data-bs-theme="dark"] .acm-loc-empty td { color: #94a3b8; }
[data-bs-theme="dark"] .acm-pill-yes     { background: rgba(16,185,129,.18); color: #6ee7b7; }
[data-bs-theme="dark"] .acm-pill-no      { background: rgba(239,68,68,.18); color: #fca5a5; }
[data-bs-theme="dark"] .acm-loc-btn      { background: #103129; border-color: rgba(16,185,129,.25); color: #94a3b8; }
[data-bs-theme="dark"] .acm-loc-btn:hover { background: rgba(16,185,129,.18); border-color: #10b981; color: #6ee7b7; }
[data-bs-theme="dark"] .acm-loc-btn-del:hover { background: rgba(239,68,68,.18); border-color: #ef4444; color: #fca5a5; }

/* Location sub-modal — dark */
[data-bs-theme="dark"] .acm-loc-sub-overlay { background: rgba(0,0,0,.65); }
[data-bs-theme="dark"] .acm-loc-sub-card    { background: #0f2a23; }
[data-bs-theme="dark"] .acm-loc-sub-footer  { background: #103129; border-top-color: rgba(16,185,129,.20); }
[data-bs-theme="dark"] .acm-loc-radio       { background: #103129; border-color: rgba(16,185,129,.25); color: #ecfdf5; }
[data-bs-theme="dark"] .acm-loc-radio.on    { background: rgba(16,185,129,.18); border-color: #10b981; color: #6ee7b7; }
[data-bs-theme="dark"] .acm-input-error     { background: rgba(239,68,68,.10) !important; border-color: #ef4444 !important; }
[data-bs-theme="dark"] .acm-err-text        { color: #fca5a5; }

/* Polished file upload — dark */
[data-bs-theme="dark"] .acm-file-drop          { background: #103129; border-color: rgba(16,185,129,.25); }
[data-bs-theme="dark"] .acm-file-drop:hover    { background: rgba(16,185,129,.12); border-color: #10b981; }
[data-bs-theme="dark"] .acm-file-drop-icon     { background: #0f2a23; border-color: rgba(16,185,129,.25); color: #6ee7b7; }
[data-bs-theme="dark"] .acm-file-drop-title    { color: #6ee7b7; }
[data-bs-theme="dark"] .acm-file-drop-sub      { color: #94a3b8; }
[data-bs-theme="dark"] .acm-file-chip          { background: rgba(16,185,129,.15); border-color: rgba(16,185,129,.30); }
[data-bs-theme="dark"] .acm-file-chip-name     { color: #6ee7b7; }
[data-bs-theme="dark"] .acm-file-chip-replace  { background: #103129; color: #6ee7b7; border-color: rgba(16,185,129,.40); }
[data-bs-theme="dark"] .acm-file-chip-x        { background: #103129; color: #fca5a5; border-color: rgba(239,68,68,.30); }
[data-bs-theme="dark"] .acm-file-chip-x:hover  { background: rgba(239,68,68,.15); }

/* KYC sub-tabs + card — dark */
[data-bs-theme="dark"] .acm-kyc-subtab     { background: #103129; border-color: rgba(16,185,129,.20); color: #94a3b8; }
[data-bs-theme="dark"] .acm-kyc-subtab:hover { color: #6ee7b7; border-color: #10b981; }
[data-bs-theme="dark"] .acm-kyc-subtab.on  { background: linear-gradient(135deg,#10b981 0%,#059669 100%); color: #fff; }
[data-bs-theme="dark"] .acm-kyc-card       { background: #0f2a23; border-color: rgba(16,185,129,.25); }
[data-bs-theme="dark"] .acm-kyc-head       { background: linear-gradient(180deg, rgba(16,185,129,.18) 0%, rgba(16,185,129,.10) 100%); border-bottom-color: rgba(16,185,129,.25); }
[data-bs-theme="dark"] .acm-kyc-head-title { color: #6ee7b7; }
[data-bs-theme="dark"] .acm-kyc-head-sub   { color: #34d399; }
[data-bs-theme="dark"] .acm-kyc-toolbar    { background: #103129; border-bottom-color: rgba(16,185,129,.20); }
[data-bs-theme="dark"] .acm-kyc-search input { background: #0a1f1a; border-color: rgba(16,185,129,.25); color: #ecfdf5; }
[data-bs-theme="dark"] .acm-kyc-count      { background: #103129; border-color: rgba(16,185,129,.25); color: #94a3b8; }
[data-bs-theme="dark"] .acm-kyc-code       { background: rgba(16,185,129,.18); color: #6ee7b7; border-color: rgba(16,185,129,.30); }
[data-bs-theme="dark"] .acm-kyc-exp        { background: rgba(255,255,255,.06); color: #ecfdf5; }
[data-bs-theme="dark"] .acm-kyc-exp.na     { color: #6b7280; }
[data-bs-theme="dark"] .acm-kyc-attach     { color: #6ee7b7; }
`;
