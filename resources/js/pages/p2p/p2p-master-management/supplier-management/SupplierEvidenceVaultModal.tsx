import { Fragment, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
/* TYPE-only. The runtime values are imported inside the export handler below,
   so 155 KB of zip machinery is fetched when someone clicks Export — not when
   the vault opens, and certainly not when the supplier LIST opens. A type
   import is erased at compile time and pulls in nothing. */
import type JSZipType from 'jszip';
import api from '../../../../api';
import Tooltip from '../../../../components/ui/Tooltip';
import { MasterDatePicker } from '../../../../components/ui/MasterDatePicker';
import { useToast } from '../../../../contexts/ToastContext';
import { resolveFileUrl } from '../../../../utils/resolveFileUrl';
import { signatureRequestsToVaultDocs, mergeTradeDocuments, type SigReqRow } from '../../../../utils/vaultSignatureRows';
import { downloadFile } from '../../../../utils/downloadFile';
import SalesCustomerSendForSignatureModal from '../../../sales/core-masters/customer/SalesCustomerSendForSignatureModal';
import { CEV_CSS } from '../../../sales/core-masters/customer/CustomerEvidenceVaultModal';
/* AddVendorModal's styles are no longer a string this file can inject — they
   are a real stylesheet that module imports, so importing SegmentRefUploadPopup
   from it already pulls them in. */
import { SegmentRefUploadPopup } from './AddVendorModal';
import { SigningTrackerModal } from '../../../sales/opportunity-pipeline/SigningTrackerModal';

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
  /* Vendor type master name ("Material Supplier", "Service Provider", …).
     Shown as its own header chip when the caller knows it. */
  type?: string;
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
  /* Fired after the vault re-fetches itself following a change made INSIDE it
   * (document upload / re-upload). Lets a host screen — e.g. the Create-PO
   * wizard's Supplier Legal Status card — refresh its own copy of the same
   * compliance figures instead of staying stale until a page reload. */
  onVaultChange?: () => void;
}

/* Lets the deeply-nested row actions hide their Upload button without prop drilling. */
const VaultViewOnlyCtx = createContext(false);

type TabKey = 'company-dd' | 'owner-kyc' | 'trade-licenses' | 'trade-documents' | 'shipment-agreements';

/* Top-level grouping — see CustomerEvidenceVaultModal for the rationale.
 *   • standard      — KYC, DD, Trade Licenses (one-time party docs)
 *   • case-to-case  — Trade Documents, Agreements (per-deal records) */
type GroupKey = 'standard' | 'case-to-case';

const GROUPS: { key: GroupKey; title: string; sub: string; icon: string; overview: string }[] = [
  { key: 'standard',     title: 'Standard Documents',                  sub: 'ONE TIME · KYC, DD & LICENSES',      icon: 'ri-shield-check-line', overview: 'All Standard Document Overview' },
  { key: 'case-to-case', title: 'Case to Case Documents & Agreements', sub: 'PER DEAL · TRADE DOCS & AGREEMENTS', icon: 'ri-todo-line',         overview: 'All Case Document Overview' },
];

const TABS: { key: TabKey; label: string; icon: string; countKey: keyof VaultData; group: GroupKey }[] = [
  { key: 'company-dd',          label: 'Company Due Diligence', icon: 'ri-shield-check-line',   countKey: 'company_dd_count',       group: 'standard' },
  { key: 'owner-kyc',           label: 'Owner KYC Details',     icon: 'ri-user-3-line',         countKey: 'owner_kyc_count',        group: 'standard' },
  { key: 'trade-licenses',      label: 'Trade Licenses',        icon: 'ri-file-list-3-line',    countKey: 'trade_license_count',    group: 'standard' },
  { key: 'trade-documents',     label: 'Trade Documents',       icon: 'ri-article-line',        countKey: 'trade_documents_count',  group: 'case-to-case' },
  { key: 'shipment-agreements', label: 'Agreements',            icon: 'ri-truck-line',          countKey: 'total_shipments',        group: 'case-to-case' },
];


/* ─── Empty vault — the zero-state used until the live payload lands, and
 *      when the fetch fails or the supplier has no saved record yet. There is
 *      deliberately NO demo data: an empty vault must read as empty, never as
 *      a set of plausible-looking rows a reviewer could mistake for real
 *      compliance evidence. Without this the `!vault` guard below returned
 *      null and the modal simply never opened while the fetch was in flight. */
const EMPTY_VAULT: VaultData = {
  total_documents:         0,
  verified_signed:         0,
  pending:                 0,
  company_dd_count:        0,
  owner_kyc_count:         0,
  trade_license_count:     0,
  trade_documents_count:   0,
  total_shipments:         0,
  company_dd:              [],
  owner_kyc:               [],
  trade_licenses:          [],
  trade_documents:         [],
  shipment_agreements:     [],
  vendor_with_shipment:    [],
  vendor_without_shipment: [],
  vendor_deal_ratios:      null,
  last_updated:            '—',
};

export default function SupplierEvidenceVaultModal({ open, supplier, onClose, data, viewOnly = false, onVaultChange }: Props) {
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
   * to EMPTY_VAULT if the fetch fails or the supplier has no db_id
   * (unsaved record) — never to demo rows. */
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

  /* Always-current `onVaultChange` in a ref — keeps `reloadVault` stable. */
  const onVaultChangeRef = useRef(onVaultChange);
  onVaultChangeRef.current = onVaultChange;

  /* Re-fetch helper — invoked by the Actions column after a successful
   * re-upload so the row's attachment_url refreshes in place. */
  const reloadVault = useCallback(() => {
    if (!supplier?.db_id) return Promise.resolve();
    setLoading(true);
    return api.get(`/segment-uploads/supplier/${supplier.db_id}/vault`)
      .then(r => {
        setVaultLive((r.data?.data ?? null) as VaultData | null);
        // Tell the host screen the vault moved so its own compliance figures
        // (e.g. the PO wizard's Supplier Legal Status card) re-read the same
        // endpoint — read through a ref so adding the callback never changes
        // this function's identity, which is threaded into every row action.
        onVaultChangeRef.current?.();
      })
      .catch(() => { /* keep prior state on transient errors */ })
      .finally(() => setLoading(false));
  }, [supplier?.db_id]);

  /* Fetch the vault payload when the modal opens. Skips when (a) the
   * parent passed an override via `data` or (b) supplier has no
   * db_id. Failure leaves vaultLive at null, and the vault then renders
   * as EMPTY_VAULT rather than inventing rows. */
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
    /* Priority: explicit `data` prop > live API > empty vault. No demo
     * fallback — an unloaded or failed vault reads as genuinely empty. */
    const base = data ?? vaultLive ?? EMPTY_VAULT;
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
    // Guard: if not a single uploaded file exists anywhere in the vault, don't
    // build an empty ZIP (of placeholder .txt files) — tell the user instead.
    const everyDoc: VaultDoc[] = [
      ...(vault.company_dd ?? []),
      ...(vault.owner_kyc ?? []),
      ...(vault.trade_licenses ?? []),
      ...(vault.vendor_with_shipment ?? []).flatMap(d => [...(d.docs ?? []), ...(d.agreements ?? [])]),
      ...(vault.vendor_without_shipment ?? []).flatMap(d => [...(d.docs ?? []), ...(d.agreements ?? [])]),
    ];
    if (!everyDoc.some(d => d.attachment_url)) {
      toast.info('Nothing to export', 'There are no uploaded documents in this vault yet.');
      return;
    }
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

      /* Both libraries land here, on the click, in parallel. */
      const [{ default: JSZip }, { saveAs }] = await Promise.all([
        import('jszip'),
        import('file-saver'),
      ]);
      const zip = new JSZip();
      // Drop every doc with a file into `folder`, numbered to avoid name clashes.
      const addDocs = async (folder: JSZipType, docs: VaultDoc[]) => {
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
  const StatusPill = ({ s }: { s: VaultStatus | 'Expired' }) => {
    const tone =
      s === 'Verified' ? { bg: '#ecfdf5', fg: '#059669', mark: '✓' }
      : s === 'Signed'   ? { bg: '#dbeafe', fg: '#1e40af', mark: '✓' }
      : s === 'Expiring' ? { bg: '#fef3c7', fg: '#92400e', mark: '⚠' }
      : s === 'Expired'  ? { bg: '#fef2f2', fg: '#b91c1c', mark: '⌛' }
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
  // else is "pending". Drives the uploaded / pending split on the stat cards.
  const isUploaded = (d: VaultDoc) => !!(d.attachment_url || (d.attachment && d.attachment !== '—'));

  /* ─── Stat-card figures.
   *
   * "Standard documents" is the three one-time buckets added together, and
   * every ring on that strip is measured against that same whole — so the
   * cards read as parts of one total rather than six unrelated numbers.
   * Uploaded / pending are derived from the rows themselves, which is the
   * only way to show a per-bucket split the API doesn't hand us. */
  const stdAll: VaultDoc[] = [...vault.company_dd, ...vault.owner_kyc, ...vault.trade_licenses];
  const upOf = (rows: VaultDoc[]) => rows.filter(isUploaded).length;
  const stdTotal = stdAll.length;
  const stdUp    = upOf(stdAll);
  const stdPend  = stdTotal - stdUp;
  const splitOf  = (rows: VaultDoc[]) => ({ up: upOf(rows), pend: rows.length - upOf(rows) });

  /* Case-to-case: signature progress across the deals in the active view.
   * Deals whose documents have not loaded contribute nothing rather than a
   * guess — an empty strip is honest, invented counts are not. */
  const dealRows  = shipmentIdMode === 'with' ? (vault.vendor_with_shipment ?? []) : (vault.vendor_without_shipment ?? []);
  const dealDocs  = dealRows.flatMap(r => r.docs ?? []);
  const dealAgrs  = dealRows.flatMap(r => r.agreements ?? []);
  const caseAll   = [...dealDocs, ...dealAgrs];
  const isSigned  = (d: VaultDoc) => d.status === 'Signed' || (d.sig_state ?? '').toLowerCase() === 'completed';
  const caseSigned  = caseAll.filter(isSigned).length;
  const caseWaiting = caseAll.filter(d => d.signature_request_id && !isSigned(d)).length;
  const caseUnsent  = caseAll.filter(d => !d.signature_request_id).length;

  /* Section-banner pills follow the row statuses, so an expiring document is
   * called out instead of being folded into "uploaded". */
  const statusTally = {
    Verified: docsForTab.filter(d => evEffectiveStatus(d) === 'Verified').length,
    Signed:   docsForTab.filter(d => evEffectiveStatus(d) === 'Signed').length,
    Expiring: docsForTab.filter(d => evEffectiveStatus(d) === 'Expiring').length,
    Expired:  docsForTab.filter(d => evEffectiveStatus(d) === 'Expired').length,
    Pending:  docsForTab.filter(d => evEffectiveStatus(d) === 'Pending').length,
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

        /* ══ Supplier vault skin (.sev) ═══════════════════════════════════
           Scoped to this modal on purpose: .cev-* is shared with the Customer
           and Consignee vaults, and they are not part of this redesign. */
        .cev-card.sev{width:min(1380px,88vw);}

        /* HEADER — deep teal hero, code-led title, translucent tag row. */
        .sev .cev-header{background:linear-gradient(125deg,#083344 0%,#0c4a6e 25%,#0e7490 50%,#0891b2 75%,#06b6d4 100%);min-height:82px;}
        /* Eyebrow — pale cyan on the teal hero, led by a short rule, as .ev-hd-label. */
        .sev .cev-header-eyebrow{display:flex;align-items:center;gap:7px;font-size:8px;font-weight:700;letter-spacing:.2em;text-transform:uppercase;color:rgba(165,243,252,.8);margin-bottom:3px;}
        .sev .cev-header-eyebrow::before{content:'';width:20px;height:1.5px;border-radius:2px;background:linear-gradient(90deg,rgba(165,243,252,.65),transparent);}
        .sev .cev-header-title{font-size:24px;letter-spacing:-.6px;line-height:1.2;display:flex;align-items:baseline;gap:9px;flex-wrap:wrap;text-shadow:0 2px 20px rgba(6,182,212,.45);}
        .sev .sev-hd-code{font-family:'JetBrains Mono',ui-monospace,Menlo,Consolas,monospace;font-size:22px;font-weight:800;letter-spacing:-.02em;color:#a5f3fc;}
        .sev .sev-hd-dash{font-size:19px;font-weight:400;color:rgba(207,250,254,.5);}
        .sev .sev-hd-nm{min-width:0;}
        .sev .cev-header-chips{gap:6px;margin-top:7px;}
        .sev .cev-chip{font-size:9.5px;font-weight:600;padding:3px 10px;border-radius:6px;letter-spacing:.02em;-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);background:rgba(255,255,255,.09);border:1px solid rgba(255,255,255,.18);color:rgba(207,250,254,.85);}
        .sev .cev-chip-link{background:rgba(6,182,212,.18);border-color:rgba(6,182,212,.38);color:#a5f3fc;}
        .sev .cev-chip-risk[data-risk="low"]{background:rgba(16,185,129,.18);border-color:rgba(52,211,153,.38);color:#6ee7b7;}
        .sev .cev-chip-risk[data-risk="medium"]{background:rgba(245,158,11,.18);border-color:rgba(251,191,36,.4);color:#fde68a;}
        .sev .cev-chip-risk[data-risk="high"]{background:rgba(239,68,68,.2);border-color:rgba(248,113,113,.45);color:#fecaca;}
        @media (max-width:900px){
          .sev .cev-header-title{font-size:19px;gap:7px;}
          .sev .sev-hd-code{font-size:17px;}
          .sev .sev-hd-dash{font-size:15px;}
        }

        /* GROUP CARDS now open the body, so they carry the top band's wash. */
        .sev .cev-groups-wrap{position:relative;background:linear-gradient(180deg,#f4f5fb 0%,#fbfbfe 100%);padding:15px 18px 13px;border-bottom:1.5px solid #e8eaf5;}
        /* The accent line carries on from the header. It used to ride on the KPI
           strip; the group cards lead the body now, so it rides on them. */
        .sev .cev-groups-wrap::before{content:'';position:absolute;top:0;left:0;right:0;height:2.5px;z-index:2;background:linear-gradient(90deg,#0e7490,#0891b2,#06b6d4,#67e8f9,#06b6d4,#0891b2,#0e7490);background-size:200% 100%;animation:cevStatsAccent 4s linear infinite;}

        /* STAT CARDS */
        .sev .sev-stats{display:flex;align-items:stretch;gap:8px;flex-shrink:0;padding:9px 14px 10px;background:linear-gradient(180deg,#f7fafc 0%,#ffffff 100%);border-bottom:1.5px solid #e8eaf5;}
        .sev .sev-stat{flex:1;min-width:0;position:relative;overflow:hidden;display:flex;flex-direction:column;align-items:flex-start;text-align:left;gap:1px;padding:8px 10px 9px;border-radius:12px;background:linear-gradient(150deg,var(--evTint,#ecfeff) 0%,#ffffff 78%);border:1px solid var(--evEdge,#a5f3fc);box-shadow:0 1px 2px rgba(8,51,68,.05);transition:transform .2s cubic-bezier(.22,1,.36,1),box-shadow .2s;}
        .sev .sev-stat:hover{transform:translateY(-2px);box-shadow:0 8px 18px -8px rgba(8,51,68,.32);}
        .sev .sev-stat-ico{width:22px;height:22px;border-radius:7px;display:flex;align-items:center;justify-content:center;background:#fff;color:var(--evTone,#0891b2);border:1px solid var(--evEdge,#a5f3fc);box-shadow:0 1px 3px rgba(8,51,68,.08);font-size:12px;}
        .sev .sev-stat-dial{position:absolute;top:8px;right:9px;display:flex;flex-direction:column;align-items:center;gap:2px;}
        .sev .sev-stat-ring{width:26px;height:26px;overflow:visible;}
        .sev .sev-stat-ring circle{fill:none;stroke-linecap:round;}
        .sev .sev-stat-ring .rg-bg{stroke:var(--evTone,#0891b2);opacity:.18;stroke-width:3.4;}
        .sev .sev-stat-ring .rg-fg{stroke:var(--evTone,#0891b2);stroke-width:3.4;stroke-dasharray:100;transition:stroke-dashoffset .6s cubic-bezier(.22,1,.36,1);}
        .sev .sev-stat:hover .sev-stat-ring .rg-fg{filter:drop-shadow(0 1px 3px rgba(8,51,68,.25));}
        .sev .sev-stat-frac{font-family:'JetBrains Mono',ui-monospace,Menlo,Consolas,monospace;font-size:7.5px;font-weight:700;letter-spacing:-.02em;line-height:1;color:var(--evInk,#0e7490);opacity:.85;font-variant-numeric:tabular-nums;white-space:nowrap;}
        .sev .sev-stat-label{margin-top:13px;padding-right:2px;font-size:7.5px;font-weight:800;letter-spacing:.07em;text-transform:uppercase;color:var(--evInk,#0e7490);line-height:1.25;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}
        .sev .sev-stat-val{font-size:20px;font-weight:800;color:#0f2b3d;line-height:1.05;font-variant-numeric:tabular-nums;letter-spacing:-.03em;}
        .sev .sev-stat-tag{margin-top:2px;font-size:7px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:var(--evInk,#0e7490);background:#fff;border:1px solid var(--evEdge,#a5f3fc);border-radius:20px;padding:1.5px 7px;white-space:nowrap;}
        .sev .sev-stat-split{display:flex;align-items:center;gap:4px;flex-wrap:wrap;margin-top:3px;}
        .sev .sev-split-up,.sev .sev-split-pd{font-size:7px;font-weight:800;letter-spacing:.03em;border-radius:20px;padding:1.5px 6px;white-space:nowrap;}
        .sev .sev-split-up{color:#047857;background:#ecfdf5;border:1px solid #a7f3d0;}
        .sev .sev-split-pd{color:#b91c1c;background:#fef2f2;border:1px solid #fecaca;}
        .sev .sev-split-up.is-zero,.sev .sev-split-pd.is-zero{color:#64748b;background:#f1f5f9;border-color:#dbe3ec;}
        /* One place per colour — wash, glyph, ring and text all read from it. */
        .sev .sev-stat--slate{--evTone:#3b82f6;--evTint:#eff6ff;--evEdge:#c7dbfb;--evInk:#1d4ed8;}
        .sev .sev-stat--teal {--evTone:#0891b2;--evTint:#ecfeff;--evEdge:#a5f3fc;--evInk:#0e7490;}
        .sev .sev-stat--green{--evTone:#10b981;--evTint:#ecfdf5;--evEdge:#a7f3d0;--evInk:#047857;}
        .sev .sev-stat--amber{--evTone:#f59e0b;--evTint:#fffbeb;--evEdge:#fcd34d;--evInk:#b45309;}
        .sev .sev-stat--red  {--evTone:#ef4444;--evTint:#fef2f2;--evEdge:#fecaca;--evInk:#b91c1c;}
        @media (max-width:1180px){
          .sev .sev-stat-val{font-size:18px;}
          .sev .sev-stat-label{font-size:7px;}
        }
        /* Seven cards do not fit a phone; let the strip scroll instead of
           squeezing every card down to an unreadable sliver. */
        @media (max-width:820px){
          .sev .sev-stats{overflow-x:auto;}
          .sev .sev-stat{flex:0 0 152px;}
        }

        /* Section banner — amber pill for the expiring bucket. */
        .sev .sev-sec-pill-warn{background:linear-gradient(135deg,#fffbeb,#fef3c7);color:#b45309;border:1px solid #fcd34d;}
        .sev .sev-sec-pill-warn .cev-sec-dot{background:#f59e0b;}

        /* Footer provenance line. */
        .sev .cev-footer-meta{display:flex;align-items:center;gap:10px;font-size:11px;color:#64748b;}
        .sev .sev-foot-upd strong{color:#0e7490;font-weight:800;}
        .sev .sev-foot-div{width:1px;height:12px;background:#cfe9f1;display:inline-block;}
        .sev .sev-foot-managed{display:inline-flex;align-items:center;gap:5px;font-size:10.5px;font-weight:600;color:#0e7490;}

        [data-bs-theme="dark"] .sev .sev-stats{background:#0b2530;border-bottom-color:rgba(148,197,255,.12);}
        [data-bs-theme="dark"] .sev .sev-stat{background:#102b36;border-color:rgba(148,197,255,.14);box-shadow:none;}
        [data-bs-theme="dark"] .sev .sev-stat-ico{background:#0b2530;}
        [data-bs-theme="dark"] .sev .sev-stat-val{color:#e7f2f7;}
        [data-bs-theme="dark"] .sev .sev-stat-tag{background:#0b2530;}
        [data-bs-theme="dark"] .sev .sev-split-up{background:rgba(16,185,129,.12);border-color:rgba(16,185,129,.3);color:#6ee7b7;}
        [data-bs-theme="dark"] .sev .sev-split-pd{background:rgba(239,68,68,.12);border-color:rgba(239,68,68,.3);color:#fca5a5;}
        [data-bs-theme="dark"] .sev .sev-split-up.is-zero,[data-bs-theme="dark"] .sev .sev-split-pd.is-zero{background:rgba(148,197,255,.08);border-color:rgba(148,197,255,.16);color:#93a7b8;}
        [data-bs-theme="dark"] .sev .cev-groups-wrap{background:#0d1f29;border-bottom-color:rgba(148,197,255,.12);}
        [data-bs-theme="dark"] .sev .cev-footer-meta{color:#9db2c4;}
        [data-bs-theme="dark"] .sev .sev-foot-div{background:rgba(148,197,255,.2);}

        /* HEADER ICON — translucent tile with the compliance tick badge. */
        .sev .cev-vault-icon{width:48px;height:48px;border-radius:14px;flex-shrink:0;position:relative;background:linear-gradient(135deg,rgba(255,255,255,.22),rgba(255,255,255,.08));border:1px solid rgba(255,255,255,.28);display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,.95);box-shadow:0 4px 20px rgba(0,0,0,.25),inset 0 1px 0 rgba(255,255,255,.3),0 0 0 4px rgba(255,255,255,.06);}
        .sev .cev-vault-icon-tick{position:absolute;top:-4px;right:-4px;width:16px;height:16px;border-radius:50%;background:linear-gradient(135deg,#10b981,#34d399);border:2.5px solid #083344;display:flex;align-items:center;justify-content:center;color:#fff;box-shadow:0 0 10px rgba(16,185,129,.7),0 2px 4px rgba(0,0,0,.2);}

        /* CHIP PALETTE — one tint per kind of fact. */
        .sev .cev-chip-seg,.sev .cev-chip-type,.sev .cev-chip-contact,.sev .cev-chip-city,.sev .cev-chip-country{background:rgba(255,255,255,.12);border-color:rgba(255,255,255,.22);color:#e2f7fc;}
        .sev .sev-chip-more{cursor:pointer;font-family:inherit;}
        .sev .sev-chip-more:hover{background:rgba(255,255,255,.22);}

        /* The reference header carries texture, not bubbles: the decorative
           orbs go, and the wash layer becomes the prototype's radial tints
           over a fine dot grid. */
        .sev .cev-header-orb{display:none;}
        .sev .cev-header-bg::before,.sev .cev-header-bg::after{display:none;}
        .sev .cev-header-bg{
          background:
            radial-gradient(circle, rgba(255,255,255,.06) 1px, transparent 1px) 0 0/20px 20px,
            radial-gradient(ellipse 55% 180% at 95% 50%, rgba(34,211,238,.22) 0%, transparent 60%),
            radial-gradient(ellipse 30% 100% at 10% 80%, rgba(6,182,212,.18) 0%, transparent 55%),
            radial-gradient(ellipse 20% 60% at 50% 0%, rgba(255,255,255,.07) 0%, transparent 60%);
        }
        /* Bottom shine line, as on .ev-hd. */
        .sev .cev-header-bg::after{display:block;content:'';position:absolute;bottom:0;left:0;right:0;top:auto;width:auto;height:1px;border-radius:0;box-shadow:none;background:linear-gradient(90deg,transparent 0%,rgba(103,232,249,.5) 30%,rgba(255,255,255,.35) 50%,rgba(103,232,249,.5) 70%,transparent 100%);}

        /* Close button — a rounded square that turns red on hover. */
        .sev .cev-close{width:28px;height:28px;border-radius:8px;flex-shrink:0;background:rgba(255,255,255,.18);border:1px solid rgba(255,255,255,.35);color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;transition:background .18s,border-color .18s,color .18s,transform .18s;}
        .sev .cev-close:hover{background:rgba(239,68,68,.4);border-color:rgba(248,113,113,.6);color:#fff;transform:scale(1.08);}
      `}</style>
      <div className="cev-card sev" onMouseDown={(e) => e.stopPropagation()}>
        {/* ─── HEADER ─── */}
        <div className="cev-header">
          <div className="cev-header-bg" aria-hidden />
          <span className="cev-header-orb" aria-hidden />
          <div className="cev-header-content">
            <div className="cev-header-left">
              <div className="cev-vault-icon">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="7" width="20" height="14" rx="2.5" />
                  <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" />
                  <line x1="12" y1="12" x2="12" y2="15" />
                  <circle cx="12" cy="16" r=".5" fill="currentColor" />
                </svg>
                <span className="cev-vault-icon-tick" aria-hidden>
                  <svg width="7" height="7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12" /></svg>
                </span>
              </div>
              <div className="cev-header-text">
                <div className="cev-header-eyebrow">SUPPLIER EVIDENCE VAULT</div>
                <div className="cev-header-title">
                  <span className="sev-hd-code">{supplier.id}</span>
                  <span className="sev-hd-dash" aria-hidden>—</span>
                  <span className="sev-hd-nm">{supplier.company}</span>
                </div>
                {/* Chip row — the supplier's identity at a glance: code, the
                    segments it deals in, its vendor type, who to talk to and
                    where they sit, then the risk grade. Each fact gets its own
                    chip so none of them hides inside a joined string. */}
                {(() => {
                  const segs = (supplier.segments && supplier.segments.length > 0
                    ? supplier.segments
                    : (supplier.segment ? [supplier.segment] : [])
                  ).map(s => String(s).trim()).filter(Boolean);
                  const chipSegs = segs.slice(0, 3);
                  const segRest  = segs.length - chipSegs.length;
                  const type = (supplier.type ?? '').trim();
                  // "Pending" is the list's placeholder for an unset type — a
                  // chip saying Pending reads as a status, so it is left out.
                  const showType = !!type && !/^(pending|-|—|n\/a)$/i.test(type);
                  const risk = (supplier.risk ?? 'Low').replace(/\s*risk$/i, '');
                  return (
                    <div className="cev-header-chips">
                      {/* No code chip — the title already leads with it. */}
                      {supplier.customerId && <span className="cev-chip cev-chip-link">↳ {supplier.customerId}</span>}
                      {chipSegs.map((s, i) => (
                        <Tooltip key={`${s}-${i}`} label={s}>
                          <span className="cev-chip cev-chip-seg">{s.length > 22 ? s.slice(0, 22) + '…' : s}</span>
                        </Tooltip>
                      ))}
                      {segRest > 0 && (
                        <button
                          type="button"
                          className="cev-chip cev-chip-seg sev-chip-more"
                          onClick={e => { const b = e.currentTarget.getBoundingClientRect(); setSegPop(prev => prev ? null : { names: segs, x: b.left, y: b.bottom + 6 }); }}
                        >+{segRest} more</button>
                      )}
                      {showType && <span className="cev-chip cev-chip-type">{type}</span>}
                      {supplier.contact && <span className="cev-chip cev-chip-contact">{supplier.contact}</span>}
                      {supplier.contactCity && <span className="cev-chip cev-chip-city">{supplier.contactCity}</span>}
                      {supplier.country && <span className="cev-chip cev-chip-country">{supplier.country}</span>}
                      <span className="cev-chip cev-chip-risk" data-risk={risk.toLowerCase()}>{risk} Risk</span>
                    </div>
                  );
                })()}
              </div>
            </div>
            <div className="cev-header-right">
              <button type="button" className="cev-close" onClick={onClose} aria-label="Close vault">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
          </div>
        </div>

        {showSkeleton ? <VaultSkeleton /> : (<div className="cev-scroll">
        {/* ─── GROUP CARDS — Standard Documents vs Case to Case. Leads the
             body: the stat strip below reports on whichever group is open. */}
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
                  <i className="ri-list-check-2" aria-hidden /> {g.overview}
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* ─── STAT CARDS — tinted wash per metric, glyph top-left, completion
             ring top-right, and the uploaded / pending split underneath. */}
        <div className="sev-stats">
          {group === 'standard' ? (<>
            <SevStat tone="slate" icon="ri-file-list-3-line"  label="Total Standard Documents" value={stdTotal} part={stdTotal} whole={stdTotal} split={{ up: stdUp, pend: stdPend }} />
            <SevStat tone="green" icon="ri-checkbox-circle-line" label="Verified / Uploaded"   value={stdUp}    part={stdUp}    whole={stdTotal} tag="Compliant" />
            <SevStat tone="red"   icon="ri-error-warning-line"   label="Pending"               value={stdPend}  part={stdPend}  whole={stdTotal} tag="Action needed" />
            <SevStat tone="teal"  icon="ri-home-4-line"          label="Company Due Diligence" value={vault.company_dd.length}     part={vault.company_dd.length}     whole={stdTotal} split={splitOf(vault.company_dd)} />
            <SevStat tone="teal"  icon="ri-user-3-line"          label="Owner KYC"             value={vault.owner_kyc.length}      part={vault.owner_kyc.length}      whole={stdTotal} split={splitOf(vault.owner_kyc)} />
            <SevStat tone="teal"  icon="ri-computer-line"        label="Trade License"         value={vault.trade_licenses.length} part={vault.trade_licenses.length} whole={stdTotal} split={splitOf(vault.trade_licenses)} />
          </>) : (<>
            <SevStat tone="slate" icon="ri-ship-line"            label="With Shipment ID Transactions" value={(vault.vendor_with_shipment ?? []).length} />
            <SevStat tone="slate" icon="ri-inbox-archive-line"   label="All Other Transactions"        value={(vault.vendor_without_shipment ?? []).length} />
            <SevStat tone="teal"  icon="ri-article-line"         label="Total Trade Documents"         value={dealDocs.length} part={dealDocs.length} whole={caseAll.length} />
            <SevStat tone="teal"  icon="ri-file-paper-2-line"    label="Total Agreements"              value={dealAgrs.length} part={dealAgrs.length} whole={caseAll.length} />
            <SevStat tone="green" icon="ri-checkbox-circle-line" label="Total Signed"                  value={caseSigned}  part={caseSigned}  whole={caseAll.length} tag="Complete" />
            <SevStat tone="amber" icon="ri-time-line"            label="Pending for Sign"              value={caseWaiting} part={caseWaiting} whole={caseAll.length} tag="Awaiting" />
            <SevStat tone="red"   icon="ri-mail-send-line"       label="Not Sent for Signature"        value={caseUnsent}  part={caseUnsent}  whole={caseAll.length} tag="Action needed" />
          </>)}
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
                  {statusTally.Verified > 0 && <span className="cev-sec-pill cev-sec-pill-ok"><span className="cev-sec-dot" />Verified {statusTally.Verified}</span>}
                  {statusTally.Signed > 0 && <span className="cev-sec-pill cev-sec-pill-ok"><span className="cev-sec-dot" />Signed {statusTally.Signed}</span>}
                  {statusTally.Expiring > 0 && <span className="cev-sec-pill sev-sec-pill-warn"><span className="cev-sec-dot" />Expiring {statusTally.Expiring}</span>}
                  {statusTally.Expired > 0 && <span className="cev-sec-pill cev-sec-pill-bad"><span className="cev-sec-dot" />Expired {statusTally.Expired}</span>}
                  {statusTally.Pending > 0 && <span className="cev-sec-pill cev-sec-pill-bad"><span className="cev-sec-dot" />Pending {statusTally.Pending}</span>}
                  <span className="cev-sec-pill cev-sec-pill-docs">{docsForTab.length} Document{docsForTab.length === 1 ? '' : 's'}</span>
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
          <div className="cev-footer-meta">
            <span className="sev-foot-upd">Last updated:&nbsp;<strong>{vault.last_updated || '—'}</strong></span>
            <span className="sev-foot-div" aria-hidden />
            <span className="sev-foot-managed"><i className="ri-shield-check-line" aria-hidden /> Vault managed by Compliance Team</span>
          </div>
          <div className="cev-footer-actions">
            <Tooltip label="Download all files as a foldered ZIP">
              <button type="button" className="cev-btn cev-btn-light" onClick={handleExportAll} disabled={exporting}>
                {exporting
                  ? <i className="ri-loader-4-line cev-spin" />
                  : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>}
                {exporting ? 'Exporting…' : 'Export All'}
              </button>
            </Tooltip>
            <button type="button" className="cev-btn cev-btn-dark" onClick={onClose}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              Close Vault
            </button>
          </div>
        </div>
      </div>

      {/* Send for Signature — launched from a Trade Documents row. The
          modal portals to <body>, so it overlays the vault cleanly.
          multiBox: the ONE resolved signer can be asked to sign the same
          document in several places (Legal Team #9 / BR-03 of the Multiple
          Signature Placements spec). It was held back here while the rest of
          the flows were proven; the spec puts every module in scope, so it is
          on. Single-signer trade-doc mode only. */}
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
        multiBox
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
                  <thead><tr><th style={{ width: 60 }}>SR NO</th><th>DOCUMENT NAME</th><th style={{ width: 130 }}>STATUS</th><th style={{ width: 130 }}>ACTION</th></tr></thead>
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
                          <td><StatusPill s={evEffectiveStatus(d)} /></td>
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
                <Tooltip label={name}>
                  <span className="cev-seg-pop-pill">{name.length > 20 ? name.slice(0, 20) + '…' : name}</span>
                </Tooltip>
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

/* ─── Stat card — the strip under the group cards. A tinted wash in the
 *      metric's own tone, its glyph top-left, a completion ring top-right
 *      reading "part / whole", then the label and figure. Either an uploaded
 *      / pending split or a single status tag closes the card.
 *
 *      pathLength=100 on both circles lets the arc be set in plain percent,
 *      so the maths never has to know the radius. */
function SevStat(props: {
  tone: 'slate' | 'teal' | 'green' | 'amber' | 'red';
  icon: string;
  label: string;
  value: number;
  part?: number;
  whole?: number;
  tag?: string;
  split?: { up: number; pend: number };
}): ReactNode {
  const whole = props.whole ?? 0;
  const part  = props.part ?? 0;
  const pct   = whole > 0 ? Math.max(0, Math.min(100, Math.round((part / whole) * 100))) : 0;
  return (
    <div className={`sev-stat sev-stat--${props.tone}`}>
      <span className="sev-stat-ico"><i className={props.icon} aria-hidden /></span>
      {whole > 0 && (
        <span className="sev-stat-dial">
          <svg className="sev-stat-ring" viewBox="0 0 40 40" aria-hidden>
            <circle className="rg-bg" cx="20" cy="20" r="16" pathLength={100} />
            <circle className="rg-fg" cx="20" cy="20" r="16" pathLength={100} transform="rotate(-90 20 20)" strokeDashoffset={100 - pct} />
          </svg>
          <span className="sev-stat-frac">{part}/{whole}</span>
        </span>
      )}
      <div className="sev-stat-label">{props.label}</div>
      <div className="sev-stat-val">{props.value.toLocaleString()}</div>
      {props.split ? (
        <div className="sev-stat-split">
          <span className={`sev-split-up ${props.split.up === 0 ? 'is-zero' : ''}`}>{props.split.up} uploaded</span>
          <span className={`sev-split-pd ${props.split.pend === 0 ? 'is-zero' : ''}`}>{props.split.pend} pending</span>
        </div>
      ) : props.tag ? <div className="sev-stat-tag">{props.tag}</div> : null}
    </div>
  );
}

/* ─── Loading skeleton — shimmer placeholders for the whole vault body
   (KPI ribbon, group cards, tabs, section banner, table). Shown on first
   load; once it clears, whatever the API returned is what renders. */
function VaultSkeleton() {
  return (
    <div className="cev-skel">
      {/* Group cards lead the real layout, so they lead the skeleton too. */}
      <div className="cev-skel-groups">
        <div className="cev-skel-group cev-sk" />
        <div className="cev-skel-group cev-sk" />
      </div>
      <div className="cev-skel-kpis">
        {Array.from({ length: 6 }).map((_, i) => <div key={i} className="cev-skel-kpi cev-sk" />)}
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
  // Figma column label for the reference/number cell — "Document Number" for
  // Owner KYC, "License / Number" for Company DD & Trade Licenses.
  const codeLbl = tab === 'owner-kyc' ? 'Document Number' : tab === 'trade-documents' ? 'Reference' : 'License / Number';
  /* Tab → SegmentDocUpload category for the re-upload endpoint. */
  const category: 'kyc' | 'dd' | 'tl' | 'td' = tab === 'company-dd' ? 'dd' : tab === 'owner-kyc' ? 'kyc' : tab === 'trade-licenses' ? 'tl' : 'td';
  return (
    <div className="cev-table-wrap">
      <div className="cev-table-scroll">

      {/* Columns (mirrors Figma): Sr No · Document Name · License/Number ·
          Issuing Authority · Issue Date · Expiry · Attachment · Status · Actions. */}
      <table className="cev-table">
        <thead>
          <tr>
            <th style={{ width: 56 }}>Sr No</th>
            {/* Pinned width. The table is width:100% with a 980px min-width, so
                whenever the row content is narrower than that the browser hands
                the slack to the widest auto column — Document Name. Owner KYC
                has the shortest values of the three standard tabs (KYC-001,
                "N/A" expiry, a 25-char-capped authority), so it collected almost
                all of it and opened a large empty gap beside the names, while
                Trade Licenses looked right (QA #67). Fixing the width makes all
                three tabs match and spreads any remaining slack across the other
                columns instead of pooling it in one. */}
            <th style={{ width: 220 }}>Document Name</th>
            <th>{codeLbl}</th>
            <th>{authorityLbl}</th>
            <th>Requirement</th>
            <th>Issue Date</th>
            <th>Expiry</th>
            <th>Attachment</th>
            <th>Status</th>
            <th style={{ width: 140 }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={10} className="cev-empty">No documents in this bucket yet.</td></tr>
          ) : rows.map((d, i) => (
            <tr key={`${d.doc_code ?? 'doc'}-${i}`}>
              <td>{i + 1}</td>
              <td className="cev-doc-name">{d.name}</td>
              <td className="cev-mono">{d.reference || d.doc_code || '—'}</td>
              <td>{d.authority && d.authority !== '—' ? <Tooltip label={d.authority}><span>{d.authority.length > 25 ? d.authority.slice(0, 25) + '…' : d.authority}</span></Tooltip> : '—'}</td>
              <td>
                {d.requirement === 'M' ? (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 800, background: '#dcfce7', color: '#15803d', border: '1px solid #bbf7d0', whiteSpace: 'nowrap' }}>★ Mandatory</span>
                ) : (
                  <span style={{ display: 'inline-flex', alignItems: 'center', padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: '#f1f5f9', color: '#64748b', border: '1px solid #e2e8f0', whiteSpace: 'nowrap' }}>Optional</span>
                )}
              </td>
              <td>{evFmtExpiry(d.issue_date)}</td>
              <td>{evFmtExpiry(d.expiry)}</td>
              <td>
                {d.attachment_url ? (
                  <a href={d.attachment_url} target="_blank" rel="noreferrer" className="cev-attach"><i className="ri-download-2-line" /> {d.attachment || 'View'}</a>
                ) : d.attachment ? (
                  <span className="cev-attach cev-attach-muted"><i className="ri-file-line" /> {d.attachment}</span>
                ) : <span style={{ color: '#9ca3af' }}>—</span>}
              </td>
              <td><VaultStatusPill status={evEffectiveStatus(d)} /></td>
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

/* Expiry helpers — parse whatever the row carries (yyyy-mm-dd, dd/mm/yyyy,
 * mm/yyyy, "Lifetime"/"N/A"/"—") and render it as "12-Jan-2027". */
const EV_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function evParseExpiry(s?: string | null): Date | null {
  if (!s) return null;
  const t = s.trim();
  if (/^(n\/a|—|-|lifetime|varies|)$/i.test(t)) return null;
  let m: RegExpMatchArray | null;
  if ((m = t.match(/^(\d{4})-(\d{2})-(\d{2})/)))          return new Date(+m[1], +m[2] - 1, +m[3]);
  if ((m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)))   return new Date(+m[3], +m[2] - 1, +m[1]); // dd/mm/yyyy
  if ((m = t.match(/^(\d{1,2})\/(\d{4})$/)))              return new Date(+m[2], +m[1] - 1, 1);     // mm/yyyy
  const d = new Date(t);
  return isNaN(d.getTime()) ? null : d;
}
function evFmtExpiry(s?: string | null): string {
  const d = evParseExpiry(s);
  if (!d) return s && s.trim() && s.trim() !== '-' ? s.trim() : '—';
  return `${String(d.getDate()).padStart(2, '0')}-${EV_MONTHS[d.getMonth()]}-${d.getFullYear()}`;
}
/* Vault expiry → ISO (yyyy-mm-dd) for MasterDatePicker, or '' when the row
 * carries no real date ("Lifetime", "N/A", "—", or anything unparseable).
 * The picker feeds its value straight into `new Date(...)`, so handing it a
 * label produces an Invalid Date and NaNs the whole day grid. */
function evExpiryIso(s?: string | null): string {
  const d = evParseExpiry(s);
  if (!d) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/* Effective status: a document whose expiry is already in the past reads as
 * "Expired" regardless of its stored status. */
function evEffectiveStatus(d: VaultDoc): VaultStatus | 'Expired' {
  const exp = evParseExpiry(d.expiry);
  if (exp) { const today = new Date(); today.setHours(0, 0, 0, 0); if (exp < today) return 'Expired'; }
  return d.status;
}

/* Status pill (Figma): Verified / Expiring / Pending / Signed / Expired — coloured dot + label. */
function VaultStatusPill({ status }: { status: VaultStatus | 'Expired' }) {
  const map: Record<VaultStatus | 'Expired', { bg: string; color: string; border: string; dot: string }> = {
    Verified: { bg: '#dcfce7', color: '#15803d', border: '#bbf7d0', dot: '#22c55e' },
    Expiring: { bg: '#fef3c7', color: '#b45309', border: '#fde68a', dot: '#f59e0b' },
    Pending:  { bg: '#fee2e2', color: '#dc2626', border: '#fecaca', dot: '#ef4444' },
    Signed:   { bg: '#cffafe', color: '#0e7490', border: '#a5f3fc', dot: '#06b6d4' },
    Expired:  { bg: '#fee2e2', color: '#b91c1c', border: '#fca5a5', dot: '#dc2626' },
  };
  const s = map[status] ?? map.Pending;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: s.bg, color: s.color, border: `1px solid ${s.border}`, whiteSpace: 'nowrap' }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: s.dot, flexShrink: 0 }} /> {status}
    </span>
  );
}

/* Bound a filename for the View/Download tooltips — a long no-space name
 * (e.g. "PO-PO_2026-27_003_unsigned_final.pdf") otherwise makes the tooltip
 * run off the screen edge. Keep the start + the extension, elide the middle. */
function clipFileName(s: string, max = 42): string {
  if (!s || s.length <= max) return s;
  const dot = s.lastIndexOf('.');
  const ext = dot > 0 && s.length - dot <= 6 ? s.slice(dot) : '';
  return s.slice(0, Math.max(1, max - ext.length - 1)) + '…' + ext;
}

/* View / Download / Re-upload actions. View opens the attachment in a new
 * tab; Download triggers a blob save; Re-upload posts to
 * /segment-uploads/{type}/{id} with the same (category, doc_code) tuple so
 * the existing row is replaced server-side. */
/* Re-upload / Upload popup for an Evidence Vault row. Shows the CURRENT file
 * (so the user sees what's already there), lets them pick a replacement, previews
 * the picked file, then saves. Mirrors the AddVendorModal SegmentRefUploadPopup. */
function VaultReuploadPopup({ doc, category, busy, onClose, onSubmit }: {
  doc: VaultDoc;
  category: 'kyc' | 'dd' | 'tl' | 'td' | 'agreement';
  busy: boolean;
  onClose: () => void;
  onSubmit: (f: File, opts?: { docName?: string; expiryDate?: string }) => void | Promise<void>;
}) {
  const toast = useToast();
  // Standard documents (Company DD / Owner KYC / Trade Licenses) get the rich
  // form (Auto Code · Document Name · Issuing Authority · Expiry) mirroring the
  // supplier Edit form's upload popup. Case-to-Case rows keep the plain uploader.
  const isStd = category === 'kyc' || category === 'dd' || category === 'tl';
  const noExpiry = (s?: string | null) => !s || /^(lifetime|n\/a|—|-|varies|)$/i.test(s.trim());
  const toISO = (s?: string | null) => {
    if (!s) return '';
    const t = s.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
    const m = t.match(/^(\d{2})[/-](\d{2})[/-](\d{4})$/);
    return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
  };
  const [file, setFile] = useState<File | null>(null);
  const [docName, setDocName] = useState(doc.name || '');
  const [hasExpiry, setHasExpiry] = useState(isStd && !noExpiry(doc.expiry));
  const [expiryDate, setExpiryDate] = useState(toISO(doc.expiry));
  const inputRef = useRef<HTMLInputElement | null>(null);
  const pick = (f: File | undefined) => {
    if (!f) return;
    if (!/\.(pdf|jpe?g|png)$/i.test(f.name)) {
      toast.error('Unsupported file type', 'Only PDF, JPG or PNG files are allowed.');
      return;
    }
    if (f.size > 2 * 1024 * 1024) {
      toast.error('File too large', f.name + ' exceeds the 2 MB limit.');
      return;
    }
    setFile(f);
  };
  const save = () => {
    if (!file) return;
    if (isStd && hasExpiry && !expiryDate) { toast.error('Expiry required', 'Pick an expiry date or set Expiry to “No”.'); return; }
    void onSubmit(file, isStd ? { docName, expiryDate: hasExpiry ? expiryDate : undefined } : undefined);
  };
  return createPortal(
    <div className="cev-reup-ov" onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <style>{CEV_REUP_CSS}</style>
      <div className="cev-reup-card" role="dialog" aria-modal="true">
        <div className="cev-reup-hd">
          <div className="cev-reup-hd-l">
            <span className="cev-reup-hd-ico"><i className="ri-upload-cloud-2-line" /></span>
            <div>
              <div className="cev-reup-ttl">{(doc.attachment ? 'Re-upload ' : 'Upload ') + (category === 'dd' ? 'Due Diligence' : category === 'kyc' ? 'Owner KYC' : category === 'tl' ? 'Trade License' : '') + ' Document'}</div>
              <div className="cev-reup-sub">{doc.name || doc.doc_code}</div>
            </div>
          </div>
          <button type="button" className="cev-reup-x" onClick={onClose} aria-label="Close" disabled={busy}><i className="ri-close-line" /></button>
        </div>
        <div className="cev-reup-bd">
          {isStd && (
            <div className="cev-reup-grid">
              <div className="cev-reup-fld">
                <label>Auto Code</label>
                <div className="cev-reup-ro cev-mono" style={{ color: '#d97706', fontWeight: 700 }}>{doc.reference || doc.doc_code || '—'}</div>
              </div>
              <div className="cev-reup-fld">
                <label>Document Name</label>
                <div className="cev-reup-ro">{doc.name || '—'}</div>
              </div>
              <div className="cev-reup-fld">
                <label>Issuing Authority</label>
                <div className="cev-reup-ro">{doc.authority && doc.authority !== '—' ? doc.authority : '—'}</div>
              </div>
              <div className="cev-reup-fld">
                <label>Expiry <span className="cev-reup-hint">Has an expiry date?</span></label>
                <div className="cev-reup-toggle">
                  <button type="button" className={hasExpiry ? 'on' : ''} onClick={() => setHasExpiry(true)}>Yes</button>
                  <button type="button" className={!hasExpiry ? 'on' : ''} onClick={() => { setHasExpiry(false); setExpiryDate(''); }}>No</button>
                </div>
                {hasExpiry && <div style={{ marginTop: 8 }}><MasterDatePicker value={expiryDate} onChange={setExpiryDate} placeholder="Select expiry date" minDate={new Date().toISOString().slice(0, 10)} /></div>}
              </div>
            </div>
          )}
          {doc.attachment && (
            <div className="cev-reup-fld">
              <label>Current File</label>
              <a className="cev-reup-cur" href={doc.attachment_url} target="_blank" rel="noreferrer"><i className="ri-file-text-line" /><span>{doc.attachment}</span></a>
            </div>
          )}
          <div className="cev-reup-fld">
            <label>Upload Document <span className="cev-reup-req">*</span></label>
            <input ref={inputRef} type="file" hidden accept=".pdf,.jpg,.jpeg,.png" onChange={e => { pick(e.target.files?.[0] ?? undefined); e.currentTarget.value = ''; }} />
            <button type="button" className={`cev-reup-drop${file ? ' has' : ''}`} onClick={() => inputRef.current?.click()}>
              <i className={file ? 'ri-file-check-line' : 'ri-upload-cloud-2-line'} />
              <span>{file ? file.name : 'Upload document (JPG / PNG / PDF, max 2 MB)'}</span>
            </button>
          </div>
        </div>
        <div className="cev-reup-ft">
          <button type="button" className="cev-reup-cancel" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="cev-reup-save" disabled={!file || busy} onClick={save}>
            {busy ? <><i className="ri-loader-4-line cev-spin" /> Uploading…</> : 'Save'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

const CEV_REUP_CSS = `
.cev-reup-ov { position:fixed; inset:0; z-index:100000; background:rgba(15,23,42,.5); display:flex; align-items:center; justify-content:center; padding:16px; }
.cev-reup-card { width:100%; max-width:640px; background:#fff; border-radius:16px; overflow:hidden; box-shadow:0 24px 60px rgba(8,40,60,.32); font-family:'DM Sans',system-ui,sans-serif; }
.cev-reup-hd { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; padding:16px 18px; background:linear-gradient(120deg,#6d28d9,#7c3aed 55%,#8b5cf6); color:#fff; }
.cev-reup-hd-l { display:flex; align-items:center; gap:12px; min-width:0; }
.cev-reup-hd-ico { width:40px; height:40px; border-radius:11px; flex-shrink:0; display:flex; align-items:center; justify-content:center; background:rgba(255,255,255,.18); color:#fff; font-size:20px; }
.cev-reup-ttl { font-size:15px; font-weight:800; }
.cev-reup-sub { font-size:12px; opacity:.85; margin-top:2px; }
.cev-reup-x { background:rgba(255,255,255,.18); border:none; color:#fff; width:30px; height:30px; border-radius:8px; cursor:pointer; display:flex; align-items:center; justify-content:center; font-size:18px; flex-shrink:0; }
.cev-reup-x:hover:not(:disabled) { background:rgba(255,255,255,.3); }
.cev-reup-bd { padding:18px; display:flex; flex-direction:column; gap:16px; }
.cev-reup-fld label { display:block; font-size:11px; font-weight:700; letter-spacing:0; text-transform:none; color:#3b0764; margin-bottom:6px; }
.cev-reup-req { color:#dc2626; }
.cev-reup-cur { display:inline-flex; align-items:center; gap:7px; max-width:100%; padding:8px 12px; border-radius:9px; background:#f5f3ff; border:1px solid #ddd6fe; color:#6d28d9; font-size:12.5px; font-weight:600; text-decoration:none; }
.cev-reup-cur span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.cev-reup-cur:hover { background:#ede9fe; }
.cev-reup-none { font-size:12.5px; color:#94a3b8; font-style:italic; }
.cev-reup-drop { width:100%; display:flex; align-items:center; gap:9px; padding:12px 14px; border-radius:10px; border:1.5px dashed #cbd5e1; background:#f8fafc; color:#64748b; font-family:inherit; font-size:12.5px; font-weight:600; cursor:pointer; text-align:left; }
.cev-reup-drop:hover { border-color:#8b5cf6; background:#faf5ff; color:#6d28d9; }
.cev-reup-drop.has { border-style:solid; border-color:#8b5cf6; background:#faf5ff; color:#6d28d9; }
.cev-reup-drop i { font-size:18px; flex-shrink:0; }
.cev-reup-drop span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.cev-reup-ft { display:flex; justify-content:flex-end; gap:10px; padding:14px 18px; border-top:1px solid #eef2f7; }
.cev-reup-cancel { padding:9px 18px; border-radius:9px; border:1.5px solid #e2e8f0; background:#fff; color:#475569; font-family:inherit; font-size:12.5px; font-weight:700; cursor:pointer; }
.cev-reup-cancel:hover:not(:disabled) { background:#f8fafc; }
.cev-reup-save { display:inline-flex; align-items:center; gap:7px; padding:9px 22px; border-radius:9px; border:none; background:linear-gradient(135deg,#6d28d9,#7c3aed 55%,#8b5cf6); color:#fff; font-family:inherit; font-size:12.5px; font-weight:700; cursor:pointer; }
.cev-reup-save:disabled, .cev-reup-cancel:disabled { opacity:.55; cursor:not-allowed; }
[data-bs-theme="dark"] .cev-reup-card { background:#0f2731; }
[data-bs-theme="dark"] .cev-reup-drop { background:#16303b; border-color:#2a4a56; color:#9db3c1; }
[data-bs-theme="dark"] .cev-reup-cur { background:rgba(139,92,246,.14); border-color:rgba(139,92,246,.35); color:#c4b5fd; }
[data-bs-theme="dark"] .cev-reup-ft { border-top-color:#1c3a45; }
[data-bs-theme="dark"] .cev-reup-cancel { background:#16303b; border-color:#2a4a56; color:#9db3c1; }
/* Rich fields (standard docs): Auto Code · Document Name · Issuing Authority · Expiry. */
.cev-reup-grid { display:grid; grid-template-columns:1fr 1fr; gap:14px; }
.cev-reup-ro { height:38px; padding:0 12px; border-radius:10px; background:#f7f4ff; border:1px solid #e4dcf7; color:#495057; font-family:inherit; font-size:13px; font-weight:400; display:flex; align-items:center; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; box-sizing:border-box; }
.cev-reup-in { width:100%; height:38px; padding:5px 12px; border-radius:10px; border:1px solid #e4dcf7; background:#f7f4ff; font-family:inherit; font-size:13px; font-weight:400; color:#495057; box-sizing:border-box; transition:border-color .18s ease, box-shadow .18s ease; }
.cev-reup-in:focus { outline:none; border-color:#7c3aed; box-shadow:0 0 0 3px rgba(124,58,237,.12); background:#fff; }
.cev-reup-hint { font-size:11px; font-weight:500; text-transform:none; letter-spacing:0; color:#94a3b8; margin-left:6px; }
.cev-reup-toggle { display:inline-flex; height:38px; border:1.5px solid #e9e2f7; background:#faf8ff; border-radius:9px; overflow:hidden; }
.cev-reup-toggle button { min-width:46px; padding:0 15px; border:none; border-right:1.5px solid #e9e2f7; background:transparent; color:#6b7280; font-family:inherit; font-size:13px; font-weight:600; cursor:pointer; transition:background .14s, color .14s; }
.cev-reup-toggle button:last-child { border-right:0; }
.cev-reup-toggle button:hover { background:#f1ebfe; color:#7c3aed; }
.cev-reup-toggle button.on { background:#7c3aed; color:#fff; }
.cev-mono { font-family:'Geist Mono',ui-monospace,Menlo,Consolas,monospace; }
[data-bs-theme="dark"] .cev-reup-ro { background:#16303b; border-color:#2a4a56; color:#cbd5e1; }
[data-bs-theme="dark"] .cev-reup-in { background:#16303b; border-color:#2a4a56; color:#e2e8f0; }
[data-bs-theme="dark"] .cev-reup-toggle { border-color:#2a4a56; }
[data-bs-theme="dark"] .cev-reup-toggle button { background:#16303b; color:#9db3c1; }
[data-bs-theme="dark"] .cev-reup-fld label { color:#c4b5fd; }
[data-bs-theme="dark"] .cev-reup-none { color:#7c93a8; }
[data-bs-theme="dark"] .cev-reup-cancel:hover:not(:disabled) { background:#1c3a45; }
@media (max-width:560px) { .cev-reup-grid { grid-template-columns:1fr; } }
`;

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
  const [reupOpen, setReupOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reminding, setReminding] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [trackerOpen, setTrackerOpen] = useState(false);
  const canTrack = !!doc.signature_request_id;
  const canViewOrDownload = !!doc.attachment_url;
  const canReupload = !!ownerId && !!doc.doc_code;
  // Standard docs reuse the supplier form's exact upload popup (SegmentRefUploadPopup)
  // so KYC / DD / Trade License all look identical to the "inside" Edit form.
  const isStdCat = category === 'kyc' || category === 'dd' || category === 'tl';
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

  const onPick = async (f: File | undefined, opts?: { docName?: string; expiryDate?: string }): Promise<boolean> => {
    if (!f || !ownerId || !doc.doc_code) return false;
    // Only PDF / JPG / PNG may be uploaded (Word / Excel are blocked so every
    // stored attachment can be previewed in-browser via View).
    if (!/\.(pdf|jpe?g|png)$/i.test(f.name)) {
      toast.error('Unsupported file type', 'Only PDF, JPG or PNG files are allowed. Word / Excel files are not supported.');
      return false;
    }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('category', category);
      fd.append('doc_code', doc.doc_code);
      fd.append('doc_name', (opts?.docName?.trim()) || doc.name || doc.doc_code);
      if (opts?.expiryDate) fd.append('expiry_date', opts.expiryDate);
      fd.append('attachment', f);
      await api.post(`/segment-uploads/${ownerType}/${ownerId}`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      await onReload();
      toast.success('Document uploaded', `${f.name} has been attached.`);
      return true;
    } catch (e: any) {
      toast.error('Upload failed', e?.response?.data?.message || 'The file could not be uploaded. Please try again.');
      return false;
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="cev-row-actions">
      {reupOpen && (isStdCat ? (
        <>
          {/* The vault modal sits at z-index 11400; lift the reused popup's
              backdrop above it so it opens ON TOP, not behind the vault — and the
              date-picker calendar (default 11100) above the popup.
              MasterDatePicker.css sets the calendar's z-index via
              `div.master-datepicker-popup` (specificity 0,1,1) with !important, so a
              plain `.master-datepicker-popup` override loses and the calendar stays
              trapped under this backdrop. `html div...` (0,1,2) wins outright. */}
          <style>{'.avm-cp-backdrop{z-index:13000!important;}html div.master-datepicker-popup{z-index:13100!important;}'}</style>
          <SegmentRefUploadPopup
            title={category === 'dd' ? 'DD Document Name' : category === 'kyc' ? 'Owner KYC Document Name' : 'Trade License Document Name'}
            row={{ code: doc.reference || doc.doc_code || '', name: doc.name, authority: doc.authority, requirement: (doc.requirement as 'M' | 'O') || 'M' }}
            existing={doc.attachment ? { file: null, url: doc.attachment_url || '', name: doc.attachment, expiry: evExpiryIso(doc.expiry) || undefined } : undefined}
            onClose={() => setReupOpen(false)}
            onSubmit={async (f, expiryDate) => { const ok = await onPick(f, { expiryDate }); if (ok) setReupOpen(false); }}
          />
        </>
      ) : (
        <VaultReuploadPopup
          doc={doc}
          category={category}
          busy={busy}
          onClose={() => setReupOpen(false)}
          onSubmit={async (f, opts) => { const ok = await onPick(f, opts); if (ok) setReupOpen(false); }}
        />
      ))}
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
      {canTrack && (
        <Tooltip label="Signing activity tracker">
          <button
            type="button"
            onClick={() => setTrackerOpen(true)}
            className="cev-row-act cev-row-act-track"
            aria-label="Signing activity tracker"
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: 28, height: 28, borderRadius: 6,
              background: '#ede9fe', color: '#6d28d9', border: '1px solid #ddd6fe',
              cursor: 'pointer',
            }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
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
      <Tooltip label={canViewOrDownload ? `View ${clipFileName(doc.attachment)}` : 'No attachment yet'}>
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
      <Tooltip label={!canViewOrDownload ? 'No attachment yet' : (downloading ? 'Downloading…' : `Download ${clipFileName(doc.attachment)}`)}>
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
          tab (category 'td') AND on CTC Agreement rows (category
          'agreement') — those rows are driven by the signature flow
          (Send / Reminder / signed-file View), not manual file
          attachment. Standard tabs (KYC / DD / Trade Licenses) keep it.
          Also hidden in viewOnly mode (e.g. from a With-PO SPI). */}
      {category !== 'td' && category !== 'agreement' && !viewOnly && (
      <Tooltip label={canReupload ? (busy ? 'Uploading…' : (doc.attachment ? 'Re-upload (replace file)' : 'Upload')) : 'Save the record first'}>
        <button
          type="button"
          disabled={!canReupload || busy}
          onClick={() => setReupOpen(true)}
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
  // Declined / recalled read as such (until re-sent) instead of collapsing to Pending.
  if (d.sig_state === 'declined' || d.sig_state === 'rejected') return { label: 'Declined', c: ['#fef2f2', '#b91c1c', '#fecaca', '#ef4444'] };
  if (d.sig_state === 'recalled') return { label: 'Recalled', c: ['#fffbeb', '#92400e', '#fde68a', '#f59e0b'] };
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
