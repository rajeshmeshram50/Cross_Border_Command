import { Fragment, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import api from '../../../../api';
import Tooltip from '../../../../components/ui/Tooltip';
import { useToast } from '../../../../contexts/ToastContext';
import { resolveFileUrl } from '../../../../utils/resolveFileUrl';
import { signatureRequestsToVaultDocs, mergeTradeDocuments, type SigReqRow } from '../../../../utils/vaultSignatureRows';
import { downloadFile } from '../../../../utils/downloadFile';
import SalesCustomerSendForSignatureModal from '../../../sales/core-masters/customer/SalesCustomerSendForSignatureModal';
import { CEV_CSS } from '../../../sales/core-masters/customer/CustomerEvidenceVaultModal';

/* Fetch a stored attachment as a Blob for the ZIP export. Our own uploads
 * (segment_doc_uploads/…) stream THROUGH the backend so Azure's cross-origin
 * CORS doesn't block them; anything else is fetched directly. Returns null on
 * failure so the export skips it (and counts it as "missing"). */
async function fetchVaultBlob(rawUrl: string): Promise<Blob | null> {
  if (!rawUrl) return null;
  if (/segment_doc_uploads\//i.test(rawUrl)) {
    try {
      const res = await api.get('/segment-uploads/download', { params: { url: rawUrl }, responseType: 'blob' });
      return res.data as Blob;
    } catch { /* fall through to a direct fetch */ }
  }
  try {
    const res = await fetch(resolveFileUrl(rawUrl), { credentials: 'include' });
    if (res.ok) return await res.blob();
  } catch { /* ignore */ }
  return null;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Supplier Evidence Vault — read-only compliance archive
 *
 * Mirrors CustomerEvidenceVaultModal in BOTH structure and look: it reuses
 * the customer's exported CEV_CSS (cyan/teal palette + dark mode) verbatim via
 * the .cev-* classes so the two vaults can never visually drift. Only the
 * supplier-specific text, buckets, toggle wording and the live supplier vault
 * endpoint differ.
 *
 *   1. Company Due Diligence — PAN, TAN, GST, CIN, IEC, Address Proof, …
 *   2. Owner KYC Details     — Aadhaar, PAN, Passport, Director address …
 *   3. Trade Licenses        — IEC, APEDA, Agro Export Permit, Organic …
 *   4. Trade Documents       — Master Sales Agreement, PO Framework, NDA …
 *   5. Shipment Agreements   — per-shipment matrix (Customer = Supplier / ≠)
 *
 * Backend wiring (live):
 *   GET /api/segment-uploads/supplier/{id}/vault → { stats, company_dd,
 *     owner_kyc, trade_licenses, trade_documents, shipment_agreements,
 *     last_updated }
 * ──────────────────────────────────────────────────────────────────── */

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
  reference?: string | null;
  authority?: string | null;
  issue_date?: string | null;
  expiry?: string | null;
  attachment?: string | null;
  /** Live storage URL when the server has the actual file; lets the
   *  attachment cell render as a clickable link. */
  attachment_url?: string | null;
  status: VaultStatus;
  /** Master doc-code (DD-001, KYC-002, …). Required by the Actions
   *  column so a re-upload can POST against the right SegmentDocUpload row. */
  doc_code?: string | null;
  /** Mandatory / Optional per the segment DCP rules — drives the
   *  Requirement column (matches the Edit form's table). */
  requirement?: 'M' | 'O' | null;
  /** URL to the Zoho-issued Certificate of Completion. Set on rows
   *  that came from a completed Zoho Sign request; renders the
   *  certificate icon button in the Actions column. */
  certificate_url?: string | null;
}

export interface VaultShipmentRow {
  id: number;
  shipment_id: string;
  opportunity_id: string;
  customer: string;
  country: string;
  due_dil:    { ratio: string; pct: number };
  kyc:        { ratio: string; pct: number };
  trade_lic:  { ratio: string; pct: number };
  trade_docs: { ratio: string; pct: number };
  agreement:  { ratio: string; pct: number };
  risk: 'Compliant' | 'Medium' | 'High';
  buyer_is_supplier: boolean;
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
  /* Case-to-Case deals — split by whether the lead has a shipment. */
  vendor_with_shipment?:    VendorDealRow[];
  vendor_without_shipment?: VendorDealRow[];
  vendor_deal_ratios?:      DealRatios | null;
  last_updated:           string;
}

type DealCount = { d: number; t: number };
export interface DealRatios { kyc: DealCount; dd: DealCount; tl: DealCount; td: DealCount }
export interface VendorDealRow {
  sr: number;
  shipment_id?: string;
  procurement_id?: string;
  customer?: string;
  consignee?: string;
  supplier: string;
  ratios: DealRatios;
  /** This deal's applicable Trade Documents (from the vendor's mapped products),
   *  with live Zoho signature status — drives the Trade Documents drill-down. */
  docs?: VaultDoc[];
  /** Same, for Agreements — drives the Agreements drill-down. */
  agreements?: VaultDoc[];
}

export interface SupplierVaultTarget {
  id: string;             // S-001 / matches vendors.vendor_code
  db_id?: number;
  company: string;
  risk?: string;
  segment?: string;
  /* All mapped segments (vendor_segments). Header shows every one; falls back
     to the scalar `segment` when not provided. */
  segments?: string[];
  country?: string;
  contact?: string;
  contactCity?: string;
  /* Primary contact email — the default signer when sending a trade doc for
   * e-signature from this supplier's vault. */
  email?: string;
  /* Linked customer code (e.g. C-010) so the header can show the
   * buyer-supplier relationship at a glance. */
  customerId?: string;
}

interface Props {
  open: boolean;
  supplier: SupplierVaultTarget | null;
  onClose: () => void;
  data?: VaultData | null;
  /* When true the vault is opened purely to review (e.g. from a With-PO SPI where
   * the supplier's legal status is inherited from the PO). Upload/Re-upload is hidden. */
  viewOnly?: boolean;
}

/* Lets the deeply-nested row actions hide their Upload button without prop drilling. */
const VaultViewOnlyCtx = createContext(false);

type TabKey = 'company-dd' | 'owner-kyc' | 'trade-licenses' | 'trade-documents' | 'shipment-agreements';

/* Top-level grouping — see CustomerEvidenceVaultModal for the rationale.
 *   • standard      — KYC, DD, Trade Licenses (one-time party docs)
 *   • case-to-case  — Trade Documents, Agreements (per-deal records) */
type GroupKey = 'standard' | 'case-to-case';

const GROUPS: { key: GroupKey; title: string; sub: string; icon: string }[] = [
  { key: 'standard',     title: 'Standard Documents',      sub: 'ONE TIME · KYC, DD & LICENSES',     icon: 'ri-shield-check-line' },
  { key: 'case-to-case', title: 'Case to Case Agreements', sub: 'PER DEAL · TRADE DOCS & AGREEMENTS', icon: 'ri-todo-line' },
];

const TABS: { key: TabKey; label: string; icon: string; countKey: keyof VaultData; group: GroupKey }[] = [
  { key: 'company-dd',          label: 'Company Due Diligence', icon: 'ri-shield-check-line',   countKey: 'company_dd_count',       group: 'standard' },
  { key: 'owner-kyc',           label: 'Owner KYC Details',     icon: 'ri-user-3-line',         countKey: 'owner_kyc_count',        group: 'standard' },
  { key: 'trade-licenses',      label: 'Trade Licenses',        icon: 'ri-file-list-3-line',    countKey: 'trade_license_count',    group: 'standard' },
  { key: 'trade-documents',     label: 'Trade Documents',       icon: 'ri-article-line',        countKey: 'trade_documents_count',  group: 'case-to-case' },
  { key: 'shipment-agreements', label: 'Agreements',            icon: 'ri-truck-line',          countKey: 'total_shipments',        group: 'case-to-case' },
];

function buildDemoVault(supplier: SupplierVaultTarget): VaultData {
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
      { id: 1, name: 'Company PAN',          reference: 'AABCT1234F',      authority: 'Income Tax Dept', issue_date: '01/01/2023', expiry: '01/01/2028', attachment: 'CompanyPAN.pdf',     status: 'Verified' },
      { id: 2, name: 'Company TAN',          reference: 'PNET01234B',      authority: 'Income Tax Dept', issue_date: '01/01/2023', expiry: '01/01/2028', attachment: 'CompanyTAN.pdf',     status: 'Verified' },
      { id: 3, name: 'Company GST',          reference: '27AABCT1234F1Z5', authority: 'GST Portal',      issue_date: '01/01/2023', expiry: '01/01/2028', attachment: 'CompanyGST.pdf',     status: 'Verified' },
      { id: 4, name: 'CIN / Shop Act',       reference: 'U72900MH2019PTC', authority: 'MCA',             issue_date: '01/01/2022', expiry: '—',          attachment: 'CIN.pdf',            status: 'Verified' },
      { id: 5, name: 'IEC Code',             reference: '0412345678',      authority: 'DGFT',            issue_date: '01/01/2021', expiry: '—',          attachment: 'IECCode.pdf',        status: 'Verified' },
      { id: 6, name: 'Business Address Proof', reference: '1234567890',    authority: '—',               issue_date: '01/01/2022', expiry: '01/01/2027', attachment: 'AddressProof.pdf',   status: 'Verified' },
      { id: 7, name: 'Cancelled Cheque',     reference: '1234567890',      authority: 'HDFC Bank',       issue_date: '01/01/2025', expiry: '—',          attachment: 'CancelledCheque.pdf', status: 'Expiring' },
      { id: 8, name: 'FSSAI License',        reference: '10223452000120',  authority: 'FSSAI',           issue_date: '01/03/2024', expiry: '01/03/2025', attachment: 'FSSAI.pdf',          status: 'Pending' },
    ],
    owner_kyc: [
      { id: 1, name: 'Aadhaar Card',           reference: 'XXXX-XXXX-3456', authority: 'UIDAI',           issue_date: '01/05/2018', expiry: 'Lifetime',   attachment: 'Aadhaar.pdf',     status: 'Verified' },
      { id: 2, name: 'PAN Card',               reference: 'BVKPJ5678K',     authority: 'Income Tax Dept', issue_date: '01/01/2015', expiry: 'Lifetime',   attachment: 'PANCard.pdf',     status: 'Verified' },
      { id: 3, name: 'Passport',               reference: 'P4521876J',      authority: 'MEA India',       issue_date: '15/06/2020', expiry: '15/06/2030', attachment: 'Passport.pdf',    status: 'Verified' },
      { id: 4, name: 'Director Address Proof', reference: '—',              authority: '—',               issue_date: '01/01/2024', expiry: '01/01/2026', attachment: 'DirAddress.pdf',  status: 'Verified' },
      { id: 5, name: 'DIN Certificate',        reference: '07654321',       authority: 'MCA',             issue_date: '—',          expiry: '—',          attachment: 'DIN.pdf',          status: 'Pending' },
    ],
    trade_licenses: [
      { id: 1, name: 'Import Export License', reference: 'IEC-0412345678',      authority: 'DGFT',            issue_date: '01/01/2021', expiry: 'Lifetime',   attachment: 'IECLicense.pdf',  status: 'Verified' },
      { id: 2, name: 'APEDA Registration',    reference: 'APEDA/REG/2021/7823', authority: 'APEDA',           issue_date: '15/03/2021', expiry: '14/03/2027', attachment: 'APEDA.pdf',       status: 'Verified' },
      { id: 3, name: 'Agro Export Permit',    reference: 'AGRO/EXP/MH/4512',    authority: 'State Agri Dept', issue_date: '01/06/2023', expiry: '01/06/2026', attachment: 'AgroPermit.pdf',  status: 'Expiring' },
      { id: 4, name: 'Organic Certification', reference: 'NPOP/ORG/2022/1134',  authority: 'APEDA / NPOP',    issue_date: '10/10/2022', expiry: '09/10/2027', attachment: 'OrganicCert.pdf', status: 'Verified' },
    ],
    trade_documents: [
      { id: 1, name: 'Master Sales Agreement',  reference: 'MSA/CNGE/2024/001',  authority: supplier.company, issue_date: '01/04/2024', expiry: '31/03/2027', attachment: 'MSA.pdf',         status: 'Verified' },
      { id: 2, name: 'Purchase Order Framework', reference: 'POF/CNGE/2024/012', authority: supplier.company, issue_date: '15/04/2024', expiry: '14/04/2026', attachment: 'POFramework.pdf', status: 'Verified' },
      { id: 3, name: 'NDA & Confidentiality',    reference: 'NDA/CNGE/2025/003', authority: supplier.company, issue_date: '—',           expiry: '—',          attachment: 'NDA.pdf',         status: 'Pending' },
    ],
    shipment_agreements: [
      { id: 1, shipment_id: 'SHP-2026-00487', opportunity_id: 'OPP-107', customer: supplier.company,         country: supplier.country ?? 'India',
        due_dil: { ratio: '2/2', pct: 100 }, kyc: { ratio: '3/3', pct: 100 }, trade_lic: { ratio: '1/1', pct: 100 }, trade_docs: { ratio: '4/4', pct: 100 }, agreement: { ratio: '1/1', pct: 100 }, risk: 'Compliant', buyer_is_supplier: true },
      { id: 2, shipment_id: 'SHP-2026-00328', opportunity_id: 'OPP-028', customer: 'GreenHarvest Global Ltd',  country: 'United States',
        due_dil: { ratio: '0/2', pct: 0 },   kyc: { ratio: '0/4', pct: 0 },   trade_lic: { ratio: '0/1', pct: 0 },   trade_docs: { ratio: '0/4', pct: 0 },   agreement: { ratio: '0/1', pct: 0 },   risk: 'Medium', buyer_is_supplier: false },
      { id: 3, shipment_id: 'SHP-2026-00512', opportunity_id: 'OPP-134', customer: 'Eastern Harvest Co.',      country: 'UAE',
        due_dil: { ratio: '1/2', pct: 50 },  kyc: { ratio: '2/3', pct: 67 },  trade_lic: { ratio: '1/1', pct: 100 }, trade_docs: { ratio: '2/4', pct: 50 },  agreement: { ratio: '0/1', pct: 0 },   risk: 'Medium', buyer_is_supplier: true },
      { id: 4, shipment_id: 'SHP-2026-00601', opportunity_id: 'OPP-156', customer: 'International Buyer LLC',  country: 'UAE',
        due_dil: { ratio: '2/2', pct: 100 }, kyc: { ratio: '3/3', pct: 100 }, trade_lic: { ratio: '1/1', pct: 100 }, trade_docs: { ratio: '4/4', pct: 100 }, agreement: { ratio: '1/1', pct: 100 }, risk: 'Compliant', buyer_is_supplier: true },
    ],
    last_updated: '04/05/2026',
  };
}

export default function SupplierEvidenceVaultModal({ open, supplier, onClose, data, viewOnly = false }: Props) {
  const toast = useToast();
  const [tab, setTab] = useState<TabKey>('company-dd');
  const [group, setGroup] = useState<GroupKey>('standard');
  /* "+N more" segment overflow popover — a titled list (matches the CLM pages'
   * authority/segment popovers), opened on click from the header chip. */
  const [segPop, setSegPop] = useState<{ names: string[]; x: number; y: number } | null>(null);
  // "Document Overview" popup — set to a group key to open the all-docs list.
  const [overview, setOverview] = useState<GroupKey | null>(null);
  const [overviewPage, setOverviewPage] = useState(1);
  const [ovShip, setOvShip] = useState<number | null>(null);
  // Row currently downloading in the Document Overview — drives a per-row spinner.
  const [ovDownloadingKey, setOvDownloadingKey] = useState<string | null>(null);
  /* Case-to-Case top toggle (Figma .ev-shp-toggle) — splits per-deal records
     into those tied to a shipment vs general trade docs. */
  const [shipmentIdMode, setShipmentIdMode] = useState<'with' | 'without'>('with');

  /* Switch the active group and jump to its first sub-tab.
   * Case-to-Case splits a supplier's deals strictly either/or:
   *   • With Shipment ID    = procurements whose lead already has a shipment order
   *   • Without Shipment ID = procurements whose lead has no shipment yet
   * A deal appears in exactly ONE of the two views (no overlap). */
  const selectGroup = (g: GroupKey) => {
    setGroup(g);
    const first = TABS.find(t => t.group === g);
    if (first) setTab(first.key);
  };
  const selectTab = (t: typeof TABS[number]) => {
    setTab(t.key);
  };
  /* Live API payload — populated by the fetch effect below. Falls back
   * to the demo builder if the fetch fails or the supplier has no
   * db_id (unsaved record). */
  const [vaultLive, setVaultLive] = useState<VaultData | null>(null);
  const [loading, setLoading] = useState(false);
  /* Export All — in-flight flag drives the spinner + disabled state. */
  const [exporting, setExporting] = useState(false);
  /* Zoho Sign signature requests for this supplier — fetched in parallel
   * with the vault payload and merged into the Trade Documents tab. The
   * vault's own /vault endpoint doesn't know about clm_signature_requests
   * (it predates the Sign flow), so the merge happens client-side. */
  const [signatureRows, setSignatureRows] = useState<SigReqRow[]>([]);
  /* Send-for-Signature launch state — when non-null, the Zoho Sign
   * wizard opens with these clm_trade_doc_library ids pre-checked. Driven
   * by the Trade Documents tab's per-row Send button. */
  const [sendDocIds, setSendDocIds] = useState<number[] | null>(null);
  // Whether the open Send modal is sending case-to-case Agreements (→ agreement_ids)
  // or Trade Documents (→ trade_doc_ids). Drives which library the backend uses.
  const [sendKind, setSendKind] = useState<'trade' | 'agreement'>('trade');

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Scroll lock — lock BOTH <html> and <body> so the page behind can't scroll.
  useEffect(() => {
    if (!open) return;
    const b = document.body.style.overflow;
    const h = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    return () => { document.body.style.overflow = b; document.documentElement.style.overflow = h; };
  }, [open]);

  /* Init the active tab ONLY on open / supplier change — NOT on onClose (fresh
   * closure each parent render), so a background re-render no longer snaps the
   * user's tab back to the default. */
  useEffect(() => {
    if (!open) return;
    setTab('company-dd');
    setGroup('standard');
    setShipmentIdMode('with');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, supplier?.db_id]);

  /* Re-fetch helper — invoked by the Actions column after a successful
   * re-upload so the row's attachment_url refreshes in place. */
  const reloadVault = useCallback(() => {
    if (!supplier?.db_id) return Promise.resolve();
    setLoading(true);
    return api.get(`/segment-uploads/supplier/${supplier.db_id}/vault`)
      .then(r => { setVaultLive((r.data?.data ?? null) as VaultData | null); })
      .catch(() => { /* keep prior state on transient errors */ })
      .finally(() => setLoading(false));
  }, [supplier?.db_id]);

  /* Fetch the vault payload when the modal opens. Skips when (a) the
   * parent passed an override via `data` or (b) supplier has no
   * db_id. Failure leaves vaultLive at null and the demo path takes
   * over so the design review still has content. */
  useEffect(() => {
    if (!open || !supplier?.db_id || data) {
      setVaultLive(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    api.get(`/segment-uploads/supplier/${supplier.db_id}/vault`)
      .then(r => { if (!cancelled) setVaultLive((r.data?.data ?? null) as VaultData | null); })
      .catch(() => { if (!cancelled) setVaultLive(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, supplier?.db_id, data]);

  /* Re-fetch signature requests — used by the open-effect and after a
   * Send so the Trade Documents tab flips to "Pending"/"Signed" without
   * re-opening the vault. */
  const reloadSignatures = useCallback(() => {
    if (!supplier?.db_id) return Promise.resolve();
    return api.get('/clm/signature-requests', {
      params: { party_id: supplier.db_id, model_name: 'Vendor', sync: 1 },
    })
      .then(r => { setSignatureRows(Array.isArray(r.data?.data) ? (r.data.data as SigReqRow[]) : []); })
      .catch(() => { /* keep previous rows on transient failure */ });
  }, [supplier?.db_id]);

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

  /* Fetch signature requests for this supplier in parallel. sync=true
   * triggers a Zoho round-trip for any still-inprogress rows so the
   * vault reflects "Signed" the moment the recipient finishes signing,
   * not just on the next vault open. */
  useEffect(() => {
    if (!open || !supplier?.db_id) { setSignatureRows([]); return; }
    let cancelled = false;
    api.get('/clm/signature-requests', {
      params: { party_id: supplier.db_id, model_name: 'Vendor', sync: 1 },
    })
      .then(r => {
        if (cancelled) return;
        const rows = Array.isArray(r.data?.data) ? (r.data.data as SigReqRow[]) : [];
        setSignatureRows(rows);
      })
      .catch(() => { if (!cancelled) setSignatureRows([]); });
    return () => { cancelled = true; };
  }, [open, supplier?.db_id]);

  /* Re-poll signing status when the user returns to this tab — e.g. after
   * signing in the Zoho Sign tab — so the vault flips Pending → Signed without
   * a manual refresh. Only while the vault is open. */
  useEffect(() => {
    if (!open || !supplier?.db_id) return;
    const onBack = () => { if (document.visibilityState === 'visible') void reloadSignatures(); };
    window.addEventListener('focus', onBack);
    document.addEventListener('visibilitychange', onBack);
    return () => {
      window.removeEventListener('focus', onBack);
      document.removeEventListener('visibilitychange', onBack);
    };
  }, [open, supplier?.db_id, reloadSignatures]);

  const vault: VaultData | null = useMemo(() => {
    if (!supplier) return null;
    /* Priority: explicit `data` prop > live API > demo fallback. */
    const base = data ?? vaultLive ?? buildDemoVault(supplier);
    if (!base) return null;
    // Trade Documents tab = the party's expected trade docs (segment-rule
    // td, party-filtered to mirror the edit form) merged with their live
    // Zoho Sign status. Each row exposes Send-for-Signature; signed rows
    // also carry the signed PDF + certificate links.
    // Split signature requests by library so a trade-doc id and an agreement
    // id that share a number don't overlay onto each other.
    const tradeSigRows       = signatureRequestsToVaultDocs(signatureRows.filter(r => (r.document_type ?? 'trade_doc') !== 'agreement'));
    const agrSigRows         = signatureRequestsToVaultDocs(signatureRows.filter(r => r.document_type === 'agreement'));
    const sigRows            = tradeSigRows;
    const baseSegmentTd      = (base.trade_documents ?? []) as VaultDoc[];
    const mergedTd           = mergeTradeDocuments(baseSegmentTd as any, sigRows, 'supplier') as unknown as VaultDoc[];
    const baseSegmentSigned  = baseSegmentTd.filter(r => r.status === 'Verified' || r.status === 'Signed').length;
    const baseSegmentPending = baseSegmentTd.filter(r => r.status === 'Pending').length;
    const mergedSigned       = mergedTd.filter(r => r.status === 'Verified' || r.status === 'Signed').length;
    const mergedPending      = mergedTd.filter(r => r.status === 'Pending').length;

    /* Overlay the live Zoho status onto the per-deal Trade Documents AND
     * Agreements (matched by db_id / library id — vendor-level, same as the
     * standard tab), each from its OWN library's requests, so a signed doc or
     * agreement flips to Signed without waiting on a per-deal lead_id. Recompute
     * the TRADE DOCS column ratio from the overlaid trade-doc statuses. */
    const buildSigMap = (rows: ReturnType<typeof signatureRequestsToVaultDocs>) => {
      const m = new Map<number, VaultDoc>();
      for (const s of rows as unknown as VaultDoc[]) {
        if (s.db_id != null && !m.has(s.db_id)) m.set(s.db_id, s);
      }
      return m;
    };
    const sigByDoc = buildSigMap(tradeSigRows);
    const sigByAgr = buildSigMap(agrSigRows);
    const overlayDoc = (d: VaultDoc, map: Map<number, VaultDoc>): VaultDoc => {
      const sig = d.db_id != null ? map.get(d.db_id) : undefined;
      return sig ? {
        ...d,
        status:               sig.status,
        attachment_url:       sig.attachment_url ?? d.attachment_url,
        certificate_url:      sig.certificate_url ?? d.certificate_url,
        signature_request_id: sig.signature_request_id ?? d.signature_request_id,
        sig_state:            sig.sig_state ?? d.sig_state,
      } : d;
    };
    const overlayRows = (rows?: VendorDealRow[]): VendorDealRow[] => (rows ?? []).map(r => {
      const docs       = (r.docs ?? []).map(d => overlayDoc(d, sigByDoc));
      const agreements = (r.agreements ?? []).map(d => overlayDoc(d, sigByAgr));
      const signed = docs.filter(d => d.status === 'Signed').length;
      return { ...r, docs, agreements, ratios: { ...r.ratios, td: { d: signed, t: docs.length } } };
    });

    return {
      ...base,
      trade_documents: mergedTd as typeof base.trade_documents,
      trade_documents_count: mergedTd.length,
      vendor_with_shipment:    overlayRows(base.vendor_with_shipment),
      vendor_without_shipment: overlayRows(base.vendor_without_shipment),
      // KPI roll-ups: swap the raw segment-rule TD contribution for the
      // merged (party-filtered + signature-aware) numbers.
      verified_signed: Math.max(0, (base.verified_signed ?? 0) - baseSegmentSigned) + mergedSigned,
      pending:         Math.max(0, (base.pending ?? 0)         - baseSegmentPending) + mergedPending,
      total_documents: Math.max(0, (base.total_documents ?? 0) - baseSegmentTd.length) + mergedTd.length,
    };
  }, [supplier, data, vaultLive, signatureRows]);

  if (!open || !supplier || !vault) return null;

  /* Export All — builds a ZIP of the ACTUAL document files, foldered:
   *   <Supplier> /
   *     Standard / Company Due Diligence | Owner KYC Details | Trade Licenses /
   *     CTC / With Shipment ID / <shipment> /  &  Without Shipment ID / <procurement> /
   * Files are fetched as blobs (our uploads stream through the backend so Azure
   * CORS doesn't block them) and dropped into the matching folder. */
  const handleExportAll = async () => {
    if (!vault || !supplier || exporting) return;
    setExporting(true);
    let added = 0, missing = 0;
    try {
      const sanitize = (s: string) => (s || '').replace(/[\\/:*?"<>|]/g, '_').trim() || 'item';
      const fileNameFor = (d: VaultDoc): string => {
        const fromAttach = d.attachment && d.attachment.trim();
        if (fromAttach) return fromAttach;
        const fromUrl = d.attachment_url ? decodeURIComponent(d.attachment_url.split('/').pop()?.split('?')[0] || '') : '';
        return fromUrl || `${d.name || 'document'}.pdf`;
      };

      const zip = new JSZip();
      // Drop every doc with a file into `folder`, numbered to avoid name clashes.
      const addDocs = async (folder: JSZip, docs: VaultDoc[]) => {
        let i = 0;
        for (const d of docs) {
          i++;
          if (!d.attachment_url) { missing++; continue; }
          const blob = await fetchVaultBlob(d.attachment_url);
          if (!blob) { missing++; continue; }
          folder.file(`${String(i).padStart(2, '0')} - ${sanitize(fileNameFor(d))}`, blob);
          added++;
        }
        // Keep the folder visible in the zip even when nothing landed in it.
        if (!docs.some(d => d.attachment_url)) folder.file('(no documents).txt', 'No uploaded documents in this category.');
      };

      // ── Standard Documents ──
      const std = zip.folder('Standard')!;
      await addDocs(std.folder('Company Due Diligence')!, vault.company_dd);
      await addDocs(std.folder('Owner KYC Details')!, vault.owner_kyc);
      await addDocs(std.folder('Trade Licenses')!, vault.trade_licenses);

      // ── Case to Case ── one subfolder per deal (shipment / procurement id),
      // holding that deal's Trade Documents + Agreements.
      const ctc = zip.folder('CTC')!;
      const withShip = ctc.folder('With Shipment ID')!;
      const withDeals = vault.vendor_with_shipment ?? [];
      if (withDeals.length === 0) withShip.file('(no shipments).txt', 'No shipment-based deals for this supplier.');
      for (const deal of withDeals) {
        const f = withShip.folder(sanitize(deal.shipment_id || `deal-${deal.sr}`))!;
        await addDocs(f, [...(deal.docs ?? []), ...(deal.agreements ?? [])]);
      }
      const withoutShip = ctc.folder('Without Shipment ID')!;
      const withoutDeals = vault.vendor_without_shipment ?? [];
      if (withoutDeals.length === 0) withoutShip.file('(no procurements).txt', 'No procurement-based deals for this supplier.');
      for (const deal of withoutDeals) {
        const f = withoutShip.folder(sanitize(deal.procurement_id || `deal-${deal.sr}`))!;
        await addDocs(f, [...(deal.docs ?? []), ...(deal.agreements ?? [])]);
      }

      const blob = await zip.generateAsync({ type: 'blob' });
      const zipName = sanitize(`${supplier.id} ${supplier.company}`);
      saveAs(blob, `${zipName}.zip`);
      toast.success('Exported', `${added} file${added === 1 ? '' : 's'} zipped${missing ? ` · ${missing} had no attachment` : ''}.`);
    } catch {
      toast.error('Export failed', 'Could not build the ZIP. Please try again.');
    } finally {
      setExporting(false);
    }
  };

  /* ─── Status pill renderer — Verified (mint), Expiring (amber),
   *      Pending (rose), Signed (sky). Same palette across all tabs. */
  const StatusPill = ({ s }: { s: VaultStatus }) => {
    const tone =
      s === 'Verified' ? { bg: '#ecfdf5', fg: '#059669', mark: '✓' }
      : s === 'Signed'   ? { bg: '#dbeafe', fg: '#1e40af', mark: '✓' }
      : s === 'Expiring' ? { bg: '#fef3c7', fg: '#92400e', mark: '⚠' }
      :                    { bg: '#fef2f2', fg: '#dc2626', mark: '⌛' };
    return (
      <span className="cev-pill" data-status={s} style={{ background: tone.bg, color: tone.fg }}>
        {tone.mark} {s}
      </span>
    );
  };

  const docsForTab: VaultDoc[] = tab === 'company-dd' ? vault.company_dd
    : tab === 'owner-kyc'      ? vault.owner_kyc
    : tab === 'trade-licenses' ? vault.trade_licenses
    : tab === 'trade-documents' ? vault.trade_documents
    : [];
  // A document counts as "uploaded" once it has an attachment; everything
  // else is "pending". These two are the only header badges we surface.
  const isUploaded = (d: VaultDoc) => !!(d.attachment_url || (d.attachment && d.attachment !== '—'));
  const counts = {
    Uploaded: docsForTab.filter(isUploaded).length,
    Pending:  docsForTab.filter(d => !isUploaded(d)).length,
  };

  const tabMeta = TABS.find(t => t.key === tab)!;

  /* Tab badge count. Standard tabs keep their own count key. The case-to-case
   * tabs render the per-deal matrix, so their badge must follow the active
   * With/Without Shipment view — otherwise it claims "1" while the table reads
   * "No shipments". Both sub-tabs share the same deal rows, so both reflect the
   * current mode's deal count. */
  const tabCount = (t: typeof TABS[number]): number => {
    if (t.group === 'case-to-case') {
      return (shipmentIdMode === 'with' ? (vault.vendor_with_shipment ?? []) : (vault.vendor_without_shipment ?? [])).length;
    }
    return vault[t.countKey] as number;
  };

  const showSkeleton = loading && !vaultLive && !data;

  return createPortal(
    <VaultViewOnlyCtx.Provider value={viewOnly}>
    <div className="cev-overlay" role="dialog" aria-modal="true" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <style>{CEV_CSS}</style>
      {/* With/Without Shipment ID segmented toggle — matches the Figma .ev-shp-toggle
          (joined bar, not two separate pills). */}
      <style>{`
        /* Padded track with a floating, fully-rounded active pill (content-width). */
        .cev-shp-toggle{display:inline-flex;align-self:flex-start;width:fit-content;align-items:center;gap:2px;padding:3px;border-radius:10px;border:1.5px solid rgba(6,182,212,.2);background:#f0fdff;margin:-6px 18px 6px;}
        .cev-shp-toggle button{display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:7px 13px;border:none;border-radius:7px;cursor:pointer;font-family:inherit;font-size:11px;font-weight:700;letter-spacing:.01em;white-space:nowrap;transition:background .15s,color .15s,box-shadow .15s;background:transparent;color:#94a3b8;}
        .cev-shp-toggle button:hover:not(.is-active){color:#0891b2;}
        .cev-shp-toggle button.is-active{background:linear-gradient(135deg,#0891b2,#06b6d4);color:#fff;box-shadow:0 2px 8px rgba(6,182,212,.3);}
        [data-bs-theme="dark"] .cev-shp-toggle{background:rgba(6,182,212,.08);border-color:rgba(6,182,212,.25);}
        [data-bs-theme="dark"] .cev-shp-toggle button{color:#7dd3fc;}
        [data-bs-theme="dark"] .cev-shp-toggle button.is-active{background:linear-gradient(135deg,#0891b2,#06b6d4);color:#fff;}
        /* Complete / Partial / Pending status pills in the deal-matrix section header (Figma .ev-spill). */
        .cev-deal-spill{display:inline-flex;align-items:center;gap:5px;font-size:9.5px;font-weight:700;padding:4px 10px;border-radius:20px;white-space:nowrap;letter-spacing:.01em;}
        .cev-deal-dot{width:5px;height:5px;border-radius:50%;display:inline-block;flex-shrink:0;}
        /* Deal-matrix surfaces as CSS variables so the inline-styled table + JS
           hover flip with the theme (the matrix is Figma-light by default). */
        .cev-deal{--dl-row:#fff;--dl-zebra:#fafbff;--dl-hover:#f0fdff;--dl-ink:#083344;--dl-sub:#64748b;--dl-muted:#94a3b8;--dl-border:#eef0fa;--dl-line:#e8eaf5;--dl-panel:#fafbff;--dl-docrow:#fff;--dl-docline:#f0f2fa;}
        [data-bs-theme="dark"] .cev-deal{--dl-row:#101c2b;--dl-zebra:#13212f;--dl-hover:#193044;--dl-ink:#e7f2f7;--dl-sub:#9db2c4;--dl-muted:#7f97aa;--dl-border:rgba(148,197,255,.10);--dl-line:rgba(148,197,255,.12);--dl-panel:#0d1925;--dl-docrow:#101c2b;--dl-docline:rgba(148,197,255,.08);}
        /* On phones the With/Without toggle fills the row (equal buttons) so it
           can't overflow at ~320-360px. */
        @media (max-width: 640px) {
          .cev-shp-toggle{display:flex;width:auto;margin:-6px 12px 6px;}
          .cev-shp-toggle button{flex:1;padding:7px 8px;}
        }
      `}</style>
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
                <div className="cev-header-eyebrow">SUPPLIER EVIDENCE VAULT</div>
                <div className="cev-header-title">{supplier.company}</div>
                <div className="cev-header-chips">
                  <span className="cev-chip cev-chip-id">● {supplier.id}</span>
                  {supplier.customerId && <span className="cev-chip cev-chip-link">↳ {supplier.customerId}</span>}
                  <span className="cev-chip cev-chip-risk" data-risk={(supplier.risk ?? 'Low').toLowerCase()}>● {supplier.risk ?? 'Low'} Risk</span>
                  {supplier.contact && (
                    <span className="cev-chip cev-chip-contact">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                      {supplier.contact}{supplier.contactCity ? ` · ${supplier.contactCity}` : ''}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div className="cev-header-right">
              <div className="cev-header-meta">
                {(() => {
                  /* Cap the inline segment list at 5; the rest collapse into a
                   * "+N more" chip whose tooltip lists every segment, so a
                   * supplier with many segments no longer overflows the header. */
                  const segs = (supplier.segments && supplier.segments.length > 0
                    ? supplier.segments
                    : (supplier.segment ? [supplier.segment] : [])
                  ).map(s => String(s).trim()).filter(Boolean);
                  const shown = segs.slice(0, 5);
                  const extra = segs.length - shown.length;
                  return (
                    <>
                      {shown.map((s, i) => <span key={`${s}-${i}`}>{s}</span>)}
                      {extra > 0 && (
                        <button
                          type="button"
                          className="cev-seg-more"
                          onClick={e => { const b = e.currentTarget.getBoundingClientRect(); setSegPop(prev => prev ? null : { names: segs, x: b.left, y: b.bottom + 6 }); }}
                        >+{extra} more</button>
                      )}
                    </>
                  );
                })()}
                {supplier.country && <span>· {supplier.country}</span>}
              </div>
              <button type="button" className="cev-close" onClick={onClose} aria-label="Close vault">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
          </div>
        </div>

        {showSkeleton ? <VaultSkeleton /> : (<div className="cev-scroll">
        {/* ─── KPI STRIP — full-width static stat row (flat columns split by
             thin dividers, animated top accent line; no horizontal scroll). */}
        <div className="cev-kpi-outer">
          <div className="cev-kpi-strip">
            <KpiTile label="Total Documents"        value={vault.total_documents}        accent="#0e7490" />
            <KpiTile label="Verified / Signed"      value={vault.verified_signed}        accent="#16a34a" subtitle="✓ COMPLIANT" subTone="good" />
            <KpiTile label="Pending"                value={vault.pending}                accent="#dc2626" subtitle="⚠ ACTION"    subTone="bad" />
            <KpiTile label="Company Due Diligence"  value={vault.company_dd_count}       accent="#0891b2" />
            <KpiTile label="Owner KYC"              value={vault.owner_kyc_count}        accent="#0e7490" />
            <KpiTile label="Trade License"          value={vault.trade_license_count}    accent="#0891b2" />
            <KpiTile label="Trade Documents"        value={vault.trade_documents_count}  accent="#0d9488" />
            <KpiTile label="Total Shipments"        value={vault.total_shipments}        accent="#0c4a6e" />
          </div>
        </div>

        {/* ─── GROUP CARDS — Standard Documents vs Case to Case. */}
        <div className="cev-groups-wrap">
          <div className="cev-groups">
            {GROUPS.map(g => (
              <div key={g.key} className={`cev-group ${group === g.key ? 'is-active' : ''}`}>
                <button
                  type="button"
                  className="cev-group-main"
                  onClick={() => selectGroup(g.key)}
                >
                  <span className="cev-group-icon"><i className={g.icon} aria-hidden /></span>
                  <span className="cev-group-text">
                    <span className="cev-group-title">{g.title}</span>
                    <span className="cev-group-sub">{g.sub}</span>
                  </span>
                </button>
                <button
                  type="button"
                  className="cev-group-overview"
                  onClick={() => { setOverview(g.key); setOverviewPage(1); setOvShip(null); }}
                  title="View all documents in one list"
                >
                  <i className="ri-list-check-2" aria-hidden /> Document Overview
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* ─── CASE-TO-CASE: With / Without Shipment ID toggle (Figma .ev-shp-toggle).
               Sits above the Trade Documents / Agreements sub-tabs. */}
        {group === 'case-to-case' && (
          <div className="cev-shp-toggle">
            <button type="button" className={shipmentIdMode === 'with' ? 'is-active' : ''} onClick={() => setShipmentIdMode('with')}>
              <i className="ri-time-line" aria-hidden />With Shipment ID
            </button>
            <button type="button" className={shipmentIdMode === 'without' ? 'is-active' : ''} onClick={() => setShipmentIdMode('without')}>
              <i className="ri-file-list-2-line" aria-hidden />Without Shipment ID
            </button>
          </div>
        )}

        {/* ─── SUB-TABS — for the active group. */}
        <div className="cev-tabs-wrap">
          <div className="cev-tabs">
            {TABS.filter(t => t.group === group).map(t => (
              <button
                key={t.key}
                type="button"
                className={`cev-tab ${tab === t.key ? 'is-active' : ''}`}
                onClick={() => selectTab(t)}
              >
                <span className="cev-tab-icon"><i className={t.icon} aria-hidden /></span>
                <span className="cev-tab-label">{t.label}</span>
                <span className="cev-tab-count">{tabCount(t)}</span>
              </button>
            ))}
          </div>
        </div>

        {/* ─── BODY ─── */}
        {/* The Shipment Agreements tab adds a Customer=/≠Supplier toggle between
            the section and the table, so it uses the "fused card" layout. */}
        <div className={`cev-body ${tab === 'shipment-agreements' ? 'cev-body-ship' : ''}`}>
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
              {group === 'case-to-case' && tab === 'trade-documents' ? (() => {
                const dr = shipmentIdMode === 'with' ? (vault.vendor_with_shipment ?? []) : (vault.vendor_without_shipment ?? []);
                const cmpl = dr.filter(r => (r.ratios?.td?.t ?? 0) > 0 && r.ratios?.td?.d === r.ratios?.td?.t).length;
                const part = dr.filter(r => (r.ratios?.td?.d ?? 0) > 0 && (r.ratios?.td?.d ?? 0) < (r.ratios?.td?.t ?? 0)).length;
                const pend = dr.filter(r => (r.ratios?.td?.d ?? 0) === 0).length;
                const spill = (txt: string, bg: string, fg: string, bd: string, dot: string) => (
                  <span className="cev-deal-spill" style={{ background: bg, color: fg, border: `1px solid ${bd}` }}><span className="cev-deal-dot" style={{ background: dot }} />{txt}</span>
                );
                return (<>
                  {cmpl > 0 && spill(`Complete ${cmpl}`, 'linear-gradient(135deg,#ecfdf5,#d1fae5)', '#059669', '#6ee7b7', '#10b981')}
                  {part > 0 && spill(`Partial ${part}`, 'linear-gradient(135deg,#fffbeb,#fef3c7)', '#d97706', '#fcd34d', '#f59e0b')}
                  {pend > 0 && spill(`Pending ${pend}`, 'linear-gradient(135deg,#fef2f2,#fee2e2)', '#dc2626', '#fca5a5', '#ef4444')}
                  <span className="cev-sec-pill cev-sec-pill-docs">{dr.length} {shipmentIdMode === 'with' ? 'Shipments' : 'Procurements'}</span>
                </>);
              })() : group === 'case-to-case' && tab === 'shipment-agreements' ? (
                <span className="cev-sec-pill cev-sec-pill-docs">{(shipmentIdMode === 'with' ? (vault.vendor_with_shipment ?? []) : (vault.vendor_without_shipment ?? [])).length} {shipmentIdMode === 'with' ? 'Shipments' : 'Procurements'}</span>
              ) : tab === 'shipment-agreements' ? (
                <span className="cev-sec-pill cev-sec-pill-docs">{vault.total_shipments} Shipments</span>
              ) : (
                <>
                  {counts.Uploaded > 0 && <span className="cev-sec-pill cev-sec-pill-ok"><span className="cev-sec-dot" />Uploaded {counts.Uploaded}</span>}
                  {counts.Pending > 0 && <span className="cev-sec-pill cev-sec-pill-bad"><span className="cev-sec-dot" />Pending {counts.Pending}</span>}
                </>
              )}
            </div>
          </div>

          {group === 'case-to-case' && (tab === 'trade-documents' || tab === 'shipment-agreements')
            ? <VendorDealTable key={`${shipmentIdMode}-${tab}`} mode={shipmentIdMode} docKind={tab === 'shipment-agreements' ? 'agreement' : 'trade'}
                               rows={shipmentIdMode === 'with' ? (vault.vendor_with_shipment ?? []) : (vault.vendor_without_shipment ?? [])}
                               ownerId={supplier?.db_id ?? null} onReload={reloadVault}
                               onSendTradeDoc={(d) => { if (d.db_id) { setSendKind(tab === 'shipment-agreements' ? 'agreement' : 'trade'); setSendDocIds([d.db_id]); } }} onRemindTradeDoc={handleRemind} />
            : tab === 'shipment-agreements'
              ? <ShipmentTable rows={vault.shipment_agreements} />
              : <DocsTable rows={docsForTab} tab={tab} ownerType="supplier" ownerId={supplier?.db_id ?? null} onReload={reloadVault}
                           onSendTradeDoc={(d) => { if (d.db_id) { setSendKind('trade'); setSendDocIds([d.db_id]); } }}
                           onRemindTradeDoc={handleRemind} />}
        </div>
        </div>)}

        {/* ─── FOOTER ─── */}
        <div className="cev-footer">
          <div className="cev-footer-meta" />
          <div className="cev-footer-actions">
            <Tooltip label="Download all files as a foldered ZIP">
              <button type="button" className="cev-btn cev-btn-light" onClick={handleExportAll} disabled={exporting}>
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
          modal portals to <body>, so it overlays the vault cleanly.
          NOTE: multiBox (one-person-multiple-signatures "Sign 1/2/3" picker) is
          temporarily DISABLED — the single-signature original Zoho flow is used.
          The multi-box code stays intact in the send modal, gated behind the
          prop; re-enable by adding `multiBox` back to the props below. */}
      <SalesCustomerSendForSignatureModal
        open={Array.isArray(sendDocIds)}
        customer={supplier?.db_id ? {
          id:      supplier.id,
          db_id:   supplier.db_id,
          company: supplier.company,
          contact: supplier.contact,
          email:   supplier.email,   // primary contact email → default signer
        } : null}
        modelName="Vendor"
        sendAsAgreement={sendKind === 'agreement'}
        preselectedDocIds={sendDocIds ?? undefined}
        onClose={() => setSendDocIds(null)}
        onSent={() => { setSendDocIds(null); void reloadSignatures(); }}
      />

      {/* Document Overview popup — all documents for the chosen group in one
          flat list (name + status + download). Opened from the "Document
          Overview" button on each group card. */}
      {overview && (() => {
        const isStd = overview === 'standard';
        const stdDocs: VaultDoc[] = isStd ? [...vault.company_dd, ...vault.owner_kyc, ...vault.trade_licenses] : [];
        const c2cDocs: VaultDoc[] = isStd ? [] : vault.trade_documents;
        const title = isStd ? 'Standard Documents — Overview' : 'Case to Case Agreements — Overview';
        const sub = isStd
          ? 'All Company Due Diligence, Owner KYC & Trade Licenses documents in one list'
          : 'All Trade Documents & Agreements in one list';
        const docs: VaultDoc[] = isStd ? stdDocs : c2cDocs;
        // Full list — the body scrolls after ~5 rows (see .cev-ov-body
        // min/max-height) instead of paginating.
        void overviewPage;
        return (
          <div className="cev-ov-overlay" role="dialog" aria-modal="true" onMouseDown={(e) => { if (e.target === e.currentTarget) setOverview(null); }}>
            <div className="cev-ov-card">
              <div className="cev-ov-head">
                <span className="cev-ov-head-icon"><i className="ri-list-check-2" aria-hidden /></span>
                <div className="cev-ov-head-text">
                  <div className="cev-ov-title">{title}</div>
                  <div className="cev-ov-sub">{sub}</div>
                </div>
                <button type="button" className="cev-ov-close" onClick={() => setOverview(null)} aria-label="Close"><i className="ri-close-line" /></button>
              </div>
              <div className="cev-ov-body">
                <table className="cev-ov-table">
                  <thead><tr><th style={{ width: 48 }}>#</th><th>DOCUMENT NAME</th><th style={{ width: 130 }}>STATUS</th><th style={{ width: 130 }}>ACTION</th></tr></thead>
                  <tbody>
                    {docs.length === 0 ? (
                      <tr><td colSpan={4} className="cev-ov-empty">No documents available.</td></tr>
                    ) : docs.map((d, i) => {
                      const absIdx = i;
                      const raw = d.attachment_url;
                      const url = raw ? resolveFileUrl(raw) : null;
                      const fname = d.attachment || `${d.name}.pdf`;
                      return (
                        <tr key={`${overview}-${absIdx}`}>
                          <td className="cev-ov-num">{absIdx + 1}</td>
                          <td className="cev-ov-name">{d.name}</td>
                          <td><StatusPill s={d.status as VaultStatus} /></td>
                          <td>
                            {(() => {
                              const dlKey = `${overview}-${absIdx}`;
                              const dling = ovDownloadingKey === dlKey;
                              return (
                                <button
                                  type="button"
                                  className="cev-ov-dl"
                                  disabled={!url || dling}
                                  onClick={async () => {
                                    if (!url) return;
                                    setOvDownloadingKey(dlKey);
                                    try { await downloadFile(url, fname); } finally { setOvDownloadingKey(null); }
                                  }}
                                >
                                  {dling
                                    ? <><i className="ri-loader-4-line cev-spin" aria-hidden /> Downloading…</>
                                    : <><i className="ri-download-2-line" aria-hidden /> Download</>}
                                </button>
                              );
                            })()}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {docs.length > 0 && (
                <div className="cev-ov-pager">
                  <span className="cev-ov-pager-info">
                    Showing all <strong>{docs.length}</strong> document{docs.length === 1 ? '' : 's'}
                  </span>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {segPop && createPortal(
        <>
          <div onClick={() => setSegPop(null)} style={{ position: 'fixed', inset: 0, zIndex: 13000 }} />
          <div className="cev-seg-pop" style={{ position: 'fixed', left: Math.min(segPop.x, window.innerWidth - 250), top: segPop.y, zIndex: 13001, width: 232, maxHeight: 320, overflowY: 'auto' }}>
            <div className="cev-seg-pop-title">Segments ({segPop.names.length})</div>
            {segPop.names.map((name, i) => (
              <div key={i} className={`cev-seg-pop-row ${i % 2 ? 'alt' : ''}`}>
                <span className="cev-seg-pop-pill">{name}</span>
              </div>
            ))}
          </div>
        </>,
        document.body
      )}
    </div>
    </VaultViewOnlyCtx.Provider>,
    document.body
  );
}

/* ─── KPI tile — flat stat column (matches the CLM prototype): small uppercase
 *      label, a large tone-coloured number, and an optional status sub-line
 *      (✓ COMPLIANT / ⚠ ACTION). No icon box / gradient chrome. */
function KpiTile({ label, value, accent, subtitle, subTone }: { label: string; value: number; accent?: string; subtitle?: string; subTone?: 'good' | 'bad' }) {
  return (
    <div className="cev-kpi-tile">
      <div className="cev-kpi-label">{label.toUpperCase()}</div>
      <div className="cev-kpi-value" style={accent ? { color: accent } : undefined}>{value.toLocaleString()}</div>
      {subtitle && <div className={`cev-kpi-sub ${subTone === 'bad' ? 'is-bad' : 'is-good'}`}>{subtitle}</div>}
    </div>
  );
}

/* ─── Loading skeleton — shimmer placeholders for the whole vault body
   (KPI ribbon, group cards, tabs, section banner, table). Shown on first
   load instead of the demo fallback. */
function VaultSkeleton() {
  return (
    <div className="cev-skel">
      <div className="cev-skel-kpis">
        {Array.from({ length: 6 }).map((_, i) => <div key={i} className="cev-skel-kpi cev-sk" />)}
      </div>
      <div className="cev-skel-groups">
        <div className="cev-skel-group cev-sk" />
        <div className="cev-skel-group cev-sk" />
      </div>
      <div className="cev-skel-tabs">
        {Array.from({ length: 3 }).map((_, i) => <div key={i} className="cev-skel-tab cev-sk" />)}
      </div>
      <div className="cev-skel-section cev-sk" />
      <div className="cev-skel-table">
        <div className="cev-skel-thead cev-sk" />
        {Array.from({ length: 6 }).map((_, i) => <div key={i} className="cev-skel-row cev-sk" />)}
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
  const authorityLbl = tab === 'trade-documents' ? 'Counter Party' : 'Issuing Authority';
  /* Tab → SegmentDocUpload category for the re-upload endpoint. */
  const category: 'kyc' | 'dd' | 'tl' | 'td' = tab === 'company-dd' ? 'dd' : tab === 'owner-kyc' ? 'kyc' : tab === 'trade-licenses' ? 'tl' : 'td';
  return (
    <div className="cev-table-wrap">
      <div className="cev-table-scroll">

      {/* Columns: Sr No · Auto Code · Document Name · Issuing Authority ·
          Requirement · Attachment · Actions. */}
      <table className="cev-table">
        <thead>
          <tr>
            <th style={{ width: 56 }}>Sr No</th>
            <th>Auto Code</th>
            <th>Document Name</th>
            <th>{authorityLbl}</th>
            <th>Requirement</th>
            <th>Attachment</th>
            <th style={{ width: 140 }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={7} className="cev-empty">No documents in this bucket yet.</td></tr>
          ) : rows.map((d, i) => (
            <tr key={`${d.doc_code ?? 'doc'}-${i}`}>
              <td>{i + 1}</td>
              <td className="cev-mono">{d.reference || d.doc_code || '—'}</td>
              <td className="cev-doc-name">{d.name}</td>
              <td>{d.authority && d.authority !== '—' ? <Tooltip label={d.authority}><span>{d.authority.length > 25 ? d.authority.slice(0, 25) + '…' : d.authority}</span></Tooltip> : '—'}</td>
              <td>
                {d.requirement === 'M' ? (
                  <span className="cev-req cev-req-m" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 800, background: '#dcfce7', color: '#15803d', border: '1px solid #bbf7d0', whiteSpace: 'nowrap' }}>★ Mandatory</span>
                ) : (
                  <span className="cev-req cev-req-o" style={{ display: 'inline-flex', alignItems: 'center', padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: '#f1f5f9', color: '#64748b', border: '1px solid #e2e8f0', whiteSpace: 'nowrap' }}>Optional</span>
                )}
              </td>
              <td>
                {d.attachment_url ? (
                  <a href={d.attachment_url} target="_blank" rel="noreferrer" className="cev-attach"><i className="ri-download-2-line" /> {d.attachment || 'View'}</a>
                ) : d.attachment ? (
                  <span className="cev-attach cev-attach-muted"><i className="ri-file-line" /> {d.attachment}</span>
                ) : <span style={{ color: '#9ca3af' }}>—</span>}
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
 * tab; Download triggers a blob save; Re-upload posts to
 * /segment-uploads/{type}/{id} with the same (category, doc_code) tuple so
 * the existing row is replaced server-side. */
function VaultRowActions({ doc, ownerType, ownerId, category, onReload, onSendTradeDoc, onRemindTradeDoc }: {
  doc: VaultDoc;
  ownerType: 'customer' | 'consignee' | 'supplier';
  ownerId: number | null;
  category: 'kyc' | 'dd' | 'tl' | 'td' | 'agreement';
  onReload: () => Promise<void> | void;
  onSendTradeDoc?: (doc: VaultDoc) => void;
  onRemindTradeDoc?: (doc: VaultDoc) => void | Promise<void>;
}) {
  const toast = useToast();
  const viewOnly = useContext(VaultViewOnlyCtx);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [reminding, setReminding] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const canViewOrDownload = !!doc.attachment_url;
  const canReupload = !!ownerId && !!doc.doc_code;
  // Signing lifecycle for Trade Document rows:
  //   • signed (completed)   → no Send / no Reminder, View signed + cert only
  //   • sent (inprogress)    → no Send, Reminder only
  //   • never sent / dead    → Send available (declined / recalled / expired
  //                            count as "dead" so a fresh round can start)
  const isSigned     = doc.sig_state === 'completed' || doc.status === 'Signed';
  const isInProgress = doc.sig_state === 'inprogress';
  // Trade Documents AND case-to-case Agreements both support Send / Remind —
  // ClmSignatureController::send accepts agreement_ids and runs the same Zoho
  // flow, so the same lifecycle gates (signed / in-progress / fresh) apply.
  const isTradeDoc   = (category === 'td' || category === 'agreement') && !!ownerId && !!doc.db_id;
  const canSend   = !viewOnly && isTradeDoc && !!onSendTradeDoc && !isSigned && !isInProgress;
  const canRemind = isTradeDoc && !!onRemindTradeDoc && isInProgress && !!doc.signature_request_id;

  const remind = async () => {
    if (!onRemindTradeDoc) return;
    setReminding(true);
    try { await onRemindTradeDoc(doc); } finally { setReminding(false); }
  };

  // Blob download so it works on the deployed server too (a plain <a download>
  // is ignored cross-origin / for inline-served files → opens instead of saving).
  // Spinner while the file streams so the user sees the download is in flight.
  const download = async () => {
    if (downloading) return;
    setDownloading(true);
    try { await downloadFile(doc.attachment_url, doc.attachment ?? undefined); }
    catch { toast.error('Download failed', 'Could not download the file. Please try again.'); }
    finally { setDownloading(false); }
  };

  const onPick = async (f: File | undefined) => {
    if (!f || !ownerId || !doc.doc_code) return;
    // Only PDF / JPG / PNG may be uploaded (Word / Excel are blocked so every
    // stored attachment can be previewed in-browser via View).
    if (!/\.(pdf|jpe?g|png)$/i.test(f.name)) {
      toast.error('Unsupported file type', 'Only PDF, JPG or PNG files are allowed. Word / Excel files are not supported.');
      return;
    }
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
      toast.success('Document uploaded', `${f.name} has been attached.`);
    } catch (e: any) {
      toast.error('Upload failed', e?.response?.data?.message || 'The file could not be uploaded. Please try again.');
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
        accept=".pdf,.jpg,.jpeg,.png"
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
              background: '#cffafe', color: '#0891b2', border: '1px solid #67e8f9',
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
      <Tooltip label={!canViewOrDownload ? 'No attachment yet' : (downloading ? 'Downloading…' : `Download ${doc.attachment}`)}>
        <button
          type="button"
          disabled={!canViewOrDownload || downloading}
          onClick={download}
          className={`cev-row-act cev-row-act-download ${!canViewOrDownload ? 'is-disabled' : ''}`}
          aria-label="Download"
        >
          {downloading
            ? <i className="ri-loader-4-line cev-spin" style={{ fontSize: 13 }} aria-hidden />
            : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>}
        </button>
      </Tooltip>
      {/* Upload / Re-upload is hidden on the Case-to-Case Trade Documents
          tab (category 'td') — those rows are driven by the signature
          flow (Send / Reminder / signed-file View), not manual file
          attachment. Standard tabs (KYC / DD / Trade Licenses) keep it.
          Also hidden in viewOnly mode (e.g. from a With-PO SPI). */}
      {category !== 'td' && !viewOnly && (
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
      )}
      {/* Certificate of Completion — only rendered when this row came
          from a completed Zoho Sign request. */}
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

/* ─── Shipment-ID-wise matrix — one row per shipment with the Customer /
 *      Supplier compliance ratios. A Customer = / ≠ Supplier toggle filters
 *      the rows. */
/* Case-to-Case matrix — shipment-wise (With Shipment ID) or procurement-wise
   (Without Shipment ID). Reuses the shipment table's chip pills + Ratio cells.
   The KYC/DD/Lic/Docs ratios are the vendor's overall verified-vs-total. */
/* ── Vendor deal matrix (Case-to-Case → Trade Documents) ──────────────────
 * Faithful port of the P2P_Sourcing Figma "Trade Documents" matrix: dark-teal
 * gradient header, teal rounded ID pill with a clock glyph, gradient avatar
 * blocks for Customer / Consignee / Supplier, and colour-coded d/t + % ratio
 * cells (green 100% · amber partial · red 0%). Styling is inline to mirror the
 * prototype 1:1. */
const DEAL_TH: React.CSSProperties = { padding: '10px 8px', fontSize: 7, fontWeight: 700, letterSpacing: '.12em', color: 'rgba(255,255,255,.65)', textTransform: 'uppercase' };
const DEAL_THC: React.CSSProperties = { ...DEAL_TH, textAlign: 'center' };
const DEAL_AV_GRADS = [
  'linear-gradient(135deg,#06b6d4,#22d3ee)',
  'linear-gradient(135deg,#0e7490,#22d3ee)',
  'linear-gradient(135deg,#0891b2,#06b6d4)',
  'linear-gradient(135deg,#083344,#0891b2)',
];

function dealFrac(c?: DealCount) {
  // Null-safe against a malformed/missing ratio so one bad row can't crash the
  // whole Case-to-Case table (server is expected to always send {d,t}).
  const d = c?.d ?? 0, t = c?.t ?? 0;
  const pct = t > 0 ? Math.round((d / t) * 100) : 0;
  const col = pct === 100 ? '#059669' : pct > 0 ? '#d97706' : '#dc2626';
  return (
    <div style={{ lineHeight: 1.3 }}>
      <div style={{ fontSize: 12, fontWeight: 800, color: col }}>{d}/{t}</div>
      <div style={{ fontSize: 8, fontWeight: 600, color: col, opacity: 0.7 }}>{pct}%</div>
    </div>
  );
}

function DealAvatar({ name, grad, tag }: { name: string; grad: string; tag?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <div style={{ width: 34, height: 34, borderRadius: 10, background: grad, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 800, color: '#fff', flexShrink: 0, boxShadow: '0 2px 8px rgba(6,182,212,.3)' }}>{(name || '—').charAt(0).toUpperCase()}</div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--dl-ink, #083344)', lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 220 }}>{name || '—'}</div>
        {tag && <div style={{ marginTop: 2 }}><span style={{ fontSize: 8, background: '#ecfdf5', color: '#059669', border: '1px solid #a7f3d0', padding: '1px 6px', borderRadius: 4, fontWeight: 700 }}>{tag}</span></div>}
      </div>
    </div>
  );
}

function DealIdPill({ text }: { text: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 9.5, fontWeight: 700, padding: '4px 9px', borderRadius: 20, border: '1.5px solid #a5f3fc', background: '#ecfeff', color: '#0e7490', whiteSpace: 'nowrap' }}>
      <span style={{ width: 13, height: 13, borderRadius: '50%', border: '1.5px solid #a5f3fc', background: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <svg width="7" height="7" viewBox="0 0 24 24" fill="none" stroke="#22d3ee" strokeWidth="2.5"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
      </span>{text}
    </span>
  );
}

/* Compact Figma drill-down sub-table — small fonts + the Figma columns
 * (# · Document Name · Required · Uploaded On · Valid Upto · Status · Actions),
 * but each row keeps the real VaultRowActions Zoho wiring (Send / Remind /
 * signed-status / certificate / re-upload) so it behaves exactly like the
 * Customer vault. */
const DEAL_SUB_TH: React.CSSProperties = { padding: '8px 12px', fontSize: 6.5, fontWeight: 700, letterSpacing: '.12em', color: 'rgba(255,255,255,.65)', textTransform: 'uppercase' };

function dealDocState(d: VaultDoc): { label: string; c: [string, string, string, string] } {
  if (d.sig_state === 'completed' || d.status === 'Signed') return { label: 'Signed', c: ['#ecfdf5', '#059669', '#a7f3d0', '#10b981'] };
  if (d.sig_state === 'inprogress') return { label: 'Sent', c: ['#fffbeb', '#d97706', '#fcd34d', '#f59e0b'] };
  if (d.status === 'Verified') return { label: 'Verified', c: ['#ecfdf5', '#059669', '#a7f3d0', '#10b981'] };
  return { label: 'Pending', c: ['#fef2f2', '#dc2626', '#fca5a5', '#ef4444'] };
}

function DealDocsSubTable({ rows, ownerId, onReload, onSendTradeDoc, onRemindTradeDoc, category = 'td', emptyLabel = 'No trade documents on record.' }: {
  rows: VaultDoc[];
  ownerId: number | null;
  onReload: () => Promise<void> | void;
  onSendTradeDoc?: (doc: VaultDoc) => void;
  onRemindTradeDoc?: (doc: VaultDoc) => void | Promise<void>;
  /** 'td' = Trade Documents, 'agreement' = case-to-case Agreements. Both get
   *  the full Send / Remind / View actions (supplier agreement-send is wired
   *  through ClmSignatureController::send with agreement_ids). */
  category?: 'td' | 'agreement';
  emptyLabel?: string;
}) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr style={{ background: 'linear-gradient(110deg,#083344,#0e7490)' }}>
          <th style={{ ...DEAL_SUB_TH, width: 32, textAlign: 'center' }}>#</th>
          <th style={{ ...DEAL_SUB_TH, textAlign: 'left' }}>Document Name</th>
          <th style={{ ...DEAL_SUB_TH, textAlign: 'center' }}>Required</th>
          <th style={{ ...DEAL_SUB_TH, textAlign: 'center' }}>Uploaded On</th>
          <th style={{ ...DEAL_SUB_TH, textAlign: 'center' }}>Valid Upto</th>
          <th style={{ ...DEAL_SUB_TH, textAlign: 'center' }}>Status</th>
          <th style={{ ...DEAL_SUB_TH, textAlign: 'center' }}>Actions</th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr><td colSpan={7} style={{ padding: 18, textAlign: 'center', color: 'var(--dl-muted)', fontSize: 11, background: 'var(--dl-docrow)' }}>{emptyLabel}</td></tr>
        ) : rows.map((d, di) => {
          const st = dealDocState(d);
          return (
            <tr key={`${d.doc_code ?? 'doc'}-${di}`} style={{ background: 'var(--dl-docrow)', borderBottom: '1px solid var(--dl-docline)' }}>
              <td style={{ padding: '11px 12px', textAlign: 'center', fontSize: 10.5, fontWeight: 700, color: '#0e7490' }}>{di + 1}</td>
              <td style={{ padding: '11px 12px' }}>
                <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--dl-ink, #083344)' }}>{d.name}</div>
                {(d.reference || d.doc_code) && <div style={{ fontSize: 9, color: 'var(--dl-muted)', marginTop: 2 }}>{d.reference || d.doc_code}</div>}
              </td>
              <td style={{ padding: '11px 12px', textAlign: 'center' }}>
                <span style={{ fontSize: 8.5, fontWeight: 800, padding: '2.5px 8px', borderRadius: 5, ...(d.requirement === 'O' ? { background: '#f1f5f9', color: '#64748b', border: '1px solid #e2e8f0' } : { background: 'linear-gradient(135deg,#fef3c7,#fde68a)', color: '#92400e', border: '1px solid #fcd34d' }) }}>{d.requirement === 'O' ? 'OPT' : 'REQ'}</span>
              </td>
              <td style={{ padding: '11px 12px', textAlign: 'center', fontSize: 10.5, color: 'var(--dl-sub)' }}>{d.issue_date || '—'}</td>
              <td style={{ padding: '11px 12px', textAlign: 'center', fontSize: 10.5, color: 'var(--dl-sub)' }}>{d.expiry || '—'}</td>
              <td style={{ padding: '11px 12px', textAlign: 'center' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 9.5, fontWeight: 700, padding: '3px 9px', borderRadius: 6, background: st.c[0], color: st.c[1], border: `1px solid ${st.c[2]}` }}><span style={{ width: 5, height: 5, borderRadius: '50%', background: st.c[3], display: 'inline-block' }} />{st.label}</span>
              </td>
              <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                <VaultRowActions doc={d} ownerType="supplier" ownerId={ownerId} category={category} onReload={onReload} onSendTradeDoc={onSendTradeDoc} onRemindTradeDoc={onRemindTradeDoc} />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function VendorDealTable({ mode, rows, ownerId, onReload, onSendTradeDoc, onRemindTradeDoc, docKind = 'trade' }: {
  mode: 'with' | 'without';
  rows: VendorDealRow[];
  ownerId: number | null;
  onReload: () => Promise<void> | void;
  onSendTradeDoc?: (doc: VaultDoc) => void;
  onRemindTradeDoc?: (doc: VaultDoc) => void | Promise<void>;
  /** Which per-deal doc set the drill-down shows: Trade Documents or Agreements. */
  docKind?: 'trade' | 'agreement';
}) {
  const [open, setOpen] = useState<number | null>(null);
  // total column count incl. the leading expand-arrow column
  const span = (mode === 'with' ? 9 : 7) + 1;
  return (
    <div className="cev-deal" style={{ margin: 0, border: '1.5px solid var(--dl-line)', borderRadius: 8, overflow: 'hidden' }}>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: mode === 'with' ? 920 : 660 }}>
          <thead>
            <tr style={{ background: 'linear-gradient(110deg,#083344 0%,#0c4a6e 55%,#0e7490 100%)' }}>
              <th style={{ ...DEAL_TH, paddingLeft: 14, width: 40 }} />
              <th style={{ ...DEAL_TH, textAlign: 'left' }}>SR</th>
              <th style={{ ...DEAL_TH, textAlign: 'left' }}>{mode === 'with' ? 'Shipment ID' : 'Procurement ID'}</th>
              {mode === 'with' && <th style={{ ...DEAL_TH, textAlign: 'left' }}>Customer</th>}
              {mode === 'with' && <th style={{ ...DEAL_TH, textAlign: 'left' }}>Consignee</th>}
              <th style={{ ...DEAL_TH, textAlign: 'left' }}>Supplier</th>
              <th style={DEAL_THC}>KYC</th>
              <th style={DEAL_THC}>Due Dil.</th>
              <th style={DEAL_THC}>Trade Lic.</th>
              <th style={{ ...DEAL_THC, paddingRight: 14 }}>Trade Docs</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={span} style={{ padding: 34, textAlign: 'center', color: 'var(--dl-muted)', fontSize: 12, background: 'var(--dl-panel)' }}>
                {mode === 'with' ? 'No shipments for this supplier yet.' : 'No procurements for this supplier yet.'}
              </td></tr>
            ) : rows.map((r, idx) => {
              const bg = idx % 2 === 0 ? 'var(--dl-row)' : 'var(--dl-zebra)';
              const isOpen = open === idx;
              return (
                <Fragment key={`${r.sr}-${r.shipment_id ?? r.procurement_id}`}>
                  <tr style={{ background: isOpen ? 'var(--dl-hover)' : bg, borderBottom: '1.5px solid var(--dl-border)', cursor: 'pointer' }}
                      onClick={() => setOpen(isOpen ? null : idx)}
                      onMouseEnter={(e) => { if (!isOpen) e.currentTarget.style.background = 'var(--dl-hover)'; }}
                      onMouseLeave={(e) => { if (!isOpen) e.currentTarget.style.background = bg; }}>
                    <td style={{ padding: '13px 8px 13px 14px', verticalAlign: 'middle', width: 40 }}>
                      <span style={{ fontSize: 9, color: '#0e7490', userSelect: 'none' }}>{isOpen ? '▼' : '▶'}</span>
                    </td>
                    <td style={{ padding: '13px 8px', verticalAlign: 'middle', fontSize: 11, fontWeight: 700, color: '#0e7490' }}>{r.sr}</td>
                    <td style={{ padding: '13px 8px', verticalAlign: 'middle' }}><DealIdPill text={r.shipment_id ?? r.procurement_id ?? '—'} /></td>
                    {mode === 'with' && <td style={{ padding: '13px 8px', verticalAlign: 'middle' }}><DealAvatar name={r.customer || '—'} grad={DEAL_AV_GRADS[idx % DEAL_AV_GRADS.length]} /></td>}
                    {mode === 'with' && <td style={{ padding: '13px 8px', verticalAlign: 'middle' }}>{r.consignee ? <DealAvatar name={r.consignee} grad="linear-gradient(135deg,#059669,#10b981)" tag="Consignee" /> : <span style={{ fontSize: 10, color: 'var(--dl-muted)' }}>—</span>}</td>}
                    <td style={{ padding: '13px 8px', verticalAlign: 'middle' }}><DealAvatar name={r.supplier} grad="linear-gradient(135deg,#0891b2,#06b6d4)" /></td>
                    <td style={{ padding: '13px 8px', verticalAlign: 'middle', textAlign: 'center' }}>{dealFrac(r.ratios?.kyc)}</td>
                    <td style={{ padding: '13px 8px', verticalAlign: 'middle', textAlign: 'center' }}>{dealFrac(r.ratios?.dd)}</td>
                    <td style={{ padding: '13px 8px', verticalAlign: 'middle', textAlign: 'center' }}>{dealFrac(r.ratios?.tl)}</td>
                    <td style={{ padding: '13px 14px 13px 8px', verticalAlign: 'middle', textAlign: 'center' }}>{dealFrac(r.ratios?.td)}</td>
                  </tr>
                  {isOpen && (
                    <tr>
                      <td colSpan={span} style={{ padding: 0, background: 'var(--dl-panel)', borderTop: '1.5px solid var(--dl-line)', borderBottom: '1.5px solid var(--dl-line)' }}>
                        {/* Compact Figma drill-down — small fonts + Figma columns,
                            but the same Zoho Send / Remind / signed-status / cert
                            wiring as the Customer vault (via VaultRowActions). */}
                        <DealDocsSubTable rows={docKind === 'agreement' ? (r.agreements ?? []) : (r.docs ?? [])} ownerId={ownerId}
                                          onReload={onReload} onSendTradeDoc={onSendTradeDoc} onRemindTradeDoc={onRemindTradeDoc}
                                          category={docKind === 'agreement' ? 'agreement' : 'td'}
                                          emptyLabel={docKind === 'agreement' ? 'No agreements on record.' : 'No trade documents on record.'} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ShipmentTable({ rows }: { rows: VaultShipmentRow[] }) {
  const filtered = rows;
  return (
    <>
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
  /* Plain stacked count — bold "X/Y" with the percentage beneath, tinted
   * by completion (green = complete, amber = partial, red = missing). No
   * donut/circle — matches the Figma's coloured-number columns. */
  const tone = r.pct >= 100 ? 'good' : r.pct >= 50 ? 'mid' : 'bad';
  const status = tone === 'good' ? 'Complete' : tone === 'mid' ? 'Partial' : 'Missing';
  return (
    <span className="cev-ratio-num" data-tone={tone} title={`${r.ratio} · ${status}`}>
      <span className="cev-ratio-num-main">{r.ratio}</span>
      <span className="cev-ratio-num-pct">{r.pct}%</span>
    </span>
  );
}

function sectionSub(tab: TabKey): string {
  switch (tab) {
    case 'company-dd':       return 'Business registration, tax, compliance & identity documents';
    case 'owner-kyc':        return 'Director identity, address proof & personal compliance documents';
    case 'trade-licenses':   return 'Export, import & product-specific trade authorization licenses';
    case 'trade-documents':  return 'Sales contracts, purchase orders & signed trade agreements';
    case 'shipment-agreements': return 'Per-shipment compliance matrix grouped by customer-supplier link';
  }
}
