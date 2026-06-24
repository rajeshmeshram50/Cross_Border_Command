import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
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
import SalesCustomerSendForSignatureModal from '../sales/core-masters/customer/SalesCustomerSendForSignatureModal';
import {
  readVendorMasterBundle,
  writeVendorMasterBundle,
  bustVendorMasterBundle,
} from './vendorBundleCache';

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
  /* Zoho Sign completion-certificate URL — populated by the polling
   * effect from clm_signature_requests.certificate_path on completed
   * rows. Drives the third action-column button. */
  certificateUrl?: string;
  /* Set by the parent right before rendering — true when this row's
   * signatureRequestId is inside the active 60-second Resend cooldown.
   * The button locks so a multi-doc bundle can't fire one reminder
   * email per doc. */
  cooldownActive?: boolean;
  /* Reminder counter + last-sent timestamp from clm_signature_requests.
   * Drives the "× N" badge on the Resend button so the user can see at
   * a glance how many times the recipient has already been nudged. */
  reminder_count?: number;
  last_reminder_sent_at?: string | null;
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

/* Trade Document Management (the former Step 3, an Evidence Vault) was
 * removed from the supplier form — those uploads now live in the standalone
 * Evidence Vault popup. The wizard is now Identity → KYC → Map Products. */
type StepKey = 1 | 2 | 3;
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

/* Supplier Type is a FIXED vocabulary (not the shared customer/consignee
 * types). The form sends the chosen name; the backend resolves it to a
 * master_vendor_types row so the vendor_type_id FK stays valid. */
const SUPPLIER_TYPE_OPTS: { value: string; label: string }[] = [
  { value: 'Logistic',          label: 'Logistic' },
  { value: 'Material',          label: 'Material' },
  { value: 'Tech Services',     label: 'Tech Services' },
  { value: 'Advisory Services', label: 'Advisory Services' },
  { value: 'Risk Services',     label: 'Risk Services' },
];

/* Step 2 KYC sub-tab → section-header title + subtitle (mirrors the Figma,
 * where the heading changes to the active sub-tab's name). */
const KYC_TAB_TITLE: Record<string, string> = {
  company: 'Company Due Diligence',
  owner:   'Owner KYC',
  license: 'Trade Licence',
  bank:    'Bank Details',
  gst:     'GST Scrutiny',
};
const KYC_TAB_SUB: Record<string, string> = {
  company: 'Licenses, statutory documents, and compliance proofs',
  owner:   'Identity & address proofs for owners / directors',
  license: 'Export / import licences and registrations',
  bank:    'Bank account & verification documents',
  gst:     'GST registration & compliance checks',
};

/* Classification & Flags — fixed vocabulary for the visual-only field that
 * mirrors the Figma. Not persisted yet (no backing column). */
const CLASSIFICATION_OPTS: { value: string; label: string }[] = [
  { value: 'Standard',  label: 'Standard' },
  { value: 'Preferred', label: 'Preferred' },
  { value: 'Watchlist', label: 'Watchlist' },
  { value: 'Blacklisted', label: 'Blacklisted' },
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

  /* Company Name / Company Legal Name input sanitiser. Strip XSS angle
   * brackets and SQL-injection signatures before they reach state, then
   * enforce a name whitelist (letters, digits, spaces, and the few
   * punctuation marks real company names use: . , - ( ) & / ' %). 100-char
   * cap matches the backend column. Inline error surfaces when a paste
   * lands disallowed input so the user knows what was stripped. */
  const COMPANY_NAME_SQL_RE = /(\bOR\b\s+\d+\s*=\s*\d+|--|;\s*(?:DROP|DELETE|INSERT|UPDATE|TRUNCATE|ALTER)\b|\bUNION\s+SELECT\b|javascript:|\bon\w+\s*=)/gi;
  // \p{L}/\p{N} (u flag) keep non-Latin / Unicode names (e.g. 中文, العربية,
  // देवनागरी) — only strip markup / symbol-soup, not legitimate scripts.
  const COMPANY_NAME_INVALID_RE = /[^\p{L}\p{N}\s\-.,()&/'%]/gu;
  const COMPANY_NAME_MAX = 100;
  const handleCompanyNameChange = (
    raw: string,
    fieldKey: 'companyName' | 'legalName',
    setter: (v: string) => void,
  ) => {
    let cleaned = raw.replace(/[<>]/g, '');
    const afterAngles = cleaned;
    cleaned = cleaned.replace(COMPANY_NAME_SQL_RE, '');
    const afterSql = cleaned;
    cleaned = cleaned.replace(COMPANY_NAME_INVALID_RE, '');
    if (cleaned.length > COMPANY_NAME_MAX) cleaned = cleaned.slice(0, COMPANY_NAME_MAX);
    setter(cleaned);
    if (cleaned === raw) {
      clearFieldError(fieldKey);
      return;
    }
    let msg: string;
    if (afterAngles !== raw)        msg = 'HTML characters (< or >) are not allowed';
    else if (afterSql !== afterAngles) msg = 'SQL-like patterns are not allowed';
    else                            msg = "Use letters, numbers, spaces, and . , - ( ) & / ' % only";
    setFieldErrors(prev => ({ ...prev, [fieldKey]: msg }));
  };

  /* Generic sanitised-change wrapper. Pipes the raw keystroke through
   * the supplied sanitiser, writes the cleaned value back to state, and
   * surfaces / clears the inline error on the matching Field. Lets the
   * Registered Office / City / Contact Person / Designation inputs all
   * share one bind-site without each growing their own handler. */
  const applySanitizer = (
    raw: string,
    fieldKey: string,
    setter: (v: string) => void,
    sanitizer: (raw: string) => SanitizeResult,
  ) => {
    const { cleaned, error } = sanitizer(raw);
    setter(cleaned);
    if (error) setFieldErrors(prev => ({ ...prev, [fieldKey]: error }));
    else clearFieldError(fieldKey);
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
  /* True until the bundled master fetch (/vendors/master-bundle) resolves.
   * While true, the modal body shows a shimmer skeleton so the user sees
   * structure instead of empty dropdowns — important because the bundle
   * pulls 1800+ states rows on cold load. Hits 0ms when the sessionStorage
   * cache is fresh (see vendorBundleCache). */
  const [mastersLoading, setMastersLoading] = useState<boolean>(true);

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
  /* Classification & Flags — visual field to match the Figma. There is no
   * backing vendor column yet, so it is NOT sent to the API; it defaults to
   * "Standard" and is purely presentational until a column ships. */
  const [classificationFlag, setClassificationFlag] = useState('Standard');

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

  /* Stash for the segment_uploads array that now arrives bundled with
   * the /vendors/{id} response. Hydrated into segmentRefUploads by an
   * effect declared AFTER the segment-rules useEffect, so the wipe
   * inside segment-rules runs first and doesn't nuke our entries.
   * See the comment in the main hydration block for the race rationale. */
  const [bundledSegUploads, setBundledSegUploads] = useState<any[] | null>(null);

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
  /* Primary contact "saved" flag — once the user clicks Save on the Primary
     Contact card, the contact surfaces as a locked (non-edit/non-delete)
     "Primary" row in the contacts table below. Edit-mode starts saved. */
  const [primarySaved, setPrimarySaved] = useState(false);
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

  /* segmentRefUploads hydration moved INLINE into the main edit-mode
   * hydration effect below (search for `root.segment_uploads`). The
   * VendorController::show() response now bundles this data so we no
   * longer need a separate /segment-uploads/supplier/{id} round-trip
   * on modal open. Same pattern shipped for Customer + Consignee. */

  /* ─── Step 3: Trade Documents (preset signature workflow) ─── */
  // Starts EMPTY — Trade Documents are populated only from the segment
  // rule's `td` set intersected with the party=Supplier trade-doc library
  // (see the segment-rules effect). No hardcoded seed rows, so only real
  // clm_trade_doc_library entries appear.
  const [tradeDocRows, setTradeDocRows] = useState<TradeDocRow[]>([]);
  /* Send for Signature — when non-null the Zoho Sign wizard pops with
   * the listed clm_trade_doc_library ids pre-checked. modelName='Vendor'
   * makes the backend resolve {{supplier.*}} tokens with this vendor. */
  const [sendForSignature, setSendForSignature] = useState<number[] | null>(null);
  const [sigStatusByDoc, setSigStatusByDoc] = useState<Record<number, { status: TradeDocRow['status']; signatureRequestId: number; signedUrl?: string; certificateUrl?: string; reminderCount?: number; lastReminderAt?: string | null }>>({});

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
  /* Header "Map Product" → opens the Mapped Products list popup (Figma flow).
     Mappings collect in productMappings state and persist on wizard submit. */
  const [mappedListOpen, setMappedListOpen] = useState(false);

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
  /* When set, the Map Products popup is editing this existing mapping
   * row (saveMapDraft updates in place instead of appending a new one). */
  const [mapEditingId,   setMapEditingId]   = useState<string | null>(null);

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
  /* Bundled master fetch — /vendors/master-bundle returns every dropdown
   * (vendor_types, risk_levels, vendor_behaviour, segments,
   * compliance_behaviours, countries, state_codes [with state relation],
   * states, license_name, gst_percentage) in ONE round-trip. Replaces the
   * previous 8-call Promise.all and pre-empts the two later lazy fetches
   * (license_name on the License popup, gst_percentage on the Map Product
   * dialog) — they now hydrate from this same bundle for free.
   *
   * Caching: the bundle is read from sessionStorage first (5-min TTL) via
   * vendorBundleCache. Cache hit ⇒ synchronous hydration, 0 API calls.
   * Cache miss ⇒ fetch + persist for next time. Inline master adds bust
   * the cache (see onMasterAdded analog if/when introduced).
   */
  useEffect(() => {
    type IdRow = { id: number | string };
    type NamedRow = IdRow & { name?: string | null };
    type Bundle = {
      vendor_types: NamedRow[];
      risk_levels: NamedRow[];
      vendor_behaviour: NamedRow[];
      segments: Array<IdRow & { name?: string | null; title?: string | null }>;
      compliance_behaviours: NamedRow[];
      countries: NamedRow[];
      state_codes: Array<IdRow & {
        state_id: number | string;
        state_code: string;
        status?: string | null;
        state?: { id?: number; name?: string; country_id?: number | string } | null;
      }>;
      states: Array<IdRow & { name?: string | null; country_id?: number | string | null }>;
      license_name: NamedRow[];
      gst_percentage: Array<IdRow & { percentage?: number | string | null }>;
    };

    const toOpt = (rows: NamedRow[]): Opt[] =>
      (rows || [])
        .map(r => ({ value: String(r.id), label: String(r.name ?? '') }))
        .filter(o => o.value !== '' && o.label !== '');

    const hydrate = (b: Bundle) => {
      setVendorTypeOpts(toOpt(b.vendor_types));
      setRiskLevelOpts(toOpt(b.risk_levels));
      setBehaviourOpts(toOpt(b.vendor_behaviour));
      // Segments: server returns `name`, but the Segments model also
      // appends `title` (alias of name) for legacy API consumers. Read
      // whichever is present — same string either way.
      setSegmentOpts(
        (b.segments || [])
          .map(r => ({ value: String(r.id), label: String(r.title ?? r.name ?? '') }))
          .filter(o => o.value !== '' && o.label !== '')
      );
      setComplianceOpts(toOpt(b.compliance_behaviours));
      setCountryOpts(toOpt(b.countries));
      setStateCodeRows(
        (b.state_codes || [])
          .map(r => ({
            id: String(r.id),
            state_id: String(r.state_id ?? ''),
            state_code: String(r.state_code ?? ''),
            state_name: String(r.state?.name ?? ''),
            country_id: String(r.state?.country_id ?? ''),
          }))
          .filter(r => r.state_name !== '')
      );
      setStateRows(
        (b.states || [])
          .map(r => ({
            id: String(r.id),
            name: String(r.name ?? ''),
            country_id: String(r.country_id ?? ''),
          }))
          .filter(r => r.name !== '')
      );
      // Pre-populate the License Type + GST% dropdowns that were
      // previously lazy-loaded on popup open. Now they're already in
      // memory by the time the user clicks anything.
      setLicenseTypeOpts(
        (b.license_name || [])
          .map(r => ({ value: String(r.name ?? ''), label: String(r.name ?? '') }))
          .filter(o => o.value)
      );
      setGstPctOpts(
        (b.gst_percentage || [])
          .map(r => ({ value: String(r.percentage ?? ''), label: `${r.percentage ?? ''}%` }))
          .filter(o => o.value && o.value !== '')
      );
    };

    // Cache hit — hydrate immediately, skip the network.
    const cached = readVendorMasterBundle<Bundle>();
    if (cached) {
      hydrate(cached);
      setMastersLoading(false);
      return;
    }

    (async () => {
      try {
        const res = await api.get<Bundle>('/vendors/master-bundle');
        hydrate(res.data);
        writeVendorMasterBundle(res.data);
      } catch {
        // Dropdowns stay empty; the form still renders and individual
        // saves will surface validation errors if a required option is
        // missing.
      } finally {
        setMastersLoading(false);
      }
    })();
  }, []);

  /* Segment-rule reference-upload wipe. Runs ONLY on genuine segment
   * changes (not on step transitions, not on initial hydration). The
   * wipe used to live inside the segment-rules fetch effect below, but
   * adding `step` to that effect's deps caused Step 1 → Step 2
   * transitions to wipe the bundled segmentRefUploads. Splitting it
   * here with [segment] dep alone ensures step transitions are no-ops.
   *
   * The skip-first-fire ref handles the initial hydration case: when
   * the main edit-mode fetch calls setSegment(segIds), segment changes
   * from [] → [...] which would otherwise wipe what bundledSegUploads
   * is about to write. Marking the ref true on first fire causes us
   * to skip exactly once — subsequent user-driven changes wipe as
   * expected. */
  const segmentDirtyRef = useRef(false);
  useEffect(() => {
    if (!segmentDirtyRef.current) {
      segmentDirtyRef.current = true;
      return;
    }
    setSegmentRefUploads(prev => {
      Object.values(prev).forEach(u => { try { URL.revokeObjectURL(u.url); } catch {} });
      return {};
    });
  }, [segment]);

  /* Segment-rule template fetch (multi-segment). The supplier
   * `segment` state is an array of DB ids (stringified). For each id
   * we hit the resolver in parallel and merge category arrays —
   * deduped by `code`, with Mandatory winning over Optional so a doc
   * required by any segment stays mandatory in the union. */
  useEffect(() => {
    /* Lazy gate — only fire the CLM segment-rules + trade-doc-library
     * fetches once the user reaches Step 2 or higher. Step 1 only
     * edits identity + address; it doesn't need this data. Mirrors
     * the same gate added to AddCustomerModal / AddConsigneeModal. */
    if (step < 2) return;

    const ids = (segment ?? [])
      .map(s => Number(s))
      .filter(n => Number.isFinite(n) && n > 0);
    if (ids.length === 0) { setSegmentDocs(EMPTY_SEG_DOCS); setTradeDocRows([]); return; }

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
       * No seed fallback — when the intersection is empty the table is
       * empty, so only real clm_trade_doc_library rows ever appear. */
      setTradeDocRows(mergedTd.map(d => ({
        code: d.code,
        name: d.name,
        db_id: partyById.get(d.code) ?? null,
        sendForSignature: d.requirement === 'M',
        status: 'N/A' as const,
        attachment: null,
        attachmentName: '',
      })));
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, segment]);

  /* Apply the bundled segment_uploads payload to segmentRefUploads.
   * Declared AFTER the segment-rules effect above so it fires LATER in
   * the same commit cycle — segment-rules wipes segmentRefUploads
   * synchronously when `segment` changes (including the initial
   * hydration), and this effect then writes the hydrated entries on
   * top. The OLD code achieved the same ordering by luck (its fetch
   * was a network round-trip that resolved after the wipe); we now
   * achieve it deterministically.
   *
   * Fires once per change to bundledSegUploads. Main hydration sets it
   * exactly once on edit-mode open, so this effect runs once too. */
  useEffect(() => {
    if (!bundledSegUploads || bundledSegUploads.length === 0) return;
    const CAT_TO_SUB: Record<string, string> = { dd: 'company', kyc: 'owner', tl: 'license' };
    const hydrated: Record<string, SegRefUpload> = {};
    for (const x of bundledSegUploads) {
      const sub = CAT_TO_SUB[x.category];
      if (!sub || !x.doc_code) continue;
      hydrated[`${sub}::${x.doc_code}`] = {
        file: null,
        url:  x.attachment_url || '',
        name: x.attachment_name || '',
      };
    }
    if (Object.keys(hydrated).length > 0) setSegmentRefUploads(hydrated);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bundledSegUploads]);

  /* Poll live signature-request status every 15s while the user is on
   * Step 3 → Trade Documents. ?sync=true makes the backend pull each
   * inprogress row from Zoho so completed signings appear in the badges
   * without a refresh — same pattern as Customer/Consignee Stage 3.
   * Keyed on `vendorId` (not `initialVendorId`) so the poller also kicks
   * in for newly-created vendors once Stage 1→2 has saved a row. */
  useEffect(() => {
    // Dormant since the Evidence Vault step was removed: `tradeTab` can no
    // longer become 'trade' here, so this poller never fires. Kept for the
    // standalone Evidence Vault flow's parity.
    if (!vendorId || tradeTab !== 'trade') return;
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
          signed_document_paths?: Array<{ url?: string; path?: string; file_url?: string }> | string[] | null;
          signed_document_path?: string | null;
          signed_document_url?: string | null;
          certificate_path?: string | null;
          certificate_url?: string | null;
          file_url?: string | null;
          reminder_count?: number;
          last_reminder_sent_at?: string | null;
        }> = Array.isArray(r.data?.data) ? r.data.data : [];
        const map: Record<number, { status: TradeDocRow['status']; signatureRequestId: number; signedUrl?: string; certificateUrl?: string; reminderCount?: number; lastReminderAt?: string | null }> = {};
        for (const row of rows) {
          const ids = Array.isArray(row.trade_doc_ids) ? row.trade_doc_ids : [];
          for (let i = 0; i < ids.length; i++) {
            const docId = Number(ids[i]);
            if (!docId || map[docId]) continue;
            // Resolve a usable URL from whatever the backend populated.
            // Production sometimes returns signed_document_paths=null
            // (the Zoho-download queue job hadn't run yet) while the
            // webhook-set certificate_path is already there. Fall back
            // through the chain so the View / Download buttons enable
            // as soon as ANY signed artefact exists, instead of staying
            // disabled until the queue worker catches up.
            // Backend transforms the response with file_url() now (see
            // ClmSignatureController::index), so .url / .file_url on each
            // signed_document_paths entry is already absolute (Azure blob
            // URL on prod, /storage/… on local). Prefer those over raw
            // paths so we don't double-resolve.
            const signedArr = row.signed_document_paths;
            let rawSignedUrl: string | null = null;
            if (Array.isArray(signedArr)) {
              const entry = signedArr[i] as { url?: string; path?: string; file_url?: string } | string | undefined;
              if (typeof entry === 'string') rawSignedUrl = entry;
              else if (entry && typeof entry === 'object') rawSignedUrl = entry.url || entry.file_url || entry.path || null;
            }
            if (!rawSignedUrl) rawSignedUrl = row.signed_document_url || null;
            if (!rawSignedUrl) rawSignedUrl = row.signed_document_path || null;
            /* file_url and certificate_* are NOT fallbacks here. When
             * Zoho mints the certificate before the signed PDF lands
             * (signed_document_paths: []), Laravel's model accessor
             * fills file_url with the cert URL — using that as a signed
             * URL fallback silently routes the View / Download buttons
             * to the certificate. Keep them strictly separate so the
             * signed-doc buttons stay disabled until the real signed
             * PDF appears, and the cert lives only on its own button. */
            const rawCertUrl = row.certificate_url || row.certificate_path || null;
            // Resolve via resolveFileUrl so the URL gets the right
            // base prefix (VITE_API_URL on the deployed SPA, current
            // origin in dev). Bare /storage/… relative URLs 404 when
            // the SPA origin differs from the API host.
            map[docId] = {
              status: row.status,
              signatureRequestId: row.id,
              signedUrl:      rawSignedUrl ? resolveFileUrl(rawSignedUrl) : undefined,
              certificateUrl: rawCertUrl   ? resolveFileUrl(rawCertUrl)   : undefined,
              reminderCount:  typeof row.reminder_count === 'number' ? row.reminder_count : undefined,
              lastReminderAt: row.last_reminder_sent_at ?? null,
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
        signedUrl:      info.signedUrl      ?? r.signedUrl,
        certificateUrl: info.certificateUrl ?? r.certificateUrl,
        reminder_count:        info.reminderCount  ?? r.reminder_count        ?? 0,
        last_reminder_sent_at: info.lastReminderAt ?? r.last_reminder_sent_at ?? null,
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
      vendor_type_id?: number | null; vendor_type_name?: string | null; risk_level_id?: number | null;
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
      /* Parallel fetch — kick off the vendor show AND the products
       * dropdown at the same time. Previously productOpts only loaded
       * when the user opened Step 4, so a fresh edit with mappings
       * showed blank HSN/Segment until the user clicked Map Products
       * and waited for *another* ~500-row fetch. Firing both in parallel
       * shaves the perceived load to whichever is slower, and the
       * Map Products backfill effect immediately joins them. */
      const minShimmerMs = 350; // floor so the shimmer doesn't flicker on fast networks
      const t0 = performance.now();
      try {
        const [res] = await Promise.all([
          api.get<{ data: ApiVendor; segment_uploads?: { data?: any[] } }>(`/vendors/${initialVendorId}`),
          fetchProductOptsIfNeeded(),
        ]);
        const root = res.data ?? ({} as { data?: ApiVendor; segment_uploads?: { data?: any[] } });
        const v = root.data;
        if (!v) return;

        /* Stage 2/3 segment-rule reference uploads — now arrive in the
         * same response as the vendor itself (top-level `segment_uploads`
         * key, not inside `data`). We stash them in state and let a
         * dedicated useEffect (declared AFTER the segment-rules effect
         * below) apply them to segmentRefUploads. Declaration order
         * matters: the segment-rules effect synchronously wipes
         * segmentRefUploads whenever `segment` changes — including the
         * initial hydration where setSegment(segIds) below fires it.
         * If we hydrated inline here, the wipe would run on the very
         * next effect-firing cycle and nuke our entries. Routing through
         * a downstream effect guarantees we run AFTER the wipe.
         *
         * The OLD code (separate /segment-uploads fetch) avoided this
         * race only because the network round-trip delayed the
         * setSegmentRefUploads(...) past the wipe — bundling collapsed
         * that delay, so we restore the ordering deterministically. */
        const refs: any[] = Array.isArray(root.segment_uploads?.data) ? root.segment_uploads!.data! : [];
        setBundledSegUploads(refs);

        // Step 1 — identity
        setVendorCode(v.vendor_code ?? '');
        setCompanyName(v.company_name ?? '');
        setLegalName(v.legal_name ?? '');
        setWebsite(v.website ?? '');
        // Supplier Type now binds to the fixed-vocabulary NAME.
        setVendorType(v.vendor_type_name ?? '');
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

        // Step 4 — product mappings. HSN/SAC + Segment aren't echoed in
        // the vendor show payload, so they're seeded empty here and a
        // later effect backfills them once productOpts loads (kicked off
        // by the void call right after).
        setProductMappings((v.product_mappings ?? []).map(m => ({
          id: String(m.id),
          productId: m.product_id ?? null,
          productCode: m.product_code ?? '',
          productName: m.product_name ?? '',
          hsnSacCode: '',
          segment: '',
          batchSerialLot: m.batch_serial_lot ?? '',
          purchasePrice: Number(m.purchase_price ?? 0),
          gstPercentage: Number(m.gst_percentage ?? 0),
          gstAmount: Number(m.gst_amount ?? 0),
          totalAmount: Number(m.total_amount ?? 0),
        })));
        // productOpts already fetched in parallel above — Map Products
        // backfill effect joins on productId once both arrays are
        // populated, so no extra fetch needed here.
      } catch {
        toast.error('Load failed', 'Could not load the supplier — closing the form.');
        onClose();
      } finally {
        // Floor the visible shimmer time so a fast network doesn't
        // render a 50ms flash that looks like a glitch. Once enough
        // wall-clock has elapsed, drop the overlay.
        const elapsed = performance.now() - t0;
        const wait = Math.max(0, minShimmerMs - elapsed);
        if (wait > 0) await new Promise(r => setTimeout(r, wait));
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
        // Supplier Type is sent as the fixed-vocabulary NAME; the backend
        // resolves it to the master_vendor_types FK.
        vendor_type: vendorType || null,
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

  /* Client-side validation of the address fields (which live on tab 1's
     "Supplier Address Details" card). Run when LEAVING tab 1 so address
     errors highlight on the tab the user is actually looking at — instead
     of surfacing later via saveContacts() while the user is on tab 2.
     Sets fieldErrors but does NOT toast (the caller decides). */
  const validateAddress = (): boolean => {
    const errs: Record<string, string> = {};
    if (!registeredOffice.trim()) errs.registeredOffice = 'Registered Office Address is required';
    if (!country)                 errs.country          = 'Country is required';
    if (!state)                   errs.state            = 'State is required';
    if (!stateCode)               errs.stateCode        = 'State Code is required (pick a State to auto-fill)';
    if (!city.trim())             errs.city             = 'City is required';
    if (Object.keys(errs).length) { setFieldErrors(prev => ({ ...prev, ...errs })); return false; }
    return true;
  };

  const goNext = async () => {
    if (saving) return;
    if (step === 1 && idTab === 'identification') {
      const okId = await saveIdentity();
      const okAddr = validateAddress();
      if (okId && okAddr) setIdTab('address');
      else if (okId && !okAddr) toast.error('Missing required fields', 'Please fix the highlighted address fields');
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
        // Last KYC sub-tab → straight to Map Products (now Step 3). The
        // Trade Document Management / Evidence Vault step was removed.
        setStep(3);
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
    const err = validateVendorUpload(file);
    if (err) { toast.error(err.title, err.body); return; }
    setDdRows(prev => prev.map(r => r.id === id ? { ...r, file, fileName: file.name } : r));
  };
  const attachFileToLicense = (id: string, file: File) => {
    const err = validateVendorUpload(file);
    if (err) { toast.error(err.title, err.body); return; }
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

  const openLicPopup = () => {
    setLicDraft(EMPTY_LIC_DRAFT);
    setLicPopupOpen(true);
    // license_name options are now seeded from the master bundle on mount
    // (see hydrate() in the bundled-fetch useEffect above), so no fetch
    // is needed here. The popup opens with the dropdown pre-populated.
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
    // Signed docs are locked — they never join select-all or a bulk send.
    const isSignedRow = (s: string) => s === 'completed' || s === 'Signed';
    setTradeDocRows(prev => {
      const selectable = prev.filter(r => !isSignedRow(r.status));
      const allOn = selectable.length > 0 && selectable.every(r => r.sendForSignature);
      return prev.map(r => isSignedRow(r.status) ? r : { ...r, sendForSignature: !allOn });
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
        .then((res) => {
          setRecentReminds(prev => ({ ...prev, [reqId]: Date.now() + 60_000 }));
          toast.success('Reminder sent',
            bundleCount > 1
              ? `The signer was notified about all ${bundleCount} documents in this signature request.`
              : 'The signer has been notified.',
          );
          // Optimistic counter bump — server's returned value wins so
          // the badge stays accurate even when the polling loop is
          // mid-flight against the same row.
          const serverCount = Number(res?.data?.data?.reminder_count ?? NaN);
          const serverLastAt = (res?.data?.data?.last_reminder_sent_at ?? null) as string | null;
          setTradeDocRows(prev => prev.map(r => (
            r.signatureRequestId === reqId
              ? {
                  ...r,
                  reminder_count: Number.isFinite(serverCount) ? serverCount : (r.reminder_count ?? 0) + 1,
                  last_reminder_sent_at: serverLastAt ?? new Date().toISOString(),
                }
              : r
          )));
        })
        .catch(err => toast.error('Reminder failed', err?.response?.data?.message ?? 'Could not send the reminder. Try again later.'));
      return;
    }
    setSendForSignature([row.db_id]);
  };
  const sendSelectedTradeDocs = () => {
    // Signed (completed) docs are locked — never include them in a bulk send.
    const ids = tradeDocRows
      .filter(r => r.sendForSignature && r.db_id && r.status !== 'completed' && r.status !== 'Signed')
      .map(r => r.db_id!);
    if (ids.length === 0) {
      toast.info('Nothing selected', 'Tick one or more unsigned documents under "Send for Signature" first.');
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
  // gst_percentage options are seeded from the master bundle on mount
  // (see hydrate() in the bundled-fetch useEffect above). The two callers
  // below still invoke this helper but it's now a no-op kept for layout
  // — removing the fetch silently turns the dialog into an instant open.
  const fetchGstPctOptsIfNeeded = async () => { /* seeded from bundle */ };

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
    setMapEditingId(null);
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
    // Duplicate-mapping check only fires for ADD mode — in edit mode the
    // row already exists for this productId, so we exclude the row being
    // edited from the check.
    if (productMappings.some(m => m.productId === Number(mapDraft.productId) && m.id !== mapEditingId)) {
      toast.error('Already mapped', `${mapDraft.productCode} is already mapped to this vendor`);
      return;
    }
    if (mapEditingId) {
      setProductMappings(prev => prev.map(r => r.id !== mapEditingId ? r : {
        ...r,
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
      }));
      setMapEditingId(null);
      setMapPopupOpen(false);
      toast.success('Mapping updated', `${mapDraft.productCode} ${mapDraft.productName} updated`);
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

  /* Backfill HSN / Segment on existing mappings once productOpts arrive.
   * Edit-load seeds these as empty (the vendor show payload doesn't
   * include the joined master rows), so the Map Products table renders
   * blank cells until the user re-edits each mapping. This effect joins
   * each mapping back to its product by productId and writes the master
   * values in. Skips rows that already have data so a user-edited value
   * isn't clobbered. */
  useEffect(() => {
    if (productOpts.length === 0 || productMappings.length === 0) return;
    let dirty = false;
    const next = productMappings.map(m => {
      if (m.hsnSacCode && m.segment) return m;
      const opt = productOpts.find(o => Number(o.value) === Number(m.productId));
      if (!opt) return m;
      if ((m.hsnSacCode || '') === (opt.hsn || '') && (m.segment || '') === (opt.segment || '')) return m;
      dirty = true;
      return { ...m, hsnSacCode: m.hsnSacCode || opt.hsn || '', segment: m.segment || opt.segment || '' };
    });
    if (dirty) setProductMappings(next);
  }, [productOpts, productMappings]);

  /* Open the Map Products popup in edit mode for an existing row.
   * Prefills the draft from the row, sets mapEditingId so saveMapDraft
   * updates in place rather than appending, and ensures the product /
   * GST option lists are loaded so the dropdowns aren't blank. */
  const openMapEdit = (id: string) => {
    const row = productMappings.find(r => r.id === id);
    if (!row) return;
    setMapEditingId(id);
    setMapDraft({
      productId: row.productId != null ? String(row.productId) : '',
      productCode: row.productCode,
      productName: row.productName,
      hsnSacCode: row.hsnSacCode,
      segment: row.segment,
      batchSerialLot: row.batchSerialLot,
      purchasePrice: String(row.purchasePrice ?? ''),
      gstPercentage: String(row.gstPercentage ?? ''),
      gstAmount: String(row.gstAmount ?? ''),
      totalAmount: String(row.totalAmount ?? ''),
    });
    setMapPopupOpen(true);
    void fetchProductOptsIfNeeded();
    void fetchGstPctOptsIfNeeded();
  };

  /* Tracks which extra contact the popup is currently editing. null in
   * add-mode (popup appends a new row), set to a contact id in edit-mode
   * (saveContactDraft updates that row in place rather than creating a
   * duplicate). Lets the Edit icon on each secondary contact reuse the
   * same ContactAddPopup component. */
  const [contactEditingId, setContactEditingId] = useState<number | null>(null);
  /* Save the primary contact — validates the four required fields, then
     marks it saved so it surfaces as the locked "Primary" row in the
     table below. The actual persistence still happens in saveContacts()
     on Save & Next; this is the in-form confirmation step the user asked for. */
  const savePrimaryContact = () => {
    const errs: Record<string, string> = {};
    if (!contactName.trim())  errs.contactName = 'Contact Person Name is required';
    if (!designation.trim())  errs.designation = 'Designation is required';
    if (!contactNo.trim())    errs.contactNo   = 'Contact No is required';
    else { const e = validateContactNumber(contactNo, 'Contact No'); if (e) errs.contactNo = e; }
    if (!email.trim())        errs.email       = 'Email is required';
    else { const e = validateEmail(email); if (e) errs.email = e; }
    if (Object.keys(errs).length) {
      setFieldErrors(prev => ({ ...prev, ...errs }));
      toast.error('Missing required fields', 'Please fix the highlighted fields');
      return;
    }
    setPrimarySaved(true);
    toast.success('Primary contact saved', `${contactName} added below`);
  };

  const openContactPopup = () => {
    setContactEditingId(null);
    setContactDraft({ name: '', designation: '', phone: '', email: '', whatsapp: true, attachmentName: '', attachmentFile: null });
    setContactPopupOpen(true);
  };
  const openContactEdit = (id: number) => {
    const c = extraContacts.find(x => x.id === id);
    if (!c) return;
    setContactEditingId(id);
    setContactDraft({
      name: c.name,
      designation: c.designation,
      phone: c.phone,
      email: c.email,
      whatsapp: c.whatsapp,
      attachmentName: c.attachmentName,
      attachmentFile: c.attachmentFile ?? null,
      attachmentPath: c.attachmentPath,
    });
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

    if (contactEditingId !== null) {
      setExtraContacts(prev => prev.map(c => c.id === contactEditingId ? { ...c, ...contactDraft } : c));
      toast.success('Contact updated', `${contactDraft.name} updated`);
    } else {
      setExtraContacts(prev => [...prev, { id: Date.now(), ...contactDraft }]);
      toast.success('Contact added', `${contactDraft.name} added to the list`);
    }
    setContactPopupOpen(false);
    setContactEditingId(null);
  };
  const removeExtraContact = (id: number) => setExtraContacts(prev => prev.filter(c => c.id !== id));

  /* Row count for the active KYC sub-tab — drives the Figma "N documents"
     header badge. Falls back to the segment-rule reference rows when the user
     hasn't uploaded their own yet. */
  const kycDocCount =
    kycTab === 'company' ? (ddRows.length      || segmentDocs.dd.length) :
    kycTab === 'owner'   ? (ownerRows.length   || segmentDocs.kyc.length) :
    kycTab === 'license' ? (licenseRows.length || segmentDocs.tl.length) :
    kycTab === 'bank'    ? bankRows.length :
                           gstRows.length;

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
              {/* person-with-+ (add user) — matches the Figma header icon */}
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <line x1="19" y1="8" x2="19" y2="14" />
                <line x1="22" y1="11" x2="16" y2="11" />
              </svg>
            </div>
            <div className="min-w-0">
              <div className="avm-title">{isEdit ? 'Edit Supplier' : 'Add Supplier'}</div>
              <div className="avm-sub">{isEdit ? 'Update supplier details, KYC, or product mappings — saved per step.' : 'Capture, verify, and onboard suppliers with complete compliance and product readiness.'}</div>
            </div>
          </div>
          <div className="avm-head-right">
            {/* Map Product — opens the Mapped Products list popup (Figma). */}
            <button className="avm-map-btn" onClick={() => setMappedListOpen(true)}>
              <i className="ri-price-tag-3-line" /> Map Product
            </button>
            <button className="avm-close" onClick={onClose} aria-label="Close">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            </button>
          </div>
        </div>

        {/* ─── Stepper strip ─── */}
        <div className="avm-stepper-wrap">
          <div className="avm-stepper">
            {/* Two-stage stepper to mirror the Figma exactly: Legal Identity →
                KYC / Due Diligence. Product mapping is the final wizard step
                (step 3) but is not surfaced as a stepper card here. */}
            <StepperItem n={1} title="Supplier Legal Identity"   sub="Company, GST, PAN & contact" current={step} tone="violet" icon="ri-building-2-line" />
            <div className="avm-step-arrow">›</div>
            <StepperItem n={2} title="KYC / Due Diligence"       sub="Docs, identity & compliance" current={step} tone="purple" icon="ri-shield-check-line" />
          </div>
        </div>

        {/* ─── Body ─── */}
        <div className="avm-body">
          {(loadingEdit || mastersLoading) ? (
            /* Shimmer skeleton — replaces the form entirely while
               /vendors/master-bundle (or the edit-mode prefill) is in
               flight. Previously this was an overlay sitting ON TOP of
               the form, but absolute positioning inside a scrollable
               body left gaps and let the half-loaded form bleed through.
               Mutually-exclusive rendering is simpler and reliable.
               Skeleton hits 0ms when the sessionStorage cache is fresh. */
            <div className="avm-load-overlay avm-load-overlay-static" role="status" aria-live="polite" aria-label="Loading supplier form">
              <div className="avm-load-skeleton">
                {/* Section heading + 4 fields */}
                <div className="avm-load-bar avm-load-heading" />
                <div className="avm-load-grid">
                  <div className="avm-load-bar" />
                  <div className="avm-load-bar" />
                  <div className="avm-load-bar" />
                  <div className="avm-load-bar" />
                </div>
                {/* Address section heading + grid */}
                <div className="avm-load-bar avm-load-heading" style={{ marginTop: 18 }} />
                <div className="avm-load-grid">
                  <div className="avm-load-bar" />
                  <div className="avm-load-bar" />
                  <div className="avm-load-bar" />
                  <div className="avm-load-bar" />
                </div>
                {/* Contact section heading + grid */}
                <div className="avm-load-bar avm-load-heading" style={{ marginTop: 18 }} />
                <div className="avm-load-grid">
                  <div className="avm-load-bar" />
                  <div className="avm-load-bar" />
                  <div className="avm-load-bar" />
                  <div className="avm-load-bar" />
                </div>
                {/* Bottom section — KYC docs / product mappings */}
                <div className="avm-load-bar avm-load-heading" style={{ marginTop: 18 }} />
                <div className="avm-load-grid">
                  <div className="avm-load-bar" />
                  <div className="avm-load-bar" />
                  <div className="avm-load-bar" />
                  <div className="avm-load-bar" />
                </div>
              </div>
            </div>
          ) : (<>
          {/* The form body proper renders only when masters and edit-mode
              prefill have both finished — keeps half-hydrated inputs from
              flashing onscreen behind a translucent skeleton. */}
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
                    { label: 'Supplier Type',       value: labelFor(vendorType, SUPPLIER_TYPE_OPTS) || vendorType || '—' },
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

            // The Trade Document Management recap was removed along with
            // that step (Evidence Vault).

            if (prevStages.length === 0) return null;

            return (
              <div className="avm-prev">
                <div className="avm-prev-head">
                  <span className="avm-prev-ico"><i className="ri-time-line" /></span>
                  <div className="avm-prev-headtext">
                    <div className="avm-prev-title">What you did in previous stages</div>
                    <div className="avm-prev-subtitle">Stage {step - 1} completed — review your entry below</div>
                  </div>
                  <button className="avm-prev-toggle" onClick={() => setPrevOpen(o => !o)}>
                    {step - 1} stage{step - 1 > 1 ? 's' : ''} completed
                    <i className="ri-arrow-down-s-line" style={{ transform: prevOpen ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }} />
                  </button>
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
                <button className={`avm-tab ${idTab === 'identification' ? 'on' : ''}`} onClick={() => setIdTab('identification')}>Supplier Identification &amp; Address Details</button>
                {/* Can't jump to Contact Person Details until Supplier
                    Identification is valid. Mirrors Save & Next: validates +
                    persists (so the contact step has a vendorId to attach to)
                    and only switches when clean — else inline errors show. */}
                <button className={`avm-tab ${idTab === 'address' ? 'on' : ''}`} disabled={saving} onClick={async () => { if (saving || idTab === 'address') return; const okId = await saveIdentity(); const okAddr = validateAddress(); if (okId && okAddr) setIdTab('address'); else if (okId && !okAddr) toast.error('Missing required fields', 'Please fix the highlighted address fields'); }}>Contact Person Details</button>
              </div>

              {idTab === 'identification' && (
                <SectionCard tone="violet" icon={<i className="ri-building-line" />} title="Basic Company Details" subtitle="Supplier identity, type, and risk classification">
                  {/* 3×3 grid mirroring the Figma:
                      row1: Company Name · Company Legal Name · Supplier Type
                      row2: Company Website · Supplier Segment · Risk Level
                      row3: Supplier Behaviour · Classification & Flags · Compliance Behaviour */}
                  <div className="avm-grid-3">
                    <Field label="Company Name" required error={fieldErrors.companyName}>
                      <input
                        className="avm-input"
                        placeholder="e.g. ABC Logistics"
                        value={companyName}
                        maxLength={COMPANY_NAME_MAX}
                        onChange={e => handleCompanyNameChange(e.target.value, 'companyName', setCompanyName)}
                      />
                    </Field>
                    <Field label="Company Legal Name" error={fieldErrors.legalName}>
                      <input
                        className="avm-input"
                        placeholder="ABC Logistics Pvt Ltd"
                        value={legalName}
                        maxLength={COMPANY_NAME_MAX}
                        onChange={e => handleCompanyNameChange(e.target.value, 'legalName', setLegalName)}
                      />
                    </Field>
                    <Field label="Supplier Type" required error={fieldErrors.vendorType}>
                      <SelectInput value={vendorType} onChange={(v) => { setVendorType(v); clearFieldError('vendorType'); }} placeholder="Select" options={SUPPLIER_TYPE_OPTS} />
                    </Field>
                  </div>
                  <div className="avm-grid-3">
                    <Field label="Company Website">
                      <input className="avm-input" placeholder="https://abclogistics.com" value={website} onChange={e => setWebsite(e.target.value)} />
                    </Field>
                    <Field label="Supplier Segment" required addNew onAdd={() => setQuickAdd('segments')} error={fieldErrors.segment}>
                      {/* masterFormKit's MasterMultiSelect renders visible violet
                          chips with × buttons + a checkbox-marked dropdown so
                          multi-select is obvious. `value` prop is plural despite
                          the singular name. Wrapped in .avm-master-select so it
                          gets the same 32px height / padding / placeholder size
                          as every other select on the form. */}
                      <div className="avm-master-select">
                        <MasterMultiSelect
                          value={segment}
                          options={segmentOpts}
                          placeholder="Select Segment"
                          onChange={vs => { setSegment(vs); clearFieldError('segment'); }}
                        />
                      </div>
                    </Field>
                    <Field label="Risk Level" required addNew onAdd={() => setQuickAdd('risk_levels')} error={fieldErrors.riskLevel}>
                      <SelectInput value={riskLevel} onChange={(v) => { setRiskLevel(v); clearFieldError('riskLevel'); }} placeholder="Select" options={riskLevelOpts} />
                    </Field>
                  </div>
                  <div className="avm-grid-3">
                    <Field label="Supplier Behaviour" required addNew onAdd={() => setQuickAdd('vendor_behaviour')} error={fieldErrors.vendorBehaviour}>
                      <SelectInput value={vendorBehaviour} onChange={(v) => { setVendorBehaviour(v); clearFieldError('vendorBehaviour'); }} placeholder="Select" options={behaviourOpts} />
                    </Field>
                    <Field label="Classification & Flags">
                      {/* Visual-only — see classificationFlag state note. */}
                      <SelectInput value={classificationFlag} onChange={setClassificationFlag} placeholder="Select" options={CLASSIFICATION_OPTS} />
                    </Field>
                    <Field label="Compliance Behaviour" required addNew onAdd={() => setQuickAdd('compliance_behaviours')} error={fieldErrors.complianceBehaviour}>
                      <SelectInput value={complianceBehaviour} onChange={(v) => { setComplianceBehaviour(v); clearFieldError('complianceBehaviour'); }} placeholder="Select" options={complianceOpts} />
                    </Field>
                  </div>
                </SectionCard>
              )}

              {idTab === 'identification' && (
                <SectionCard tone="amber" icon={<i className="ri-map-pin-line" />} title="Supplier Address Details" subtitle="Registered office and location">
                  <div className="avm-grid-2">
                    <Field label="Address Type" required>
                      {/* Primary address type is locked to "Registered Office
                          Address" — same as the Customer form. Other types
                          (Warehouse, Billing, …) belong on later steps. */}
                      <div className="avm-master-select">
                        <MasterSelect
                          value="Registered Office"
                          options={[{ value: 'Registered Office', label: 'Registered Office' }]}
                          placeholder="Select address type"
                          disabled
                          onChange={() => { /* locked */ }}
                        />
                      </div>
                    </Field>
                    <Field label="Registered Office Address" required error={fieldErrors.registeredOffice}>
                      <input
                        className="avm-input"
                        placeholder="Plot 21, Industrial Area"
                        value={registeredOffice}
                        maxLength={200}
                        onChange={e => applySanitizer(e.target.value, 'registeredOffice', setRegisteredOffice, sanitizeKycAddress)}
                      />
                    </Field>
                  </div>
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
                      <input
                        className="avm-input"
                        placeholder="e.g. Pune"
                        value={city}
                        maxLength={60}
                        onChange={e => applySanitizer(e.target.value, 'city', setCity, raw => sanitizeKycAlpha(raw, 60))}
                      />
                    </Field>
                  </div>
                </SectionCard>
              )}

              {idTab === 'address' && (
                <>
                  {/* Primary Contact Person Details — moved here from the
                      Identification tab to mirror the Figma's "Contact Person
                      Details" tab. Same component state, so saveContacts()
                      still validates + persists it on Save & Next. */}
                  <SectionCard tone="violet" icon={<i className="ri-user-3-line" />} title="Primary Contact Person Details" subtitle="Primary point of contact for this supplier" headerAction={
                    <button className="avm-section-add-btn" onClick={savePrimaryContact}>
                      <i className="ri-save-line" /> Save Contact
                    </button>
                  }>
                    <div className="avm-grid-4">
                      <Field label="Contact Person Name" required error={fieldErrors.contactName}>
                        <input className="avm-input" placeholder="Rahul Sharma" value={contactName} maxLength={60} onChange={e => applySanitizer(e.target.value, 'contactName', setContactName, raw => sanitizeKycAlpha(raw, 60))} />
                      </Field>
                      <Field label="Designation" required error={fieldErrors.designation}>
                        <input className="avm-input" placeholder="Manager" value={designation} maxLength={60} onChange={e => applySanitizer(e.target.value, 'designation', setDesignation, raw => sanitizeKycDesignation(raw, 60))} />
                      </Field>
                      <Field label="Contact No" required error={fieldErrors.contactNo}>
                        <input className="avm-input" placeholder="9876543210" inputMode="numeric" pattern="\d*" maxLength={15} value={contactNo} onChange={e => { setContactNo(digitsOnly(e.target.value)); clearFieldError('contactNo'); }} />
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
                      <Field label="Attachment (Business Card)">
                        <FileChooser file={attachment} onPick={(f) => setAttachment(f)} placeholder="No files attached" />
                      </Field>
                    </div>
                  </SectionCard>

                  {/* ── Additional Contact Persons ──
                      The primary KYC contact (captured on the Vendor
                      Identification sub-tab) is also surfaced here as
                      the first row so the table reads as "all contacts
                      we know about". Marked with a "Primary" pill and
                      not deletable — the user has to go back to the
                      first sub-tab to change it. */}
                  <SectionCard tone="violet" icon={<i className="ri-contacts-book-line" />} title="Additional Contact Persons" subtitle="Add more points of contact for this supplier" headerAction={
                    <button className="avm-section-add-btn" onClick={openContactPopup}>+ Add More Contact Person</button>
                  }>
                    {(() => {
                      // Additional (secondary) contacts only — the primary KYC
                      // contact now lives in its own card above (Figma layout).
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
                      // Primary contact surfaces as the first, locked row once it
                      // has been saved (or always, in edit mode where it already
                      // exists). Marked "Primary" — no edit/delete actions.
                      const primaryHasData = !!(contactName.trim() || email.trim() || contactNo.trim());
                      if ((primarySaved || isEdit) && primaryHasData) {
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
                        return <div className="avm-empty">No contact persons added yet.</div>;
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
                                          style={{ maxWidth: 200, color: '#6d28d9', textDecoration: 'underline', textUnderlineOffset: 2 }}
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
                                        <span className="text-muted fs-13" title="Edit in the Primary Contact Person card above">—</span>
                                      ) : (
                                        <>
                                          <button type="button" className="btn btn-sm btn-soft-info" onClick={() => r.contactId !== undefined && openContactEdit(r.contactId)} data-tooltip="Edit" aria-label="Edit">
                                            <i className="ri-pencil-line" />
                                          </button>
                                          <button type="button" className="btn btn-sm btn-soft-danger" onClick={() => r.contactId !== undefined && removeExtraContact(r.contactId)} data-tooltip="Remove" aria-label="Remove">
                                            <i className="ri-delete-bin-line" />
                                          </button>
                                        </>
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
          {step === 2 && (<>
            {/* Sub-tab strip sits ABOVE the section card (Figma layout). */}
            <div className="avm-pill-tabs">
              <button className={`avm-pill ${kycTab === 'company' ? 'on' : ''}`} onClick={() => setKycTab('company')}>Company Due Diligence</button>
              <button className={`avm-pill ${kycTab === 'owner'   ? 'on' : ''}`} onClick={() => setKycTab('owner')}>Owner KYC</button>
              <button className={`avm-pill ${kycTab === 'license' ? 'on' : ''}`} onClick={() => setKycTab('license')}>Trade Licence</button>
              <button className={`avm-pill ${kycTab === 'bank'    ? 'on' : ''}`} onClick={() => setKycTab('bank')}>Bank Details</button>
              <button className={`avm-pill ${kycTab === 'gst'     ? 'on' : ''}`} onClick={() => setKycTab('gst')}>GST Scrutiny</button>
            </div>
            <SectionCard tone="teal" icon={<i className="ri-file-list-3-line" />} title={KYC_TAB_TITLE[kycTab] ?? 'KYC / Due Diligence'} subtitle={KYC_TAB_SUB[kycTab] ?? 'Upload statutory & identity proofs'} headerAction={
              <div className="d-inline-flex align-items-center gap-2">
                <span className="avm-doc-count">{kycDocCount} document{kycDocCount === 1 ? '' : 's'}</span>
                {(kycTab === 'bank' || kycTab === 'gst') && (
                  <button className={`avm-section-add-btn${kycTab === 'gst' ? ' amber' : ''}`} onClick={kycTabAddMeta[kycTab].onClick}>
                    {kycTabAddMeta[kycTab].label}
                  </button>
                )}
              </div>
            }>

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
          </>)}

          {/* ─── STEP 3 ─── */}
          {/* Step 3 (Trade Document Management / Evidence Vault) removed —
              KYC & trade-document uploads now live in the standalone
              Evidence Vault popup. */}

          {/* ─── STEP 3 — Map Products ─── */}
          {step === 3 && (
            <SectionCard tone="green" icon={<i className="ri-box-3-line" />} title="Products Details" subtitle="Link products to this vendor with purchase price & GST" headerAction={
              <button className="avm-section-add-btn" onClick={openMapPopup}>+ Add More Products</button>
            }>
              <ProductMappingTable rows={productMappings} onRemove={removeMapRow} onEdit={openMapEdit} />
            </SectionCard>
          )}
          </>)}
        </div>

        {/* ─── Footer ─── */}
        <div className="avm-foot">
          <div className="avm-foot-note">
            <span className="avm-foot-dot" /> Fields marked with <span className="avm-req">*</span> are required
          </div>
          <div className="avm-foot-right">
            {step > 1 && <button className="avm-btn-outline" onClick={goPrev}>← Previous</button>}
            {step < 3 ? (
              <button className="avm-btn-primary" onClick={goNext} disabled={saving}>
                {saving ? (
                  <><span className="avm-spinner" role="status" aria-hidden="true" /> Saving…</>
                ) : (
                  <>Save &amp; Next →</>
                )}
              </button>
            ) : (
              <button className="avm-btn-primary" onClick={submitAll} disabled={saving}>
                {saving ? (
                  <><span className="avm-spinner" role="status" aria-hidden="true" /> Saving…</>
                ) : (
                  <><i className="ri-check-line" /> Save Supplier</>
                )}
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
      {mappedListOpen && (
        <MappedProductsPopup
          rows={productMappings}
          onAdd={openMapPopup}
          onRemove={removeMapRow}
          onEdit={openMapEdit}
          onClose={() => setMappedListOpen(false)}
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
            bustVendorMasterBundle();
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
    /* Same defence layer the main vendor form uses on its Company Name —
     * Quick Add writes straight to /master/{slug} so without this an
     * attacker could plant `<script>` / `' OR 1=1 --` into a Risk Level
     * or Compliance Behaviour and have it render verbatim everywhere
     * those masters are surfaced. */
    const QA_SQL_RE = /(\bOR\b\s+\d+\s*=\s*\d+|--|;\s*(?:DROP|DELETE|INSERT|UPDATE|TRUNCATE|ALTER)\b|\bUNION\s+SELECT\b|javascript:|\bon\w+\s*=)/i;
    const QA_NAME_WHITELIST = /^[A-Za-z0-9\s\-.,()&/'%]+$/;
    schema.fields.forEach(f => {
      const raw = (values[f.name] ?? '').toString().trim();
      if (f.required && !raw) {
        errs[f.name] = `${f.label} is required`;
        return;
      }
      if (!raw || f.type === 'number') return;
      if (/[<>]/.test(raw)) {
        errs[f.name] = `${f.label} cannot contain HTML characters (< or >)`;
        return;
      }
      if (QA_SQL_RE.test(raw)) {
        errs[f.name] = `${f.label} contains disallowed patterns (possible SQL/JS injection)`;
        return;
      }
      if (!/[A-Za-z0-9]/.test(raw)) {
        errs[f.name] = `${f.label} must contain meaningful text (letters or numbers)`;
        return;
      }
      if (!QA_NAME_WHITELIST.test(raw)) {
        errs[f.name] = `${f.label} may only contain letters, numbers, spaces, and . , - ( ) & / ' %`;
        return;
      }
      if (raw.length > 80) {
        errs[f.name] = `${f.label} must be 80 characters or fewer`;
        return;
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
  const [errors, setErrors] = useState<{ name?: string; designation?: string }>({});
  const handleNameChange = (raw: string) => {
    const { cleaned, error } = sanitizeKycAlpha(raw, 60);
    setDraft({ ...draft, name: cleaned });
    setErrors(prev => ({ ...prev, name: error }));
  };
  const handleDesignationChange = (raw: string) => {
    const { cleaned, error } = sanitizeKycDesignation(raw, 60);
    setDraft({ ...draft, designation: cleaned });
    setErrors(prev => ({ ...prev, designation: error }));
  };
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
            <Field label="Contact Person Name" required error={errors.name}>
              <input
                className="avm-input"
                placeholder="Enter name"
                value={draft.name}
                maxLength={60}
                onChange={e => handleNameChange(e.target.value)}
              />
            </Field>
            <Field label="Designation" required error={errors.designation}>
              <input
                className="avm-input"
                placeholder="Enter designation"
                value={draft.designation}
                maxLength={60}
                onChange={e => handleDesignationChange(e.target.value)}
              />
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
  icon: string;
}) {
  const state = props.current > props.n ? 'done' : props.current === props.n ? 'active' : 'idle';
  return (
    <div className={`avm-step avm-step-${state} avm-step-${props.tone}`}>
      <div className="avm-step-ico">
        {state === 'done'
          ? <i className="ri-check-line" />
          : <><i className={props.icon} /><span className="avm-step-ico-num">{props.n}</span></>}
      </div>
      <div className="avm-step-text">
        <div className="avm-step-title">{props.title}</div>
        <div className="avm-step-sub">{props.sub}</div>
      </div>
      {state === 'active' && <span className="avm-step-badge avm-step-badge-active">In Progress</span>}
      {state === 'done'   && <span className="avm-step-badge avm-step-badge-done">Completed</span>}
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
          <div className="avm-section-headtext">
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
const FILE_ACCEPT     = '.jpg,.jpeg,.png,.pdf,.doc,.docx,image/jpeg,image/png,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const FILE_MAX_BYTES  = 2 * 1024 * 1024; // 2 MB
const FILE_TYPE_LABEL = 'JPG / PNG / PDF / DOC / DOCX';
const FILE_ALLOWED_EXT_RE   = /\.(jpe?g|png|pdf|docx?)$/i;
const FILE_ALLOWED_MIME_RE  = /^(image\/(jpeg|png)|application\/(pdf|msword|vnd\.openxmlformats-officedocument\.wordprocessingml\.document))$/i;
/* Dangerous extension blacklist — script-style and executable files that
 * must never reach storage even if a mistuned MIME-sniff or an empty type
 * lets them past the allow-list. Belt-and-suspenders behind the whitelist. */
const FILE_DENY_EXT_RE = /\.(exe|bat|cmd|com|scr|msi|js|jse|vbs|vbe|ws[hf]?|ps1|psm1|jar|sh|app|apk|dll|deb|rpm|html?|svg|php|asp[x]?|jsp)$/i;

/* Shared upload validator for the inline KYC / DD / Trade-Document / segment
 * table upload buttons. FileChooser already runs these three checks inline,
 * but the table <input type="file"> handlers bypassed them, so unsupported /
 * oversized files (e.g. .exe) were accepted (QA bug). Returns a toast-ready
 * { title, body } when the file must be rejected, or null when it's allowed. */
function validateVendorUpload(file: File): { title: string; body: string } | null {
  if (FILE_DENY_EXT_RE.test(file.name)) {
    return { title: 'Unsafe file type blocked', body: `${file.name} — executable / script files are not allowed` };
  }
  const mimeOk = file.type && FILE_ALLOWED_MIME_RE.test(file.type);
  const extOk  = FILE_ALLOWED_EXT_RE.test(file.name);
  if (!mimeOk && !extOk) {
    return { title: 'Unsupported file', body: `Only ${FILE_TYPE_LABEL} files are allowed` };
  }
  if (file.size > FILE_MAX_BYTES) {
    return { title: 'File too large', body: `${file.name} exceeds the 2 MB limit` };
  }
  return null;
}

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
    /* Three-layer validation — the native `accept` attribute is advisory
     * (users can override via the OS dialog), so we enforce on JS too:
     *   1. Hard-deny dangerous extensions (.exe, .bat, .js, .html, …)
     *      even if the MIME somehow claims otherwise.
     *   2. Allow only the whitelisted business formats (PDF/JPG/PNG/DOC/DOCX)
     *      by MIME *or* by extension. The OR is necessary because some
     *      browsers / OSes ship an empty `picked.type` for valid files. */
    const name = picked.name;
    if (FILE_DENY_EXT_RE.test(name)) {
      toast.error('Unsafe file type blocked', `${name} — executable / script files are not allowed`);
      e.target.value = '';
      return;
    }
    const mimeOk = picked.type && FILE_ALLOWED_MIME_RE.test(picked.type);
    const extOk  = FILE_ALLOWED_EXT_RE.test(name);
    if (!mimeOk && !extOk) {
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
            data-tooltip="View attachment"
            aria-label="View attachment"
            onClick={(e) => e.stopPropagation()}
          >
            <i className="ri-eye-line" />
          </a>
        )}
        <button
          type="button"
          className="avm-fc-action avm-fc-delete"
          data-tooltip="Delete attachment"
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
  const toast = useToast();
  /* Show the blob URL immediately for instant feedback, then fire the
   * server upload — the persist callback swaps the blob URL for a
   * permanent attachment_url once the row lands in segment_doc_uploads. */
  const onPick = (refKey: string, docName: string, f: File | undefined) => {
    if (!f) return;
    /* Reject unsupported / oversized files BEFORE the optimistic UI shows
       the row as uploaded (QA: Company DD / Trade Document accepted .exe). */
    const err = validateVendorUpload(f);
    if (err) { toast.error(err.title, err.body); return; }
    setUploads(prev => {
      const existing = prev[refKey];
      if (existing?.url && existing.url.startsWith('blob:')) {
        try { URL.revokeObjectURL(existing.url); } catch {}
      }
      return { ...prev, [refKey]: { file: f, url: URL.createObjectURL(f), name: f.name } };
    });
    void persistUpload(refKey, f, docName);
  };
  const [q, setQ] = useState('');
  const lo = q.trim().toLowerCase();
  const filtered = lo
    ? rows.filter(r => `${r.code} ${r.name} ${r.authority ?? ''}`.toLowerCase().includes(lo))
    : rows;
  return (
    <>
      {/* Search bar (Figma) */}
      <div className="avm-kyc-search">
        <i className="ri-search-line" />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder={`Search ${title.replace(/ NAME$/i, '').toLowerCase()} name…`} />
        {q && <button type="button" className="avm-kyc-search-clear" onClick={() => setQ('')} aria-label="Clear"><i className="ri-close-line" /></button>}
      </div>
      <div className="table-responsive table-card border rounded avm-kyc-table-wrap">
        <table className="table align-middle mb-0 avm-kyc-table">
          <thead className="table-light">
            <tr>
              <th>SR NO</th>
              <th>AUTO CODE</th>
              <th>{title}</th>
              <th>ISSUING AUTHORITY</th>
              <th>EXPIRY</th>
              <th>STATUS</th>
              <th>ACTIONS</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r, i) => {
              const refKey = `${tabKey}::${r.code}`;
              const uploaded = uploads[refKey];
              const isDate = !!(r.expiry && /\d/.test(r.expiry));
              return (
                <tr key={r.code}>
                  <td><span className="avm-sr-badge">{String(i + 1).padStart(2, '0')}</span></td>
                  <td><span className="avm-auto-code">{r.code}</span></td>
                  <td><strong>{r.name}</strong></td>
                  <td>{r.authority || '—'}</td>
                  <td><span className={`avm-exp-pill ${isDate ? 'is-date' : 'is-na'}`}>{r.expiry || 'N/A'}</span></td>
                  <td>
                    <div className="avm-req-pair">
                      <span className={`avm-req-pill ${r.requirement === 'M' ? 'on-m' : 'off'}`}>✓ Mandatory</span>
                      <span className={`avm-req-pill ${r.requirement === 'O' ? 'on-o' : 'off'}`}>Optional</span>
                    </div>
                  </td>
                  <td>
                    <div className="avm-kyc-actions">
                      <label className="avm-kyc-act up" data-tooltip={uploaded ? 'Re-upload' : 'Upload'} aria-label={uploaded ? 'Re-upload' : 'Upload'}>
                        <i className="ri-upload-2-line" />
                        <input type="file" hidden accept={FILE_ACCEPT} onChange={e => onPick(refKey, r.name, e.target.files?.[0])} />
                      </label>
                      {uploaded ? (
                        <a href={uploaded.url} download={uploaded.name} className="avm-kyc-act down" data-tooltip={`Download ${uploaded.name}`} aria-label="Download"><i className="ri-download-2-line" /></a>
                      ) : (
                        <span className="avm-kyc-act down is-disabled" data-tooltip="No file uploaded yet" aria-label="No file"><i className="ri-download-2-line" /></span>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr><td colSpan={7} style={{ textAlign: 'center', padding: '18px', color: '#94a3b8' }}>No documents match your search.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
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
          style={{ maxWidth: 180, color: '#6d28d9', textDecoration: 'underline', textUnderlineOffset: 2 }}
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
          data-tooltip="View attachment"
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
          data-tooltip="Delete attachment"
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
    <div className="table-responsive table-card border rounded avm-kyc-table-wrap">
      <table className="table align-middle mb-0 avm-kyc-table">
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
                      <label className="btn btn-sm btn-soft-primary mb-0" data-tooltip="Upload" aria-label="Upload">
                        <i className={r.fileName ? 'ri-checkbox-circle-line' : 'ri-upload-2-line'} />
                        <input type="file" hidden accept={FILE_ACCEPT} onChange={e => {
                          const f = e.target.files?.[0];
                          if (f && props.onAttach) props.onAttach(r.id, f);
                        }} />
                      </label>
                    )}
                    {props.onRemove && !r.mandatory && (
                      <button type="button" className="btn btn-sm btn-soft-danger" onClick={() => props.onRemove?.(r.id)} data-tooltip="Remove" aria-label="Remove">
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
    <div className="table-responsive table-card border rounded avm-kyc-table-wrap">
      <table className="table align-middle mb-0 avm-kyc-table">
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
                  <button type="button" className="btn btn-sm btn-soft-danger" onClick={() => props.onRemove?.(r.id)} data-tooltip="Remove" aria-label="Remove">
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
    <div className="table-responsive table-card border rounded avm-kyc-table-wrap">
      <table className="table align-middle mb-0 avm-kyc-table">
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
                        <label className="btn btn-sm btn-soft-primary mb-0" data-tooltip="Upload" aria-label="Upload">
                          <i className={r.fileName ? 'ri-checkbox-circle-line' : 'ri-upload-2-line'} />
                          <input type="file" hidden onChange={e => {
                            const f = e.target.files?.[0];
                            if (f && props.onAttach) props.onAttach(r.id, f);
                          }} />
                        </label>
                      )}
                      {props.onRemove && !isSeed && (
                        <button type="button" className="btn btn-sm btn-soft-danger" onClick={() => props.onRemove?.(r.id)} data-tooltip="Remove" aria-label="Remove">
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
    <div className="table-responsive table-card border rounded avm-kyc-table-wrap">
      <table className="table align-middle mb-0 avm-kyc-table">
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
                <button type="button" className="btn btn-sm btn-soft-danger" onClick={() => props.onRemove?.(r.id)} data-tooltip="Remove" aria-label="Remove">
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
    <div className="table-responsive table-card border rounded avm-kyc-table-wrap">
      <table className="table align-middle mb-0 avm-kyc-table">
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
                <button type="button" className="btn btn-sm btn-soft-danger" onClick={() => props.onRemove?.(r.id)} data-tooltip="Remove" aria-label="Remove">
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
  // Signed docs are locked — select-all reflects only the unsigned rows.
  const selectable = props.rows.filter(r => r.status !== 'completed' && r.status !== 'Signed');
  const allChecked = selectable.length > 0 && selectable.every(r => r.sendForSignature);
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
                  <input type="checkbox" checked={allChecked} disabled={selectable.length === 0} onChange={props.onToggleAll} />
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
                            checked={!isSigned && r.sendForSignature}
                            onChange={() => props.onToggleSign(r.code)}
                            disabled={isSigned}
                          />
                          {(() => {
                            const remCount = r.reminder_count ?? 0;
                            const lastAt   = r.last_reminder_sent_at;
                            const baseTitle = isSigned
                              ? 'This document has already been signed.'
                              : r.cooldownActive
                                ? 'Reminder just sent — one reminder covers every document in this bundle.'
                                : (r.status === 'N/A' ? 'Send for signature' : 'Resend for signature');
                            const titleWithCount = remCount > 0
                              ? `${baseTitle} · Reminders sent: ${remCount}${lastAt ? ` (last: ${new Date(lastAt).toLocaleString()})` : ''}`
                              : baseTitle;
                            const isResend = r.status !== 'N/A';
                            return (
                              <button
                                type="button"
                                className="avm-btn-primary"
                                style={{
                                  display: 'inline-flex', alignItems: 'center', gap: 5,
                                  padding: '6px 14px',
                                  fontSize: 13,
                                  opacity: (isSigned || r.cooldownActive) ? 0.5 : 1,
                                  cursor:  (isSigned || r.cooldownActive) ? 'not-allowed' : 'pointer',
                                }}
                                onClick={() => { if (!isSigned && !r.cooldownActive) props.onSend(r.code); }}
                                disabled={isSigned || !!r.cooldownActive}
                                title={titleWithCount}
                              >
                                <i className="ri-send-plane-line me-1" /> {r.cooldownActive ? 'Sent ✓' : (isResend ? 'Resend' : 'Send')}
                                {isResend && remCount > 0 && (
                                  <span aria-label={`Reminder sent ${remCount} times`} style={{
                                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                    marginLeft: 2, minWidth: 18, padding: '0 5px', height: 16,
                                    borderRadius: 999,
                                    background: 'rgba(255,255,255,.22)', color: '#fff',
                                    fontFamily: "'Geist Mono', ui-monospace, monospace",
                                    fontSize: 9.5, fontWeight: 800, letterSpacing: '.02em', lineHeight: 1,
                                  }}>× {remCount}</span>
                                )}
                              </button>
                            );
                          })()}
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
                        data-tooltip={r.signedUrl ? 'View signed document' : 'View'}
                        aria-label={r.signedUrl ? 'View signed document' : 'View'}
                        style={{ opacity: canView ? 1 : 0.5, pointerEvents: canView ? 'auto' : 'none' }}
                      >
                        <i className="ri-eye-line" />
                      </a>
                      <a
                        href={r.signedUrl || '#'}
                        download={r.signedUrl ? '' : undefined}
                        onClick={e => { if (!r.signedUrl) e.preventDefault(); }}
                        className="btn btn-sm btn-soft-secondary"
                        data-tooltip={r.signedUrl ? 'Download signed document' : 'Download'}
                        aria-label={r.signedUrl ? 'Download signed document' : 'Download'}
                        style={{ opacity: r.signedUrl ? 1 : 0.5, pointerEvents: r.signedUrl ? 'auto' : 'none' }}
                      >
                        <i className="ri-download-2-line" />
                      </a>
                      {/* Certificate of Completion — third action only
                          when the request is completed and Zoho has
                          minted the certificate. Matches the Customer /
                          Consignee Stage 3 tables. The legacy 'Signed'
                          string is treated the same as 'completed' so
                          rows from before the live-status polling
                          landed still see the button. */}
                      {(r.status === 'completed' || r.status === 'Signed') && r.certificateUrl && (
                        <a
                          href={r.certificateUrl}
                          target="_blank"
                          rel="noreferrer"
                          download=""
                          className="btn btn-sm btn-soft-info"
                          data-tooltip="Download Certificate of Completion"
                          aria-label="Download Certificate of Completion"
                          style={{ pointerEvents: 'auto' }}
                        >
                          <i className="ri-award-line" />
                        </a>
                      )}
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
function ProductMappingTable(props: { rows: ProductMappingRow[]; onRemove: (id: string) => void; onEdit?: (id: string) => void }) {
  if (props.rows.length === 0) return <EmptyTable label="No products mapped yet. Use “+ Add More Products” to link this vendor to one or more products." />;
  return (
    <div className="table-responsive table-card border rounded avm-kyc-table-wrap">
      <table className="table align-middle mb-0 avm-kyc-table">
        <thead className="table-light">
          <tr>
            <th>SR NO</th>
            <th>PRODUCT CODE</th>
            <th>PRODUCT NAME</th>
            <th>HSN / SAC</th>
            <th>SEGMENT</th>
            <th>BATCH / LOT</th>
            <th className="text-end">PRICE (₹)</th>
            <th className="text-end">GST %</th>
            <th className="text-end">GST AMT (₹)</th>
            <th className="text-end">TOTAL (₹)</th>
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
                <div className="hstack gap-1">
                  {props.onEdit && (
                    <button type="button" className="btn btn-sm btn-soft-info" onClick={() => props.onEdit?.(r.id)} data-tooltip="Edit product" aria-label="Edit product">
                      <i className="ri-pencil-line" />
                    </button>
                  )}
                  <button type="button" className="btn btn-sm btn-soft-danger" onClick={() => props.onRemove(r.id)} data-tooltip="Remove product" aria-label="Remove product">
                    <i className="ri-delete-bin-line" />
                  </button>
                </div>
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
                      <button type="button" className={`btn btn-sm ${done ? 'btn-soft-success' : 'btn-soft-primary'}`} onClick={() => props.onUpload(r.code)} data-tooltip={done ? 'Uploaded' : 'Upload'} aria-label={done ? 'Uploaded' : 'Upload'}>
                        <i className={done ? 'ri-checkbox-circle-line' : 'ri-upload-2-line'} />
                      </button>
                      <button type="button" className="btn btn-sm btn-soft-secondary" data-tooltip="Download" aria-label="Download" disabled={!done}>
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

/* Mapped Products list popup — opened from the Add Supplier header's
 * "Map Product" button (Figma flow). Shows the supplier's current product
 * mappings (or an empty state) and a "Map Product" CTA that opens the
 * AddProductMappingPopup form. Reuses the shared popup chrome (avm-cp-*). */
function MappedProductsPopup(props: {
  rows: ProductMappingRow[];
  onAdd: () => void;
  onRemove: (id: string) => void;
  onEdit: (id: string) => void;
  onClose: () => void;
}) {
  const n = props.rows.length;
  return createPortal((
    <div className="avm-cp-backdrop">
      <div className="avm-cp-popup avm-cp-popup-wide">
        <div className="avm-cp-head">
          <div className="avm-cp-title">
            <i className="ri-box-3-line" /> Mapped Products
            <div className="avm-cp-subtitle">Products linked to this supplier with price &amp; GST</div>
          </div>
          <button className="avm-close avm-cp-close" onClick={props.onClose} aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>
        <div className="avm-cp-body">
          <div className="avm-mapped-toolbar">
            <span className="avm-mapped-count">{n} product{n === 1 ? '' : 's'} mapped</span>
            <button className="avm-section-add-btn" onClick={props.onAdd}>
              <i className="ri-add-line" /> Map Product
            </button>
          </div>
          {n === 0 ? (
            <div className="avm-empty avm-empty-accent">No products mapped yet. Click "Map Product" to begin.</div>
          ) : (
            <ProductMappingTable rows={props.rows} onRemove={props.onRemove} onEdit={props.onEdit} />
          )}
        </div>
        <div className="avm-cp-foot">
          <button className="avm-btn-ghost" onClick={props.onClose}>Close</button>
        </div>
      </div>
    </div>
  ), document.body);
}

function PopupShell(props: {
  title: string;
  icon: string;
  subtitle?: string;
  tone?: 'purple' | 'amber';
  onClose: () => void;
  onSave: () => void;
  children: ReactNode;
}) {
  const amber = props.tone === 'amber';
  return createPortal((
    /* Backdrop click does NOT dismiss — these popups (DD / Owner
       KYC / Trade License / Bank / GST / Product Mapping) all
       collect form input that's easy to lose on a stray click. */
    <div className="avm-cp-backdrop">
      <div className={`avm-cp-popup${amber ? ' avm-cp-amber' : ''}`}>
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
          <button className={`avm-btn-primary${amber ? ' avm-btn-amber' : ''}`} onClick={props.onSave}>
            <i className="ri-save-line" /> Save
          </button>
        </div>
      </div>
    </div>
  ), document.body);
}

type DdAddPopupDraft = { documentName: string; issuingAuthority: string; expiry: string; mandatory: boolean; file: File | null; fileName: string };

/* ─── Vendor KYC popup field sanitisers ────────────────────────────────
 * Shared by the DD, Owner KYC, Trade License, and Bank popups. Each
 * helper strips XSS angle brackets and SQL-injection signatures, then
 * enforces a per-field-type charset and length cap, returning the
 * cleaned value along with a context-aware error message when input
 * was modified. The Field component renders the error inline. */
const VENDOR_KYC_SQL_RE = /(\bOR\b\s+\d+\s*=\s*\d+|--|;\s*(?:DROP|DELETE|INSERT|UPDATE|TRUNCATE|ALTER)\b|\bUNION\s+SELECT\b|javascript:|\bon\w+\s*=)/gi;

type SanitizeResult = { cleaned: string; error?: string };

const stripXssAndSql = (raw: string): { cleaned: string; afterAngles: string; afterSql: string } => {
  const afterAngles = raw.replace(/[<>]/g, '');
  const afterSql = afterAngles.replace(VENDOR_KYC_SQL_RE, '');
  return { cleaned: afterSql, afterAngles, afterSql };
};

/* Name-like fields — DD Document Name, KYC Document Name, Issuing
 * Authority, Bank Name. Allows letters, digits, spaces, and the basic
 * punctuation real names use (. , - ( ) & / ' %). */
const VENDOR_NAME_INVALID_RE = /[^A-Za-z0-9\s\-.,()&/'%]/g;
const sanitizeKycName = (raw: string, maxLen = 120): SanitizeResult => {
  const { cleaned: stripped, afterAngles, afterSql } = stripXssAndSql(raw);
  let cleaned = stripped.replace(VENDOR_NAME_INVALID_RE, '');
  if (cleaned.length > maxLen) cleaned = cleaned.slice(0, maxLen);
  if (cleaned === raw) return { cleaned };
  let error: string;
  if (afterAngles !== raw)          error = 'HTML characters (< or >) are not allowed';
  else if (afterSql !== afterAngles) error = 'SQL-like patterns are not allowed';
  else                              error = "Use letters, numbers, spaces, and . , - ( ) & / ' % only";
  return { cleaned, error };
};

/* Identifier fields — Document Number, License Number. These are
 * machine-readable codes like PAN (AABCT1234F), FSSAI (10019011000123),
 * Aadhaar masks; allow letters, digits, hyphens, and slashes only. */
const VENDOR_ID_INVALID_RE = /[^A-Za-z0-9\-/]/g;
const sanitizeKycId = (raw: string, maxLen = 40): SanitizeResult => {
  const { cleaned: stripped, afterAngles, afterSql } = stripXssAndSql(raw);
  let cleaned = stripped.replace(VENDOR_ID_INVALID_RE, '');
  if (cleaned.length > maxLen) cleaned = cleaned.slice(0, maxLen);
  if (cleaned === raw) return { cleaned };
  let error: string;
  if (afterAngles !== raw)          error = 'HTML characters (< or >) are not allowed';
  else if (afterSql !== afterAngles) error = 'SQL-like patterns are not allowed';
  else                              error = 'Only letters, digits, hyphens and slashes are allowed';
  return { cleaned, error };
};

/* Alphabetic-only fields — Bank Branch, City, Contact Person Name.
 * Letters + spaces, plus the few punctuation marks real values use
 * (e.g. "M.G. Road", "St. Louis", "Mr. Rahul Sharma"). */
const VENDOR_ALPHA_INVALID_RE = /[^A-Za-z\s.,'-]/g;
const sanitizeKycAlpha = (raw: string, maxLen = 60): SanitizeResult => {
  const cleaned = raw.replace(VENDOR_ALPHA_INVALID_RE, '').slice(0, maxLen);
  if (cleaned === raw) return { cleaned };
  return { cleaned, error: 'Only alphabetic characters are allowed' };
};

/* Designation — same alphabet base, plus `/` for combined titles
 * (e.g. "CEO/Director", "Sr. Manager - Ops"). */
const VENDOR_DESIGNATION_INVALID_RE = /[^A-Za-z\s.,'/-]/g;
const sanitizeKycDesignation = (raw: string, maxLen = 60): SanitizeResult => {
  const cleaned = raw.replace(VENDOR_DESIGNATION_INVALID_RE, '').slice(0, maxLen);
  if (cleaned === raw) return { cleaned };
  return { cleaned, error: 'Only letters, spaces, and . , - / are allowed' };
};

/* Address — broader charset than a name (plot numbers, flat numbers
 * etc. include `#` and `/`), but still no `<` / `>` / SQL signatures.
 * Allows letters, digits, spaces, and . , - ( ) & / ' # %. */
const VENDOR_ADDRESS_INVALID_RE = /[^A-Za-z0-9\s\-.,()&/'#%]/g;
const sanitizeKycAddress = (raw: string, maxLen = 200): SanitizeResult => {
  const { cleaned: stripped, afterAngles, afterSql } = stripXssAndSql(raw);
  let cleaned = stripped.replace(VENDOR_ADDRESS_INVALID_RE, '');
  if (cleaned.length > maxLen) cleaned = cleaned.slice(0, maxLen);
  if (cleaned === raw) return { cleaned };
  let error: string;
  if (afterAngles !== raw)          error = 'HTML characters (< or >) are not allowed';
  else if (afterSql !== afterAngles) error = 'SQL-like patterns are not allowed';
  else                              error = "Use letters, numbers, spaces, and . , - ( ) & / ' # % only";
  return { cleaned, error };
};

/* Expiry — MM/YYYY or N/A. As the user types, only digits, slash,
 * and N/A letters survive. 7-char cap (MM/YYYY length). Save-time
 * format validation is left to the parent saver — this just blocks
 * the obviously-invalid keystrokes that the screenshots called out
 * (random text, special characters). */
const VENDOR_EXPIRY_INVALID_RE = /[^0-9NA/]/gi;
const sanitizeKycExpiry = (raw: string): SanitizeResult => {
  let cleaned = raw.replace(VENDOR_EXPIRY_INVALID_RE, '');
  if (cleaned.length > 7) cleaned = cleaned.slice(0, 7);
  if (cleaned === raw) return { cleaned };
  return { cleaned, error: 'Enter MM/YYYY (e.g. 12/2026) or N/A' };
};

/* Back-compat alias — earlier turn introduced sanitizeDdDocName and the
 * DdAddPopup body still references it. Wire it to the new generic. */
const sanitizeDdDocName = (raw: string) => sanitizeKycName(raw, 120);
const DD_DOC_NAME_MAX = 120;

function DdAddPopup(props: {
  nextCodePreview: string;
  draft: DdAddPopupDraft;
  setDraft: Setter<DdAddPopupDraft>;
  onClose: () => void;
  onSave: () => void;
}) {
  const { draft, setDraft, onClose, onSave, nextCodePreview } = props;
  const set = <K extends keyof typeof draft>(k: K, v: typeof draft[K]) => setDraft({ ...draft, [k]: v });
  const [errors, setErrors] = useState<{ documentName?: string; issuingAuthority?: string; expiry?: string }>({});
  const handleDocNameChange = (raw: string) => {
    const { cleaned, error } = sanitizeDdDocName(raw);
    setDraft({ ...draft, documentName: cleaned });
    setErrors(prev => ({ ...prev, documentName: error }));
  };
  const handleAuthorityChange = (raw: string) => {
    const { cleaned, error } = sanitizeKycName(raw, 120);
    setDraft({ ...draft, issuingAuthority: cleaned });
    setErrors(prev => ({ ...prev, issuingAuthority: error }));
  };
  const handleExpiryChange = (raw: string) => {
    const { cleaned, error } = sanitizeKycExpiry(raw);
    setDraft({ ...draft, expiry: cleaned });
    setErrors(prev => ({ ...prev, expiry: error }));
  };
  return (
    <PopupShell title="Add Due Diligence Document" icon="ri-file-text-line" onClose={onClose} onSave={onSave}>
      <div className="avm-grid-2">
        <Field label="Auto Code">
          <input className="avm-input" value={nextCodePreview} readOnly style={{ color: '#d97706', fontFamily: 'monospace', fontWeight: 600 }} />
        </Field>
        <Field label="DD Document Name" required error={errors.documentName}>
          <input
            className="avm-input"
            placeholder="e.g. Memorandum of Association"
            value={draft.documentName}
            maxLength={DD_DOC_NAME_MAX}
            onChange={e => handleDocNameChange(e.target.value)}
          />
        </Field>
      </div>
      <div className="avm-grid-2">
        <Field label="Issuing Authority" required error={errors.issuingAuthority}>
          <input
            className="avm-input"
            placeholder="e.g. Registrar of Companies (ROC)"
            value={draft.issuingAuthority}
            maxLength={120}
            onChange={e => handleAuthorityChange(e.target.value)}
          />
        </Field>
        <Field label="Expiry" error={errors.expiry}>
          <input
            className="avm-input"
            placeholder="MM/YYYY or N/A"
            value={draft.expiry}
            maxLength={7}
            onChange={e => handleExpiryChange(e.target.value)}
          />
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
  const [errors, setErrors] = useState<{ documentName?: string; issuingAuthority?: string; documentNumber?: string; expiry?: string }>({});
  const handleDocNameChange = (raw: string) => {
    const { cleaned, error } = sanitizeKycName(raw, 120);
    setDraft({ ...draft, documentName: cleaned });
    setErrors(prev => ({ ...prev, documentName: error }));
  };
  const handleAuthorityChange = (raw: string) => {
    const { cleaned, error } = sanitizeKycName(raw, 120);
    setDraft({ ...draft, issuingAuthority: cleaned });
    setErrors(prev => ({ ...prev, issuingAuthority: error }));
  };
  const handleDocNumberChange = (raw: string) => {
    const { cleaned, error } = sanitizeKycId(raw, 40);
    setDraft({ ...draft, documentNumber: cleaned });
    setErrors(prev => ({ ...prev, documentNumber: error }));
  };
  const handleExpiryChange = (raw: string) => {
    const { cleaned, error } = sanitizeKycExpiry(raw);
    setDraft({ ...draft, expiry: cleaned });
    setErrors(prev => ({ ...prev, expiry: error }));
  };
  return (
    <PopupShell title="Add Owner KYC Document" icon="ri-user-add-line" subtitle="Upload an identity, address, or compliance document for the owner" onClose={onClose} onSave={onSave}>
      <div className="avm-grid-2">
        <Field label="Auto Code">
          <input className="avm-input" value={nextCodePreview} readOnly style={{ color: '#d97706', fontFamily: 'monospace', fontWeight: 600 }} />
        </Field>
        <Field label="KYC Document Name" required error={errors.documentName}>
          <input
            className="avm-input"
            placeholder="e.g. PAN Card, Aadhaar Card, Passport"
            value={draft.documentName}
            maxLength={120}
            onChange={e => handleDocNameChange(e.target.value)}
          />
        </Field>
      </div>
      <div className="avm-grid-2">
        <Field label="Issuing Authority" required error={errors.issuingAuthority}>
          <input
            className="avm-input"
            placeholder="e.g. Income Tax Department"
            value={draft.issuingAuthority}
            maxLength={120}
            onChange={e => handleAuthorityChange(e.target.value)}
          />
        </Field>
        <Field label="Document Number" error={errors.documentNumber}>
          <input
            className="avm-input"
            placeholder="e.g. AABCT1234F"
            value={draft.documentNumber}
            maxLength={40}
            onChange={e => handleDocNumberChange(e.target.value)}
          />
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
        <Field label="Expiry" error={errors.expiry}>
          <input
            className="avm-input"
            placeholder="MM/YYYY or N/A"
            value={draft.expiry}
            maxLength={7}
            onChange={e => handleExpiryChange(e.target.value)}
          />
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
  const [errors, setErrors] = useState<{ licenseNumber?: string; issuingAuthority?: string }>({});
  const handleLicenseNumberChange = (raw: string) => {
    const { cleaned, error } = sanitizeKycId(raw, 40);
    setDraft({ ...draft, licenseNumber: cleaned });
    setErrors(prev => ({ ...prev, licenseNumber: error }));
  };
  const handleAuthorityChange = (raw: string) => {
    const { cleaned, error } = sanitizeKycName(raw, 120);
    setDraft({ ...draft, issuingAuthority: cleaned });
    setErrors(prev => ({ ...prev, issuingAuthority: error }));
  };
  return (
    <PopupShell title="Add Trade License" icon="ri-file-list-3-line" subtitle="Register a regulatory license, certification, or trade authorization" onClose={onClose} onSave={onSave}>
      <div className="avm-grid-2">
        <Field label="License Type" required>
          {typeOpts.length > 0
            ? <SelectInput value={draft.licenseType} onChange={v => set('licenseType', v)} placeholder="Select License Type" options={typeOpts} />
            : <input className="avm-input" placeholder="e.g. FSSAI License" value={draft.licenseType} onChange={e => set('licenseType', e.target.value)} />}
        </Field>
        <Field label="License Number" required error={errors.licenseNumber}>
          <input
            className="avm-input"
            placeholder="e.g. 10019011000123"
            value={draft.licenseNumber}
            maxLength={40}
            onChange={e => handleLicenseNumberChange(e.target.value)}
          />
        </Field>
      </div>
      <div className="avm-grid-3">
        <Field label="Issuing Authority" required error={errors.issuingAuthority}>
          <input
            className="avm-input"
            placeholder="e.g. FSSAI, Govt. of India"
            value={draft.issuingAuthority}
            maxLength={120}
            onChange={e => handleAuthorityChange(e.target.value)}
          />
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
  const [errors, setErrors] = useState<{ bankName?: string; branchName?: string; branchAddress?: string }>({});
  const handleBankNameChange = (raw: string) => {
    const { cleaned, error } = sanitizeKycName(raw, 80);
    setDraft({ ...draft, bankName: cleaned });
    setErrors(prev => ({ ...prev, bankName: error }));
  };
  const handleBranchChange = (raw: string) => {
    const { cleaned, error } = sanitizeKycAlpha(raw, 60);
    setDraft({ ...draft, branchName: cleaned });
    setErrors(prev => ({ ...prev, branchName: error }));
  };
  const handleBranchAddressChange = (raw: string) => {
    const { cleaned, error } = sanitizeKycAddress(raw, 200);
    setDraft({ ...draft, branchAddress: cleaned });
    setErrors(prev => ({ ...prev, branchAddress: error }));
  };
  return (
    <PopupShell title="Add Bank Details" icon="ri-bank-line" onClose={onClose} onSave={onSave}>
      <div className="avm-grid-4">
        <Field label="Bank Name" required error={errors.bankName}>
          <input
            className="avm-input"
            placeholder="Enter bank name"
            value={draft.bankName}
            maxLength={80}
            onChange={e => handleBankNameChange(e.target.value)}
          />
        </Field>
        <Field label="Branch" required error={errors.branchName}>
          <input
            className="avm-input"
            placeholder="Enter branch"
            value={draft.branchName}
            maxLength={60}
            onChange={e => handleBranchChange(e.target.value)}
          />
        </Field>
        <Field label="Account Number" required>
          <input className="avm-input" placeholder="Enter account number" value={draft.accountNumber} onChange={e => set('accountNumber', e.target.value)} />
        </Field>
        <Field label="IFSC Code" required>
          <input className="avm-input" placeholder="Enter IFSC code" value={draft.ifsc} onChange={e => set('ifsc', e.target.value.toUpperCase())} />
        </Field>
      </div>
      <div className="avm-grid-2">
        <Field label="Branch Address" error={errors.branchAddress}>
          <input
            className="avm-input"
            placeholder="Enter branch address"
            value={draft.branchAddress}
            maxLength={200}
            onChange={e => handleBranchAddressChange(e.target.value)}
          />
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
  const [errors, setErrors] = useState<{ gstNumber?: string; prevNonGst2aInvoice?: string; redFlags?: string }>({});
  /* GST number is strictly alphanumeric (15 chars: 27AADCI6120M1ZH style).
   * Strip everything else and uppercase; backend still validates the full
   * regex, this just keeps obvious garbage out of the picker. */
  const handleGstNumberChange = (raw: string) => {
    const cleaned = raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 15);
    set('gstNumber', cleaned);
    if (cleaned !== raw.toUpperCase().slice(0, 15)) {
      setErrors(prev => ({ ...prev, gstNumber: 'Only letters and digits (e.g. 27AADCI6120M1ZH)' }));
    } else {
      setErrors(prev => ({ ...prev, gstNumber: undefined }));
    }
  };
  const handlePrevInvoiceChange = (raw: string) => {
    const { cleaned, error } = sanitizeKycId(raw, 50);
    set('prevNonGst2aInvoice', cleaned);
    setErrors(prev => ({ ...prev, prevNonGst2aInvoice: error }));
  };
  /* Red Flags is free-form prose — explanation text like "GSTR-1 not filed
   * for Q3 2024". Strip XSS/SQL but keep the broader address-style
   * charset so the user can type sentences naturally. */
  const handleRedFlagsChange = (raw: string) => {
    const { cleaned, error } = sanitizeKycAddress(raw, 300);
    set('redFlags', cleaned);
    setErrors(prev => ({ ...prev, redFlags: error }));
  };
  return (
    <PopupShell title="Add GST Scrutiny" icon="ri-file-text-line" tone="amber" onClose={onClose} onSave={onSave}>
      <div className="avm-grid-3">
        <Field label="GST Number" required error={errors.gstNumber}>
          <input
            className="avm-input"
            placeholder="Enter GST number"
            value={draft.gstNumber}
            maxLength={15}
            onChange={e => handleGstNumberChange(e.target.value)}
          />
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
        <Field label="Previous Non-GST 2A Reflected Invoice" error={errors.prevNonGst2aInvoice}>
          <input
            className="avm-input"
            placeholder="Enter invoice reference (optional)"
            value={draft.prevNonGst2aInvoice}
            maxLength={50}
            onChange={e => handlePrevInvoiceChange(e.target.value)}
          />
        </Field>
        <Field label="Red Flags" error={errors.redFlags}>
          <input
            className="avm-input"
            placeholder="Enter red flags (optional)"
            value={draft.redFlags}
            maxLength={300}
            onChange={e => handleRedFlagsChange(e.target.value)}
          />
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
  background: rgba(49, 22, 99, .42);
  backdrop-filter: blur(3px);
  display: flex; align-items: flex-start; justify-content: center;
  padding: 24px 20px;
  overflow-y: auto;
  font-family: var(--font-sans);
}
.avm-modal {
  width: 100%; max-width: 1200px;
  max-height: calc(100vh - 48px);
  margin: auto;
  background: #fff;
  border-radius: 18px;
  /* Soft white frame so the modal (and the purple header's top edge) reads
     as a bordered card — like the Add Customer modal, but no dotted texture. */
  border: 1.5px solid rgba(255, 255, 255, .65);
  overflow: hidden;
  display: flex; flex-direction: column;
  box-shadow: 0 30px 80px rgba(15, 23, 42, .45);
  color: #1e1b4b;
}
.avm-modal *, .avm-modal *::before, .avm-modal *::after { box-sizing: border-box; }

/* Header — purple gradient bar (.sf-head spec from the Figma) with a
   subtle white hairline border so the bar reads as a framed strip. */
.avm-head {
  display: flex; align-items: center; justify-content: space-between; gap: 14px;
  padding: 14px 22px;
  position: relative; overflow: hidden;
  background: linear-gradient(115deg, #4c1d95 0%, #5b21b6 28%, #6d28d9 55%, #7c3aed 80%, #8b5cf6 100%);
  color: #fff;
  border-bottom: 1px solid rgba(255, 255, 255, .22);
  box-shadow: inset 0 2px 0 rgba(255, 255, 255, .35);
}
.avm-head-left { display: flex; align-items: center; gap: 12px; min-width: 0; }
.avm-head-icon {
  width: 38px; height: 38px; border-radius: 11px; flex-shrink: 0;
  background: rgba(255,255,255,.18);
  border: 1px solid rgba(255,255,255,.25);
  display: flex; align-items: center; justify-content: center;
}
.avm-title { font-size: 15.5px; font-weight: 600; letter-spacing: -0.01em; }
.avm-sub   { font-size: 11px; font-weight: 400; color: rgba(255,255,255,.85); margin-top: 1px; }
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
/* Stepper, body and footer share ONE continuous light-lavender surface so
   the modal reads as a single sheet (Figma) — the white section cards float
   on top. No dividing band between the stepper and the form. */
.avm-stepper-wrap { padding: 12px 18px; background: #f5f2fc; }
.avm-stepper { display: flex; align-items: stretch; gap: 0; flex-wrap: wrap; }

/* Step card — matches the Figma two-card stepper: icon chip with a small
   number badge, title + sub, and a status pill pushed to the right. */
.avm-step {
  flex: 1; min-width: 240px;
  display: flex; align-items: center; gap: 12px;
  padding: 10px 14px;
  background: #fff; border: 1.5px solid #ece7f8; border-radius: 14px;
  box-shadow: 0 1px 3px rgba(124,58,237,.05);
  transition: border-color .15s, background .15s, box-shadow .15s;
}
.avm-step-ico {
  position: relative; width: 40px; height: 40px; border-radius: 12px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center; color: #fff;
  background: linear-gradient(135deg, #c4b5fd, #a78bfa);
  box-shadow: 0 4px 10px rgba(124,58,237,.25);
}
.avm-step-ico i { font-size: 18px; line-height: 1; }
.avm-step-ico-num {
  position: absolute; right: -4px; bottom: -4px;
  width: 17px; height: 17px; border-radius: 50%;
  background: #fff; color: #7c3aed; border: 1.5px solid #ede9fe;
  font-size: 9.5px; font-weight: 800;
  display: flex; align-items: center; justify-content: center;
}
.avm-step-text { flex: 1; min-width: 0; }
.avm-step-title { font-size: 13.5px; font-weight: 700; color: #1e1b4b; letter-spacing: -0.01em; }
.avm-step-sub   { font-size: 11px; font-weight: 500; color: #94a3b8; margin-top: 2px; }
.avm-step-badge {
  flex-shrink: 0; padding: 4px 11px; border-radius: 99px;
  font-size: 9.5px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase;
}
.avm-step-badge-active { background: linear-gradient(135deg, #8b5cf6, #7c3aed); color: #fff; box-shadow: 0 3px 8px rgba(124,58,237,.4); }
.avm-step-badge-done   { background: linear-gradient(135deg, #22c55e, #16a34a); color: #fff; box-shadow: 0 3px 8px rgba(22,163,74,.35); }

/* Active card — purple wash + glow (universal, regardless of tone) */
.avm-step-active {
  border-color: #c4b5fd;
  background: linear-gradient(135deg, #faf5ff, #f3e8ff);
  box-shadow: 0 6px 18px rgba(124,58,237,.14);
}
.avm-step-active .avm-step-ico { background: linear-gradient(135deg, #8b5cf6, #7c3aed, #5b21b6); box-shadow: 0 4px 12px rgba(124,58,237,.45); }

/* Completed card — green wash + green check chip */
.avm-step-done {
  border-color: #bbf7d0;
  background: linear-gradient(135deg, #f0fdf4, #dcfce7);
}
.avm-step-done .avm-step-ico { background: linear-gradient(135deg, #22c55e, #16a34a); box-shadow: 0 4px 12px rgba(22,163,74,.4); }
.avm-step-done .avm-step-ico i { font-size: 22px; }
.avm-step-done .avm-step-title { color: #15803d; }
.avm-step-done .avm-step-sub   { color: #4d9e6a; }

/* Connector — short line between cards (the › glyph is hidden via font-size:0) */
.avm-step-arrow { flex: 0 0 26px; align-self: center; height: 2px; background: #ddd6fe; font-size: 0; border-radius: 2px; }

/* Body — plain white surface like the Client / Master forms */
.avm-body {
  flex: 1; overflow-y: auto;
  padding: 12px 22px 14px;
  background: #f5f2fc;
  scrollbar-width: thin; scrollbar-color: #ddd6fe transparent;
  position: relative;  /* anchor for the .avm-load-overlay during edit-load */
}
.avm-body::-webkit-scrollbar { width: 8px; }
.avm-body::-webkit-scrollbar-thumb { background: #ddd6fe; border-radius: 99px; }

/* Previous-stage summary */
/* Step 2 / 3 / 4 carried-over summary header — restyled to match the
 * lavender Stage 1 vendor header (.avm-id-summary) so every read-only
 * header in the wizard reads as one component family. Previously this
 * was a green "completed" panel; design feedback wanted the same calm
 * violet palette applied across all stages. */
.avm-prev {
  background: linear-gradient(180deg, #faf5ff 0%, #f3e8ff 100%);
  border: 1px solid #e9d5ff; border-radius: 12px;
  margin-bottom: 14px; overflow: hidden;
}
.avm-prev-head {
  display: flex; align-items: center; gap: 12px;
  padding: 10px 14px;
  background: transparent;
}
.avm-prev-ico {
  width: 32px; height: 32px; border-radius: 9px; flex-shrink: 0;
  background: linear-gradient(135deg, #8b5cf6, #7c3aed); color: #fff;
  display: inline-flex; align-items: center; justify-content: center; font-size: 16px;
  box-shadow: 0 3px 9px rgba(124,58,237,.35);
}
.avm-prev-headtext { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.avm-prev-title { font-size: 13px; font-weight: 700; color: #3b0764; letter-spacing: -0.01em; }
.avm-prev-subtitle { font-size: 10.5px; font-weight: 500; color: #7c3aed; }
.avm-prev-toggle {
  flex-shrink: 0;
  display: inline-flex; align-items: center; gap: 4px;
  height: 30px; padding: 0 8px 0 14px;
  background: linear-gradient(135deg, #8b5cf6, #7c3aed); border: none; color: #fff;
  border-radius: 99px; font-family: inherit; font-size: 11.5px; font-weight: 700; cursor: pointer;
  box-shadow: 0 3px 9px rgba(124,58,237,.4);
  transition: filter .15s, box-shadow .15s;
}
.avm-prev-toggle i { font-size: 17px; }
.avm-prev-toggle:hover { filter: brightness(1.06); box-shadow: 0 5px 13px rgba(124,58,237,.5); }
.avm-prev-body { padding: 14px 18px 16px; display: flex; flex-direction: column; gap: 13px; border-top: 1px solid rgba(196,181,253,.4); }
/* Step-grouped summary — each stage's label uses the same muted violet
 * tone so the header reads as a single block rather than several panels
 * fighting for attention. */
.avm-prev-stage { display: flex; flex-direction: column; gap: 8px; }
.avm-prev-stage + .avm-prev-stage { margin-top: 6px; padding-top: 10px; border-top: 1px dashed rgba(196,181,253,.55); }
.avm-prev-stage-label {
  font-size: 10.5px; font-weight: 700; letter-spacing: .08em;
  color: #6d28d9;
  display: inline-flex; align-items: center;
  text-transform: uppercase;
}
.avm-prev-stage.tone-violet .avm-prev-stage-label,
.avm-prev-stage.tone-teal   .avm-prev-stage-label,
.avm-prev-stage.tone-purple .avm-prev-stage-label { color: #6d28d9; }

/* Switch the per-stage rows from flex-wrap to the same 4-column grid
 * used by .avm-id-summary-row, so labels and values line up cleanly
 * across stages — matches the Stage 1 screenshot exactly. */
.avm-prev-rows { display: flex; flex-direction: column; gap: 13px; }
.avm-prev-row {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  column-gap: 28px;
  row-gap: 13px;
  align-items: baseline;
}
.avm-prev-pair {
  display: flex; align-items: baseline; gap: 6px;
  font-size: 12px; line-height: 1.4;
  min-width: 0;
  cursor: default; padding: 1px 2px; border-radius: 4px;
  transition: background .12s;
}
.avm-prev-pair:hover { background: rgba(124,58,237,0.06); }
.avm-prev-k {
  font-size: 12px; font-weight: 600; letter-spacing: .01em;
  color: #64748b; text-transform: uppercase;
  white-space: nowrap; flex-shrink: 0;
}
.avm-prev-v {
  font-weight: 600; color: #6d28d9; line-height: 1.4;
  min-width: 0; flex: 1 1 auto;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.avm-prev-link {
  font-weight: 600; color: #6d28d9; text-decoration: underline;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  min-width: 0; flex: 1 1 auto;
}
.avm-prev-link:hover { color: #4c1d95; }
.avm-prev-suffix {
  font-size: 11px; color: #64748b; font-weight: 500;
}
@media (max-width: 900px) {
  .avm-prev-row { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}

/* Tabs */
.avm-tabs {
  display: flex; gap: 4px; margin-bottom: 14px;
  border-bottom: 1.5px solid #e2d4fa;
}
.avm-tab {
  background: none; border: none; padding: 10px 16px;
  font-family: inherit; font-size: 13px; font-weight: 500;
  color: #94a3b8; cursor: pointer;
  border-bottom: 2.5px solid transparent;
  margin-bottom: -1.5px;
  transition: color .15s, border-color .15s;
}
.avm-tab:hover { color: #7c3aed; }
.avm-tab.on { color: #7c3aed; border-bottom-color: #7c3aed; font-weight: 600; }

/* Pill tabs (Step 2 sub-tabs) */
/* Sub-tab strip (Figma): a light lavender container; only the ACTIVE tab is a
   purple gradient pill, inactive tabs are plain muted text. Scoped under
   .avm-pill-tabs so it doesn't collide with the table status .avm-pill badges. */
.avm-pill-tabs {
  display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 14px;
  padding: 5px;
  background: #f3eefc;
  border: 1px solid #e9e2f7;
  border-radius: 12px;
}
.avm-pill-tabs .avm-pill {
  display: inline-flex; align-items: center;
  background: transparent; color: #6b7280;
  border: none; border-radius: 9px;
  padding: 8px 16px; font-family: inherit; font-size: 12.5px; font-weight: 600; cursor: pointer; line-height: 1.2;
  transition: background .15s, color .15s, box-shadow .15s;
}
.avm-pill-tabs .avm-pill:hover { background: rgba(124,58,237,.08); color: #6d28d9; }
.avm-pill-tabs .avm-pill.on {
  color: #fff;
  background: linear-gradient(135deg, #8b5cf6, #7c3aed, #5b21b6);
  border: none;
  box-shadow: 0 4px 12px rgba(124, 58, 237, .42);
}
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
  position: relative;
  background: #fff;
  border: 1px solid #ece4fb;
  border-radius: 12px; margin-bottom: 8px; overflow: hidden;
}
/* Left accent strip — a vertical GRADIENT bar (Figma), not a flat border. */
.avm-section::before {
  content: '';
  position: absolute; left: 0; top: 0; bottom: 0;
  width: 4px; opacity: .85;
  background: linear-gradient(180deg, #a78bfa, #7c3aed, #5b21b6);
}
/* All section strips use the same purple gradient (.avm-section::before).
   Only the outer border tint + icon/title colour vary per section. */
.avm-section-violet { border-color: #ece4fb; }
.avm-section-amber  { border-color: #fbeccb; }
.avm-section-teal   { border-color: #cdf6f1; }
.avm-section-green  { border-color: #d6f5df; }
.avm-section-purple { border-color: #ece4fb; }

.avm-section-head {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 9px 14px;
  background: #fff;
  border-bottom: 1px solid #f1ecfb;
}
/* Subtle tinted section heads — keep the coloured left-border accent but
   use a near-white head so it doesn't fight the white form surface. */
/* Section header sits on the same white as the body (seamless card, like the
   Figma) — separated only by the thin divider line from .avm-section-head. */
.avm-section-amber .avm-section-head { border-bottom-color: #fef3c7; }
.avm-section-teal  .avm-section-head { border-bottom-color: #ccfbf1; }
.avm-section-green .avm-section-head { border-bottom-color: #dcfce7; }
.avm-section-head-left { display: flex; align-items: center; gap: 10px; }
.avm-section-icon {
  width: 28px; height: 28px; border-radius: 8px;
  display: flex; align-items: center; justify-content: center;
  font-size: 15px; border: 1px solid transparent;
}
.avm-section-violet .avm-section-icon { background: #f5f1fe; color: #7c3aed; border-color: #e2d4fa; }
.avm-section-amber  .avm-section-icon { background: #fffbeb; color: #d97706; border-color: #fde68a; }
.avm-section-teal   .avm-section-icon { background: #f0fdfa; color: #0d9488; border-color: #99f6e4; }
.avm-section-green  .avm-section-icon { background: #f0fdf4; color: #16a34a; border-color: #bbf7d0; }
.avm-section-purple .avm-section-icon { background: #f5f1fe; color: #7c3aed; border-color: #e2d4fa; }
.avm-section-headtext { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; min-width: 0; }
.avm-section-title { font-size: 11px; font-weight: 600; color: #5b21b6; letter-spacing: 0.02em; text-transform: uppercase; }
.avm-section-sub   { font-size: 10.5px; font-weight: 500; color: #a78bfa; letter-spacing: 0; }
.avm-section-sub::before { content: '|'; margin-right: 7px; color: #c4b5fd; font-weight: 600; }
/* Amber section keeps its amber icon, but the title + subtitle use the same
   purple as every other section heading (user request). */
.avm-section-body { padding: 10px 14px 12px; display: flex; flex-direction: column; gap: 8px; }

.avm-section-add-btn {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 7px 14px; border-radius: 8px;
  background: linear-gradient(120deg, #7c3aed 0%, #a78bfa 100%); color: #fff; border: none;
  font-family: inherit; font-size: 12px; font-weight: 500; cursor: pointer;
  transition: transform .12s, box-shadow .15s;
}
.avm-section-add-btn:hover { transform: translateY(-1px); box-shadow: 0 4px 12px rgba(124,58,237,.35); }

/* "N documents" count badge on the KYC section header (Figma) */
.avm-doc-count {
  display: inline-flex; align-items: center;
  padding: 5px 13px; border-radius: 99px;
  background: #f5f1fe; color: #6d28d9;
  border: 1px solid #e2d4fa;
  font-size: 11.5px; font-weight: 700; white-space: nowrap;
}

/* Form */
.avm-grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 18px; }
.avm-grid-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px 18px; }
.avm-grid-4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px 18px; }

.avm-field { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
/* Labels match the Client / Recruitment master forms: small, uppercase,
   modest letter-spacing, navy color, lighter weight (500) so the
   surrounding form chrome doesn't shout at the user. */
.avm-field-label {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 12px; font-weight: 500;
  letter-spacing: 0; text-transform: none;
  color: #1e293b;
  margin-bottom: 3px;
}
[data-bs-theme="dark"] .avm-field-label,
[data-layout-mode="dark"] .avm-field-label { color: #c4b5fd; }
.avm-req { color: #f06548; font-weight: 600; margin-left: 1px; }
/* Inline quick-add (+) buttons — let the user add a new master entry
   (Risk Level / Supplier Behaviour / Segment / Compliance / Country)
   without leaving the form. */
.avm-field-plus {
  width: 18px; height: 18px;
  border: none; border-radius: 5px;
  background: #7c3aed; color: #fff;
  font-size: 14px; font-weight: 500; line-height: 1; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
}
/* Inputs — mirror .master-modal .form-control from masterFormKit so the
   wizard reads as part of the same form family as Clients / Recruitment.
   Subtle blue-tinted surface, indigo focus ring, 10px radius. */
.avm-input {
  height: 32px; width: 100%;
  padding: 5px 11px;
  border: 1px solid color-mix(in srgb, #a78bfa 20%, var(--vz-border-color, #e9ebec));
  border-radius: 10px;
  background: color-mix(in srgb, #a78bfa 5%, var(--vz-card-bg, #fff));
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
  font-size: 13px !important;   /* one uniform placeholder size everywhere */
}
.avm-input:hover:not(:disabled):not([readonly]) {
  border-color: rgba(124,58,237,0.55);
  box-shadow: 0 2px 6px rgba(124,58,237,0.08);
}
.avm-input:focus {
  background: var(--vz-card-bg, #fff);
  border-color: #7c3aed;
  box-shadow: 0 0 0 3px rgba(124,58,237,0.15), 0 4px 12px rgba(124,58,237,0.12);
}
[data-bs-theme="dark"] .avm-input,
[data-layout-mode="dark"] .avm-input {
  background: color-mix(in srgb, #a78bfa 12%, var(--vz-card-bg));
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
  min-height: 32px !important; height: 32px;
  /* Right padding trimmed 32px -> 12px: the chevron is a flex item pushed to
     the right by the toggle's space-between, so the extra 32px right padding
     was holding it ~20px in from the edge, making it look centred. 12px sits
     it flush near the right edge like a normal select. */
  padding: 0 12px !important;
  font-size: 13px !important;
  background: var(--vz-card-bg, #fff) !important;
  border: 1px solid var(--vz-border-color, #e9ebec) !important;
  border-radius: 6px !important;
  color: var(--vz-body-color, #495057) !important;
}
.avm-master-select .master-select-wrap.show .master-select-toggle {
  border-color: #7c3aed !important;
  box-shadow: 0 0 0 3px rgba(124,58,237,.15) !important;
}

/* Radios */
.avm-radio-row { display: inline-flex; align-items: center; gap: 16px; height: 32px; }
.avm-radio { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; color: #1e1b4b; cursor: pointer; }
.avm-radio input { width: 16px; height: 16px; accent-color: #7c3aed; }
/* Dark-theme: navy text turns invisible on the modal's dark background.
 * Lift Yes / No labels to a high-contrast off-white and tint the radio
 * accent to the indigo used elsewhere in the wizard. */
[data-bs-theme="dark"] .avm-radio { color: #ede9fe; }
[data-bs-theme="dark"] .avm-radio input { accent-color: #a78bfa; }

/* File chooser — same chrome as the inputs, dashed border to signal upload */
.avm-filechooser {
  position: relative;
  height: 32px; padding: 0 8px 0 12px;
  border: 1px dashed var(--vz-border-color, #e9ebec); border-radius: 8px;
  background: var(--vz-card-bg, #fff); color: #6b7280;
  display: inline-flex; align-items: center; gap: 8px;
  font-size: 12.5px; font-weight: 500; cursor: pointer;
  width: 100%;
}
.avm-filechooser:hover { border-color: #7c3aed; }
.avm-filechooser-input { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
.avm-filechooser-icon { color: #7c3aed; font-size: 15px; flex-shrink: 0; }
.avm-filechooser-text {
  flex: 1; min-width: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  color: #1e1b4b;
}
/* Filename as a link — applies the indigo affordance only when a
   view URL exists (fresh blob or hydrated server path). Clicking
   the name opens the file in a new tab, same as the 👁 button. */
.avm-filechooser-link {
  color: #6d28d9;
  text-decoration: underline;
  text-decoration-color: rgba(124, 58, 237, .35);
  text-underline-offset: 2px;
  cursor: pointer;
}
.avm-filechooser-link:hover {
  color: #5b21b6;
  text-decoration-color: #6d28d9;
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
  border: 1px solid #ddd6fe;
  background: #faf5ff;
}
.avm-filechooser.avm-filechooser-has-file:hover { border-color: #a78bfa; }
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
  background: rgba(124, 58, 237, .10);
  border-color: #7c3aed;
  color: #7c3aed;
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
  background: rgba(124, 58, 237, .18); border-color: #a78bfa; color: #ddd6fe;
}
[data-bs-theme="dark"] .avm-fc-delete:hover {
  background: rgba(248, 113, 113, .18); border-color: #f87171; color: #fecaca;
}

/* Extra contact rows */
.avm-extra-contacts { display: flex; flex-direction: column; gap: 12px; }
.avm-extra-contact { padding: 10px 12px; border: 1px solid #e2e8f0; border-radius: 10px; background: #f8fafc; }
.avm-extra-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; font-size: 12px; color: #7c3aed; }
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
.avm-doctable-count { font-size: 12px; color: #7c3aed; font-weight: 700; }

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
  /* Theme-adaptive — was hardcoded #495057 (dark text), which on the modal's
     dark surface in dark mode rendered the KYC cell text nearly invisible.
     var(--vz-body-color) is dark in light mode and light in dark mode, so the
     cells stay readable in BOTH without depending on theme-prefixed overrides. */
  color: var(--vz-body-color, #495057);
  padding: 10px 12px;
  vertical-align: middle;
  border-top: 1px solid #f3f4f6;
}
.avm-modal .table tbody td strong {
  font-weight: 600;
  /* was #1e293b (near-black) — invisible on the dark modal. Emphasis colour
     adapts per theme (near-black in light, near-white in dark). */
  color: var(--vz-emphasis-color, var(--vz-heading-color, #1e293b));
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
  background: rgba(124, 58, 237, 0.10); border-color: #7c3aed; color: #7c3aed;
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
.avm-product-code { font-size: 11px; font-weight: 600; color: #7c3aed; letter-spacing: .06em; }
.avm-product-name { font-size: 13px; font-weight: 500; color: #1e1b4b; }
.avm-product-info { display: inline-flex; gap: 6px; }
.avm-product-tag { padding: 3px 9px; border-radius: 99px; background: #f5f1fe; color: #7c3aed; font-size: 10.5px; font-weight: 500; }

/* Footer */
.avm-foot {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 22px;
  background: #f5f2fc; border-top: 1px solid #e9e2f7;
}
.avm-foot-right { display: flex; align-items: center; gap: 8px; }
.avm-foot-note { display: inline-flex; align-items: center; gap: 7px; font-size: 12px; font-weight: 500; color: #64748b; }
.avm-foot-dot { width: 7px; height: 7px; border-radius: 50%; background: #7c3aed; display: inline-block; flex-shrink: 0; }
[data-bs-theme="dark"] .avm-foot-note { color: #a89fc7; }
.avm-btn-ghost, .avm-btn-outline, .avm-btn-primary {
  display: inline-flex; align-items: center; gap: 6px;
  height: 40px; padding: 0 18px;
  font-family: inherit; font-size: 13px; font-weight: 600; cursor: pointer;
  border-radius: 10px;
  transition: transform .12s, background .15s, box-shadow .15s, border-color .15s;
}
/* Cancel button — the old #e2e8f0 border was nearly invisible against
 * the modal's white surface, so the button read as a floating label.
 * Use a stronger slate border + subtle shadow so it's recognisable as
 * a clickable affordance without competing with the primary CTA. */
.avm-btn-ghost {
  background: #fff;
  border: 1.5px solid #94a3b8;
  color: #334155;
  box-shadow: 0 1px 2px rgba(15,23,42,.06);
}
.avm-btn-ghost:hover { background: #f1f5f9; border-color: #64748b; color: #1e293b; }
.avm-btn-outline { background: #fff; border: 1.5px solid #ddd6fe; color: #7c3aed; }
.avm-btn-outline:hover { background: #f5f1fe; border-color: #7c3aed; }
.avm-btn-primary {
  position: relative; overflow: hidden;
  color: #fff; border: none;
  background: linear-gradient(135deg, #8b5cf6, #7c3aed, #5b21b6);
  box-shadow: 0 6px 18px rgba(124,58,237,.5), 0 1px 0 rgba(255,255,255,.2) inset;
  text-shadow: 0 1px 2px rgba(0,0,0,.18);
}
.avm-btn-primary:hover { transform: translateY(-1px); box-shadow: 0 8px 22px rgba(124,58,237,.6), 0 1px 0 rgba(255,255,255,.2) inset; }
.avm-btn-primary:disabled { transform: none; opacity: .85; cursor: progress; box-shadow: 0 6px 18px rgba(124,58,237,.32), 0 1px 0 rgba(255,255,255,.2) inset; }

/* Inline spinner shown in Save & Next / Save Vendor while the network
 * call is in flight. Same size/curve as Bootstrap's spinner-border-sm
 * so it sits flush with the 13px button text. */
.avm-spinner {
  display: inline-block;
  width: 14px; height: 14px;
  border: 2px solid rgba(255,255,255,0.4);
  border-top-color: #fff;
  border-radius: 50%;
  animation: avm-spinner-spin .7s linear infinite;
  vertical-align: -2px;
}
@keyframes avm-spinner-spin { to { transform: rotate(360deg); } }
.avm-spinner-lg {
  width: 36px; height: 36px;
  border-width: 3px;
  border-color: rgba(124,58,237,.20);
  border-top-color: #7c3aed;
}

/* Edit-mode shimmer placeholder — shown over the form while /vendors/{id}
 * is in flight. Form-shaped skeleton bars convey "data is loading" while
 * preserving the user's mental map of the form layout (no centred modal
 * card covering the geometry). */
.avm-load-overlay {
  position: absolute;
  inset: 0;
  background: #fff;
  z-index: 5;
  overflow: hidden;
  padding: 22px 26px;
}
/* avm-load-overlay-static — used when the skeleton REPLACES the form
   (mutually-exclusive render) rather than sitting on top of it. Drops
   the absolute positioning so the skeleton flows normally inside the
   scrollable body, which guarantees full coverage regardless of body
   height or scroll offset. */
.avm-load-overlay-static {
  position: static;
  inset: auto;
  z-index: auto;
  min-height: 100%;
}
[data-bs-theme="dark"] .avm-load-overlay { background: #1c2531; }
.avm-load-skeleton { width: 100%; max-width: 1100px; display: flex; flex-direction: column; gap: 10px; }
.avm-load-grid { display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 12px; }
.avm-load-bar {
  height: 38px; border-radius: 8px;
  background: linear-gradient(90deg, #eef2f7 0%, #f8fafc 50%, #eef2f7 100%);
  background-size: 200% 100%;
  animation: avm-skel-shimmer 1.2s ease-in-out infinite;
}
.avm-load-heading { height: 18px; width: 220px; border-radius: 5px; margin-bottom: 6px; }
[data-bs-theme="dark"] .avm-load-bar {
  background: linear-gradient(90deg, #221940 0%, #1a1430 50%, #221940 100%);
  background-size: 200% 100%;
}
@keyframes avm-skel-shimmer {
  0%   { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
@media (max-width: 880px) {
  .avm-load-grid { grid-template-columns: 1fr 1fr; }
}

/* KYC table layout — Bootstrap's table-nowrap was forcing every cell
 * onto a single line, so long document names / addresses / red flags
 * would overflow the column and break the table layout. Allow text
 * cells to wrap with sane per-cell limits, but keep nowrap for the
 * status badges and the action button column so they stay aligned. */
.avm-kyc-table-wrap { overflow-x: auto; }
/* width:auto so the table hugs its content — columns sit tight together
   instead of stretching across the full card (no wasted gaps / no scroll). */
.avm-kyc-table {
  table-layout: auto;
  width: auto;
}
.avm-kyc-table th, .avm-kyc-table td {
  white-space: normal;
  word-break: break-word;
  overflow-wrap: anywhere;
  vertical-align: middle;
  max-width: 280px;
  padding: 9px 14px;
  font-size: 12px;
}
/* Tighten the inter-column rhythm: first/last cells hug the card edges. */
.avm-kyc-table th:first-child, .avm-kyc-table td:first-child { padding-left: 14px; }
.avm-kyc-table th:last-child,  .avm-kyc-table td:last-child  { padding-right: 14px; text-align: right; }
.avm-kyc-table th { white-space: nowrap; }  /* headers stay on one line */
.avm-kyc-table td .badge,
.avm-kyc-table td .avm-pill,
.avm-kyc-table td .btn,
.avm-kyc-table td .hstack,
.avm-kyc-table td .font-monospace,
/* td.font-monospace — the numeric columns (PRICE, GST %, GST AMT, TOTAL) put
   the class on the <td> itself, not a child, so the descendant selector above
   missed them and the cells inherited word-break/overflow-wrap. In a narrow
   column that broke "12.00%" so the % dropped to a second line (QA report).
   Matching the td directly keeps the value + % on one line. */
.avm-kyc-table td.font-monospace { white-space: nowrap; }
/* Action / SR / status columns stay narrow so they don't fight the
 * text columns for horizontal space. The last column is action icons
 * across every KYC table; first is the row number. */
.avm-kyc-table th:first-child, .avm-kyc-table td:first-child,
.avm-kyc-table th:last-child,  .avm-kyc-table td:last-child {
  white-space: nowrap;
  max-width: none;
  width: 1%;
}
/* Dark-mode KYC tables — cell text + row hover. The DD document name and
   plain cells rendered too dim on the modal's dark surface, and the inherited
   (Velzon/Bootstrap) row-hover background washed them out to near-invisible.
   Brighten the cell text and pin a subtle violet hover wash with readable
   white text. Pills / badges / buttons keep their own colours (they set
   their own colour on their own element, so the td colour does not override
   them); muted secondary cells also keep their muted tone. */
[data-bs-theme="dark"] .avm-kyc-table {
  --bs-table-color: #e5e7eb;
  --bs-table-bg: transparent;
  --bs-table-border-color: rgba(255,255,255,.10);
  color: #e5e7eb;
}
/* Force readable cell text (the inherited table colour was rendering as a
   faint purple on the dark gradient). !important + the strong override so the
   DD document name and plain cells are clearly visible. */
[data-bs-theme="dark"] .avm-kyc-table tbody td {
  color: #e5e7eb !important;
}
[data-bs-theme="dark"] .avm-kyc-table tbody td strong {
  color: #f5f3ff !important;
}
/* Secondary / muted cells (issuing authority, expiry, "Not uploaded") — keep
   them dimmer than the main text but still legible. */
[data-bs-theme="dark"] .avm-kyc-table tbody td .text-muted,
[data-bs-theme="dark"] .avm-kyc-table tbody td .avm-prev-v {
  color: rgba(255,255,255,.62) !important;
}
[data-bs-theme="dark"] .avm-kyc-table tbody tr:hover td {
  background-color: rgba(124,92,252,.16) !important;
  color: #ffffff !important;
}

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
[data-bs-theme="dark"] .avm-pill.on { background: linear-gradient(135deg, #7c3aed, #6d28d9); color: #fff; }
[data-bs-theme="dark"] .avm-sub-pill { background: #1a1430; border-color: #3b2a6b; color: #a89fc7; }
[data-bs-theme="dark"] .avm-sub-pill.on { background: #14241a; border-color: #14532d; color: #4ade80; }
[data-bs-theme="dark"] .avm-tabs { border-bottom-color: #3b2a6b; }
[data-bs-theme="dark"] .avm-tab { color: #6d6391; }
[data-bs-theme="dark"] .avm-tab.on { color: #c4b5fd; border-bottom-color: #a78bfa; }
[data-bs-theme="dark"] .avm-extra-contact { background: #110c25; border-color: #3b2a6b; }
[data-bs-theme="dark"] .avm-empty { background: #110c25; border-color: #3b2a6b; color: #6d6391; }
[data-bs-theme="dark"] .avm-foot { background: #14102a; border-top-color: #3b2a6b; }
[data-bs-theme="dark"] .avm-btn-ghost { background: #1a1430; border-color: #3b2a6b; color: #c4b5fd; }
/* Dark-mode hover — without this the light .avm-btn-ghost:hover rule is
   overridden by the dark base rule above (equal specificity, defined later),
   so the Cancel button showed no hover feedback in dark mode (QA report). */
[data-bs-theme="dark"] .avm-btn-ghost:hover { background: #221852; border-color: #4c1d95; color: #ede9fe; }
[data-bs-theme="dark"] .avm-btn-outline { background: #1a1430; border-color: #4c1d95; color: #c4b5fd; }
[data-bs-theme="dark"] .avm-product-row { background: #110c25; border-color: #3b2a6b; }
[data-bs-theme="dark"] .avm-product-row.on { background: #14241a; border-color: #14532d; }
[data-bs-theme="dark"] .avm-product-name { color: #ede9fe; }
[data-bs-theme="dark"] .avm-product-tag { background: #2a1d5c; color: #c4b5fd; }
[data-bs-theme="dark"] .avm-doctable-search { background: #110c25; border-color: #3b2a6b; }
[data-bs-theme="dark"] .avm-doctable-search input { color: #ede9fe; }
[data-bs-theme="dark"] .avm-doctable-count { color: #c4b5fd; }
/* Dark mode — mirrors .avm-id-summary palette so all read-only headers
 * (Stage 1 + carried-over Stage 2/3/4) share the same dark violet shell. */
[data-bs-theme="dark"] .avm-prev { background: linear-gradient(180deg, #1a1538 0%, #14102a 100%); border-color: #3b2a6b; }
[data-bs-theme="dark"] .avm-prev-head { background: transparent; border-bottom-color: rgba(167,139,250,.25); }
[data-bs-theme="dark"] .avm-prev-title { color: #ddd6fe; }
[data-bs-theme="dark"] .avm-prev-toggle { background: #221940; color: #c4b5fd; border-color: rgba(167,139,250,.35); }
[data-bs-theme="dark"] .avm-prev-toggle:hover { background: #2a1d5c; border-color: #a78bfa; }
[data-bs-theme="dark"] .avm-prev-chip { background: #221940; border-color: rgba(167,139,250,.35); color: #ddd6fe; }
[data-bs-theme="dark"] .avm-prev-pair:hover { background: rgba(167,139,250,0.10); }
[data-bs-theme="dark"] .avm-prev-k { color: #94a3b8; }
[data-bs-theme="dark"] .avm-prev-v { color: #c4b5fd; }
[data-bs-theme="dark"] .avm-prev-link { color: #c4b5fd; }
[data-bs-theme="dark"] .avm-prev-link:hover { color: #ddd6fe; }
[data-bs-theme="dark"] .avm-prev-suffix { color: #94a3b8; }
[data-bs-theme="dark"] .avm-prev-stage-label,
[data-bs-theme="dark"] .avm-prev-stage.tone-violet .avm-prev-stage-label,
[data-bs-theme="dark"] .avm-prev-stage.tone-teal   .avm-prev-stage-label,
[data-bs-theme="dark"] .avm-prev-stage.tone-purple .avm-prev-stage-label { color: #c4b5fd; }
[data-bs-theme="dark"] .avm-prev-stage + .avm-prev-stage { border-top-color: rgba(167,139,250,.20); }

/* ─── Master Quick-Add popup ─── */
.avm-qa-backdrop {
  position: fixed; inset: 0; z-index: 1100;
  background: rgba(15, 23, 42, .6);
  backdrop-filter: blur(3px);
  display: flex; align-items: center; justify-content: center;
  padding: 24px 20px;
  font-family: var(--font-sans);
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
  background: linear-gradient(135deg, #5b21b6, #a78bfa);
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
[data-bs-theme="dark"] .avm-qa-head  { background: linear-gradient(135deg, #5b21b6, #a78bfa); }
[data-bs-theme="dark"] .avm-qa-foot  { border-top-color: #3b2a6b; }

/* ─── Contact Person popup ─── */
.avm-cp-backdrop {
  position: fixed; inset: 0; z-index: 1100;
  background: rgba(15, 23, 42, .6);
  backdrop-filter: blur(3px);
  display: flex; align-items: center; justify-content: center;
  padding: 24px 20px;
  font-family: var(--font-sans);
}
.avm-cp-popup {
  width: 100%; max-width: 880px;
  background: #fff;
  border-radius: 16px;
  overflow: hidden;
  display: flex; flex-direction: column;
  box-shadow: 0 30px 80px rgba(15, 23, 42, .5);
}
/* Mapped Products list popup — wider to fit the mapping table columns. */
.avm-cp-popup-wide { max-width: 1040px; }
.avm-mapped-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
.avm-mapped-count {
  font-size: 12.5px; font-weight: 700; color: #6d28d9;
  background: #f5f1fe; border: 1px solid #e2d4fa; border-radius: 8px; padding: 6px 14px;
}
.avm-empty-accent { color: #7c3aed; border-color: #ddd6fe; background: #faf7ff; }
.avm-cp-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 18px;
  background: linear-gradient(135deg, #5b21b6, #a78bfa);
  color: #fff;
}
/* Amber-toned popup (GST Scrutiny) — orange header + orange Save button. */
.avm-cp-amber .avm-cp-head { background: linear-gradient(115deg, #d97706 0%, #f59e0b 55%, #fbbf24 100%); }
.avm-btn-amber {
  background: linear-gradient(135deg, #fbbf24, #f59e0b, #d97706) !important;
  box-shadow: 0 4px 12px rgba(217,119,6,.4) !important;
}
.avm-btn-amber:hover { box-shadow: 0 6px 18px rgba(217,119,6,.5) !important; }
/* Amber "+ Add" section button (GST tab). */
.avm-section-add-btn.amber { background: linear-gradient(120deg, #f59e0b 0%, #fbbf24 100%); }
.avm-section-add-btn.amber:hover { box-shadow: 0 4px 12px rgba(217,119,6,.4); }
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
[data-bs-theme="dark"] .avm-cp-head  { background: linear-gradient(135deg, #5b21b6, #a78bfa); }
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
  border-radius: 6px;
  background: #f5f1fe;
  color: #6d28d9;
  border: 1px solid #e2d4fa;
  font-family: 'DM Mono', 'JetBrains Mono', monospace;
  font-size: 12px;
  font-weight: 700;
  line-height: 1.2;
  letter-spacing: .02em;
}

/* KYC reference table (Figma): SR-No badge, expiry pills, Mandatory/Optional
   pair, upload/download action buttons, and a search bar above the table. */
.avm-sr-badge {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 26px; height: 24px; padding: 0 6px;
  border-radius: 7px; background: #f5f1fe; color: #6d28d9;
  border: 1px solid #e2d4fa; font-size: 11px; font-weight: 800; font-family: 'DM Mono', monospace;
}
.avm-exp-pill { display: inline-block; padding: 4px 10px; border-radius: 7px; font-size: 11px; font-weight: 700; }
.avm-exp-pill.is-na   { background: #f1f5f9; color: #64748b; border: 1px solid #e2e8f0; }
.avm-exp-pill.is-date { background: #fef2f2; color: #dc2626; border: 1px solid #fecaca; }
.avm-req-pair { display: inline-flex; align-items: center; gap: 4px; }
.avm-req-pill { display: inline-flex; align-items: center; padding: 3px 9px; border-radius: 99px; font-size: 10px; font-weight: 700; white-space: nowrap; }
.avm-req-pill.on-m { background: linear-gradient(135deg, #22c55e, #16a34a); color: #fff; box-shadow: 0 2px 6px rgba(22,163,74,.3); }
.avm-req-pill.on-o { background: linear-gradient(135deg, #8b5cf6, #7c3aed); color: #fff; box-shadow: 0 2px 6px rgba(124,58,237,.3); }
.avm-req-pill.off  { background: #f5f3fb; color: #9b94b3; border: 1px solid #e9e2f7; }
.avm-kyc-actions { display: inline-flex; align-items: center; gap: 5px; }
.avm-kyc-act {
  width: 27px; height: 27px; border-radius: 7px; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
  transition: transform .14s, box-shadow .14s, filter .14s; text-decoration: none;
}
.avm-kyc-act i { font-size: 14px; }
.avm-kyc-act.up   { background: #f5f1fe; color: #7c3aed; border: 1px solid #ddd6fe; }
.avm-kyc-act.up:hover { background: #7c3aed; color: #fff; border-color: transparent; transform: translateY(-1px); }
.avm-kyc-act.down { background: #f0fdf4; color: #16a34a; border: 1px solid #bbf7d0; }
.avm-kyc-act.down:hover { background: #16a34a; color: #fff; border-color: transparent; transform: translateY(-1px); }
.avm-kyc-act.is-disabled { opacity: .45; cursor: not-allowed; }
.avm-kyc-act.is-disabled:hover { background: #f0fdf4; color: #16a34a; transform: none; }
.avm-kyc-search {
  position: relative; display: flex; align-items: center; gap: 9px;
  height: 38px; margin-bottom: 12px; padding: 0 12px 0 14px;
  background: #faf8ff; border: 1.5px solid #e9e2f7; border-radius: 11px;
  transition: border-color .16s, box-shadow .16s;
}
.avm-kyc-search:focus-within { border-color: #a78bfa; box-shadow: 0 0 0 3px rgba(167,139,250,.18); }
.avm-kyc-search > i { color: #a78bfa; font-size: 16px; flex-shrink: 0; }
.avm-kyc-search input { flex: 1; min-width: 0; border: none; outline: none; background: transparent; font-family: inherit; font-size: 13px; color: #3b0764; }
.avm-kyc-search input::placeholder { color: #a78bfa; opacity: .7; }
.avm-kyc-search-clear { flex-shrink: 0; width: 22px; height: 22px; border: none; border-radius: 6px; background: rgba(124,58,237,.1); color: #7c3aed; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; }
.avm-kyc-search-clear:hover { background: #7c3aed; color: #fff; }
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

/* ════════════════════════════════════════════════════════════════════════
 * Dark mode — completeness pass across every stage of the Supplier wizard.
 * Each element below either carried a hardcoded light value with no dark
 * counterpart, or an inline style on the element that the earlier dark
 * rules could not reach. Every override is gated on [data-bs-theme="dark"]
 * so light mode is byte-for-byte unchanged.
 * ════════════════════════════════════════════════════════════════════ */

/* The segment / DD reference rows carry an inline background:#fafafa on the
   <tr> (near-white). In dark mode that washed the whole row to near-white
   beneath the light cell text, leaving the document names unreadable.
   Neutralise it so the row inherits the dark table surface; !important is
   required to beat the inline style, which otherwise wins on specificity. */
[data-bs-theme="dark"] .avm-kyc-table tbody tr { background-color: transparent !important; }

/* File links inside the KYC / segment tables were hardcoded inline as teal
   (#0d9488) or indigo (#6d28d9) — both too dim against the dark surface.
   Substring matching on the inline colour lifts each to its lighter
   counterpart without touching any other anchor. */
[data-bs-theme="dark"] .avm-modal a[style*="0d9488"] { color: #5eead4 !important; }
[data-bs-theme="dark"] .avm-modal a[style*="4338ca"] { color: #c4b5fd !important; }

/* Doc-table banners (Trade Document Management, Steps 3 & 4) were light
   amber / teal panels with no dark variant — bright blocks on the dark body. */
[data-bs-theme="dark"] .avm-doctable-banner.tone-amber {
  background: linear-gradient(135deg, #3a2a08, #2a2105); color: #fcd34d; border-color: #78521a;
}
[data-bs-theme="dark"] .avm-doctable-banner.tone-teal {
  background: linear-gradient(135deg, #0c2522, #08201d); color: #5eead4; border-color: #155e56;
}
[data-bs-theme="dark"] .avm-doctable-banner-sub { color: #fbbf24; }

/* Purple section tone — the only section colour left without a dark border. */
[data-bs-theme="dark"] .avm-section-purple { border-color: #3b2a6b; border-left-color: #a78bfa; }

/* Extra-contact card: the navy heading + light-red remove button were tuned
   for the white card and disappeared / glared on the dark card surface. */
[data-bs-theme="dark"] .avm-extra-head   { color: #c4b5fd; }
[data-bs-theme="dark"] .avm-extra-remove { background: #3a0e0e; border-color: #b91c1c; color: #fca5a5; }

/* Remaining navy (#7c3aed) accents that dim out against the dark surface. */
[data-bs-theme="dark"] .avm-product-code     { color: #c4b5fd; }
[data-bs-theme="dark"] .avm-filechooser-icon { color: #c4b5fd; }
[data-bs-theme="dark"] .avm-tab:hover        { color: #c4b5fd; }

/* ───── Dark mode for the NEW Step-2 / Figma elements ───── */
[data-bs-theme="dark"] .avm-pill-tabs { background: rgba(255,255,255,.04); border-color: rgba(167,139,250,.18); }
[data-bs-theme="dark"] .avm-pill-tabs .avm-pill { color: #a89fc7; }
[data-bs-theme="dark"] .avm-pill-tabs .avm-pill:hover { background: rgba(124,58,237,.18); color: #ede9fe; }
[data-bs-theme="dark"] .avm-doc-count { background: rgba(124,58,237,.18); color: #c4b5fd; border-color: rgba(167,139,250,.3); }
[data-bs-theme="dark"] .avm-sr-badge  { background: rgba(124,58,237,.2); color: #c4b5fd; border-color: rgba(167,139,250,.3); }
[data-bs-theme="dark"] .avm-exp-pill.is-na   { background: rgba(255,255,255,.06); color: #adb5bd; border-color: rgba(255,255,255,.12); }
[data-bs-theme="dark"] .avm-exp-pill.is-date { background: rgba(220,38,38,.18); color: #fca5a5; border-color: rgba(220,38,38,.4); }
[data-bs-theme="dark"] .avm-req-pill.off { background: rgba(255,255,255,.05); color: #9a93b3; border-color: rgba(255,255,255,.12); }
[data-bs-theme="dark"] .avm-kyc-act.up   { background: rgba(124,58,237,.18); color: #c4b5fd; border-color: rgba(167,139,250,.3); }
[data-bs-theme="dark"] .avm-kyc-act.down { background: rgba(22,163,74,.18); color: #4ade80; border-color: rgba(22,163,74,.4); }
[data-bs-theme="dark"] .avm-kyc-search { background: rgba(255,255,255,.04); border-color: rgba(167,139,250,.22); }
[data-bs-theme="dark"] .avm-kyc-search input { color: #ede9fe; }
[data-bs-theme="dark"] .avm-mapped-count { background: rgba(124,58,237,.18); color: #c4b5fd; border-color: rgba(167,139,250,.3); }
[data-bs-theme="dark"] .avm-empty-accent { background: rgba(124,58,237,.08); color: #c4b5fd; border-color: rgba(167,139,250,.3); }
[data-bs-theme="dark"] .avm-section-headtext .avm-section-sub { color: #a89fc7; }
[data-bs-theme="dark"] .avm-section-sub::before { color: rgba(167,139,250,.4); }
[data-bs-theme="dark"] .avm-foot-note { color: #a89fc7; }

/* ───── Responsive — collapse the form/table grids on narrow screens ───── */
@media (max-width: 820px) {
  .avm-grid-3, .avm-grid-4 { grid-template-columns: 1fr 1fr; }
}
@media (max-width: 520px) {
  .avm-grid-2, .avm-grid-3, .avm-grid-4 { grid-template-columns: 1fr; }
  .avm-tabs { overflow-x: auto; }
  .avm-pill-tabs { overflow-x: auto; flex-wrap: nowrap; }
}
`;
