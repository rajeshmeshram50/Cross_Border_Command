import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import api from '../../api';
import Tooltip from '../../components/ui/Tooltip';
import { useToast } from '../../contexts/ToastContext';
import { signatureRequestsToVaultDocs, mergeTradeDocuments, type SigReqRow } from '../../utils/vaultSignatureRows';
import { downloadFile } from '../../utils/downloadFile';
import SalesCustomerSendForSignatureModal from '../sales/SalesCustomerSendForSignatureModal';

/* ────────────────────────────────────────────────────────────────────────────
 * Supplier Evidence Vault — read-only compliance archive
 *
 * Mirrors CustomerEvidenceVaultModal in structure (same 5 buckets, same
 * shipment matrix) but skinned with the emerald palette that matches the
 * Sales → Supplier page (mint hero strip, emerald Add Supplier button).
 * The vault opens FROM that page so it should feel like an extension of
 * it, not the sibling Customer module which owns the violet identity.
 *
 *   1. Company Due Diligence — PAN, TAN, GST, CIN, IEC, Address Proof, …
 *   2. Owner KYC Details     — Aadhaar, PAN, Passport, Director address …
 *   3. Trade Licenses        — IEC, APEDA, Agro Export Permit, Organic …
 *   4. Trade Documents       — Master Sales Agreement, PO Framework, NDA …
 *   5. Shipment Agreements   — per-shipment matrix (Buyer = Supplier / ≠)
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
  last_updated:           string;
}

export interface SupplierVaultTarget {
  id: string;             // S-001 / matches vendors.vendor_code
  db_id?: number;
  company: string;
  risk?: string;
  segment?: string;
  country?: string;
  contact?: string;
  contactCity?: string;
  /* Linked customer code (e.g. C-010) so the header can show the
   * buyer-supplier relationship at a glance. */
  customerId?: string;
}

interface Props {
  open: boolean;
  supplier: SupplierVaultTarget | null;
  onClose: () => void;
  data?: VaultData | null;
}

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

export default function SupplierEvidenceVaultModal({ open, supplier, onClose, data }: Props) {
  const toast = useToast();
  const [tab, setTab] = useState<TabKey>('company-dd');
  const [group, setGroup] = useState<GroupKey>('standard');
  const [shipmentFilter, setShipmentFilter] = useState<'all' | 'buyer-eq-supplier' | 'buyer-neq-supplier'>('all');

  /* Switch the active group and jump to its first sub-tab. */
  const selectGroup = (g: GroupKey) => {
    setGroup(g);
    const first = TABS.find(t => t.group === g);
    if (first) setTab(first.key);
  };
  const kpiStripRef = useRef<HTMLDivElement | null>(null);
  const [kpiPaused, setKpiPaused] = useState(false);
  /* Live API payload — populated by the fetch effect below. Falls back
   * to the demo builder if the fetch fails or the supplier has no
   * db_id (unsaved record). */
  const [vaultLive, setVaultLive] = useState<VaultData | null>(null);
  const [loading, setLoading] = useState(false);
  /* Zoho Sign signature requests for this supplier — fetched in parallel
   * with the vault payload and merged into the Trade Documents tab. The
   * vault's own /vault endpoint doesn't know about clm_signature_requests
   * (it predates the Sign flow), so the merge happens client-side. */
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

  /* Init the active tab ONLY on open / supplier change — NOT on onClose (fresh
   * closure each parent render), so a background re-render no longer snaps the
   * user's tab back to the default. */
  useEffect(() => {
    if (!open) return;
    setTab('company-dd');
    setGroup('standard');
    setShipmentFilter('all');
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
    if (!supplier) return null;
    /* Priority: explicit `data` prop > live API > demo fallback. */
    const base = data ?? vaultLive ?? buildDemoVault(supplier);
    if (!base) return null;
    // Trade Documents tab = the party's expected trade docs (segment-rule
    // td, party-filtered to mirror the edit form) merged with their live
    // Zoho Sign status. Each row exposes Send-for-Signature; signed rows
    // also carry the signed PDF + certificate links.
    const sigRows            = signatureRequestsToVaultDocs(signatureRows);
    const baseSegmentTd      = (base.trade_documents ?? []) as VaultDoc[];
    const mergedTd           = mergeTradeDocuments(baseSegmentTd as any, sigRows, 'supplier') as unknown as VaultDoc[];
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
  }, [supplier, data, vaultLive, signatureRows]);

  if (!open || !supplier || !vault) return null;

  const StatusPill = ({ s }: { s: VaultStatus }) => {
    const tone =
      s === 'Verified' ? { bg: '#d1fae5', fg: '#047857', mark: '✓' }
      : s === 'Signed'   ? { bg: '#dbeafe', fg: '#1e40af', mark: '✓' }
      : s === 'Expiring' ? { bg: '#fef3c7', fg: '#92400e', mark: '⚠' }
      :                    { bg: '#fee2e2', fg: '#b91c1c', mark: '⌛' };
    return (
      <span className="svev-pill" style={{ background: tone.bg, color: tone.fg }}>
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

  return createPortal(
    <div className="svev-overlay" role="dialog" aria-modal="true" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <style>{SVEV_CSS}</style>
      <div className="svev-card" onMouseDown={(e) => e.stopPropagation()}>
        {/* ─── HEADER ─── */}
        <div className="svev-header">
          <div className="svev-header-bg" aria-hidden />
          <span className="svev-header-orb" aria-hidden />
          <div className="svev-header-content">
            <div className="svev-header-left">
              <div className="svev-vault-icon">
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="3" width="20" height="5" rx="1.5" />
                  <path d="M4 8v12a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V8" />
                  <line x1="10" y1="13" x2="14" y2="13" />
                  <line x1="10" y1="17" x2="14" y2="17" />
                </svg>
                <span className="svev-vault-icon-tick" aria-hidden>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5"><polyline points="20 6 9 17 4 12" /></svg>
                </span>
              </div>
              <div className="svev-header-text">
                <div className="svev-header-eyebrow">— EVIDENCE VAULT</div>
                <div className="svev-header-title">{supplier.company}</div>
                <div className="svev-header-chips">
                  <span className="svev-chip svev-chip-id">● {supplier.id}</span>
                  {supplier.customerId && <span className="svev-chip svev-chip-link">↳ {supplier.customerId}</span>}
                  <span className="svev-chip svev-chip-risk" data-risk={(supplier.risk ?? 'Low').toLowerCase()}>● {supplier.risk ?? 'Low'} Risk</span>
                  {supplier.contact && (
                    <span className="svev-chip svev-chip-contact">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                      {supplier.contact}{supplier.contactCity ? ` · ${supplier.contactCity}` : ''}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div className="svev-header-right">
              <div className="svev-header-meta">
                {supplier.segment && <span>{supplier.segment}</span>}
                {supplier.country && <span>· {supplier.country}</span>}
              </div>
              <button type="button" className="svev-close" onClick={onClose} aria-label="Close vault">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
          </div>
        </div>

        {/* ─── KPI STRIP ─── */}
        <div
          className="svev-kpi-outer"
          onMouseEnter={() => setKpiPaused(true)}
          onMouseLeave={() => setKpiPaused(false)}
          onTouchStart={() => setKpiPaused(true)}
          onTouchEnd={() => setKpiPaused(false)}
        >
          <span className="svev-kpi-fade svev-kpi-fade-l" aria-hidden />
          <span className="svev-kpi-fade svev-kpi-fade-r" aria-hidden />
          <button
            type="button"
            className="svev-kpi-nav svev-kpi-nav-prev"
            aria-label="Scroll KPIs left"
            onClick={() => kpiStripRef.current?.scrollBy({ left: -260, behavior: 'smooth' })}
          >
            <i className="ri-arrow-left-s-line" />
          </button>
          <button
            type="button"
            className="svev-kpi-nav svev-kpi-nav-next"
            aria-label="Scroll KPIs right"
            onClick={() => kpiStripRef.current?.scrollBy({ left: 260, behavior: 'smooth' })}
          >
            <i className="ri-arrow-right-s-line" />
          </button>
          <div
            ref={kpiStripRef}
            className="svev-kpi-strip"
            onWheel={(e) => {
              if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
                e.currentTarget.scrollLeft += e.deltaY;
              }
            }}
          >
          {[0, 1].map((cycle) => (
            <div key={cycle} className="svev-kpi-cycle" aria-hidden={cycle === 1 ? true : undefined}>
              <KpiTile label="Total Documents"        value={vault.total_documents}        icon="ri-file-list-3-line"        gradient="linear-gradient(135deg, #047857 0%, #10b981 100%)" />
              <KpiTile label="Verified / Signed"      value={vault.verified_signed}        icon="ri-shield-check-line"       gradient="linear-gradient(135deg, #16a34a 0%, #4ade80 100%)" />
              <KpiTile label="Pending"                value={vault.pending}                icon="ri-time-line"               gradient="linear-gradient(135deg, #d97706 0%, #f59e0b 100%)" />
              <KpiTile label="Company Due Diligence"  value={vault.company_dd_count}       icon="ri-building-line"           gradient="linear-gradient(135deg, #059669 0%, #34d399 100%)" />
              <KpiTile label="Owner KYC"              value={vault.owner_kyc_count}        icon="ri-user-3-line"             gradient="linear-gradient(135deg, #047857 0%, #059669 100%)" />
              <KpiTile label="Trade License"          value={vault.trade_license_count}    icon="ri-government-line"         gradient="linear-gradient(135deg, #10b981 0%, #6ee7b7 100%)" />
              <KpiTile label="Trade Documents"        value={vault.trade_documents_count}  icon="ri-article-line"            gradient="linear-gradient(135deg, #0d9488 0%, #5eead4 100%)" />
              <KpiTile label="Total Shipments"        value={vault.total_shipments}        icon="ri-truck-line"              gradient="linear-gradient(135deg, #064e3b 0%, #047857 100%)" />
            </div>
          ))}
          </div>
        </div>

        {/* ─── GROUP CARDS — Standard Documents vs Case to Case. */}
        <div className="svev-groups-wrap">
          <div className="svev-groups">
            {GROUPS.map(g => (
              <button
                key={g.key}
                type="button"
                className={`svev-group ${group === g.key ? 'is-active' : ''}`}
                onClick={() => selectGroup(g.key)}
              >
                <span className="svev-group-icon"><i className={g.icon} aria-hidden /></span>
                <span className="svev-group-text">
                  <span className="svev-group-title">{g.title}</span>
                  <span className="svev-group-sub">{g.sub}</span>
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* ─── SUB-TABS — for the active group. */}
        <div className="svev-tabs-wrap">
          <div className="svev-tabs">
            {TABS.filter(t => t.group === group).map(t => (
              <button
                key={t.key}
                type="button"
                className={`svev-tab ${tab === t.key ? 'is-active' : ''}`}
                onClick={() => setTab(t.key)}
              >
                <span className="svev-tab-icon"><i className={t.icon} aria-hidden /></span>
                <span className="svev-tab-label">{t.label}</span>
                <span className="svev-tab-count">{vault[t.countKey] as number}</span>
              </button>
            ))}
          </div>
        </div>

        {/* ─── BODY ─── */}
        <div className="svev-body">
          <div className="svev-section">
            <div className="svev-section-left">
              <div className="svev-section-icon"><i className={tabMeta.icon} /></div>
              <div>
                <div className="svev-section-title">{tabMeta.label}</div>
                <div className="svev-section-sub">{sectionSub(tab)}</div>
              </div>
            </div>
            <div className="svev-section-right">
              <div className="svev-section-count">{vault[tabMeta.countKey] as number}</div>
              <div className="svev-section-count-label">{tab === 'shipment-agreements' ? 'SHIPMENTS' : 'DOCUMENTS'}</div>
            </div>
          </div>

          {tab === 'shipment-agreements'
            ? <ShipmentTable rows={vault.shipment_agreements} filter={shipmentFilter} setFilter={setShipmentFilter} />
            : <DocsTable rows={docsForTab} tab={tab} ownerType="supplier" ownerId={supplier?.db_id ?? null} onReload={reloadVault}
                         onSendTradeDoc={(d) => { if (d.db_id) setSendDocIds([d.db_id]); }}
                         onRemindTradeDoc={handleRemind} />}
        </div>

        {/* ─── FOOTER ─── */}
        <div className="svev-footer">
          <div className="svev-footer-meta">
            Last updated: <b>{vault.last_updated}</b> · Vault managed by Compliance Team
          </div>
          <div className="svev-footer-actions">
            <button type="button" className="svev-btn svev-btn-light" onClick={() => alert('Export wiring lands with the backend')}>
              <i className="ri-download-cloud-2-line" /> Export All
            </button>
            <button type="button" className="svev-btn svev-btn-dark" onClick={onClose}>
              Close Vault
            </button>
          </div>
        </div>
      </div>

      {/* Send for Signature — launched from a Trade Documents row. The
          modal portals to <body>, so it overlays the vault cleanly. */}
      <SalesCustomerSendForSignatureModal
        open={Array.isArray(sendDocIds)}
        customer={supplier?.db_id ? {
          id:      supplier.id,
          db_id:   supplier.db_id,
          company: supplier.company,
          contact: supplier.contact,
        } : null}
        modelName="Vendor"
        preselectedDocIds={sendDocIds ?? undefined}
        onClose={() => setSendDocIds(null)}
        onSent={() => { setSendDocIds(null); void reloadSignatures(); }}
      />
    </div>,
    document.body
  );
}

function KpiTile({ label, value, icon, gradient }: { label: string; value: number; icon: string; gradient: string }) {
  return (
    <div className="svev-kpi-tile">
      <span className="svev-kpi-strip-top" style={{ background: gradient }} aria-hidden />
      <div className="svev-kpi-body">
        <div className="svev-kpi-text">
          <div className="svev-kpi-label">{label.toUpperCase()}</div>
          <div className="svev-kpi-value">{value.toLocaleString()}</div>
        </div>
        <div className="svev-kpi-icon" style={{ background: gradient }}>
          <i className={icon} aria-hidden />
        </div>
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
    <div className="svev-table-wrap">
      <div className="svev-table-scroll">
      <table className="svev-table">
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
            <tr><td colSpan={6} className="svev-empty">No documents in this bucket yet.</td></tr>
          ) : rows.map((d, i) => (
            <tr key={d.id}>
              <td>{i + 1}</td>
              <td className="svev-doc-name">{d.name}</td>
              <td className="svev-mono">{d.reference || '—'}</td>
              <td>{d.authority || '—'}</td>
              <td>
                {d.attachment ? (
                  d.attachment_url ? (
                    <Tooltip label={`Open ${d.attachment}`}>
                      <a href={d.attachment_url} target="_blank" rel="noreferrer" className="svev-attach" style={{ textDecoration: 'none' }}>
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                        {d.attachment}
                      </a>
                    </Tooltip>
                  ) : (
                  <Tooltip label={d.attachment}>
                    <span className="svev-attach">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                      {d.attachment}
                    </span>
                  </Tooltip>
                  )
                ) : <span className="svev-muted">Not uploaded</span>}
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
    <div className="svev-row-actions">
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
            className="svev-row-act svev-row-act-send"
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
            className="svev-row-act svev-row-act-remind"
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
          className={`svev-row-act svev-row-act-view ${!canViewOrDownload ? 'is-disabled' : ''}`}
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
          className={`svev-row-act svev-row-act-download ${!canViewOrDownload ? 'is-disabled' : ''}`}
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
          className={`svev-row-act svev-row-act-upload ${(!canReupload || busy) ? 'is-disabled' : ''}`}
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
          from a completed Zoho Sign request (the helper attaches the
          same URL to every doc-row in the request). Mirrors the
          faCertificate action button in New_IDIMS_6.0's
          Stage3Tab2DocumentationArchive. */}
      {doc.certificate_url && (
        <Tooltip label="Certificate of Completion">
          <a
            href={doc.certificate_url}
            target="_blank"
            rel="noreferrer"
            className="svev-row-act svev-row-act-cert"
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

function ShipmentTable({ rows, filter, setFilter }: {
  rows: VaultShipmentRow[];
  filter: 'all' | 'buyer-eq-supplier' | 'buyer-neq-supplier';
  setFilter: (f: 'all' | 'buyer-eq-supplier' | 'buyer-neq-supplier') => void;
}) {
  const filtered = rows.filter(r =>
    filter === 'all' ? true
    : filter === 'buyer-eq-supplier' ? r.buyer_is_supplier
    : !r.buyer_is_supplier
  );
  return (
    <>
      <div className="svev-ship-filter">
        <button type="button" className={`svev-ship-fbtn ${filter === 'all' ? 'is-active' : ''}`} onClick={() => setFilter('all')}>All Shipments</button>
        <button type="button" className={`svev-ship-fbtn ${filter === 'buyer-eq-supplier' ? 'is-active' : ''}`} onClick={() => setFilter('buyer-eq-supplier')}>✓ Customer = Supplier</button>
        <button type="button" className={`svev-ship-fbtn ${filter === 'buyer-neq-supplier' ? 'is-active' : ''}`} onClick={() => setFilter('buyer-neq-supplier')}>✕ Customer ≠ Supplier</button>
      </div>
      <div className="svev-table-wrap">
        <div className="svev-table-scroll">
        <table className="svev-table">
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
              <tr><td colSpan={11} className="svev-empty">No shipments match the filter.</td></tr>
            ) : filtered.map((r, i) => (
              <tr key={r.id}>
                <td>{i + 1}</td>
                <td><span className="svev-chip-pill">● {r.shipment_id}</span></td>
                <td><span className="svev-chip-pill svev-chip-pill-warm">● {r.opportunity_id}</span></td>
                <td>
                  <span className="svev-cust-cell">
                    <span className="svev-cust-mono">{r.customer.charAt(0)}</span>
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
                  <span className={`svev-pill svev-risk-${r.risk.toLowerCase()}`}>
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
        className="svev-ratio"
        data-tone={tone}
        onMouseEnter={showTip}
        onMouseLeave={hideTip}
        onFocus={showTip}
        onBlur={hideTip}
        tabIndex={0}
      >
        <svg width="38" height="38" viewBox="0 0 38 38" aria-hidden>
          <circle className="svev-ratio-track" cx="19" cy="19" r={radius} fill="none" strokeWidth="3.5" />
          <circle
            className="svev-ratio-arc"
            cx="19" cy="19" r={radius}
            fill="none" strokeWidth="3.5"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            strokeLinecap="round"
            transform="rotate(-90 19 19)"
          />
        </svg>
        <span className="svev-ratio-label">{r.ratio}</span>
      </span>
      {tip && createPortal(
        <div className="svev-ratio-tip" style={{ top: tip.top, left: tip.left }} role="tooltip">
          <b className="svev-ratio-tip-pct" data-tone={tone}>{r.pct}%</b>
          <span className="svev-ratio-tip-meta">{r.ratio} · {status}</span>
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
    case 'shipment-agreements': return 'Per-shipment compliance matrix grouped by customer-supplier link';
  }
}

/* ─── Scoped CSS — emerald palette to match the Sales → Supplier
   page (mint hero strip, emerald Add Supplier button, mint table
   header). Sibling Customer module owns the violet identity. */
const SVEV_CSS = `
.svev-overlay {
  position: fixed; inset: 0;
  background: rgba(6,78,59,0.45);
  -webkit-backdrop-filter: blur(6px);
  backdrop-filter: blur(6px);
  z-index: 11200;
  display: flex; align-items: stretch; justify-content: flex-end;
  font-family: 'DM Sans','Inter',system-ui,-apple-system,sans-serif;
  animation: cnevFade .18s ease both;
}
@keyframes cnevFade { from { opacity: 0; } to { opacity: 1; } }
.svev-card {
  position: relative;
  width: min(1280px, 90vw);
  height: 100vh;
  background: #f0fdf4;
  border-radius: 0;
  overflow: hidden;
  display: flex; flex-direction: column;
  box-shadow: -32px 0 80px rgba(6,78,59,.40), -12px 0 30px rgba(6,78,59,.18);
  animation: cnevSlide .26s cubic-bezier(.22,1,.36,1) both;
}
@keyframes cnevSlide { from { transform: translateX(40px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }

/* ─── HEADER ─── */
.svev-header {
  position: relative;
  flex-shrink: 0;
  padding: 14px 22px;
  background: linear-gradient(135deg, #064e3b 0%, #047857 35%, #059669 65%, #34d399 100%);
  color: #fff;
  overflow: hidden;
}
.svev-header-bg {
  position: absolute; inset: 0;
  pointer-events: none;
  overflow: hidden;
  background:
    radial-gradient(circle at 100% 0%, rgba(167,243,208,0.32), transparent 45%),
    radial-gradient(circle at 0% 100%, rgba(110,231,183,0.30), transparent 55%);
}
.svev-header-bg::before,
.svev-header-bg::after {
  content: '';
  position: absolute;
  border-radius: 50%;
  background: radial-gradient(circle at 30% 30%, rgba(255,255,255,0.22), rgba(255,255,255,0.06) 60%, transparent 75%);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.18);
}
.svev-header-bg::before { width: 220px; height: 220px; top: -80px; right: -40px; }
.svev-header-bg::after  { width: 130px; height: 130px; bottom: -45px; right: 130px;
  background: radial-gradient(circle at 30% 30%, rgba(110,231,183,0.30), rgba(110,231,183,0.06) 60%, transparent 75%); }
.svev-header-orb {
  position: absolute;
  width: 90px; height: 90px;
  top: 8px; right: 220px;
  border-radius: 50%;
  background: radial-gradient(circle at 30% 30%, rgba(255,255,255,0.18), rgba(255,255,255,0.04) 60%, transparent 75%);
  pointer-events: none;
}
.svev-header-content {
  position: relative;
  display: flex; align-items: center; justify-content: space-between; gap: 20px;
}
.svev-header-left { display: flex; align-items: center; gap: 12px; min-width: 0; }
.svev-vault-icon {
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
.svev-vault-icon-tick {
  position: absolute; top: -3px; right: -3px;
  width: 18px; height: 18px; border-radius: 50%;
  background: #6ee7b7; color: #064e3b;
  display: inline-flex; align-items: center; justify-content: center;
  border: 2px solid #047857;
}
.svev-header-text { min-width: 0; }
.svev-header-eyebrow { font-size: 9.5px; font-weight: 700; letter-spacing: .12em; color: rgba(255,255,255,.78); margin-bottom: 2px; }
.svev-header-title { font-size: 18px; font-weight: 800; letter-spacing: -0.01em; line-height: 1.15; margin-bottom: 6px; color: #fff; }
.svev-header-chips { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.svev-chip { display: inline-flex; align-items: center; gap: 5px; padding: 3px 9px; border-radius: 999px; font-size: 10.5px; font-weight: 600; background: rgba(255,255,255,0.16); border: 1px solid rgba(255,255,255,0.24); color: #ecfdf5; }
.svev-chip-id { background: rgba(255,255,255,0.20); }
.svev-chip-link { background: rgba(255,255,255,0.14); color: #d1fae5; }
.svev-chip-risk[data-risk="low"]      { background: rgba(16,185,129,0.30); color: #ecfdf5; }
.svev-chip-risk[data-risk="medium"]   { background: rgba(245,158,11,0.30); color: #fef3c7; }
.svev-chip-risk[data-risk="high"]     { background: rgba(239,68,68,0.30);  color: #fee2e2; }
.svev-chip-risk[data-risk="critical"] { background: rgba(220,38,38,0.40);  color: #fee2e2; }

.svev-header-right { display: flex; align-items: center; gap: 12px; flex-shrink: 0; }
.svev-header-meta { font-size: 11px; color: rgba(255,255,255,.84); display: inline-flex; gap: 4px; align-items: center; }
.svev-header-meta span { white-space: nowrap; }
.svev-close {
  width: 28px; height: 28px; border-radius: 50%;
  display: inline-flex; align-items: center; justify-content: center;
  background: rgba(255,255,255,0.18); color: #fff; border: 1px solid rgba(255,255,255,0.28);
  cursor: pointer; transition: all .15s;
  flex-shrink: 0;
}
.svev-close:hover { background: rgba(255,255,255,0.30); transform: rotate(90deg); }

/* ─── KPI STRIP ─── */
.svev-kpi-outer {
  position: relative;
  flex-shrink: 0;
  background: linear-gradient(180deg, #f0fdf4 0%, #ecfdf5 100%);
  border-bottom: 1px solid #d1fae5;
}
.svev-kpi-strip {
  display: flex; gap: 12px; align-items: stretch;
  padding: 14px 64px;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
  -ms-overflow-style: none;
  scroll-behavior: smooth;
}
.svev-kpi-strip::-webkit-scrollbar { display: none; }
.svev-kpi-cycle {
  display: flex; gap: 12px; align-items: stretch;
  flex-shrink: 0;
  margin-right: 12px;
}
.svev-kpi-cycle:last-child { margin-right: 0; }
.svev-kpi-fade {
  position: absolute;
  top: 0; bottom: 0;
  width: 70px;
  pointer-events: none;
  z-index: 3;
}
.svev-kpi-fade-l { left: 0;  background: linear-gradient(90deg,  #f0fdf4 0%, #f0fdf4 25%, rgba(240,253,244,0) 100%); }
.svev-kpi-fade-r { right: 0; background: linear-gradient(270deg, #ecfdf5 0%, #ecfdf5 25%, rgba(236,253,245,0) 100%); }
.svev-kpi-nav {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  z-index: 5;
  width: 34px; height: 34px;
  border-radius: 50%;
  border: none;
  background: linear-gradient(135deg, #ffffff 0%, #ecfdf5 100%);
  color: #047857;
  display: inline-flex; align-items: center; justify-content: center;
  cursor: pointer;
  box-shadow:
    0 2px 6px rgba(16,185,129,0.18),
    0 8px 22px rgba(6,78,59,0.18),
    inset 0 0 0 1px rgba(16,185,129,0.20);
  transition: all .18s ease;
  font-size: 18px;
}
.svev-kpi-nav:hover {
  background: linear-gradient(135deg, #047857, #10b981);
  color: #fff;
  transform: translateY(-50%) scale(1.10);
  box-shadow:
    0 4px 10px rgba(16,185,129,0.30),
    0 10px 26px rgba(16,185,129,0.45);
}
.svev-kpi-nav:active { transform: translateY(-50%) scale(0.96); }
.svev-kpi-nav-prev { left: 14px; }
.svev-kpi-nav-next { right: 14px; }
.svev-kpi-tile {
  position: relative;
  flex: 0 0 220px;
  background: var(--vz-card-bg, #fff);
  border: 1px solid rgba(16,185,129,0.16);
  border-radius: 12px;
  padding: 12px 14px;
  box-shadow: 0 2px 10px rgba(6,78,59,0.06);
  overflow: hidden;
  min-width: 0;
  transition: transform 180ms ease, box-shadow 220ms ease, border-color 180ms ease;
}
.svev-kpi-tile:hover {
  transform: translateY(-1px);
  box-shadow: 0 6px 18px rgba(6,78,59,0.10);
  border-color: rgba(16,185,129,0.30);
}
.svev-kpi-strip-top { position: absolute; top: 0; left: 0; right: 0; height: 3px; }
.svev-kpi-body { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.svev-kpi-text { min-width: 0; }
.svev-kpi-label {
  font-size: 10.5px; font-weight: 700; letter-spacing: .06em;
  color: var(--vz-secondary-color, #6b7280);
  text-transform: uppercase;
  margin-bottom: 6px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.svev-kpi-value {
  font-size: 22px; font-weight: 800; line-height: 1;
  color: var(--vz-heading-color, #2b3245);
}
.svev-kpi-icon {
  width: 38px; height: 38px; border-radius: 10px;
  display: inline-flex; align-items: center; justify-content: center;
  color: #fff;
  font-size: 18px;
  flex-shrink: 0;
  box-shadow: 0 4px 10px rgba(0,0,0,0.10);
}

/* ─── TABS ─── */
/* ─── GROUP CARDS — Standard Documents vs Case to Case (emerald variant). */
.svev-groups-wrap {
  flex-shrink: 0;
  background: linear-gradient(180deg, #f0fdf4 0%, #ecfdf5 100%);
  padding: 14px 18px 0;
}
.svev-groups { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.svev-group {
  display: flex; align-items: center; gap: 14px;
  padding: 13px 18px;
  background: #ffffff;
  border: 1.5px solid #d6f5e3;
  border-radius: 14px;
  cursor: pointer;
  text-align: left;
  transition: all .2s ease;
}
.svev-group:hover { border-color: #6ee7b7; background: #f0fdf4; }
.svev-group.is-active {
  background: linear-gradient(120deg, #064e3b 0%, #047857 55%, #10b981 100%);
  border-color: #047857;
  box-shadow: 0 6px 18px rgba(16,185,129,.35);
}
.svev-group-icon {
  width: 42px; height: 42px; flex-shrink: 0;
  display: inline-flex; align-items: center; justify-content: center;
  border-radius: 12px;
  background: #e7f9ef; color: #047857; border: 1px solid #c7f0d8;
  font-size: 20px;
}
.svev-group.is-active .svev-group-icon { background: rgba(255,255,255,.18); color: #fff; border-color: rgba(255,255,255,.25); }
.svev-group-text { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.svev-group-title { font-size: 15px; font-weight: 800; color: #064e3b; letter-spacing: -.01em; }
.svev-group.is-active .svev-group-title { color: #ffffff; }
.svev-group-sub { font-size: 10.5px; font-weight: 700; letter-spacing: .06em; color: #6b9e85; }
.svev-group.is-active .svev-group-sub { color: rgba(255,255,255,.8); }

.svev-tabs-wrap {
  flex-shrink: 0;
  background: linear-gradient(180deg, #f0fdf4 0%, #ecfdf5 100%);
  border-bottom: 1px solid #d1fae5;
  padding: 12px 18px;
}
.svev-tabs {
  display: flex; gap: 8px;
  overflow-x: auto;
  scrollbar-width: none;
  padding-bottom: 2px;
}
.svev-tabs::-webkit-scrollbar { display: none; }
.svev-tab {
  flex: 0 0 auto;
  position: relative;
  display: inline-flex; align-items: center; gap: 9px;
  padding: 9px 16px 9px 9px;
  background: #ffffff;
  border: 1px solid rgba(16,185,129,0.18);
  border-radius: 999px;
  color: #065f46;
  font-size: 13px; font-weight: 700;
  cursor: pointer;
  transition: transform .18s ease, box-shadow .22s ease, border-color .18s ease, background .18s ease, color .18s ease;
  box-shadow: 0 1px 2px rgba(6,78,59,0.04);
}
.svev-tab-icon {
  width: 28px; height: 28px;
  border-radius: 50%;
  display: inline-flex; align-items: center; justify-content: center;
  background: linear-gradient(135deg, #d1fae5, #a7f3d0);
  color: #047857;
  font-size: 15px;
  transition: all .18s ease;
  flex-shrink: 0;
}
.svev-tab-label { white-space: nowrap; }
.svev-tab:hover {
  transform: translateY(-1px);
  border-color: rgba(16,185,129,0.42);
  box-shadow: 0 6px 16px rgba(16,185,129,0.16);
  color: #064e3b;
}
.svev-tab:hover .svev-tab-icon {
  background: linear-gradient(135deg, #a7f3d0, #6ee7b7);
}
.svev-tab.is-active {
  background: linear-gradient(135deg, #047857 0%, #10b981 55%, #6ee7b7 100%);
  border-color: transparent;
  color: #ffffff;
  box-shadow:
    0 4px 12px rgba(16,185,129,0.32),
    0 10px 26px rgba(6,78,59,0.28);
  transform: translateY(-1px);
}
.svev-tab.is-active .svev-tab-icon {
  background: rgba(255,255,255,0.22);
  color: #ffffff;
  box-shadow: inset 0 0 0 1px rgba(255,255,255,0.30);
}
.svev-tab-count {
  background: #d1fae5; color: #047857;
  font-size: 10.5px; font-weight: 800; letter-spacing: 0.02em;
  padding: 2px 8px; border-radius: 999px;
  min-width: 22px; text-align: center;
  transition: all .18s ease;
}
.svev-tab.is-active .svev-tab-count {
  background: rgba(255,255,255,0.28);
  color: #ffffff;
  box-shadow: inset 0 0 0 1px rgba(255,255,255,0.30);
}

/* ─── BODY ─── */
.svev-body {
  flex: 1; min-height: 0; overflow-y: auto;
  padding: 18px 24px 22px;
  display: flex; flex-direction: column; gap: 14px;
  /* Match the visible scrollbar pattern used by [[AddVendorModal]]'s
     .avm-body so the rail is obvious when a tab's table grows past
     the body. Solid emerald replaces the prior near-invisible rgba(.30). */
  scrollbar-width: thin; scrollbar-color: #6ee7b7 transparent;
}
.svev-body::-webkit-scrollbar { width: 8px; }
.svev-body::-webkit-scrollbar-thumb { background: #6ee7b7; border-radius: 99px; }
.svev-body::-webkit-scrollbar-thumb:hover { background: #10b981; }

.svev-section {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 14px 18px;
  background: linear-gradient(110deg, #ecfdf5, #d1fae5 70%, #a7f3d0);
  border: 1px solid rgba(16,185,129,.18);
  border-radius: 14px;
}
.svev-section-left { display: flex; align-items: center; gap: 12px; min-width: 0; }
.svev-section-icon {
  width: 38px; height: 38px; border-radius: 10px;
  background: linear-gradient(135deg, #10b981, #047857);
  color: #fff;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 18px;
  box-shadow: 0 4px 12px rgba(16,185,129,.30);
}
.svev-section-title { font-size: 15px; font-weight: 800; color: #064e3b; }
.svev-section-sub   { font-size: 12px; color: #047857; margin-top: 1px; }
.svev-section-right { text-align: right; }
.svev-section-count { font-size: 26px; font-weight: 800; color: #064e3b; line-height: 1; }
.svev-section-count-label { font-size: 9.5px; font-weight: 700; letter-spacing: .12em; color: #047857; margin-top: 2px; }

.svev-filter-row { display: flex; gap: 8px; flex-wrap: wrap; }
.svev-filter { display: inline-flex; align-items: center; gap: 6px; padding: 5px 12px; border-radius: 999px; font-size: 11.5px; font-weight: 700; border: 1px solid transparent; }
.svev-filter-verified { background: #d1fae5; color: #047857; border-color: rgba(5,150,105,.30); }
.svev-filter-expiring { background: #fef3c7; color: #92400e; border-color: rgba(217,119,6,.30); }
.svev-filter-pending  { background: #fee2e2; color: #b91c1c; border-color: rgba(239,68,68,.30); }

.svev-table-wrap {
  background: #fff;
  border: 1px solid rgba(16,185,129,.18);
  border-radius: 14px;
  overflow: hidden;
  scrollbar-width: thin;
  position: relative;
  /* Don't let the flex column body squash this wrap below its
     intrinsic height — without this, extra rows can be clipped at
     the bottom and .svev-body's overflow-y never trips, so the user
     has no scrollbar to reach hidden documents. */
  flex-shrink: 0;
}
.svev-section { flex-shrink: 0; }
.svev-table-scroll {
  overflow-x: auto;
  overflow-y: visible;
  scrollbar-width: thin;
}
.svev-table-scroll::-webkit-scrollbar { width: 8px; height: 8px; }
.svev-table-scroll::-webkit-scrollbar-thumb { background: rgba(16,185,129,.30); border-radius: 999px; }
.svev-table-scroll::-webkit-scrollbar-thumb:hover { background: rgba(16,185,129,.55); }
.svev-table { width: 100%; min-width: 980px; border-collapse: separate; border-spacing: 0; font-size: 13px; }
.svev-table thead th {
  position: sticky; top: 0;
  z-index: 3;
  padding: 9px 14px;
  text-align: left;
  background:
    linear-gradient(180deg, #ecfdf5 0%, #d1fae5 55%, #a7f3d0 100%);
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,0.65),
    inset 0 -1px 0 rgba(16,185,129,0.25),
    0 4px 10px -8px rgba(16,185,129,0.30);
  font-size: 10.5px; font-weight: 800; letter-spacing: .08em;
  color: #047857; text-transform: uppercase;
  white-space: nowrap;
}
.svev-table tbody td { padding: 13px 14px; border-bottom: 1px solid #ecfdf5; vertical-align: middle; }
.svev-table tbody tr:last-child td { border-bottom: none; }
.svev-table tbody tr:hover td { background: #f0fdf4; }
.svev-doc-name { font-weight: 700; color: #064e3b; }
.svev-mono { font-family: 'JetBrains Mono','SF Mono',ui-monospace,monospace; font-size: 12px; color: #1f2937; }
.svev-empty { padding: 30px !important; text-align: center; color: #94a3b8; font-style: italic; }
.svev-muted { color: #94a3b8; font-style: italic; font-size: 12px; }

.svev-date {
  display: inline-block;
  font-size: 11.5px; font-weight: 600;
  padding: 3px 9px; border-radius: 6px;
  background: #ecfdf5; color: #047857;
}
.svev-date-expiry[data-status="expiring"] { background: #fef3c7; color: #92400e; }
.svev-date-expiry[data-status="pending"]  { background: #fee2e2; color: #b91c1c; }

.svev-attach {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 3px 9px; border-radius: 6px;
  background: #d1fae5; color: #047857;
  font-size: 11.5px; font-weight: 600;
  border: 1px solid rgba(16,185,129,.30);
}

/* Row Actions — View / Download / Re-upload icons. */
.svev-row-actions { display: inline-flex; align-items: center; gap: 6px; }
.svev-row-act {
  width: 28px; height: 28px; border-radius: 7px;
  display: inline-flex; align-items: center; justify-content: center;
  border: 1px solid transparent; background: transparent;
  cursor: pointer; text-decoration: none;
  transition: background .15s ease, border-color .15s ease, color .15s ease, transform .15s ease;
}
.svev-row-act-view     { color: #2563eb; background: rgba(37,99,235,.08);  border-color: rgba(37,99,235,.20); }
.svev-row-act-view:hover:not(.is-disabled)     { background: rgba(37,99,235,.18); transform: translateY(-1px); }
.svev-row-act-download { color: #0891b2; background: rgba(8,145,178,.08);  border-color: rgba(8,145,178,.20); }
.svev-row-act-download:hover:not(.is-disabled) { background: rgba(8,145,178,.18); transform: translateY(-1px); }
.svev-row-act-upload   { color: #047857; background: rgba(16,185,129,.10); border-color: rgba(16,185,129,.30); }
.svev-row-act-upload:hover:not(.is-disabled)   { background: rgba(16,185,129,.20); transform: translateY(-1px); }
.svev-row-act.is-disabled, .svev-row-act:disabled { opacity: .45; cursor: not-allowed; pointer-events: none; }
/* Dark mode — lift the action-button fills + icon colours. Send / Reminder /
 * Certificate set colours inline, so those need !important. */
[data-bs-theme="dark"] .svev-row-act-view     { color: #93c5fd; background: rgba(59,130,246,.16); border-color: rgba(59,130,246,.34); }
[data-bs-theme="dark"] .svev-row-act-view:hover:not(.is-disabled)     { background: rgba(59,130,246,.28); }
[data-bs-theme="dark"] .svev-row-act-download { color: #67e8f9; background: rgba(8,145,178,.18); border-color: rgba(8,145,178,.36); }
[data-bs-theme="dark"] .svev-row-act-download:hover:not(.is-disabled) { background: rgba(8,145,178,.30); }
[data-bs-theme="dark"] .svev-row-act-upload   { color: #6ee7b7; background: rgba(16,185,129,.18); border-color: rgba(16,185,129,.38); }
[data-bs-theme="dark"] .svev-row-act-upload:hover:not(.is-disabled)   { background: rgba(16,185,129,.30); }
[data-bs-theme="dark"] .svev-row-act-send   { background: rgba(16,185,129,.22) !important; color: #6ee7b7 !important; border-color: rgba(16,185,129,.42) !important; }
[data-bs-theme="dark"] .svev-row-act-remind { background: rgba(245,158,11,.20) !important; color: #fcd34d !important; border-color: rgba(245,158,11,.42) !important; }
[data-bs-theme="dark"] .svev-row-act-cert   { background: rgba(8,145,178,.22) !important; color: #67e8f9 !important; border-color: rgba(8,145,178,.42) !important; }

.svev-pill {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 3px 10px; border-radius: 999px;
  font-size: 11px; font-weight: 700;
}
.svev-risk-compliant { background: #d1fae5; color: #047857; }
.svev-risk-medium    { background: #fef3c7; color: #92400e; }
.svev-risk-high      { background: #fee2e2; color: #b91c1c; }

.svev-chip-pill { display: inline-flex; align-items: center; gap: 4px; padding: 3px 9px; border-radius: 6px; background: #d1fae5; color: #047857; font-size: 11.5px; font-weight: 700; border: 1px solid rgba(16,185,129,.30); font-family: 'JetBrains Mono', ui-monospace, monospace; }
.svev-chip-pill-warm { background: #fef3c7; color: #92400e; border-color: rgba(217,119,6,.30); }
.svev-cust-cell { display: inline-flex; align-items: center; gap: 8px; }
.svev-cust-mono {
  width: 26px; height: 26px; border-radius: 50%;
  display: inline-flex; align-items: center; justify-content: center;
  background: linear-gradient(135deg, #10b981, #047857); color: #fff;
  font-size: 11.5px; font-weight: 800;
  flex-shrink: 0;
}

/* Compact donut + portal tooltip */
.svev-ratio {
  position: relative;
  display: inline-flex; align-items: center; justify-content: center;
  width: 38px; height: 38px;
  line-height: 1;
}
.svev-ratio svg { display: block; transition: filter .2s ease; }
.svev-ratio:hover svg { filter: drop-shadow(0 2px 6px rgba(6,78,59,0.20)); }
.svev-ratio-track { stroke: #d1fae5; }
.svev-ratio-arc {
  transition: stroke-dashoffset .6s cubic-bezier(.22,1,.36,1), stroke .2s ease;
}
.svev-ratio[data-tone="good"] .svev-ratio-arc { stroke: #16a34a; }
.svev-ratio[data-tone="mid"]  .svev-ratio-arc { stroke: #f59e0b; }
.svev-ratio[data-tone="bad"]  .svev-ratio-arc { stroke: #dc2626; }
.svev-ratio-label {
  position: absolute; inset: 0;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 10.5px; font-weight: 800; letter-spacing: -0.02em;
  color: #064e3b;
  font-family: 'JetBrains Mono','SF Mono',ui-monospace,monospace;
}
.svev-ratio[data-tone="good"] .svev-ratio-label { color: #047857; }
.svev-ratio[data-tone="mid"]  .svev-ratio-label { color: #b45309; }
.svev-ratio[data-tone="bad"]  .svev-ratio-label { color: #b91c1c; }

.svev-ratio-tip {
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
.svev-ratio-tip-pct {
  font-size: 15px; font-weight: 800; letter-spacing: -0.01em;
  font-family: 'JetBrains Mono','SF Mono',ui-monospace,monospace;
  color: #ffffff;
}
.svev-ratio-tip-pct[data-tone="good"] { color: #6ee7b7; }
.svev-ratio-tip-pct[data-tone="mid"]  { color: #fcd34d; }
.svev-ratio-tip-pct[data-tone="bad"]  { color: #fca5a5; }
.svev-ratio-tip-meta {
  font-size: 10px; font-weight: 600; letter-spacing: 0.04em;
  text-transform: uppercase;
  opacity: 0.82;
}

.svev-ship-filter { display: flex; gap: 8px; flex-wrap: wrap; }
.svev-ship-fbtn {
  flex: 1; min-width: 160px;
  padding: 10px 18px;
  background: #fff;
  border: 1px solid rgba(16,185,129,.20);
  border-radius: 10px;
  color: #475569;
  font-size: 12.5px; font-weight: 700;
  cursor: pointer; transition: all .15s;
}
.svev-ship-fbtn:hover { background: #f0fdf4; color: #047857; }
.svev-ship-fbtn.is-active {
  background: linear-gradient(135deg, #047857, #10b981);
  color: #fff; border-color: transparent;
  box-shadow: 0 4px 12px rgba(16,185,129,.30);
}

/* ─── FOOTER ─── */
.svev-footer {
  flex-shrink: 0;
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 14px 24px;
  background: #fff;
  border-top: 1px solid #d1fae5;
}
.svev-footer-meta { font-size: 12px; color: #475569; }
.svev-footer-actions { display: flex; gap: 10px; }
.svev-btn {
  display: inline-flex; align-items: center; gap: 7px;
  padding: 9px 18px;
  border-radius: 10px;
  font-size: 12.5px; font-weight: 700;
  cursor: pointer; border: 1px solid transparent;
  transition: all .15s;
}
.svev-btn-light { background: #fff; color: #047857; border-color: rgba(16,185,129,.30); }
.svev-btn-light:hover { background: #ecfdf5; transform: translateY(-1px); box-shadow: 0 4px 12px rgba(16,185,129,.20); }
.svev-btn-dark  { background: linear-gradient(135deg, #064e3b, #047857); color: #fff; box-shadow: 0 4px 14px rgba(6,78,59,.30); }
.svev-btn-dark:hover  { transform: translateY(-1px); box-shadow: 0 8px 22px rgba(6,78,59,.45); }

/* ─── DARK MODE ─── */
[data-bs-theme="dark"] .svev-card { background: #0c2218; }
[data-bs-theme="dark"] .svev-groups-wrap { background: linear-gradient(180deg, #0c2218 0%, #102b21 100%); }
[data-bs-theme="dark"] .svev-group { background: #102b21; border-color: rgba(16,185,129,.30); }
[data-bs-theme="dark"] .svev-group:hover { background: #14352a; border-color: rgba(16,185,129,.5); }
[data-bs-theme="dark"] .svev-group.is-active { background: linear-gradient(120deg,#064e3b,#047857); border-color: #10b981; }
[data-bs-theme="dark"] .svev-group-icon { background: rgba(16,185,129,.20); color: #6ee7b7; border-color: rgba(16,185,129,.3); }
[data-bs-theme="dark"] .svev-group.is-active .svev-group-icon { background: rgba(255,255,255,.18); color: #fff; }
[data-bs-theme="dark"] .svev-group-title { color: #d1fae5; }
[data-bs-theme="dark"] .svev-group-sub { color: #8fbfa6; }
[data-bs-theme="dark"] .svev-tabs-wrap { background: linear-gradient(180deg, #0c2218 0%, #102b21 100%); border-bottom-color: rgba(16,185,129,.22); }
[data-bs-theme="dark"] .svev-tab { background: #102b21; border-color: rgba(16,185,129,.28); color: #6ee7b7; box-shadow: 0 1px 2px rgba(0,0,0,0.30); }
[data-bs-theme="dark"] .svev-tab-icon { background: rgba(16,185,129,.18); color: #6ee7b7; }
[data-bs-theme="dark"] .svev-tab:hover { border-color: rgba(110,231,183,.50); color: #d1fae5; box-shadow: 0 6px 16px rgba(0,0,0,.30); }
[data-bs-theme="dark"] .svev-tab:hover .svev-tab-icon { background: rgba(16,185,129,.32); color: #d1fae5; }
[data-bs-theme="dark"] .svev-tab.is-active { background: linear-gradient(135deg, #047857 0%, #10b981 55%, #6ee7b7 100%); color: #fff; border-color: transparent; }
[data-bs-theme="dark"] .svev-tab.is-active .svev-tab-icon { background: rgba(255,255,255,0.22); color: #fff; }
[data-bs-theme="dark"] .svev-tab-count { background: rgba(16,185,129,.22); color: #6ee7b7; }
[data-bs-theme="dark"] .svev-tab.is-active .svev-tab-count { background: rgba(255,255,255,.28); color: #fff; }
[data-bs-theme="dark"] .svev-kpi-outer { background: linear-gradient(180deg, #0c2218 0%, #102b21 100%); border-bottom-color: rgba(16,185,129,.22); }
[data-bs-theme="dark"] .svev-kpi-fade-l { background: linear-gradient(90deg,  #0c2218 0%, #0c2218 25%, rgba(12,34,24,0) 100%); }
[data-bs-theme="dark"] .svev-kpi-fade-r { background: linear-gradient(270deg, #102b21 0%, #102b21 25%, rgba(16,43,33,0) 100%); }
[data-bs-theme="dark"] .svev-kpi-nav { background: linear-gradient(135deg, #143829 0%, #0c2218 100%); color: #6ee7b7; box-shadow: 0 2px 6px rgba(0,0,0,.40), 0 8px 22px rgba(0,0,0,.50), inset 0 0 0 1px rgba(16,185,129,.30); }
[data-bs-theme="dark"] .svev-kpi-nav:hover { background: linear-gradient(135deg, #047857, #10b981); color: #fff; }
[data-bs-theme="dark"] .svev-kpi-tile { background: #102b21; border-color: rgba(16,185,129,.28); box-shadow: 0 2px 10px rgba(0,0,0,0.30); }
[data-bs-theme="dark"] .svev-kpi-tile:hover { border-color: rgba(16,185,129,.45); box-shadow: 0 6px 18px rgba(0,0,0,0.40); }
[data-bs-theme="dark"] .svev-kpi-label { color: #94a3b8; }
[data-bs-theme="dark"] .svev-kpi-value { color: #d1fae5; }
[data-bs-theme="dark"] .svev-body { background: #0c2218; scrollbar-color: #047857 transparent; }
[data-bs-theme="dark"] .svev-body::-webkit-scrollbar-thumb { background: #047857; }
[data-bs-theme="dark"] .svev-body::-webkit-scrollbar-thumb:hover { background: #10b981; }
[data-bs-theme="dark"] .svev-section { background: linear-gradient(110deg, rgba(16,185,129,.14), rgba(110,231,183,.10)); border-color: rgba(16,185,129,.30); }
[data-bs-theme="dark"] .svev-section-title { color: #d1fae5; }
[data-bs-theme="dark"] .svev-section-sub { color: #6ee7b7; }
[data-bs-theme="dark"] .svev-section-count { color: #d1fae5; }
[data-bs-theme="dark"] .svev-section-count-label { color: #6ee7b7; }
[data-bs-theme="dark"] .svev-table-wrap { background: #102b21; border-color: rgba(16,185,129,.28); }
[data-bs-theme="dark"] .svev-table thead th {
  background:
    linear-gradient(180deg, rgba(16,185,129,.22) 0%, rgba(16,185,129,.16) 55%, rgba(6,78,59,.18) 100%);
  color: #6ee7b7;
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,0.08),
    inset 0 -1px 0 rgba(16,185,129,0.40),
    0 4px 10px -8px rgba(0,0,0,0.40);
}
[data-bs-theme="dark"] .svev-table tbody td { color: #e2e8f0; border-bottom-color: rgba(16,185,129,.10); }
[data-bs-theme="dark"] .svev-table tbody tr:hover td { background: rgba(16,185,129,.06); }
[data-bs-theme="dark"] .svev-doc-name { color: #d1fae5; }
[data-bs-theme="dark"] .svev-mono { color: #e2e8f0; }
[data-bs-theme="dark"] .svev-date { background: rgba(16,185,129,.16); color: #6ee7b7; }
[data-bs-theme="dark"] .svev-date-expiry[data-status="expiring"] { background: rgba(245,158,11,.18); color: #fcd34d; }
[data-bs-theme="dark"] .svev-date-expiry[data-status="pending"]  { background: rgba(239,68,68,.18); color: #fca5a5; }
[data-bs-theme="dark"] .svev-attach { background: rgba(16,185,129,.16); color: #6ee7b7; border-color: rgba(16,185,129,.30); }
[data-bs-theme="dark"] .svev-chip-pill { background: rgba(16,185,129,.16); color: #6ee7b7; }
[data-bs-theme="dark"] .svev-chip-pill-warm { background: rgba(217,119,6,.18); color: #fcd34d; border-color: rgba(217,119,6,.30); }
[data-bs-theme="dark"] .svev-ratio-track { stroke: rgba(16,185,129,.22); }
[data-bs-theme="dark"] .svev-ratio-label { color: #d1fae5; }
[data-bs-theme="dark"] .svev-ratio[data-tone="good"] .svev-ratio-label { color: #6ee7b7; }
[data-bs-theme="dark"] .svev-ratio[data-tone="mid"]  .svev-ratio-label { color: #fcd34d; }
[data-bs-theme="dark"] .svev-ratio[data-tone="bad"]  .svev-ratio-label { color: #fca5a5; }
[data-bs-theme="dark"] .svev-footer { background: #0c2218; border-top-color: rgba(16,185,129,.22); }
[data-bs-theme="dark"] .svev-footer-meta { color: #cbd5e1; }
[data-bs-theme="dark"] .svev-btn-light { background: rgba(16,185,129,.12); color: #6ee7b7; border-color: rgba(16,185,129,.30); }
[data-bs-theme="dark"] .svev-btn-light:hover { background: rgba(16,185,129,.18); }
[data-bs-theme="dark"] .svev-ship-fbtn { background: #102b21; color: #94a3b8; border-color: rgba(16,185,129,.28); }
[data-bs-theme="dark"] .svev-ship-fbtn:hover { color: #6ee7b7; background: rgba(16,185,129,.10); }
[data-bs-theme="dark"] .svev-filter-verified { background: rgba(16,185,129,.18); color: #6ee7b7; border-color: rgba(16,185,129,.30); }
[data-bs-theme="dark"] .svev-filter-expiring { background: rgba(245,158,11,.18); color: #fcd34d; border-color: rgba(217,119,6,.30); }
[data-bs-theme="dark"] .svev-filter-pending  { background: rgba(239,68,68,.18);  color: #fca5a5; border-color: rgba(239,68,68,.30); }

/* ─── RESPONSIVE ─── */
@media (max-width: 1440px) { .svev-card { width: min(1100px, 92vw); } }
@media (max-width: 1280px) { .svev-card { width: 92vw; } }
@media (max-width: 960px) {
  .svev-card { width: 96vw; }
  .svev-header { padding: 12px 14px; }
  .svev-header-title { font-size: 16px; }
  .svev-vault-icon { width: 38px; height: 38px; border-radius: 10px; }
  .svev-header-content { flex-direction: column; align-items: flex-start; gap: 10px; }
  .svev-header-right { width: 100%; justify-content: space-between; }
  .svev-kpi-strip { padding: 12px 52px; gap: 8px; }
  .svev-kpi-tile { flex: 0 0 190px; padding: 10px 12px; }
  .svev-kpi-value { font-size: 20px; }
  .svev-kpi-icon { width: 32px; height: 32px; font-size: 15px; }
  .svev-kpi-fade { width: 50px; }
  .svev-kpi-nav { width: 30px; height: 30px; font-size: 16px; }
  .svev-kpi-nav-prev { left: 10px; }
  .svev-kpi-nav-next { right: 10px; }
  .svev-groups-wrap { padding: 12px 14px 0; }
  .svev-groups { grid-template-columns: 1fr; gap: 10px; }
  .svev-tabs-wrap { padding: 10px 14px; }
  .svev-tab { padding: 7px 14px 7px 7px; font-size: 12.5px; gap: 7px; }
  .svev-tab-icon { width: 24px; height: 24px; font-size: 13px; }
  .svev-body { padding: 14px 16px 18px; gap: 12px; }
  .svev-section { padding: 12px 14px; }
  .svev-section-count { font-size: 22px; }
  .svev-footer { flex-direction: column; align-items: stretch; gap: 10px; }
  .svev-footer-actions { display: flex; gap: 8px; }
  .svev-footer-actions .svev-btn { flex: 1; justify-content: center; }
  .svev-header-orb { display: none; }
  .svev-header-bg::after { display: none; }
}
@media (max-width: 640px) {
  .svev-card { width: 100vw; }
  .svev-kpi-tile { flex: 0 0 170px; }
  .svev-tab { padding: 6px 12px 6px 6px; font-size: 11.5px; }
  .svev-tab-icon { width: 22px; height: 22px; font-size: 12px; }
  .svev-tab-count { font-size: 9.5px; padding: 1px 6px; }
}
`;
