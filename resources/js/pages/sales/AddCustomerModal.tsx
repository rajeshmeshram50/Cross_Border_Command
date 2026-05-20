import { Fragment, useEffect, useMemo, useState } from 'react';
import api from '../../api';
import { MasterSelect, MasterDatePicker } from '../master/masterFormKit';
import Tooltip from '../../components/ui/Tooltip';
import DeleteConfirmModal from '../../components/ui/DeleteConfirmModal';
import { Shimmer } from '../../components/ui/Shimmer';

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
    coName:'', coLegal:'', coType:'', coWeb:'', coSeg:'', coClass:'', coRisk:'',
    addrType:'', addr:'', country:'', state:'', city:'', pin:'',
    cpName:'', cpDesig:'', cpTel:'', cpEmail:'', cpWa:'' as 'yes'|'no'|'',
  });
  const setF = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm(prev => ({ ...prev, [k]: v }));

  // Additional locations (each row = address + the contact person at that
  // address; previously stored as two parallel arrays which carried the
  // same fields). The primary address+contact lives on `form` above.
  const [locations, setLocations] = useState<LocationRow[]>([]);

  // Inline validation errors. Key = form field name on Stage 1; value =
  // the message rendered under the input. Cleared on next keystroke.
  const [errors, setErrors] = useState<Record<string, string>>({});

  /* Numeric PK of the saved customer. In edit mode it comes from the
   * `customer` prop (passed in from the list). In create mode it's set
   * by the Stage 1 → 2 auto-save POST so Stage 2 KYC upload calls have
   * a `/customers/{id}/documents` target without forcing the user to
   * close + re-open the modal. */
  const [savedDbId, setSavedDbId] = useState<number | null>(customer?.db_id ?? null);

  // Trade docs selection
  const [tdDocs, setTdDocs] = useState([
    { id:'td1', name:'Bill of Lading',           selected:true, sent:false },
    { id:'td2', name:'Phytosanitary Certificate', selected:true, sent:false },
  ]);

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
    phone_number?: string | null; id_proof_url?: string | null; address_proof_url?: string | null;
    photograph_url?: string | null; status?: string;
  };
  const [kycDocs,   setKycDocs]   = useState<KycDocRowApi[]>([]);
  const [kycOwners, setKycOwners] = useState<KycOwnerRowApi[]>([]);

  /** Confirm-delete state for Stage 2 rows. `kind` decides which
   *  endpoint the confirm calls. */
  const [kycDelModal, setKycDelModal] = useState<{ open: boolean; kind: 'doc' | 'owner'; id: number | null; label?: string }>({ open: false, kind: 'doc', id: null });

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
    setStage(1); setMaxStage(1); setTab('identification');
    setKycSub('company-dd'); setKycPage({ 'company-dd':1, 'owner-kyc':1, 'trade-licence':1 }); setKycSearch('');
    setEvTab('kyc-documents'); setEvSub('dd');
    setHistoryOpen(true);
    setForm({
      coName:   customer?.company ?? '',
      coLegal:  customer?.company ?? '',
      coType:   customer?.type ?? '',
      coWeb:    '',
      coSeg:    customer?.segment ?? '',
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
      cpWa:     customer?.whatsapp === 'Yes' ? 'yes' : customer?.whatsapp === 'No' ? 'no' : '',
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
      { id:'td1', name:'Bill of Lading',           selected:true, sent:false },
      { id:'td2', name:'Phytosanitary Certificate', selected:true, sent:false },
    ]);
    setLocModal({ open:false, editing:null });
    // Deps deliberately use a stable identifier (the customer's primary
    // key) instead of the customer object itself. Otherwise any parent
    // re-render that produces a new `customer` reference — even with
    // identical data — would re-run this effect, wipe in-progress
    // Stage 2/3 edits, and jump the user back to Stage 1.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, customer?.db_id ?? null, customer?.id ?? null]);

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
          coSeg:    d.segment       ?? '',
          coClass:  d.classification ?? '',
          coRisk:   d.riskLevel     ?? '',
          addrType: pa.type         ?? d.addrType ?? DEFAULT_ADDRESS_TYPE,
          addr:     pa.address_line ?? d.addr    ?? '',
          country:  pa.country      ?? d.country ?? '',
          state:    pa.state        ?? d.state   ?? '',
          city:     pa.city         ?? d.city    ?? '',
          pin:      pa.pin          ?? d.pin     ?? '',
          cpName:   pa.cp_name        ?? d.contact ?? '',
          cpDesig:  pa.cp_designation ?? d.cpDesig ?? '',
          cpTel:    pa.cp_contact     ?? d.phone   ?? '',
          cpEmail:  pa.cp_email       ?? d.email   ?? '',
          cpWa:     (pa.cp_whatsapp === 'yes' || d.whatsapp === 'Yes') ? 'yes'
                  : (pa.cp_whatsapp === 'no'  || d.whatsapp === 'No')  ? 'no' : '',
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
          cpWhatsapp:     (a.cp_whatsapp === 'yes' || a.cp_whatsapp === 'no') ? a.cp_whatsapp : '',
        })));
      })
      .catch(() => { /* hydration failure: leave the thin prefill from the list row */ })
      .finally(() => { if (!cancelled) setHydrating(false); });

    // Stage 2 data — pulled in parallel with the main customer payload.
    Promise.all([
      api.get(`/customers/${customer.db_id}/documents`).catch(() => ({ data: { data: [] } })),
      api.get(`/customers/${customer.db_id}/owners`).catch(() => ({ data: { data: [] } })),
    ]).then(([docsRes, ownersRes]) => {
      if (cancelled) return;
      setKycDocs(Array.isArray(docsRes.data?.data) ? docsRes.data.data : []);
      setKycOwners(Array.isArray(ownersRes.data?.data) ? ownersRes.data.data : []);
    });

    return () => { cancelled = true; };
  }, [open, customer?.db_id]);

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
    if (!form.coLegal.trim())                           next.coLegal = 'Legal name is required';
    if (!form.coType)                                   next.coType  = 'Select a customer type';
    if (!form.coSeg)                                    next.coSeg   = 'Select a segment';
    if (!form.coClass)                                  next.coClass = 'Select a classification';
    if (!form.coRisk)                                   next.coRisk  = 'Select a risk level';
    if (!form.addrType)                                 next.addrType = 'Select an address type';
    if (!form.addr.trim())                              next.addr     = 'Address is required';
    if (!form.country)                                  next.country  = 'Select a country';
    if (!form.state)                                    next.state    = 'Select a state';
    if (!form.city.trim())                              next.city     = 'City is required';
    if (!form.pin.trim())                               next.pin      = 'PIN / Postal code is required';
    else if (!/^[A-Za-z0-9-\s]{3,12}$/.test(form.pin))  next.pin      = 'PIN / Postal code looks invalid';
    if (!form.cpName.trim())                            next.cpName   = 'Contact person name is required';
    if (!form.cpDesig.trim())                           next.cpDesig  = 'Designation is required';
    if (!form.cpTel.trim())                             next.cpTel    = 'Contact number is required';
    else if (!/^\+?[0-9\s-]{7,15}$/.test(form.cpTel))   next.cpTel    = 'Phone must be 7–15 digits';
    if (!form.cpEmail.trim())                           next.cpEmail  = 'Email is required';
    else if (!/^\S+@\S+\.\S+$/.test(form.cpEmail))      next.cpEmail  = 'Enter a valid email address';
    if (!form.cpWa)                                     next.cpWa     = 'Select WhatsApp preference';
    setErrors(next);
    if (Object.keys(next).length === 0) return true;
    // Surface the first field with an error to the user. The body
    // is scrollable so an off-screen field can be missed otherwise.
    const firstKey = Object.keys(next)[0];
    const el = document.querySelector<HTMLElement>(`[data-field="${firstKey}"]`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return false;
  };

  /* Build the POST/PUT payload from the form + locations. Mirrors the
   * shape declared in CustomerController::validatePayload(). */
  const buildPayload = () => ({
    company_name:   form.coName,
    legal_name:     form.coLegal,
    type:           form.coType,
    segment:        form.coSeg,
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
      pin:            form.pin,
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
      pin:            l.pin,
      cp_name:        l.cpName,
      cp_designation: l.cpDesignation,
      cp_contact:     l.cpContact,
      cp_email:       l.cpEmail,
      cp_whatsapp:    l.cpWhatsapp,
    })),
  });

  const submitCustomer = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const payload = buildPayload();
      if (isEdit && customer?.db_id) {
        await api.put(`/customers/${customer.db_id}`, payload);
      } else {
        await api.post('/customers', payload);
      }
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
      } else {
        alert(err?.response?.data?.message ?? 'Save failed. Please try again.');
      }
    } finally {
      setSaving(false);
    }
  };

  /* Auto-save Stage 1 when transitioning from the Address & Contact
   * sub-tab to Stage 2. Without this, Stage 2 KYC upload calls have
   * no `/customers/{id}/documents` target — the user would have to
   * Save Customer (Stage 3), close the modal, find the row in the
   * list, and re-open as edit. Same auto-save pattern is used by
   * AddConsigneeModal. */
  const persistStage1 = async (): Promise<number | null> => {
    if (saving) return savedDbId;
    setSaving(true);
    try {
      const payload = buildPayload();
      if (savedDbId) {
        await api.put(`/customers/${savedDbId}`, payload);
        return savedDbId;
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
      } else {
        alert(err?.response?.data?.message ?? 'Save failed. Please try again.');
      }
      return null;
    } finally {
      setSaving(false);
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
      onSaved?.();
    } else if (stage === 2) {
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

  return (
    <div className="acm-root" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
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
          <button type="button" className="acm-close" onClick={onClose} aria-label="Close">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        {/* STEPPER */}
        <Stepper stage={stage} onGoto={gotoStage} />

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

        {/* STAGE 1 TABS */}
        {stage === 1 && (
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
          {/* While the edit-mode hydration fetch is in flight, render a
              skeleton that mirrors the actual Stage 1 form structure
              (Basic Company + Primary Address & Contact sections) so
              the user sees content shape immediately. */}
          {stage === 1 && hydrating && <Stage1FormShimmer />}
          {stage === 1 && !hydrating && tab === 'identification' && (
            <Stage1Identification form={form} setF={setF} masters={masters} errors={errors} clearErr={(k) => setErrors(e => { if (!e[k]) return e; const n = { ...e }; delete n[k]; return n; })} />
          )}
          {stage === 1 && !hydrating && tab === 'address-contact' && (
            <Stage1AdditionalLocations
              locations={locations}
              onAdd={() => setLocModal({ open:true, editing:null })}
              onEdit={(id) => setLocModal({ open:true, editing:id })}
              onDel={(id) => setDelModal({ open:true, id })}
            />
          )}
          {stage === 2 && (
            <Stage2KYC
              sub={kycSub} setSub={(s) => { setKycSub(s); setKycSearch(''); }}
              page={kycPage} setPage={(s, p) => setKycPage(prev => ({ ...prev, [s]: p }))}
              search={kycSearch} setSearch={setKycSearch}
              onAdd={(s) => { setEditDocId(null); setEditOwnerId(null); setDocModal({ open: true, sub: s }); }}
              docs={kycDocs}
              owners={kycOwners}
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
          {stage === 3 && evTab === 'kyc-documents' && (
            <Stage3KycDocs sub={evSub} setSub={setEvSub} />
          )}
          {stage === 3 && evTab === 'trade-documents' && (
            <Stage3TradeDocs
              docs={tdDocs}
              onToggle={(id) => setTdDocs(prev => prev.map(d => d.id === id ? { ...d, selected: !d.selected } : d))}
              onToggleAll={(checked) => setTdDocs(prev => prev.map(d => ({ ...d, selected: checked })))}
              onSend={(id) => setTdDocs(prev => prev.map(d => d.id === id ? { ...d, sent: true } : d))}
              onSendSelected={() => setTdDocs(prev => prev.map(d => d.selected ? { ...d, sent: true } : d))}
            />
          )}
        </div>

        {/* FOOTER */}
        <div className="acm-footer">
          <div className="acm-req-note">
            <span className="acm-req-dot" />
            Fields marked with <span className="acm-req">*</span> are required
          </div>
          <div className="acm-footer-actions">
            {!atStart && (
              <button type="button" className="acm-btn-prev" onClick={goPrev}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6"/></svg>
                Previous
              </button>
            )}
            <button type="button" className="acm-btn-next" onClick={goNext} disabled={saving} style={saving ? { opacity:.7, cursor:'wait' } : undefined}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v13a2 2 0 0 1-2 2z" />
                <polyline points="17 21 17 13 7 13 7 21" />
                <polyline points="7 3 7 8 15 8" />
              </svg>
              <span>{saving ? 'Saving…' : nextLabel}</span>
            </button>
          </div>
        </div>

      </div>

      {/* SUB-MODAL: Add/edit a single Location (address + contact) */}
      {locModal.open && (
        <LocationSubModal
          editing={locModal.editing ? locations.find(l => l.id === locModal.editing) ?? null : null}
          masters={masters}
          onClose={() => setLocModal({ open:false, editing:null })}
          onSave={(rec) => {
            if (locModal.editing) setLocations(prev => prev.map(l => l.id === locModal.editing ? { ...rec, id: l.id } : l));
            else setLocations(prev => [...prev, { ...rec, id: newId('loc') }]);
            setLocModal({ open:false, editing:null });
          }}
        />
      )}

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
        onClose={() => setKycDelModal({ open: false, kind: kycDelModal.kind, id: null })}
        onConfirm={async () => {
          const id = kycDelModal.id;
          const kind = kycDelModal.kind;
          if (!id || !customer?.db_id) { setKycDelModal({ open: false, kind, id: null }); return; }
          try {
            if (kind === 'doc') {
              await api.delete(`/customers/${customer.db_id}/documents/${id}`);
              setKycDocs(prev => prev.filter(d => d.id !== id));
            } else {
              await api.delete(`/customers/${customer.db_id}/owners/${id}`);
              setKycOwners(prev => prev.filter(o => o.id !== id));
            }
          } catch (err: any) {
            alert(err?.response?.data?.message ?? 'Could not delete. Try again.');
          } finally {
            setKycDelModal({ open: false, kind, id: null });
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
    </div>
  );
}

/* ───── Stepper ───── */
function Stepper({ stage, onGoto }: { stage: Stage; onGoto: (s: Stage) => void }) {
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
        const cls = s.n < stage ? 'acm-step-done' : s.n === stage ? 'acm-step-active' : 'acm-step-pending';
        return (
          <Fragment key={s.n}>
            <div className={`acm-step ${cls}`} onClick={() => onGoto(s.n)}>
              <div className="acm-step-badge-wrap">
                <div className="acm-step-badge">{s.n < stage ? CHECK_BADGE : s.icon}</div>
                <div className="acm-step-num">{s.n < stage ? CHECK_NUM : s.n}</div>
              </div>
              <div className="acm-step-text">
                <div className="acm-step-title">{s.title}</div>
                <div className="acm-step-sub">{s.sub}</div>
              </div>
            </div>
            {i < steps.length - 1 && (
              <div className="acm-step-connector"><div className="acm-connector-line" data-done={s.n < stage ? '1' : '0'} /></div>
            )}
          </Fragment>
        );
      })}
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
            <Field label="Company Name" required error={errors.coName} fieldKey="coName"><input className={errors.coName ? 'acm-input-error' : ''} value={form.coName} onChange={e => set('coName', e.target.value)} placeholder="e.g. Shree Agro Pvt Ltd" /></Field>
            <Field label="Company Legal Name" required error={errors.coLegal} fieldKey="coLegal"><input className={errors.coLegal ? 'acm-input-error' : ''} value={form.coLegal} onChange={e => set('coLegal', e.target.value)} placeholder="Registered legal entity name" /></Field>
            <Field label="Customer Type" required error={errors.coType} fieldKey="coType">
              <MasterSelect value={form.coType} options={optsWith(masters.customerTypes, form.coType)} placeholder="Select customer type" invalid={!!errors.coType} onChange={v => set('coType', v)} />
            </Field>
          </div>
          <div className="acm-row acm-row-4">
            <Field label="Company Website"><input value={form.coWeb} onChange={e => setF('coWeb', e.target.value)} placeholder="https://example.com" /></Field>
            <Field label="Customer Segment" required error={errors.coSeg} fieldKey="coSeg">
              <MasterSelect value={form.coSeg} options={optsWith(masters.segments, form.coSeg)} placeholder="Select segment" invalid={!!errors.coSeg} onChange={v => set('coSeg', v)} />
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
              <MasterSelect value={form.addrType} options={optsWith(masters.addressTypes, form.addrType)} placeholder="Select address type" invalid={!!errors.addrType} onChange={v => set('addrType', v)} />
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
            <Field label="Pin / Postal Code" required error={errors.pin} fieldKey="pin"><input className={errors.pin ? 'acm-input-error' : ''} value={form.pin} onChange={e => set('pin', e.target.value)} maxLength={12} placeholder="6-digit PIN" /></Field>
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

/* ───── Stage 1 — Additional Locations & Contacts (merged table) ─────
 * Replaces the previous two-table layout (Addresses + Contact Persons).
 * Each row now captures both the address and the contact person at
 * that address, since the old shapes were identical. */
function Stage1AdditionalLocations({ locations, onAdd, onEdit, onDel }:
  { locations: LocationRow[]; onAdd: () => void; onEdit: (id: string) => void; onDel: (id: string) => void }) {
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
              {locations.length === 0 ? (
                <tr className="acm-empty-row"><td colSpan={9}>No additional locations yet. Click <strong>+ Add More Location</strong> to capture another branch, warehouse, or shipping address with its contact person.</td></tr>
              ) : locations.map((l, i) => {
                const place = [l.city, l.state, l.country].filter(Boolean).join(' • ');
                return (
                  <tr key={l.id}>
                    <td>{i + 1}</td>
                    <td>{l.type}</td>
                    <td title={l.line}>{l.line.length > 36 ? l.line.slice(0, 33) + '…' : l.line}</td>
                    <td>{place}</td>
                    <td>{l.cpName}{l.cpDesignation ? <span style={{ color:'#6b7280', fontWeight:500 }}> ({l.cpDesignation})</span> : null}</td>
                    <td>{l.cpContact}</td>
                    <td>{l.cpEmail}</td>
                    <td>{l.cpWhatsapp === 'yes' ? <span className="acm-pill-yes">✓ Yes</span> : <span className="acm-pill-no">✕ No</span>}</td>
                    <td>
                      <div className="acm-row-actions">
                        <Tooltip label="Edit">
                          <button type="button" className="acm-row-btn" aria-label="Edit" onClick={() => onEdit(l.id)}>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                          </button>
                        </Tooltip>
                        <Tooltip label="Delete">
                          <button type="button" className="acm-row-btn acm-row-btn-del" aria-label="Delete" onClick={() => onDel(l.id)}>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /></svg>
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
}

/* ───── Stage 2 — KYC sub-tabs + doc table ───── */
function Stage2KYC({ sub, setSub, page, setPage, search, setSearch, onAdd, docs, owners, customerSaved, onEditDoc, onDeleteDoc, onEditOwner, onDeleteOwner }:
  { sub: KycSubTab; setSub: (s: KycSubTab) => void;
    page: Record<KycSubTab, number>; setPage: (s: KycSubTab, p: number) => void;
    search: string; setSearch: (s: string) => void;
    onAdd: (s: KycSubTab) => void;
    /** Live KYC data fetched on edit. `docs` covers both DD + TL — filter by `kind`.  */
    docs: { id:number; kind:'dd'|'tl'; name:string; license_number?:string|null; issuing_authority?:string|null; issue_date?:string|null; expiry_date?:string|null; attachment_url?:string|null; attachment_name?:string|null; status?:string }[];
    owners: { id:number; owner_name:string; designation?:string|null; official_email?:string|null; phone_number?:string|null; id_proof_url?:string|null; address_proof_url?:string|null; photograph_url?:string|null; status?:string }[];
    /** True only when the parent customer has a db_id (i.e. has been saved). */
    customerSaved: boolean;
    onEditDoc:     (id:number) => void;
    onDeleteDoc:   (id:number) => void;
    onEditOwner:   (id:number) => void;
    onDeleteOwner: (id:number) => void;
  }) {
  const meta = KYC_TAB_META[sub];

  // Source data depends on the sub-tab:
  //   company-dd   → live docs filtered by kind='dd'
  //   owner-kyc    → live owners
  //   trade-licence → design-only placeholder list (TL_DOCS); backend
  //                  wiring to ship in a follow-up
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
  // Trade Licence reference list — kept in sync via search so the
  // toolbar count + filter still feel responsive even though the data
  // is static.
  const filteredTradeLegacy = useMemo(() => {
    if (!q) return TL_DOCS;
    return TL_DOCS.filter(d =>
      d.code.toLowerCase().includes(q) ||
      d.name.toLowerCase().includes(q) ||
      d.authority.toLowerCase().includes(q));
  }, [q]);

  const totalRows = isOwners ? filteredOwners.length
                  : isTradeLegacy ? filteredTradeLegacy.length
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
            {meta.showAdd && (() => {
              // Trade Licence is still placeholder-only — disable add
              // until the backend wiring lands. Company DD and Owner
              // KYC are fully wired so they fall through to the normal
              // enabled / customerSaved gating.
              const isPlaceholder = isTradeLegacy;
              const isDisabled    = isPlaceholder || !customerSaved;
              const reason = isPlaceholder
                ? 'Trade Licence is design-only for now. Backend wiring coming soon.'
                : !customerSaved
                  ? 'Save the customer (Stage 1) first to enable adding KYC documents'
                  : '';
              return (
                <Tooltip label={reason} disabled={!isDisabled}>
                  <button
                    type="button"
                    className="acm-add-pill"
                    onClick={() => { if (!isDisabled) onAdd(sub); }}
                    disabled={isDisabled}
                    style={isDisabled ? { opacity: 0.55, cursor: 'not-allowed' } : undefined}
                  >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                    {meta.addLabel}
                  </button>
                </Tooltip>
              );
            })()}
          </div>
        </div>

        <div className="acm-doc-toolbar">
          <div className="acm-doc-search">
            <svg className="acm-doc-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input type="search" placeholder={meta.placeholder} value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <div className="acm-doc-count">{totalRows} {isOwners ? `owner${totalRows === 1 ? '' : 's'}` : `document${totalRows === 1 ? '' : 's'}`}</div>
        </div>

        <div className="acm-section-body acm-section-body-table">
          <div className="acm-table-wrap">
            {isTradeLegacy ? (
              /* Design-only Trade Licence table — keeps the
                 Mandatory/Optional toggle + upload/download icons from
                 the original mock. Wiring to /customers/{id}/documents
                 with kind='tl' will land in a follow-up. */
              <table className="acm-table">
                <thead><tr>
                  <th>Sr No</th><th>Auto Code</th><th>Document Name</th>
                  <th>Issuing Authority</th><th>Expiry</th><th>Status</th><th>Actions</th>
                </tr></thead>
                <tbody>
                  {totalRows === 0 ? (
                    <tr className="acm-empty-row"><td colSpan={7}>No trade licence documents match your search.</td></tr>
                  ) : legacySlice.map((dl, i) => {
                    const sr = start + i + 1;
                    const srPad = String(sr).padStart(2, '0');
                    const expClass = dl.expiry === 'N/A' ? 'acm-expiry-na' : 'acm-expiry-date';
                    return (
                      <tr key={dl.code}>
                        <td>{srPad}</td>
                        <td><span className="acm-doc-code">{dl.code}</span></td>
                        <td style={{ fontWeight: 700, color: '#1f2937' }}>{dl.name}</td>
                        <td style={{ color: '#6b7280' }}>{dl.authority}</td>
                        <td><span className={expClass}>{dl.expiry}</span></td>
                        <td>
                          {dl.status === 'mandatory'
                            ? <span className="acm-status-toggle"><span className="acm-status-mandatory is-on">✓ Mandatory</span><span className="acm-status-optional">Optional</span></span>
                            : <span className="acm-status-toggle"><span className="acm-status-mandatory">Mandatory</span><span className="acm-status-optional is-on">Optional</span></span>}
                        </td>
                        <td>
                          <div className="acm-row-actions">
                            <Tooltip label="Upload (coming soon)">
                              <button type="button" className="acm-doc-action acm-doc-action-upload" aria-label="Upload" disabled style={{ opacity: 0.7, cursor: 'not-allowed' }}>
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                              </button>
                            </Tooltip>
                            <Tooltip label="Download (coming soon)">
                              <button type="button" className="acm-doc-action acm-doc-action-download" aria-label="Download" disabled style={{ opacity: 0.7, cursor: 'not-allowed' }}>
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                              </button>
                            </Tooltip>
                          </div>
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
                  <th>ID Proof</th><th>Address Proof</th><th>Photograph</th><th>Status</th><th>Actions</th>
                </tr></thead>
                <tbody>
                  {totalRows === 0 ? (
                    <tr className="acm-empty-row"><td colSpan={10}>{q ? 'No owners match your search.' : 'No owners captured yet. Click "+ Add Owner KYC Document" to add one.'}</td></tr>
                  ) : ownerSlice.map((o, i) => (
                    <tr key={o.id}>
                      <td>{String(start + i + 1).padStart(2, '0')}</td>
                      <td style={{ fontWeight: 700, color: '#1f2937' }}>{o.owner_name}</td>
                      <td>{o.designation || '—'}</td>
                      <td>{o.official_email || '—'}</td>
                      <td style={{ fontFamily: 'JetBrains Mono, ui-monospace, monospace', fontSize: 11 }}>{o.phone_number || '—'}</td>
                      <td>{o.id_proof_url      ? <a href={o.id_proof_url}      target="_blank" rel="noopener noreferrer" className="acm-attach-link">View</a> : '—'}</td>
                      <td>{o.address_proof_url ? <a href={o.address_proof_url} target="_blank" rel="noopener noreferrer" className="acm-attach-link">View</a> : '—'}</td>
                      <td>{o.photograph_url    ? <a href={o.photograph_url}    target="_blank" rel="noopener noreferrer" className="acm-attach-link">View</a> : '—'}</td>
                      <td>{(o.status || 'Active') === 'Active' ? <span className="acm-status-active">✓ Active</span> : <span className="acm-pill-no">Inactive</span>}</td>
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
                  <th>Issuing Authority</th><th>Issuing Date</th><th>Expiry</th><th>Status</th><th>Attachment</th><th>Actions</th>
                </tr></thead>
                <tbody>
                  {totalRows === 0 ? (
                    <tr className="acm-empty-row"><td colSpan={10}>{q ? 'No documents match your search.' : 'No documents captured yet. Click "+ Add Document / License" to add one.'}</td></tr>
                  ) : docSlice.map((d, i) => {
                    const sr = start + i + 1;
                    const code = codeFor(kind.toUpperCase(), sr);
                    const fmtMonthYear = (s?: string | null) =>
                      s ? (() => { const [y, m] = s.split('-'); return `${m}/${y}`; })() : 'N/A';
                    const expLabel = fmtMonthYear(d.expiry_date);
                    const issLabel = fmtMonthYear(d.issue_date);
                    const expClass = d.expiry_date ? 'acm-expiry-date' : 'acm-expiry-na';
                    const issClass = d.issue_date  ? 'acm-expiry-date' : 'acm-expiry-na';
                    return (
                      <tr key={d.id}>
                        <td>{String(sr).padStart(2, '0')}</td>
                        <td><span className="acm-doc-code">{code}</span></td>
                        <td style={{ fontWeight: 700, color: '#1f2937' }}>{d.name}</td>
                        <td style={{ fontFamily: 'JetBrains Mono, ui-monospace, monospace', fontSize: 11 }}>{d.license_number || '—'}</td>
                        <td style={{ color: '#6b7280' }}>{d.issuing_authority || '—'}</td>
                        <td><span className={issClass}>{issLabel}</span></td>
                        <td><span className={expClass}>{expLabel}</span></td>
                        <td>{(d.status || 'Active') === 'Active' ? <span className="acm-status-active">✓ Active</span> : <span className="acm-pill-no">Inactive</span>}</td>
                        <td>{d.attachment_url ? <a href={d.attachment_url} target="_blank" rel="noopener noreferrer" className="acm-attach-link">View</a> : '—'}</td>
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
function Stage3KycDocs({ sub, setSub }: { sub: EvSubTab; setSub: (s: EvSubTab) => void }) {
  const meta = EV_SUB_META[sub];
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
                {meta.data.map((d, i) => {
                  let st: React.ReactNode;
                  if (d.status === 'active') st = <span className="acm-status-active">✓ Active</span>;
                  else if (d.status === 'mandatory') st = <span className="acm-status-mandatory is-on">✓ Mandatory</span>;
                  else st = <span className="acm-status-optional is-on">Optional</span>;
                  const expCls = d.expiry === 'N/A' ? 'acm-expiry-na' : d.expiry === 'Varies' ? 'acm-expiry-varies' : 'acm-expiry-date';
                  return (
                    <tr key={d.code}>
                      <td>{i + 1}</td>
                      <td><span className="acm-doc-code">{d.code}</span></td>
                      <td style={{ fontWeight: 700, color: '#1f2937' }}>{d.name}</td>
                      <td style={{ color: '#6b7280' }}>{d.authority}</td>
                      <td><span className={expCls}>{d.expiry}</span></td>
                      <td>{st}</td>
                      <td>
                        <Tooltip label="Preview the uploaded attachment">
                          <button type="button" className="acm-attach-link" aria-label="View attachment">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
                            View Attachment
                          </button>
                        </Tooltip>
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

/* ───── Stage 3 — Trade Documents ───── */
function Stage3TradeDocs({ docs, onToggle, onToggleAll, onSend, onSendSelected }:
  { docs: { id:string; name:string; selected:boolean; sent:boolean }[]; onToggle:(id:string)=>void; onToggleAll:(c:boolean)=>void; onSend:(id:string)=>void; onSendSelected:()=>void }) {
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
                    <div className="acm-td-cell-check">
                      <input type="checkbox" checked={d.selected} onChange={() => onToggle(d.id)} />
                      {d.sent ? (
                        <button type="button" className="acm-btn-resend" onClick={() => onSend(d.id)}>
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-4.5"/></svg>
                          Resend
                        </button>
                      ) : (
                        <button type="button" className="acm-btn-send" onClick={() => onSend(d.id)}>
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                          Send
                        </button>
                      )}
                    </div>
                  </td>
                  <td className="td-status"><span className="acm-expiry-na">N/A</span></td>
                  <td className="td-actions">
                    <div className="acm-row-actions">
                      <Tooltip label="View document">
                        <button type="button" className="acm-doc-action acm-doc-action-view" aria-label="View"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></button>
                      </Tooltip>
                      <Tooltip label="Download document">
                        <button type="button" className="acm-doc-action acm-doc-action-download" aria-label="Download"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg></button>
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
    editing?: { id: number; name: string; license_number?: string | null; issuing_authority?: string | null; issue_date?: string | null; expiry_date?: string | null; attachment_name?: string | null } | null;
    onClose: () => void;
    /** Fires with the saved server row (already shaped by the API) so
     *  the parent can prepend / replace it in the table state. */
    onSaved: (row: any) => void;
    onDocTypeAdded: (opt: MasterOpt) => void }) {
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
    if (!d.authority.trim()) next.authority = 'Issuing authority is required';
    if (!d.issueDate)        next.issueDate = 'Issue date is required';
    if (!d.expiryDate)       next.expiryDate = 'Expiry date is required';
    // Cross-field check: expiry must not be earlier than issue date.
    // Dates come from MasterDatePicker as YYYY-MM-DD strings, which
    // sort lexicographically — direct string compare is safe.
    if (d.issueDate && d.expiryDate && d.expiryDate < d.issueDate) {
      next.expiryDate = 'Expiry date must be on or after the issue date';
    }
    setErrs(next);
    if (Object.keys(next).length > 0) return;

    if (!customerId) {
      alert('Please save the customer (Stage 1) first before adding KYC documents.');
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
    if (d.attachment) fd.append('attachment',  d.attachment);
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
      } else {
        alert(err?.response?.data?.message ?? 'Could not save the document. Try again.');
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="acm-sub-modal" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
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
              <input className={errs.license ? 'acm-input-error' : ''} value={d.license} onChange={e => set('license', e.target.value)} placeholder="Enter license number" />
            </Field>
          </div>
          <div className="acm-row acm-row-4">
            <Field label="Issuing Authority" required error={errs.authority}>
              <input className={errs.authority ? 'acm-input-error' : ''} value={d.authority} onChange={e => set('authority', e.target.value)} placeholder="Enter issuing authority" />
            </Field>
            <Field label="Issuing Date" required error={errs.issueDate}>
              {/* maxDate constrains the picker to dates at or before the
                  chosen expiry, so the two fields can never disagree. */}
              <MasterDatePicker
                value={d.issueDate}
                maxDate={d.expiryDate || undefined}
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
              {/* minDate forces expiry ≥ issue date when both are picked. */}
              <MasterDatePicker
                value={d.expiryDate}
                minDate={d.issueDate || undefined}
                invalid={!!errs.expiryDate}
                onChange={(v: string) => set('expiryDate', v)}
                placeholder="DD/MM/YYYY"
              />
            </Field>
            <Field label="Attachments">
              <Tooltip label={d.attachment ? `Replace: ${d.attachment.name}` : 'Attach a file'}>
                <label className="acm-doc-attach">
                  <input type="file" hidden onChange={e => set('attachment', e.target.files?.[0] ?? null)} />
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
                  <span className="acm-doc-attach-label">{d.attachment ? (d.attachment.name.length > 14 ? d.attachment.name.slice(0, 14) + '…' : d.attachment.name) : 'ATTACH FILE'}</span>
                </label>
              </Tooltip>
            </Field>
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
      } else {
        alert(err?.response?.data?.message ?? 'Could not save the document type. Try again.');
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="acm-sub-modal acm-doc-type-sub-modal" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
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
                  { value: 'Vendor',   label: 'Vendor' },
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
    editing?: { id: number; owner_name: string; designation?: string | null; official_email?: string | null; phone_number?: string | null } | null;
    onClose: () => void;
    /** Fires with the saved server row so the parent can prepend / replace it
     *  in the Owner KYC table. */
    onSaved: (row: any) => void }) {
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
    if (!editing) {
      if (!d.idProof)        next.idProof      = 'ID proof is required';
      if (!d.addressProof)   next.addressProof = 'Address proof is required';
      if (!d.photograph)     next.photograph   = 'Photograph is required';
    }
    setErrs(next);
    if (Object.keys(next).length > 0) return;

    if (!customerId) {
      alert('Please save the customer (Stage 1) first before adding owner KYC.');
      return;
    }

    const fd = new FormData();
    fd.append('owner_name',     d.ownerName.trim());
    fd.append('designation',    d.designation);
    fd.append('official_email', d.officialEmail.trim());
    fd.append('phone_number',   d.phoneNumber.trim());
    if (d.idProof)      fd.append('id_proof',      d.idProof);
    if (d.addressProof) fd.append('address_proof', d.addressProof);
    if (d.photograph)   fd.append('photograph',    d.photograph);
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
      } else {
        alert(err?.response?.data?.message ?? 'Could not save the owner. Try again.');
      }
    } finally {
      setSaving(false);
    }
  };
  /** Renders one of the three file-upload pills. Same shape as the
   *  ATTACH FILE control on the other doc sub-modal, but bound to the
   *  named field key so its placeholder + error text can vary. */
  const FileField = ({ field, label }: { field: 'idProof' | 'addressProof' | 'photograph'; label: string }) => {
    const file = d[field];
    return (
      <Field label={label} required error={errs[field]}>
        <Tooltip label={file ? `Replace: ${file.name}` : `Upload ${label}`}>
          <label className={`acm-doc-attach ${errs[field] ? 'acm-input-error' : ''}`}>
            <input type="file" hidden onChange={e => set(field, e.target.files?.[0] ?? null)} />
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
            <span className="acm-doc-attach-label">
              {file ? (file.name.length > 18 ? file.name.slice(0, 18) + '…' : file.name) : `UPLOAD ${label.toUpperCase()}`}
            </span>
          </label>
        </Tooltip>
      </Field>
    );
  };
  return (
    <div className="acm-sub-modal" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
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
            <FileField field="idProof"      label="ID Proof" />
            <FileField field="addressProof" label="Address Proof" />
            <FileField field="photograph"   label="Photograph" />
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

/* ───── Location sub-modal (merged Address + Contact form) ───── */
function LocationSubModal({ editing, masters, onClose, onSave }:
  { editing: LocationRow | null; masters: MasterLists; onClose: () => void; onSave: (rec: Omit<LocationRow, 'id'>) => void }) {
  const [d, setD] = useState<Omit<LocationRow, 'id'>>(() => editing ? { ...editing } : {
    type: DEFAULT_ADDRESS_TYPE, line: '', country: '', state: '', city: '', pin: '',
    cpName: '', cpDesignation: '', cpContact: '', cpEmail: '', cpWhatsapp: '' as 'yes' | 'no' | '',
  });
  const [errs, setErrs] = useState<Record<string, string>>({});
  const set = <K extends keyof typeof d>(k: K, v: (typeof d)[K]) => {
    setD(prev => ({ ...prev, [k]: v }));
    setErrs(prev => { if (!prev[k as string]) return prev; const n = { ...prev }; delete n[k as string]; return n; });
  };
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
    else if (!/^[A-Za-z0-9-\s]{3,12}$/.test(d.pin))    next.pin           = 'PIN looks invalid';
    if (!d.cpName.trim())                              next.cpName        = 'Contact name required';
    if (!d.cpDesignation.trim())                       next.cpDesignation = 'Designation required';
    if (!d.cpContact.trim())                           next.cpContact     = 'Phone required';
    else if (!/^\+?[0-9\s-]{7,15}$/.test(d.cpContact)) next.cpContact     = 'Phone must be 7–15 digits';
    if (!d.cpEmail.trim())                             next.cpEmail       = 'Email required';
    else if (!/^\S+@\S+\.\S+$/.test(d.cpEmail))        next.cpEmail       = 'Enter a valid email';
    if (!d.cpWhatsapp)                                 next.cpWhatsapp    = 'Select WhatsApp preference';
    setErrs(next);
    if (Object.keys(next).length === 0) onSave(d);
  };
  return (
    <div className="acm-sub-modal" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
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
              <MasterSelect value={d.type} options={optsWith(masters.addressTypes, d.type)} placeholder="Select address type" invalid={!!errs.type} onChange={v => set('type', v)} />
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
            <Field label="Pin / Postal Code" required error={errs.pin}><input className={errs.pin ? 'acm-input-error' : ''} value={d.pin} onChange={e => set('pin', e.target.value)} maxLength={12} placeholder="Enter PIN" /></Field>
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
        <ReadInline label="Customer Segment"          value={form.coSeg} />
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

/* ───── Scoped CSS (root: .acm-root) ───── */
const SCOPED_CSS = `
.acm-root {
  position: fixed; inset: 0; z-index: 10000;
  display: flex; align-items: center; justify-content: center;
  padding: 16px;
  background: radial-gradient(ellipse at center, rgba(76,29,149,.45) 0%, rgba(15,5,40,.78) 100%);
  -webkit-backdrop-filter: blur(10px) saturate(1.3);
          backdrop-filter: blur(10px) saturate(1.3);
  font-family: 'DM Sans', system-ui, -apple-system, sans-serif;
  animation: acmFadeIn .25s ease;
}
@keyframes acmFadeIn { from { opacity: 0; } to { opacity: 1; } }

.acm-root *, .acm-root *::before, .acm-root *::after { box-sizing: border-box; }

.acm-card {
  /* Stable card size: width caps at 1200, height pins at 90vh so the
     modal doesn't reflow each time the user switches between Stage 1
     sub-tabs (the empty Address & Contact table is shorter than the
     full Identification form). Height = min(90vh, 100vh - 32px) keeps
     a small breathing gap on shorter viewports. */
  width: 100%; max-width: 1200px;
  height: min(90vh, calc(100vh - 32px));
  background: linear-gradient(165deg,#faf7ff 0%,#f5efff 45%,#ede9fe 100%);
  border: 1px solid rgba(167,139,250,.5);
  border-radius: 20px;
  box-shadow: 0 32px 80px -20px rgba(76,29,149,.55), 0 12px 30px rgba(15,5,40,.25), inset 0 1px 0 rgba(255,255,255,.75);
  overflow: hidden; display: flex; flex-direction: column;
  animation: acmSlideUp .35s cubic-bezier(.34,1.56,.64,1);
}
@keyframes acmSlideUp { from { opacity: 0; transform: translateY(24px) scale(.96); } to { opacity: 1; transform: translateY(0) scale(1); } }

.acm-header {
  background: linear-gradient(135deg,#2e1065 0%,#4c1d95 30%,#6d28d9 65%,#7c3aed 100%);
  padding: 16px 22px; display: flex; align-items: center; justify-content: space-between;
  position: relative; overflow: hidden; flex-shrink: 0;
}
.acm-header::before {
  content: ''; position: absolute; inset: 0; pointer-events: none;
  background-image: radial-gradient(ellipse at 15% 50%, rgba(167,139,250,.32) 0%, transparent 55%), radial-gradient(ellipse at 85% 50%, rgba(139,92,246,.22) 0%, transparent 55%);
}
.acm-header-left { display: flex; align-items: center; gap: 14px; position: relative; z-index: 1; }
.acm-header-icon { width: 40px; height: 40px; border-radius: 12px; background: rgba(255,255,255,.18); border: 1.5px solid rgba(255,255,255,.3); display: flex; align-items: center; justify-content: center; -webkit-backdrop-filter: blur(4px); backdrop-filter: blur(4px); flex-shrink: 0; }
.acm-title { font-size: 17px; font-weight: 800; color: #fff; letter-spacing: -.3px; line-height: 1.2; }
.acm-subtitle { font-size: 12px; color: rgba(255,255,255,.78); margin-top: 3px; }
.acm-close { width: 34px; height: 34px; border-radius: 50%; border: 1.5px solid rgba(255,255,255,.3); background: rgba(255,255,255,.1); color: #fff; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all .25s; position: relative; z-index: 1; }
.acm-close:hover { background: rgba(255,255,255,.28); transform: rotate(90deg); }

/* Stepper */
.acm-stepper { padding: 16px 22px 14px; display: flex; align-items: center; gap: 0; flex-shrink: 0; }
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
.acm-tabs { padding: 14px 22px 0; display: flex; gap: 8px; flex-shrink: 0; flex-wrap: wrap; }
.acm-tab { padding: 7px 18px; border-radius: 10px; border: 1.5px solid transparent; font-family: inherit; font-size: 12px; font-weight: 700; cursor: pointer; transition: all .2s; white-space: nowrap; }
.acm-tab-on { background: linear-gradient(135deg,#7c3aed,#6d28d9); color: #fff; border-color: #7c3aed; box-shadow: 0 3px 10px rgba(109,40,217,.35); }
.acm-tab-off { background: #fff; color: #6d28d9; border-color: #c4b5fd; }
.acm-tab-off:hover { background: #ede9fe; border-color: #7c3aed; }

/* Body */
.acm-body { flex: 1; overflow-y: auto; padding: 16px 22px 20px; scrollbar-width: thin; scrollbar-color: #a78bfa #ede9fe; }
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

/* Dark-mode variant. */
[data-bs-theme="dark"] .acm-hs-inline:hover { background: rgba(167,139,250,0.10); }
[data-bs-theme="dark"] .acm-hs-inline-lbl { color: #94a3b8; }
[data-bs-theme="dark"] .acm-hs-inline-val { color: #c4b5fd; }
[data-bs-theme="dark"] .acm-hs-inline-val.is-empty { color: #475569; }

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

/* Tables */
.acm-table-wrap { width: 100%; overflow-x: auto; }
.acm-table { width: 100%; border-collapse: collapse; font-size: 11.5px; min-width: 900px; }
.acm-table thead tr { background: linear-gradient(180deg, #faf7ff, #f5efff); }
.acm-table thead th { padding: 13px 14px; text-align: left; font-size: 9.5px; font-weight: 800; letter-spacing: .1em; color: #6b7280; text-transform: uppercase; border-bottom: 1px solid #ede9fe; white-space: nowrap; }
.acm-table tbody td { padding: 13px 14px; border-bottom: 1px solid #f5f3ff; color: #3b0764; vertical-align: middle; font-size: 11.5px; }
.acm-table tbody tr:last-child td { border-bottom: none; }
.acm-table tbody tr:hover td { background: #faf7ff; }
.acm-empty-row td { text-align: center; color: #9ca3af; padding: 26px 14px !important; font-size: 11.5px; font-style: italic; background: #fafaff; }
.acm-empty-row strong { color: #6d28d9; font-style: normal; }

/* Pills + chips */
.acm-doc-code { display: inline-block; padding: 3px 9px; border-radius: 6px; background: linear-gradient(135deg, #f5f3ff, #ede9fe); color: #5b21b6; font-family: 'JetBrains Mono', monospace; font-size: 10.5px; font-weight: 700; border: 1px solid #c4b5fd; letter-spacing: .02em; }
.acm-status-toggle { display: inline-flex; gap: 6px; align-items: center; }
.acm-status-mandatory, .acm-status-optional { display: inline-flex; align-items: center; gap: 4px; padding: 3px 10px; border-radius: 20px; font-size: 10.5px; font-weight: 700; border: 1px solid transparent; }
.acm-status-mandatory { background: #f5f3ff; color: #9ca3af; border-color: #e5e1f3; }
.acm-status-mandatory.is-on { background: linear-gradient(135deg, #dcfce7, #bbf7d0); color: #15803d; border-color: #86efac; }
.acm-status-optional { background: #fff; color: #9ca3af; border-color: #e5e1f3; }
.acm-status-optional.is-on { background: #fff; color: #374151; border-color: #9ca3af; font-weight: 700; }
.acm-status-active { display: inline-flex; align-items: center; gap: 5px; padding: 3px 11px; border-radius: 20px; font-size: 10.5px; font-weight: 700; background: linear-gradient(135deg, #dcfce7, #bbf7d0); color: #15803d; border: 1px solid #86efac; }
.acm-expiry-na, .acm-expiry-date, .acm-expiry-varies { display: inline-block; padding: 3px 11px; border-radius: 20px; font-size: 10.5px; font-weight: 700; white-space: nowrap; }
.acm-expiry-na { background: #f3f4f6; color: #6b7280; border: 1px solid #e5e7eb; }
.acm-expiry-date { background: linear-gradient(135deg,#fee2e2,#fecaca); color: #b91c1c; border: 1px solid #fca5a5; }
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
.acm-attach-link { display: inline-flex; align-items: center; gap: 5px; color: #2563eb; font-family: inherit; font-size: 11.5px; font-weight: 600; cursor: pointer; background: none; border: none; padding: 0; }
.acm-attach-link:hover { color: #1d4ed8; text-decoration: underline; }

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
[data-bs-theme="dark"] .acm-body { scrollbar-color: #4c1d95 #11182a; }
[data-bs-theme="dark"] .acm-body::-webkit-scrollbar-track { background: #11182a; }
[data-bs-theme="dark"] .acm-body::-webkit-scrollbar-thumb { background: #6d28d9; }

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

/* Section card */
[data-bs-theme="dark"] .acm-section { background: #11182a; border-color: rgba(167,139,250,0.20); box-shadow: 0 2px 12px rgba(0,0,0,0.35); }
[data-bs-theme="dark"] .acm-section-purple { border-top-color: #a78bfa; }
[data-bs-theme="dark"] .acm-section-head { background: linear-gradient(110deg, rgba(76,29,149,0.28) 0%, rgba(109,40,217,0.18) 100%); border-bottom-color: rgba(167,139,250,0.15); }
[data-bs-theme="dark"] .acm-section-icon { background: linear-gradient(135deg, #4c1d95, #2e1065); color: #c4b5fd; border-color: rgba(167,139,250,0.35); }
[data-bs-theme="dark"] .acm-section-title { color: #ede9fe; }
[data-bs-theme="dark"] .acm-section-sub { color: #94a3b8; }

/* Form fields */
[data-bs-theme="dark"] .acm-field label { color: #94a3b8; }
[data-bs-theme="dark"] .acm-field input,
[data-bs-theme="dark"] .acm-field select,
[data-bs-theme="dark"] .acm-field textarea {
  background: #1c2531 !important;
  border-color: rgba(167,139,250,0.20);
  color: #f1f5f9;
}
[data-bs-theme="dark"] .acm-field input::placeholder,
[data-bs-theme="dark"] .acm-field textarea::placeholder { color: #475569; }
[data-bs-theme="dark"] .acm-field input:focus,
[data-bs-theme="dark"] .acm-field select:focus,
[data-bs-theme="dark"] .acm-field textarea:focus {
  border-color: #a78bfa;
  box-shadow: 0 0 0 3.5px rgba(167,139,250,0.18);
}
[data-bs-theme="dark"] .acm-field input.acm-input-error { background: rgba(239,68,68,0.10); border-color: #ef4444; }
[data-bs-theme="dark"] .acm-radio { color: #94a3b8; }
[data-bs-theme="dark"] .acm-radio-pill { background: #1c2531; border-color: rgba(167,139,250,0.20); color: #c4b5fd; }
[data-bs-theme="dark"] .acm-radio-pill.is-active { background: rgba(124,58,237,0.30); border-color: #a78bfa; color: #ede9fe; }

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
[data-bs-theme="dark"] .acm-expiry-na { background: rgba(255,255,255,0.05); color: #94a3b8; border-color: rgba(255,255,255,0.10); }
[data-bs-theme="dark"] .acm-expiry-date { background: rgba(239,68,68,0.18); color: #fca5a5; border-color: rgba(239,68,68,0.40); }
[data-bs-theme="dark"] .acm-expiry-varies { background: rgba(245,158,11,0.18); color: #fcd34d; border-color: rgba(245,158,11,0.40); }
[data-bs-theme="dark"] .acm-doc-code { background: rgba(167,139,250,0.15); color: #c4b5fd; border-color: rgba(167,139,250,0.30); }
[data-bs-theme="dark"] .acm-pill-yes { background: rgba(16,185,129,0.18); color: #6ee7b7; border-color: rgba(16,185,129,0.40); }
[data-bs-theme="dark"] .acm-pill-no  { background: rgba(255,255,255,0.06); color: #94a3b8; border-color: rgba(255,255,255,0.20); }
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
[data-bs-theme="dark"] .acm-doc-search { background: #1c2531; border-color: rgba(167,139,250,0.20); }
[data-bs-theme="dark"] .acm-doc-search input { background: transparent; color: #f1f5f9; }
[data-bs-theme="dark"] .acm-doc-search input::placeholder { color: #475569; }
[data-bs-theme="dark"] .acm-doc-search-icon { color: #94a3b8; }
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
[data-bs-theme="dark"] .acm-footer { background: rgba(28,37,49,0.40); border-top-color: rgba(167,139,250,0.18); }
[data-bs-theme="dark"] .acm-req-note { color: #94a3b8; }
[data-bs-theme="dark"] .acm-btn-prev { background: transparent; color: #c4b5fd; border-color: rgba(167,139,250,0.40); }
[data-bs-theme="dark"] .acm-btn-prev:hover { background: rgba(167,139,250,0.12); }

/* Error message text under invalid fields */
[data-bs-theme="dark"] .acm-field-error { color: #fca5a5; }
`;
