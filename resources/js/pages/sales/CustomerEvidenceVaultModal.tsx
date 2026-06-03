import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import api from '../../api';
import Tooltip from '../../components/ui/Tooltip';
import { useToast } from '../../contexts/ToastContext';
import { signatureRequestsToVaultDocs, mergeTradeDocuments, type SigReqRow } from '../../utils/vaultSignatureRows';
import SalesCustomerSendForSignatureModal from './SalesCustomerSendForSignatureModal';

/* ────────────────────────────────────────────────────────────────────────────
 * Customer Evidence Vault — read-only compliance archive
 *
 * Single-customer popup that shows every piece of compliance evidence
 * tied to that customer in five buckets:
 *
 *   1. Company Due Diligence — PAN, TAN, GST, CIN, IEC, Address Proof, …
 *   2. Owner KYC Details     — Aadhaar, PAN, Passport, Director address …
 *   3. Trade Licenses        — IEC, APEDA, Agro Export Permit, Organic …
 *   4. Trade Documents       — Master Sales Agreement, PO Framework, NDA …
 *   5. Shipment Agreements   — per-shipment matrix (Buyer = Consignee / ≠)
 *
 * Header carries the per-customer status: total docs, verified count,
 * pending count, and per-bucket counts. Footer has Export All + Close.
 *
 * Backend wiring (planned, NOT live yet):
 *   GET /api/customers/{id}/vault → { stats, company_dd, owner_kyc,
 *                                     trade_licenses, trade_documents,
 *                                     shipment_agreements, last_updated }
 *
 * The component takes a `data` prop matching the VaultData shape below
 * so the future API integration is a one-line swap: replace the demo
 * builder with an api.get(`/customers/${id}/vault`) call. The shape is
 * intentionally flat so a single endpoint can hydrate the whole panel.
 * ──────────────────────────────────────────────────────────────────── */

/* ─── API contract — when the backend is built, this is the response
 *      shape the endpoint must return so the modal plugs in unchanged. */
export type VaultStatus = 'Verified' | 'Pending' | 'Expiring' | 'Signed';

export interface VaultDoc {
  id: number;
  /** clm_trade_doc_library.id — set on Trade Document rows so the vault
   *  can launch Send-for-Signature and merge live signing status. */
  db_id?: number | null;
  /** Applicable-party CSV (Trade Document rows only) used to party-filter
   *  the tab to match the edit form. */
  party?: string | null;
  /** Zoho Sign request id + raw status backing this Trade Document row.
   *  Drive the Send / Reminder / View-only gating: once sent the row
   *  shows Reminder (not Send); once signed it shows View only. */
  signature_request_id?: number | null;
  sig_state?: string | null;
  name: string;
  reference?: string | null;       // license number / reference no
  authority?: string | null;       // issuing authority / counter party
  issue_date?: string | null;      // DD/MM/YYYY for display
  expiry?: string | null;          // DD/MM/YYYY or "Lifetime" or "—"
  attachment?: string | null;      // filename only — URL resolved by parent
  /** Live storage URL for the uploaded file. Server-resolved so the
   *  modal doesn't need to know about the disk layout. When present
   *  the attachment cell renders as a clickable link. */
  attachment_url?: string | null;
  status: VaultStatus;
  /** Master doc-code (DD-001, KYC-002, …). Needed by the Actions column
   *  so a re-upload can POST to /segment-uploads with the right key. */
  doc_code?: string | null;
  /** URL to the Zoho-issued Certificate of Completion. Set on rows
   *  that came from a completed Zoho Sign request; renders the
   *  certificate icon button in the Actions column. */
  certificate_url?: string | null;
}

export interface VaultShipmentRow {
  id: number;
  shipment_id: string;             // SHP-2026-00487
  opportunity_id: string;          // OPP-107
  customer: string;
  country: string;
  due_dil:    { ratio: string; pct: number };   // "2/2"  + 100
  kyc:        { ratio: string; pct: number };
  trade_lic:  { ratio: string; pct: number };
  trade_docs: { ratio: string; pct: number };
  agreement:  { ratio: string; pct: number };
  risk: 'Compliant' | 'Medium' | 'High';
  buyer_is_consignee: boolean;
}

export interface VaultData {
  total_documents:        number;
  verified_signed:        number;
  pending:                number;
  company_dd_count:       number;
  owner_kyc_count:        number;
  trade_license_count:    number;
  trade_documents_count:  number;
  total_shipments:        number;
  company_dd:             VaultDoc[];
  owner_kyc:              VaultDoc[];
  trade_licenses:         VaultDoc[];
  trade_documents:        VaultDoc[];
  shipment_agreements:    VaultShipmentRow[];
  last_updated:           string;   // DD/MM/YYYY
}

export interface CustomerVaultTarget {
  id: string;             // C-001
  db_id?: number;
  company: string;
  risk?: string;          // Low / Medium / High
  type?: string;          // Retailer / Wholesaler / …
  segment?: string;       // Dry Fruits / Handicrafts …
  country?: string;
  contact?: string;
  contactCity?: string;
}

interface Props {
  open: boolean;
  customer: CustomerVaultTarget | null;
  onClose: () => void;
  /** Optional override — when the backend is wired, the parent passes
   *  the API response. Until then, the demo builder below produces a
   *  realistic snapshot for the design review. */
  data?: VaultData | null;
  /** Tab to open on. Lets callers deep-link straight to a bucket — e.g.
   *  the Buyer Profile page opens the vault on 'owner-kyc' when a KYC
   *  progress cell is clicked. Defaults to 'company-dd'. */
  initialTab?: TabKey;
}

export type TabKey = 'company-dd' | 'owner-kyc' | 'trade-licenses' | 'trade-documents' | 'shipment-agreements';

/* Top-level grouping — the tabs are split into two buckets:
 *   • standard      — one-time party documents (KYC, DD, Trade Licenses)
 *   • case-to-case  — per-deal records (Trade Documents, Agreements)
 * The header shows the two group cards; the sub-tab row below shows only
 * the tabs belonging to the active group. */
type GroupKey = 'standard' | 'case-to-case';

const GROUPS: { key: GroupKey; title: string; sub: string; icon: string }[] = [
  { key: 'standard',     title: 'Standard Documents',      sub: 'ONE TIME · KYC, DD & LICENSES',        icon: 'ri-shield-check-line' },
  { key: 'case-to-case', title: 'Case to Case Agreements', sub: 'PER DEAL · TRADE DOCS & AGREEMENTS',    icon: 'ri-todo-line' },
];

const TABS: { key: TabKey; label: string; icon: string; countKey: keyof VaultData; group: GroupKey }[] = [
  { key: 'company-dd',          label: 'Company Due Diligence', icon: 'ri-shield-check-line',   countKey: 'company_dd_count',       group: 'standard' },
  { key: 'owner-kyc',           label: 'Owner KYC Details',     icon: 'ri-user-3-line',         countKey: 'owner_kyc_count',        group: 'standard' },
  { key: 'trade-licenses',      label: 'Trade Licenses',        icon: 'ri-file-list-3-line',    countKey: 'trade_license_count',    group: 'standard' },
  { key: 'trade-documents',     label: 'Trade Documents',       icon: 'ri-article-line',        countKey: 'trade_documents_count',  group: 'case-to-case' },
  { key: 'shipment-agreements', label: 'Agreements',            icon: 'ri-truck-line',          countKey: 'total_shipments',        group: 'case-to-case' },
];

/* Which group a tab belongs to — used to sync the group cards when the
 * active tab is set programmatically (e.g. via initialTab deep-link). */
const groupOfTab = (t: TabKey): GroupKey => TABS.find(x => x.key === t)?.group ?? 'standard';

/* ─── Demo-data builder — produces a realistic vault snapshot keyed
 *      off the customer's id so the same customer always renders the
 *      same numbers during design review. Swap this for the API call
 *      when the backend lands. */
function buildDemoVault(customer: CustomerVaultTarget): VaultData {
  return {
    total_documents:       22,
    verified_signed:       18,
    pending:               2,
    company_dd_count:      8,
    owner_kyc_count:       5,
    trade_license_count:   4,
    trade_documents_count: 3,
    total_shipments:       4,
    company_dd: [
      { id: 1, name: 'Company PAN',          reference: 'AABCT1234F',     authority: 'Income Tax Dept', issue_date: '01/01/2023', expiry: '01/01/2028', attachment: 'CompanyPAN.pdf',     status: 'Verified' },
      { id: 2, name: 'Company TAN',          reference: 'PNET01234B',     authority: 'Income Tax Dept', issue_date: '01/01/2023', expiry: '01/01/2028', attachment: 'CompanyTAN.pdf',     status: 'Verified' },
      { id: 3, name: 'Company GST',          reference: '27AABCT1234F1Z5', authority: 'GST Portal',     issue_date: '01/01/2023', expiry: '01/01/2028', attachment: 'CompanyGST.pdf',     status: 'Verified' },
      { id: 4, name: 'CIN / Shop Act',       reference: 'U72900MH2019PTC', authority: 'MCA',           issue_date: '01/01/2022', expiry: '—',           attachment: 'CIN.pdf',            status: 'Verified' },
      { id: 5, name: 'IEC Code',             reference: '0412345678',     authority: 'DGFT',           issue_date: '01/01/2021', expiry: '—',           attachment: 'IECCode.pdf',        status: 'Verified' },
      { id: 6, name: 'Business Address Proof', reference: '1234567890',   authority: '—',              issue_date: '01/01/2022', expiry: '01/01/2027', attachment: 'AddressProof.pdf',   status: 'Verified' },
      { id: 7, name: 'Cancelled Cheque',     reference: '1234567890',     authority: 'HDFC Bank',     issue_date: '01/01/2025', expiry: '—',           attachment: 'CancelledCheque.pdf', status: 'Expiring' },
      { id: 8, name: 'FSSAI License',        reference: '10223452000120', authority: 'FSSAI',         issue_date: '01/03/2024', expiry: '01/03/2025', attachment: 'FSSAI.pdf',          status: 'Pending' },
    ],
    owner_kyc: [
      { id: 1, name: 'Aadhaar Card',         reference: 'XXXX-XXXX-3456', authority: 'UIDAI',            issue_date: '01/05/2018', expiry: 'Lifetime', attachment: 'Aadhaar.pdf',     status: 'Verified' },
      { id: 2, name: 'PAN Card',             reference: 'BVKPJ5678K',     authority: 'Income Tax Dept', issue_date: '01/01/2015', expiry: 'Lifetime', attachment: 'PANCard.pdf',     status: 'Verified' },
      { id: 3, name: 'Passport',             reference: 'P4521876J',      authority: 'MEA India',       issue_date: '15/06/2020', expiry: '15/06/2030', attachment: 'Passport.pdf',    status: 'Verified' },
      { id: 4, name: 'Director Address Proof', reference: '—',             authority: '—',               issue_date: '01/01/2024', expiry: '01/01/2026', attachment: 'DirAddress.pdf',  status: 'Verified' },
      { id: 5, name: 'DIN Certificate',      reference: '07654321',       authority: 'MCA',             issue_date: '—',           expiry: '—',           attachment: 'DIN.pdf',          status: 'Pending' },
    ],
    trade_licenses: [
      { id: 1, name: 'Import Export License', reference: 'IEC-0412345678',      authority: 'DGFT',          issue_date: '01/01/2021', expiry: 'Lifetime',   attachment: 'IECLicense.pdf',  status: 'Verified' },
      { id: 2, name: 'APEDA Registration',    reference: 'APEDA/REG/2021/7823', authority: 'APEDA',          issue_date: '15/03/2021', expiry: '14/03/2027', attachment: 'APEDA.pdf',       status: 'Verified' },
      { id: 3, name: 'Agro Export Permit',    reference: 'AGRO/EXP/MH/4512',    authority: 'State Agri Dept', issue_date: '01/06/2023', expiry: '01/06/2026', attachment: 'AgroPermit.pdf',  status: 'Expiring' },
      { id: 4, name: 'Organic Certification', reference: 'NPOP/ORG/2022/1134',  authority: 'APEDA / NPOP',   issue_date: '10/10/2022', expiry: '09/10/2027', attachment: 'OrganicCert.pdf', status: 'Verified' },
    ],
    trade_documents: [
      { id: 1, name: 'Master Sales Agreement', reference: 'MSA/CUST/2024/001', authority: customer.company, issue_date: '01/04/2024', expiry: '31/03/2027', attachment: 'MSA.pdf',         status: 'Verified' },
      { id: 2, name: 'Purchase Order Framework', reference: 'POF/CUST/2024/012', authority: customer.company, issue_date: '15/04/2024', expiry: '14/04/2026', attachment: 'POFramework.pdf', status: 'Verified' },
      { id: 3, name: 'NDA & Confidentiality', reference: 'NDA/CUST/2025/003', authority: customer.company, issue_date: '—',           expiry: '—',          attachment: 'NDA.pdf',         status: 'Pending' },
    ],
    shipment_agreements: [
      { id: 1, shipment_id: 'SHP-2026-00487', opportunity_id: 'OPP-107', customer: customer.company,    country: customer.country ?? 'India',
        due_dil: { ratio: '2/2', pct: 100 }, kyc: { ratio: '3/3', pct: 100 }, trade_lic: { ratio: '1/1', pct: 100 }, trade_docs: { ratio: '4/4', pct: 100 }, agreement: { ratio: '1/1', pct: 100 }, risk: 'Compliant', buyer_is_consignee: true },
      { id: 2, shipment_id: 'SHP-2026-00328', opportunity_id: 'OPP-028', customer: 'GreenHarvest Global Ltd', country: 'United States',
        due_dil: { ratio: '0/2', pct: 0 },   kyc: { ratio: '0/4', pct: 0 },   trade_lic: { ratio: '0/1', pct: 0 },   trade_docs: { ratio: '0/4', pct: 0 },   agreement: { ratio: '0/1', pct: 0 },   risk: 'Medium', buyer_is_consignee: false },
      { id: 3, shipment_id: 'SHP-2026-00512', opportunity_id: 'OPP-134', customer: 'Eastern Harvest Co.',    country: 'UAE',
        due_dil: { ratio: '1/2', pct: 50 },  kyc: { ratio: '2/3', pct: 67 },  trade_lic: { ratio: '1/1', pct: 100 }, trade_docs: { ratio: '2/4', pct: 50 },  agreement: { ratio: '0/1', pct: 0 },   risk: 'Medium', buyer_is_consignee: true },
      { id: 4, shipment_id: 'SHP-2026-00601', opportunity_id: 'OPP-156', customer: 'International Buyer LLC', country: 'UAE',
        due_dil: { ratio: '2/2', pct: 100 }, kyc: { ratio: '3/3', pct: 100 }, trade_lic: { ratio: '1/1', pct: 100 }, trade_docs: { ratio: '4/4', pct: 100 }, agreement: { ratio: '1/1', pct: 100 }, risk: 'Compliant', buyer_is_consignee: true },
    ],
    last_updated: '04/05/2026',
  };
}

export default function CustomerEvidenceVaultModal({ open, customer, onClose, data, initialTab }: Props) {
  const toast = useToast();
  const [tab, setTab] = useState<TabKey>('company-dd');
  const [group, setGroup] = useState<GroupKey>('standard');
  const [shipmentFilter, setShipmentFilter] = useState<'all' | 'buyer-eq-consignee' | 'buyer-neq-consignee'>('all');

  /* Switch the active group and jump to its first sub-tab. */
  const selectGroup = (g: GroupKey) => {
    setGroup(g);
    const first = TABS.find(t => t.group === g);
    if (first) setTab(first.key);
  };
  const kpiStripRef = useRef<HTMLDivElement | null>(null);
  const [kpiPaused, setKpiPaused] = useState(false);
  /* Export All — in-flight flag drives spinner + disabled state on
   * the footer button while the XLSX workbook is being assembled. */
  const [exporting, setExporting] = useState(false);
  /* Live vault payload from GET /segment-uploads/customer/{id}/vault.
   * Stays null until the fetch resolves; null + loading lets the modal
   * render a skeleton instead of demo numbers. */
  const [vaultLive, setVaultLive] = useState<VaultData | null>(null);
  const [loading, setLoading] = useState(false);
  /* Zoho Sign signature requests for this customer — fetched in parallel
   * with the vault payload and merged into the Trade Documents tab as
   * "Signed" / "Pending" rows. Completion certificates surface as their
   * own rows (one per completed request), matching New_IDIMS_6.0. */
  const [signatureRows, setSignatureRows] = useState<SigReqRow[]>([]);
  /* Send-for-Signature launch state — when non-null, the Zoho Sign
   * wizard opens with these clm_trade_doc_library ids pre-checked. Driven
   * by the Trade Documents tab's per-row Send button. */
  const [sendDocIds, setSendDocIds] = useState<number[] | null>(null);

  /* Close on Escape — destructive shortcut is fine for a read-only
   * panel since there's no in-flight edit to lose. */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    // Open on the caller-requested tab (deep-link from the Buyer Profile
    // progress cells), falling back to the first tab — and sync the group
    // card to whichever group that tab lives in.
    const startTab = initialTab ?? 'company-dd';
    setTab(startTab);
    setGroup(groupOfTab(startTab));
    setShipmentFilter('all');
    return () => window.removeEventListener('keydown', onKey);
  }, [open, customer?.db_id, onClose, initialTab]);

  /* Fetch the vault payload when the modal opens for a new customer.
   * Skips the fetch when (a) the parent passed an override via `data`
   * or (b) customer has no db_id (unsaved record). On failure the
   * `vaultLive` stays null and the demo builder takes over so the
   * design review still has something to render. */
  /* Re-fetch the vault payload — called both by the open-effect below
   * and by the Actions column after a successful re-upload so the row
   * picks up the new attachment_url without a full modal re-open. */
  const reloadVault = useCallback(() => {
    if (!customer?.db_id) return Promise.resolve();
    setLoading(true);
    return api.get(`/segment-uploads/customer/${customer.db_id}/vault`)
      .then(r => { setVaultLive((r.data?.data ?? null) as VaultData | null); })
      .catch(() => { /* leave previous vault state intact on transient failures */ })
      .finally(() => setLoading(false));
  }, [customer?.db_id]);

  useEffect(() => {
    if (!open || !customer?.db_id || data) {
      setVaultLive(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    api.get(`/segment-uploads/customer/${customer.db_id}/vault`)
      .then(r => { if (!cancelled) setVaultLive((r.data?.data ?? null) as VaultData | null); })
      .catch(() => { if (!cancelled) setVaultLive(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, customer?.db_id, data]);

  /* Fetch signature requests for this customer in parallel with the
   * vault. sync=true triggers a Zoho round-trip for any still-inprogress
   * rows so the vault reflects "Signed" the moment the recipient
   * finishes signing, not just on the next vault open. */
  /* Re-fetch signature requests — used by the open-effect and after a
   * Send so the Trade Documents tab flips to "Pending"/"Signed" without
   * re-opening the vault. */
  const reloadSignatures = useCallback(() => {
    if (!customer?.db_id) return Promise.resolve();
    return api.get('/clm/signature-requests', {
      params: { party_id: customer.db_id, model_name: 'Customer', sync: 1 },
    })
      .then(r => { setSignatureRows(Array.isArray(r.data?.data) ? (r.data.data as SigReqRow[]) : []); })
      .catch(() => { /* keep previous rows on transient failure */ });
  }, [customer?.db_id]);

  /* Send a Zoho reminder for an already-sent (in-progress) trade doc.
   * Returns a promise so the row button can show a busy state. */
  const handleRemind = useCallback(async (doc: VaultDoc) => {
    if (!doc.signature_request_id) return;
    try {
      await api.post(`/clm/signature-requests/${doc.signature_request_id}/remind`);
      toast.success('Reminder sent', 'The signer has been reminded to sign this document.');
      await reloadSignatures();
    } catch (e: any) {
      toast.error('Could not send reminder', e?.response?.data?.message || 'The reminder could not be sent.');
    }
  }, [reloadSignatures, toast]);

  useEffect(() => {
    if (!open || !customer?.db_id) { setSignatureRows([]); return; }
    let cancelled = false;
    api.get('/clm/signature-requests', {
      params: { party_id: customer.db_id, model_name: 'Customer', sync: 1 },
    })
      .then(r => {
        if (cancelled) return;
        const rows = Array.isArray(r.data?.data) ? (r.data.data as SigReqRow[]) : [];
        setSignatureRows(rows);
      })
      .catch(() => { if (!cancelled) setSignatureRows([]); });
    return () => { cancelled = true; };
  }, [open, customer?.db_id]);

  /* Auto-scroll the KPI ribbon — continuous one-way drift. Tiles are
   * rendered twice (see render below), so when scrollLeft reaches the
   * halfway mark we snap back to 0 — invisible because the second
   * half is byte-identical to the first. Pauses on hover/touch. */
  useEffect(() => {
    if (!open || kpiPaused) return;
    const strip = kpiStripRef.current;
    if (!strip) return;
    let raf = 0;
    const tick = () => {
      if (!strip) return;
      const half = strip.scrollWidth / 2;
      if (half <= 4) return;
      strip.scrollLeft += 0.6;
      if (strip.scrollLeft >= half) {
        // Seamless wrap — jump back by exactly one cycle.
        strip.scrollLeft -= half;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [open, kpiPaused, tab]);

  const vault: VaultData | null = useMemo(() => {
    if (!customer) return null;
    /* Source priority: explicit `data` prop > live API > demo. The
     * demo path stays as a graceful fallback when the API hasn't run
     * yet, errors out, or the customer has no db_id. */
    const base = data ?? vaultLive ?? buildDemoVault(customer);
    if (!base) return null;
    // Trade Documents tab = the party's expected trade docs (segment-rule
    // td, party-filtered to mirror the edit form) merged with their live
    // Zoho Sign status. Each row exposes Send-for-Signature; signed rows
    // also carry the signed PDF + certificate links.
    const sigRows            = signatureRequestsToVaultDocs(signatureRows);
    const baseSegmentTd      = (base.trade_documents ?? []) as VaultDoc[];
    const mergedTd           = mergeTradeDocuments(baseSegmentTd as any, sigRows, 'buyer') as unknown as VaultDoc[];
    const baseSegmentSigned  = baseSegmentTd.filter(r => r.status === 'Verified' || r.status === 'Signed').length;
    const baseSegmentPending = baseSegmentTd.filter(r => r.status === 'Pending').length;
    const mergedSigned       = mergedTd.filter(r => r.status === 'Verified' || r.status === 'Signed').length;
    const mergedPending      = mergedTd.filter(r => r.status === 'Pending').length;
    return {
      ...base,
      trade_documents: mergedTd as typeof base.trade_documents,
      trade_documents_count: mergedTd.length,
      // KPI roll-ups: swap the raw segment-rule TD contribution for the
      // merged (party-filtered + signature-aware) numbers.
      verified_signed: Math.max(0, (base.verified_signed ?? 0) - baseSegmentSigned) + mergedSigned,
      pending:         Math.max(0, (base.pending ?? 0)         - baseSegmentPending) + mergedPending,
      total_documents: Math.max(0, (base.total_documents ?? 0) - baseSegmentTd.length) + mergedTd.length,
    };
  }, [customer, data, vaultLive, signatureRows]);

  /* Export All — builds a multi-sheet Excel workbook of every tab
   * in the vault (Summary, Company DD, Owner KYC, Trade Licenses,
   * Trade Documents, Shipment Agreements). One workbook = one
   * self-contained compliance archive snapshot the user can email
   * / file. Mirrors ConsigneeEvidenceVaultModal so both vaults
   * behave the same way. */
  const handleExportAll = async () => {
    if (!vault || !customer || exporting) return;
    setExporting(true);
    try {
      const fmtDate = (d?: string | null) => (d && d !== 'N/A') ? d : '';
      const docRow = (d: VaultDoc, i: number) => ({
        '#':                  i + 1,
        'Doc Code':           d.doc_code || '',
        'Document Name':      d.name || '',
        'Reference / Number': d.reference || '',
        'Issuing Authority':  d.authority || '',
        'Issue Date':         fmtDate(d.issue_date),
        'Expiry':             fmtDate(d.expiry),
        'Status':             d.status || '',
        'Attachment':         d.attachment || '',
        'Attachment URL':     d.attachment_url || '',
      });
      const shipmentRow = (s: VaultShipmentRow, i: number) => ({
        '#':                 i + 1,
        'Shipment ID':       s.shipment_id || '',
        'Opportunity ID':    s.opportunity_id || '',
        'Customer':          s.customer || '',
        'Country':           s.country || '',
        'Due Diligence':     s.due_dil?.ratio || '',
        'KYC':               s.kyc?.ratio || '',
        'Trade Licence':     s.trade_lic?.ratio || '',
        'Trade Docs':        s.trade_docs?.ratio || '',
        'Agreement':         s.agreement?.ratio || '',
        'Risk':              s.risk || '',
        'Buyer = Consignee': s.buyer_is_consignee ? 'Yes' : 'No',
      });

      const summary = [
        { Field: 'Customer ID',           Value: customer.id },
        { Field: 'Company',               Value: customer.company },
        { Field: 'Risk',                  Value: customer.risk || '' },
        { Field: 'Type',                  Value: customer.type || '' },
        { Field: 'Segment',               Value: customer.segment || '' },
        { Field: 'Country',               Value: customer.country || '' },
        { Field: 'Contact',               Value: customer.contact || '' },
        { Field: 'Total Documents',       Value: vault.total_documents },
        { Field: 'Verified / Signed',     Value: vault.verified_signed },
        { Field: 'Pending',               Value: vault.pending },
        { Field: 'Company Due Diligence', Value: vault.company_dd_count },
        { Field: 'Owner KYC',             Value: vault.owner_kyc_count },
        { Field: 'Trade Licenses',        Value: vault.trade_license_count },
        { Field: 'Trade Documents',       Value: vault.trade_documents_count },
        { Field: 'Shipment Agreements',   Value: vault.total_shipments },
        { Field: 'Last Updated',          Value: vault.last_updated || '' },
        { Field: 'Exported At',           Value: new Date().toLocaleString('en-IN') },
      ];

      const wb = XLSX.utils.book_new();
      const append = (name: string, rows: any[]) => {
        // Empty buckets still get a sheet (with a placeholder row) so
        // the workbook structure matches what the modal shows.
        const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ '#': '', 'Document Name': '(no records)' }]);
        XLSX.utils.book_append_sheet(wb, ws, name);
      };

      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary), 'Summary');
      append('Company Due Diligence', vault.company_dd.map(docRow));
      append('Owner KYC',             vault.owner_kyc.map(docRow));
      append('Trade Licenses',        vault.trade_licenses.map(docRow));
      append('Trade Documents',       vault.trade_documents.map(docRow));
      const shipRows = vault.shipment_agreements.map(shipmentRow);
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.json_to_sheet(shipRows.length ? shipRows : [{ '#': '', 'Shipment ID': '(no records)' }]),
        'Shipment Agreements'
      );

      const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      const stamp = new Date().toISOString().slice(0, 10);
      const safeId = (customer.id || 'customer').replace(/[^A-Za-z0-9_-]/g, '_');
      saveAs(
        new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
        `EvidenceVault_${safeId}_${stamp}.xlsx`,
      );

      const totalRows = vault.company_dd.length + vault.owner_kyc.length
                      + vault.trade_licenses.length + vault.trade_documents.length
                      + vault.shipment_agreements.length;
      toast.success('Exported', `${totalRows} record${totalRows === 1 ? '' : 's'} across 6 sheets.`);
    } catch (err: any) {
      toast.error('Export failed', err?.message || 'Could not generate the Excel file.');
    } finally {
      setExporting(false);
    }
  };

  if (!open || !customer || !vault) return null;

  /* ─── Status pill renderer — Verified (mint), Expiring (amber),
   *      Pending (rose), Signed (sky). Same palette across all tabs. */
  const StatusPill = ({ s }: { s: VaultStatus }) => {
    const tone =
      s === 'Verified' ? { bg: '#d1fae5', fg: '#047857', mark: '✓' }
      : s === 'Signed'   ? { bg: '#dbeafe', fg: '#1e40af', mark: '✓' }
      : s === 'Expiring' ? { bg: '#fef3c7', fg: '#92400e', mark: '⚠' }
      :                    { bg: '#fee2e2', fg: '#b91c1c', mark: '⌛' };
    return (
      <span className="cev-pill" style={{ background: tone.bg, color: tone.fg }}>
        {tone.mark} {s}
      </span>
    );
  };

  /* ─── Filter chips above each docs table (Verified / Expiring /
   *      Pending) — pure counters from the bucket data. */
  const docsForTab: VaultDoc[] = tab === 'company-dd' ? vault.company_dd
    : tab === 'owner-kyc'      ? vault.owner_kyc
    : tab === 'trade-licenses' ? vault.trade_licenses
    : tab === 'trade-documents' ? vault.trade_documents
    : [];
  const counts = {
    Verified: docsForTab.filter(d => d.status === 'Verified' || d.status === 'Signed').length,
    Expiring: docsForTab.filter(d => d.status === 'Expiring').length,
    Pending:  docsForTab.filter(d => d.status === 'Pending').length,
  };

  const tabMeta = TABS.find(t => t.key === tab)!;

  return createPortal(
    <div className="cev-overlay" role="dialog" aria-modal="true" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <style>{CEV_CSS}</style>
      <div className="cev-card" onMouseDown={(e) => e.stopPropagation()}>
        {/* ─── HEADER ─── */}
        <div className="cev-header">
          <div className="cev-header-bg" aria-hidden />
          <span className="cev-header-orb" aria-hidden />
          <div className="cev-header-content">
            <div className="cev-header-left">
              <div className="cev-vault-icon">
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="3" width="20" height="5" rx="1.5" />
                  <path d="M4 8v12a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V8" />
                  <line x1="10" y1="13" x2="14" y2="13" />
                  <line x1="10" y1="17" x2="14" y2="17" />
                </svg>
                <span className="cev-vault-icon-tick" aria-hidden>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5"><polyline points="20 6 9 17 4 12" /></svg>
                </span>
              </div>
              <div className="cev-header-text">
                <div className="cev-header-eyebrow">— EVIDENCE VAULT</div>
                <div className="cev-header-title">{customer.company}</div>
                <div className="cev-header-chips">
                  <span className="cev-chip cev-chip-id">● {customer.id}</span>
                  <span className="cev-chip cev-chip-risk"  data-risk={(customer.risk ?? 'Low').toLowerCase()}>● {customer.risk ?? 'Low'} Risk</span>
                  {customer.contact && (
                    <span className="cev-chip cev-chip-contact">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                      {customer.contact}{customer.contactCity ? ` · ${customer.contactCity}` : ''}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div className="cev-header-right">
              <div className="cev-header-meta">
                {customer.type && <span>{customer.type}</span>}
                {customer.segment && <span>· {customer.segment}</span>}
                {customer.country && <span>· {customer.country}</span>}
              </div>
              <button type="button" className="cev-close" onClick={onClose} aria-label="Close vault">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
          </div>
        </div>

        {/* ─── KPI STRIP — auto-scrolling ribbon. Drifts continuously,
             pauses on hover/touch, with manual prev/next arrows for
             accessible control. Edge fade-masks soften the boundary
             where tiles meet the arrow buttons. */}
        <div
          className="cev-kpi-outer"
          onMouseEnter={() => setKpiPaused(true)}
          onMouseLeave={() => setKpiPaused(false)}
          onTouchStart={() => setKpiPaused(true)}
          onTouchEnd={() => setKpiPaused(false)}
        >
          <span className="cev-kpi-fade cev-kpi-fade-l" aria-hidden />
          <span className="cev-kpi-fade cev-kpi-fade-r" aria-hidden />
          <button
            type="button"
            className="cev-kpi-nav cev-kpi-nav-prev"
            aria-label="Scroll KPIs left"
            onClick={() => kpiStripRef.current?.scrollBy({ left: -260, behavior: 'smooth' })}
          >
            <i className="ri-arrow-left-s-line" />
          </button>
          <button
            type="button"
            className="cev-kpi-nav cev-kpi-nav-next"
            aria-label="Scroll KPIs right"
            onClick={() => kpiStripRef.current?.scrollBy({ left: 260, behavior: 'smooth' })}
          >
            <i className="ri-arrow-right-s-line" />
          </button>
          <div
            ref={kpiStripRef}
            className="cev-kpi-strip"
            onWheel={(e) => {
              if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
                e.currentTarget.scrollLeft += e.deltaY;
              }
            }}
          >
          {/* Tiles rendered twice — the duplicate set powers the
              seamless infinite loop. The auto-scroll effect snaps
              scrollLeft back by exactly one cycle when it crosses
              the halfway mark, so the wrap is invisible. */}
          {[0, 1].map((cycle) => (
            <div key={cycle} className="cev-kpi-cycle" aria-hidden={cycle === 1 ? true : undefined}>
              <KpiTile label="Total Documents"        value={vault.total_documents}        icon="ri-file-list-3-line"        gradient="linear-gradient(135deg, #6d28d9 0%, #7c3aed 100%)" />
              <KpiTile label="Verified / Signed"      value={vault.verified_signed}        icon="ri-shield-check-line"       gradient="linear-gradient(135deg, #16a34a 0%, #4ade80 100%)" />
              <KpiTile label="Pending"                value={vault.pending}                icon="ri-time-line"               gradient="linear-gradient(135deg, #d97706 0%, #f59e0b 100%)" />
              <KpiTile label="Company Due Diligence"  value={vault.company_dd_count}       icon="ri-building-line"           gradient="linear-gradient(135deg, #7c3aed 0%, #a78bfa 100%)" />
              <KpiTile label="Owner KYC"              value={vault.owner_kyc_count}        icon="ri-user-3-line"             gradient="linear-gradient(135deg, #5b21b6 0%, #7c3aed 100%)" />
              <KpiTile label="Trade License"          value={vault.trade_license_count}    icon="ri-government-line"         gradient="linear-gradient(135deg, #8b5cf6 0%, #c4b5fd 100%)" />
              <KpiTile label="Trade Documents"        value={vault.trade_documents_count}  icon="ri-article-line"            gradient="linear-gradient(135deg, #6366f1 0%, #a5b4fc 100%)" />
              <KpiTile label="Total Shipments"        value={vault.total_shipments}        icon="ri-truck-line"              gradient="linear-gradient(135deg, #4c1d95 0%, #7c3aed 100%)" />
            </div>
          ))}
          </div>
        </div>

        {/* ─── GROUP CARDS — Standard Documents vs Case to Case. */}
        <div className="cev-groups-wrap">
          <div className="cev-groups">
            {GROUPS.map(g => (
              <button
                key={g.key}
                type="button"
                className={`cev-group ${group === g.key ? 'is-active' : ''}`}
                onClick={() => selectGroup(g.key)}
              >
                <span className="cev-group-icon"><i className={g.icon} aria-hidden /></span>
                <span className="cev-group-text">
                  <span className="cev-group-title">{g.title}</span>
                  <span className="cev-group-sub">{g.sub}</span>
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* ─── SUB-TABS — pill ribbon for the active group. */}
        <div className="cev-tabs-wrap">
          <div className="cev-tabs">
            {TABS.filter(t => t.group === group).map(t => (
              <button
                key={t.key}
                type="button"
                className={`cev-tab ${tab === t.key ? 'is-active' : ''}`}
                onClick={() => setTab(t.key)}
              >
                <span className="cev-tab-icon"><i className={t.icon} aria-hidden /></span>
                <span className="cev-tab-label">{t.label}</span>
                <span className="cev-tab-count">{vault[t.countKey] as number}</span>
              </button>
            ))}
          </div>
        </div>

        {/* ─── BODY ─── */}
        <div className="cev-body">
          {/* Section banner — explains what the active tab holds. */}
          <div className="cev-section">
            <div className="cev-section-left">
              <div className="cev-section-icon"><i className={tabMeta.icon} /></div>
              <div>
                <div className="cev-section-title">{tabMeta.label}</div>
                <div className="cev-section-sub">{sectionSub(tab)}</div>
              </div>
            </div>
            <div className="cev-section-right">
              <div className="cev-section-count">{vault[tabMeta.countKey] as number}</div>
              <div className="cev-section-count-label">{tab === 'shipment-agreements' ? 'SHIPMENTS' : 'DOCUMENTS'}</div>
            </div>
          </div>

          {/* Tables */}
          {tab === 'shipment-agreements'
            ? <ShipmentTable rows={vault.shipment_agreements} filter={shipmentFilter} setFilter={setShipmentFilter} />
            : <DocsTable rows={docsForTab} tab={tab} ownerType="customer" ownerId={customer?.db_id ?? null} onReload={reloadVault}
                         onSendTradeDoc={(d) => { if (d.db_id) setSendDocIds([d.db_id]); }}
                         onRemindTradeDoc={handleRemind} />}
        </div>

        {/* ─── FOOTER ─── */}
        <div className="cev-footer">
          <div className="cev-footer-meta">
            Last updated: <b>{vault.last_updated}</b> · Vault managed by Compliance Team
          </div>
          <div className="cev-footer-actions">
            <Tooltip label="Download every tab (Company DD, Owner KYC, Trade Licenses, Trade Documents, Shipments) as a single .xlsx workbook">
              <button
                type="button"
                className="cev-btn cev-btn-light"
                onClick={handleExportAll}
                disabled={exporting}
                style={exporting ? { opacity: 0.7, cursor: 'wait' } : undefined}
              >
                <i className={exporting ? 'ri-loader-4-line cev-spin' : 'ri-download-cloud-2-line'} />
                {exporting ? ' Exporting…' : ' Export All'}
              </button>
            </Tooltip>
            <button type="button" className="cev-btn cev-btn-dark" onClick={onClose}>
              Close Vault
            </button>
          </div>
        </div>
      </div>

      {/* Send for Signature — launched from a Trade Documents row. The
          modal portals to <body>, so it overlays the vault cleanly. */}
      <SalesCustomerSendForSignatureModal
        open={Array.isArray(sendDocIds)}
        customer={customer?.db_id ? {
          id:      customer.id,
          db_id:   customer.db_id,
          company: customer.company,
          contact: customer.contact,
        } : null}
        modelName="Customer"
        preselectedDocIds={sendDocIds ?? undefined}
        onClose={() => setSendDocIds(null)}
        onSent={() => { setSendDocIds(null); void reloadSignatures(); }}
      />
    </div>,
    document.body
  );
}

/* ─── KPI tile — project-standard card pattern (mirrors the Master
 *      pages' .mp-kpi-tile). Top gradient accent strip, label +
 *      value on the left, gradient icon square on the right. */
function KpiTile({ label, value, icon, gradient }: { label: string; value: number; icon: string; gradient: string }) {
  return (
    <div className="cev-kpi-tile">
      <span className="cev-kpi-strip-top" style={{ background: gradient }} aria-hidden />
      <div className="cev-kpi-body">
        <div className="cev-kpi-text">
          <div className="cev-kpi-label">{label.toUpperCase()}</div>
          <div className="cev-kpi-value">{value.toLocaleString()}</div>
        </div>
        <div className="cev-kpi-icon" style={{ background: gradient }}>
          <i className={icon} aria-hidden />
        </div>
      </div>
    </div>
  );
}

/* ─── Docs table — used by 4 of the 5 tabs. */
function DocsTable({ rows, tab, ownerType, ownerId, onReload, onSendTradeDoc, onRemindTradeDoc }: {
  rows: VaultDoc[];
  tab: TabKey;
  ownerType: 'customer' | 'consignee' | 'supplier';
  ownerId: number | null;
  onReload: () => Promise<void> | void;
  onSendTradeDoc?: (doc: VaultDoc) => void;
  onRemindTradeDoc?: (doc: VaultDoc) => void | Promise<void>;
}) {
  const numberHeader = tab === 'company-dd' ? 'License / Number' : tab === 'owner-kyc' ? 'Document Number' : tab === 'trade-licenses' ? 'License Number' : 'Reference No';
  const authorityLbl = tab === 'trade-documents' ? 'Counter Party' : 'Issuing Authority';
  /* Tab → SegmentDocUpload category for the re-upload endpoint. */
  const category: 'kyc' | 'dd' | 'tl' | 'td' = tab === 'company-dd' ? 'dd' : tab === 'owner-kyc' ? 'kyc' : tab === 'trade-licenses' ? 'tl' : 'td';
  return (
    <div className="cev-table-wrap">
      <div className="cev-table-scroll">
      <table className="cev-table">
        <thead>
          <tr>
            <th style={{ width: 56 }}>SR</th>
            <th>Document Name</th>
            <th>{numberHeader}</th>
            <th>{authorityLbl}</th>
            <th>Attachment</th>
            <th style={{ width: 140 }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={6} className="cev-empty">No documents in this bucket yet.</td></tr>
          ) : rows.map((d, i) => (
            <tr key={d.id}>
              <td>{i + 1}</td>
              <td className="cev-doc-name">{d.name}</td>
              <td className="cev-mono">{d.reference || '—'}</td>
              <td>{d.authority || '—'}</td>
              <td>
                {d.attachment ? (
                  d.attachment_url ? (
                    <Tooltip label={`Open ${d.attachment}`}>
                      <a href={d.attachment_url} target="_blank" rel="noreferrer" className="cev-attach" style={{ textDecoration: 'none' }}>
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                        {d.attachment}
                      </a>
                    </Tooltip>
                  ) : (
                    <Tooltip label={d.attachment}>
                      <span className="cev-attach">
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                        {d.attachment}
                      </span>
                    </Tooltip>
                  )
                ) : <span className="cev-muted">Not uploaded</span>}
              </td>
              <td>
                <VaultRowActions doc={d} ownerType={ownerType} ownerId={ownerId} category={category} onReload={onReload} onSendTradeDoc={onSendTradeDoc} onRemindTradeDoc={onRemindTradeDoc} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}

/* View / Download / Re-upload actions. View opens the attachment in a new
 * tab; Download triggers a save via the `download` attribute on a hidden
 * link; Re-upload posts to /segment-uploads/{type}/{id} with the same
 * (category, doc_code) tuple so the existing row is replaced server-side. */
function VaultRowActions({ doc, ownerType, ownerId, category, onReload, onSendTradeDoc, onRemindTradeDoc }: {
  doc: VaultDoc;
  ownerType: 'customer' | 'consignee' | 'supplier';
  ownerId: number | null;
  category: 'kyc' | 'dd' | 'tl' | 'td';
  onReload: () => Promise<void> | void;
  onSendTradeDoc?: (doc: VaultDoc) => void;
  onRemindTradeDoc?: (doc: VaultDoc) => void | Promise<void>;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [reminding, setReminding] = useState(false);
  const canViewOrDownload = !!doc.attachment_url;
  const canReupload = !!ownerId && !!doc.doc_code;
  // Signing lifecycle for Trade Document rows:
  //   • signed (completed)   → no Send / no Reminder, View signed + cert only
  //   • sent (inprogress)    → no Send, Reminder only
  //   • never sent / dead    → Send available (declined / recalled / expired
  //                            count as "dead" so a fresh round can start)
  const isSigned     = doc.sig_state === 'completed' || doc.status === 'Signed';
  const isInProgress = doc.sig_state === 'inprogress';
  const isTradeDoc   = category === 'td' && !!ownerId && !!doc.db_id;
  const canSend   = isTradeDoc && !!onSendTradeDoc && !isSigned && !isInProgress;
  const canRemind = isTradeDoc && !!onRemindTradeDoc && isInProgress && !!doc.signature_request_id;

  const remind = async () => {
    if (!onRemindTradeDoc) return;
    setReminding(true);
    try { await onRemindTradeDoc(doc); } finally { setReminding(false); }
  };

  const download = () => {
    if (!doc.attachment_url) return;
    const a = document.createElement('a');
    a.href = doc.attachment_url;
    a.download = doc.attachment || '';
    a.target = '_blank';
    a.rel = 'noreferrer';
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const onPick = async (f: File | undefined) => {
    if (!f || !ownerId || !doc.doc_code) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('category', category);
      fd.append('doc_code', doc.doc_code);
      fd.append('doc_name', doc.name || doc.doc_code);
      fd.append('attachment', f);
      await api.post(`/segment-uploads/${ownerType}/${ownerId}`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      await onReload();
    } catch {
      // intentionally silent — parent toast pattern not threaded through here
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="cev-row-actions">
      <input
        ref={fileRef}
        type="file"
        hidden
        accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx"
        onChange={e => { void onPick(e.target.files?.[0] ?? undefined); e.currentTarget.value = ''; }}
      />
      {canSend && (
        <Tooltip label="Send for signature">
          <button
            type="button"
            onClick={() => onSendTradeDoc!(doc)}
            className="cev-row-act cev-row-act-send"
            aria-label="Send for signature"
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: 28, height: 28, borderRadius: 6,
              background: '#ede9fe', color: '#6d28d9', border: '1px solid #c4b5fd',
              cursor: 'pointer',
            }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
          </button>
        </Tooltip>
      )}
      {canRemind && (
        <Tooltip label={reminding ? 'Sending reminder…' : 'Send signing reminder'}>
          <button
            type="button"
            onClick={remind}
            disabled={reminding}
            className="cev-row-act cev-row-act-remind"
            aria-label="Send reminder"
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: 28, height: 28, borderRadius: 6,
              background: '#fef3c7', color: '#b45309', border: '1px solid #fcd34d',
              cursor: reminding ? 'wait' : 'pointer', opacity: reminding ? 0.7 : 1,
            }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
          </button>
        </Tooltip>
      )}
      <Tooltip label={canViewOrDownload ? `View ${doc.attachment}` : 'No attachment yet'}>
        <a
          href={canViewOrDownload ? doc.attachment_url! : undefined}
          target={canViewOrDownload ? '_blank' : undefined}
          rel="noreferrer"
          aria-disabled={!canViewOrDownload}
          className={`cev-row-act cev-row-act-view ${!canViewOrDownload ? 'is-disabled' : ''}`}
          onClick={e => { if (!canViewOrDownload) e.preventDefault(); }}
          aria-label="View"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
        </a>
      </Tooltip>
      <Tooltip label={canViewOrDownload ? `Download ${doc.attachment}` : 'No attachment yet'}>
        <button
          type="button"
          disabled={!canViewOrDownload}
          onClick={download}
          className={`cev-row-act cev-row-act-download ${!canViewOrDownload ? 'is-disabled' : ''}`}
          aria-label="Download"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        </button>
      </Tooltip>
      <Tooltip label={canReupload ? (busy ? 'Uploading…' : (doc.attachment ? 'Re-upload (replace file)' : 'Upload')) : 'Save the record first'}>
        <button
          type="button"
          disabled={!canReupload || busy}
          onClick={() => fileRef.current?.click()}
          className={`cev-row-act cev-row-act-upload ${(!canReupload || busy) ? 'is-disabled' : ''}`}
          aria-label={doc.attachment ? 'Re-upload' : 'Upload'}
        >
          {busy
            ? <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
            : doc.attachment
              ? <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
              : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>}
        </button>
      </Tooltip>
      {/* Certificate of Completion — only rendered when this row came
          from a completed Zoho Sign request. Mirrors the faCertificate
          action in New_IDIMS_6.0's Stage3Tab2DocumentationArchive. */}
      {doc.certificate_url && (
        <Tooltip label="Certificate of Completion">
          <a
            href={doc.certificate_url}
            target="_blank"
            rel="noreferrer"
            className="cev-row-act cev-row-act-cert"
            aria-label="Certificate of Completion"
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: 28, height: 28, borderRadius: 6,
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
  );
}

/* ─── Shipment agreements matrix — different shape from the docs
 *      tables, so it gets its own renderer. */
function ShipmentTable({ rows, filter, setFilter }: {
  rows: VaultShipmentRow[];
  filter: 'all' | 'buyer-eq-consignee' | 'buyer-neq-consignee';
  setFilter: (f: 'all' | 'buyer-eq-consignee' | 'buyer-neq-consignee') => void;
}) {
  const filtered = rows.filter(r =>
    filter === 'all' ? true
    : filter === 'buyer-eq-consignee' ? r.buyer_is_consignee
    : !r.buyer_is_consignee
  );
  return (
    <>
      <div className="cev-ship-filter">
        <button type="button" className={`cev-ship-fbtn ${filter === 'all' ? 'is-active' : ''}`} onClick={() => setFilter('all')}>All Shipments</button>
        <button type="button" className={`cev-ship-fbtn ${filter === 'buyer-eq-consignee' ? 'is-active' : ''}`} onClick={() => setFilter('buyer-eq-consignee')}>✓ Buyer = Consignee</button>
        <button type="button" className={`cev-ship-fbtn ${filter === 'buyer-neq-consignee' ? 'is-active' : ''}`} onClick={() => setFilter('buyer-neq-consignee')}>✕ Buyer ≠ Consignee</button>
      </div>
      <div className="cev-table-wrap">
        <div className="cev-table-scroll">
        <table className="cev-table">
          <thead>
            <tr>
              <th style={{ width: 56 }}>SR</th>
              <th>Shipment ID</th>
              <th>Opportunity ID</th>
              <th>Customer</th>
              <th>Country</th>
              <th>Due Dil.</th>
              <th>KYC</th>
              <th>Trade Lic.</th>
              <th>Trade Docs</th>
              <th>Agreement</th>
              <th>Risk</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={11} className="cev-empty">No shipments match the filter.</td></tr>
            ) : filtered.map((r, i) => (
              <tr key={r.id}>
                <td>{i + 1}</td>
                <td><span className="cev-chip-pill">● {r.shipment_id}</span></td>
                <td><span className="cev-chip-pill cev-chip-pill-warm">● {r.opportunity_id}</span></td>
                <td>
                  <span className="cev-cust-cell">
                    <span className="cev-cust-mono">{r.customer.charAt(0)}</span>
                    {r.customer}
                  </span>
                </td>
                <td>{r.country}</td>
                <td><Ratio r={r.due_dil} /></td>
                <td><Ratio r={r.kyc} /></td>
                <td><Ratio r={r.trade_lic} /></td>
                <td><Ratio r={r.trade_docs} /></td>
                <td><Ratio r={r.agreement} /></td>
                <td>
                  <span className={`cev-pill cev-risk-${r.risk.toLowerCase()}`}>
                    {r.risk === 'Compliant' ? '✓' : '⚠'} {r.risk}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
    </>
  );
}

function Ratio({ r }: { r: { ratio: string; pct: number } }) {
  /* Compact SVG donut — 38px circle, ratio inside, hover-portal
   * tooltip with completion percentage and a status word.
   *
   * Self-contained tooltip (not the project Tooltip component) so it
   * is guaranteed to render above the modal overlay (z-index 11200)
   * regardless of any other stacking gotchas. Position is computed
   * from the trigger's getBoundingClientRect and clamped to the
   * viewport so it never falls offscreen. */
  const tone = r.pct >= 100 ? 'good' : r.pct >= 50 ? 'mid' : 'bad';
  const status = tone === 'good' ? 'Complete' : tone === 'mid' ? 'Partial' : 'Missing';
  const radius = 15;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (Math.min(100, Math.max(0, r.pct)) / 100) * circumference;

  const triggerRef = useRef<HTMLSpanElement | null>(null);
  const [tip, setTip] = useState<{ top: number; left: number } | null>(null);

  const showTip = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    // Tooltip is ~80×46px; centre horizontally above the donut.
    const W = 86, H = 50, gap = 8;
    let left = rect.left + rect.width / 2 - W / 2;
    let top  = rect.top - H - gap;
    // Flip below the donut if there isn't room above.
    if (top < 6) top = rect.bottom + gap;
    // Clamp to viewport.
    left = Math.max(6, Math.min(left, window.innerWidth - W - 6));
    setTip({ top, left });
  };
  const hideTip = () => setTip(null);

  return (
    <>
      <span
        ref={triggerRef}
        className="cev-ratio"
        data-tone={tone}
        onMouseEnter={showTip}
        onMouseLeave={hideTip}
        onFocus={showTip}
        onBlur={hideTip}
        tabIndex={0}
      >
        <svg width="38" height="38" viewBox="0 0 38 38" aria-hidden>
          <circle className="cev-ratio-track" cx="19" cy="19" r={radius} fill="none" strokeWidth="3.5" />
          <circle
            className="cev-ratio-arc"
            cx="19" cy="19" r={radius}
            fill="none" strokeWidth="3.5"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            strokeLinecap="round"
            transform="rotate(-90 19 19)"
          />
        </svg>
        <span className="cev-ratio-label">{r.ratio}</span>
      </span>
      {tip && createPortal(
        <div className="cev-ratio-tip" style={{ top: tip.top, left: tip.left }} role="tooltip">
          <b className="cev-ratio-tip-pct" data-tone={tone}>{r.pct}%</b>
          <span className="cev-ratio-tip-meta">{r.ratio} · {status}</span>
        </div>,
        document.body,
      )}
    </>
  );
}

function sectionSub(tab: TabKey): string {
  switch (tab) {
    case 'company-dd':       return 'Business registration, tax, compliance & identity documents';
    case 'owner-kyc':        return 'Director identity, address proof & personal compliance documents';
    case 'trade-licenses':   return 'Export, import & product-specific trade authorization licenses';
    case 'trade-documents':  return 'Sales contracts, purchase orders & signed trade agreements';
    case 'shipment-agreements': return 'Per-shipment compliance matrix grouped by buyer-consignee link';
  }
}

/* ─── Scoped CSS (all rules under .cev-*) ─── */
/* Violet palette — matches the Sales → Customers page (purple WDH
   strip, violet Add Customer button, lavender table header). The
   vault opens FROM that page so it should feel like an extension of
   it, not a sibling module. Emerald is reserved for the Consignee
   module which has its own visual identity. */
const CEV_CSS = `
.cev-overlay {
  position: fixed; inset: 0;
  background: rgba(40,18,80,0.45);
  -webkit-backdrop-filter: blur(6px);
  backdrop-filter: blur(6px);
  z-index: 11200;
  display: flex; align-items: stretch; justify-content: flex-end;
  font-family: 'DM Sans','Inter',system-ui,-apple-system,sans-serif;
  animation: cevFade .18s ease both;
}
@keyframes cevFade { from { opacity: 0; } to { opacity: 1; } }
.cev-card {
  position: relative;
  width: min(1280px, 90vw);
  height: 100vh;
  background: #faf7ff;
  /* No curve — straight edges so the drawer feels like a flush
     extension of the page rather than a floating card. */
  border-radius: 0;
  overflow: hidden;
  display: flex; flex-direction: column;
  box-shadow: -32px 0 80px rgba(40,18,80,.40), -12px 0 30px rgba(40,18,80,.18);
  animation: cevSlide .26s cubic-bezier(.22,1,.36,1) both;
}
@keyframes cevSlide { from { transform: translateX(40px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }

/* ─── HEADER ─── */
.cev-header {
  position: relative;
  flex-shrink: 0;
  padding: 14px 22px;
  background: linear-gradient(135deg, #4c1d95 0%, #6d28d9 35%, #7c3aed 65%, #a78bfa 100%);
  color: #fff;
  overflow: hidden;
}
/* Decorative bubble cluster — mirrors the green Figma reference. Pure
   CSS circles sized + positioned so they read as soft floating orbs on
   the right side of the gradient. pointer-events: none keeps them
   purely cosmetic. */
.cev-header-bg {
  position: absolute; inset: 0;
  pointer-events: none;
  overflow: hidden;
  background:
    radial-gradient(circle at 100% 0%, rgba(221,214,254,0.32), transparent 45%),
    radial-gradient(circle at 0% 100%, rgba(167,139,250,0.30), transparent 55%);
}
.cev-header-bg::before,
.cev-header-bg::after {
  content: '';
  position: absolute;
  border-radius: 50%;
  background: radial-gradient(circle at 30% 30%, rgba(255,255,255,0.22), rgba(255,255,255,0.06) 60%, transparent 75%);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.18);
}
.cev-header-bg::before { width: 220px; height: 220px; top: -80px; right: -40px; }
.cev-header-bg::after  { width: 130px; height: 130px; bottom: -45px; right: 130px;
  background: radial-gradient(circle at 30% 30%, rgba(196,181,253,0.30), rgba(196,181,253,0.06) 60%, transparent 75%); }
/* Extra orb via a span on the JSX side too — gives a third bubble
   without nesting another wrapper. */
.cev-header-orb {
  position: absolute;
  width: 90px; height: 90px;
  top: 8px; right: 220px;
  border-radius: 50%;
  background: radial-gradient(circle at 30% 30%, rgba(255,255,255,0.18), rgba(255,255,255,0.04) 60%, transparent 75%);
  pointer-events: none;
}
.cev-header-content {
  position: relative;
  display: flex; align-items: center; justify-content: space-between; gap: 20px;
}
.cev-header-left { display: flex; align-items: center; gap: 12px; min-width: 0; }
.cev-vault-icon {
  position: relative;
  width: 42px; height: 42px; border-radius: 12px;
  background: rgba(255,255,255,0.18);
  border: 1.5px solid rgba(255,255,255,0.35);
  display: inline-flex; align-items: center; justify-content: center;
  color: #fff;
  box-shadow: 0 4px 14px rgba(0,0,0,.18);
  -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px);
  flex-shrink: 0;
}
.cev-vault-icon-tick {
  position: absolute; top: -3px; right: -3px;
  width: 18px; height: 18px; border-radius: 50%;
  background: #a78bfa; color: #2e1065;
  display: inline-flex; align-items: center; justify-content: center;
  border: 2px solid #6d28d9;
}
.cev-header-text { min-width: 0; }
.cev-header-eyebrow { font-size: 9.5px; font-weight: 700; letter-spacing: .12em; color: rgba(255,255,255,.78); margin-bottom: 2px; }
.cev-header-title { font-size: 18px; font-weight: 800; letter-spacing: -0.01em; line-height: 1.15; margin-bottom: 6px; color: #fff; }
.cev-header-chips { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.cev-chip { display: inline-flex; align-items: center; gap: 5px; padding: 3px 9px; border-radius: 999px; font-size: 10.5px; font-weight: 600; background: rgba(255,255,255,0.16); border: 1px solid rgba(255,255,255,0.24); color: #f5f3ff; }
.cev-chip-id { background: rgba(255,255,255,0.20); }
.cev-chip-risk[data-risk="low"]    { background: rgba(16,185,129,0.30); color: #ecfdf5; }
.cev-chip-risk[data-risk="medium"] { background: rgba(245,158,11,0.30); color: #fef3c7; }
.cev-chip-risk[data-risk="high"]   { background: rgba(239,68,68,0.30);  color: #fee2e2; }

.cev-header-right { display: flex; align-items: center; gap: 12px; flex-shrink: 0; }
.cev-header-meta { font-size: 11px; color: rgba(255,255,255,.84); display: inline-flex; gap: 4px; align-items: center; }
.cev-header-meta span { white-space: nowrap; }
.cev-close {
  width: 28px; height: 28px; border-radius: 50%;
  display: inline-flex; align-items: center; justify-content: center;
  background: rgba(255,255,255,0.18); color: #fff; border: 1px solid rgba(255,255,255,0.28);
  cursor: pointer; transition: all .15s;
  flex-shrink: 0;
}
.cev-close:hover { background: rgba(255,255,255,0.30); transform: rotate(90deg); }

/* ─── KPI STRIP — auto-scrolling ribbon with edge fades. Tiles
   stay at fixed width; the strip drifts continuously and pauses on
   hover. Manual arrows remain for accessibility. Edge fade-masks
   soften the boundary so tiles dissolve into the arrow buttons
   instead of getting clipped under them. */
.cev-kpi-outer {
  position: relative;
  flex-shrink: 0;
  background: linear-gradient(180deg, #faf7ff 0%, #f5f3ff 100%);
  border-bottom: 1px solid #ede9fe;
}
.cev-kpi-strip {
  display: flex; gap: 12px; align-items: stretch;
  padding: 14px 64px;          /* room for the absolute arrow buttons */
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;       /* Firefox */
  -ms-overflow-style: none;    /* Edge legacy */
  scroll-behavior: smooth;
}
.cev-kpi-strip::-webkit-scrollbar { display: none; }
.cev-kpi-cycle {
  display: flex; gap: 12px; align-items: stretch;
  flex-shrink: 0;
  margin-right: 12px;        /* match strip gap between the two cycles */
}
.cev-kpi-cycle:last-child { margin-right: 0; }
.cev-kpi-fade {
  position: absolute;
  top: 0; bottom: 0;
  width: 70px;
  pointer-events: none;
  z-index: 3;
}
.cev-kpi-fade-l {
  left: 0;
  background: linear-gradient(90deg, #faf7ff 0%, #faf7ff 25%, rgba(250,247,255,0) 100%);
}
.cev-kpi-fade-r {
  right: 0;
  background: linear-gradient(270deg, #f5f3ff 0%, #f5f3ff 25%, rgba(245,243,255,0) 100%);
}
.cev-kpi-nav {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  z-index: 5;
  width: 34px; height: 34px;
  border-radius: 50%;
  border: none;
  background: linear-gradient(135deg, #ffffff 0%, #f5f3ff 100%);
  color: #6d28d9;
  display: inline-flex; align-items: center; justify-content: center;
  cursor: pointer;
  box-shadow:
    0 2px 6px rgba(124,58,237,0.18),
    0 8px 22px rgba(40,18,80,0.18),
    inset 0 0 0 1px rgba(124,58,237,0.20);
  transition: all .18s ease;
  font-size: 18px;
}
.cev-kpi-nav:hover {
  background: linear-gradient(135deg, #6d28d9, #7c3aed);
  color: #fff;
  transform: translateY(-50%) scale(1.10);
  box-shadow:
    0 4px 10px rgba(124,58,237,0.30),
    0 10px 26px rgba(124,58,237,0.45);
}
.cev-kpi-nav:active { transform: translateY(-50%) scale(0.96); }
.cev-kpi-nav-prev { left: 14px; }
.cev-kpi-nav-next { right: 14px; }
.cev-kpi-tile {
  position: relative;
  flex: 0 0 220px;            /* fixed width — strip scrolls when many */
  scroll-snap-align: start;
  background: var(--vz-card-bg, #fff);
  border: 1px solid rgba(124,58,237,0.16);
  border-radius: 12px;
  padding: 12px 14px;
  box-shadow: 0 2px 10px rgba(40,18,80,0.06);
  overflow: hidden;
  min-width: 0;
  transition: transform 180ms ease, box-shadow 220ms ease, border-color 180ms ease;
}
.cev-kpi-tile:hover {
  transform: translateY(-1px);
  box-shadow: 0 6px 18px rgba(40,18,80,0.10);
  border-color: rgba(124,58,237,0.30);
}
.cev-kpi-strip-top {
  position: absolute; top: 0; left: 0; right: 0; height: 3px;
}
.cev-kpi-body {
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
}
.cev-kpi-text { min-width: 0; }
.cev-kpi-label {
  font-size: 10.5px; font-weight: 700; letter-spacing: .06em;
  color: var(--vz-secondary-color, #6b7280);
  text-transform: uppercase;
  margin-bottom: 6px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.cev-kpi-value {
  font-size: 22px; font-weight: 800; line-height: 1;
  color: var(--vz-heading-color, #2b3245);
}
.cev-kpi-icon {
  width: 38px; height: 38px; border-radius: 10px;
  display: inline-flex; align-items: center; justify-content: center;
  color: #fff;
  font-size: 18px;
  flex-shrink: 0;
  box-shadow: 0 4px 10px rgba(0,0,0,0.10);
}

/* ─── TABS — pill ribbon. Inactive tabs read as soft chips,
   active tab gets a violet gradient + lifted shadow. Animated icon
   square and pill count badge keep the row visually rich. */
/* ─── GROUP CARDS — two big selectors that split the sub-tabs into
   Standard Documents (one-time) and Case to Case Agreements (per-deal). */
.cev-groups-wrap {
  flex-shrink: 0;
  background: linear-gradient(180deg, #faf7ff 0%, #f5f3ff 100%);
  padding: 14px 18px 0;
}
.cev-groups { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.cev-group {
  display: flex; align-items: center; gap: 14px;
  padding: 13px 18px;
  background: #ffffff;
  border: 1.5px solid #e9e3fb;
  border-radius: 14px;
  cursor: pointer;
  text-align: left;
  transition: all .2s ease;
}
.cev-group:hover { border-color: #c4b5fd; background: #faf7ff; }
.cev-group.is-active {
  background: linear-gradient(120deg, #4c1d95 0%, #6d28d9 55%, #7c3aed 100%);
  border-color: #6d28d9;
  box-shadow: 0 6px 18px rgba(109,40,217,.35);
}
.cev-group-icon {
  width: 42px; height: 42px; flex-shrink: 0;
  display: inline-flex; align-items: center; justify-content: center;
  border-radius: 12px;
  background: #f1edfd; color: #6d28d9; border: 1px solid #e0d8fa;
  font-size: 20px;
}
.cev-group.is-active .cev-group-icon { background: rgba(255,255,255,.18); color: #fff; border-color: rgba(255,255,255,.25); }
.cev-group-text { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.cev-group-title { font-size: 15px; font-weight: 800; color: #1e1b4b; letter-spacing: -.01em; }
.cev-group.is-active .cev-group-title { color: #ffffff; }
.cev-group-sub { font-size: 10.5px; font-weight: 700; letter-spacing: .06em; color: #8b80b5; }
.cev-group.is-active .cev-group-sub { color: rgba(255,255,255,.8); }

.cev-tabs-wrap {
  flex-shrink: 0;
  background: linear-gradient(180deg, #faf7ff 0%, #f5f3ff 100%);
  border-bottom: 1px solid #ede9fe;
  padding: 12px 18px;
}
.cev-tabs {
  display: flex; gap: 8px;
  overflow-x: auto;
  scrollbar-width: none;
  padding-bottom: 2px;
}
.cev-tabs::-webkit-scrollbar { display: none; }
/* Tab pill — restyled to match AddCustomerModal's .acm-tab (Stage 1
 * Customer Identification / Address & Contact Details). Same clean
 * rounded-rectangle pill + solid 1.5px border + simpler gradient on
 * active. Icons and count badges are retained (functionality stays
 * intact) but the icon circle's heavy background was dropped so the
 * icon reads as part of the label, not as a separate chip stuck to
 * the tab. */
.cev-tab {
  flex: 0 0 auto;
  position: relative;
  display: inline-flex; align-items: center; gap: 8px;
  padding: 8px 16px;
  background: #ffffff;
  border: 1.5px solid #c4b5fd;
  border-radius: 12px;
  color: #6d28d9;
  font-size: 12.5px; font-weight: 700;
  cursor: pointer;
  transition: all .2s ease;
  white-space: nowrap;
}
.cev-tab-icon {
  width: 18px; height: 18px;
  display: inline-flex; align-items: center; justify-content: center;
  background: transparent;
  color: #6d28d9;
  font-size: 15px;
  flex-shrink: 0;
  transition: color .18s ease;
}
.cev-tab-label { white-space: nowrap; }
.cev-tab:hover {
  background: #ede9fe;
  border-color: #7c3aed;
  color: #4c1d95;
}
.cev-tab:hover .cev-tab-icon { color: #4c1d95; }
.cev-tab.is-active {
  background: linear-gradient(135deg, #7c3aed, #6d28d9);
  border-color: #7c3aed;
  color: #ffffff;
  box-shadow: 0 3px 10px rgba(109,40,217,.35);
}
.cev-tab.is-active .cev-tab-icon { color: #ffffff; }
.cev-tab-count {
  background: #ede9fe; color: #5b21b6;
  font-size: 10.5px; font-weight: 800; letter-spacing: 0.02em;
  padding: 2px 8px; border-radius: 999px;
  min-width: 22px; text-align: center;
  transition: all .18s ease;
}
.cev-tab.is-active .cev-tab-count {
  background: rgba(255,255,255,0.28);
  color: #ffffff;
}

/* ─── BODY ─── */
.cev-body {
  flex: 1; min-height: 0; overflow-y: auto;
  padding: 18px 24px 22px;
  display: flex; flex-direction: column; gap: 14px;
  /* Match the visible scrollbar pattern used by [[AddVendorModal]]'s
     .avm-body so the rail is obvious when a tab's table grows past
     the body. Solid violet replaces the prior near-invisible rgba(.30). */
  scrollbar-width: thin; scrollbar-color: #c4b5fd transparent;
}
.cev-body::-webkit-scrollbar { width: 8px; }
.cev-body::-webkit-scrollbar-thumb { background: #c4b5fd; border-radius: 99px; }
.cev-body::-webkit-scrollbar-thumb:hover { background: #7c3aed; }

.cev-section {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 14px 18px;
  background: linear-gradient(110deg, #f5f3ff, #ede9fe 70%, #ddd6fe);
  border: 1px solid rgba(124,58,237,.18);
  border-radius: 14px;
}
.cev-section-left { display: flex; align-items: center; gap: 12px; min-width: 0; }
.cev-section-icon {
  width: 38px; height: 38px; border-radius: 10px;
  background: linear-gradient(135deg, #7c3aed, #6d28d9);
  color: #fff;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 18px;
  box-shadow: 0 4px 12px rgba(124,58,237,.30);
}
.cev-section-title { font-size: 15px; font-weight: 800; color: #4c1d95; }
.cev-section-sub   { font-size: 12px; color: #6d28d9; margin-top: 1px; }
.cev-section-right { text-align: right; }
.cev-section-count { font-size: 26px; font-weight: 800; color: #4c1d95; line-height: 1; }
.cev-section-count-label { font-size: 9.5px; font-weight: 700; letter-spacing: .12em; color: #6d28d9; margin-top: 2px; }

.cev-filter-row { display: flex; gap: 8px; flex-wrap: wrap; }
.cev-filter { display: inline-flex; align-items: center; gap: 6px; padding: 5px 12px; border-radius: 999px; font-size: 11.5px; font-weight: 700; border: 1px solid transparent; }
.cev-filter-verified { background: #d1fae5; color: #047857; border-color: rgba(5,150,105,.30); }
.cev-filter-expiring { background: #fef3c7; color: #92400e; border-color: rgba(217,119,6,.30); }
.cev-filter-pending  { background: #fee2e2; color: #b91c1c; border-color: rgba(239,68,68,.30); }

.cev-table-wrap {
  background: #fff;
  border: 1px solid rgba(124,58,237,.18);
  border-radius: 14px;
  overflow: hidden;          /* keep the rounded edge crisp over the
                                 sticky header band — w/o this the band
                                 paints over the corner radius */
  scrollbar-width: thin;
  position: relative;
  /* Don't let the flex column body squash this wrap below its
     intrinsic height — without this, extra rows can be clipped at
     the bottom and .cev-body's overflow-y never trips, so the user
     has no scrollbar to reach hidden documents. */
  flex-shrink: 0;
}
.cev-section { flex-shrink: 0; }
/* Inner scroll context for the table — own scrolling ancestor so
   the sticky thead pins inside the table, not against the outer
   body. Viewport-relative max-height so the table fills the
   available vertical space on any laptop screen while still
   leaving a hard ceiling that keeps the sticky band working. */
/* Let the outer body handle vertical scrolling (it already has
 * overflow-y: auto). The inner div only handles horizontal overflow
 * for tables wider than the modal so on narrow screens the table can
 * scroll sideways without forcing the whole vault to widen. */
.cev-table-scroll {
  overflow-x: auto;
  overflow-y: visible;
  scrollbar-width: thin;
}
.cev-table-scroll::-webkit-scrollbar { width: 8px; height: 8px; }
.cev-table-scroll::-webkit-scrollbar-thumb { background: rgba(124,58,237,.30); border-radius: 999px; }
.cev-table-scroll::-webkit-scrollbar-thumb:hover { background: rgba(124,58,237,.55); }
.cev-table-scroll::-webkit-scrollbar { height: 8px; width: 8px; }
.cev-table-scroll::-webkit-scrollbar-thumb { background: rgba(124,58,237,.30); border-radius: 999px; }
.cev-table { width: 100%; min-width: 980px; border-collapse: separate; border-spacing: 0; font-size: 13px; }
.cev-table thead th {
  position: sticky; top: 0;
  z-index: 3;                /* sits above row cells AND above any
                                 backdrop the body might leak under */
  padding: 9px 14px;         /* tighter than 12px — visually slim band */
  text-align: left;
  /* Glossy lavender band: top highlight → core fill → soft shadow line
     at the bottom. Looks lifted off the surface so the sticky scroll
     state reads cleanly even when rows pass underneath. */
  background:
    linear-gradient(180deg, #f5f3ff 0%, #ede9fe 55%, #ddd6fe 100%);
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,0.65),
    inset 0 -1px 0 rgba(124,58,237,0.25),
    0 4px 10px -8px rgba(124,58,237,0.30);
  font-size: 10.5px; font-weight: 800; letter-spacing: .08em;
  color: #5b21b6; text-transform: uppercase;
  white-space: nowrap;
}
.cev-table tbody td { padding: 13px 14px; border-bottom: 1px solid #f5f3ff; vertical-align: middle; }
.cev-table tbody tr:last-child td { border-bottom: none; }
.cev-table tbody tr:hover td { background: #faf7ff; }
.cev-doc-name { font-weight: 700; color: #4c1d95; }
.cev-mono { font-family: 'JetBrains Mono','SF Mono',ui-monospace,monospace; font-size: 12px; color: #1f2937; }
.cev-empty { padding: 30px !important; text-align: center; color: #94a3b8; font-style: italic; }
.cev-muted { color: #94a3b8; font-style: italic; font-size: 12px; }

.cev-date {
  display: inline-block;
  font-size: 11.5px; font-weight: 600;
  padding: 3px 9px; border-radius: 6px;
  background: #f5f3ff; color: #5b21b6;
}
.cev-date-expiry[data-status="expiring"] { background: #fef3c7; color: #92400e; }
.cev-date-expiry[data-status="pending"]  { background: #fee2e2; color: #b91c1c; }

.cev-attach {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 3px 9px; border-radius: 6px;
  background: #ede9fe; color: #5b21b6;
  font-size: 11.5px; font-weight: 600;
  border: 1px solid rgba(124,58,237,.30);
}

/* Row Actions — View / Download / Re-upload icons. Shared baseline
 * with a per-action tint so users can scan the column without reading
 * the icons. Disabled state stays visible but loses its hover affordance. */
.cev-row-actions { display: inline-flex; align-items: center; gap: 6px; }
.cev-row-act {
  width: 28px; height: 28px; border-radius: 7px;
  display: inline-flex; align-items: center; justify-content: center;
  border: 1px solid transparent; background: transparent;
  cursor: pointer; text-decoration: none;
  transition: background .15s ease, border-color .15s ease, color .15s ease, transform .15s ease;
}
.cev-row-act-view     { color: #2563eb; background: rgba(37,99,235,.08);  border-color: rgba(37,99,235,.20); }
.cev-row-act-view:hover:not(.is-disabled)     { background: rgba(37,99,235,.18); transform: translateY(-1px); }
.cev-row-act-download { color: #0891b2; background: rgba(8,145,178,.08);  border-color: rgba(8,145,178,.20); }
.cev-row-act-download:hover:not(.is-disabled) { background: rgba(8,145,178,.18); transform: translateY(-1px); }
.cev-row-act-upload   { color: #7c3aed; background: rgba(124,58,237,.08); border-color: rgba(124,58,237,.20); }
.cev-row-act-upload:hover:not(.is-disabled)   { background: rgba(124,58,237,.18); transform: translateY(-1px); }
.cev-row-act.is-disabled, .cev-row-act:disabled {
  opacity: .45; cursor: not-allowed; pointer-events: none;
}
/* Dark mode — lift the action-button fills + icon colours so they read on the
 * dark row. Send / Reminder / Certificate set their colours inline, so those
 * need !important to win over the inline style attribute. */
[data-bs-theme="dark"] .cev-row-act-view     { color: #93c5fd; background: rgba(59,130,246,.16); border-color: rgba(59,130,246,.34); }
[data-bs-theme="dark"] .cev-row-act-view:hover:not(.is-disabled)     { background: rgba(59,130,246,.28); }
[data-bs-theme="dark"] .cev-row-act-download { color: #67e8f9; background: rgba(8,145,178,.18); border-color: rgba(8,145,178,.36); }
[data-bs-theme="dark"] .cev-row-act-download:hover:not(.is-disabled) { background: rgba(8,145,178,.30); }
[data-bs-theme="dark"] .cev-row-act-upload   { color: #c4b5fd; background: rgba(124,58,237,.20); border-color: rgba(124,58,237,.40); }
[data-bs-theme="dark"] .cev-row-act-upload:hover:not(.is-disabled)   { background: rgba(124,58,237,.32); }
[data-bs-theme="dark"] .cev-row-act-send   { background: rgba(124,58,237,.24) !important; color: #c4b5fd !important; border-color: rgba(124,58,237,.42) !important; }
[data-bs-theme="dark"] .cev-row-act-remind { background: rgba(245,158,11,.20) !important; color: #fcd34d !important; border-color: rgba(245,158,11,.42) !important; }
[data-bs-theme="dark"] .cev-row-act-cert   { background: rgba(8,145,178,.22) !important; color: #67e8f9 !important; border-color: rgba(8,145,178,.42) !important; }

.cev-pill {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 3px 10px; border-radius: 999px;
  font-size: 11px; font-weight: 700;
}
.cev-risk-compliant { background: #d1fae5; color: #047857; }
.cev-risk-medium    { background: #fef3c7; color: #92400e; }
.cev-risk-high      { background: #fee2e2; color: #b91c1c; }

/* Chip pills used in shipment matrix */
.cev-chip-pill { display: inline-flex; align-items: center; gap: 4px; padding: 3px 9px; border-radius: 6px; background: #ede9fe; color: #5b21b6; font-size: 11.5px; font-weight: 700; border: 1px solid rgba(124,58,237,.30); font-family: 'JetBrains Mono', ui-monospace, monospace; }
.cev-chip-pill-warm { background: #fef3c7; color: #92400e; border-color: rgba(217,119,6,.30); }
.cev-cust-cell { display: inline-flex; align-items: center; gap: 8px; }
.cev-cust-mono {
  width: 26px; height: 26px; border-radius: 50%;
  display: inline-flex; align-items: center; justify-content: center;
  background: linear-gradient(135deg, #7c3aed, #6d28d9); color: #fff;
  font-size: 11.5px; font-weight: 800;
  flex-shrink: 0;
}
.cev-ratio {
  position: relative;
  display: inline-flex; align-items: center; justify-content: center;
  width: 38px; height: 38px;
  line-height: 1;
}
.cev-ratio svg { display: block; transition: filter .2s ease; }
.cev-ratio:hover svg { filter: drop-shadow(0 2px 6px rgba(76,29,149,0.20)); }
.cev-ratio-track { stroke: #ede9fe; }
.cev-ratio-arc {
  transition: stroke-dashoffset .6s cubic-bezier(.22,1,.36,1), stroke .2s ease;
}
.cev-ratio[data-tone="good"] .cev-ratio-arc { stroke: #16a34a; }
.cev-ratio[data-tone="mid"]  .cev-ratio-arc { stroke: #f59e0b; }
.cev-ratio[data-tone="bad"]  .cev-ratio-arc { stroke: #dc2626; }
.cev-ratio-label {
  position: absolute; inset: 0;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 10.5px; font-weight: 800; letter-spacing: -0.02em;
  color: #4c1d95;
  font-family: 'JetBrains Mono','SF Mono',ui-monospace,monospace;
}
.cev-ratio[data-tone="good"] .cev-ratio-label { color: #047857; }
.cev-ratio[data-tone="mid"]  .cev-ratio-label { color: #b45309; }
.cev-ratio[data-tone="bad"]  .cev-ratio-label { color: #b91c1c; }

/* Self-contained portal tooltip for the donut. Dark glossy pill,
   centred above (or flipped below) the donut, z-index above every
   modal in this project (highest known overlay is 11200). */
.cev-ratio-tip {
  position: fixed;
  z-index: 12500;
  display: inline-flex; flex-direction: column; align-items: center; gap: 1px;
  padding: 6px 12px;
  border-radius: 9px;
  background: linear-gradient(180deg, #2a3444 0%, #1f2937 100%);
  border: 1px solid rgba(255,255,255,0.06);
  box-shadow:
    0 12px 26px -6px rgba(15,23,42,0.45),
    0 4px 10px rgba(15,23,42,0.22);
  color: #fff;
  line-height: 1.15;
  pointer-events: none;
  white-space: nowrap;
  animation: cevTipPop .18s cubic-bezier(0.34, 1.56, 0.64, 1) both;
}
@keyframes cevTipPop {
  0%   { opacity: 0; transform: translateY(4px) scale(0.92); }
  100% { opacity: 1; transform: translateY(0) scale(1); }
}
.cev-ratio-tip-pct {
  font-size: 15px; font-weight: 800; letter-spacing: -0.01em;
  font-family: 'JetBrains Mono','SF Mono',ui-monospace,monospace;
  color: #ffffff;
}
.cev-ratio-tip-pct[data-tone="good"] { color: #6ee7b7; }
.cev-ratio-tip-pct[data-tone="mid"]  { color: #fcd34d; }
.cev-ratio-tip-pct[data-tone="bad"]  { color: #fca5a5; }
.cev-ratio-tip-meta {
  font-size: 10px; font-weight: 600; letter-spacing: 0.04em;
  text-transform: uppercase;
  opacity: 0.82;
}

.cev-ship-filter { display: flex; gap: 8px; flex-wrap: wrap; }
.cev-ship-fbtn {
  flex: 1; min-width: 160px;
  padding: 10px 18px;
  background: #fff;
  border: 1px solid rgba(124,58,237,.20);
  border-radius: 10px;
  color: #475569;
  font-size: 12.5px; font-weight: 700;
  cursor: pointer; transition: all .15s;
}
.cev-ship-fbtn:hover { background: #faf7ff; color: #6d28d9; }
.cev-ship-fbtn.is-active {
  background: linear-gradient(135deg, #6d28d9, #7c3aed);
  color: #fff; border-color: transparent;
  box-shadow: 0 4px 12px rgba(124,58,237,.30);
}

/* ─── FOOTER ─── */
.cev-footer {
  flex-shrink: 0;
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 14px 24px;
  background: #fff;
  border-top: 1px solid #ede9fe;
}
.cev-footer-meta { font-size: 12px; color: #475569; }
.cev-footer-actions { display: flex; gap: 10px; }
.cev-btn {
  display: inline-flex; align-items: center; gap: 7px;
  padding: 9px 18px;
  border-radius: 10px;
  font-size: 12.5px; font-weight: 700;
  cursor: pointer; border: 1px solid transparent;
  transition: all .15s;
}
.cev-btn-light { background: #fff; color: #6d28d9; border-color: rgba(124,58,237,.30); }
.cev-btn-light:hover { background: #f5f3ff; transform: translateY(-1px); box-shadow: 0 4px 12px rgba(124,58,237,.20); }
.cev-btn-dark  { background: linear-gradient(135deg, #4c1d95, #7c3aed); color: #fff; box-shadow: 0 4px 14px rgba(76,29,149,.30); }
.cev-btn-dark:hover  { transform: translateY(-1px); box-shadow: 0 8px 22px rgba(76,29,149,.45); }
/* Spinner used by the Export All button while the XLSX workbook is
 * being built. Class-scoped to .cev-spin so it doesn't collide with
 * any global ri-spin rule the project may add later. */
.cev-spin { display: inline-block; animation: cevSpin .8s linear infinite; }
@keyframes cevSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

/* ─── DARK MODE — violet palette mapped to lavender-on-deep-purple ─── */
[data-bs-theme="dark"] .cev-card { background: #1a1430; }
[data-bs-theme="dark"] .cev-groups-wrap { background: linear-gradient(180deg, #1a1430 0%, #211a3d 100%); }
[data-bs-theme="dark"] .cev-group { background: #211a3d; border-color: rgba(167,139,250,.30); }
[data-bs-theme="dark"] .cev-group:hover { background: #2a2150; border-color: rgba(167,139,250,.5); }
[data-bs-theme="dark"] .cev-group.is-active { background: linear-gradient(120deg,#4c1d95,#6d28d9); border-color: #7c3aed; }
[data-bs-theme="dark"] .cev-group-icon { background: rgba(124,58,237,.22); color: #c4b5fd; border-color: rgba(167,139,250,.3); }
[data-bs-theme="dark"] .cev-group.is-active .cev-group-icon { background: rgba(255,255,255,.18); color: #fff; }
[data-bs-theme="dark"] .cev-group-title { color: #ede9fe; }
[data-bs-theme="dark"] .cev-group-sub { color: #a99fcf; }
[data-bs-theme="dark"] .cev-tabs-wrap { background: linear-gradient(180deg, #1a1430 0%, #211a3d 100%); border-bottom-color: rgba(124,58,237,.22); }
[data-bs-theme="dark"] .cev-tab { background: transparent; color: #c4b5fd; border: 1.5px solid rgba(167,139,250,0.40); box-shadow: none; }
[data-bs-theme="dark"] .cev-tab-icon { background: transparent; color: #c4b5fd; }
[data-bs-theme="dark"] .cev-tab:hover { background: rgba(167,139,250,0.10); border-color: #a78bfa; color: #ede9fe; box-shadow: none; }
[data-bs-theme="dark"] .cev-tab:hover .cev-tab-icon { background: transparent; color: #ede9fe; }
[data-bs-theme="dark"] .cev-tab.is-active { background: linear-gradient(135deg,#6d28d9,#4c1d95); color: #fff; border-color: #7c3aed; }
[data-bs-theme="dark"] .cev-tab.is-active .cev-tab-icon { background: transparent; color: #fff; }
[data-bs-theme="dark"] .cev-tab-count { background: rgba(124,58,237,.22); color: #c4b5fd; }
[data-bs-theme="dark"] .cev-tab.is-active .cev-tab-count { background: rgba(255,255,255,.28); color: #fff; }
[data-bs-theme="dark"] .cev-kpi-outer { background: linear-gradient(180deg, #1a1430 0%, #211a3d 100%); border-bottom-color: rgba(124,58,237,.22); }
[data-bs-theme="dark"] .cev-kpi-fade-l { background: linear-gradient(90deg, #1a1430 0%, #1a1430 25%, rgba(26,20,48,0) 100%); }
[data-bs-theme="dark"] .cev-kpi-fade-r { background: linear-gradient(270deg, #211a3d 0%, #211a3d 25%, rgba(33,26,61,0) 100%); }
[data-bs-theme="dark"] .cev-kpi-nav { background: linear-gradient(135deg, #2a2150 0%, #1f1840 100%); color: #c4b5fd; box-shadow: 0 2px 6px rgba(0,0,0,.40), 0 8px 22px rgba(0,0,0,.50), inset 0 0 0 1px rgba(124,58,237,.30); }
[data-bs-theme="dark"] .cev-kpi-nav:hover { background: linear-gradient(135deg, #6d28d9, #7c3aed); color: #fff; }
[data-bs-theme="dark"] .cev-kpi-tile { background: #211a3d; border-color: rgba(124,58,237,.28); box-shadow: 0 2px 10px rgba(0,0,0,0.30); }
[data-bs-theme="dark"] .cev-kpi-tile:hover { border-color: rgba(124,58,237,.45); box-shadow: 0 6px 18px rgba(0,0,0,0.40); }
[data-bs-theme="dark"] .cev-kpi-label { color: #94a3b8; }
[data-bs-theme="dark"] .cev-kpi-value { color: #ede9fe; }
[data-bs-theme="dark"] .cev-body { background: #1a1430; scrollbar-color: #6d28d9 transparent; }
[data-bs-theme="dark"] .cev-body::-webkit-scrollbar-thumb { background: #6d28d9; }
[data-bs-theme="dark"] .cev-body::-webkit-scrollbar-thumb:hover { background: #a78bfa; }
[data-bs-theme="dark"] .cev-section { background: linear-gradient(110deg, rgba(124,58,237,.14), rgba(167,139,250,.10)); border-color: rgba(124,58,237,.30); }
[data-bs-theme="dark"] .cev-section-title { color: #ede9fe; }
[data-bs-theme="dark"] .cev-section-sub { color: #c4b5fd; }
[data-bs-theme="dark"] .cev-section-count { color: #ede9fe; }
[data-bs-theme="dark"] .cev-section-count-label { color: #c4b5fd; }
[data-bs-theme="dark"] .cev-table-wrap { background: #211a3d; border-color: rgba(124,58,237,.28); }
[data-bs-theme="dark"] .cev-table thead th {
  background:
    linear-gradient(180deg, rgba(124,58,237,.22) 0%, rgba(124,58,237,.16) 55%, rgba(76,29,149,.18) 100%);
  color: #c4b5fd;
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,0.08),
    inset 0 -1px 0 rgba(124,58,237,0.40),
    0 4px 10px -8px rgba(0,0,0,0.40);
}
[data-bs-theme="dark"] .cev-table tbody td { color: #e2e8f0; border-bottom-color: rgba(124,58,237,.10); }
[data-bs-theme="dark"] .cev-table tbody tr:hover td { background: rgba(124,58,237,.06); }
[data-bs-theme="dark"] .cev-doc-name { color: #ede9fe; }
[data-bs-theme="dark"] .cev-mono { color: #e2e8f0; }
[data-bs-theme="dark"] .cev-date { background: rgba(124,58,237,.16); color: #c4b5fd; }
[data-bs-theme="dark"] .cev-date-expiry[data-status="expiring"] { background: rgba(245,158,11,.18); color: #fcd34d; }
[data-bs-theme="dark"] .cev-date-expiry[data-status="pending"]  { background: rgba(239,68,68,.18); color: #fca5a5; }
[data-bs-theme="dark"] .cev-attach { background: rgba(124,58,237,.16); color: #c4b5fd; border-color: rgba(124,58,237,.30); }
[data-bs-theme="dark"] .cev-ratio-track { stroke: rgba(124,58,237,.22); }
[data-bs-theme="dark"] .cev-ratio-label { color: #ede9fe; }
[data-bs-theme="dark"] .cev-ratio[data-tone="good"] .cev-ratio-label { color: #6ee7b7; }
[data-bs-theme="dark"] .cev-ratio[data-tone="mid"]  .cev-ratio-label { color: #fcd34d; }
[data-bs-theme="dark"] .cev-ratio[data-tone="bad"]  .cev-ratio-label { color: #fca5a5; }
[data-bs-theme="dark"] .cev-chip-pill { background: rgba(124,58,237,.16); color: #c4b5fd; }
[data-bs-theme="dark"] .cev-chip-pill-warm { background: rgba(217,119,6,.18); color: #fcd34d; border-color: rgba(217,119,6,.30); }
[data-bs-theme="dark"] .cev-footer { background: #1a1430; border-top-color: rgba(124,58,237,.22); }
[data-bs-theme="dark"] .cev-footer-meta { color: #cbd5e1; }
[data-bs-theme="dark"] .cev-btn-light { background: rgba(124,58,237,.12); color: #c4b5fd; border-color: rgba(124,58,237,.30); }
[data-bs-theme="dark"] .cev-btn-light:hover { background: rgba(124,58,237,.18); }
[data-bs-theme="dark"] .cev-ship-fbtn { background: #211a3d; color: #94a3b8; border-color: rgba(124,58,237,.28); }
[data-bs-theme="dark"] .cev-ship-fbtn:hover { color: #c4b5fd; background: rgba(124,58,237,.10); }
[data-bs-theme="dark"] .cev-filter-verified { background: rgba(16,185,129,.18); color: #6ee7b7; border-color: rgba(16,185,129,.30); }
[data-bs-theme="dark"] .cev-filter-expiring { background: rgba(245,158,11,.18); color: #fcd34d; border-color: rgba(217,119,6,.30); }
[data-bs-theme="dark"] .cev-filter-pending  { background: rgba(239,68,68,.18);  color: #fca5a5; border-color: rgba(239,68,68,.30); }

/* ─── RESPONSIVE ─── */
@media (max-width: 1440px) {
  .cev-card { width: min(1100px, 92vw); }
}
@media (max-width: 1280px) {
  .cev-card { width: 92vw; }
}
@media (max-width: 960px) {
  .cev-card { width: 96vw; }
  .cev-header { padding: 12px 14px; }
  .cev-header-title { font-size: 16px; }
  .cev-vault-icon { width: 38px; height: 38px; border-radius: 10px; }
  .cev-header-content { flex-direction: column; align-items: flex-start; gap: 10px; }
  .cev-header-right { width: 100%; justify-content: space-between; }
  .cev-kpi-strip { padding: 12px 52px; gap: 8px; }
  .cev-kpi-tile { flex: 0 0 190px; padding: 10px 12px; }
  .cev-kpi-value { font-size: 20px; }
  .cev-kpi-icon { width: 32px; height: 32px; font-size: 15px; }
  .cev-kpi-fade { width: 50px; }
  .cev-kpi-nav { width: 30px; height: 30px; font-size: 16px; }
  .cev-kpi-nav-prev { left: 10px; }
  .cev-kpi-nav-next { right: 10px; }
  .cev-groups-wrap { padding: 12px 14px 0; }
  .cev-groups { grid-template-columns: 1fr; gap: 10px; }
  .cev-tabs-wrap { padding: 10px 14px; }
  .cev-tab { padding: 7px 14px; font-size: 12px; gap: 7px; }
  .cev-tab-icon { width: 16px; height: 16px; font-size: 13px; }
  .cev-body { padding: 14px 16px 18px; gap: 12px; }
  .cev-section { padding: 12px 14px; }
  .cev-section-count { font-size: 22px; }
  .cev-footer { flex-direction: column; align-items: stretch; gap: 10px; }
  .cev-footer-actions { display: flex; gap: 8px; }
  .cev-footer-actions .cev-btn { flex: 1; justify-content: center; }
  .cev-header-orb { display: none; }
  .cev-header-bg::after { display: none; }
}
@media (max-width: 640px) {
  .cev-card { width: 100vw; }
  .cev-kpi-tile { flex: 0 0 170px; }
  .cev-tab { padding: 6px 12px; font-size: 11.5px; }
  .cev-tab-icon { width: 14px; height: 14px; font-size: 12px; }
  .cev-tab-count { font-size: 9.5px; padding: 1px 6px; }
}
`;
