import { useEffect, useMemo, useState, type ChangeEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import api from '../../api';
import { resolveFileUrl } from '../../utils/resolveFileUrl';
import { useToast } from '../../contexts/ToastContext';
import { MasterSelect } from '../../components/ui/MasterSelect';
import { MasterMultiSelect } from '../master/masterFormKit';
import { MasterDatePicker } from '../../components/ui/MasterDatePicker';
import {
  validateEmail, validatePincode, validateWebsite,
  validateGstin, validateIfsc, validateAccountNumber,
} from '../../utils/fieldValidators';
import SalesCustomerSendForSignatureModal from '../sales/SalesCustomerSendForSignatureModal';

/* Vendor-specific contact number rule — 6 to 15 digits, numerics only.
 * Stricter than the shared `validatePhoneGeneric` (which permits +, spaces,
 * parens, hyphens) because the vendor module wants a clean digit string
 * for WhatsApp / SMS automations downstream. */
function validateContactNumber(value: string, label = 'Contact No'): string {
  const v = (value ?? '').trim();
  if (!v) return '';
  if (!/^\d+$/.test(v))           return `${label} must contain digits only (no spaces, +, or punctuation)`;
  if (v.length < 6 || v.length > 15) return `${label} must be 6 to 15 digits`;
  return '';
}

/* Strip any non-digit character from a contact-number input as the user
 * types, so the field is impossible to populate with letters or symbols. */
const digitsOnly = (raw: string): string => (raw || '').replace(/\D/g, '').slice(0, 15);

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
  // Step 2 — KYC / Due Diligence collections
  dueDiligence: DueDiligenceRow[];
  ownerKyc: OwnerKycRow[];
  tradeLicenses: TradeLicenseRow[];
  bankAccounts: BankRow[];
  gstScrutiny: GstScrutinyRow[];
  // Step 3 — Trade Documents (preset doc types with signature workflow)
  tradeDocuments: TradeDocRow[];
  // Step 4 — product mappings with pricing
  productMappings: ProductMappingRow[];
  // Step 4 — derived list of mapped product codes (kept for backward-compat
  // with the Vendors list page which only needs codes today)
  mappedProductCodes: string[];
};

/* ─── Step 2 row shapes ─────────────────────────────────────────────
 * Each Step-2 tab maintains a list of rows the user adds via its
 * "+ Add …" modal. `file` carries the actual File for upload once a
 * backend lands; `fileName` is what we render in the table today. */
/* `existingPath` is set when the row came back from /vendors/{id} on
 * edit-mode prefill — it carries the server-side storage path so the
 * KYC re-save can ship `existing_path` to the controller and skip the
 * file upload when the user didn't replace it. Picking a new file
 * clears it via the FileChooser's onPick handler. */
export type DueDiligenceRow = {
  id: string;
  code: string;              // DD-001, DD-002, …
  documentName: string;
  issuingAuthority: string;
  expiry: string;            // 'N/A' | 'MM/YYYY'
  mandatory: boolean;
  file: File | null;
  fileName: string;
  existingPath?: string;
  /** Pre-resolved URL from the backend (via file_url(), matches the URL
   *  scheme used for client/branch profile photos). Prefer this over
   *  composing a URL from existingPath — it understands Azure Blob
   *  Storage where Storage::url() is the authoritative builder. */
  existingUrl?: string;
};

export type OwnerKycRow = {
  id: string;
  code: string;              // KYC-001, KYC-002, …
  documentName: string;
  issuingAuthority: string;
  documentNumber: string;
  issueDate: string;         // dd/mm/yyyy
  expiry: string;
  status: 'Active' | 'Inactive';
  file: File | null;
  fileName: string;
  existingPath?: string;
  existingUrl?: string;
};

export type TradeLicenseRow = {
  id: string;
  code: string;              // TL-001, TL-002, …
  licenseType: string;       // label from license_name master (or free text)
  licenseNumber: string;
  issuingAuthority: string;
  issueDate: string;
  expiryDate: string;
  file: File | null;
  fileName: string;
  existingPath?: string;
  existingUrl?: string;
};

export type BankRow = {
  id: string;
  bankName: string;
  branchName: string;
  accountNumber: string;
  ifsc: string;
  branchAddress: string;
  chequeFile: File | null;
  chequeFileName: string;
  existingPath?: string;
  existingUrl?: string;
};

export type GstScrutinyRow = {
  id: string;
  gstNumber: string;
  status: 'Active' | 'Suspended' | 'Cancelled';
  lastFilingDate: string;
  prevNonGst2aInvoice: string;
  redFlags: string;
};

/* Step 3 — Trade Documents (signature workflow on a preset list).
 * `db_id` is the clm_trade_doc_library.id used by the Zoho-Sign send
 * modal; null for rows that came from the legacy SEED_TRADE_DOCS
 * fallback (those can't be sent since they don't map to a library
 * draft). `signedUrl` and `signatureRequestId` are set by the polling
 * loop once the live signature status is fetched. */
export type TradeDocRow = {
  code: string;             // TD-001, TD-002, …
  name: string;             // 'Vendor / Supplier Agreement'
  db_id: number | null;
  sendForSignature: boolean;
  status: 'N/A' | 'Sent' | 'Signed' | 'inprogress' | 'completed' | 'declined' | 'recalled' | 'expired';
  attachment: File | null;
  attachmentName: string;
  signatureRequestId?: number;
  signedUrl?: string;
  /* Set by the parent right before rendering — true when this row's
   * signatureRequestId is inside the active 60-second Resend cooldown.
   * The button locks so a multi-doc bundle can't fire one reminder
   * email per doc. */
  cooldownActive?: boolean;
};

/* Step 4 — product-vendor mapping rows with pricing. */
export type ProductMappingRow = {
  id: string;
  productId: number | null;     // FK to products.id (when picked from API)
  productCode: string;
  productName: string;
  hsnSacCode: string;
  segment: string;
  batchSerialLot: string;
  purchasePrice: number;
  gstPercentage: number;
  gstAmount: number;
  totalAmount: number;
};

type StepKey = 1 | 2 | 3 | 4;
type IdTab = 'identification' | 'address';
type KycTab = 'company' | 'owner' | 'license' | 'bank' | 'gst';

/* Forward order of the Step 2 sub-tabs — drives "Save & Next" pagination
 * so the user walks Company DD → Owner KYC → Trade License → Bank → GST
 * before advancing to Step 3. Clicking any pill in the header still
 * jumps freely; this only controls what the footer button does. */
const KYC_TAB_ORDER: KycTab[] = ['company', 'owner', 'license', 'bank', 'gst'];

/* Forward order of the Step 3 → KYC sub-pills. Save & Next walks
 * Owner KYC → Company Due Diligence → Trade License, then flips the
 * Step 3 top tab to "Trade Documents", then advances to Step 4. */
const KYC_SUB_ORDER: KycSubTab[] = ['owner', 'company', 'license'];
type TradeTab = 'kyc' | 'trade';
type KycSubTab = 'owner' | 'company' | 'license';

/* Classification dropdowns (Vendor Type, Risk Level, Vendor Behaviour,
 * Segment, Compliance Behaviour, Country, State) are all loaded from
 * their masters via the API loader effect inside the component.
 * Each dropdown's value is the master row's id — see the schema on
 * vendors.vendor_type_id / risk_level_id / segment_id etc. */

/* ─── Step 2 seed rows ─────────────────────────────────────────────
 * Both DD and Trade License now start empty — the user adds every
 * row via the "+ Add …" modal. The previous seeded "Certificate of
 * Incorporation" / "IEC" rows were misleading on imports where those
 * docs aren't applicable, and forced an extra delete click anyway. */
const SEED_DD: DueDiligenceRow[] = [];

const SEED_TRADE_LICENSE: TradeLicenseRow[] = [];

/* Step 3 — Trade Documents preset list. These are common B2B agreements
 * an onboarder typically sends for e-signature. Status flips to 'Sent'
 * when the user clicks the row's Send button. */
const SEED_TRADE_DOCS: TradeDocRow[] = [
  { code: 'TD-001', name: 'Vendor / Supplier Agreement',            db_id: null, sendForSignature: false, status: 'N/A', attachment: null, attachmentName: '' },
  { code: 'TD-002', name: 'Non-Disclosure Agreement (NDA)',         db_id: null, sendForSignature: false, status: 'N/A', attachment: null, attachmentName: '' },
  { code: 'TD-003', name: 'Declaration of Compliance / Conformity', db_id: null, sendForSignature: false, status: 'N/A', attachment: null, attachmentName: '' },
  { code: 'TD-004', name: 'Quality Assurance Agreement',            db_id: null, sendForSignature: false, status: 'N/A', attachment: null, attachmentName: '' },
  { code: 'TD-005', name: 'Service Level Agreement (SLA)',          db_id: null, sendForSignature: false, status: 'N/A', attachment: null, attachmentName: '' },
];

/* ──────────────────────────────────────────────────────────────────────────
 * Component
 * ────────────────────────────────────────────────────────────────────── */
export default function AddVendorModal(props: {
  /** Existing vendor id to edit; omit or pass null to create a new one. */
  vendorId?: number | null;
  /** Optional step to land on when the modal opens — used by row
   *  actions like "Map Products" that want to drop the user
   *  straight onto Step 4 instead of replaying Step 1. Ignored in
   *  create mode (no vendorId) so we never skip past required setup. */
  initialStep?: StepKey;
  onClose: () => void;
  onSubmit: (payload: VendorPayload) => void;
}) {
  const { onClose, onSubmit, vendorId: initialVendorId, initialStep } = props;
  const toast = useToast();
  const isEdit = !!initialVendorId;

  /* ─── Wizard navigation ─── */
  const [step, setStep] = useState<StepKey>(isEdit && initialStep ? initialStep : 1);
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
  const [behaviourOpts,  setBehaviourOpts]      = useState<Opt[]>([]);
  const [countryOpts,    setCountryOpts]        = useState<Opt[]>([]);
  /* master_states drives the State dropdown — full per-country list
     (1800+ rows across 90+ countries). Loaded once on mount and
     cascaded off the selected Country via the `country_id` field. */
  const [stateRows, setStateRows] = useState<Array<{
    id: string;
    name: string;
    country_id: string;
  }>>([]);
  /* master_state_codes — only used for the State Code auto-fill once
     a state is picked. Most countries have no entries here (it was
     seeded for India only at boot); the State dropdown must not be
     gated by it or non-Indian countries would show zero options.
     Each row carries `state_id` (the FK into master_states) and
     `state_code` (the value we auto-fill into the State Code field). */
  const [stateCodeRows, setStateCodeRows] = useState<Array<{
    id: string;
    state_id: string;
    state_code: string;
    state_name: string;
    country_id: string;
  }>>([]);
  /* The State dropdown is now declared further down (after `country`
     is in scope) so it can cascade off the selected country. See
     `stateOpts` below the country/state useState block. */

  /* ─── Per-field validation errors keyed by field name ─── */
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const clearFieldError = (k: string) => {
    setFieldErrors(prev => {
      if (!prev[k]) return prev;
      const next = { ...prev };
      delete next[k];
      return next;
    });
  };

  /* ─── Master Quick-Add state (matches the Add Product wizard pattern) ─── */
  const [quickAdd, setQuickAdd] = useState<VendorMasterSlug | null>(null);

  /* Persisted vendor id — null until the first step (Identity) is saved.
     Every subsequent step PUT/POST targets /vendors/{vendorId}/step/… so
     the wizard treats this as required after Step 1 advances. When the
     caller passes a vendorId prop (edit mode), it's pre-set here and a
     load-effect fetches the existing data to prefill the form. */
  const [vendorId, setVendorId] = useState<number | null>(initialVendorId ?? null);
  /* Vendor code surfaced in the carried-over header on later steps.
     Populated from /vendors/{id} on edit-mode load; new vendors get
     their code only after Step 1 saves, so it stays blank until then. */
  const [vendorCode, setVendorCode] = useState<string>('');
  const [saving,   setSaving]   = useState(false);
  const [loadingEdit, setLoadingEdit] = useState(isEdit);

  /* ─── Step 1: Identification ─── */
  const [companyName, setCompanyName] = useState('');
  const [legalName,   setLegalName]   = useState('');
  const [vendorType,  setVendorType]  = useState('');
  const [website,     setWebsite]     = useState('');
  const [riskLevel,   setRiskLevel]   = useState('');
  const [vendorBehaviour, setVendorBehaviour] = useState('');
  /* Segment is multi-valued — array of segment ids (as strings) so a
   * supplier can be tagged with several segments and the segment-rule
   * resolver unions all their KYC/DD/TL/TD/QC docs into Step 2/3. The
   * legacy `segment_id` column is scalar, so on save we send the first
   * id as `segment_id` and the joined list as `segment_ids`. */
  const [segment,     setSegment]     = useState<string[]>([]);
  const [complianceBehaviour, setComplianceBehaviour] = useState('');

  /* Segment-rule template — resolved KYC/DD/TL/TD/QC master rows for the
   * currently-selected supplier segment. Renders as a reference banner
   * above the Step 2 Company DD and Trade License tables so onboarders
   * see the segment's required uploads at a glance. Stays empty when no
   * segment is picked or the segment has no rule configured. */
  type SegDocRow = { id:number; code:string; name:string; authority?:string|null; expiry?:string|null; status?:string; requirement:'M'|'O' };
  type SegmentDocs = { kyc: SegDocRow[]; dd: SegDocRow[]; tl: SegDocRow[]; td: SegDocRow[]; qc: SegDocRow[] };
  const EMPTY_SEG_DOCS: SegmentDocs = { kyc:[], dd:[], tl:[], td:[], qc:[] };
  const [segmentDocs, setSegmentDocs] = useState<SegmentDocs>(EMPTY_SEG_DOCS);

  /* Per-row file uploads against the segment-rule reference rows in
   * Step 2 (Company DD / Owner KYC / Trade License). Key:
   * `${kycTab}::${doc.code}`. Value: File + blob URL. Reset on modal
   * close — held at this level (not inside SupplierSegmentRefTable)
   * so switching sub-tabs doesn't drop uploads. */
  type SegRefUpload = { file: File | null; url: string; name: string };
  const [segmentRefUploads, setSegmentRefUploads] = useState<Record<string, SegRefUpload>>({});

  /* Persist a segment-rule reference upload so it lands in
   * segment_doc_uploads (where the Evidence Vault reads from). The
   * three vendor KYC sub-tabs map directly onto the three categories:
   *   company → dd, owner → kyc, license → tl. */
  const SUB_TO_CAT_V: Record<string, 'kyc' | 'dd' | 'tl'> = {
    company: 'dd',
    owner:   'kyc',
    license: 'tl',
  };
  const persistSegmentRefUpload = async (refKey: string, file: File, docName: string) => {
    const ownerId = vendorId || initialVendorId || null;
    if (!ownerId) {
      // Vendor row needs to exist before /segment-uploads/supplier/{id}
      // can write. The supplier form posts on Step 1 save so this only
      // bites if the user uploads before saving Step 1.
      return;
    }
    const [sub, doc_code] = refKey.split('::');
    const category = SUB_TO_CAT_V[sub];
    if (!category || !doc_code) return;
    const fd = new FormData();
    fd.append('category', category);
    fd.append('doc_code', doc_code);
    fd.append('doc_name', docName || doc_code);
    fd.append('attachment', file);
    try {
      const { data } = await api.post(`/segment-uploads/supplier/${ownerId}`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const row = data?.data;
      if (row?.attachment_url) {
        setSegmentRefUploads(prev => {
          const existing = prev[refKey];
          if (existing?.url && existing.url.startsWith('blob:')) {
            try { URL.revokeObjectURL(existing.url); } catch {}
          }
          return {
            ...prev,
            [refKey]: { file: null, url: row.attachment_url, name: row.attachment_name || file.name },
          };
        });
      }
    } catch {
      // Silent — keep blob URL in state so the user still sees the upload
    }
  };

  /* ─── Step 1: Address + primary contact ─── */
  const [registeredOffice, setRegisteredOffice] = useState('');
  const [country,   setCountry]   = useState('');
  const [state,     setState]     = useState('');
  const [stateCode, setStateCode] = useState('');
  const [city,      setCity]      = useState('');
  const [pincode,   setPincode]   = useState('');

  /* State dropdown options. Source is master_states (the full per-
     country list), filtered by the selected Country. Country is the
     master_countries id stored as a string, so the comparison matches
     `country_id` (also stringified) directly. When no country is
     picked yet we show every state — the cascade narrows it as soon
     as the user chooses one. */
  const stateOpts = useMemo<Opt[]>(() => {
    const filtered = country
      ? stateRows.filter(r => r.country_id === country)
      : stateRows;
    return filtered
      .map(r => ({ value: r.id, label: r.name }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [stateRows, country]);
  const [contactName, setContactName] = useState('');
  const [designation, setDesignation] = useState('');
  const [contactNo,   setContactNo]   = useState('');
  const [email,       setEmail]       = useState('');
  const [whatsappEnabled, setWhatsappEnabled] = useState(true);
  const [attachment, setAttachment] = useState<File | null>(null);
  /* Server-side path for the primary contact's previously uploaded
     business card. Hydrated from primary_address.attachment_path on
     edit-mode load so the table cell can render a working View link
     without a fresh upload. */
  const [primaryAttachmentPath, setPrimaryAttachmentPath] = useState<string>('');

  type ContactRow = {
    id: number;
    name: string;
    designation: string;
    phone: string;
    email: string;
    whatsapp: boolean;
    attachmentName: string;
    /* Server-stored path — present when the row was hydrated from
       /vendors/{id}. Empty for freshly-added rows that haven't been
       saved yet. */
    attachmentPath?: string;
    /* Freshly-picked File — set while the popup is open so the
       FileChooser can render a blob: preview URL with View + Delete
       buttons before the row is persisted. Cleared on save. */
    attachmentFile?: File | null;
  };
  const [extraContacts, setExtraContacts] = useState<ContactRow[]>([]);

  /* Contact-person popup (mirrors the QcAddPopup pattern used in the
     Add Product wizard). The popup lives outside the main scroll area
     so it always stays centred when the form is long. */
  const [contactPopupOpen, setContactPopupOpen] = useState(false);
  const [contactDraft, setContactDraft] = useState<Omit<ContactRow, 'id'>>({
    name: '', designation: '', phone: '', email: '', whatsapp: true, attachmentName: '', attachmentFile: null,
  });


  /* ─── Step 2: KYC / Due Diligence — one row list per tab ─── */
  const [ddRows,      setDdRows]      = useState<DueDiligenceRow[]>(SEED_DD);
  const [ownerRows,   setOwnerRows]   = useState<OwnerKycRow[]>([]);
  const [licenseRows, setLicenseRows] = useState<TradeLicenseRow[]>(SEED_TRADE_LICENSE);
  const [bankRows,    setBankRows]    = useState<BankRow[]>([]);
  const [gstRows,     setGstRows]     = useState<GstScrutinyRow[]>([]);

  /* ─── Step 2: per-modal draft + open flag ─── */
  type DdDraft     = Omit<DueDiligenceRow, 'id' | 'code'>;
  type OwnerDraft  = Omit<OwnerKycRow,    'id' | 'code'>;
  type LicDraft    = Omit<TradeLicenseRow,'id' | 'code'>;
  type BankDraft   = Omit<BankRow,        'id'>;
  type GstDraft    = Omit<GstScrutinyRow, 'id'>;
  const EMPTY_DD_DRAFT: DdDraft = { documentName: '', issuingAuthority: '', expiry: 'N/A', mandatory: false, file: null, fileName: '' };
  const EMPTY_OWNER_DRAFT: OwnerDraft = { documentName: '', issuingAuthority: '', documentNumber: '', issueDate: '', expiry: '', status: 'Active', file: null, fileName: '' };
  const EMPTY_LIC_DRAFT: LicDraft = { licenseType: '', licenseNumber: '', issuingAuthority: '', issueDate: '', expiryDate: '', file: null, fileName: '' };
  const EMPTY_BANK_DRAFT: BankDraft = { bankName: '', branchName: '', accountNumber: '', ifsc: '', branchAddress: '', chequeFile: null, chequeFileName: '' };
  const EMPTY_GST_DRAFT: GstDraft = { gstNumber: '', status: 'Active', lastFilingDate: '', prevNonGst2aInvoice: '', redFlags: '' };

  const [ddPopupOpen,    setDdPopupOpen]    = useState(false);
  const [ownerPopupOpen, setOwnerPopupOpen] = useState(false);
  const [licPopupOpen,   setLicPopupOpen]   = useState(false);
  const [bankPopupOpen,  setBankPopupOpen]  = useState(false);
  const [gstPopupOpen,   setGstPopupOpen]   = useState(false);

  const [ddDraft,    setDdDraft]    = useState<DdDraft>(EMPTY_DD_DRAFT);
  const [ownerDraft, setOwnerDraft] = useState<OwnerDraft>(EMPTY_OWNER_DRAFT);
  const [licDraft,   setLicDraft]   = useState<LicDraft>(EMPTY_LIC_DRAFT);
  const [bankDraft,  setBankDraft]  = useState<BankDraft>(EMPTY_BANK_DRAFT);
  const [gstDraft,   setGstDraft]   = useState<GstDraft>(EMPTY_GST_DRAFT);

  /* license_name master powers the License Type dropdown on the
     Trade License modal. Loaded lazily the first time the modal opens
     to avoid an extra fetch on initial mount. */
  const [licenseTypeOpts, setLicenseTypeOpts] = useState<Opt[]>([]);

  /* Hydrate segmentRefUploads on edit-mode open so the KYC / DD / Trade
   * License tables show what was previously attached. Reads the same
   * segment_doc_uploads table the Evidence Vault uses. */
  useEffect(() => {
    if (!initialVendorId) return;
    let cancelled = false;
    api.get(`/segment-uploads/supplier/${initialVendorId}`)
      .then((r) => {
        if (cancelled) return;
        const refs: any[] = Array.isArray(r.data?.data) ? r.data.data : [];
        const CAT_TO_SUB: Record<string, string> = { dd: 'company', kyc: 'owner', tl: 'license' };
        const hydrated: Record<string, SegRefUpload> = {};
        for (const x of refs) {
          const sub = CAT_TO_SUB[x.category];
          if (!sub || !x.doc_code) continue;
          hydrated[`${sub}::${x.doc_code}`] = { file: null, url: x.attachment_url || '', name: x.attachment_name || '' };
        }
        if (Object.keys(hydrated).length > 0) setSegmentRefUploads(hydrated);
      })
      .catch(() => { /* silent — leave the table empty */ });
    return () => { cancelled = true; };
  }, [initialVendorId]);

  /* ─── Step 3: Trade Documents (preset signature workflow) ─── */
  const [tradeDocRows, setTradeDocRows] = useState<TradeDocRow[]>(SEED_TRADE_DOCS);
  /* Send for Signature — when non-null the Zoho Sign wizard pops with
   * the listed clm_trade_doc_library ids pre-checked. modelName='Vendor'
   * makes the backend resolve {{supplier.*}} tokens with this vendor. */
  const [sendForSignature, setSendForSignature] = useState<number[] | null>(null);
  const [sigStatusByDoc, setSigStatusByDoc] = useState<Record<number, { status: TradeDocRow['status']; signatureRequestId: number; signedUrl?: string }>>({});

  /* Resend cooldown — same pattern as the customer + consignee modals.
   * Zoho's remind API operates per-REQUEST so a multi-doc bundle gets
   * ONE reminder email no matter how many rows in the bundle the user
   * clicks Resend on. We seed a 60s cooldown on the
   * signature_request_id; every sibling row's Resend button locks
   * visually until the timer expires. */
  const [recentReminds, setRecentReminds] = useState<Record<number, number>>({});
  useEffect(() => {
    const expiries = Object.values(recentReminds);
    if (expiries.length === 0) return;
    const earliest = Math.min(...expiries);
    const wait = Math.max(50, earliest - Date.now() + 50);
    const id = window.setTimeout(() => {
      setRecentReminds(prev => {
        const now = Date.now();
        const fresh: Record<number, number> = {};
        for (const k in prev) if (prev[k] > now) fresh[+k] = prev[k];
        return fresh;
      });
    }, wait);
    return () => window.clearTimeout(id);
  }, [recentReminds]);
  const isReminderCooldown = (reqId?: number | null): boolean => !!reqId && (recentReminds[reqId] ?? 0) > Date.now();
  const reminderCooldownSeconds = (reqId?: number | null): number => {
    if (!reqId) return 0;
    return Math.max(0, Math.ceil(((recentReminds[reqId] ?? 0) - Date.now()) / 1000));
  };

  /* ─── Step 4: Product mappings + Add Product Mapping modal ─── */
  type ProductOpt = {
    value: string;             // product id as string
    label: string;             // product_code — name
    code: string;
    name: string;
    hsn: string;
    segment: string;
    /* Auto-seed values pulled from the product itself — picking a
       product in the mapping modal pre-fills Purchase Price and GST %
       so the user only confirms or overrides. */
    basePrice: string;
    gstPercentage: string;
  };
  const [productOpts,    setProductOpts]    = useState<ProductOpt[]>([]);
  const [gstPctOpts,     setGstPctOpts]     = useState<Opt[]>([]);
  const [productMappings, setProductMappings] = useState<ProductMappingRow[]>([]);
  const [mapPopupOpen,   setMapPopupOpen]   = useState(false);

  type MapDraft = {
    productId: string;         // '' = nothing picked
    productCode: string;
    productName: string;
    hsnSacCode: string;
    segment: string;
    batchSerialLot: string;
    purchasePrice: string;     // string while editing — parsed on save
    gstPercentage: string;
    gstAmount: string;
    totalAmount: string;
  };
  const EMPTY_MAP_DRAFT: MapDraft = { productId: '', productCode: '', productName: '', hsnSacCode: '', segment: '', batchSerialLot: '', purchasePrice: '', gstPercentage: '', gstAmount: '', totalAmount: '' };
  const [mapDraft,       setMapDraft]       = useState<MapDraft>(EMPTY_MAP_DRAFT);

  /* ─── Body scroll lock ─── */
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  /* ─── Master loader — every classification dropdown on the form
   *
   *   Vendor Type            → customer_types        (label: name)
   *   Risk Level             → risk_levels           (label: name)
   *   Vendor Behaviour       → vendor_behaviour      (label: name)
   *   Vendor Segment         → segments              (label: title)
   *   Compliance Behaviour   → compliance_behaviours (label: name)
   *   Country                → countries             (label: name)
   *   State + State Code     → state_codes (eager-loads state.name) so
   *                            one fetch drives both the State dropdown
   *                            AND the State Code auto-fill.
   * ──────────────────────────────────────────────────────────── */
  useEffect(() => {
    type Row = Record<string, unknown> & { id: number | string; status?: string };
    /* Master rows ship to the dropdown as { value: id, label: name } so
       the form state carries FK ids the backend can persist directly
       (vendor_type_id, risk_level_id, segment_id, …). The PrevField
       summary still wants the label, so we resolve via labelFor(...). */
    const fetchMaster = async (slug: string, labelKey: string): Promise<Opt[]> => {
      try {
        const res = await api.get<Row[]>(`/master/${slug}`);
        return (res.data || [])
          .filter(r => String(r.status ?? '').toLowerCase() !== 'inactive')
          .map(r => ({ value: String(r.id), label: String(r[labelKey] ?? '') }))
          .filter(o => o.value !== '' && o.label !== '');
      } catch {
        return [];
      }
    };
    const fetchStateCodes = async () => {
      try {
        type Sc = {
          id: number | string;
          state_id: number | string;
          state_code: string;
          status?: string;
          state?: { id?: number; name?: string; country_id?: number | string };
        };
        const res = await api.get<Sc[]>(`/master/state_codes`);
        return (res.data || [])
          .filter(r => String(r.status ?? '').toLowerCase() !== 'inactive')
          .map(r => ({
            id: String(r.id),
            state_id: String(r.state_id ?? ''),
            state_code: String(r.state_code ?? ''),
            state_name: String(r.state?.name ?? ''),
            country_id: String(r.state?.country_id ?? ''),
          }))
          .filter(r => r.state_name !== '');
      } catch {
        return [] as Array<{ id: string; state_id: string; state_code: string; state_name: string; country_id: string }>;
      }
    };
    /* master_states is the full per-country state list. Pulled
       directly here (instead of relying on state_codes' eager-loaded
       relation) because state_codes only carries ~10 Indian rows —
       picking any other country was returning an empty State dropdown
       before this. country_id rides along so the dropdown can cascade
       off the chosen Country. */
    const fetchStates = async () => {
      try {
        type S = { id: number | string; name?: string; country_id?: number | string; status?: string };
        const res = await api.get<S[]>(`/master/states`);
        return (res.data || [])
          .filter(r => String(r.status ?? '').toLowerCase() !== 'inactive')
          .map(r => ({
            id: String(r.id),
            name: String(r.name ?? ''),
            country_id: String(r.country_id ?? ''),
          }))
          .filter(r => r.name !== '');
      } catch {
        return [] as Array<{ id: string; name: string; country_id: string }>;
      }
    };
    (async () => {
      const [vt, rl, bh, sg, cb, co, sc, st] = await Promise.all([
        fetchMaster('vendor_types',          'name'),
        fetchMaster('risk_levels',           'name'),
        fetchMaster('vendor_behaviour',      'name'),
        fetchMaster('segments',              'title'),
        fetchMaster('compliance_behaviours', 'name'),
        fetchMaster('countries',             'name'),
        fetchStateCodes(),
        fetchStates(),
      ]);
      setVendorTypeOpts(vt);
      setRiskLevelOpts(rl);
      setBehaviourOpts(bh);
      setSegmentOpts(sg);
      setComplianceOpts(cb);
      setCountryOpts(co);
      setStateCodeRows(sc);
      setStateRows(st);
    })();
  }, []);

  /* Segment-rule template fetch (multi-segment). The supplier
   * `segment` state is an array of DB ids (stringified). For each id
   * we hit the resolver in parallel and merge category arrays —
   * deduped by `code`, with Mandatory winning over Optional so a doc
   * required by any segment stays mandatory in the union. */
  useEffect(() => {
    /* Selection changed → previously-attached uploads no longer match
     * (the DCP rule's codes are different). Wipe them and revoke
     * blob URLs so the GC can reclaim. */
    setSegmentRefUploads(prev => {
      Object.values(prev).forEach(u => { try { URL.revokeObjectURL(u.url); } catch {} });
      return {};
    });

    const ids = (segment ?? [])
      .map(s => Number(s))
      .filter(n => Number.isFinite(n) && n > 0);
    if (ids.length === 0) { setSegmentDocs(EMPTY_SEG_DOCS); return; }

    let cancelled = false;
    Promise.all([
      Promise.all(
        ids.map(id =>
          api.get(`/clm/segment-rules/for-segment/${id}`)
            .then(r => r.data?.data ?? {})
            .catch(() => ({}))
        )
      ),
      /* Party filter for the supplier (vendor) form: trade docs whose
       * `party` CSV mentions ANY Supplier-* sub-type. The endpoint
       * matches Supplier-Material / Logistic / Tech / Advisory /
       * Strategic Risk. Intersected with segment-rule td below. */
      api.get('/clm/trade-doc-library/for-party/supplier')
        .then(r => Array.isArray(r.data?.data) ? r.data.data : [])
        .catch(() => [] as Array<{ code: string; name: string }>),
    ]).then(([results, partyDocs]) => {
      if (cancelled) return;
      const mergeCat = (cat: 'kyc'|'dd'|'tl'|'td'|'qc'): SegDocRow[] => {
        const map = new Map<string, SegDocRow>();
        for (const r of results) {
          const rows: SegDocRow[] = Array.isArray(r?.[cat]) ? r[cat] : [];
          for (const d of rows) {
            const existing = map.get(d.code);
            if (!existing) { map.set(d.code, d); continue; }
            if (existing.requirement !== 'M' && d.requirement === 'M') {
              map.set(d.code, { ...existing, requirement: 'M' });
            }
          }
        }
        return Array.from(map.values());
      };
      const partyById = new Map<string, number>(
        (partyDocs as Array<{ code: string; id: number }>).map(p => [p.code, p.id]),
      );
      const mergedTd = mergeCat('td').filter(d => partyById.has(d.code));
      setSegmentDocs({
        kyc: mergeCat('kyc'),
        dd:  mergeCat('dd'),
        tl:  mergeCat('tl'),
        td:  mergedTd,
        qc:  mergeCat('qc'),
      });
      /* Drive the Step 3 Trade Documents signature workflow from the
       * segment × party intersection. Mandatory rows arrive pre-checked.
       * Falls back to the legacy seed list when the intersection is
       * empty so the table is never blank — those rows have db_id=null
       * and can't be sent (Send is gated on db_id). */
      if (mergedTd.length > 0) {
        setTradeDocRows(mergedTd.map(d => ({
          code: d.code,
          name: d.name,
          db_id: partyById.get(d.code) ?? null,
          sendForSignature: d.requirement === 'M',
          status: 'N/A' as const,
          attachment: null,
          attachmentName: '',
        })));
      }
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segment]);

  /* Poll live signature-request status every 15s while the user is on
   * Step 3 → Trade Documents. ?sync=true makes the backend pull each
   * inprogress row from Zoho so completed signings appear in the badges
   * without a refresh — same pattern as Customer/Consignee Stage 3.
   * Keyed on `vendorId` (not `initialVendorId`) so the poller also kicks
   * in for newly-created vendors once Stage 1→2 has saved a row. */
  useEffect(() => {
    if (!vendorId || step !== 3 || tradeTab !== 'trade') return;
    let cancelled = false;
    const fetchAndUpdate = async (withSync: boolean) => {
      try {
        const r = await api.get('/clm/signature-requests', {
          params: { party_id: vendorId, model_name: 'Vendor', sync: withSync ? 1 : 0 },
        });
        if (cancelled) return;
        const rows: Array<{
          id: number;
          status: TradeDocRow['status'];
          trade_doc_ids: number[];
          signed_document_paths?: Array<{ url?: string; path?: string }> | null;
        }> = Array.isArray(r.data?.data) ? r.data.data : [];
        const map: Record<number, { status: TradeDocRow['status']; signatureRequestId: number; signedUrl?: string }> = {};
        for (const row of rows) {
          const ids = Array.isArray(row.trade_doc_ids) ? row.trade_doc_ids : [];
          for (let i = 0; i < ids.length; i++) {
            const docId = Number(ids[i]);
            if (!docId || map[docId]) continue;
            const signedEntry = Array.isArray(row.signed_document_paths) ? row.signed_document_paths[i] : null;
            map[docId] = {
              status: row.status,
              signatureRequestId: row.id,
              signedUrl: signedEntry?.url || (signedEntry?.path ? `/storage/${signedEntry.path}` : undefined),
            };
          }
        }
        setSigStatusByDoc(map);
      } catch { /* silent — polling failures shouldn't toast every 15s */ }
    };
    fetchAndUpdate(false);
    const iv = window.setInterval(() => fetchAndUpdate(true), 15000);
    return () => { cancelled = true; window.clearInterval(iv); };
  }, [vendorId, step, tradeTab]);

  // Project polled status into tradeDocRows.
  useEffect(() => {
    setTradeDocRows(prev => prev.map(r => {
      if (!r.db_id) return r;
      const info = sigStatusByDoc[r.db_id];
      if (!info) return r;
      return {
        ...r,
        status: info.status,
        signatureRequestId: info.signatureRequestId,
        signedUrl: info.signedUrl ?? r.signedUrl,
      };
    }));
  }, [sigStatusByDoc]);

  /* ──────────────────────────────────────────────────────────────────
   * Edit-mode prefill — fires once on mount when the parent passed an
   * existing vendor id. Hits GET /vendors/{id} (whose response is the
   * controller's `shape()`) and pours every field back into the form
   * state. File rows come back with their server path; we surface the
   * basename so the user sees what's already attached and keep the
   * full path on `existingPath` so the next save can reuse it.
   * ────────────────────────────────────────────────────────────── */
  useEffect(() => {
    if (!initialVendorId) return;
    type ApiAddress = {
      address_line?: string | null; country_id?: number | null; state_id?: number | null;
      state_code?: string | null; city?: string | null; pincode?: string | null;
      contact_name?: string | null; designation?: string | null; contact_no?: string | null;
      email?: string | null; whatsapp_enabled?: boolean;
    };
    type ApiExtra = {
      id: number; contact_name?: string | null; designation?: string | null;
      contact_no?: string | null; email?: string | null; whatsapp_enabled?: boolean;
      attachment_path?: string | null; attachment_url?: string | null;
    };
    type ApiDd = { id: number; code?: string | null; document_name?: string | null; issuing_authority?: string | null; expiry?: string | null; mandatory?: boolean; attachment_path?: string | null; attachment_url?: string | null };
    type ApiOwner = { id: number; code?: string | null; document_name?: string | null; issuing_authority?: string | null; document_number?: string | null; issue_date?: string | null; expiry?: string | null; status?: string | null; attachment_path?: string | null; attachment_url?: string | null };
    type ApiTl = { id: number; code?: string | null; license_type_id?: number | null; license_type_name?: string | null; license_number?: string | null; issuing_authority?: string | null; issue_date?: string | null; expiry_date?: string | null; attachment_path?: string | null; attachment_url?: string | null };
    type ApiBank = { id: number; bank_name?: string | null; branch_name?: string | null; account_number?: string | null; ifsc?: string | null; branch_address?: string | null; cheque_path?: string | null; cheque_url?: string | null };
    type ApiGst = { id: number; gst_number?: string | null; status?: string | null; last_filing_date?: string | null; prev_non_gst_2a_invoice?: string | null; red_flags?: string | null };
    type ApiMapping = { id: number; product_id?: number | null; product_code?: string | null; product_name?: string | null; batch_serial_lot?: string | null; purchase_price?: number | string | null; gst_percentage?: number | string | null; gst_amount?: number | string | null; total_amount?: number | string | null };
    type ApiVendor = {
      id: number;
      vendor_code?: string | null;
      company_name?: string | null; legal_name?: string | null; website?: string | null;
      vendor_type_id?: number | null; risk_level_id?: number | null;
      vendor_behaviour_id?: number | null; segment_id?: number | null;
      compliance_behaviour_id?: number | null;
      primary_address?: ApiAddress | null;
      extra_contacts?: ApiExtra[];
      due_diligence?: ApiDd[];
      owner_kyc?: ApiOwner[];
      trade_licenses?: ApiTl[];
      bank_accounts?: ApiBank[];
      gst_scrutiny?: ApiGst[];
      product_mappings?: ApiMapping[];
    };

    const basename = (p?: string | null): string => {
      if (!p) return '';
      const last = String(p).split('/').pop() ?? '';
      // Backend stores attachments as `{slug}-{rand}__{original}.{ext}`
      // so the original filename can be recovered without a DB
      // migration. If the separator is absent (legacy uploads) we
      // fall back to the raw stored name.
      const sep = last.indexOf('__');
      return sep >= 0 ? last.slice(sep + 2) : last;
    };
    const numStr = (n?: number | null): string => (n ?? '') === '' || n == null ? '' : String(n);

    (async () => {
      try {
        const res = await api.get<{ data: ApiVendor }>(`/vendors/${initialVendorId}`);
        const v = res.data?.data;
        if (!v) return;

        // Step 1 — identity
        setVendorCode(v.vendor_code ?? '');
        setCompanyName(v.company_name ?? '');
        setLegalName(v.legal_name ?? '');
        setWebsite(v.website ?? '');
        setVendorType(numStr(v.vendor_type_id));
        setRiskLevel(numStr(v.risk_level_id));
        setVendorBehaviour(numStr(v.vendor_behaviour_id));
        /* Multi-segment hydration. The legacy `segment_id` column is
         * scalar — when the server starts shipping a `segment_ids`
         * array (or comma-joined string), we honour it; otherwise we
         * fall back to a single-element array sourced from segment_id. */
        const segIds: string[] = Array.isArray((v as any).segment_ids)
          ? (v as any).segment_ids.map((x: any) => String(x)).filter(Boolean)
          : typeof (v as any).segment_ids === 'string'
            ? (v as any).segment_ids.split(',').map((s: string) => s.trim()).filter(Boolean)
            : v.segment_id ? [String(v.segment_id)] : [];
        setSegment(segIds);
        setComplianceBehaviour(numStr(v.compliance_behaviour_id));

        // Step 1 — primary address + extra contacts
        const pa = v.primary_address;
        if (pa) {
          setRegisteredOffice(pa.address_line ?? '');
          setCountry(numStr(pa.country_id));
          setState(numStr(pa.state_id));
          setStateCode(pa.state_code ?? '');
          setCity(pa.city ?? '');
          setPincode(pa.pincode ?? '');
          setContactName(pa.contact_name ?? '');
          setDesignation(pa.designation ?? '');
          setContactNo(pa.contact_no ?? '');
          setEmail(pa.email ?? '');
          setWhatsappEnabled(pa.whatsapp_enabled ?? true);
          setPrimaryAttachmentPath(pa.attachment_path ?? '');
        }
        setExtraContacts((v.extra_contacts ?? []).map(c => ({
          id: c.id,
          name: c.contact_name ?? '',
          designation: c.designation ?? '',
          phone: c.contact_no ?? '',
          email: c.email ?? '',
          whatsapp: c.whatsapp_enabled ?? true,
          attachmentName: basename(c.attachment_path),
          attachmentPath: c.attachment_path ?? undefined,
        })));

        // Step 2 — KYC sub-collections (file fields restored via existingPath
        // + existingUrl). `existingUrl` is the backend-resolved file_url()
        // value (same helper that powers client/branch profile photos and
        // knows how to address Azure Blob Storage); we hand that to the
        // FileChooser so View links don't try to compose Azure URLs from
        // a raw path on the frontend.
        setDdRows((v.due_diligence ?? []).map(r => ({
          id: String(r.id),
          code: r.code ?? '',
          documentName: r.document_name ?? '',
          issuingAuthority: r.issuing_authority ?? '',
          expiry: r.expiry ?? '',
          mandatory: !!r.mandatory,
          file: null,
          fileName: basename(r.attachment_path),
          existingPath: r.attachment_path ?? undefined,
          existingUrl: r.attachment_url ?? undefined,
        })));
        setOwnerRows((v.owner_kyc ?? []).map(r => ({
          id: String(r.id),
          code: r.code ?? '',
          documentName: r.document_name ?? '',
          issuingAuthority: r.issuing_authority ?? '',
          documentNumber: r.document_number ?? '',
          issueDate: r.issue_date ?? '',
          expiry: r.expiry ?? '',
          status: (r.status === 'Inactive' ? 'Inactive' : 'Active'),
          file: null,
          fileName: basename(r.attachment_path),
          existingPath: r.attachment_path ?? undefined,
          existingUrl: r.attachment_url ?? undefined,
        })));
        setLicenseRows((v.trade_licenses ?? []).map(r => ({
          id: String(r.id),
          code: r.code ?? '',
          // licenseType in form state carries the master id (matches the
          // ID-based License Type dropdown). Falls back to the joined
          // name if the id is missing — keeps old rows readable.
          licenseType: r.license_type_id != null ? String(r.license_type_id) : (r.license_type_name ?? ''),
          licenseNumber: r.license_number ?? '',
          issuingAuthority: r.issuing_authority ?? '',
          issueDate: r.issue_date ?? '',
          expiryDate: r.expiry_date ?? '',
          file: null,
          fileName: basename(r.attachment_path),
          existingPath: r.attachment_path ?? undefined,
          existingUrl: r.attachment_url ?? undefined,
        })));
        setBankRows((v.bank_accounts ?? []).map(r => ({
          id: String(r.id),
          bankName: r.bank_name ?? '',
          branchName: r.branch_name ?? '',
          accountNumber: r.account_number ?? '',
          ifsc: r.ifsc ?? '',
          branchAddress: r.branch_address ?? '',
          chequeFile: null,
          chequeFileName: basename(r.cheque_path),
          existingPath: r.cheque_path ?? undefined,
          existingUrl: r.cheque_url ?? undefined,
        })));
        setGstRows((v.gst_scrutiny ?? []).map(r => ({
          id: String(r.id),
          gstNumber: r.gst_number ?? '',
          status: (r.status === 'Suspended' || r.status === 'Cancelled' ? r.status : 'Active'),
          lastFilingDate: r.last_filing_date ?? '',
          prevNonGst2aInvoice: r.prev_non_gst_2a_invoice ?? '',
          redFlags: r.red_flags ?? '',
        })));

        // Step 4 — product mappings
        setProductMappings((v.product_mappings ?? []).map(m => ({
          id: String(m.id),
          productId: m.product_id ?? null,
          productCode: m.product_code ?? '',
          productName: m.product_name ?? '',
          hsnSacCode: '',  // not echoed in the index/show shape; refetched if user re-edits
          segment: '',
          batchSerialLot: m.batch_serial_lot ?? '',
          purchasePrice: Number(m.purchase_price ?? 0),
          gstPercentage: Number(m.gst_percentage ?? 0),
          gstAmount: Number(m.gst_amount ?? 0),
          totalAmount: Number(m.total_amount ?? 0),
        })));
      } catch {
        toast.error('Load failed', 'Could not load the supplier — closing the form.');
        onClose();
      } finally {
        setLoadingEdit(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialVendorId]);

  /* Look up a master label by its FK id — used by the "previous stages"
     summary that needs the display name even though form state carries
     the id. Returns '' when nothing matches so callers can `||` to a
     placeholder. */
  const labelFor = (id: string, opts: Opt[]): string =>
    opts.find(o => o.value === id)?.label ?? '';

  /* ──────────────────────────────────────────────────────────────────
   * Step-wise persistence
   *
   *   Step 1 / identification  → POST /vendors/step/identity      sets vendorId
   *   Step 1 / address         → PUT  /vendors/{id}/step/contacts
   *   Step 2 (all 5 tabs)      → POST /vendors/{id}/step/kyc      multipart
   *   Step 3 (Trade Documents) → no backend, just advance
   *   Step 4 / map products    → POST /vendors/{id}/step/products + onSubmit
   *
   * Each handler validates client-side first, then hits the API and
   * advances only on success. The `saving` flag disables the footer
   * button so the user can't double-fire mid-request.
   * ────────────────────────────────────────────────────────────── */

  const saveIdentity = async (): Promise<boolean> => {
    if (!companyName.trim()) { setFieldErrors(e => ({ ...e, companyName: 'Company Name is required' })); toast.error('Missing required fields', 'Company Name is required'); return false; }
    const errs: Record<string, string> = {};
    if (!vendorType)         errs.vendorType          = 'Supplier Type is required';
    if (!riskLevel)          errs.riskLevel           = 'Risk Level is required';
    if (!vendorBehaviour)    errs.vendorBehaviour     = 'Supplier Behaviour is required';
    if (!Array.isArray(segment) || segment.length === 0)
                              errs.segment             = 'Select at least one supplier segment';
    if (!complianceBehaviour) errs.complianceBehaviour = 'Compliance Behaviour is required';
    if (website)             { const e = validateWebsite(website); if (e) errs.website = e; }
    if (Object.keys(errs).length) { setFieldErrors(prev => ({ ...prev, ...errs })); toast.error('Missing required fields', 'Please fix the highlighted fields'); return false; }

    setSaving(true);
    try {
      const res = await api.post<{ data: { id: number } }>('/vendors/step/identity', {
        id: vendorId,
        company_name: companyName,
        legal_name: legalName || null,
        website: website || null,
        vendor_type_id: vendorType ? Number(vendorType) : null,
        risk_level_id: riskLevel ? Number(riskLevel) : null,
        vendor_behaviour_id: vendorBehaviour ? Number(vendorBehaviour) : null,
        /* Multi-segment: the legacy `segment_id` column is scalar so
         * we send the first selected id as primary. `segment_ids` is
         * a comma-joined list for the future column. */
        segment_id: (segment ?? [])[0] ? Number((segment ?? [])[0]) : null,
        segment_ids: (segment ?? []).join(','),
        compliance_behaviour_id: complianceBehaviour ? Number(complianceBehaviour) : null,
      });
      setVendorId(res.data?.data?.id ?? vendorId);
      // Capture the server-assigned vendor_code so the header on
      // later steps can render it without another roundtrip.
      const returnedCode = (res.data?.data as Record<string, unknown> | undefined)?.vendor_code;
      if (typeof returnedCode === 'string' && returnedCode) {
        setVendorCode(returnedCode);
      }
      setFieldErrors({});
      toast.success('Identity saved', 'Vendor identity details captured');
      return true;
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Could not save vendor identity';
      toast.error('Save failed', msg);
      return false;
    } finally {
      setSaving(false);
    }
  };

  const saveContacts = async (): Promise<boolean> => {
    if (!vendorId) { toast.error('Step blocked', 'Save Identity information first.'); return false; }
    const errs: Record<string, string> = {};
    if (!registeredOffice.trim())  errs.registeredOffice = 'Registered Office Address is required';
    if (!country)                  errs.country          = 'Country is required';
    if (!state)                    errs.state            = 'State is required';
    if (!stateCode)                errs.stateCode        = 'State Code is required (pick a State to auto-fill)';
    if (!city.trim())              errs.city             = 'City is required';
    if (!contactName.trim())       errs.contactName      = 'Contact Person Name is required';
    if (!designation.trim())       errs.designation      = 'Designation is required';
    if (!contactNo.trim())         errs.contactNo        = 'Contact No is required';
    if (!email.trim())             errs.email            = 'Email is required';
    if (!errs.email && email)      { const e = validateEmail(email);              if (e) errs.email     = e; }
    if (!errs.contactNo && contactNo) { const e = validateContactNumber(contactNo, 'Contact No'); if (e) errs.contactNo = e; }
    if (pincode)                   { const e = validatePincode(pincode);          if (e) errs.pincode   = e; }
    if (Object.keys(errs).length) { setFieldErrors(prev => ({ ...prev, ...errs })); toast.error('Missing required fields', 'Please fix the highlighted fields'); return false; }

    setSaving(true);
    try {
      await api.put(`/vendors/${vendorId}/step/contacts`, {
        primary_address: {
          address_line: registeredOffice,
          country_id: country ? Number(country) : null,
          state_id:   state   ? Number(state)   : null,
          state_code: stateCode,
          city,
          pincode: pincode || null,
          contact_name: contactName,
          designation,
          contact_no: contactNo,
          email,
          whatsapp_enabled: whatsappEnabled,
        },
        extra_contacts: extraContacts.map(c => ({
          contact_name: c.name,
          designation: c.designation,
          contact_no: c.phone,
          email: c.email,
          whatsapp_enabled: c.whatsapp,
        })),
      });
      setFieldErrors({});
      toast.success('Contacts saved', 'Address & contact persons captured');
      return true;
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Could not save contacts';
      toast.error('Save failed', msg);
      return false;
    } finally {
      setSaving(false);
    }
  };

  const saveKyc = async (): Promise<boolean> => {
    if (!vendorId) { toast.error('Step blocked', 'Save Identity information first.'); return false; }
    const missingDd = ddRows.filter(r => r.mandatory && !r.fileName);
    if (missingDd.length) {
      toast.error('Upload required documents', `Missing file on: ${missingDd.map(r => r.code).join(', ')}`);
      return false;
    }

    /* Build multipart payload. Indexed array notation
       (`due_diligence[0][document_name]`) lets PHP/Laravel parse the
       rows into the validation rules cleanly, and `dd_files[N]` ships
       the new file for row N (or nothing if the row already has an
       existing_path on the backend). */
    const fd = new FormData();
    ddRows.forEach((r, i) => {
      fd.append(`due_diligence[${i}][code]`, r.code);
      fd.append(`due_diligence[${i}][document_name]`, r.documentName);
      fd.append(`due_diligence[${i}][issuing_authority]`, r.issuingAuthority || '');
      fd.append(`due_diligence[${i}][expiry]`, r.expiry || '');
      fd.append(`due_diligence[${i}][mandatory]`, r.mandatory ? '1' : '0');
      if (r.file) fd.append(`dd_files[${i}]`, r.file);
      else if (r.existingPath) fd.append(`due_diligence[${i}][existing_path]`, r.existingPath);
    });
    ownerRows.forEach((r, i) => {
      fd.append(`owner_kyc[${i}][code]`, r.code);
      fd.append(`owner_kyc[${i}][document_name]`, r.documentName);
      fd.append(`owner_kyc[${i}][issuing_authority]`, r.issuingAuthority || '');
      fd.append(`owner_kyc[${i}][document_number]`, r.documentNumber || '');
      if (r.issueDate) fd.append(`owner_kyc[${i}][issue_date]`, r.issueDate);
      fd.append(`owner_kyc[${i}][expiry]`, r.expiry || '');
      fd.append(`owner_kyc[${i}][status]`, r.status);
      if (r.file) fd.append(`owner_files[${i}]`, r.file);
      else if (r.existingPath) fd.append(`owner_kyc[${i}][existing_path]`, r.existingPath);
    });
    licenseRows.forEach((r, i) => {
      fd.append(`trade_licenses[${i}][code]`, r.code);
      // licenseType in modal stores the master label (Trade License modal
      // shows a free-text fallback) — send as license_type_id only when
      // the value parses as a number, else send null.
      const ltId = Number(r.licenseType);
      if (Number.isInteger(ltId) && ltId > 0) {
        fd.append(`trade_licenses[${i}][license_type_id]`, String(ltId));
      }
      fd.append(`trade_licenses[${i}][license_number]`, r.licenseNumber || '');
      fd.append(`trade_licenses[${i}][issuing_authority]`, r.issuingAuthority || '');
      if (r.issueDate)  fd.append(`trade_licenses[${i}][issue_date]`, r.issueDate);
      if (r.expiryDate) fd.append(`trade_licenses[${i}][expiry_date]`, r.expiryDate);
      if (r.file) fd.append(`tl_files[${i}]`, r.file);
      else if (r.existingPath) fd.append(`trade_licenses[${i}][existing_path]`, r.existingPath);
    });
    bankRows.forEach((r, i) => {
      fd.append(`bank_accounts[${i}][bank_name]`, r.bankName);
      fd.append(`bank_accounts[${i}][branch_name]`, r.branchName);
      fd.append(`bank_accounts[${i}][account_number]`, r.accountNumber);
      fd.append(`bank_accounts[${i}][ifsc]`, r.ifsc);
      fd.append(`bank_accounts[${i}][branch_address]`, r.branchAddress || '');
      if (r.chequeFile) fd.append(`cheque_files[${i}]`, r.chequeFile);
      else if (r.existingPath) fd.append(`bank_accounts[${i}][existing_path]`, r.existingPath);
    });
    gstRows.forEach((r, i) => {
      fd.append(`gst_scrutiny[${i}][gst_number]`, r.gstNumber);
      fd.append(`gst_scrutiny[${i}][status]`, r.status);
      if (r.lastFilingDate) fd.append(`gst_scrutiny[${i}][last_filing_date]`, r.lastFilingDate);
      fd.append(`gst_scrutiny[${i}][prev_non_gst_2a_invoice]`, r.prevNonGst2aInvoice || '');
      fd.append(`gst_scrutiny[${i}][red_flags]`, r.redFlags || '');
    });

    setSaving(true);
    try {
      await api.post(`/vendors/${vendorId}/step/kyc`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setFieldErrors({});
      toast.success('KYC saved', 'Due-diligence details captured');
      return true;
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Could not save KYC';
      toast.error('Save failed', msg);
      return false;
    } finally {
      setSaving(false);
    }
  };

  const saveProducts = async (): Promise<boolean> => {
    if (!vendorId) { toast.error('Step blocked', 'Save Identity information first.'); return false; }
    if (productMappings.length === 0) {
      toast.error('No products mapped', 'Map at least one product before saving the vendor.');
      return false;
    }
    setSaving(true);
    try {
      await api.post(`/vendors/${vendorId}/step/products`, {
        mappings: productMappings.map(m => ({
          product_id: m.productId,
          batch_serial_lot: m.batchSerialLot || null,
          purchase_price: m.purchasePrice,
          gst_percentage: m.gstPercentage,
          gst_amount: m.gstAmount,
          total_amount: m.totalAmount,
        })),
      });
      toast.success('Vendor saved', 'Products mapped — vendor is now Active');
      return true;
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Could not save product mappings';
      toast.error('Save failed', msg);
      return false;
    } finally {
      setSaving(false);
    }
  };

  const goNext = async () => {
    if (saving) return;
    if (step === 1 && idTab === 'identification') {
      const ok = await saveIdentity();
      if (ok) setIdTab('address');
    } else if (step === 1 && idTab === 'address') {
      const ok = await saveContacts();
      if (ok) setStep(2);
    } else if (step === 2) {
      // Step 2 has 5 sub-tabs (Company DD → Owner KYC → Trade License →
      // Bank → GST). Save & Next persists the full KYC payload AND
      // walks one sub-tab forward. Only on the last sub-tab (gst) does
      // the wizard advance to Step 3.
      const ok = await saveKyc();
      if (!ok) return;
      const idx = KYC_TAB_ORDER.indexOf(kycTab);
      if (idx >= 0 && idx < KYC_TAB_ORDER.length - 1) {
        setKycTab(KYC_TAB_ORDER[idx + 1]);
      } else {
        setStep(3);
      }
    } else if (step === 3) {
      // Stage 3 has 2 top tabs and (inside the KYC tab) 3 sub-pills:
      //   KYC  → Owner KYC → Company Due Diligence → Trade License
      //   Trade Documents
      // Save & Next walks the pills, then the top tabs, then Step 4.
      // Stage 3 is frontend-only — no API call between sub-tabs.
      if (tradeTab === 'kyc') {
        const idx = KYC_SUB_ORDER.indexOf(kycSub);
        if (idx >= 0 && idx < KYC_SUB_ORDER.length - 1) {
          setKycSub(KYC_SUB_ORDER[idx + 1]);
        } else {
          setTradeTab('trade');
        }
      } else {
        setStep(4);
      }
    }
  };

  const goPrev = () => {
    if (step > 1) setStep((step - 1) as StepKey);
  };

  const submitAll = async () => {
    if (saving) return;
    const ok = await saveProducts();
    if (!ok) return;
    onSubmit({
      companyName, legalName, vendorType, website, riskLevel,
      vendorBehaviour, segment, complianceBehaviour,
      registeredOffice, country, state, stateCode, city, pincode,
      contactName, designation, contactNo, email, whatsappEnabled,
      dueDiligence: ddRows,
      ownerKyc: ownerRows,
      tradeLicenses: licenseRows,
      bankAccounts: bankRows,
      gstScrutiny: gstRows,
      tradeDocuments: tradeDocRows,
      productMappings,
      mappedProductCodes: productMappings.map(m => m.productCode).filter(Boolean),
    });
  };

  /* ──────────────────────────────────────────────────────────────────
   * Step 2 — row helpers
   *
   * Each "+ Add …" button stamps the next auto-code (DD-002 if DD-001
   * already exists) and appends the draft to the right list. Seed rows
   * (mandatory defaults) share the same code prefix so the next-code
   * calculation just counts the list length. Validation lives inside
   * each save handler so the modal can show a focused toast.
   * ────────────────────────────────────────────────────────────── */
  const nextCode = (prefix: string, rows: Array<{ code: string }>) => {
    let max = 0;
    const re = new RegExp(`^${prefix}-(\\d+)$`, 'i');
    for (const r of rows) {
      const m = re.exec(r.code);
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
    return `${prefix}-${String(max + 1).padStart(3, '0')}`;
  };
  const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  /* Inline upload — used by mandatory seed rows that don't have a
     dedicated row in the modal. Picking a file flips the row's
     fileName so the action button switches to "Uploaded". */
  const attachFileToDd = (id: string, file: File) => {
    setDdRows(prev => prev.map(r => r.id === id ? { ...r, file, fileName: file.name } : r));
  };
  const attachFileToLicense = (id: string, file: File) => {
    setLicenseRows(prev => prev.map(r => r.id === id ? { ...r, file, fileName: file.name } : r));
  };

  /* Open / save / delete handlers per modal */
  const openDdPopup = () => { setDdDraft(EMPTY_DD_DRAFT); setDdPopupOpen(true); };
  const saveDdDraft = () => {
    if (!ddDraft.documentName.trim()) { toast.error('Missing field', 'DD Document Name is required'); return; }
    if (!ddDraft.issuingAuthority.trim()) { toast.error('Missing field', 'Issuing Authority is required'); return; }
    const row: DueDiligenceRow = { id: uid(), code: nextCode('DD', ddRows), ...ddDraft };
    setDdRows(prev => [...prev, row]);
    setDdPopupOpen(false);
    toast.success('Document added', `${row.code} ${row.documentName} added`);
  };
  const removeDdRow = (id: string) => setDdRows(prev => prev.filter(r => r.id !== id));

  const openOwnerPopup = () => { setOwnerDraft(EMPTY_OWNER_DRAFT); setOwnerPopupOpen(true); };
  const saveOwnerDraft = () => {
    if (!ownerDraft.documentName.trim())     { toast.error('Missing field', 'KYC Document Name is required'); return; }
    if (!ownerDraft.issuingAuthority.trim()) { toast.error('Missing field', 'Issuing Authority is required'); return; }
    if (!ownerDraft.fileName)                { toast.error('Missing file', 'Please upload the KYC document'); return; }
    const row: OwnerKycRow = { id: uid(), code: nextCode('KYC', ownerRows), ...ownerDraft };
    setOwnerRows(prev => [...prev, row]);
    setOwnerPopupOpen(false);
    toast.success('Owner KYC added', `${row.code} ${row.documentName} added`);
  };
  const removeOwnerRow = (id: string) => setOwnerRows(prev => prev.filter(r => r.id !== id));

  const openLicPopup = async () => {
    setLicDraft(EMPTY_LIC_DRAFT);
    setLicPopupOpen(true);
    // Lazy-load the license_name master the first time the modal opens.
    if (licenseTypeOpts.length === 0) {
      try {
        const res = await api.get<Array<{ id: string | number; name?: string; status?: string }>>('/master/license_name');
        const rows = Array.isArray(res.data) ? res.data : [];
        setLicenseTypeOpts(rows
          .filter(r => (r.status ?? 'Active') === 'Active')
          .map(r => ({ value: String(r.name ?? ''), label: String(r.name ?? '') }))
          .filter(o => o.value));
      } catch { /* silent — fallback to free text */ }
    }
  };
  const saveLicDraft = () => {
    if (!licDraft.licenseType.trim())   { toast.error('Missing field', 'License Type is required'); return; }
    if (!licDraft.licenseNumber.trim()) { toast.error('Missing field', 'License Number is required'); return; }
    if (!licDraft.issuingAuthority.trim()) { toast.error('Missing field', 'Issuing Authority is required'); return; }
    if (!licDraft.issueDate)            { toast.error('Missing field', 'Issue Date is required'); return; }
    if (!licDraft.expiryDate)           { toast.error('Missing field', 'Expiry Date is required'); return; }
    if (!licDraft.fileName)             { toast.error('Missing file', 'Please upload the license document'); return; }
    const row: TradeLicenseRow = { id: uid(), code: nextCode('TL', licenseRows), ...licDraft };
    setLicenseRows(prev => [...prev, row]);
    setLicPopupOpen(false);
    toast.success('Trade license added', `${row.code} ${row.licenseType} added`);
  };
  const removeLicRow = (id: string) => setLicenseRows(prev => prev.filter(r => r.id !== id));

  const openBankPopup = () => { setBankDraft(EMPTY_BANK_DRAFT); setBankPopupOpen(true); };
  const saveBankDraft = () => {
    if (!bankDraft.bankName.trim())      { toast.error('Missing field', 'Bank Name is required'); return; }
    if (!bankDraft.branchName.trim())    { toast.error('Missing field', 'Branch is required'); return; }
    if (!bankDraft.accountNumber.trim()) { toast.error('Missing field', 'Account Number is required'); return; }
    if (!bankDraft.ifsc.trim())          { toast.error('Missing field', 'IFSC Code is required'); return; }
    const accErr = validateAccountNumber(bankDraft.accountNumber); if (accErr) { toast.error('Invalid Account Number', accErr); return; }
    const ifscErr = validateIfsc(bankDraft.ifsc); if (ifscErr) { toast.error('Invalid IFSC', ifscErr); return; }
    const row: BankRow = { id: uid(), ...bankDraft };
    setBankRows(prev => [...prev, row]);
    setBankPopupOpen(false);
    toast.success('Bank added', `${row.bankName} (${row.branchName})`);
  };
  const removeBankRow = (id: string) => setBankRows(prev => prev.filter(r => r.id !== id));

  const openGstPopup = () => { setGstDraft(EMPTY_GST_DRAFT); setGstPopupOpen(true); };
  const saveGstDraft = () => {
    if (!gstDraft.gstNumber.trim())     { toast.error('Missing field', 'GST Number is required'); return; }
    if (!gstDraft.lastFilingDate)       { toast.error('Missing field', 'GST Last Filing Date is required'); return; }
    const gstErr = validateGstin(gstDraft.gstNumber); if (gstErr) { toast.error('Invalid GST Number', gstErr); return; }
    const row: GstScrutinyRow = { id: uid(), ...gstDraft };
    setGstRows(prev => [...prev, row]);
    setGstPopupOpen(false);
    toast.success('GST scrutiny added', row.gstNumber);
  };
  const removeGstRow = (id: string) => setGstRows(prev => prev.filter(r => r.id !== id));

  /* Tab-aware label + handler for the SectionCard's "+ Add …" button */
  const kycTabAddMeta: Record<KycTab, { label: string; onClick: () => void }> = {
    company: { label: '+ Add More Due Diligence', onClick: openDdPopup },
    owner:   { label: '+ Add Owner KYC',          onClick: openOwnerPopup },
    license: { label: '+ Add Trade License',      onClick: openLicPopup },
    bank:    { label: '+ Add More Bank',          onClick: openBankPopup },
    gst:     { label: '+ Add GST Scrutiny',       onClick: openGstPopup },
  };

  /* ──────────────────────────────────────────────────────────────────
   * Step 3 — Trade Documents handlers
   *
   * Each row is a fixed agreement type. Toggling the per-row checkbox
   * marks it for signature; clicking Send flips status to 'Sent' and
   * clears the checkbox (so the same row can be re-sent if needed).
   * The header "select-all" checkbox flips every row's checkbox.
   * ────────────────────────────────────────────────────────────── */
  const toggleTradeDocSign = (code: string) => {
    setTradeDocRows(prev => prev.map(r => r.code === code ? { ...r, sendForSignature: !r.sendForSignature } : r));
  };
  const toggleAllTradeDocSign = () => {
    setTradeDocRows(prev => {
      const allOn = prev.every(r => r.sendForSignature);
      return prev.map(r => ({ ...r, sendForSignature: !allOn }));
    });
  };
  const sendTradeDoc = (code: string) => {
    const row = tradeDocRows.find(r => r.code === code);
    if (!row?.db_id) {
      toast.info('Not a library document', 'This row is a legacy placeholder. Pick a segment with mapped trade documents to enable signature sending.');
      return;
    }
    // `vendorId` covers both edit-mode (prop-supplied) and create-mode
    // (set by Stage 1→2 auto-save). Checking only `initialVendorId`
    // here was wrong — it stays null after a fresh create until the
    // user closes and re-opens the modal.
    if (!vendorId) {
      toast.info('Save vendor first', 'Save the vendor before sending documents for signature.');
      return;
    }
    /* Resend semantics — when the doc is already `inprogress` in Zoho,
     * the user clicking "Resend" wants to NUDGE the existing signer,
     * not re-pick recipients + re-position the signature box. Hit the
     * remind endpoint directly (mirrors New_IDIMS_6.0 + the customer /
     * consignee flows) and toast. Declined / recalled / expired rows
     * fall through to the wizard so the user can re-cast a fresh
     * request. Vendor row state uses signatureRequestId (camelCase).
     * Bundle-aware cooldown stops a 3-doc bundle from triggering three
     * reminder emails. */
    const reqId = row.signatureRequestId;
    if (reqId && row.status === 'inprogress') {
      if (isReminderCooldown(reqId)) {
        toast.info('Already reminded', `One reminder covers every document in this bundle. Try again in ${reminderCooldownSeconds(reqId)}s.`);
        return;
      }
      const bundleCount = tradeDocRows.filter(r => r.signatureRequestId === reqId).length;
      api.post(`/clm/signature-requests/${reqId}/remind`)
        .then(() => {
          setRecentReminds(prev => ({ ...prev, [reqId]: Date.now() + 60_000 }));
          toast.success('Reminder sent',
            bundleCount > 1
              ? `The signer was notified about all ${bundleCount} documents in this signature request.`
              : 'The signer has been notified.',
          );
        })
        .catch(err => toast.error('Reminder failed', err?.response?.data?.message ?? 'Could not send the reminder. Try again later.'));
      return;
    }
    setSendForSignature([row.db_id]);
  };
  const sendSelectedTradeDocs = () => {
    const ids = tradeDocRows.filter(r => r.sendForSignature && r.db_id).map(r => r.db_id!);
    if (ids.length === 0) {
      toast.info('Nothing selected', 'Tick one or more documents under "Send for Signature" first.');
      return;
    }
    if (!vendorId) {
      toast.info('Save vendor first', 'Save the vendor before sending documents for signature.');
      return;
    }
    setSendForSignature(ids.slice(0, 10));
  };

  /* ──────────────────────────────────────────────────────────────────
   * Step 4 — Product Mapping handlers
   *
   * The modal pulls active products from /api/products and active gst
   * percentages from the gst_percentage master on first open. Selecting
   * a product copies its code / HSN / segment into readonly draft
   * fields. Changing purchase price or GST % auto-computes the GST
   * amount and total amount so the user only enters two values.
   * ────────────────────────────────────────────────────────────── */
  const fetchProductOptsIfNeeded = async () => {
    if (productOpts.length) return;
    try {
      type ProductRow = {
        id: number; product_code?: string; name?: string;
        status?: string; step_completed?: number;
        base_price?: number | string | null;
        hsn?: { hsn_code?: string } | null;
        segment?: { title?: string } | null;
        gst_percentage?: { percentage?: number | string } | null;
      };
      // Pull every product (no `status=` filter) so we get both the
      // post-Quality "inactive" rows and the post-Vendor "active"
      // rows. Drafts are dropped client-side — anything with
      // step_completed < 3 hasn't gone through the Core → Sales →
      // Quality sub-tabs and therefore lacks the HSN / segment data
      // that the mapping modal auto-fills.
      const res = await api.get<{ data?: ProductRow[] } | ProductRow[]>('/products?per_page=500');
      const rows = Array.isArray(res.data) ? res.data : (res.data?.data ?? []);
      const eligible = rows.filter(r => Number(r.step_completed ?? 0) >= 3);
      setProductOpts(eligible.map(r => ({
        value:    String(r.id),
        label:    `${r.product_code ?? ''} — ${r.name ?? ''}`.replace(/^ — /, ''),
        code:     r.product_code ?? '',
        name:     r.name ?? '',
        hsn:      r.hsn?.hsn_code ?? '',
        segment:  r.segment?.title ?? '',
        basePrice:     r.base_price != null ? String(r.base_price) : '',
        gstPercentage: r.gst_percentage?.percentage != null ? String(r.gst_percentage.percentage) : '',
      })));
    } catch { /* silent — modal falls back to manual entry */ }
  };
  const fetchGstPctOptsIfNeeded = async () => {
    if (gstPctOpts.length) return;
    try {
      const res = await api.get<Array<{ id: string | number; percentage?: number | string; status?: string }>>('/master/gst_percentage');
      const rows = Array.isArray(res.data) ? res.data : [];
      setGstPctOpts(rows
        .filter(r => (r.status ?? 'Active') === 'Active')
        .map(r => ({ value: String(r.percentage ?? ''), label: `${r.percentage ?? ''}%` }))
        .filter(o => o.value && o.value !== ''));
    } catch { /* silent */ }
  };

  const recomputeMapTotals = (draft: MapDraft): MapDraft => {
    const price = parseFloat(draft.purchasePrice);
    const pct   = parseFloat(draft.gstPercentage);
    if (!isFinite(price) || price < 0) return { ...draft, gstAmount: '', totalAmount: '' };
    const safePct = isFinite(pct) ? pct : 0;
    const gstAmt  = +(price * (safePct / 100)).toFixed(2);
    const total   = +(price + gstAmt).toFixed(2);
    return { ...draft, gstAmount: gstAmt.toFixed(2), totalAmount: total.toFixed(2) };
  };

  const openMapPopup = () => {
    setMapDraft(EMPTY_MAP_DRAFT);
    setMapPopupOpen(true);
    void fetchProductOptsIfNeeded();
    void fetchGstPctOptsIfNeeded();
  };

  const onMapProductChange = (productIdStr: string) => {
    const picked = productOpts.find(p => p.value === productIdStr);
    setMapDraft(d => recomputeMapTotals({
      ...d,
      productId:     productIdStr,
      productCode:   picked?.code ?? '',
      productName:   picked?.name ?? '',
      hsnSacCode:    picked?.hsn  ?? '',
      segment:       picked?.segment ?? '',
      // Seed purchase price + GST from the product's own data if it
      // has them; user can still override. recomputeMapTotals runs
      // off the same draft so amount totals update in one pass.
      purchasePrice: picked?.basePrice ?? d.purchasePrice,
      gstPercentage: picked?.gstPercentage ?? d.gstPercentage,
    }));
  };

  const saveMapDraft = () => {
    if (!mapDraft.productId)             { toast.error('Missing field', 'Pick a Product Name'); return; }
    if (!mapDraft.purchasePrice.trim())  { toast.error('Missing field', 'Purchase Price is required'); return; }
    const price = parseFloat(mapDraft.purchasePrice);
    if (!isFinite(price) || price < 0)   { toast.error('Invalid price', 'Purchase Price must be a non-negative number'); return; }
    if (productMappings.some(m => m.productId === Number(mapDraft.productId))) {
      toast.error('Already mapped', `${mapDraft.productCode} is already mapped to this vendor`);
      return;
    }
    const row: ProductMappingRow = {
      id: uid(),
      productId:    Number(mapDraft.productId),
      productCode:  mapDraft.productCode,
      productName:  mapDraft.productName,
      hsnSacCode:   mapDraft.hsnSacCode,
      segment:      mapDraft.segment,
      batchSerialLot: mapDraft.batchSerialLot,
      purchasePrice: price,
      gstPercentage: parseFloat(mapDraft.gstPercentage) || 0,
      gstAmount:    parseFloat(mapDraft.gstAmount) || 0,
      totalAmount:  parseFloat(mapDraft.totalAmount) || price,
    };
    setProductMappings(prev => [...prev, row]);
    setMapPopupOpen(false);
    toast.success('Product mapped', `${row.productCode} ${row.productName} added`);
  };
  const removeMapRow = (id: string) => setProductMappings(prev => prev.filter(r => r.id !== id));

  const openContactPopup = () => {
    setContactDraft({ name: '', designation: '', phone: '', email: '', whatsapp: true, attachmentName: '', attachmentFile: null });
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
    // Format checks — phone and email
    const phoneErr = validateContactNumber(contactDraft.phone, 'Contact No');
    if (phoneErr) { toast.error('Invalid Contact No', phoneErr); return; }
    const emailErr = validateEmail(contactDraft.email);
    if (emailErr) { toast.error('Invalid Email', emailErr); return; }

    setExtraContacts(prev => [...prev, { id: Date.now(), ...contactDraft }]);
    setContactPopupOpen(false);
    toast.success('Contact added', `${contactDraft.name} added to the list`);
  };
  const removeExtraContact = (id: number) => setExtraContacts(prev => prev.filter(c => c.id !== id));


  return createPortal((
    // Backdrop click intentionally does NOT close the wizard — the
    // user has stepped through multiple tabs of form data and an
    // accidental click outside would lose all of it. The Cancel button
    // and the top-right X are the only dismissal paths.
    <div className="avm-backdrop">
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
              <div className="avm-title">{isEdit ? 'Edit Supplier' : 'Add Supplier'}</div>
              <div className="avm-sub">{isEdit ? 'Update supplier details, KYC, or product mappings — saved per step.' : 'Capture, verify, and onboard suppliers with complete compliance and sourcing readiness.'}</div>
            </div>
          </div>
          <div className="avm-head-right">
            {/* "Map Products" header CTA removed — Step 4 of the wizard
                already covers product mapping; a duplicate shortcut in
                the header was confusing because it had no handler. */}
            <button className="avm-close" onClick={onClose} aria-label="Close">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            </button>
          </div>
        </div>

        {/* ─── Stepper strip ─── */}
        <div className="avm-stepper-wrap">
          <div className="avm-stepper">
            <StepperItem n={1} title="Supplier Legal Identity"     sub="Company, GST, PAN & contact"            current={step} tone="violet" />
            <div className="avm-step-arrow">›</div>
            <StepperItem n={2} title="Supplier KYC / Due Diligence" sub="Docs, identity & compliance"            current={step} tone="teal" />
            <div className="avm-step-arrow">›</div>
            <StepperItem n={3} title="Trade Document Management"  sub="Manage trade docs, contracts & agreements" current={step} tone="purple" />
            <div className="avm-step-arrow">›</div>
            <StepperItem n={4} title="Map Products"               sub="Link products & pricing"                current={step} tone="green" />
          </div>
        </div>

        {/* ─── Body ─── */}
        <div className="avm-body">
          {step > 1 && (() => {
            /* Carried-over summary of everything captured in earlier
               steps. Each entry is a `Label : value` pair flowed
               inline so the header reads like the field strip on
               read-only detail screens — much denser than a card grid.
               KYC carries the FIRST row of each sub-list (not the
               count), and contact info shows only the PRIMARY contact.
               Sub-tabs inside the same step share this header so
               navigating between them never loses the upstream data. */
            type PrevField = {
              label: string;
              value: string;
              href?: string;        // renders the value as a link
              suffix?: string;      // appended in muted style after value (e.g. validity)
            };
            type PrevStage = {
              name: string;
              tone: 'violet' | 'teal' | 'purple';
              rows: PrevField[][];   // one inline row per sub-array
            };
            const prevStages: PrevStage[] = [];

            if (step > 1) {
              const yesNo = (b: boolean) => (b ? 'Yes' : 'No');
              prevStages.push({
                name: 'Supplier Legal Identity Details',
                tone: 'violet',
                rows: [
                  [
                    { label: 'Supplier Code',       value: vendorCode || '—' },
                    { label: 'Company Name',        value: companyName || '—' },
                    { label: 'Company Legal Name',  value: legalName || '—' },
                    { label: 'Supplier Type',       value: labelFor(vendorType, vendorTypeOpts) || '—' },
                  ],
                  [
                    { label: 'Company Website',     value: website || 'NA' },
                    { label: 'Risk Level',          value: labelFor(riskLevel, riskLevelOpts) || '—' },
                    { label: 'Supplier Behaviour',  value: labelFor(vendorBehaviour, behaviourOpts) || '—' },
                    { label: 'Compliance Behaviour',value: labelFor(complianceBehaviour, complianceOpts) || '—' },
                  ],
                  [
                    { label: 'Registered Office Address', value: registeredOffice || '—' },
                    { label: 'Country',             value: labelFor(country, countryOpts) || '—' },
                    { label: 'State',               value: labelFor(state, stateOpts) || '—' },
                    { label: 'City',                value: city || '—' },
                    { label: 'State Code',          value: stateCode || '—' },
                  ],
                  // Primary contact only — extras are intentionally
                  // hidden (the user said to surface only the
                  // primary). Pincode + segment included so the row
                  // still reads as a complete identity snapshot.
                  [
                    { label: 'Contact Person Name', value: contactName || '—' },
                    { label: 'Designation',         value: designation || '—' },
                    { label: 'Contact No',          value: contactNo || '—' },
                    { label: 'WhatsApp Enable',     value: yesNo(whatsappEnabled) },
                  ],
                ],
              });
            }

            if (step > 2) {
              // First entry of each KYC sub-list — counts are gone.
              const bank = bankRows[0];
              const dd   = ddRows[0];
              const own  = ownerRows[0];
              const kycRows: PrevField[][] = [];

              if (bank) {
                kycRows.push([
                  { label: 'Bank Name',      value: bank.bankName || '—' },
                  { label: 'Branch',         value: bank.branchName || '—' },
                  { label: 'Account Number', value: bank.accountNumber || '—' },
                  { label: 'IFSC Code',      value: bank.ifsc || '—' },
                ]);
              }
              if (dd) {
                const fileLabel = dd.fileName || (dd.existingPath ? dd.existingPath.split('/').pop() ?? '' : '');
                const href = dd.existingPath ? resolveFileUrl(dd.existingPath) : (dd.file ? URL.createObjectURL(dd.file) : '');
                kycRows.push([
                  {
                    label: dd.documentName || 'Document',
                    value: fileLabel || '—',
                    href: href || undefined,
                    suffix: dd.expiry && dd.expiry !== 'N/A' ? `(Validity: ${dd.expiry})` : undefined,
                  },
                ]);
              }
              if (own) {
                kycRows.push([
                  { label: 'Document Name',     value: own.documentName || '—' },
                  { label: 'Issuing Authority', value: own.issuingAuthority || '—' },
                  { label: 'Document Number',   value: own.documentNumber || '—' },
                  { label: 'Issue Date',        value: own.issueDate || '—' },
                ]);
              }
              if (kycRows.length) {
                prevStages.push({
                  name: 'Supplier KYC / Due Diligence Details',
                  tone: 'teal',
                  rows: kycRows,
                });
              }
            }

            if (step > 3) {
              const td = tradeDocRows.find(r => r.status !== 'N/A');
              if (td) {
                prevStages.push({
                  name: 'Trade Document Management',
                  tone: 'purple',
                  rows: [[
                    { label: 'Document', value: td.name || '—' },
                    { label: 'Status',   value: td.status },
                    ...(td.attachmentName ? [{ label: 'Attachment', value: td.attachmentName }] : []),
                  ]],
                });
              }
            }

            if (prevStages.length === 0) return null;

            return (
              <div className="avm-prev">
                <div className="avm-prev-head">
                  <div className="avm-prev-title">
                    <span className="avm-prev-check"><i className="ri-check-line" /></span>
                    What you did in previous stages
                    <span className="avm-prev-chip">Stage {step - 1} of 4 Complete</span>
                  </div>
                  <button className="avm-prev-toggle" onClick={() => setPrevOpen(o => !o)}>{prevOpen ? 'Hide' : 'Show'}</button>
                </div>
                {prevOpen && (
                  <div className="avm-prev-body">
                    {prevStages.map(s => (
                      <div key={s.name} className={`avm-prev-stage tone-${s.tone}`}>
                        <div className="avm-prev-stage-label">⊕ {s.name}</div>
                        <div className="avm-prev-rows">
                          {s.rows.map((row, i) => (
                            <div key={i} className="avm-prev-row">
                              {row.map((f, j) => (
                                <span key={`${f.label}-${j}`} className="avm-prev-pair">
                                  <span className="avm-prev-k">{f.label} :</span>{' '}
                                  {f.href ? (
                                    <a href={f.href} target="_blank" rel="noopener noreferrer" className="avm-prev-link" title={f.value}>{f.value}</a>
                                  ) : (
                                    <span className="avm-prev-v" title={f.value}>{f.value}</span>
                                  )}
                                  {f.suffix ? <span className="avm-prev-suffix"> {f.suffix}</span> : null}
                                </span>
                              ))}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}

          {/* ─── STEP 1 ─── */}
          {step === 1 && (
            <>
              <div className="avm-tabs">
                <button className={`avm-tab ${idTab === 'identification' ? 'on' : ''}`} onClick={() => setIdTab('identification')}>Supplier Identification</button>
                <button className={`avm-tab ${idTab === 'address' ? 'on' : ''}`}        onClick={() => setIdTab('address')}>Address &amp; Contact Persons</button>
              </div>

              {idTab === 'identification' && (
                <SectionCard tone="violet" icon={<i className="ri-building-line" />} title="Basic Company Details" subtitle="Identity, classification & sourcing readiness">
                  <div className="avm-grid-2">
                    <Field label="Company Name" required error={fieldErrors.companyName}>
                      <input className="avm-input" placeholder="e.g. ABC Logistics" value={companyName} onChange={e => { setCompanyName(e.target.value); clearFieldError('companyName'); }} />
                    </Field>
                    <Field label="Company Legal Name">
                      <input className="avm-input" placeholder="ABC Logistics Pvt Ltd" value={legalName} onChange={e => setLegalName(e.target.value)} />
                    </Field>
                  </div>
                  <div className="avm-grid-3">
                    <Field label="Supplier Type" required addNew onAdd={() => setQuickAdd('vendor_types')} error={fieldErrors.vendorType}>
                      <SelectInput value={vendorType} onChange={(v) => { setVendorType(v); clearFieldError('vendorType'); }} placeholder="Select" options={vendorTypeOpts} />
                    </Field>
                    <Field label="Company Website">
                      <input className="avm-input" placeholder="https://abclogistics.com" value={website} onChange={e => setWebsite(e.target.value)} />
                    </Field>
                    <Field label="Risk Level" required addNew onAdd={() => setQuickAdd('risk_levels')} error={fieldErrors.riskLevel}>
                      <SelectInput value={riskLevel} onChange={(v) => { setRiskLevel(v); clearFieldError('riskLevel'); }} placeholder="Select" options={riskLevelOpts} />
                    </Field>
                  </div>
                  <div className="avm-grid-3">
                    <Field label="Supplier Behaviour" required addNew onAdd={() => setQuickAdd('vendor_behaviour')} error={fieldErrors.vendorBehaviour}>
                      <SelectInput value={vendorBehaviour} onChange={(v) => { setVendorBehaviour(v); clearFieldError('vendorBehaviour'); }} placeholder="Select" options={behaviourOpts} />
                    </Field>
                    <Field label="Supplier Segment" required addNew onAdd={() => setQuickAdd('segments')} error={fieldErrors.segment}>
                      {/* masterFormKit's MasterMultiSelect renders visible violet
                          chips with × buttons + a checkbox-marked dropdown so
                          multi-select is obvious. `value` prop is plural despite
                          the singular name. */}
                      <MasterMultiSelect
                        value={segment}
                        options={segmentOpts}
                        placeholder="Select Segment"
                        onChange={vs => { setSegment(vs); clearFieldError('segment'); }}
                      />
                    </Field>
                    <Field label="Compliance Behaviour" required addNew onAdd={() => setQuickAdd('compliance_behaviours')} error={fieldErrors.complianceBehaviour}>
                      <SelectInput value={complianceBehaviour} onChange={(v) => { setComplianceBehaviour(v); clearFieldError('complianceBehaviour'); }} placeholder="Select" options={complianceOpts} />
                    </Field>
                  </div>
                </SectionCard>
              )}

              {idTab === 'identification' && (
                <SectionCard tone="amber" icon={<i className="ri-map-pin-line" />} title="Company Address & Contact Person Details" subtitle="Registered office and primary KYC contact">
                  <Field label="Registered Office Address" required error={fieldErrors.registeredOffice}>
                    <input className="avm-input" placeholder="Plot 21, Industrial Area" value={registeredOffice} onChange={e => { setRegisteredOffice(e.target.value); clearFieldError('registeredOffice'); }} />
                  </Field>
                  <div className="avm-grid-4">
                    <Field label="Country" required addNew onAdd={() => setQuickAdd('countries')} error={fieldErrors.country}>
                      <SelectInput
                        value={country}
                        onChange={(v) => { setCountry(v); setState(''); setStateCode(''); clearFieldError('country'); }}
                        placeholder="Select Country"
                        options={countryOpts}
                      />
                    </Field>
                    <Field label="State" required error={fieldErrors.state}>
                      <SelectInput
                        value={state}
                        onChange={(v) => {
                          setState(v);
                          // Auto-fill State Code from the master_state_codes row
                          // whose state_id matches the chosen state. The
                          // dropdown's `value` is the state's id since the
                          // switch to ID-based master FK references.
                          const sc = stateCodeRows.find(r => r.state_id === v)?.state_code ?? '';
                          setStateCode(sc);
                          clearFieldError('state');
                          clearFieldError('stateCode');
                        }}
                        placeholder="Select State"
                        options={stateOpts}
                      />
                    </Field>
                    <Field label="State Code" required error={fieldErrors.stateCode}>
                      <input
                        className="avm-input"
                        placeholder="Auto-filled from State"
                        value={stateCode}
                        readOnly
                        title="Pulled from State Codes master based on the selected State"
                      />
                    </Field>
                    <Field label="City" required error={fieldErrors.city}>
                      <input className="avm-input" placeholder="e.g. Pune" value={city} onChange={e => { setCity(e.target.value); clearFieldError('city'); }} />
                    </Field>
                  </div>
                  <div className="avm-grid-4">
                    <Field label="Contact Person Name" required error={fieldErrors.contactName}>
                      <input className="avm-input" placeholder="Rahul Sharma" value={contactName} onChange={e => { setContactName(e.target.value); clearFieldError('contactName'); }} />
                    </Field>
                    <Field label="Designation" required error={fieldErrors.designation}>
                      <input className="avm-input" placeholder="admin" value={designation} onChange={e => { setDesignation(e.target.value); clearFieldError('designation'); }} />
                    </Field>
                    <Field label="Contact No" required error={fieldErrors.contactNo}>
                      <input
                        className="avm-input"
                        placeholder="9876543210"
                        inputMode="numeric"
                        pattern="\d*"
                        maxLength={15}
                        value={contactNo}
                        onChange={e => { setContactNo(digitsOnly(e.target.value)); clearFieldError('contactNo'); }}
                      />
                    </Field>
                    <Field label="Email" required error={fieldErrors.email}>
                      <input className="avm-input" placeholder="rahul@abclogistics.com" value={email} onChange={e => { setEmail(e.target.value); clearFieldError('email'); }} />
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
                  {/* Step-1 readonly summary — surfaces everything the
                      user captured on the Vendor Identification sub-tab
                      so they can verify they're entering address /
                      additional contacts under the correct vendor
                      without flipping tabs. */}
                  <div className="avm-id-summary">
                    <div className="avm-id-summary-row">
                      <span className="avm-id-pair"><span className="avm-id-k">VENDOR CODE :</span> <span className="avm-id-v">{vendorCode || '—'}</span></span>
                      <span className="avm-id-pair"><span className="avm-id-k">COMPANY NAME :</span> <span className="avm-id-v">{companyName || '—'}</span></span>
                      <span className="avm-id-pair"><span className="avm-id-k">COMPANY LEGAL NAME :</span> <span className="avm-id-v">{legalName || '—'}</span></span>
                      <span className="avm-id-pair"><span className="avm-id-k">VENDOR TYPE :</span> <span className="avm-id-v">{labelFor(vendorType, vendorTypeOpts) || '—'}</span></span>
                    </div>
                    <div className="avm-id-summary-row">
                      <span className="avm-id-pair"><span className="avm-id-k">RISK LEVEL :</span> <span className="avm-id-v">{labelFor(riskLevel, riskLevelOpts) || '—'}</span></span>
                      <span className="avm-id-pair"><span className="avm-id-k">VENDOR BEHAVIOUR :</span> <span className="avm-id-v">{labelFor(vendorBehaviour, behaviourOpts) || '—'}</span></span>
                      <span className="avm-id-pair"><span className="avm-id-k">SEGMENT :</span> <span className="avm-id-v">{segment.length > 0 ? segment.map(id => labelFor(id, segmentOpts)).filter(Boolean).join(', ') : '—'}</span></span>
                      <span className="avm-id-pair"><span className="avm-id-k">COMPLIANCE BEHAVIOUR :</span> <span className="avm-id-v">{labelFor(complianceBehaviour, complianceOpts) || '—'}</span></span>
                    </div>
                    <div className="avm-id-summary-row">
                      <span className="avm-id-pair"><span className="avm-id-k">COUNTRY :</span> <span className="avm-id-v">{labelFor(country, countryOpts) || '—'}</span></span>
                      <span className="avm-id-pair"><span className="avm-id-k">STATE :</span> <span className="avm-id-v">{labelFor(state, stateOpts) || '—'}</span></span>
                      <span className="avm-id-pair"><span className="avm-id-k">STATE CODE :</span> <span className="avm-id-v">{stateCode || '—'}</span></span>
                      <span className="avm-id-pair"><span className="avm-id-k">CITY :</span> <span className="avm-id-v">{city || '—'}</span></span>
                    </div>
                    <div className="avm-id-summary-row">
                      <span className="avm-id-pair"><span className="avm-id-k">PRIMARY CONTACT :</span> <span className="avm-id-v">{contactName || '—'}</span></span>
                      <span className="avm-id-pair"><span className="avm-id-k">DESIGNATION :</span> <span className="avm-id-v">{designation || '—'}</span></span>
                      <span className="avm-id-pair"><span className="avm-id-k">CONTACT NO :</span> <span className="avm-id-v">{contactNo || '—'}</span></span>
                      <span className="avm-id-pair"><span className="avm-id-k">EMAIL :</span> <span className="avm-id-v">{email || '—'}</span></span>
                      <span className="avm-id-pair"><span className="avm-id-k">WHATSAPP :</span> <span className="avm-id-v">{whatsappEnabled ? 'Yes' : 'No'}</span></span>
                    </div>
                  </div>

                  {/* ── Additional Contact Persons ──
                      The primary KYC contact (captured on the Vendor
                      Identification sub-tab) is also surfaced here as
                      the first row so the table reads as "all contacts
                      we know about". Marked with a "Primary" pill and
                      not deletable — the user has to go back to the
                      first sub-tab to change it. */}
                  <SectionCard tone="violet" icon={<i className="ri-contacts-book-line" />} title="Additional Contact Persons" subtitle="Secondary contacts beyond the primary KYC contact" headerAction={
                    <button className="avm-section-add-btn" onClick={openContactPopup}>+ Add More Contact Person</button>
                  }>
                    {(() => {
                      // Merge view: primary first (when populated), then extras.
                      const primaryHasData = !!(contactName.trim() || email.trim() || contactNo.trim());
                      type Row = {
                        key: string;
                        isPrimary: boolean;
                        contactId?: number;
                        name: string;
                        designation: string;
                        phone: string;
                        email: string;
                        whatsapp: boolean;
                        attachmentName: string;
                        attachmentHref: string;
                      };
                      const rows: Row[] = [];
                      if (primaryHasData) {
                        const freshHref = attachment ? URL.createObjectURL(attachment) : '';
                        const savedHref = primaryAttachmentPath ? resolveFileUrl(primaryAttachmentPath) : '';
                        rows.push({
                          key: 'primary',
                          isPrimary: true,
                          name: contactName,
                          designation,
                          phone: contactNo,
                          email,
                          whatsapp: whatsappEnabled,
                          attachmentName: attachment?.name ?? (primaryAttachmentPath ? (primaryAttachmentPath.split('/').pop() ?? '') : ''),
                          attachmentHref: freshHref || savedHref,
                        });
                      }
                      extraContacts.forEach(c => rows.push({
                        key: String(c.id),
                        isPrimary: false,
                        contactId: c.id,
                        name: c.name,
                        designation: c.designation,
                        phone: c.phone,
                        email: c.email,
                        whatsapp: c.whatsapp,
                        attachmentName: c.attachmentName,
                        attachmentHref: c.attachmentPath ? resolveFileUrl(c.attachmentPath) : '',
                      }));

                      if (rows.length === 0) {
                        return <div className="avm-empty">Fill in the primary KYC contact on the Vendor Identification tab to see it here, then add more if needed.</div>;
                      }
                      return (
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
                              {rows.map((r, idx) => (
                                <tr key={r.key}>
                                  <td>{idx + 1}</td>
                                  <td>
                                    <strong>{r.name || '—'}</strong>
                                    {r.isPrimary && (
                                      <span className="badge bg-primary-subtle text-primary ms-2" style={{ padding: '3px 8px', fontSize: 10 }}>
                                        Primary
                                      </span>
                                    )}
                                  </td>
                                  <td>{r.designation || '—'}</td>
                                  <td><span className="font-monospace fs-13">{r.phone || '—'}</span></td>
                                  <td>{r.email || '—'}</td>
                                  <td>
                                    <span className={`avm-pill ${r.whatsapp ? 'avm-pill-success' : 'avm-pill-muted'}`}>
                                      {r.whatsapp ? '✓ Yes' : '— No'}
                                    </span>
                                  </td>
                                  <td>
                                    {r.attachmentName ? (
                                      r.attachmentHref ? (
                                        <a
                                          href={r.attachmentHref}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="fs-13 d-inline-flex align-items-center text-truncate"
                                          style={{ maxWidth: 200, color: '#4338ca', textDecoration: 'underline', textUnderlineOffset: 2 }}
                                          title={`Open ${r.attachmentName}`}
                                        >
                                          <i className="ri-attachment-line me-1" />
                                          {r.attachmentName}
                                        </a>
                                      ) : (
                                        <span className="fs-13"><i className="ri-attachment-line text-muted me-1" />{r.attachmentName}</span>
                                      )
                                    ) : (
                                      <span className="text-muted fs-13">—</span>
                                    )}
                                  </td>
                                  <td>
                                    <div className="hstack gap-1">
                                      {r.isPrimary ? (
                                        <span className="text-muted fs-13" title="Edit on the Vendor Identification tab">—</span>
                                      ) : (
                                        <button type="button" className="btn btn-sm btn-soft-danger" onClick={() => r.contactId !== undefined && removeExtraContact(r.contactId)} title="Remove">
                                          <i className="ri-delete-bin-line" />
                                        </button>
                                      )}
                                    </div>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      );
                    })()}
                  </SectionCard>
                </>
              )}
            </>
          )}

          {/* ─── STEP 2 ─── */}
          {/* The "+ Add" header pill is hidden for the three KYC sub-tabs
              (company / owner / license) — rows there are sourced from
              the segment-rule reference tables now. Bank Details and GST
              Scrutiny still need the add button for manual entries. */}
          {step === 2 && (
            <SectionCard tone="teal" icon={<i className="ri-shield-check-line" />} title="KYC / Due Diligence Details" subtitle="Upload statutory & identity proofs" headerAction={
              (kycTab === 'bank' || kycTab === 'gst') ? (
                <button className="avm-section-add-btn" onClick={kycTabAddMeta[kycTab].onClick}>
                  {kycTabAddMeta[kycTab].label}
                </button>
              ) : null
            }>
              <div className="avm-pill-tabs">
                <button className={`avm-pill ${kycTab === 'company' ? 'on' : ''}`} onClick={() => setKycTab('company')}>Company Due Diligence Details</button>
                <button className={`avm-pill ${kycTab === 'owner'   ? 'on' : ''}`} onClick={() => setKycTab('owner')}>Owner KYC Details</button>
                <button className={`avm-pill ${kycTab === 'license' ? 'on' : ''}`} onClick={() => setKycTab('license')}>Trade License Details</button>
                <button className={`avm-pill ${kycTab === 'bank'    ? 'on' : ''}`} onClick={() => setKycTab('bank')}>Supplier Bank Details</button>
                <button className={`avm-pill ${kycTab === 'gst'     ? 'on' : ''}`} onClick={() => setKycTab('gst')}>GST Scrutiny</button>
              </div>

              {kycTab === 'company' && (
                ddRows.length === 0 && segmentDocs.dd.length > 0 ? (
                  <SupplierSegmentRefTable
                    title="DD DOCUMENT NAME"
                    rows={segmentDocs.dd}
                    tabKey="company"
                    uploads={segmentRefUploads}
                    setUploads={setSegmentRefUploads}
                    persistUpload={persistSegmentRefUpload}
                  />
                ) : (
                  <DdTable
                    rows={ddRows}
                    onRemove={removeDdRow}
                    onAttach={attachFileToDd}
                    onClearFile={(id) => setDdRows(prev => prev.map(r => r.id === id ? { ...r, file: null, fileName: '', existingPath: undefined } : r))}
                  />
                )
              )}
              {kycTab === 'owner' && (
                ownerRows.length === 0 && segmentDocs.kyc.length > 0 ? (
                  <SupplierSegmentRefTable
                    title="KYC DOCUMENT NAME"
                    rows={segmentDocs.kyc}
                    tabKey="owner"
                    uploads={segmentRefUploads}
                    setUploads={setSegmentRefUploads}
                    persistUpload={persistSegmentRefUpload}
                  />
                ) : (
                  <OwnerKycTable
                    rows={ownerRows}
                    onRemove={removeOwnerRow}
                  />
                )
              )}
              {kycTab === 'license' && (
                licenseRows.length === 0 && segmentDocs.tl.length > 0 ? (
                  <SupplierSegmentRefTable
                    title="TRADE LICENSE NAME"
                    rows={segmentDocs.tl}
                    tabKey="license"
                    uploads={segmentRefUploads}
                    setUploads={setSegmentRefUploads}
                    persistUpload={persistSegmentRefUpload}
                  />
                ) : (
                  <TradeLicenseTable
                    rows={licenseRows}
                    onRemove={removeLicRow}
                    onAttach={attachFileToLicense}
                    onClearFile={(id) => setLicenseRows(prev => prev.map(r => r.id === id ? { ...r, file: null, fileName: '', existingPath: undefined } : r))}
                  />
                )
              )}
              {kycTab === 'bank' && (
                <BankTable
                  rows={bankRows}
                  onRemove={removeBankRow}
                  onClearFile={(id) => setBankRows(prev => prev.map(r => r.id === id ? { ...r, chequeFile: null, chequeFileName: '', existingPath: undefined } : r))}
                />
              )}
              {kycTab === 'gst' && (
                <GstScrutinyTable rows={gstRows} onRemove={removeGstRow} />
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
                  {/* Read-only roll-up of Step 2's segment-rule uploads.
                      Each sub-pill maps to the matching Step 2 tab key
                      (`company`/`owner`/`license`) — the same prefix
                      SupplierSegmentRefTable uses to store uploads, so
                      the View link here resolves the same blob URL the
                      user picked on Step 2. */}
                  {(() => {
                    const sourceRows = kycSub === 'owner'   ? (segmentDocs.kyc || [])
                                      : kycSub === 'company' ? (segmentDocs.dd  || [])
                                      : (segmentDocs.tl || []);
                    const tabKey = kycSub === 'owner' ? 'owner' : kycSub === 'company' ? 'company' : 'license';
                    if (sourceRows.length === 0) {
                      return (
                        <div className="text-center text-muted py-4">
                          No segment rule loaded for this category. Pick a segment on Step 1 to populate the vault.
                        </div>
                      );
                    }
                    return (
                      <div className="table-responsive table-card border rounded mt-2">
                        <table className="table align-middle table-nowrap mb-0">
                          <thead className="table-light">
                            <tr>
                              <th>SR NO</th><th>AUTO CODE</th><th>DOCUMENT NAME</th>
                              <th>AUTHORITY</th><th>EXPIRY</th><th>STATUS</th><th>ATTACHMENT</th>
                            </tr>
                          </thead>
                          <tbody>
                            {sourceRows.map((d: any, i: number) => {
                              const refKey = `${tabKey}::${d.code}`;
                              const uploaded = segmentRefUploads[refKey];
                              return (
                                <tr key={d.code}>
                                  <td>{String(i + 1).padStart(2, '0')}</td>
                                  <td><span className="avm-auto-code">{d.code}</span></td>
                                  <td><strong>{d.name}</strong></td>
                                  <td>{d.authority || '—'}</td>
                                  <td>{d.expiry || 'N/A'}</td>
                                  <td>
                                    <span className={`avm-pill ${d.requirement === 'M' ? 'avm-pill-success' : 'avm-pill-muted'}`}>
                                      {d.requirement === 'M' ? '✓ Mandatory' : 'Optional'}
                                    </span>
                                  </td>
                                  <td>
                                    {uploaded ? (
                                      <a href={uploaded.url} target="_blank" rel="noreferrer" style={{ color:'#0d9488', fontWeight:600 }}>
                                        <i className="ri-attachment-line me-1" />{uploaded.name}
                                      </a>
                                    ) : (
                                      <span className="text-muted fst-italic">Not uploaded in Step 2</span>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    );
                  })()}
                </>
              )}
              {tradeTab === 'trade' && (
                <TradeDocsTable
                  rows={tradeDocRows.map(r => ({ ...r, cooldownActive: isReminderCooldown(r.signatureRequestId) }))}
                  onToggleAll={toggleAllTradeDocSign}
                  onToggleSign={toggleTradeDocSign}
                  onSend={sendTradeDoc}
                  onSendSelected={sendSelectedTradeDocs}
                />
              )}
            </SectionCard>
          )}

          {/* ─── STEP 4 ─── */}
          {step === 4 && (
            <SectionCard tone="green" icon={<i className="ri-box-3-line" />} title="Products Details" subtitle="Link products to this vendor with purchase price & GST" headerAction={
              <button className="avm-section-add-btn" onClick={openMapPopup}>+ Add More Products</button>
            }>
              <ProductMappingTable rows={productMappings} onRemove={removeMapRow} />
            </SectionCard>
          )}
        </div>

        {/* ─── Footer ─── */}
        <div className="avm-foot">
          <button className="avm-btn-ghost" onClick={onClose}>Cancel</button>
          <div className="avm-foot-right">
            {step > 1 && <button className="avm-btn-outline" onClick={goPrev}>← Previous</button>}
            {step < 4 ? (
              <button className="avm-btn-primary" onClick={goNext} disabled={saving}>
                {saving ? 'Saving…' : <>Save &amp; Next →</>}
              </button>
            ) : (
              <button className="avm-btn-primary" onClick={submitAll} disabled={saving}>
                <i className="ri-check-line" /> {saving ? 'Saving…' : 'Save Vendor'}
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

      {ddPopupOpen && (
        <DdAddPopup
          nextCodePreview={nextCode('DD', ddRows)}
          draft={ddDraft}
          setDraft={setDdDraft}
          onClose={() => setDdPopupOpen(false)}
          onSave={saveDdDraft}
        />
      )}
      {ownerPopupOpen && (
        <OwnerKycAddPopup
          nextCodePreview={nextCode('KYC', ownerRows)}
          draft={ownerDraft}
          setDraft={setOwnerDraft}
          onClose={() => setOwnerPopupOpen(false)}
          onSave={saveOwnerDraft}
        />
      )}
      {licPopupOpen && (
        <TradeLicenseAddPopup
          draft={licDraft}
          setDraft={setLicDraft}
          typeOpts={licenseTypeOpts}
          onClose={() => setLicPopupOpen(false)}
          onSave={saveLicDraft}
        />
      )}
      {bankPopupOpen && (
        <BankAddPopup
          draft={bankDraft}
          setDraft={setBankDraft}
          onClose={() => setBankPopupOpen(false)}
          onSave={saveBankDraft}
        />
      )}
      {gstPopupOpen && (
        <GstScrutinyAddPopup
          draft={gstDraft}
          setDraft={setGstDraft}
          onClose={() => setGstPopupOpen(false)}
          onSave={saveGstDraft}
        />
      )}
      {mapPopupOpen && (
        <AddProductMappingPopup
          draft={mapDraft}
          setDraft={setMapDraft}
          productOpts={productOpts}
          gstPctOpts={gstPctOpts}
          onProductChange={onMapProductChange}
          recompute={recomputeMapTotals}
          onClose={() => setMapPopupOpen(false)}
          onSave={saveMapDraft}
        />
      )}

      {quickAdd && (
        <MasterQuickAddPopup
          slug={quickAdd}
          onClose={() => setQuickAdd(null)}
          onSaved={(row) => {
            // The new master row's id becomes the dropdown's value
            // (the wizard stores FK ids and resolves labels through
            // the Opts array on render). Without this, picking the
            // just-added row would post a stale label to the API
            // and fail the integer FK validation.
            const id = String(row.id ?? '');
            if (!id) { setQuickAdd(null); return; }
            switch (quickAdd) {
              case 'vendor_types': {
                const label = String(row.name ?? '');
                if (label) { setVendorTypeOpts(prev => [...prev, { value: id, label }]); setVendorType(id); clearFieldError('vendorType'); }
                break;
              }
              case 'risk_levels': {
                const label = String(row.name ?? '');
                if (label) { setRiskLevelOpts(prev => [...prev, { value: id, label }]); setRiskLevel(id); clearFieldError('riskLevel'); }
                break;
              }
              case 'vendor_behaviour': {
                const label = String(row.name ?? '');
                if (label) { setBehaviourOpts(prev => [...prev, { value: id, label }]); setVendorBehaviour(id); clearFieldError('vendorBehaviour'); }
                break;
              }
              case 'segments': {
                const label = String(row.title ?? '');
                if (label) {
                  setSegmentOpts(prev => [...prev, { value: id, label }]);
                  /* Multi-select: append the newly-created segment id
                   * rather than replacing the existing selection. Guard
                   * against double-add when the user clicks twice. */
                  setSegment(prev => prev.includes(id) ? prev : [...prev, id]);
                  clearFieldError('segment');
                }
                break;
              }
              case 'compliance_behaviours': {
                const label = String(row.name ?? '');
                if (label) { setComplianceOpts(prev => [...prev, { value: id, label }]); setComplianceBehaviour(id); clearFieldError('complianceBehaviour'); }
                break;
              }
              case 'countries': {
                const label = String(row.name ?? '');
                if (label) { setCountryOpts(prev => [...prev, { value: id, label }]); setCountry(id); clearFieldError('country'); }
                break;
              }
            }
            setQuickAdd(null);
          }}
        />
      )}

      {/* Step 3 Trade Documents → Send for Signature (Zoho Sign).
          Mounts at the modal root so the wizard renders ABOVE the
          vendor form. modelName='Vendor' makes the backend resolve
          the {{supplier.*}} token namespace from this vendor. */}
      <SalesCustomerSendForSignatureModal
        open={Array.isArray(sendForSignature)}
        modelName="Vendor"
        customer={(() => {
          // `vendorId` is the runtime state — covers both edit-mode
          // (prop) and create-mode (set by Stage 1→2 auto-save). The
          // earlier check on `initialVendorId` returned null for newly
          // saved vendors, blocking the wizard from opening even
          // though the row existed on the server.
          if (!vendorId) return null;
          return {
            id:      `v-${vendorId}`,
            db_id:   vendorId,
            company: companyName || '',
            contact: contactName || '',
            email:   email || '',
          };
        })()}
        preselectedDocIds={sendForSignature ?? undefined}
        onClose={() => setSendForSignature(null)}
        onSent={(sentDocIds) => {
          const sentSet = new Set(sentDocIds);
          setTradeDocRows(prev => prev.map(r => (r.db_id && sentSet.has(r.db_id))
            ? { ...r, sendForSignature: false, status: 'inprogress' as const }
            : r));
          setSendForSignature(null);
        }}
      />
    </div>
  ), document.body);
}

/* ──────────────────────────────────────────────────────────────────────────
 * Master Quick-Add popup — opens above the wizard when a "+" button is
 * clicked on a master-backed field. Mirrors the Add Product wizard popup.
 *
 * NOTE on declaration order: `VendorMasterSlug` MUST be declared before
 * `QUICK_ADD_SCHEMAS` because Vite/SWC processes the file top-to-bottom
 * and doesn't always hoist type aliases used inside Record<…> generic
 * arguments. A forward reference here trips the dev transformer with a
 * 500 even though tsc itself is happy.
 * ────────────────────────────────────────────────────────────────────── */
type VendorMasterSlug = 'vendor_types' | 'risk_levels' | 'vendor_behaviour' | 'segments' | 'compliance_behaviours' | 'countries';

type QaField = { name: string; label: string; type?: 'text' | 'number'; required?: boolean; placeholder?: string };

const QUICK_ADD_SCHEMAS: Record<VendorMasterSlug, { title: string; fields: QaField[] }> = {
  vendor_types:          { title: 'Add Supplier Type',       fields: [{ name: 'name',  label: 'Supplier Type',       required: true, placeholder: 'e.g. Genuine / Verified' }] },
  risk_levels:           { title: 'Add Risk Level',          fields: [{ name: 'name',  label: 'Risk Level',          required: true, placeholder: 'e.g. Low, Medium, High' }] },
  vendor_behaviour:      { title: 'Add Supplier Behaviour',  fields: [{ name: 'name',  label: 'Supplier Behaviour',  required: true, placeholder: 'e.g. Excellent / Good' }] },
  segments:              { title: 'Add Segment',             fields: [{ name: 'title', label: 'Segment Name',        required: true, placeholder: 'e.g. Dry Fruits' }] },
  compliance_behaviours: { title: 'Add Compliance Behaviour', fields: [{ name: 'name',  label: 'Behaviour Name',      required: true, placeholder: 'e.g. Compliant, Under Review' }] },
  countries:             { title: 'Add Country',             fields: [{ name: 'name',  label: 'Country Name',        required: true, placeholder: 'e.g. India' }] },
};

function MasterQuickAddPopup(props: {
  slug: VendorMasterSlug;
  onClose: () => void;
  onSaved: (row: Record<string, unknown>) => void;
}) {
  const { slug, onClose, onSaved } = props;
  const toast = useToast();
  const schema = QUICK_ADD_SCHEMAS[slug];
  const [values, setValues] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const set = (k: string, v: string) => {
    setValues(prev => ({ ...prev, [k]: v }));
    if (errors[k]) setErrors(prev => { const n = { ...prev }; delete n[k]; return n; });
  };

  const submit = async () => {
    const errs: Record<string, string> = {};
    schema.fields.forEach(f => {
      if (f.required && !(values[f.name] ?? '').toString().trim()) {
        errs[f.name] = `${f.label} is required`;
      }
    });
    if (Object.keys(errs).length) {
      setErrors(errs);
      toast.error('Missing required fields', 'Please fix the highlighted fields');
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = { ...values, status: 'Active' };
      schema.fields.forEach(f => {
        if (f.type === 'number' && payload[f.name] !== undefined) {
          payload[f.name] = Number(payload[f.name]);
        }
      });
      const res = await api.post<Record<string, unknown>>(`/master/${slug}`, payload);
      toast.success('Saved', `${schema.title.replace('Add ', '')} added`);
      onSaved(res.data);
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string; errors?: Record<string, string[]> } } };
      const fieldErr = err?.response?.data?.errors;
      if (fieldErr) {
        const flat: Record<string, string> = {};
        Object.entries(fieldErr).forEach(([k, v]) => { if (v?.[0]) flat[k] = v[0]; });
        setErrors(flat);
      }
      toast.error('Save failed', err?.response?.data?.message || `Could not add to ${slug}`);
    } finally {
      setSaving(false);
    }
  };

  return createPortal((
    /* Backdrop click intentionally does NOT close the popup — the
       user is mid-edit on a master record and an accidental outside
       click would wipe their input. The only dismissal paths are the
       header ✕ button and the footer Cancel. */
    <div className="avm-qa-backdrop">
      <div className="avm-qa-popup">
        <div className="avm-qa-head">
          <div className="avm-qa-title">
            <i className="ri-add-circle-line" /> {schema.title}
          </div>
          <button className="avm-close avm-qa-close" onClick={onClose} aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>
        <div className="avm-qa-body">
          {schema.fields.map(f => (
            <Field key={f.name} label={f.label} required={f.required} error={errors[f.name]}>
              <input
                className="avm-input"
                type={f.type === 'number' ? 'number' : 'text'}
                placeholder={f.placeholder ?? ''}
                value={values[f.name] ?? ''}
                onChange={(e) => set(f.name, e.target.value)}
              />
            </Field>
          ))}
        </div>
        <div className="avm-qa-foot">
          <button className="avm-btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="avm-btn-primary" onClick={submit} disabled={saving}>
            <i className="ri-save-line" /> Save
          </button>
        </div>
      </div>
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
  /* Newly picked File while the popup is open. The wider ContactRow
   * carries this too so the just-added row keeps a working "View" link
   * via a blob URL until the next /vendors/{id} reload. */
  attachmentFile?: File | null;
  /* Server-stored path on edit. Drives the FileChooser's "existing"
   * state so the user sees the previously-attached file with View +
   * Delete actions instead of an empty input. */
  attachmentPath?: string;
};
function ContactAddPopup(props: {
  draft: ContactDraft;
  setDraft: (next: ContactDraft) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const { draft, setDraft, onClose, onSave } = props;
  const set = <K extends keyof ContactDraft>(k: K, v: ContactDraft[K]) => setDraft({ ...draft, [k]: v });
  return createPortal((
    /* Backdrop click is intentionally NOT wired to onClose so an
       accidental outside click doesn't wipe an in-flight contact entry.
       Header ✕ and footer Cancel are the only dismissal paths. */
    <div className="avm-cp-backdrop">
      <div className="avm-cp-popup">
        <div className="avm-cp-head">
          <div className="avm-cp-title">
            <i className="ri-user-add-line" /> Add Contact Person
          </div>
          <button className="avm-close avm-cp-close" onClick={onClose} aria-label="Close">
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
              <input
                className="avm-input"
                placeholder="Enter 6-15 digit number"
                inputMode="numeric"
                pattern="\d*"
                maxLength={15}
                value={draft.phone}
                onChange={e => set('phone', digitsOnly(e.target.value))}
              />
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
              {/* FileChooser provides the empty-state input + populated-
                 state filename / View / Delete actions. Swapping in here
                 so the contact popup matches the rest of the wizard's
                 file fields and the user can preview / remove an
                 attachment without retyping the form. */}
              <FileChooser
                file={draft.attachmentFile ?? null}
                existingPath={draft.attachmentFile ? undefined : draft.attachmentPath}
                onPick={(f) => setDraft({
                  ...draft,
                  attachmentFile: f,
                  attachmentName: f?.name ?? '',
                  // Picking null = delete. Drop the saved server path too
                  // so the row doesn't silently re-attach it on Save.
                  attachmentPath: f ? draft.attachmentPath : undefined,
                })}
                placeholder="No files attached"
              />
            </Field>
          </div>
        </div>

        <div className="avm-cp-foot">
          <button className="avm-btn-ghost" onClick={onClose}>Cancel</button>
          <button className="avm-btn-primary" onClick={onSave}>
            <i className="ri-save-line" /> Save
          </button>
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

function Field(props: {
  label: string;
  required?: boolean;
  addNew?: boolean;
  onAdd?: () => void;
  error?: string;
  children: ReactNode;
}) {
  /* Renders as a <div>, NOT a <label>. A <label> proxies clicks anywhere
     within it to the first form control inside — when `addNew` is set,
     that first control is the "+" button, so clicking the field area or
     even the label text was firing the quick-add popup. Using a plain
     <div> keeps the visual layout but breaks the click-association
     entirely. */
  return (
    <div className={`avm-field${props.error ? ' has-error' : ''}`}>
      <span className="avm-field-label">
        {props.label}{props.required && <span className="avm-req">*</span>}
        {props.addNew && (
          <button
            type="button"
            className="avm-field-plus"
            tabIndex={-1}
            title={`Add new ${props.label}`}
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); props.onAdd?.(); }}
          >+</button>
        )}
      </span>
      {props.children}
      {props.error && (
        <span className="avm-field-error">
          <i className="ri-error-warning-line" /> {props.error}
        </span>
      )}
    </div>
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

/* Shared file picker for every attachment field in the vendor wizard.
 *
 *  • Accepts JPG / PNG / PDF only — both the native picker's MIME
 *    filter AND a runtime guard on pick (since users can bypass the
 *    picker's filter by selecting "All Files").
 *  • Caps file size at 2 MB.
 *  • After a file is picked (or when an existing server path is
 *    passed in), the empty "Choose file" affordance is replaced with
 *    a compact row: filename + View button (opens in a new tab) +
 *    Delete button (clears the file).
 *
 *  `existingPath` is set on rows hydrated from /vendors/{id} so the
 *  View link works on previously-uploaded files without re-uploading.
 */
const FILE_ACCEPT     = '.jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf';
const FILE_MAX_BYTES  = 2 * 1024 * 1024; // 2 MB
const FILE_TYPE_LABEL = 'JPG / PNG / PDF';

function FileChooser(props: {
  file: File | null;
  onPick: (f: File | null) => void;
  placeholder?: string;
  existingPath?: string;
  /** Pre-resolved URL from the backend (file_url() helper). Prefer this
   *  over composing a URL via resolveFileUrl(existingPath) — the helper
   *  knows about Azure Blob Storage, where Storage::url() is the only
   *  authoritative URL builder. */
  existingUrl?: string;
}) {
  const { file, onPick, placeholder, existingPath, existingUrl } = props;
  const toast = useToast();

  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0] ?? null;
    if (!picked) { onPick(null); return; }
    // Validate format — picker MIME filter is advisory, native dialog
    // lets the user override it.
    const ok =
      /^(image\/(jpeg|png)|application\/pdf)$/i.test(picked.type) ||
      /\.(jpe?g|png|pdf)$/i.test(picked.name);
    if (!ok) {
      toast.error('Unsupported file', `Only ${FILE_TYPE_LABEL} files are allowed`);
      e.target.value = '';
      return;
    }
    if (picked.size > FILE_MAX_BYTES) {
      toast.error('File too large', `${picked.name} exceeds the 2 MB limit`);
      e.target.value = '';
      return;
    }
    onPick(picked);
  };

  const hasFile = !!file || !!existingPath;
  // Strip the storage prefix from the filename so users see the original
  // upload name (e.g. "PAN Card.pdf"), not the slug+rand prefix that
  // absorbFile() puts in front to keep filenames collision-safe.
  const stripPrefix = (n: string) => {
    const idx = n.indexOf('__');
    return idx >= 0 ? n.slice(idx + 2) : n;
  };
  const fileName = file?.name ?? (existingPath ? stripPrefix(existingPath.split('/').pop() ?? 'Attachment') : '');
  const viewHref = file
    ? URL.createObjectURL(file)
    : (existingUrl || (existingPath ? resolveFileUrl(existingPath) : ''));

  if (!hasFile) {
    // Empty state — clickable drop affordance.
    return (
      <div className="avm-filechooser">
        <input
          type="file"
          className="avm-filechooser-input"
          accept={FILE_ACCEPT}
          onChange={onChange}
        />
        <span className="avm-filechooser-icon"><i className="ri-attachment-line" /></span>
        <span className="avm-filechooser-text">{placeholder ?? `Choose file (${FILE_TYPE_LABEL}, max 2 MB)`}</span>
      </div>
    );
  }

  // Populated state — filename + View / Delete actions. The whole
  // strip stays visually consistent with the empty affordance. The
  // filename itself is also clickable when a view URL is available,
  // so the user doesn't have to aim at the small 👁 button.
  return (
    <div className="avm-filechooser avm-filechooser-has-file">
      <span className="avm-filechooser-icon"><i className="ri-attachment-line" /></span>
      {viewHref ? (
        <a
          href={viewHref}
          target="_blank"
          rel="noopener noreferrer"
          className="avm-filechooser-text avm-filechooser-link"
          title={`Open ${fileName}`}
          onClick={(e) => e.stopPropagation()}
        >
          {fileName}
        </a>
      ) : (
        <span className="avm-filechooser-text" title={fileName}>{fileName}</span>
      )}
      <div className="avm-filechooser-actions">
        {viewHref && (
          <a
            href={viewHref}
            target="_blank"
            rel="noopener noreferrer"
            className="avm-fc-action avm-fc-view"
            title="View attachment"
            aria-label="View attachment"
            onClick={(e) => e.stopPropagation()}
          >
            <i className="ri-eye-line" />
          </a>
        )}
        <button
          type="button"
          className="avm-fc-action avm-fc-delete"
          title="Delete attachment"
          aria-label="Delete attachment"
          onClick={(e) => { e.stopPropagation(); e.preventDefault(); onPick(null); }}
        >
          <i className="ri-delete-bin-line" />
        </button>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
 * Step 2 row tables — one per KYC tab. Each table renders the user-added
 * row list, an empty state, and per-row actions (delete + optional file
 * attach for mandatory seed rows). All five are intentionally similar in
 * shape so the styling stays consistent with the rest of the modal.
 * ────────────────────────────────────────────────────────────────────── */
function EmptyTable(props: { label: string }) {
  return <div className="avm-empty">{props.label}</div>;
}

/* Segment-rule reference table — rendered in Step 2 sub-tabs (Company
 * DD, Owner KYC, Trade License) when no live rows have been captured
 * yet AND the selected supplier segment's rule defines required
 * documents. Acts as a checklist of what the segment expects. Each
 * row's Actions cell starts as a single Upload button; on file pick
 * it flips to View / Download / Delete via a blob URL held in the
 * parent's `uploads` map. */
function SupplierSegmentRefTable(props: {
  title: string;
  tabKey: string;
  rows: { code: string; name: string; authority?: string | null; expiry?: string | null; requirement: 'M' | 'O' }[];
  uploads: Record<string, { file: File | null; url: string; name: string }>;
  setUploads: React.Dispatch<React.SetStateAction<Record<string, { file: File | null; url: string; name: string }>>>;
  persistUpload: (refKey: string, file: File, docName: string) => Promise<void> | void;
}) {
  const { title, tabKey, rows, uploads, setUploads, persistUpload } = props;
  /* Show the blob URL immediately for instant feedback, then fire the
   * server upload — the persist callback swaps the blob URL for a
   * permanent attachment_url once the row lands in segment_doc_uploads. */
  const onPick = (refKey: string, docName: string, f: File | undefined) => {
    if (!f) return;
    setUploads(prev => {
      const existing = prev[refKey];
      if (existing?.url && existing.url.startsWith('blob:')) {
        try { URL.revokeObjectURL(existing.url); } catch {}
      }
      return { ...prev, [refKey]: { file: f, url: URL.createObjectURL(f), name: f.name } };
    });
    void persistUpload(refKey, f, docName);
  };
  return (
    <div className="table-responsive table-card border rounded">
      <table className="table align-middle table-nowrap mb-0">
        <thead className="table-light">
          <tr>
            <th>SR NO</th>
            <th>AUTO CODE</th>
            <th>{title}</th>
            <th>ISSUING AUTHORITY</th>
            <th>EXPIRY</th>
            <th>STATUS</th>
            <th>FILE</th>
            <th>ACTIONS</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const refKey = `${tabKey}::${r.code}`;
            const uploaded = uploads[refKey];
            return (
              <tr key={r.code} style={{ background: '#fafafa' }}>
                <td>{String(i + 1).padStart(2, '0')}</td>
                <td><span className="avm-auto-code">{r.code}</span></td>
                <td><strong>{r.name}</strong></td>
                <td>{r.authority || '—'}</td>
                <td>{r.expiry || 'N/A'}</td>
                <td>
                  <span className={`avm-pill ${r.requirement === 'M' ? 'avm-pill-success' : 'avm-pill-muted'}`}>
                    {r.requirement === 'M' ? '✓ Mandatory' : 'Optional'}
                  </span>
                </td>
                <td>
                  {uploaded
                    ? <a href={uploaded.url} target="_blank" rel="noreferrer" style={{ color:'#0d9488', fontWeight:600 }}>{uploaded.name}</a>
                    : <span style={{ color: '#9ca3af', fontStyle: 'italic' }}>Not uploaded</span>}
                </td>
                <td>
                  {!uploaded ? (
                    <label className="btn btn-sm btn-soft-primary mb-0" title="Upload" style={{ cursor: 'pointer' }}>
                      <i className="ri-upload-2-line" />
                      <input type="file" hidden onChange={e => onPick(refKey, r.name, e.target.files?.[0])} />
                    </label>
                  ) : (
                    <div className="hstack gap-1">
                      <a href={uploaded.url} target="_blank" rel="noreferrer" className="btn btn-sm btn-soft-info" title={`View ${uploaded.name}`}>
                        <i className="ri-eye-line" />
                      </a>
                      <a href={uploaded.url} download={uploaded.name} className="btn btn-sm btn-soft-secondary" title={`Download ${uploaded.name}`}>
                        <i className="ri-download-2-line" />
                      </a>
                      <label className="btn btn-sm btn-soft-primary mb-0" title="Re-upload (replace file)" style={{ cursor: 'pointer' }}>
                        <i className="ri-refresh-line" />
                        <input type="file" hidden onChange={e => onPick(refKey, r.name, e.target.files?.[0])} />
                      </label>
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* Reusable FILE-cell renderer for the KYC tables — shows the filename
 * plus inline View (opens the file in a new tab) and Delete (clears
 * the attachment) action buttons. Works equally well for freshly-
 * picked File objects (via createObjectURL) and previously-uploaded
 * server paths (via resolveFileUrl). */
function AttachmentCell(props: {
  fileName?: string;
  file?: File | null;
  existingPath?: string;
  existingUrl?: string;
  onClear?: () => void;
}) {
  const { fileName, file, existingPath, existingUrl, onClear } = props;
  const hasContent = !!(fileName || file || existingPath);
  if (!hasContent) return <span className="text-muted fs-13">—</span>;
  const href = file
    ? URL.createObjectURL(file)
    : (existingUrl || (existingPath ? resolveFileUrl(existingPath) : ''));
  return (
    <div className="d-inline-flex align-items-center gap-2">
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="fs-13 text-truncate d-inline-flex align-items-center"
          style={{ maxWidth: 180, color: '#4338ca', textDecoration: 'underline', textUnderlineOffset: 2 }}
          title={`Open ${fileName}`}
        >
          <i className="ri-attachment-line me-1" />
          {fileName || 'Attachment'}
        </a>
      ) : (
        <span className="fs-13 text-truncate" style={{ maxWidth: 180 }} title={fileName}>
          <i className="ri-attachment-line text-muted me-1" />
          {fileName || 'Attachment'}
        </span>
      )}
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="btn btn-sm btn-soft-primary p-0 d-inline-flex align-items-center justify-content-center"
          style={{ width: 26, height: 26 }}
          title="View attachment"
          aria-label="View attachment"
        >
          <i className="ri-eye-line" style={{ fontSize: 13 }} />
        </a>
      ) : null}
      {onClear ? (
        <button
          type="button"
          onClick={onClear}
          className="btn btn-sm btn-soft-danger p-0 d-inline-flex align-items-center justify-content-center"
          style={{ width: 26, height: 26 }}
          title="Delete attachment"
          aria-label="Delete attachment"
        >
          <i className="ri-delete-bin-line" style={{ fontSize: 13 }} />
        </button>
      ) : null}
    </div>
  );
}

function DdTable(props: {
  rows: DueDiligenceRow[];
  onRemove?: (id: string) => void;
  onAttach?: (id: string, file: File) => void;
  onClearFile?: (id: string) => void;
  readOnly?: boolean;
}) {
  if (props.rows.length === 0) return <EmptyTable label="No due-diligence documents added yet. Use “+ Add More Due Diligence” to begin." />;
  return (
    <div className="table-responsive table-card border rounded">
      <table className="table align-middle table-nowrap mb-0">
        <thead className="table-light">
          <tr>
            <th>SR NO</th>
            <th>AUTO CODE</th>
            <th>DD DOCUMENT NAME</th>
            <th>ISSUING AUTHORITY</th>
            <th>EXPIRY</th>
            <th>STATUS</th>
            <th>FILE</th>
            {!props.readOnly && <th>ACTIONS</th>}
          </tr>
        </thead>
        <tbody>
          {props.rows.map((r, i) => (
            <tr key={r.id}>
              <td>{String(i + 1).padStart(2, '0')}</td>
              <td><span className="avm-auto-code">{r.code}</span></td>
              <td><strong>{r.documentName}</strong></td>
              <td>{r.issuingAuthority}</td>
              <td>{r.expiry || 'N/A'}</td>
              <td>
                <span className={`avm-pill ${r.mandatory ? 'avm-pill-success' : 'avm-pill-muted'}`}>
                  {r.mandatory ? '✓ Mandatory' : 'Optional'}
                </span>
              </td>
              <td>
                <AttachmentCell
                  fileName={r.fileName}
                  file={r.file}
                  existingPath={r.existingPath}
                  existingUrl={r.existingUrl}
                  onClear={props.onClearFile && !props.readOnly ? () => props.onClearFile?.(r.id) : undefined}
                />
              </td>
              {!props.readOnly && (
                <td>
                  <div className="hstack gap-1">
                    {/* Mandatory seed rows let the user attach a file inline
                        instead of going through the Add modal, since their
                        row metadata is already populated. */}
                    {props.onAttach && (
                      <label className="btn btn-sm btn-soft-primary mb-0" title="Upload">
                        <i className={r.fileName ? 'ri-checkbox-circle-line' : 'ri-upload-2-line'} />
                        <input type="file" hidden onChange={e => {
                          const f = e.target.files?.[0];
                          if (f && props.onAttach) props.onAttach(r.id, f);
                        }} />
                      </label>
                    )}
                    {props.onRemove && !r.mandatory && (
                      <button type="button" className="btn btn-sm btn-soft-danger" onClick={() => props.onRemove?.(r.id)} title="Remove">
                        <i className="ri-delete-bin-line" />
                      </button>
                    )}
                  </div>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OwnerKycTable(props: {
  rows: OwnerKycRow[];
  onRemove?: (id: string) => void;
  onClearFile?: (id: string) => void;
  readOnly?: boolean;
}) {
  if (props.rows.length === 0) return <EmptyTable label="No owner-KYC documents added yet. Use “+ Add Owner KYC” to begin." />;
  return (
    <div className="table-responsive table-card border rounded">
      <table className="table align-middle table-nowrap mb-0">
        <thead className="table-light">
          <tr>
            <th>SR NO</th>
            <th>AUTO CODE</th>
            <th>KYC DOCUMENT NAME</th>
            <th>ISSUING AUTHORITY</th>
            <th>DOCUMENT NO</th>
            <th>ISSUE DATE</th>
            <th>EXPIRY</th>
            <th>STATUS</th>
            <th>FILE</th>
            {!props.readOnly && <th>ACTIONS</th>}
          </tr>
        </thead>
        <tbody>
          {props.rows.map((r, i) => (
            <tr key={r.id}>
              <td>{String(i + 1).padStart(2, '0')}</td>
              <td><span className="avm-auto-code">{r.code}</span></td>
              <td><strong>{r.documentName}</strong></td>
              <td>{r.issuingAuthority}</td>
              <td><span className="font-monospace fs-13">{r.documentNumber || '—'}</span></td>
              <td>{r.issueDate || '—'}</td>
              <td>{r.expiry || 'N/A'}</td>
              <td>
                <span className={`avm-pill ${r.status === 'Active' ? 'avm-pill-success' : 'avm-pill-muted'}`}>
                  {r.status}
                </span>
              </td>
              <td>
                <AttachmentCell
                  fileName={r.fileName}
                  file={r.file}
                  existingPath={r.existingPath}
                  existingUrl={r.existingUrl}
                  onClear={props.onClearFile && !props.readOnly ? () => props.onClearFile?.(r.id) : undefined}
                />
              </td>
              {!props.readOnly && (
                <td>
                  <button type="button" className="btn btn-sm btn-soft-danger" onClick={() => props.onRemove?.(r.id)} title="Remove">
                    <i className="ri-delete-bin-line" />
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TradeLicenseTable(props: {
  rows: TradeLicenseRow[];
  onRemove?: (id: string) => void;
  onAttach?: (id: string, file: File) => void;
  onClearFile?: (id: string) => void;
  readOnly?: boolean;
}) {
  if (props.rows.length === 0) return <EmptyTable label="No trade licenses added yet. Use “+ Add Trade License” to begin." />;
  return (
    <div className="table-responsive table-card border rounded">
      <table className="table align-middle table-nowrap mb-0">
        <thead className="table-light">
          <tr>
            <th>SR NO</th>
            <th>AUTO CODE</th>
            <th>LICENSE TYPE</th>
            <th>LICENSE NO</th>
            <th>ISSUING AUTHORITY</th>
            <th>ISSUE</th>
            <th>EXPIRY</th>
            <th>FILE</th>
            {!props.readOnly && <th>ACTIONS</th>}
          </tr>
        </thead>
        <tbody>
          {props.rows.map((r, i) => {
            const isSeed = r.id.startsWith('seed-');
            return (
              <tr key={r.id}>
                <td>{String(i + 1).padStart(2, '0')}</td>
                <td><span className="avm-auto-code">{r.code}</span></td>
                <td><strong>{r.licenseType}</strong></td>
                <td><span className="font-monospace fs-13">{r.licenseNumber || '—'}</span></td>
                <td>{r.issuingAuthority}</td>
                <td>{r.issueDate || '—'}</td>
                <td>{r.expiryDate || '—'}</td>
                <td>
                  <AttachmentCell
                    fileName={r.fileName}
                    file={r.file}
                    existingPath={r.existingPath}
                    existingUrl={r.existingUrl}
                    onClear={props.onClearFile && !props.readOnly ? () => props.onClearFile?.(r.id) : undefined}
                  />
                </td>
                {!props.readOnly && (
                  <td>
                    <div className="hstack gap-1">
                      {props.onAttach && (
                        <label className="btn btn-sm btn-soft-primary mb-0" title="Upload">
                          <i className={r.fileName ? 'ri-checkbox-circle-line' : 'ri-upload-2-line'} />
                          <input type="file" hidden onChange={e => {
                            const f = e.target.files?.[0];
                            if (f && props.onAttach) props.onAttach(r.id, f);
                          }} />
                        </label>
                      )}
                      {props.onRemove && !isSeed && (
                        <button type="button" className="btn btn-sm btn-soft-danger" onClick={() => props.onRemove?.(r.id)} title="Remove">
                          <i className="ri-delete-bin-line" />
                        </button>
                      )}
                    </div>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function BankTable(props: { rows: BankRow[]; onRemove?: (id: string) => void; onClearFile?: (id: string) => void }) {
  if (props.rows.length === 0) return <EmptyTable label="No bank records added yet." />;
  return (
    <div className="table-responsive table-card border rounded">
      <table className="table align-middle table-nowrap mb-0">
        <thead className="table-light">
          <tr>
            <th>SR NO</th>
            <th>BANK NAME</th>
            <th>BRANCH</th>
            <th>ACCOUNT NO</th>
            <th>IFSC CODE</th>
            <th>BRANCH ADDRESS</th>
            <th>PROOF ATTACHMENT</th>
            <th>ACTION</th>
          </tr>
        </thead>
        <tbody>
          {props.rows.map((r, i) => (
            <tr key={r.id}>
              <td>{String(i + 1).padStart(2, '0')}</td>
              <td><strong>{r.bankName}</strong></td>
              <td>{r.branchName}</td>
              <td><span className="font-monospace fs-13">{r.accountNumber}</span></td>
              <td><span className="font-monospace fs-13">{r.ifsc}</span></td>
              <td>{r.branchAddress || '—'}</td>
              <td>
                <AttachmentCell
                  fileName={r.chequeFileName}
                  file={r.chequeFile}
                  existingPath={r.existingPath}
                  existingUrl={r.existingUrl}
                  onClear={props.onClearFile ? () => props.onClearFile?.(r.id) : undefined}
                />
              </td>
              <td>
                <button type="button" className="btn btn-sm btn-soft-danger" onClick={() => props.onRemove?.(r.id)} title="Remove">
                  <i className="ri-delete-bin-line" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function GstScrutinyTable(props: { rows: GstScrutinyRow[]; onRemove?: (id: string) => void }) {
  if (props.rows.length === 0) return <EmptyTable label="No GST scrutiny entries added yet." />;
  return (
    <div className="table-responsive table-card border rounded">
      <table className="table align-middle table-nowrap mb-0">
        <thead className="table-light">
          <tr>
            <th>SR NO</th>
            <th>GST NUMBER</th>
            <th>STATUS</th>
            <th>LAST FILING</th>
            <th>PREV 2A INVOICE</th>
            <th>RED FLAGS</th>
            <th>ACTIONS</th>
          </tr>
        </thead>
        <tbody>
          {props.rows.map((r, i) => (
            <tr key={r.id}>
              <td>{String(i + 1).padStart(2, '0')}</td>
              <td><span className="font-monospace fs-13">{r.gstNumber}</span></td>
              <td>
                <span className={`avm-pill ${r.status === 'Active' ? 'avm-pill-success' : (r.status === 'Suspended' ? 'avm-pill-warning' : 'avm-pill-danger')}`}>
                  {r.status}
                </span>
              </td>
              <td>{r.lastFilingDate || '—'}</td>
              <td>{r.prevNonGst2aInvoice || '—'}</td>
              <td>{r.redFlags || '—'}</td>
              <td>
                <button type="button" className="btn btn-sm btn-soft-danger" onClick={() => props.onRemove?.(r.id)} title="Remove">
                  <i className="ri-delete-bin-line" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
 * Step 3 — Trade Documents table. Fixed list of agreements with a
 * per-row send-for-signature checkbox + Send button, plus document
 * status pill. Header checkbox bulk-toggles every row's checkbox.
 * ────────────────────────────────────────────────────────────────────── */
function TradeDocsTable(props: {
  rows: TradeDocRow[];
  onToggleAll: () => void;
  onToggleSign: (code: string) => void;
  onSend: (code: string) => void;
  onSendSelected: () => void;
}) {
  const allChecked = props.rows.length > 0 && props.rows.every(r => r.sendForSignature);
  // Map raw signature status → display label + pill colour. Legacy
  // 'Sent'/'Signed'/'N/A' values still come back from local-only state
  // (rows that haven't been hit by the poller yet); the live values
  // come from the polling loop in the parent.
  const badge = (status: TradeDocRow['status']): { label: string; cls: string } => {
    switch (status) {
      case 'completed': case 'Signed':     return { label: 'Signed',             cls: 'avm-pill-primary' };
      case 'inprogress': case 'Sent':       return { label: 'Awaiting Signature', cls: 'avm-pill-success' };
      case 'declined':                      return { label: 'Declined',           cls: 'avm-pill-muted' };
      case 'recalled':                      return { label: 'Recalled',           cls: 'avm-pill-muted' };
      case 'expired':                       return { label: 'Expired',            cls: 'avm-pill-muted' };
      default:                              return { label: 'N/A',                cls: 'avm-pill-muted' };
    }
  };
  return (
    <div>
      <div className="table-responsive table-card border rounded">
        <table className="table align-middle table-nowrap mb-0">
          <thead className="table-light">
            <tr>
              <th>SR NO</th>
              <th>DOCUMENT NAME</th>
              <th style={{ minWidth: 260 }}>
                <label className="d-inline-flex align-items-center gap-2 mb-0">
                  <input type="checkbox" checked={allChecked} onChange={props.onToggleAll} />
                  SEND DOCUMENT FOR SIGNATURE
                </label>
              </th>
              <th>DOCUMENT STATUS</th>
              <th>ACTIONS</th>
            </tr>
          </thead>
          <tbody>
            {props.rows.map((r, i) => {
              const b = badge(r.status);
              const viewHref = r.signedUrl || (r.attachmentName ? '#' : '#');
              const canView  = !!r.signedUrl || !!r.attachmentName;
              return (
                <tr key={r.code}>
                  <td>{String(i + 1)}</td>
                  <td><strong>{r.name}</strong></td>
                  <td>
                    {(() => {
                      // Once the signer is done (`completed` from polling,
                      // or the legacy 'Signed' local-state value), block
                      // resend — it would create a fresh request against
                      // an archived PDF. declined / recalled / expired
                      // stay re-sendable so the user can retry.
                      const isSigned = r.status === 'completed' || r.status === 'Signed';
                      return (
                        <div className="d-inline-flex align-items-center gap-2">
                          <input
                            type="checkbox"
                            checked={r.sendForSignature}
                            onChange={() => props.onToggleSign(r.code)}
                            disabled={isSigned}
                          />
                          <button
                            type="button"
                            className="avm-btn-primary"
                            style={{
                              padding: '6px 14px',
                              fontSize: 13,
                              opacity: (isSigned || r.cooldownActive) ? 0.5 : 1,
                              cursor:  (isSigned || r.cooldownActive) ? 'not-allowed' : 'pointer',
                            }}
                            onClick={() => { if (!isSigned && !r.cooldownActive) props.onSend(r.code); }}
                            disabled={isSigned || !!r.cooldownActive}
                            title={
                              isSigned         ? 'This document has already been signed.'
                              : r.cooldownActive ? 'Reminder just sent — one reminder covers every document in this bundle.'
                              : (r.status === 'N/A' ? 'Send for signature' : 'Resend for signature')
                            }
                          >
                            <i className="ri-send-plane-line me-1" /> {r.cooldownActive ? 'Sent ✓' : (r.status === 'N/A' ? 'Send' : 'Resend')}
                          </button>
                        </div>
                      );
                    })()}
                  </td>
                  <td>
                    <span className={`avm-pill ${b.cls}`}>{b.label}</span>
                  </td>
                  <td>
                    <div className="hstack gap-1">
                      <a
                        href={r.signedUrl || viewHref}
                        target={r.signedUrl ? '_blank' : undefined}
                        rel={r.signedUrl ? 'noreferrer' : undefined}
                        onClick={e => { if (!canView) e.preventDefault(); }}
                        className="btn btn-sm btn-soft-secondary"
                        title={r.signedUrl ? 'View signed document' : 'View'}
                        style={{ opacity: canView ? 1 : 0.5, pointerEvents: canView ? 'auto' : 'none' }}
                      >
                        <i className="ri-eye-line" />
                      </a>
                      <a
                        href={r.signedUrl || '#'}
                        download={r.signedUrl ? '' : undefined}
                        onClick={e => { if (!r.signedUrl) e.preventDefault(); }}
                        className="btn btn-sm btn-soft-secondary"
                        title={r.signedUrl ? 'Download signed document' : 'Download'}
                        style={{ opacity: r.signedUrl ? 1 : 0.5, pointerEvents: r.signedUrl ? 'auto' : 'none' }}
                      >
                        <i className="ri-download-2-line" />
                      </a>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {props.rows.length > 0 && (
        <div style={{ marginTop: 12, display: 'flex', justifyContent: 'center' }}>
          <button type="button" className="avm-btn-primary" onClick={props.onSendSelected}>
            <i className="ri-send-plane-line me-1" /> Send Selected Documents for Signature
          </button>
        </div>
      )}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
 * Step 4 — Product mapping table. Lists products linked to this vendor
 * with purchase price + GST + total. Empty state until "+ Add More
 * Products" is clicked.
 * ────────────────────────────────────────────────────────────────────── */
function ProductMappingTable(props: { rows: ProductMappingRow[]; onRemove: (id: string) => void }) {
  if (props.rows.length === 0) return <EmptyTable label="No products mapped yet. Use “+ Add More Products” to link this vendor to one or more products." />;
  return (
    <div className="table-responsive table-card border rounded">
      <table className="table align-middle table-nowrap mb-0">
        <thead className="table-light">
          <tr>
            <th>SR NO</th>
            <th>PRODUCT CODE</th>
            <th>PRODUCT NAME</th>
            <th>HSN / SAC</th>
            <th>SEGMENT</th>
            <th>BATCH / LOT</th>
            <th>PRICE (₹)</th>
            <th>GST %</th>
            <th>GST AMT (₹)</th>
            <th>TOTAL (₹)</th>
            <th>ACTIONS</th>
          </tr>
        </thead>
        <tbody>
          {props.rows.map((r, i) => (
            <tr key={r.id}>
              <td>{String(i + 1).padStart(2, '0')}</td>
              <td><span className="avm-auto-code">{r.productCode}</span></td>
              <td><strong>{r.productName}</strong></td>
              <td><span className="font-monospace fs-13">{r.hsnSacCode || '—'}</span></td>
              <td>{r.segment || '—'}</td>
              <td>{r.batchSerialLot || '—'}</td>
              <td className="text-end font-monospace fs-13">{r.purchasePrice.toFixed(2)}</td>
              <td className="text-end font-monospace fs-13">{r.gstPercentage ? `${r.gstPercentage.toFixed(2)}%` : '—'}</td>
              <td className="text-end font-monospace fs-13">{r.gstAmount.toFixed(2)}</td>
              <td className="text-end font-monospace fs-13"><strong>{r.totalAmount.toFixed(2)}</strong></td>
              <td>
                <button type="button" className="btn btn-sm btn-soft-danger" onClick={() => props.onRemove(r.id)} title="Remove">
                  <i className="ri-delete-bin-line" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
 * Doc table — used by Step 3's Trade Documents sub-tab (legacy upload-toggle
 * UX for the read-only trade-docs repository).
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
                  <td><span className="avm-auto-code">{r.code}</span></td>
                  <td><strong>{r.name}</strong></td>
                  <td>{r.authority}</td>
                  <td>
                    <span className={`avm-pill ${expiryDanger ? 'avm-pill-danger' : 'avm-pill-muted'}`}>
                      {r.expiry}
                    </span>
                  </td>
                  {props.showMandatory && (
                    <td>
                      <span className={`avm-pill ${r.mandatory ? 'avm-pill-success' : 'avm-pill-muted'}`}>
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
 * Step 2 popups — one per KYC tab. Each one captures a single row's
 * draft, validates on save, and hands the row up to the parent. All
 * five share the same backdrop / shell styling as ContactAddPopup so
 * focus + escape behaviour stays consistent.
 * ────────────────────────────────────────────────────────────────────── */
type Setter<T> = (v: T) => void;

function PopupShell(props: {
  title: string;
  icon: string;
  subtitle?: string;
  onClose: () => void;
  onSave: () => void;
  children: ReactNode;
}) {
  return createPortal((
    /* Backdrop click does NOT dismiss — these popups (DD / Owner
       KYC / Trade License / Bank / GST / Product Mapping) all
       collect form input that's easy to lose on a stray click. */
    <div className="avm-cp-backdrop">
      <div className="avm-cp-popup">
        <div className="avm-cp-head">
          <div className="avm-cp-title">
            <i className={props.icon} /> {props.title}
            {props.subtitle && <div className="avm-cp-subtitle">{props.subtitle}</div>}
          </div>
          <button className="avm-close avm-cp-close" onClick={props.onClose} aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>
        <div className="avm-cp-body">{props.children}</div>
        <div className="avm-cp-foot">
          <button className="avm-btn-ghost" onClick={props.onClose}>Cancel</button>
          <button className="avm-btn-primary" onClick={props.onSave}>
            <i className="ri-save-line" /> Save
          </button>
        </div>
      </div>
    </div>
  ), document.body);
}

type DdAddPopupDraft = { documentName: string; issuingAuthority: string; expiry: string; mandatory: boolean; file: File | null; fileName: string };
function DdAddPopup(props: {
  nextCodePreview: string;
  draft: DdAddPopupDraft;
  setDraft: Setter<DdAddPopupDraft>;
  onClose: () => void;
  onSave: () => void;
}) {
  const { draft, setDraft, onClose, onSave, nextCodePreview } = props;
  const set = <K extends keyof typeof draft>(k: K, v: typeof draft[K]) => setDraft({ ...draft, [k]: v });
  return (
    <PopupShell title="Add Due Diligence Document" icon="ri-file-text-line" onClose={onClose} onSave={onSave}>
      <div className="avm-grid-2">
        <Field label="Auto Code">
          <input className="avm-input" value={nextCodePreview} readOnly style={{ color: '#d97706', fontFamily: 'monospace', fontWeight: 600 }} />
        </Field>
        <Field label="DD Document Name" required>
          <input className="avm-input" placeholder="e.g. Memorandum of Association" value={draft.documentName} onChange={e => set('documentName', e.target.value)} />
        </Field>
      </div>
      <div className="avm-grid-2">
        <Field label="Issuing Authority" required>
          <input className="avm-input" placeholder="e.g. Registrar of Companies (ROC)" value={draft.issuingAuthority} onChange={e => set('issuingAuthority', e.target.value)} />
        </Field>
        <Field label="Expiry">
          <input className="avm-input" placeholder="MM/YYYY or N/A" value={draft.expiry} onChange={e => set('expiry', e.target.value)} />
        </Field>
      </div>
      <div className="avm-grid-2">
        <Field label="Status">
          <SelectInput value={draft.mandatory ? 'Mandatory' : 'Optional'} onChange={v => set('mandatory', v === 'Mandatory')} options={['Mandatory', 'Optional']} />
        </Field>
        <Field label="Upload Document">
          <FileChooser
            file={draft.file}
            existingPath={draft.existingPath}
            onPick={f => setDraft({ ...draft, file: f, fileName: f?.name ?? '', existingPath: f ? undefined : draft.existingPath })}
            placeholder="Upload DD document (JPG / PNG / PDF, max 2 MB)"
          />
        </Field>
      </div>
    </PopupShell>
  );
}

type OwnerKycAddPopupDraft = { documentName: string; issuingAuthority: string; documentNumber: string; issueDate: string; expiry: string; status: 'Active' | 'Inactive'; file: File | null; fileName: string };
function OwnerKycAddPopup(props: {
  nextCodePreview: string;
  draft: OwnerKycAddPopupDraft;
  setDraft: Setter<OwnerKycAddPopupDraft>;
  onClose: () => void;
  onSave: () => void;
}) {
  const { draft, setDraft, onClose, onSave, nextCodePreview } = props;
  const set = <K extends keyof typeof draft>(k: K, v: typeof draft[K]) => setDraft({ ...draft, [k]: v });
  return (
    <PopupShell title="Add Owner KYC Document" icon="ri-user-add-line" subtitle="Upload an identity, address, or compliance document for the owner" onClose={onClose} onSave={onSave}>
      <div className="avm-grid-2">
        <Field label="Auto Code">
          <input className="avm-input" value={nextCodePreview} readOnly style={{ color: '#d97706', fontFamily: 'monospace', fontWeight: 600 }} />
        </Field>
        <Field label="KYC Document Name" required>
          <input className="avm-input" placeholder="e.g. PAN Card, Aadhaar Card, Passport" value={draft.documentName} onChange={e => set('documentName', e.target.value)} />
        </Field>
      </div>
      <div className="avm-grid-2">
        <Field label="Issuing Authority" required>
          <input className="avm-input" placeholder="e.g. Income Tax Department" value={draft.issuingAuthority} onChange={e => set('issuingAuthority', e.target.value)} />
        </Field>
        <Field label="Document Number">
          <input className="avm-input" placeholder="e.g. AABCT1234F" value={draft.documentNumber} onChange={e => set('documentNumber', e.target.value)} />
        </Field>
      </div>
      <div className="avm-grid-3">
        <Field label="Issue Date">
          <MasterDatePicker
            value={draft.issueDate}
            onChange={(v) => set('issueDate', v)}
            placeholder="dd/mm/yyyy"
            maxDate={new Date().toISOString().slice(0, 10)}
          />
        </Field>
        <Field label="Expiry">
          <input className="avm-input" placeholder="MM/YYYY or N/A" value={draft.expiry} onChange={e => set('expiry', e.target.value)} />
        </Field>
        <Field label="Status">
          <SelectInput value={draft.status} onChange={v => set('status', v as 'Active' | 'Inactive')} options={['Active', 'Inactive']} />
        </Field>
      </div>
      <Field label="Upload Document" required>
        <FileChooser
          file={draft.file}
          existingPath={draft.existingPath}
          onPick={f => setDraft({ ...draft, file: f, fileName: f?.name ?? '', existingPath: f ? undefined : draft.existingPath })}
          placeholder="Upload KYC document (JPG / PNG / PDF, max 2 MB)"
        />
      </Field>
    </PopupShell>
  );
}

type TradeLicenseAddPopupDraft = { licenseType: string; licenseNumber: string; issuingAuthority: string; issueDate: string; expiryDate: string; file: File | null; fileName: string };
function TradeLicenseAddPopup(props: {
  draft: TradeLicenseAddPopupDraft;
  setDraft: Setter<TradeLicenseAddPopupDraft>;
  typeOpts: Array<{ value: string; label: string }>;
  onClose: () => void;
  onSave: () => void;
}) {
  const { draft, setDraft, onClose, onSave, typeOpts } = props;
  const set = <K extends keyof typeof draft>(k: K, v: typeof draft[K]) => setDraft({ ...draft, [k]: v });
  return (
    <PopupShell title="Add Trade License" icon="ri-file-list-3-line" subtitle="Register a regulatory license, certification, or trade authorization" onClose={onClose} onSave={onSave}>
      <div className="avm-grid-2">
        <Field label="License Type" required>
          {typeOpts.length > 0
            ? <SelectInput value={draft.licenseType} onChange={v => set('licenseType', v)} placeholder="Select License Type" options={typeOpts} />
            : <input className="avm-input" placeholder="e.g. FSSAI License" value={draft.licenseType} onChange={e => set('licenseType', e.target.value)} />}
        </Field>
        <Field label="License Number" required>
          <input className="avm-input" placeholder="e.g. 10019011000123" value={draft.licenseNumber} onChange={e => set('licenseNumber', e.target.value)} />
        </Field>
      </div>
      <div className="avm-grid-3">
        <Field label="Issuing Authority" required>
          <input className="avm-input" placeholder="e.g. FSSAI, Govt. of India" value={draft.issuingAuthority} onChange={e => set('issuingAuthority', e.target.value)} />
        </Field>
        <Field label="Issue Date" required>
          <MasterDatePicker
            value={draft.issueDate}
            onChange={(v) => set('issueDate', v)}
            placeholder="dd/mm/yyyy"
            maxDate={new Date().toISOString().slice(0, 10)}
          />
        </Field>
        <Field label="Expiry Date" required>
          <MasterDatePicker
            value={draft.expiryDate}
            onChange={(v) => set('expiryDate', v)}
            placeholder="dd/mm/yyyy"
            minDate={new Date().toISOString().slice(0, 10)}
          />
        </Field>
      </div>
      <Field label="License Document" required>
        <FileChooser
          file={draft.file}
          existingPath={draft.existingPath}
          onPick={f => setDraft({ ...draft, file: f, fileName: f?.name ?? '', existingPath: f ? undefined : draft.existingPath })}
          placeholder="Upload License document (JPG / PNG / PDF, max 2 MB)"
        />
      </Field>
    </PopupShell>
  );
}

type BankAddPopupDraft = { bankName: string; branchName: string; accountNumber: string; ifsc: string; branchAddress: string; chequeFile: File | null; chequeFileName: string };
function BankAddPopup(props: {
  draft: BankAddPopupDraft;
  setDraft: Setter<BankAddPopupDraft>;
  onClose: () => void;
  onSave: () => void;
}) {
  const { draft, setDraft, onClose, onSave } = props;
  const set = <K extends keyof typeof draft>(k: K, v: typeof draft[K]) => setDraft({ ...draft, [k]: v });
  return (
    <PopupShell title="Add Bank Details" icon="ri-bank-line" onClose={onClose} onSave={onSave}>
      <div className="avm-grid-4">
        <Field label="Bank Name" required>
          <input className="avm-input" placeholder="Enter bank name" value={draft.bankName} onChange={e => set('bankName', e.target.value)} />
        </Field>
        <Field label="Branch" required>
          <input className="avm-input" placeholder="Enter branch" value={draft.branchName} onChange={e => set('branchName', e.target.value)} />
        </Field>
        <Field label="Account Number" required>
          <input className="avm-input" placeholder="Enter account number" value={draft.accountNumber} onChange={e => set('accountNumber', e.target.value)} />
        </Field>
        <Field label="IFSC Code" required>
          <input className="avm-input" placeholder="Enter IFSC code" value={draft.ifsc} onChange={e => set('ifsc', e.target.value.toUpperCase())} />
        </Field>
      </div>
      <div className="avm-grid-2">
        <Field label="Branch Address">
          <input className="avm-input" placeholder="Enter branch address" value={draft.branchAddress} onChange={e => set('branchAddress', e.target.value)} />
        </Field>
        <Field label="Cancelled Cheque" required>
          <FileChooser
            file={draft.chequeFile}
            existingPath={draft.existingPath}
            onPick={f => setDraft({ ...draft, chequeFile: f, chequeFileName: f?.name ?? '', existingPath: f ? undefined : draft.existingPath })}
            placeholder="Upload Cancelled Cheque (JPG / PNG / PDF, max 2 MB)"
          />
        </Field>
      </div>
    </PopupShell>
  );
}

type GstScrutinyAddPopupDraft = { gstNumber: string; status: 'Active' | 'Suspended' | 'Cancelled'; lastFilingDate: string; prevNonGst2aInvoice: string; redFlags: string };
function GstScrutinyAddPopup(props: {
  draft: GstScrutinyAddPopupDraft;
  setDraft: Setter<GstScrutinyAddPopupDraft>;
  onClose: () => void;
  onSave: () => void;
}) {
  const { draft, setDraft, onClose, onSave } = props;
  const set = <K extends keyof typeof draft>(k: K, v: typeof draft[K]) => setDraft({ ...draft, [k]: v });
  return (
    <PopupShell title="Add GST Scrutiny" icon="ri-shield-check-line" onClose={onClose} onSave={onSave}>
      <div className="avm-grid-3">
        <Field label="GST Number" required>
          <input className="avm-input" placeholder="Enter GST number" value={draft.gstNumber} onChange={e => set('gstNumber', e.target.value.toUpperCase())} />
        </Field>
        <Field label="GST Status" required>
          <SelectInput value={draft.status} onChange={v => set('status', v as 'Active' | 'Suspended' | 'Cancelled')} placeholder="Select GST status" options={['Active', 'Suspended', 'Cancelled']} />
        </Field>
        <Field label="GST Last Filing Date" required>
          <MasterDatePicker
            value={draft.lastFilingDate}
            onChange={(v) => set('lastFilingDate', v)}
            placeholder="dd/mm/yyyy"
            maxDate={new Date().toISOString().slice(0, 10)}
          />
        </Field>
      </div>
      <div className="avm-grid-2">
        <Field label="Previous Non-GST 2A Reflected Invoice">
          <input className="avm-input" placeholder="Enter invoice reference (optional)" value={draft.prevNonGst2aInvoice} onChange={e => set('prevNonGst2aInvoice', e.target.value)} />
        </Field>
        <Field label="Red Flags">
          <input className="avm-input" placeholder="Enter red flags (optional)" value={draft.redFlags} onChange={e => set('redFlags', e.target.value)} />
        </Field>
      </div>
    </PopupShell>
  );
}

type ProductMappingDraft = { productId: string; productCode: string; productName: string; hsnSacCode: string; segment: string; batchSerialLot: string; purchasePrice: string; gstPercentage: string; gstAmount: string; totalAmount: string };
function AddProductMappingPopup(props: {
  draft: ProductMappingDraft;
  setDraft: Setter<ProductMappingDraft>;
  productOpts: Array<{ value: string; label: string }>;
  onProductChange: (productIdStr: string) => void;
  recompute: (d: ProductMappingDraft) => ProductMappingDraft;
  onClose: () => void;
  onSave: () => void;
}) {
  const { draft, setDraft, productOpts, onProductChange, recompute, onClose, onSave } = props;
  const set = <K extends keyof ProductMappingDraft>(k: K, v: ProductMappingDraft[K]) => setDraft({ ...draft, [k]: v });
  return (
    <PopupShell title="Add Product Mapping" icon="ri-box-3-line" subtitle="Link a product with purchase price & GST for this vendor" onClose={onClose} onSave={onSave}>
      <div className="avm-grid-2">
        <Field label="Product Name" required>
          {productOpts.length > 0
            ? <SelectInput value={draft.productId} onChange={onProductChange} placeholder="Select Product Name" options={productOpts} />
            : <input className="avm-input" placeholder="Loading products…" value={draft.productName} onChange={e => set('productName', e.target.value)} />}
        </Field>
        <Field label="Product Code">
          <input className="avm-input" value={draft.productCode} readOnly placeholder="Auto-fills from product" />
        </Field>
      </div>
      <div className="avm-grid-3">
        <Field label="HSN / SAC Code">
          <input className="avm-input" value={draft.hsnSacCode} readOnly placeholder="—" />
        </Field>
        <Field label="Segment">
          <input className="avm-input" value={draft.segment} readOnly placeholder="—" />
        </Field>
        <Field label="Batch/Serial/Lot Number">
          <input className="avm-input" placeholder="—" value={draft.batchSerialLot} onChange={e => set('batchSerialLot', e.target.value)} />
        </Field>
      </div>
      <div className="avm-grid-3">
        <Field label="Purchase Price (₹)" required>
          <input className="avm-input" type="number" min="0" step="0.01" placeholder="Enter purchase price" value={draft.purchasePrice} onChange={e => setDraft(recompute({ ...draft, purchasePrice: e.target.value }))} />
        </Field>
        {/* GST % is inherited from the selected product (set in the
            Product wizard's Sales Config step) and locked here so a
            vendor mapping can never carry a different tax rate than
            the product itself. Same behavior as the product form's
            Map Vendor popup — the two flows are now symmetric. */}
        <Field label="GST %">
          <input
            className="avm-input"
            value={draft.gstPercentage ? `${draft.gstPercentage}%` : '—'}
            readOnly
            title="GST % comes from the product's Sales Config — not editable here"
          />
        </Field>
        <Field label="GST Amount (₹)">
          <input className="avm-input" value={draft.gstAmount} readOnly placeholder="Auto-computed" />
        </Field>
      </div>
      <Field label="Total Amount (₹)">
        <input className="avm-input" value={draft.totalAmount} readOnly placeholder="Auto-computed" />
      </Field>
    </PopupShell>
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
.avm-title { font-size: 17px; font-weight: 600; letter-spacing: -0.01em; }
.avm-sub   { font-size: 12px; font-weight: 400; color: rgba(255,255,255,.85); margin-top: 2px; }
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
  font-size: 12px; font-weight: 600;
}
.avm-step-title { font-size: 12.5px; font-weight: 600; color: #1e1b4b; letter-spacing: -0.01em; }
.avm-step-sub   { font-size: 10.5px; font-weight: 400; color: #6b7280; }

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
.avm-prev-title { display: inline-flex; align-items: center; gap: 8px; font-size: 12.5px; font-weight: 600; color: #166534; letter-spacing: -0.01em; }
.avm-prev-check { width: 22px; height: 22px; border-radius: 50%; background: linear-gradient(135deg, #22c55e, #16a34a); color: #fff; display: inline-flex; align-items: center; justify-content: center; }
.avm-prev-chip { padding: 3px 10px; border-radius: 99px; background: #fff; color: #166534; font-size: 11px; font-weight: 500; border: 1px solid #bbf7d0; }
.avm-prev-toggle { height: 28px; padding: 0 12px; background: #fff; border: 1px solid #bbf7d0; color: #166534; border-radius: 7px; font-family: inherit; font-size: 11.5px; font-weight: 500; cursor: pointer; }
.avm-prev-body { padding: 10px 14px 12px; display: flex; flex-direction: column; gap: 10px; }
/* Step-grouped summary — each stage gets a tone-coloured label
   followed by a flat grid of label/value pairs. No per-cell box;
   stage labels do the visual grouping. Mirrors the Add Product
   wizard's PreviousStages styling. */
.avm-prev-stage { display: flex; flex-direction: column; gap: 6px; }
.avm-prev-stage + .avm-prev-stage { margin-top: 10px; }
.avm-prev-stage-label {
  font-size: 10.5px; font-weight: 600; letter-spacing: .08em;
  display: inline-flex; align-items: center;
}
.avm-prev-stage.tone-violet .avm-prev-stage-label { color: #5b21b6; }
.avm-prev-stage.tone-teal   .avm-prev-stage-label { color: #0f766e; }
.avm-prev-stage.tone-purple .avm-prev-stage-label { color: #6b21a8; }

/* Compact inline pair rows — each row is a flex-wrap container
   that flows "Label : value" pairs side by side and breaks onto
   the next visual line only when the viewport is too narrow. */
.avm-prev-rows {
  display: flex; flex-direction: column; gap: 6px;
}
.avm-prev-row {
  display: flex; flex-wrap: wrap; gap: 6px 26px;
  align-items: baseline;
}
.avm-prev-pair {
  display: inline-flex; align-items: baseline; gap: 6px;
  font-size: 12.5px; line-height: 1.45;
  min-width: 0;
}
/* Carried-over summary header (Steps 2 / 3 / 4) — same visual tone
   as the .avm-id-summary strip on the Address & Contact sub-tab so
   every read-only header in the wizard reads as one component
   family. Label weight lowered from 700 → 500 per design feedback. */
.avm-prev-k {
  font-size: 10px; font-weight: 500; letter-spacing: .04em;
  color: #7c3aed; text-transform: uppercase;
  white-space: nowrap;
}
.avm-prev-v {
  font-weight: 500; color: #1e1b4b;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  max-width: 320px;
}
.avm-prev-link {
  font-weight: 600; color: #4338ca; text-decoration: underline;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  max-width: 320px;
}
.avm-prev-link:hover { color: #312e81; }
.avm-prev-suffix {
  font-size: 11.5px; color: #64748b; font-weight: 500;
}

/* Tabs */
.avm-tabs {
  display: flex; gap: 4px; margin-bottom: 14px;
  border-bottom: 1.5px solid #d8e3fa;
}
.avm-tab {
  background: none; border: none; padding: 10px 16px;
  font-family: inherit; font-size: 13px; font-weight: 500;
  color: #94a3b8; cursor: pointer;
  border-bottom: 2.5px solid transparent;
  margin-bottom: -1.5px;
  transition: color .15s, border-color .15s;
}
.avm-tab:hover { color: #405189; }
.avm-tab.on { color: #405189; border-bottom-color: #405189; font-weight: 600; }

/* Pill tabs (Step 2 sub-tabs) */
.avm-pill-tabs { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 14px; }
.avm-pill {
  background: #eef2ff; color: #405189;
  border: 1px solid #d8e3fa; border-radius: 99px;
  padding: 7px 14px; font-family: inherit; font-size: 12px; font-weight: 500; cursor: pointer;
  transition: background .15s, border-color .15s;
}
.avm-pill:hover { background: #dbe5fc; border-color: #c0cffb; }
.avm-pill.on { background: linear-gradient(120deg, #405189, #6691e7); color: #fff; border-color: transparent; font-weight: 600; }
.avm-sub-pills { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 14px; }
.avm-sub-pill {
  display: inline-flex; align-items: center; gap: 6px;
  background: #fff; color: #475569;
  border: 1.5px solid #e2e8f0; border-radius: 8px;
  padding: 6px 14px; font-family: inherit; font-size: 12px; font-weight: 500; cursor: pointer;
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
.avm-section-title { font-size: 13.5px; font-weight: 600; color: #1e1b4b; letter-spacing: -0.01em; }
.avm-section-sub   { font-size: 11px; font-weight: 400; color: #6b7280; margin-top: 1px; }
.avm-section-amber .avm-section-title { color: #92400e; }
.avm-section-amber .avm-section-sub   { color: #b45309; }
.avm-section-body { padding: 14px 16px 16px; display: flex; flex-direction: column; gap: 12px; }

.avm-section-add-btn {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 7px 14px; border-radius: 8px;
  background: linear-gradient(120deg, #405189 0%, #6691e7 100%); color: #fff; border: none;
  font-family: inherit; font-size: 12px; font-weight: 500; cursor: pointer;
  transition: transform .12s, box-shadow .15s;
}
.avm-section-add-btn:hover { transform: translateY(-1px); box-shadow: 0 4px 12px rgba(64,81,137,.35); }

/* Form */
.avm-grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.avm-grid-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
.avm-grid-4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }

.avm-field { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
/* Labels match the Client / Recruitment master forms: small, uppercase,
   modest letter-spacing, navy color, lighter weight (500) so the
   surrounding form chrome doesn't shout at the user. */
.avm-field-label {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 10.5px; font-weight: 500;
  letter-spacing: 0.06em; text-transform: uppercase;
  color: #405189;
  margin-bottom: 3px;
}
[data-bs-theme="dark"] .avm-field-label,
[data-layout-mode="dark"] .avm-field-label { color: #8aa1d9; }
.avm-req { color: #f06548; font-weight: 600; margin-left: 1px; }
.avm-field-plus {
  width: 18px; height: 18px;
  border: none; border-radius: 5px;
  background: #405189; color: #fff;
  font-size: 14px; font-weight: 500; line-height: 1; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
}
/* Inputs — mirror .master-modal .form-control from masterFormKit so the
   wizard reads as part of the same form family as Clients / Recruitment.
   Subtle blue-tinted surface, indigo focus ring, 10px radius. */
.avm-input {
  height: 38px; width: 100%;
  padding: 7px 12px;
  border: 1px solid color-mix(in srgb, #6691e7 20%, var(--vz-border-color, #e9ebec));
  border-radius: 10px;
  background: color-mix(in srgb, #6691e7 5%, var(--vz-card-bg, #fff));
  color: var(--vz-body-color, #495057);
  font-family: inherit; font-size: 13px; font-weight: 400; outline: none;
  box-shadow: 0 1px 2px rgba(18,38,63,0.04), inset 0 1px 1px rgba(255,255,255,0.04);
  transition: border-color .18s ease, box-shadow .18s ease, background .18s ease;
}
.avm-input::placeholder,
.avm-modal input::placeholder,
.avm-modal textarea::placeholder,
.avm-modal .master-select-placeholder {
  color: #94a3b8 !important;
  opacity: 0.45 !important;
  font-weight: 400 !important;
}
.avm-input:hover:not(:disabled):not([readonly]) {
  border-color: rgba(99,102,241,0.55);
  box-shadow: 0 2px 6px rgba(99,102,241,0.08);
}
.avm-input:focus {
  background: var(--vz-card-bg, #fff);
  border-color: #6366f1;
  box-shadow: 0 0 0 3px rgba(99,102,241,0.15), 0 4px 12px rgba(99,102,241,0.12);
}
[data-bs-theme="dark"] .avm-input,
[data-layout-mode="dark"] .avm-input {
  background: color-mix(in srgb, #6691e7 12%, var(--vz-card-bg));
}

/* Inline per-field error — red text + warning icon under the input,
   plus a red border on the input itself (matches the Add Product form). */
.avm-field .avm-field-error,
.avm-modal .avm-field-error,
.avm-field-error {
  display: inline-flex !important; align-items: center; gap: 4px;
  font-size: 11.5px; font-weight: 600; color: #ef4444 !important;
  margin-top: 4px; line-height: 1.2;
}
.avm-field .avm-field-error i,
.avm-field-error i { font-size: 13px; color: #ef4444 !important; }
.avm-field.has-error .avm-input,
.avm-field.has-error textarea {
  border-color: #ef4444 !important;
}
.avm-field.has-error .avm-input:focus,
.avm-field.has-error textarea:focus {
  box-shadow: 0 0 0 3px rgba(239,68,68,.15) !important;
}
.avm-field.has-error .master-select-wrap .master-select-toggle {
  border-color: #ef4444 !important;
}
.avm-field.has-error .avm-field-label { color: #ef4444 !important; }

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
/* Dark-theme: navy text turns invisible on the modal's dark background.
 * Lift Yes / No labels to a high-contrast off-white and tint the radio
 * accent to the indigo used elsewhere in the wizard. */
[data-bs-theme="dark"] .avm-radio { color: #ede9fe; }
[data-bs-theme="dark"] .avm-radio input { accent-color: #818cf8; }

/* File chooser — same chrome as the inputs, dashed border to signal upload */
.avm-filechooser {
  position: relative;
  height: 38px; padding: 0 8px 0 12px;
  border: 1px dashed var(--vz-border-color, #e9ebec); border-radius: 8px;
  background: var(--vz-card-bg, #fff); color: #6b7280;
  display: inline-flex; align-items: center; gap: 8px;
  font-size: 12.5px; font-weight: 500; cursor: pointer;
  width: 100%;
}
.avm-filechooser:hover { border-color: #405189; }
.avm-filechooser-input { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
.avm-filechooser-icon { color: #405189; font-size: 15px; flex-shrink: 0; }
.avm-filechooser-text {
  flex: 1; min-width: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  color: #1e1b4b;
}
/* Filename as a link — applies the indigo affordance only when a
   view URL exists (fresh blob or hydrated server path). Clicking
   the name opens the file in a new tab, same as the 👁 button. */
.avm-filechooser-link {
  color: #4338ca;
  text-decoration: underline;
  text-decoration-color: rgba(99, 102, 241, .35);
  text-underline-offset: 2px;
  cursor: pointer;
}
.avm-filechooser-link:hover {
  color: #312e81;
  text-decoration-color: #4338ca;
}
[data-bs-theme="dark"] .avm-filechooser-link {
  color: #c4b5fd;
  text-decoration-color: rgba(196, 181, 253, .35);
}
[data-bs-theme="dark"] .avm-filechooser-link:hover { color: #e9d5ff; }

/* Populated state — the hidden <input> is gone, so the strip is no
   longer a "click anywhere to choose" affordance. Border switches to
   solid + a subtle indigo tint, and the View / Delete buttons sit on
   the right as proper pill-style action chips. */
.avm-filechooser.avm-filechooser-has-file {
  cursor: default;
  border: 1px solid #c7d2fe;
  background: #f5f7ff;
}
.avm-filechooser.avm-filechooser-has-file:hover { border-color: #818cf8; }
.avm-filechooser-actions {
  display: inline-flex; align-items: center; gap: 4px;
  flex-shrink: 0;
}
.avm-fc-action {
  width: 26px; height: 26px;
  display: inline-flex; align-items: center; justify-content: center;
  border-radius: 6px;
  background: #fff;
  border: 1px solid var(--vz-border-color, #e5e7eb);
  color: #6b7280;
  cursor: pointer;
  transition: background .15s ease, border-color .15s ease, color .15s ease;
  padding: 0;
  text-decoration: none;
}
.avm-fc-action i { font-size: 14px; line-height: 1; }
.avm-fc-view:hover {
  background: rgba(64, 81, 137, .10);
  border-color: #405189;
  color: #405189;
}
.avm-fc-delete:hover {
  background: rgba(240, 101, 72, .10);
  border-color: #f06548;
  color: #f06548;
}

[data-bs-theme="dark"] .avm-filechooser.avm-filechooser-has-file {
  background: #1a1538; border-color: #3b2a6b;
}
[data-bs-theme="dark"] .avm-filechooser-text { color: #ede9fe; }
[data-bs-theme="dark"] .avm-fc-action {
  background: #2a2150; border-color: #3b2a6b; color: #cbd5e1;
}
[data-bs-theme="dark"] .avm-fc-view:hover {
  background: rgba(99, 102, 241, .18); border-color: #818cf8; color: #c7d2fe;
}
[data-bs-theme="dark"] .avm-fc-delete:hover {
  background: rgba(248, 113, 113, .18); border-color: #f87171; color: #fecaca;
}

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
  font-size: 12.5px; font-weight: 500; letter-spacing: .04em;
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

/* ───── Global table chrome inside the Vendor modal ─────
   Mirrors the Clients list table (resources/js/pages/client/Clients.tsx)
   so every embedded table here — DD, Owner KYC, Trade License, Bank,
   GST Scrutiny, Product Mappings — reads with the same tight header /
   cell rhythm. The vendor modal was rendering Velzon's default 13.5px
   bold uppercase headers, which dwarfed everything around them. */
.avm-modal .table {
  --bs-table-bg: transparent;
  font-size: 13px;
  margin-bottom: 0;
}
.avm-modal .table thead.table-light th,
.avm-modal .table thead th {
  font-size: 11.5px;
  font-weight: 500;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: #64748b;
  padding: 10px 12px;
  background: #f8f9fc;
  border-bottom: 1px solid #e9ebec;
  white-space: nowrap;
}
.avm-modal .table tbody td {
  font-size: 13px;
  font-weight: 400;
  color: #495057;
  padding: 10px 12px;
  vertical-align: middle;
  border-top: 1px solid #f3f4f6;
}
.avm-modal .table tbody td strong {
  font-weight: 600;
  color: #1e293b;
}

/* Action buttons inside vendor-modal tables — 30x30 outline pills,
   identical to the Clients ActionBtn component
   (resources/js/pages/client/Clients.tsx#L131). Replaces the larger
   Velzon .btn-soft-* defaults that were oversized in this context. */
.avm-modal .table .btn.btn-sm.btn-soft-primary,
.avm-modal .table .btn.btn-sm.btn-soft-danger,
.avm-modal .table .btn.btn-sm.btn-soft-info,
.avm-modal .table .btn.btn-sm.btn-soft-success,
.avm-modal .table .btn.btn-sm.btn-soft-warning {
  width: 30px; height: 30px; padding: 0;
  border-radius: 8px;
  background: var(--vz-secondary-bg, #f3f4f6);
  border: 1px solid var(--vz-border-color, #e5e7eb);
  color: var(--vz-secondary-color, #6c757d);
  display: inline-flex; align-items: center; justify-content: center;
  transition: all .15s ease;
}
.avm-modal .table .btn.btn-sm.btn-soft-primary i,
.avm-modal .table .btn.btn-sm.btn-soft-danger i,
.avm-modal .table .btn.btn-sm.btn-soft-info i,
.avm-modal .table .btn.btn-sm.btn-soft-success i,
.avm-modal .table .btn.btn-sm.btn-soft-warning i {
  font-size: 14px;
}
.avm-modal .table .btn.btn-sm.btn-soft-primary:hover {
  background: rgba(64, 81, 137, 0.10); border-color: #405189; color: #405189;
}
.avm-modal .table .btn.btn-sm.btn-soft-danger:hover {
  background: rgba(240, 101, 72, 0.10); border-color: #f06548; color: #f06548;
}
.avm-modal .table .btn.btn-sm.btn-soft-info:hover {
  background: rgba(41, 156, 219, 0.10); border-color: #299cdb; color: #299cdb;
}
.avm-modal .table .btn.btn-sm.btn-soft-success:hover {
  background: rgba(10, 179, 156, 0.10); border-color: #0ab39c; color: #0ab39c;
}
.avm-modal .table .btn.btn-sm.btn-soft-warning:hover {
  background: rgba(247, 184, 75, 0.10); border-color: #f7b84b; color: #f7b84b;
}

/* Hover row tint — same subtle gray the Clients table uses. */
.avm-modal .table tbody tr:hover td { background: #f8f9fc; }

/* Auto-code monospace badge — keep it tight & lower-key. */
.avm-modal .table .badge.bg-light {
  font-size: 11px;
  font-weight: 600;
  padding: 4px 9px;
  background: #f3f4f6 !important;
  border-color: #e5e7eb !important;
}

[data-bs-theme="dark"] .avm-modal .table thead.table-light th,
[data-bs-theme="dark"] .avm-modal .table thead th {
  background: #2a2150; color: #94a3b8; border-bottom-color: #3b2a6b;
}
[data-bs-theme="dark"] .avm-modal .table tbody td {
  color: #cbd5e1; border-top-color: #2a2150;
}
[data-bs-theme="dark"] .avm-modal .table tbody td strong { color: #ede9fe; }
[data-bs-theme="dark"] .avm-modal .table tbody tr:hover td { background: #1a1538; }

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
.avm-product-code { font-size: 11px; font-weight: 600; color: #405189; letter-spacing: .06em; }
.avm-product-name { font-size: 13px; font-weight: 500; color: #1e1b4b; }
.avm-product-info { display: inline-flex; gap: 6px; }
.avm-product-tag { padding: 3px 9px; border-radius: 99px; background: #eef2ff; color: #405189; font-size: 10.5px; font-weight: 500; }

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
  font-family: inherit; font-size: 13px; font-weight: 600; cursor: pointer;
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
[data-bs-theme="dark"] .avm-prev { background: #14241a; border-color: #166534; }
[data-bs-theme="dark"] .avm-prev-head { background: linear-gradient(135deg, #16321f, #1d4029); border-bottom-color: #166534; }
[data-bs-theme="dark"] .avm-prev-title { color: #ffffff; }
[data-bs-theme="dark"] .avm-prev-toggle { background: #1a3225; color: #d1fae5; border-color: #22c55e; }
[data-bs-theme="dark"] .avm-prev-chip { background: #1a3225; border-color: #22c55e; color: #ffffff; }
[data-bs-theme="dark"] .avm-prev-field-label { color: #c4b5fd; }
[data-bs-theme="dark"] .avm-prev-field-value { color: #ffffff; }
[data-bs-theme="dark"] .avm-prev-k { color: #d8b4fe; font-weight: 600; }
[data-bs-theme="dark"] .avm-prev-v { color: #ffffff; font-weight: 500; }
[data-bs-theme="dark"] .avm-prev-link { color: #a5b4fc; }
[data-bs-theme="dark"] .avm-prev-link:hover { color: #c7d2fe; }
[data-bs-theme="dark"] .avm-prev-suffix { color: #cbd5e1; }
[data-bs-theme="dark"] .avm-prev-stage.tone-violet .avm-prev-stage-label { color: #c4b5fd; }
[data-bs-theme="dark"] .avm-prev-stage.tone-teal   .avm-prev-stage-label { color: #5eead4; }
[data-bs-theme="dark"] .avm-prev-stage.tone-purple .avm-prev-stage-label { color: #d8b4fe; }

/* ─── Master Quick-Add popup ─── */
.avm-qa-backdrop {
  position: fixed; inset: 0; z-index: 1100;
  background: rgba(15, 23, 42, .6);
  backdrop-filter: blur(3px);
  display: flex; align-items: center; justify-content: center;
  padding: 24px 20px;
  font-family: 'DM Sans', 'Inter', system-ui, sans-serif;
}
.avm-qa-popup {
  width: 100%; max-width: 480px;
  background: #fff; border-radius: 16px; overflow: hidden;
  display: flex; flex-direction: column;
  box-shadow: 0 30px 80px rgba(15, 23, 42, .5);
}
.avm-qa-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 18px;
  background: linear-gradient(135deg, #2b3a85, #6691e7);
  color: #fff;
}
.avm-qa-title { display: inline-flex; align-items: center; gap: 8px; font-size: 15px; font-weight: 600; letter-spacing: -0.01em; }
.avm-qa-title i { font-size: 18px; }
.avm-qa-close {
  width: 30px; height: 30px; border-radius: 8px;
  border: 1px solid rgba(255,255,255,.25);
  background: rgba(255,255,255,.12); color: #fff;
  display: inline-flex; align-items: center; justify-content: center; cursor: pointer;
  transition: background .15s, transform .12s;
}
.avm-qa-close:hover { background: rgba(255,255,255,.22); transform: rotate(90deg); }
.avm-qa-body { padding: 18px; display: flex; flex-direction: column; gap: 12px; }
.avm-qa-foot {
  display: flex; justify-content: flex-end; gap: 8px;
  padding: 12px 18px; border-top: 1px solid #ede9fe;
}

[data-bs-theme="dark"] .avm-qa-popup { background: #14102a; color: #ede9fe; }
[data-bs-theme="dark"] .avm-qa-head  { background: linear-gradient(135deg, #2b3a85, #6691e7); }
[data-bs-theme="dark"] .avm-qa-foot  { border-top-color: #3b2a6b; }

/* ─── Contact Person popup ─── */
.avm-cp-backdrop {
  position: fixed; inset: 0; z-index: 1100;
  background: rgba(15, 23, 42, .6);
  backdrop-filter: blur(3px);
  display: flex; align-items: center; justify-content: center;
  padding: 24px 20px;
  font-family: 'DM Sans', 'Inter', system-ui, sans-serif;
}
.avm-cp-popup {
  width: 100%; max-width: 880px;
  background: #fff;
  border-radius: 16px;
  overflow: hidden;
  display: flex; flex-direction: column;
  box-shadow: 0 30px 80px rgba(15, 23, 42, .5);
}
.avm-cp-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 18px;
  background: linear-gradient(135deg, #2b3a85, #6691e7);
  color: #fff;
}
.avm-cp-title { display: inline-flex; align-items: center; gap: 8px; font-size: 15px; font-weight: 600; letter-spacing: -0.01em; }
.avm-cp-title i { font-size: 18px; }
.avm-cp-close {
  width: 30px; height: 30px; border-radius: 8px;
  border: 1px solid rgba(255,255,255,.25);
  background: rgba(255,255,255,.12); color: #fff;
  display: inline-flex; align-items: center; justify-content: center; cursor: pointer;
  transition: background .15s, transform .12s;
}
.avm-cp-close:hover { background: rgba(255,255,255,.22); transform: rotate(90deg); }
.avm-cp-body  { padding: 18px; display: flex; flex-direction: column; gap: 12px; }
.avm-cp-foot {
  display: flex; justify-content: flex-end; gap: 8px;
  padding: 12px 18px;
  border-top: 1px solid #ede9fe;
}

/* Readonly Step-1 summary strip — now rendered ON the Address &
   Contact Person sub-tab itself (not inside the contact popup). It
   surfaces every field captured on the Vendor Identification sub-tab
   so the user can verify they're entering the right vendor's address
   / extra contacts without tab-flipping. */
/* Read-only identity summary — aligned with the customer & consignee
 * modals' .acm-hs-grid / .acg-hs-grid look: dense 4-column grid of
 * "LABEL : Value" pairs, hover affordance, and ellipsis on long values.
 * Old layout was flex-wrap rows which produced uneven column widths
 * and mismatched the rest of the suite. */
.avm-id-summary {
  padding: 14px 18px 16px;
  margin-bottom: 14px;
  background: linear-gradient(180deg, #faf5ff 0%, #f3e8ff 100%);
  border: 1px solid #e9d5ff;
  border-radius: 12px;
  display: flex; flex-direction: column; gap: 13px;
}
.avm-id-summary-row {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  column-gap: 28px;
  row-gap: 13px;
  align-items: baseline;
}
.avm-id-pair {
  display: flex; align-items: baseline; gap: 6px;
  font-size: 12px; line-height: 1.4;
  min-width: 0;
  cursor: default; padding: 1px 2px; border-radius: 4px;
  transition: background .12s;
}
.avm-id-pair:hover { background: rgba(124,58,237,0.06); }
.avm-id-k {
  font-size: 12px; font-weight: 600; letter-spacing: .01em;
  color: #64748b;
  white-space: nowrap; flex-shrink: 0;
}
.avm-id-v {
  font-weight: 600; color: #6d28d9; line-height: 1.4;
  min-width: 0; flex: 1 1 auto;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
@media (max-width: 900px) {
  .avm-id-summary-row { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
[data-bs-theme="dark"] .avm-id-summary { background: linear-gradient(180deg, #1a1538 0%, #14102a 100%); border-color: #3b2a6b; }
[data-bs-theme="dark"] .avm-id-pair:hover { background: rgba(167,139,250,0.10); }
[data-bs-theme="dark"] .avm-id-k { color: #94a3b8; }
[data-bs-theme="dark"] .avm-id-v { color: #c4b5fd; }

[data-bs-theme="dark"] .avm-cp-popup { background: #14102a; color: #ede9fe; }
[data-bs-theme="dark"] .avm-cp-head  { background: linear-gradient(135deg, #2b3a85, #6691e7); }
[data-bs-theme="dark"] .avm-cp-foot  { border-top-color: #3b2a6b; }
/* .avm-cp-summary moved to .avm-id-summary on the Address tab — see
   the rule block above. The dark-mode overrides used to live here. */

/* Bootstrap "subtle" badge palette inside the modal's tables.
 * Bootstrap 5.3's bg-*-subtle / text-* tokens swap via --bs-* vars,
 * which depend on Bootstrap's own CSS being applied BEFORE this
 * scoped block. In Edge those vars resolved fine, but in Chrome (and
 * in some cache states) the dark-mode swap was missing — the STATUS
 * pill rendered as pale-on-pale and the user reported the table
 * "looks empty" in Chrome. Pin solid colours per state so the
 * rendering is identical in every Chromium-based browser. */
.avm-modal .badge.bg-success-subtle,
.avm-modal .badge.bg-success-subtle.text-success {
  background-color: #d1fae5 !important;
  color: #065f46 !important;
}
.avm-modal .badge.bg-warning-subtle,
.avm-modal .badge.bg-warning-subtle.text-warning {
  background-color: #fef3c7 !important;
  color: #854d0e !important;
}
.avm-modal .badge.bg-danger-subtle,
.avm-modal .badge.bg-danger-subtle.text-danger {
  background-color: #fee2e2 !important;
  color: #991b1b !important;
}
.avm-modal .badge.bg-primary-subtle,
.avm-modal .badge.bg-primary-subtle.text-primary {
  background-color: #dbeafe !important;
  color: #1e40af !important;
}
.avm-modal .badge.bg-light,
.avm-modal .badge.bg-light.text-muted {
  background-color: #f1f5f9 !important;
  color: #475569 !important;
}
[data-bs-theme="dark"] .avm-modal .badge.bg-success-subtle,
[data-bs-theme="dark"] .avm-modal .badge.bg-success-subtle.text-success {
  background-color: #0c2e1d !important;
  color: #4ade80 !important;
}
[data-bs-theme="dark"] .avm-modal .badge.bg-warning-subtle,
[data-bs-theme="dark"] .avm-modal .badge.bg-warning-subtle.text-warning {
  background-color: #3a2a08 !important;
  color: #fbbf24 !important;
}
[data-bs-theme="dark"] .avm-modal .badge.bg-danger-subtle,
[data-bs-theme="dark"] .avm-modal .badge.bg-danger-subtle.text-danger {
  background-color: #3a0e0e !important;
  color: #f87171 !important;
}
[data-bs-theme="dark"] .avm-modal .badge.bg-primary-subtle,
[data-bs-theme="dark"] .avm-modal .badge.bg-primary-subtle.text-primary {
  background-color: #0f1e3a !important;
  color: #60a5fa !important;
}
[data-bs-theme="dark"] .avm-modal .badge.bg-light,
[data-bs-theme="dark"] .avm-modal .badge.bg-light.text-muted {
  background-color: rgba(255,255,255,0.06) !important;
  color: #94a3b8 !important;
}

/* Auto-code badge (e.g. KYC-001, V-001-P-002). Uses solid hex
 * colours (no rgba alpha, no Bootstrap CSS vars) so it renders the
 * SAME in Chrome and Edge — the rgba variant the badge used before
 * composited to different perceived shades when Chrome cached an
 * older Bootstrap layer, producing a faded "barely visible" look.
 * Solid backgrounds avoid that drift entirely. */
.avm-auto-code {
  display: inline-block;
  padding: 4px 10px;
  border-radius: 4px;
  background: #fef3c7;
  color: #854d0e;
  border: 1px solid #fde68a;
  font-family: 'DM Mono', 'JetBrains Mono', monospace;
  font-size: 12px;
  font-weight: 700;
  line-height: 1.2;
  letter-spacing: .02em;
}
[data-bs-theme="dark"] .avm-auto-code {
  background: #3a2a08;
  color: #fde68a;
  border-color: #78521a;
}

/* Status / mandatory / whatsapp pills used inside the vendor modal tables.
 * Custom-named classes (no collision with Bootstrap utility classes like
 * .bg-success-subtle / .text-muted) so the rendering is identical across
 * Chrome, Edge and any cache state. Earlier the badges depended on
 * Bootstrap's --bs-*-subtle CSS vars that Chrome could resolve to a
 * near-white background, producing the "empty pill" the user reported. */
.avm-pill {
  display: inline-block;
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 11.5px;
  font-weight: 600;
  line-height: 1.2;
  letter-spacing: .01em;
  border: 1px solid transparent;
  white-space: nowrap;
}
.avm-pill-success { background: #d1fae5; color: #065f46; border-color: #6ee7b7; }
.avm-pill-warning { background: #fef3c7; color: #854d0e; border-color: #fde68a; }
.avm-pill-danger  { background: #fee2e2; color: #991b1b; border-color: #fca5a5; }
.avm-pill-primary { background: #dbeafe; color: #1e40af; border-color: #93c5fd; }
.avm-pill-muted   { background: #f1f5f9; color: #475569; border-color: #cbd5e1; }
[data-bs-theme="dark"] .avm-pill-success { background: #0c2e1d; color: #4ade80; border-color: #15803d; }
[data-bs-theme="dark"] .avm-pill-warning { background: #3a2a08; color: #fbbf24; border-color: #b45309; }
[data-bs-theme="dark"] .avm-pill-danger  { background: #3a0e0e; color: #f87171; border-color: #b91c1c; }
[data-bs-theme="dark"] .avm-pill-primary { background: #0f1e3a; color: #60a5fa; border-color: #1d4ed8; }
[data-bs-theme="dark"] .avm-pill-muted   { background: rgba(255,255,255,0.06); color: #cbd5e1; border-color: rgba(255,255,255,0.14); }
`;
