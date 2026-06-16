import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { ShipmentDocPanel, type VaultShipmentDoc } from './CustomerEvidenceVaultModal';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import api from '../../api';
import Tooltip from '../../components/ui/Tooltip';
import { useToast } from '../../contexts/ToastContext';
import { signatureRequestsToVaultDocs, mergeTradeDocuments, type SigReqRow } from '../../utils/vaultSignatureRows';
import { downloadFile } from '../../utils/downloadFile';
import SalesCustomerSendForSignatureModal from './SalesCustomerSendForSignatureModal';
import { SigningTrackerModal } from './SigningTrackerModal';

/* ────────────────────────────────────────────────────────────────────────────
 * Consignee Evidence Vault — read-only compliance archive
 *
 * Mirrors CustomerEvidenceVaultModal in structure (same 5 buckets, same
 * shipment matrix) but skinned with the emerald palette that matches the
 * Sales → Consignee page (mint hero strip, emerald Add Consignee button).
 * The vault opens FROM that page so it should feel like an extension of
 * it, not the sibling Customer module which owns the violet identity.
 *
 *   1. Company Due Diligence — PAN, TAN, GST, CIN, IEC, Address Proof, …
 *   2. Owner KYC Details     — Aadhaar, PAN, Passport, Director address …
 *   3. Trade Licenses        — IEC, APEDA, Agro Export Permit, Organic …
 *   4. Trade Documents       — Master Sales Agreement, PO Framework, NDA …
 *   5. Shipment Agreements   — per-shipment matrix (Buyer = Consignee / ≠)
 *
 * Backend wiring (planned, NOT live yet):
 *   GET /api/consignees/{id}/vault → { stats, company_dd, owner_kyc,
 *                                      trade_licenses, trade_documents,
 *                                      shipment_agreements, last_updated }
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
  consignee?: string;
  country: string;
  due_dil:    { ratio: string; pct: number };
  kyc:        { ratio: string; pct: number };
  trade_lic:  { ratio: string; pct: number };
  trade_docs: { ratio: string; pct: number };
  agreement:  { ratio: string; pct: number };
  risk: 'Compliant' | 'Medium' | 'High';
  buyer_is_consignee: boolean;
  trade_docs_buyer?:     VaultShipmentDoc[];
  trade_docs_consignee?: VaultShipmentDoc[];
  agreements_buyer?:     VaultShipmentDoc[];
  agreements_consignee?: VaultShipmentDoc[];
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
  last_updated:           string;
}

export interface ConsigneeVaultTarget {
  id: string;             // CN-001 / matches consignees.code
  db_id?: number;
  company: string;
  risk?: string;
  segment?: string;
  country?: string;
  contact?: string;
  contactCity?: string;
  /* Linked customer code (e.g. C-010) so the header can show the
   * buyer-consignee relationship at a glance. */
  customerId?: string;
}

interface Props {
  open: boolean;
  consignee: ConsigneeVaultTarget | null;
  onClose: () => void;
  data?: VaultData | null;
  /** Tab to open on — lets the Buyer Profile page deep-link straight to
   *  a bucket (e.g. 'owner-kyc') when a progress cell is clicked.
   *  Defaults to 'company-dd'. */
  initialTab?: TabKey;
}

export type TabKey = 'company-dd' | 'owner-kyc' | 'trade-licenses' | 'trade-documents' | 'shipment-agreements';

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

const groupOfTab = (t: TabKey): GroupKey => TABS.find(x => x.key === t)?.group ?? 'standard';

function buildDemoVault(consignee: ConsigneeVaultTarget): VaultData {
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
      { id: 1, name: 'Master Sales Agreement',  reference: 'MSA/CNGE/2024/001',  authority: consignee.company, issue_date: '01/04/2024', expiry: '31/03/2027', attachment: 'MSA.pdf',         status: 'Verified' },
      { id: 2, name: 'Purchase Order Framework', reference: 'POF/CNGE/2024/012', authority: consignee.company, issue_date: '15/04/2024', expiry: '14/04/2026', attachment: 'POFramework.pdf', status: 'Verified' },
      { id: 3, name: 'NDA & Confidentiality',    reference: 'NDA/CNGE/2025/003', authority: consignee.company, issue_date: '—',           expiry: '—',          attachment: 'NDA.pdf',         status: 'Pending' },
    ],
    shipment_agreements: [
      { id: 1, shipment_id: 'SHP-2026-00487', opportunity_id: 'OPP-107', customer: consignee.company,         country: consignee.country ?? 'India',
        due_dil: { ratio: '2/2', pct: 100 }, kyc: { ratio: '3/3', pct: 100 }, trade_lic: { ratio: '1/1', pct: 100 }, trade_docs: { ratio: '4/4', pct: 100 }, agreement: { ratio: '1/1', pct: 100 }, risk: 'Compliant', buyer_is_consignee: true },
      { id: 2, shipment_id: 'SHP-2026-00328', opportunity_id: 'OPP-028', customer: 'GreenHarvest Global Ltd',  country: 'United States',
        due_dil: { ratio: '0/2', pct: 0 },   kyc: { ratio: '0/4', pct: 0 },   trade_lic: { ratio: '0/1', pct: 0 },   trade_docs: { ratio: '0/4', pct: 0 },   agreement: { ratio: '0/1', pct: 0 },   risk: 'Medium', buyer_is_consignee: false },
      { id: 3, shipment_id: 'SHP-2026-00512', opportunity_id: 'OPP-134', customer: 'Eastern Harvest Co.',      country: 'UAE',
        due_dil: { ratio: '1/2', pct: 50 },  kyc: { ratio: '2/3', pct: 67 },  trade_lic: { ratio: '1/1', pct: 100 }, trade_docs: { ratio: '2/4', pct: 50 },  agreement: { ratio: '0/1', pct: 0 },   risk: 'Medium', buyer_is_consignee: true },
      { id: 4, shipment_id: 'SHP-2026-00601', opportunity_id: 'OPP-156', customer: 'International Buyer LLC',  country: 'UAE',
        due_dil: { ratio: '2/2', pct: 100 }, kyc: { ratio: '3/3', pct: 100 }, trade_lic: { ratio: '1/1', pct: 100 }, trade_docs: { ratio: '4/4', pct: 100 }, agreement: { ratio: '1/1', pct: 100 }, risk: 'Compliant', buyer_is_consignee: true },
    ],
    last_updated: '04/05/2026',
  };
}

export default function ConsigneeEvidenceVaultModal({ open, consignee, onClose, data, initialTab }: Props) {
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

  const [tab, setTab] = useState<TabKey>('company-dd');
  const [group, setGroup] = useState<GroupKey>('standard');
  // "Document Overview" popup — set to a group key to open the all-docs list.
  const [overview, setOverview] = useState<GroupKey | null>(null);
  const [shipmentFilter, setShipmentFilter] = useState<'all' | 'buyer-eq-consignee' | 'buyer-neq-consignee'>('all');

  /* Switch the active group and jump to its first sub-tab. */
  const selectGroup = (g: GroupKey) => {
    setGroup(g);
    const first = TABS.find(t => t.group === g);
    if (first) setTab(first.key);
  };
  const [exporting, setExporting] = useState(false);
  const kpiStripRef = useRef<HTMLDivElement | null>(null);
  const [kpiPaused, setKpiPaused] = useState(false);
  /* Live API payload — populated by the fetch effect below. Falls back
   * to the demo builder if the fetch fails or the consignee has no
   * db_id (unsaved record). */
  const [vaultLive, setVaultLive] = useState<VaultData | null>(null);
  const [loading, setLoading] = useState(false);
  /* Zoho Sign signature requests for this consignee — fetched in parallel
   * with the vault payload and merged into the Trade Documents tab as
   * "Signed" / "Pending" rows + a separate "Certificate of Completion"
   * row per completed request (matches the New_IDIMS_6.0 evidence panel). */
  const [signatureRows, setSignatureRows] = useState<SigReqRow[]>([]);
  /* Send-for-Signature launch state — when non-null, the Zoho Sign
   * wizard opens with these clm_trade_doc_library ids pre-checked. Driven
   * by the Trade Documents tab's per-row Send button. */
  const [sendDocIds, setSendDocIds] = useState<number[] | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  /* Init the active tab ONLY on open / customer / deep-link change — NOT on
   * onClose (fresh closure each parent render), so a background re-render no
   * longer snaps the user's tab back to the default. */
  useEffect(() => {
    if (!open) return;
    const startTab = initialTab ?? 'company-dd';
    setTab(startTab);
    setGroup(groupOfTab(startTab));
    setShipmentFilter('all');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, consignee?.db_id, initialTab]);

  /* Re-fetch helper — invoked after the Actions column re-uploads a
   * file so the row picks up the fresh attachment_url. */
  const reloadVault = useCallback(() => {
    if (!consignee?.db_id) return Promise.resolve();
    setLoading(true);
    return api.get(`/segment-uploads/consignee/${consignee.db_id}/vault`)
      .then(r => { setVaultLive((r.data?.data ?? null) as VaultData | null); })
      .catch(() => { /* swallow transient errors — previous state stays */ })
      .finally(() => setLoading(false));
  }, [consignee?.db_id]);

  /* Fetch the vault payload when the modal opens. Skips when (a) the
   * parent passed an override via `data` or (b) consignee has no
   * db_id. Failure leaves vaultLive at null and the demo path takes
   * over so the design review still has content. */
  useEffect(() => {
    if (!open || !consignee?.db_id || data) {
      setVaultLive(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    api.get(`/segment-uploads/consignee/${consignee.db_id}/vault`)
      .then(r => { if (!cancelled) setVaultLive((r.data?.data ?? null) as VaultData | null); })
      .catch(() => { if (!cancelled) setVaultLive(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, consignee?.db_id, data]);

  /* Re-fetch signature requests — used by the open-effect and after a
   * Send so the Trade Documents tab flips to "Pending"/"Signed" without
   * re-opening the vault. */
  const reloadSignatures = useCallback(() => {
    if (!consignee?.db_id) return Promise.resolve();
    return api.get('/clm/signature-requests', {
      params: { party_id: consignee.db_id, model_name: 'Consignee', sync: 1 },
    })
      .then(r => { setSignatureRows(Array.isArray(r.data?.data) ? (r.data.data as SigReqRow[]) : []); })
      .catch(() => { /* keep previous rows on transient failure */ });
  }, [consignee?.db_id]);

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

  /* Fetch signature requests for this consignee in parallel with the
   * vault. sync=true triggers a Zoho round-trip for any still-inprogress
   * rows so the vault reflects "Signed" the moment the recipient
   * finishes signing, not just on the next vault open. */
  useEffect(() => {
    if (!open || !consignee?.db_id) { setSignatureRows([]); return; }
    let cancelled = false;
    api.get('/clm/signature-requests', {
      params: { party_id: consignee.db_id, model_name: 'Consignee', sync: 1 },
    })
      .then(r => {
        if (cancelled) return;
        const rows = Array.isArray(r.data?.data) ? (r.data.data as SigReqRow[]) : [];
        setSignatureRows(rows);
      })
      .catch(() => { if (!cancelled) setSignatureRows([]); });
    return () => { cancelled = true; };
  }, [open, consignee?.db_id]);

  /* Auto-scroll the KPI ribbon — continuous one-way drift. Tiles
   * rendered twice, scrollLeft wraps invisibly at the halfway mark.
   * Pauses on hover/touch. */
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
      if (strip.scrollLeft >= half) strip.scrollLeft -= half;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [open, kpiPaused, tab]);

  const vault: VaultData | null = useMemo(() => {
    if (!consignee) return null;
    /* Priority: explicit `data` prop > live API > demo fallback. */
    const base = data ?? vaultLive ?? buildDemoVault(consignee);
    if (!base) return null;
    // Trade Documents tab = the party's expected trade docs (segment-rule
    // td, party-filtered to mirror the edit form) merged with their live
    // Zoho Sign status. Each row exposes Send-for-Signature; signed rows
    // also carry the signed PDF + certificate links.
    const sigRows            = signatureRequestsToVaultDocs(signatureRows);
    const baseSegmentTd      = (base.trade_documents ?? []) as VaultDoc[];
    const mergedTd           = mergeTradeDocuments(baseSegmentTd as any, sigRows, 'consignee') as unknown as VaultDoc[];
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
  }, [consignee, data, vaultLive, signatureRows]);

  /* Export All — builds a multi-sheet Excel workbook of every tab
   * in the vault (Company DD, Owner KYC, Trade Licenses, Trade
   * Documents, Shipment Agreements) plus a Summary sheet with the
   * KPI roll-ups + consignee meta. One workbook = one self-contained
   * compliance archive snapshot the user can email / file. */
  const handleExportAll = async () => {
    if (!vault || !consignee || exporting) return;
    setExporting(true);
    try {
      const fmtDate = (d?: string | null) => (d && d !== 'N/A') ? d : '';
      const docRow = (d: VaultDoc, i: number) => ({
        '#':                 i + 1,
        'Doc Code':          d.doc_code || '',
        'Document Name':     d.name || '',
        'Reference / Number': d.reference || '',
        'Issuing Authority': d.authority || '',
        'Issue Date':        fmtDate(d.issue_date),
        'Expiry':            fmtDate(d.expiry),
        'Status':            d.status || '',
        'Attachment':        d.attachment || '',
        'Attachment URL':    d.attachment_url || '',
      });
      const shipmentRow = (s: VaultShipmentRow, i: number) => ({
        '#':                  i + 1,
        'Shipment ID':        s.shipment_id || '',
        'Opportunity ID':     s.opportunity_id || '',
        'Customer':           s.customer || '',
        'Country':            s.country || '',
        'Due Diligence':      s.due_dil?.ratio || '',
        'KYC':                s.kyc?.ratio || '',
        'Trade Licence':      s.trade_lic?.ratio || '',
        'Trade Docs':         s.trade_docs?.ratio || '',
        'Agreement':          s.agreement?.ratio || '',
        'Risk':               s.risk || '',
        'Buyer = Consignee':  s.buyer_is_consignee ? 'Yes' : 'No',
      });

      const summary = [
        { Field: 'Consignee ID',          Value: consignee.id },
        { Field: 'Company',               Value: consignee.company },
        { Field: 'Linked Customer',       Value: consignee.customerId || '' },
        { Field: 'Risk',                  Value: consignee.risk || '' },
        { Field: 'Segment',               Value: consignee.segment || '' },
        { Field: 'Country',               Value: consignee.country || '' },
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
        // Empty buckets still get a sheet (with just the header row)
        // so the workbook structure matches what the modal shows —
        // an empty "Trade Documents" tab on screen → an empty sheet
        // in the file, not a missing sheet that confuses the recipient.
        const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ '#': '', 'Document Name': '(no records)' }]);
        XLSX.utils.book_append_sheet(wb, ws, name);
      };

      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary), 'Summary');
      append('Company Due Diligence', vault.company_dd.map(docRow));
      append('Owner KYC',             vault.owner_kyc.map(docRow));
      append('Trade Licenses',        vault.trade_licenses.map(docRow));
      append('Trade Documents',       vault.trade_documents.map(docRow));
      // Shipments have a different column set — build separately so
      // the doc-row mapper doesn't smuggle in null reference/authority
      // columns for shipment rows.
      const shipRows = vault.shipment_agreements.map(shipmentRow);
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.json_to_sheet(shipRows.length ? shipRows : [{ '#': '', 'Shipment ID': '(no records)' }]),
        'Shipment Agreements'
      );

      const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      const stamp = new Date().toISOString().slice(0, 10);
      const safeId = (consignee.id || 'consignee').replace(/[^A-Za-z0-9_-]/g, '_');
      saveAs(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
             `EvidenceVault_${safeId}_${stamp}.xlsx`);

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

  if (!open || !consignee || !vault) return null;

  const StatusPill = ({ s }: { s: VaultStatus }) => {
    const tone =
      s === 'Verified' ? { bg: '#dcfce7', fg: '#15803d', mark: '✓' }
      : s === 'Signed'   ? { bg: '#dbeafe', fg: '#1e40af', mark: '✓' }
      : s === 'Expiring' ? { bg: '#fef3c7', fg: '#92400e', mark: '⚠' }
      :                    { bg: '#fee2e2', fg: '#b91c1c', mark: '⌛' };
    return (
      <span className="cnev-pill" style={{ background: tone.bg, color: tone.fg }}>
        {tone.mark} {s}
      </span>
    );
  };

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

  /* Show the skeleton only on the FIRST load (live data not in yet, no
   * explicit data prop). Re-fetches keep the current content visible. */
  const showSkeleton = loading && !vaultLive && !data;

  return createPortal(
    <div className="cnev-overlay" role="dialog" aria-modal="true" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <style>{CNEV_CSS}</style>
      <div className="cnev-card" onMouseDown={(e) => e.stopPropagation()}>
        {/* ─── HEADER ─── */}
        <div className="cnev-header">
          <div className="cnev-header-bg" aria-hidden />
          <span className="cnev-header-orb" aria-hidden />
          <div className="cnev-header-content">
            <div className="cnev-header-left">
              <div className="cnev-vault-icon">
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="3" width="20" height="5" rx="1.5" />
                  <path d="M4 8v12a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V8" />
                  <line x1="10" y1="13" x2="14" y2="13" />
                  <line x1="10" y1="17" x2="14" y2="17" />
                </svg>
                <span className="cnev-vault-icon-tick" aria-hidden>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5"><polyline points="20 6 9 17 4 12" /></svg>
                </span>
              </div>
              <div className="cnev-header-text">
                <div className="cnev-header-eyebrow">— EVIDENCE VAULT</div>
                <div className="cnev-header-title">{consignee.company}</div>
                <div className="cnev-header-chips">
                  <span className="cnev-chip cnev-chip-id">● {consignee.id}</span>
                  {consignee.customerId && <span className="cnev-chip cnev-chip-link">↳ {consignee.customerId}</span>}
                  <span className="cnev-chip cnev-chip-risk" data-risk={(consignee.risk ?? 'Low').toLowerCase()}>● {consignee.risk ?? 'Low'} Risk</span>
                  {consignee.contact && (
                    <span className="cnev-chip cnev-chip-contact">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                      {consignee.contact}{consignee.contactCity ? ` · ${consignee.contactCity}` : ''}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div className="cnev-header-right">
              <div className="cnev-header-meta">
                {consignee.segment && <span>{consignee.segment}</span>}
                {consignee.country && <span>· {consignee.country}</span>}
              </div>
              <button type="button" className="cnev-close" onClick={onClose} aria-label="Close vault">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
          </div>
        </div>

        {showSkeleton ? <VaultSkeleton /> : (<>
        {/* ─── KPI STRIP ─── */}
        <div
          className="cnev-kpi-outer"
          onMouseEnter={() => setKpiPaused(true)}
          onMouseLeave={() => setKpiPaused(false)}
          onTouchStart={() => setKpiPaused(true)}
          onTouchEnd={() => setKpiPaused(false)}
        >
          <span className="cnev-kpi-fade cnev-kpi-fade-l" aria-hidden />
          <span className="cnev-kpi-fade cnev-kpi-fade-r" aria-hidden />
          <button
            type="button"
            className="cnev-kpi-nav cnev-kpi-nav-prev"
            aria-label="Scroll KPIs left"
            onClick={() => kpiStripRef.current?.scrollBy({ left: -260, behavior: 'smooth' })}
          >
            <i className="ri-arrow-left-s-line" />
          </button>
          <button
            type="button"
            className="cnev-kpi-nav cnev-kpi-nav-next"
            aria-label="Scroll KPIs right"
            onClick={() => kpiStripRef.current?.scrollBy({ left: 260, behavior: 'smooth' })}
          >
            <i className="ri-arrow-right-s-line" />
          </button>
          <div
            ref={kpiStripRef}
            className="cnev-kpi-strip"
            onWheel={(e) => {
              if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
                e.currentTarget.scrollLeft += e.deltaY;
              }
            }}
          >
          {[0, 1].map((cycle) => (
            <div key={cycle} className="cnev-kpi-cycle" aria-hidden={cycle === 1 ? true : undefined}>
              <KpiTile label="Total Documents"        value={vault.total_documents}        accent="#0e7490" />
              <KpiTile label="Verified / Signed"      value={vault.verified_signed}        accent="#16a34a" subtitle="✓ COMPLIANT" subTone="good" />
              <KpiTile label="Pending"                value={vault.pending}                accent="#dc2626" subtitle="⚠ ACTION"    subTone="bad" />
              <KpiTile label="Company Due Diligence"  value={vault.company_dd_count}       accent="#0891b2" />
              <KpiTile label="Owner KYC"              value={vault.owner_kyc_count}        accent="#0e7490" />
              <KpiTile label="Trade License"          value={vault.trade_license_count}    accent="#0891b2" />
              <KpiTile label="Trade Documents"        value={vault.trade_documents_count}  accent="#0d9488" />
              <KpiTile label="Total Shipments"        value={vault.total_shipments}        accent="#0c4a6e" />
            </div>
          ))}
          </div>
        </div>

        {/* ─── GROUP CARDS — Standard Documents vs Case to Case. */}
        <div className="cnev-groups-wrap">
          <div className="cnev-groups">
            {GROUPS.map(g => (
              <div key={g.key} className={`cnev-group ${group === g.key ? 'is-active' : ''}`}>
                <button
                  type="button"
                  className="cnev-group-main"
                  onClick={() => selectGroup(g.key)}
                >
                  <span className="cnev-group-icon"><i className={g.icon} aria-hidden /></span>
                  <span className="cnev-group-text">
                    <span className="cnev-group-title">{g.title}</span>
                    <span className="cnev-group-sub">{g.sub}</span>
                  </span>
                </button>
                <button
                  type="button"
                  className="cnev-group-overview"
                  onClick={() => setOverview(g.key)}
                  title="View all documents in one list"
                >
                  <i className="ri-list-check-2" aria-hidden /> Document Overview
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* ─── SUB-TABS — for the active group. */}
        <div className="cnev-tabs-wrap">
          <div className="cnev-tabs">
            {TABS.filter(t => t.group === group).map(t => (
              <button
                key={t.key}
                type="button"
                className={`cnev-tab ${tab === t.key ? 'is-active' : ''}`}
                onClick={() => setTab(t.key)}
              >
                <span className="cnev-tab-icon"><i className={t.icon} aria-hidden /></span>
                <span className="cnev-tab-label">{t.label}</span>
                <span className="cnev-tab-count">{vault[t.countKey] as number}</span>
              </button>
            ))}
          </div>
        </div>

        {/* ─── BODY ─── */}
        <div className="cnev-body">
          <div className="cnev-section">
            <div className="cnev-section-left">
              <div className="cnev-section-icon"><i className={tabMeta.icon} /></div>
              <div>
                <div className="cnev-section-title">{tabMeta.label}</div>
                <div className="cnev-section-sub">{sectionSub(tab)}</div>
              </div>
            </div>
            <div className="cnev-section-right">
              <div className="cnev-section-count">{(tab === 'shipment-agreements' || tab === 'trade-documents') ? vault.total_shipments : (vault[tabMeta.countKey] as number)}</div>
              <div className="cnev-section-count-label">{(tab === 'shipment-agreements' || tab === 'trade-documents') ? 'SHIPMENTS' : 'DOCUMENTS'}</div>
            </div>
          </div>

          {(tab === 'shipment-agreements' || tab === 'trade-documents')
            ? <ShipmentTable rows={vault.shipment_agreements} kind={tab === 'trade-documents' ? 'trade' : 'agreement'} filter={shipmentFilter} setFilter={setShipmentFilter} />
            : <DocsTable rows={docsForTab} tab={tab} ownerType="consignee" ownerId={consignee?.db_id ?? null} onReload={reloadVault}
                         onSendTradeDoc={(d) => { if (d.db_id) setSendDocIds([d.db_id]); }}
                         onRemindTradeDoc={handleRemind} />}
        </div>
        </>)}

        {/* ─── FOOTER ─── */}
        <div className="cnev-footer">
          <div className="cnev-footer-meta">
            Last updated: <b>{vault.last_updated}</b> · Vault managed by Compliance Team
          </div>
          <div className="cnev-footer-actions">
            <Tooltip label="Download every tab (Company DD, Owner KYC, Trade Licenses, Trade Documents, Shipments) as a single .xlsx workbook">
              <button
                type="button"
                className="cnev-btn cnev-btn-light"
                onClick={handleExportAll}
                disabled={exporting}
                style={exporting ? { opacity: 0.7, cursor: 'wait' } : undefined}
              >
                <i className={exporting ? 'ri-loader-4-line cnev-spin' : 'ri-download-cloud-2-line'} />
                {exporting ? 'Exporting…' : 'Export All'}
              </button>
            </Tooltip>
            <button type="button" className="cnev-btn cnev-btn-dark" onClick={onClose}>
              Close Vault
            </button>
          </div>
        </div>
      </div>

      {/* Send for Signature — launched from a Trade Documents row. The
          modal portals to <body>, so it overlays the vault cleanly. */}
      <SalesCustomerSendForSignatureModal
        open={Array.isArray(sendDocIds)}
        customer={consignee?.db_id ? {
          id:      consignee.id,
          db_id:   consignee.db_id,
          company: consignee.company,
          contact: consignee.contact,
        } : null}
        modelName="Consignee"
        preselectedDocIds={sendDocIds ?? undefined}
        onClose={() => setSendDocIds(null)}
        onSent={() => { setSendDocIds(null); void reloadSignatures(); }}
      />

      {/* Document Overview popup — all documents for the chosen group in one
          flat list (name + status + download). */}
      {overview && (() => {
        const isStd = overview === 'standard';
        const docs: VaultDoc[] = isStd
          ? [...vault.company_dd, ...vault.owner_kyc, ...vault.trade_licenses]
          : [...vault.trade_documents];
        const title = isStd ? 'Standard Documents — Overview' : 'Case to Case Agreements — Overview';
        const sub = isStd
          ? 'All Company Due Diligence, Owner KYC & Trade Licenses documents in one list'
          : 'All Trade Documents & Agreements for this consignee in one list';
        return (
          <div className="cnev-ov-overlay" role="dialog" aria-modal="true" onMouseDown={(e) => { if (e.target === e.currentTarget) setOverview(null); }}>
            <div className="cnev-ov-card">
              <div className="cnev-ov-head">
                <span className="cnev-ov-head-icon"><i className="ri-list-check-2" aria-hidden /></span>
                <div className="cnev-ov-head-text">
                  <div className="cnev-ov-title">{title}</div>
                  <div className="cnev-ov-sub">{sub}</div>
                </div>
                <button type="button" className="cnev-ov-close" onClick={() => setOverview(null)} aria-label="Close"><i className="ri-close-line" /></button>
              </div>
              <div className="cnev-ov-body">
                <table className="cnev-ov-table">
                  <thead><tr><th style={{ width: 48 }}>#</th><th>DOCUMENT NAME</th><th style={{ width: 130 }}>STATUS</th><th style={{ width: 130 }}>ACTION</th></tr></thead>
                  <tbody>
                    {docs.length === 0 ? (
                      <tr><td colSpan={4} className="cnev-ov-empty">No documents available.</td></tr>
                    ) : docs.map((d, i) => {
                      const url = d.attachment_url || null;
                      return (
                        <tr key={`${d.id}-${i}`}>
                          <td className="cnev-ov-num">{i + 1}</td>
                          <td className="cnev-ov-name">{d.name}</td>
                          <td><StatusPill s={d.status} /></td>
                          <td>
                            <button
                              type="button"
                              className="cnev-ov-dl"
                              disabled={!url}
                              onClick={() => { if (url) void downloadFile(url, d.attachment || `${d.name}.pdf`); }}
                            >
                              <i className="ri-download-2-line" aria-hidden /> Download
                            </button>
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
      })()}
    </div>,
    document.body
  );
}

function KpiTile({ label, value, accent, subtitle, subTone }: { label: string; value: number; accent?: string; subtitle?: string; subTone?: 'good' | 'bad' }) {
  /* Flat stat column (matches the CLM prototype): small uppercase label, a
     large tone-coloured number, and an optional status sub-line. */
  return (
    <div className="cnev-kpi-tile">
      <div className="cnev-kpi-label">{label.toUpperCase()}</div>
      <div className="cnev-kpi-value" style={accent ? { color: accent } : undefined}>{value.toLocaleString()}</div>
      {subtitle && <div className={`cnev-kpi-sub ${subTone === 'bad' ? 'is-bad' : 'is-good'}`}>{subtitle}</div>}
    </div>
  );
}

/* ─── Loading skeleton — shimmer placeholders for the whole vault body
   (KPI ribbon, group cards, tabs, section banner, table). Shown on first
   load instead of the demo fallback. */
function VaultSkeleton() {
  return (
    <div className="cnev-skel">
      <div className="cnev-skel-kpis">
        {Array.from({ length: 6 }).map((_, i) => <div key={i} className="cnev-skel-kpi cnev-sk" />)}
      </div>
      <div className="cnev-skel-groups">
        <div className="cnev-skel-group cnev-sk" />
        <div className="cnev-skel-group cnev-sk" />
      </div>
      <div className="cnev-skel-tabs">
        {Array.from({ length: 3 }).map((_, i) => <div key={i} className="cnev-skel-tab cnev-sk" />)}
      </div>
      <div className="cnev-skel-section cnev-sk" />
      <div className="cnev-skel-table">
        <div className="cnev-skel-thead cnev-sk" />
        {Array.from({ length: 6 }).map((_, i) => <div key={i} className="cnev-skel-row cnev-sk" />)}
      </div>
    </div>
  );
}

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
  const category: 'kyc' | 'dd' | 'tl' | 'td' = tab === 'company-dd' ? 'dd' : tab === 'owner-kyc' ? 'kyc' : tab === 'trade-licenses' ? 'tl' : 'td';
  return (
    <div className="cnev-table-wrap">
      <div className="cnev-table-scroll">
      <table className="cnev-table">
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
            <tr><td colSpan={6} className="cnev-empty">No documents in this bucket yet.</td></tr>
          ) : rows.map((d, i) => (
            <tr key={d.id}>
              <td>{i + 1}</td>
              <td className="cnev-doc-name">{d.name}</td>
              <td className="cnev-mono">{d.reference || '—'}</td>
              <td>{d.authority || '—'}</td>
              <td>
                {d.attachment ? (
                  d.attachment_url ? (
                    <Tooltip label={`Open ${d.attachment}`}>
                      <a href={d.attachment_url} target="_blank" rel="noreferrer" className="cnev-attach" style={{ textDecoration: 'none' }}>
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                        {d.attachment}
                      </a>
                    </Tooltip>
                  ) : (
                  <Tooltip label={d.attachment}>
                    <span className="cnev-attach">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                      {d.attachment}
                    </span>
                  </Tooltip>
                  )
                ) : <span className="cnev-muted">Not uploaded</span>}
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

function VaultRowActions({ doc, ownerType, ownerId, category, onReload, onSendTradeDoc, onRemindTradeDoc }: {
  doc: VaultDoc;
  ownerType: 'customer' | 'consignee' | 'supplier';
  ownerId: number | null;
  category: 'kyc' | 'dd' | 'tl' | 'td';
  onReload: () => Promise<void> | void;
  onSendTradeDoc?: (doc: VaultDoc) => void;
  onRemindTradeDoc?: (doc: VaultDoc) => void | Promise<void>;
}) {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [reminding, setReminding] = useState(false);
  const [trackerOpen, setTrackerOpen] = useState(false);
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
  // Signing activity tracker — available once a document has been sent for
  // signature (sent or signed), keyed off its signature request id.
  const canTrack  = !!doc.signature_request_id;

  const remind = async () => {
    if (!onRemindTradeDoc) return;
    setReminding(true);
    try { await onRemindTradeDoc(doc); } finally { setReminding(false); }
  };

  // Blob download so it works on the deployed server too (a plain <a download>
  // is ignored cross-origin / for inline-served files → opens instead of saving).
  const download = () => { void downloadFile(doc.attachment_url, doc.attachment); };

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
    <div className="cnev-row-actions">
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
            className="cnev-row-act cnev-row-act-send"
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
            className="cnev-row-act cnev-row-act-remind"
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
      {canTrack && (
        <Tooltip label="Signing activity tracker">
          <button
            type="button"
            onClick={() => setTrackerOpen(true)}
            className="cnev-row-act cnev-row-act-track"
            aria-label="Signing activity tracker"
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: 28, height: 28, borderRadius: 6,
              background: '#cffafe', color: '#0e7490', border: '1px solid #67e8f9',
              cursor: 'pointer',
            }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v5h5"/><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8"/><path d="M12 7v5l4 2"/></svg>
          </button>
        </Tooltip>
      )}
      {trackerOpen && doc.signature_request_id && (
        <SigningTrackerModal
          sigId={doc.signature_request_id}
          code={doc.doc_code || doc.name || `Doc #${doc.db_id ?? ''}`}
          onClose={() => setTrackerOpen(false)}
        />
      )}
      <Tooltip label={canViewOrDownload ? `View ${doc.attachment}` : 'No attachment yet'}>
        <a
          href={canViewOrDownload ? doc.attachment_url! : undefined}
          target={canViewOrDownload ? '_blank' : undefined}
          rel="noreferrer"
          aria-disabled={!canViewOrDownload}
          className={`cnev-row-act cnev-row-act-view ${!canViewOrDownload ? 'is-disabled' : ''}`}
          onClick={e => { if (!canViewOrDownload) e.preventDefault(); }}
          aria-label="View"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
        </a>
      </Tooltip>
      <Tooltip label={canViewOrDownload ? `Download ${doc.attachment}` : 'No attachment yet'}>
        <button
          type="button"
          aria-disabled={!canViewOrDownload}
          onClick={() => { if (canViewOrDownload) download(); }}
          className={`cnev-row-act cnev-row-act-download ${!canViewOrDownload ? 'is-disabled' : ''}`}
          aria-label="Download"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        </button>
      </Tooltip>
      {/* Upload / Re-upload is hidden on the Case-to-Case Trade Documents
          tab (category 'td') — those rows are driven by the signature
          flow (Send / Reminder / signed-file View), not manual file
          attachment. Standard tabs (KYC / DD / Trade Licenses) keep it. */}
      {category !== 'td' && (
      <Tooltip label={canReupload ? (busy ? 'Uploading…' : (doc.attachment ? 'Re-upload (replace file)' : 'Upload')) : 'Save the record first'}>
        <button
          type="button"
          aria-disabled={!canReupload || busy}
          onClick={() => { if (canReupload && !busy) fileRef.current?.click(); }}
          className={`cnev-row-act cnev-row-act-upload ${(!canReupload || busy) ? 'is-disabled' : ''}`}
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
          from a completed Zoho Sign request. Mirrors the faCertificate
          action in New_IDIMS_6.0's Stage3Tab2DocumentationArchive. */}
      {doc.certificate_url && (
        <Tooltip label="Certificate of Completion">
          <a
            href={doc.certificate_url}
            target="_blank"
            rel="noreferrer"
            className="cnev-row-act cnev-row-act-cert"
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

function ShipmentTable({ rows, kind, filter, setFilter }: {
  rows: VaultShipmentRow[];
  kind: 'trade' | 'agreement';
  filter: 'all' | 'buyer-eq-consignee' | 'buyer-neq-consignee';
  setFilter: (f: 'all' | 'buyer-eq-consignee' | 'buyer-neq-consignee') => void;
}) {
  const [openId, setOpenId] = useState<number | null>(null);
  const filtered = rows.filter(r =>
    filter === 'all' ? true
    : filter === 'buyer-eq-consignee' ? r.buyer_is_consignee
    : !r.buyer_is_consignee
  );
  const lastCol = kind === 'trade' ? 'Trade Docs' : 'Agreement';
  const COLS = 10;
  return (
    <>
      <div className="cnev-ship-filter">
        <button type="button" className={`cnev-ship-fbtn ${filter === 'all' ? 'is-active' : ''}`} onClick={() => setFilter('all')}>All Shipments</button>
        <button type="button" className={`cnev-ship-fbtn ${filter === 'buyer-eq-consignee' ? 'is-active' : ''}`} onClick={() => setFilter('buyer-eq-consignee')}>✓ Buyer = Consignee</button>
        <button type="button" className={`cnev-ship-fbtn ${filter === 'buyer-neq-consignee' ? 'is-active' : ''}`} onClick={() => setFilter('buyer-neq-consignee')}>✕ Buyer ≠ Consignee</button>
      </div>
      <div className="cnev-table-wrap">
        <div className="cnev-table-scroll">
        <table className="cnev-table">
          <thead>
            <tr>
              <th style={{ width: 34 }} />
              <th style={{ width: 46 }}>SR</th>
              <th>Shipment ID</th>
              <th>Opportunity ID</th>
              <th>Customer (Buyer)</th>
              <th>Consignee</th>
              <th>Due Dil.</th>
              <th>KYC</th>
              <th>Trade Lic.</th>
              <th>{lastCol}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={COLS} className="cnev-empty">No shipments match the filter.</td></tr>
            ) : filtered.map((r, i) => {
              const open = openId === r.id;
              return (
                <Fragment key={r.id}>
                  <tr style={{ cursor: 'pointer' }} onClick={() => setOpenId(open ? null : r.id)}>
                    <td style={{ textAlign: 'center' }}><span style={{ display: 'inline-block', transition: 'transform .18s', transform: open ? 'rotate(90deg)' : 'none', color: '#0891b2', fontWeight: 800 }}>▸</span></td>
                    <td>{i + 1}</td>
                    <td><span className="cnev-chip-pill">● {r.shipment_id}</span></td>
                    <td><span className="cnev-chip-pill cnev-chip-pill-warm">● {r.opportunity_id}</span></td>
                    <td>
                      <span className="cnev-cust-cell">
                        <span className="cnev-cust-mono">{r.customer.charAt(0)}</span>
                        {r.customer}
                      </span>
                    </td>
                    <td>
                      <span className="cnev-cust-cell">
                        <span className="cnev-cust-mono" style={{ background: 'linear-gradient(135deg,#0891b2,#06b6d4)' }}>{(r.consignee || '—').charAt(0)}</span>
                        {r.consignee || '—'}
                      </span>
                    </td>
                    <td><Ratio r={r.due_dil} /></td>
                    <td><Ratio r={r.kyc} /></td>
                    <td><Ratio r={r.trade_lic} /></td>
                    <td><Ratio r={kind === 'trade' ? r.trade_docs : r.agreement} /></td>
                  </tr>
                  {open && (
                    <tr>
                      <td colSpan={COLS} style={{ padding: 0, background: '#f0fdff' }}>
                        <ShipmentDocPanel
                          buyer={kind === 'trade' ? (r.trade_docs_buyer ?? []) : (r.agreements_buyer ?? [])}
                          consignee={kind === 'trade' ? (r.trade_docs_consignee ?? []) : (r.agreements_consignee ?? [])}
                          buyerName={r.customer}
                          consigneeName={r.consignee || '—'}
                          buyerIsConsignee={r.buyer_is_consignee}
                        />
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
    </>
  );
}

function Ratio({ r }: { r: { ratio: string; pct: number } }) {
  /* Compact SVG donut — 38px circle with ratio inside, hover-portal
   * tooltip with completion %. Self-contained so it stacks above
   * the modal overlay (z-index 11200) without relying on the global
   * Tooltip's stacking layer. */
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
    const W = 86, H = 50, gap = 8;
    let left = rect.left + rect.width / 2 - W / 2;
    let top  = rect.top - H - gap;
    if (top < 6) top = rect.bottom + gap;
    left = Math.max(6, Math.min(left, window.innerWidth - W - 6));
    setTip({ top, left });
  };
  const hideTip = () => setTip(null);

  return (
    <>
      <span
        ref={triggerRef}
        className="cnev-ratio"
        data-tone={tone}
        onMouseEnter={showTip}
        onMouseLeave={hideTip}
        onFocus={showTip}
        onBlur={hideTip}
        tabIndex={0}
      >
        <svg width="38" height="38" viewBox="0 0 38 38" aria-hidden>
          <circle className="cnev-ratio-track" cx="19" cy="19" r={radius} fill="none" strokeWidth="3.5" />
          <circle
            className="cnev-ratio-arc"
            cx="19" cy="19" r={radius}
            fill="none" strokeWidth="3.5"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            strokeLinecap="round"
            transform="rotate(-90 19 19)"
          />
        </svg>
        <span className="cnev-ratio-label">{r.ratio}</span>
      </span>
      {tip && createPortal(
        <div className="cnev-ratio-tip" style={{ top: tip.top, left: tip.left }} role="tooltip">
          <b className="cnev-ratio-tip-pct" data-tone={tone}>{r.pct}%</b>
          <span className="cnev-ratio-tip-meta">{r.ratio} · {status}</span>
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

/* ─── Scoped CSS — emerald palette to match the Sales → Consignee
   page (mint hero strip, emerald Add Consignee button, mint table
   header). Sibling Customer module owns the violet identity. */
const CNEV_CSS = `
.cnev-overlay {
  position: fixed; inset: 0;
  background: rgba(12,74,110,0.45);
  -webkit-backdrop-filter: blur(6px);
  backdrop-filter: blur(6px);
  z-index: 11200;
  display: flex; align-items: stretch; justify-content: flex-end;
  font-family: 'DM Sans','Inter',system-ui,-apple-system,sans-serif;
  animation: cnevFade .18s ease both;
}
@keyframes cnevFade { from { opacity: 0; } to { opacity: 1; } }
.cnev-card {
  position: relative;
  width: min(1280px, 90vw);
  height: 100vh;
  background: #f0fdff;
  border-radius: 0;
  overflow: hidden;
  display: flex; flex-direction: column;
  box-shadow: -32px 0 80px rgba(12,74,110,.40), -12px 0 30px rgba(12,74,110,.18);
  animation: cnevSlide .26s cubic-bezier(.22,1,.36,1) both;
}
@keyframes cnevSlide { from { transform: translateX(40px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }

/* ─── HEADER ─── */
.cnev-header {
  position: relative;
  flex-shrink: 0;
  padding: 14px 22px;
  background: linear-gradient(135deg, #0c4a6e 0%, #0e7490 35%, #0891b2 65%, #22d3ee 100%);
  color: #fff;
  overflow: hidden;
}
.cnev-header-bg {
  position: absolute; inset: 0;
  pointer-events: none;
  overflow: hidden;
  background:
    radial-gradient(circle at 100% 0%, rgba(165,243,252,0.32), transparent 45%),
    radial-gradient(circle at 0% 100%, rgba(103,232,249,0.30), transparent 55%);
}
.cnev-header-bg::before,
.cnev-header-bg::after {
  content: '';
  position: absolute;
  border-radius: 50%;
  background: radial-gradient(circle at 30% 30%, rgba(255,255,255,0.22), rgba(255,255,255,0.06) 60%, transparent 75%);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.18);
}
.cnev-header-bg::before { width: 220px; height: 220px; top: -80px; right: -40px; }
.cnev-header-bg::after  { width: 130px; height: 130px; bottom: -45px; right: 130px;
  background: radial-gradient(circle at 30% 30%, rgba(103,232,249,0.30), rgba(103,232,249,0.06) 60%, transparent 75%); }
.cnev-header-orb {
  position: absolute;
  width: 90px; height: 90px;
  top: 8px; right: 220px;
  border-radius: 50%;
  background: radial-gradient(circle at 30% 30%, rgba(255,255,255,0.18), rgba(255,255,255,0.04) 60%, transparent 75%);
  pointer-events: none;
}
.cnev-header-content {
  position: relative;
  display: flex; align-items: center; justify-content: space-between; gap: 20px;
}
.cnev-header-left { display: flex; align-items: center; gap: 12px; min-width: 0; }
.cnev-vault-icon {
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
.cnev-vault-icon-tick {
  position: absolute; top: -3px; right: -3px;
  width: 18px; height: 18px; border-radius: 50%;
  background: #67e8f9; color: #0c4a6e;
  display: inline-flex; align-items: center; justify-content: center;
  border: 2px solid #0e7490;
}
.cnev-header-text { min-width: 0; }
.cnev-header-eyebrow { font-size: 9.5px; font-weight: 700; letter-spacing: .12em; color: rgba(255,255,255,.78); margin-bottom: 2px; }
.cnev-header-title { font-size: 18px; font-weight: 800; letter-spacing: -0.01em; line-height: 1.15; margin-bottom: 6px; color: #fff; }
.cnev-header-chips { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.cnev-chip { display: inline-flex; align-items: center; gap: 5px; padding: 3px 9px; border-radius: 999px; font-size: 10.5px; font-weight: 600; background: rgba(255,255,255,0.16); border: 1px solid rgba(255,255,255,0.24); color: #ecfeff; }
.cnev-chip-id { background: rgba(255,255,255,0.20); }
.cnev-chip-link { background: rgba(255,255,255,0.14); color: #cffafe; }
.cnev-chip-risk[data-risk="low"]      { background: rgba(8,145,178,0.30); color: #ecfeff; }
.cnev-chip-risk[data-risk="medium"]   { background: rgba(245,158,11,0.30); color: #fef3c7; }
.cnev-chip-risk[data-risk="high"]     { background: rgba(239,68,68,0.30);  color: #fee2e2; }
.cnev-chip-risk[data-risk="critical"] { background: rgba(220,38,38,0.40);  color: #fee2e2; }

.cnev-header-right { display: flex; align-items: center; gap: 12px; flex-shrink: 0; }
.cnev-header-meta { font-size: 11px; color: rgba(255,255,255,.84); display: inline-flex; gap: 4px; align-items: center; }
.cnev-header-meta span { white-space: nowrap; }
.cnev-close {
  width: 28px; height: 28px; border-radius: 50%;
  display: inline-flex; align-items: center; justify-content: center;
  background: rgba(255,255,255,0.18); color: #fff; border: 1px solid rgba(255,255,255,0.28);
  cursor: pointer; transition: all .15s;
  flex-shrink: 0;
}
.cnev-close:hover { background: rgba(255,255,255,0.30); transform: rotate(90deg); }

/* ─── KPI STRIP ─── */
.cnev-kpi-outer {
  position: relative;
  flex-shrink: 0;
  background: linear-gradient(180deg, #f0fdff 0%, #ecfeff 100%);
  border-bottom: 1px solid #cffafe;
}
.cnev-kpi-strip {
  display: flex; gap: 12px; align-items: stretch;
  padding: 14px 64px;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
  -ms-overflow-style: none;
  scroll-behavior: smooth;
}
.cnev-kpi-strip::-webkit-scrollbar { display: none; }
.cnev-kpi-cycle {
  display: flex; gap: 12px; align-items: stretch;
  flex-shrink: 0;
  margin-right: 12px;
}
.cnev-kpi-cycle:last-child { margin-right: 0; }
.cnev-kpi-fade {
  position: absolute;
  top: 0; bottom: 0;
  width: 70px;
  pointer-events: none;
  z-index: 3;
}
.cnev-kpi-fade-l { left: 0;  background: linear-gradient(90deg,  #f0fdff 0%, #f0fdff 25%, rgba(240,253,255,0) 100%); }
.cnev-kpi-fade-r { right: 0; background: linear-gradient(270deg, #ecfeff 0%, #ecfeff 25%, rgba(236,254,255,0) 100%); }
.cnev-kpi-nav {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  z-index: 5;
  width: 34px; height: 34px;
  border-radius: 50%;
  border: none;
  background: linear-gradient(135deg, #ffffff 0%, #ecfeff 100%);
  color: #0e7490;
  display: inline-flex; align-items: center; justify-content: center;
  cursor: pointer;
  box-shadow:
    0 2px 6px rgba(8,145,178,0.18),
    0 8px 22px rgba(12,74,110,0.18),
    inset 0 0 0 1px rgba(8,145,178,0.20);
  transition: all .18s ease;
  font-size: 18px;
}
.cnev-kpi-nav:hover {
  background: linear-gradient(135deg, #0e7490, #06b6d4);
  color: #fff;
  transform: translateY(-50%) scale(1.10);
  box-shadow:
    0 4px 10px rgba(8,145,178,0.30),
    0 10px 26px rgba(8,145,178,0.45);
}
.cnev-kpi-nav:active { transform: translateY(-50%) scale(0.96); }
.cnev-kpi-nav-prev { left: 14px; }
.cnev-kpi-nav-next { right: 14px; }
.cnev-kpi-tile {
  position: relative;
  flex: 0 0 168px;
  background: var(--vz-card-bg, #fff);
  border: 1px solid rgba(8,145,178,0.14);
  border-radius: 12px;
  padding: 12px 16px;
  box-shadow: 0 1px 5px rgba(12,74,110,0.05);
  overflow: hidden;
  min-width: 0;
  transition: transform 180ms ease, box-shadow 220ms ease, border-color 180ms ease;
}
.cnev-kpi-tile:hover {
  transform: translateY(-1px);
  box-shadow: 0 6px 18px rgba(12,74,110,0.10);
  border-color: rgba(8,145,178,0.30);
}
.cnev-kpi-strip-top { position: absolute; top: 0; left: 0; right: 0; height: 3px; }
.cnev-kpi-body { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.cnev-kpi-text { min-width: 0; }
.cnev-kpi-label {
  font-size: 10.5px; font-weight: 700; letter-spacing: .06em;
  color: var(--vz-secondary-color, #6b7280);
  text-transform: uppercase;
  margin-bottom: 6px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.cnev-kpi-value {
  font-size: 26px; font-weight: 800; line-height: 1.05;
  color: var(--vz-heading-color, #0c4a6e);
}
.cnev-kpi-sub {
  margin-top: 5px;
  font-size: 9.5px; font-weight: 800; letter-spacing: .04em; text-transform: uppercase;
}
.cnev-kpi-sub.is-good { color: #16a34a; }
.cnev-kpi-sub.is-bad  { color: #dc2626; }
.cnev-kpi-icon {
  width: 38px; height: 38px; border-radius: 10px;
  display: inline-flex; align-items: center; justify-content: center;
  color: #fff;
  font-size: 18px;
  flex-shrink: 0;
  box-shadow: 0 4px 10px rgba(0,0,0,0.10);
}

/* ─── TABS ─── */
/* ─── GROUP CARDS — Standard Documents vs Case to Case (green variant). */
.cnev-groups-wrap {
  flex-shrink: 0;
  background: linear-gradient(180deg, #f0fdff 0%, #ecfeff 100%);
  padding: 14px 18px 0;
}
.cnev-groups { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.cnev-group {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 13px 18px;
  background: #ffffff;
  border: 1.5px solid #cffafe;
  border-radius: 14px;
  text-align: left;
  transition: all .2s ease;
}
.cnev-group:hover { border-color: #67e8f9; background: #f0fdff; }
.cnev-group-main {
  flex: 1; min-width: 0;
  display: flex; align-items: center; gap: 14px;
  background: transparent; border: 0; padding: 0; cursor: pointer;
  text-align: left; font-family: inherit;
}
.cnev-group-overview {
  flex-shrink: 0;
  display: inline-flex; align-items: center; gap: 6px;
  padding: 7px 13px; border-radius: 9px;
  background: #ecfeff; color: #0e7490; border: 1.5px solid #a5f3fc;
  font-family: inherit; font-size: 11.5px; font-weight: 700; cursor: pointer;
  white-space: nowrap; transition: all .18s ease;
}
.cnev-group-overview:hover { background: #fff; border-color: #06b6d4; color: #0891b2; transform: translateY(-1px); box-shadow: 0 4px 12px rgba(8,145,178,.22); }
.cnev-group-overview i { font-size: 14px; }
.cnev-group.is-active .cnev-group-overview { background: rgba(255,255,255,.16); color: #fff; border-color: rgba(255,255,255,.35); }
.cnev-group.is-active .cnev-group-overview:hover { background: #fff; color: #0891b2; border-color: #fff; }

/* ─── Document Overview popup ─── */
.cnev-ov-overlay {
  position: fixed; inset: 0; z-index: 11400;
  background: rgba(8,51,68,.45); -webkit-backdrop-filter: blur(4px); backdrop-filter: blur(4px);
  display: flex; align-items: center; justify-content: center; padding: 24px;
}
.cnev-ov-card {
  width: min(760px, 96vw); max-height: 86vh;
  background: #fff; border-radius: 16px; overflow: hidden;
  display: flex; flex-direction: column;
  box-shadow: 0 30px 80px rgba(8,51,68,.45);
}
.cnev-ov-head {
  display: flex; align-items: center; gap: 14px; padding: 16px 20px;
  background: linear-gradient(120deg, #083344 0%, #0c4a6e 30%, #0e7490 65%, #0891b2 100%);
  color: #fff; flex-shrink: 0;
}
.cnev-ov-head-icon {
  width: 40px; height: 40px; border-radius: 11px; flex-shrink: 0;
  display: inline-flex; align-items: center; justify-content: center;
  background: rgba(255,255,255,.16); border: 1px solid rgba(255,255,255,.22); font-size: 19px;
}
.cnev-ov-head-text { flex: 1; min-width: 0; }
.cnev-ov-title { font-size: 16px; font-weight: 800; letter-spacing: -.01em; }
.cnev-ov-sub { font-size: 11.5px; font-weight: 500; color: rgba(255,255,255,.82); margin-top: 2px; }
.cnev-ov-close {
  width: 34px; height: 34px; border-radius: 50%; flex-shrink: 0;
  border: 1px solid rgba(255,255,255,.25); background: rgba(255,255,255,.12); color: #fff;
  cursor: pointer; font-size: 18px; display: inline-flex; align-items: center; justify-content: center;
  transition: all .15s ease;
}
.cnev-ov-close:hover { background: rgba(255,255,255,.25); }
.cnev-ov-body { overflow: auto; padding: 14px 18px 18px; }
.cnev-ov-table { width: 100%; border-collapse: separate; border-spacing: 0; font-size: 13px; }
.cnev-ov-table thead th {
  position: sticky; top: 0; background: #083344; color: #fff;
  font-size: 10px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase;
  padding: 10px 12px; text-align: left; white-space: nowrap;
}
.cnev-ov-table thead th:first-child { border-radius: 8px 0 0 8px; }
.cnev-ov-table thead th:last-child  { border-radius: 0 8px 8px 0; }
.cnev-ov-table tbody td { padding: 11px 12px; border-bottom: 1px solid #e6f7fb; vertical-align: middle; }
.cnev-ov-table tbody tr:hover td { background: #f0fdff; }
.cnev-ov-num { color: #5e94a1; font-weight: 700; }
.cnev-ov-name { font-weight: 700; color: #0a2630; }
.cnev-ov-empty { text-align: center; color: #5e94a1; padding: 28px 12px !important; font-weight: 600; }
.cnev-ov-dl {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 5px 12px; border-radius: 7px;
  background: #ecfeff; color: #0e7490; border: 1.5px solid #a5f3fc;
  font-family: inherit; font-size: 11.5px; font-weight: 700; cursor: pointer; transition: all .15s ease;
}
.cnev-ov-dl:hover:not(:disabled) { background: #fff; border-color: #06b6d4; color: #0891b2; }
.cnev-ov-dl:disabled { opacity: .45; cursor: not-allowed; }
[data-bs-theme="dark"] .cnev-ov-card { background: #0a2630; }
[data-bs-theme="dark"] .cnev-ov-table tbody td { border-bottom-color: rgba(8,145,178,.18); color: #cffafe; }
[data-bs-theme="dark"] .cnev-ov-name { color: #e6f7fb; }
[data-bs-theme="dark"] .cnev-ov-table tbody tr:hover td { background: rgba(8,145,178,.10); }
.cnev-group.is-active {
  background: linear-gradient(120deg, #0c4a6e 0%, #0e7490 55%, #06b6d4 100%);
  border-color: #0e7490;
  box-shadow: 0 6px 18px rgba(8,145,178,.35);
}
.cnev-group-icon {
  width: 42px; height: 42px; flex-shrink: 0;
  display: inline-flex; align-items: center; justify-content: center;
  border-radius: 12px;
  background: #cffafe; color: #0e7490; border: 1px solid #a5f3fc;
  font-size: 20px;
}
.cnev-group.is-active .cnev-group-icon { background: rgba(255,255,255,.18); color: #fff; border-color: rgba(255,255,255,.25); }
.cnev-group-text { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.cnev-group-title { font-size: 15px; font-weight: 800; color: #0c4a6e; letter-spacing: -.01em; }
.cnev-group.is-active .cnev-group-title { color: #ffffff; }
.cnev-group-sub { font-size: 10.5px; font-weight: 700; letter-spacing: .06em; color: #6b9e85; }
.cnev-group.is-active .cnev-group-sub { color: rgba(255,255,255,.8); }

.cnev-tabs-wrap {
  flex-shrink: 0;
  background: linear-gradient(180deg, #f0fdff 0%, #ecfeff 100%);
  border-bottom: 1px solid #cffafe;
  padding: 12px 18px;
}
.cnev-tabs {
  display: flex; gap: 8px;
  overflow-x: auto;
  scrollbar-width: none;
  padding-bottom: 2px;
}
.cnev-tabs::-webkit-scrollbar { display: none; }
/* Tab pill — restyled to match AddCustomerModal's .acm-tab (Stage 1
 * Customer Identification pill). Clean rounded-rectangle pill +
 * solid 1.5px border + single-stop gradient on active. Icons and
 * count badges kept (functionality preserved) but the icon circle's
 * heavy gradient background was dropped so the icon sits inline
 * with the label instead of looking like a stuck-on chip. Green
 * palette stays — this is the consignee variant. */
.cnev-tab {
  flex: 0 0 auto;
  position: relative;
  display: inline-flex; align-items: center; gap: 8px;
  padding: 8px 16px;
  background: #ffffff;
  border: 1.5px solid #67e8f9;
  border-radius: 12px;
  color: #0e7490;
  font-size: 12.5px; font-weight: 700;
  cursor: pointer;
  transition: all .2s ease;
  white-space: nowrap;
}
.cnev-tab-icon {
  width: 18px; height: 18px;
  display: inline-flex; align-items: center; justify-content: center;
  background: transparent;
  color: #0e7490;
  font-size: 15px;
  flex-shrink: 0;
  transition: color .18s ease;
}
.cnev-tab-label { white-space: nowrap; }
.cnev-tab:hover {
  background: #ecfeff;
  border-color: #06b6d4;
  color: #0c4a6e;
}
.cnev-tab:hover .cnev-tab-icon { color: #0c4a6e; }
.cnev-tab.is-active {
  background: linear-gradient(135deg, #06b6d4, #0e7490);
  border-color: #06b6d4;
  color: #ffffff;
  box-shadow: 0 3px 10px rgba(8,145,178,.35);
}
.cnev-tab.is-active .cnev-tab-icon { color: #ffffff; }
.cnev-tab-count {
  background: #cffafe; color: #0e7490;
  font-size: 10.5px; font-weight: 800; letter-spacing: 0.02em;
  padding: 2px 8px; border-radius: 999px;
  min-width: 22px; text-align: center;
  transition: all .18s ease;
}
.cnev-tab.is-active .cnev-tab-count {
  background: rgba(255,255,255,0.28);
  color: #ffffff;
}

/* ─── BODY ─── */
.cnev-body {
  flex: 1; min-height: 0; overflow-y: auto;
  padding: 18px 24px 22px;
  display: flex; flex-direction: column; gap: 14px;
  /* Match the visible scrollbar pattern used by [[AddVendorModal]]'s
     .avm-body so the rail is obvious when a tab's table grows past
     the body. Solid emerald replaces the prior near-invisible rgba(.30). */
  scrollbar-width: thin; scrollbar-color: #67e8f9 transparent;
}
.cnev-body::-webkit-scrollbar { width: 8px; }
.cnev-body::-webkit-scrollbar-thumb { background: #67e8f9; border-radius: 99px; }
.cnev-body::-webkit-scrollbar-thumb:hover { background: #06b6d4; }

.cnev-section {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 14px 18px;
  background: linear-gradient(110deg, #ecfeff, #cffafe 70%, #a5f3fc);
  border: 1px solid rgba(8,145,178,.18);
  border-radius: 14px;
}
.cnev-section-left { display: flex; align-items: center; gap: 12px; min-width: 0; }
.cnev-section-icon {
  width: 38px; height: 38px; border-radius: 10px;
  background: linear-gradient(135deg, #06b6d4, #0e7490);
  color: #fff;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 18px;
  box-shadow: 0 4px 12px rgba(8,145,178,.30);
}
.cnev-section-title { font-size: 15px; font-weight: 800; color: #0c4a6e; }
.cnev-section-sub   { font-size: 12px; color: #0e7490; margin-top: 1px; }
.cnev-section-right { text-align: right; }
.cnev-section-count { font-size: 26px; font-weight: 800; color: #0c4a6e; line-height: 1; }
.cnev-section-count-label { font-size: 9.5px; font-weight: 700; letter-spacing: .12em; color: #0e7490; margin-top: 2px; }

.cnev-filter-row { display: flex; gap: 8px; flex-wrap: wrap; }
.cnev-filter { display: inline-flex; align-items: center; gap: 6px; padding: 5px 12px; border-radius: 999px; font-size: 11.5px; font-weight: 700; border: 1px solid transparent; }
.cnev-filter-verified { background: #dcfce7; color: #15803d; border-color: rgba(21,128,61,.30); }
.cnev-filter-expiring { background: #fef3c7; color: #92400e; border-color: rgba(217,119,6,.30); }
.cnev-filter-pending  { background: #fee2e2; color: #b91c1c; border-color: rgba(239,68,68,.30); }

.cnev-table-wrap {
  background: #fff;
  border: 1px solid rgba(8,145,178,.18);
  border-radius: 14px;
  overflow: hidden;
  scrollbar-width: thin;
  position: relative;
  /* Don't let the flex column body squash this wrap below its
     intrinsic height — without this, extra rows can be clipped at
     the bottom and .cnev-body's overflow-y never trips, so the user
     has no scrollbar to reach hidden documents. */
  flex-shrink: 0;
}
.cnev-section { flex-shrink: 0; }
.cnev-table-scroll {
  overflow-x: auto;
  overflow-y: visible;
  scrollbar-width: thin;
}
.cnev-table-scroll::-webkit-scrollbar { width: 8px; height: 8px; }
.cnev-table-scroll::-webkit-scrollbar-thumb { background: rgba(8,145,178,.30); border-radius: 999px; }
.cnev-table-scroll::-webkit-scrollbar-thumb:hover { background: rgba(8,145,178,.55); }
.cnev-table { width: 100%; min-width: 980px; border-collapse: separate; border-spacing: 0; font-size: 13px; }
.cnev-table thead th {
  position: sticky; top: 0;
  z-index: 3;
  padding: 9px 14px;
  text-align: left;
  background:
    linear-gradient(180deg, #ecfeff 0%, #cffafe 55%, #a5f3fc 100%);
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,0.65),
    inset 0 -1px 0 rgba(8,145,178,0.25),
    0 4px 10px -8px rgba(8,145,178,0.30);
  font-size: 10.5px; font-weight: 800; letter-spacing: .08em;
  color: #0e7490; text-transform: uppercase;
  white-space: nowrap;
}
.cnev-table tbody td { padding: 13px 14px; border-bottom: 1px solid #ecfeff; vertical-align: middle; }
.cnev-table tbody tr:last-child td { border-bottom: none; }
.cnev-table tbody tr:hover td { background: #f0fdff; }
.cnev-doc-name { font-weight: 700; color: #0c4a6e; }
.cnev-mono { font-family: 'JetBrains Mono','SF Mono',ui-monospace,monospace; font-size: 12px; color: #1f2937; }
.cnev-empty { padding: 30px !important; text-align: center; color: #94a3b8; font-style: italic; }
/* ─── Loading skeleton (shimmer) — emerald-tinted to match the consignee theme. */
.cnev-skel { flex: 1; min-height: 0; overflow: hidden; padding: 16px 22px; display: flex; flex-direction: column; gap: 16px; }
.cnev-sk { position: relative; overflow: hidden; background: #cffafe; border-radius: 12px; }
.cnev-sk::after { content: ''; position: absolute; inset: 0; transform: translateX(-100%); background: linear-gradient(90deg, transparent, rgba(255,255,255,.7), transparent); animation: cnevShimmer 1.3s ease-in-out infinite; }
@keyframes cnevShimmer { 100% { transform: translateX(100%); } }
.cnev-skel-kpis { display: flex; gap: 12px; }
.cnev-skel-kpi { flex: 1; height: 74px; }
.cnev-skel-groups { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.cnev-skel-group { height: 60px; }
.cnev-skel-tabs { display: flex; gap: 10px; }
.cnev-skel-tab { width: 190px; height: 40px; border-radius: 999px; }
.cnev-skel-section { height: 66px; }
.cnev-skel-table { display: flex; flex-direction: column; gap: 10px; }
.cnev-skel-thead { height: 38px; }
.cnev-skel-row { height: 46px; border-radius: 10px; }
[data-bs-theme="dark"] .cnev-sk { background: rgba(8,145,178,.14); }
[data-bs-theme="dark"] .cnev-sk::after { background: linear-gradient(90deg, transparent, rgba(255,255,255,.10), transparent); }
.cnev-muted { color: #94a3b8; font-style: italic; font-size: 12px; }

.cnev-date {
  display: inline-block;
  font-size: 11.5px; font-weight: 600;
  padding: 3px 9px; border-radius: 6px;
  background: #ecfeff; color: #0e7490;
}
.cnev-date-expiry[data-status="expiring"] { background: #fef3c7; color: #92400e; }
.cnev-date-expiry[data-status="pending"]  { background: #fee2e2; color: #b91c1c; }

.cnev-attach {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 3px 9px; border-radius: 6px;
  background: #cffafe; color: #0e7490;
  font-size: 11.5px; font-weight: 600;
  border: 1px solid rgba(8,145,178,.30);
}

/* Row Actions — View / Download / Re-upload icons. */
.cnev-row-actions { display: inline-flex; align-items: center; gap: 6px; }
.cnev-row-act {
  width: 28px; height: 28px; border-radius: 7px;
  display: inline-flex; align-items: center; justify-content: center;
  border: 1px solid transparent; background: transparent;
  cursor: pointer; text-decoration: none;
  transition: background .15s ease, border-color .15s ease, color .15s ease, transform .15s ease;
}
.cnev-row-act-view     { color: #2563eb; background: rgba(37,99,235,.08);  border-color: rgba(37,99,235,.20); }
.cnev-row-act-view:hover:not(.is-disabled)     { background: rgba(37,99,235,.18); transform: translateY(-1px); }
.cnev-row-act-download { color: #0891b2; background: rgba(8,145,178,.08);  border-color: rgba(8,145,178,.20); }
.cnev-row-act-download:hover:not(.is-disabled) { background: rgba(8,145,178,.18); transform: translateY(-1px); }
.cnev-row-act-upload   { color: #0e7490; background: rgba(8,145,178,.10); border-color: rgba(8,145,178,.30); }
.cnev-row-act-upload:hover:not(.is-disabled)   { background: rgba(8,145,178,.20); transform: translateY(-1px); }
.cnev-row-act.is-disabled, .cnev-row-act:disabled { opacity: .45; cursor: not-allowed; pointer-events: none; }
/* Dark mode — lift the action-button fills + icon colours. Send / Reminder /
 * Certificate set colours inline, so those need !important. */
[data-bs-theme="dark"] .cnev-row-act-view     { color: #93c5fd; background: rgba(59,130,246,.16); border-color: rgba(59,130,246,.34); }
[data-bs-theme="dark"] .cnev-row-act-view:hover:not(.is-disabled)     { background: rgba(59,130,246,.28); }
[data-bs-theme="dark"] .cnev-row-act-download { color: #67e8f9; background: rgba(8,145,178,.18); border-color: rgba(8,145,178,.36); }
[data-bs-theme="dark"] .cnev-row-act-download:hover:not(.is-disabled) { background: rgba(8,145,178,.30); }
[data-bs-theme="dark"] .cnev-row-act-upload   { color: #67e8f9; background: rgba(8,145,178,.18); border-color: rgba(8,145,178,.38); }
[data-bs-theme="dark"] .cnev-row-act-upload:hover:not(.is-disabled)   { background: rgba(8,145,178,.30); }
[data-bs-theme="dark"] .cnev-row-act-send   { background: rgba(8,145,178,.22) !important; color: #67e8f9 !important; border-color: rgba(8,145,178,.42) !important; }
[data-bs-theme="dark"] .cnev-row-act-remind { background: rgba(245,158,11,.20) !important; color: #fcd34d !important; border-color: rgba(245,158,11,.42) !important; }
[data-bs-theme="dark"] .cnev-row-act-cert   { background: rgba(8,145,178,.22) !important; color: #67e8f9 !important; border-color: rgba(8,145,178,.42) !important; }

.cnev-pill {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 3px 10px; border-radius: 999px;
  font-size: 11px; font-weight: 700;
}
.cnev-risk-compliant { background: #dcfce7; color: #15803d; }
.cnev-risk-medium    { background: #fef3c7; color: #92400e; }
.cnev-risk-high      { background: #fee2e2; color: #b91c1c; }

.cnev-chip-pill { display: inline-flex; align-items: center; gap: 4px; padding: 3px 9px; border-radius: 6px; background: #cffafe; color: #0e7490; font-size: 11.5px; font-weight: 700; border: 1px solid rgba(8,145,178,.30); font-family: 'JetBrains Mono', ui-monospace, monospace; }
.cnev-chip-pill-warm { background: #fef3c7; color: #92400e; border-color: rgba(217,119,6,.30); }
.cnev-cust-cell { display: inline-flex; align-items: center; gap: 8px; }
.cnev-cust-mono {
  width: 26px; height: 26px; border-radius: 50%;
  display: inline-flex; align-items: center; justify-content: center;
  background: linear-gradient(135deg, #06b6d4, #0e7490); color: #fff;
  font-size: 11.5px; font-weight: 800;
  flex-shrink: 0;
}

/* Compact donut + portal tooltip */
.cnev-ratio {
  position: relative;
  display: inline-flex; align-items: center; justify-content: center;
  width: 38px; height: 38px;
  line-height: 1;
}
.cnev-ratio svg { display: block; transition: filter .2s ease; }
.cnev-ratio:hover svg { filter: drop-shadow(0 2px 6px rgba(12,74,110,0.20)); }
.cnev-ratio-track { stroke: #cffafe; }
.cnev-ratio-arc {
  transition: stroke-dashoffset .6s cubic-bezier(.22,1,.36,1), stroke .2s ease;
}
.cnev-ratio[data-tone="good"] .cnev-ratio-arc { stroke: #16a34a; }
.cnev-ratio[data-tone="mid"]  .cnev-ratio-arc { stroke: #f59e0b; }
.cnev-ratio[data-tone="bad"]  .cnev-ratio-arc { stroke: #dc2626; }
.cnev-ratio-label {
  position: absolute; inset: 0;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 10.5px; font-weight: 800; letter-spacing: -0.02em;
  color: #0c4a6e;
  font-family: 'JetBrains Mono','SF Mono',ui-monospace,monospace;
}
.cnev-ratio[data-tone="good"] .cnev-ratio-label { color: #0e7490; }
.cnev-ratio[data-tone="mid"]  .cnev-ratio-label { color: #b45309; }
.cnev-ratio[data-tone="bad"]  .cnev-ratio-label { color: #b91c1c; }

.cnev-ratio-tip {
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
  animation: cnevTipPop .18s cubic-bezier(0.34, 1.56, 0.64, 1) both;
}
@keyframes cnevTipPop {
  0%   { opacity: 0; transform: translateY(4px) scale(0.92); }
  100% { opacity: 1; transform: translateY(0) scale(1); }
}
/* Spinner used by the Export All button while the XLSX workbook is
 * being built. Class-scoped to .cnev-spin so it does not collide
 * with any global ri-spin rule the project may add later. */
.cnev-spin { display: inline-block; animation: cnevSpin .8s linear infinite; }
@keyframes cnevSpin {
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
}
.cnev-ratio-tip-pct {
  font-size: 15px; font-weight: 800; letter-spacing: -0.01em;
  font-family: 'JetBrains Mono','SF Mono',ui-monospace,monospace;
  color: #ffffff;
}
.cnev-ratio-tip-pct[data-tone="good"] { color: #67e8f9; }
.cnev-ratio-tip-pct[data-tone="mid"]  { color: #fcd34d; }
.cnev-ratio-tip-pct[data-tone="bad"]  { color: #fca5a5; }
.cnev-ratio-tip-meta {
  font-size: 10px; font-weight: 600; letter-spacing: 0.04em;
  text-transform: uppercase;
  opacity: 0.82;
}

.cnev-ship-filter { display: flex; gap: 8px; flex-wrap: wrap; }
.cnev-ship-fbtn {
  flex: 1; min-width: 160px;
  padding: 10px 18px;
  background: #fff;
  border: 1px solid rgba(8,145,178,.20);
  border-radius: 10px;
  color: #475569;
  font-size: 12.5px; font-weight: 700;
  cursor: pointer; transition: all .15s;
}
.cnev-ship-fbtn:hover { background: #f0fdff; color: #0e7490; }
.cnev-ship-fbtn.is-active {
  background: linear-gradient(135deg, #0e7490, #06b6d4);
  color: #fff; border-color: transparent;
  box-shadow: 0 4px 12px rgba(8,145,178,.30);
}

/* ─── FOOTER ─── */
.cnev-footer {
  flex-shrink: 0;
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 14px 24px;
  background: #fff;
  border-top: 1px solid #cffafe;
}
.cnev-footer-meta { font-size: 12px; color: #475569; }
.cnev-footer-actions { display: flex; gap: 10px; }
.cnev-btn {
  display: inline-flex; align-items: center; gap: 7px;
  padding: 9px 18px;
  border-radius: 10px;
  font-size: 12.5px; font-weight: 700;
  cursor: pointer; border: 1px solid transparent;
  transition: all .15s;
}
.cnev-btn-light { background: #fff; color: #0e7490; border-color: rgba(8,145,178,.30); }
.cnev-btn-light:hover { background: #ecfeff; transform: translateY(-1px); box-shadow: 0 4px 12px rgba(8,145,178,.20); }
.cnev-btn-dark  { background: linear-gradient(135deg, #0c4a6e, #0e7490); color: #fff; box-shadow: 0 4px 14px rgba(12,74,110,.30); }
.cnev-btn-dark:hover  { transform: translateY(-1px); box-shadow: 0 8px 22px rgba(12,74,110,.45); }

/* ─── DARK MODE ─── */
[data-bs-theme="dark"] .cnev-card { background: #08222b; }
[data-bs-theme="dark"] .cnev-groups-wrap { background: linear-gradient(180deg, #08222b 0%, #0a2a33 100%); }
[data-bs-theme="dark"] .cnev-group { background: #0a2a33; border-color: rgba(8,145,178,.30); }
[data-bs-theme="dark"] .cnev-group:hover { background: #14352a; border-color: rgba(8,145,178,.5); }
[data-bs-theme="dark"] .cnev-group.is-active { background: linear-gradient(120deg,#0c4a6e,#0e7490); border-color: #06b6d4; }
[data-bs-theme="dark"] .cnev-group-icon { background: rgba(8,145,178,.20); color: #67e8f9; border-color: rgba(8,145,178,.3); }
[data-bs-theme="dark"] .cnev-group.is-active .cnev-group-icon { background: rgba(255,255,255,.18); color: #fff; }
[data-bs-theme="dark"] .cnev-group-title { color: #cffafe; }
[data-bs-theme="dark"] .cnev-group-sub { color: #8fbfa6; }
[data-bs-theme="dark"] .cnev-tabs-wrap { background: linear-gradient(180deg, #08222b 0%, #0a2a33 100%); border-bottom-color: rgba(8,145,178,.22); }
[data-bs-theme="dark"] .cnev-tab { background: transparent; color: #67e8f9; border: 1.5px solid rgba(8,145,178,0.40); box-shadow: none; }
[data-bs-theme="dark"] .cnev-tab-icon { background: transparent; color: #67e8f9; }
[data-bs-theme="dark"] .cnev-tab:hover { background: rgba(8,145,178,0.10); border-color: #06b6d4; color: #cffafe; box-shadow: none; }
[data-bs-theme="dark"] .cnev-tab:hover .cnev-tab-icon { background: transparent; color: #cffafe; }
[data-bs-theme="dark"] .cnev-tab.is-active { background: linear-gradient(135deg, #0e7490, #0c4a6e); color: #fff; border-color: #06b6d4; }
[data-bs-theme="dark"] .cnev-tab.is-active .cnev-tab-icon { background: transparent; color: #fff; }
[data-bs-theme="dark"] .cnev-tab-count { background: rgba(8,145,178,.22); color: #67e8f9; }
[data-bs-theme="dark"] .cnev-tab.is-active .cnev-tab-count { background: rgba(255,255,255,.28); color: #fff; }
[data-bs-theme="dark"] .cnev-kpi-outer { background: linear-gradient(180deg, #08222b 0%, #0a2a33 100%); border-bottom-color: rgba(8,145,178,.22); }
[data-bs-theme="dark"] .cnev-kpi-fade-l { background: linear-gradient(90deg,  #08222b 0%, #08222b 25%, rgba(8,34,43,0) 100%); }
[data-bs-theme="dark"] .cnev-kpi-fade-r { background: linear-gradient(270deg, #0a2a33 0%, #0a2a33 25%, rgba(10,42,51,0) 100%); }
[data-bs-theme="dark"] .cnev-kpi-nav { background: linear-gradient(135deg, #143829 0%, #08222b 100%); color: #67e8f9; box-shadow: 0 2px 6px rgba(0,0,0,.40), 0 8px 22px rgba(0,0,0,.50), inset 0 0 0 1px rgba(8,145,178,.30); }
[data-bs-theme="dark"] .cnev-kpi-nav:hover { background: linear-gradient(135deg, #0e7490, #06b6d4); color: #fff; }
[data-bs-theme="dark"] .cnev-kpi-tile { background: #0a2a33; border-color: rgba(8,145,178,.28); box-shadow: 0 2px 10px rgba(0,0,0,0.30); }
[data-bs-theme="dark"] .cnev-kpi-tile:hover { border-color: rgba(8,145,178,.45); box-shadow: 0 6px 18px rgba(0,0,0,0.40); }
[data-bs-theme="dark"] .cnev-kpi-label { color: #94a3b8; }
[data-bs-theme="dark"] .cnev-kpi-value { color: #cffafe; }
[data-bs-theme="dark"] .cnev-body { background: #08222b; scrollbar-color: #0e7490 transparent; }
[data-bs-theme="dark"] .cnev-body::-webkit-scrollbar-thumb { background: #0e7490; }
[data-bs-theme="dark"] .cnev-body::-webkit-scrollbar-thumb:hover { background: #06b6d4; }
[data-bs-theme="dark"] .cnev-section { background: linear-gradient(110deg, rgba(8,145,178,.14), rgba(103,232,249,.10)); border-color: rgba(8,145,178,.30); }
[data-bs-theme="dark"] .cnev-section-title { color: #cffafe; }
[data-bs-theme="dark"] .cnev-section-sub { color: #67e8f9; }
[data-bs-theme="dark"] .cnev-section-count { color: #cffafe; }
[data-bs-theme="dark"] .cnev-section-count-label { color: #67e8f9; }
[data-bs-theme="dark"] .cnev-table-wrap { background: #0a2a33; border-color: rgba(8,145,178,.28); }
[data-bs-theme="dark"] .cnev-table thead th {
  background:
    linear-gradient(180deg, rgba(8,145,178,.22) 0%, rgba(8,145,178,.16) 55%, rgba(12,74,110,.18) 100%);
  color: #67e8f9;
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,0.08),
    inset 0 -1px 0 rgba(8,145,178,0.40),
    0 4px 10px -8px rgba(0,0,0,0.40);
}
[data-bs-theme="dark"] .cnev-table tbody td { color: #e2e8f0; border-bottom-color: rgba(8,145,178,.10); }
[data-bs-theme="dark"] .cnev-table tbody tr:hover td { background: rgba(8,145,178,.06); }
[data-bs-theme="dark"] .cnev-doc-name { color: #cffafe; }
[data-bs-theme="dark"] .cnev-mono { color: #e2e8f0; }
[data-bs-theme="dark"] .cnev-date { background: rgba(8,145,178,.16); color: #67e8f9; }
[data-bs-theme="dark"] .cnev-date-expiry[data-status="expiring"] { background: rgba(245,158,11,.18); color: #fcd34d; }
[data-bs-theme="dark"] .cnev-date-expiry[data-status="pending"]  { background: rgba(239,68,68,.18); color: #fca5a5; }
[data-bs-theme="dark"] .cnev-attach { background: rgba(8,145,178,.16); color: #67e8f9; border-color: rgba(8,145,178,.30); }
[data-bs-theme="dark"] .cnev-chip-pill { background: rgba(8,145,178,.16); color: #67e8f9; }
[data-bs-theme="dark"] .cnev-chip-pill-warm { background: rgba(217,119,6,.18); color: #fcd34d; border-color: rgba(217,119,6,.30); }
[data-bs-theme="dark"] .cnev-ratio-track { stroke: rgba(8,145,178,.22); }
[data-bs-theme="dark"] .cnev-ratio-label { color: #cffafe; }
[data-bs-theme="dark"] .cnev-ratio[data-tone="good"] .cnev-ratio-label { color: #67e8f9; }
[data-bs-theme="dark"] .cnev-ratio[data-tone="mid"]  .cnev-ratio-label { color: #fcd34d; }
[data-bs-theme="dark"] .cnev-ratio[data-tone="bad"]  .cnev-ratio-label { color: #fca5a5; }
[data-bs-theme="dark"] .cnev-footer { background: #08222b; border-top-color: rgba(8,145,178,.22); }
[data-bs-theme="dark"] .cnev-footer-meta { color: #cbd5e1; }
[data-bs-theme="dark"] .cnev-btn-light { background: rgba(8,145,178,.12); color: #67e8f9; border-color: rgba(8,145,178,.30); }
[data-bs-theme="dark"] .cnev-btn-light:hover { background: rgba(8,145,178,.18); }
[data-bs-theme="dark"] .cnev-ship-fbtn { background: #0a2a33; color: #94a3b8; border-color: rgba(8,145,178,.28); }
[data-bs-theme="dark"] .cnev-ship-fbtn:hover { color: #67e8f9; background: rgba(8,145,178,.10); }
[data-bs-theme="dark"] .cnev-filter-verified { background: rgba(8,145,178,.18); color: #67e8f9; border-color: rgba(8,145,178,.30); }
[data-bs-theme="dark"] .cnev-filter-expiring { background: rgba(245,158,11,.18); color: #fcd34d; border-color: rgba(217,119,6,.30); }
[data-bs-theme="dark"] .cnev-filter-pending  { background: rgba(239,68,68,.18);  color: #fca5a5; border-color: rgba(239,68,68,.30); }

/* ─── RESPONSIVE ─── */
@media (max-width: 1440px) { .cnev-card { width: min(1100px, 92vw); } }
@media (max-width: 1280px) { .cnev-card { width: 92vw; } }
@media (max-width: 960px) {
  .cnev-card { width: 96vw; }
  .cnev-header { padding: 12px 14px; }
  .cnev-header-title { font-size: 16px; }
  .cnev-vault-icon { width: 38px; height: 38px; border-radius: 10px; }
  .cnev-header-content { flex-direction: column; align-items: flex-start; gap: 10px; }
  .cnev-header-right { width: 100%; justify-content: space-between; }
  .cnev-kpi-strip { padding: 12px 52px; gap: 8px; }
  .cnev-kpi-tile { flex: 0 0 190px; padding: 10px 12px; }
  .cnev-kpi-value { font-size: 20px; }
  .cnev-kpi-icon { width: 32px; height: 32px; font-size: 15px; }
  .cnev-kpi-fade { width: 50px; }
  .cnev-kpi-nav { width: 30px; height: 30px; font-size: 16px; }
  .cnev-kpi-nav-prev { left: 10px; }
  .cnev-kpi-nav-next { right: 10px; }
  .cnev-groups-wrap { padding: 12px 14px 0; }
  .cnev-groups { grid-template-columns: 1fr; gap: 10px; }
  .cnev-tabs-wrap { padding: 10px 14px; }
  .cnev-tab { padding: 7px 14px; font-size: 12px; gap: 7px; }
  .cnev-tab-icon { width: 16px; height: 16px; font-size: 13px; }
  .cnev-body { padding: 14px 16px 18px; gap: 12px; }
  .cnev-section { padding: 12px 14px; }
  .cnev-section-count { font-size: 22px; }
  .cnev-footer { flex-direction: column; align-items: stretch; gap: 10px; }
  .cnev-footer-actions { display: flex; gap: 8px; }
  .cnev-footer-actions .cnev-btn { flex: 1; justify-content: center; }
  .cnev-header-orb { display: none; }
  .cnev-header-bg::after { display: none; }
}
@media (max-width: 640px) {
  .cnev-card { width: 100vw; }
  .cnev-kpi-tile { flex: 0 0 170px; }
  .cnev-tab { padding: 6px 12px; font-size: 11.5px; }
  .cnev-tab-icon { width: 14px; height: 14px; font-size: 12px; }
  .cnev-tab-count { font-size: 9.5px; padding: 1px 6px; }
}
`;
