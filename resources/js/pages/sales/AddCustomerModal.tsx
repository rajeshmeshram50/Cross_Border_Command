import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import api from '../../api';
import { MasterSelect, MasterDatePicker, MasterMultiSelect } from '../master/masterFormKit';
import Tooltip from '../../components/ui/Tooltip';
import DeleteConfirmModal from '../../components/ui/DeleteConfirmModal';
import { Shimmer } from '../../components/ui/Shimmer';
import { resolveFileUrl } from '../../utils/resolveFileUrl';
import { useToast } from '../../contexts/ToastContext';
import SalesCustomerSendForSignatureModal from './SalesCustomerSendForSignatureModal';

/* ────────────────────────────────────────────────────────────────────────────
 * Add Customer — 3-stage modal
 *
 * Native React port of #addCustomerModal from Customer_Flow.html.
 *   Stage 1 — Customer Legal Identity (Identification + Address & Contact)
 *   Stage 2 — KYC / Due Diligence (Company DD / Owner KYC / Trade Licence)
 *   Stage 3 — Evidence Vault (KYC Documents / Trade Documents)
 *
 * All CSS is scoped under `.acm-root` so it doesn't bleed into the rest of
 * the app. Saving is stubbed: clicking Save/Submit fires an alert, no real
 * persistence wire-up yet — that lands when the customers table migration
 * lands and we swap the front-end arrays for /api/customers POST.
 * ──────────────────────────────────────────────────────────────────────── */

type Stage = 1 | 2 | 3;
type StageTab = 'identification' | 'address-contact';
type KycSubTab = 'company-dd' | 'owner-kyc' | 'trade-licence';
type EvTab = 'kyc-documents' | 'trade-documents';
type EvSubTab = 'dd' | 'kyc' | 'tl';

/** Unified location row — every additional location captures both the
 *  address *and* the contact person at that address. The fields used
 *  to live in two parallel interfaces (AddressRow + ContactRow) with
 *  the same shape; merging them here removes the duplicate state and
 *  the duplicate sub-modal. */
interface LocationRow {
  id: string;
  type: string; line: string; country: string; state: string; city: string; pin: string;
  cpName: string; cpDesignation: string; cpContact: string; cpEmail: string; cpWhatsapp: 'yes' | 'no' | '';
}
/** Default value for the "Address Type" field — surfaced as the
 *  pre-selected option on the primary address form and on every new
 *  Add Location sub-modal. User can switch to any other master entry. */
const DEFAULT_ADDRESS_TYPE = 'Registered Office';

/* ── Master option shape — every list comes back from /master/{slug}
 *    normalized to { id, name } so the JSX is uniform regardless of the
 *    underlying column (segments uses `title`, the rest use `name`).
 *    States additionally carry country_id so we can filter by selected
 *    country at the UI layer. */
interface MasterOpt { id: number; name: string; }
interface StateOpt extends MasterOpt { country_id: number; }
interface MasterLists {
  customerTypes:     MasterOpt[];
  segments:          MasterOpt[];
  classifications:   MasterOpt[];
  riskLevels:        MasterOpt[];
  addressTypes:      MasterOpt[];
  countries:         MasterOpt[];
  states:            StateOpt[];
  designations:      MasterOpt[];
  /** Document Type master — backs the "Document / License Name"
   *  dropdown on the Stage 2 Add Document / License sub-modal.
   *  Managed in the Master module under "Document Types". */
  documentTypes:     MasterOpt[];
}
const EMPTY_MASTERS: MasterLists = {
  customerTypes: [], segments: [], classifications: [], riskLevels: [],
  addressTypes: [], countries: [], states: [], designations: [], documentTypes: [],
};

// MasterSelect expects `{ value, label }`. Customer/segment/classification/
// risk/address values on this form are still stored as the display name
// (everything saves as strings), so value === label here. If the customers
// API later switches to storing master ids, this is the one place to swap
// `String(o.id)` in.
const toSelectOpts = (rows: MasterOpt[]) => rows.map(o => ({ value: o.name, label: o.name }));

/**
 * Same as `toSelectOpts` but also injects the currently-selected
 * `current` value as a synthetic option when it isn't already in the
 * list. Without this, opening an existing customer for edit shows the
 * placeholder when the saved value either (a) was captured as free
 * text before the field became a master dropdown (e.g. a typed
 * designation like "Director, CFO"), or (b) was deleted/renamed in
 * the master after the customer was saved. Keeping the synthetic row
 * preserves the user's history and avoids silently zeroing the value
 * on the next Save.
 */
const optsWith = (rows: MasterOpt[], current?: string | null) => {
  const base = toSelectOpts(rows);
  const v = (current ?? '').trim();
  if (v && !base.some(o => o.value === v)) return [{ value: v, label: v }, ...base];
  return base;
};

/* Stage 2 / Stage 3 reference lists.
 *   - Stage 2 Company DD and Owner KYC are backed by live
 *     customer_documents + customer_owners (so they render from
 *     the parent's API state, not these arrays).
 *   - Stage 3 (Evidence Vault) is still design-only — its renderer
 *     consumes the arrays below directly as read-only placeholder
 *     rows. When the Evidence Vault backend lands, swap the source
 *     to live data; the table layout stays unchanged.
 *   - Trade Licence on Stage 2 also reads TL_DOCS for now (the
 *     same design-only treatment). */
type KycDocRow = { code: string; name: string; authority: string; expiry: string; status: string };
const DD_DOCS: KycDocRow[] = [
  { code: 'DD-001', name: 'Certificate of Incorporation',                          authority: 'Registrar of Companies (ROC)', expiry: 'N/A',     status: 'mandatory' },
  { code: 'DD-002', name: 'Memorandum & Articles of Association (MOA/AOA)',        authority: 'Registrar of Companies (ROC)', expiry: 'N/A',     status: 'mandatory' },
  { code: 'DD-003', name: 'Board Resolution for Authorized Signatory',             authority: 'Company Board',                expiry: '12/2026', status: 'mandatory' },
  { code: 'DD-004', name: 'Financial Statements (Last 2-3 Years)',                 authority: 'Statutory Auditor',            expiry: '03/2026', status: 'mandatory' },
  { code: 'DD-005', name: 'Bank Account Verification Letter / Cancelled Cheque',   authority: 'Authorized Dealer Bank',       expiry: 'N/A',     status: 'mandatory' },
  { code: 'DD-006', name: 'Tax Registration Certificate',                          authority: 'Income Tax Department',        expiry: 'N/A',     status: 'optional'  },
];
const OWN_KYC_DOCS: KycDocRow[] = [
  { code: 'KYC-001', name: 'PAN Card',                                  authority: 'Income Tax Department',           expiry: 'N/A',    status: 'active' },
  { code: 'KYC-002', name: 'Aadhaar Card',                              authority: 'UIDAI',                           expiry: 'N/A',    status: 'active' },
  { code: 'KYC-003', name: 'Address Proof',                             authority: 'Bank / Utility / Govt Authority', expiry: 'N/A',    status: 'active' },
  { code: 'KYC-004', name: 'Identity Proof (Passport / DL / Voter ID)', authority: 'GOI / RTO / ECI',                 expiry: 'Varies', status: 'active' },
  { code: 'KYC-005', name: 'Company Registration Certificate',          authority: 'Registrar of Companies (ROC)',    expiry: 'N/A',    status: 'active' },
  { code: 'KYC-006', name: 'GST Certificate',                           authority: 'GST Department',                  expiry: '09/2030', status: 'active' },
  { code: 'KYC-007', name: 'Passport-size Photograph',                  authority: 'Self-Provided',                   expiry: 'N/A',    status: 'active' },
  { code: 'KYC-008', name: 'Bank Statement (Last 6 Months)',            authority: 'Authorized Bank',                 expiry: 'N/A',    status: 'active' },
  { code: 'KYC-009', name: 'Utility Bill',                              authority: 'Service Provider',                expiry: 'N/A',    status: 'active' },
  { code: 'KYC-010', name: 'Property Tax Receipt',                      authority: 'Municipal Authority',             expiry: 'N/A',    status: 'active' },
];
const TL_DOCS: KycDocRow[] = [
  { code: 'TL-001', name: 'Import Export Code (IEC)',      authority: 'DGFT',                     expiry: '03/2026', status: 'mandatory' },
  { code: 'TL-002', name: 'RCMC Certificate',              authority: 'Export Promotion Council', expiry: '05/2027', status: 'mandatory' },
  { code: 'TL-003', name: 'Export Licence',                authority: 'DGFT',                     expiry: '12/2026', status: 'optional'  },
  { code: 'TL-004', name: 'Drug Licence',                  authority: 'CDSCO',                    expiry: '08/2027', status: 'optional'  },
  { code: 'TL-005', name: 'FSSAI Licence',                 authority: 'FSSAI',                    expiry: '06/2028', status: 'optional'  },
  { code: 'TL-006', name: 'GST Registration',              authority: 'GST Department',           expiry: 'N/A',     status: 'mandatory' },
  { code: 'TL-007', name: 'ISO Certification',             authority: 'Certification Body',       expiry: '11/2027', status: 'optional'  },
  { code: 'TL-008', name: 'Pollution Control Certificate', authority: 'Pollution Control Board',  expiry: '07/2026', status: 'mandatory' },
];

/* ─── File-upload guard ─────
 * Browser `accept=` is only a hint — users can switch the file picker
 * to "All files" and select a .php / .exe / .zip anyway. We re-check
 * the chosen file's extension + size here and reject + alert if it
 * doesn't match. The server enforces the same list
 * (mimes:jpg,jpeg,png,pdf,doc,docx) so a manipulated request can't
 * slip through either. */
const ALLOWED_DOC_EXTS = ['pdf', 'jpg', 'jpeg', 'png', 'doc', 'docx'];
const ALLOWED_PHOTO_EXTS = ['jpg', 'jpeg', 'png'];
const MAX_UPLOAD_MB = 2;
type FileKind = 'doc' | 'photo';
function validateUpload(file: File, kind: FileKind = 'doc'): string | null {
  const allowed = kind === 'photo' ? ALLOWED_PHOTO_EXTS : ALLOWED_DOC_EXTS;
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (!allowed.includes(ext)) {
    return `Only ${allowed.map(e => e.toUpperCase()).join(', ')} files are allowed (got .${ext}).`;
  }
  if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
    return `File must not exceed ${MAX_UPLOAD_MB} MB.`;
  }
  return null;
}

const KYC_PER_PAGE = 6;
const KYC_TAB_META: Record<KycSubTab, { title: string; sub: string; nameCol: string; placeholder: string; data: typeof DD_DOCS; showAdd: boolean; addLabel?: string }> = {
  'company-dd':   { title:'COMPANY DUE DILIGENCE', sub:'| Licenses, statutory documents, and compliance proofs', nameCol:'DD Document Name',     placeholder:'Search DD document name...',     data: DD_DOCS,      showAdd: true,  addLabel:'Add Document / License' },
  'owner-kyc':    { title:'OWNER KYC DETAILS',     sub:'| Owner identity proofs, address proofs, and photographs', nameCol:'KYC Document Name', placeholder:'Search KYC document name...',    data: OWN_KYC_DOCS, showAdd: true,  addLabel:'Add Owner KYC Document' },
  'trade-licence':{ title:'TRADE LICENCE',         sub:'| Trade licence documents and regulatory approvals',     nameCol:'Document Name',         placeholder:'Search trade licence document...', data: TL_DOCS,    showAdd: true,  addLabel:'Add Trade Licence' },
};
const EV_SUB_META: Record<EvSubTab, { title: string; sub: string; nameCol: string; data: typeof DD_DOCS }> = {
  dd:  { title:'COMPANY DUE DILIGENCE', sub:'| Licenses, statutory documents, and compliance proofs', nameCol:'DD Document Name',  data: DD_DOCS },
  kyc: { title:'OWNER KYC DETAILS',     sub:'| Owner identity proofs, address proofs, and photographs', nameCol:'KYC Document Name', data: OWN_KYC_DOCS },
  tl:  { title:'TRADE LICENCE',         sub:'| Trade licence documents and regulatory approvals',     nameCol:'Document Name',      data: TL_DOCS },
};

const newId = (prefix: string) => prefix + '_' + Math.random().toString(36).slice(2, 9);

/* ── Stage memory ──────────────────────────────────────────────────
 * Module-level map keyed by customer.db_id (edit mode) that survives
 * close/reopen so a user who accidentally dismisses the modal on
 * Stage 2 or Stage 3 lands back on the same stage when they reopen —
 * not jarringly bounced back to Stage 1.
 *
 * Only writes happen for edit-mode customers; create mode starts
 * fresh on every open. The entry is cleared after a successful final
 * submit so the next visit reads as "fresh open" again. */
type StageMemoryEntry = { stage: Stage; maxStage: Stage; tab: StageTab; kycSub: KycSubTab; evTab: EvTab };
const stageMemory = new Map<number, StageMemoryEntry>();

// Minimal customer shape the parent list passes in when editing. Mirrors the
// `Customer` type in SalesCustomers; kept inline so this modal doesn't depend
// on the parent file. `db_id` is the underlying numeric primary key — needed
// for PUT/DELETE; absent until the row has been persisted server-side.
export interface EditCustomer {
  id: string; db_id?: number; company: string; type: string; segment: string;
  country: string; contact: string; phone: string; email: string;
  whatsapp: 'Yes' | 'No';
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** When set, modal opens in Edit mode with form pre-filled from this row. */
  customer?: EditCustomer | null;
  /** Fired after a successful POST or PUT so the parent list can refetch. */
  onSaved?: () => void;
}

export default function AddCustomerModal({ open, onClose, customer, onSaved }: Props) {
  const isEdit = !!customer;
  const toast = useToast();
  const [stage, setStage] = useState<Stage>(1);
  const [maxStage, setMaxStage] = useState<Stage>(1);
  const [tab, setTab] = useState<StageTab>('identification');
  const [kycSub, setKycSub] = useState<KycSubTab>('company-dd');
  const [kycPage, setKycPage] = useState<Record<KycSubTab, number>>({ 'company-dd':1, 'owner-kyc':1, 'trade-licence':1 });
  const [kycSearch, setKycSearch] = useState('');
  const [evTab, setEvTab] = useState<EvTab>('kyc-documents');
  const [evSub, setEvSub] = useState<EvSubTab>('dd');
  // History panel defaults to OPEN so the moment the user reaches
  // Stage 2 they can see the captured Stage 1 data (Basic Company
  // Details + Primary Address & Contact Person) without an extra
  // click. They can still collapse it via the chevron if they want
  // more vertical space for the active stage.
  const [historyOpen, setHistoryOpen] = useState(true);

  // ── Master dropdowns. Every <select> on this modal sources its
  //    options from /master/{slug}, scoped server-side to the
  //    inviting tenant. Inactive rows are filtered out at the UI
  //    layer so historical data still renders if someone edits an
  //    older customer that referenced a since-deactivated row.
  const [masters, setMasters] = useState<MasterLists>(EMPTY_MASTERS);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const pickName = (rows: any[], key = 'name'): MasterOpt[] => rows
      .filter(r => !r.status || String(r.status).toLowerCase() === 'active')
      .map(r => ({ id: Number(r.id), name: String(r[key] ?? '') }))
      .filter(r => r.name);
    const pickStates = (rows: any[]): StateOpt[] => rows
      .filter(r => !r.status || String(r.status).toLowerCase() === 'active')
      .map(r => ({ id: Number(r.id), name: String(r.name ?? ''), country_id: Number(r.country_id) }))
      .filter(r => r.name);
    Promise.allSettled([
      api.get('/master/customer_types').then(r => { if (!cancelled) setMasters(m => ({ ...m, customerTypes: pickName(r.data ?? []) })); }),
      api.get('/master/segments').then(r => { if (!cancelled) setMasters(m => ({ ...m, segments: pickName(r.data ?? [], 'title') })); }),
      api.get('/master/customer_classifications').then(r => { if (!cancelled) setMasters(m => ({ ...m, classifications: pickName(r.data ?? []) })); }),
      api.get('/master/risk_levels').then(r => { if (!cancelled) setMasters(m => ({ ...m, riskLevels: pickName(r.data ?? []) })); }),
      api.get('/master/address_types').then(r => { if (!cancelled) setMasters(m => ({ ...m, addressTypes: pickName(r.data ?? []) })); }),
      api.get('/master/countries').then(r => {
        if (cancelled) return;
        const sorted = [...(r.data ?? [])].sort((a: any, b: any) => String(a.name).localeCompare(String(b.name)));
        setMasters(m => ({ ...m, countries: pickName(sorted) }));
      }),
      api.get('/master/states').then(r => { if (!cancelled) setMasters(m => ({ ...m, states: pickStates(r.data ?? []) })); }),
      api.get('/master/designations').then(r => { if (!cancelled) setMasters(m => ({ ...m, designations: pickName(r.data ?? []) })); }),
      // Document Type master — field is `title` (not `name`) — so pickName
      // is called with the secondary key. Used by Stage 2's Add Document /
      // License sub-modal.
      api.get('/master/document_type').then(r => { if (!cancelled) setMasters(m => ({ ...m, documentTypes: pickName(r.data ?? [], 'title') })); }),
    ]);
    return () => { cancelled = true; };
  }, [open]);

  // Form: company + primary address + primary contact
  const [form, setForm] = useState({
    coName:'', coLegal:'', coType:'', coWeb:'', coSeg:[] as string[], coClass:'', coRisk:'',
    /* Primary address type is locked to "Registered Office" in the UI
       — other types live on the Address & Contact Details tab. */
    addrType: DEFAULT_ADDRESS_TYPE, addr:'', country:'', state:'', city:'', pin:'',
    cpName:'', cpDesig:'', cpTel:'', cpEmail:'', cpWa:'yes' as 'yes'|'no'|'',
  });
  const setF = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm(prev => ({ ...prev, [k]: v }));

  // Additional locations (each row = address + the contact person at that
  // address; previously stored as two parallel arrays which carried the
  // same fields). The primary address+contact lives on `form` above.
  const [locations, setLocations] = useState<LocationRow[]>([]);

  // Inline validation errors. Key = form field name on Stage 1; value =
  // the message rendered under the input. Cleared on next keystroke.
  const [errors, setErrors] = useState<Record<string, string>>({});

  /* Real-time duplicate detection for the primary contact phone & email.
   * Fires inline error the moment the user finishes typing a value
   * that's already used by an additional location row — much friendlier
   * than letting them click Save & Next and bounce back. The check
   * mirrors the click-time validator in validateStage1() so behaviour
   * stays consistent. */
  useEffect(() => {
    const phone = (form.cpTel   || '').trim();
    const email = (form.cpEmail || '').trim().toLowerCase();
    const dupPhoneMsg = 'This phone number is already used by another address on this customer';
    const dupEmailMsg = 'This email is already used by another address on this customer';
    setErrors(prev => {
      const next = { ...prev };
      const phoneDup = phone && locations.some(l => (l.cpContact || '').trim() === phone);
      const emailDup = email && locations.some(l => (l.cpEmail   || '').trim().toLowerCase() === email);
      if (phoneDup) next.cpTel = dupPhoneMsg;
      else if (next.cpTel === dupPhoneMsg) delete next.cpTel;
      if (emailDup) next.cpEmail = dupEmailMsg;
      else if (next.cpEmail === dupEmailMsg) delete next.cpEmail;
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.cpTel, form.cpEmail, locations]);

  /* Numeric PK of the saved customer. In edit mode it comes from the
   * `customer` prop (passed in from the list). In create mode it's set
   * by the Stage 1 → 2 auto-save POST so Stage 2 KYC upload calls have
   * a `/customers/{id}/documents` target without forcing the user to
   * close + re-open the modal. */
  const [savedDbId, setSavedDbId] = useState<number | null>(customer?.db_id ?? null);
  /* Synchronous re-entry lock — `saving` state is async and React
   * batches updates, so two rapid Save & Next clicks can both pass
   * the saving check before either has set saving=true. A ref flips
   * immediately on the synchronous tick, blocking the second call
   * cold. Fixes the duplicate-row issue users saw on quick clicks. */
  const inFlightRef = useRef(false);

  // Trade docs selection — initial rows are populated from the segment
  // rule when the user picks a segment in Stage 1 (see segment-template
  // effect below). Falls back to the original two-row placeholder when
  // the segment has no rule (or no `td` selections).
  /* `db_id` is the numeric clm_trade_doc_library.id — required by the
   * Zoho Sign send modal. It's null on the legacy placeholder rows and
   * populated when the segment-rule merge below joins against the
   * /clm/trade-doc-library/for-party/buyer endpoint. */
  const [tdDocs, setTdDocs] = useState<TdDocRow[]>([
    { id:'td1', db_id:null, name:'Bill of Lading',           selected:true, sent:false, status: 'idle' },
    { id:'td2', db_id:null, name:'Phytosanitary Certificate', selected:true, sent:false, status: 'idle' },
  ]);

  /* "Send for Signature" launch state — when non-null, the Zoho Sign
   * wizard pops with the listed clm_trade_doc_library ids pre-checked.
   * The Stage 3 Trade Documents tab's per-row "Send" button (single id)
   * and the "Send Selected Documents for Signature" footer button
   * (all currently-checked ids) both write to this state. */
  const [sendForSignature, setSendForSignature] = useState<number[] | null>(null);

  /* Resend cooldown — Zoho's remind API operates per-REQUEST (one request
   * may bundle 1..10 docs), so clicking Resend on any row in a bundle
   * triggers ONE email covering every unsigned doc in that request.
   * To stop a 3-doc bundle from triggering 3 reminder emails, every
   * successful remind seeds a 60-second cooldown keyed by zoho-side
   * signature_request_id; the Resend button on every sibling row in
   * the same bundle disables for the cooldown window.
   *
   * Stored as { signature_request_id: expiresAtMs }. A self-pruning
   * setTimeout schedules cleanup at the earliest expiry; the resulting
   * state change re-renders the table so the button auto-enables. */
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

  /* Signature-request status, keyed by clm_trade_doc_library.id. Hydrated
   * from /clm/signature-requests?party_id=N and refreshed every 15s while
   * the user is on the Stage 3 Trade Documents tab. The poller passes
   * `sync=true` so the backend pulls each inprogress row from Zoho on the
   * same request — that's how completed signings, declines and recalls
   * appear in the table without the user having to reload. */
  type SigInfo = { status: TdSigStatus; signatureRequestId: number; signedUrl?: string };
  const [sigStatusByDoc, setSigStatusByDoc] = useState<Record<number, SigInfo>>({});

  useEffect(() => {
    const partyId = customer?.db_id ?? savedDbId;
    if (!open || stage !== 3 || evTab !== 'trade-documents' || !partyId) return;

    let cancelled = false;

    const fetchAndUpdate = async (withSync: boolean) => {
      try {
        const r = await api.get('/clm/signature-requests', {
          params: { party_id: partyId, model_name: 'Customer', sync: withSync ? 1 : 0 },
        });
        if (cancelled) return;
        const rows: Array<{
          id: number;
          status: TdSigStatus;
          trade_doc_ids: number[];
          signed_document_paths?: Array<{ url?: string; path?: string }> | null;
        }> = Array.isArray(r.data?.data) ? r.data.data : [];

        // Latest request wins when a single doc has been resent. The list
        // endpoint returns rows newest-first (per the controller's ->latest()
        // ordering), so the first row we see for a doc id is the most
        // recent — `if (!map.has(docId))` keeps it that way.
        const map: Record<number, SigInfo> = {};
        for (const row of rows) {
          const ids = Array.isArray(row.trade_doc_ids) ? row.trade_doc_ids : [];
          for (let i = 0; i < ids.length; i++) {
            const docId = Number(ids[i]);
            if (!docId || map[docId]) continue;
            const signedEntry = Array.isArray(row.signed_document_paths) ? row.signed_document_paths[i] : null;
            // Route the URL through resolveFileUrl so it picks up the
            // right base (VITE_API_URL on the deployed SPA, current
            // origin in dev), and so legacy /storage prefixes don't
            // double-stack. Prevents the "View / Download icons go
            // nowhere" bug when the SPA origin differs from the API.
            const rawSignedUrl = signedEntry?.url || signedEntry?.path || null;
            map[docId] = {
              status: row.status,
              signatureRequestId: row.id,
              signedUrl: rawSignedUrl ? resolveFileUrl(rawSignedUrl) : undefined,
            };
          }
        }
        setSigStatusByDoc(map);
      } catch {
        // Silent — polling failures shouldn't toast every 15s.
      }
    };

    fetchAndUpdate(false);
    const iv = window.setInterval(() => fetchAndUpdate(true), 15000);
    return () => { cancelled = true; window.clearInterval(iv); };
  }, [open, stage, evTab, customer?.db_id, savedDbId]);

  // Project the polled status into the tdDocs rows so the table renders
  // live state. Kept as an effect (not a useMemo on render) because we
  // also want the `sent` flag to flip permanently once a doc has been
  // sent, even if the polling response transiently drops it.
  useEffect(() => {
    setTdDocs(prev => prev.map(d => {
      if (!d.db_id) return d;
      const info = sigStatusByDoc[d.db_id];
      if (!info) return d;
      return {
        ...d,
        sent: d.sent || info.status !== 'idle',
        status: info.status,
        signature_request_id: info.signatureRequestId,
        signed_url: info.signedUrl ?? d.signed_url,
      };
    }));
  }, [sigStatusByDoc]);

  /* Segment-rule template — resolved KYC / DD / TL / TD / QC master rows
   * for the currently-selected segment. The Stage 2 Trade Licence sub-
   * tab and Stage 3 Trade Documents tab render off these when present
   * (falling back to the legacy static lists otherwise). Stage 2 Company
   * DD also surfaces the segment's required-doc reference list as an
   * info banner so the user knows which uploads are expected. */
  type SegDocRow = { id:number; code:string; name:string; authority?:string|null; expiry?:string|null; status?:string; requirement:'M'|'O' };
  type SegmentDocs = { kyc: SegDocRow[]; dd: SegDocRow[]; tl: SegDocRow[]; td: SegDocRow[]; qc: SegDocRow[] };
  const EMPTY_SEG_DOCS: SegmentDocs = { kyc:[], dd:[], tl:[], td:[], qc:[] };
  const [segmentDocs, setSegmentDocs] = useState<SegmentDocs>(EMPTY_SEG_DOCS);

  /* Per-row file uploads against the segment-rule reference rows in
   * Stage 2 (Company DD / Owner KYC / Trade Licence). Key shape is
   * `${sub-tab}::${doc.code}` so codes don't collide across categories.
   * Value carries the File plus a blob URL for View/Download links —
   * the URL stays valid as long as the modal session lives. */
  type SegRefUpload = { file: File | null; url: string; name: string };
  const [segmentRefUploads, setSegmentRefUploads] = useState<Record<string, SegRefUpload>>({});

  /* Persist a segment-rule reference upload to the server. refKey
   * shape is `${sub-tab}::${doc.code}` — we split the sub-tab back into
   * its (kyc|dd|tl) category and POST FormData to the SegmentDocUpload
   * endpoint that the Evidence Vault reads from. Without this round-
   * trip the upload only lives in browser memory and disappears the
   * next time the modal opens. */
  const SUB_TO_CAT_C: Record<string, 'kyc' | 'dd' | 'tl'> = {
    'company-dd':    'dd',
    'owner-kyc':     'kyc',
    'trade-license': 'tl',
  };
  const persistSegmentRefUpload = async (refKey: string, file: File, docName: string) => {
    const ownerId = savedDbId || customer?.db_id || null;
    if (!ownerId) {
      toast.error('Save first', 'Save the customer before attaching reference documents.');
      return;
    }
    const [sub, doc_code] = refKey.split('::');
    const category = SUB_TO_CAT_C[sub];
    if (!category || !doc_code) return;
    const fd = new FormData();
    fd.append('category', category);
    fd.append('doc_code', doc_code);
    fd.append('doc_name', docName || doc_code);
    fd.append('attachment', file);
    try {
      const { data } = await api.post(`/segment-uploads/customer/${ownerId}`, fd, {
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

  // Sub-modal — single one now since address and contact share the same
  // fields. `editing` carries the location row id when re-opening for edit.
  const [locModal, setLocModal] = useState<{ open:boolean; editing:string|null }>({ open:false, editing:null });

  // Delete-confirm popup for the Address & Contact table. Project-wide
  // DeleteConfirmModal — same component used by Branches / Clients /
  // Employees so the experience stays consistent across modules.
  const [delModal, setDelModal] = useState<{ open:boolean; id:string|null }>({ open:false, id:null });

  // Stage 2 — "Add Document / License" popup. Triggered from the
  // Company Due Diligence / Owner KYC / Trade Licence section headers.
  // `sub` carries which of the three buckets is being added to so the
  // modal can label itself contextually.
  const [docModal, setDocModal] = useState<{ open:boolean; sub:KycSubTab }>({ open:false, sub:'company-dd' });

  /* ── Stage 2 — KYC live data ───────────────────────────────────────
   * Pulled from /customers/{id}/documents (kind=dd|tl) and
   * /customers/{id}/owners when the modal opens in edit mode. Saving
   * a new row pushes its server response into the matching bucket so
   * the Stage 2 table refreshes without a full refetch. */
  type KycDocRowApi = {
    id: number; kind: 'dd' | 'tl'; name: string; license_number?: string | null;
    issuing_authority?: string | null; issue_date?: string | null; expiry_date?: string | null;
    attachment_path?: string | null; attachment_url?: string | null; attachment_name?: string | null;
    description?: string | null; status?: string;
  };
  type KycOwnerRowApi = {
    id: number; owner_name: string; designation?: string | null; official_email?: string | null;
    phone_number?: string | null;
    /* Both *_path and *_url carried side-by-side. The backend's
     * Storage::url() can throw on misconfigured public disks
     * (FilesystemAdapter raises "This driver does not support
     * retrieving URLs"). When that happens, *_url comes back null
     * and the frontend falls back to resolveFileUrl(*_path). */
    id_proof_path?: string | null;       id_proof_url?: string | null;
    address_proof_path?: string | null;  address_proof_url?: string | null;
    photograph_path?: string | null;     photograph_url?: string | null;
    status?: string;
  };
  const [kycDocs,   setKycDocs]   = useState<KycDocRowApi[]>([]);
  const [kycOwners, setKycOwners] = useState<KycOwnerRowApi[]>([]);

  /** Confirm-delete state for Stage 2 rows. `kind` decides which
   *  endpoint the confirm calls. */
  const [kycDelModal, setKycDelModal] = useState<{ open: boolean; kind: 'doc' | 'owner'; id: number | null; label?: string }>({ open: false, kind: 'doc', id: null });
  /* In-flight flag for the Stage 2 delete confirm — drives spinner +
   * disabled state on the confirm dialog while the DELETE request is
   * in flight. */
  const [kycDeleting, setKycDeleting] = useState(false);

  /** Edit-mode targets for Stage 2 sub-modals. When set, the matching
   *  sub-modal opens pre-filled and saves via PUT instead of POST. */
  const [editDocId,   setEditDocId]   = useState<number | null>(null);
  const [editOwnerId, setEditOwnerId] = useState<number | null>(null);

  // Saving flag — disables the Submit/Save & Next button + suppresses
  // double-submits while POST/PUT is in flight.
  const [saving, setSaving] = useState(false);

  // Hydrating flag — covers the brief window between modal open and
  // the full customer detail landing from /api/customers/:id in Edit
  // mode. Used to dim the body so the user doesn't start typing into
  // fields that are about to be overwritten.
  const [hydrating, setHydrating] = useState(false);

  // Reset all state when modal closes. When `customer` is provided we open in
  // Edit mode and prefill the form fields we know about (company name, type,
  // segment, country, contact person, phone, email, whatsapp). The list row
  // doesn't carry KYC/address detail so those stay blank — when the real GET
  // /api/customers/:id endpoint lands, fetch and hydrate the rest here.
  useEffect(() => {
    if (!open) return;
    /* Both create and edit modes always land on Stage 1 so the user
     * reviews identity first before stepping forward. Sub-tab memory
     * (KYC sub-tab, vault tab) is still restored so inner navigation
     * isn't lost if the user advances back to Stage 2/3 manually. */
    const memKey = customer?.db_id ?? null;
    const remembered = memKey ? stageMemory.get(memKey) : null;
    setStage   (1);
    setMaxStage(remembered?.maxStage ?? 1);
    setTab     ('identification');
    setKycSub  (remembered?.kycSub   ?? 'company-dd');
    setEvTab   (remembered?.evTab    ?? 'kyc-documents');
    setKycPage({ 'company-dd':1, 'owner-kyc':1, 'trade-licence':1 });
    setKycSearch('');
    setEvSub('dd');
    setHistoryOpen(true);
    setForm({
      coName:   customer?.company ?? '',
      coLegal:  customer?.company ?? '',
      coType:   customer?.type ?? '',
      coWeb:    '',
      /* Segment is now multi-valued. The list row only carries a
       * single comma-separated string (legacy), so split on comma and
       * trim — empty pieces drop out. */
      coSeg:    (customer?.segment ?? '').split(',').map(s => s.trim()).filter(Boolean),
      coClass:  '',
      coRisk:   '',
      addrType: DEFAULT_ADDRESS_TYPE,
      addr:     '',
      country:  customer?.country ?? '',
      state:    '',
      city:     '',
      pin:      '',
      cpName:   customer?.contact ?? '',
      cpDesig:  '',
      cpTel:    customer?.phone ?? '',
      cpEmail:  customer?.email ?? '',
      cpWa:     customer?.whatsapp === 'No' ? 'no' : 'yes',
    });
    setLocations([]);
    setKycDocs([]);
    setKycOwners([]);
    setErrors({});
    // Edit mode arrives with db_id (Stage 2 KYC POSTs work
    // immediately); create mode starts null and gets filled by the
    // Stage 1 → 2 auto-save POST so KYC uploads gain a target in the
    // same modal session.
    setSavedDbId(customer?.db_id ?? null);
    setTdDocs([
      { id:'td1', db_id:null, name:'Bill of Lading',           selected:true, sent:false, status: 'idle' },
      { id:'td2', db_id:null, name:'Phytosanitary Certificate', selected:true, sent:false, status: 'idle' },
    ]);
    setSegmentDocs(EMPTY_SEG_DOCS);
    /* Revoke any previously-issued blob URLs so the browser releases
     * them back to the GC. Failing to do this leaks each picked file
     * for the lifetime of the tab. */
    Object.values(segmentRefUploads).forEach(u => { try { URL.revokeObjectURL(u.url); } catch {} });
    setSegmentRefUploads({});
    setLocModal({ open:false, editing:null });
    // Flip the shimmer ON immediately when an edit-mode modal opens.
    // Without this, the first render after `open` flips sees
    // `hydrating = false` (stale state from a previous close), so the
    // body shows neither shimmer nor data for a brief flash. The
    // hydration effect below still drives the actual fetch and the
    // setHydrating(false) on completion, but the shimmer is now
    // guaranteed from frame 1. Create mode keeps it off — there's
    // nothing to load.
    setHydrating(!!customer?.db_id);
    // Deps deliberately use a stable identifier (the customer's primary
    // key) instead of the customer object itself. Otherwise any parent
    // re-render that produces a new `customer` reference — even with
    // identical data — would re-run this effect, wipe in-progress
    // Stage 2/3 edits, and jump the user back to Stage 1.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, customer?.db_id ?? null, customer?.id ?? null]);

  /* Persist stage/tab into module-level memory whenever it changes.
   * Reading happens in the open-effect above — closing the modal
   * (which unmounts the component or flips `open` to false) leaves the
   * last-known stage in the map ready for the next open. Edit mode
   * only; create mode has no anchor key to remember it by. */
  useEffect(() => {
    if (!open) return;
    const memKey = customer?.db_id ?? null;
    if (memKey == null) return;
    stageMemory.set(memKey, { stage, maxStage, tab, kycSub, evTab });
  }, [open, customer?.db_id, stage, maxStage, tab, kycSub, evTab]);

  /* ── Edit-mode hydration. The list row passed in `customer` only
   * carries a thin slice of fields (company / type / segment / country
   * / contact / phone / email / whatsapp). On open we fetch the full
   * record from /api/customers/:id so every Stage 1 field — including
   * legal name, classification, risk level, website, full address +
   * pin, and the additional Locations & Contacts table — repopulates
   * with whatever the user saved before. */
  useEffect(() => {
    if (!open || !customer?.db_id) return;
    let cancelled = false;
    setHydrating(true);
    api.get(`/customers/${customer.db_id}`)
      .then(r => {
        if (cancelled) return;
        const d = r.data?.data ?? r.data ?? {};
        const pa = d.primary_address ?? {};
        setForm({
          coName:   d.company       ?? '',
          coLegal:  d.legalName     ?? d.company ?? '',
          coType:   d.type          ?? '',
          coWeb:    d.website       ?? '',
          /* Server still ships a single comma-joined `segment` string
           * (the column is scalar) — split + trim back into an array
           * for the multi-select. Array shapes from a future PATCH
           * also land here once the backend column is widened. */
          coSeg:    Array.isArray(d.segment)
                      ? d.segment.filter(Boolean)
                      : String(d.segment ?? '').split(',').map(s => s.trim()).filter(Boolean),
          coClass:  d.classification ?? '',
          coRisk:   d.riskLevel     ?? '',
          // Primary address type is locked to "Registered Office" — even
          // if older data stored a different label, normalise here so
          // the disabled dropdown stays in sync with the saved record.
          addrType: DEFAULT_ADDRESS_TYPE,
          addr:     pa.address_line ?? d.addr    ?? '',
          country:  pa.country      ?? d.country ?? '',
          state:    pa.state        ?? d.state   ?? '',
          city:     pa.city         ?? d.city    ?? '',
          pin:      pa.pin          ?? d.pin     ?? '',
          cpName:   pa.cp_name        ?? d.contact ?? '',
          cpDesig:  pa.cp_designation ?? d.cpDesig ?? '',
          cpTel:    pa.cp_contact     ?? d.phone   ?? '',
          cpEmail:  pa.cp_email       ?? d.email   ?? '',
          cpWa:     (pa.cp_whatsapp === 'no' || d.whatsapp === 'No') ? 'no' : 'yes',
        });
        // Additional locations — map the server shape back to LocationRow.
        const extra = Array.isArray(d.locations) ? d.locations : [];
        setLocations(extra.map((a: any) => ({
          id:             'loc_' + String(a.id),
          type:           a.type           ?? '',
          line:           a.address_line   ?? '',
          country:        a.country        ?? '',
          state:          a.state          ?? '',
          city:           a.city           ?? '',
          pin:            a.pin            ?? '',
          cpName:         a.cp_name        ?? '',
          cpDesignation:  a.cp_designation ?? '',
          cpContact:      a.cp_contact     ?? '',
          cpEmail:        a.cp_email       ?? '',
          cpWhatsapp:     a.cp_whatsapp === 'no' ? 'no' : 'yes',
        })));
      })
      .catch(() => { /* hydration failure: leave the thin prefill from the list row */ })
      .finally(() => { if (!cancelled) setHydrating(false); });

    // Stage 2 data — pulled in parallel with the main customer payload.
    Promise.all([
      api.get(`/customers/${customer.db_id}/documents`).catch(() => ({ data: { data: [] } })),
      api.get(`/customers/${customer.db_id}/owners`).catch(() => ({ data: { data: [] } })),
      /* Segment-rule reference uploads (Stage 2 KYC/DD/TL tables + Stage
       * 3 Evidence Vault). Hydrate from the same `segment_doc_uploads`
       * table that the Vault reads so re-open Edit shows what was
       * previously attached. */
      api.get(`/segment-uploads/customer/${customer.db_id}`).catch(() => ({ data: { data: [] } })),
    ]).then(([docsRes, ownersRes, refsRes]) => {
      if (cancelled) return;
      setKycDocs(Array.isArray(docsRes.data?.data) ? docsRes.data.data : []);
      setKycOwners(Array.isArray(ownersRes.data?.data) ? ownersRes.data.data : []);
      const refs = Array.isArray(refsRes.data?.data) ? refsRes.data.data : [];
      const hydrated: Record<string, SegRefUpload> = {};
      const CAT_TO_SUB: Record<string, string> = { dd: 'company-dd', kyc: 'owner-kyc', tl: 'trade-license' };
      for (const r of refs) {
        const sub = CAT_TO_SUB[r.category];
        if (!sub || !r.doc_code) continue;
        hydrated[`${sub}::${r.doc_code}`] = {
          file: null as unknown as File,
          url:  r.attachment_url || '',
          name: r.attachment_name || '',
        };
      }
      if (Object.keys(hydrated).length > 0) setSegmentRefUploads(hydrated);
    });

    return () => { cancelled = true; };
  }, [open, customer?.db_id]);

  /* ── Segment-rule template fetch ───────────────────────────────────
   * Whenever the user picks (or hydration sets) a segment in Stage 1,
   * resolve each chosen segment's id from the segments master and pull
   * its KYC / DD / TL / TD / QC documents in parallel. The category
   * arrays are then merged and deduped by `code` so a doc that's
   * required by multiple segments only renders once in Stage 2 + Stage
   * 3. Mandatory wins on dedupe: if ANY selected segment marks a code
   * as 'M', the merged row inherits 'M' even when another segment had
   * it as 'O'.
   *
   * Bailout (resets segmentDocs to empty) when nothing's selected, the
   * masters list hasn't loaded yet, or no chosen name resolves to a
   * master row.
   */
  useEffect(() => {
    if (!open) return;
    const names = (form.coSeg ?? []).filter(Boolean);
    if (names.length === 0) { setSegmentDocs(EMPTY_SEG_DOCS); return; }
    const segRows = names
      .map(n => masters.segments.find(s => s.name === n))
      .filter((r): r is { id:number; name:string } => !!r);
    if (segRows.length === 0) { setSegmentDocs(EMPTY_SEG_DOCS); return; }

    let cancelled = false;
    Promise.all([
      Promise.all(
        segRows.map(s =>
          api.get(`/clm/segment-rules/for-segment/${s.id}`)
            .then(r => r.data?.data ?? {})
            .catch(() => ({}))
        )
      ),
      /* Party filter for the customer form: only trade docs whose
       * `party` CSV mentions "Buyer" reach Stage 3. The endpoint scopes
       * to the current client. We intersect against the segment-rule td
       * set below so the union of (segments × party=Buyer) renders. */
      api.get('/clm/trade-doc-library/for-party/buyer')
        .then(r => Array.isArray(r.data?.data) ? r.data.data : [])
        .catch(() => [] as Array<{ code: string }>),
    ]).then(([results, partyDocs]) => {
      if (cancelled) return;
      /* Per-category merge + dedupe. Key = code; Mandatory > Optional
       * so a doc that's mandatory in any rule stays mandatory in the
       * union. Order is "first-seen wins" otherwise so the Stage 2
       * table doesn't reshuffle every render. */
      const mergeCat = (cat: 'kyc'|'dd'|'tl'|'td'|'qc') => {
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
      const merged: SegmentDocs = {
        kyc: mergeCat('kyc'),
        dd:  mergeCat('dd'),
        tl:  mergeCat('tl'),
        td:  mergeCat('td'),
        qc:  mergeCat('qc'),
      };
      setSegmentDocs(merged);
      /* Pre-populate Stage 3 Trade Documents from the merged td
       * intersected with the party=Buyer library. Mandatory rows arrive
       * pre-checked. The legacy two-row placeholder only kicks in when
       * the merged set is empty (preserved for backward compatibility). */
      const partyById = new Map<string, number>(
        (partyDocs as Array<{ code: string; id: number }>).map(p => [p.code, p.id]),
      );
      const buyerTd = merged.td.filter(d => partyById.has(d.code));
      if (buyerTd.length > 0) {
        setTdDocs(buyerTd.map(d => ({
          id: `td_${d.code}`,
          db_id: partyById.get(d.code) ?? null,
          name: d.name,
          selected: d.requirement === 'M',
          sent: false,
          status: 'idle' as TdSigStatus,
        })));
      }
    });

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, form.coSeg, masters.segments]);

  // Inject DM Sans/Inter once
  useEffect(() => {
    const id = 'acm-fonts';
    if (document.getElementById(id)) return;
    const link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=DM+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;700&display=swap';
    document.head.appendChild(link);
  }, []);

  // Body scroll lock
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  // ESC closes the sub-modal first, then the main modal.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (locModal.open) { setLocModal({ open:false, editing:null }); return; }
      onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, locModal.open, onClose]);

  if (!open) return null;

  const gotoStage = (s: Stage) => {
    if (s > maxStage) return;
    setStage(s);
    if (s === 1) setTab('identification');
  };

  /* ── Stage 1 validation. Runs when the user clicks Save & Next on
   *    Stage 1 (and on the final Submit on Stage 3 so a back-edit can't
   *    smuggle through a bad email/phone). Returns true when the form
   *    is clean. Error messages render inline under the corresponding
   *    field via the `errors` state. */
  const validateStage1 = (): boolean => {
    const next: Record<string, string> = {};
    if (!form.coName.trim())                            next.coName  = 'Company name is required';
    else if (form.coName.trim().length > 30)            next.coName  = 'Company name must be 30 characters or fewer';
    if (!form.coLegal.trim())                           next.coLegal = 'Legal name is required';
    if (!form.coType)                                   next.coType  = 'Select a customer type';
    if (!form.coSeg || form.coSeg.length === 0)         next.coSeg   = 'Select at least one segment';
    if (!form.coClass)                                  next.coClass = 'Select a classification';
    if (!form.coRisk)                                   next.coRisk  = 'Select a risk level';
    if (!form.addrType)                                 next.addrType = 'Select an address type';
    if (!form.addr.trim())                              next.addr     = 'Address is required';
    if (!form.country)                                  next.country  = 'Select a country';
    if (!form.state)                                    next.state    = 'Select a state';
    if (!form.city.trim())                              next.city     = 'City is required';
    if (!form.pin.trim())                               next.pin      = 'PIN / Postal code is required';
    else if (!/^\d{6}$/.test(form.pin.trim()))          next.pin      = 'PIN must be exactly 6 digits';
    if (!form.cpName.trim())                            next.cpName   = 'Contact person name is required';
    if (!form.cpDesig.trim())                           next.cpDesig  = 'Designation is required';
    if (!form.cpTel.trim())                             next.cpTel    = 'Contact number is required';
    else if (!/^\+?[0-9\s-]{7,15}$/.test(form.cpTel))   next.cpTel    = 'Phone must be 7–15 digits';
    else if (locations.some(l => (l.cpContact || '').trim() === form.cpTel.trim())) {
      next.cpTel = 'This phone number is already used by another address on this customer';
    }
    if (!form.cpEmail.trim())                           next.cpEmail  = 'Email is required';
    else if (!/^\S+@\S+\.\S+$/.test(form.cpEmail))      next.cpEmail  = 'Enter a valid email address';
    else if (locations.some(l => (l.cpEmail || '').trim().toLowerCase() === form.cpEmail.trim().toLowerCase())) {
      next.cpEmail = 'This email is already used by another address on this customer';
    }
    if (!form.cpWa)                                     next.cpWa     = 'Select WhatsApp preference';
    setErrors(next);
    if (Object.keys(next).length === 0) return true;
    // Surface the first field with an error to the user. The body
    // is scrollable so an off-screen field can be missed otherwise.
    // Also fire a toast — inline reds can be off-screen on small
    // viewports — auto-scroll surfaces the offending field. Toast
    // suppressed: the inline red error + scroll-into-view already
    // communicates the rejection without a second popup layer.
    const firstKey = Object.keys(next)[0];
    const el = document.querySelector<HTMLElement>(`[data-field="${firstKey}"]`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return false;
  };

  /* Build the POST/PUT payload from the form + locations. Mirrors the
   * shape declared in CustomerController::validatePayload(). */
  /* Normalize the pin code so the backend's strict `regex:/^\d{6}$/`
   * rule doesn't trip on legacy / partial values. Anything that isn't
   * exactly 6 digits arrives as null — the `nullable` rule then lets
   * it through, and the user fixes it on the next edit. */
  const cleanPin = (v: any): string | null => {
    const s = String(v ?? '').trim();
    return /^\d{6}$/.test(s) ? s : null;
  };
  const buildPayload = () => ({
    company_name:   form.coName,
    legal_name:     form.coLegal,
    type:           form.coType,
    /* Multi-segment is stored as a comma-joined string for now — the
     * legacy `customers.segment` column is scalar (string). Order is
     * preserved so the first entry stays the "primary" segment for
     * existing list-row callers that only read the first label. */
    segment:        (form.coSeg ?? []).join(', '),
    classification: form.coClass,
    risk_level:     form.coRisk,
    website:        form.coWeb,
    status:         'Active' as const,
    primary_address: {
      type:           form.addrType,
      address_line:   form.addr,
      country:        form.country,
      state:          form.state,
      city:           form.city,
      pin:            cleanPin(form.pin),
      cp_name:        form.cpName,
      cp_designation: form.cpDesig,
      cp_contact:     form.cpTel,
      cp_email:       form.cpEmail,
      cp_whatsapp:    form.cpWa,
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
  });

  const submitCustomer = async () => {
    // Synchronous re-entry lock — saving state is async so two
    // rapid clicks could both slip past the check. The ref blocks
    // any second call on the same tick.
    if (inFlightRef.current || saving) return;
    inFlightRef.current = true;
    setSaving(true);
    try {
      const payload = buildPayload();
      // Prefer customer.db_id (edit mode) BUT fall back to savedDbId
      // (the id persistStage1 just created in this session). Without
      // that fallback, the final Submit click after a Stage 1→2 auto-
      // save would POST a *second* row for the same customer — silent
      // duplicate. Mirrors persistStage1's idempotent check.
      const persistedDbId = (isEdit && customer?.db_id) || savedDbId;
      if (persistedDbId) {
        await api.put(`/customers/${persistedDbId}`, payload);
      } else {
        const r = await api.post('/customers', payload);
        const newId = r.data?.data?.db_id ?? null;
        if (newId) setSavedDbId(newId);
      }
      // Final submit succeeded → drop the remembered stage so a future
      // re-open of this customer starts fresh on Stage 1 instead of
      // bouncing back to Stage 3 (which is where this submit fired from).
      if (persistedDbId) stageMemory.delete(persistedDbId);
      onSaved?.();
      onClose();
    } catch (err: any) {
      // Surface Laravel validation errors back to the matching field.
      // Backend sends 422 { errors: { 'primary_address.cp_email': [...] } }.
      const apiErrors = err?.response?.data?.errors ?? null;
      if (apiErrors && typeof apiErrors === 'object') {
        const next: Record<string, string> = {};
        for (const [key, msgs] of Object.entries(apiErrors)) {
          const msg = Array.isArray(msgs) ? String((msgs as any[])[0]) : String(msgs);
          // Map server-side nested keys back to Stage 1 form keys
          // (primary_address.cp_email → cpEmail) so the inline error
          // lands on the right input.
          const map: Record<string, string> = {
            'company_name': 'coName', 'legal_name': 'coLegal',
            'type': 'coType', 'segment': 'coSeg',
            'classification': 'coClass', 'risk_level': 'coRisk',
            'primary_address.type': 'addrType', 'primary_address.address_line': 'addr',
            'primary_address.country': 'country', 'primary_address.state': 'state',
            'primary_address.city': 'city', 'primary_address.pin': 'pin',
            'primary_address.cp_name': 'cpName', 'primary_address.cp_designation': 'cpDesig',
            'primary_address.cp_contact': 'cpTel', 'primary_address.cp_email': 'cpEmail',
            'primary_address.cp_whatsapp': 'cpWa',
          };
          next[map[key] ?? key] = msg;
        }
        setErrors(next);
        setStage(1);
        const firstKey = Object.keys(next)[0];
        const el = document.querySelector<HTMLElement>(`[data-field="${firstKey}"]`);
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        // Toast suppressed — inline red errors + scroll already
        // communicate the rejection.
      } else {
        toast.error('Save failed', err?.response?.data?.message ?? 'Please try again.');
      }
    } finally {
      setSaving(false);
      inFlightRef.current = false;
    }
  };

  /* Auto-save Stage 1 when transitioning from the Address & Contact
   * sub-tab to Stage 2. Without this, Stage 2 KYC upload calls have
   * no `/customers/{id}/documents` target — the user would have to
   * Save Customer (Stage 3), close the modal, find the row in the
   * list, and re-open as edit. Same auto-save pattern is used by
   * AddConsigneeModal. */
  const persistStage1 = async (): Promise<number | null> => {
    // Synchronous re-entry lock — see inFlightRef declaration.
    // Without it, two rapid Save & Next clicks both read savedDbId
    // before the first POST's response had set it, and both end up
    // POSTing — silent duplicate.
    if (inFlightRef.current || saving) return savedDbId;
    inFlightRef.current = true;
    setSaving(true);
    try {
      const payload = buildPayload();
      // Prefer the existing customer.db_id (edit mode) over savedDbId
      // (in-session POST result). Either way, if we already have a
      // row id we PUT — never re-POST.
      const persistedDbId = (isEdit && customer?.db_id) || savedDbId;
      if (persistedDbId) {
        await api.put(`/customers/${persistedDbId}`, payload);
        return persistedDbId;
      }
      const r = await api.post('/customers', payload);
      const newId = r.data?.data?.db_id ?? null;
      if (newId) setSavedDbId(newId);
      return newId;
    } catch (err: any) {
      // Replay the same 422 → inline-error mapping that submitCustomer uses.
      const apiErrors = err?.response?.data?.errors ?? null;
      if (apiErrors && typeof apiErrors === 'object') {
        const next: Record<string, string> = {};
        const map: Record<string, string> = {
          'company_name': 'coName', 'legal_name': 'coLegal',
          'type': 'coType', 'segment': 'coSeg',
          'classification': 'coClass', 'risk_level': 'coRisk',
          'primary_address.type': 'addrType', 'primary_address.address_line': 'addr',
          'primary_address.country': 'country', 'primary_address.state': 'state',
          'primary_address.city': 'city', 'primary_address.pin': 'pin',
          'primary_address.cp_name': 'cpName', 'primary_address.cp_designation': 'cpDesig',
          'primary_address.cp_contact': 'cpTel', 'primary_address.cp_email': 'cpEmail',
          'primary_address.cp_whatsapp': 'cpWa',
        };
        for (const [key, msgs] of Object.entries(apiErrors)) {
          const msg = Array.isArray(msgs) ? String((msgs as any[])[0]) : String(msgs);
          next[map[key] ?? key] = msg;
        }
        setErrors(next);
        setStage(1);
        setTab('identification');
        const firstKey = Object.keys(next)[0];
        document.querySelector<HTMLElement>(`[data-field="${firstKey}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        // Toast suppressed — inline red errors + scroll handle this.
      } else {
        toast.error('Save failed', err?.response?.data?.message ?? 'Please try again.');
      }
      return null;
    } finally {
      setSaving(false);
      inFlightRef.current = false;
    }
  };

  const goNext = async () => {
    if (stage === 1) {
      /* Always validate Stage 1 before leaving it, no matter which
       * sub-tab is active. Previously the gate only fired from the
       * Identification tab — a user could click straight to the
       * Address & Contact tab, hit Save & Next, and slip past with an
       * empty form. Snapping back to Identification on failure
       * surfaces every red field at once. */
      if (!validateStage1()) {
        setTab('identification');
        return;
      }
      if (tab === 'identification') {
        setTab('address-contact');
        return;
      }
      // Leaving Stage 1 entirely → persist so Stage 2 KYC has a target.
      const id = await persistStage1();
      if (!id) return;
      setStage(2); setMaxStage(m => Math.max(m, 2) as Stage);
      // onSaved intentionally NOT fired here — Stage 1 → 2 is an
      // intermediate auto-save, not the user's explicit "I'm done"
      // action. Calling it triggered the parent's "Customer updated"
      // toast twice (once here, once again after final Stage 3 save).
      // The parent refreshes its list when the modal actually closes.
    } else if (stage === 2) {
      /* Stage 2 advance: no validation gate. Stage 2 is now a
       * segment-rule-driven reference view — the manual Add flow that
       * the old DD/Owner KYC gate enforced has been removed, so the
       * user can move to Stage 3 without uploading anything. */
      setStage(3); setMaxStage(m => Math.max(m, 3) as Stage);
    } else {
      if (!validateStage1()) { setStage(1); setTab('identification'); return; }
      submitCustomer();
    }
  };
  const goPrev = () => {
    if (stage === 1) {
      if (tab === 'address-contact') setTab('identification');
    } else if (stage === 2) { setStage(1); setTab('address-contact'); }
    else { setStage(2); }
  };

  const atStart = stage === 1 && tab === 'identification';
  const nextLabel = stage === 3
    ? (isEdit ? 'Update Customer' : 'Submit Customer')
    : 'Save & Next';

  /* Stage 2/3 advance: no gates. The form moves freely between stages
   * 1 → 2 → 3 — only Stage 1's required fields are enforced. */
  const stage2Missing = '';
  const nextLocked = false;

  return (
    /* No backdrop-click-to-close — users were losing partially filled
       forms by misclicking the overlay. Close only via the X / Cancel
       button or the ESC key. */
    <div className="acm-root">
      <style>{SCOPED_CSS}</style>
      <div className="acm-card">

        {/* HEADER */}
        <div className="acm-header">
          <div className="acm-header-left">
            <div className="acm-header-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2">
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
            </div>
            <div>
              <div className="acm-title">{isEdit ? `Edit Customer — ${customer!.id}` : 'Add Customer'}</div>
              <div className="acm-subtitle">{isEdit ? 'Update customer details, KYC, and trade documents.' : 'Capture, verify, and onboard customers with complete compliance and product readiness.'}</div>
            </div>
          </div>
          {hydrating && (
            <div className="acm-loading-pill" aria-live="polite">
              <span className="acm-loading-spinner" aria-hidden>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                  <path d="M12 2a10 10 0 0 1 10 10" />
                </svg>
              </span>
              Loading customer details…
            </div>
          )}
          <button type="button" className="acm-close" onClick={onClose} aria-label="Close">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        {/* Indeterminate top progress bar — gives the user immediate
            "actively loading" feedback while the parallel /customers,
            /documents, /owners and /segment-uploads fetches resolve. The
            shimmer skeletons below fill in the visual scaffold; this bar
            is the kinetic cue that they're not stuck. */}
        {hydrating && <div className="acm-top-progress" role="progressbar" aria-label="Loading"><span /></div>}

        {/* STEPPER — swap to skeleton during edit-mode hydration so
            the whole top of the modal reads as "loading" instead of
            showing a partially-active stepper above an empty body. */}
        {hydrating
          ? <StepperShimmer />
          : <Stepper stage={stage} maxStage={maxStage} onGoto={gotoStage} />}

        {/* HISTORY PANEL */}
        {stage > 1 && (
          <div className={`acm-history ${historyOpen ? 'acm-hist-open' : ''}`}>
            <div className="acm-history-header" onClick={() => setHistoryOpen(o => !o)}>
              <div className="acm-history-header-left">
                <div className="acm-history-icon">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                    <polyline points="12 8 12 12 14 14"/><path d="M3.05 11a9 9 0 1 1 .5 4M3 16v-5h5"/>
                  </svg>
                </div>
                <div>
                  <div className="acm-history-title">What you did in previous stages</div>
                  <div className="acm-history-meta">{stage - 1 === 1 ? 'Stage 1 completed' : `Stages 1–${stage - 1} completed`} — review your entries below</div>
                </div>
              </div>
              <div className="acm-history-actions">
                <span className="acm-history-badge">{stage - 1} stage{stage - 1 === 1 ? '' : 's'} completed</span>
                <div className={`acm-history-chevron ${historyOpen ? 'acm-open' : ''}`}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="6 9 12 15 18 9"/></svg>
                </div>
              </div>
            </div>
            <div className="acm-history-body">
              <HistoryStage1 form={form} locations={locations} customerId={customer?.id} />
              {stage >= 3 && (
                <HistoryStage2
                  ddCount={kycDocs.filter(d => d.kind === 'dd').length}
                  ownerCount={kycOwners.length}
                  tlCount={kycDocs.filter(d => d.kind === 'tl').length}
                />
              )}
            </div>
          </div>
        )}

        {/* STAGE 1 TABS — swap to shimmer pills during edit-mode
            hydration so the tab row matches the loading state of the
            stepper above and the body below. */}
        {stage === 1 && hydrating && (
          <div className="acm-tabs acm-tabs-shimmer">
            <Shimmer height={36} width={180} radius={999} />
            <Shimmer height={36} width={200} radius={999} />
          </div>
        )}
        {stage === 1 && !hydrating && (
          <div className="acm-tabs">
            <button type="button" className={`acm-tab ${tab === 'identification' ? 'acm-tab-on' : 'acm-tab-off'}`} onClick={() => setTab('identification')}>Customer Identification</button>
            <button type="button" className={`acm-tab ${tab === 'address-contact' ? 'acm-tab-on' : 'acm-tab-off'}`} onClick={() => setTab('address-contact')}>Address &amp; Contact Details</button>
          </div>
        )}

        {/* STAGE 3 TABS */}
        {stage === 3 && (
          <div className="acm-tabs">
            <button type="button" className={`acm-tab ${evTab === 'kyc-documents' ? 'acm-tab-on' : 'acm-tab-off'}`} onClick={() => setEvTab('kyc-documents')}>KYC Documents</button>
            <button type="button" className={`acm-tab ${evTab === 'trade-documents' ? 'acm-tab-on' : 'acm-tab-off'}`} onClick={() => setEvTab('trade-documents')}>Trade Documents</button>
          </div>
        )}

        {/* BODY */}
        <div className="acm-body">
          {/* Edit-mode hydration UX — show a full-form shimmer while
              /customers/:id is in flight so the user sees structured
              skeleton blocks (matching the actual section layout)
              instead of a half-empty form. When the GET resolves the
              shimmer swaps to the populated form in one frame. This
              feels faster than the previous "form with thin progress
              strip" because there's no jarring mid-load repaint as
              additional fields populate. */}
          {stage === 1 && hydrating && <Stage1FormShimmer />}
          {stage === 1 && !hydrating && tab === 'identification' && (
            <Stage1Identification form={form} setF={setF} masters={masters} errors={errors} clearErr={(k) => setErrors(e => { if (!e[k]) return e; const n = { ...e }; delete n[k]; return n; })} />
          )}
          {stage === 1 && !hydrating && tab === 'address-contact' && (
            <Stage1AdditionalLocations
              primary={{
                type:          form.addrType,
                line:          form.addr,
                country:       form.country,
                state:         form.state,
                city:          form.city,
                pin:           form.pin,
                cpName:        form.cpName,
                cpDesignation: form.cpDesig,
                cpContact:     form.cpTel,
                cpEmail:       form.cpEmail,
                cpWhatsapp:    form.cpWa,
              }}
              locations={locations}
              onAdd={() => setLocModal({ open:true, editing:null })}
              onEdit={(id) => setLocModal({ open:true, editing:id })}
              onDel={(id) => setDelModal({ open:true, id })}
              onEditPrimary={() => setTab('identification')}
            />
          )}
          {stage === 2 && hydrating && <Stage2Shimmer />}
          {stage === 2 && !hydrating && (
            <Stage2KYC
              sub={kycSub} setSub={(s) => { setKycSub(s); setKycSearch(''); }}
              page={kycPage} setPage={(s, p) => setKycPage(prev => ({ ...prev, [s]: p }))}
              search={kycSearch} setSearch={setKycSearch}
              onAdd={(s) => { setEditDocId(null); setEditOwnerId(null); setDocModal({ open: true, sub: s }); }}
              docs={kycDocs}
              owners={kycOwners}
              segmentName={(form.coSeg ?? []).join(', ')}
              segmentDocs={segmentDocs}
              segmentRefUploads={segmentRefUploads}
              setSegmentRefUploads={setSegmentRefUploads}
              persistSegmentRefUpload={persistSegmentRefUpload}
              customerSaved={!!savedDbId}
              onEditDoc={(id) => {
                const row = kycDocs.find(d => d.id === id);
                if (!row) return;
                setEditDocId(id);
                setDocModal({ open: true, sub: row.kind === 'dd' ? 'company-dd' : 'trade-licence' });
              }}
              onDeleteDoc={(id) => {
                const row = kycDocs.find(d => d.id === id);
                setKycDelModal({ open: true, kind: 'doc', id, label: row?.name });
              }}
              onEditOwner={(id) => {
                setEditOwnerId(id);
                setDocModal({ open: true, sub: 'owner-kyc' });
              }}
              onDeleteOwner={(id) => {
                const row = kycOwners.find(o => o.id === id);
                setKycDelModal({ open: true, kind: 'owner', id, label: row?.owner_name });
              }}
            />
          )}
          {stage === 3 && hydrating && <Stage3Shimmer />}
          {stage === 3 && !hydrating && evTab === 'kyc-documents' && (
            <Stage3KycDocs sub={evSub} setSub={setEvSub} segmentDocs={segmentDocs} segmentRefUploads={segmentRefUploads} />
          )}
          {stage === 3 && !hydrating && evTab === 'trade-documents' && (
            <Stage3TradeDocs
              docs={tdDocs.map(d => ({ ...d, cooldownActive: isReminderCooldown(d.signature_request_id) }))}
              onToggle={(id) => setTdDocs(prev => prev.map(d => d.id === id ? { ...d, selected: !d.selected } : d))}
              onToggleAll={(checked) => setTdDocs(prev => prev.map(d => ({ ...d, selected: checked })))}
              onSend={(id) => {
                const row = tdDocs.find(d => d.id === id);
                if (!row?.db_id) {
                  toast.info('Not a library document', 'This row is a placeholder. Pick a segment with mapped trade documents to enable signature sending.');
                  return;
                }
                if (!(customer?.db_id || savedDbId)) {
                  toast.info('Save customer first', 'Save the customer before sending documents for signature.');
                  return;
                }
                /* Resend semantics — when the doc is already sitting in
                 * Zoho `inprogress`, the user clicking "Resend" wants to
                 * NUDGE the existing signer, not re-pick recipients +
                 * re-position the signature. Hit the remind endpoint
                 * directly (same flow New_IDIMS_6.0 uses) and toast.
                 * For declined / recalled / expired / never-sent rows
                 * fall through to the wizard so the user can re-cast a
                 * fresh request.
                 *
                 * Bundle handling — Zoho's remind API operates per-
                 * REQUEST; a 3-doc bundle gets ONE email when any of
                 * its rows is reminded. We seed a 60s cooldown on the
                 * signature_request_id so accidentally clicking
                 * Resend on the other two rows in the bundle doesn't
                 * fire three reminder emails. */
                const reqId = row.signature_request_id;
                if (row.sent && reqId && row.status === 'inprogress') {
                  if (isReminderCooldown(reqId)) {
                    toast.info('Already reminded', `One reminder covers every document in this bundle. Try again in ${reminderCooldownSeconds(reqId)}s.`);
                    return;
                  }
                  const bundleCount = tdDocs.filter(d => d.signature_request_id === reqId).length;
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
              }}
              onSendSelected={() => {
                const ids = tdDocs.filter(d => d.selected && d.db_id).map(d => d.db_id!);
                if (ids.length === 0) {
                  toast.info('Nothing selected', 'Tick one or more documents under "Send for Signature" first.');
                  return;
                }
                if (!(customer?.db_id || savedDbId)) {
                  toast.info('Save customer first', 'Save the customer before sending documents for signature.');
                  return;
                }
                setSendForSignature(ids.slice(0, 10));
              }}
            />
          )}
        </div>

        {/* FOOTER */}
        <div className="acm-footer">
          <div className="acm-req-note">           
         
          </div>
          <div className="acm-footer-actions">
            {!atStart && (
              <button type="button" className="acm-btn-prev" onClick={goPrev}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6"/></svg>
                Previous
              </button>
            )}
            <Tooltip label={nextLocked ? stage2Missing : ''} disabled={!nextLocked}>
              <button
                type="button"
                className="acm-btn-next"
                onClick={goNext}
                disabled={saving || nextLocked}
                style={
                  saving      ? { opacity:.7, cursor:'wait' } :
                  nextLocked  ? { opacity:.55, cursor:'not-allowed' } :
                  undefined
                }
              >
                {saving ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="acm-cust-spin">
                    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                  </svg>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v13a2 2 0 0 1-2 2z" />
                    <polyline points="17 21 17 13 7 13 7 21" />
                    <polyline points="7 3 7 8 15 8" />
                  </svg>
                )}
                <span>{saving ? 'Saving…' : nextLabel}</span>
              </button>
            </Tooltip>
          </div>
        </div>

      </div>

      {/* SUB-MODAL: Add/edit a single Location (address + contact).
          `disallowedTypes` blocks "Registered Office" when the primary
          address is already the registered office — a customer can
          have only one. */}
      {locModal.open && (() => {
        /* Collect every email + phone already used on this customer —
         * primary contact (Stage 1) plus every additional location
         * the user has already added — minus the row currently being
         * edited (if any). The sub-modal blocks save when the user
         * tries to enter a value that's already in this set, so the
         * "same number across two addresses" trap is caught client-
         * side before the API conflict. */
        const editingId = locModal.editing;
        const otherLocs = editingId
          ? locations.filter(l => l.id !== editingId)
          : locations;
        const primaryEmail = (form.cpEmail || '').trim().toLowerCase();
        const primaryPhone = (form.cpTel   || '').trim();
        const existingEmails = [
          primaryEmail,
          ...otherLocs.map(l => (l.cpEmail || '').trim().toLowerCase()),
        ].filter(Boolean);
        const existingPhones = [
          primaryPhone,
          ...otherLocs.map(l => (l.cpContact || '').trim()),
        ].filter(Boolean);
        return (
          <LocationSubModal
            editing={editingId ? locations.find(l => l.id === editingId) ?? null : null}
            masters={masters}
            disallowedTypes={form.addrType === 'Registered Office' ? ['Registered Office'] : []}
            existingEmails={existingEmails}
            existingPhones={existingPhones}
            onClose={() => setLocModal({ open:false, editing:null })}
            onSave={(rec) => {
              if (editingId) setLocations(prev => prev.map(l => l.id === editingId ? { ...rec, id: l.id } : l));
              else setLocations(prev => [...prev, { ...rec, id: newId('loc') }]);
              setLocModal({ open:false, editing:null });
            }}
          />
        );
      })()}

      {/* CONFIRM DELETE — project-wide DeleteConfirmModal. The label
          shown to the user is the address type of the row being
          deleted so it reads e.g. "Delete Warehouse?" not just "Delete". */}
      <DeleteConfirmModal
        open={delModal.open}
        title="Delete Address & Contact"
        itemName={delModal.id ? (locations.find(l => l.id === delModal.id)?.type || 'this location') : undefined}
        subMessage="This will remove the address and its contact person from this customer. The action cannot be undone."
        onClose={() => setDelModal({ open:false, id:null })}
        onConfirm={() => {
          if (delModal.id) setLocations(prev => prev.filter(l => l.id !== delModal.id));
          setDelModal({ open:false, id:null });
        }}
      />

      {/* Stage 2 delete confirm — covers both doc and owner rows. The
          `kind` tells us which endpoint to hit. On success the row is
          dropped from local state so the table updates instantly. */}
      <DeleteConfirmModal
        open={kycDelModal.open}
        title={kycDelModal.kind === 'doc' ? 'Delete Document' : 'Delete Owner'}
        itemName={kycDelModal.label || (kycDelModal.kind === 'doc' ? 'this document' : 'this owner')}
        subMessage={kycDelModal.kind === 'doc'
          ? 'This will permanently delete the document and its uploaded attachment.'
          : 'This will permanently delete the owner record and all uploaded identity proofs.'}
        onClose={() => { if (!kycDeleting) setKycDelModal({ open: false, kind: kycDelModal.kind, id: null }); }}
        loading={kycDeleting}
        onConfirm={async () => {
          const id = kycDelModal.id;
          const kind = kycDelModal.kind;
          if (!id || !customer?.db_id) { setKycDelModal({ open: false, kind, id: null }); return; }
          setKycDeleting(true);
          try {
            if (kind === 'doc') {
              await api.delete(`/customers/${customer.db_id}/documents/${id}`);
              setKycDocs(prev => prev.filter(d => d.id !== id));
            } else {
              await api.delete(`/customers/${customer.db_id}/owners/${id}`);
              setKycOwners(prev => prev.filter(o => o.id !== id));
            }
          } catch (err: any) {
            toast.error('Delete failed', err?.response?.data?.message ?? 'Please try again.');
          } finally {
            setKycDelModal({ open: false, kind, id: null });
            setKycDeleting(false);
          }
        }}
      />

      {/* SUB-MODAL (Stage 2) — Owner KYC has its own dedicated "Add
          Owner Due Diligence" form (Owner Name + Designation + Email +
          Phone + 3 file uploads). The other two sub-tabs use the
          generic Document / License form. */}
      {docModal.open && docModal.sub === 'owner-kyc' && (
        <OwnerDDSubModal
          masters={masters}
          customerId={savedDbId}
          editing={editOwnerId ? kycOwners.find(o => o.id === editOwnerId) ?? null : null}
          onClose={() => { setEditOwnerId(null); setDocModal(m => ({ ...m, open: false })); }}
          onSaved={(row) => {
            setKycOwners(prev => editOwnerId
              ? prev.map(o => o.id === editOwnerId ? row : o)
              : [row, ...prev]);
            setEditOwnerId(null);
            setDocModal(m => ({ ...m, open: false }));
          }}
        />
      )}
      {docModal.open && docModal.sub !== 'owner-kyc' && (
        <DocumentSubModal
          sub={docModal.sub}
          masters={masters}
          customerId={savedDbId}
          editing={editDocId ? kycDocs.find(d => d.id === editDocId) ?? null : null}
          /* When a new Document Type is added via the popup-on-popup,
             append it to masters.documentTypes so the dropdown picks
             it up immediately (no need to re-open the modal). */
          onDocTypeAdded={(opt) => setMasters(m => ({ ...m, documentTypes: [...m.documentTypes, opt] }))}
          onClose={() => { setEditDocId(null); setDocModal(m => ({ ...m, open: false })); }}
          onSaved={(row) => {
            // On create → prepend the new row. On update → replace it
            // in place so the table reflects the change without
            // re-fetching the whole list.
            setKycDocs(prev => editDocId
              ? prev.map(d => d.id === editDocId ? row : d)
              : [row, ...prev]);
            setEditDocId(null);
            setDocModal(m => ({ ...m, open: false }));
          }}
        />
      )}

      {/* Stage 3 Trade Documents → Send for Signature.
          Opens the Zoho Sign wizard pre-checked with whichever
          documents the user picked (single id from a row's "Send"
          button, or the multi-id list from the footer button).
          The wizard's onSent flips those rows' `sent` flags so
          they show "Resend" thereafter. */}
      <SalesCustomerSendForSignatureModal
        open={Array.isArray(sendForSignature)}
        customer={(() => {
          // The Zoho send modal needs the saved DB id. In edit mode it
          // comes from the `customer` prop; in create mode it shows up
          // after the Stage 1 → 2 auto-save POST. The Stage 3 handlers
          // already block when this id is missing, so this null-return
          // is defensive only.
          const partyId = (customer?.db_id ?? savedDbId) ?? null;
          if (!partyId) return null;
          return {
            id:      customer?.id ?? `c-${partyId}`,
            db_id:   partyId,
            company: form.coName || customer?.company || '',
            contact: form.cpName || customer?.contact || '',
            email:   form.cpEmail || customer?.email || '',
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
    </div>
  );
}

/* ───── Stepper ───── */
function Stepper({ stage, maxStage, onGoto }: { stage: Stage; maxStage: Stage; onGoto: (s: Stage) => void }) {
  const steps = [
    { n:1 as Stage, title:'Customer Legal Identity', sub:'Company, GST, PAN & contact',
      icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg> },
    { n:2 as Stage, title:'KYC / Due Diligence', sub:'Docs, identity & compliance',
      icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/></svg> },
    { n:3 as Stage, title:'Evidence Vault', sub:'Trade documents & archive',
      icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="3" width="20" height="5" rx="1.5"/><path d="M4 8v12a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V8"/><line x1="10" y1="13" x2="14" y2="13"/><line x1="10" y1="17" x2="14" y2="17"/></svg> },
  ];
  const CHECK_BADGE = <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>;
  const CHECK_NUM = <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5"><polyline points="20 6 9 17 4 12"/></svg>;

  return (
    <div className="acm-stepper">
      {steps.map((s, i) => {
        /* Reachability is driven by `maxStage` so a user who reached
         * Stage 2 (or 3) and then navigated back to Stage 1 still sees
         * the later stage as visited+clickable, not as a locked
         * pending step. Three visual states:
         *   active     — current stage (purple)
         *   done       — visited (s.n <= maxStage) but not current (green ✓)
         *   pending    — not yet reached (s.n > maxStage, locked) */
        const visited = s.n <= maxStage;
        const cls = s.n === stage ? 'acm-step-active' : visited ? 'acm-step-done' : 'acm-step-pending';
        const showCheck = visited && s.n !== stage;
        return (
          <Fragment key={s.n}>
            <div className={`acm-step ${cls}`} onClick={() => onGoto(s.n)}>
              <div className="acm-step-badge-wrap">
                <div className="acm-step-badge">{showCheck ? CHECK_BADGE : s.icon}</div>
                <div className="acm-step-num">{showCheck ? CHECK_NUM : s.n}</div>
              </div>
              <div className="acm-step-text">
                <div className="acm-step-title">{s.title}</div>
                <div className="acm-step-sub">{s.sub}</div>
              </div>
            </div>
            {i < steps.length - 1 && (
              /* Connector lights up if the next step has been reached
               * (regardless of current position), so going back to
               * Stage 1 doesn't visually undo the 1↔2 connection. */
              <div className="acm-step-connector"><div className="acm-connector-line" data-done={s.n < maxStage ? '1' : '0'} /></div>
            )}
          </Fragment>
        );
      })}
    </div>
  );
}

/* ───── Stepper shimmer ─────
 * Skeleton variant rendered while the edit-mode hydration GET is in
 * flight. Mirrors the 3-stage layout (icon + 2 text rows + connector)
 * so the swap to the real Stepper once data lands is structurally
 * identical — no layout shift. */
function StepperShimmer() {
  return (
    <div className="acm-stepper acm-stepper-shimmer">
      {[0, 1, 2].map((i) => (
        <Fragment key={i}>
          <div className="acm-step acm-step-pending" style={{ pointerEvents: 'none' }}>
            <div className="acm-step-badge-wrap">
              <Shimmer width={40} height={40} radius={10} />
            </div>
            <div className="acm-step-text" style={{ flex: 1 }}>
              <Shimmer height={11} width="70%" radius={4} style={{ marginBottom: 6 }} />
              <Shimmer height={9}  width="55%" radius={4} />
            </div>
          </div>
          {i < 2 && (
            <div className="acm-step-connector">
              <Shimmer height={2} width="100%" radius={2} />
            </div>
          )}
        </Fragment>
      ))}
    </div>
  );
}

/* ───── Stage 1 form skeleton ─────
 * Rendered while the edit-mode hydration fetch is in flight so the
 * user sees the section + field shape immediately instead of empty
 * inputs flickering into populated state. Layout mirrors the actual
 * Stage 1 form (Basic Company Details + Primary Address & Contact). */
function Stage1FormShimmer() {
  const FieldShim = () => (
    <div className="acm-field">
      <Shimmer height={10} width="40%" radius={4} style={{ marginBottom: 7 }} />
      <Shimmer height={36} radius={9} />
    </div>
  );
  const Section = ({ rows }: { rows: { cols: number }[] }) => (
    <div className="acm-section acm-section-purple" style={{ marginBottom: 16 }}>
      <div className="acm-section-head">
        <Shimmer width={28} height={28} radius={8} />
        <div style={{ flex: 1, marginLeft: 10 }}>
          <Shimmer height={11} width="35%" radius={4} />
        </div>
      </div>
      <div className="acm-section-body">
        {rows.map((r, i) => (
          <div key={i} className={`acm-row acm-row-${r.cols}`} style={{ marginBottom: i < rows.length - 1 ? 14 : 0 }}>
            {Array.from({ length: r.cols }).map((_, j) => <FieldShim key={j} />)}
          </div>
        ))}
      </div>
    </div>
  );
  return (
    <div>
      <Section rows={[{ cols: 3 }, { cols: 4 }]} />
      <Section rows={[{ cols: 2 }, { cols: 4 }, { cols: 4 }, { cols: 1 }]} />
    </div>
  );
}

/* ───── Stage 2 KYC shimmer — mimics the sub-tabs + toolbar + table
 * header strip so the swap to the real Stage2KYC after hydration is
 * structurally identical (no layout shift). */
function Stage2Shimmer() {
  return (
    <div>
      {/* Sub-tab row (Company DD / Owner KYC / Trade Licence) */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        <Shimmer height={34} width={150} radius={999} />
        <Shimmer height={34} width={120} radius={999} />
        <Shimmer height={34} width={140} radius={999} />
      </div>
      {/* Toolbar (search + add) */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <Shimmer height={36} width="60%" radius={8} />
        <Shimmer height={36} width={170} radius={8} />
      </div>
      {/* Table header strip + 3 body rows */}
      <div style={{ border: '1px solid var(--vz-border-color)', borderRadius: 10, overflow: 'hidden' }}>
        <div style={{ padding: '12px 14px', background: 'rgba(124,58,237,0.04)' }}>
          <Shimmer height={11} width="40%" radius={4} />
        </div>
        {[0, 1, 2].map((i) => (
          <div key={i} style={{ display: 'flex', gap: 14, padding: '14px', borderTop: '1px solid var(--vz-border-color)' }}>
            <Shimmer height={14} width={28} radius={4} />
            <Shimmer height={14} width="22%" radius={4} />
            <Shimmer height={14} width="18%" radius={4} />
            <Shimmer height={14} width="18%" radius={4} />
            <Shimmer height={14} width="14%" radius={4} />
            <Shimmer height={14} width={70} radius={4} />
          </div>
        ))}
      </div>
    </div>
  );
}

/* ───── Stage 3 Evidence Vault shimmer ─────
 * Mirrors the document-grid layout users land on for the final stage,
 * so the populated view appears in the same footprint. */
function Stage3Shimmer() {
  return (
    <div>
      {/* Sub-tab row (DD / TL / Owner KYC) */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        <Shimmer height={34} width={140} radius={999} />
        <Shimmer height={34} width={120} radius={999} />
        <Shimmer height={34} width={150} radius={999} />
      </div>
      {/* 2-col card grid of doc previews */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} style={{ padding: 14, border: '1px solid var(--vz-border-color)', borderRadius: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <Shimmer width={36} height={36} radius={8} />
              <div style={{ flex: 1 }}>
                <Shimmer height={11} width="60%" radius={4} style={{ marginBottom: 6 }} />
                <Shimmer height={9} width="40%" radius={4} />
              </div>
            </div>
            <Shimmer height={56} width="100%" radius={8} />
          </div>
        ))}
      </div>
    </div>
  );
}

/* ───── Stage 1 — Identification + Primary Address & Contact ───── */
function Stage1Identification({ form, setF, masters, errors, clearErr }:
  { form: any; setF: (k: any, v: any) => void; masters: MasterLists; errors: Record<string, string>; clearErr: (k: string) => void }) {
  // States filter against the selected country: look up the country
  // name → its id from the countries master, then filter states by it.
  const selectedCountry = masters.countries.find(c => c.name === form.country);
  const states = selectedCountry
    ? masters.states.filter(s => s.country_id === selectedCountry.id)
    : [];
  // Wraps `setF` so each keystroke also clears the matching error, giving
  // the user immediate feedback when they fix a bad field.
  const set = (k: string, v: any) => { setF(k as any, v); clearErr(k); };
  return (
    <div>
      <div className="acm-section acm-section-purple">
        <div className="acm-section-head">
          <div className="acm-section-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg></div>
          <div>
            <span className="acm-section-title">BASIC COMPANY DETAILS</span>
            <span className="acm-section-sub">| Company identity, segment, and risk classification</span>
          </div>
        </div>
        <div className="acm-section-body">
          <div className="acm-row acm-row-3">
            <Field label="Company Name" required error={errors.coName} fieldKey="coName"><input className={errors.coName ? 'acm-input-error' : ''} value={form.coName} maxLength={30} onChange={e => set('coName', e.target.value.slice(0, 30))} placeholder="e.g. Shree Agro Pvt Ltd (max 30)" /></Field>
            <Field label="Company Legal Name" required error={errors.coLegal} fieldKey="coLegal"><input className={errors.coLegal ? 'acm-input-error' : ''} value={form.coLegal} onChange={e => set('coLegal', e.target.value)} placeholder="Registered legal entity name" /></Field>
            <Field label="Customer Type" required error={errors.coType} fieldKey="coType">
              <MasterSelect value={form.coType} options={optsWith(masters.customerTypes, form.coType)} placeholder="Select customer type" invalid={!!errors.coType} onChange={v => set('coType', v)} />
            </Field>
          </div>
          <div className="acm-row acm-row-4">
            <Field label="Company Website"><input value={form.coWeb} onChange={e => setF('coWeb', e.target.value)} placeholder="https://example.com" /></Field>
            <Field label="Customer Segment" required error={errors.coSeg} fieldKey="coSeg">
              {/* masterFormKit's MasterMultiSelect renders visible violet
                  chips with × buttons + a checkbox-marked dropdown so
                  multi-select is obvious. `value` prop is plural despite
                  the singular name. */}
              <MasterMultiSelect
                value={form.coSeg}
                options={toSelectOpts(masters.segments)}
                placeholder="Select segment"
                invalid={!!errors.coSeg}
                onChange={vs => set('coSeg', vs)}
              />
            </Field>
            <Field label="Classification & Flags" required error={errors.coClass} fieldKey="coClass">
              <MasterSelect value={form.coClass} options={optsWith(masters.classifications, form.coClass)} placeholder="Select classification" invalid={!!errors.coClass} onChange={v => set('coClass', v)} />
            </Field>
            <Field label="Risk Level" required error={errors.coRisk} fieldKey="coRisk">
              <MasterSelect value={form.coRisk} options={optsWith(masters.riskLevels, form.coRisk)} placeholder="Select risk level" invalid={!!errors.coRisk} onChange={v => set('coRisk', v)} />
            </Field>
          </div>
        </div>
      </div>

      <div className="acm-section acm-section-purple">
        <div className="acm-section-head">
          <div className="acm-section-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg></div>
          <div>
            <span className="acm-section-title">PRIMARY ADDRESS &amp; CONTACT PERSON</span>
            <span className="acm-section-sub">| Registered office and primary contact at this location</span>
          </div>
        </div>
        <div className="acm-section-body">
          <div className="acm-row acm-row-2">
            <Field label="Address Type" required error={errors.addrType} fieldKey="addrType">
              {/* The primary address is, by definition, the registered
                 office — locked here so a user can't pick anything else
                 for the primary slot. Other types (Warehouse, Billing,
                 etc.) belong on the "Address & Contact Details" tab. */}
              <MasterSelect
                value={DEFAULT_ADDRESS_TYPE}
                options={[{ value: DEFAULT_ADDRESS_TYPE, label: DEFAULT_ADDRESS_TYPE }]}
                placeholder="Select address type"
                disabled
                onChange={() => { /* locked */ }}
              />
            </Field>
            <Field label="Address" required error={errors.addr} fieldKey="addr"><input className={errors.addr ? 'acm-input-error' : ''} value={form.addr} onChange={e => set('addr', e.target.value)} placeholder="Street, building, area" /></Field>
          </div>
          <div className="acm-row acm-row-4">
            <Field label="Country" required error={errors.country} fieldKey="country">
              <MasterSelect value={form.country} options={optsWith(masters.countries, form.country)} placeholder="Select country" invalid={!!errors.country} onChange={v => { set('country', v); setF('state', ''); }} />
            </Field>
            <Field label="State" required error={errors.state} fieldKey="state">
              <MasterSelect
                value={form.state}
                options={(() => {
                  const base = states.map(s => ({ value: s.name, label: s.name }));
                  if (form.state && !base.some(o => o.value === form.state)) return [{ value: form.state, label: form.state }, ...base];
                  return base;
                })()}
                placeholder={form.country ? 'Select state' : 'Select country first'}
                disabled={!form.country}
                invalid={!!errors.state}
                onChange={v => set('state', v)}
              />
            </Field>
            <Field label="City" required error={errors.city} fieldKey="city"><input className={errors.city ? 'acm-input-error' : ''} value={form.city} onChange={e => set('city', e.target.value)} placeholder="City name" /></Field>
            <Field label="Pin / Postal Code" required error={errors.pin} fieldKey="pin"><input className={errors.pin ? 'acm-input-error' : ''} value={form.pin} onChange={e => set('pin', e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" maxLength={6} placeholder="6-digit PIN" /></Field>
          </div>
          <div className="acm-row acm-row-4">
            <Field label="Contact Person Name" required error={errors.cpName} fieldKey="cpName"><input className={errors.cpName ? 'acm-input-error' : ''} value={form.cpName} onChange={e => set('cpName', e.target.value)} placeholder="Full name" /></Field>
            <Field label="Designation" required error={errors.cpDesig} fieldKey="cpDesig">
              <MasterSelect value={form.cpDesig} options={optsWith(masters.designations, form.cpDesig)} placeholder="Select designation" invalid={!!errors.cpDesig} onChange={v => set('cpDesig', v)} />
            </Field>
            <Field label="Contact No" required error={errors.cpTel} fieldKey="cpTel"><input className={errors.cpTel ? 'acm-input-error' : ''} type="tel" value={form.cpTel} onChange={e => set('cpTel', e.target.value)} placeholder="7–15 digit number" /></Field>
            <Field label="Email" required error={errors.cpEmail} fieldKey="cpEmail"><input className={errors.cpEmail ? 'acm-input-error' : ''} type="email" value={form.cpEmail} onChange={e => set('cpEmail', e.target.value)} placeholder="name@company.com" /></Field>
          </div>
          <div className="acm-row acm-row-1">
            <Field label="Whatsapp Enabled" required error={errors.cpWa} fieldKey="cpWa">
              <div className="acm-radio-row">
                <label className="acm-radio"><input type="radio" name="cpWa" value="yes" checked={form.cpWa === 'yes'} onChange={() => set('cpWa', 'yes')} /> YES</label>
                <label className="acm-radio"><input type="radio" name="cpWa" value="no" checked={form.cpWa === 'no'} onChange={() => set('cpWa', 'no')} /> NO</label>
              </div>
            </Field>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ───── Stage 1 — Address & Contact Details (primary + additional) ─────
 * Single table that surfaces both the primary address (captured on the
 * Customer Identification tab) and any additional locations the user
 * has added here. The primary row is read-only from this table — the
 * edit button jumps back to the Identification tab and the delete
 * button is disabled, since the primary address is mandatory for a
 * customer. */
type PrimaryRowData = {
  type: string; line: string; country: string; state: string; city: string; pin: string;
  cpName: string; cpDesignation: string; cpContact: string; cpEmail: string; cpWhatsapp: string;
};
function Stage1AdditionalLocations({ primary, locations, onAdd, onEdit, onDel, onEditPrimary }:
  { primary: PrimaryRowData;
    locations: LocationRow[];
    onAdd: () => void;
    onEdit: (id: string) => void;
    onDel: (id: string) => void;
    onEditPrimary: () => void;
  }) {
  type DisplayRow = PrimaryRowData & { id: string; isPrimary: boolean };
  const allRows: DisplayRow[] = [
    { id: '__primary__', isPrimary: true, ...primary },
    ...locations.map(l => ({ ...l, isPrimary: false })),
  ];
  return (
    <div className="acm-section acm-section-purple">
      <div className="acm-section-head">
        <div className="acm-section-head-row" style={{ width: '100%' }}>
          <div className="acm-section-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></svg></div>
          <div>
            <span className="acm-section-title">ADDRESS &amp; CONTACT DETAILS</span>
            <span className="acm-section-sub">| All addresses with their authorized contact person</span>
          </div>
          <button type="button" className="acm-add-pill" onClick={onAdd}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
            Add More Address &amp; Contact
          </button>
        </div>
      </div>
      <div className="acm-section-body acm-section-body-table">
        <div className="acm-table-wrap">
          <table className="acm-table">
            <thead>
              <tr>
                <th>Sr No</th><th>Address Type</th><th>Address</th><th>City / State / Country</th>
                <th>Contact Person</th><th>Phone</th><th>Email</th><th>WhatsApp</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {allRows.map((l, i) => {
                const place = [l.city, l.state, l.country].filter(Boolean).join(' • ');
                const contact = l.cpName + (l.cpDesignation ? ` (${l.cpDesignation})` : '');
                return (
                  <tr key={l.id} className={l.isPrimary ? 'acm-primary-row' : undefined}>
                    <td>{i + 1}</td>
                    <td>
                      <div className="acm-type-cell">
                        {/* Long custom address types (e.g. "Warehouse —
                            Mumbai Distribution Hub") get truncated to
                            14 chars with hover tooltip — keeps the
                            column narrow. */}
                        {l.type
                          ? <TruncatedCell text={l.type} max={14} />
                          : <span>—</span>}
                        {l.isPrimary && <span className="acm-primary-tag">Primary</span>}
                      </div>
                    </td>
                    {/* Tight per-column truncation — keep the table to
                        a predictable width on tablets / smaller laptop
                        screens. Long values overflow into the Tooltip
                        on hover (full text always available there). */}
                    <td><TruncatedCell text={l.line} max={16} /></td>
                    <td><TruncatedCell text={place} max={18} /></td>
                    <td><TruncatedCell text={contact} max={18} /></td>
                    <td><TruncatedCell text={l.cpContact} max={15} mono /></td>
                    <td><TruncatedCell text={l.cpEmail} max={18} /></td>
                    <td>{l.cpWhatsapp === 'yes' ? <span className="acm-pill-yes">✓ Yes</span> : l.cpWhatsapp === 'no' ? <span className="acm-pill-no">✕ No</span> : <span style={{ color: '#9ca3af' }}>—</span>}</td>
                    <td>
                      <div className="acm-row-actions">
                        <Tooltip label={l.isPrimary ? 'Edit in Customer Identification tab' : 'Edit'}>
                          <button type="button" className="acm-row-btn" aria-label="Edit" onClick={() => l.isPrimary ? onEditPrimary() : onEdit(l.id)}>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                          </button>
                        </Tooltip>
                        {l.isPrimary ? (
                          <Tooltip label="The primary address cannot be deleted">
                            <button type="button" className="acm-row-btn acm-row-btn-del" aria-label="Delete (disabled)" disabled style={{ opacity: 0.4, cursor: 'not-allowed' }}>
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /></svg>
                            </button>
                          </Tooltip>
                        ) : (
                          <Tooltip label="Delete">
                            <button type="button" className="acm-row-btn acm-row-btn-del" aria-label="Delete" onClick={() => onDel(l.id)}>
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /></svg>
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
}

/* ───── Segment-required reference banner ─────
 * Compact callout rendered above the Company DD table when the
 * selected segment's rule defines required due-diligence documents.
 * Pure-read — clicking nothing; the user still uses "+ Add Document"
 * to upload. Acts as a checklist so they know what to expect. */
function SegmentRequiredBanner({ segmentName, label, rows }: {
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

/* Stage 2 reference-row actions cell. Initial state shows a single
 * Upload button — clicking it opens the file picker. Once a file is
 * picked the cell switches to View / Download / Delete actions backed
 * by a blob URL the parent component holds onto. Delete revokes the
 * URL and drops the entry from the upload map, returning the cell to
 * its initial Upload state. */
function SegmentRefRowActions({ refKey, docName, uploads, setUploads, persistUpload }: {
  refKey: string;
  docName: string;
  uploads: Record<string, { file: File | null; url: string; name: string }>;
  setUploads: React.Dispatch<React.SetStateAction<Record<string, { file: File | null; url: string; name: string }>>>;
  persistUpload: (refKey: string, file: File, docName: string) => Promise<void> | void;
}) {
  const uploaded = uploads[refKey];
  /* Re-using `onPick` for both first-time upload and re-upload. We
   * show the blob URL immediately for instant feedback, then fire the
   * server upload — the persist callback swaps the blob URL for a
   * permanent attachment_url once the row hits segment_doc_uploads. */
  const onPick = (f: File | undefined) => {
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

  if (!uploaded) {
    return (
      <div className="acm-row-actions">
        <Tooltip label="Upload">
          <label className="acm-doc-action acm-doc-action-upload" aria-label="Upload" style={{ cursor: 'pointer' }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            <input type="file" hidden onChange={e => onPick(e.target.files?.[0])} />
          </label>
        </Tooltip>
      </div>
    );
  }
  return (
    <div className="acm-row-actions">
      <Tooltip label={`View ${uploaded.name}`}>
        <a href={uploaded.url} target="_blank" rel="noreferrer" className="acm-doc-action acm-doc-action-view" aria-label="View">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
        </a>
      </Tooltip>
      <Tooltip label={`Download ${uploaded.name}`}>
        <a href={uploaded.url} download={uploaded.name} className="acm-doc-action acm-doc-action-download" aria-label="Download">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        </a>
      </Tooltip>
      <Tooltip label="Re-upload (replace file)">
        <label className="acm-doc-action acm-doc-action-upload" aria-label="Re-upload" style={{ cursor: 'pointer' }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
          <input type="file" hidden onChange={e => onPick(e.target.files?.[0])} />
        </label>
      </Tooltip>
    </div>
  );
}

/* ───── Stage 2 — KYC sub-tabs + doc table ───── */
function Stage2KYC({ sub, setSub, page, setPage, search, setSearch, onAdd, docs, owners, segmentName, segmentDocs, segmentRefUploads, setSegmentRefUploads, persistSegmentRefUpload, customerSaved, onEditDoc, onDeleteDoc, onEditOwner, onDeleteOwner }:
  { sub: KycSubTab; setSub: (s: KycSubTab) => void;
    page: Record<KycSubTab, number>; setPage: (s: KycSubTab, p: number) => void;
    search: string; setSearch: (s: string) => void;
    onAdd: (s: KycSubTab) => void;
    /** Live KYC data fetched on edit. `docs` covers both DD + TL — filter by `kind`.  */
    docs: { id:number; kind:'dd'|'tl'; name:string; license_number?:string|null; issuing_authority?:string|null; issue_date?:string|null; expiry_date?:string|null; attachment_path?:string|null; attachment_url?:string|null; attachment_name?:string|null; status?:string }[];
    owners: { id:number; owner_name:string; designation?:string|null; official_email?:string|null; phone_number?:string|null; id_proof_path?:string|null; id_proof_url?:string|null; address_proof_path?:string|null; address_proof_url?:string|null; photograph_path?:string|null; photograph_url?:string|null; status?:string }[];
    /** Segment chosen on Stage 1 + the KYC/DD/TL master rows the
     *  segment rule references. When the segment has a configured rule
     *  these drive the Trade Licence sub-tab and the reference banner
     *  on Company DD; otherwise fall back to the legacy static lists. */
    segmentName: string;
    segmentDocs: { kyc:{ id:number; code:string; name:string; authority?:string|null; expiry?:string|null; status?:string; requirement:'M'|'O' }[]; dd:any[]; tl:any[]; td:any[]; qc:any[] };
    /** Per-row file picker state for the segment-rule reference rows.
     *  Key is `${sub}::${doc.code}`; value carries the File + a blob URL
     *  used by the View / Download actions. Lifted to the parent so it
     *  survives sub-tab switches. */
    segmentRefUploads: Record<string, { file: File | null; url: string; name: string }>;
    setSegmentRefUploads: React.Dispatch<React.SetStateAction<Record<string, { file: File | null; url: string; name: string }>>>;
    /** Fires the actual POST /segment-uploads/customer/{id} so the
     *  Evidence Vault sees the attachment. */
    persistSegmentRefUpload: (refKey: string, file: File, docName: string) => Promise<void> | void;
    /** True only when the parent customer has a db_id (i.e. has been saved). */
    customerSaved: boolean;
    onEditDoc:     (id:number) => void;
    onDeleteDoc:   (id:number) => void;
    onEditOwner:   (id:number) => void;
    onDeleteOwner: (id:number) => void;
  }) {
  const meta = KYC_TAB_META[sub];

  // Source data depends on the sub-tab:
  //   company-dd   → live docs filtered by kind='dd'; falls back to a
  //                  segment-driven reference table when no live rows
  //                  yet AND the segment rule defines DD documents.
  //   owner-kyc    → live owners; falls back to a segment-driven KYC
  //                  reference table when no owners yet AND the segment
  //                  rule defines KYC documents.
  //   trade-licence → segment-driven reference table (segmentDocs.tl)
  //                  with a static TL_DOCS fallback.
  const isOwners      = sub === 'owner-kyc';
  const isTradeLegacy = sub === 'trade-licence';
  const kind: 'dd' | 'tl' = sub === 'company-dd' ? 'dd' : 'tl';

  const q = search.toLowerCase().trim();
  const filteredDocs = useMemo(() => {
    const base = docs.filter(d => d.kind === kind);
    if (!q) return base;
    return base.filter(d =>
      (d.name || '').toLowerCase().includes(q) ||
      (d.license_number || '').toLowerCase().includes(q) ||
      (d.issuing_authority || '').toLowerCase().includes(q));
  }, [docs, kind, q]);
  const filteredOwners = useMemo(() => {
    if (!q) return owners;
    return owners.filter(o =>
      (o.owner_name || '').toLowerCase().includes(q) ||
      (o.designation || '').toLowerCase().includes(q) ||
      (o.official_email || '').toLowerCase().includes(q));
  }, [owners, q]);
  /* Segment-rule reference list per sub-tab. The DD / KYC / TL master
   * rows the active segment's rule references are surfaced here as a
   * 7-column reference table — the same table layout the Trade Licence
   * sub-tab has always used. Source per sub-tab:
   *   company-dd   → segmentDocs.dd
   *   owner-kyc    → segmentDocs.kyc
   *   trade-licence → segmentDocs.tl, falling back to static TL_DOCS
   * Each row is normalized to { code, name, authority, expiry, status }
   * so a single render path serves all three tabs. */
  const segmentRefSource = useMemo(() => {
    const norm = (rows: any[]) => rows.map(d => ({
      code:      d.code,
      name:      d.name,
      authority: d.authority ?? '—',
      expiry:    d.expiry ?? 'N/A',
      status:    d.requirement === 'M' ? 'mandatory' : 'optional',
    }));
    if (sub === 'company-dd')   return norm(segmentDocs.dd || []);
    if (sub === 'owner-kyc')    return norm(segmentDocs.kyc || []);
    if (sub === 'trade-licence') {
      const tl = segmentDocs.tl || [];
      return tl.length > 0 ? norm(tl) : TL_DOCS;
    }
    return [];
  }, [sub, segmentDocs]);
  const filteredTradeLegacy = useMemo(() => {
    if (!q) return segmentRefSource;
    return segmentRefSource.filter(d =>
      d.code.toLowerCase().includes(q) ||
      d.name.toLowerCase().includes(q) ||
      (d.authority || '').toLowerCase().includes(q));
  }, [q, segmentRefSource]);
  /* Which sub-tabs are currently rendering the 7-col reference table.
   * Always for trade-licence (matches prior behavior). For company-dd
   * and owner-kyc, only when (a) no live data yet AND (b) the segment
   * provides reference rows — once the user adds a real upload (or an
   * owner), the live tables take over. */
  const showSegmentRef = isTradeLegacy
    || (sub === 'company-dd' && filteredDocs.length === 0 && (segmentDocs.dd?.length ?? 0) > 0)
    || (sub === 'owner-kyc'  && owners.length === 0       && (segmentDocs.kyc?.length ?? 0) > 0);

  const totalRows = showSegmentRef ? filteredTradeLegacy.length
                  : isOwners       ? filteredOwners.length
                  : filteredDocs.length;

  const maxPage = Math.max(1, Math.ceil(totalRows / KYC_PER_PAGE));
  const curPage = Math.min(page[sub], maxPage);
  const start = (curPage - 1) * KYC_PER_PAGE;
  const docSlice    = filteredDocs.slice(start, start + KYC_PER_PAGE);
  const ownerSlice  = filteredOwners.slice(start, start + KYC_PER_PAGE);
  const legacySlice = filteredTradeLegacy.slice(start, start + KYC_PER_PAGE);

  // Compose an auto-code prefix that mirrors the design (DD-001 etc.).
  // Uses the row's sr position so codes stay stable per page render.
  const codeFor = (kindLetters: string, sr: number) => `${kindLetters}-${String(sr).padStart(3, '0')}`;

  return (
    <div>
      <div className="acm-subtabs-row">
        {(['company-dd','owner-kyc','trade-licence'] as KycSubTab[]).map(s => (
          <button key={s} type="button" className={`acm-subtab-pill ${sub === s ? 'is-active' : ''}`} onClick={() => setSub(s)}>
            {s === 'company-dd' ? 'Company Due Diligence' : s === 'owner-kyc' ? 'Owner KYC' : 'Trade Licence'}
          </button>
        ))}
      </div>

      <div className="acm-section acm-section-purple">
        <div className="acm-section-head">
          <div className="acm-section-head-row" style={{ width:'100%' }}>
            <div className="acm-section-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></div>
            <div>
              <span className="acm-section-title">{meta.title}</span>
              <span className="acm-section-sub">{meta.sub}</span>
            </div>
            {/* Stage 2 sub-tab headers no longer carry a "+ Add" pill —
                the section is driven entirely by the segment-rule
                reference table below. Per-row upload actions on each
                reference row are still the path to attaching real
                files in a future iteration. */}
          </div>
        </div>

        <div className="acm-doc-toolbar">
          <div className="acm-doc-search">
            <svg className="acm-doc-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input type="search" placeholder={meta.placeholder} value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <div className="acm-doc-count">{totalRows} {(!showSegmentRef && isOwners) ? `owner${totalRows === 1 ? '' : 's'}` : `document${totalRows === 1 ? '' : 's'}`}</div>
        </div>

        <div className="acm-section-body acm-section-body-table">
          <div className="acm-table-wrap">
            {showSegmentRef ? (
              /* Segment-rule reference table — shared layout for
                 Company DD, Owner KYC, and Trade Licence sub-tabs.
                 Rows come from the segment's configured rule (or the
                 static TL_DOCS fallback for Trade Licence when no rule
                 exists). Upload + download icons stay design-only for
                 now; the "+ Add" pill above still launches the wired
                 add flow. */
              <table className="acm-table">
                <thead><tr>
                  <th>Sr No</th><th>Auto Code</th><th>Document Name</th>
                  <th>Issuing Authority</th><th>Actions</th>
                </tr></thead>
                <tbody>
                  {totalRows === 0 ? (
                    <tr className="acm-empty-row"><td colSpan={5}>No reference documents match your search.</td></tr>
                  ) : legacySlice.map((dl, i) => {
                    const sr = start + i + 1;
                    const srPad = String(sr).padStart(2, '0');
                    return (
                      <tr key={dl.code}>
                        <td>{srPad}</td>
                        <td><span className="acm-doc-code">{dl.code}</span></td>
                        <td style={{ fontWeight: 700, color: '#1f2937' }}>{dl.name}</td>
                        <td style={{ color: '#6b7280' }}>{dl.authority}</td>
                        <td>
                          <SegmentRefRowActions
                            refKey={`${sub}::${dl.code}`}
                            docName={dl.name}
                            uploads={segmentRefUploads}
                            setUploads={setSegmentRefUploads}
                            persistUpload={persistSegmentRefUpload}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : isOwners ? (
              <table className="acm-table">
                <thead><tr>
                  <th>Sr No</th><th>Owner Name</th><th>Designation</th><th>Email</th><th>Phone</th>
                  <th>ID Proof</th><th>Address Proof</th><th>Photograph</th><th>Actions</th>
                </tr></thead>
                <tbody>
                  {totalRows === 0 ? (
                    <tr className="acm-empty-row"><td colSpan={9}>{q ? 'No owners match your search.' : 'No owners captured yet. Click "+ Add Owner KYC Document" to add one.'}</td></tr>
                  ) : ownerSlice.map((o, i) => (
                    <tr key={o.id}>
                      <td>{String(start + i + 1).padStart(2, '0')}</td>
                      <td style={{ fontWeight: 700, color: '#1f2937' }}>{o.owner_name}</td>
                      <td>{o.designation || '—'}</td>
                      <td>{o.official_email || '—'}</td>
                      <td style={{ fontFamily: 'JetBrains Mono, ui-monospace, monospace', fontSize: 11 }}>{o.phone_number || '—'}</td>
                      <td><BustedLink url={o.id_proof_url}      path={o.id_proof_path} /></td>
                      <td><BustedLink url={o.address_proof_url} path={o.address_proof_path} /></td>
                      <td><BustedLink url={o.photograph_url}    path={o.photograph_path} /></td>
                      <td>
                        <div className="acm-row-actions">
                          <Tooltip label="Edit">
                            <button type="button" className="acm-row-btn" aria-label="Edit" onClick={() => onEditOwner(o.id)}>
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                            </button>
                          </Tooltip>
                          <Tooltip label="Delete">
                            <button type="button" className="acm-row-btn acm-row-btn-del" aria-label="Delete" onClick={() => onDeleteOwner(o.id)}>
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                            </button>
                          </Tooltip>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <table className="acm-table">
                <thead><tr>
                  <th>Sr No</th><th>Auto Code</th><th>{meta.nameCol}</th><th>License #</th>
                  <th>Issuing Authority</th><th>Issuing Date</th><th>Expiry</th><th>Attachment</th><th>Actions</th>
                </tr></thead>
                <tbody>
                  {totalRows === 0 ? (
                    <tr className="acm-empty-row"><td colSpan={9}>{q ? 'No documents match your search.' : 'No documents captured yet. Click "+ Add Document / License" to add one.'}</td></tr>
                  ) : docSlice.map((d, i) => {
                    const sr = start + i + 1;
                    const code = codeFor(kind.toUpperCase(), sr);
                    const fmtMonthYear = (s?: string | null) =>
                      s ? (() => { const [y, m] = s.split('-'); return `${m}/${y}`; })() : 'N/A';
                    const expLabel = fmtMonthYear(d.expiry_date);
                    const issLabel = fmtMonthYear(d.issue_date);
                    // Date pill colour: issue dates are informational
                    // (blue), expiry dates are contextual — green when
                    // still in the future, red only after they've
                    // actually expired, grey when missing.
                    const todayStr = new Date().toISOString().slice(0, 10);
                    const expClass = !d.expiry_date ? 'acm-expiry-na'
                      : d.expiry_date < todayStr ? 'acm-expiry-past'
                      : 'acm-expiry-future';
                    const issClass = d.issue_date ? 'acm-issue-date' : 'acm-expiry-na';
                    return (
                      <tr key={d.id}>
                        <td>{String(sr).padStart(2, '0')}</td>
                        <td><span className="acm-doc-code">{code}</span></td>
                        <td style={{ fontWeight: 700, color: '#1f2937' }}>{d.name}</td>
                        <td style={{ fontFamily: 'JetBrains Mono, ui-monospace, monospace', fontSize: 11 }}>{d.license_number || '—'}</td>
                        <td style={{ color: '#6b7280' }}>{d.issuing_authority || '—'}</td>
                        <td><span className={issClass}>{issLabel}</span></td>
                        <td><span className={expClass}>{expLabel}</span></td>
                        <td><BustedLink url={d.attachment_url} path={d.attachment_path} /></td>
                        <td>
                          <div className="acm-row-actions">
                            <Tooltip label="Edit">
                              <button type="button" className="acm-row-btn" aria-label="Edit" onClick={() => onEditDoc(d.id)}>
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                              </button>
                            </Tooltip>
                            <Tooltip label="Delete">
                              <button type="button" className="acm-row-btn acm-row-btn-del" aria-label="Delete" onClick={() => onDeleteDoc(d.id)}>
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
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
          <div className="acm-doc-pag-wrap">
            <span className="acm-doc-pag-info">
              {totalRows === 0 ? 'Showing 0 of 0 rows' : `Showing ${start + 1}–${Math.min(start + KYC_PER_PAGE, totalRows)} of ${totalRows} rows`}
            </span>
            {maxPage > 1 && (
              <div className="acm-pagination">
                <button type="button" className="acm-page-btn" disabled={curPage === 1} onClick={() => setPage(sub, curPage - 1)}>‹</button>
                {Array.from({ length: maxPage }, (_, i) => i + 1).map(p => (
                  <button key={p} type="button" className={`acm-page-btn ${p === curPage ? 'is-active' : ''}`} onClick={() => setPage(sub, p)}>{p}</button>
                ))}
                <button type="button" className="acm-page-btn" disabled={curPage === maxPage} onClick={() => setPage(sub, curPage + 1)}>›</button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
/* Legacy KycRow (rendered the old hardcoded DD/TL rows) was removed
   once Stage 2 became data-driven and inlined its row rendering. */

/* ───── Stage 3 — Evidence Vault KYC Documents ───── */
function Stage3KycDocs({ sub, setSub, segmentDocs, segmentRefUploads }: {
  sub: EvSubTab;
  setSub: (s: EvSubTab) => void;
  segmentDocs: { kyc:any[]; dd:any[]; tl:any[]; td:any[]; qc:any[] };
  segmentRefUploads: Record<string, { file: File; url: string; name: string }>;
}) {
  const meta = EV_SUB_META[sub];
  /* Stage 3 KYC vault is a read-only roll-up of the Stage 2
   * segment-rule uploads. Map each EvSubTab to the matching Stage 2
   * sub-tab (the refKey prefix that the uploader stored uploads
   * under) and the segmentDocs category that drives the row list. */
  const stage2Key = sub === 'dd' ? 'company-dd' : sub === 'kyc' ? 'owner-kyc' : 'trade-licence';
  const sourceRows = sub === 'dd' ? segmentDocs.dd
                    : sub === 'kyc' ? segmentDocs.kyc
                    : segmentDocs.tl;
  return (
    <div>
      <div className="acm-nested-tabs">
        {(['dd','kyc','tl'] as EvSubTab[]).map(s => (
          <button key={s} type="button" className={`acm-nested-tab ${sub === s ? 'is-active' : ''}`} onClick={() => setSub(s)}>
            {s === 'dd' ? 'Company Due Diligence' : s === 'kyc' ? 'Owner KYC' : 'Trade License'}
          </button>
        ))}
      </div>

      <div className="acm-section acm-section-purple">
        <div className="acm-section-head">
          <div className="acm-section-head-row" style={{ width: '100%' }}>
            <div className="acm-section-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></div>
            <div>
              <span className="acm-section-title">{meta.title}</span>
              <span className="acm-section-sub">{meta.sub}</span>
            </div>
          </div>
        </div>
        <div className="acm-section-body acm-section-body-table">
          <div className="acm-table-wrap">
            <table className="acm-table">
              <thead><tr><th>Sr No</th><th>Auto Code</th><th>{meta.nameCol}</th><th>Issuing Authority</th><th>Expiry</th><th>Status</th><th>Attachment</th></tr></thead>
              <tbody>
                {sourceRows.length === 0 ? (
                  <tr className="acm-empty-row"><td colSpan={7}>No segment rule loaded for this category yet — pick a segment on Stage 1.</td></tr>
                ) : sourceRows.map((d: any, i: number) => {
                  const refKey = `${stage2Key}::${d.code}`;
                  const uploaded = segmentRefUploads[refKey];
                  const expCls = !d.expiry || d.expiry === 'N/A' ? 'acm-expiry-na' : 'acm-expiry-date';
                  return (
                    <tr key={d.code}>
                      <td>{i + 1}</td>
                      <td><span className="acm-doc-code">{d.code}</span></td>
                      <td style={{ fontWeight: 700, color: '#1f2937' }}>{d.name}</td>
                      <td style={{ color: '#6b7280' }}>{d.authority || '—'}</td>
                      <td><span className={expCls}>{d.expiry || 'N/A'}</span></td>
                      <td>
                        {d.requirement === 'M'
                          ? <span className="acm-status-mandatory is-on">✓ Mandatory</span>
                          : <span className="acm-status-optional is-on">Optional</span>}
                      </td>
                      <td>
                        {uploaded ? (
                          <Tooltip label={`Open ${uploaded.name}`}>
                            <a href={uploaded.url} target="_blank" rel="noreferrer" className="acm-attach-link" aria-label="View attachment">
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
                              {uploaded.name}
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
      </div>
    </div>
  );
}

/* ───── Stage 3 — Trade Documents ─────
 * Per-row signature status. `status` mirrors clm_signature_requests.status
 * exactly so it stays consistent across the front- and back-end; the badge
 * style + label below is the only place where status → human-readable copy
 * lives. */
type TdSigStatus = 'idle' | 'inprogress' | 'completed' | 'declined' | 'recalled' | 'expired';
type TdDocRow = {
  id: string; db_id: number | null;
  name: string; selected: boolean; sent: boolean;
  status?: TdSigStatus;
  signature_request_id?: number;
  signed_url?: string;
  /* Set by the parent right before rendering — true when this row's
   * signature_request_id is inside the active 60-second Resend
   * cooldown. The button disables to stop a multi-doc bundle from
   * firing one reminder per doc. */
  cooldownActive?: boolean;
};

const TD_STATUS_BADGE: Record<TdSigStatus, { label: string; bg: string; fg: string }> = {
  idle:       { label: 'N/A',                 bg: '#f1f5f9', fg: '#94a3b8' },
  inprogress: { label: 'Awaiting Signature',  bg: '#fef3c7', fg: '#92400e' },
  completed:  { label: 'Signed',              bg: '#dcfce7', fg: '#166534' },
  declined:   { label: 'Declined',            bg: '#fee2e2', fg: '#991b1b' },
  recalled:   { label: 'Recalled',            bg: '#e0e7ff', fg: '#3730a3' },
  expired:    { label: 'Expired',             bg: '#fee2e2', fg: '#7f1d1d' },
};

function Stage3TradeDocs({ docs, onToggle, onToggleAll, onSend, onSendSelected }:
  { docs: TdDocRow[]; onToggle:(id:string)=>void; onToggleAll:(c:boolean)=>void; onSend:(id:string)=>void; onSendSelected:()=>void }) {
  const selCount = docs.filter(d => d.selected).length;
  const allChecked = selCount === docs.length;
  return (
    <div className="acm-section acm-section-purple">
      <div className="acm-section-head">
        <div className="acm-section-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><rect x="2" y="3" width="20" height="5" rx="1"/><path d="M4 8v12a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V8"/><line x1="10" y1="12" x2="14" y2="12"/></svg></div>
        <div>
          <span className="acm-section-title">TRADE DOCUMENTS</span>
          <span className="acm-section-sub">| Trade documents for digital signature & archive</span>
        </div>
      </div>
      <div className="acm-section-body acm-section-body-table">
        <div className="acm-table-wrap">
          <table className="acm-table acm-td-table">
            <colgroup><col className="col-srno" /><col className="col-docname" /><col className="col-sig" /><col className="col-status" /><col className="col-actions" /></colgroup>
            <thead>
              <tr>
                <th>Sr No</th>
                <th>Document Name</th>
                <th>
                  <label className="acm-td-check-label">
                    <input type="checkbox" checked={allChecked} ref={el => { if (el) el.indeterminate = selCount > 0 && selCount < docs.length; }} onChange={e => onToggleAll(e.target.checked)} />
                    Send for Signature
                  </label>
                </th>
                <th className="th-status">Document Status</th>
                <th className="th-actions">Actions</th>
              </tr>
            </thead>
            <tbody>
              {docs.map((d, i) => (
                <tr key={d.id}>
                  <td style={{ color: '#9ca3af', fontWeight: 600 }}>{i + 1}</td>
                  <td style={{ fontWeight: 600, color: '#1f2937' }}>{d.name}</td>
                  <td>
                    {(() => {
                      // Once a doc is `completed` (signer finished signing),
                      // resending is a footgun — it would create a brand-new
                      // signature request against the already-archived PDF.
                      // declined / recalled / expired stay re-sendable so
                      // the user can retry with a different recipient or
                      // window.
                      const isSigned = d.status === 'completed';
                      const onCooldown = !!d.cooldownActive;
                      const resendLocked = isSigned || onCooldown;
                      return (
                        <div className="acm-td-cell-check">
                          <input type="checkbox" checked={d.selected} onChange={() => onToggle(d.id)} disabled={isSigned} />
                          {d.sent ? (
                            <button
                              type="button"
                              className="acm-btn-resend"
                              onClick={() => { if (!resendLocked) onSend(d.id); }}
                              disabled={resendLocked}
                              title={
                                isSigned   ? 'This document has already been signed.'
                                : onCooldown ? 'Reminder just sent — one reminder covers every document in this bundle.'
                                : 'Resend for signature'
                              }
                              style={resendLocked ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
                            >
                              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-4.5"/></svg>
                              {onCooldown ? 'Sent ✓' : 'Resend'}
                            </button>
                          ) : (
                            <button type="button" className="acm-btn-send" onClick={() => onSend(d.id)}>
                              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                              Send
                            </button>
                          )}
                        </div>
                      );
                    })()}
                  </td>
                  <td className="td-status">
                    {(() => {
                      const s = d.status ?? 'idle';
                      const b = TD_STATUS_BADGE[s];
                      return (
                        <span style={{
                          display: 'inline-block', padding: '3px 10px', borderRadius: 999,
                          fontSize: 11, fontWeight: 700,
                          background: b.bg, color: b.fg,
                        }}>{b.label}</span>
                      );
                    })()}
                  </td>
                  <td className="td-actions">
                    <div className="acm-row-actions">
                      <Tooltip label={d.signed_url ? 'View signed document' : 'View document'}>
                        <a
                          href={d.signed_url || '#'}
                          target={d.signed_url ? '_blank' : undefined}
                          rel={d.signed_url ? 'noreferrer' : undefined}
                          onClick={e => { if (!d.signed_url) e.preventDefault(); }}
                          className="acm-doc-action acm-doc-action-view"
                          aria-label="View"
                          style={{ opacity: d.signed_url ? 1 : 0.5, cursor: d.signed_url ? 'pointer' : 'not-allowed', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
                        >
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                        </a>
                      </Tooltip>
                      <Tooltip label={d.signed_url ? 'Download signed document' : 'Download document'}>
                        <a
                          href={d.signed_url || '#'}
                          download={d.signed_url ? '' : undefined}
                          onClick={e => { if (!d.signed_url) e.preventDefault(); }}
                          className="acm-doc-action acm-doc-action-download"
                          aria-label="Download"
                          style={{ opacity: d.signed_url ? 1 : 0.5, cursor: d.signed_url ? 'pointer' : 'not-allowed', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
                        >
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                        </a>
                      </Tooltip>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="acm-td-actions">
          <button type="button" className="acm-btn-purple-lg" onClick={onSendSelected}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
            Send Selected Documents for Signature
          </button>
          <button type="button" className="acm-btn-purple-lg-out">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Customer Specific Document
          </button>
        </div>
      </div>
    </div>
  );
}

/* ───── KYC file slot ─────
 * Shared widget used by Stage 2's Add Document / License and Owner KYC
 * sub-modals. Renders one of four states:
 *   1. No file        → "Click to upload" drop zone
 *   2. New File picked → name chip + Preview (blob URL) + Remove + Replace
 *   3. Existing file   → name chip + Preview (server URL) + Remove (flags
 *                        backend to delete) + Replace
 *   4. Existing flagged for removal → muted notice + Undo + Replace
 *
 * The parent controls the actual state — this component is pure UI plus
 * validation. The parent reads `removeExisting` on submit and appends
 * `remove_<field>=1` to the FormData so the backend nulls the column
 * and deletes the file from disk. */
function KycFileSlot({
  label, required, kind = 'doc', accept, value, existingUrl, existingName,
  removeExisting, error, fieldKey,
  onPick, onRemoveExisting, onRestoreExisting,
}: {
  label: string;
  required?: boolean;
  kind?: FileKind;
  accept: string;
  value: File | null;
  existingUrl?: string | null;
  existingName?: string | null;
  removeExisting: boolean;
  error?: string;
  fieldKey?: string;
  onPick: (file: File | null) => void;
  onRemoveExisting: () => void;
  onRestoreExisting: () => void;
}) {
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement | null>(null);
  // Blob URL for the newly-picked file so Preview opens it inline.
  // Revoke on unmount / file-change to avoid leaks.
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!value) { setBlobUrl(null); return; }
    const url = URL.createObjectURL(value);
    setBlobUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [value]);

  const hasNew      = !!value;
  const showExisting = !hasNew && !!existingUrl && !removeExisting;
  const showRemoved  = !hasNew && removeExisting && !!existingUrl;
  const hintText     = kind === 'photo'
    ? `JPG, JPEG, PNG — max ${MAX_UPLOAD_MB} MB`
    : `PDF, DOC, DOCX, JPG, PNG — max ${MAX_UPLOAD_MB} MB`;

  const handlePick = (f: File | null) => {
    if (!f) { onPick(null); return; }
    const err = validateUpload(f, kind);
    if (err) {
      toast.error('File rejected', err);
      if (inputRef.current) inputRef.current.value = '';
      return;
    }
    onPick(f);
  };

  const previewUrl = hasNew ? blobUrl : (showExisting ? existingUrl : null);
  const previewName = hasNew ? value!.name : existingName || 'attachment';
  // Cache-bust the server URL on click so a freshly-uploaded replacement
  // shows the new file instead of the browser's cached copy. The blob
  // URL (newly-picked file) is already unique per File instance, no
  // busting needed. Evaluated at click time (not render time) so the
  // URL doesn't churn every re-render.
  const openPreview = () => {
    if (!previewUrl) return;
    let url = previewUrl;
    if (!hasNew) {
      const sep = url.includes('?') ? '&' : '?';
      url = `${url}${sep}t=${Date.now()}`;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="acm-field" data-field={fieldKey}>
      <label>{label} {required && <span className="acm-req">*</span>}</label>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        hidden
        onChange={e => handlePick(e.target.files?.[0] ?? null)}
      />
      {hasNew || showExisting ? (
        <div className={`acm-fileslot-chip ${hasNew ? 'is-new' : 'is-existing'}`}>
          <div className="acm-fileslot-icon">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
          </div>
          <span className="acm-fileslot-name" title={previewName}>{previewName}</span>
          <div className="acm-fileslot-actions">
            <Tooltip label="Preview">
              <button
                type="button"
                className="acm-fileslot-btn acm-fileslot-btn-view"
                aria-label="Preview"
                disabled={!previewUrl}
                onClick={openPreview}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
              </button>
            </Tooltip>
            <Tooltip label="Replace">
              <button
                type="button"
                className="acm-fileslot-btn"
                aria-label="Replace"
                onClick={() => inputRef.current?.click()}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
              </button>
            </Tooltip>
            <Tooltip label="Remove">
              <button
                type="button"
                className="acm-fileslot-btn acm-fileslot-btn-del"
                aria-label="Remove"
                onClick={() => {
                  if (hasNew) {
                    onPick(null);
                    if (inputRef.current) inputRef.current.value = '';
                  } else {
                    onRemoveExisting();
                  }
                }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>
              </button>
            </Tooltip>
          </div>
        </div>
      ) : showRemoved ? (
        <div className="acm-fileslot-removed">
          <span className="acm-fileslot-removed-text">Attachment will be removed on save</span>
          <div className="acm-fileslot-actions">
            <Tooltip label="Undo">
              <button
                type="button"
                className="acm-fileslot-btn"
                aria-label="Undo"
                onClick={onRestoreExisting}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-4.5"/></svg>
              </button>
            </Tooltip>
            <Tooltip label="Pick a different file">
              <button
                type="button"
                className="acm-fileslot-btn"
                aria-label="Replace"
                onClick={() => inputRef.current?.click()}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
              </button>
            </Tooltip>
          </div>
        </div>
      ) : (
        /* Single-line drop zone — the full mime hint lives in a tooltip
           so the widget can slot into a narrow 4-column grid without
           wrapping. Matches the height of the other inputs in the row. */
        <Tooltip label={hintText}>
          <button type="button" className={`acm-fileslot-drop ${error ? 'acm-input-error' : ''}`} onClick={() => inputRef.current?.click()}>
            <span className="acm-fileslot-drop-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            </span>
            <span className="acm-fileslot-drop-title">Click to upload</span>
            <span className="acm-fileslot-drop-size">max {MAX_UPLOAD_MB} MB</span>
          </button>
        </Tooltip>
      )}
      {error && <span className="acm-field-error">{error}</span>}
    </div>
  );
}

/* ───── Document / License sub-modal (Stage 2 — KYC) ─────
 * One form covers all three sub-tabs (Company DD / Owner KYC / Trade
 * Licence). The doc name dropdown is sourced from the master list for
 * the currently-active sub-tab; the `+` button next to it toggles the
 * field to a free-text input so the user can capture a custom name
 * the master doesn't have yet (e.g. a one-off trade licence).
 *
 * Save is a stub for now — KYC doc storage isn't DB-backed yet. When
 * it lands, swap the onSave body for the real POST and the rest of
 * this form is already in shape. */
type NewDoc = {
  name: string;         // Document/License Name
  license: string;      // License Number
  authority: string;    // Issuing Authority
  issueDate: string;    // YYYY-MM-DD
  expiryDate: string;   // YYYY-MM-DD
  attachment: File | null;
};
function DocumentSubModal({ sub, masters, customerId, editing, onClose, onSaved, onDocTypeAdded }:
  { sub: KycSubTab; masters: MasterLists; customerId: number | null;
    /** When set the form opens pre-filled with this row and saves via PUT. */
    editing?: { id: number; name: string; license_number?: string | null; issuing_authority?: string | null; issue_date?: string | null; expiry_date?: string | null; attachment_name?: string | null; attachment_url?: string | null; attachment_path?: string | null } | null;
    onClose: () => void;
    /** Fires with the saved server row (already shaped by the API) so
     *  the parent can prepend / replace it in the table state. */
    onSaved: (row: any) => void;
    onDocTypeAdded: (opt: MasterOpt) => void }) {
  const toast = useToast();
  const [d, setD] = useState<NewDoc>(() => editing ? {
    name:       editing.name             ?? '',
    license:    editing.license_number   ?? '',
    authority:  editing.issuing_authority ?? '',
    issueDate:  editing.issue_date       ?? '',
    expiryDate: editing.expiry_date      ?? '',
    attachment: null,   // existing file is shown as link; only set if user picks a new one
  } : { name: '', license: '', authority: '', issueDate: '', expiryDate: '', attachment: null });
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  // When editing, the parent's row may already carry an uploaded
  // attachment. Track a "remove on save" flag so we can null it
  // server-side via remove_attachment=1 without forcing the user to
  // re-upload a placeholder. Reset whenever a new file is picked.
  const [removeAttachment, setRemoveAttachment] = useState(false);
  // Inline "Add Document Type" master popup (opens from the `+` next
  // to the doc-name dropdown). Stays modal — never navigates away.
  const [typeModal, setTypeModal] = useState(false);
  const set = <K extends keyof NewDoc>(k: K, v: NewDoc[K]) => {
    setD(prev => ({ ...prev, [k]: v }));
    setErrs(prev => { if (!prev[k as string]) return prev; const n = { ...prev }; delete n[k as string]; return n; });
  };
  // Dropdown source: the Document Type master (managed in the Master
  // module under "Document Types"). The currently-selected value is
  // prepended as a synthetic option so legacy / since-renamed values
  // still render correctly on edit. The "+" button next to the
  // dropdown opens the master page in a new tab — the user adds the
  // new type there, returns, and the fresh option appears here.
  const docOptions = (() => {
    const base = masters.documentTypes.map(x => ({ value: x.name, label: x.name }));
    if (d.name && !base.some(o => o.value === d.name)) {
      return [{ value: d.name, label: d.name }, ...base];
    }
    return base;
  })();
  const submit = async () => {
    if (saving) return;
    const next: Record<string, string> = {};
    if (!d.name.trim())      next.name      = 'Document name is required';
    if (!d.license.trim())   next.license   = 'License number is required';
    else if (d.license.trim().length > 25) next.license = 'License number must be 25 characters or fewer';
    if (!d.authority.trim()) next.authority = 'Issuing authority is required';
    if (!d.issueDate)        next.issueDate = 'Issue date is required';
    else {
      // Backstop in case a stale picker / paste lets a future issue
      // date through — a document can't be issued in the future.
      const today = new Date().toISOString().slice(0, 10);
      if (d.issueDate > today) next.issueDate = 'Issue date cannot be in the future';
    }
    if (!d.expiryDate)       next.expiryDate = 'Expiry date is required';
    else {
      // Expiry must not be earlier than today — a document that has
      // already expired isn't useful and shouldn't be captured against
      // an active KYC record.
      const today = new Date().toISOString().slice(0, 10);
      if (d.expiryDate < today) next.expiryDate = 'Expiry date cannot be in the past';
    }
    // Cross-field check: expiry must not be earlier than issue date.
    // Dates come from MasterDatePicker as YYYY-MM-DD strings, which
    // sort lexicographically — direct string compare is safe.
    if (d.issueDate && d.expiryDate && d.expiryDate < d.issueDate) {
      next.expiryDate = 'Expiry date must be on or after the issue date';
    }
    /* Attachment is mandatory for Company Due Diligence documents — the
     * uploaded proof is the whole point of the KYC checklist. Trade
     * Licence keeps the attachment optional (some licences are number-
     * only references). On edit, an existing server-side attachment
     * (still in place) counts as satisfying the requirement. */
    if (sub === 'company-dd') {
      const hasNew      = !!d.attachment;
      const hasExisting = !!editing?.attachment_url && !removeAttachment;
      if (!hasNew && !hasExisting) {
        next.attachment = 'Attachment is required for Company Due Diligence documents';
      }
    }
    setErrs(next);
    if (Object.keys(next).length > 0) return;

    if (!customerId) {
      toast.warning('Save customer first', 'Complete Stage 1 before adding KYC documents.');
      return;
    }

    // Use multipart/form-data so the attachment can ride alongside the
    // text fields. The server validates `kind` against ['dd','tl'].
    const kind = sub === 'company-dd' ? 'dd' : 'tl';
    const fd = new FormData();
    fd.append('kind', kind);
    fd.append('name', d.name.trim());
    fd.append('license_number', d.license.trim());
    fd.append('issuing_authority', d.authority.trim());
    if (d.issueDate)  fd.append('issue_date',  d.issueDate);
    if (d.expiryDate) fd.append('expiry_date', d.expiryDate);
    if (d.attachment) {
      fd.append('attachment', d.attachment);
    } else if (removeAttachment && editing?.attachment_url) {
      // No new pick + user clicked Remove on the existing file →
      // backend nulls the column and deletes the disk file.
      fd.append('remove_attachment', '1');
    }
    fd.append('status', 'Active');

    setSaving(true);
    try {
      // Edit → POST to the same path (Laravel accepts both POST and PUT
      // on the update route; POST is used here so multipart files ride
      // along with text fields. The route also accepts a `_method=PUT`
      // sentinel if we want strict semantics later.)
      const url = editing
        ? `/customers/${customerId}/documents/${editing.id}`
        : `/customers/${customerId}/documents`;
      const { data } = await api.post(url, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const row = data?.data ?? data;
      onSaved(row);
    } catch (err: any) {
      const apiErrors = err?.response?.data?.errors;
      if (apiErrors && typeof apiErrors === 'object') {
        // Map server keys back to the local field names.
        const map: Record<string, string> = {
          name: 'name', license_number: 'license', issuing_authority: 'authority',
          issue_date: 'issueDate', expiry_date: 'expiryDate', attachment: 'name',
        };
        const next2: Record<string, string> = {};
        for (const [k, msgs] of Object.entries(apiErrors)) {
          const localKey = map[k] ?? k;
          next2[localKey] = Array.isArray(msgs) ? String((msgs as any[])[0]) : String(msgs);
        }
        setErrs(next2);
        // Toast suppressed — inline red errors handle this.
      } else {
        toast.error('Save failed', err?.response?.data?.message ?? 'Could not save the document. Try again.');
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="acm-sub-modal">
      <div className="acm-sub-card acm-doc-sub-card">
        <div className="acm-sub-header acm-doc-sub-header">
          <div className="acm-sub-title acm-doc-sub-title">{editing ? 'Edit Document / License' : 'Add New Document / License'}</div>
          <Tooltip label="Close">
            <button type="button" className="acm-sub-close" onClick={onClose} aria-label="Close">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </Tooltip>
        </div>
        <div className="acm-sub-body">
          <div className="acm-row acm-row-2">
            <Field label="Document / License Name" required error={errs.name}>
              <div className="acm-doc-name-row">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <MasterSelect
                    value={d.name}
                    options={docOptions}
                    placeholder="Select Document / License"
                    invalid={!!errs.name}
                    onChange={v => set('name', v)}
                  />
                </div>
                <Tooltip label="Add new document type">
                  <button
                    type="button"
                    className="acm-doc-plus-btn"
                    aria-label="Add new document type"
                    /* Opens the master's Add Document Type form inline
                       on top of this sub-modal — never navigates away
                       so the user's in-progress license stays intact. */
                    onClick={() => setTypeModal(true)}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                  </button>
                </Tooltip>
              </div>
            </Field>
            <Field label="License Number" required error={errs.license}>
              <input className={errs.license ? 'acm-input-error' : ''} value={d.license} maxLength={25} onChange={e => set('license', e.target.value.slice(0, 25))} placeholder="Enter license number (max 25)" />
            </Field>
          </div>
          <div className="acm-row acm-row-4">
            <Field label="Issuing Authority" required error={errs.authority}>
              <input className={errs.authority ? 'acm-input-error' : ''} value={d.authority} onChange={e => set('authority', e.target.value)} placeholder="Enter issuing authority" />
            </Field>
            <Field label="Issuing Date" required error={errs.issueDate}>
              {/* maxDate caps the picker at the earlier of today and
                  the chosen expiry — a document can never be issued in
                  the future, and the two date fields can never
                  disagree with each other. */}
              <MasterDatePicker
                value={d.issueDate}
                maxDate={(() => {
                  const today = new Date().toISOString().slice(0, 10);
                  return d.expiryDate && d.expiryDate < today ? d.expiryDate : today;
                })()}
                invalid={!!errs.issueDate}
                onChange={(v: string) => {
                  set('issueDate', v);
                  // Auto-clear an expiry that's now earlier than the new
                  // issue date so the form stays internally consistent.
                  if (d.expiryDate && v && d.expiryDate < v) set('expiryDate', '');
                }}
                placeholder="DD/MM/YYYY"
              />
            </Field>
            <Field label="Expiry Date" required error={errs.expiryDate}>
              {/* minDate forces expiry ≥ the later of (issue date, today)
                  — a document can't be issued in the future, and it
                  can't already be expired. Submit-time validator below
                  is the backstop. */}
              <MasterDatePicker
                value={d.expiryDate}
                minDate={(() => {
                  const today = new Date().toISOString().slice(0, 10);
                  return d.issueDate && d.issueDate > today ? d.issueDate : today;
                })()}
                invalid={!!errs.expiryDate}
                onChange={(v: string) => set('expiryDate', v)}
                placeholder="DD/MM/YYYY"
              />
            </Field>
            <KycFileSlot
              label="Attachment"
              /* Company Due Diligence requires the proof file — the
                 whole point of the DD checklist is the uploaded
                 document, so the red asterisk + submit-time validator
                 enforce it. Trade Licence keeps it optional. */
              required={sub === 'company-dd'}
              kind="doc"
              accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
              value={d.attachment}
              existingUrl={editing?.attachment_url ?? null}
              existingName={editing?.attachment_name ?? null}
              removeExisting={removeAttachment}
              error={errs.attachment}
              fieldKey="attachment"
              onPick={(f) => {
                set('attachment', f);
                if (f) {
                  setRemoveAttachment(false);
                  setErrs(s => { const n = { ...s }; delete n.attachment; return n; });
                }
              }}
              onRemoveExisting={() => setRemoveAttachment(true)}
              onRestoreExisting={() => setRemoveAttachment(false)}
            />
          </div>
        </div>
        <div className="acm-sub-footer acm-doc-sub-footer">
          <button type="button" className="acm-btn-mini-cancel" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="button" className="acm-btn-save acm-doc-save" onClick={submit} disabled={saving}>
            {saving ? 'Saving…' : (editing ? 'Update' : 'Save')}
          </button>
        </div>
      </div>

      {typeModal && (
        <AddDocumentTypeMasterModal
          onClose={() => setTypeModal(false)}
          onSaved={(opt) => {
            onDocTypeAdded(opt);
            set('name', opt.name);   // auto-select the freshly-created type
            setTypeModal(false);
          }}
        />
      )}
    </div>
  );
}

/* ───── Inline "Add Document Type" master popup ─────
 * Rendered on top of the Add Document / License sub-modal. POSTs to
 * /master/document_type — the canonical Document Types master — so
 * the new row immediately shows up everywhere that consumes the
 * master (Stage 2 dropdown here, master listing page, anywhere else).
 *
 * Fields mirror the master schema:
 *   title         (required text)
 *   applicable_to (Customer | Vendor | Both | Internal)
 *   is_mandatory  (Yes | No)
 *   status        (Active | Inactive — required, defaults to Active)
 */
function AddDocumentTypeMasterModal({ onClose, onSaved }:
  { onClose: () => void; onSaved: (opt: MasterOpt) => void }) {
  const toast = useToast();
  const [title, setTitle]               = useState('');
  const [applicableTo, setApplicableTo] = useState('');
  const [isMandatory, setIsMandatory]   = useState('');
  const [status, setStatus]             = useState('Active');
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

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
      // The master endpoint returns the created row — wrap it as a
      // MasterOpt so the parent can append straight into the
      // documentTypes list and auto-select the new entry.
      const row = data?.data ?? data;
      onSaved({ id: Number(row?.id ?? 0), name: String(row?.title ?? title.trim()) });
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
    <div className="acm-sub-modal acm-doc-type-sub-modal">
      <div className="acm-sub-card acm-doc-sub-card acm-doc-type-master-card">
        <div className="acm-sub-header acm-doc-sub-header acm-doc-type-master-head">
          <div className="acm-doc-type-master-head-left">
            <div className="acm-doc-type-master-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            </div>
            <div>
              <div className="acm-sub-title acm-doc-sub-title" style={{ textAlign: 'left' }}>Add Document Type</div>
              <div className="acm-doc-type-master-sub">Fill in the details to register a new document type</div>
            </div>
          </div>
          <Tooltip label="Close">
            <button type="button" className="acm-sub-close" onClick={onClose} aria-label="Close">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </Tooltip>
        </div>
        <div className="acm-sub-body acm-doc-type-master-body">
          <div className="acm-row acm-row-1">
            <Field label="Document Type Name" required error={errs.title}>
              <input
                className={errs.title ? 'acm-input-error' : ''}
                value={title}
                onChange={e => { setTitle(e.target.value); if (errs.title) setErrs(p => { const n = { ...p }; delete n.title; return n; }); }}
                placeholder="e.g. GST Registration Certificate"
                autoFocus
              />
            </Field>
          </div>
          <div className="acm-row acm-row-1">
            <Field label="Applicable To" error={errs.applicable_to}>
              <MasterSelect
                value={applicableTo}
                options={[
                  { value: 'Customer', label: 'Customer' },
                  { value: 'Vendor',   label: 'Supplier' },
                  { value: 'Both',     label: 'Both' },
                  { value: 'Internal', label: 'Internal' },
                ]}
                placeholder="Select…"
                invalid={!!errs.applicable_to}
                onChange={v => setApplicableTo(v)}
              />
            </Field>
          </div>
          <div className="acm-row acm-row-1">
            <Field label="Is Mandatory" error={errs.is_mandatory}>
              <MasterSelect
                value={isMandatory}
                options={[{ value: 'Yes', label: 'Yes' }, { value: 'No', label: 'No' }]}
                placeholder="Select…"
                invalid={!!errs.is_mandatory}
                onChange={v => setIsMandatory(v)}
              />
            </Field>
          </div>
          <div className="acm-row acm-row-1">
            <Field label="Status" required error={errs.status}>
              <MasterSelect
                value={status}
                options={[{ value: 'Active', label: 'Active' }, { value: 'Inactive', label: 'Inactive' }]}
                placeholder="Select…"
                invalid={!!errs.status}
                onChange={v => setStatus(v)}
              />
            </Field>
          </div>
        </div>
        <div className="acm-sub-footer acm-doc-sub-footer acm-doc-type-master-footer">
          <button type="button" className="acm-btn-mini-cancel" onClick={onClose} disabled={saving}>
            <span style={{ marginRight: 6 }}>×</span> Cancel
          </button>
          <button type="button" className="acm-btn-save acm-doc-save acm-doc-type-master-save" onClick={submit} disabled={saving}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v13a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
            <span>{saving ? 'Saving…' : 'Save Document Type'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

/* ───── Owner Due Diligence sub-modal ─────
 * Stage 2 → Owner KYC tab uses a different form than the generic
 * Document / License flow: an owner row needs identity proofs and
 * the owner's contact details, not a license number + expiry. Same
 * visual chrome as the other sub-modals (purple gradient header,
 * dark-mode aware) — only the field set changes. */
type NewOwnerDD = {
  ownerName:     string;
  designation:   string;       // master-backed
  officialEmail: string;
  phoneNumber:   string;
  idProof:       File | null;
  addressProof:  File | null;
  photograph:    File | null;
};
function OwnerDDSubModal({ masters, customerId, editing, onClose, onSaved }:
  { masters: MasterLists; customerId: number | null;
    /** When set the form opens pre-filled and saves via update. */
    editing?: { id: number; owner_name: string; designation?: string | null; official_email?: string | null; phone_number?: string | null; id_proof_path?: string | null; id_proof_url?: string | null; id_proof_name?: string | null; address_proof_path?: string | null; address_proof_url?: string | null; address_proof_name?: string | null; photograph_path?: string | null; photograph_url?: string | null; photograph_name?: string | null } | null;
    onClose: () => void;
    /** Fires with the saved server row so the parent can prepend / replace it
     *  in the Owner KYC table. */
    onSaved: (row: any) => void }) {
  const toast = useToast();
  const [d, setD] = useState<NewOwnerDD>(() => editing ? {
    ownerName:     editing.owner_name      ?? '',
    designation:   editing.designation     ?? '',
    officialEmail: editing.official_email  ?? '',
    phoneNumber:   editing.phone_number    ?? '',
    // Existing files are still on the server. Only set these if the
    // user picks a new file — empty FormData fields are skipped below.
    idProof: null, addressProof: null, photograph: null,
  } : {
    ownerName: '', designation: '', officialEmail: '', phoneNumber: '',
    idProof: null, addressProof: null, photograph: null,
  });
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  // Track per-slot "remove existing" flags. The submit appends
  // remove_<field>=1 when these are set and no new file has been
  // picked, so the backend nulls the column + deletes the disk file.
  const [removeIdProof,      setRemoveIdProof]      = useState(false);
  const [removeAddressProof, setRemoveAddressProof] = useState(false);
  const [removePhotograph,   setRemovePhotograph]   = useState(false);
  const set = <K extends keyof NewOwnerDD>(k: K, v: NewOwnerDD[K]) => {
    setD(prev => ({ ...prev, [k]: v }));
    setErrs(prev => { if (!prev[k as string]) return prev; const n = { ...prev }; delete n[k as string]; return n; });
  };
  const submit = async () => {
    if (saving) return;
    const next: Record<string, string> = {};
    if (!d.ownerName.trim())                            next.ownerName    = 'Owner name is required';
    if (!d.designation)                                 next.designation  = 'Select a designation';
    if (!d.officialEmail.trim())                        next.officialEmail = 'Official email is required';
    else if (!/^\S+@\S+\.\S+$/.test(d.officialEmail))   next.officialEmail = 'Enter a valid email';
    if (!d.phoneNumber.trim())                          next.phoneNumber  = 'Phone number is required';
    else if (!/^\+?[0-9\s-]{7,15}$/.test(d.phoneNumber)) next.phoneNumber = 'Phone must be 7–15 digits';
    // Files are required only when creating a new owner. On edit the
    // existing files stay on disk until the user picks a replacement.
    // If the user explicitly removed an existing file (without picking
    // a replacement) we also fail validation — owners must have all
    // three proofs at all times.
    const has = (file: File | null, existing: string | null | undefined, remove: boolean) =>
      !!file || (!!existing && !remove);
    if (!has(d.idProof,      editing?.id_proof_url,      removeIdProof))      next.idProof      = 'ID proof is required';
    if (!has(d.addressProof, editing?.address_proof_url, removeAddressProof)) next.addressProof = 'Address proof is required';
    if (!has(d.photograph,   editing?.photograph_url,    removePhotograph))   next.photograph   = 'Photograph is required';
    setErrs(next);
    if (Object.keys(next).length > 0) {
      // Toast suppressed — inline red errors mark each offending field.
      return;
    }

    if (!customerId) {
      toast.warning('Save customer first', 'Complete Stage 1 before adding owner KYC.');
      return;
    }

    const fd = new FormData();
    fd.append('owner_name',     d.ownerName.trim());
    fd.append('designation',    d.designation);
    fd.append('official_email', d.officialEmail.trim());
    fd.append('phone_number',   d.phoneNumber.trim());
    if (d.idProof)           fd.append('id_proof',           d.idProof);
    else if (removeIdProof && editing?.id_proof_url) fd.append('remove_id_proof', '1');
    if (d.addressProof)      fd.append('address_proof',      d.addressProof);
    else if (removeAddressProof && editing?.address_proof_url) fd.append('remove_address_proof', '1');
    if (d.photograph)        fd.append('photograph',         d.photograph);
    else if (removePhotograph && editing?.photograph_url) fd.append('remove_photograph', '1');
    fd.append('status', 'Active');

    setSaving(true);
    try {
      // On edit → POST to the update route (Laravel accepts both POST
      // and PUT; we use POST so multipart files ride along cleanly).
      const url = editing
        ? `/customers/${customerId}/owners/${editing.id}`
        : `/customers/${customerId}/owners`;
      const { data } = await api.post(url, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      onSaved(data?.data ?? data);
    } catch (err: any) {
      const apiErrors = err?.response?.data?.errors;
      if (apiErrors && typeof apiErrors === 'object') {
        const map: Record<string, string> = {
          owner_name: 'ownerName', designation: 'designation',
          official_email: 'officialEmail', phone_number: 'phoneNumber',
          id_proof: 'idProof', address_proof: 'addressProof', photograph: 'photograph',
        };
        const next2: Record<string, string> = {};
        for (const [k, msgs] of Object.entries(apiErrors)) {
          const localKey = map[k] ?? k;
          next2[localKey] = Array.isArray(msgs) ? String((msgs as any[])[0]) : String(msgs);
        }
        setErrs(next2);
        // Toast suppressed — inline red errors handle this.
      } else {
        toast.error('Save failed', err?.response?.data?.message ?? 'Could not save the owner. Try again.');
      }
    } finally {
      setSaving(false);
    }
  };
  // Per-slot meta — picks accept attribute + which "remove" flag the
  // KycFileSlot's onRemoveExisting / onRestoreExisting toggles, plus
  // the existing-file URL/name resolved from the editing prop.
  const SLOT_META: Record<'idProof' | 'addressProof' | 'photograph', {
    label: string; kind: FileKind; accept: string;
    existingUrl: string | null | undefined; existingName: string | null | undefined;
    removeFlag: boolean; setRemoveFlag: (v: boolean) => void;
  }> = {
    idProof: {
      label: 'ID Proof', kind: 'doc',
      accept: '.pdf,.jpg,.jpeg,.png,.doc,.docx',
      existingUrl:  editing?.id_proof_url,
      existingName: editing?.id_proof_name,
      removeFlag:    removeIdProof,
      setRemoveFlag: setRemoveIdProof,
    },
    addressProof: {
      label: 'Address Proof', kind: 'doc',
      accept: '.pdf,.jpg,.jpeg,.png,.doc,.docx',
      existingUrl:  editing?.address_proof_url,
      existingName: editing?.address_proof_name,
      removeFlag:    removeAddressProof,
      setRemoveFlag: setRemoveAddressProof,
    },
    photograph: {
      label: 'Photograph', kind: 'photo',
      accept: '.jpg,.jpeg,.png',
      existingUrl:  editing?.photograph_url,
      existingName: editing?.photograph_name,
      removeFlag:    removePhotograph,
      setRemoveFlag: setRemovePhotograph,
    },
  };
  const slot = (field: 'idProof' | 'addressProof' | 'photograph') => {
    const m = SLOT_META[field];
    return (
      <KycFileSlot
        label={m.label}
        required
        kind={m.kind}
        accept={m.accept}
        value={d[field]}
        existingUrl={m.existingUrl ?? null}
        existingName={m.existingName ?? null}
        removeExisting={m.removeFlag}
        error={errs[field]}
        fieldKey={field}
        onPick={(f) => {
          set(field, f);
          if (f) {
            m.setRemoveFlag(false);
            setErrs(s => { const n = { ...s }; delete n[field]; return n; });
          }
        }}
        onRemoveExisting={() => m.setRemoveFlag(true)}
        onRestoreExisting={() => m.setRemoveFlag(false)}
      />
    );
  };
  return (
    <div className="acm-sub-modal">
      <div className="acm-sub-card acm-doc-sub-card">
        <div className="acm-sub-header acm-doc-sub-header">
          <div className="acm-sub-title acm-doc-sub-title">{editing ? 'Edit Owner Due Diligence' : 'Add Owner Due Diligence'}</div>
          <Tooltip label="Close">
            <button type="button" className="acm-sub-close" onClick={onClose} aria-label="Close">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </Tooltip>
        </div>
        <div className="acm-sub-body">
          <div className="acm-row acm-row-4">
            <Field label="Owner Name" required error={errs.ownerName}>
              <input className={errs.ownerName ? 'acm-input-error' : ''} value={d.ownerName} onChange={e => set('ownerName', e.target.value)} placeholder="Enter owner name" />
            </Field>
            <Field label="Designation" required error={errs.designation}>
              <MasterSelect value={d.designation} options={optsWith(masters.designations, d.designation)} placeholder="Select designation" invalid={!!errs.designation} onChange={v => set('designation', v)} />
            </Field>
            <Field label="Official Email" required error={errs.officialEmail}>
              <input className={errs.officialEmail ? 'acm-input-error' : ''} type="email" value={d.officialEmail} onChange={e => set('officialEmail', e.target.value)} placeholder="name@company.com" />
            </Field>
            <Field label="Phone Number" required error={errs.phoneNumber}>
              <input className={errs.phoneNumber ? 'acm-input-error' : ''} type="tel" value={d.phoneNumber} onChange={e => set('phoneNumber', e.target.value)} placeholder="7–15 digit number" />
            </Field>
          </div>
          <div className="acm-row acm-row-3">
            {slot('idProof')}
            {slot('addressProof')}
            {slot('photograph')}
          </div>
        </div>
        <div className="acm-sub-footer acm-doc-sub-footer">
          <button type="button" className="acm-btn-mini-cancel" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="button" className="acm-btn-save acm-doc-save" onClick={submit} disabled={saving}>
            {saving ? 'Saving…' : (editing ? 'Update' : 'Save')}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ───── Location sub-modal (merged Address + Contact form) ─────
 * `disallowedTypes` excludes address types already claimed elsewhere
 * (e.g. "Registered Office" when the primary address is already the
 * registered office — a customer can only have one). The currently
 * editing row's own type is still shown so existing data isn't hidden
 * from the user mid-edit. */
function LocationSubModal({ editing, masters, disallowedTypes, existingEmails = [], existingPhones = [], onClose, onSave }:
  { editing: LocationRow | null; masters: MasterLists; disallowedTypes?: string[];
    /** Emails already used by other addresses (primary + other locations)
     *  on this customer — used to block duplicates within the same form
     *  before the user can save and run into a backend conflict. */
    existingEmails?: string[];
    existingPhones?: string[];
    onClose: () => void; onSave: (rec: Omit<LocationRow, 'id'>) => void }) {
  const toast = useToast();
  // For new locations, skip the default "Registered Office" prefill if
  // that type is disallowed — otherwise the user lands on a value
  // they can't actually save with.
  const initialType = editing
    ? editing.type
    : (disallowedTypes?.includes(DEFAULT_ADDRESS_TYPE) ? '' : DEFAULT_ADDRESS_TYPE);
  const [d, setD] = useState<Omit<LocationRow, 'id'>>(() => editing ? { ...editing } : {
    type: initialType, line: '', country: '', state: '', city: '', pin: '',
    cpName: '', cpDesignation: '', cpContact: '', cpEmail: '', cpWhatsapp: 'yes' as 'yes' | 'no' | '',
  });
  // Strip disallowed types, but keep whatever the row currently has
  // so an existing value never silently disappears from its own
  // dropdown.
  const availableAddressTypes = useMemo(() => {
    if (!disallowedTypes || disallowedTypes.length === 0) return masters.addressTypes;
    return masters.addressTypes.filter(t => !disallowedTypes.includes(t.name) || t.name === d.type);
  }, [masters.addressTypes, disallowedTypes, d.type]);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const set = <K extends keyof typeof d>(k: K, v: (typeof d)[K]) => {
    setD(prev => ({ ...prev, [k]: v }));
    setErrs(prev => { if (!prev[k as string]) return prev; const n = { ...prev }; delete n[k as string]; return n; });
  };
  /* Real-time duplicate check — fires the inline error the moment the
   * user finishes typing a phone or email that's already in use on
   * this customer (primary contact or another location). Without this,
   * the validation only fired on Save, which felt like "the form ate
   * the value silently and then rejected it on submit". */
  useEffect(() => {
    const phone = (d.cpContact || '').trim();
    const email = (d.cpEmail   || '').trim().toLowerCase();
    setErrs(prev => {
      const next = { ...prev };
      if (phone && existingPhones.includes(phone)) {
        next.cpContact = 'This phone number is already used by another address on this customer';
      } else if (next.cpContact === 'This phone number is already used by another address on this customer') {
        delete next.cpContact;
      }
      if (email && existingEmails.includes(email)) {
        next.cpEmail = 'This email is already used by another address on this customer';
      } else if (next.cpEmail === 'This email is already used by another address on this customer') {
        delete next.cpEmail;
      }
      return next;
    });
  }, [d.cpContact, d.cpEmail, existingPhones, existingEmails]);
  const selectedCountry = masters.countries.find(c => c.name === d.country);
  const states = selectedCountry
    ? masters.states.filter(s => s.country_id === selectedCountry.id)
    : [];
  const submit = () => {
    const next: Record<string, string> = {};
    if (!d.type)                                       next.type          = 'Select address type';
    if (!d.line.trim())                                next.line          = 'Address is required';
    if (!d.country)                                    next.country       = 'Select country';
    if (!d.state)                                      next.state         = 'Select state';
    if (!d.city.trim())                                next.city          = 'City is required';
    if (!d.pin.trim())                                 next.pin           = 'PIN is required';
    else if (!/^\d{6}$/.test(d.pin.trim()))            next.pin           = 'PIN must be exactly 6 digits';
    if (!d.cpName.trim())                              next.cpName        = 'Contact name required';
    if (!d.cpDesignation.trim())                       next.cpDesignation = 'Designation required';
    if (!d.cpContact.trim())                           next.cpContact     = 'Phone required';
    else if (!/^\+?[0-9\s-]{7,15}$/.test(d.cpContact)) next.cpContact     = 'Phone must be 7–15 digits';
    else if (existingPhones.includes(d.cpContact.trim())) {
      next.cpContact = 'This phone number is already used by another address on this customer';
    }
    if (!d.cpEmail.trim())                             next.cpEmail       = 'Email required';
    else if (!/^\S+@\S+\.\S+$/.test(d.cpEmail))        next.cpEmail       = 'Enter a valid email';
    else if (existingEmails.includes(d.cpEmail.trim().toLowerCase())) {
      next.cpEmail = 'This email is already used by another address on this customer';
    }
    if (!d.cpWhatsapp)                                 next.cpWhatsapp    = 'Select WhatsApp preference';
    setErrs(next);
    if (Object.keys(next).length === 0) { onSave(d); return; }
    // Toast suppressed — inline red errors handle this.
  };
  return (
    <div className="acm-sub-modal">
      <div className="acm-sub-card acm-doc-sub-card">
        <div className="acm-sub-header acm-doc-sub-header">
          <div className="acm-sub-title acm-doc-sub-title">{editing ? 'Edit' : 'Add New'} Location &amp; Contact</div>
          <Tooltip label="Close">
            <button type="button" className="acm-sub-close" onClick={onClose} aria-label="Close">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </Tooltip>
        </div>
        <div className="acm-sub-body">
          <div className="acm-row acm-row-2">
            <Field label="Address Type" required error={errs.type}>
              <MasterSelect value={d.type} options={optsWith(availableAddressTypes, d.type)} placeholder="Select address type" invalid={!!errs.type} onChange={v => set('type', v)} />
            </Field>
            <Field label="Address" required error={errs.line}><input className={errs.line ? 'acm-input-error' : ''} value={d.line} onChange={e => set('line', e.target.value)} placeholder="Enter complete address" /></Field>
          </div>
          <div className="acm-row acm-row-4">
            <Field label="Country" required error={errs.country}>
              <MasterSelect value={d.country} options={optsWith(masters.countries, d.country)} placeholder="Select country" invalid={!!errs.country} onChange={v => { set('country', v); set('state', ''); }} />
            </Field>
            <Field label="State" required error={errs.state}>
              <MasterSelect
                value={d.state}
                options={(() => {
                  const base = states.map(s => ({ value: s.name, label: s.name }));
                  if (d.state && !base.some(o => o.value === d.state)) return [{ value: d.state, label: d.state }, ...base];
                  return base;
                })()}
                placeholder={d.country ? 'Select state' : 'Select country first'}
                disabled={!d.country}
                invalid={!!errs.state}
                onChange={v => set('state', v)}
              />
            </Field>
            <Field label="City" required error={errs.city}><input className={errs.city ? 'acm-input-error' : ''} value={d.city} onChange={e => set('city', e.target.value)} placeholder="Enter City" /></Field>
            <Field label="Pin / Postal Code" required error={errs.pin}><input className={errs.pin ? 'acm-input-error' : ''} value={d.pin} onChange={e => set('pin', e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" maxLength={6} placeholder="6-digit PIN" /></Field>
          </div>
          <div className="acm-row acm-row-4">
            <Field label="Contact Person Name" required error={errs.cpName}><input className={errs.cpName ? 'acm-input-error' : ''} value={d.cpName} onChange={e => set('cpName', e.target.value)} placeholder="Full name" /></Field>
            <Field label="Designation" required error={errs.cpDesignation}>
              <MasterSelect value={d.cpDesignation} options={optsWith(masters.designations, d.cpDesignation)} placeholder="Select designation" invalid={!!errs.cpDesignation} onChange={v => set('cpDesignation', v)} />
            </Field>
            <Field label="Contact No" required error={errs.cpContact}><input className={errs.cpContact ? 'acm-input-error' : ''} type="tel" value={d.cpContact} onChange={e => set('cpContact', e.target.value)} placeholder="7–15 digit mobile" /></Field>
            <Field label="Email Id" required error={errs.cpEmail}><input className={errs.cpEmail ? 'acm-input-error' : ''} type="email" value={d.cpEmail} onChange={e => set('cpEmail', e.target.value)} placeholder="name@company.com" /></Field>
          </div>
          <div className="acm-row acm-row-1">
            <Field label="Whatsapp Enabled?" required error={errs.cpWhatsapp}>
              <div className="acm-radio-pills">
                <label className={`acm-radio-pill ${d.cpWhatsapp === 'yes' ? 'is-active' : ''}`}><input type="radio" name="locWa" value="yes" checked={d.cpWhatsapp === 'yes'} onChange={() => set('cpWhatsapp', 'yes')} /> Yes</label>
                <label className={`acm-radio-pill ${d.cpWhatsapp === 'no' ? 'is-active' : ''}`}><input type="radio" name="locWa" value="no" checked={d.cpWhatsapp === 'no'} onChange={() => set('cpWhatsapp', 'no')} /> No</label>
              </div>
            </Field>
          </div>
        </div>
        <div className="acm-sub-footer acm-doc-sub-footer">
          <button type="button" className="acm-btn-mini-cancel" onClick={onClose}>Cancel</button>
          <button type="button" className="acm-btn-save acm-doc-save" onClick={submit}>{editing ? 'Update' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}

/* ───── Compact inline "label : value" pair ─────
 * Single line; the label is muted, value is the prominent dark text.
 * Long values truncate with an ellipsis and surface the full text on
 * hover via the project-wide Tooltip — keeps the grid columns lined
 * up no matter how long an address or company name gets. */
function ReadInline({ label, value, span }: { label: string; value?: string | null; span?: number }) {
  const v = (value ?? '').toString().trim();
  const node = (
    <div className="acm-hs-inline" style={span ? { gridColumn: `span ${span}` } : undefined}>
      <span className="acm-hs-inline-lbl">{label} :</span>
      <span className={`acm-hs-inline-val ${!v ? 'is-empty' : ''}`}>{v || '—'}</span>
    </div>
  );
  // Tooltip only when there's actual content to disambiguate.
  return v ? <Tooltip label={`${label}: ${v}`}>{node}</Tooltip> : node;
}

/* ───── Stage 1 read-only summary ─────
 * Dense horizontal layout — every Stage 1 field shown as a tight
 * "Label : Value" pair laid out in a 4-column grid. No card chrome;
 * the parent history panel already frames the content. */
function HistoryStage1({ form, locations, customerId }: { form: any; locations: LocationRow[]; customerId?: string }) {
  const wa = form.cpWa === 'yes' ? 'Yes' : form.cpWa === 'no' ? 'No' : '';
  return (
    <div className="acm-hs-mirror">
      <div className="acm-hs-grid">
        <ReadInline label="Customer ID"               value={customerId} />
        <ReadInline label="Company Name"              value={form.coName} />
        <ReadInline label="Company Legal Name"        value={form.coLegal} />
        <ReadInline label="Customer Type"             value={form.coType} />

        <ReadInline label="Company Website"           value={form.coWeb} />
        <ReadInline label="Customer Segment"          value={(form.coSeg ?? []).join(', ')} />
        <ReadInline label="Classification"            value={form.coClass} />
        <ReadInline label="Risk Level"                value={form.coRisk} />

        <ReadInline label="Registered Office Address" value={form.addr} span={2} />
        <ReadInline label="Country"                   value={form.country} />
        <ReadInline label="State"                     value={form.state} />

        <ReadInline label="City"                      value={form.city} />
        <ReadInline label="PIN / Postal Code"         value={form.pin} />
        <ReadInline label="Contact Person Name"       value={form.cpName} />
        <ReadInline label="Designation"               value={form.cpDesig} />

        <ReadInline label="Contact No"                value={form.cpTel} />
        <ReadInline label="Email"                     value={form.cpEmail} />
        <ReadInline label="WhatsApp Enable"           value={wa} />
        {locations.length > 0 && (
          <ReadInline label="Additional Locations" value={`${locations.length} captured`} />
        )}
      </div>
    </div>
  );
}
function HistoryStage2({ ddCount, ownerCount, tlCount }:
  { ddCount: number; ownerCount: number; tlCount: number }) {
  const total = ddCount + ownerCount + tlCount;
  return (
    <div className="acm-hs-block">
      <div className="acm-hs-header">
        <div className="acm-hs-num"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg></div>
        <div className="acm-hs-title">Stage 2 — KYC / Due Diligence</div>
        <div className="acm-hs-divider" />
      </div>
      <div className="acm-hs-group">
        <div className="acm-hs-group-label">Document Summary</div>
        <div className="acm-hs-stats">
          <div className="acm-hs-stat"><div className="acm-hs-stat-num">{ddCount}</div><div className="acm-hs-stat-lbl">DD Docs</div></div>
          <div className="acm-hs-stat"><div className="acm-hs-stat-num">{ownerCount}</div><div className="acm-hs-stat-lbl">Owner KYC</div></div>
          <div className="acm-hs-stat"><div className="acm-hs-stat-num">{tlCount}</div><div className="acm-hs-stat-lbl">Trade Lic.</div></div>
          <div className="acm-hs-stat"><div className="acm-hs-stat-num">{total}</div><div className="acm-hs-stat-lbl">Total</div></div>
        </div>
      </div>
    </div>
  );
}

/* ───── Reusable field wrapper ───── */
function Field({ label, required, children, error, fieldKey }: { label: string; required?: boolean; children: React.ReactNode; error?: string; fieldKey?: string }) {
  return (
    <div className="acm-field" data-field={fieldKey}>
      <label>{label} {required && <span className="acm-req">*</span>}</label>
      {children}
      {error && <span className="acm-field-error">{error}</span>}
    </div>
  );
}

/* Attachment link with cache-busting. The browser caches /storage/
 * URLs aggressively, so a freshly-uploaded replacement at the same
 * URL slot would otherwise show the old image. Busting on click (not
 * in href) keeps middle-click / copy-link working with a stable URL,
 * while a left-click forces a fresh fetch. */
function BustedLink({ url, path, label = 'View', className = 'acm-attach-link' }:
  { url?: string | null; path?: string | null; label?: string; className?: string }) {
  const href = url || (path ? resolveFileUrl(path) : '');
  if (!href) return <span style={{ color: '#9ca3af' }}>—</span>;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
      onClick={(e) => {
        e.preventDefault();
        const sep = href.includes('?') ? '&' : '?';
        window.open(`${href}${sep}t=${Date.now()}`, '_blank', 'noopener,noreferrer');
      }}
    >
      {label}
    </a>
  );
}

/* Truncated table cell. Empty → muted dash. Short → render as-is.
 * Long → trim with an ellipsis and wrap in the project's portal-based
 * Tooltip so the full text shows on hover (clears table overflow
 * clipping, matches the look used everywhere else in the project). */
function TruncatedCell({ text, max = 28, mono = false }: { text: string; max?: number; mono?: boolean }) {
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
}

/* ───── Scoped CSS (root: .acm-root) ───── */
const SCOPED_CSS = `
.acm-root {
  position: fixed; inset: 0; z-index: 10000;
  display: flex; align-items: center; justify-content: center;
  padding: 16px;
  background: rgba(15, 23, 42, 0.55);
  -webkit-backdrop-filter: blur(4px);
          backdrop-filter: blur(4px);
  font-family: 'DM Sans', system-ui, -apple-system, sans-serif;
  animation: acmFadeIn .25s ease;
}
@keyframes acmFadeIn { from { opacity: 0; } to { opacity: 1; } }
@keyframes acm-cust-spin { to { transform: rotate(360deg); } }
.acm-cust-spin { animation: acm-cust-spin .9s linear infinite; transform-origin: 50% 50%; }

/* Edit-mode hydration progress strip — thin indeterminate bar that
   sits above the Stage 1 form while /customers/:id resolves with
   the full record. Replaces the previous full-form skeleton which
   blocked the user from seeing the pre-filled list-row data. */
.acm-hydrate-strip {
  display: flex; align-items: center; gap: 10px;
  padding: 8px 14px;
  background: #faf7ff;
  border: 1px solid #e9e6f5;
  border-radius: 10px;
}
.acm-hydrate-strip-text {
  font-size: 11.5px; font-weight: 600; color: #6d28d9; letter-spacing: .02em;
}
.acm-hydrate-strip-bar {
  flex: 1; height: 4px; border-radius: 999px;
  background: linear-gradient(90deg,
    rgba(124,58,237,.10) 0%, rgba(124,58,237,.10) 30%,
    rgba(124,58,237,.55) 50%,
    rgba(124,58,237,.10) 70%, rgba(124,58,237,.10) 100%);
  background-size: 200% 100%;
  animation: acm-hydrate-slide 1.2s linear infinite;
}
@keyframes acm-hydrate-slide {
  0%   { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
[data-bs-theme="dark"] .acm-hydrate-strip { background: rgba(124,58,237,.10); border-color: rgba(167,139,250,.30); }
[data-bs-theme="dark"] .acm-hydrate-strip-text { color: #c4b5fd; }

.acm-root *, .acm-root *::before, .acm-root *::after { box-sizing: border-box; }

.acm-card {
  /* Stable card size: width caps at 1440, height pins at 92vh so the
     modal doesn't reflow each time the user switches between Stage 1
     sub-tabs. Clean white body (was a heavy lavender wash that made
     everything look blurred together) with a defined violet border. */
  width: 100%; max-width: 1440px;
  height: min(92vh, calc(100vh - 24px));
  background: #ffffff;
  border: 1px solid #d6c5ff;
  border-radius: 20px;
  box-shadow: 0 32px 80px -20px rgba(76,29,149,.40), 0 12px 30px rgba(15,5,40,.18);
  overflow: hidden; display: flex; flex-direction: column;
  animation: acmSlideUp .35s cubic-bezier(.34,1.56,.64,1);
}
@keyframes acmSlideUp { from { opacity: 0; transform: translateY(24px) scale(.96); } to { opacity: 1; transform: translateY(0) scale(1); } }

/* Header — solid violet gradient banner. Bold brand color carries
   the modal identity; white text + glassy icon box on top. */
.acm-header {
  position: relative;
  background: linear-gradient(135deg, #4c1d95 0%, #6d28d9 45%, #7c3aed 100%);
  padding: 18px 24px;
  display: flex; align-items: center; justify-content: space-between;
  overflow: hidden;
  flex-shrink: 0;
}
.acm-header::before {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  background-image:
    radial-gradient(ellipse at 15% 50%, rgba(167,139,250,0.30) 0%, transparent 55%),
    radial-gradient(ellipse at 85% 50%, rgba(139,92,246,0.20) 0%, transparent 55%);
}
.acm-header-left { display: flex; align-items: center; gap: 14px; position: relative; z-index: 1; }
.acm-header-icon {
  width: 42px; height: 42px; border-radius: 12px;
  background: rgba(255,255,255,0.18);
  border: 1.5px solid rgba(255,255,255,0.30);
  color: #fff;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
  -webkit-backdrop-filter: blur(6px);
  backdrop-filter: blur(6px);
  box-shadow: 0 4px 12px rgba(0,0,0,0.18);
}
.acm-title { font-size: 17px; font-weight: 800; color: #fff; letter-spacing: -.3px; line-height: 1.2; }
.acm-subtitle { font-size: 12px; color: rgba(255,255,255,0.80); margin-top: 3px; }
.acm-close {
  width: 34px; height: 34px; border-radius: 50%;
  border: 1.5px solid rgba(255,255,255,0.30);
  background: rgba(255,255,255,0.12);
  color: #fff;
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: all .25s;
  position: relative; z-index: 1;
}
.acm-close:hover { background: rgba(255,255,255,0.28); transform: rotate(90deg); }

/* ── Hydration feedback ───────────────────────────────────────────
 * A small "Loading…" pill in the modal header + an indeterminate
 * progress bar under the header so users get clear active-loading
 * feedback the moment they click Edit. Shimmer skeletons below fill
 * in the scaffold — these two cues confirm "yes, fetching now". */
.acm-loading-pill {
  display: inline-flex; align-items: center; gap: 7px;
  padding: 5px 11px; border-radius: 999px;
  background: rgba(255,255,255,.18);
  border: 1px solid rgba(255,255,255,.30);
  color: #fff;
  font-size: 11.5px; font-weight: 600; letter-spacing: .01em;
  -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px);
  position: relative; z-index: 1;
  animation: acmPillFade .2s ease both;
}
@keyframes acmPillFade { from { opacity: 0; transform: translateY(-2px) } to { opacity: 1; transform: none } }
.acm-loading-spinner {
  display: inline-flex; width: 12px; height: 12px;
  animation: acmSpin .8s linear infinite;
}
@keyframes acmSpin { to { transform: rotate(360deg); } }

.acm-top-progress {
  position: relative; height: 3px;
  background: rgba(124,58,237,.10);
  overflow: hidden; flex-shrink: 0;
}
.acm-top-progress > span {
  position: absolute; top: 0; bottom: 0; left: 0; width: 30%;
  background: linear-gradient(90deg, transparent, #7c3aed 30%, #a855f7 70%, transparent);
  border-radius: 2px;
  animation: acmTopSlide 1.1s cubic-bezier(.4,0,.2,1) infinite;
}
@keyframes acmTopSlide {
  0%   { left: -35%; }
  100% { left: 100%; }
}

/* Stepper */
.acm-stepper { padding: 16px 22px 14px; display: flex; align-items: center; gap: 0; flex-shrink: 0; background: #fff; border-bottom: 1px solid #ede9fe; }
.acm-step-connector { flex: 0 0 28px; height: 28px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; position: relative; z-index: 0; }
.acm-connector-line { width: 100%; height: 3px; background: #e2e8f0; border-radius: 3px; position: relative; overflow: hidden; }
.acm-connector-line::after { content: ''; position: absolute; inset: 0; background: linear-gradient(90deg, #10b981, #059669); border-radius: 3px; transform: scaleX(0); transform-origin: left; transition: transform .5s cubic-bezier(.4,0,.2,1); }
.acm-connector-line[data-done="1"]::after { transform: scaleX(1); }
.acm-step { flex: 1; padding: 11px 14px; border-radius: 14px; display: flex; align-items: center; gap: 12px; position: relative; overflow: hidden; transition: all .25s; cursor: pointer; min-width: 0; }
.acm-step-badge-wrap { position: relative; flex-shrink: 0; width: 40px; height: 40px; }
.acm-step-badge { width: 40px; height: 40px; border-radius: 12px; display: flex; align-items: center; justify-content: center; transition: all .25s; }
.acm-step-num { position: absolute; bottom: -4px; right: -4px; width: 18px; height: 18px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 9px; font-weight: 900; border: 2px solid #fff; line-height: 1; box-shadow: 0 1px 3px rgba(0,0,0,.15); }
.acm-step-text { min-width: 0; flex: 1; }
.acm-step-title { font-size: 12px; font-weight: 800; letter-spacing: -.2px; line-height: 1.25; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.acm-step-sub { font-size: 9.5px; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.acm-step-active { background: linear-gradient(135deg, #ede9fe 0%, #ddd6fe 100%); border: 2px solid #7c3aed; box-shadow: 0 6px 22px rgba(109,40,217,.22), 0 1px 0 rgba(255,255,255,.85) inset; }
.acm-step-active .acm-step-badge { background: linear-gradient(135deg, #7c3aed, #5b21b6); color: #fff; box-shadow: 0 5px 14px rgba(109,40,217,.48); }
.acm-step-active .acm-step-num { background: linear-gradient(135deg, #6d28d9, #4c1d95); color: #fff; }
.acm-step-active .acm-step-title { color: #2e1065; }
.acm-step-active .acm-step-sub { color: #6d28d9; }
.acm-step-done { background: linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%); border: 2px solid #10b981; box-shadow: 0 6px 20px rgba(16,185,129,.2), 0 1px 0 rgba(255,255,255,.85) inset; }
.acm-step-done .acm-step-badge { background: linear-gradient(135deg, #10b981, #047857); color: #fff; box-shadow: 0 5px 12px rgba(16,185,129,.42); }
.acm-step-done .acm-step-num { background: linear-gradient(135deg, #059669, #047857); color: #fff; }
.acm-step-done .acm-step-title { color: #065f46; }
.acm-step-done .acm-step-sub { color: #10b981; }
.acm-step-pending { background: #f8fafc; border: 1.5px solid #e2e8f0; cursor: not-allowed; opacity: .75; }
.acm-step-pending .acm-step-badge { background: linear-gradient(135deg, #f1f5f9, #e2e8f0); color: #94a3b8; border: 1px solid #e2e8f0; }
.acm-step-pending .acm-step-num { background: #e2e8f0; color: #94a3b8; }
.acm-step-pending .acm-step-title { color: #94a3b8; font-weight: 700; }
.acm-step-pending .acm-step-sub { color: #cbd5e1; }

/* Tabs */
.acm-tabs { padding: 14px 22px 14px; display: flex; gap: 8px; flex-shrink: 0; flex-wrap: wrap; background: #fff; border-bottom: 1px solid #ede9fe; }
.acm-tab { padding: 7px 18px; border-radius: 10px; border: 1.5px solid transparent; font-family: inherit; font-size: 12px; font-weight: 700; cursor: pointer; transition: all .2s; white-space: nowrap; }
.acm-tab-on { background: linear-gradient(135deg,#7c3aed,#6d28d9); color: #fff; border-color: #7c3aed; box-shadow: 0 3px 10px rgba(109,40,217,.35); }
.acm-tab-off { background: #fff; color: #6d28d9; border-color: #c4b5fd; }
.acm-tab-off:hover { background: #ede9fe; border-color: #7c3aed; }

/* Body */
.acm-body { flex: 1; overflow-y: auto; padding: 16px 22px 20px; background: #fafafd; scrollbar-width: thin; scrollbar-color: #a78bfa #ede9fe; }
.acm-body::-webkit-scrollbar { width: 6px; }
.acm-body::-webkit-scrollbar-track { background: #ede9fe; border-radius: 10px; }
.acm-body::-webkit-scrollbar-thumb { background: #a78bfa; border-radius: 10px; }

/* Section card */
.acm-section { background: #fff; border: 1.5px solid #e0d9f7; border-radius: 14px; margin-bottom: 16px; overflow: hidden; box-shadow: 0 2px 12px rgba(109,40,217,.06); }
.acm-section:last-child { margin-bottom: 0; }
.acm-section-purple { border-top: 3px solid #7c3aed; }
.acm-section-head { padding: 11px 16px; background: linear-gradient(110deg,#faf5ff 0%,#f0ebff 100%); display: flex; align-items: center; gap: 10px; border-bottom: 1px solid #ede9fe; }
.acm-section-icon { width: 28px; height: 28px; border-radius: 8px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; background: linear-gradient(135deg,#ede9fe,#ddd6fe); color: #7c3aed; border: 1px solid #c4b5fd; }
.acm-section-title { font-size: 11px; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; color: #5b21b6; }
.acm-section-sub { font-size: 11px; color: #9ca3af; font-weight: 500; display: inline-block; margin-left: 6px; }
.acm-section-body { padding: 16px; }
.acm-section-body-table { padding: 0 !important; }
.acm-section-head-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; width: 100%; }
.acm-section-head-row > div:nth-child(2) { flex: 1; min-width: 0; }

/* Forms */
.acm-row { display: grid; gap: 14px; margin-bottom: 14px; }
.acm-row:last-child { margin-bottom: 0; }
.acm-row-2 { grid-template-columns: 1fr 2fr; }
.acm-row-3 { grid-template-columns: repeat(3, 1fr); }
.acm-row-4 { grid-template-columns: repeat(4, 1fr); }
.acm-row-1 { grid-template-columns: 1fr; }
.acm-field { display: flex; flex-direction: column; min-width: 0; }
.acm-field label { font-size: 10px; font-weight: 800; letter-spacing: .09em; color: #6b7280; text-transform: uppercase; margin-bottom: 5px; }
.acm-req { color: #ef4444; font-weight: 700; }
.acm-field input, .acm-field select, .acm-field textarea {
  width: 100%; padding: 9px 12px; border: 1.5px solid #e0d9f7; border-radius: 9px;
  font-family: inherit; font-size: 12px; color: #3b0764;
  background: #fff; outline: none; transition: border-color .18s, box-shadow .18s, background .18s;
  appearance: auto; box-sizing: border-box;
}
.acm-field input:focus, .acm-field select:focus, .acm-field textarea:focus { border-color: #7c3aed; box-shadow: 0 0 0 3.5px rgba(124,58,237,.14); }
.acm-field input::placeholder { color: #c4b5fd; font-size: 11.5px; }
/* Inline validation: red ring around the input + helper text underneath.
   The MasterSelect dropdown already renders its own invalid state when
   passed invalid={true}, so this rule only targets native inputs. */
.acm-field input.acm-input-error { border-color: #ef4444; background: #fef2f2; }
.acm-field input.acm-input-error:focus { box-shadow: 0 0 0 3.5px rgba(239,68,68,.15); }
.acm-field-error { color: #ef4444; font-size: 10.5px; font-weight: 600; margin-top: 4px; letter-spacing: .02em; }

/* ── Stage 1 read-only summary (shown on Stage 2 / Stage 3) ─────────
   Dense horizontal layout — every Stage 1 field rendered as a tight
   "Label : Value" pair in a 4-column grid. No card chrome; the
   collapsible history panel above already frames the block. */
/* Comfortable breathing room around the dense 4-column grid so the
   data isn't kissing the panel borders. Horizontal padding lines up
   with the panel header's 16px gutter; vertical padding gives the
   first/last rows space from the divider line. */
.acm-hs-mirror { padding: 14px 18px 16px; }
.acm-hs-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  column-gap: 28px;
  row-gap: 13px;
}
.acm-hs-inline {
  display: flex; align-items: baseline; gap: 6px;
  font-size: 12px; min-width: 0;
  /* Hover affordance — subtle bg tint so the user knows the row is
     hover-interactive (Tooltip shows full value). */
  cursor: default; padding: 1px 2px; border-radius: 4px;
  transition: background .12s;
}
.acm-hs-inline:hover { background: rgba(124,58,237,0.06); }
.acm-hs-inline-lbl {
  color: #64748b; font-weight: 600;
  letter-spacing: .01em; white-space: nowrap; flex-shrink: 0;
}
.acm-hs-inline-val {
  color: #6d28d9; font-weight: 600;
  line-height: 1.4; min-width: 0; flex: 1 1 auto;
  /* Truncate long values to one line with an ellipsis. Full text is
     still available on hover via the project-wide Tooltip. */
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.acm-hs-inline-val.is-empty { color: #cbd5e1; font-weight: 500; }

/* Additional Address & Contact entries inside the history panel —
   each row from the Stage 1 second tab gets its own outlined block
   so the user can review every captured warehouse/billing address
   without leaving the Stage 2/3 view. */
.acm-hs-extras {
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px dashed #ddd6fe;
}
.acm-hs-extras-head {
  display: flex; align-items: center; gap: 8px;
  margin-bottom: 8px;
}
.acm-hs-extras-title {
  font-size: 11px; font-weight: 800; letter-spacing: .08em;
  text-transform: uppercase; color: #5b21b6;
}
.acm-hs-extras-badge {
  font-size: 10px; font-weight: 700;
  padding: 2px 8px; border-radius: 999px;
  background: linear-gradient(135deg, #ede9fe, #ddd6fe);
  color: #5b21b6; border: 1px solid #c4b5fd;
}
.acm-hs-extras-item {
  background: rgba(124,58,237,0.04);
  border: 1px solid rgba(124,58,237,0.18);
  border-radius: 10px;
  padding: 10px 12px;
  margin-bottom: 8px;
}
.acm-hs-extras-item:last-child { margin-bottom: 0; }
.acm-hs-extras-row {
  display: flex; align-items: center; gap: 10px;
  margin-bottom: 8px;
}
.acm-hs-extras-num {
  font-size: 10px; font-weight: 800; color: #5b21b6;
  background: #ede9fe; border: 1px solid #c4b5fd;
  padding: 2px 7px; border-radius: 999px;
}
.acm-hs-extras-type {
  font-size: 12px; font-weight: 700; color: #3b0764;
  letter-spacing: .02em;
}
.acm-hs-extras-grid { row-gap: 8px; }

/* Tiny section heading above each history block — visually separates
   the Customer Identification grid from the Address & Contact list. */
.acm-hs-section-label {
  font-size: 11px; font-weight: 800; letter-spacing: .08em;
  text-transform: uppercase; color: #5b21b6;
  margin-bottom: 10px;
}
.acm-hs-section-label:not(:first-child) { margin-top: 14px; }

/* "Primary" tag inline next to the address-type label on the first
   row of the address list. Distinguishes the form-sourced primary
   entry from the user-added additionals. */
.acm-hs-extras-primary {
  display: inline-block;
  padding: 2px 8px; border-radius: 999px;
  background: linear-gradient(135deg, #d1fae5, #a7f3d0);
  color: #065f46; border: 1px solid #6ee7b7;
  font-size: 9.5px; font-weight: 800;
  letter-spacing: .04em; text-transform: uppercase;
}

[data-bs-theme="dark"] .acm-hs-section-label { color: #ddd6fe; }
[data-bs-theme="dark"] .acm-hs-extras-primary { background: rgba(16,185,129,0.22); color: #a7f3d0; border-color: rgba(110,231,183,0.40); }

/* Dark-mode variant. */
[data-bs-theme="dark"] .acm-hs-inline:hover { background: rgba(167,139,250,0.10); }
[data-bs-theme="dark"] .acm-hs-inline-lbl { color: #94a3b8; }
[data-bs-theme="dark"] .acm-hs-inline-val { color: #c4b5fd; }
[data-bs-theme="dark"] .acm-hs-inline-val.is-empty { color: #475569; }
[data-bs-theme="dark"] .acm-hs-extras { border-top-color: rgba(167,139,250,0.25); }
[data-bs-theme="dark"] .acm-hs-extras-title { color: #ddd6fe; }
[data-bs-theme="dark"] .acm-hs-extras-badge { background: rgba(124,58,237,0.30); color: #ede9fe; border-color: rgba(167,139,250,0.45); }
[data-bs-theme="dark"] .acm-hs-extras-item { background: rgba(124,58,237,0.10); border-color: rgba(167,139,250,0.25); }
[data-bs-theme="dark"] .acm-hs-extras-num { background: rgba(167,139,250,0.22); color: #ddd6fe; border-color: rgba(167,139,250,0.45); }
[data-bs-theme="dark"] .acm-hs-extras-type { color: #f5f3ff; }

/* Narrower viewports — collapse the dense 4-col layout to 2 cols so
   labels still fit beside their values on a 3:2 ratio. */
@media (max-width: 900px) {
  .acm-hs-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
.acm-radio-row { display: flex; align-items: center; gap: 16px; padding: 9px 0; }
.acm-radio { display: inline-flex; align-items: center; gap: 6px; font-size: 11.5px; font-weight: 700; color: #6b7280; cursor: pointer; letter-spacing: .04em; user-select: none; }
.acm-radio input[type="radio"] { accent-color: #7c3aed; width: 14px; height: 14px; cursor: pointer; }

/* Footer */
.acm-footer {
  padding: 14px 22px; border-top: 1px solid rgba(167,139,250,.35);
  background: linear-gradient(180deg, rgba(255,255,255,.6) 0%, rgba(237,233,254,.92) 100%);
  display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-shrink: 0;
}
.acm-req-note { font-size: 11.5px; color: #6d28d9; font-weight: 500; display: inline-flex; align-items: center; gap: 7px; }
.acm-req-dot { width: 7px; height: 7px; border-radius: 50%; background: linear-gradient(135deg,#a78bfa,#7c3aed); box-shadow: 0 0 0 3px rgba(167,139,250,.18); }
.acm-footer-actions { display: inline-flex; align-items: center; gap: 10px; }
.acm-btn-prev, .acm-btn-next {
  padding: 9px 22px; border-radius: 10px; font-family: inherit; font-size: 12px; font-weight: 700;
  cursor: pointer; display: inline-flex; align-items: center; gap: 7px; transition: all .22s;
  letter-spacing: .02em;
}
.acm-btn-prev { border: 1.5px solid rgba(124,58,237,.3); background: rgba(255,255,255,.92); color: #5b21b6; box-shadow: 0 1px 0 rgba(255,255,255,.9) inset, 0 2px 6px rgba(124,58,237,.08); }
.acm-btn-prev:hover { background: #fff; border-color: #7c3aed; color: #4c1d95; transform: translateY(-1px); }
.acm-btn-next { border: none; background: linear-gradient(135deg,#8b5cf6 0%,#7c3aed 45%,#6d28d9 100%); color: #fff; box-shadow: 0 6px 18px -4px rgba(109,40,217,.55), 0 2px 4px rgba(76,29,149,.25), inset 0 1px 0 rgba(255,255,255,.28); }
.acm-btn-next:hover { transform: translateY(-1.5px); box-shadow: 0 10px 24px -4px rgba(109,40,217,.65); }

/* Sub-tabs (Stage 2) */
.acm-subtabs-row { display: flex; gap: 8px; margin-bottom: 16px; flex-wrap: wrap; }
.acm-subtab-pill { padding: 7px 18px; border-radius: 10px; border: 1.5px solid #c4b5fd; background: #fff; color: #6d28d9; font-family: inherit; font-size: 12px; font-weight: 700; cursor: pointer; transition: all .2s; white-space: nowrap; }
.acm-subtab-pill:hover:not(.is-active) { background: #ede9fe; }
.acm-subtab-pill.is-active { background: linear-gradient(135deg, #7c3aed, #6d28d9); color: #fff; border-color: #7c3aed; box-shadow: 0 3px 10px rgba(109,40,217,.35); }

/* Nested tabs (Stage 3) */
.acm-nested-tabs { display: flex; gap: 0; margin-bottom: 16px; border-bottom: 1.5px solid #ede9fe; padding: 0 4px; flex-wrap: wrap; }
.acm-nested-tab { padding: 10px 18px; border: none; background: transparent; color: #9ca3af; font-family: inherit; font-size: 12px; font-weight: 700; cursor: pointer; position: relative; transition: color .2s; white-space: nowrap; margin-bottom: -1.5px; }
.acm-nested-tab::after { content: ''; position: absolute; bottom: 0; left: 14px; right: 14px; height: 2.5px; background: linear-gradient(90deg, #7c3aed, #6d28d9); border-radius: 3px 3px 0 0; transform: scaleX(0); transform-origin: center; transition: transform .25s ease; }
.acm-nested-tab:hover:not(.is-active) { color: #6d28d9; }
.acm-nested-tab.is-active { color: #6d28d9; }
.acm-nested-tab.is-active::after { transform: scaleX(1); }

/* Doc toolbar */
.acm-doc-toolbar { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; padding: 12px 16px; background: linear-gradient(180deg, #faf7ff, #f5efff); border-bottom: 1px solid #ede9fe; }
.acm-doc-search { position: relative; flex: 1; max-width: 340px; min-width: 200px; }
.acm-doc-search input { width: 100%; padding: 8px 14px 8px 36px !important; border: 1.5px solid #e0d9f7 !important; border-radius: 22px !important; font-size: 12px !important; background: #fff !important; font-family: inherit; color: #3b0764; outline: none; box-sizing: border-box; }
.acm-doc-search input:focus { border-color: #7c3aed !important; box-shadow: 0 0 0 3px rgba(124,58,237,.12) !important; }
.acm-doc-search-icon { position: absolute; left: 13px; top: 50%; transform: translateY(-50%); color: #a78bfa; pointer-events: none; }
.acm-doc-count { font-size: 11.5px; color: #6d28d9; font-weight: 700; white-space: nowrap; letter-spacing: .02em; }

/* Tables — cap height + scroll the table body when there are lots of
   rows so the modal footer never gets pushed off-screen. Header strip
   stays sticky so the user always sees which column they're on. */
.acm-table-wrap {
  width: 100%;
  overflow-x: auto;
  overflow-y: auto;
  max-height: 360px;
  scrollbar-width: thin;
}
.acm-table thead th { position: sticky; top: 0; z-index: 1; }
.acm-table { width: 100%; border-collapse: collapse; font-size: 12.5px; min-width: 900px; font-family: 'DM Sans', 'Inter', system-ui, -apple-system, sans-serif; }
.acm-table thead tr { background: linear-gradient(180deg, #faf7ff, #f5efff); }
.acm-table thead th {
  padding: 14px 16px;
  text-align: left;
  font-size: 10.5px;
  font-weight: 800;
  letter-spacing: .09em;
  color: #5b21b6;
  text-transform: uppercase;
  border-bottom: 1.5px solid #e9d5ff;
  white-space: nowrap;
}
.acm-table tbody td {
  padding: 14px 16px;
  border-bottom: 1px solid #f5f3ff;
  color: #1f2937;
  vertical-align: middle;
  font-size: 12.5px;
  font-weight: 500;
  line-height: 1.45;
}
.acm-table tbody tr:last-child td { border-bottom: none; }
.acm-table tbody tr:hover td { background: #faf7ff; }
.acm-empty-row td { text-align: center; color: #9ca3af; padding: 26px 14px !important; font-size: 11.5px; font-style: italic; background: #fafaff; }
.acm-empty-row strong { color: #6d28d9; font-style: normal; }

/* Pills + chips */
.acm-doc-code {
  display: inline-block;
  padding: 4px 10px;
  border-radius: 7px;
  background: linear-gradient(135deg, #f5f3ff, #ede9fe);
  color: #5b21b6;
  font-family: ui-monospace, 'JetBrains Mono', monospace;
  font-size: 11.5px;
  font-weight: 700;
  border: 1px solid #c4b5fd;
  letter-spacing: .02em;
  white-space: nowrap;
}
.acm-status-toggle { display: inline-flex; gap: 6px; align-items: center; }
.acm-status-mandatory, .acm-status-optional { display: inline-flex; align-items: center; gap: 4px; padding: 3px 10px; border-radius: 20px; font-size: 10.5px; font-weight: 700; border: 1px solid transparent; }
.acm-status-mandatory { background: #f5f3ff; color: #9ca3af; border-color: #e5e1f3; }
.acm-status-mandatory.is-on { background: linear-gradient(135deg, #dcfce7, #bbf7d0); color: #15803d; border-color: #86efac; }
.acm-status-optional { background: #fff; color: #9ca3af; border-color: #e5e1f3; }
.acm-status-optional.is-on { background: #fff; color: #374151; border-color: #9ca3af; font-weight: 700; }
.acm-status-active { display: inline-flex; align-items: center; gap: 5px; padding: 3px 11px; border-radius: 20px; font-size: 10.5px; font-weight: 700; background: linear-gradient(135deg, #dcfce7, #bbf7d0); color: #15803d; border: 1px solid #86efac; }
.acm-expiry-na, .acm-expiry-date, .acm-expiry-varies, .acm-expiry-future, .acm-expiry-past, .acm-issue-date {
  display: inline-block;
  padding: 4px 12px;
  border-radius: 20px;
  font-size: 11px;
  font-weight: 700;
  white-space: nowrap;
  letter-spacing: .02em;
}
.acm-expiry-na     { background: #f3f4f6; color: #6b7280; border: 1px solid #e5e7eb; }
.acm-issue-date    { background: linear-gradient(135deg,#e0e7ff,#c7d2fe); color: #3730a3; border: 1px solid #a5b4fc; }
.acm-expiry-future { background: linear-gradient(135deg,#d1fae5,#a7f3d0); color: #047857; border: 1px solid #6ee7b7; }
.acm-expiry-past   { background: linear-gradient(135deg,#fee2e2,#fecaca); color: #b91c1c; border: 1px solid #fca5a5; }
/* Legacy class — used by the design-only Trade Licence placeholder
   table. Kept around so old data still renders consistently with the
   new contextual colours; treats any non-empty date as future. */
.acm-expiry-date   { background: linear-gradient(135deg,#d1fae5,#a7f3d0); color: #047857; border: 1px solid #6ee7b7; }
.acm-expiry-varies { background: linear-gradient(135deg,#fef3c7,#fde68a); color: #92400e; border: 1px solid #fcd34d; }

/* Action buttons */
.acm-row-actions { display: inline-flex; gap: 4px; }
.acm-row-btn { width: 26px; height: 26px; border-radius: 7px; border: 1px solid #e0d9f7; background: #fff; color: #7c3aed; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; padding: 0; }
.acm-row-btn:hover { background: #ede9fe; border-color: #c4b5fd; }
.acm-row-btn-del { color: #ef4444; }
.acm-row-btn-del:hover { background: #fee2e2; border-color: #fca5a5; }
.acm-doc-action { width: 28px; height: 28px; border-radius: 7px; border: 1.5px solid; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; padding: 0; transition: all .15s; }
.acm-doc-action-upload { border-color: #bae6fd; background: linear-gradient(135deg, #f0f9ff, #e0f2fe); color: #0284c7; }
.acm-doc-action-upload:hover { background: linear-gradient(135deg, #0ea5e9, #0284c7); color: #fff; border-color: #0284c7; }
.acm-doc-action-download { border-color: #bbf7d0; background: linear-gradient(135deg, #f0fdf4, #dcfce7); color: #16a34a; }
.acm-doc-action-download:hover { background: linear-gradient(135deg, #22c55e, #16a34a); color: #fff; border-color: #16a34a; }
.acm-doc-action-view { border-color: #c4b5fd; background: linear-gradient(135deg, #f5f3ff, #ede9fe); color: #6d28d9; }
.acm-doc-action-view:hover { background: linear-gradient(135deg, #a78bfa, #7c3aed); color: #fff; }

/* Whatsapp pills in tables */
.acm-pill-yes, .acm-pill-no { display: inline-block; padding: 2px 9px; border-radius: 20px; font-size: 10px; font-weight: 700; }
.acm-pill-yes { background: linear-gradient(135deg,#dcfce7,#bbf7d0); color: #15803d; border: 1px solid #86efac; }
.acm-pill-no { background: linear-gradient(135deg,#fee2e2,#fecaca); color: #b91c1c; border: 1px solid #fca5a5; }

/* Primary row marker in the Address & Contact Details table — the
   row sourced from Stage 1's "PRIMARY ADDRESS & CONTACT PERSON"
   section. Subtle violet wash + a small Primary tag so users can
   distinguish it from rows added via "+ Add More Address & Contact". */
.acm-primary-row td { background: linear-gradient(180deg, #faf7ff, #f5efff); }
.acm-primary-row:hover td { background: #f3edff; }
.acm-type-cell { display: inline-flex; align-items: center; gap: 7px; flex-wrap: wrap; }
.acm-primary-tag { display: inline-block; padding: 2px 8px; border-radius: 20px; font-size: 9.5px; font-weight: 800; letter-spacing: .04em; text-transform: uppercase; background: linear-gradient(135deg, #ede9fe, #ddd6fe); color: #5b21b6; border: 1px solid #c4b5fd; }

/* Add pill button */
.acm-add-pill { display: inline-flex; align-items: center; gap: 5px; padding: 6px 14px; border-radius: 20px; border: 1px solid #c4b5fd; background: #fff; color: #6d28d9; font-family: inherit; font-size: 11.5px; font-weight: 700; cursor: pointer; transition: all .18s; white-space: nowrap; box-shadow: 0 2px 6px rgba(109,40,217,.1); flex-shrink: 0; }
.acm-add-pill:hover { background: linear-gradient(135deg, #7c3aed, #6d28d9); color: #fff; border-color: #7c3aed; transform: translateY(-1px); }

/* Pagination */
.acm-doc-pag-wrap { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 11px 16px; border-top: 1px solid #ede9fe; background: #fafafd; flex-wrap: wrap; }
.acm-doc-pag-info { font-size: 11px; color: #6b7280; font-weight: 500; }
.acm-pagination { display: inline-flex; gap: 4px; }
.acm-page-btn { min-width: 28px; height: 28px; padding: 0 8px; border-radius: 7px; border: 1px solid #e5e1f3; background: #fff; color: #6b7280; font-family: inherit; font-size: 11.5px; font-weight: 700; cursor: pointer; transition: all .15s; }
.acm-page-btn:hover:not(.is-active):not(:disabled) { border-color: #c4b5fd; color: #6d28d9; background: #f5f3ff; }
.acm-page-btn.is-active { background: linear-gradient(135deg, #7c3aed, #6d28d9); color: #fff; border-color: #7c3aed; }
.acm-page-btn:disabled { opacity: .4; cursor: not-allowed; }

/* Attachment link */
.acm-attach-link {
  display: inline-flex; align-items: center; gap: 5px;
  color: #7c3aed; font-family: inherit;
  font-size: 12px; font-weight: 700;
  cursor: pointer; background: none; border: none; padding: 0;
  text-decoration: none;
}
.acm-attach-link:hover { color: #5b21b6; text-decoration: underline; }

/* Trade docs table */
.acm-td-table col.col-srno { width: 52px; }
.acm-td-table col.col-docname { width: 30%; }
.acm-td-table col.col-sig { width: 220px; }
.acm-td-table col.col-status { width: 130px; }
.acm-td-table col.col-actions { width: 90px; }
.acm-td-table td.td-status, .acm-td-table th.th-status, .acm-td-table td.td-actions, .acm-td-table th.th-actions { text-align: center; }
.acm-td-check-label { display: inline-flex; align-items: center; gap: 8px; cursor: pointer; font-family: inherit; font-size: 9px; font-weight: 800; letter-spacing: .1em; color: #6b7280; text-transform: uppercase; user-select: none; }
.acm-td-check-label input[type="checkbox"] { accent-color: #7c3aed; width: 15px; height: 15px; margin: 0; cursor: pointer; }
.acm-td-cell-check { display: flex; align-items: center; gap: 10px; }
.acm-td-cell-check > input[type="checkbox"] { width: 15px; height: 15px; accent-color: #7c3aed; cursor: pointer; margin: 0; }
.acm-btn-resend { display: inline-flex; align-items: center; gap: 5px; padding: 4px 12px; border-radius: 20px; border: 1.5px solid #7c3aed; background: linear-gradient(135deg, #7c3aed, #6d28d9); color: #fff; font-family: inherit; font-size: 10.5px; font-weight: 700; cursor: pointer; white-space: nowrap; }
.acm-btn-send { display: inline-flex; align-items: center; gap: 5px; padding: 4px 12px; border-radius: 20px; border: 1.5px solid #7c3aed; background: #fff; color: #6d28d9; font-family: inherit; font-size: 10.5px; font-weight: 700; cursor: pointer; white-space: nowrap; }
.acm-btn-send:hover { background: linear-gradient(135deg, #7c3aed, #6d28d9); color: #fff; }
.acm-td-actions { display: flex; justify-content: center; align-items: center; gap: 14px; padding: 16px; border-top: 1px solid #ede9fe; background: linear-gradient(180deg, #faf7ff, #f5efff); flex-wrap: wrap; }
.acm-btn-purple-lg { padding: 9px 20px; border-radius: 10px; border: none; background: linear-gradient(135deg, #7c3aed, #6d28d9); color: #fff; font-family: inherit; font-size: 12px; font-weight: 700; cursor: pointer; display: inline-flex; align-items: center; gap: 7px; box-shadow: 0 4px 12px rgba(109,40,217,.38); }
.acm-btn-purple-lg-out { padding: 9px 20px; border-radius: 10px; border: 1.5px solid #c4b5fd; background: #fff; color: #6d28d9; font-family: inherit; font-size: 12px; font-weight: 700; cursor: pointer; display: inline-flex; align-items: center; gap: 7px; }
.acm-btn-purple-lg-out:hover { background: #ede9fe; }

/* Sub-modals */
.acm-sub-modal { position: fixed; inset: 0; z-index: 10001; display: flex; align-items: center; justify-content: center; padding: 18px; background: rgba(20,20,30,.45); -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px); }
.acm-sub-card { width: 100%; max-width: 880px; max-height: calc(100vh - 36px); background: #fff; border: 1px solid #e9e6f5; border-radius: 14px; overflow: hidden; display: flex; flex-direction: column; box-shadow: 0 20px 56px -16px rgba(15,15,30,.32), 0 8px 24px rgba(15,15,30,.14); animation: acmSlideUp .3s cubic-bezier(.34,1.56,.64,1); }
.acm-sub-header { background: linear-gradient(110deg, #7c3aed 0%, #8b5cf6 60%, #a78bfa 100%); padding: 14px 22px; display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; }
.acm-sub-title { font-size: 16px; font-weight: 800; color: #fff; letter-spacing: -.3px; }
.acm-sub-title-accent { color: #fff; }
.acm-sub-close { width: 30px; height: 30px; border-radius: 50%; border: 1.5px solid rgba(255,255,255,.4); background: rgba(255,255,255,.15); color: #fff; cursor: pointer; display: flex; align-items: center; justify-content: center; padding: 0; }
.acm-sub-close:hover { background: rgba(255,255,255,.32); transform: rotate(90deg); }
.acm-sub-body { flex: 1; padding: 20px 24px; overflow-y: auto; background: linear-gradient(180deg, #fff 0%, #fbfaff 100%); }
.acm-sub-footer { padding: 14px 22px; display: flex; justify-content: center; gap: 12px; border-top: 1px solid #efeaf9; background: #faf9fd; flex-shrink: 0; }
.acm-btn-save { padding: 7px 18px; border-radius: 9px; border: none; background: linear-gradient(135deg, #7c3aed, #5b21b6); color: #fff; font-family: inherit; font-size: 11.5px; font-weight: 700; cursor: pointer; box-shadow: 0 3px 10px rgba(109,40,217,.35); }

/* "Add New Document / License" popup — clean white card with no
   internal section borders (header/body/footer all one continuous
   surface) to match the design mock. */
.acm-doc-sub-card { max-width: 920px; border-radius: 18px; background: #fff !important; box-shadow: 0 24px 60px -16px rgba(15,15,30,.32), 0 8px 24px rgba(15,15,30,.14); }
/* Purple gradient header strip — visually ties the sub-modal back to
   the parent Add Customer modal which uses the same palette. */
.acm-doc-sub-header {
  background: linear-gradient(135deg, #4c1d95 0%, #6d28d9 35%, #7c3aed 70%, #8b5cf6 100%) !important;
  border-bottom: none; padding: 16px 26px; justify-content: center; position: relative;
}
.acm-doc-sub-title { color: #fff; font-size: 17px; font-weight: 800; letter-spacing: -.2px; }
/* Close button: translucent white pill, sits over the colored header
   so it stays visible against the gradient. Keyed off the header
   class (not the card) so the rule applies to every sub-modal that
   uses acm-doc-sub-header — Add Document / License, Add Document
   Type, Owner Due Diligence, and Location & Contact. */
.acm-doc-sub-header .acm-sub-close {
  position: absolute; top: 50%; right: 18px; transform: translateY(-50%);
  width: 32px; height: 32px; border-radius: 50%;
  background: rgba(255,255,255,0.15) !important; border: 1px solid rgba(255,255,255,0.35) !important;
  color: #fff !important;
  z-index: 2;
}
.acm-doc-sub-header .acm-sub-close:hover { background: rgba(255,255,255,0.28) !important; transform: translateY(-50%) rotate(90deg); }
.acm-doc-sub-card .acm-sub-body { background: #fff !important; padding: 18px 26px 8px; }
.acm-doc-sub-footer { background: #fff !important; border-top: none; padding: 6px 22px 22px; }
/* Field labels inside this popup adopt a darker / tighter style than
   the main modal (closer to the dark-on-white look in the mock). */
.acm-doc-sub-body .acm-field label { color: #475569; font-size: 10.5px; font-weight: 700; letter-spacing: .1em; }
.acm-doc-sub-body .acm-field input,
.acm-doc-sub-body .acm-field textarea {
  border: 1.5px solid #e9d5ff; border-radius: 10px; padding: 10px 12px; font-size: 12.5px;
  color: #3b0764; background: #fff;
}
.acm-doc-sub-body .acm-field input::placeholder,
.acm-doc-sub-body .acm-field textarea::placeholder { color: #c4b5fd; font-weight: 400; }
.acm-doc-sub-body .acm-field input:focus,
.acm-doc-sub-body .acm-field textarea:focus { border-color: #7c3aed; box-shadow: 0 0 0 3.5px rgba(124,58,237,.12); }
/* Cancel: white pill, violet border + violet text. Matches the mock. */
.acm-doc-sub-footer .acm-btn-mini-cancel {
  background: #fff; border: 1.5px solid #c4b5fd; color: #7c3aed;
  padding: 9px 22px; border-radius: 9px; font-weight: 700; font-size: 12px; cursor: pointer;
}
.acm-doc-sub-footer .acm-btn-mini-cancel:hover { background: #faf5ff; }
/* Save: same purple gradient as the header strip so the two
   "branded" surfaces of the popup visually agree. */
.acm-doc-save {
  background: linear-gradient(135deg, #4c1d95 0%, #6d28d9 35%, #7c3aed 70%, #8b5cf6 100%) !important;
  box-shadow: 0 4px 12px rgba(109,40,217,.35);
  padding: 9px 44px !important; min-width: 120px; font-size: 12px !important;
}
.acm-doc-save:hover { filter: brightness(1.08); box-shadow: 0 6px 16px rgba(109,40,217,.45); }
/* Doc-name field: dropdown + a `+` square button that opens the
   "Add New Document Type" secondary popup. */
.acm-doc-name-row { display: flex; align-items: stretch; gap: 8px; }
.acm-doc-plus-btn {
  flex-shrink: 0; width: 38px; height: 38px; border-radius: 9px;
  border: 1.5px solid #c4b5fd; background: #faf5ff; color: #7c3aed;
  cursor: pointer; display: inline-flex; align-items: center; justify-content: center;
  transition: background .15s, border-color .15s;
}
.acm-doc-plus-btn:hover { background: #ede9fe; border-color: #7c3aed; }
/* Attachment field renders as a same-height pill with a paperclip
   icon and "ATTACH FILE" label so it visually balances with the
   adjacent inputs in the bottom row. */
.acm-doc-attach {
  display: inline-flex; align-items: center; gap: 8px;
  height: 40px; padding: 0 14px; width: 100%;
  border: 1.5px solid #e9d5ff; border-radius: 10px;
  background: #fff; color: #475569; cursor: pointer;
  font-size: 11.5px; font-weight: 700; letter-spacing: .08em;
}
.acm-doc-attach:hover { border-color: #7c3aed; background: #faf7ff; color: #7c3aed; }
.acm-doc-attach-label { font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }

/* ───── KYC file slot ─────
   Used for the attachment in Document/License sub-modal and for the 3
   identity-proof fields in the Owner KYC sub-modal. Three visual modes:
   drop zone (no file), chip (file picked or existing), or muted notice
   (existing flagged for removal). */
.acm-fileslot-drop {
  display: inline-flex; align-items: center; gap: 8px;
  width: 100%; height: 40px;
  padding: 0 12px;
  border: 1.5px dashed #c4b5fd; border-radius: 10px;
  background: #faf7ff; color: #6d28d9;
  cursor: pointer; transition: all .18s;
  font-family: inherit;
  white-space: nowrap;
  overflow: hidden;
}
.acm-fileslot-drop:hover { border-color: #7c3aed; background: #ede9fe; }
.acm-fileslot-drop.acm-input-error { border-color: #ef4444; background: #fef2f2; }
.acm-fileslot-drop-icon { display: inline-flex; flex-shrink: 0; color: #7c3aed; }
.acm-fileslot-drop-title { font-size: 12px; font-weight: 700; color: #5b21b6; flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.acm-fileslot-drop-size {
  flex-shrink: 0;
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(124,58,237,0.10);
  color: #6d28d9;
  font-size: 10px; font-weight: 700;
  letter-spacing: .03em;
}

.acm-fileslot-chip {
  display: flex; align-items: center; gap: 8px;
  width: 100%; min-height: 40px; padding: 6px 8px 6px 10px;
  border: 1.5px solid #e0d9f7; border-radius: 10px;
  background: #fff;
}
.acm-fileslot-chip.is-existing { border-color: #c4b5fd; background: linear-gradient(180deg, #faf7ff, #f5efff); }
.acm-fileslot-chip.is-new      { border-color: #86efac; background: linear-gradient(180deg, #f0fdf4, #ecfdf5); }
.acm-fileslot-icon {
  width: 26px; height: 26px; border-radius: 7px;
  display: inline-flex; align-items: center; justify-content: center;
  background: #ede9fe; color: #6d28d9; flex-shrink: 0;
}
.acm-fileslot-chip.is-new .acm-fileslot-icon { background: #d1fae5; color: #047857; }
.acm-fileslot-name {
  flex: 1; min-width: 0;
  font-size: 11.5px; color: #3b0764; font-weight: 600;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.acm-fileslot-actions { display: inline-flex; gap: 4px; flex-shrink: 0; }
.acm-fileslot-btn {
  width: 26px; height: 26px; border-radius: 7px;
  border: 1px solid #e0d9f7; background: #fff;
  color: #7c3aed; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
  padding: 0; transition: all .15s;
}
.acm-fileslot-btn:hover:not(:disabled) { background: #ede9fe; border-color: #c4b5fd; }
.acm-fileslot-btn:disabled { opacity: .45; cursor: not-allowed; }
.acm-fileslot-btn-view { border-color: #c4b5fd; background: linear-gradient(135deg, #f5f3ff, #ede9fe); color: #6d28d9; }
.acm-fileslot-btn-view:hover:not(:disabled) { background: linear-gradient(135deg, #a78bfa, #7c3aed); color: #fff; border-color: #7c3aed; }
.acm-fileslot-btn-del { color: #ef4444; }
.acm-fileslot-btn-del:hover:not(:disabled) { background: #fee2e2; border-color: #fca5a5; }

.acm-fileslot-removed {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  width: 100%; min-height: 40px; padding: 6px 8px 6px 12px;
  border: 1.5px dashed #fca5a5; border-radius: 10px;
  background: #fef2f2;
}
.acm-fileslot-removed-text { font-size: 11.5px; color: #b91c1c; font-weight: 600; }

/* Dark-mode variants */
[data-bs-theme="dark"] .acm-fileslot-drop { background: rgba(124,58,237,0.10); border-color: rgba(167,139,250,0.40); color: #c4b5fd; }
[data-bs-theme="dark"] .acm-fileslot-drop:hover { background: rgba(124,58,237,0.18); border-color: #a78bfa; }
[data-bs-theme="dark"] .acm-fileslot-drop-title { color: #ddd6fe; }
[data-bs-theme="dark"] .acm-fileslot-drop-size { background: rgba(167,139,250,0.22); color: #ddd6fe; }
[data-bs-theme="dark"] .acm-fileslot-chip { background: #11182a; border-color: rgba(255,255,255,0.10); }
[data-bs-theme="dark"] .acm-fileslot-chip.is-existing { background: rgba(124,58,237,0.10); border-color: rgba(167,139,250,0.30); }
[data-bs-theme="dark"] .acm-fileslot-chip.is-new { background: rgba(16,185,129,0.10); border-color: rgba(110,231,183,0.40); }
[data-bs-theme="dark"] .acm-fileslot-icon { background: rgba(167,139,250,0.22); color: #c4b5fd; }
[data-bs-theme="dark"] .acm-fileslot-chip.is-new .acm-fileslot-icon { background: rgba(16,185,129,0.22); color: #6ee7b7; }
[data-bs-theme="dark"] .acm-fileslot-name { color: #ecfdf5; }
[data-bs-theme="dark"] .acm-fileslot-btn { background: rgba(255,255,255,0.04); border-color: rgba(255,255,255,0.12); color: #c4b5fd; }
[data-bs-theme="dark"] .acm-fileslot-btn:hover:not(:disabled) { background: rgba(167,139,250,0.18); border-color: rgba(167,139,250,0.40); }
[data-bs-theme="dark"] .acm-fileslot-btn-del { color: #fca5a5; }
[data-bs-theme="dark"] .acm-fileslot-btn-del:hover:not(:disabled) { background: rgba(239,68,68,0.18); border-color: rgba(252,165,165,0.50); }
[data-bs-theme="dark"] .acm-fileslot-removed { background: rgba(239,68,68,0.10); border-color: rgba(252,165,165,0.40); }
[data-bs-theme="dark"] .acm-fileslot-removed-text { color: #fca5a5; }

/* "Add Document Type" master popup — sits above the Add Document /
   License sub-modal at z-index 10002. Header is left-aligned (icon
   + title + subtitle), unlike the centered title used elsewhere. */
.acm-doc-type-sub-modal { z-index: 10002; }
.acm-doc-type-card { max-width: 760px; border-radius: 18px; }
.acm-doc-type-master-card { max-width: 560px; border-radius: 18px; }
.acm-doc-type-master-head { justify-content: space-between !important; padding: 18px 24px !important; }
.acm-doc-type-master-head-left { display: flex; align-items: center; gap: 14px; }
.acm-doc-type-master-icon {
  width: 44px; height: 44px; border-radius: 12px;
  background: rgba(255,255,255,0.20); border: 1px solid rgba(255,255,255,0.35);
  display: inline-flex; align-items: center; justify-content: center;
  color: #fff; flex-shrink: 0;
}
.acm-doc-type-master-sub { font-size: 11px; color: rgba(255,255,255,0.85); margin-top: 3px; }
.acm-doc-type-master-body { padding: 18px 24px 4px !important; }
.acm-doc-type-master-body .acm-row { margin-bottom: 14px; }
.acm-doc-type-master-footer { padding: 8px 24px 22px !important; justify-content: flex-end !important; }
/* Save Document Type button — dark-navy gradient with save icon, the
   "premium master" look from the design spec (not the violet save
   used elsewhere on this modal). */
.acm-doc-type-master-save {
  background: linear-gradient(135deg, #1e3a8a 0%, #1e40af 60%, #2563eb 100%) !important;
  display: inline-flex !important; align-items: center; gap: 8px;
  min-width: 200px;
}
.acm-doc-type-master-save:hover { filter: brightness(1.1); }
[data-bs-theme="dark"] .acm-doc-type-master-save {
  background: linear-gradient(135deg, #0f172a 0%, #1e3a8a 60%, #1e40af 100%) !important;
}
.acm-doc-type-body { padding: 24px 28px 12px; }
.acm-doc-type-row { display: grid; grid-template-columns: 200px 1fr; align-items: start; gap: 16px; margin-bottom: 18px; }
.acm-doc-type-row:last-child { margin-bottom: 0; }
.acm-doc-type-label { font-size: 13px; font-weight: 700; color: #4338ca; padding-top: 6px; }
.acm-doc-type-input-wrap { min-width: 0; }
.acm-doc-type-input-wrap input,
.acm-doc-type-input-wrap textarea {
  width: 100%; padding: 6px 2px; font-family: inherit; font-size: 13px; color: #3b0764;
  background: transparent; outline: none; border: none;
  border-bottom: 1px solid #e2e8f0; border-radius: 0;
  transition: border-color .18s;
  resize: vertical;
}
.acm-doc-type-input-wrap input:focus,
.acm-doc-type-input-wrap textarea:focus { border-bottom-color: #7c3aed; box-shadow: none; }
.acm-doc-type-input-wrap input::placeholder,
.acm-doc-type-input-wrap textarea::placeholder { color: #cbd5e1; font-size: 12.5px; }

/* ── Dark-mode variants ─────────────────────────────────────────────
   Both document popups (Add New Document / License + Add New Document
   Type) flip to a deep slate surface when the page has data-bs-theme
   set to "dark", matching the rest of the app's dark palette.        */
[data-bs-theme="dark"] .acm-doc-sub-card,
[data-bs-theme="dark"] .acm-doc-type-card {
  background: #11182a !important;
  border: 1px solid rgba(255,255,255,0.08);
  box-shadow: 0 24px 60px -16px rgba(0,0,0,.65), 0 8px 24px rgba(0,0,0,.45);
}
/* Dark mode keeps the purple header strip — just deepens the gradient
   slightly so it reads on the darker surrounding chrome. */
[data-bs-theme="dark"] .acm-doc-sub-header {
  background: linear-gradient(135deg, #2e1065 0%, #4c1d95 35%, #6d28d9 70%, #7c3aed 100%) !important;
}
[data-bs-theme="dark"] .acm-doc-sub-title { color: #fff; }
[data-bs-theme="dark"] .acm-doc-sub-header .acm-sub-close {
  background: rgba(255,255,255,0.15) !important;
  border-color: rgba(255,255,255,0.35) !important;
  color: #fff !important;
}
[data-bs-theme="dark"] .acm-doc-sub-header .acm-sub-close:hover { background: rgba(255,255,255,0.28) !important; }
[data-bs-theme="dark"] .acm-doc-sub-card .acm-sub-body { background: #11182a !important; }
[data-bs-theme="dark"] .acm-doc-sub-footer { background: #11182a !important; }
[data-bs-theme="dark"] .acm-doc-sub-body .acm-field label { color: #94a3b8; }
[data-bs-theme="dark"] .acm-doc-sub-body .acm-field input,
[data-bs-theme="dark"] .acm-doc-sub-body .acm-field textarea {
  background: #1c2531;
  border-color: rgba(167,139,250,0.30);
  color: #f1f5f9;
}
[data-bs-theme="dark"] .acm-doc-sub-body .acm-field input::placeholder,
[data-bs-theme="dark"] .acm-doc-sub-body .acm-field textarea::placeholder { color: #64748b; }
[data-bs-theme="dark"] .acm-doc-sub-body .acm-field input:focus,
[data-bs-theme="dark"] .acm-doc-sub-body .acm-field textarea:focus { border-color: #a78bfa; box-shadow: 0 0 0 3.5px rgba(167,139,250,.18); }
[data-bs-theme="dark"] .acm-doc-sub-footer .acm-btn-mini-cancel {
  background: transparent; border-color: rgba(167,139,250,0.45); color: #c4b5fd;
}
[data-bs-theme="dark"] .acm-doc-sub-footer .acm-btn-mini-cancel:hover { background: rgba(167,139,250,0.12); }
/* Dark mode: keep the violet gradient (matches the dark-mode header)
   but deepen it slightly to read against the slate card surface. */
[data-bs-theme="dark"] .acm-doc-save {
  background: linear-gradient(135deg, #2e1065 0%, #4c1d95 35%, #6d28d9 70%, #7c3aed 100%) !important;
  color: #fff !important;
  box-shadow: 0 4px 12px rgba(0,0,0,.55);
}
[data-bs-theme="dark"] .acm-doc-save:hover { filter: brightness(1.15); }
[data-bs-theme="dark"] .acm-doc-plus-btn {
  background: rgba(167,139,250,0.10);
  border-color: rgba(167,139,250,0.45);
  color: #c4b5fd;
}
[data-bs-theme="dark"] .acm-doc-plus-btn:hover { background: rgba(167,139,250,0.20); border-color: #a78bfa; color: #ede9fe; }
[data-bs-theme="dark"] .acm-doc-attach {
  background: #1c2531; border-color: rgba(167,139,250,0.30); color: #94a3b8;
}
[data-bs-theme="dark"] .acm-doc-attach:hover { border-color: #a78bfa; background: rgba(167,139,250,0.10); color: #ede9fe; }
/* "Add New Document Type" — underline-style inputs flip to a lighter
   slate underline on a dark surface. */
[data-bs-theme="dark"] .acm-doc-type-label { color: #c4b5fd; }
[data-bs-theme="dark"] .acm-doc-type-input-wrap input,
[data-bs-theme="dark"] .acm-doc-type-input-wrap textarea {
  background: transparent; color: #f1f5f9;
  border-bottom-color: rgba(255,255,255,0.10);
}
[data-bs-theme="dark"] .acm-doc-type-input-wrap input:focus,
[data-bs-theme="dark"] .acm-doc-type-input-wrap textarea:focus { border-bottom-color: #a78bfa; }
[data-bs-theme="dark"] .acm-doc-type-input-wrap input::placeholder,
[data-bs-theme="dark"] .acm-doc-type-input-wrap textarea::placeholder { color: #475569; }
.acm-btn-save:hover { background: linear-gradient(135deg, #6d28d9, #4c1d95); transform: translateY(-1px); }
.acm-btn-mini-cancel { padding: 7px 18px; border-radius: 9px; border: 1.5px solid rgba(124,58,237,.3); background: #fff; color: #5b21b6; font-family: inherit; font-size: 11.5px; font-weight: 700; cursor: pointer; }
.acm-btn-mini-cancel:hover { border-color: #7c3aed; }

/* Radio pills */
.acm-radio-pills { display: inline-flex; gap: 10px; flex-wrap: wrap; }
.acm-radio-pill { display: inline-flex; align-items: center; gap: 8px; padding: 8px 18px; border: 1.5px solid #e5e1f3; border-radius: 9px; background: #fff; cursor: pointer; font-size: 12px; font-weight: 700; color: #6b7280; user-select: none; }
.acm-radio-pill input[type="radio"] { accent-color: #7c3aed; width: 13px; height: 13px; margin: 0; }
.acm-radio-pill.is-active { border-color: #7c3aed; background: #f5f3ff; color: #5b21b6; box-shadow: 0 0 0 3px rgba(124,58,237,.10); }

/* History panel */
.acm-history { margin: 10px 22px 0; border-radius: 12px; border: 1.5px solid #c4b5fd; background: #fff; overflow: hidden; box-shadow: 0 2px 12px rgba(109,40,217,.09); flex-shrink: 0; max-height: 46px; transition: max-height .38s cubic-bezier(.4,0,.2,1); }
/* Expanded panel needs room for the 5-row inline grid + breathing
   padding; below 900px the grid collapses to 2 cols (9-10 rows) so
   the body keeps scrolling for narrow viewports. */
.acm-history.acm-hist-open { max-height: 340px; }
.acm-history-header { height: 46px; box-sizing: border-box; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 0 16px; cursor: pointer; background: linear-gradient(110deg, #f5f3ff 0%, #ede9fe 100%); border-left: 4px solid #7c3aed; user-select: none; }
.acm-history-header:hover { background: linear-gradient(110deg, #ede9fe, #ddd6fe); }
.acm-history-header-left { display: flex; align-items: center; gap: 10px; min-width: 0; }
.acm-history-icon { width: 28px; height: 28px; border-radius: 8px; background: linear-gradient(135deg, #7c3aed, #5b21b6); color: #fff; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.acm-history-title { font-size: 12px; font-weight: 800; color: #3b0764; white-space: nowrap; }
.acm-history-meta { font-size: 9.5px; color: #7c3aed; margin-top: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.acm-history-actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.acm-history-badge { padding: 3px 11px; border-radius: 20px; background: linear-gradient(135deg, #7c3aed, #6d28d9); color: #fff; font-size: 9.5px; font-weight: 800; white-space: nowrap; }
.acm-history-chevron { width: 22px; height: 22px; border-radius: 50%; background: rgba(124,58,237,.12); display: flex; align-items: center; justify-content: center; color: #7c3aed; transition: transform .3s; }
.acm-history-chevron.acm-open { transform: rotate(180deg); }
.acm-history-body { overflow-y: auto; max-height: calc(340px - 46px); border-top: 1px solid #ede9fe; }
.acm-hs-block { padding: 12px 16px 10px; border-bottom: 1px solid #f3f0fb; }
.acm-hs-block:last-child { border-bottom: none; }
.acm-hs-header { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.acm-hs-num { width: 20px; height: 20px; border-radius: 50%; background: linear-gradient(135deg, #10b981, #047857); color: #fff; font-size: 8px; font-weight: 900; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.acm-hs-title { font-size: 10px; font-weight: 800; color: #065f46; text-transform: uppercase; letter-spacing: .08em; }
.acm-hs-divider { flex: 1; height: 1px; background: linear-gradient(90deg, #bbf7d0, transparent); }
.acm-hs-group { margin-bottom: 9px; }
.acm-hs-group:last-child { margin-bottom: 0; }
.acm-hs-group-label { font-size: 8.5px; font-weight: 800; color: #a78bfa; text-transform: uppercase; letter-spacing: .1em; margin-bottom: 5px; padding-bottom: 4px; border-bottom: 1px dashed #ede9fe; }
/* Legacy .acm-hs-field / .acm-hs-fields / etc. styles for the old
   per-field pill summary were removed once HistoryStage1 switched to
   the dense inline "Label : Value" grid (see .acm-hs-inline above).
   Only the Stage 2 doc-counter stats below remain in use. */
.acm-hs-stats { display: grid; grid-template-columns: repeat(4,1fr); gap: 6px; }
.acm-hs-stat { background: linear-gradient(135deg, #f5f3ff, #ede9fe); border: 1px solid #ddd6fe; border-radius: 8px; padding: 6px 10px; text-align: center; }
.acm-hs-stat-num { font-size: 14px; font-weight: 900; color: #5b21b6; line-height: 1; }
.acm-hs-stat-lbl { font-size: 8px; font-weight: 700; color: #7c3aed; text-transform: uppercase; letter-spacing: .07em; margin-top: 2px; }

@media (max-width: 900px) {
  .acm-card { max-width: 100%; }
  .acm-row-3, .acm-row-4 { grid-template-columns: repeat(2, 1fr); }
}
@media (max-width: 680px) {
  .acm-row-2, .acm-row-3, .acm-row-4 { grid-template-columns: 1fr; }
  .acm-stepper { overflow-x: auto; }
  .acm-step { min-width: 200px; flex: 0 0 auto; }
}

/* ════════════════════════════════════════════════════════════════════
   DARK MODE — premium dark palette for the whole Add/Edit Customer
   modal. Triggered by [data-bs-theme="dark"] (the project's standard).
   Palette:
     #0b1220 — modal card base (deepest)
     #11182a — section / surface
     #1c2531 — input / cell
     #0f172a — borders / dividers
     #f1f5f9 — primary text
     #94a3b8 — muted text
     #c4b5fd — lavender accents
     #a78bfa — focus / interactive accent
   ════════════════════════════════════════════════════════════════════ */

/* Modal card + body */
[data-bs-theme="dark"] .acm-card {
  background: linear-gradient(165deg, #0b1220 0%, #11182a 45%, #131c30 100%);
  border-color: rgba(167,139,250,0.20);
  box-shadow: 0 32px 80px -20px rgba(0,0,0,0.7), 0 12px 30px rgba(0,0,0,0.45);
}
[data-bs-theme="dark"] .acm-body {
  /* Light-mode default is #fafafd which leaks through in dark mode
     and makes the form look like a white slab inside a dark card.
     Use a near-black navy so the section cards (#1a2236) sitting on
     top read as distinct, slightly-lighter panels. */
  background: #0c1322;
  scrollbar-color: #4c1d95 #11182a;
}
[data-bs-theme="dark"] .acm-body::-webkit-scrollbar-track { background: #11182a; }
[data-bs-theme="dark"] .acm-body::-webkit-scrollbar-thumb { background: #6d28d9; }
/* Tabs strip + stepper share the same dark body background so the
   transition between header and body reads as one continuous panel. */
[data-bs-theme="dark"] .acm-stepper,
[data-bs-theme="dark"] .acm-tabs { background: #0c1322; border-bottom-color: rgba(167,139,250,0.18); }
/* Footer + req-note dark styles live below — keep here only the
   stepper + tabs strip dark-mode matching. */

/* Header banner — dark variant of the soft lavender wash. */
[data-bs-theme="dark"] .acm-header {
  background: linear-gradient(135deg, #1e1838 0%, #251c44 50%, #2a1d49 100%);
  border-bottom-color: rgba(167,139,250,0.20);
}
[data-bs-theme="dark"] .acm-title { color: #e9d5ff; }
[data-bs-theme="dark"] .acm-subtitle { color: #9aa0b4; }
[data-bs-theme="dark"] .acm-close {
  background: rgba(255,255,255,0.06);
  border-color: rgba(167,139,250,0.30);
  color: #c4b5fd;
}
[data-bs-theme="dark"] .acm-close:hover {
  background: rgba(167,139,250,0.15);
  border-color: #a78bfa;
  color: #e9d5ff;
}
[data-bs-theme="dark"] .acm-loading-pill { background: rgba(167,139,250,.18); border-color: rgba(167,139,250,.35); color: #ede9fe; }
[data-bs-theme="dark"] .acm-top-progress { background: rgba(167,139,250,.14); }
[data-bs-theme="dark"] .acm-top-progress > span { background: linear-gradient(90deg, transparent, #a78bfa 30%, #c4b5fd 70%, transparent); }

/* Stepper — keep colored states but darken pending */
[data-bs-theme="dark"] .acm-step-active { background: linear-gradient(135deg, rgba(76,29,149,0.45) 0%, rgba(109,40,217,0.30) 100%); border-color: #a78bfa; box-shadow: 0 6px 22px rgba(0,0,0,.4), 0 0 0 1px rgba(167,139,250,.15) inset; }
[data-bs-theme="dark"] .acm-step-active .acm-step-title { color: #f1f5f9; }
[data-bs-theme="dark"] .acm-step-active .acm-step-sub { color: #c4b5fd; }
[data-bs-theme="dark"] .acm-step-done { background: linear-gradient(135deg, rgba(6,95,70,0.40) 0%, rgba(16,185,129,0.20) 100%); border-color: #10b981; box-shadow: 0 6px 20px rgba(0,0,0,.4); }
[data-bs-theme="dark"] .acm-step-done .acm-step-title { color: #d1fae5; }
[data-bs-theme="dark"] .acm-step-done .acm-step-sub { color: #34d399; }
[data-bs-theme="dark"] .acm-step-pending { background: rgba(28,37,49,0.6); border-color: rgba(255,255,255,0.08); opacity: 0.7; }
[data-bs-theme="dark"] .acm-step-pending .acm-step-badge { background: #1c2531; border-color: rgba(255,255,255,0.10); color: #64748b; }
[data-bs-theme="dark"] .acm-step-pending .acm-step-num { background: #1c2531; color: #64748b; border-color: #11182a; }
[data-bs-theme="dark"] .acm-step-pending .acm-step-title { color: #64748b; }
[data-bs-theme="dark"] .acm-step-pending .acm-step-sub { color: #475569; }
[data-bs-theme="dark"] .acm-connector-line { background: rgba(255,255,255,0.06); }

/* History panel ("What you did in previous stages") */
[data-bs-theme="dark"] .acm-history { background: #11182a; border-color: rgba(167,139,250,0.20); box-shadow: 0 2px 12px rgba(0,0,0,0.35); }
[data-bs-theme="dark"] .acm-history-header { background: linear-gradient(110deg, rgba(76,29,149,0.30) 0%, rgba(109,40,217,0.20) 100%); border-left-color: #a78bfa; }
[data-bs-theme="dark"] .acm-history-header:hover { background: linear-gradient(110deg, rgba(76,29,149,0.40), rgba(109,40,217,0.30)); }
[data-bs-theme="dark"] .acm-history-title { color: #ede9fe; }
[data-bs-theme="dark"] .acm-history-meta { color: #c4b5fd; }
[data-bs-theme="dark"] .acm-history-body { border-top-color: rgba(167,139,250,0.18); }
[data-bs-theme="dark"] .acm-history-badge { background: rgba(124,58,237,0.30); color: #c4b5fd; }
[data-bs-theme="dark"] .acm-history-icon { background: linear-gradient(135deg, #4c1d95, #2e1065); }
[data-bs-theme="dark"] .acm-history-chevron { background: rgba(167,139,250,0.15); color: #c4b5fd; }

/* Stage 1 sub-tabs */
[data-bs-theme="dark"] .acm-tab-off { background: transparent; color: #c4b5fd; border-color: rgba(167,139,250,0.45); }
[data-bs-theme="dark"] .acm-tab-off:hover { background: rgba(167,139,250,0.10); border-color: #a78bfa; }
[data-bs-theme="dark"] .acm-tab-on { background: linear-gradient(135deg,#6d28d9,#4c1d95); border-color: #7c3aed; box-shadow: 0 3px 10px rgba(0,0,0,.4); }

/* Section card — lift further above the body so the panels really
   pop. The brighter border + stronger top highlight make them read
   as distinct elevated cards instead of muddy washes. */
[data-bs-theme="dark"] .acm-section {
  background: #1f2942;
  border-color: rgba(167,139,250,0.35);
  box-shadow:
    0 6px 22px rgba(0,0,0,0.50),
    inset 0 1px 0 rgba(255,255,255,0.06);
}
[data-bs-theme="dark"] .acm-section-purple { border-top-color: #a78bfa; }
/* Softer header wash — the previous gradient competed with the modal
   header. A muted lavender tint keeps the section heading subtle while
   the brighter title text below carries the emphasis. */
[data-bs-theme="dark"] .acm-section-head {
  background: linear-gradient(110deg, rgba(124,58,237,0.22) 0%, rgba(167,139,250,0.10) 100%);
  border-bottom-color: rgba(167,139,250,0.28);
}
[data-bs-theme="dark"] .acm-section-icon { background: linear-gradient(135deg, #7c3aed, #5b21b6); color: #fff; border-color: rgba(167,139,250,0.55); box-shadow: 0 2px 8px rgba(124,58,237,0.35); }
[data-bs-theme="dark"] .acm-section-title { color: #ffffff; }
[data-bs-theme="dark"] .acm-section-sub { color: #d1d5db; }

/* Form fields — proper contrast for labels, borders, and placeholders.
   Previously borders were so faded inputs looked like ghost outlines
   and placeholders blended into the input background. */
[data-bs-theme="dark"] .acm-field label { color: #e2e8f0; font-weight: 700; }
[data-bs-theme="dark"] .acm-field input,
[data-bs-theme="dark"] .acm-field select,
[data-bs-theme="dark"] .acm-field textarea {
  background: #131c33 !important;
  border-color: rgba(167,139,250,0.50);
  color: #ffffff;
}
[data-bs-theme="dark"] .acm-field input::placeholder,
[data-bs-theme="dark"] .acm-field textarea::placeholder { color: #94a3b8; }
[data-bs-theme="dark"] .acm-field input:hover,
[data-bs-theme="dark"] .acm-field select:hover,
[data-bs-theme="dark"] .acm-field textarea:hover { border-color: rgba(167,139,250,0.75); }
[data-bs-theme="dark"] .acm-field input:focus,
[data-bs-theme="dark"] .acm-field select:focus,
[data-bs-theme="dark"] .acm-field textarea:focus {
  border-color: #a78bfa;
  box-shadow: 0 0 0 3.5px rgba(167,139,250,0.22);
}
[data-bs-theme="dark"] .acm-field input.acm-input-error { background: rgba(239,68,68,0.10); border-color: #ef4444; }
[data-bs-theme="dark"] .acm-radio { color: #e2e8f0; }
[data-bs-theme="dark"] .acm-radio input[type="radio"] { accent-color: #a78bfa; }
[data-bs-theme="dark"] .acm-radio-pill { background: #131c33; border-color: rgba(167,139,250,0.40); color: #ddd6fe; }
[data-bs-theme="dark"] .acm-radio-pill.is-active { background: rgba(124,58,237,0.45); border-color: #a78bfa; color: #ffffff; }

/* Add buttons / action pills inside sections */
[data-bs-theme="dark"] .acm-add-pill { background: rgba(167,139,250,0.12); border-color: rgba(167,139,250,0.40); color: #c4b5fd; }
[data-bs-theme="dark"] .acm-add-pill:hover { background: rgba(167,139,250,0.22); border-color: #a78bfa; color: #ede9fe; }
[data-bs-theme="dark"] .acm-row-btn { background: #1c2531; border-color: rgba(167,139,250,0.20); color: #c4b5fd; }
[data-bs-theme="dark"] .acm-row-btn:hover { background: rgba(167,139,250,0.18); border-color: #a78bfa; color: #ede9fe; }
[data-bs-theme="dark"] .acm-row-btn-del:hover { background: rgba(239,68,68,0.18); border-color: #ef4444; color: #fca5a5; }

/* Inline tables (Stage 1 Additional Locations, Stage 2 KYC docs/owners,
   Stage 3 read-only Evidence Vault). The original light styles use
   ".acm-table thead tr" (with the row selector) so the dark override
   needs to match that specificity or the lavender gradient bleeds
   through and shows as a white strip across the section body. */
[data-bs-theme="dark"] .acm-table thead tr {
  background: linear-gradient(180deg, rgba(28,37,49,0.85), rgba(17,24,42,0.85)) !important;
}
[data-bs-theme="dark"] .acm-table thead th {
  color: #c4b5fd !important;
  border-bottom-color: rgba(167,139,250,0.20) !important;
  background: transparent !important;
}
[data-bs-theme="dark"] .acm-table tbody td {
  color: #e2e8f0;
  border-bottom-color: rgba(255,255,255,0.06);
}
[data-bs-theme="dark"] .acm-table tbody tr:hover td { background: rgba(167,139,250,0.06) !important; }
[data-bs-theme="dark"] .acm-empty-row td { color: #64748b !important; background: transparent !important; }
[data-bs-theme="dark"] .acm-empty-row strong { color: #c4b5fd !important; }
[data-bs-theme="dark"] .acm-table tbody td[style*="color: rgb(31, 41, 55)"],
[data-bs-theme="dark"] .acm-table tbody td[style*="color:#1f2937"] { color: #f1f5f9 !important; }
[data-bs-theme="dark"] .acm-table tbody td[style*="color: rgb(107, 114, 128)"],
[data-bs-theme="dark"] .acm-table tbody td[style*="color:#6b7280"] { color: #94a3b8 !important; }
/* Table wrapper inside section-body-table — neutralize any lingering
   light tint from the section card so the table flush-fits the
   dark background. */
[data-bs-theme="dark"] .acm-section-body-table { background: transparent !important; }
[data-bs-theme="dark"] .acm-table-wrap { background: transparent; }

/* Status / expiry pills in tables */
[data-bs-theme="dark"] .acm-status-active { background: rgba(16,185,129,0.18); color: #6ee7b7; border-color: rgba(16,185,129,0.40); }
[data-bs-theme="dark"] .acm-status-mandatory.is-on { background: rgba(16,185,129,0.18); color: #6ee7b7; border-color: rgba(16,185,129,0.40); }
[data-bs-theme="dark"] .acm-status-mandatory { background: transparent; color: #64748b; border-color: rgba(255,255,255,0.10); }
[data-bs-theme="dark"] .acm-status-optional.is-on { background: rgba(255,255,255,0.06); color: #cbd5e1; border-color: rgba(255,255,255,0.20); }
[data-bs-theme="dark"] .acm-status-optional { background: transparent; color: #64748b; border-color: rgba(255,255,255,0.10); }
[data-bs-theme="dark"] .acm-expiry-na     { background: rgba(255,255,255,0.05); color: #94a3b8; border-color: rgba(255,255,255,0.10); }
[data-bs-theme="dark"] .acm-issue-date    { background: rgba(99,102,241,0.20); color: #c7d2fe; border-color: rgba(99,102,241,0.40); }
[data-bs-theme="dark"] .acm-expiry-future { background: rgba(16,185,129,0.18); color: #6ee7b7; border-color: rgba(16,185,129,0.40); }
[data-bs-theme="dark"] .acm-expiry-past   { background: rgba(239,68,68,0.18); color: #fca5a5; border-color: rgba(239,68,68,0.40); }
[data-bs-theme="dark"] .acm-expiry-date   { background: rgba(16,185,129,0.18); color: #6ee7b7; border-color: rgba(16,185,129,0.40); }
[data-bs-theme="dark"] .acm-expiry-varies { background: rgba(245,158,11,0.18); color: #fcd34d; border-color: rgba(245,158,11,0.40); }
[data-bs-theme="dark"] .acm-doc-code { background: rgba(167,139,250,0.15); color: #c4b5fd; border-color: rgba(167,139,250,0.30); }
[data-bs-theme="dark"] .acm-pill-yes { background: rgba(16,185,129,0.18); color: #6ee7b7; border-color: rgba(16,185,129,0.40); }
[data-bs-theme="dark"] .acm-pill-no  { background: rgba(255,255,255,0.06); color: #94a3b8; border-color: rgba(255,255,255,0.20); }
[data-bs-theme="dark"] .acm-primary-row td { background: rgba(124,58,237,0.10); }
[data-bs-theme="dark"] .acm-primary-row:hover td { background: rgba(124,58,237,0.16); }
[data-bs-theme="dark"] .acm-primary-tag { background: rgba(124,58,237,0.20); color: #ddd6fe; border-color: rgba(167,139,250,0.40); }
[data-bs-theme="dark"] .acm-attach-link { color: #c4b5fd; }
[data-bs-theme="dark"] .acm-attach-link:hover { color: #ede9fe; }
[data-bs-theme="dark"] .acm-doc-action-upload { background: rgba(167,139,250,0.12); color: #c4b5fd; border-color: rgba(167,139,250,0.30); }
[data-bs-theme="dark"] .acm-doc-action-download { background: rgba(16,185,129,0.12); color: #6ee7b7; border-color: rgba(16,185,129,0.30); }
[data-bs-theme="dark"] .acm-doc-action-view { background: rgba(56,189,248,0.12); color: #7dd3fc; border-color: rgba(56,189,248,0.30); }

/* Stage 2 sub-tabs (pill row) */
[data-bs-theme="dark"] .acm-subtab-pill { background: transparent; color: #c4b5fd; border: 1.5px solid rgba(167,139,250,0.40); }
[data-bs-theme="dark"] .acm-subtab-pill:hover { background: rgba(167,139,250,0.10); }
[data-bs-theme="dark"] .acm-subtab-pill.is-active { background: linear-gradient(135deg,#6d28d9,#4c1d95); color: #fff; border-color: #7c3aed; }

/* Stage 2 doc toolbar + search */
[data-bs-theme="dark"] .acm-doc-toolbar { background: rgba(28,37,49,0.4); border-color: rgba(255,255,255,0.06); }
/* Light-mode .acm-doc-search input uses !important on background +
   border so the dark override must match that specificity or the
   white pill leaks into dark mode. */
[data-bs-theme="dark"] .acm-doc-search input {
  background: #131c33 !important;
  border-color: rgba(167,139,250,0.40) !important;
  color: #ffffff;
}
[data-bs-theme="dark"] .acm-doc-search input::placeholder { color: #94a3b8; }
[data-bs-theme="dark"] .acm-doc-search input:focus {
  border-color: #a78bfa !important;
  box-shadow: 0 0 0 3px rgba(167,139,250,0.22) !important;
}
[data-bs-theme="dark"] .acm-doc-search-icon { color: #c4b5fd; }
[data-bs-theme="dark"] .acm-doc-count { color: #c4b5fd; }
[data-bs-theme="dark"] .acm-doc-pag-wrap { background: rgba(28,37,49,0.40); border-color: rgba(255,255,255,0.06); }
[data-bs-theme="dark"] .acm-doc-pag-info { color: #94a3b8; }
[data-bs-theme="dark"] .acm-page-btn { background: #1c2531; color: #c4b5fd; border-color: rgba(167,139,250,0.25); }
[data-bs-theme="dark"] .acm-page-btn:hover:not(:disabled) { background: rgba(167,139,250,0.18); color: #ede9fe; }
[data-bs-theme="dark"] .acm-page-btn.is-active { background: linear-gradient(135deg,#6d28d9,#4c1d95); border-color: #7c3aed; color: #fff; }
[data-bs-theme="dark"] .acm-page-btn:disabled { opacity: 0.4; }

/* Stage 3 - Trade Documents */
[data-bs-theme="dark"] .acm-btn-send { background: rgba(124,58,237,0.20); color: #c4b5fd; border-color: rgba(167,139,250,0.40); }
[data-bs-theme="dark"] .acm-btn-send:hover { background: rgba(124,58,237,0.32); border-color: #a78bfa; }
[data-bs-theme="dark"] .acm-btn-resend { background: rgba(255,255,255,0.06); color: #94a3b8; border-color: rgba(255,255,255,0.18); }
[data-bs-theme="dark"] .acm-btn-purple-lg { background: linear-gradient(135deg,#6d28d9,#4c1d95); }
[data-bs-theme="dark"] .acm-btn-purple-lg-out { background: transparent; color: #c4b5fd; border-color: rgba(167,139,250,0.40); }
[data-bs-theme="dark"] .acm-btn-purple-lg-out:hover { background: rgba(167,139,250,0.12); }
[data-bs-theme="dark"] .acm-td-actions { background: rgba(28,37,49,0.40); border-top-color: rgba(255,255,255,0.06); }
[data-bs-theme="dark"] .acm-td-check-label { color: #ede9fe; }

/* Stage 2 doc counter stats (history) */
[data-bs-theme="dark"] .acm-hs-stat { background: linear-gradient(135deg, rgba(76,29,149,0.28), rgba(109,40,217,0.18)); border-color: rgba(167,139,250,0.30); }
[data-bs-theme="dark"] .acm-hs-stat-num { color: #ede9fe; }
[data-bs-theme="dark"] .acm-hs-stat-lbl { color: #c4b5fd; }

/* Footer + bottom action buttons */
[data-bs-theme="dark"] .acm-footer {
  background: linear-gradient(180deg, rgba(15,23,42,0.6) 0%, rgba(17,24,42,0.95) 100%);
  border-top-color: rgba(167,139,250,0.25);
}
[data-bs-theme="dark"] .acm-req-note { color: #c4b5fd; font-weight: 600; }
[data-bs-theme="dark"] .acm-btn-prev { background: rgba(167,139,250,0.08); color: #ddd6fe; border-color: rgba(167,139,250,0.45); }
[data-bs-theme="dark"] .acm-btn-prev:hover { background: rgba(167,139,250,0.18); border-color: #a78bfa; color: #ffffff; }

/* Error message text under invalid fields */
[data-bs-theme="dark"] .acm-field-error { color: #fca5a5; }

/* ============================================================
 *  RESPONSIVE — tablet & mobile
 *  Strategy: the modal is normally a fixed-width card centered on
 *  the screen. On narrower viewports we (a) eat the side padding,
 *  (b) collapse multi-col grids down toward 1 col, (c) stack the
 *  header / footer rows that were side-by-side, (d) loosen the
 *  step indicator and sub-modal so they fit, and (e) drop heavy
 *  visual chrome (large icons, generous padding) so the form is
 *  still usable on a phone.
 * ============================================================ */

/* ── Small laptop (≤ 1440px) ─────────────────────────────────
   1366×768 / 1440×900 are the most common laptop sizes. The
   modal caps at max-width: 1440 so on a 1440px viewport it fills
   the entire screen edge-to-edge — give it breathing room. */
@media (max-width: 1440px) {
  .acm-root { padding: 10px; }
  .acm-card {
    max-width: calc(100vw - 20px);
    height: min(94vh, calc(100vh - 16px));
  }
  .acm-header { padding: 12px 18px; }
  .acm-stepper { padding: 12px 16px 10px; }
  .acm-body { padding: 14px 18px 16px; }
  .acm-footer { padding: 10px 18px; }
  .acm-section-body, .acm-sec-pad { padding: 14px; }
}

/* ── Compact laptop (≤ 1280px) ────────────────────────────────
   Common HP/Dell business laptops (1280×800, 1366×768). 4-col
   grids start to feel cramped here — collapse to 2x2 and tighten
   the stepper chrome. */
@media (max-width: 1280px) {
  .acm-row-4 { grid-template-columns: 1fr 1fr; }
  .acm-step { padding: 9px 11px; gap: 9px; }
  .acm-step-badge-wrap,
  .acm-step-badge { width: 34px; height: 34px; }
  .acm-step-title { font-size: 11.5px; }
  .acm-step-sub   { font-size: 9px; }
  .acm-step-connector { flex-basis: 18px; }
}

/* ── Tablet (≤ 1024px) ───────────────────────────────────────
   Collapse all multi-col grids to 2 cols, fix the stepper to
   wrap, and tighten paddings further. */
@media (max-width: 1024px) {
  .acm-root { padding: 8px; }
  .acm-card {
    max-width: calc(100vw - 16px);
    height: min(96vh, calc(100vh - 12px));
  }
  .acm-row-4 { grid-template-columns: 1fr 1fr; }
  .acm-row-3 { grid-template-columns: 1fr 1fr; }
  .acm-row-2 { grid-template-columns: 1fr 1fr; }
  .acm-section-body, .acm-sec-pad { padding: 12px; }
  /* Stepper: hide the connector lines (the chevrons get tiny) and
     allow steps to flex-wrap onto two rows so they don't shrink
     into unreadable pills. */
  .acm-stepper { padding: 10px 12px 8px; flex-wrap: wrap; gap: 8px; }
  .acm-step-connector { display: none; }
  .acm-step { flex: 1 1 calc(50% - 6px); min-width: 0; }
  /* Tabs: tighter padding */
  .acm-tabs { padding: 0 16px; }
  /* Body */
  .acm-body { padding: 12px 14px 14px; }
}

/* ── Mobile (≤ 640px) ───────────────────────────────────────── */
@media (max-width: 640px) {
  .acm-root { padding: 0; align-items: stretch; }
  .acm-card {
    border-radius: 0;
    max-height: 100vh;
    height: 100vh;
    width: 100vw;
    max-width: 100vw;
  }
  /* Header: stack icon + title, tighten font */
  .acm-header { padding: 14px 16px; flex-direction: column; align-items: flex-start; gap: 10px; }
  .acm-header-icon { width: 40px; height: 40px; }
  .acm-title { font-size: 16px; }
  .acm-subtitle   { font-size: 11.5px; }
  .acm-close { position: absolute; top: 12px; right: 12px; }
  /* Stepper: full vertical stack on phone */
  .acm-stepper { flex-direction: column; align-items: stretch; gap: 8px; padding: 12px; }
  .acm-step-connector { display: none; }
  .acm-step { width: 100%; flex: 0 0 auto; }
  /* Tabs */
  .acm-tabs { flex-wrap: wrap; padding: 0 12px; }
  .acm-tab { flex: 1 1 auto; min-width: 40%; font-size: 12px; padding: 8px 10px; }
  /* Body padding */
  .acm-body { padding: 12px; }
  /* All grids → single column on phone */
  .acm-row-4, .acm-row-3, .acm-row-2 { grid-template-columns: 1fr; }
  .acm-row { gap: 10px; }
  /* Inputs slightly smaller */
  .acm-input { font-size: 13px; padding: 8px 10px; }
  /* Section header tightens */
  .acm-section-head { padding: 10px 12px; gap: 8px; }
  .acm-section-title { font-size: 12.5px; }
  .acm-section-sub { display: none; }
  .acm-section-body, .acm-sec-pad { padding: 10px; }
  /* Footer: stack actions, full-width buttons. Hide the "fields with *"
     hint on phones to free up vertical space. Reset align-items so the
     column-direction children actually stretch to full width (the base
     rule uses align-items: center which would otherwise shrink the
     buttons to content width and centre them — bad mobile look). */
  .acm-footer {
    padding: 10px 12px 14px;
    flex-direction: column;
    align-items: stretch;
    gap: 8px;
  }
  .acm-req-note { display: none; }
  .acm-footer-actions {
    width: 100%;
    display: flex;
    flex-direction: row;
    align-items: stretch;
    gap: 8px;
  }
  .acm-btn-prev, .acm-btn-next {
    flex: 1 1 0;
    min-width: 0;
    padding: 11px 14px;
    font-size: 13px;
    justify-content: center;
  }
  /* Sub-modal */
  .acm-sub-modal { padding: 0; align-items: stretch; }
  .acm-sub-card { border-radius: 0; max-height: 100vh; height: 100vh; width: 100vw; }
  .acm-sub-header { padding: 14px 16px; }
  .acm-sub-body { padding: 14px; }
  .acm-sub-footer {
    padding: 12px 14px 14px;
    flex-direction: column;
    align-items: stretch;
    gap: 8px;
  }
  .acm-btn-mini-cancel, .acm-btn-save, .acm-doc-save { width: 100%; flex: 0 0 auto; }
  /* Map-Consignee popup (if present), Stage 2 toolbar */
  .acm-doc-toolbar { flex-direction: column; align-items: stretch; gap: 8px; padding: 10px 12px; }
  .acm-doc-search { max-width: 100%; }
  .acm-doc-count { align-self: flex-start; }
  /* Stage 2 sub-tabs wrap */
  .acm-subtabs-row { flex-wrap: wrap; gap: 6px; }
  /* History recap card collapses to single column */
  .acm-recap-grid { grid-template-columns: 1fr; }
  /* Same-as-Customer banner: tighter */
  .acm-same-banner { padding: 10px 12px; gap: 10px; }
  .acm-same-banner-sub { font-size: 11.5px; }
  /* Address & Contact action button — wrap label */
  .acm-add-pill { font-size: 11.5px; padding: 6px 12px; }
  .acm-section-head-row { flex-wrap: wrap; gap: 8px; }
}
`;
