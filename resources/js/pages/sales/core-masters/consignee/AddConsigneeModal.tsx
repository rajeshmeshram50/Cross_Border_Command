import { useEffect, useMemo, useRef, useState } from 'react';
import { useToast } from '../../../../contexts/ToastContext';
import api from '../../../../api';
import { MasterSelect, MasterDatePicker } from '../../../master/masterFormKit';
import Tooltip from '../../../../components/ui/Tooltip';
import { downloadFile } from '../../../../utils/downloadFile';
import DeleteConfirmModal from '../../../../components/ui/DeleteConfirmModal';
import { Shimmer, ShimmerTableRows } from '../../../../components/ui/Shimmer';
import { resolveFileUrl } from '../../../../utils/resolveFileUrl';
import SalesCustomerSendForSignatureModal from '../customer/SalesCustomerSendForSignatureModal';
import { MasterMultiSelect } from '../../../master/masterFormKit';
import {
  readCustomerMasterBundle,
  writeCustomerMasterBundle,
  bustCustomerMasterBundle,
} from '../customer/customerBundleCache';

/* Truncate a long attachment file name so it never spills out of the
 * ATTACHMENT cell into the ACTIONS column. The full name is shown on
 * hover via the wrapping Tooltip. Caps at 25 chars + ellipsis. */
const truncFileName = (s: string | undefined | null, n = 25): string => {
  const v = String(s ?? '');
  return v.length > n ? v.slice(0, n) + '…' : v;
};

/* Stage 3 → Trade Documents → Send for Signature.
 * Same shape used by AddCustomerModal / AddVendorModal so the Zoho
 * Sign send modal accepts any of the three flows interchangeably. */
type TdSigStatus = 'idle' | 'inprogress' | 'completed' | 'declined' | 'recalled' | 'expired';
type TdDocRow = {
  id: string; db_id: number | null;
  name: string; selected: boolean; sent: boolean;
  status?: TdSigStatus;
  signature_request_id?: number;
  signed_url?: string;
  /* Zoho Sign completion-certificate URL — populated by the polling
   * effect from clm_signature_requests.certificate_path on completed
   * rows. Drives the third action-column button. */
  certificate_url?: string;
  /* Set by the parent right before rendering — true when this row's
   * signature_request_id is inside the active 60-second Resend
   * cooldown. The button locks so a multi-doc bundle can't fire one
   * reminder per doc. */
  cooldownActive?: boolean;
  /* Reminder counter + last-sent timestamp from clm_signature_requests.
   * Drives the "× N" badge on the Resend button so users know how many
   * times the recipient has already been nudged. */
  reminder_count?: number;
  last_reminder_sent_at?: string | null;
};
const TD_STATUS_BADGE: Record<TdSigStatus, { label: string; bg: string; fg: string }> = {
  idle:       { label: 'N/A',                bg: '#f1f5f9', fg: '#94a3b8' },
  inprogress: { label: 'Awaiting Signature', bg: '#fef3c7', fg: '#92400e' },
  completed:  { label: 'Signed',             bg: '#dcfce7', fg: '#166534' },
  declined:   { label: 'Declined',           bg: '#fee2e2', fg: '#991b1b' },
  recalled:   { label: 'Recalled',           bg: '#e0e7ff', fg: '#3730a3' },
  expired:    { label: 'Expired',            bg: '#fee2e2', fg: '#7f1d1d' },
};

/* Render a saved segment value (a name, or a comma-joined / array list of
 * names) as "S-001: Name" using the segment master codes. Falls back to the
 * bare name when no code is known. Keeps every read-only display in sync with
 * the "code: name" labels the segment dropdown now shows. */
function segDisplay(value: string | string[] | null | undefined, segs: { name: string; code?: string }[]): string {
  const arr = Array.isArray(value)
    ? value
    : String(value ?? '').split(',').map(s => s.trim()).filter(Boolean);
  if (arr.length === 0) return '';
  return arr.map(n => {
    const code = segs.find(s => s.name === n)?.code;
    return code ? `${code}: ${n}` : n;
  }).join(', ');
}

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
  /* _path is the disk-relative storage path (e.g.
   * "consignee_documents/12/doc-abcd.pdf") — what the backend always
   * returns. _url is the optional pre-built public URL (returns
   * null on server configs where Storage::url() throws). View links
   * prefer _url when present, fall back to resolveFileUrl(_path). */
  attachment_path?: string;
  attachment_url?: string | null;
  attachment_name?: string;
  status: 'Active' | 'Inactive';
}
interface KycOwnerRow {
  id: string;
  owner_name: string;
  designation?: string;
  official_email?: string;
  phone_number?: string;
  id_proof_path?: string;       id_proof_url?: string | null;       id_proof_name?: string;
  address_proof_path?: string;  address_proof_url?: string | null;  address_proof_name?: string;
  photograph_path?: string;     photograph_url?: string | null;     photograph_name?: string;
  status: 'Active' | 'Inactive';
}
type KycSubTab = 'company-dd' | 'owner-kyc' | 'trade-licence';
type EvSubTab  = 'dd' | 'kyc' | 'tl';

/* Master value — must match the seeded address_types row exactly so
 * the dropdown selects it instead of inserting a synthetic fallback. */
const DEFAULT_ADDRESS_TYPE = 'Registered Office';
const newLocId = () => `loc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
const newKycId = (prefix: string) => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

/* Esc-to-close keyboard shortcut, scoped to whichever sub-modal is
 * currently mounted. We attach to keydown only while the modal is
 * open; passing it to every sub-modal keeps the keyboard UX uniform
 * (Location / KycDoc / KycOwner all close the same way). */
const useEscapeKey = (onEscape: () => void) => {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onEscape(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onEscape]);
};

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
  /** Numeric primary key — present once the row has been saved to the
   *  consignees table. Required to fire PUT/DELETE during edit. */
  db_id?: number;
  customerId: string;
  customer_db_id?: number;
  /** All customers this consignee is mapped to (many-to-many). The
   *  `customerId` above stays the primary for backward compatibility. */
  customers?: { id: number; code: string | null; name: string | null }[];
  company: string;
  segment: string;
  /* Free-text master value coming back from /master/risk_levels.
   * Common values are Low / Medium / High but the master can hold
   * any tenant-defined tier (Tier-1, Critical, etc.) so we keep the
   * type honest as a plain string. */
  risk: string;
  contact: string;
  email: string;
  phone: string;
  country: string;
  countryDetail: string;
  /* True iff this consignee was created with "Same as Customer" on.
   * Lets the edit flow keep the toggle ticked + lets the front-end
   * differentiate "this row IS the mirror" from "another consignee
   * is the mirror" when gating the toggle. */
  same_as_customer?: boolean;
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
  /* Optional fields surfaced from /customers — used by the "Same as
   * Customer" checkbox on Stage 1 to fully copy the customer onto the
   * consignee in one click. Older list responses may omit some of
   * these so all extras stay nullable. */
  risk?: string;
  website?: string;
  addressType?: string;
  address?: string;
  designation?: string;
  country: string;
  state: string;
  city: string;
  pin: string;
  contactPerson: string;
  phone: string;
  email: string;
  whatsapp: 'Yes' | 'No';
  /* True when this customer already has a same-as-customer consignee
   * attached. Drives the disabled state on the "Same as Customer"
   * banner so the user can't create / convert a second mirror — the
   * business rule is one mirror per customer. */
  hasSameAsCustomerConsignees?: boolean;
  sameAsCustomerConsigneeCount?: number;
};

/* Derive two-letter initials from a company name — used by the
 * picker's avatar tile when the API response doesn't carry one. */
const initialsOf = (name: string): string => {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '—';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

interface Props {
  open: boolean;
  consignee: ConsigneeRow | null; // null = create; non-null = edit (skip phase A)
  onClose: () => void;
  /** Fired after a successful POST or PUT so the parent list can refetch. */
  onSaved?: () => void;
  /** When set, the picker is bypassed and this customer is used as the
   *  pre-selected link. Used by SalesCustomers' "Map Consignee" flow
   *  (the user is already on a specific customer — they shouldn't have
   *  to pick again, and they should NOT be able to switch). The string
   *  format is the customer's display code (e.g. "C-001"). */
  preselectedCustomerId?: string;
  /** Alternative pre-select handle: numeric DB primary key. Used by
   *  callers (like the lead-matrix toolbar) that only have the lead's
   *  `customer_id` foreign key; the modal will resolve it against the
   *  /customers list's `db_id` if `preselectedCustomerId` doesn't match. */
  preselectedCustomerDbId?: number;
  /** Live count of existing same-as-customer consignees for the
   *  preselected customer, passed in by CustomerConsigneesModal which
   *  has just-fetched the list. Source of truth for the "max 1
   *  mirror per customer" guard — beats the /customers withCount
   *  which can lag behind during a session. */
  existingMirrorCount?: number;
  /** Optional landing stage. When set (typically 2 for KYC or 3 for
   *  Trade Docs/Evidence Vault), the modal opens on that stage instead
   *  of Stage 1 — used by the CLM panel deep-link from the opportunity
   *  detail page. Only respected in Edit mode (consignee present);
   *  ignored on create. */
  initialStage?: Stage;
}

type Phase = 'pick-customer' | 'wizard';
/* Evidence Vault (the former Stage 3) was removed from the consignee form —
 * those uploads now live in the standalone ConsigneeEvidenceVaultModal. The
 * form is a 2-stage flow: Legal Identity → KYC / Due Diligence. */
type Stage = 1 | 2;
type IdentityTab = 'identification' | 'address-contact';
type VaultTab = 'kyc' | 'trade';

/* ── Stage memory ──────────────────────────────────────────────────
 * Module-level map keyed by consignee.db_id (edit mode) that survives
 * close/reopen. A user who accidentally dismisses the modal on Stage 2
 * or Stage 3 lands back on the same stage when they reopen — not on
 * Stage 1. Cleared after a successful final submit. */
type ConsigneeStageMemoryEntry = { stage: Stage; idTab: IdentityTab; kycSub: KycSubTab; vaultTab: VaultTab };
const consigneeStageMemory = new Map<number, ConsigneeStageMemoryEntry>();

export default function AddConsigneeModal({ open, consignee, onClose, onSaved, preselectedCustomerId, preselectedCustomerDbId, existingMirrorCount, initialStage }: Props) {
  const toast = useToast();

  // Scroll lock — lock BOTH <html> and <body> so the page behind can't scroll.
  useEffect(() => {
    if (!open) return;
    const b = document.body.style.overflow;
    const h = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    return () => { document.body.style.overflow = b; document.documentElement.style.overflow = h; };
  }, [open]);

  const [phase, setPhase]   = useState<Phase>('pick-customer');
  const [stage, setStage]   = useState<Stage>(1);
  /* Furthest stage the user has reached — drives which steps the
   * stepper lets you click back/forward to (parallels AddCustomerModal).
   * Editing an existing consignee unlocks all three immediately; a fresh
   * create grows it as the user advances via Save & Next. */
  const [maxStage, setMaxStage] = useState<Stage>(1);
  const [customer, setCustomer] = useState<CustomerOption | null>(null);
  /* Additional customers this consignee is ALSO mapped to (many-to-many),
   * beyond the primary `customer` above. Stored as customer DB ids. The
   * payload sends [primary, ...these]. "Same as Customer" is disabled while
   * any extras are selected (the KYC mirror is intrinsically 1:1). */
  const [extraCustomerIds, setExtraCustomerIds] = useState<number[]>([]);
  const [extraSearch, setExtraSearch] = useState('');
  const [search, setSearch]     = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  /* Linked-customer panel starts COLLAPSED — when the user picks a
   * customer they only see the bar with the customer's id + name,
   * not the full address/contact details. Detail block expands when
   * the user ticks "Same as Customer" (handled in the setter wired
   * to Stage1's setSameAsCustomer) OR when they click the chevron. */
  // Expanded by default so the parent-customer recap grid is visible on open
  // (matches the Figma). User can still collapse it via the bar / chevron.
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
  /* Parallel `{ id, name }` view of mSegments — kept so we can map the
   * segment name stored in form1.segment back to its DB id for the
   * /clm/segment-rules/for-segment/{id} call that drives Stage 2 doc
   * auto-population. MasterSelect itself only needs {value,label}. */
  const [mSegmentIds, setMSegmentIds] = useState<{ id: number; name: string; code?: string }[]>([]);
  const [mClassifications, setMClassifications] = useState<Opt[]>([]);
  const [mRiskLevels,      setMRiskLevels]      = useState<Opt[]>([]);
  const [mAddressTypes,    setMAddressTypes]    = useState<Opt[]>([]);
  const [mCountries,       setMCountries]       = useState<(Opt & { id: number })[]>([]);
  const [mStates,          setMStates]          = useState<StateOpt[]>([]);
  const [mDesignations,    setMDesignations]    = useState<Opt[]>([]);
  /* Document Type master — backs the DD Document / License Name and
   * Trade Licence Name dropdowns in the Stage 2 sub-modal. Field key
   * on the master is `title` (managed in Master → Document Types). */
  const [mDocumentTypes,   setMDocumentTypes]   = useState<Opt[]>([]);

  // Stage 1 — Consignee Legal Identity
  const [idTab, setIdTab]         = useState<IdentityTab>('identification');
  /* "Same as Customer" toggle. When on, Stage 1's Basic Company +
   * Primary Address & Contact fields mirror the linked customer's
   * details and the inputs lock to read-only. Untick to edit
   * individually. The flag itself isn't persisted server-side — it's
   * a UX shortcut for copy-once-and-edit. */
  const [sameAsCustomer, setSameAsCustomer] = useState(false);
  /* Inline validation errors for Stage 1 fields. Keyed by form1 field
   * name. Each `goNext` from Stage 1 runs validateStage1() and refuses
   * to advance if any required field is empty/invalid; the error map
   * drives the red border + helper text under each affected Field. */
  const [errors1, setErrors1] = useState<Record<string, string>>({});

  /* Saving state — disables the Save button while api.post/put is in
   * flight so a double-click can't fire two creates. */
  const [saving, setSaving] = useState(false);
  /* Numeric PK of the saved consignee (created at Stage 1→2 transition
   * for new records, or pre-filled from the edit-mode prop). Drives all
   * Stage 2 KYC POSTs to /consignees/{id}/documents and /owners. */
  const [savedDbId, setSavedDbId] = useState<number | null>(null);
  /* Synchronous re-entry lock — `saving` state is async and React
   * batches updates, so two rapid clicks on "Save & Next" can both
   * pass the saving check before either has set saving=true. A ref
   * flips immediately on the synchronous tick, blocking the second
   * call cold. This is the actual fix for the duplicate row issue
   * the user saw on rapid clicks. */
  const inFlightRef = useRef(false);

  /* True after persistStage1 has POSTed or PUT a row in this session.
   * If the user closes via X/Cancel before the Stage 3 final submit,
   * we still fire onSaved so the parent list refreshes — otherwise a
   * brand-new consignee created on Stage 1 stays invisible until the
   * page is reloaded. Reset on modal open. */
  const dirtySavedRef = useRef(false);

  /* Skip-once cache for the parent customer's `locations` array.
   * Stashed by the edit-mode hydration from the bundled
   * /consignees/{id} response (customer_locations key). Consumed by
   * the same-as-customer effect below to skip its own
   * GET /customers/{customer.db_id} round-trip on initial open —
   * production network panel showed that fetch costing ~3 sec.
   * Subsequent toggles off/on or linked-customer changes still
   * fetch as before since the ref is cleared after a single use. */
  const bundledCustomerLocationsRef = useRef<{ customerId: number; rows: any[] } | null>(null);

  /* Tracks which parent-customer's segment we've already pre-filled onto a
   * NEW consignee's Segment field, so the inherit-once logic never fights
   * the user's later add/remove edits. Reset to null on every modal open
   * and re-prefills when the linked customer changes. */
  const segPrefillCustomerRef = useRef<string | null>(null);

  /* Stage 3 → Trade Documents → Send for Signature. Mirrors what
   * [[AddCustomerModal]] does — tdDocs is the table state (per-row
   * checkbox + status badge), sendForSignature holds the IDs the user
   * just clicked Send on so the wizard pops with them pre-checked. */
  const [tdDocs, setTdDocs] = useState<TdDocRow[]>([]);
  const [sendForSignature, setSendForSignature] = useState<number[] | null>(null);
  const [sigStatusByDoc, setSigStatusByDoc] = useState<Record<number, { status: TdSigStatus; signatureRequestId: number; signedUrl?: string; certificateUrl?: string; reminderCount?: number; lastReminderAt?: string | null }>>({});

  /* Resend cooldown — Zoho's remind API operates per-REQUEST; one
   * 3-doc bundle gets ONE reminder email no matter which row in it
   * the user clicks Resend on. To stop that bundle from firing three
   * separate reminders if the user clicks each row, we seed a 60s
   * cooldown on the signature_request_id; every sibling row's Resend
   * button locks visually until the timer expires. Same pattern as
   * the customer modal. */
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
  const isReminderCooldown = (reqId?: number): boolean => !!reqId && (recentReminds[reqId] ?? 0) > Date.now();
  const reminderCooldownSeconds = (reqId?: number): number => {
    if (!reqId) return 0;
    return Math.max(0, Math.ceil(((recentReminds[reqId] ?? 0) - Date.now()) / 1000));
  };

  /* True while the edit-mode hydration fetch is in flight. Renders a
   * shimmer skeleton over Stage 1 so the user sees the form shape
   * resolving in rather than empty inputs flashing into populated. */
  const [hydrating, setHydrating] = useState(false);
  /* True until /customers/master-bundle resolves (or sessionStorage cache
   * hits). The modal renders a shimmer skeleton while either this OR
   * `hydrating` is true via the derived `showShimmer` flag below. */
  const [mastersLoading, setMastersLoading] = useState<boolean>(true);
  const showShimmer = hydrating || mastersLoading;
  const [form1, setForm1] = useState({
    /* Basic company. `segment` is multi-valued — array of segment
     * names — so a consignee can be tagged with several segments and
     * the rule-resolver unions all their KYC/DD/TL/TD/QC docs. */
    companyName: '', legalName: '', website: '', segment: [] as string[], classification: '', risk: '',
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

  /* Real-time duplicate detection for the primary contact phone & email.
   * Fires the inline error the moment the user types a value already
   * used by an additional location row, so they don't get bounced back
   * after clicking Save & Next. Mirrors AddCustomerModal. */
  useEffect(() => {
    const phone = (form1.contactNo || '').trim();
    const email = (form1.email     || '').trim().toLowerCase();
    const dupPhoneMsg = 'This phone number is already used by another address on this consignee';
    const dupEmailMsg = 'This email is already used by another address on this consignee';
    setErrors1(prev => {
      const next = { ...prev };
      const phoneDup = phone && locations.some(l => (l.cpContact || '').trim() === phone);
      const emailDup = email && locations.some(l => (l.cpEmail   || '').trim().toLowerCase() === email);
      if (phoneDup) next.contactNo = dupPhoneMsg;
      else if (next.contactNo === dupPhoneMsg) delete next.contactNo;
      if (emailDup) next.email = dupEmailMsg;
      else if (next.email === dupEmailMsg) delete next.email;
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form1.contactNo, form1.email, locations]);

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
  /* In-flight flag for the Stage 2 delete confirm — drives spinner +
   * disabled state on the confirm dialog while the DELETE request
   * is going. */
  const [kycDeleting, setKycDeleting] = useState(false);

  /* Stage 3 — Evidence Vault. Outer tab = KYC vs Trade. Inner sub-tab
   * (when on KYC) = which KYC kind to view. */
  const [vaultTab, setVaultTab] = useState<VaultTab>('kyc');
  const [evSub, setEvSub]       = useState<EvSubTab>('dd');

  /* Segment-rule template — resolved KYC/DD/TL/TD/QC master rows for
   * the segment chosen on Stage 1. Drives Stage 2's Trade Licence
   * reference list and the Company DD required-doc banner so the user
   * sees what's expected for the segment without manual lookup. */
  type SegDocRow = { id:number; code:string; name:string; authority?:string|null; expiry?:string|null; status?:string; requirement:'M'|'O' };
  type SegmentDocs = { kyc: SegDocRow[]; dd: SegDocRow[]; tl: SegDocRow[]; td: SegDocRow[]; qc: SegDocRow[] };
  const EMPTY_SEG_DOCS: SegmentDocs = { kyc:[], dd:[], tl:[], td:[], qc:[] };
  const [segmentDocs, setSegmentDocs] = useState<SegmentDocs>(EMPTY_SEG_DOCS);
  /* segment name → its required KYC/DD/Trade-License doc codes (from the DCP
   * rules). Lets us block removing a segment in edit mode once any of its
   * documents have been uploaded. Built alongside the Stage 2 doc fetch. */
  const [segCodeMap, setSegCodeMap] = useState<Record<string, string[]>>({});
  /* True while the Stage 2 segment-rule document catalog is being fetched from
   * the DB — drives the table shimmer so the Company-DD / Owner-KYC / Trade-
   * Licence grids don't flash empty while the call is in flight (it fires after
   * hydration, so the page-level shimmer is already off). Mirrors [[AddCustomerModal]]. */
  const [segmentDocsLoading, setSegmentDocsLoading] = useState(false);

  /* Per-row file uploads against the segment-rule reference rows.
   * Key: `${sub-tab}::${doc.code}`. Value: File + blob URL used by the
   * View / Download actions. Lifted here (parent) so sub-tab switches
   * don't drop in-progress uploads. */
  type SegRefUpload = { file: File | null; url: string; name: string };
  const [segmentRefUploads, setSegmentRefUploads] = useState<Record<string, SegRefUpload>>({});

  /* Persist a segment-rule reference upload to /segment-uploads/consignee/{id}
   * so the Evidence Vault sees it. Mirrors AddCustomerModal's helper —
   * without this round-trip the upload only lives in browser memory. */
  /* Sub-tab → backend category. The sub-tab key is 'trade-licence'
   * (British spelling — matches the KycSubTab type). The American
   * 'trade-license' spelling here used to return undefined and
   * silently kill the segment-ref upload (file shown as blob in
   * the current session, never reached the server, vanished on
   * re-edit). */
  const SUB_TO_CAT_CO: Record<string, 'kyc' | 'dd' | 'tl'> = {
    'company-dd':    'dd',
    'owner-kyc':     'kyc',
    'trade-licence': 'tl',
  };
  const persistSegmentRefUpload = async (refKey: string, file: File, docName: string) => {
    // File-type / size guard at the upload chokepoint — the picker's accept=
    // hint is bypassable, so reject a .txt / .php / .exe / oversize file
    // instantly with a clear message before it reaches the server (which
    // enforces the same mimes rule too).
    const check = isAcceptedFile(file);
    if (!check.ok) {
      toast.error('Unsupported file', check.reason);
      return;
    }
    const ownerId = savedDbId || consignee?.db_id || null;
    if (!ownerId) {
      toast.error('Save first', 'Save the consignee before attaching reference documents.');
      return;
    }
    const [sub, doc_code] = refKey.split('::');
    const category = SUB_TO_CAT_CO[sub];
    if (!category || !doc_code) return;
    const fd = new FormData();
    fd.append('category', category);
    fd.append('doc_code', doc_code);
    fd.append('doc_name', docName || doc_code);
    fd.append('attachment', file);
    try {
      const { data } = await api.post(`/segment-uploads/consignee/${ownerId}`, fd, {
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
    } catch (err: any) {
      toast.error('Upload failed', err?.response?.data?.message ?? 'Could not save the attachment.');
    }
  };

  // Reset everything when modal opens fresh.
  useEffect(() => {
    if (!open) return;
    dirtySavedRef.current = false;
    if (consignee) {
      // Edit mode — skip the customer picker. The matching customer
      // is populated by the fetch effect below once it lands; until
      // then we keep `customer` null but jump straight to the wizard.
      setCustomer(null);
      setPhase('wizard');
    } else if (preselectedCustomerId || preselectedCustomerDbId) {
      // Map-Consignee flow — caller already knows which customer this
      // consignee belongs to. Skip the picker. `customer` is resolved
      // by the customer-list fetch effect below as soon as it lands.
      // Reset to null first so a stale `sameAsCustomerConsigneeCount`
      // from a previous open of this same modal doesn't briefly
      // flash an enabled toggle before the fresh fetch lands.
      setCustomer(null);
      setPhase('wizard');
    } else {
      setCustomer(null);
      setPhase('pick-customer');
    }
    /* Both create and edit modes always land on Stage 1 so the user
     * reviews identity first before stepping forward. The sub-tab
     * memory (KYC sub-tab, vault tab) is still restored so a user
     * returning to Stage 2/3 doesn't lose their inner navigation
     * if they manually advance again. */
    const memKey = consignee?.db_id ?? null;
    const remembered = memKey ? consigneeStageMemory.get(memKey) : null;
    /* Deep-link: when a consignee is present and the caller wants to
     * land on Stage 2 (KYC) or Stage 3 (Trade Docs), honour it. Create
     * mode always lands on Stage 1 — there's no identity to skip past
     * yet. */
    /* Clamp to ≤2 — the form is now a 2-stage flow. A caller could still
     * pass the legacy initialStage=3 (Evidence Vault); never land past
     * Stage 2. */
    const landing = Math.min(2, consignee ? (initialStage ?? 1) : 1) as Stage;
    setStage   (landing);
    // Existing consignee = a saved record → both stages are reachable
    // for review. Fresh create starts locked to Stage 1.
    setMaxStage((consignee ? 2 : landing) as Stage);
    setIdTab   ('identification');
    setKycSub  (remembered?.kycSub   ?? 'company-dd');
    setVaultTab(remembered?.vaultTab ?? 'kyc');
    setSearch('');
    setSearchOpen(false);
    /* Panel collapsed by default — picking a customer alone shows
     * only the id+name bar. Ticking "Same as Customer" (or clicking
     * the chevron) expands it. Hydration below re-opens it for an
     * existing same-as-customer consignee. */
    setLinkedHidden(true);
    setErrors1({});
    setSameAsCustomer(false);
    setExtraCustomerIds([]);
    setExtraSearch('');
    setEvSub('dd');
    setLocations([]);
    /* Reset Stage 1 form to empty defaults — CREATE mode only. In edit
     * mode the hydration effect below replays the consignee's saved
     * payload, so wiping here would just cause an empty flash before
     * the GET resolves. Create mode lands on a clean form so picking
     * a customer never reveals stale residue from a prior session;
     * mirror copy only happens after the user ticks Same-as-Customer. */
    // New open → allow the parent-customer segment to pre-fill again.
    segPrefillCustomerRef.current = null;
    if (!consignee?.db_id) {
      setForm1({
        companyName: '', legalName: '', website: '', segment: [] as string[], classification: '', risk: '',
        addressType: 'Registered Office', address: '', country: '', state: '', city: '', pin: '',
        contactName: '', designation: '', contactNo: '', email: '', whatsapp: 'Yes',
      });
    }
    setLocModal({ open: false, editing: null });
    setDelModal({ open: false, id: null });
    setKycSearch('');
    setKycDocs([]);
    setKycOwners([]);
    setDocModal({ open: false, sub: 'company-dd', editingId: null });
    setOwnerModal({ open: false, editingId: null });
    setKycDelModal({ open: false, kind: null, id: null });
    setSegmentDocs(EMPTY_SEG_DOCS);
    Object.values(segmentRefUploads).forEach(u => { try { URL.revokeObjectURL(u.url); } catch {} });
    setSegmentRefUploads({});
    /* Edit mode arrives with db_id; create mode starts null and gets
     * filled by the Stage 1→2 auto-save POST. */
    setSavedDbId(consignee?.db_id ?? null);
    /* Shimmer only when there's actually something to fetch (edit
     * mode). Create mode lands on an empty form instantly. */
    setHydrating(!!consignee?.db_id);
  }, [open, consignee]);

  /* Persist stage/tab into module-level memory whenever they change.
   * Closing the modal leaves the last-known stage in the map ready
   * for the next open. Edit mode only — create mode has no anchor
   * key to remember it by. */
  useEffect(() => {
    if (!open) return;
    const memKey = consignee?.db_id ?? null;
    if (memKey == null) return;
    consigneeStageMemory.set(memKey, { stage, idTab, kycSub, vaultTab });
  }, [open, consignee?.db_id, stage, idTab, kycSub, vaultTab]);

  /* Fetch the live customer list when the modal opens. Maps the API
   * response (the same shape SalesCustomers consumes) into the
   * picker's CustomerOption type. On edit mode the matching row is
   * also resolved here so the linked-customer card prefills. */
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setCustomersLoading(true);
    /* `tab=all` is critical — /customers defaults to `tab=fresh`, which
     * hides any customer that already has a lead (Recurring bucket).
     * Without it, editing a consignee whose customer turned recurring
     * after creation leaves `customer` null on this modal, the
     * Same-as-Customer panel renders empty, and persistStage1 trips
     * the "Hold on, loading the linked customer" toast forever. */
    api.get('/customers', { params: { tab: 'all' } })
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
          risk:          c.riskLevel  ?? '',
          website:       c.website    ?? '',
          addressType:   c.addrType   ?? '',
          address:       c.addr       ?? '',
          designation:   c.cpDesig    ?? '',
          country:       c.country    ?? '',
          state:         c.state      ?? '',
          city:          c.city       ?? '',
          pin:           c.pin        ?? '',
          contactPerson: c.contact    ?? '',
          phone:         c.phone      ?? '',
          email:         c.email      ?? '',
          whatsapp:      c.whatsapp === 'Yes' ? 'Yes' : 'No',
          hasSameAsCustomerConsignees:  !!c.hasSameAsCustomerConsignees,
          sameAsCustomerConsigneeCount: typeof c.sameAsCustomerConsigneeCount === 'number' ? c.sameAsCustomerConsigneeCount : 0,
        }));
        setCustomerOptions(opts);
        // Resolve the linked customer for edit mode now that we have the list.
        if (consignee) {
          const found = opts.find(o => o.id === consignee.customerId) || null;
          setCustomer(found);
        } else if (preselectedCustomerId || preselectedCustomerDbId) {
          // Map-Consignee flow — find the customer the parent locked us
          // to. Try the display code first (legacy callers), then fall
          // back to the numeric db_id (lead-matrix toolbar). Resilient to
          // legacy customer rows where customer_code may be missing or
          // formatted differently from the picker's id.
          const found =
            (preselectedCustomerId
              ? opts.find(o => o.id === preselectedCustomerId)
              : undefined)
            ?? (preselectedCustomerDbId
              ? opts.find(o => o.db_id === preselectedCustomerDbId)
              : undefined)
            ?? null;
          setCustomer(found);
        }
      })
      .catch(() => { if (!cancelled) setCustomerOptions([]); })
      .finally(() => { if (!cancelled) setCustomersLoading(false); });
    return () => { cancelled = true; };
  }, [open, consignee]);

  /* Inherit the parent customer's Segment on a NEW consignee.
   *
   * A consignee created under a customer defaults its Segment to that
   * customer's selected segment(s) — but the field stays a normal
   * editable multi-select: the user can add their own segments on top, or
   * remove (×) the inherited ones if the consignee doesn't share them.
   *
   * Runs once per resolved/picked customer (tracked via segPrefillCustomerRef)
   * so re-renders never re-add a segment the user just removed. Skipped in
   * edit mode (keeps the saved segment) and while Same-as-Customer is on
   * (that path copies the full identity, segment included). */
  useEffect(() => {
    if (!open) return;
    if (consignee?.db_id) return;          // edit mode — keep saved segment
    if (sameAsCustomer) return;            // full-copy effect owns segment here
    if (!customer) return;
    const cid = customer.id || '';
    if (segPrefillCustomerRef.current === cid) return;  // already inherited for this customer
    segPrefillCustomerRef.current = cid;
    const segs = String(customer.segment ?? '').split(',').map(s => s.trim()).filter(Boolean);
    setForm1(prev => ({ ...prev, segment: segs }));
  }, [open, customer, sameAsCustomer, consignee?.db_id]);

  /* "Same as Customer" copy effect. When the toggle flips on (or the
   * linked customer changes while it's on), mirror every Stage 1
   * field from the customer onto form1. Untick is a no-op: the
   * already-copied values stay and become editable again — so the
   * user can copy → tweak one field → save without losing their
   * inputs. */
  useEffect(() => {
    if (!sameAsCustomer || !customer) return;
    setForm1(prev => ({
      ...prev,
      companyName:    customer.name ?? '',
      legalName:      customer.legalName ?? '',
      website:        customer.website ?? '',
      /* Customer's segment is a single comma-joined string (legacy
       * scalar column); split back into an array for the consignee's
       * multi-select. Empty pieces drop out. */
      segment:        String(customer.segment ?? '').split(',').map(s => s.trim()).filter(Boolean),
      classification: customer.classification ?? '',
      risk:           customer.risk ?? '',
      // Primary address type is locked to "Registered Office" in the UI
      // — normalise on hydration so the form state stays in sync with
      // the disabled dropdown shown to the user.
      addressType:    'Registered Office',
      address:        customer.address ?? '',
      country:        customer.country ?? '',
      state:          customer.state ?? '',
      city:           customer.city ?? '',
      pin:            customer.pin ?? '',
      contactName:    customer.contactPerson ?? '',
      designation:    customer.designation ?? '',
      contactNo:      customer.phone ?? '',
      email:          customer.email ?? '',
      whatsapp:       customer.whatsapp === 'Yes' ? 'Yes' : 'No',
    }));
    setErrors1({}); // a full copy from a saved customer is presumed clean

    /* Pull the customer's *additional* locations too — Stage 1's
     * Address & Contact Details table should mirror those when the
     * checkbox is ticked. CustomerOption is the picker shape and
     * doesn't carry locations, so we hit /customers/{db_id} for the
     * full record. The primary address already flows through the
     * `customer.address/country/state/city/pin` block above. */
    if (customer.db_id) {
      /* Skip-once: edit-mode hydration may have already cached the
       * parent customer's locations from the bundled /consignees/{id}
       * response (customer_locations key). When the cached customerId
       * matches the picked customer, consume the cached rows and skip
       * the network round-trip. Subsequent toggles/customer changes
       * still fetch normally because the ref is cleared after use. */
      const cached = bundledCustomerLocationsRef.current;
      if (cached && cached.customerId === customer.db_id) {
        const extra = cached.rows;
        setLocations(extra.map((a: any) => ({
          id:            `cloc_${a.id ?? Math.random().toString(36).slice(2, 7)}`,
          type:          a.type ?? '',
          line:          a.address_line ?? '',
          country:       a.country ?? '',
          state:         a.state ?? '',
          city:          a.city ?? '',
          pin:           a.pin ?? '',
          cpName:        a.cp_name ?? '',
          cpDesignation: a.cp_designation ?? '',
          cpContact:     a.cp_contact ?? '',
          cpEmail:       a.cp_email ?? '',
          cpWhatsapp:    a.cp_whatsapp === 'no' ? 'no' : 'yes',
        })));
        bundledCustomerLocationsRef.current = null;
        return;
      }
      let cancelled = false;
      api.get(`/customers/${customer.db_id}`)
        .then(r => {
          if (cancelled) return;
          const extra: any[] = Array.isArray(r.data?.data?.locations) ? r.data.data.locations : [];
          setLocations(extra.map((a: any) => ({
            id:            `cloc_${a.id ?? Math.random().toString(36).slice(2, 7)}`,
            type:          a.type ?? '',
            line:          a.address_line ?? '',
            country:       a.country ?? '',
            state:         a.state ?? '',
            city:          a.city ?? '',
            pin:           a.pin ?? '',
            cpName:        a.cp_name ?? '',
            cpDesignation: a.cp_designation ?? '',
            cpContact:     a.cp_contact ?? '',
            cpEmail:       a.cp_email ?? '',
            cpWhatsapp:    a.cp_whatsapp === 'no' ? 'no' : 'yes',
          })));
        })
        .catch(() => { /* silent — the rest of the mirror still works */ });
      return () => { cancelled = true; };
    }
  }, [sameAsCustomer, customer]);

  /* Edit-mode hydration. When the parent opens the modal with a row
   * that already has db_id, fetch /consignees/{db_id} and replay the
   * payload into form1 + locations. The customer-list effect above
   * resolves the linked customer card; this one fills the wizard. */
  useEffect(() => {
    if (!open) return;
    if (!consignee?.db_id) return;
    let cancelled = false;
    setHydrating(true);
    api.get(`/consignees/${consignee.db_id}`)
      .then(r => {
        if (cancelled) return;
        const root = r.data ?? {};
        const d = root.data ?? null;
        if (!d) return;
        const wa = (d.primary_address?.cp_whatsapp ?? '').toLowerCase();
        setForm1({
          companyName:    d.company       ?? '',
          legalName:      d.legalName     ?? '',
          website:        d.website       ?? '',
          /* Server still stores `segment` as a comma-joined string;
           * split back into the multi-select's array shape. Arrays
           * from a future PATCH also land here. */
          segment:        Array.isArray(d.segment)
                            ? d.segment.filter(Boolean)
                            : String(d.segment ?? '').split(',').map(s => s.trim()).filter(Boolean),
          classification: d.classification ?? '',
          risk:           d.riskLevel     ?? '',
          // Locked to "Registered Office" in the UI — see the disabled
          // MasterSelect in Stage 1's Primary Address section.
          addressType:    'Registered Office',
          address:        d.primary_address?.address_line ?? '',
          country:        d.primary_address?.country    ?? '',
          state:          d.primary_address?.state      ?? '',
          city:           d.primary_address?.city       ?? '',
          pin:            d.primary_address?.pin        ?? '',
          contactName:    d.primary_address?.cp_name        ?? '',
          designation:    d.primary_address?.cp_designation ?? '',
          contactNo:      d.primary_address?.cp_contact     ?? '',
          email:          d.primary_address?.cp_email       ?? '',
          whatsapp:       wa === 'yes' ? 'Yes' : 'No',
        });
        /* Stash the bundled parent customer locations so the
         * same-as-customer effect above can skip its own
         * /customers/{customer.db_id} fetch on this initial open.
         * Only valid when same_as_customer is true AND a customer is
         * linked — otherwise the effect bails before reaching the
         * cache check, so stashing harmlessly. */
        if (Array.isArray(root.customer_locations) && d.customer_id) {
          bundledCustomerLocationsRef.current = {
            customerId: Number(d.customer_id),
            rows:       root.customer_locations,
          };
        }

        // Restore the toggle from the server so the user sees the
        // same banner state they left in — and so Save & Next keeps
        // the consignee flagged as same-as-customer on update.
        if (typeof d.same_as_customer === 'boolean') {
          setSameAsCustomer(d.same_as_customer);
          // Linked Customer panel stays collapsed by default — the
          // user can click the bar to expand it on demand. (Previous
          // behavior auto-expanded for same-as-customer rows, but
          // the summary section is noisy on first open.)
        }
        // Hydrate the extra customer mappings (everything except the primary).
        if (Array.isArray(d.customer_ids)) {
          const primaryId = Number(d.customer_id);
          setExtraCustomerIds(
            d.customer_ids.map((x: any) => Number(x)).filter((x: number) => x && x !== primaryId),
          );
        }
        const extra: any[] = Array.isArray(d.locations) ? d.locations : [];
        setLocations(extra.map((a: any) => ({
          id:            `loc_db_${a.id}`,
          type:          a.type ?? '',
          line:          a.address_line ?? '',
          country:       a.country ?? '',
          state:         a.state ?? '',
          city:          a.city ?? '',
          pin:           a.pin ?? '',
          cpName:        a.cp_name ?? '',
          cpDesignation: a.cp_designation ?? '',
          cpContact:     a.cp_contact ?? '',
          cpEmail:       a.cp_email ?? '',
          cpWhatsapp:    (a.cp_whatsapp ?? '').toLowerCase() === 'no' ? 'no' : 'yes',
        })));

        // Stage 2 data — now arrives in the same response as `documents`,
        // `owners`, and `segment_uploads`. Top-level keys, not inside `data`.
        // Mirrors the AddCustomerModal hydration shape — ConsigneeController::show()
        // bundles these in via safeDelegate() so we no longer need the 3
        // parallel /consignees/{id}/documents + /owners + /segment-uploads
        // round-trips that used to fire here via refetchKyc().
        const docs: any[] = Array.isArray(root.documents) ? root.documents : [];
        const owners: any[] = Array.isArray(root.owners) ? root.owners : [];
        setKycDocs(docs.map((x: any) => ({
          id: `db_${x.id}`,
          kind: x.kind === 'tl' ? 'tl' : 'dd',
          name: x.name ?? '',
          license_number: x.license_number ?? '',
          issuing_authority: x.issuing_authority ?? '',
          issue_date: x.issue_date ?? '',
          expiry_date: x.expiry_date ?? '',
          attachment_path: x.attachment_path ?? '',
          attachment_url:  x.attachment_url ?? null,
          attachment_name: x.attachment_name ?? '',
          status: x.status === 'Inactive' ? 'Inactive' : 'Active',
        })));
        setKycOwners(owners.map((x: any) => ({
          id: `db_${x.id}`,
          owner_name: x.owner_name ?? '',
          designation: x.designation ?? '',
          official_email: x.official_email ?? '',
          phone_number: x.phone_number ?? '',
          id_proof_path:      x.id_proof_path ?? '',
          id_proof_url:       x.id_proof_url ?? null,
          id_proof_name:      x.id_proof_name ?? '',
          address_proof_path: x.address_proof_path ?? '',
          address_proof_url:  x.address_proof_url ?? null,
          address_proof_name: x.address_proof_name ?? '',
          photograph_path:    x.photograph_path ?? '',
          photograph_url:     x.photograph_url ?? null,
          photograph_name:    x.photograph_name ?? '',
          status: x.status === 'Inactive' ? 'Inactive' : 'Active',
        })));

        // Stage 3 segment-rule reference uploads. Same hydration pattern
        // as before — only the source moved from a separate call to this
        // bundled response. British 'trade-licence' spelling matches the
        // KycSubTab type + render's refKey lookup.
        const refs: any[] = Array.isArray(root.segment_uploads?.data) ? root.segment_uploads.data : [];
        const CAT_TO_SUB: Record<string, string> = { dd: 'company-dd', kyc: 'owner-kyc', tl: 'trade-licence' };
        const hydrated: Record<string, SegRefUpload> = {};
        for (const ref of refs) {
          const sub = CAT_TO_SUB[ref.category];
          if (!sub || !ref.doc_code) continue;
          hydrated[`${sub}::${ref.doc_code}`] = {
            file: null as unknown as File,
            url:  ref.attachment_url || '',
            name: ref.attachment_name || '',
          };
        }
        if (Object.keys(hydrated).length > 0) setSegmentRefUploads(hydrated);
      })
      .catch(() => { /* silent — toast was added on the save path; on hydration just keep the empty form */ })
      .finally(() => { if (!cancelled) setHydrating(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, consignee?.db_id]);

  /* Bundled master fetch — /customers/master-bundle returns every dropdown
   * (segments, customer_classifications, risk_levels, address_types,
   * countries, states, designations, document_type) in ONE round-trip.
   * Shared with AddCustomerModal via the same sessionStorage cache key,
   * so opening one modal warms the cache for the other. Replaces 8
   * separate /master/* fetches. The unused `customer_types` field in
   * the bundle is silently ignored — payload cost is negligible. */
  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    type IdNamed = { id: number | string; name?: string | null };
    type Bundle = {
      customer_types: IdNamed[];
      segments: Array<{ id: number | string; name?: string | null; title?: string | null; code?: string | null }>;
      customer_classifications: IdNamed[];
      risk_levels: IdNamed[];
      address_types: IdNamed[];
      countries: IdNamed[];
      states: Array<{ id: number | string; name?: string | null; country_id?: number | string | null }>;
      designations: IdNamed[];
      document_type: Array<{ id: number | string; title?: string | null }>;
    };

    const pickName = (rows: IdNamed[]): Opt[] => (rows || [])
      .map(r => ({ value: String(r.name ?? ''), label: String(r.name ?? '') }))
      .filter(o => o.value);
    const pickCountriesFromBundle = (rows: IdNamed[]): (Opt & { id: number })[] => (rows || [])
      .map(r => ({ id: Number(r.id), value: String(r.name ?? ''), label: String(r.name ?? '') }))
      .filter(o => o.value);
    const pickStatesFromBundle = (rows: Bundle['states']): StateOpt[] => (rows || [])
      .map(r => ({ countryId: Number(r.country_id), value: String(r.name ?? ''), label: String(r.name ?? '') }))
      .filter(o => o.value);

    const hydrate = (b: Bundle) => {
      // Segments — server returns `name`; the model also appends `title`
      // (alias) for legacy consumers. Read whichever is present.
      const segmentRows = (b.segments || []).map(x => ({
        id: Number(x.id),
        name: String(x.title ?? x.name ?? ''),
        code: String(x.code ?? ''),
      })).filter(s => s.name);
      // Label shows "<segment code>: <name>" (e.g. "S-001: Tobacco") in the
      // dropdown/chips; value stays the plain name so saving + DCP rule lookup
      // logic is unchanged.
      setMSegments(segmentRows.map(s => ({ value: s.name, label: s.code ? `${s.code}: ${s.name}` : s.name })));
      setMSegmentIds(segmentRows);

      setMClassifications(pickName(b.customer_classifications));
      setMRiskLevels(pickName(b.risk_levels));
      setMAddressTypes(pickName(b.address_types));
      // Countries — alpha-sort mirrors the previous client-side sort.
      const sortedCountries = [...(b.countries ?? [])].sort((a, b) =>
        String(a.name ?? '').localeCompare(String(b.name ?? '')));
      setMCountries(pickCountriesFromBundle(sortedCountries));
      setMStates(pickStatesFromBundle(b.states));
      setMDesignations(pickName(b.designations));
      // Document Type master uses `title` (not `name`).
      setMDocumentTypes(
        (b.document_type || [])
          .map(r => ({ value: String(r.title ?? ''), label: String(r.title ?? '') }))
          .filter(o => o.value)
      );
    };

    // Cache hit — hydrate immediately, skip the network entirely.
    const cached = readCustomerMasterBundle<Bundle>();
    if (cached) {
      hydrate(cached);
      setMastersLoading(false);
      return () => { cancelled = true; };
    }

    (async () => {
      try {
        const res = await api.get<Bundle>('/customers/master-bundle');
        if (cancelled) return;
        hydrate(res.data);
        writeCustomerMasterBundle(res.data);
      } catch {
        // Dropdowns stay empty; validation will catch missing values.
      } finally {
        if (!cancelled) setMastersLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [open]);

  /* Segment-rule template fetch (multi-segment). For each chosen
   * segment, resolve its DB id from mSegmentIds and pull the rule's
   * KYC / DD / TL / TD / QC docs in parallel. Category arrays are
   * merged and deduped by `code` so a doc that's required by multiple
   * segments only renders once in Stage 2 + Stage 3. Mandatory wins
   * on dedupe — if any selected segment marks a code as 'M', the
   * merged row stays 'M'. */
  useEffect(() => {
    if (!open) return;
    /* Lazy gate — only fire the CLM segment-rules + trade-doc-library
     * fetches once the user reaches Stage 2 or higher. Stage 1 only
     * edits identity + address; it doesn't need this data. Previously
     * these calls fired on modal open and added 1-2 sec to the Stage 1
     * open even for users who only edit Stage 1. The `stage` value is
     * in the dep array below so the fetch fires exactly when the user
     * clicks the Stage 2 (or Stage 3) tab.
     *
     * Mirrors the same gate added to AddCustomerModal. We deliberately
     * do NOT clear segmentDocs when stage<2 — if the user navigates
     * Stage 2 → Stage 1, the previously-loaded docs stay cached and
     * are immediately usable when they go back. We ALSO load when
     * maxStage>=2 (e.g. editing an existing consignee while sitting on
     * Stage 1) so the stepper's per-stage completeness is accurate
     * rather than defaulting later stages to a false "done". */
    /* In EDIT mode always load (even on Stage 1 with maxStage=1): the
     * segment-remove guard needs segCodeMap to know which documents each
     * segment owns, otherwise a segment with uploaded docs on an existing
     * consignee could be removed. */
    if (stage < 2 && maxStage < 2 && !consignee) return;
    const names = (form1.segment ?? []).filter(Boolean);
    if (names.length === 0) { setSegmentDocs(EMPTY_SEG_DOCS); setSegmentDocsLoading(false); return; }
    const segRows = names
      .map(n => mSegmentIds.find(s => s.name === n))
      .filter((r): r is { id:number; name:string } => !!r);
    if (segRows.length === 0) { setSegmentDocs(EMPTY_SEG_DOCS); setSegmentDocsLoading(false); return; }

    let cancelled = false;
    setSegmentDocsLoading(true);
    Promise.all([
      Promise.all(
        segRows.map(s =>
          api.get(`/clm/segment-rules/for-segment/${s.id}`)
            .then(r => r.data?.data ?? {})
            .catch(() => ({}))
        )
      ),
      /* Party filter for the consignee form: only trade docs whose
       * `party` CSV mentions "Consignee" reach the td bucket. We
       * intersect with segment-rule td below. */
      api.get('/clm/trade-doc-library/for-party/consignee')
        .then(r => Array.isArray(r.data?.data) ? r.data.data : [])
        .catch(() => [] as Array<{ code: string }>),
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
      /* Per-segment doc-code map (KYC/DD/Trade License) — `results[i]`
       * aligns with `segRows[i]`. Drives the remove-segment guard. */
      const codeMap: Record<string, string[]> = {};
      results.forEach((r: any, i: number) => {
        const seg = segRows[i];
        if (!seg) return;
        const codes = new Set<string>();
        (['kyc', 'dd', 'tl'] as const).forEach(cat => {
          const rows: SegDocRow[] = Array.isArray(r?.[cat]) ? r[cat] : [];
          rows.forEach(d => { if (d?.code) codes.add(d.code); });
        });
        codeMap[seg.name] = Array.from(codes);
      });
      setSegCodeMap(codeMap);
      // Parallel state for the Send-for-Signature flow — same shape
      // as in [[AddCustomerModal]] so Stage3TradeDocs is portable.
      setTdDocs(mergedTd.map(d => ({
        id: `td_${d.code}`,
        db_id: partyById.get(d.code) ?? null,
        name: d.name,
        // No default selection — the user explicitly ticks the rows they
        // want to send. Pre-checking Mandatory rows surprised users who
        // opened the tab and saw signatures queued up without intent.
        selected: false,
        sent: false,
        status: 'idle' as TdSigStatus,
      })));
    }).finally(() => { if (!cancelled) setSegmentDocsLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, stage, maxStage, form1.segment, mSegmentIds]);

  /* Poll the live signature-request list every 15s while the user is on
   * Stage 3 → Trade Documents. The backend's ?sync=true triggers a Zoho
   * round-trip per inprogress row, so completed signings, declines and
   * recalls show up in the badges without the user having to refresh. */
  useEffect(() => {
    // Dormant since the Evidence Vault (Stage 3) was removed from this form:
    // `vaultTab` can no longer become 'trade' here, so this poller never
    // fires. Kept for the standalone Evidence Vault flow's parity.
    const partyId = consignee?.db_id ?? savedDbId;
    if (!open || vaultTab !== 'trade' || !partyId) return;
    let cancelled = false;
    const fetchAndUpdate = async (withSync: boolean) => {
      try {
        const r = await api.get('/clm/signature-requests', {
          params: { party_id: partyId, model_name: 'Consignee', sync: withSync ? 1 : 0 },
        });
        if (cancelled) return;
        const rows: Array<{
          id: number;
          status: TdSigStatus;
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
        const map: Record<number, { status: TdSigStatus; signatureRequestId: number; signedUrl?: string; certificateUrl?: string; reminderCount?: number; lastReminderAt?: string | null }> = {};
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
            // Resolve via resolveFileUrl so the URL picks up the right
            // base (VITE_API_URL on the deployed SPA, current origin in
            // dev). Without this the View / Download icons get a bare
            // /storage/… relative URL that 404s when the SPA origin
            // differs from the API host.
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
  }, [open, stage, vaultTab, consignee?.db_id, savedDbId]);

  // Project the polled status into the tdDocs rows.
  useEffect(() => {
    setTdDocs(prev => prev.map(d => {
      if (!d.db_id) return d;
      const info = sigStatusByDoc[d.db_id];
      if (!info) return d;
      return {
        ...d,
        sent:   d.sent || info.status !== 'idle',
        status: info.status,
        signature_request_id: info.signatureRequestId,
        signed_url:      info.signedUrl      ?? d.signed_url,
        certificate_url: info.certificateUrl ?? d.certificate_url,
        reminder_count:        info.reminderCount  ?? d.reminder_count        ?? 0,
        last_reminder_sent_at: info.lastReminderAt ?? d.last_reminder_sent_at ?? null,
      };
    }));
  }, [sigStatusByDoc]);

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

  /* Wrapper around the prop's onClose — if persistStage1 ran during
   * this session (dirtySavedRef), fire onSaved so the parent list
   * refreshes even when the user dismisses via X/Cancel before the
   * Stage 3 final submit. The final submit path at goSubmit() already
   * fires onSaved + onClose directly, so this only matters for early
   * dismissal. */
  const handleClose = () => {
    if (dirtySavedRef.current) {
      onSaved?.();
      dirtySavedRef.current = false;
    }
    onClose();
  };

  /* Multi-select on the picker. The FIRST customer picked becomes the
   * "primary" (`customer`); every additional one goes into
   * `extraCustomerIds`. Un-ticking the primary promotes the next extra. */
  const isCustomerPicked = (opt: CustomerOption): boolean =>
    (!!opt.db_id && customer?.db_id === opt.db_id) || (!!opt.db_id && extraCustomerIds.includes(opt.db_id));

  const togglePickCustomer = (opt: CustomerOption) => {
    const id = opt.db_id;
    if (!id) return;
    if (customer?.db_id === id) {
      // Un-ticking the primary → promote the first extra (if any).
      if (extraCustomerIds.length > 0) {
        const nextId = extraCustomerIds[0];
        setCustomer(customerOptions.find(c => c.db_id === nextId) ?? null);
        setExtraCustomerIds(prev => prev.filter(x => x !== nextId));
      } else {
        setCustomer(null);
      }
    } else if (extraCustomerIds.includes(id)) {
      setExtraCustomerIds(prev => prev.filter(x => x !== id));
    } else if (!customer) {
      setCustomer(opt);            // first pick = primary
    } else {
      setExtraCustomerIds(prev => [...prev, id]);
    }
  };

  const pickedCount = (customer ? 1 : 0) + extraCustomerIds.length;

  const confirmCustomer = () => {
    if (!customer) {
      toast.warning('Pick a customer', 'Select at least one customer this consignee will be linked to.');
      return;
    }
    setPhase('wizard');
    setStage(1);
  };

  /* Single source of truth for Stage 1 field rules. Returns the error
   * message for one field (or null when clean). Used by both the full
   * Save-&-Next validator below and the per-keystroke validator in
   * Stage1.set() — so the inline red error appears in real time as
   * the user types, instead of waiting for the Save button. */
  const stage1FieldRule = (k: string, f: typeof form1): string | null => {
    switch (k) {
      case 'companyName':
        if (!f.companyName.trim()) return 'Company name is required';
        if (f.companyName.trim().length < 2) return 'Company name must be at least 2 characters';
        if (f.companyName.trim().length > 30) return 'Company name must be 30 characters or fewer';
        // \p{L}/\p{N} (u flag) allow non-Latin / Unicode names (e.g. 中文, العربية).
        if (!/^[\p{L}\p{N} .,'&()\-\/]+$/u.test(f.companyName.trim()))
          return 'Company name has invalid characters — letters, numbers and . , & \' - ( ) / only';
        if (!/\p{L}/u.test(f.companyName)) return 'Company name must contain at least one letter';
        return null;
      case 'legalName':
        if (!f.legalName.trim()) return 'Company legal name is required';
        if (f.legalName.trim().length < 2) return 'Legal name must be at least 2 characters';
        if (f.legalName.trim().length > 100) return 'Legal name must be 100 characters or fewer';
        if (!/^[\p{L}\p{N} .,'&()\-\/]+$/u.test(f.legalName.trim()))
          return 'Legal name has invalid characters — letters, numbers and . , & \' - ( ) / only';
        if (!/\p{L}/u.test(f.legalName)) return 'Legal name must contain at least one letter';
        return null;
      case 'website':
        if (!f.website || !f.website.trim()) return null;
        if (f.website.trim().length > 200) return 'Website must be 200 characters or fewer';
        if (!/^(https?:\/\/)?([\w-]+\.)+[A-Za-z]{2,}(\/[\w\-./?%&=#]*)?$/.test(f.website.trim()))
          return 'Enter a valid website (e.g. https://example.com)';
        return null;
      case 'segment':
        if (!Array.isArray(f.segment) || f.segment.length === 0) return 'Select at least one segment';
        return null;
      case 'risk':
        if (!f.risk) return 'Select a risk level';
        return null;
      case 'addressType':
        if (!f.addressType) return 'Select address type';
        return null;
      case 'address':
        if (!f.address.trim()) return 'Address is required';
        if (f.address.trim().length < 4) return 'Address must be at least 4 characters';
        if (f.address.trim().length > 75) return 'Address must be 75 characters or fewer';
        // Must contain at least one letter — blocks gibberish like "1234"
        // or "...." while still allowing genuine addresses that mix
        // letters, numbers, commas, hyphens, etc.
        if (!/[A-Za-z]/.test(f.address)) return 'Address must contain at least one letter';
        return null;
      case 'country':
        if (!f.country) return 'Select country';
        return null;
      case 'state':
        if (!f.state) return 'Select state';
        return null;
      case 'city':
        if (!f.city.trim()) return 'City is required';
        if (f.city.trim().length > 30) return 'City must be 30 characters or fewer';
        if (!/^[A-Za-z][A-Za-z .'\-]*$/.test(f.city.trim()))
          return 'City can contain only letters, spaces, dots, hyphens and apostrophes';
        return null;
      case 'pin':
        if (!f.pin.trim()) return 'PIN is required';
        if (!/^\d{6}$/.test(f.pin.trim())) return 'PIN must be exactly 6 digits';
        return null;
      case 'contactName':
        if (!f.contactName.trim()) return 'Contact name is required';
        if (f.contactName.trim().length > 60) return 'Name must be 60 characters or fewer';
        if (!/^[A-Za-z][A-Za-z .'\-]*$/.test(f.contactName.trim()))
          return 'Name can contain only letters, spaces, dots, hyphens and apostrophes';
        return null;
      case 'designation':
        if (!f.designation.trim()) return 'Designation is required';
        return null;
      case 'contactNo':
        if (!f.contactNo.trim()) return 'Contact number is required';
        if (!/^\+?[0-9\s-]{7,15}$/.test(f.contactNo)) return 'Phone must be 7-15 digits';
        if (locations.some(l => (l.cpContact || '').trim() === f.contactNo.trim()))
          return 'This phone number is already used by another address on this consignee';
        return null;
      case 'email':
        if (!f.email.trim()) return 'Email is required';
        if (!/^[A-Za-z0-9._%+-]+@[A-Za-z0-9][A-Za-z0-9.-]*\.[A-Za-z]{2,}$/.test(f.email)) return 'Enter a valid email';
        if (locations.some(l => (l.cpEmail || '').trim().toLowerCase() === f.email.trim().toLowerCase()))
          return 'This email is already used by another address on this consignee';
        return null;
      case 'whatsapp':
        if (!f.whatsapp) return 'Select WhatsApp preference';
        return null;
    }
    return null;
  };

  const STAGE1_FIELD_KEYS = [
    'companyName','legalName','website','segment','risk','addressType','address',
    'country','state','city','pin','contactName','designation','contactNo','email','whatsapp',
  ];

  /* Validate every required Stage 1 field. Returns the error map (empty
   * when valid). The map keys match form1 field names so we can wire
   * inline error display via the Field's `error` prop in Stage1. */
  const validateStage1 = (): Record<string, string> => {
    const e: Record<string, string> = {};
    for (const k of STAGE1_FIELD_KEYS) {
      const msg = stage1FieldRule(k, form1);
      if (msg) e[k] = msg;
    }
    return e;
  };

  /* ── Real per-stage completeness for the stepper ──────────────────
   * Mirrors AddCustomerModal: the stepper must not paint a stage green
   * just because the user advanced past it. A visited-but-empty stage
   * shows amber "incomplete" instead. Plain const (not useMemo) on
   * purpose — it must sit after STAGE1_FIELD_KEYS/stage1FieldRule, which
   * are declared below the `if (!open) return null` early-return, so a
   * hook here would break React's stable hook order.
   *
   *   Stage 1 — every required identity field is valid.
   *   Stage 2 & 3 — share ONE segment-rule upload set (dd/kyc/tl). Done
   *     when every MANDATORY doc is uploaded; an all-optional rule is
   *     done once at least one is uploaded; a rule with no docs at all
   *     has nothing to satisfy → done. */
  const stageComplete: [boolean, boolean, boolean] = (() => {
    const s1 = STAGE1_FIELD_KEYS.every(k => !stage1FieldRule(k, form1));

    const subFor = (cat: 'dd' | 'kyc' | 'tl') =>
      cat === 'dd' ? 'company-dd' : cat === 'kyc' ? 'owner-kyc' : 'trade-licence';
    let mandTotal = 0, mandDone = 0, anyDoc = false, anyUpload = false;
    (['dd', 'kyc', 'tl'] as const).forEach(cat => {
      ((segmentDocs as any)[cat] || []).forEach((d: any) => {
        anyDoc = true;
        const up = !!segmentRefUploads[`${subFor(cat)}::${d.code}`];
        if (up) anyUpload = true;
        if (d.requirement === 'M') { mandTotal++; if (up) mandDone++; }
      });
    });
    const docsComplete = !anyDoc
      ? true
      : mandTotal > 0 ? mandDone === mandTotal : anyUpload;

    return [s1, docsComplete, docsComplete];
  })();

  /* Guarded tab switcher handed to the Stage 1 tab buttons. The user can't
     jump straight to "Address & Contact" until the Identification fields are
     valid — clicking it validates first and only switches when clean (else it
     surfaces the inline errors + scrolls to the first one). Going back to
     "identification" is always allowed. Internal flows (goNext / goPrev /
     reset) keep calling setIdTab directly, so they're unaffected. */
  const requestIdTab = (t: IdentityTab) => {
    if (t === 'address-contact' && idTab !== 'address-contact') {
      const e = validateStage1();
      setErrors1(e);
      if (Object.keys(e).length > 0) {
        const firstKey = Object.keys(e)[0];
        setTimeout(() => {
          document.querySelector<HTMLElement>(`[data-field="${firstKey}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 0);
        return;
      }
    }
    setIdTab(t);
  };

  /* Per-keystroke validator passed down to Stage1. Runs the single-field
   * rule against the post-change form and updates errors1 with just that
   * field's error — so the inline red shows up as the user types instead
   * of waiting for Save & Next. */
  const validateField1 = (k: string, nextForm: typeof form1) => {
    const msg = stage1FieldRule(k, nextForm);
    setErrors1(prev => {
      const next = { ...prev };
      if (msg) next[k] = msg;
      else delete next[k];
      return next;
    });
  };

  /* Refetch KYC docs + owners from the server. Called after every
   * Stage 2 sub-modal save so the table picks up the canonical row
   * (with auto-generated codes, attachment URLs, etc.) instead of
   * the optimistic in-memory copy. */
  const refetchKyc = async (id: number | null = savedDbId) => {
    if (!id) return;
    try {
      const [docsR, ownersR, refsR] = await Promise.all([
        api.get(`/consignees/${id}/documents`),
        api.get(`/consignees/${id}/owners`),
        api.get(`/segment-uploads/consignee/${id}`).catch(() => ({ data: { data: [] } })),
      ]);
      const refs: any[] = Array.isArray(refsR.data?.data) ? refsR.data.data : [];
      const hydrated: Record<string, SegRefUpload> = {};
      // British 'trade-licence' on purpose — matches the KycSubTab
      // type + the render's refKey lookup. American 'trade-license'
      // here broke hydration of trade-licence segment uploads on
      // re-edit (key in segmentRefUploads didn't match the one the
      // render rebuilt from `sub`).
      const CAT_TO_SUB: Record<string, string> = { dd: 'company-dd', kyc: 'owner-kyc', tl: 'trade-licence' };
      for (const r of refs) {
        const sub = CAT_TO_SUB[r.category];
        if (!sub || !r.doc_code) continue;
        hydrated[`${sub}::${r.doc_code}`] = { file: null, url: r.attachment_url || '', name: r.attachment_name || '' };
      }
      if (Object.keys(hydrated).length > 0) setSegmentRefUploads(hydrated);
      const docs: any[] = Array.isArray(docsR.data?.data) ? docsR.data.data : [];
      const owners: any[] = Array.isArray(ownersR.data?.data) ? ownersR.data.data : [];
      setKycDocs(docs.map((x: any) => ({
        id: `db_${x.id}`,
        kind: x.kind === 'tl' ? 'tl' : 'dd',
        name: x.name ?? '',
        license_number: x.license_number ?? '',
        issuing_authority: x.issuing_authority ?? '',
        issue_date: x.issue_date ?? '',
        expiry_date: x.expiry_date ?? '',
        attachment_path: x.attachment_path ?? '',
        attachment_url:  x.attachment_url ?? null,
        attachment_name: x.attachment_name ?? '',
        status: x.status === 'Inactive' ? 'Inactive' : 'Active',
      })));
      setKycOwners(owners.map((x: any) => ({
        id: `db_${x.id}`,
        owner_name: x.owner_name ?? '',
        designation: x.designation ?? '',
        official_email: x.official_email ?? '',
        phone_number: x.phone_number ?? '',
        id_proof_path:      x.id_proof_path ?? '',
        id_proof_url:       x.id_proof_url ?? null,
        id_proof_name:      x.id_proof_name ?? '',
        address_proof_path: x.address_proof_path ?? '',
        address_proof_url:  x.address_proof_url ?? null,
        address_proof_name: x.address_proof_name ?? '',
        photograph_path:    x.photograph_path ?? '',
        photograph_url:     x.photograph_url ?? null,
        photograph_name:    x.photograph_name ?? '',
        status: x.status === 'Inactive' ? 'Inactive' : 'Active',
      })));
    } catch { /* silent — KYC table just stays empty until next fetch */ }
  };

  /* Auto-save Stage 1 on the way to Stage 2. Creates the consignee
   * row (POST) the first time, then PUTs on subsequent transitions
   * to keep the saved record in sync with any edits made via the
   * Previous button. Without this, Stage 2 KYC POSTs have no
   * consignee_id to nest under. */
  const persistStage1 = async (): Promise<number | null> => {
    // Guard: in the Map-Consignee flow we receive a preselected
    // customer code but `customer` resolves only after /customers
    // returns. If the user mashes Save & Next during that window, we
    // would POST with customer_id = null and the server 422s. Refuse
    // to advance and surface a clear info toast instead — far better
    // than a cryptic backend error.
    if (!customer) {
      toast.info('Hold on', 'Loading the linked customer. Try again in a moment.');
      return null;
    }
    // Re-entry lock — if a previous save is still in flight, return
    // the id we already have (or null) instead of firing a second POST.
    // Without this, rapid Save-&-Next clicks created duplicate rows
    // because the second click read savedDbId before the first POST's
    // response had updated it.
    if (inFlightRef.current) {
      return consignee?.db_id ?? savedDbId;
    }
    inFlightRef.current = true;
    setSaving(true);
    // Min-display window — on fast networks the save can complete in
    // <50ms and the Save & Next spinner flashes imperceptibly. Force
    // ≥350ms of loader so users get clear "something happened"
    // feedback before the stage advances.
    const _saveStart = Date.now();
    try {
      const payload = buildPayload();
      let dbId = consignee?.db_id ?? savedDbId;
      if (dbId) {
        await api.put(`/consignees/${dbId}`, payload);
      } else {
        const r = await api.post('/consignees', payload);
        dbId = r.data?.data?.db_id ?? null;
        if (dbId) setSavedDbId(dbId);
      }
      // Mark this session as dirty so an early X/Cancel still triggers
      // the parent list refresh (without it the new row stays invisible
      // until the page reloads).
      dirtySavedRef.current = true;
      return dbId;
    } catch (err: any) {
      const apiErrors = err?.response?.data?.errors ?? null;
      if (apiErrors && typeof apiErrors === 'object') {
        // Backend "max 1 same-as-customer per customer" rejection.
        // Auto-untick the toggle so the user can save with their own
        // details — staying ticked would just trip the same 422 again.
        if (apiErrors.same_as_customer) {
          const msg = Array.isArray(apiErrors.same_as_customer)
            ? String(apiErrors.same_as_customer[0])
            : String(apiErrors.same_as_customer);
          setSameAsCustomer(false);
          toast.error('Same-as-Customer blocked', msg);
          return null;
        }
        const map: Record<string, string> = {
          'company_name':   'companyName',
          'legal_name':     'legalName',
          'segment':        'segment',
          'classification': 'classification',
          'risk_level':     'risk',
          'website':        'website',
          'primary_address.type':           'addressType',
          'primary_address.address_line':   'address',
          'primary_address.country':        'country',
          'primary_address.state':          'state',
          'primary_address.city':           'city',
          'primary_address.pin':            'pin',
          'primary_address.cp_name':        'contactName',
          'primary_address.cp_designation': 'designation',
          'primary_address.cp_contact':     'contactNo',
          'primary_address.cp_email':       'email',
          'primary_address.cp_whatsapp':    'whatsapp',
        };
        const next: Record<string, string> = {};
        for (const [k, msgs] of Object.entries(apiErrors)) {
          const msg = Array.isArray(msgs) ? String((msgs as any[])[0]) : String(msgs);
          next[map[k] ?? k] = msg;
        }
        setErrors1(next);
        toast.error('Save failed', Object.values(next)[0] ?? 'Please review the form');
      } else {
        toast.error('Save failed', err?.response?.data?.message ?? 'Please try again.');
      }
      return null;
    } finally {
      const elapsed = Date.now() - _saveStart;
      if (elapsed < 350) await new Promise(r => setTimeout(r, 350 - elapsed));
      setSaving(false);
      inFlightRef.current = false;
    }
  };

  const goNext = async () => {
    if (stage === 1) {
      const e = validateStage1();
      setErrors1(e);
      if (Object.keys(e).length > 0) {
        const firstKey = Object.keys(e)[0];
        // Toast suppressed — the inline red error + auto-scroll below
        // already surface the rejection without a second popup layer.
        setIdTab('identification');
        // Scroll the first offending field into view so the red
        // border is visible even when the body has scrolled past it.
        setTimeout(() => {
          document.querySelector<HTMLElement>(`[data-field="${firstKey}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 0);
        return;
      }
      /* Sub-tab cycling: persist Stage 1 on the first Save & Next so
       * the Identification tab edits are committed, then move to the
       * Address & Contact sub-tab. The second Save & Next from
       * Address & Contact crosses into Stage 2. Mirrors AddCustomerModal
       * so both modals behave the same way. */
      if (idTab === 'identification') {
        const id = await persistStage1();
        if (!id) return;
        setIdTab('address-contact');
        return;
      }
      // Leaving Stage 1 entirely → persist so Stage 2 KYC has a target.
      const id = await persistStage1();
      if (!id) return;
      /* If "Same as Customer" is ticked, fire the deep-clone endpoint.
       * The backend uses replace semantics — each call wipes the
       * consignee's existing Stage 2 KYC and re-mirrors fresh from
       * the customer. So re-ticking + re-saving always produces an
       * exact mirror, even after the customer's KYC has been edited
       * since the consignee was first created. */
      if (sameAsCustomer && customer?.db_id) {
        try {
          const r = await api.post(`/consignees/${id}/clone-from-customer`, { customer_id: customer.db_id });
          await refetchKyc(id);
          const cloned = r.data?.cloned ?? { documents: 0, owners: 0 };
          toast.success('Customer KYC mirrored',
            `${cloned.documents} doc${cloned.documents === 1 ? '' : 's'} + ${cloned.owners} owner${cloned.owners === 1 ? '' : 's'} copied with files.`);
        } catch (err: any) {
          toast.warning('KYC clone partial', err?.response?.data?.message ?? 'Some KYC rows may not have copied — review Stage 2.');
        }
      }
      setStage(2); setMaxStage(m => Math.max(m, 2) as Stage);
      return;
    }
    if (stage === 2) {
      /* Stage 2 (final): walk Company DD → Owner KYC → Trade Licence,
       * each getting its own Save & Next step. On the last sub-tab the
       * primary button submits the consignee — there is no Stage 3
       * (Evidence Vault) to step into anymore. */
      if (kycSub === 'company-dd')  { setKycSub('owner-kyc');    return; }
      if (kycSub === 'owner-kyc')   { setKycSub('trade-licence'); return; }
      handleSave();
      return;
    }
  };
  const goBack = () => {
    if (stage === 1) {
      if (idTab === 'address-contact') setIdTab('identification');
      return;
    }
    // Stage 2: step backwards through the sub-tabs before falling back
    // to Stage 1's last sub-tab.
    if (kycSub === 'trade-licence') { setKycSub('owner-kyc'); return; }
    if (kycSub === 'owner-kyc')     { setKycSub('company-dd'); return; }
    setStage(1); setIdTab('address-contact');
  };

  /* Jump straight to any already-reached stage from the stepper (click
   * a step header). Mirrors AddCustomerModal.gotoStage: forward jumps to
   * not-yet-reached stages are blocked; landing on Stage 1 resets its
   * sub-tab so the user sees Identification first. */
  const gotoStage = (s: Stage) => {
    if (s > maxStage || s === stage) return;
    setStage(s);
    if (s === 1) setIdTab('identification');
  };

  /* Build the POST/PUT payload from form1 + locations. Mirrors the
   * shape declared in ConsigneeController::validatePayload(). The
   * additional `locations` table is included; Stage 2 KYC docs + Owner
   * KYC rows stay in-memory until the KYC backend lands. */
  /* Normalize the pin code before sending so the backend's strict
   * `regex:/^\d{6}$/` rule doesn't trip on legacy / partial values.
   * Anything that isn't exactly 6 digits arrives as null — the
   * `nullable` rule then lets it through, and the user can correct
   * the row on the next edit. */
  const cleanPin = (v: any): string | null => {
    const s = String(v ?? '').trim();
    return /^\d{6}$/.test(s) ? s : null;
  };
  const buildPayload = () => {
    const primaryId = customer?.db_id ?? (Number(customer?.id?.replace(/[^0-9]/g, '')) || null);
    // Full many-to-many mapping = primary + any additionally-checked customers.
    const customerIds = Array.from(new Set(
      [primaryId, ...extraCustomerIds].filter((x): x is number => typeof x === 'number' && !!x),
    ));
    return {
    customer_id:      primaryId,
    customer_ids:     customerIds,
    company_name:     form1.companyName,
    legal_name:       form1.legalName || null,
    /* Multi-segment is comma-joined for the legacy scalar column. The
     * first entry stays the "primary" segment so existing list-row
     * callers keep working. */
    segment:          (form1.segment ?? []).length > 0 ? (form1.segment ?? []).join(', ') : null,
    classification:   form1.classification || null,
    risk_level:       form1.risk || null,
    website:          form1.website || null,
    status:           'Active' as const,
    /* Persist the "Same as Customer" toggle so the Customers list
     * knows which customers have mirrored consignees attached. The
     * Edit Customer button uses this flag to prompt a confirmation
     * warning before opening the wizard. */
    same_as_customer: sameAsCustomer,
    primary_address: {
      type:           form1.addressType,
      address_line:   form1.address,
      country:        form1.country,
      state:          form1.state,
      city:           form1.city,
      pin:            cleanPin(form1.pin),
      cp_name:        form1.contactName,
      cp_designation: form1.designation,
      cp_contact:     form1.contactNo,
      cp_email:       form1.email,
      cp_whatsapp:    form1.whatsapp?.toLowerCase() === 'yes' ? 'yes' : 'no',
    },
    locations: locations.map(l => ({
      type:           l.type,
      address_line:   l.line,
      country:        l.country,
      state:          l.state,
      city:           l.city,
      pin:            cleanPin(l.pin),
      cp_name:        l.cpName,
      cp_designation: l.cpDesignation,
      cp_contact:     l.cpContact,
      cp_email:       l.cpEmail,
      cp_whatsapp:    l.cpWhatsapp,
    })),
    };
  };

  const handleSave = async () => {
    // Synchronous re-entry lock — see comment on inFlightRef. The
    // saving state is async; a ref blocks duplicate calls on the
    // very same tick.
    if (inFlightRef.current || saving) return;
    // Final Stage 1 validation — a user can navigate back from Stage 3
    // and edit the form before Save Consignee, so the gate has to fire
    // here too. Snap back to Stage 1 / identification tab if anything
    // is missing so the inline red borders are visible.
    const e = validateStage1();
    if (Object.keys(e).length > 0) {
      setErrors1(e);
      setStage(1);
      setIdTab('identification');
      // Toast suppressed — inline red errors handle this.
      return;
    }

    inFlightRef.current = true;
    setSaving(true);
    try {
      const payload = buildPayload();
      // Prefer consignee.db_id (edit mode) BUT fall back to savedDbId
      // (the id of the row persistStage1 just created in this session).
      // Without that fallback, the final Save Consignee click would POST
      // a *second* row for a consignee that persistStage1 already
      // created — silent duplicate on the list. Same pattern as
      // persistStage1's own idempotent check.
      const persistedDbId = consignee?.db_id ?? savedDbId;
      if (persistedDbId) {
        await api.put(`/consignees/${persistedDbId}`, payload);
      } else {
        const r = await api.post('/consignees', payload);
        const newId = r.data?.data?.db_id ?? null;
        if (newId) setSavedDbId(newId);
      }
      // Final submit succeeded → drop the remembered stage so a future
      // re-open of this consignee starts fresh on Stage 1 instead of
      // bouncing back to Stage 3 (where this submit fired from).
      if (persistedDbId) consigneeStageMemory.delete(persistedDbId);
      toast.success('Consignee saved', `${form1.companyName} linked to ${customer?.name ?? 'customer'}`);
      onSaved?.();
      onClose();
    } catch (err: any) {
      // Surface Laravel 422 errors back to the matching field. Server
      // sends { errors: { 'primary_address.cp_email': [...] } }.
      const apiErrors = err?.response?.data?.errors ?? null;
      if (apiErrors && typeof apiErrors === 'object') {
        const map: Record<string, string> = {
          'company_name':   'companyName',
          'legal_name':     'legalName',
          'segment':        'segment',
          'classification': 'classification',
          'risk_level':     'risk',
          'website':        'website',
          'primary_address.type':           'addressType',
          'primary_address.address_line':   'address',
          'primary_address.country':        'country',
          'primary_address.state':          'state',
          'primary_address.city':           'city',
          'primary_address.pin':            'pin',
          'primary_address.cp_name':        'contactName',
          'primary_address.cp_designation': 'designation',
          'primary_address.cp_contact':     'contactNo',
          'primary_address.cp_email':       'email',
          'primary_address.cp_whatsapp':    'whatsapp',
        };
        const next: Record<string, string> = {};
        for (const [k, msgs] of Object.entries(apiErrors)) {
          const msg = Array.isArray(msgs) ? String((msgs as any[])[0]) : String(msgs);
          next[map[k] ?? k] = msg;
        }
        setErrors1(next);
        setStage(1);
        setIdTab('identification');
        toast.error('Save failed', Object.values(next)[0] ?? 'Please review the form');
      } else {
        toast.error('Save failed', err?.response?.data?.message ?? 'Please try again.');
      }
    } finally {
      setSaving(false);
      inFlightRef.current = false;
    }
  };

  /* ─── Render: phase A — customer picker ─── */
  /* Never show the picker in edit mode (or the Map-Consignee preselect flow):
     `phase` initialises to 'pick-customer' and only flips to 'wizard' in a
     post-render effect, which briefly flashed the picker before the wizard.
     Guarding the render here goes straight to the wizard (its hydration
     shimmer covers the moment before the customer resolves). */
  if (phase === 'pick-customer' && !consignee && !preselectedCustomerId && !preselectedCustomerDbId) {
    return (
      <div className="acm-overlay">
        <style>{SCOPED_CSS}</style>
        <div className="acm-pick" onMouseDown={e => e.stopPropagation()}>
          <div className="acm-pick-header">
            <button className="acm-close" onClick={handleClose} aria-label="Close"><IconClose /></button>
            <div className="acm-pick-icon"><IconTruck size={28} /></div>
            <div className="acm-pick-title">Add New Consignee</div>
            <div className="acm-pick-sub">Select one or more customer accounts this consignee will be linked to. The first pick is the primary customer.</div>
          </div>
          <div className="acm-pick-body">
            <label className="acm-label">
              <IconUser /> CUSTOMER ACCOUNT <span className="acm-req">*</span>
            </label>
            <div className="acm-picker-wrap">
            <div className="acm-picker" onClick={() => setSearchOpen(true)}>
              <IconSearch />
              <input
                type="text"
                placeholder={pickedCount > 0 ? `${pickedCount} customer${pickedCount > 1 ? 's' : ''} selected — search to add more` : 'Search by name, ID, or segment...'}
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
                {filteredCustomers.map(c => {
                  const picked = isCustomerPicked(c);
                  const isPrimary = !!c.db_id && customer?.db_id === c.db_id;
                  return (
                  <button
                    key={c.id}
                    className={`acm-picker-option ${picked ? 'is-picked' : ''}`}
                    onClick={() => togglePickCustomer(c)}
                  >
                    <input
                      type="checkbox"
                      checked={picked}
                      readOnly
                      style={{ marginRight: 4, width: 15, height: 15, flex: '0 0 auto' }}
                    />
                    <div className="acm-pop-avatar">{c.initials}</div>
                    <div className="acm-pop-info">
                      <div className="acm-pop-name">
                        {c.name}
                        {isPrimary && <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, color: '#0f766e', background: '#ccfbf1', borderRadius: 20, padding: '1px 7px' }}>PRIMARY</span>}
                      </div>
                      <div className="acm-pop-meta">{c.id} • {c.segment} • {c.country}</div>
                    </div>
                  </button>
                  );
                })}
              </div>
            )}
            </div>

            {customer && (
              <>
                <div className="acm-picked">
                  <div className="acm-picked-avatar">{customer.initials}</div>
                  <div className="acm-picked-info">
                    <div className="acm-picked-name">
                      {customer.name}
                      <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, color: '#0f766e', background: '#ccfbf1', borderRadius: 20, padding: '1px 7px' }}>PRIMARY</span>
                    </div>
                    <div className="acm-picked-meta">{customer.id} • {customer.segment} • {customer.country}</div>
                  </div>
                  <button className="acm-picked-clear" onClick={() => togglePickCustomer(customer)} aria-label="Clear selection"><IconClose size={14} /></button>
                </div>
                {extraCustomerIds.length > 0 && (
                  <div className="d-flex flex-wrap" style={{ gap: 6, marginTop: 8 }}>
                    {extraCustomerIds.map(eid => {
                      const o = customerOptions.find(c => c.db_id === eid);
                      if (!o) return null;
                      return (
                        <span key={eid} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: '#0c63b0', background: '#dceefe', borderRadius: 20, padding: '3px 10px' }}>
                          {o.id} · {o.name}
                          <span role="button" onClick={() => togglePickCustomer(o)} style={{ cursor: 'pointer', display: 'inline-flex' }} aria-label={`Remove ${o.name}`}><IconClose size={12} /></span>
                        </span>
                      );
                    })}
                  </div>
                )}
              </>
            )}

            <div className="acm-info">
              <div className="acm-info-icon"><IconInfo /></div>
              <div>
                The consignee will be <strong>linked to the selected customer</strong> and used for shipment delivery, export documentation, and traceability across all trade workflows.
              </div>
            </div>
          </div>
          <div className="acm-pick-footer">
            <button className="acm-btn acm-btn-light" onClick={handleClose}><IconClose size={14} /> Cancel</button>
            <button
              className={`acm-btn acm-btn-primary ${customer ? '' : 'acm-btn-disabled'}`}
              onClick={confirmCustomer}
              disabled={!customer}
            >
              <IconCheck /> Confirm &amp; Continue{pickedCount > 1 ? ` (${pickedCount})` : ''}
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
    <div className="acm-overlay">
      <style>{SCOPED_CSS}</style>
      <div className={`acm-wiz ${subOpen ? 'acm-wiz-blurred' : ''}`}>
        {/* Header — title flips to Edit mode when the modal opens with
             an existing consignee row attached (db_id present), so the
             user can tell at a glance whether they're creating or
             modifying. Subtitle changes too for parallel symmetry. */}
        <div className="acm-wiz-header">
          <div className="acm-wiz-hicon"><IconTruck size={20} /></div>
          <div className="acm-wiz-htxt">
            <div className="acm-wiz-htitle">{consignee?.db_id ? 'Edit Consignee' : 'Add Consignee'}</div>
            <div className="acm-wiz-hsub">
              {consignee?.db_id
                ? 'Update consignee identity, KYC, and trade documents.'
                : 'Capture consignee identity, customer linkage, compliance, and shipment readiness for export execution.'}
            </div>
          </div>
          <button className="acm-close" onClick={handleClose} aria-label="Close"><IconClose /></button>
        </div>
                  {customer && (
            <div className={`${linkedHidden ? '' : 'is-open'}`}>
              <div className="acg-linked-bar" onClick={() => setLinkedHidden(h => !h)} role="button">
                <div className="acg-linked-bar-left">
                  <div className="acg-linked-icon"><IconUser /></div>
                  <div className="acg-linked-title">
                    <span className="acg-linked-tag">LINKED CUSTOMER</span>
                    <span className="acg-linked-id">{customer.id}</span>
                    <span className="acg-linked-name">{customer.name}</span>
                    {/* Additionally-mapped customers selected via the checkbox
                        list below — surfaced here as chips so the header shows
                        every customer this consignee links to. */}
                    {extraCustomerIds.length > 0 && (
                      <span className="d-inline-flex align-items-center flex-wrap" style={{ gap: 4, marginLeft: 4 }}>
                        {extraCustomerIds.map(eid => {
                          const o = customerOptions.find(c => c.db_id === eid);
                          return (
                            <span key={eid} style={{ fontSize: 11, fontWeight: 700, color: '#0c63b0', background: '#dceefe', borderRadius: 20, padding: '1px 8px' }}>
                              +{o?.id ?? eid}
                            </span>
                          );
                        })}
                      </span>
                    )}
                  </div>
                </div>
                <div className="acg-linked-actions">
                  {sameAsCustomer && <span className="acg-linked-badge">Same as Customer</span>}
                  {/* Figma: a "Show / Hide" pill (text + chevron), not a bare arrow. */}
                  <span className="acg-linked-toggle">
                    {linkedHidden ? 'Show' : 'Hide'}
                    <span className={`acg-linked-chev ${linkedHidden ? '' : 'is-open'}`}><IconChevronDown /></span>
                  </span>
                </div>
              </div>
              {!linkedHidden && (
                <>
                  <div className="acg-hs-mirror">
                    <div className="acg-hs-grid">
                      <ReadInlineG label="Customer ID"          value={customer.id} />
                      <ReadInlineG label="Company Name"         value={customer.name} />
                      <ReadInlineG label="Company Legal Name"    value={customer.legalName} />
                      <ReadInlineG label="Customer Type"        value={customer.type} />

                      <ReadInlineG label="Customer Segment"     value={segDisplay(customer.segment, mSegmentIds)} />
                      <ReadInlineG label="Classification"       value={customer.classification} />
                      <ReadInlineG label="Risk Level"           value={customer.risk} />
                      <ReadInlineG label="Company Website"      value={customer.website} />

                      <ReadInlineG label="Registered Office Address" value={customer.address} span={2} />
                      <ReadInlineG label="Country"              value={customer.country} />
                      <ReadInlineG label="State"                value={customer.state} />

                      <ReadInlineG label="City"                 value={customer.city} />
                      <ReadInlineG label="PIN / Postal Code"    value={customer.pin} />
                      <ReadInlineG label="Contact Person Name"  value={customer.contactPerson} />
                      <ReadInlineG label="Designation"          value={customer.designation} />

                      <ReadInlineG label="Contact No"           value={customer.phone} />
                      <ReadInlineG label="Email"                value={customer.email} />
                      <ReadInlineG label="WhatsApp Enabled"     value={customer.whatsapp} />
                    </div>
                  </div>

                  {/* Data of the ADDITIONALLY-mapped customers (checkbox list
                      selections). Read-only recap so the user can confirm which
                      other customers this consignee links to. */}
                  {extraCustomerIds.length > 0 && (
                    <div className="acg-hs-mirror" style={{ marginTop: 8 }}>
                      <div style={{ fontSize: 11.5, fontWeight: 700, color: '#0c63b0', letterSpacing: 0.3, marginBottom: 6 }}>
                        ALSO MAPPED CUSTOMERS ({extraCustomerIds.length})
                      </div>
                      {extraCustomerIds.map(eid => {
                        const o = customerOptions.find(c => c.db_id === eid);
                        if (!o) return null;
                        return (
                          <div key={eid} className="acg-hs-grid" style={{ marginBottom: 6 }}>
                            <ReadInlineG label="Customer ID"         value={o.id} />
                            <ReadInlineG label="Company Name"        value={o.name} />
                            <ReadInlineG label="Segment"             value={segDisplay(o.segment, mSegmentIds)} />
                            <ReadInlineG label="Contact Person"      value={o.contactPerson} />
                            <ReadInlineG label="Contact No"          value={o.phone} />
                            <ReadInlineG label="Email"               value={o.email} />
                            <ReadInlineG label="City"                value={o.city} />
                            <ReadInlineG label="Country"             value={o.country} />
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Stage 2 KYC stat cards — merged into the Linked
                      Customer panel when Same as Customer is on so the
                      user sees ONE consolidated read-only block instead
                      of a redundant "What you did in previous stages"
                      panel below. Shown from Stage 2 onwards (the stats
                      are meaningless before the user reaches KYC). */}
                  {sameAsCustomer && stage >= 2 && (() => {
                    const segKeys = Object.keys(segmentRefUploads);
                    const segDd  = segKeys.filter(k => k.startsWith('company-dd::')).length;
                    const segOwn = segKeys.filter(k => k.startsWith('owner-kyc::')).length;
                    const segTl  = segKeys.filter(k => k.startsWith('trade-licence::')).length;
                    const ddCount    = kycDocs.filter(d => d.kind === 'dd').length + segDd;
                    const ownerCount = kycOwners.length + segOwn;
                    const tlCount    = kycDocs.filter(d => d.kind === 'tl').length + segTl;
                    const total      = ddCount + ownerCount + tlCount;
                    return (
                      <div className="acg-hs-mirror acg-hs-stats-wrap">
                        <div className="acg-hs-stats">
                          <div className="acg-hs-stat"><div className="acg-hs-stat-num">{ddCount}</div><div className="acg-hs-stat-lbl">DD Docs</div></div>
                          <div className="acg-hs-stat"><div className="acg-hs-stat-num">{ownerCount}</div><div className="acg-hs-stat-lbl">Owner KYC</div></div>
                          <div className="acg-hs-stat"><div className="acg-hs-stat-num">{tlCount}</div><div className="acg-hs-stat-lbl">Trade Lic.</div></div>
                          <div className="acg-hs-stat"><div className="acg-hs-stat-num">{total}</div><div className="acg-hs-stat-lbl">Total</div></div>
                        </div>
                      </div>
                    );
                  })()}
                </>
              )}
            </div>
          )}

        {/* ── Also map to other customers (many-to-many) ─────────────────
            A single consignee can be linked to multiple customers. The
            primary (Linked Customer above) is always included; tick more
            here to map them too. Disabled while "Same as Customer" is on
            (that KYC mirror is strictly 1:1). */}
        {customer && (
          <div className="acm-map-customers" style={{ margin: '10px 0 4px', border: '1px solid #e5e7eb', borderRadius: 10, padding: '12px 14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: '#334155', letterSpacing: 0.2 }}>
                ALSO MAP TO OTHER CUSTOMERS
                {extraCustomerIds.length > 0 && (
                  <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 700, color: '#0c63b0', background: '#dceefe', borderRadius: 20, padding: '1px 8px' }}>
                    {extraCustomerIds.length} selected
                  </span>
                )}
              </div>
            </div>
            {sameAsCustomer ? (
              <div style={{ fontSize: 12, color: '#94a3b8' }}>
                Not available while “Same as Customer” is on — that mirror links exactly one customer.
              </div>
            ) : (
              <>
                <input
                  className="acm-inp"
                  value={extraSearch}
                  onChange={e => setExtraSearch(e.target.value)}
                  placeholder="Search customers to map…"
                  style={{ width: '100%', marginBottom: 8, padding: '7px 10px', borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 13 }}
                />
                <div style={{ maxHeight: 168, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {customerOptions
                    .filter(o => o.db_id && o.db_id !== customer.db_id)
                    .filter(o => {
                      const n = extraSearch.trim().toLowerCase();
                      return !n || o.name.toLowerCase().includes(n) || o.id.toLowerCase().includes(n);
                    })
                    .map(o => {
                      const checked = extraCustomerIds.includes(o.db_id as number);
                      return (
                        <label key={o.db_id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 8px', borderRadius: 8, cursor: 'pointer', background: checked ? '#f0f9ff' : 'transparent' }}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => setExtraCustomerIds(prev =>
                              checked ? prev.filter(x => x !== o.db_id) : [...prev, o.db_id as number],
                            )}
                          />
                          <span style={{ fontSize: 12.5, fontWeight: 600, color: '#475569', minWidth: 58 }}>{o.id}</span>
                          <span style={{ fontSize: 12.5, color: '#334155' }}>{o.name}</span>
                        </label>
                      );
                    })}
                  {customerOptions.filter(o => o.db_id && o.db_id !== customer.db_id).length === 0 && (
                    <div style={{ fontSize: 12, color: '#94a3b8', padding: '6px 2px' }}>No other customers available.</div>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {/* Pinned top — stepper + Linked Customer summary stay
            visible while the rest of the body scrolls below them.
            Both elements appear in all three stages so keeping them
            anchored saves the user from scrolling back up to check
            which stage they're on or which customer they're linked
            to. Sits OUTSIDE .acm-wiz-body so the body's overflow
            scroll only affects the form / table content below. */}
        <div className="acm-wiz-pinned-top">
          {/* Linked Customer summary — uses the same slim collapsible
              panel + compact 4-col "Label : Value" grid as the "What
              you did in previous stages" recap, so every read-only
              data block in the modal looks identical. */}


          {/* 3-step indicator — sits BELOW the Linked Customer summary so the
              order matches the Figma: header → customer summary → stepper →
              tabs. */}
          <div className="acm-steps">
            {/* Completion 'done' tick removed (user request) — a green ✓ used
                to appear even with nothing uploaded / trade docs unsent
                (Evidence Vault is design-only), which read as "done" and
                confused users. Visited steps now stay neutral ('incomplete')
                showing just their number; no ✓ on any step. */}
            <StepNode
              n={1}
              title="Consignee Legal Identity"
              sub="Company, address & contact"
              status={stage === 1 ? 'active' : 1 <= maxStage ? 'done' : 'idle'}
              icon={<IconHome />}
              clickable={stage !== 1 && 1 <= maxStage}
              onClick={() => gotoStage(1)}
            />
            <div className="acm-steps-arrow"><IconChevronRight /></div>
            <StepNode
              n={2}
              title="KYC / Due Diligence"
              sub="Docs, identity & compliance"
              /* 'done' only when we've actually moved PAST this step (stage > 2),
                 NOT merely because it was completed in a prior session. On the
                 edit form opened at stage 1, KYC therefore shows as a reachable
                 (clickable) numbered step — you can jump straight to it, but it
                 isn't marked complete, which avoided the confusion of both
                 stages looking done on open. */
              status={stage === 2 ? 'active' : stage > 2 ? 'done' : 2 <= maxStage ? 'incomplete' : 'idle'}
              icon={<IconDoc />}
              clickable={stage !== 2 && 2 <= maxStage}
              onClick={() => gotoStage(2)}
            />
            {/* Stage 3 (Evidence Vault) removed — KYC / Trade-document
                uploads now live in the standalone ConsigneeEvidenceVaultModal. */}
          </div>
        </div>

        {/* Scrolling body — only the stage-specific form / tables /
            banners scroll. The pinned section above stays put. */}
        <div className="acm-wiz-body">
          {/* Hydration UX — show the full-form shimmer while EITHER
              /consignees/:id resolves (edit mode) OR the initial
              master-bundle load is in flight. The skeleton swaps to
              the populated form in one frame once everything lands. */}
          {stage === 1 && showShimmer && <Stage1FormShimmer />}
          {stage === 1 && !showShimmer && (
            <Stage1
              tab={idTab}
              setTab={requestIdTab}
              form={form1}
              setForm={setForm1}
              segCodeMap={segCodeMap}
              uploadedCodes={Object.entries(segmentRefUploads)
                .filter(([, v]) => !!(v && (v.url || v.file)))
                .map(([k]) => k.split('::')[1])}
              onBlockedSegmentRemove={(segs) => toast.error('Cannot remove segment', `You can't remove ${segs.join(', ')} — ${segs.length > 1 ? 'they have' : 'it has'} completed standard documents. Delete those documents first to drop the segment.`)}
              errors={errors1}
              clearErr={(k) => setErrors1(prev => { if (!prev[k]) return prev; const n = { ...prev }; delete n[k]; return n; })}
              validateField={validateField1}
              sameAsCustomer={sameAsCustomer}
              setSameAsCustomer={(v) => {
                /* Block-on-tick: if the user tries to enable
                 * Same-as-Customer for a customer that already has its
                 * one allowed mirror (and we're not editing that mirror
                 * ourselves), surface the constraint *immediately* via
                 * toast instead of letting them fill the form and then
                 * hit a 422 at Save & Next. Toggle stays unticked
                 * because we return before setSameAsCustomer fires.
                 *
                 * `existingMirrorCount` from the parent popup is the
                 * source of truth when provided — it's computed from a
                 * just-refreshed consignee list. Falls back to the
                 * customer-list count for standalone usage. */
                const mirrorCount = existingMirrorCount ?? customer?.sameAsCustomerConsigneeCount ?? 0;
                const alreadyMirrored =
                  mirrorCount > 0 && !(consignee?.same_as_customer === true);
                if (v && alreadyMirrored) {
                  toast.error('Only one Same-as-Customer allowed', 'This customer already has one.');
                  return;
                }
                // Same-as-Customer is 1:1 — not allowed when the consignee is
                // mapped to additional customers.
                if (v && extraCustomerIds.length > 0) {
                  toast.error('Not available with multiple customers', 'Remove the extra mapped customers to use “Same as Customer”.');
                  return;
                }

                setSameAsCustomer(v);
                /* Auto-toggle the linked-customer detail panel with the
                 * checkbox so the rule "customer details visible iff
                 * Same-as-Customer is ticked" actually holds. Picking a
                 * customer from the dropdown alone leaves the panel
                 * collapsed (just the id + name bar). */
                setLinkedHidden(!v);
                /* Tick  = useEffect mirrors customer's Stage 1 fields +
                 *         additional addresses onto form1 + locations[].
                 *         After Stage 1 save, persistStage1 then fires the
                 *         clone-from-customer backend endpoint to copy KYC
                 *         docs + owners (with file attachments).
                 * Untick = KEEP the mirrored values in form1 + locations
                 *         and just unlock the inputs so the user can
                 *         tweak any field. Wiping on untick (the old
                 *         behaviour) forced users to start over even
                 *         though most of the customer data was almost
                 *         certainly what they wanted — they just needed
                 *         to edit one or two fields. Stage 2 KYC lives
                 *         on the server so it isn't touched here either.
                 */
                if (!v) {
                  setErrors1({});
                  /* Clear the auto-filled preview on untick — but ONLY
                   * while this consignee hasn't been saved yet (no Save &
                   * Next done). Before the first save, ticking
                   * Same-as-Customer is just an autofill preview, so
                   * unticking should undo it and leave a blank form. Once
                   * it's been persisted (edit mode, or savedDbId set after
                   * a Save & Next) the mirrored values are the user's own
                   * committed data, so we keep them and just unlock the
                   * fields for editing instead of wiping their work. */
                  const notYetSaved = !consignee?.db_id && !savedDbId;
                  if (notYetSaved) {
                    /* Segment is INHERITED from the linked customer (it's not
                     * part of the "same as customer" copy — it comes from the
                     * customer regardless). So on untick, clear the mirrored
                     * fields but KEEP the customer's segment instead of wiping
                     * it to []. */
                    const inheritedSegs = String(customer?.segment ?? '').split(',').map(s => s.trim()).filter(Boolean);
                    setForm1({
                      companyName: '', legalName: '', website: '', segment: inheritedSegs, classification: '', risk: '',
                      addressType: 'Registered Office', address: '', country: '', state: '', city: '', pin: '',
                      contactName: '', designation: '', contactNo: '', email: '', whatsapp: 'Yes',
                    });
                    setLocations([]);
                  }
                }
              }}
              customer={customer}
              /* Block ticking when this customer already has another
               * same-as-customer consignee. Editing the mirror itself
               * stays allowed (the row being edited IS the mirror, so
               * keeping the tick is just preservation).
               *
               * Prefer `existingMirrorCount` (live count from the
               * parent popup) when provided; otherwise fall back to
               * the customer-list withCount. */
              mirrorAlreadyTakenByOther={
                (existingMirrorCount ?? customer?.sameAsCustomerConsigneeCount ?? 0) > 0 &&
                !(consignee?.same_as_customer === true)
              }
              /* Lock the toggle once the Consignee Identification Details tab
                 is COMPLETE (all required fields filled) on a self-entered
                 consignee — so a later click on "Same as Customer" can't wipe
                 the details the user already typed. A same-as-customer row
                 (toggle already on) is NOT locked, so a mistaken mirror can
                 still be unticked + edited; the "one mirror per customer"
                 constraint above still guards re-ticking. */
              mirrorLocked={
                // Editing a consignee already SAVED as Same-as-Customer → lock
                // it ON so it can't be unticked here.
                (sameAsCustomer && consignee?.same_as_customer === true) ||
                // OR self-entered consignee with completed basic details → lock
                // it OFF so a later tick can't overwrite the typed details.
                (!sameAsCustomer &&
                  !!form1.companyName?.trim() &&
                  !!form1.legalName?.trim() &&
                  (form1.segment?.length ?? 0) > 0 &&
                  !!form1.risk)
              }
              /* Clicking the DISABLED toggle still surfaces a short toast so
                 the user knows why it's locked (a native disabled input is
                 silent). */
              onBlockedClick={() => {
                const alreadyMirrored =
                  (existingMirrorCount ?? customer?.sameAsCustomerConsigneeCount ?? 0) > 0 &&
                  !(consignee?.same_as_customer === true);
                if (!customer) toast.info('Pick a customer first', '');
                else if (sameAsCustomer) toast.info('Linked as Same as Customer', "This consignee mirrors the customer — you can't untick it here.");
                else if (alreadyMirrored) toast.error('Only one Same-as-Customer allowed', 'This customer already has one.');
                else toast.info('Basic details already completed', "You can't mark this consignee as Same as Customer now.");
              }}
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
              form1={form1}
              locations={locations}
              consigneeCode={consignee?.id}
              sameAsCustomer={sameAsCustomer}
              segmentName={(form1.segment ?? []).join(', ')}
              segmentDocs={segmentDocs}
              loading={segmentDocsLoading}
              segmentRefUploads={segmentRefUploads}
              setSegmentRefUploads={setSegmentRefUploads}
              persistSegmentRefUpload={persistSegmentRefUpload}
              segments={mSegmentIds}
            />
          )}
          {/* Stage 3 (Evidence Vault) body removed — KYC / Trade-document
              uploads now live in the standalone ConsigneeEvidenceVaultModal. */}
        </div>

        {/* Footer */}
        <div className="acm-wiz-footer">
          <button className="acm-btn acm-btn-light" onClick={handleClose}><IconClose size={14} /> Cancel</button>
          <div className="acm-footer-right">
            {stage > 1 && (
              <button className="acm-btn acm-btn-light" onClick={goBack}>
                <IconChevronLeft /> Previous
              </button>
            )}
            {(() => {
              /* Single primary action button: cycles sub-tabs while there
               * are more ahead, then morphs into Save Consignee on the
               * final Stage 2 › Trade Licence sub-tab. goNext owns the
               * final dispatch (there's no Stage 3 / Evidence Vault). */
              const onFinalTab = stage === 2 && kycSub === 'trade-licence';
              return onFinalTab ? (
                <button
                  className="acm-btn acm-btn-primary"
                  onClick={goNext}
                  disabled={saving}
                  style={saving ? { opacity: 0.75, cursor: 'wait' } : undefined}
                >
                  {saving ? <IconSpinner size={18} /> : <IconCheck />} {saving ? 'Saving…' : 'Save Consignee'}
                </button>
              ) : (
                <button
                  className="acm-btn acm-btn-primary"
                  onClick={goNext}
                  disabled={saving}
                  style={saving ? { opacity: 0.55, cursor: 'wait' } : undefined}
                >
                  {saving
                    ? <><IconSpinner size={18} /> Saving…</>
                    : <>Save &amp; Next <IconChevronRight /></>}
                </button>
              );
            })()}
          </div>
        </div>
      </div>
    </div>

    {locModal.open && (() => {
      /* Collect every email + phone already used on this consignee —
       * primary contact (Stage 1) plus every additional location the
       * user has already added — minus the row currently being edited.
       * The sub-modal blocks save (and surfaces a real-time error)
       * when the user tries to enter a value already in this set. */
      const editingId = locModal.editing;
      const otherLocs = editingId
        ? locations.filter(l => l.id !== editingId)
        : locations;
      const primaryEmail = (form1.email     || '').trim().toLowerCase();
      const primaryPhone = (form1.contactNo || '').trim();
      const existingEmails = [
        primaryEmail,
        ...otherLocs.map(l => (l.cpEmail || '').trim().toLowerCase()),
      ].filter(Boolean);
      const existingPhones = [
        primaryPhone,
        ...otherLocs.map(l => (l.cpContact || '').trim()),
      ].filter(Boolean);
      /* Address type uniqueness — every type already used on this
       * consignee (primary + other locations) is blocked from the
       * dropdown so each type can only appear once. The row being
       * edited keeps its own value visible (handled inside the
       * sub-modal's availableAddressTypes filter). */
      const usedAddressTypes = [
        (form1.addressType || '').trim(),
        ...otherLocs.map(l => (l.type || '').trim()),
      ].filter(Boolean);
      return (
        <LocationSubModal
          editing={editingId ? locations.find(l => l.id === editingId) ?? null : null}
          masters={{
            addressTypes: mAddressTypes,
            countries: mCountries,
            states: mStates,
            designations: mDesignations,
          }}
          disallowedTypes={usedAddressTypes}
          existingEmails={existingEmails}
          existingPhones={existingPhones}
          onClose={() => setLocModal({ open: false, editing: null })}
          onSave={(rec) => {
            if (editingId) {
              setLocations(prev => prev.map(l => l.id === editingId ? { ...rec, id: l.id } : l));
            } else {
              setLocations(prev => [...prev, { ...rec, id: newLocId() }]);
            }
            setLocModal({ open: false, editing: null });
          }}
        />
      );
    })()}

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
        documentTypes={mDocumentTypes}
        editing={docModal.editingId ? kycDocs.find(d => d.id === docModal.editingId) ?? null : null}
        consigneeId={savedDbId}
        onClose={() => setDocModal({ open: false, sub: 'company-dd', editingId: null })}
        onSaved={async () => {
          await refetchKyc(savedDbId);
          setDocModal({ open: false, sub: 'company-dd', editingId: null });
        }}
      />
    )}

    {ownerModal.open && (
      <KycOwnerSubModal
        editing={ownerModal.editingId ? kycOwners.find(o => o.id === ownerModal.editingId) ?? null : null}
        consigneeId={savedDbId}
        designations={mDesignations}
        onClose={() => setOwnerModal({ open: false, editingId: null })}
        onSaved={async () => {
          await refetchKyc(savedDbId);
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
      onClose={() => { if (!kycDeleting) setKycDelModal({ open: false, kind: null, id: null }); }}
      loading={kycDeleting}
      onConfirm={async () => {
        const id = kycDelModal.id;
        const kind = kycDelModal.kind;
        if (!id || !savedDbId) {
          setKycDelModal({ open: false, kind: null, id: null });
          return;
        }
        // Server rows are stored under id = 'db_<numeric>' so we can
        // map back to the persisted row. Bare in-memory rows (no db_
        // prefix) can only be dropped from the table since they were
        // never persisted (shouldn't happen now that we auto-save
        // Stage 1, but kept as a defensive branch).
        if (id.startsWith('db_')) {
          const numericId = Number(id.replace('db_', ''));
          setKycDeleting(true);
          try {
            if (kind === 'owner') {
              await api.delete(`/consignees/${savedDbId}/owners/${numericId}`);
            } else {
              await api.delete(`/consignees/${savedDbId}/documents/${numericId}`);
            }
            await refetchKyc(savedDbId);
          } catch (err: any) {
            toast.error('Delete failed', err?.response?.data?.message ?? 'Please try again.');
          } finally {
            setKycDeleting(false);
            setKycDelModal({ open: false, kind: null, id: null });
          }
        } else {
          // Optimistic local-only drop fallback.
          if (kind === 'owner') setKycOwners(prev => prev.filter(o => o.id !== id));
          else if (kind === 'doc') setKycDocs(prev => prev.filter(d => d.id !== id));
          setKycDelModal({ open: false, kind: null, id: null });
        }
      }}
    />

    {/* Stage 3 Trade Documents → Send for Signature (Zoho Sign).
        Opens the Zoho Sign wizard pre-checked with the docs the user
        picked. modelName='Consignee' tells the backend to resolve the
        {{consignee.*}} token namespace from this consignee's data. */}
    <SalesCustomerSendForSignatureModal
      open={Array.isArray(sendForSignature)}
      modelName="Consignee"
      customer={(() => {
        const partyId = (consignee?.db_id ?? savedDbId) ?? null;
        if (!partyId) return null;
        return {
          id:      consignee?.id ?? `g-${partyId}`,
          db_id:   partyId,
          company: form1.companyName || '',
          contact: form1.contactName || '',
          email:   form1.email || '',
        };
      })()}
      preselectedDocIds={sendForSignature ?? undefined}
      onClose={() => setSendForSignature(null)}
      onSent={(sentDocIds) => {
        const sentSet = new Set(sentDocIds);
        setTdDocs(prev => prev.map(d => (d.db_id && sentSet.has(d.db_id))
          ? { ...d, sent: true, status: 'inprogress' as TdSigStatus }
          : d));
        setSendForSignature(null);
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

const StepNode = ({ n, title, sub, status, icon, clickable = false, onClick }: {
  n: number; title: string; sub: string;
  status: 'idle' | 'active' | 'done' | 'incomplete';
  icon: React.ReactNode;
  clickable?: boolean;
  onClick?: () => void;
}) => (
  <div
    className={`acm-step ${status === 'active' ? 'acm-step-active' : ''} ${status === 'done' ? 'acm-step-done' : ''} ${status === 'incomplete' ? 'acm-step-incomplete' : ''} ${clickable ? 'acm-step-clickable' : ''}`}
    onClick={clickable ? onClick : undefined}
    role={clickable ? 'button' : undefined}
    tabIndex={clickable ? 0 : undefined}
  >
    <div className="acm-step-badge">
      {/* Figma: completed step shows a white ✓ on the green badge. */}
      {status === 'done' ? <IconCheck /> : status === 'active' ? icon : <span>{n}</span>}
    </div>
    <div className="acm-step-text">
      <div className="acm-step-title">{title}</div>
      <div className="acm-step-sub">{sub}</div>
    </div>
    {status === 'done' && <div className="acm-step-done-mark"><IconCheck size={12} /></div>}
  </div>
);

const SectionHeader = ({ icon, title, sub, accent }: { icon: React.ReactNode; title: string; sub: string; accent?: string }) => {
  /* Glossy gradient badge (matches the stepper / linked-customer icons)
     instead of a flat fill. Blue accent → blue gradient; everything else
     → the brand green gradient. */
  const iconBg = accent === '#3b82f6'
    ? 'linear-gradient(135deg, #3b82f6, #1d4ed8)'
    : 'linear-gradient(135deg, #0d9488, #065f46)';
  return (
  <div className="acm-sec-header" style={accent ? { borderTopColor: accent } : undefined}>
    <div className="acm-sec-icon" style={{ background: iconBg }}>{icon}</div>
    <div>
      <div className="acm-sec-title">{title}</div>
      <span className="acm-sec-sep">|</span>
      <span className="acm-sec-sub">{sub}</span>
    </div>
  </div>
  );
};

/* Truncated table cell. Empty → muted dash. Short → render as-is.
 * Long → trim with an ellipsis and wrap in the project's portal-based
 * Tooltip so the full text shows on hover (clears table overflow
 * clipping, matches the look used everywhere else in the project). */
/* Attachment cell — renders a clickable View link when there's any
 * path or URL, an em-dash when not. Prefers the server-built `url`
 * (works when the public disk has its `url` key configured); falls
 * back to resolveFileUrl(path) for servers where Storage::url()
 * threw and `url` came back null. Always opens in a new tab. */
const AttachmentLink = ({ url, path, label = 'View' }: { url?: string | null; path?: string; label?: string }) => {
  const href = url || (path ? resolveFileUrl(path) : '');
  if (!href) return <span style={{ color: '#9ca3af' }}>—</span>;
  // Cache-bust on click so a freshly-uploaded replacement opens the
  // new file instead of the browser's cached copy. Done in onClick (not
  // in href) so the link doesn't churn every re-render — and so the
  // user can still middle-click / copy a stable URL if they want.
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="acm-kyc-attach acm-kyc-attach-link"
      onClick={(e) => {
        e.preventDefault();
        const sep = href.includes('?') ? '&' : '?';
        window.open(`${href}${sep}t=${Date.now()}`, '_blank', 'noopener,noreferrer');
      }}
    >
      {label}
    </a>
  );
};

const TruncatedCell = ({ text, max = 28, mono = false }: { text: string; max?: number; mono?: boolean }) => {
  const t = (text ?? '').trim();
  if (!t) return <span style={{ color: '#9ca3af' }}>—</span>;
  const style: React.CSSProperties | undefined = mono
    ? { fontFamily: 'ui-monospace, "JetBrains Mono", monospace', fontSize: 11.5 }
    : undefined;
  if (t.length <= max) return <span style={style}>{t}</span>;
  return (
    <Tooltip label={t} maxWidth={320}>
      <span style={style}>{t.slice(0, max - 1)}…</span>
    </Tooltip>
  );
};

const Field = ({ label, required, error, fieldKey, children }: { label: string; required?: boolean; error?: string; fieldKey?: string; children: React.ReactNode }) => (
  <div className="acm-field" data-field={fieldKey}>
    <label className="acm-field-label">
      {label.toUpperCase()} {required && <span className="acm-req">*</span>}
    </label>
    {children}
    {error && <span className="acm-err-text">{error}</span>}
  </div>
);

/* ─── Stage 1 skeleton ─────
 * Rendered while the edit-mode hydration fetch is in flight so the
 * user sees the section + field shape resolve in instead of empty
 * inputs flashing into populated state. Layout mirrors the actual
 * Stage 1 form: the Same-as-Customer banner row, Basic Company
 * Details (6 fields in a 2-col grid), and Primary Address & Contact
 * (Address Type+Address row, then 4-col Country/State/City/Pin, then
 * 4-col contact, then the WhatsApp radio row). Light + dark mode
 * inherit from the shared `.shimmer` styles in app.css. */
function Stage1FormShimmer() {
  const FieldShim = () => (
    <div className="acm-field">
      <Shimmer height={10} width="40%" radius={4} style={{ marginBottom: 7 }} />
      <Shimmer height={36} radius={9} />
    </div>
  );
  const Section = ({ rows, accent = '#10b981' }: { rows: { cols: number }[]; accent?: string }) => (
    <div style={{
      background: 'var(--shim-card-bg, #fff)',
      border: '1px solid var(--shim-border, #e5e7eb)',
      borderTop: `2px solid ${accent}`,
      borderRadius: 12,
      overflow: 'hidden',
      marginBottom: 16,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', background: 'var(--shim-secondary-bg, #f9fafb)', borderBottom: '1px solid var(--shim-border, #e5e7eb)' }}>
        <Shimmer width={28} height={28} radius={8} />
        <Shimmer height={12} width="32%" radius={4} />
      </div>
      <div style={{ padding: 14 }}>
        {rows.map((r, i) => (
          <div
            key={i}
            style={{
              display: 'grid',
              gridTemplateColumns: `repeat(${r.cols}, minmax(0, 1fr))`,
              gap: 14,
              marginBottom: i < rows.length - 1 ? 14 : 0,
            }}
          >
            {Array.from({ length: r.cols }).map((_, j) => <FieldShim key={j} />)}
          </div>
        ))}
      </div>
    </div>
  );
  return (
    <div>
      {/* Same-as-Customer banner placeholder */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: 14, borderRadius: 12, marginBottom: 14,
        background: 'var(--shim-secondary-bg, #f9fafb)',
        border: '1px solid var(--shim-border, #e5e7eb)',
      }}>
        <Shimmer width={22} height={22} radius={6} />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <Shimmer height={12} width="22%" radius={4} />
          <Shimmer height={10} width="65%" radius={4} />
        </div>
      </div>
      {/* Basic Company Details — 3 rows of 2 cols = 6 fields */}
      <Section rows={[{ cols: 2 }, { cols: 2 }, { cols: 2 }]} accent="#10b981" />
      {/* Primary Address & Contact — 1+2 / 4 / 4 / 1 */}
      <Section rows={[{ cols: 2 }, { cols: 4 }, { cols: 4 }, { cols: 1 }]} accent="#3b82f6" />
    </div>
  );
}

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
  tab, setTab, form, setForm, masters, errors, clearErr, validateField,
  sameAsCustomer, setSameAsCustomer, customer, mirrorAlreadyTakenByOther, mirrorLocked, onBlockedClick,
  locations, onAddLocation, onEditLocation, onDeleteLocation,
  segCodeMap = {}, uploadedCodes = [], onBlockedSegmentRemove,
}: {
  tab: IdentityTab;
  setTab: (t: IdentityTab) => void;
  form: any;
  setForm: (next: any) => void;
  masters: Stage1Masters;
  errors: Record<string, string>;
  clearErr: (k: string) => void;
  /** Per-keystroke validator from the parent. Receives the field key
   *  and the post-change form so the inline red error appears in real
   *  time without waiting for Save & Next. */
  validateField: (k: string, nextForm: any) => void;
  sameAsCustomer: boolean;
  setSameAsCustomer: (v: boolean) => void;
  customer: CustomerOption | null;
  /** True when this customer already has a *different* consignee
   *  marked same-as-customer. Disables the toggle so the user can't
   *  create a second mirror — the business rule is 1 mirror / customer. */
  mirrorAlreadyTakenByOther: boolean;
  /** True when editing a consignee that was SAVED as same-as-customer.
   *  Locks the toggle so it can't be unticked from the edit screen — a
   *  saved mirror stays a mirror; change the source on the Customer. */
  mirrorLocked: boolean;
  /** Fired when the user clicks the toggle while it's disabled, so the parent
   *  can show a short toast explaining why it can't be ticked. */
  onBlockedClick?: () => void;
  locations: LocationRow[];
  onAddLocation: () => void;
  onEditLocation: (id: string) => void;
  onDeleteLocation: (id: string) => void;
  /** segment name → its required KYC/DD/TL doc codes (DCP rules). */
  segCodeMap?: Record<string, string[]>;
  /** Doc codes that actually have an uploaded file/URL. */
  uploadedCodes?: string[];
  /** Fired with the segment names the user tried (and failed) to remove. */
  onBlockedSegmentRemove?: (segs: string[]) => void;
}) => {
  /* When the "Same as Customer" toggle is on, Stage 1's basic
   * company + primary address fields lock to read-only — every
   * input + MasterSelect receives `disabled={lock}` so the user can
   * tell at a glance the values are being mirrored. */
  /* Lock whenever Same-as-Customer is on — including edit mode where the
     linked `customer` object may not be re-resolved yet. (Earlier the
     `&& !!customer` guard let a saved mirror's fields stay editable on edit.) */
  const lock = sameAsCustomer;
  const set = (k: string, v: any) => {
    const nextForm = { ...form, [k]: v };
    setForm(nextForm);
    validateField(k, nextForm);
  };
  const selectedCountry = masters.countries.find(c => c.value === form.country);
  const filteredStates = selectedCountry
    ? masters.states.filter(s => s.countryId === selectedCountry.id)
    : [];
  return (
    <>
      {/* Sub-tabs + Same-as-Customer banner sit on the SAME row so the
          banner fills the otherwise-empty space next to the two tab
          pills. On narrow viewports the row wraps and the banner
          drops below the tabs as a full-width strip.
          Same-as-Customer governs the entire Stage 1 (both tabs lock
          when ticked), so it stays visible on BOTH Identification and
          Address & Contact tabs. */}
      <div className="acm-id-tabs-row">
        <div className="acm-id-tabs">
          <button className={`acm-id-tab ${tab === 'identification' ? 'on' : ''}`} onClick={() => setTab('identification')}>
            <IconTruck size={14} /> Consignee Identification Details
          </button>
          <button className={`acm-id-tab ${tab === 'address-contact' ? 'on' : ''}`} onClick={() => setTab('address-contact')}>
            <IconUser /> Contact Person Details
          </button>
        </div>
        {/* "Same as Customer" toggle. Three visual states:
              - normal:   regular emerald banner, click toggles
              - is-on:    emerald-filled, fields mirroring customer
              - is-blocked: amber warning style, customer already has
                          its one allowed mirror. Click still fires
                          but the parent's setSameAsCustomer wrapper
                          intercepts and shows a toast — user gets
                          *immediate* feedback instead of waiting
                          until Save & Next.
              - is-disabled: greyed out, no customer resolved yet */}
        <label
          className={`acm-same-banner acm-same-banner-inline ${sameAsCustomer ? 'is-on' : ''} ${(!customer || mirrorLocked || mirrorAlreadyTakenByOther) ? 'is-disabled' : ''} ${mirrorAlreadyTakenByOther && customer ? 'is-blocked' : ''}`}
          title={mirrorLocked ? (sameAsCustomer ? "This consignee mirrors the customer — you can't untick Same as Customer here." : "You already completed this consignee's basic details, so you can't mark it as Same as Customer.") : undefined}
          // Native disabled inputs are silent on click — fire a toast via the
          // label so the user gets feedback on why the toggle is locked.
          onClick={() => { if (!customer || mirrorLocked || mirrorAlreadyTakenByOther) onBlockedClick?.(); }}
          style={(!customer || mirrorLocked || mirrorAlreadyTakenByOther) ? { cursor: 'not-allowed' } : undefined}
        >
          <input
            type="checkbox"
            checked={sameAsCustomer}
            /* Disabled when: no customer yet, identification details already
               filled (mirrorLocked), OR this customer already has its one
               allowed mirror — disabled UPFRONT instead of tick-then-toast. */
            disabled={!customer || mirrorLocked || mirrorAlreadyTakenByOther}
            onChange={e => { if (mirrorLocked || mirrorAlreadyTakenByOther) return; setSameAsCustomer(e.target.checked); }}
          />
          <span className="acm-same-banner-box" aria-hidden>
            {sameAsCustomer && (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
          </span>
          <span className="acm-same-banner-text">
            <span className="acm-same-banner-title">
              {mirrorAlreadyTakenByOther && customer
                ? <>Same as Customer <span className="acm-same-banner-warn">— not available</span></>
                : 'Same as Customer'}
            </span>
            <span className="acm-same-banner-sub">
              {!customer
                ? <>Pick a customer first.</>
                : (sameAsCustomer && mirrorLocked)
                  ? <>Linked as Same as Customer — can&rsquo;t untick here.</>
                  : mirrorAlreadyTakenByOther
                    ? <><strong>{customer.name}</strong> already has one — only one allowed per customer.</>
                    : mirrorLocked
                      ? <>Basic details already completed — can&rsquo;t mark as Same as Customer.</>
                      : <>Copy <strong>{customer.name}</strong>&rsquo;s identity, address &amp; contact. Untick to edit.</>}
            </span>
          </span>
        </label>
      </div>

      {tab === 'identification' && (
        <>
          <SectionHeader icon={<IconHome />} title="Basic Company Details"     sub="Company identity, segment, and risk classification" accent="#10b981" />
          {/* Figma layout: row 1 = Company Name | Legal Name (2-col),
              row 2 = Website | Segment | Classification | Risk (4-col). */}
          <div className="acm-sec-pad">
            <div className="acm-grid-2">
            <Field label="Company Name" required error={errors.companyName} fieldKey="companyName">
              <input
                className={`acm-input ${errors.companyName ? 'acm-input-error' : ''}`}
                placeholder="Enter company name"
                value={form.companyName}
                maxLength={30}
                onChange={e => set('companyName', e.target.value.slice(0, 30))}
                disabled={lock}
              />
            </Field>
            <Field label="Company Legal Name" required error={errors.legalName} fieldKey="legalName">
              <input className={`acm-input ${errors.legalName ? 'acm-input-error' : ''}`} placeholder="Enter legal name" value={form.legalName} onChange={e => set('legalName', e.target.value)} disabled={lock} />
            </Field>
            </div>
            <div className="acm-grid-4 acm-mt-12">
            <Field label="Company Website" error={errors.website} fieldKey="website">
              <input className={`acm-input ${errors.website ? 'acm-input-error' : ''}`} placeholder="https://example.com" value={form.website} onChange={e => set('website', e.target.value)} disabled={lock} />
            </Field>
            <Field label="Consignee Segment" required error={errors.segment} fieldKey="segment">
              {/* Segment is INHERITED from the parent customer and is NOT
                  editable here — a consignee must not pick its own segment.
                  The field is locked (read-only chips) and a hint points the
                  user to the customer to change it. */}
              <MasterMultiSelect
                value={Array.isArray(form.segment) ? form.segment : (form.segment ? [form.segment] : [])}
                options={masters.segments.map(o => ({ value: o.value, label: o.label }))}
                placeholder="Inherited from customer"
                invalid={!!errors.segment}
                disabled
                onChange={() => { /* locked — segment is managed on the customer */ }}
                maxChips={2}
              />
              <div style={{ marginTop: 5, fontSize: 11, fontWeight: 600, color: '#64748b', display: 'flex', alignItems: 'center', gap: 5 }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
                Comes from the customer — change it there.
              </div>
            </Field>
            <Field label="Classification &amp; Flags">
              <MasterSelect
                value={form.classification}
                options={optsWith(masters.classifications, form.classification)}
                placeholder="Select Classification"
                disabled={lock}
                allowDeselect
                onChange={v => set('classification', v)}
              />
            </Field>
            <Field label="Risk Level" required error={errors.risk} fieldKey="risk">
              <MasterSelect
                value={form.risk}
                options={optsWith(masters.riskLevels, form.risk)}
                placeholder="Select Risk Level"
                invalid={!!errors.risk}
                disabled={lock}
                onChange={v => set('risk', v)}
              />
            </Field>
            </div>
          </div>

          <SectionHeader icon={<IconPin />} title="Company Address &amp; Primary Contact" sub="Registered office location and primary contact details" accent="#3b82f6" />
          <div className="acm-sec-pad">
            <div className="acm-grid-2">
              <Field label="Address Type" required error={errors.addressType} fieldKey="addressType">
                {/* Primary address is, by definition, the registered
                   office — locked here so a user can't pick anything
                   else for the primary slot. Other types (Warehouse,
                   Billing, etc.) belong on the Address & Contact
                   Details tab. */}
                <MasterSelect
                  value="Registered Office"
                  options={[{ value: 'Registered Office', label: 'Register Office Address' }]}
                  placeholder="Select Address Type"
                  disabled
                  onChange={() => { /* locked */ }}
                />
              </Field>
              <Field label="Address" required error={errors.address} fieldKey="address">
                <input className={`acm-input ${errors.address ? 'acm-input-error' : ''}`} placeholder="Enter full address" value={form.address} onChange={e => set('address', e.target.value)} disabled={lock} maxLength={75} />
              </Field>
            </div>
            <div className="acm-grid-4 acm-mt-12">
              <Field label="Country" required error={errors.country} fieldKey="country">
                <MasterSelect
                  value={form.country}
                  options={optsWith(masters.countries, form.country)}
                  placeholder="Select Country"
                  invalid={!!errors.country}
                  disabled={lock}
                  onChange={v => { const nf = { ...form, country: v, state: '' }; setForm(nf); validateField('country', nf); validateField('state', nf); }}
                />
              </Field>
              <Field label="State" required error={errors.state} fieldKey="state">
                <MasterSelect
                  value={form.state}
                  options={optsWith(filteredStates, form.state)}
                  placeholder={form.country ? 'Select State' : 'Select country first'}
                  disabled={lock || !form.country}
                  invalid={!!errors.state}
                  onChange={v => set('state', v)}
                />
              </Field>
              <Field label="City" required error={errors.city} fieldKey="city">
                <input className={`acm-input ${errors.city ? 'acm-input-error' : ''}`} placeholder="Enter city" value={form.city} onChange={e => set('city', e.target.value)} disabled={lock} />
              </Field>
              <Field label="Pin / Postal Code" required error={errors.pin} fieldKey="pin">
                <input
                  className={`acm-input ${errors.pin ? 'acm-input-error' : ''}`}
                  placeholder="Enter PIN code"
                  inputMode="numeric"
                  maxLength={6}
                  value={form.pin}
                  onChange={e => set('pin', e.target.value.replace(/\D/g, '').slice(0, 6))}
                  disabled={lock}
                />
              </Field>
            </div>
          </div>

          {/* Primary Contact Details — split into its own section (Figma):
              the address section above carries only the registered-office
              fields; the contact person lives here under a green header. */}
          <SectionHeader icon={<IconUser />} title="Primary Contact Details" sub="Key contact person for this consignee" accent="#10b981" />
          <div className="acm-sec-pad">
            <div className="acm-grid-4">
              <Field label="Contact Person Name" required error={errors.contactName} fieldKey="contactName">
                <input className={`acm-input ${errors.contactName ? 'acm-input-error' : ''}`} placeholder="Enter contact name" value={form.contactName} onChange={e => set('contactName', e.target.value)} disabled={lock} />
              </Field>
              <Field label="Designation" required error={errors.designation} fieldKey="designation">
                {/* Free-text input — users were asked to type the
                    designation manually instead of picking from the
                    /master/designations dropdown. Master fetch still
                    runs (harmless) but no longer drives the UI here. */}
                <input
                  className={`acm-input ${errors.designation ? 'acm-input-error' : ''}`}
                  placeholder="Enter designation"
                  value={form.designation}
                  onChange={e => set('designation', e.target.value)}
                  disabled={lock}
                  maxLength={60}
                />
              </Field>
              <Field label="Contact No" required error={errors.contactNo} fieldKey="contactNo">
                <input className={`acm-input ${errors.contactNo ? 'acm-input-error' : ''}`} type="tel" placeholder="Enter phone number" value={form.contactNo} onChange={e => set('contactNo', e.target.value)} disabled={lock} />
              </Field>
              <Field label="Email ID" required error={errors.email} fieldKey="email">
                <input className={`acm-input ${errors.email ? 'acm-input-error' : ''}`} type="email" placeholder="Enter email address" value={form.email} onChange={e => set('email', e.target.value)} disabled={lock} />
              </Field>
            </div>
            <div className="acm-mt-12">
              <Field label="Whatsapp Enabled?" required error={errors.whatsapp} fieldKey="whatsapp">
                <div className="acm-radio-row">
                  <label className="acm-radio">
                    <input type="radio" name="acm-wa" checked={form.whatsapp === 'Yes'} disabled={lock} onChange={() => set('whatsapp', 'Yes')} />
                    <span /> Yes
                  </label>
                  <label className="acm-radio">
                    <input type="radio" name="acm-wa" checked={form.whatsapp === 'No'} disabled={lock} onChange={() => set('whatsapp', 'No')} />
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
          primary={{
            type:          form.addressType,
            line:          form.address,
            country:       form.country,
            state:         form.state,
            city:          form.city,
            pin:           form.pin,
            cpName:        form.contactName,
            cpDesignation: form.designation,
            cpContact:     form.contactNo,
            cpEmail:       form.email,
            cpWhatsapp:    form.whatsapp === 'Yes' ? 'yes' : form.whatsapp === 'No' ? 'no' : '',
          }}
          locations={locations}
          onAdd={onAddLocation}
          onEdit={onEditLocation}
          onDel={onDeleteLocation}
          onEditPrimary={() => setTab('identification')}
          /* lock = Same-as-Customer is on → table is read-only mirror;
             user must untick the toggle to edit addresses & contacts. */
          locked={lock}
        />
      )}
    </>
  );
};

/* ─── Stage 1 — Address & Contact table ─────
 * Renders the primary address (captured on the Consignee Identification
 * tab) as the first row, followed by any additional locations. The
 * primary row is read-only here — edit jumps back to the Identification
 * tab and delete is disabled, since the primary address is required. */
type PrimaryRowData = {
  type: string; line: string; country: string; state: string; city: string; pin: string;
  cpName: string; cpDesignation: string; cpContact: string; cpEmail: string; cpWhatsapp: string;
};
const LocationsTable = ({ primary, locations, onAdd, onEdit, onDel, onEditPrimary, locked = false }: {
  primary: PrimaryRowData;
  locations: LocationRow[];
  onAdd: () => void;
  onEdit: (id: string) => void;
  onDel: (id: string) => void;
  onEditPrimary: () => void;
  /** When the consignee is mirroring its customer ("Same as Customer"
   *  enabled), the user can't add/edit/delete addresses here — they
   *  must untick the toggle first so a manual entry no longer overrides
   *  the mirrored data. Disables the Add button + per-row actions and
   *  surfaces a tooltip explaining the lock. */
  locked?: boolean;
}) => {
  type DisplayRow = PrimaryRowData & { id: string; isPrimary: boolean };
  const allRows: DisplayRow[] = [
    { id: '__primary__', isPrimary: true, ...primary },
    ...locations.map(l => ({ ...l, isPrimary: false })),
  ];
  const lockedTip = 'Same as Customer is on — untick it to edit addresses & contacts.';
  return (
  <div className="acm-loc-card">
    <div className="acm-loc-head">
      <div className="acm-loc-head-row">
        <div className="acm-loc-head-icon"><IconUser /></div>
        <div className="acm-loc-head-text">
          <span className="acm-loc-head-title">Contact Persons</span>
          <span className="acm-loc-head-sub">| Authorized contacts associated with this consignee</span>
        </div>
        <Tooltip label={lockedTip} disabled={!locked}>
          <button
            type="button"
            className="acm-add-pill"
            onClick={() => { if (!locked) onAdd(); }}
            disabled={locked}
            style={locked ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
          >
            <IconPlus /> Add More Contact Person
          </button>
        </Tooltip>
      </div>
    </div>
    <div className="acm-loc-body">
      <div className="acm-loc-table-wrap">
        <table className="acm-loc-table">
          <thead>
            <tr>
              <th>SR NO</th><th>CONTACT PERSON NAME</th><th>DESIGNATION</th><th>ADDRESS DETAILS</th>
              <th>CONTACT NO</th><th>EMAIL ID</th><th>WHATSAPP ENABLE</th><th>ACTIONS</th>
            </tr>
          </thead>
          <tbody>
            {allRows.map((l, i) => {
              const place = [l.city, l.state, l.country].filter(Boolean).join(' • ');
              // Figma "Address Details" column merges type + line + city/state/country.
              const addressDetails = [l.type, l.line, place].filter(Boolean).join(', ');
              return (
                <tr key={l.id} className={l.isPrimary ? 'acm-loc-primary-row' : undefined}>
                  <td>{i + 1}</td>
                  <td>
                    <div className="acm-loc-type-cell">
                      {l.cpName ? <TruncatedCell text={l.cpName} max={18} /> : <span>—</span>}
                      {l.isPrimary && <span className="acm-loc-primary-tag">Primary</span>}
                    </div>
                  </td>
                  <td><TruncatedCell text={l.cpDesignation} max={18} /></td>
                  <td><TruncatedCell text={addressDetails} max={36} /></td>
                  <td><TruncatedCell text={l.cpContact} max={18} mono /></td>
                  <td><TruncatedCell text={l.cpEmail} max={28} /></td>
                  <td>{l.cpWhatsapp === 'yes' ? <span className="acm-pill-yes">✓ Yes</span> : l.cpWhatsapp === 'no' ? <span className="acm-pill-no">✕ No</span> : <span style={{ color: '#9ca3af' }}>—</span>}</td>
                  <td>
                    <div className="acm-loc-actions">
                      <Tooltip label={locked ? lockedTip : (l.isPrimary ? 'Edit in Consignee Identification tab' : 'Edit')}>
                        <button
                          type="button"
                          className="acm-loc-btn"
                          aria-label="Edit"
                          onClick={() => { if (locked) return; l.isPrimary ? onEditPrimary() : onEdit(l.id); }}
                          disabled={locked}
                          style={locked ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}
                        >
                          {/* Same edit-box icon as the Consignee list page. */}
                          <i className="ri-edit-box-line" style={{ fontSize: 15 }} />
                        </button>
                      </Tooltip>
                      {l.isPrimary || locked ? (
                        <Tooltip label={locked ? lockedTip : 'The primary address cannot be deleted'}>
                          <button type="button" className="acm-loc-btn acm-loc-btn-del" aria-label="Delete (disabled)" disabled style={{ opacity: 0.4, cursor: 'not-allowed' }}>
                            <IconTrash />
                          </button>
                        </Tooltip>
                      ) : (
                        <Tooltip label="Delete">
                          <button type="button" className="acm-loc-btn acm-loc-btn-del" aria-label="Delete" onClick={() => onDel(l.id)}>
                            <IconTrash />
                          </button>
                        </Tooltip>
                      )}
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
};

/* ─── Stage 2 — KYC / Due Diligence ─── */
/* ─── Stage 2 — KYC / Due Diligence (table-driven) ─── */
const KYC_SUB_META: Record<KycSubTab, { title: string; sub: string; nameCol: string; placeholder: string; addLabel: string }> = {
  'company-dd':   { title: 'COMPANY DUE DILIGENCE', sub: '| Licenses, statutory documents, and compliance proofs', nameCol: 'DD Document Name',  placeholder: 'Search DD document name…',    addLabel: 'Add Document / License' },
  'owner-kyc':    { title: 'OWNER KYC DETAILS',     sub: '| Owner identity proofs, address proofs, and photographs', nameCol: 'KYC Document Name', placeholder: 'Search owner name…',          addLabel: 'Add Owner KYC' },
  'trade-licence':{ title: 'TRADE LICENCE',         sub: '| Trade licence documents and regulatory approvals',     nameCol: 'Document Name',       placeholder: 'Search trade licence…',       addLabel: 'Add Trade Licence' },
};

/* Per-row actions cell for the segment-rule reference rows. Starts as
 * a single Upload icon; on file pick it flips to View / Download /
 * Delete using a blob URL the parent caches. Delete revokes the URL
 * and restores the initial Upload state. */
function ConsigneeSegmentRefActions({ refKey, docName, uploads, setUploads, persistUpload, disabled = false }: {
  refKey: string;
  docName: string;
  uploads: Record<string, { file: File | null; url: string; name: string }>;
  setUploads: React.Dispatch<React.SetStateAction<Record<string, { file: File | null; url: string; name: string }>>>;
  persistUpload: (refKey: string, file: File, docName: string) => Promise<void> | void;
  /* When true (Same as Customer on), hide the Upload / Re-upload labels
   * and show only View / Download — the consignee's segment-rule uploads
   * are mirrored read-through from the linked customer, so writing here
   * would split the mirror. */
  disabled?: boolean;
}) {
  const toast = useToast();
  const uploaded = uploads[refKey];
  /* Single picker — drives both first-time Upload and Re-upload. Shows
   * the blob URL immediately for snappy feedback and fires the server
   * upload; the persist callback swaps the blob URL for the permanent
   * attachment_url once it lands in segment_doc_uploads.
   *
   * isAcceptedFile() enforces the extension allow-list (PDF / JPG /
   * PNG / DOC / DOCX) AND the 2 MB cap up front, so a 50 MB junk
   * file can never reach the persist call. Server runs the same
   * check — this is the client-side bounce for immediate feedback. */
  const onPick = (f: File | undefined) => {
    if (!f) return;
    const check = isAcceptedFile(f);
    if (!check.ok) {
      toast.error('File rejected', check.reason);
      return;
    }
    setUploads(prev => {
      const existing = prev[refKey];
      if (existing?.url && existing.url.startsWith('blob:')) {
        try { URL.revokeObjectURL(existing.url); } catch {}
      }
      return { ...prev, [refKey]: { file: f, url: URL.createObjectURL(f), name: f.name } };
    });
    void persistUpload(refKey, f, docName);
  };

  if (!uploaded) {
    if (disabled) {
      return (
        <div className="acm-loc-actions">
          <Tooltip label="Same as Customer is on — manage from the customer side.">
            <span className="acm-loc-btn" style={{ opacity: 0.4, cursor: 'not-allowed' }} aria-label="Locked">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
            </span>
          </Tooltip>
        </div>
      );
    }
    return (
      <div className="acm-loc-actions">
        <Tooltip label="Upload">
          <label className="acm-loc-btn" aria-label="Upload" style={{ cursor: 'pointer' }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            <input type="file" hidden accept=".pdf,.jpg,.jpeg,.png" onChange={e => { onPick(e.target.files?.[0]); e.currentTarget.value = ''; }} />
          </label>
        </Tooltip>
      </div>
    );
  }
  return (
    <div className="acm-loc-actions">
      <Tooltip label={`View ${uploaded.name}`}>
        <a href={uploaded.url} target="_blank" rel="noreferrer" className="acm-loc-btn" aria-label="View">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
        </a>
      </Tooltip>
      <Tooltip label={`Download ${uploaded.name}`}>
        <a href={uploaded.url} onClick={e => { e.preventDefault(); void downloadFile(uploaded.url, uploaded.name); }} className="acm-loc-btn" aria-label="Download">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        </a>
      </Tooltip>
      {!disabled && (
        <Tooltip label="Re-upload (replace file)">
          <label className="acm-loc-btn" aria-label="Re-upload" style={{ cursor: 'pointer' }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
            <input type="file" hidden accept=".pdf,.jpg,.jpeg,.png" onChange={e => { onPick(e.target.files?.[0]); e.currentTarget.value = ''; }} />
          </label>
        </Tooltip>
      )}
    </div>
  );
}

/* Compact reference callout — Company DD sub-tab, rendered when the
 * selected segment's rule defines required DD documents. Read-only; the
 * "+ Add Document" button is still where the user attaches files. */
function ConsigneeSegmentBanner({ segmentName, label, rows }: {
  segmentName: string;
  label: string;
  rows: { code:string; name:string; requirement:'M'|'O' }[];
}) {
  const mandCount = rows.filter(r => r.requirement === 'M').length;
  return (
    <div style={{
      margin: '0 0 12px',
      padding: '10px 12px',
      borderRadius: 10,
      background: 'linear-gradient(135deg, #f5f3ff 0%, #ede9fe 100%)',
      border: '1px solid #c4b5fd',
      fontSize: 11.5,
    }}>
      <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:6, color:'#5b21b6', fontWeight:700, letterSpacing:0.2 }}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        Segment "{segmentName}" requires {rows.length} {label} document{rows.length === 1 ? '' : 's'}
        {mandCount > 0 && <span style={{ color:'#7c3aed' }}> · {mandCount} mandatory</span>}
      </div>
      <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
        {rows.map(r => (
          <span key={r.code} style={{
            display:'inline-flex', alignItems:'center', gap:4,
            padding:'3px 8px', borderRadius:999, fontSize:10.5, fontWeight:600,
            background: r.requirement === 'M' ? '#7c3aed' : '#ffffff',
            color:      r.requirement === 'M' ? '#ffffff' : '#5b21b6',
            border:     r.requirement === 'M' ? 'none' : '1px solid #c4b5fd',
          }}>
            {r.requirement === 'M' ? '★ ' : ''}{r.name}
          </span>
        ))}
      </div>
    </div>
  );
}

const Stage2 = ({
  sub, setSub, search, setSearch, docs, owners,
  onAddDoc, onEditDoc, onDeleteDoc, onAddOwner, onEditOwner, onDeleteOwner,
  form1, locations, consigneeCode, sameAsCustomer, segmentName, segmentDocs, loading,
  segmentRefUploads, setSegmentRefUploads, persistSegmentRefUpload, segments = [],
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
  form1: { companyName: string; legalName: string; website: string; segment: string[]; classification: string; risk: string; addressType: string; address: string; country: string; state: string; city: string; pin: string; contactName: string; designation: string; contactNo: string; email: string; whatsapp: string };
  locations: LocationRow[];
  consigneeCode?: string;
  sameAsCustomer: boolean;
  /** Segment-rule resolver output + per-row upload state. Driven by
   *  the chosen segment's rule — Stage 2 sub-tabs (Company DD, Owner
   *  KYC, Trade Licence) render from these and the row actions cell
   *  uses segmentRefUploads for per-row file pickers. */
  segmentName: string;
  segmentDocs: { kyc:any[]; dd:any[]; tl:any[]; td:any[]; qc:any[] };
  /** True while the segment-rule catalog is loading from the DB — drives the
   *  in-table shimmer. */
  loading?: boolean;
  segmentRefUploads: Record<string, { file: File | null; url: string; name: string }>;
  setSegmentRefUploads: React.Dispatch<React.SetStateAction<Record<string, { file: File | null; url: string; name: string }>>>;
  persistSegmentRefUpload: (refKey: string, file: File, docName: string) => Promise<void> | void;
  /** Segment master rows (name + code) for the "S-001: Name" review display. */
  segments?: { name: string; code?: string }[];
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
      {/* "What you did in previous stage" — compact summary panel
          (collapsed by default) showing Stage 1 entries in a dense
          4-column Label : Value grid. Mirrors AddCustomerModal.
          When "Same as Customer" is on, the Linked Customer panel
          above already shows the exact same data + each KYC table
          carries its own "Locked — mirroring customer" pill, so we
          collapse the previously-large banner to a single-line note
          that costs almost no vertical real estate. */}
      {sameAsCustomer ? (
        <div className="acg-mirror-inline">
          <span className="acg-mirror-inline-icon"><IconUser /></span>
          <span><b>Stage 1 mirrors the linked customer.</b> Untick <b>Same as Customer</b> on Stage 1 to capture different details.</span>
        </div>
      ) : (
        <ConsigneeHistoryPanel stagesCompleted={1}>
          <ConsigneeHistoryStage1 form={form1} locations={locations} consigneeCode={consigneeCode} segments={segments} />
        </ConsigneeHistoryPanel>
      )}

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
            {/* Stage 2 sub-tab headers no longer carry a "+ Add" pill.
                Rows now come exclusively from the selected segment's
                rule (Company DD / Owner KYC / Trade Licence reference
                tables below). Same-as-Customer still mirrors the
                customer's data — the lock chip surfaces that state. */}
            {sameAsCustomer && (
              <Tooltip label="Same as Customer is on — untick it on Stage 1 to capture different details.">
                <span className="acm-add-pill acm-add-pill-locked" aria-disabled="true">
                  <IconLock /> Locked — mirroring customer
                </span>
              </Tooltip>
            )}
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
            {totalRows} {(isOwners && !(filteredOwners.length === 0 && segmentDocs.kyc.length > 0)) ? `owner${totalRows === 1 ? '' : 's'}` : `document${totalRows === 1 ? '' : 's'}`}
          </div>
        </div>

        <div className="acm-kyc-body">
          <div className="acm-loc-table-wrap">
            {loading ? (
              /* Segment-rule catalog still loading from the DB — table shimmer
                 (real headers + shimmer rows) so the grid doesn't flash empty. */
              <table className="acm-loc-table">
                <thead>
                  <tr>
                    {isOwners ? (
                      <>
                        <th>SR NO</th><th>OWNER NAME</th><th>DESIGNATION</th><th>EMAIL</th><th>PHONE</th>
                        <th>ID PROOF</th><th>ADDRESS PROOF</th><th>PHOTOGRAPH</th><th>ACTIONS</th>
                      </>
                    ) : (
                      <>
                        <th>SR NO</th><th>AUTO CODE</th><th>DOCUMENT NAME</th>
                        <th>ISSUING AUTHORITY</th><th>REQUIREMENT</th><th>ATTACHMENT</th><th>ACTIONS</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody><ShimmerTableRows rows={4} cols={isOwners ? 9 : 7} /></tbody>
              </table>
            ) : isOwners && filteredOwners.length === 0 && segmentDocs.kyc.length > 0 ? (
              /* Owner KYC sub-tab — segment-rule reference table.
                 Mirrors the Trade Licence + Company DD layout when the
                 segment's rule defines required KYC documents and no
                 owners have been captured yet. The "+ Add Owner KYC"
                 pill still opens the existing owner-form to capture
                 real entries on top of these references. */
              <table className="acm-loc-table">
                <thead>
                  <tr>
                    <th>SR NO</th><th>AUTO CODE</th><th>DOCUMENT NAME</th>
                    <th>ISSUING AUTHORITY</th><th>REQUIREMENT</th><th>ATTACHMENT</th><th>ACTIONS</th>
                  </tr>
                </thead>
                <tbody>
                  {segmentDocs.kyc.map((d: any, i: number) => {
                    const refKey = `owner-kyc::${d.code}`;
                    const uploaded = segmentRefUploads[refKey];
                    return (
                      <tr key={d.code} className="acm-loc-placeholder-row">
                        <td>{String(i + 1).padStart(2, '0')}</td>
                        <td><span className="acm-kyc-code">{d.code}</span></td>
                        <td style={{ fontWeight: 700 }}>{d.name}{d.requirement === 'M' ? <span style={{ marginLeft:6, color:'#7c3aed' }}>★</span> : null}</td>
                        <td>{d.authority ?? '—'}</td>
                        {/* Requirement — Mandatory / Optional, same as Company DD. */}
                        <td>
                          {d.requirement === 'M'
                            ? <span className="acm-badge acm-badge--mand">★ Mandatory</span>
                            : <span className="acm-badge acm-badge--opt">Optional</span>}
                        </td>
                        <td>
                          {uploaded
                            ? <Tooltip label={uploaded.name}><a href={uploaded.url} target="_blank" rel="noreferrer" style={{ color:'#0d9488', fontWeight:600, whiteSpace:'nowrap' }}>{truncFileName(uploaded.name)}</a></Tooltip>
                            : <span style={{ color: '#9ca3af', fontStyle: 'italic' }}>Not uploaded</span>}
                        </td>
                        <td>
                          <ConsigneeSegmentRefActions
                            refKey={refKey}
                            docName={d.name}
                            uploads={segmentRefUploads}
                            setUploads={setSegmentRefUploads}
                            persistUpload={persistSegmentRefUpload}
                            disabled={sameAsCustomer}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : isOwners ? (
              <table className="acm-loc-table">
                <thead>
                  <tr>
                    <th>SR NO</th><th>OWNER NAME</th><th>DESIGNATION</th><th>EMAIL</th><th>PHONE</th>
                    <th>ID PROOF</th><th>ADDRESS PROOF</th><th>PHOTOGRAPH</th><th>ACTIONS</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredOwners.length === 0 ? (
                    <tr className="acm-loc-empty"><td colSpan={9}>{q ? 'No owners match your search.' : 'No owners captured yet. Click "+ Add Owner KYC" to add one.'}</td></tr>
                  ) : filteredOwners.map((o, i) => (
                    <tr key={o.id}>
                      <td>{String(i + 1).padStart(2, '0')}</td>
                      <td style={{ fontWeight: 700 }}>{o.owner_name}</td>
                      <td>{o.designation || '—'}</td>
                      <td>{o.official_email || '—'}</td>
                      <td>{o.phone_number || '—'}</td>
                      <td><AttachmentLink url={o.id_proof_url}      path={o.id_proof_path} /></td>
                      <td><AttachmentLink url={o.address_proof_url} path={o.address_proof_path} /></td>
                      <td><AttachmentLink url={o.photograph_url}    path={o.photograph_path} /></td>
                      <td>
                        <div className="acm-loc-actions">
                          <Tooltip label={sameAsCustomer ? 'Same as Customer is on — untick it to edit KYC entries.' : 'Edit'}>
                            <button
                              type="button"
                              className="acm-loc-btn"
                              aria-label="Edit"
                              onClick={() => { if (sameAsCustomer) return; onEditOwner(o.id); }}
                              disabled={sameAsCustomer}
                              style={sameAsCustomer ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}
                            >
                              <IconPencil />
                            </button>
                          </Tooltip>
                          <Tooltip label={sameAsCustomer ? 'Same as Customer is on — untick it to delete KYC entries.' : 'Delete'}>
                            <button
                              type="button"
                              className="acm-loc-btn acm-loc-btn-del"
                              aria-label="Delete"
                              onClick={() => { if (sameAsCustomer) return; onDeleteOwner(o.id); }}
                              disabled={sameAsCustomer}
                              style={sameAsCustomer ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}
                            >
                              <IconTrash />
                            </button>
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
                    <th>SR NO</th><th>AUTO CODE</th><th>{meta.nameCol.toUpperCase()}</th>
                    <th>ISSUING AUTHORITY</th><th>REQUIREMENT</th><th>ATTACHMENT</th><th>ACTIONS</th>
                  </tr>
                </thead>
                <tbody>
                  {/* Segment-rule reference rows. Shown above the live
                      filteredDocs table only when no real docs are
                      captured yet AND the user isn't searching. Source
                      per sub-tab:
                        company-dd   → segmentDocs.dd
                        trade-licence → segmentDocs.tl
                      Both come straight from the segment's rule in the
                      Document Control Panel. When the DCP leaves a
                      category empty, NOTHING renders here (no dummy
                      placeholder) — the empty message below takes over.
                      Once a real upload lands the live row takes over. */}
                  {(() => {
                    if (filteredDocs.length > 0 || q) return null;
                    let segSrc: any[] = [];
                    if (sub === 'company-dd')   segSrc = (segmentDocs.dd || []).map((d: any) => ({ code:d.code, name:d.name, authority:d.authority ?? '—', expiry:d.expiry ?? 'N/A', isMandatory:d.requirement === 'M' }));
                    if (sub === 'trade-licence') segSrc = (segmentDocs.tl || []).map((d: any) => ({ code:d.code, name:d.name, authority:d.authority ?? '—', expiry:d.expiry ?? 'N/A', isMandatory:d.requirement === 'M' }));
                    return segSrc.map((tl, i) => {
                      const refKey = `${sub}::${tl.code}`;
                      const uploaded = segmentRefUploads[refKey];
                      return (
                        <tr key={tl.code} className="acm-loc-placeholder-row">
                          <td>{String(i + 1).padStart(2, '0')}</td>
                          <td><span className="acm-kyc-code">{tl.code}</span></td>
                          <td style={{ fontWeight: 700 }}>
                            {tl.name}{tl.isMandatory ? <span style={{ marginLeft:6, color:'#7c3aed' }}>★</span> : null}
                          </td>
                          <td>{tl.authority}</td>
                          {/* Requirement — Mandatory / Optional, shown up-front. */}
                          <td>
                            {tl.isMandatory
                              ? <span className="acm-badge acm-badge--mand">★ Mandatory</span>
                              : <span className="acm-badge acm-badge--opt">Optional</span>}
                          </td>
                          <td>
                            {uploaded
                              ? <Tooltip label={uploaded.name}><a href={uploaded.url} target="_blank" rel="noreferrer" style={{ color:'#0d9488', fontWeight:600, whiteSpace:'nowrap' }}>{truncFileName(uploaded.name)}</a></Tooltip>
                              : <span style={{ color: '#9ca3af', fontStyle: 'italic' }}>Not uploaded</span>}
                          </td>
                          <td>
                            <ConsigneeSegmentRefActions
                              refKey={refKey}
                              docName={tl.name}
                              uploads={segmentRefUploads}
                              setUploads={setSegmentRefUploads}
                              persistUpload={persistSegmentRefUpload}
                              disabled={sameAsCustomer}
                            />
                          </td>
                        </tr>
                      );
                    });
                  })()}
                  {filteredDocs.length === 0 && (
                    q
                      ? <tr className="acm-loc-empty"><td colSpan={7}>No documents match your search.</td></tr>
                      : (sub === 'company-dd' && (segmentDocs.dd?.length ?? 0) === 0)
                        ? <tr className="acm-loc-empty"><td colSpan={7}>{`No DD documents yet. Click "+ ${meta.addLabel}" to add one.`}</td></tr>
                        : (sub === 'trade-licence' && (segmentDocs.tl?.length ?? 0) === 0)
                          ? <tr className="acm-loc-empty"><td colSpan={7}>No trade licence documents configured for this segment in the Document Control Panel.</td></tr>
                          : null /* company-dd-with-segment-refs already render rows above */
                  )}
                  {filteredDocs.map((d, i) => {
                    const sr = i + 1;
                    return (
                      <tr key={d.id}>
                        <td>{String(sr).padStart(2, '0')}</td>
                        <td><span className="acm-kyc-code">{codeFor(kind, sr)}</span></td>
                        <td style={{ fontWeight: 700 }}>{d.name}</td>
                        <td>{d.issuing_authority || '—'}</td>
                        <td style={{ color: '#9ca3af' }}>—</td>
                        <td><AttachmentLink url={d.attachment_url} path={d.attachment_path} /></td>
                        <td>
                          <div className="acm-loc-actions">
                            <Tooltip label={sameAsCustomer ? 'Same as Customer is on — untick it to edit KYC entries.' : 'Edit'}>
                              <button
                                type="button"
                                className="acm-loc-btn"
                                aria-label="Edit"
                                onClick={() => { if (sameAsCustomer) return; onEditDoc(d.id); }}
                                disabled={sameAsCustomer}
                                style={sameAsCustomer ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}
                              >
                                <IconPencil />
                              </button>
                            </Tooltip>
                            <Tooltip label={sameAsCustomer ? 'Same as Customer is on — untick it to delete KYC entries.' : 'Delete'}>
                              <button
                                type="button"
                                className="acm-loc-btn acm-loc-btn-del"
                                aria-label="Delete"
                                onClick={() => { if (sameAsCustomer) return; onDeleteDoc(d.id); }}
                                disabled={sameAsCustomer}
                                style={sameAsCustomer ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}
                              >
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
            )}
          </div>
        </div>
      </div>
    </>
  );
};

/* ─── Stage 3 — Evidence Vault ─── */
/* Stage 3 → Trade Documents → interactive table. Mirrors the Customer
 * modal's Stage3TradeDocs — same row shape, same status badge styling,
 * different launch context (signs as Consignee). Per-row Send and footer
 * "Send Selected Documents for Signature" both open the Zoho wizard
 * with the chosen library ids pre-checked. */
function ConsigneeTradeDocsTable({ docs, onToggle, onToggleAll, onSend, onSendSelected, sameAsCustomer }: {
  docs: TdDocRow[];
  onToggle: (id: string) => void;
  onToggleAll: (checked: boolean) => void;
  onSend: (id: string) => void;
  onSendSelected: () => void;
  /* When the consignee is flagged "Same as Customer", its Stage 3 Trade
   * Documents come straight from the linked customer (the backend swaps
   * party_id transparently). Sending a fresh signature request from the
   * consignee side would split the mirror, so the Send / Send Selected
   * controls are locked here too. */
  sameAsCustomer: boolean;
}) {
  // Signed (completed) docs are locked — they're excluded from select-all
  // and the bulk send, so the counts work off the selectable subset only.
  const selectable = docs.filter(d => d.status !== 'completed');
  const selCount = selectable.filter(d => d.selected).length;
  // Roll-up "all signed" — every TD row has hit Zoho's completed state.
  // When that's true, no further send is meaningful (Resend on a signed
  // doc creates a fresh request against the archived PDF, which the
  // per-row button already blocks). Use this to lock the bulk controls
  // too — header select-all checkbox and footer "Send Selected" button.
  const allSigned = docs.length > 0 && docs.every(d => d.status === 'completed');
  const bulkLocked = sameAsCustomer || allSigned;
  // "All checked" reflects only the selectable (unsigned) rows.
  const allChecked = !allSigned && selectable.length > 0 && selCount === selectable.length;
  return (
    <div className="acm-kyc-card" style={{ marginTop: 12 }}>
      {sameAsCustomer && (
        <div className="acm-td-mirror-note">
          Same as Customer is on — Trade Document signatures mirror the linked customer. Sending is disabled here; manage signatures on the customer side.
        </div>
      )}
      <div className="acm-loc-table-wrap">
        <table className="acm-loc-table">
          <thead>
            <tr>
              <th>SR NO</th>
              <th>DOCUMENT NAME</th>
              <th>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <input
                    type="checkbox"
                    checked={allChecked}
                    disabled={bulkLocked}
                    ref={el => { if (el) el.indeterminate = !allSigned && selCount > 0 && selCount < selectable.length; }}
                    onChange={e => onToggleAll(e.target.checked)}
                  />
                  SEND FOR SIGNATURE
                </label>
              </th>
              <th>DOCUMENT STATUS</th>
              <th>ACTIONS</th>
            </tr>
          </thead>
          <tbody>
            {docs.length === 0 && (
              <tr><td colSpan={5} style={{ textAlign: 'center', color: '#94a3b8', padding: 18 }}>
                No buyer/consignee-applicable trade documents — pick a segment with mapped TD docs on Stage 1.
              </td></tr>
            )}
            {docs.map((d, i) => {
              const s = d.status ?? 'idle';
              const b = TD_STATUS_BADGE[s];
              return (
                <tr key={d.id}>
                  <td style={{ color: '#9ca3af', fontWeight: 600 }}>{i + 1}</td>
                  <td style={{ fontWeight: 600, color: '#1f2937' }}>{d.name}</td>
                  <td>
                    {(() => {
                      // Once `completed` the signer has finished — a
                      // Resend would create a brand-new request against
                      // the archived PDF. Lock the button + checkbox.
                      // declined / recalled / expired stay re-sendable.
                      // Same-as-Customer also locks the controls — see
                      // the banner above for the rationale.
                      const isSigned   = d.status === 'completed';
                      const onCooldown = !!d.cooldownActive;
                      const locked     = isSigned || sameAsCustomer || onCooldown;
                      return (
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                          <input type="checkbox" checked={!isSigned && d.selected} onChange={() => onToggle(d.id)} disabled={locked} />
                          {(() => {
                            const remCount = d.reminder_count ?? 0;
                            const lastAt   = d.last_reminder_sent_at;
                            const baseTitle =
                              sameAsCustomer ? 'Same as Customer is on — manage signatures on the customer side.'
                              : isSigned     ? 'This document has already been signed.'
                              : onCooldown   ? 'Reminder just sent — one reminder covers every document in this bundle.'
                              : (d.sent ? 'Resend for signature' : 'Send for signature');
                            const titleWithCount = remCount > 0
                              ? `${baseTitle} · Reminders sent: ${remCount}${lastAt ? ` (last: ${new Date(lastAt).toLocaleString()})` : ''}`
                              : baseTitle;
                            return (
                              <button
                                type="button"
                                onClick={() => { if (!locked) onSend(d.id); }}
                                disabled={locked}
                                title={titleWithCount}
                                style={{
                                  display: 'inline-flex', alignItems: 'center', gap: 4,
                                  padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700,
                                  background: locked ? '#f1f5f9' : (d.sent ? '#f1f5f9' : 'linear-gradient(135deg, #047857 0%, #059669 25%, #10b981 55%, #2dd4bf 85%, #5eead4 100%)'),
                                  color:      locked ? '#94a3b8' : (d.sent ? '#475569' : '#fff'),
                                  border: '1px solid ' + (locked ? '#e2e8f0' : (d.sent ? '#cbd5e1' : '#059669')),
                                  cursor: locked ? 'not-allowed' : 'pointer',
                                  opacity: locked ? 0.6 : 1,
                                }}
                              >
                                {onCooldown ? 'Sent ✓' : (d.sent ? 'Resend' : 'Send')}
                                {d.sent && remCount > 0 && (
                                  <span aria-label={`Reminder sent ${remCount} times`} style={{
                                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                    marginLeft: 2, minWidth: 18, padding: '0 5px', height: 15,
                                    borderRadius: 999,
                                    background: locked ? '#cbd5e1' : (d.sent ? '#475569' : 'rgba(255,255,255,.25)'),
                                    color: locked ? '#475569' : '#fff',
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
                    <span style={{
                      display: 'inline-block', padding: '3px 10px', borderRadius: 999,
                      fontSize: 11, fontWeight: 700,
                      background: b.bg, color: b.fg,
                    }}>{b.label}</span>
                  </td>
                  <td>
                    <div style={{ display: 'inline-flex', gap: 6 }}>
                      <Tooltip label={d.signed_url ? 'View signed document' : 'View document'}>
                        <a
                          href={d.signed_url || '#'}
                          target={d.signed_url ? '_blank' : undefined}
                          rel={d.signed_url ? 'noreferrer' : undefined}
                          onClick={e => { if (!d.signed_url) e.preventDefault(); }}
                          style={{
                            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                            width: 26, height: 26, borderRadius: 6,
                            background: '#eef2ff', color: '#4338ca',
                            opacity: d.signed_url ? 1 : 0.5,
                            cursor: d.signed_url ? 'pointer' : 'not-allowed',
                          }}
                        >
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                        </a>
                      </Tooltip>
                      <Tooltip label={d.signed_url ? 'Download signed document' : 'Download document'}>
                        <a
                          href={d.signed_url || '#'}
                          onClick={e => { e.preventDefault(); if (d.signed_url) void downloadFile(d.signed_url, d.name || ''); }}
                          style={{
                            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                            width: 26, height: 26, borderRadius: 6,
                            background: '#ecfdf5', color: '#10b981',
                            opacity: d.signed_url ? 1 : 0.5,
                            cursor: d.signed_url ? 'pointer' : 'not-allowed',
                          }}
                        >
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                        </a>
                      </Tooltip>
                      {/* Certificate of Completion — third action button,
                          only shown once the request is completed and Zoho
                          has minted the certificate. Distinct cyan styling
                          so it doesn't blend with the View / Download
                          buttons that target the signed PDF. */}
                      {d.status === 'completed' && d.certificate_url && (
                        <Tooltip label="Download Certificate of Completion">
                          <a
                            href={d.certificate_url}
                            onClick={e => { e.preventDefault(); void downloadFile(d.certificate_url!, `${d.name || 'document'}-certificate`); }}
                            style={{
                              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                              width: 26, height: 26, borderRadius: 6,
                              background: '#cffafe', color: '#0e7490',
                              border: '1px solid #67e8f9',
                              cursor: 'pointer', textDecoration: 'none',
                            }}
                          >
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                              <circle cx="12" cy="8" r="6"/>
                              <path d="M15.477 12.89L17 22l-5-3-5 3 1.523-9.11"/>
                            </svg>
                          </a>
                        </Tooltip>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {docs.length > 0 && !sameAsCustomer && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 10, padding: 14 }}>
          <button
            type="button"
            onClick={() => { if (!bulkLocked) onSendSelected(); }}
            disabled={bulkLocked}
            title={allSigned ? 'All documents have already been signed.' : undefined}
            style={{
              padding: '9px 16px', borderRadius: 8, fontSize: 13, fontWeight: 700,
              background: bulkLocked
                ? '#f1f5f9'
                : 'linear-gradient(135deg, #047857 0%, #059669 25%, #10b981 55%, #2dd4bf 85%, #5eead4 100%)',
              color: bulkLocked ? '#94a3b8' : '#fff',
              border: bulkLocked ? '1px solid #e2e8f0' : 'none',
              cursor: bulkLocked ? 'not-allowed' : 'pointer',
              opacity: bulkLocked ? 0.7 : 1,
              display: 'inline-flex', alignItems: 'center', gap: 8,
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
            Send Selected Documents for Signature
          </button>
        </div>
      )}
    </div>
  );
}

const Stage3 = ({ vaultTab, setVaultTab, evSub, setEvSub, form1, kycDocs, kycOwners, locations, sameAsCustomer, segmentDocs, segmentRefUploads, tdDocs, onToggleTd, onToggleAllTd, onSendTd, onSendSelectedTd, segments = [] }: {
  locations: LocationRow[];
  segments?: { name: string; code?: string }[];
  vaultTab: VaultTab;
  setVaultTab: (t: VaultTab) => void;
  evSub: EvSubTab;
  setEvSub: (s: EvSubTab) => void;
  form1: any;
  kycDocs: KycDocRow[];
  kycOwners: KycOwnerRow[];
  sameAsCustomer: boolean;
  segmentDocs: { kyc:any[]; dd:any[]; tl:any[]; td:any[]; qc:any[] };
  segmentRefUploads: Record<string, { file: File | null; url: string; name: string }>;
  tdDocs: TdDocRow[];
  onToggleTd: (id: string) => void;
  onToggleAllTd: (checked: boolean) => void;
  onSendTd: (id: string) => void;
  onSendSelectedTd: () => void;
}) => {
  /* Combined counts: legacy hand-added docs (kycDocs / kycOwners) PLUS
   * segment-rule reference uploads keyed by `${sub-tab}::${doc.code}`.
   * Counting only the legacy arrays left the Stage 3 summary stuck at
   * 0 even when the user had uploaded files against the segment-rule
   * rows on Stage 2 — mirrors the same fix applied to the Customer
   * modal's HistoryStage2. */
  const segKeys = Object.keys(segmentRefUploads);
  const segDd  = segKeys.filter(k => k.startsWith('company-dd::')).length;
  const segOwn = segKeys.filter(k => k.startsWith('owner-kyc::')).length;
  const segTl  = segKeys.filter(k => k.startsWith('trade-licence::')).length;
  const ddCount    = kycDocs.filter(d => d.kind === 'dd').length + segDd;
  const tlCount    = kycDocs.filter(d => d.kind === 'tl').length + segTl;
  const ownerCount = kycOwners.length + segOwn;
  return (
    <>
      {/* "What you did in previous stages" — compact summary panel
          (Stage 1 entries as a 4-col Label : Value grid + Stage 2
          KYC counts as inline stats).
          When Same as Customer is on, the Linked Customer panel above
          already shows the full Stage 1 data AND now hosts the Stage 2
          stat cards inline, so this panel becomes a pure duplicate —
          suppress it entirely. When OFF, the consignee has its own
          Stage 1 data so the panel still earns its place. */}
      {!sameAsCustomer && (
        <ConsigneeHistoryPanel stagesCompleted={2}>
          <ConsigneeHistoryStage1 form={form1} locations={locations} segments={segments} />
          <ConsigneeHistoryStage2 ddCount={ddCount} ownerCount={ownerCount} tlCount={tlCount} />
        </ConsigneeHistoryPanel>
      )}

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

          {(() => {
            /* Stage 3 KYC vault now rolls up Stage 2's segment-rule
             * uploads (the source of truth post-rule consolidation).
             * Map each EvSubTab to the matching Stage 2 ref-key prefix
             * + the segmentDocs category that drives the row list. */
            const stage2Key = evSub === 'dd' ? 'company-dd'
                            : evSub === 'kyc' ? 'owner-kyc'
                            : 'trade-licence';
            const sourceRows = evSub === 'dd' ? (segmentDocs.dd || [])
                              : evSub === 'kyc' ? (segmentDocs.kyc || [])
                              : (segmentDocs.tl || []);
            if (sourceRows.length === 0) {
              return (
                <div className="acm-kyc-card" style={{ marginTop: 12 }}>
                  <div className="acm-loc-empty" style={{ padding: 24, textAlign: 'center', color: '#6b7280' }}>
                    No segment rule loaded for this category. Pick a segment on Stage 1 to populate the vault.
                  </div>
                </div>
              );
            }
            return (
              <div className="acm-kyc-card" style={{ marginTop: 12 }}>
                <div className="acm-loc-table-wrap">
                  <table className="acm-loc-table">
                    <thead>
                      <tr>
                        <th>SR NO</th><th>AUTO CODE</th><th>DOCUMENT NAME</th>
                        <th>ISSUING AUTHORITY</th>
                        <th>REQUIREMENT</th>
                        <th>STATUS</th>
                        <th>ATTACHMENT</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sourceRows.map((d: any, i: number) => {
                        const refKey = `${stage2Key}::${d.code}`;
                        const uploaded = segmentRefUploads[refKey];
                        return (
                          <tr key={d.code} className="acm-loc-placeholder-row">
                            <td>{String(i + 1).padStart(2, '0')}</td>
                            <td><span className="acm-kyc-code">{d.code}</span></td>
                            <td style={{ fontWeight: 700 }}>
                              {d.name}{d.requirement === 'M' ? <span style={{ marginLeft:6, color:'#7c3aed' }}>★</span> : null}
                            </td>
                            <td>{d.authority || '—'}</td>
                            {/* Requirement — is this doc required or optional. */}
                            <td>
                              {d.requirement === 'M'
                                ? <span className="acm-badge acm-badge--mand">★ Mandatory</span>
                                : <span className="acm-badge acm-badge--opt">Optional</span>}
                            </td>
                            {/* Status — completed only when an attachment was uploaded. */}
                            <td>
                              {uploaded
                                ? <span className="acm-badge acm-badge--done">✓ Completed</span>
                                : <span className={`acm-badge ${d.requirement === 'M' ? 'acm-badge--miss-m' : 'acm-badge--miss-o'}`}>✗ Incomplete</span>}
                            </td>
                            <td>
                              {uploaded ? (
                                <Tooltip label={uploaded.name}>
                                  <a href={uploaded.url} target="_blank" rel="noreferrer" style={{ color:'#0d9488', fontWeight:600, textDecoration:'underline', whiteSpace:'nowrap' }}>
                                    {truncFileName(uploaded.name)}
                                  </a>
                                </Tooltip>
                              ) : (
                                <span style={{ color: '#9ca3af', fontStyle: 'italic', fontSize: 11 }}>Not uploaded in Stage 2</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })()}
        </>
      )}

      {vaultTab === 'trade' && (
        <>
          <SectionHeader icon={<IconVault />} title="Trade Documents" sub="Send for digital signature via Zoho Sign" accent="#10b981" />
          <ConsigneeTradeDocsTable
            docs={tdDocs}
            onToggle={onToggleTd}
            onToggleAll={onToggleAllTd}
            onSend={onSendTd}
            onSendSelected={onSendSelectedTd}
            sameAsCustomer={sameAsCustomer}
          />
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

/* ─── ReadInlineG — emerald-themed compact "Label : Value" pair.
 * Mirror of AddCustomerModal's `ReadInline`. Used inside the
 * Stage 2 / Stage 3 history panel so the data carried forward from
 * Stage 1 reads as a dense 4-column grid instead of card-styled
 * sub-panels. */
const ReadInlineG = ({ label, value, span }: { label: string; value?: string | null; span?: number }) => {
  const v = (value ?? '').toString().trim();
  const node = (
    <div className="acg-hs-inline" style={span ? { gridColumn: `span ${span}` } : undefined}>
      <span className="acg-hs-inline-lbl">{label} :</span>
      <span className={`acg-hs-inline-val ${!v ? 'is-empty' : ''}`}>{v || '—'}</span>
    </div>
  );
  return v ? <Tooltip label={`${label}: ${v}`}>{node}</Tooltip> : node;
};

/* ─── Stage 1 summary — dense 4-column "Label : Value" grid of every
 * Stage 1 field the user filled. Same compact layout the Customer
 * modal uses, just emerald-themed via .acg-hs-* classes. */
function ConsigneeHistoryStage1({ form, locations, consigneeCode, segments = [] }: {
  form: { companyName: string; legalName: string; website: string; segment: string[]; classification: string; risk: string; addressType: string; address: string; country: string; state: string; city: string; pin: string; contactName: string; designation: string; contactNo: string; email: string; whatsapp: string };
  locations: LocationRow[];
  consigneeCode?: string;
  segments?: { name: string; code?: string }[];
}) {
  return (
    <div className="acg-hs-mirror">
      <div className="acg-hs-grid">
        {consigneeCode && <ReadInlineG label="Consignee ID" value={consigneeCode} />}
        <ReadInlineG label="Company Name"        value={form.companyName} />
        <ReadInlineG label="Company Legal Name"  value={form.legalName} />
        <ReadInlineG label="Customer Segment"    value={segDisplay(form.segment, segments)} />

        <ReadInlineG label="Classification"      value={form.classification} />
        <ReadInlineG label="Risk Level"          value={form.risk} />
        <ReadInlineG label="Company Website"     value={form.website} />
        <ReadInlineG label="Address Type"        value={form.addressType} />

        <ReadInlineG label="Registered Address"  value={form.address} span={2} />
        <ReadInlineG label="Country"             value={form.country} />
        <ReadInlineG label="State"               value={form.state} />

        <ReadInlineG label="City"                value={form.city} />
        <ReadInlineG label="PIN / Postal Code"   value={form.pin} />
        <ReadInlineG label="Contact Person"      value={form.contactName} />
        <ReadInlineG label="Designation"         value={form.designation} />

        <ReadInlineG label="Contact No"          value={form.contactNo} />
        <ReadInlineG label="Email"               value={form.email} />
        <ReadInlineG label="WhatsApp Enabled"    value={form.whatsapp} />
        {locations.length > 0 && (
          <ReadInlineG label="Additional Locations" value={`${locations.length} captured`} />
        )}
      </div>
    </div>
  );
}

/* ─── Stage 2 summary — compact KYC counts shown as inline stats. */
function ConsigneeHistoryStage2({ ddCount, ownerCount, tlCount }: { ddCount: number; ownerCount: number; tlCount: number }) {
  const total = ddCount + ownerCount + tlCount;
  return (
    <div className="acg-hs-mirror acg-hs-stats-wrap">
      <div className="acg-hs-stats">
        <div className="acg-hs-stat"><div className="acg-hs-stat-num">{ddCount}</div><div className="acg-hs-stat-lbl">DD Docs</div></div>
        <div className="acg-hs-stat"><div className="acg-hs-stat-num">{ownerCount}</div><div className="acg-hs-stat-lbl">Owner KYC</div></div>
        <div className="acg-hs-stat"><div className="acg-hs-stat-num">{tlCount}</div><div className="acg-hs-stat-lbl">Trade Lic.</div></div>
        <div className="acg-hs-stat"><div className="acg-hs-stat-num">{total}</div><div className="acg-hs-stat-lbl">Total</div></div>
      </div>
    </div>
  );
}

/* ─── Collapsible "What you did in previous stages" wrapper —
 * emerald variant of the Customer modal's `acm-history` panel.
 * Renders a slim header (icon + title + stage count chip + chevron)
 * that toggles a body containing one or more summary sub-blocks. */
function ConsigneeHistoryPanel({ stagesCompleted, children }: { stagesCompleted: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`acg-history ${open ? 'acg-hist-open' : ''}`}>
      <div className="acg-history-header" onClick={() => setOpen(o => !o)} role="button">
        <div className="acg-history-header-left">
          <div className="acg-history-icon">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <polyline points="12 8 12 12 14 14"/><path d="M3.05 11a9 9 0 1 1 .5 4M3 16v-5h5"/>
            </svg>
          </div>
          <div>
            <div className="acg-history-title">What you did in previous stages</div>
            <div className="acg-history-meta">{stagesCompleted === 1 ? 'Stage 1 completed' : `Stages 1–${stagesCompleted} completed`} — review your entries below</div>
          </div>
        </div>
        <div className="acg-history-actions">
          <span className="acg-history-badge">{stagesCompleted} stage{stagesCompleted === 1 ? '' : 's'} completed</span>
          <div className={`acg-history-chevron ${open ? 'acg-open' : ''}`}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="6 9 12 15 18 9"/></svg>
          </div>
        </div>
      </div>
      <div className="acg-history-body">{children}</div>
    </div>
  );
}

/* ─── Polished file-upload field ─────
 * Replaces the bare `<input type="file">` (browser's grey "Choose File"
 * looks out of place inside the emerald sub-modal). Hands the parent
 * the actual File object so it can be POSTed via multipart/form-data,
 * along with a display name. `displayName` allows pre-filling the
 * filename when editing an already-uploaded row (no File available
 * but we know the name from the server).
 *
 * Client-side file-type guard:
 *   The HTML `accept` attribute is only a HINT — users can switch the
 *   file picker to "All Files" and pick a .php / .exe / .zip anyway.
 *   So we re-validate the chosen file against the allowed extensions
 *   here and reject + toast if it doesn't match. The server enforces
 *   the same list (mimes:jpg,jpeg,png,pdf) so a manipulated request
 *   can't slip through either. Word / Excel are NOT accepted — browsers
 *   can't preview them (they download), which broke the View flow. */
const DEFAULT_ACCEPT = '.pdf,.jpg,.jpeg,.png';
const MAX_MB = 2;
function parseAcceptExts(accept?: string): string[] {
  if (!accept) return [];
  return accept.split(',')
    .map(s => s.trim().toLowerCase().replace(/^\./, ''))
    .filter(s => s && !s.includes('/'));  // skip mime patterns like "image/*"
}
function isAcceptedFile(file: File, accept?: string): { ok: true } | { ok: false; reason: string } {
  // image/* shortcut — accept any image
  if (accept?.includes('image/')) {
    if (file.type.startsWith('image/')) return { ok: true };
    return { ok: false, reason: 'Only image files (JPG, JPEG, PNG) are allowed.' };
  }
  const exts = parseAcceptExts(accept || DEFAULT_ACCEPT);
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (!exts.includes(ext)) {
    return { ok: false, reason: `Only ${exts.map(e => e.toUpperCase()).join(', ')} files are allowed.` };
  }
  if (file.size > MAX_MB * 1024 * 1024) {
    return { ok: false, reason: `File must not exceed ${MAX_MB} MB.` };
  }
  return { ok: true };
}

function FileUploadField({ value, displayName, existingUrl, onPick, onRemoveExisting, accept, hint }: {
  value: File | null;
  displayName?: string;
  /** Direct URL to the existing server-side file, used by Preview when
   *  no new file has been picked. Falsy ⇒ Preview is hidden. */
  existingUrl?: string | null;
  /** Fires when the user clicks the X on a server-side (existing) file
   *  — distinct from `onPick(null)` which clears a newly-picked file.
   *  Parent uses this to flag `remove_<field>=1` for the save call. */
  onRemoveExisting?: () => void;
  onPick: (file: File | null) => void;
  accept?: string;
  hint?: string;
}) {
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // Blob URL for the newly-picked file so Preview opens it without
  // a round trip. Revoke on unmount / file-change to avoid leaks.
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!value) { setBlobUrl(null); return; }
    const url = URL.createObjectURL(value);
    setBlobUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [value]);
  const labelText = value ? value.name : (displayName || '');
  const hasFile = !!labelText;
  // Preview source: blob URL for a fresh pick, server URL for an
  // existing file. Falls back to null when neither is available
  // (e.g. file picked offline or backend isn't returning the URL yet).
  const previewUrl = value ? blobUrl : (existingUrl || null);
  const effectiveAccept = accept || DEFAULT_ACCEPT;
  const hintText = hint || (effectiveAccept.includes('image/')
    ? `JPG, JPEG, PNG — max ${MAX_MB} MB`
    : `PDF, DOC, DOCX, JPG, PNG — max ${MAX_MB} MB`);
  return (
    <div className="acm-file-zone">
      {hasFile ? (
        <div className="acm-file-chip">
          <div className="acm-file-chip-icon">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
          </div>
          <span className="acm-file-chip-name" title={labelText}>{labelText}</span>
          {previewUrl && (
            <Tooltip label="Preview">
              <button
                type="button"
                className="acm-file-chip-preview"
                aria-label="Preview"
                onClick={() => {
                  // Cache-bust server URLs (not blob URLs) so a fresh
                  // upload renders instead of the browser's cached copy.
                  // Evaluated on click so the URL doesn't churn each render.
                  let url = previewUrl;
                  if (!value) {
                    const sep = url.includes('?') ? '&' : '?';
                    url = `${url}${sep}t=${Date.now()}`;
                  }
                  window.open(url, '_blank', 'noopener,noreferrer');
                }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
              </button>
            </Tooltip>
          )}
          <button
            type="button"
            className="acm-file-chip-x"
            aria-label="Remove file"
            onClick={() => {
              setErr(null);
              if (inputRef.current) inputRef.current.value = '';
              // New pick → clear the in-memory file. Existing only →
              // tell the parent to flag the saved file for backend
              // deletion via remove_<field>=1.
              if (value) onPick(null);
              else if (onRemoveExisting) onRemoveExisting();
              else onPick(null);
            }}
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
            <span className="acm-file-drop-sub">{hintText}</span>
          </span>
        </button>
      )}
      {err && <div className="acm-file-err">{err}</div>}
      <input
        ref={inputRef}
        type="file"
        accept={effectiveAccept}
        style={{ display: 'none' }}
        onChange={e => {
          const f = e.target.files?.[0];
          if (!f) return;
          const check = isAcceptedFile(f, effectiveAccept);
          if (!check.ok) {
            setErr(check.reason);
            toast.error('File rejected', check.reason);
            if (inputRef.current) inputRef.current.value = '';
            return;
          }
          setErr(null);
          onPick(f);
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
              <th>ISSUING AUTHORITY</th><th>ATTACHMENT</th>
            </tr>
          </thead>
          <tbody>
            {docs.length === 0 ? (
              <tr className="acm-loc-empty"><td colSpan={5}>No {kind === 'dd' ? 'company DD' : 'trade licence'} documents captured in Stage 2.</td></tr>
            ) : docs.map((d, i) => (
              <tr key={d.id}>
                <td>{String(i + 1).padStart(2, '0')}</td>
                <td><span className="acm-kyc-code">{codeFor(kind, i + 1)}</span></td>
                <td style={{ fontWeight: 700 }}>{d.name}</td>
                <td>{d.issuing_authority || '—'}</td>
                <td><AttachmentLink url={d.attachment_url} path={d.attachment_path} /></td>
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
            <th>ID PROOF</th><th>ADDRESS PROOF</th><th>PHOTOGRAPH</th>
          </tr>
        </thead>
        <tbody>
          {owners.length === 0 ? (
            <tr className="acm-loc-empty"><td colSpan={8}>No owners captured in Stage 2.</td></tr>
          ) : owners.map((o, i) => (
            <tr key={o.id}>
              <td>{String(i + 1).padStart(2, '0')}</td>
              <td style={{ fontWeight: 700 }}>{o.owner_name}</td>
              <td>{o.designation || '—'}</td>
              <td>{o.official_email || '—'}</td>
              <td>{o.phone_number || '—'}</td>
              <td><AttachmentLink url={o.id_proof_url}      path={o.id_proof_path} /></td>
              <td><AttachmentLink url={o.address_proof_url} path={o.address_proof_path} /></td>
              <td><AttachmentLink url={o.photograph_url}    path={o.photograph_path} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </div>
);

/* ─── Stage 2 — Add/Edit KYC Document sub-modal (DD + Trade Licence) ─── */
function KycDocSubModal({ sub, documentTypes, editing, consigneeId, onClose, onSaved }: {
  sub: KycSubTab;
  /** Document Type master rows — backs the Name dropdown. Parent
   *  fetches once on modal open; we also refetch locally as a safety
   *  net in case the parent's fetch hasn't landed yet. */
  documentTypes: { value: string; label: string }[];
  editing: KycDocRow | null;
  /** Parent consignee's numeric PK — needed to POST/PUT under
   *  /consignees/{id}/documents. Null if Stage 1 hasn't auto-saved
   *  yet; in that case the submit shows a guidance error. */
  consigneeId: number | null;
  onClose: () => void;
  /** Fires with the server-saved row so the parent can refetch the
   *  full KYC docs list (keeps codes/URLs consistent with the DB). */
  onSaved: () => void;
}) {
  const titleLabel = sub === 'company-dd' ? 'DD Document / License' : 'Trade Licence';
  const [d, setD] = useState({
    name: editing?.name ?? '',
    license_number: editing?.license_number ?? '',
    issuing_authority: editing?.issuing_authority ?? '',
    issue_date: editing?.issue_date ?? '',
    expiry_date: editing?.expiry_date ?? '',
    status: (editing?.status ?? 'Active') as 'Active' | 'Inactive',
  });
  /* Separate file slot — `file` is the just-picked File, ready to
   * POST. `existingAttachmentName` is the filename returned by the
   * server when editing (so the chip still shows the existing
   * attachment even though no File is in memory yet). */
  const [file, setFile] = useState<File | null>(null);
  const existingAttachmentName = editing?.attachment_name ?? '';
  const existingAttachmentUrl  = editing?.attachment_url ?? '';
  // Flag: user clicked the X on the existing server-side attachment.
  // Submit forwards this as remove_attachment=1 so the backend nulls
  // the column + deletes the disk file.
  const [removeAttachment, setRemoveAttachment] = useState(false);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  // Inline "Add Document Type" master popup — opens from the `+`
  // button next to the Name dropdown. Posts to /master/document_type
  // so the new row immediately joins the dropdown without losing the
  // user's in-progress license entry.
  const [typeModal, setTypeModal] = useState(false);
  useEscapeKey(() => { if (!saving) onClose(); });
  const set = <K extends keyof typeof d>(k: K, v: (typeof d)[K]) => {
    setD(prev => ({ ...prev, [k]: v }));
    setErrs(prev => { if (!prev[k as string]) return prev; const n = { ...prev }; delete n[k as string]; return n; });
  };

  /* Defensive local fetch — same pattern as LocationSubModal. If the
   * parent's fetch hasn't landed yet, this one ensures the dropdown
   * is still populated. The effective list prefers whichever side has
   * data. */
  const [localDocTypes, setLocalDocTypes] = useState<{ value: string; label: string }[]>([]);
  useEffect(() => {
    let cancelled = false;
    api.get('/master/document_type').then(r => {
      if (cancelled) return;
      const rows = (r.data ?? [])
        .filter((x: any) => !x.status || String(x.status).toLowerCase() === 'active')
        .map((x: any) => ({ value: String(x.title ?? ''), label: String(x.title ?? '') }))
        .filter((o: any) => o.value);
      setLocalDocTypes(rows);
    }).catch(() => { /* silent — parent copy is usually enough */ });
    return () => { cancelled = true; };
  }, []);
  const docOptions = (() => {
    const base = (documentTypes.length ? documentTypes : localDocTypes);
    if (d.name && !base.some(o => o.value === d.name)) {
      return [{ value: d.name, label: d.name }, ...base];
    }
    return base;
  })();

  const submit = async () => {
    if (saving) return;
    /* Validation parity with AddCustomerModal's DocSubModal so the
     * same fields are mandatory on both sides — testers shouldn't
     * find a looser gate on consignee. Backend stays nullable for all
     * non-name fields (intentional — bulk seeds / data backfills),
     * the UI just makes them required at capture time. */
    const next: Record<string, string> = {};
    if (!d.name.trim())                                   next.name              = 'Document name is required';
    if (!(d.license_number ?? '').trim())                 next.license_number    = 'License / document number is required';
    else if ((d.license_number ?? '').trim().length > 25) next.license_number    = 'License number must be 25 characters or fewer';
    if (!(d.issuing_authority ?? '').trim())              next.issuing_authority = 'Issuing authority is required';
    if (!d.issue_date)                                    next.issue_date        = 'Issue date is required';
    else {
      // Backstop: documents can't be issued in the future even if a
      // stale picker or paste slips a future date past the maxDate cap.
      const today = new Date().toISOString().slice(0, 10);
      if (d.issue_date > today) next.issue_date = 'Issue date cannot be in the future';
    }
    if (!d.expiry_date)                                   next.expiry_date       = 'Expiry date is required';
    else {
      // Expiry must not be earlier than today — an already-expired
      // document isn't useful and shouldn't be captured against an
      // active KYC record.
      const today = new Date().toISOString().slice(0, 10);
      if (d.expiry_date < today) next.expiry_date = 'Expiry date cannot be in the past';
      else if (d.issue_date && d.expiry_date < d.issue_date) next.expiry_date = 'Expiry date must be on or after the issue date';
    }
    setErrs(next);
    if (Object.keys(next).length > 0) {
      // Bring the first offending field into view so the user sees the red border.
      const firstKey = Object.keys(next)[0];
      document.querySelector<HTMLElement>(`[data-field="${firstKey}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    if (!consigneeId) {
      setErrs({ name: 'Please complete Stage 1 first so the consignee gets an ID.' });
      return;
    }

    const kind = sub === 'company-dd' ? 'dd' : 'tl';
    const fd = new FormData();
    fd.append('kind', kind);
    fd.append('name', d.name);
    if (d.license_number)    fd.append('license_number', d.license_number);
    if (d.issuing_authority) fd.append('issuing_authority', d.issuing_authority);
    if (d.issue_date)        fd.append('issue_date', d.issue_date);
    if (d.expiry_date)       fd.append('expiry_date', d.expiry_date);
    if (d.status)            fd.append('status', d.status);
    if (file) {
      fd.append('attachment', file);
    } else if (removeAttachment && existingAttachmentUrl) {
      // No new pick + user clicked the X on the existing file → tell
      // the backend to wipe it (column null + disk delete).
      fd.append('remove_attachment', '1');
    }

    setSaving(true);
    try {
      /* Explicit multipart header — the project's default api
       * instance defaults to application/json, which strips the file
       * out of the FormData (Laravel then sees `attachment` as a
       * string field and 422s with "must be a file"). The Customer
       * modal sets this same header for the same reason. */
      const cfg = { headers: { 'Content-Type': 'multipart/form-data' } };
      if (editing?.id && editing.id.startsWith('db_')) {
        // db_-prefixed id encodes the server PK so we can find the
        // row again across refetches without re-keying.
        const numericId = Number(editing.id.replace('db_', ''));
        await api.post(`/consignees/${consigneeId}/documents/${numericId}`, fd, cfg);
      } else {
        await api.post(`/consignees/${consigneeId}/documents`, fd, cfg);
      }
      onSaved();
    } catch (err: any) {
      const apiErrors = err?.response?.data?.errors ?? null;
      if (apiErrors && typeof apiErrors === 'object') {
        const next: Record<string, string> = {};
        for (const [k, msgs] of Object.entries(apiErrors)) {
          next[k] = Array.isArray(msgs) ? String((msgs as any[])[0]) : String(msgs);
        }
        setErrs(next);
      } else {
        setErrs({ name: err?.response?.data?.message ?? 'Save failed. Please try again.' });
      }
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="acm-loc-sub-overlay">
      <div className="acm-loc-sub-card" onMouseDown={e => e.stopPropagation()}>
        <div className="acm-loc-sub-header">
          <div className="acm-loc-sub-title">{editing ? 'Edit' : 'Add'} {titleLabel}</div>
          <button type="button" className="acm-loc-sub-close" onClick={onClose} aria-label="Close"><IconClose /></button>
        </div>
        <div className="acm-loc-sub-body">
          <div className="acm-loc-grid-2">
            <div className="acm-field" data-field="name">
              <label className="acm-field-label">{titleLabel.toUpperCase()} NAME <span className="acm-req">*</span></label>
              <div className="acg-doc-name-row">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <MasterSelect
                    value={d.name}
                    options={docOptions}
                    placeholder={`Select ${titleLabel.toLowerCase()}`}
                    invalid={!!errs.name}
                    onChange={(v) => set('name', v)}
                  />
                </div>
                <Tooltip label="Add new document type">
                  <button
                    type="button"
                    className="acg-doc-plus-btn"
                    aria-label="Add new document type"
                    onClick={() => setTypeModal(true)}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                  </button>
                </Tooltip>
              </div>
              {errs.name && <span className="acm-err-text">{errs.name}</span>}
            </div>
            <div className="acm-field" data-field="license_number">
              <label className="acm-field-label">LICENSE / DOCUMENT NUMBER <span className="acm-req">*</span></label>
              <input
                className={`acm-input ${errs.license_number ? 'acm-input-error' : ''}`}
                placeholder="Enter license number (max 25)"
                value={d.license_number ?? ''}
                maxLength={25}
                onChange={e => set('license_number', e.target.value.slice(0, 25))}
              />
              {errs.license_number && <span className="acm-err-text">{errs.license_number}</span>}
            </div>
          </div>
          <div className="acm-field acm-mt-12" data-field="issuing_authority">
            <label className="acm-field-label">ISSUING AUTHORITY <span className="acm-req">*</span></label>
            <input
              className={`acm-input ${errs.issuing_authority ? 'acm-input-error' : ''}`}
              placeholder="e.g. Registrar of Companies"
              value={d.issuing_authority ?? ''}
              onChange={e => set('issuing_authority', e.target.value)}
            />
            {errs.issuing_authority && <span className="acm-err-text">{errs.issuing_authority}</span>}
          </div>
          <div className="acm-loc-grid-2 acm-mt-12">
            <div className="acm-field" data-field="issue_date">
              <label className="acm-field-label">ISSUE DATE <span className="acm-req">*</span></label>
              {/* maxDate caps at the earlier of today and the chosen
                  expiry — a document can never be issued in the future,
                  and the two date fields can never disagree. */}
              <MasterDatePicker
                value={d.issue_date ?? ''}
                maxDate={(() => {
                  const today = new Date().toISOString().slice(0, 10);
                  return d.expiry_date && d.expiry_date < today ? d.expiry_date : today;
                })()}
                placeholder="DD/MM/YYYY"
                invalid={!!errs.issue_date}
                onChange={(v: string) => {
                  set('issue_date', v);
                  if (d.expiry_date && v && d.expiry_date < v) set('expiry_date', '');
                }}
              />
              {errs.issue_date && <span className="acm-err-text">{errs.issue_date}</span>}
            </div>
            <div className="acm-field" data-field="expiry_date">
              <label className="acm-field-label">EXPIRY DATE <span className="acm-req">*</span></label>
              {/* minDate forces expiry ≥ the later of (today, issue
                  date) — a document can't already be expired and
                  can't be valid before it was even issued. The
                  submit-time validator below is the backstop in case
                  a stale picker / paste slips a past value through. */}
              <MasterDatePicker
                value={d.expiry_date ?? ''}
                minDate={(() => {
                  const today = new Date().toISOString().slice(0, 10);
                  return d.issue_date && d.issue_date > today ? d.issue_date : today;
                })()}
                placeholder="DD/MM/YYYY"
                invalid={!!errs.expiry_date}
                onChange={(v: string) => set('expiry_date', v)}
              />
              {errs.expiry_date && <span className="acm-err-text">{errs.expiry_date}</span>}
            </div>
          </div>
          <div className="acm-mt-12">
            <div className="acm-field">
              <label className="acm-field-label">ATTACHMENT</label>
              <FileUploadField
                value={file}
                displayName={file ? '' : (removeAttachment ? '' : existingAttachmentName)}
                existingUrl={removeAttachment ? null : existingAttachmentUrl}
                onPick={(f) => {
                  setFile(f);
                  if (f) setRemoveAttachment(false);   // new pick supersedes any prior "remove"
                }}
                onRemoveExisting={() => setRemoveAttachment(true)}
                accept=".pdf,.jpg,.jpeg,.png"
              />
            </div>
          </div>
        </div>
        <div className="acm-loc-sub-footer">
          <button type="button" className="acm-btn acm-btn-light" onClick={onClose} disabled={saving}>Cancel</button>
          <button
            type="button"
            className="acm-btn acm-btn-primary"
            onClick={submit}
            disabled={saving}
            style={saving ? { opacity: 0.7, cursor: 'wait' } : undefined}
          >
            {saving ? <><IconSpinner size={14} /> Saving…</> : (editing ? 'Update' : 'Save')}
          </button>
        </div>
      </div>
      {typeModal && (
        <AddDocumentTypeMasterPopup
          onClose={() => setTypeModal(false)}
          onSaved={(name) => {
            /* Append the new master row to the dropdown source via a
             * local state slot, then auto-select it on the form so
             * the user can save the in-progress doc without losing
             * any inputs. */
            setLocalDocTypes(prev => prev.some(o => o.value === name) ? prev : [...prev, { value: name, label: name }]);
            set('name', name);
            setTypeModal(false);
          }}
        />
      )}
    </div>
  );
}

/* ───── Inline "Add Document Type" master popup ─────
 * Mirrors AddCustomerModal's AddDocumentTypeMasterModal — posts to
 * /master/document_type so the new row immediately joins the dropdown.
 * Stays modal on top of the KYC Doc sub-modal so the user never loses
 * their in-progress license entry. */
function AddDocumentTypeMasterPopup({ onClose, onSaved }: {
  onClose: () => void;
  onSaved: (name: string) => void;
}) {
  const toast = useToast();
  const [title, setTitle]               = useState('');
  const [applicableTo, setApplicableTo] = useState('');
  const [isMandatory, setIsMandatory]   = useState('');
  const [status, setStatus]             = useState('Active');
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  useEscapeKey(() => { if (!saving) onClose(); });

  const submit = async () => {
    if (saving) return;
    const next: Record<string, string> = {};
    if (!title.trim()) next.title = 'Document type name is required';
    if (!status)       next.status = 'Status is required';
    setErrs(next);
    if (Object.keys(next).length) return;
    setSaving(true);
    try {
      const { data } = await api.post('/master/document_type', {
        title:         title.trim(),
        applicable_to: applicableTo || null,
        is_mandatory:  isMandatory  || null,
        status,
      });
      const row = data?.data ?? data;
      onSaved(String(row?.title ?? title.trim()));
      // Cached customer/consignee bundle now stale — bust it so the next
      // open of either modal refetches the fresh doctype list.
      bustCustomerMasterBundle();
    } catch (err: any) {
      const apiErrors = err?.response?.data?.errors;
      if (apiErrors && typeof apiErrors === 'object') {
        const next2: Record<string, string> = {};
        for (const [k, msgs] of Object.entries(apiErrors)) {
          next2[k] = Array.isArray(msgs) ? String((msgs as any[])[0]) : String(msgs);
        }
        setErrs(next2);
        // Toast suppressed — inline red errors handle this.
      } else {
        toast.error('Save failed', err?.response?.data?.message ?? 'Could not save the document type. Try again.');
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    // Backdrop is purely visual — closing only via the X / Cancel button
    // so accidental outside-clicks don't wipe an in-progress entry.
    <div className="acm-loc-sub-overlay" style={{ zIndex: 10002 }}>
      <div className="acm-loc-sub-card" style={{ maxWidth: 480 }}>
        <div className="acm-loc-sub-header">
          <div className="acm-loc-sub-title">Add Document Type</div>
          <button type="button" className="acm-loc-sub-close" onClick={onClose} aria-label="Close"><IconClose /></button>
        </div>
        <div className="acm-loc-sub-body">
          <div className="acm-field" data-field="title">
            <label className="acm-field-label">DOCUMENT TYPE NAME <span className="acm-req">*</span></label>
            <input
              className={`acm-input ${errs.title ? 'acm-input-error' : ''}`}
              placeholder="e.g. GST Registration Certificate"
              value={title}
              onChange={e => { setTitle(e.target.value); if (errs.title) setErrs(p => { const n = { ...p }; delete n.title; return n; }); }}
              autoFocus
            />
            {errs.title && <span className="acm-err-text">{errs.title}</span>}
          </div>
          <div className="acm-loc-grid-2 acm-mt-12">
            <div className="acm-field">
              <label className="acm-field-label">APPLICABLE TO</label>
              <MasterSelect
                value={applicableTo}
                options={[
                  { value: 'Customer', label: 'Customer' },
                  { value: 'Vendor',   label: 'Supplier' },
                  { value: 'Both',     label: 'Both' },
                  { value: 'Internal', label: 'Internal' },
                ]}
                placeholder="Select…"
                onChange={(v) => setApplicableTo(v)}
              />
            </div>
            <div className="acm-field">
              <label className="acm-field-label">IS MANDATORY</label>
              <MasterSelect
                value={isMandatory}
                options={[{ value: 'Yes', label: 'Yes' }, { value: 'No', label: 'No' }]}
                placeholder="Select…"
                onChange={(v) => setIsMandatory(v)}
              />
            </div>
          </div>
          <div className="acm-field acm-mt-12" data-field="status">
            <label className="acm-field-label">STATUS <span className="acm-req">*</span></label>
            <MasterSelect
              value={status}
              options={[{ value: 'Active', label: 'Active' }, { value: 'Inactive', label: 'Inactive' }]}
              placeholder="Select…"
              invalid={!!errs.status}
              onChange={(v) => setStatus(v)}
            />
            {errs.status && <span className="acm-err-text">{errs.status}</span>}
          </div>
        </div>
        <div className="acm-loc-sub-footer">
          <button type="button" className="acm-btn acm-btn-light" onClick={onClose} disabled={saving}>Cancel</button>
          <button
            type="button"
            className="acm-btn acm-btn-primary"
            onClick={submit}
            disabled={saving}
            style={saving ? { opacity: 0.7, cursor: 'wait' } : undefined}
          >
            {saving ? <><IconSpinner size={14} /> Saving…</> : 'Save Document Type'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Stage 2 — Add/Edit Owner KYC sub-modal ─── */
function KycOwnerSubModal({ editing, consigneeId, designations, onClose, onSaved }: {
  editing: KycOwnerRow | null;
  consigneeId: number | null;
  /** Designations master rows — backs the Designation dropdown so the
   *  owner KYC form pulls from the same source as the rest of the
   *  app (was previously a free-text input that bypassed the master). */
  designations: { value: string; label: string }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [d, setD] = useState({
    owner_name: editing?.owner_name ?? '',
    designation: editing?.designation ?? '',
    official_email: editing?.official_email ?? '',
    phone_number: editing?.phone_number ?? '',
    status: (editing?.status ?? 'Active') as 'Active' | 'Inactive',
  });
  /* Three separate file slots — each holds the just-picked File, ready
   * to POST. Existing filenames (when editing) live alongside so the
   * chip still shows the existing upload before the user replaces it. */
  const [idProof,      setIdProof]      = useState<File | null>(null);
  const [addressProof, setAddressProof] = useState<File | null>(null);
  const [photograph,   setPhotograph]   = useState<File | null>(null);
  const existingIdProofName      = editing?.id_proof_name ?? '';
  const existingAddressProofName = editing?.address_proof_name ?? '';
  const existingPhotographName   = editing?.photograph_name ?? '';
  const existingIdProofUrl       = editing?.id_proof_url ?? '';
  const existingAddressProofUrl  = editing?.address_proof_url ?? '';
  const existingPhotographUrl    = editing?.photograph_url ?? '';
  // Per-slot "remove existing" flags — forwarded as remove_<field>=1
  // on submit when no new file has been picked, so the backend nulls
  // the column and deletes the disk file.
  const [removeIdProof,      setRemoveIdProof]      = useState(false);
  const [removeAddressProof, setRemoveAddressProof] = useState(false);
  const [removePhotograph,   setRemovePhotograph]   = useState(false);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  useEscapeKey(() => { if (!saving) onClose(); });
  const set = <K extends keyof typeof d>(k: K, v: (typeof d)[K]) => {
    setD(prev => ({ ...prev, [k]: v }));
    setErrs(prev => { if (!prev[k as string]) return prev; const n = { ...prev }; delete n[k as string]; return n; });
  };
  const submit = async () => {
    if (saving) return;
    const next: Record<string, string> = {};
    if (!d.owner_name.trim())                                          next.owner_name     = 'Owner name is required';
    if (d.official_email && !/^[A-Za-z0-9._%+-]+@[A-Za-z0-9][A-Za-z0-9.-]*\.[A-Za-z]{2,}$/.test(d.official_email))  next.official_email = 'Enter a valid email';
    if (d.phone_number && !/^\+?[0-9\s-]{7,15}$/.test(d.phone_number)) next.phone_number   = 'Phone must be 7-15 digits';
    setErrs(next);
    if (Object.keys(next).length > 0) return;
    if (!consigneeId) {
      setErrs({ owner_name: 'Please complete Stage 1 first so the consignee gets an ID.' });
      return;
    }

    const fd = new FormData();
    fd.append('owner_name', d.owner_name);
    if (d.designation)    fd.append('designation', d.designation);
    if (d.official_email) fd.append('official_email', d.official_email);
    if (d.phone_number)   fd.append('phone_number', d.phone_number);
    if (d.status)         fd.append('status', d.status);
    if (idProof)      fd.append('id_proof', idProof);
    else if (removeIdProof && existingIdProofUrl) fd.append('remove_id_proof', '1');
    if (addressProof) fd.append('address_proof', addressProof);
    else if (removeAddressProof && existingAddressProofUrl) fd.append('remove_address_proof', '1');
    if (photograph)   fd.append('photograph', photograph);
    else if (removePhotograph && existingPhotographUrl) fd.append('remove_photograph', '1');

    setSaving(true);
    try {
      /* Explicit multipart header — the project's api default
       * application/json strips File uploads from FormData. Without
       * this the 3 identity-proof files arrive as empty strings and
       * Laravel 422s with "must be a file". */
      const cfg = { headers: { 'Content-Type': 'multipart/form-data' } };
      if (editing?.id && editing.id.startsWith('db_')) {
        const numericId = Number(editing.id.replace('db_', ''));
        await api.post(`/consignees/${consigneeId}/owners/${numericId}`, fd, cfg);
      } else {
        await api.post(`/consignees/${consigneeId}/owners`, fd, cfg);
      }
      onSaved();
    } catch (err: any) {
      const apiErrors = err?.response?.data?.errors ?? null;
      if (apiErrors && typeof apiErrors === 'object') {
        const next: Record<string, string> = {};
        for (const [k, msgs] of Object.entries(apiErrors)) {
          next[k] = Array.isArray(msgs) ? String((msgs as any[])[0]) : String(msgs);
        }
        setErrs(next);
      } else {
        setErrs({ owner_name: err?.response?.data?.message ?? 'Save failed. Please try again.' });
      }
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="acm-loc-sub-overlay">
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
              {/* Free-text input — was a MasterSelect tied to
                  /master/designations; switched to a plain input so
                  users can type any designation (Director, Owner,
                  Authorised Signatory, etc.) without master upkeep. */}
              <input
                className="acm-input"
                placeholder="e.g. Director, Owner, Authorised Signatory"
                value={d.designation ?? ''}
                onChange={e => set('designation', e.target.value)}
                maxLength={60}
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
                value={idProof}
                displayName={idProof ? '' : (removeIdProof ? '' : existingIdProofName)}
                existingUrl={removeIdProof ? null : existingIdProofUrl}
                onPick={(f) => { setIdProof(f); if (f) setRemoveIdProof(false); }}
                onRemoveExisting={() => setRemoveIdProof(true)}
                accept=".pdf,.jpg,.jpeg,.png"
              />
            </div>
            <div className="acm-field">
              <label className="acm-field-label">ADDRESS PROOF</label>
              <FileUploadField
                value={addressProof}
                displayName={addressProof ? '' : (removeAddressProof ? '' : existingAddressProofName)}
                existingUrl={removeAddressProof ? null : existingAddressProofUrl}
                onPick={(f) => { setAddressProof(f); if (f) setRemoveAddressProof(false); }}
                onRemoveExisting={() => setRemoveAddressProof(true)}
                accept=".pdf,.jpg,.jpeg,.png"
              />
            </div>
          </div>
          <div className="acm-field acm-mt-12">
            <label className="acm-field-label">PHOTOGRAPH</label>
            <FileUploadField
              value={photograph}
              displayName={photograph ? '' : (removePhotograph ? '' : existingPhotographName)}
              existingUrl={removePhotograph ? null : existingPhotographUrl}
              onPick={(f) => { setPhotograph(f); if (f) setRemovePhotograph(false); }}
              onRemoveExisting={() => setRemovePhotograph(true)}
              accept=".jpg,.jpeg,.png"
            />
          </div>
        </div>
        <div className="acm-loc-sub-footer">
          <button type="button" className="acm-btn acm-btn-light" onClick={onClose} disabled={saving}>Cancel</button>
          <button
            type="button"
            className="acm-btn acm-btn-primary"
            onClick={submit}
            disabled={saving}
            style={saving ? { opacity: 0.7, cursor: 'wait' } : undefined}
          >
            {saving ? <><IconSpinner size={14} /> Saving…</> : (editing ? 'Update' : 'Save')}
          </button>
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

function LocationSubModal({ editing, masters, disallowedTypes, existingEmails = [], existingPhones = [], onClose, onSave }: {
  editing: LocationRow | null;
  masters: LocSubModalMasters;
  /** Address types already claimed elsewhere (e.g. Registered Office on
   *  the primary address). Filtered out of the dropdown so a consignee
   *  doesn't end up with two registered offices. The currently-editing
   *  row's own type is still shown to avoid hiding existing data. */
  disallowedTypes?: string[];
  /** Emails / phones already used by other addresses (primary + other
   *  locations) on this consignee — used to block duplicates within
   *  the same form before the user can save and run into a backend
   *  conflict. Lower-cased emails, trimmed phones. */
  existingEmails?: string[];
  existingPhones?: string[];
  onClose: () => void;
  onSave: (rec: Omit<LocationRow, 'id'>) => void;
}) {
  const toast = useToast();
  // Skip the default "Registered Office" prefill when that type is
  // disallowed — otherwise the user lands on a value they can't save.
  const initialType = editing
    ? editing.type
    : (disallowedTypes?.includes(DEFAULT_ADDRESS_TYPE) ? '' : DEFAULT_ADDRESS_TYPE);
  const [d, setD] = useState<Omit<LocationRow, 'id'>>(() => editing ? { ...editing } : {
    type: initialType, line: '', country: '', state: '', city: '', pin: '',
    cpName: '', cpDesignation: '', cpContact: '', cpEmail: '', cpWhatsapp: 'yes' as 'yes' | 'no' | '',
  });
  const [errs, setErrs] = useState<Record<string, string>>({});
  useEscapeKey(onClose);
  /* Per-field validator — single source of truth shared with submit().
   * Returns the error message for one field (or null when clean) so
   * the inline red can fire on each keystroke instead of waiting for
   * the user to hit Save. */
  const locFieldRule = (k: string, dd: typeof d): string | null => {
    switch (k) {
      case 'type':
        if (!dd.type) return 'Select address type';
        return null;
      case 'line':
        if (!dd.line.trim()) return 'Address is required';
        if (dd.line.trim().length < 4) return 'Address must be at least 4 characters';
        if (dd.line.trim().length > 75) return 'Address must be 75 characters or fewer';
        if (!/[A-Za-z]/.test(dd.line)) return 'Address must contain at least one letter';
        return null;
      case 'country':
        if (!dd.country) return 'Select country';
        return null;
      case 'state':
        if (!dd.state) return 'Select state';
        return null;
      case 'city':
        if (!dd.city.trim()) return 'City is required';
        if (dd.city.trim().length > 30) return 'City must be 30 characters or fewer';
        if (!/^[A-Za-z][A-Za-z .'\-]*$/.test(dd.city.trim()))
          return 'City can contain only letters, spaces, dots, hyphens and apostrophes';
        return null;
      case 'pin':
        if (!dd.pin.trim()) return 'PIN is required';
        if (!/^\d{6}$/.test(dd.pin.trim())) return 'PIN must be exactly 6 digits';
        return null;
      case 'cpName':
        if (!dd.cpName.trim()) return 'Contact name required';
        if (dd.cpName.trim().length > 60) return 'Name must be 60 characters or fewer';
        if (!/^[A-Za-z][A-Za-z .'\-]*$/.test(dd.cpName.trim()))
          return 'Name can contain only letters, spaces, dots, hyphens and apostrophes';
        return null;
      case 'cpDesignation':
        if (!dd.cpDesignation.trim()) return 'Designation required';
        return null;
      case 'cpContact':
        if (!dd.cpContact.trim()) return 'Phone required';
        if (!/^\+?[0-9\s-]{7,15}$/.test(dd.cpContact)) return 'Phone must be 7-15 digits';
        if (existingPhones.includes(dd.cpContact.trim()))
          return 'This phone number is already used by another address on this consignee';
        return null;
      case 'cpEmail':
        if (!dd.cpEmail.trim()) return 'Email required';
        if (!/^[A-Za-z0-9._%+-]+@[A-Za-z0-9][A-Za-z0-9.-]*\.[A-Za-z]{2,}$/.test(dd.cpEmail)) return 'Enter a valid email';
        if (existingEmails.includes(dd.cpEmail.trim().toLowerCase()))
          return 'This email is already used by another address on this consignee';
        return null;
      case 'cpWhatsapp':
        if (!dd.cpWhatsapp) return 'Select WhatsApp preference';
        return null;
    }
    return null;
  };
  const set = <K extends keyof typeof d>(k: K, v: (typeof d)[K]) => {
    const nextD = { ...d, [k]: v } as typeof d;
    setD(nextD);
    const msg = locFieldRule(k as string, nextD);
    setErrs(prev => {
      const next = { ...prev };
      if (msg) next[k as string] = msg;
      else delete next[k as string];
      return next;
    });
  };
  /* Real-time duplicate check — fires the inline error the moment the
   * user types a phone or email already in use by the primary contact
   * or another location on this consignee. Mirrors the click-time
   * validator in submit() so behaviour stays consistent. */
  useEffect(() => {
    const phone = (d.cpContact || '').trim();
    const email = (d.cpEmail   || '').trim().toLowerCase();
    const dupPhoneMsg = 'This phone number is already used by another address on this consignee';
    const dupEmailMsg = 'This email is already used by another address on this consignee';
    setErrs(prev => {
      const next = { ...prev };
      if (phone && existingPhones.includes(phone)) next.cpContact = dupPhoneMsg;
      else if (next.cpContact === dupPhoneMsg) delete next.cpContact;
      if (email && existingEmails.includes(email)) next.cpEmail = dupEmailMsg;
      else if (next.cpEmail === dupEmailMsg) delete next.cpEmail;
      return next;
    });
  }, [d.cpContact, d.cpEmail, existingPhones, existingEmails]);

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
  const addressTypesAll = masters.addressTypes.length ? masters.addressTypes : local.addressTypes;
  const countries    = masters.countries.length    ? masters.countries    : local.countries;
  const states       = masters.states.length       ? masters.states       : local.states;
  const designations = masters.designations.length ? masters.designations : local.designations;
  // Strip disallowed types but always keep the row's own value so an
  // existing selection never silently disappears mid-edit.
  const addressTypes = (!disallowedTypes || disallowedTypes.length === 0)
    ? addressTypesAll
    : addressTypesAll.filter(t => !disallowedTypes.includes(t.value) || t.value === d.type);

  const selectedCountry = countries.find(c => c.value === d.country);
  const filteredStates = selectedCountry ? states.filter(s => s.countryId === selectedCountry.id) : [];

  const submit = () => {
    const next: Record<string, string> = {};
    const keys = ['type','line','country','state','city','pin','cpName','cpDesignation','cpContact','cpEmail','cpWhatsapp'];
    for (const k of keys) {
      const msg = locFieldRule(k, d);
      if (msg) next[k] = msg;
    }
    setErrs(next);
    if (Object.keys(next).length === 0) { onSave(d); return; }
    // Toast suppressed — inline red errors handle this.
  };

  return (
    <div className="acm-loc-sub-overlay">
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
                maxLength={75}
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
                onChange={v => {
                  const nd = { ...d, country: v, state: '' } as typeof d;
                  setD(nd);
                  setErrs(prev => {
                    const next = { ...prev };
                    const c = locFieldRule('country', nd);
                    if (c) next.country = c; else delete next.country;
                    const s = locFieldRule('state', nd);
                    if (s) next.state = s; else delete next.state;
                    return next;
                  });
                }}
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
                placeholder="6-digit PIN"
                inputMode="numeric"
                maxLength={6}
                value={d.pin}
                onChange={e => set('pin', e.target.value.replace(/\D/g, '').slice(0, 6))}
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
              {/* Free-text input — was a MasterSelect tied to
                  /master/designations; switched to a plain input so
                  the location's contact designation can be anything
                  the user types. */}
              <input
                className={`acm-input ${errs.cpDesignation ? 'acm-input-error' : ''}`}
                placeholder="e.g. Sales Manager"
                value={d.cpDesignation}
                onChange={e => set('cpDesignation', e.target.value)}
                maxLength={60}
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
/* Inline spinner used by the wizard footer buttons while a save/persist
 * request is in flight. Rendered as currentColor so it picks up the
 * button's existing text color on both light and dark mode. */
const IconSpinner = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="acg-spin">
    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
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
/* Padlock — used to mark the Stage 2 KYC tables as locked while
 * Same-as-Customer is on. Reads more clearly than a faded button. */
const IconLock = ({ size = 12 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="11" width="18" height="11" rx="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
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
/* Requirement + completion badges — theme-aware (Stage 2 upload table + Stage 3
   review). Light defaults plus dark overrides so they never wash out. */
.acm-badge { display:inline-flex; align-items:center; gap:4px; padding:3px 10px; border-radius:999px; font-size:11px; font-weight:700; border:1px solid transparent; white-space:nowrap; }
.acm-badge--mand   { background:#dcfce7; color:#15803d; border-color:#86efac; }
.acm-badge--opt    { background:#f3f4f6; color:#4b5563; border-color:#e5e7eb; }
.acm-badge--done   { background:#d1fae5; color:#065f46; border-color:#6ee7b7; }
.acm-badge--miss-m { background:#fee2e2; color:#b91c1c; border-color:#fecaca; }
.acm-badge--miss-o { background:#f3f4f6; color:#6b7280; border-color:#e5e7eb; }
[data-bs-theme="dark"] .acm-badge--mand   { background:rgba(16,185,129,0.18); color:#6ee7b7; border-color:rgba(16,185,129,0.40); }
[data-bs-theme="dark"] .acm-badge--opt    { background:rgba(255,255,255,0.06); color:#cbd5e1; border-color:rgba(255,255,255,0.14); }
[data-bs-theme="dark"] .acm-badge--done   { background:rgba(16,185,129,0.18); color:#6ee7b7; border-color:rgba(16,185,129,0.40); }
[data-bs-theme="dark"] .acm-badge--miss-m { background:rgba(239,68,68,0.18); color:#fca5a5; border-color:rgba(239,68,68,0.40); }
[data-bs-theme="dark"] .acm-badge--miss-o { background:rgba(255,255,255,0.06); color:#94a3b8; border-color:rgba(255,255,255,0.12); }
.acm-overlay {
  position: fixed; inset: 0;
  background: rgba(15, 42, 35, 0.55);
  backdrop-filter: blur(6px);
  display: flex; align-items: center; justify-content: center;
  /* Same base z-index as AddCustomerModal so any modal launched from
   * a sibling popup (e.g. CustomerConsigneesModal at 1090) stacks
   * predictably. The full project stack: customer-consignee popup
   * 1090 < wizard 10000 < wizard sub-modals (loc/KYC) 10001 < doc
   * type popup-on-popup 10002 < MasterSelect 11000 < DeleteConfirm
   * 11050 < MasterDatePicker 11100. */
  z-index: 10000;
  font-family: var(--font-sans);
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
  transition: all .25s;
}
.acm-close:hover { background: rgba(255,255,255,.30); transform: rotate(90deg); }

/* ─── Phase A — Customer picker ─── */
.acm-pick {
  width: 100%; max-width: 460px;
  /* Locked height so the picker doesn't grow / shrink when the search
     dropdown opens or the customer list lands. The body scrolls
     internally — header + footer stay anchored at top / bottom. */
  height: min(560px, calc(100vh - 32px));
  background: #fff; border-radius: 18px; overflow: hidden;
  box-shadow: 0 30px 80px rgba(0,0,0,.30);
  display: flex; flex-direction: column;
}
/* Picker header — same mint→teal gradient used by the listing hero,
   WDH banner, and modal header so the picker feels like one piece
   of the consignee chrome. White text + glassy icon on the wash. */
.acm-pick-header {
  position: relative; padding: 28px 20px 24px;
  /* Brighter, more even teal (Figma) — drops the dark emerald corner that
     made the old 135deg ramp read as a harsh dark-green → light diagonal. */
  background: linear-gradient(150deg, #0e9f86 0%, #14b8a6 45%, #20c9b6 75%, #2dd4bf 100%);
  color: #fff; text-align: center;
  overflow: hidden;
  /* Never let the body's growth (when the search dropdown opens) squeeze the
     header — it would clip the subtitle. Header stays fixed; body scrolls. */
  flex-shrink: 0;
}
.acm-pick-header::before {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  background-image:
    radial-gradient(ellipse at 20% 50%, rgba(255,255,255,0.22) 0%, transparent 55%),
    radial-gradient(ellipse at 80% 50%, rgba(167,243,208,0.20) 0%, transparent 55%);
}
.acm-pick-icon {
  position: relative; z-index: 1;
  width: 50px; height: 50px; border-radius: 14px;
  background: rgba(255,255,255,0.22);
  border: 1.5px solid rgba(255,255,255,0.35);
  display: inline-flex; align-items: center; justify-content: center;
  color: #fff; margin-bottom: 12px;
  -webkit-backdrop-filter: blur(6px);
  backdrop-filter: blur(6px);
  box-shadow: 0 4px 14px rgba(0,0,0,0.15);
}
.acm-pick-title {
  position: relative; z-index: 1;
  font-size: 19px; font-weight: 800; letter-spacing: -0.4px;
  color: #fff;
  text-shadow: 0 1px 2px rgba(0,0,0,0.12);
}
.acm-pick-sub {
  position: relative; z-index: 1;
  font-size: 12px; color: rgba(255,255,255,0.92);
  margin-top: 6px; line-height: 1.45; padding: 0 14px;
}
.acm-pick-body  {
  padding: 22px 20px 18px; display: flex; flex-direction: column; gap: 12px;
  /* overflow VISIBLE so the absolutely-positioned search dropdown can float
     over the picked-customer card + info below it (the dropdown has its own
     internal scroll). Body content itself is small and fixed. */
  flex: 1 1 auto; min-height: 0; overflow: visible;
}
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
.acm-picker-wrap { position: relative; }
/* Float the dropdown as an OVERLAY over the picked-customer card + info note
   below it, so it always shows even after a customer is selected (it used to
   get pushed off the bottom of the fixed-height popup). */
.acm-picker-list {
  position: absolute;
  top: calc(100% + 8px); left: 0; right: 0;
  z-index: 40;
  border: 1.5px solid #a7f3d0; border-radius: 12px;
  max-height: 280px; overflow-y: auto;
  background: #fff;
  box-shadow: 0 14px 36px rgba(13,148,136,.22), 0 4px 12px rgba(0,0,0,.08);
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
  background: linear-gradient(135deg, #0d9488, #065f46);
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
  background: linear-gradient(135deg, #0d9488, #065f46);
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

/* ─── Linked Customer panel — slim collapsible header + dense
   4-col Label : Value grid (mirrors the "What you did in previous
   stages" recap). Same look as the recap so all read-only blocks
   feel identical. */
.acg-linked {
  margin-bottom: 12px;
  border-radius: 12px;
  border: 1.5px solid #a7f3d0;
  background: #fff;
  overflow: hidden;
  box-shadow: 0 2px 12px rgba(16,185,129,.09);
  flex-shrink: 0;
}
.acg-linked-bar {
  display: flex; align-items: center; justify-content: space-between;
  gap: 12px;
  padding: 10px 16px;
  cursor: pointer;
  /* Figma: clean white bar — no left accent stripe. */
  background: #ffffff;
  user-select: none;
}
.acg-linked-bar:hover { background: #f6fefb; }
.acg-linked-bar-left { display: flex; align-items: center; gap: 10px; min-width: 0; }
.acg-linked-icon {
  width: 30px; height: 30px; border-radius: 8px;
  background: linear-gradient(135deg, #0d9488, #065f46);
  color: #fff;
  display: inline-flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.acg-linked-title { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.acg-linked-tag {
  font-size: 10px; font-weight: 800;
  color: #047857;
  background: #fff;
  border: 1px solid #a7f3d0;
  padding: 2px 8px;
  border-radius: 999px;
  letter-spacing: .06em;
}
.acg-linked-id {
  font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, monospace;
  font-size: 11px; font-weight: 700;
  color: #047857;
  background: rgba(16,185,129,0.10);
  border: 1px solid rgba(16,185,129,0.25);
  padding: 2px 8px;
  border-radius: 6px;
}
.acg-linked-name {
  font-size: 13px; font-weight: 700;
  color: #064e3b;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  max-width: 320px;
}
.acg-linked-sub { font-size: 10.5px; color: #047857; margin-top: 2px; }
.acg-linked-actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.acg-linked-badge {
  padding: 3px 11px; border-radius: 20px;
  background: linear-gradient(135deg, #0d9488, #065f46);
  color: #fff;
  font-size: 9.5px; font-weight: 800;
  white-space: nowrap;
  letter-spacing: .04em;
}
/* "Show / Hide" pill (Figma) — text + chevron in a light bordered capsule. */
.acg-linked-toggle {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 4px 12px; border-radius: 8px;
  background: #fff; border: 1px solid #a7f3d0;
  color: #047857; font-size: 11.5px; font-weight: 700;
  cursor: pointer; white-space: nowrap;
  transition: background .15s, border-color .15s, color .15s;
}
.acg-linked-toggle:hover { background: #ecfdf5; border-color: #6ee7b7; color: #065f46; }
.acg-linked-chev {
  display: inline-flex; align-items: center; justify-content: center;
  color: inherit;
  transition: transform .3s;
}
.acg-linked-chev.is-open { transform: rotate(180deg); }
.acg-linked.is-open .acg-linked-bar { border-bottom: 1px solid #d1fae5; }

[data-bs-theme="dark"] .acg-linked {
  background: rgba(16,185,129,0.08);
  border-color: rgba(16,185,129,0.30);
  box-shadow: 0 2px 12px rgba(0,0,0,0.35);
}
[data-bs-theme="dark"] .acg-linked-bar {
  background: transparent;
}
[data-bs-theme="dark"] .acg-linked-bar:hover {
  background: rgba(16,185,129,0.10);
}
[data-bs-theme="dark"] .acg-linked-toggle { background: rgba(255,255,255,0.04); border-color: rgba(16,185,129,0.35); color: #6ee7b7; }
[data-bs-theme="dark"] .acg-linked-toggle:hover { background: rgba(16,185,129,0.14); border-color: rgba(110,231,183,0.5); color: #ecfdf5; }
[data-bs-theme="dark"] .acg-linked-tag  { background: rgba(255,255,255,0.04); border-color: rgba(16,185,129,0.30); color: #6ee7b7; }
[data-bs-theme="dark"] .acg-linked-id   { color: #6ee7b7; background: rgba(16,185,129,0.18); border-color: rgba(16,185,129,0.30); }
[data-bs-theme="dark"] .acg-linked-name { color: #d1fae5; }
[data-bs-theme="dark"] .acg-linked-sub  { color: #6ee7b7; }
[data-bs-theme="dark"] .acg-linked.is-open .acg-linked-bar { border-bottom-color: rgba(16,185,129,0.18); }

.acm-pick-footer {
  /* Right-aligned button group so the primary action sits at the
     button-bar's natural anchor point instead of stretching to fill
     leftover space. At 125–175% browser zoom the previous flex:1
     primary made Cancel look like a tiny chip next to a huge bar. */
  display: flex; align-items: center; justify-content: flex-end; gap: 10px;
  padding: 14px 20px 18px;
  border-top: 1px solid #f0fdf4;
  flex-shrink: 0;
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
/* Match the primary button's interactive feel — a soft shadow + a 1px
 * lift so Cancel/Previous read as proper buttons on hover instead of
 * sitting flat next to a glowing Save & Next. */
.acm-btn-light:hover {
  background: #f9fafb;
  border-color: #10b981;
  color: #047857;
  box-shadow: 0 4px 14px rgba(5,150,105,.18);
  transform: translateY(-1px);
}
.acm-btn-primary {
  background: linear-gradient(135deg, #0d9488, #065f46);
  color: #fff;
  box-shadow: 0 4px 14px rgba(5,150,105,.30);
  /* Sensible min-width so the primary CTA stays prominent without
     stretching to fill the footer at high zoom levels. The wizard
     footer .acm-footer-right row overrides this with flex:1 for the
     2-up Previous + Save & Next layout. */
  min-width: 180px;
}
.acm-btn-primary:hover { box-shadow: 0 6px 20px rgba(5,150,105,.45); transform: translateY(-1px); }
.acm-btn-disabled,
.acm-btn:disabled {
  opacity: .60; cursor: not-allowed; transform: none !important; box-shadow: none !important;
}
/* Spin animation for the footer Save & Next / Save Consignee buttons
   while a persist request is in flight — gives the user immediate
   visual feedback that the click was registered and work is happening. */
@keyframes acg-spin { to { transform: rotate(360deg); } }
.acg-spin { animation: acg-spin .9s linear infinite; transform-origin: 50% 50%; }

/* Edit-mode hydration progress strip — thin indeterminate bar above
   the Stage 1 form while /consignees/:id resolves. Replaces the
   previous full-form skeleton so the user sees the pre-filled form
   immediately and the strip just signals "more data on its way". */
.acg-hydrate-strip {
  display: flex; align-items: center; gap: 10px;
  padding: 6px 12px;
  background: #ecfdf5;
  border: 1px solid rgba(16,185,129,.30);
  border-radius: 10px;
}
.acg-hydrate-strip-text {
  font-size: 11.5px; font-weight: 600; color: #047857; letter-spacing: .02em;
}
.acg-hydrate-strip-bar {
  flex: 1; height: 4px; border-radius: 999px;
  background: linear-gradient(90deg,
    rgba(16,185,129,.10) 0%, rgba(16,185,129,.10) 30%,
    rgba(16,185,129,.55) 50%,
    rgba(16,185,129,.10) 70%, rgba(16,185,129,.10) 100%);
  background-size: 200% 100%;
  animation: acg-hydrate-slide 1.2s linear infinite;
}
@keyframes acg-hydrate-slide {
  0%   { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
[data-bs-theme="dark"] .acg-hydrate-strip { background: rgba(16,185,129,.10); border-color: rgba(16,185,129,.30); }
[data-bs-theme="dark"] .acg-hydrate-strip-text { color: #6ee7b7; }

/* ─── Phase B — Wizard ─── */
.acm-wiz {
  /* Wider + shorter footprint: cap width at 1440 so the 2-col / 4-col
     field rows get more horizontal room, and trim the locked height so
     the modal reads as a wide panel rather than a tall one. */
  width: 100%; max-width: 1440px;
  /* Locked height so all three stages occupy the same viewport
     footprint — switching between Stage 1 (lots of fields), Stage 2
     (single row table), and Stage 3 no longer makes the modal grow
     or shrink. min() caps the height so tall monitors don't get an
     oversized modal; body scrolls internally, header + footer anchored. */
  /* Tall like the Customer form (.acm-card) — 92vh instead of a fixed 660px. */
  height: min(92vh, calc(100vh - 24px));
  background: #f0fdf4; border-radius: 16px; overflow: hidden;
  box-shadow: 0 30px 80px rgba(0,0,0,.40);
  display: flex; flex-direction: column;
}
/* Modal header — same mint→teal gradient used by the listing page
   hero strip + WDH banner + table header. Keeps a single emerald
   palette across the whole consignee surface. White-on-mint-teal
   text reads sharp against the wash. */
.acm-wiz-header {
  position: relative;
  display: flex; align-items: center; gap: 14px;
  padding: 18px 56px 18px 22px;
  /* Brighter, more even teal (Figma) — matches the picker header; drops the
     dark emerald corner that made the old ramp read dark-green → light. */
  background: linear-gradient(120deg,#0f766e 0%,#0d9488 45%,#14b8a6 78%,#2dd4bf 100%);
  color: #fff;
  flex-shrink: 0;
  overflow: hidden;
}
.acm-wiz-header::before {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
      /* White dot-grid texture (Figma) over teal-tinted glows. The glows were
         PURPLE (copied from the violet Customer header) which muddied the teal
         — recolored to soft white + mint so the header reads as clean teal. */
      background-image:
      radial-gradient(rgba(255, 255, 255, .18) 1.1px, transparent 1.6px),
      radial-gradient(circle at 15% 50%, rgba(255, 255, 255, .14) 0%, transparent 55%),
      radial-gradient(ellipse at 85% 50%, rgba(94, 234, 212, .20) 0%, transparent 55%);
    background-size: 18px 18px, auto, auto;
    background-position: 0 0, 0 0, 0 0;
    }

.acm-wiz-hicon {
  position: relative; z-index: 1;
  width: 38px; height: 38px; border-radius: 11px;
  background: rgba(255,255,255,0.22);
  border: 1px solid rgba(255,255,255,0.35);
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
  -webkit-backdrop-filter: blur(6px);
  backdrop-filter: blur(6px);
  box-shadow: 0 4px 12px rgba(0,0,0,0.12);
}
.acm-wiz-htitle { position: relative; z-index: 1; font-size: 18px; font-weight: 800; letter-spacing: -0.3px; color: #fff; text-shadow: 0 1px 2px rgba(0,0,0,0.10); }
.acm-wiz-hsub   { position: relative; z-index: 1; font-size: 11.5px; color: rgba(255,255,255,0.92); margin-top: 2px; line-height: 1.4; max-width: 860px; }

/* Pinned top — stepper + Linked Customer summary. Sits between the
   wizard header (gradient bar) and the scrolling body. Compact,
   non-scrolling, present on every stage so the user always sees
   which step they're on + which customer this consignee belongs to.
   Background matches the body's mint wash so it reads as one piece
   with the form below. */
.acm-wiz-pinned-top {
  flex-shrink: 0;
  padding: 8px 20px 4px;
  display: flex; flex-direction: column; gap: 6px;
  background: #f0fdf4;
  border-bottom: 1px solid rgba(16,185,129,0.12);
}
.acm-wiz-body {
  flex: 1; min-height: 0; overflow-y: auto;
  padding: 6px 20px 14px;
  display: flex; flex-direction: column; gap: 8px;
  /* Visible thin scrollbar mirroring [[AddVendorModal]]'s .avm-body so
     Stage 2/3 tabs (Company DD, Owner KYC, Trade Licence, Evidence
     Vault) show a styled rail when the table grows past the body. */
  scrollbar-width: thin; scrollbar-color: #6ee7b7 transparent;
}
.acm-wiz-body::-webkit-scrollbar { width: 8px; }
.acm-wiz-body::-webkit-scrollbar-thumb { background: #6ee7b7; border-radius: 99px; }
.acm-wiz-body::-webkit-scrollbar-thumb:hover { background: #10b981; }

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
  background: linear-gradient(135deg, #0d9488, #065f46);
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
  transition: transform .15s ease, box-shadow .15s ease, border-color .15s ease;
}
.acm-step-clickable { cursor: pointer; }
.acm-step-clickable:hover {
  transform: translateY(-1px);
  box-shadow: 0 6px 16px rgba(16,185,129,0.16);
  border-color: #10b981;
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
.acm-step-incomplete {
  background: #f8fafc;
  border-color: #e2e8f0;
}
.acm-step-badge {
  width: 36px; height: 36px; border-radius: 10px;
  display: flex; align-items: center; justify-content: center;
  background: #f3f4f6; color: #6b7280;
  font-size: 13px; font-weight: 800;
  flex-shrink: 0;
}
.acm-step-active .acm-step-badge {
  background: linear-gradient(135deg, #0d9488, #065f46); color: #fff;
}
.acm-step-done .acm-step-badge {
  /* Figma: green badge with a white ✓ on the completed step. */
  background: linear-gradient(135deg, #0d9488, #065f46); color: #fff;
}
.acm-step-incomplete .acm-step-badge {
  background: linear-gradient(135deg, #e2e8f0, #cbd5e1); color: #64748b;
}
.acm-step-text { min-width: 0; flex: 1; }
.acm-step-title { font-size: 13px; font-weight: 700; color: #1f2937; }
.acm-step-active .acm-step-title { color: #064e3b; }
.acm-step-incomplete .acm-step-title { color: #475569; }
.acm-step-sub { font-size: 11px; color: #6b7280; margin-top: 2px; }
.acm-step-active .acm-step-sub { color: #047857; }
.acm-step-incomplete .acm-step-sub { color: #94a3b8; }
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
/* Row that places the sub-tabs + Same-as-Customer banner side-by-side.
   Tabs stay their natural width on the left; banner takes the rest of
   the row. Wraps to two stacked rows on narrow viewports. */
.acm-id-tabs-row {
  display: flex; align-items: center; gap: 10px;
  flex-wrap: wrap;
  padding: 0;
}
.acm-id-tabs-row .acm-id-tabs { flex: 0 0 auto; padding: 0; }
/* Inline variant of the Same-as-Customer banner — slimmer padding +
   compact typography so it fits next to the tab pills without
   dominating the row. Title + sub stack tightly to keep the height
   close to the 38px tab pill height. */
.acm-same-banner-inline {
  flex: 1 1 320px;
  min-width: 0;
  margin-bottom: 0;
  padding: 4px 12px;
  gap: 8px;
  align-items: center;
}
.acm-same-banner-inline .acm-same-banner-text { line-height: 1.25; }
.acm-same-banner-inline .acm-same-banner-title { font-size: 11.5px; }
.acm-same-banner-inline .acm-same-banner-sub { font-size: 10.5px; }
.acm-same-banner-inline .acm-same-banner-box { width: 16px; height: 16px; }
@media (max-width: 820px) {
  .acm-same-banner-inline { flex: 1 1 100%; }
}
.acm-id-tab {
  display: inline-flex; align-items: center; gap: 7px;
  height: 38px; padding: 0 16px;
  background: #fff; border: 1.5px solid #e5e7eb; border-radius: 999px;
  font-family: inherit; font-size: 12.5px; font-weight: 700; color: #1f2937;
  cursor: pointer; transition: all .18s;
}
.acm-id-tab.on {
  /* Unified brand gradient (same one used for the icons). */
  background: linear-gradient(135deg, #0d9488, #065f46);
  color: #fff;
  border-color: transparent;
  box-shadow: 0 3px 10px rgba(13,148,136,.32);
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

/* ─── "What you did in previous stages" — compact emerald-themed
   recap panel that mirrors AddCustomerModal's .acm-history.
   Collapsed by default; expanding reveals a dense 4-column
   Label : Value grid of Stage 1 entries (and KYC count stats on
   Stage 3). Lives at the top of Stage 2 and Stage 3 so the user
   can verify what they carried forward without scrolling away. */
.acg-history {
  margin-bottom: 12px;
  border-radius: 12px;
  border: 1.5px solid #a7f3d0;
  background: #fff;
  overflow: hidden;
  box-shadow: 0 2px 12px rgba(16,185,129,.09);
  flex-shrink: 0;
  max-height: 46px;
  transition: max-height .38s cubic-bezier(.4,0,.2,1);
}
.acg-history.acg-hist-open { max-height: 700px; }
.acg-history-header {
  height: 46px; box-sizing: border-box;
  display: flex; align-items: center; justify-content: space-between;
  gap: 12px;
  padding: 0 16px;
  cursor: pointer;
  background: linear-gradient(110deg, #ecfdf5 0%, #d1fae5 100%);
  border-left: 4px solid #10b981;
  user-select: none;
}
.acg-history-header:hover { background: linear-gradient(110deg, #d1fae5, #a7f3d0); }
.acg-history-header-left { display: flex; align-items: center; gap: 10px; min-width: 0; }
.acg-history-icon {
  width: 28px; height: 28px; border-radius: 8px;
  background: linear-gradient(135deg, #0d9488, #065f46);
  color: #fff;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.acg-history-title { font-size: 12px; font-weight: 800; color: #064e3b; white-space: nowrap; }
.acg-history-meta  { font-size: 9.5px; color: #047857; margin-top: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.acg-history-actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.acg-history-badge {
  padding: 3px 11px; border-radius: 20px;
  background: linear-gradient(135deg, #0d9488, #065f46);
  color: #fff;
  font-size: 9.5px; font-weight: 800;
  white-space: nowrap;
}
.acg-history-chevron {
  width: 22px; height: 22px; border-radius: 50%;
  background: rgba(16,185,129,.12);
  display: flex; align-items: center; justify-content: center;
  color: #047857;
  transition: transform .3s;
}
.acg-history-chevron.acg-open { transform: rotate(180deg); }
.acg-history-body {
  overflow-y: auto;
  /* Cap the expanded panel height so a fully-populated Stage 1 +
     Stage 2 stats recap doesn't blow out the modal. Anything past
     this scrolls inside the panel — the rest of the wizard body
     stays on screen. Custom thin emerald scrollbar matches the
     other internal-scroll wrappers in the modal. */
  max-height: 260px;
  border-top: 1px solid #d1fae5;
  background: #fff;
  scrollbar-width: thin;
}
.acg-history-body::-webkit-scrollbar { width: 6px; }
.acg-history-body::-webkit-scrollbar-thumb {
  background: rgba(16,185,129,.35); border-radius: 999px;
}
.acg-history-body::-webkit-scrollbar-thumb:hover { background: rgba(16,185,129,.55); }

/* Body content — dense 4-column "Label : Value" grid (Stage 1) +
   inline stat tiles (Stage 2). Tight row spacing keeps the panel
   compact even with 18+ fields. */
.acg-hs-mirror { padding: 10px 16px 12px; }
.acg-hs-mirror + .acg-hs-mirror { padding-top: 4px; }
.acg-hs-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  column-gap: 24px;
  row-gap: 6px;
}
.acg-hs-inline {
  display: flex; align-items: baseline; gap: 6px;
  font-size: 12px; min-width: 0;
  cursor: default;
  padding: 1px 2px;
  border-radius: 4px;
  transition: background .12s ease;
}
.acg-hs-inline:hover { background: rgba(16,185,129,0.06); }
.acg-hs-inline-lbl {
  color: #64748b;
  font-weight: 600;
  letter-spacing: .01em;
  white-space: nowrap;
  flex-shrink: 0;
}
.acg-hs-inline-val {
  color: #047857;
  font-weight: 600;
  line-height: 1.4;
  min-width: 0; flex: 1 1 auto;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.acg-hs-inline-val.is-empty { color: #cbd5e1; font-weight: 500; }

/* "Stage 1 mirrors the linked customer" — slim inline note that
   replaces the full recap when Same-as-Customer is on. Kept
   compact so it reads as a one-line affordance, not a heavy
   banner. */
.acg-mirror-note {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 10px;
  margin-bottom: 8px;
  background: linear-gradient(110deg, #ecfdf5 0%, #d1fae5 100%);
  border: 1px solid rgba(16,185,129,0.25);
  border-left: 3px solid #10b981;
  border-radius: 8px;
  font-size: 11.5px;
  line-height: 1.35;
  color: #064e3b;
}
.acg-mirror-note-icon {
  width: 20px; height: 20px; border-radius: 5px;
  background: linear-gradient(135deg, #0d9488, #065f46);
  color: #fff;
  display: inline-flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.acg-mirror-note-icon svg { width: 11px; height: 11px; }
.acg-mirror-note-title { font-size: 11.5px; font-weight: 700; color: #064e3b; }
.acg-mirror-note-sub   { color: #047857; margin-top: 1px; font-size: 11px; opacity: 0.92; }
.acg-mirror-note-sub b { color: #064e3b; }

.acg-mirror-inline {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 10px;
  background: linear-gradient(110deg, #ecfdf5 0%, #d1fae5 100%);
  border: 1px solid rgba(16,185,129,0.22);
  border-left: 3px solid #10b981;
  border-radius: 8px;
  font-size: 11.5px;
  color: #064e3b;
  line-height: 1.35;
}
.acg-mirror-inline b { color: #064e3b; }
.acg-mirror-inline-icon {
  width: 20px; height: 20px; border-radius: 5px;
  background: linear-gradient(135deg, #0d9488, #065f46);
  color: #fff;
  display: inline-flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.acg-mirror-inline-icon svg { width: 11px; height: 11px; }

[data-bs-theme="dark"] .acg-mirror-note {
  background: linear-gradient(110deg, rgba(6,95,70,0.25) 0%, rgba(16,185,129,0.15) 100%);
  border-color: rgba(94,234,212,0.30);
  border-left-color: #10b981;
  color: #d1fae5;
}
[data-bs-theme="dark"] .acg-mirror-note-title { color: #ecfdf5; }
[data-bs-theme="dark"] .acg-mirror-note-sub   { color: #6ee7b7; }
[data-bs-theme="dark"] .acg-mirror-note-sub b,
[data-bs-theme="dark"] .acg-mirror-inline b   { color: #ecfdf5; }
[data-bs-theme="dark"] .acg-mirror-inline {
  background: linear-gradient(110deg, rgba(6,95,70,0.22) 0%, rgba(16,185,129,0.12) 100%);
  border-color: rgba(94,234,212,0.25);
  color: #d1fae5;
}

/* Stage 2 count stats — inline pill row under the Stage 1 grid /
 * mirror notice. Dashed separator removed + top padding tightened
 * so the mirror block and stat tiles sit in a single continuous
 * band (matches the customer modal). The .acg-history-body prefix
 * out-ranks the adjacent-sibling 4px top padding rule. */
.acg-history-body .acg-hs-mirror.acg-hs-stats-wrap {
  border-top: none;
  padding-top: 2px;
}
.acg-hs-mirror.acg-hs-stats-wrap { border-top: none; }
.acg-hs-stats {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}
.acg-hs-stat {
  background: linear-gradient(135deg, #ecfdf5, #d1fae5);
  border: 1px solid rgba(16,185,129,.22);
  border-radius: 10px;
  padding: 10px 12px;
  display: flex; flex-direction: column; gap: 2px;
  text-align: left;
}
.acg-hs-stat-num { font-size: 18px; font-weight: 800; color: #047857; line-height: 1; }
.acg-hs-stat-lbl { font-size: 10.5px; font-weight: 700; color: #065f46; text-transform: uppercase; letter-spacing: .05em; }

/* Dark-mode flips for the recap panel. */
[data-bs-theme="dark"] .acg-history {
  background: rgba(16,185,129,0.08);
  border-color: rgba(16,185,129,0.30);
  box-shadow: 0 2px 12px rgba(0,0,0,0.35);
}
[data-bs-theme="dark"] .acg-history-header {
  background: linear-gradient(110deg, rgba(6,95,70,0.35) 0%, rgba(16,185,129,0.22) 100%);
}
[data-bs-theme="dark"] .acg-history-header:hover {
  background: linear-gradient(110deg, rgba(6,95,70,0.45), rgba(16,185,129,0.32));
}
[data-bs-theme="dark"] .acg-history-title { color: #d1fae5; }
[data-bs-theme="dark"] .acg-history-meta  { color: #6ee7b7; }
[data-bs-theme="dark"] .acg-history-body  { background: #11182a; border-top-color: rgba(16,185,129,0.18); }
[data-bs-theme="dark"] .acg-hs-inline:hover { background: rgba(16,185,129,0.10); }
[data-bs-theme="dark"] .acg-hs-inline-lbl   { color: #94a3b8; }
[data-bs-theme="dark"] .acg-hs-inline-val   { color: #6ee7b7; }
[data-bs-theme="dark"] .acg-hs-inline-val.is-empty { color: #475569; }
[data-bs-theme="dark"] .acg-hs-stat {
  background: linear-gradient(135deg, rgba(16,185,129,0.18), rgba(52,211,153,0.10));
  border-color: rgba(16,185,129,0.35);
}
[data-bs-theme="dark"] .acg-hs-stat-num { color: #6ee7b7; }
[data-bs-theme="dark"] .acg-hs-stat-lbl { color: #a7f3d0; }

/* Responsive — drop to 2 columns on tablets, 1 column on phones. */
@media (max-width: 1024px) {
  .acg-hs-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .acg-hs-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 640px) {
  .acg-hs-grid { grid-template-columns: 1fr; }
  .acg-hs-stats { grid-template-columns: 1fr 1fr; }
  .acg-history-meta { display: none; }
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

/* Stage 3 — vault. Inner KYC sub-tabs (Company DD / Owner KYC /
 * Trade Licence) were a flat underline strip; restyled to match the
 * pill design used by AddCustomerModal's .acm-nested-tab so both
 * modals carry the same sub-tab affordance. Keeps the green palette
 * (consignee theme) instead of customer-purple. */
.acm-vault-tabs { display: flex; gap: 8px; padding: 0; margin-bottom: 16px; flex-wrap: wrap; border-bottom: none; }
.acm-vault-tab {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 7px 18px; border-radius: 10px;
  background: #fff; color: #047857;
  border: 1.5px solid #6ee7b7;
  font-family: inherit; font-size: 12px; font-weight: 700;
  cursor: pointer; white-space: nowrap;
  transition: all .2s;
}
.acm-vault-tab:hover:not(.on) { background: #ecfdf5; border-color: #10b981; }
.acm-vault-tab.on {
  background: linear-gradient(135deg, #0d9488, #065f46);
  color: #fff; border-color: #10b981;
  box-shadow: 0 3px 10px rgba(16,185,129,.35);
}
/* Trade Documents tab — "Same as Customer is on" advisory strip.
 * Was previously a hardcoded cyan inline style (#ecfeff / #155e75)
 * that read as a bright white slab in dark mode. Routed through a
 * class so both themes can paint it in the consignee green palette. */
.acm-td-mirror-note {
  padding: 10px 14px;
  background: linear-gradient(110deg, #ecfdf5 0%, #d1fae5 100%);
  border-bottom: 1px solid rgba(16,185,129,.22);
  color: #064e3b;
  font-size: 12px; font-weight: 600;
}
[data-bs-theme="dark"] .acm-td-mirror-note {
  background: linear-gradient(110deg, rgba(6,95,70,0.30) 0%, rgba(16,185,129,0.18) 100%);
  border-bottom-color: rgba(94,234,212,.28);
  color: #d1fae5;
}
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
  /* Allow wrap so narrow viewports stack Cancel above Previous +
     Save & Next instead of overflowing. flex-shrink stays 0 so the
     footer never disappears even when the body is overflowing. */
  flex-wrap: wrap;
  row-gap: 8px;
}
.acm-footer-right { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; row-gap: 8px; }

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
.acm-file-err {
  display: block;
  margin-top: 6px;
  padding: 6px 10px;
  background: rgba(239,68,68,0.08);
  color: #b91c1c;
  border: 1px solid rgba(239,68,68,0.22);
  border-radius: 6px;
  font-size: 11.5px;
  font-weight: 500;
  line-height: 1.4;
}
[data-bs-theme="dark"] .acm-file-err {
  background: rgba(239,68,68,0.14);
  color: #fca5a5;
  border-color: rgba(239,68,68,0.35);
}

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
.acm-file-chip-preview {
  flex-shrink: 0;
  width: 24px; height: 24px;
  display: inline-flex; align-items: center; justify-content: center;
  background: #fff; color: #047857;
  border: 1px solid #a7f3d0;
  border-radius: 6px;
  cursor: pointer; transition: all .15s ease;
}
.acm-file-chip-preview:hover { background: #10b981; border-color: #10b981; color: #fff; }
[data-bs-theme="dark"] .acm-file-chip-preview { background: #103129; color: #6ee7b7; border-color: rgba(16,185,129,.40); }
[data-bs-theme="dark"] .acm-file-chip-preview:hover { background: rgba(16,185,129,.20); color: #d1fae5; }

/* ─── "Same as Customer" banner (Stage 1) ─── */
.acm-same-banner {
  display: flex; align-items: flex-start; gap: 12px;
  padding: 12px 16px;
  /* margin-bottom removed — Stage 1's flex body gap already provides
     separation, and the banner now sits in the same row as the sub-
     tabs so a static bottom margin would create dead space below the
     row. */
  margin-bottom: 0;
  /* Saturated emerald gradient with a clear green undertone — the
     previous #ecfdf5 mix read as cream/yellow on low-contrast displays
     and certain sRGB profiles, which is why the banner looked yellow in
     some browsers. Anchoring both stops in the green-100 → green-200
     range keeps the hue unambiguous across all renderers. */
  background: linear-gradient(135deg, #d1fae5 0%, #a7f3d0 100%);
  border: 1px solid rgba(16,185,129,.45);
  border-radius: 12px;
  cursor: pointer;
  transition: all .15s ease;
  user-select: none;
}
.acm-same-banner:hover { border-color: #10b981; box-shadow: 0 2px 8px rgba(16,185,129,.18); }
.acm-same-banner.is-on {
  background: linear-gradient(135deg, #a7f3d0 0%, #6ee7b7 100%);
  border-color: #10b981;
  box-shadow: 0 2px 10px rgba(16,185,129,.25);
}
.acm-same-banner.is-disabled { opacity: 0.55; cursor: not-allowed; }
/* "Blocked" state — customer already has its one mirror. Muted slate
 * accent so it reads as "informationally unavailable" instead of the
 * harsh yellow warning the user found jarring. The label stays
 * clickable (cursor unchanged) because the click fires the toast —
 * that's the whole point. */
.acm-same-banner.is-blocked {
  background: linear-gradient(135deg, #f1f5f9 0%, #e2e8f0 100%);
  border-color: rgba(100,116,139,.40);
}
.acm-same-banner.is-blocked:hover {
  border-color: #475569;
  box-shadow: 0 2px 10px rgba(100,116,139,.18);
}
.acm-same-banner.is-blocked .acm-same-banner-box {
  border-color: #475569;
}
.acm-same-banner.is-blocked .acm-same-banner-title { color: #334155; }
.acm-same-banner.is-blocked .acm-same-banner-sub   { color: #475569; }
.acm-same-banner.is-blocked .acm-same-banner-sub strong { color: #1e293b; }
.acm-same-banner-warn {
  display: inline-block;
  font-weight: 600;
  font-size: 11.5px;
  letter-spacing: .01em;
  color: #64748b;
  margin-left: 2px;
}
[data-bs-theme="dark"] .acm-same-banner.is-blocked {
  background: linear-gradient(135deg, rgba(148,163,184,.16) 0%, rgba(148,163,184,.08) 100%);
  border-color: rgba(148,163,184,.35);
}
[data-bs-theme="dark"] .acm-same-banner.is-blocked .acm-same-banner-title { color: #e2e8f0; }
[data-bs-theme="dark"] .acm-same-banner.is-blocked .acm-same-banner-sub   { color: #cbd5e1; }
[data-bs-theme="dark"] .acm-same-banner-warn { color: #cbd5e1; }
.acm-same-banner input[type="checkbox"] { display: none; }
.acm-same-banner-box {
  flex-shrink: 0;
  width: 22px; height: 22px; border-radius: 6px;
  display: inline-flex; align-items: center; justify-content: center;
  background: #fff;
  border: 2px solid #10b981;
  color: #fff;
  transition: all .15s ease;
  margin-top: 1px;
}
.acm-same-banner.is-on .acm-same-banner-box {
  background: #10b981; border-color: #10b981;
  box-shadow: 0 1px 3px rgba(16,185,129,.30);
}
.acm-same-banner-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; line-height: 1.4; }
.acm-same-banner-title { font-size: 13px; font-weight: 700; color: #065f46; letter-spacing: .01em; }
.acm-same-banner-sub   { font-size: 12px; color: #047857; }
.acm-same-banner-sub strong { color: #065f46; }
/* Locked-input visual cue — pairs with the disabled prop wired on
 * every field in the Basic Company + Primary Address sections. */
.acm-input:disabled { background: #f9fafb; color: #6b7280; cursor: not-allowed; }
[data-bs-theme="dark"] .acm-same-banner    { background: linear-gradient(135deg, rgba(16,185,129,.18) 0%, rgba(16,185,129,.10) 100%); border-color: rgba(16,185,129,.35); }
[data-bs-theme="dark"] .acm-same-banner.is-on { background: linear-gradient(135deg, rgba(16,185,129,.28) 0%, rgba(16,185,129,.16) 100%); }
[data-bs-theme="dark"] .acm-same-banner-box   { background: #0a1f1a; border-color: #10b981; }
[data-bs-theme="dark"] .acm-same-banner-title { color: #6ee7b7; }
[data-bs-theme="dark"] .acm-same-banner-sub   { color: #34d399; }
[data-bs-theme="dark"] .acm-same-banner-sub strong { color: #d1fae5; }
[data-bs-theme="dark"] .acm-input:disabled { background: #14241f; color: #6b8a7e; }

/* ─── Stage 2 — KYC sub-tabs + card ─── */
.acm-kyc-subtabs {
  display: flex; gap: 8px; flex-wrap: wrap;
  /* Margin removed — the parent .acm-wiz-body already provides a
     14px flex gap between Stage 2 children, so an extra 12px margin
     stacked on top made the tab row feel disconnected from the
     table card below. Now they sit a single flex-gap apart. */
  margin-bottom: 0;
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
  background: linear-gradient(135deg, #0d9488, #065f46);
  border-color: transparent; color: #fff;
  box-shadow: 0 4px 10px rgba(13,148,136,.32);
}
.acm-kyc-card {
  background: #fff;
  border: 1px solid rgba(16,185,129,.25);
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 1px 2px rgba(15,42,35,.04);
  /* Don't let the flex column body squash the card below its
     intrinsic height — without this, the table can be clipped at
     the bottom and .acm-wiz-body's overflow-y never trips, so the
     user has no scrollbar to reach hidden rows. */
  flex-shrink: 0;
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
/* Anchor-variant: the chip becomes clickable + underlined on hover
 * when wired through AttachmentLink. Keeps the same emerald palette
 * so the View link still reads as part of the KYC table styling. */
.acm-kyc-attach-link {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 2px 10px; border-radius: 6px;
  background: #ecfdf5; border: 1px solid rgba(16,185,129,.30);
  color: #047857;
  text-decoration: none;
  cursor: pointer;
  transition: all .15s ease;
}
.acm-kyc-attach-link:hover {
  background: #10b981; color: #fff; border-color: #10b981;
  box-shadow: 0 2px 6px rgba(16,185,129,.25);
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

/* Row that places the doc-type dropdown alongside a small "+"
   button — opens the inline Add Document Type master popup so the
   user can extend the master without leaving the in-progress
   license entry. Mirrors AddCustomerModal's .acm-doc-name-row class. */
.acg-doc-name-row {
  display: flex; align-items: stretch; gap: 8px; width: 100%;
}
.acg-doc-plus-btn {
  flex: 0 0 auto;
  width: 38px; height: 38px;
  display: inline-flex; align-items: center; justify-content: center;
  background: linear-gradient(135deg, #0d9488, #065f46);
  color: #fff;
  border: 1px solid transparent;
  border-radius: 10px;
  cursor: pointer;
  transition: all .15s ease;
  box-shadow: 0 2px 6px rgba(5,150,105,.30);
}
.acg-doc-plus-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(5,150,105,.45);
}
[data-bs-theme="dark"] .acg-doc-plus-btn { box-shadow: 0 2px 6px rgba(16,185,129,.45); }
/* Locked variant — shown in place of the Add pill while Same-as-
   Customer mirrors the customer's KYC. Muted slate look reads as
   intentionally locked rather than a faded / broken button. */
.acm-add-pill-locked {
  background: rgba(100,116,139,0.10);
  color: #475569;
  border-color: rgba(100,116,139,0.30);
  cursor: not-allowed;
}
.acm-add-pill-locked:hover { background: rgba(100,116,139,0.10); color: #475569; border-color: rgba(100,116,139,0.30); }
[data-bs-theme="dark"] .acm-add-pill-locked {
  background: rgba(148,163,184,0.10);
  color: #cbd5e1;
  border-color: rgba(148,163,184,0.30);
}
[data-bs-theme="dark"] .acm-add-pill-locked:hover {
  background: rgba(148,163,184,0.10);
  color: #cbd5e1;
  border-color: rgba(148,163,184,0.30);
}
.acm-loc-body { padding: 0; }
/* Horizontal + vertical scroll wrapper. The inner table sets a
   min-width of 860px (Stage 1 location table) or 980px (Stage 2 KYC
   tables) so columns stay legible — this wrapper picks up the
   horizontal scroll when the viewport is narrower. width: 100% +
   max-width: 100% pin it to the parent (the wizard body's flex
   column) so it never punches out of the modal on small screens.
   max-height + overflow-y prevents the table from pushing the
   sticky footer off-screen when there are lots of rows.
   -webkit-overflow-scrolling: touch smooths the scroll on
   iPad/Android, and the thin scrollbar style keeps the rail from
   dominating the table on narrow screens. */
.acm-loc-table-wrap {
  width: 100%;
  max-width: 100%;
  overflow-x: auto;
  overflow-y: auto;
  max-height: 380px;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: thin;
}
.acm-loc-table-wrap::-webkit-scrollbar { height: 8px; }
.acm-loc-table-wrap::-webkit-scrollbar-thumb {
  background: rgba(16,185,129,.35); border-radius: 999px;
}
.acm-loc-table-wrap::-webkit-scrollbar-thumb:hover { background: rgba(16,185,129,.55); }
/* Stage 2 KYC tables — let the table grow with its rows and rely on
   the outer .acm-wiz-body as the single scroll surface. An inner
   max-height here used to capture wheel events when the cursor was
   over the table, so users on Stage 2 (especially edit mode with many
   rows) couldn't scroll the modal at all. The footer stays anchored
   because .acm-wiz-footer is outside .acm-wiz-body with flex-shrink: 0.
   Horizontal scroll is still local to the wrap on narrow viewports. */
.acm-kyc-body .acm-loc-table-wrap {
  overflow-x: auto;
  scrollbar-width: thin;
}
[data-bs-theme="dark"] .acm-kyc-body .acm-loc-table thead th { background: #103129; }
.acm-loc-table {
  width: 100%; border-collapse: collapse;
  font-size: 13px; color: #1f2937;
  /* Stage 1 location table has 9 cols (SR / Type / Address / City-
     State-Country / Contact / Phone / Email / WhatsApp / Actions);
     anchor the table to a min-width so columns keep their natural
     widths and the wrapper scrolls horizontally on narrow viewports
     instead of cramming everything into illegible strips. */
  min-width: 860px;
}
/* Stage 2 KYC tables carry more columns (ID Proof, Address Proof,
   Photograph, Status, Actions …) than the Stage 1 location table.
   Wider min-width so columns stay readable and the wrap div picks
   up horizontal scroll on narrow viewports. */
.acm-kyc-body .acm-loc-table { min-width: 980px; }
.acm-loc-table { border-collapse: separate; border-spacing: 0; }
.acm-loc-table thead tr {
  background: #f9fafb;
  border-bottom: 1px solid #e5e7eb;
}
/* Sticky header — keeps the column labels glued to the top of the
   scroll wrapper while rows scroll underneath. Needs an OWN
   background on the <th> (the <tr>'s background doesn't follow a
   positioned cell), and a box-shadow as the bottom border because a
   real border on a sticky cell scrolls away with the row above it. */
.acm-loc-table thead th {
  position: sticky;
  top: 0;
  z-index: 5;
  background: #f9fafb;
  padding: 10px 12px; text-align: left;
  /* Slightly smaller + tighter so the table header strip reads as a
     muted label row rather than competing with the row content for
     attention. */
  font-weight: 700; font-size: 10px; letter-spacing: .05em;
  color: #6b7280; text-transform: uppercase;
  white-space: nowrap;
  box-shadow: inset 0 -1px 0 0 #e5e7eb;
}
.acm-loc-table tbody td {
  padding: 12px; border-bottom: 1px solid #f3f4f6;
  vertical-align: middle;
}
/* KYC / DD / Owner KYC / Trade Licence tables — long Document Names and
   Issuing Authority values were overflowing (no wrapping), stretching the
   column and clipping text. Let text cells wrap + break long unbroken
   strings, with a sane per-cell cap, while badges / buttons / links stay on
   one line. (QA: DD document names not wrapping.) */
.acm-kyc-body .acm-loc-table tbody td {
  white-space: normal;
  word-break: break-word;
  overflow-wrap: anywhere;
  max-width: 260px;
}
.acm-kyc-body .acm-loc-table tbody td .badge,
.acm-kyc-body .acm-loc-table tbody td .btn,
.acm-kyc-body .acm-loc-table tbody td button,
.acm-kyc-body .acm-loc-table tbody td a,
.acm-kyc-body .acm-loc-table tbody td .acm-auto-code,
.acm-kyc-body .acm-loc-table tbody td .hstack {
  white-space: nowrap;
}
.acm-loc-table tbody tr:hover { background: #f0fdf4; }
.acm-loc-empty td {
  text-align: center; padding: 32px 16px !important;
  color: #6b7280; font-size: 13px;
}
/* Primary-address row marker — same row as additional locations but
   sourced from the Consignee Identification tab. Subtle green wash +
   pill so users can tell it apart from added locations. */
.acm-loc-primary-row td { background: linear-gradient(180deg, #f0fdf4, #dcfce7); }
.acm-loc-primary-row:hover td { background: #d1fae5; }
/* Placeholder rows in the Trade Licence sub-tab + Stage 3 Trade
   Documents — softly tinted + slightly muted so the user knows these
   are reference items, not real captured data. */
.acm-loc-placeholder-row td { background: #f9fafb; color: #4b5563; }
.acm-loc-placeholder-row:hover td { background: #f3f4f6; }
[data-bs-theme="dark"] .acm-loc-placeholder-row td { background: rgba(255,255,255,0.02); color: #cbd5e1; }
[data-bs-theme="dark"] .acm-loc-placeholder-row:hover td { background: rgba(255,255,255,0.04); }
.acm-loc-type-cell { display: inline-flex; align-items: center; gap: 7px; flex-wrap: wrap; }
.acm-loc-primary-tag {
  display: inline-block; padding: 2px 8px; border-radius: 999px;
  font-size: 10px; font-weight: 800; letter-spacing: .04em; text-transform: uppercase;
  background: linear-gradient(135deg, #d1fae5, #a7f3d0);
  color: #065f46; border: 1px solid #6ee7b7;
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
  flex-wrap: wrap; row-gap: 8px;
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
/* Phase-A "Add New Consignee" picker — dark theme (the teal header stays
   colored; the body / list / footer go dark to match the rest of the app). */
[data-bs-theme="dark"] .acm-pick       { background: #0a1f1a; }
[data-bs-theme="dark"] .acm-pick-body  { background: #0a1f1a; }
[data-bs-theme="dark"] .acm-label      { color: #6ee7b7; }
[data-bs-theme="dark"] .acm-picker     { background: rgba(16,185,129,.08); border-color: rgba(16,185,129,.30); }
[data-bs-theme="dark"] .acm-picker input { color: #ecfdf5; }
[data-bs-theme="dark"] .acm-picker input::placeholder { color: #6b8a7e; }
[data-bs-theme="dark"] .acm-picker-list { background: #103129; border-color: rgba(16,185,129,.30); box-shadow: 0 14px 36px rgba(0,0,0,.55), 0 4px 12px rgba(0,0,0,.4); }
[data-bs-theme="dark"] .acm-picker-option { border-bottom-color: rgba(16,185,129,.12); }
[data-bs-theme="dark"] .acm-picker-option:hover { background: rgba(16,185,129,.12); }
[data-bs-theme="dark"] .acm-pop-name   { color: #ecfdf5; }
[data-bs-theme="dark"] .acm-pop-meta,
[data-bs-theme="dark"] .acm-picker-empty { color: #94a3b8; }
[data-bs-theme="dark"] .acm-picked     { background: rgba(16,185,129,.12); border-color: #10b981; }
[data-bs-theme="dark"] .acm-picked-name { color: #ecfdf5; }
[data-bs-theme="dark"] .acm-picked-meta { color: #94a3b8; }
[data-bs-theme="dark"] .acm-info       { background: rgba(30,64,175,.20); border-color: rgba(96,165,250,.30); color: #93c5fd; }
[data-bs-theme="dark"] .acm-pick-footer { border-top-color: rgba(16,185,129,.20); background: #0a1f1a; }
/* Cancel button (scoped to the picker) — dark surface to match. */
[data-bs-theme="dark"] .acm-pick .acm-btn-light { background: #14241f; color: #ecfdf5; border-color: rgba(16,185,129,.30); }
[data-bs-theme="dark"] .acm-pick .acm-btn-light:hover { background: #1c3329; border-color: rgba(110,231,183,.50); color: #f0fdf4; box-shadow: none; transform: none; }
[data-bs-theme="dark"] .acm-btn-light  { background: #1a3d34; color: #ecfdf5; border-color: rgba(16,185,129,.30); }
/* Dark-mode hover — needs a clearly stronger background + border lift
   so the user gets a tactile cue. The previous flat #234d42 was too
   close to the base color to read as "hover". */
[data-bs-theme="dark"] .acm-btn-light:hover {
  background: #2c5e51;
  border-color: rgba(110,231,183,.55);
  color: #f0fdf4;
  box-shadow: 0 4px 16px rgba(16,185,129,.32);
  transform: translateY(-1px);
}

/* Table cell text colors — several rows are styled inline with
   color:#1f2937 (slate-800) which disappears against the dark
   canvas. Flip those to a high-contrast off-white via the inline-
   style attribute selector. Same trick the Customer modal uses. */
[data-bs-theme="dark"] .acm-loc-table tbody td[style*="color: rgb(31, 41, 55)"],
[data-bs-theme="dark"] .acm-loc-table tbody td[style*="color:#1f2937"] {
  color: #f1f5f9 !important;
}
[data-bs-theme="dark"] .acm-loc-table tbody td[style*="color: rgb(107, 114, 128)"],
[data-bs-theme="dark"] .acm-loc-table tbody td[style*="color:#6b7280"] {
  color: #94a3b8 !important;
}
[data-bs-theme="dark"] .acm-loc-table tbody td[style*="color: rgb(156, 163, 175)"],
[data-bs-theme="dark"] .acm-loc-table tbody td[style*="color:#9ca3af"] {
  color: #94a3b8 !important;
}

[data-bs-theme="dark"] .acm-wiz        { background: #0f2a23; }
[data-bs-theme="dark"] .acm-wiz-body   { background: #0a1f1a; scrollbar-color: #047857 transparent; }
[data-bs-theme="dark"] .acm-wiz-body::-webkit-scrollbar-thumb { background: #047857; }
[data-bs-theme="dark"] .acm-wiz-body::-webkit-scrollbar-thumb:hover { background: #10b981; }
[data-bs-theme="dark"] .acm-wiz-pinned-top { background: #0a1f1a; border-bottom-color: rgba(16,185,129,0.20); }
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
[data-bs-theme="dark"] .acm-step-incomplete { background: rgba(40,52,70,0.60); border-color: rgba(148,163,184,0.25); }
[data-bs-theme="dark"] .acm-step-incomplete .acm-step-badge { background: #2b3650; color: #cbd5e1; }
[data-bs-theme="dark"] .acm-step-incomplete .acm-step-title { color: #cbd5e1; }
[data-bs-theme="dark"] .acm-step-incomplete .acm-step-sub   { color: #94a3b8; }
[data-bs-theme="dark"] .acm-step-badge { background: #1a3d34; color: #94a3b8; }
[data-bs-theme="dark"] .acm-step-title { color: #ecfdf5; }
[data-bs-theme="dark"] .acm-step-sub   { color: #94a3b8; }
[data-bs-theme="dark"] .acm-step-active .acm-step-title { color: #ecfdf5; }
[data-bs-theme="dark"] .acm-step-active .acm-step-sub   { color: #6ee7b7; }
[data-bs-theme="dark"] .acm-steps-arrow { background: #103129; border-color: rgba(16,185,129,.30); color: #6ee7b7; }

[data-bs-theme="dark"] .acm-id-tab     { background: #103129; border-color: rgba(16,185,129,.20); color: #ecfdf5; }
/* Selected tab in dark mode — the light-mode emerald gradient blended
   into the modal's dark-green wash, so the active tab was almost
   invisible. Brighter mint gradient + emerald glow ring makes the
   selection unmistakable against the dark backdrop. */
[data-bs-theme="dark"] .acm-id-tab.on {
  background: linear-gradient(135deg, #5eead4, #2dd4bf 50%, #14b8a6);
  color: #022c22;
  border-color: rgba(110,231,183,.55);
  box-shadow: 0 0 0 1px rgba(110,231,183,.45), 0 4px 14px rgba(16,185,129,.45);
}
[data-bs-theme="dark"] .acm-sec-header { background: #103129; border-color: rgba(16,185,129,.20); }
[data-bs-theme="dark"] .acm-sec-pad    { background: #103129; border-color: rgba(16,185,129,.20); }
[data-bs-theme="dark"] .acm-sec-title  { color: #ecfdf5; }
[data-bs-theme="dark"] .acm-sec-sub    { color: #94a3b8; }
[data-bs-theme="dark"] .acm-sec-sep    { color: rgba(16,185,129,.40); }
[data-bs-theme="dark"] .acm-field-label { color: #6ee7b7; }
[data-bs-theme="dark"] .acm-input      { background: #0a1f1a; border-color: rgba(16,185,129,.25); color: #ecfdf5; }
[data-bs-theme="dark"] .acm-input::placeholder { color: #6b8a7e; }
[data-bs-theme="dark"] .acm-input:disabled { background: #14241f; color: #6b8a7e; }
[data-bs-theme="dark"] .acm-radio       { color: #ecfdf5; }
[data-bs-theme="dark"] .acm-radio span  { border-color: rgba(255,255,255,.30); }

/* Segment multi-select chips → emerald, to match the consignee form. The
   shared master chip is violet (inline styles), which read as an out-of-theme
   sticker on the green form. Scoped to .acm-wiz so other pages are untouched. */
.acm-wiz .master-multi-chip { background: #ecfdf5 !important; color: #047857 !important; border: 1px solid #a7f3d0 !important; }
.acm-wiz .master-multi-chip [role="button"] { color: #059669 !important; }
[data-bs-theme="dark"] .acm-wiz .master-multi-chip { background: rgba(16,185,129,0.14) !important; color: #6ee7b7 !important; border-color: rgba(110,231,183,0.40) !important; }
[data-bs-theme="dark"] .acm-wiz .master-multi-chip [role="button"] { color: #d1fae5 !important; }

[data-bs-theme="dark"] .acm-recap      { background: rgba(16,185,129,.10); border-color: rgba(16,185,129,.25); }
[data-bs-theme="dark"] .acm-recap-card { background: #103129; border-color: rgba(16,185,129,.20); }
[data-bs-theme="dark"] .acm-recap-sec-title { color: #6ee7b7; }
[data-bs-theme="dark"] .acm-recap-stage-title { color: #ecfdf5; }
[data-bs-theme="dark"] .acm-recap-done { background: rgba(16,185,129,.15); border-color: rgba(16,185,129,.30); color: #6ee7b7; }
[data-bs-theme="dark"] .acm-recap-flabel { color: #94a3b8; }
[data-bs-theme="dark"] .acm-recap-fvalue { color: #ecfdf5; }
[data-bs-theme="dark"] .acm-recap-pill { background: rgba(16,185,129,.15); color: #6ee7b7; border-color: rgba(16,185,129,.30); }

[data-bs-theme="dark"] .acm-vault-tabs { border-bottom: none; }
[data-bs-theme="dark"] .acm-vault-tab {
  background: transparent; color: #6ee7b7;
  border: 1.5px solid rgba(16,185,129,.40);
}
[data-bs-theme="dark"] .acm-vault-tab:hover:not(.on) {
  background: rgba(16,185,129,.10); border-color: #10b981;
}
[data-bs-theme="dark"] .acm-vault-tab.on {
  background: linear-gradient(135deg, #047857, #064e3b);
  color: #fff; border-color: #10b981;
  box-shadow: 0 3px 10px rgba(0,0,0,.4);
}
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
/* Sticky <th> needs its OWN opaque background in dark mode so rows
   don't scroll through it. Solid color (not gradient) so cells
   don't show a seam where the gradient repeats per-cell. */
[data-bs-theme="dark"] .acm-loc-table thead th {
  color: #94a3b8;
  background: #103129;
  box-shadow: inset 0 -1px 0 0 rgba(16,185,129,.20);
}
[data-bs-theme="dark"] .acm-loc-table tbody td { color: #ecfdf5; border-bottom-color: rgba(16,185,129,.15); }
[data-bs-theme="dark"] .acm-loc-table tbody tr:hover { background: rgba(16,185,129,.10); }
[data-bs-theme="dark"] .acm-loc-empty td { color: #94a3b8; }
[data-bs-theme="dark"] .acm-pill-yes     { background: rgba(16,185,129,.18); color: #6ee7b7; }
[data-bs-theme="dark"] .acm-pill-no      { background: rgba(239,68,68,.18); color: #fca5a5; }
[data-bs-theme="dark"] .acm-loc-btn      { background: #103129; border-color: rgba(16,185,129,.25); color: #94a3b8; }
[data-bs-theme="dark"] .acm-loc-btn:hover { background: rgba(16,185,129,.18); border-color: #10b981; color: #6ee7b7; }
[data-bs-theme="dark"] .acm-loc-btn-del:hover { background: rgba(239,68,68,.18); border-color: #ef4444; color: #fca5a5; }
[data-bs-theme="dark"] .acm-loc-primary-row td { background: rgba(16,185,129,0.12); }
[data-bs-theme="dark"] .acm-loc-primary-row:hover td { background: rgba(16,185,129,0.18); }
[data-bs-theme="dark"] .acm-loc-primary-tag { background: rgba(16,185,129,0.22); color: #a7f3d0; border-color: rgba(110,231,183,0.40); }

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
/* "View" attachment chip in dark mode — the light-mode #ecfdf5 wash
   blended into the dark green modal so the badge looked washed out
   and the dark-emerald text faded against it. Deep emerald fill with
   bright mint text gives the chip the same prominence it has in
   light mode. */
[data-bs-theme="dark"] .acm-kyc-attach-link {
  background: rgba(16,185,129,.18);
  border-color: rgba(16,185,129,.45);
  color: #6ee7b7;
}
[data-bs-theme="dark"] .acm-kyc-attach-link:hover {
  background: #10b981;
  border-color: #10b981;
  color: #022c22;
  box-shadow: 0 2px 8px rgba(16,185,129,.50);
}

/* ============================================================
 *  RESPONSIVE — tablet & mobile
 *  Mirrors AddCustomerModal's responsive block. Consignee modal
 *  uses the same .acm-* class names + a few consignee-specific
 *  ones (acm-id-tabs, acm-grid-N, acm-loc-*, acm-kyc-*, acm-same-
 *  banner). All those collapse cleanly down to single-column on
 *  phones so a full Add Consignee flow is usable from any device.
 * ============================================================ */

/* ── Small laptop (≤ 1440px) ─────────────────────────────────
   1366×768 / 1440×900 are the most common laptop sizes. The
   modal caps at max-width: 1440 so on a 1440px viewport it fills
   the entire screen edge-to-edge — give it breathing room. */
@media (max-width: 1440px) {
  .acm-overlay { padding: 10px; }
  .acm-wiz {
    max-width: min(1440px, calc(100vw - 20px));
    max-height: min(94vh, calc(100vh - 16px));
  }
  .acm-pick {
    max-width: calc(100vw - 20px);
    max-height: min(94vh, calc(100vh - 16px));
  }
  .acm-wiz-header { padding: 12px 18px; }
  .acm-steps { padding: 12px 16px 10px; }
  .acm-wiz-pinned-top { padding: 12px 18px 8px; }
  .acm-wiz-body { padding: 14px 18px 16px; }
  .acm-wiz-footer { padding: 10px 18px; }
  .acm-sec-pad { padding: 14px; }
}

/* ── Compact laptop (≤ 1280px) ────────────────────────────────
   Common HP/Dell business laptops (1280×800, 1366×768). 4-col
   grids start to feel cramped — collapse to 2x2 and tighten the
   stepper chrome. Linked-customer 7-col strip drops to 4 cols so
   each detail still gets a readable column instead of waiting for
   the 1024 breakpoint where it collapses all the way to 2. */
@media (max-width: 1280px) {
  .acm-grid-4 { grid-template-columns: repeat(2, 1fr); }
  .acm-loc-grid-4 { grid-template-columns: repeat(2, 1fr); }
  .acm-linked-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); }
  .acm-step { padding: 9px 11px; }
  .acm-step-title { font-size: 11.5px; }
  .acm-step-sub   { font-size: 9px; }
  /* Wizard body padding shrinks slightly so the form has more
     horizontal room on 1366-wide screens. */
  .acm-wiz-pinned-top { padding: 10px 14px 8px; gap: 10px; }
  .acm-wiz-body { padding: 12px 14px 14px; }
  .acm-sec-pad { padding: 12px; }
}

/* ── Tablet landscape (≤ 1024px) ─────────────────────────────── */
@media (max-width: 1024px) {
  .acm-overlay { padding: 8px; }
  .acm-wiz, .acm-pick {
    max-width: calc(100vw - 16px);
    max-height: min(96vh, calc(100vh - 12px));
  }
  /* Form section grids collapse */
  .acm-grid-4 { grid-template-columns: repeat(2, 1fr); }
  .acm-grid-3 { grid-template-columns: repeat(2, 1fr); }
  .acm-grid-2 { grid-template-columns: 1fr 1fr; }
  /* Sub-modal location grids */
  .acm-loc-grid-4 { grid-template-columns: repeat(2, 1fr); }
  /* Linked customer card */
  .acm-linked-grid { grid-template-columns: repeat(2, 1fr); }
  /* Section paddings */
  .acm-sec-pad { padding: 12px; }
  /* Stepper: hide connector chevrons + allow wrap so the steps
     don't squeeze into unreadable widths. */
  .acm-steps { flex-wrap: wrap; gap: 8px; padding: 10px 12px 8px; }
  .acm-steps-arrow { display: none; }
  .acm-step { flex: 1 1 calc(50% - 6px); min-width: 0; }
  /* Primary CTA min-width was 180px for desktop prominence — at
     tablet that forces the footer's button row to overflow when
     all three buttons sit side by side. Drop the floor here. */
  .acm-btn-primary { min-width: 0; }
}

/* ── Tablet portrait (≤ 820px) ───────────────────────────────────
   iPad portrait + small tablets land here. Two-up form grids start
   to crowd — collapse to single column, slim down headers, drop the
   stepper sub-text so each step still fits two-up. */
@media (max-width: 820px) {
  .acm-wiz, .acm-pick {
    max-width: calc(100vw - 12px);
    max-height: min(97vh, calc(100vh - 10px));
  }
  .acm-grid-4, .acm-grid-3, .acm-grid-2 { grid-template-columns: 1fr; }
  .acm-loc-grid-4, .acm-loc-grid-2 { grid-template-columns: 1fr 1fr; }
  .acm-linked-grid { grid-template-columns: repeat(2, 1fr); }
  .acm-step-sub { display: none; }
  .acm-step-title { font-size: 11px; }
  .acm-wiz-header { padding: 12px 16px; }
  .acm-wiz-htitle { font-size: 17px; }
  .acm-wiz-hsub   { font-size: 11px; }
  .acm-wiz-pinned-top { padding: 10px 14px 8px; gap: 8px; }
  .acm-wiz-body { padding: 12px 14px 14px; }
  .acm-sec-pad { padding: 12px; }
  /* Sub-modal stays a centered card on portrait tablet — only goes
     fullscreen on actual phones (640 breakpoint below). */
  .acm-loc-sub-card { width: min(96vw, 640px); max-height: min(94vh, calc(100vh - 16px)); }
}

/* ── Mobile (≤ 640px) ───────────────────────────────────────── */
@media (max-width: 640px) {
  .acm-overlay { padding: 8px; align-items: center; }
  /* The wizard stays fullscreen on real phones — multi-stage form
     needs every inch of space — but the picker keeps its compact
     card shape so it doesn't look sparse at high zoom levels where
     the layout viewport drops into this breakpoint. */
  .acm-wiz {
    border-radius: 0;
    max-height: 100vh;
    height: 100vh;
    width: 100vw;
    max-width: 100vw;
  }
  .acm-pick {
    width: 100%;
    max-width: 420px;
    height: auto;
    max-height: calc(100vh - 16px);
    border-radius: 16px;
  }
  /* Phase A picker fits the viewport */
  .acm-pick-body { padding: 14px; }
  .acm-pick-header { padding: 16px 14px 14px; }
  .acm-pick-icon { width: 42px; height: 42px; margin-bottom: 8px; }
  .acm-pick-title { font-size: 16px; }
  .acm-pick-sub   { font-size: 11px; padding: 0 8px; }
  /* Phase A picker footer: Cancel on top, primary action on bottom
     (thumb-reach). Reset align-items so the column children fill
     full width — the base rule uses align-items: center which would
     otherwise shrink them to content width. */
  .acm-pick-footer {
    padding: 12px 14px 14px;
    flex-direction: column;
    align-items: stretch;
    gap: 8px;
  }
  .acm-pick-footer .acm-btn { width: 100%; flex: 0 0 auto; }
  /* Wizard header */
  .acm-wiz-header { padding: 14px 16px; flex-direction: column; align-items: flex-start; gap: 8px; }
  .acm-wiz-hicon { width: 38px; height: 38px; }
  .acm-wiz-htitle { font-size: 16px; }
  .acm-wiz-hsub   { font-size: 11.5px; }
  .acm-close { position: absolute; top: 12px; right: 12px; }
  /* Steps: stack vertically, hide arrows */
  .acm-steps { flex-direction: column; align-items: stretch; gap: 8px; padding: 12px; }
  .acm-steps-arrow { display: none; }
  .acm-step { width: 100%; }
  /* Identification / Vault sub-tabs */
  .acm-id-tabs { flex-wrap: wrap; gap: 6px; padding: 0 12px; }
  .acm-id-tab { flex: 1 1 45%; min-width: 0; font-size: 12px; padding: 8px 10px; }
  /* Body padding */
  .acm-wiz-pinned-top { padding: 10px 12px 8px; gap: 8px; }
  .acm-wiz-body { padding: 12px; }
  /* ALL grids → single col on phone */
  .acm-grid-4, .acm-grid-3, .acm-grid-2 { grid-template-columns: 1fr; }
  .acm-loc-grid-2, .acm-loc-grid-4 { grid-template-columns: 1fr; }
  .acm-mt-12 { margin-top: 10px; }
  /* Field input sizing */
  .acm-input { font-size: 13px; padding: 9px 11px; }
  /* Section header */
  .acm-sec-header { padding: 10px 12px; }
  .acm-sec-title { font-size: 13px; }
  .acm-sec-sub   { display: none; }
  .acm-sec-pad   { padding: 10px; }
  /* Linked customer card */
  .acm-linked { padding: 12px; }
  .acm-linked-grid { grid-template-columns: 1fr 1fr; padding: 8px; gap: 8px; }
  .acm-linked-hide { font-size: 11px; padding: 4px 10px; }
  /* Wizard footer: Cancel on top, primary action group on bottom
     (Previous + Save & Next sit as a 2-up row inside .acm-footer-right).
     Reset align-items so column children fill width — base rule has
     align-items: center which otherwise shrinks Cancel to content
     width and centres it (that's what looked broken in mobile). */
  .acm-wiz-footer {
    padding: 10px 12px 14px;
    flex-direction: column;
    align-items: stretch;
    gap: 8px;
  }
  .acm-wiz-footer > .acm-btn { width: 100%; flex: 0 0 auto; }
  .acm-footer-right { width: 100%; display: flex; gap: 8px; }
  .acm-footer-right .acm-btn { flex: 1 1 0; min-width: 0; }
  .acm-btn { padding: 10px 12px; font-size: 13px; justify-content: center; }
  /* Address & Contact table card */
  .acm-loc-head-row { flex-wrap: wrap; gap: 8px; }
  .acm-loc-head-text { flex: 1 1 100%; }
  .acm-add-pill { width: 100%; justify-content: center; font-size: 12px; padding: 8px 12px; }
  /* Sub-modal (Location / KYC Doc / KYC Owner) */
  .acm-loc-sub-overlay { padding: 0; align-items: stretch; }
  .acm-loc-sub-card { border-radius: 0; max-height: 100vh; height: 100vh; width: 100vw; }
  .acm-loc-sub-header { padding: 14px 16px; }
  .acm-loc-sub-body   { padding: 14px; }
  /* Sub-modal footer: Cancel on top, primary save on bottom.
     align-items: stretch so column children fill width. */
  .acm-loc-sub-footer {
    padding: 12px 14px 14px;
    flex-direction: column;
    align-items: stretch;
    gap: 8px;
  }
  .acm-loc-sub-footer .acm-btn { width: 100%; flex: 0 0 auto; }
  /* Stage 2 KYC sub-tabs */
  .acm-kyc-subtabs { flex-wrap: wrap; gap: 6px; }
  .acm-kyc-subtab { flex: 1 1 45%; font-size: 12px; padding: 8px 10px; }
  /* KYC toolbar (search + count + add) */
  .acm-kyc-head-row { flex-wrap: wrap; gap: 8px; }
  .acm-kyc-head-text { flex: 1 1 100%; }
  .acm-kyc-toolbar { flex-direction: column; align-items: stretch; gap: 8px; padding: 10px 12px; }
  .acm-kyc-search { max-width: 100%; }
  .acm-kyc-count { align-self: flex-start; }
  /* Same-as-Customer banner */
  .acm-same-banner { padding: 10px 12px; gap: 10px; }
  .acm-same-banner-sub { font-size: 11.5px; }
  /* Recap (Stage 3) */
  .acm-recap-grid { grid-template-columns: 1fr; }
  .acm-recap-header { flex-direction: column; align-items: flex-start; gap: 8px; }
  /* Vault sub-tabs */
  .acm-vault-tabs { flex-wrap: wrap; gap: 6px; }
  .acm-vault-tab  { flex: 1 1 45%; font-size: 12px; padding: 8px 10px; }
  /* File upload zone */
  .acm-file-drop { padding: 12px; }
  .acm-file-drop-title { font-size: 12px; }
  .acm-file-drop-sub { font-size: 10.5px; }
}
`;
