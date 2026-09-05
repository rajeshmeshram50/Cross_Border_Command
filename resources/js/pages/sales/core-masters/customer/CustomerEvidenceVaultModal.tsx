import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import api from '../../../../api';
import Tooltip from '../../../../components/ui/Tooltip';
import AuthorityBadges from '../../../clm/compliance/AuthorityBadges';
import { CLM_CSS } from '../../../clm/shared/clmShared';
import { useToast } from '../../../../contexts/ToastContext';
import { resolveFileUrl } from '../../../../utils/resolveFileUrl';
import { signatureRequestsToVaultDocs, mergeTradeDocuments, overlayShipmentSigStatus, type SigReqRow } from '../../../../utils/vaultSignatureRows';
import { downloadFile, saveApiBlob } from '../../../../utils/downloadFile';
import SalesCustomerSendForSignatureModal, {
  type AgreementContext, type AgreementSigner, type AgreementSendRow, type SendForSignatureCustomer,
} from './SalesCustomerSendForSignatureModal';
import { SigningTrackerModal } from '../../opportunity-pipeline/SigningTrackerModal';
import SalesDocSendForSignatureModal from '../../opportunity-pipeline/matrix/stages/SalesDocSendForSignatureModal';

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
  /** Mandatory / Optional per the segment DCP rules — drives the
   *  Requirement column (matches the Edit Customer form's table). */
  requirement?: 'M' | 'O' | null;
  /** URL to the Zoho-issued Certificate of Completion. Set on rows
   *  that came from a completed Zoho Sign request; renders the
   *  certificate icon button in the Actions column. */
  certificate_url?: string | null;
}

/** One document inside a shipment's Buyer/Consignee sub-table. */
export interface VaultShipmentDoc {
  sig_req_id: number;
  /** Signature request id of ANY status (sent / signed / declined / recalled) —
   *  drives the Signing Tracker button. `sig_req_id` above stays completed/active
   *  only (legacy Send/Remind gating). */
  signature_request_id?: number | null;
  sig_state?: string | null;
  /** Library id — clm_agreement_library.id or clm_trade_doc_library.id.
   *  Set on applicable (not-yet-sent) rows so the Send button can launch
   *  Send-for-Signature for the exact document. */
  db_id?: number | null;
  /** 'agreement' | 'trade_doc' — which library db_id points at; drives the
   *  Send-for-Signature mode. */
  doc_type?: string | null;
  name: string;
  required: string;                // REQ | OPT
  status: 'Signed' | 'Pending' | 'Declined' | 'Recalled' | 'Expired' | 'Draft';
  uploaded_on: string;
  valid_upto: string;
  signed_url?: string | null;
  /** Set ONLY on the Proforma Invoice row: its own PI id + code, so the vault
   *  can offer the same "Send for Signature" flow as the Sales-Matrix Q/PI
   *  stage (kind='pi'). Presence of pi_id marks the row as the PI. */
  pi_id?: number | null;
  pi_code?: string | null;
}

export interface VaultShipmentRow {
  id: number;
  shipment_id: string;             // SHP-2026-00487
  opportunity_id: string;          // OPP-107
  customer: string;
  consignee?: string;
  country: string;
  due_dil:    { ratio: string; pct: number };   // "2/2"  + 100
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
  /** True when this vault is for a consignee flagged "Same as Customer"
   *  (its docs mirror the linked customer). Drives a header badge + a
   *  disabled upload action — direct uploads to such a consignee 409. */
  same_as_customer?:      boolean;
  total_documents:        number;
  verified_signed:        number;
  pending:                number;
  company_dd_count:       number;
  owner_kyc_count:        number;
  trade_license_count:    number;
  trade_documents_count:  number;
  agreements_count:       number;
  total_shipments:        number;
  company_dd:             VaultDoc[];
  owner_kyc:              VaultDoc[];
  trade_licenses:         VaultDoc[];
  trade_documents:        VaultDoc[];
  /** Top-level Agreements bucket — segment-applicable agreements for the entity
   *  (customer/consignee) or vendor, overlaid with signature status. Used by the
   *  single-bucket ClmDocsPopup 'agr' view (NOT the per-shipment vault tab). */
  agreements?:            VaultDoc[];
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
  /** Optional override — lets a parent supply an already-fetched vault
   *  payload instead of letting this modal fetch its own. When omitted
   *  (the usual case) the modal fetches, and falls back to EMPTY_VAULT. */
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

/* ─── Empty vault — the zero-state used until the live payload lands, and
 *      when the fetch fails or the customer has no saved record yet. There is
 *      deliberately NO demo data: an empty vault must read as empty, never as
 *      a set of plausible-looking rows a reviewer could mistake for real
 *      compliance evidence. The loading skeleton covers the fetch itself, so
 *      this is only ever on screen when there is genuinely nothing to show. */
const EMPTY_VAULT: VaultData = {
  total_documents:       0,
  verified_signed:       0,
  pending:               0,
  company_dd_count:      0,
  owner_kyc_count:       0,
  trade_license_count:   0,
  trade_documents_count: 0,
  agreements_count:      0,
  total_shipments:       0,
  company_dd:            [],
  owner_kyc:             [],
  trade_licenses:        [],
  trade_documents:       [],
  agreements:            [],
  shipment_agreements:   [],
  last_updated:          '—',
};

export default function CustomerEvidenceVaultModal({ open, customer, onClose, data, initialTab }: Props) {
  const toast = useToast();
  const [tab, setTab] = useState<TabKey>('company-dd');
  const [group, setGroup] = useState<GroupKey>('standard');
  // A document upload is in flight → block tab switches and closing the vault,
  // so the user can't navigate away or dismiss the modal mid-upload (which would
  // abort the request). Ref-counted so overlapping uploads don't clear it early.
  const uploadingRef = useRef(0);
  const [uploading, setUploading] = useState(false);
  const onRowBusyChange = useCallback((busy: boolean) => {
    uploadingRef.current = Math.max(0, uploadingRef.current + (busy ? 1 : -1));
    setUploading(uploadingRef.current > 0);
  }, []);
  /* "+N more" segment overflow popover — a titled list (matches the CLM pages'
   * authority/segment popovers), opened on click from the header chip. */
  const [segPop, setSegPop] = useState<{ names: string[]; x: number; y: number } | null>(null);
  // "Document Overview" popup — set to a group key to open the all-docs list.
  const [overview, setOverview] = useState<GroupKey | null>(null);
  // Document-overview pagination (5 rows per page) + selected shipment tab
  // (case-to-case overview shows one shipment's docs at a time).
  const [overviewPage, setOverviewPage] = useState(1);
  const [ovShip, setOvShip] = useState<number | null>(null);
  // Row currently being downloaded in the Document Overview (server streaming
  // can take a few seconds — show a spinner so the user knows it's working).
  const [ovDownloadingKey, setOvDownloadingKey] = useState<string | null>(null);
  const [shipmentFilter, setShipmentFilter] = useState<'buyer-eq-consignee' | 'buyer-neq-consignee'>('buyer-eq-consignee');

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
  /* Shipment Send-for-Signature — launches the preview + signature-box wizard
   * for one not-yet-sent shipment document. */
  const [shipSend, setShipSend] = useState<{ leadId: number; doc: VaultShipmentDoc; party: 'buyer' | 'consignee' } | null>(null);
  // The PI row uses the Sales-Matrix Q/PI Send-for-Signature modal, not the
  // library-doc one — routed by doc.pi_id.
  const [piSend, setPiSend] = useState<{ leadId: number; doc: VaultShipmentDoc } | null>(null);

  /* Close on Escape — destructive shortcut is fine for a read-only
   * panel since there's no in-flight edit to lose. */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && uploadingRef.current === 0) onClose(); };
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

  /* Initialise the active tab/group — ONLY when the modal opens (or the target
   * customer / deep-link tab changes), so the user's manual tab choice sticks.
   * Deliberately NOT dependent on `onClose`: that's a fresh closure on every
   * parent render, and including it reset the active tab back to the default
   * whenever the parent re-rendered (e.g. on a background refresh) — which made
   * Case-to-Case snap back to Standard on its own. */
  useEffect(() => {
    if (!open) return;
    // Open on the caller-requested tab (deep-link from the Buyer Profile
    // progress cells), falling back to the first tab — and sync the group
    // card to whichever group that tab lives in.
    const startTab = initialTab ?? 'company-dd';
    setTab(startTab);
    setGroup(groupOfTab(startTab));
    setShipmentFilter('buyer-eq-consignee');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, customer?.db_id, initialTab]);

  /* Fetch the vault payload when the modal opens for a new customer.
   * Skips the fetch when (a) the parent passed an override via `data`
   * or (b) customer has no db_id (unsaved record). On failure the
   * `vaultLive` stays null and the vault renders as EMPTY_VAULT rather
   * than inventing rows. */
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
    /* Source priority: explicit `data` prop > live API > empty vault.
     * No demo fallback — when the API hasn't run yet, errors out, or the
     * customer has no db_id, the vault reads as genuinely empty. */
    const base = data ?? vaultLive ?? EMPTY_VAULT;
    if (!base) return null;
    // Trade Documents tab = the party's expected trade docs (segment-rule
    // td, party-filtered to mirror the edit form) merged with their live
    // Zoho Sign status. Each row exposes Send-for-Signature; signed rows
    // also carry the signed PDF + certificate links.
    const sigRows            = signatureRequestsToVaultDocs(signatureRows);
    const baseSegmentTd      = (base.trade_documents ?? []) as VaultDoc[];
    const mergedTd           = mergeTradeDocuments(baseSegmentTd as any, sigRows, 'buyer') as unknown as VaultDoc[];
    // Overlay the FRESHLY-SYNCED signature status onto the shipment deal docs.
    // The vault endpoint (buildDeals) reads the DB status without a Zoho sync,
    // so a just-declined doc can still read "Pending" there; signatureRows were
    // fetched with sync=1, so they carry the authoritative latest status.
    const overlaidShipments = overlayShipmentSigStatus(base.shipment_agreements ?? [], signatureRows);
    return {
      ...base,
      // The header KPIs (Total Documents / Verified / Pending / Trade Documents /
      // Total Agreements) are computed authoritatively by the backend from the
      // Standard + Case-to-Case document families, so they pass through
      // unchanged. We still merge the segment-rule TD bucket with live
      // signatures for the Export workbook's Trade Documents sheet.
      trade_documents: mergedTd as typeof base.trade_documents,
      shipment_agreements: overlaidShipments as typeof base.shipment_agreements,
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
        'Customer = Consignee': s.buyer_is_consignee ? 'Yes' : 'No',
      });

      const summary = [
        { Field: 'Customer ID',           Value: customer.id },
        { Field: 'Company',               Value: customer.company },
        { Field: 'Risk',                  Value: customer.risk ?? 'Low' },
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

  /* ─── Filter chips above each docs table (Verified / Expiring /
   *      Pending) — pure counters from the bucket data. */
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

  /* Tab badge count. Trade Documents / Agreements are shipment-wise, so
   * their badge must reflect the real number of trade docs / agreements
   * across all shipments (sum of each shipment's ratio total) — not the
   * standard-doc KPI. Standard tabs keep their own count key. */
  const ratioTotal = (ratio: string) => { const p = (ratio || '').split('/'); return parseInt(p[1] ?? p[0], 10) || 0; };
  const shipmentDocCount = (key: 'trade_docs' | 'agreement') =>
    vault.shipment_agreements.reduce((acc, r) => acc + ratioTotal(r[key].ratio), 0);
  const tabCount = (t: typeof TABS[number]): number =>
    t.key === 'trade-documents'     ? shipmentDocCount('trade_docs')
    : t.key === 'shipment-agreements' ? shipmentDocCount('agreement')
    : (vault[t.countKey] as number);

  /* Show the skeleton only on the FIRST load (live data not in yet and no
   * explicit data prop). Re-fetches after that keep the current content
   * visible — no skeleton flash. Until live data lands the vault holds
   * EMPTY_VAULT, so the skeleton is what covers the gap. */
  const showSkeleton = loading && !vaultLive && !data;

  return createPortal(
    <div className="cev-overlay" role="dialog" aria-modal="true" onMouseDown={(e) => { if (e.target === e.currentTarget && !uploading) onClose(); }}>
      <style>{CEV_CSS}</style>
      {/* CLM shared styles — powers the teal AuthorityBadges "+N" popover on the
          issuing-authority column, matching the CLM masters / Supplier vault. */}
      <style>{CLM_CSS}</style>
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
                <div className="cev-header-eyebrow">— PARTY WISE CLM: CUSTOMER EVIDENCE VAULT</div>
                <div className="cev-header-title">{customer.company}</div>
                <div className="cev-header-chips">
                  {customer.contact && (
                    <span className="cev-chip cev-chip-contact">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                      {customer.contact}{customer.contactCity ? ` · ${customer.contactCity}` : ''}
                    </span>
                  )}
                  <span className="cev-chip cev-chip-id">● {customer.id}</span>
                  <span className="cev-chip cev-chip-risk"  data-risk={(customer.risk ?? 'Low').toLowerCase()}>● {customer.risk ?? 'Low'} Risk</span>
                </div>
              </div>
            </div>
            <div className="cev-header-right">
              <div className="cev-header-meta">
                {customer.type && <span>{customer.type}</span>}
                {customer.segment && (() => {
                  /* Cap the inline segment list at 5; the rest collapse into a
                   * "+N more" chip whose tooltip lists every segment, so a
                   * customer with many segments no longer overflows the header. */
                  const segs = String(customer.segment).split(',').map(s => s.trim()).filter(Boolean);
                  if (segs.length === 0) return null;
                  const shown = segs.slice(0, 5);
                  const extra = segs.length - shown.length;
                  /* Truncate each individual segment name (long free-text
                   * segments blow out the header) with a tooltip carrying the
                   * full value — mirrors the Supplier Evidence Vault header. */
                  return (
                    <span>
                      · {shown.map((s, i) => (
                        <Tooltip key={`${s}-${i}`} label={s}>
                          <span>{i > 0 ? ', ' : ''}{s.length > 20 ? s.slice(0, 20) + '…' : s}</span>
                        </Tooltip>
                      ))}
                      {extra > 0 && (
                        <button
                          type="button"
                          className="cev-seg-more"
                          onClick={e => { const b = e.currentTarget.getBoundingClientRect(); setSegPop(prev => prev ? null : { names: segs, x: b.left, y: b.bottom + 6 }); }}
                        >+{extra} more</button>
                      )}
                    </span>
                  );
                })()}
                {customer.country && <span>· {customer.country}</span>}
              </div>
              <button type="button" className="cev-close" onClick={() => { if (!uploading) onClose(); }} disabled={uploading} title={uploading ? 'Please wait — an upload is in progress' : 'Close vault'} style={uploading ? { opacity: .5, cursor: 'not-allowed' } : undefined} aria-label="Close vault">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
          </div>
        </div>

        {showSkeleton ? <VaultSkeleton /> : (<>
        {/* ─── KPI STRIP — auto-scrolling ribbon. Drifts continuously,
             pauses on hover/touch, with manual prev/next arrows for
             accessible control. Edge fade-masks soften the boundary
             where tiles meet the arrow buttons. */}
        <div className="cev-kpi-outer">
          {/* Static full-width stat row — all columns fit without scrolling
              (matches the CLM prototype: flat columns split by thin dividers). */}
          <div className="cev-kpi-strip">
            <KpiTile label="Total Documents"        value={vault.total_documents}        accent="#0e7490" />
            <KpiTile label="Verified / Signed"      value={vault.verified_signed}        accent="#16a34a" subtitle="✓ COMPLIANT" subTone="good" />
            <KpiTile label="Pending"                value={vault.pending}                accent="#dc2626" subtitle="⚠ ACTION"    subTone="bad" />
            <KpiTile label="Company Due Diligence"  value={vault.company_dd_count}       accent="#0891b2" />
            <KpiTile label="Owner KYC"              value={vault.owner_kyc_count}        accent="#0e7490" />
            <KpiTile label="Trade License"          value={vault.trade_license_count}    accent="#0891b2" />
            <KpiTile label="Trade Documents"        value={vault.trade_documents_count}  accent="#0d9488" />
            <KpiTile label="Total Agreements"       value={vault.agreements_count}       accent="#0891b2" />
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

        {/* ─── SUB-TABS — pill ribbon for the active group. */}
        <div className="cev-tabs-wrap">
          <div className="cev-tabs">
            {TABS.filter(t => t.group === group).map(t => (
              <button
                key={t.key}
                type="button"
                className={`cev-tab ${tab === t.key ? 'is-active' : ''}`}
                onClick={() => { if (!uploading) setTab(t.key); }}
                disabled={uploading}
                title={uploading ? 'Please wait — an upload is in progress' : undefined}
                style={uploading && tab !== t.key ? { opacity: .5, cursor: 'not-allowed' } : undefined}
              >
                <span className="cev-tab-icon"><i className={t.icon} aria-hidden /></span>
                <span className="cev-tab-label">{t.label}</span>
                <span className="cev-tab-count">{tabCount(t)}</span>
              </button>
            ))}
          </div>
        </div>

        {/* ─── BODY ─── */}
        {/* Shipment tabs add a Buyer=/≠Consignee toggle between the section and
            the table, so they use the "separated cards" layout (spacing around
            the toggle); flat doc tabs keep the section fused to the table. */}
        <div className={`cev-body ${(tab === 'shipment-agreements' || tab === 'trade-documents') ? 'cev-body-ship' : ''}`}>
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
              {(tab === 'shipment-agreements' || tab === 'trade-documents') ? (
                <span className="cev-sec-pill cev-sec-pill-docs">{vault.total_shipments} Shipments</span>
              ) : (
                <>
                  {counts.Uploaded > 0 && <span className="cev-sec-pill cev-sec-pill-ok"><span className="cev-sec-dot" />Uploaded {counts.Uploaded}</span>}
                  {counts.Pending > 0 && <span className="cev-sec-pill cev-sec-pill-bad"><span className="cev-sec-dot" />Pending {counts.Pending}</span>}
                </>
              )}
            </div>
          </div>

          {/* Tables — Trade Documents + Agreements are shipment-ID-wise
              (expandable Buyer / Consignee sub-tables); the standard-doc tabs
              stay as flat document tables. */}
          {(tab === 'shipment-agreements' || tab === 'trade-documents')
            ? <ShipmentTable rows={vault.shipment_agreements} kind={tab === 'trade-documents' ? 'trade' : 'agreement'} filter={shipmentFilter} setFilter={setShipmentFilter}
                             onSend={(leadId, doc, party) => { if (doc.pi_id) setPiSend({ leadId, doc }); else setShipSend({ leadId, doc, party }); }} activeSend={shipSend ?? (piSend ? { ...piSend, party: 'buyer' } : null)} />
            : <DocsTable rows={docsForTab} tab={tab} ownerType="customer" ownerId={customer?.db_id ?? null} onReload={reloadVault}
                         onSendTradeDoc={(d) => { if (d.db_id) setSendDocIds([d.db_id]); }}
                         onRemindTradeDoc={handleRemind} onRowBusyChange={onRowBusyChange} />}
        </div>
        </>)}

        {/* ─── FOOTER ─── */}
        <div className="cev-footer">
          <div className="cev-footer-meta" />
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
            <button type="button" className="cev-btn cev-btn-dark" onClick={() => { if (!uploading) onClose(); }} disabled={uploading} title={uploading ? 'Please wait — an upload is in progress' : undefined} style={uploading ? { opacity: .6, cursor: 'not-allowed' } : undefined}>
              {uploading ? 'Uploading…' : 'Close Vault'}
            </button>
          </div>
        </div>
      </div>

      {/* Send for Signature — launched from a Case-to-Case Trade Documents
          row. The modal portals to <body>, so it overlays the vault cleanly.
          multiBox: the ONE resolved signer can be asked to sign the same doc in
          up to 3 places (Legal Team #9 — a counterparty must be able to sign
          more than once in a document). Single-signer trade-doc mode only; the
          agreement / role flows are untouched. */}
      <SalesCustomerSendForSignatureModal
        open={Array.isArray(sendDocIds)}
        customer={customer?.db_id ? {
          id:      customer.id,
          db_id:   customer.db_id,
          company: customer.company,
          contact: customer.contact,
        } : null}
        modelName="Customer"
        multiBox
        preselectedDocIds={sendDocIds ?? undefined}
        onClose={() => setSendDocIds(null)}
        onSent={() => { setSendDocIds(null); void reloadSignatures(); }}
      />

      {/* Shipment Send-for-Signature — opens the preview + draggable signature
          box directly for the clicked doc. On send it reloads the vault so the
          row flips Draft → Pending. */}
      <ShipmentDocSendForSignature
        target={shipSend}
        onClose={() => setShipSend(null)}
        onSent={() => { setShipSend(null); void reloadVault(); void reloadSignatures(); }}
      />

      {/* Proforma Invoice Send-for-Signature — the SAME Zoho-sign flow the
          Sales-Matrix Q/PI stage uses (kind='pi'), launched from the PI row's
          Send action in the Trade Documents shipment table. */}
      {piSend && piSend.doc.pi_id && (
        <SalesDocSendForSignatureModal
          open={!!piSend}
          kind="pi"
          docId={piSend.doc.pi_id}
          docCode={piSend.doc.pi_code ?? null}
          leadId={piSend.leadId}
          customerName={customer?.company ?? null}
          onClose={() => setPiSend(null)}
          onSent={() => { setPiSend(null); void reloadVault(); void reloadSignatures(); }}
        />
      )}

      {/* Document Overview popup — all documents for the chosen group in one
          flat list (name + status + download). Opened from the "Document
          Overview" button on each group card. */}
      {overview && (() => {
        const isStd = overview === 'standard';
        // Match the inline panel: when Customer = Consignee only the buyer set
        // applies (the Consignee/Both tabs are hidden), so the overview must not
        // list the consignee-side docs — otherwise they appear as extra rows
        // that don't belong to the shipment. A both-party doc is returned in both
        // lists, so de-dupe the union (else it shows twice).
        const ovKey = (d: VaultShipmentDoc) => (d.db_id != null ? `${d.doc_type ?? ''}#${d.db_id}` : `n#${d.name}#${d.sig_req_id}`);
        const dedupeDocs = (list: VaultShipmentDoc[]): VaultShipmentDoc[] => {
          const seen = new Set<string>();
          return list.filter((d) => { const k = ovKey(d); if (seen.has(k)) return false; seen.add(k); return true; });
        };
        const shipDocsOf = (r: VaultShipmentRow): VaultShipmentDoc[] => r.buyer_is_consignee
          ? [
              ...(r.trade_docs_buyer ?? []),
              ...(r.agreements_buyer ?? []),
            ]
          : dedupeDocs([
              ...(r.trade_docs_buyer ?? []),
              ...(r.trade_docs_consignee ?? []),
              ...(r.agreements_buyer ?? []),
              ...(r.agreements_consignee ?? []),
            ]);
        const shipments = isStd ? [] : vault.shipment_agreements;
        // Case-to-Case: shipments are shown as horizontal tabs; the active
        // shipment's Trade Documents + Agreements are listed below (paginated
        // like the Standard list).
        const shipsWithDocs = isStd ? [] : shipments.filter((r) => shipDocsOf(r).length > 0);
        const activeShip = isStd ? null : (shipsWithDocs.find((r) => r.id === ovShip) ?? shipsWithDocs[0] ?? null);
        const docs: (VaultDoc | VaultShipmentDoc)[] = isStd
          ? [...vault.company_dd, ...vault.owner_kyc, ...vault.trade_licenses]
          : (activeShip ? shipDocsOf(activeShip) : []);
        const title = isStd ? 'Standard Documents — Overview' : 'Case to Case Agreements — Overview';
        const sub = isStd
          ? 'All Company Due Diligence, Owner KYC & Trade Licenses documents in one list'
          : 'Trade Documents & Agreements — pick a shipment';
        // No pagination — the full list scrolls inside the fixed-height body
        // after ~5 rows (see .cev-ov-body max-height + sticky header).
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
              {/* Case-to-Case: horizontal, scrollable shipment tabs. Click one
                  to load that shipment's documents in the table below. */}
              {!isStd && shipsWithDocs.length > 0 && (
                <div className="cev-ov-shiptabs">
                  {shipsWithDocs.map((r) => (
                    <button
                      type="button"
                      key={r.id}
                      className={`cev-ov-shiptab ${activeShip?.id === r.id ? 'is-active' : ''}`}
                      onClick={() => { setOvShip(r.id); setOverviewPage(1); }}
                    >
                      <i className="ri-truck-line" aria-hidden /> {r.shipment_id}
                      <span className="cev-ov-shiptab-opp">{r.opportunity_id}</span>
                    </button>
                  ))}
                </div>
              )}
              <div className="cev-ov-body">
                <table className="cev-ov-table">
                  <thead><tr><th style={{ width: 64 }}>SR NO</th><th>DOCUMENT NAME</th><th style={{ width: 130 }}>STATUS</th><th style={{ width: 130 }}>ACTION</th></tr></thead>
                  <tbody>
                    {docs.length === 0 ? (
                      <tr><td colSpan={4} className="cev-ov-empty">{isStd ? 'No documents available.' : (shipsWithDocs.length === 0 ? 'No shipment documents available.' : 'No documents for this shipment.')}</td></tr>
                    ) : docs.map((d, i) => {
                      const absIdx = i;
                      const raw = isStd ? (d as VaultDoc).attachment_url : (d as VaultShipmentDoc).signed_url;
                      const url = raw ? resolveFileUrl(raw) : null;
                      const fname = isStd ? ((d as VaultDoc).attachment || `${d.name}.pdf`) : `${d.name}.pdf`;
                      return (
                        <tr key={`${activeShip?.id ?? 'std'}-${absIdx}`}>
                          <td className="cev-ov-num">{absIdx + 1}</td>
                          {/* 35 to match the shipment doc panel — the Document
                              Name column is the widest here too, and a full PI
                              name ("Proforma Invoice (PI/2026-27/29)") is 32
                              characters, so 25 hid the PI number itself. */}
                          <Tooltip label={d.name} disabled={(d.name || '').length <= 35}>
                            <td className="cev-ov-name">{(d.name || '').length > 35 ? (d.name || '').slice(0, 35) + '…' : d.name}</td>
                          </Tooltip>
                          <td><StatusPill s={d.status as VaultStatus} /></td>
                          <td>
                            {(() => {
                              const dlKey = `${activeShip?.id ?? 'std'}-${absIdx}`;
                              const dling = ovDownloadingKey === dlKey;
                              return (
                                <button
                                  type="button"
                                  className="cev-ov-dl"
                                  disabled={!url || dling}
                                  onClick={async () => {
                                    if (!url) return;
                                    setOvDownloadingKey(dlKey);
                                    try {
                                      /* A SIGNED document goes through the
                                         signature endpoint that already exists
                                         for it, not through its raw storage URL.
                                         signed_url points into
                                         uploads/signed_documents/, a tree
                                         downloadFile has no API route for — so
                                         it fell through to a direct fetch, which
                                         Azure blocks cross-origin, and landed on
                                         the window.open fallback. The file
                                         opened in the browser instead of saving.
                                         This route is same-origin, tenant-checked
                                         and already sets an attachment
                                         disposition, so nothing new has to be
                                         built or secured. */
                                      const sigId = (d as VaultShipmentDoc).signature_request_id;
                                      if (!isStd && sigId) {
                                        const resp = await api.get(`/clm/signature-requests/${sigId}/download-file/0`, { responseType: 'blob' });
                                        await saveApiBlob(resp.data as Blob, fname, 'pdf');
                                      } else {
                                        await downloadFile(url, fname);
                                      }
                                    } finally { setOvDownloadingKey(null); }
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
    </div>,
    document.body
  );
}

/* ─── KPI tile — project-standard card pattern (mirrors the Master
 *      pages' .mp-kpi-tile). Top gradient accent strip, label +
 *      value on the left, gradient icon square on the right. */
function KpiTile({ label, value, accent, subtitle, subTone }: { label: string; value: number; accent?: string; subtitle?: string; subTone?: 'good' | 'bad' }) {
  /* Flat stat column (matches the CLM prototype): small uppercase label, a
     large tone-coloured number, and an optional status sub-line
     (✓ COMPLIANT / ⚠ ACTION). No icon box / gradient chrome. */
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
   load; once it clears, whatever the API returned is what renders. */
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
function DocsTable({ rows, tab, ownerType, ownerId, onReload, onSendTradeDoc, onRemindTradeDoc, onRowBusyChange }: {
  rows: VaultDoc[];
  tab: TabKey;
  ownerType: 'customer' | 'consignee' | 'supplier';
  ownerId: number | null;
  onReload: () => Promise<void> | void;
  onSendTradeDoc?: (doc: VaultDoc) => void;
  onRemindTradeDoc?: (doc: VaultDoc) => void | Promise<void>;
  /** Notifies the vault an upload is in flight so it can block tab/close. */
  onRowBusyChange?: (busy: boolean) => void;
}) {
  const authorityLbl = tab === 'trade-documents' ? 'Counter Party' : 'Issuing Authority';
  /* Which attachment chip is mid-download. The chip saves the file rather than
     opening it, and a save gives no visible response of its own — without a
     spinner a large file reads as a dead click and gets clicked again. */
  const [chipBusy, setChipBusy] = useState<string | null>(null);
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
              <Tooltip label={d.name} disabled={(d.name || '').length <= 25}>
                <td className="cev-doc-name">{(d.name || '').length > 25 ? (d.name || '').slice(0, 25) + '…' : d.name}</td>
              </Tooltip>
              <td><AuthorityBadges value={d.authority} /></td>
              <td>
                {d.requirement === 'M' ? (
                  <span className="cev-req cev-req-m" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 800, background: '#dcfce7', color: '#15803d', border: '1px solid #bbf7d0', whiteSpace: 'nowrap' }}>★ Mandatory</span>
                ) : (
                  <span className="cev-req cev-req-o" style={{ display: 'inline-flex', alignItems: 'center', padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: '#f1f5f9', color: '#64748b', border: '1px solid #e2e8f0', whiteSpace: 'nowrap' }}>Optional</span>
                )}
              </td>
              <td>
                {d.attachment_url ? (
                  /* Carries a DOWNLOAD icon, so it has to download. It was a
                     plain target="_blank" link, which opened the file in the
                     browser's viewer — the reported bug. The href stays for
                     middle-click / "copy link"; the click itself saves.
                     Viewing is not lost: the eye action in this row still
                     opens the document. */
                  (() => {
                    const key = String(d.db_id ?? d.doc_code ?? d.name ?? '');
                    const busy = chipBusy === key;
                    return (
                      <a
                        href={d.attachment_url}
                        rel="noreferrer"
                        className="cev-attach"
                        title={busy ? 'Downloading…' : `Download ${d.attachment || 'attachment'}`}
                        aria-busy={busy}
                        onClick={async (e) => {
                          e.preventDefault();
                          if (busy) return;
                          setChipBusy(key);
                          try { await downloadFile(d.attachment_url, d.attachment ?? undefined); }
                          finally { setChipBusy(null); }
                        }}
                      >
                        <i className={busy ? 'ri-loader-4-line cev-spin' : 'ri-download-2-line'} />{' '}
                        <span className="cev-attach-name">{d.attachment || 'Download'}</span>
                      </a>
                    );
                  })()
                ) : d.attachment ? (
                  <span className="cev-attach cev-attach-muted" title={d.attachment}><i className="ri-file-line" /> <span className="cev-attach-name">{d.attachment}</span></span>
                ) : <span style={{ color: '#9ca3af' }}>—</span>}
              </td>
              <td>
                <VaultRowActions doc={d} ownerType={ownerType} ownerId={ownerId} category={category} onReload={onReload} onSendTradeDoc={onSendTradeDoc} onRemindTradeDoc={onRemindTradeDoc} onBusyChange={onRowBusyChange} />
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
function VaultRowActions({ doc, ownerType, ownerId, category, onReload, onSendTradeDoc, onRemindTradeDoc, onBusyChange }: {
  doc: VaultDoc;
  ownerType: 'customer' | 'consignee' | 'supplier';
  ownerId: number | null;
  category: 'kyc' | 'dd' | 'tl' | 'td';
  onReload: () => Promise<void> | void;
  onSendTradeDoc?: (doc: VaultDoc) => void;
  onRemindTradeDoc?: (doc: VaultDoc) => void | Promise<void>;
  /** Bubbles the upload in-flight state up so the vault can block tab/close. */
  onBusyChange?: (busy: boolean) => void;
}) {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [reminding, setReminding] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [viewing, setViewing] = useState(false);
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
  const download = async () => {
    if (downloading || !doc.attachment_url) return;
    setDownloading(true);
    try { await downloadFile(doc.attachment_url, doc.attachment ?? undefined); }
    finally { setDownloading(false); }
  };

  const onPick = async (f: File | undefined) => {
    if (!f || !ownerId || !doc.doc_code) return;
    // Only PDF / JPG / PNG may be uploaded. Word / Excel are blocked so every
    // stored attachment can be previewed in-browser via View (browsers can't
    // display .doc/.docx — they download them).
    if (!/\.(pdf|jpe?g|png)$/i.test(f.name)) {
      toast.error('Unsupported file type', 'Only PDF, JPG or PNG files are allowed. Word / Excel files are not supported.');
      return;
    }
    // Size guard (server caps at 2048 KB) — validate up front so the user gets
    // an immediate toast instead of a round-trip 422.
    if (f.size > 2048 * 1024) {
      toast.error('File too large', 'The file must be 2048 KB (2 MB) or smaller.');
      return;
    }
    setBusy(true);
    onBusyChange?.(true);   // lock the vault (no tab switch / close) while uploading
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
      onBusyChange?.(false);
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
          className={`cev-row-act cev-row-act-view ${!canViewOrDownload ? 'is-disabled' : ''}`}
          onClick={e => { if (!canViewOrDownload) { e.preventDefault(); return; } setViewing(true); window.setTimeout(() => setViewing(false), 1200); }}
          aria-label="View"
        >
          {viewing
            ? <i className="ri-loader-4-line cev-spin" style={{ fontSize: 14 }} aria-hidden />
            : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>}
        </a>
      </Tooltip>
      <Tooltip label={canViewOrDownload ? (downloading ? 'Downloading…' : `Download ${doc.attachment}`) : 'No attachment yet'}>
        <button
          type="button"
          disabled={!canViewOrDownload || downloading}
          onClick={download}
          className={`cev-row-act cev-row-act-download ${!canViewOrDownload ? 'is-disabled' : ''}`}
          aria-label="Download"
        >
          {downloading
            ? <i className="ri-loader-4-line cev-spin" style={{ fontSize: 14 }} aria-hidden />
            : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>}
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

/* ─── Shipment-ID-wise matrix — one row per shipment, expandable into the
 *      shipment's Buyer / Consignee documents for the active kind (Trade
 *      Documents or Agreements). */
function ShipmentTable({ rows, kind, filter, setFilter, onSend, activeSend }: {
  rows: VaultShipmentRow[];
  kind: 'trade' | 'agreement';
  filter: 'buyer-eq-consignee' | 'buyer-neq-consignee';
  setFilter: (f: 'buyer-eq-consignee' | 'buyer-neq-consignee') => void;
  /** Launches Send-for-Signature for one shipment doc (lead + doc + party). */
  onSend?: (leadId: number, doc: VaultShipmentDoc, party: 'buyer' | 'consignee') => void;
  /** The send that is currently launching/in-flight (from the parent) — used to
   *  spin the matching row's Send button until the wizard closes. */
  activeSend?: { leadId: number; doc: VaultShipmentDoc; party: 'buyer' | 'consignee' } | null;
}) {
  const [openId, setOpenId] = useState<number | null>(null);
  const buyerNeq = filter === 'buyer-neq-consignee';
  const filtered = rows.filter(r => buyerNeq ? !r.buyer_is_consignee : r.buyer_is_consignee);
  const isAgreement = kind === 'agreement';
  // caret + SR + ship + opp + customer + consignee + Due Dil + KYC + Trade Lic
  // + Trade Docs (always) + Agreement (only on the Agreements tab).
  const COLS = isAgreement ? 11 : 10;
  return (
    <>
      {/* Same compact pill toggle for BOTH Trade Documents and Agreements tabs
          (they used to differ — Agreements had a full-width ✓/✕ bar). */}
      <div className="cev-ship-filter cev-ship-filter-2">
        <button type="button" className={`cev-ship-fbtn ${filter === 'buyer-eq-consignee' ? 'is-active' : ''}`} onClick={() => { setFilter('buyer-eq-consignee'); setOpenId(null); }}>Customer = Consignee</button>
        <button type="button" className={`cev-ship-fbtn ${filter === 'buyer-neq-consignee' ? 'is-active' : ''}`} onClick={() => { setFilter('buyer-neq-consignee'); setOpenId(null); }}>Customer &ne; Consignee</button>
      </div>
      <div className="cev-table-wrap">
        <div className="cev-table-scroll">
        <table className="cev-table">
          <thead>
            <tr>
              <th style={{ width: 34 }} />
              <th style={{ width: 46 }}>SR</th>
              <th>Shipment ID</th>
              <th>Opportunity ID</th>
              <th>Customer</th>
              <th>Consignee</th>
              <th>Due Dil.</th>
              <th>KYC</th>
              <th>Trade Lic.</th>
              <th>Trade Docs</th>
              {isAgreement && <th>Agreement</th>}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={COLS} className="cev-empty">No shipments match the filter.</td></tr>
            ) : filtered.map((r, i) => {
              const open = openId === r.id;
              return (
                <Fragment key={r.id}>
                  <tr className="cev-ship-row" style={{ cursor: 'pointer' }} onClick={() => setOpenId(open ? null : r.id)}>
                    <td style={{ textAlign: 'center' }}>
                      <span style={{ display: 'inline-block', transition: 'transform .18s', transform: open ? 'rotate(90deg)' : 'none', color: '#0891b2', fontWeight: 800 }}>▸</span>
                    </td>
                    <td>{i + 1}</td>
                    <td><span className="cev-chip-pill">● {r.shipment_id}</span></td>
                    <td><span className="cev-chip-pill cev-chip-pill-warm">● {r.opportunity_id}</span></td>
                    <td>
                      <span className="cev-cust-cell">
                        <span className="cev-cust-mono">{r.customer.charAt(0)}</span>
                        {r.customer}
                      </span>
                    </td>
                    <td>
                      <span className="cev-cust-cell">
                        <span className="cev-cust-mono" style={{ background: 'linear-gradient(135deg,#059669,#10b981)' }}>{(r.consignee || '—').charAt(0)}</span>
                        {r.consignee || '—'}
                      </span>
                    </td>
                    <td><Ratio r={r.due_dil} /></td>
                    <td><Ratio r={r.kyc} /></td>
                    <td><Ratio r={r.trade_lic} /></td>
                    <td><Ratio r={r.trade_docs} /></td>
                    {isAgreement && <td><Ratio r={r.agreement} /></td>}
                  </tr>
                  {open && (
                    <tr className="cev-ship-expand">
                      <td colSpan={COLS} style={{ padding: 0, background: '#f0fdff' }}>
                        <ShipmentDocPanel
                          buyer={kind === 'trade' ? (r.trade_docs_buyer ?? []) : (r.agreements_buyer ?? [])}
                          consignee={kind === 'trade' ? (r.trade_docs_consignee ?? []) : (r.agreements_consignee ?? [])}
                          buyerName={r.customer}
                          consigneeName={r.consignee || '—'}
                          buyerIsConsignee={r.buyer_is_consignee}
                          onSend={onSend ? (doc, party) => onSend(r.id, doc, party) : undefined}
                          pendingSend={activeSend && activeSend.leadId === r.id ? { doc: activeSend.doc, party: activeSend.party } : null}
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

/* Expanded shipment row — Buyer / Consignee sub-tabs + the document table.
 * Inline-styled (no scoped classes) so the Consignee vault reuses it as-is. */
export function ShipmentDocPanel({ buyer, consignee, buyerName, consigneeName, buyerIsConsignee, onSend, primaryParty = 'buyer', hideBuyerTab = false, pendingSend }: {
  buyer: VaultShipmentDoc[]; consignee: VaultShipmentDoc[]; buyerName: string; consigneeName: string; buyerIsConsignee: boolean;
  onSend?: (doc: VaultShipmentDoc, party: 'buyer' | 'consignee') => void;
  
  primaryParty?: 'buyer' | 'consignee';
  /** Drop the "Customer Documents" tab, leaving Consignee + Both.
   *
   *  The CONSIGNEE vault passes this: buyer-EXCLUSIVE documents are the other
   *  party's own paperwork and have no business in a consignee's archive. Note
   *  this is not the old `forceParty` in disguise — "Both" stays, so the
   *  documents the consignee co-signs with the buyer are still reachable,
   *  which is the case that made forceParty wrong. */
  hideBuyerTab?: boolean;
  /** The doc whose Send flow is currently launching/in-flight — its row's Send
   *  button shows a spinner until the send wizard closes. */
  pendingSend?: { doc: VaultShipmentDoc; party: 'buyer' | 'consignee' } | null;
}) {
  const toast = useToast();
  const [party, setParty] = useState<'buyer' | 'consignee' | 'both'>(primaryParty);
  const [busy, setBusy] = useState<number | null>(null);
  const [trackSig, setTrackSig] = useState<{ id: number; code: string } | null>(null);
  // A document whose party is "both" (buyer AND consignee) is returned in BOTH
  // lists. Split the three views by membership:
  //   • Customer Documents  → docs only the buyer has (buyer-exclusive)
  //   • Consignee Documents → docs only the consignee has (consignee-exclusive)
  //   • Both                → the COMMON docs shared by both parties (intersection)
  // (When Customer = Consignee the tabs are hidden and we show all buyer docs.)
  const docKey = (d: VaultShipmentDoc) => (d.db_id != null ? `${d.doc_type ?? ''}#${d.db_id}` : `n#${d.name}#${d.sig_req_id}`);
  const buyerKeys = new Set(buyer.map(docKey));
  const consKeys = new Set(consignee.map(docKey));
  const buyerOnly = buyer.filter(d => !consKeys.has(docKey(d)));
  const consOnly = consignee.filter(d => !buyerKeys.has(docKey(d)));
  const bothDocs = buyer.filter(d => consKeys.has(docKey(d)));
  /* Customer = Consignee ⇒ one entity, so there is nothing to split: show that
     entity's own side. Which side that is depends on whose vault you opened —
     hardcoding `buyer` meant the Consignee vault fell back to the buyer list. */
  /* With the Customer tab hidden there is no way back to a 'buyer' selection,
     but the state could still hold it if a caller opened on that tab — fall
     through to the consignee list rather than render a tabless buyer view. */
  const activeParty = hideBuyerTab && party === 'buyer' ? 'consignee' : party;
  const docs = buyerIsConsignee
    ? (primaryParty === 'consignee' ? consignee : buyer)
    : activeParty === 'both' ? bothDocs : activeParty === 'buyer' ? buyerOnly : consOnly;

  const remind = async (d: VaultShipmentDoc) => {
    setBusy(d.sig_req_id);
    try {
      await api.post(`/clm/signature-requests/${d.sig_req_id}/remind`);
      toast.success('Reminder sent', `${d.name} — the signer has been reminded.`);
    } catch (e: any) {
      toast.error('Could not send reminder', e?.response?.data?.message || 'Please try again.');
    } finally { setBusy(null); }
  };

  const stTone = (s: string) => s === 'Signed' ? '#059669' : (s === 'Declined' || s === 'Expired') ? '#dc2626' : '#d97706';

  return (
    <div className="cev-sdp" style={{ padding: '12px 16px 16px' }}>
      {/* When Customer = Consignee there's only one party, so the tab bar and the
          party-name label are redundant — render the documents table directly. */}
      {!buyerIsConsignee && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
          {!hideBuyerTab && (
            <button type="button" onClick={() => setParty('buyer')} style={partyTabStyle(party === 'buyer')}>Customer Documents <b>{buyerOnly.length}</b></button>
          )}
          {/* Highlight follows activeParty, not the raw state — with the
              Customer tab hidden a stale 'buyer' selection renders the
              consignee list, and the tab bar has to say so. */}
          <button type="button" onClick={() => setParty('consignee')} style={partyTabStyle(activeParty === 'consignee')}>Consignee Documents <b>{consOnly.length}</b></button>
          <button type="button" onClick={() => setParty('both')} style={partyTabStyle(activeParty === 'both')}>Both <b>{bothDocs.length}</b></button>
        </div>
      )}
      <div style={{ fontSize: 11, fontWeight: 600, color: '#0e7490', marginBottom: 6 }}>
        {buyerIsConsignee
          ? (primaryParty === 'consignee' ? consigneeName : buyerName)
          : activeParty === 'both' ? `${buyerName} + ${consigneeName}` : activeParty === 'buyer' ? buyerName : consigneeName}
      </div>
      {docs.length === 0 ? (
        <div style={{ padding: '18px', textAlign: 'center', color: '#64748b', fontSize: 12, background: '#fff', border: '1px dashed #a5f3fc', borderRadius: 8 }}>No {activeParty === 'both' ? '' : activeParty === 'buyer' ? 'buyer ' : 'consignee '}documents on this shipment.</div>
      ) : (
        <div style={{ background: '#fff', border: '1px solid #d6eef5', borderRadius: 10, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
            <thead>
              <tr style={{ background: 'linear-gradient(90deg,#0e7490,#0891b2)', color: '#fff' }}>
                {['Sr No', 'Document Name', 'Required', 'Signed On', 'Status', 'Actions'].map((h) => (
                  <th key={h} style={{ padding: '8px 10px', textAlign: h === 'Document Name' ? 'left' : 'center', fontSize: 9, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {docs.map((d, i) => (
                <tr key={d.sig_req_id + '-' + i} style={{ borderBottom: '1px solid #ecfeff' }}>
                  <td style={{ padding: '8px 10px', textAlign: 'center', color: '#94a3b8', fontWeight: 700 }}>{i + 1}</td>
                  {/* 35, not 25: this column is the widest in the panel and a
                      full PI name ("Proforma Invoice (PI/2026-27/29)") is 32
                      characters — the old cap cut it one bracket short of
                      useful, hiding the very number that identifies it. */}
                  <Tooltip label={d.name} disabled={(d.name || '').length <= 35}>
                    <td style={{ padding: '8px 10px', fontWeight: 700, color: '#0f172a' }}>{(d.name || '').length > 35 ? (d.name || '').slice(0, 35) + '…' : d.name}</td>
                  </Tooltip>
                  <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                    {(d.required === 'OPT' || d.required === 'O')
                      ? <span style={{ display: 'inline-flex', alignItems: 'center', padding: '3px 10px', borderRadius: 20, fontSize: 10, fontWeight: 700, background: '#f1f5f9', color: '#64748b', border: '1px solid #e2e8f0', whiteSpace: 'nowrap' }}>Optional</span>
                      : <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px', borderRadius: 20, fontSize: 10, fontWeight: 800, background: '#dcfce7', color: '#15803d', border: '1px solid #bbf7d0', whiteSpace: 'nowrap' }}>★ Mandatory</span>}
                  </td>
                  <td style={{ padding: '8px 10px', textAlign: 'center', color: '#475569' }}>{d.uploaded_on}</td>
                  <td style={{ padding: '8px 10px', textAlign: 'center' }}>{(() => {
                    const fg = stTone(d.status);
                    const bg = d.status === 'Signed' ? '#ecfdf5' : (d.status === 'Declined' || d.status === 'Expired') ? '#fef2f2' : '#fffbeb';
                    const bd = d.status === 'Signed' ? '#a7f3d0' : (d.status === 'Declined' || d.status === 'Expired') ? '#fecaca' : '#fde68a';
                    return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px', borderRadius: 20, fontSize: 10, fontWeight: 800, background: bg, color: fg, border: `1px solid ${bd}`, whiteSpace: 'nowrap' }}>● {d.status}</span>;
                  })()}</td>
                  <td style={{ padding: '8px 10px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                    {/* Native `title=` was the odd one out here: it waits ~1s,
                        renders in the OS style, and ignores the app theme. Every
                        other table in the project uses the shared Tooltip. */}
                    {d.signed_url && (
                      <Tooltip label="View signed document">
                        <button type="button" aria-label="View" onClick={() => window.open(resolveFileUrl(d.signed_url!), '_blank', 'noopener')} style={{ ...docActStyle('#0891b2'), padding: '4px 8px' }}><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg></button>
                      </Tooltip>
                    )}
                    {d.status === 'Draft' && onSend && d.db_id && (() => {
                      const isSending = !!pendingSend && pendingSend.doc === d;
                      return (
                        <Tooltip label={isSending ? 'Sending…' : 'Send for signature'}>
                        <button type="button" aria-label="Send" disabled={isSending}
                          onClick={() => onSend(d, buyer.includes(d) ? 'buyer' : 'consignee')}
                          style={{ ...docActStyle('#7c3aed'), padding: '4px 8px', ...(isSending ? { cursor: 'wait' } : null) }}>
                          {isSending
                            ? <i className="ri-loader-4-line cev-spin" style={{ fontSize: 12, display: 'inline-block' }} aria-hidden />
                            : <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>}
                        </button>
                        </Tooltip>
                      );
                    })()}
                    {/* Proforma Invoice — same Send-for-Signature the Sales-Matrix
                        Q/PI stage offers. Routes through onSend; the parent opens
                        SalesDocSendForSignatureModal (kind='pi') off the pi_id. */}
                    {d.pi_id && onSend && d.status !== 'Signed' && !d.sig_req_id && d.status !== 'Declined' && d.status !== 'Recalled' && (() => {
                      const isSending = !!pendingSend && pendingSend.doc === d;
                      return (
                        <Tooltip label={isSending ? 'Sending…' : 'Send the Proforma Invoice for signature'}>
                        <button type="button" aria-label="Send for Signature" disabled={isSending}
                          onClick={() => onSend(d, buyer.includes(d) ? 'buyer' : 'consignee')}
                          style={{ ...docActStyle('#7c3aed'), padding: '4px 8px', ...(isSending ? { cursor: 'wait' } : null) }}>
                          {isSending
                            ? <i className="ri-loader-4-line cev-spin" style={{ fontSize: 12, display: 'inline-block' }} aria-hidden />
                            : <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>}
                        </button>
                        </Tooltip>
                      );
                    })()}
                    {/* Resend — a declined / recalled doc (PI or trade doc) can be
                        re-sent for signature; routes through the same onSend flow. */}
                    {(d.status === 'Declined' || d.status === 'Recalled') && onSend && (d.db_id || d.pi_id) && (() => {
                      const isSending = !!pendingSend && pendingSend.doc === d;
                      return (
                        <Tooltip label={isSending ? 'Sending…' : `Re-send for signature (${d.status.toLowerCase()})`}>
                        <button type="button" aria-label="Resend for Signature" disabled={isSending}
                          onClick={() => onSend(d, buyer.includes(d) ? 'buyer' : 'consignee')}
                          style={{ ...docActStyle('#dc2626'), padding: '4px 8px', ...(isSending ? { cursor: 'wait' } : null) }}>
                          {isSending
                            ? <i className="ri-loader-4-line cev-spin" style={{ fontSize: 12, display: 'inline-block' }} aria-hidden />
                            : <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" /><path d="M21 3v5h-5" /><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" /><path d="M8 16H3v5" /></svg>}
                        </button>
                        </Tooltip>
                      );
                    })()}
                    {d.status === 'Pending' && d.sig_req_id > 0 && <Tooltip label={busy === d.sig_req_id ? 'Sending reminder…' : 'Send reminder to the signer'}><button type="button" aria-label="Send Reminder" disabled={busy === d.sig_req_id} onClick={() => remind(d)} style={{ ...docActStyle('#06b6d4'), padding: '4px 8px' }}>{busy === d.sig_req_id ? '…' : <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></svg>}</button></Tooltip>}
                    {/* Signing tracker — shown once the doc has a signature
                        request of ANY status (sent / signed / declined). */}
                    {(d.signature_request_id ?? (d.sig_req_id > 0 ? d.sig_req_id : null)) && (
                      <Tooltip label="View signing timeline">
                        <button type="button" aria-label="Signing activity tracker"
                          onClick={() => setTrackSig({ id: (d.signature_request_id ?? d.sig_req_id) as number, code: d.pi_code || d.name })}
                          style={{ ...docActStyle('#7c3aed'), padding: '4px 8px' }}>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v5h5" /><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8" /><path d="M12 7v5l4 2" /></svg>
                        </button>
                      </Tooltip>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {trackSig && (
        <SigningTrackerModal sigId={trackSig.id} code={trackSig.code} onClose={() => setTrackSig(null)} />
      )}
    </div>
  );
}

/* Shipment Send-for-Signature launcher — opens the SAME wizard the workplace
 * uses (preview pane + draggable signature box), pre-loaded with one shipment
 * doc, WITHOUT the intermediate list popup. On `target` set it fetches the
 * lead's applicable docs (for agreement content + signer emails) and drives
 * SalesCustomerSendForSignatureModal in the right mode. Shared by both the
 * Customer and Consignee vaults. */
export function ShipmentDocSendForSignature({ target, onClose, onSent }: {
  target: { leadId: number; doc: VaultShipmentDoc; party: 'buyer' | 'consignee' } | null;
  onClose: () => void;
  onSent: () => void;
}) {
  const toast = useToast();
  const [agr, setAgr] = useState<AgreementContext | null>(null);
  const [td,  setTd]  = useState<{ ids: number[]; leadId: number; modelName: 'Customer' | 'Consignee'; customer: SendForSignatureCustomer | null } | null>(null);

  useEffect(() => {
    if (!target?.doc.db_id) { setAgr(null); setTd(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const res  = await api.get(`/clm/leads/${target.leadId}/agreement-applicable`);
        if (cancelled) return;
        const data = res.data?.data;
        const cust = data?.lead?.customer;
        const cons = data?.lead?.consignee;

        if (target.doc.doc_type === 'agreement') {
          // Locate the applicable agreement (carries content + header/footer).
          let a: any = null;
          for (const seg of (data?.segments ?? [])) {
            const f = (seg.agreements ?? []).find((x: any) => x.id === target.doc.db_id);
            if (f) { a = f; break; }
          }
          if (!a) { toast.error('Cannot send', 'This agreement is no longer applicable to the shipment.'); onClose(); return; }
          // Signers come from the agreement's party CSV intersected with the
          // lead's mapped customer / consignee — same rule as the workplace.
          const tokens = String(a.party ?? '').toLowerCase().split(',').map((s: string) => s.trim()).filter(Boolean);
          const signers: AgreementSigner[] = [];
          if (tokens.includes('buyer'))     signers.push({ role: 'buyer',     name: cust?.name ?? '⚠ Customer not mapped',  email: cust?.email ?? null });
          if (tokens.includes('consignee')) signers.push({ role: 'consignee', name: cons?.name ?? '⚠ Consignee not mapped', email: cons?.email ?? null });
          setAgr({
            leadId: target.leadId,
            agreements: [{
              id: a.id, code: a.code, title: a.title, agreement_type: a.agreement_type,
              party: a.party, content: a.content ?? null,
              header_config: a.header_config ?? null, footer_config: a.footer_config ?? null,
            } as AgreementSendRow],
            signers,
          });
        } else {
          // Trade document — the wizard resolves content itself from the
          // preselected library id; scope the send to this lead + party.
          const p = target.party === 'consignee' ? cons : cust;
          setTd({
            ids: [target.doc.db_id!],
            leadId: target.leadId,
            modelName: target.party === 'consignee' ? 'Consignee' : 'Customer',
            customer: p ? { id: String(p.code ?? p.id), db_id: p.id, company: p.name, email: p.email } : null,
          });
        }
      } catch {
        if (!cancelled) { toast.error('Cannot send', 'Could not load the document. Please try again.'); onClose(); }
      }
    })();
    return () => { cancelled = true; };
  }, [target]);   // eslint-disable-line react-hooks/exhaustive-deps

  // Between clicking a row's "Send" and the send wizard opening we fetch the
  // applicable agreement/trade-doc (agreement-applicable) — a few seconds. Show
  // a loader for that window so the Send action gives immediate feedback
  // instead of appearing to do nothing.
  const preparing = !!target && !agr && !td;

  return (
    <>
      {/* z-index 13500, not 3000. Both Evidence Vaults render their shell at
          11200 (and the Document Overview popup at 11400, the segment popover
          at 13001), so a 3000 overlay portalled to <body> landed BEHIND the
          vault: the screen dimmed and the spinner ran on the page underneath
          while the vault itself sat there looking idle. Sits under the send
          wizard (265000), which is fine — `preparing` is false by the time the
          wizard opens. */}
      {preparing && createPortal(
        <div style={{ position: 'fixed', inset: 0, zIndex: 13500, background: 'rgba(15,23,42,.45)', backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, color: '#fff', fontFamily: 'inherit', fontSize: 13, fontWeight: 600 }}>
            <i className="ri-loader-4-line cev-spin" style={{ fontSize: 34 }} aria-hidden />
            Preparing document…
          </div>
        </div>,
        document.body,
      )}
      <SalesCustomerSendForSignatureModal
        open={!!agr}
        customer={null}
        mode="agreement"
        agreementContext={agr}
        onClose={() => { setAgr(null); onClose(); }}
        onSent={() => { setAgr(null); onSent(); }}
      />
      <SalesCustomerSendForSignatureModal
        open={!!td}
        mode="trade-doc"
        /* multiBox: this is the vault's OTHER trade-doc send (the shipment /
           case-to-case row), a separate instance from the one above - it was
           missed when multi-box was switched on, so the picker never appeared
           on documents opened through this path (Legal Team #9 / BR-03). */
        multiBox
        modelName={td?.modelName ?? 'Customer'}
        customer={td?.customer ?? null}
        leadId={td?.leadId ?? null}
        preselectedDocIds={td?.ids}
        onClose={() => { setTd(null); onClose(); }}
        onSent={() => { setTd(null); onSent(); }}
      />
    </>
  );
}

const partyTabStyle = (on: boolean): CSSProperties => ({
  display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 8, border: 'none', cursor: 'pointer',
  fontFamily: 'inherit', fontSize: 11.5, fontWeight: 700, color: on ? '#fff' : '#0e7490',
  background: on ? 'linear-gradient(135deg,#06b6d4,#0891b2)' : '#e0f7fa',
});
const docActStyle = (c: string): CSSProperties => ({
  display: 'inline-flex', alignItems: 'center', margin: '0 3px', padding: '4px 10px', borderRadius: 7, border: `1.5px solid ${c}`,
  background: '#fff', color: c, fontFamily: 'inherit', fontSize: 10, fontWeight: 700, cursor: 'pointer',
});

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
    case 'shipment-agreements': return 'Per-shipment compliance matrix grouped by customer-consignee link';
  }
}

/* ─── Scoped CSS (all rules under .cev-*) ─── */
/* Cyan/teal palette — mirrors the CLM "Buyer Evidence Vault" prototype
   (deep cyan→teal header gradient, cyan active tabs, cyan accents). The
   green/amber/red status colors (Verified / Pending / Mandatory) are kept
   semantic.
   Exported so sibling vaults (Supplier) can reuse the EXACT same palette +
   dark-mode rules and never drift from the Customer design. */
export const CEV_CSS = `
.cev-overlay {
  position: fixed; inset: 0;
  background: rgba(8,51,68,0.45);
  -webkit-backdrop-filter: blur(6px);
  backdrop-filter: blur(6px);
  z-index: 11200;
  display: flex; align-items: stretch; justify-content: flex-end;
  font-family: var(--font-sans);
  -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale;
  text-rendering: optimizeLegibility;
  animation: cevFade .18s ease both;
}
@keyframes cevFade { from { opacity: 0; } to { opacity: 1; } }
.cev-card {
  position: relative;
  width: min(1280px, 90vw);
  height: 100vh;        /* fallback for old browsers */
  height: 100dvh;       /* dynamic viewport — mobile address bar no longer hides the footer */
  background: #f0fdff;
  /* No curve — straight edges so the drawer feels like a flush
     extension of the page rather than a floating card. */
  border-radius: 0;
  overflow: hidden;
  display: flex; flex-direction: column;
  box-shadow: -32px 0 80px rgba(8,51,68,.40), -12px 0 30px rgba(8,51,68,.18);
  animation: cevSlide .26s cubic-bezier(.22,1,.36,1) both;
}
@keyframes cevSlide { from { transform: translateX(40px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }

/* ─── HEADER ─── */
.cev-header {
  position: relative;
  flex-shrink: 0;
  padding: 14px 22px;
  background: linear-gradient(125deg, #083344 0%, #0c4a6e 25%, #0e7490 50%, #0891b2 75%, #06b6d4 100%);
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
    radial-gradient(circle at 100% 0%, rgba(165,243,252,0.10), transparent 45%),
    radial-gradient(circle at 0% 100%, rgba(34,211,238,0.10), transparent 55%);
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
  background: radial-gradient(circle at 30% 30%, rgba(103,232,249,0.30), rgba(103,232,249,0.06) 60%, transparent 75%); }
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
  background: #22d3ee; color: #083344;
  display: inline-flex; align-items: center; justify-content: center;
  border: 2px solid #0891b2;
}
.cev-header-text { min-width: 0; }
.cev-header-eyebrow { font-size: 9.5px; font-weight: 700; letter-spacing: .12em; color: rgba(255,255,255,.78); margin-bottom: 2px; }
.cev-header-title { font-size: 18px; font-weight: 800; letter-spacing: -0.01em; line-height: 1.15; margin-bottom: 6px; color: #fff; }
.cev-header-chips { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.cev-chip { display: inline-flex; align-items: center; gap: 5px; padding: 3px 9px; border-radius: 999px; font-size: 10.5px; font-weight: 600; background: rgba(255,255,255,0.16); border: 1px solid rgba(255,255,255,0.24); color: #ecfeff; }
.cev-chip-id { background: rgba(255,255,255,0.20); }
.cev-chip-risk[data-risk="low"]    { background: rgba(16,185,129,0.30); color: #ecfdf5; }
.cev-chip-risk[data-risk="medium"] { background: rgba(245,158,11,0.30); color: #fef3c7; }
.cev-chip-risk[data-risk="high"]   { background: rgba(239,68,68,0.30);  color: #fee2e2; }

.cev-header-right { display: flex; align-items: center; gap: 12px; flex-shrink: 0; }
.cev-header-meta { font-size: 11px; color: rgba(255,255,255,.84); display: inline-flex; gap: 4px; align-items: center; }
.cev-header-meta span { white-space: nowrap; }
.cev-seg-more {
  display: inline-flex; align-items: center; margin-left: 5px;
  padding: 1px 8px; border-radius: 999px; cursor: default;
  font-size: 10px; font-weight: 800;
  background: rgba(255,255,255,.20); border: 1px solid rgba(255,255,255,.28); color: #ecfeff;
}
.cev-seg-more:hover { background: rgba(255,255,255,.30); }
/* "+N more" segment list popover — white card with a titled list of segment
 * pills (matches the CLM authority/segment popovers). */
.cev-seg-pop { background: #fff; border: 1.5px solid #a5f3fc; border-radius: 12px; padding: 8px; box-shadow: 0 18px 44px rgba(8,47,73,.28); }
.cev-seg-pop-title { font-size: 8px; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; color: #0e7490; padding: 4px 8px 7px; }
.cev-seg-pop-row { display: flex; align-items: center; padding: 5px 8px; border-radius: 8px; }
.cev-seg-pop-row.alt { background: #ecfeff; }
.cev-seg-pop-pill { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; font-weight: 600; color: #0e7490; background: #cffafe; border: 1px solid rgba(8,145,178,.30); border-radius: 999px; padding: 2px 11px; }
.cev-seg-pop-pill::before { content: ''; width: 5px; height: 5px; border-radius: 50%; background: currentColor; flex-shrink: 0; }
[data-bs-theme="dark"] .cev-seg-pop { background: #0f2a30; border-color: rgba(34,211,238,.30); box-shadow: 0 18px 44px rgba(0,0,0,.55); }
[data-bs-theme="dark"] .cev-seg-pop-title { color: #67e8f9; }
[data-bs-theme="dark"] .cev-seg-pop-row.alt { background: rgba(255,255,255,.04); }
[data-bs-theme="dark"] .cev-seg-pop-pill { background: rgba(8,145,178,.18); color: #67e8f9; border-color: rgba(34,211,238,.30); }
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
  background: #fff;
  border-bottom: 1.5px solid #e0f2f7;
}
/* Animated top accent line (matches the prototype .ev-stats::before). */
.cev-kpi-outer::before {
  content: ''; position: absolute; top: 0; left: 0; right: 0; height: 2.5px; z-index: 2;
  background: linear-gradient(90deg, #0e7490, #0891b2, #06b6d4, #67e8f9, #06b6d4, #0891b2, #0e7490);
  background-size: 200% 100%;
  animation: cevStatsAccent 4s linear infinite;
}
@keyframes cevStatsAccent { 0% { background-position: 0% 0%; } 100% { background-position: 200% 0%; } }
/* Full-width static row — all stat columns fit; NO horizontal scroll. */
.cev-kpi-strip {
  display: flex; gap: 0; align-items: stretch;
  padding: 0;
  overflow: visible;
}
.cev-kpi-fade {
  position: absolute;
  top: 0; bottom: 0;
  width: 70px;
  pointer-events: none;
  z-index: 3;
}
.cev-kpi-fade-l {
  left: 0;
  background: linear-gradient(90deg, #f0fdff 0%, #f0fdff 25%, rgba(240,253,255,0) 100%);
}
.cev-kpi-fade-r {
  right: 0;
  background: linear-gradient(270deg, #ecfeff 0%, #ecfeff 25%, rgba(236,254,255,0) 100%);
}
.cev-kpi-nav {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  z-index: 5;
  width: 34px; height: 34px;
  border-radius: 50%;
  border: none;
  background: linear-gradient(135deg, #ffffff 0%, #ecfeff 100%);
  color: #0891b2;
  display: inline-flex; align-items: center; justify-content: center;
  cursor: pointer;
  box-shadow:
    0 2px 6px rgba(8,145,178,0.18),
    0 8px 22px rgba(8,51,68,0.18),
    inset 0 0 0 1px rgba(8,145,178,0.20);
  transition: all .18s ease;
  font-size: 18px;
}
.cev-kpi-nav:hover {
  background: linear-gradient(135deg, #0891b2, #06b6d4);
  color: #fff;
  transform: translateY(-50%) scale(1.10);
  box-shadow:
    0 4px 10px rgba(8,145,178,0.30),
    0 10px 26px rgba(8,145,178,0.45);
}
.cev-kpi-nav:active { transform: translateY(-50%) scale(0.96); }
.cev-kpi-nav-prev { left: 14px; }
.cev-kpi-nav-next { right: 14px; }
.cev-kpi-tile {
  position: relative;
  flex: 1 1 0;                /* equal-width columns — fill the row, no scroll */
  min-width: 0;
  padding: 12px 8px 10px;
  border-right: 1px solid rgba(8,145,178,0.16);   /* thin column divider */
  text-align: center;        /* centre label, value & status sub-line */
}
.cev-kpi-tile:last-child { border-right: none; }
.cev-kpi-strip-top {
  position: absolute; top: 0; left: 0; right: 0; height: 3px;
}
.cev-kpi-body {
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
}
.cev-kpi-text { min-width: 0; }
.cev-kpi-label {
  font-size: 6.5px; font-weight: 700; letter-spacing: .1em;
  color: #94a3b8;
  text-transform: uppercase;
  margin-bottom: 2px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.cev-kpi-value {
  font-size: 22px; font-weight: 800; line-height: 1;
  color: #083344;
  font-variant-numeric: tabular-nums;
}
/* Status sub-line under the number (✓ COMPLIANT / ⚠ ACTION). */
.cev-kpi-sub {
  margin-top: 3px;
  font-size: 7px; font-weight: 700; letter-spacing: .05em;
  text-transform: uppercase;
}
.cev-kpi-sub.is-good { color: #16a34a; }
.cev-kpi-sub.is-bad  { color: #dc2626; }
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
  background: linear-gradient(180deg, #f0fdff 0%, #ecfeff 100%);
  padding: 13px 18px;
}
.cev-groups { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.cev-group {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 11px 16px;
  background: #ffffff;
  border: 1.5px solid #cffafe;
  border-radius: 13px;
  text-align: left;
  transition: all .2s ease;
}
.cev-group:hover { border-color: #67e8f9; background: #f0fdff; }
/* The icon+text selector (picks the active group). */
.cev-group-main {
  flex: 1; min-width: 0;
  display: flex; align-items: center; gap: 14px;
  background: transparent; border: 0; padding: 0; cursor: pointer;
  text-align: left; font-family: inherit;
}
/* "Document Overview" button on the right of each group card. */
/* INACTIVE card → ghost button (secondary). */
.cev-group-overview {
  flex-shrink: 0;
  display: inline-flex; align-items: center; gap: 6px;
  padding: 7px 13px; border-radius: 8px; border: none;
  background: linear-gradient(135deg, #06b6d4, #0891b2); color: #fff;
  font-family: inherit; font-size: 10px; font-weight: 800; letter-spacing: .01em; cursor: pointer;
  white-space: nowrap; box-shadow: 0 2px 8px rgba(8,145,178,.3); transition: all .18s ease;
}
.cev-group-overview:hover { background: linear-gradient(135deg, #0891b2, #0e7490); transform: translateY(-1px); box-shadow: 0 5px 14px rgba(8,145,178,.42); }
.cev-group-overview i { font-size: 13px; }
/* ACTIVE (selected) card → SOLID WHITE button (the prominent one). */
.cev-group.is-active .cev-group-overview { background: #fff; color: #0891b2; border-color: #fff; box-shadow: 0 2px 8px rgba(0,0,0,.14); }
.cev-group.is-active .cev-group-overview:hover { background: #f0fdff; color: #0891b2; border-color: #fff; }

/* ─── Document Overview popup ─── */
.cev-ov-overlay {
  position: fixed; inset: 0; z-index: 11400;
  background: rgba(8,51,68,.45); -webkit-backdrop-filter: blur(4px); backdrop-filter: blur(4px);
  display: flex; align-items: center; justify-content: center; padding: 24px;
  animation: cevFade .16s ease both;
}
.cev-ov-card {
  width: min(760px, 96vw); max-height: 86vh;
  background: #fff; border-radius: 16px; overflow: hidden;
  display: flex; flex-direction: column;
  box-shadow: 0 30px 80px rgba(8,51,68,.45);
}
.cev-ov-head {
  display: flex; align-items: center; gap: 14px; padding: 16px 20px;
  background: linear-gradient(120deg, #083344 0%, #0c4a6e 30%, #0e7490 65%, #0891b2 100%);
  color: #fff; flex-shrink: 0;
}
.cev-ov-head-icon {
  width: 40px; height: 40px; border-radius: 11px; flex-shrink: 0;
  display: inline-flex; align-items: center; justify-content: center;
  background: rgba(255,255,255,.16); border: 1px solid rgba(255,255,255,.22); font-size: 19px;
}
.cev-ov-head-text { flex: 1; min-width: 0; }
.cev-ov-title { font-size: 16px; font-weight: 800; letter-spacing: -.01em; }
.cev-ov-sub { font-size: 11.5px; font-weight: 500; color: rgba(255,255,255,.82); margin-top: 2px; }
.cev-ov-close {
  width: 34px; height: 34px; border-radius: 50%; flex-shrink: 0;
  border: 1px solid rgba(255,255,255,.25); background: rgba(255,255,255,.12); color: #fff;
  cursor: pointer; font-size: 18px; display: inline-flex; align-items: center; justify-content: center;
  transition: all .15s ease;
}
.cev-ov-close:hover { background: rgba(255,255,255,.25); }
/* Fixed height for ~5 rows so the popup size stays constant regardless of how
   many documents the selected shipment/page has (paginated at 5/page). */
/* Top spacing is a non-scrolling BORDER, not padding: padding-top is inside
   the scrollport, so a sticky (top:0) thead sticks below it and earlier rows
   peek into the gap above the header. A border sits outside the scrollport and
   clips the content, so the sticky header stays flush and nothing shows above it. */
.cev-ov-body { overflow: auto; padding: 0 18px 18px; border-top: 14px solid #fff; min-height: 312px; max-height: 312px; }
/* Overview pager (Standard docs, 5 per page) */
.cev-ov-pager { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 18px 16px; flex-wrap: wrap; }
.cev-ov-pager-info { font-size: 11px; font-weight: 600; color: #0891b2; }
.cev-ov-pager-btns { display: flex; align-items: center; gap: 5px; }
.cev-ov-pager-nav, .cev-ov-pager-num {
  min-width: 28px; height: 28px; border-radius: 7px; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
  font-family: inherit; font-size: 11px; font-weight: 700;
  border: 1.5px solid rgba(6,182,212,.22); background: #fff; color: #0891b2; transition: all .15s;
}
.cev-ov-pager-nav:disabled { opacity: .4; cursor: default; }
.cev-ov-pager-nav:not(:disabled):hover, .cev-ov-pager-num:hover { background: #ecfeff; }
.cev-ov-pager-num.is-active { background: linear-gradient(135deg, #06b6d4, #0891b2); color: #fff; border-color: transparent; font-weight: 800; }
[data-bs-theme="dark"] .cev-ov-pager-nav, [data-bs-theme="dark"] .cev-ov-pager-num { background: rgba(8,145,178,.14); color: #67e8f9; border-color: rgba(8,145,178,.34); }
[data-bs-theme="dark"] .cev-ov-pager-num.is-active { background: linear-gradient(135deg,#06b6d4,#22d3ee); color: #fff; border-color: transparent; }
/* Case-to-case shipment tabs (horizontal, scrollable) */
.cev-ov-shiptabs { display: flex; gap: 8px; overflow-x: auto; padding: 12px 18px 0; scrollbar-width: thin; scrollbar-color: rgba(8,145,178,.3) transparent; }
.cev-ov-shiptabs::-webkit-scrollbar { height: 6px; }
.cev-ov-shiptabs::-webkit-scrollbar-thumb { background: rgba(8,145,178,.3); border-radius: 99px; }
.cev-ov-shiptab { display: inline-flex; align-items: center; gap: 7px; flex-shrink: 0; padding: 8px 14px; border-radius: 10px; cursor: pointer; border: 1.5px solid rgba(6,182,212,.22); background: #fff; color: #0e7490; font-family: inherit; font-size: 12px; font-weight: 700; white-space: nowrap; transition: all .15s; }
.cev-ov-shiptab:hover { background: #ecfeff; }
.cev-ov-shiptab.is-active { background: linear-gradient(135deg,#0e7490,#06b6d4); color: #fff; border-color: transparent; box-shadow: 0 3px 10px rgba(8,145,178,.3); }
.cev-ov-shiptab-opp { font-size: 10px; font-weight: 700; padding: 1px 7px; border-radius: 20px; background: rgba(8,145,178,.1); color: #0891b2; }
.cev-ov-shiptab.is-active .cev-ov-shiptab-opp { background: rgba(255,255,255,.22); color: #fff; }
[data-bs-theme="dark"] .cev-ov-shiptab { background: rgba(8,145,178,.12); color: #67e8f9; border-color: rgba(8,145,178,.34); }
[data-bs-theme="dark"] .cev-ov-shiptab.is-active { background: linear-gradient(135deg,#06b6d4,#22d3ee); color: #fff; border-color: transparent; }
.cev-ov-table { width: 100%; border-collapse: separate; border-spacing: 0; font-size: 13px; }
.cev-ov-table thead th {
  position: sticky; top: 0; z-index: 5; background: #083344; color: #fff;
  font-size: 10px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase;
  padding: 10px 12px; text-align: left; white-space: nowrap;
}
.cev-ov-table thead th:first-child { border-radius: 8px 0 0 8px; }
.cev-ov-table thead th:last-child  { border-radius: 0 8px 8px 0; }
.cev-ov-table tbody td { padding: 11px 12px; border-bottom: 1px solid #e6f7fb; vertical-align: middle; }
.cev-ov-table tbody tr:hover td { background: #f0fdff; }
.cev-ov-num { color: #5e94a1; font-weight: 700; }
.cev-ov-name { font-weight: 700; color: #0a2630; }
/* Align the # / STATUS / ACTION columns centered (header AND cells) so the
   status pills and download buttons sit directly under their headings.
   DOCUMENT NAME stays left-aligned. */
.cev-ov-table thead th:first-child,
.cev-ov-table tbody td:first-child,
.cev-ov-table thead th:nth-child(3),
.cev-ov-table tbody td:nth-child(3),
.cev-ov-table thead th:nth-child(4),
.cev-ov-table tbody td:nth-child(4) { text-align: center; }
.cev-ov-empty { text-align: center; color: #5e94a1; padding: 28px 12px !important; font-weight: 600; }
/* Shipment group header row inside the Case-to-Case overview. */
.cev-ov-ship-head td {
  background: #ecfeff !important; border-bottom: 1px solid #a5f3fc !important;
  padding: 9px 12px !important; font-weight: 800; font-size: 12px;
  color: #0e7490; letter-spacing: .02em;
}
.cev-ov-ship-head td i { margin-right: 6px; }
.cev-ov-ship-opp {
  display: inline-block; margin-left: 10px; padding: 2px 9px; border-radius: 999px;
  background: #fff7ed; color: #c2410c; border: 1px solid #fed7aa;
  font-size: 10.5px; font-weight: 700; letter-spacing: .03em;
}
[data-bs-theme="dark"] .cev-ov-ship-head td { background: rgba(8,145,178,.16) !important; color: #67e8f9; border-bottom-color: rgba(8,145,178,.3) !important; }
[data-bs-theme="dark"] .cev-ov-ship-opp { background: rgba(194,65,12,.18); color: #fdba74; border-color: rgba(194,65,12,.4); }
.cev-ov-dl {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 5px 12px; border-radius: 7px;
  background: #ecfeff; color: #0e7490; border: 1.5px solid #a5f3fc;
  font-family: inherit; font-size: 11.5px; font-weight: 700; cursor: pointer; transition: all .15s ease;
}
.cev-ov-dl:hover:not(:disabled) { background: #fff; border-color: #06b6d4; color: #0891b2; }
.cev-ov-dl:disabled { opacity: .45; cursor: not-allowed; }
[data-bs-theme="dark"] .cev-ov-card { background: #0a2630; }
[data-bs-theme="dark"] .cev-ov-body { border-top-color: #0a2630; }
[data-bs-theme="dark"] .cev-ov-table tbody td { border-bottom-color: rgba(8,145,178,.18); color: #cffafe; }
[data-bs-theme="dark"] .cev-ov-name { color: #e6f7fb; }
[data-bs-theme="dark"] .cev-ov-table tbody tr:hover td { background: rgba(8,145,178,.10); }
.cev-group.is-active {
  background: linear-gradient(120deg, #0c4a6e 0%, #0891b2 55%, #06b6d4 100%);
  border-color: #0891b2;
  box-shadow: 0 6px 18px rgba(14,116,144,.35);
}
.cev-group-icon {
  width: 34px; height: 34px; flex-shrink: 0;
  display: inline-flex; align-items: center; justify-content: center;
  border-radius: 10px;
  background: #ecfeff; color: #0891b2; border: 1px solid #a5f3fc;
  font-size: 16px;
}
.cev-group.is-active .cev-group-icon { background: rgba(255,255,255,.18); color: #fff; border-color: rgba(255,255,255,.25); }
.cev-group-text { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.cev-group-title { font-size: 13px; font-weight: 800; color: #0a2630; letter-spacing: -.01em; }
.cev-group.is-active .cev-group-title { color: #ffffff; }
.cev-group-sub { font-size: 8.5px; font-weight: 600; letter-spacing: .06em; color: #5e94a1; }
.cev-group.is-active .cev-group-sub { color: rgba(255,255,255,.8); }

.cev-tabs-wrap {
  flex-shrink: 0;
  background: #fff;
  border-bottom: 2px solid #d6eef5;
  padding: 0 18px;
}
.cev-tabs {
  display: flex; align-items: center; gap: 2px;
  overflow-x: auto;
  scrollbar-width: none;
}
.cev-tabs::-webkit-scrollbar { display: none; }
/* Underline sub-tabs — matches the CLM prototype's .ev-tab: a flat row of
 * tabs with a glowing cyan underline on the active one, an icon chip and a
 * pill count badge. */
.cev-tab {
  flex: 0 0 auto;
  position: relative;
  display: inline-flex; align-items: center; gap: 6px;
  padding: 12px 14px;
  background: transparent;
  border: none;
  border-bottom: 2.5px solid transparent;
  margin-bottom: -2px;
  color: #94a3b8;
  font-size: 11.5px; font-weight: 600;
  cursor: pointer;
  transition: color .18s ease, border-color .18s ease;
  white-space: nowrap;
}
.cev-tab-icon {
  width: 22px; height: 22px; border-radius: 6px;
  display: inline-flex; align-items: center; justify-content: center;
  background: rgba(148,163,184,.08);
  color: #94a3b8;
  font-size: 13px;
  flex-shrink: 0;
  transition: all .18s ease;
}
.cev-tab-label { white-space: nowrap; }
.cev-tab:hover { color: #0891b2; }
.cev-tab:hover .cev-tab-icon { background: rgba(6,182,212,.1); color: #0891b2; }
.cev-tab.is-active {
  color: #0e7490; font-weight: 700;
  border-bottom-color: #0891b2;
}
.cev-tab.is-active::after {
  content: ''; position: absolute; bottom: -2px; left: 10px; right: 10px; height: 2.5px;
  background: linear-gradient(90deg, #06b6d4, #22d3ee);
  border-radius: 2px 2px 0 0;
  box-shadow: 0 0 8px rgba(6,182,212,.6);
}
.cev-tab.is-active .cev-tab-icon {
  background: linear-gradient(135deg, #ecfeff, #cffafe);
  color: #0891b2;
}
.cev-tab-count {
  background: #f0fdff; color: #22d3ee; border: 1px solid #a5f3fc;
  font-size: 9px; font-weight: 800; letter-spacing: 0;
  min-width: 18px; height: 18px; padding: 0 5px; border-radius: 20px;
  display: inline-flex; align-items: center; justify-content: center;
  transition: all .18s ease;
}
.cev-tab.is-active .cev-tab-count {
  background: linear-gradient(135deg, #06b6d4, #22d3ee);
  color: #fff; border-color: transparent;
  box-shadow: 0 2px 6px rgba(6,182,212,.38);
}

/* ─── BODY ─── */
.cev-body {
  flex: 1; min-height: 0; overflow-y: auto;
  padding: 14px 16px 18px;
  background: #f7f8fc;
  display: flex; flex-direction: column; gap: 0;
  /* Match the visible scrollbar pattern used by [[AddVendorModal]]'s
     .avm-body so the rail is obvious when a tab's table grows past
     the body. Solid violet replaces the prior near-invisible rgba(.30). */
  scrollbar-width: thin; scrollbar-color: #67e8f9 transparent;
}
.cev-body::-webkit-scrollbar { width: 8px; }
.cev-body::-webkit-scrollbar-thumb { background: #67e8f9; border-radius: 99px; }
.cev-body::-webkit-scrollbar-thumb:hover { background: #06b6d4; }
/* Unified scroller — KPIs + group cards + toggle + tabs + table scroll together
   between the fixed header and footer, so a short/zoomed viewport (or a long
   table) can reach ALL the content instead of clipping the strip above the
   table. Only present in the Supplier vault; the customer modal has no
   .cev-scroll element so its layout is unchanged. */
.cev-scroll {
  flex: 1 1 auto; min-height: 0; overflow-y: auto;
  display: flex; flex-direction: column;
  scrollbar-width: thin; scrollbar-color: #67e8f9 transparent;
}
.cev-scroll::-webkit-scrollbar { width: 8px; }
.cev-scroll::-webkit-scrollbar-thumb { background: #67e8f9; border-radius: 99px; }
.cev-scroll::-webkit-scrollbar-thumb:hover { background: #06b6d4; }
/* Inside the unified scroller the table area flows naturally (the scroller owns
   the overflow) but still grows to fill when the content is short. */
.cev-scroll .cev-body { flex: 1 0 auto; overflow: visible; }
/* Shipment tabs: ONE combined card like Standard Docs — section header fused to
   a Customer=/≠Consignee toggle band, fused to the table (no gaps). */
.cev-body-ship { gap: 0; }
.cev-body-ship .cev-ship-filter,
.cev-body-ship .cev-ship-filter-2 {
  align-self: stretch; width: auto; margin: 0; box-sizing: border-box;
  padding: 12px 14px; background: #fbfdff; border-radius: 0;
  border-left: 1px solid #e4e7f5; border-right: 1px solid #e4e7f5; border-bottom: 1px solid #e4e7f5;
}
[data-bs-theme="dark"] .cev-body-ship .cev-ship-filter,
[data-bs-theme="dark"] .cev-body-ship .cev-ship-filter-2 { background: #0a2630 !important; border-color: rgba(8,145,178,.28) !important; }

.cev-section {
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  padding: 13px 16px;
  background: linear-gradient(110deg, #fafbff 0%, #f3f5ff 100%);
  border: 1px solid #e4e7f5;
  border-radius: 10px 10px 0 0;
}
.cev-section-left { display: flex; align-items: center; gap: 12px; min-width: 0; }
.cev-section-icon {
  width: 34px; height: 34px; border-radius: 10px;
  background: linear-gradient(135deg, #ecfeff, #a5f3fc);
  color: #0891b2;
  border: 1px solid rgba(6,182,212,.22);
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 16px;
  box-shadow: 0 2px 6px rgba(6,182,212,.12);
}
.cev-section-title { font-size: 12.5px; font-weight: 800; color: #083344; }
.cev-section-sub   { font-size: 9.5px; color: #94a3b8; margin-top: 1px; }
.cev-section-right { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
.cev-section-count { font-size: 26px; font-weight: 800; color: #0c4a6e; line-height: 1; }
.cev-section-count-label { font-size: 9.5px; font-weight: 700; letter-spacing: .12em; color: #0891b2; margin-top: 2px; }
/* Figma-style status count pills on the section header band. */
.cev-sec-pill {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 4px 11px; border-radius: 999px;
  font-size: 11.5px; font-weight: 700; white-space: nowrap;
  border: 1px solid transparent;
}
.cev-sec-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
.cev-sec-pill-ok   { background: #ecfdf5; color: #059669; border-color: #a7f3d0; }
.cev-sec-pill-ok   .cev-sec-dot { background: #10b981; }
.cev-sec-pill-warn { background: #fffbeb; color: #b45309; border-color: #fde68a; }
.cev-sec-pill-warn .cev-sec-dot { background: #f59e0b; }
.cev-sec-pill-bad  { background: #fef2f2; color: #dc2626; border-color: #fecaca; }
.cev-sec-pill-bad  .cev-sec-dot { background: #ef4444; }
.cev-sec-pill-docs { background: #eff6ff; color: #2563eb; border-color: #bfdbfe; }
/* ─── Loading skeleton (shimmer) ─── */
.cev-skel { flex: 1; min-height: 0; overflow: hidden; padding: 16px 22px; display: flex; flex-direction: column; gap: 16px; }
.cev-sk { position: relative; overflow: hidden; background: #cffafe; border-radius: 12px; }
.cev-sk::after { content: ''; position: absolute; inset: 0; transform: translateX(-100%); background: linear-gradient(90deg, transparent, rgba(255,255,255,.7), transparent); animation: cevShimmer 1.3s ease-in-out infinite; }
@keyframes cevShimmer { 100% { transform: translateX(100%); } }
.cev-skel-kpis { display: flex; gap: 12px; }
.cev-skel-kpi { flex: 1; height: 74px; }
.cev-skel-groups { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.cev-skel-group { height: 60px; }
.cev-skel-tabs { display: flex; gap: 10px; }
.cev-skel-tab { width: 190px; height: 40px; border-radius: 999px; }
.cev-skel-section { height: 66px; }
.cev-skel-table { display: flex; flex-direction: column; gap: 10px; }
.cev-skel-thead { height: 38px; }
.cev-skel-row { height: 46px; border-radius: 10px; }
[data-bs-theme="dark"] .cev-sk { background: rgba(34,211,238,.12); }
[data-bs-theme="dark"] .cev-sk::after { background: linear-gradient(90deg, transparent, rgba(255,255,255,.10), transparent); }

.cev-filter-row { display: flex; gap: 8px; flex-wrap: wrap; }
.cev-filter { display: inline-flex; align-items: center; gap: 6px; padding: 5px 12px; border-radius: 999px; font-size: 11.5px; font-weight: 700; border: 1px solid transparent; }
.cev-filter-verified { background: #d1fae5; color: #047857; border-color: rgba(5,150,105,.30); }
.cev-filter-expiring { background: #fef3c7; color: #92400e; border-color: rgba(217,119,6,.30); }
.cev-filter-pending  { background: #fee2e2; color: #b91c1c; border-color: rgba(239,68,68,.30); }

.cev-table-wrap {
  background: #fff;
  border: 1px solid #e4e7f5;
  border-top: none;
  border-radius: 0 0 10px 10px;
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
/* Cap the table at ~5 rows and scroll inside it after that (instead of
 * letting the whole vault grow). The sticky thead pins to the top of THIS
 * scroll box, so the header stays visible while the extra rows scroll under
 * it. max-height (not a fixed height) means 2-4 row buckets still shrink to
 * their content with no empty space. overflow-x stays auto so wide tables
 * (min-width 980px) can still scroll sideways on narrow screens. */
.cev-table-scroll {
  overflow-x: auto;
  overflow-y: auto;
  max-height: 550px;
  scrollbar-width: thin;
}
.cev-table-scroll::-webkit-scrollbar { width: 8px; height: 8px; }
.cev-table-scroll::-webkit-scrollbar-thumb { background: rgba(8,145,178,.30); border-radius: 999px; }
.cev-table-scroll::-webkit-scrollbar-thumb:hover { background: rgba(8,145,178,.55); }
.cev-table-scroll::-webkit-scrollbar { height: 8px; width: 8px; }
.cev-table-scroll::-webkit-scrollbar-thumb { background: rgba(8,145,178,.30); border-radius: 999px; }
.cev-table { width: 100%; min-width: 980px; border-collapse: separate; border-spacing: 0; font-size: 13px; }
/* ONE continuous gradient across the whole header row (not per-column).
   The gradient + sticky both live on the <tr> so it spans left→right as a
   single band AND stays pinned on scroll; the <th> cells are transparent
   so they don't restart the gradient per column. */
.cev-table thead tr {
  position: sticky; top: 0; z-index: 3;
  background: linear-gradient(110deg, #083344 0%, #0c4a6e 60%, #0e7490 100%);
}
.cev-table thead th {
  padding: 9px 14px;         /* tighter than 12px — visually slim band */
  text-align: left;
  background: transparent;
  font-size: 10.5px; font-weight: 700; letter-spacing: .08em;
  color: rgba(255,255,255,.75); text-transform: uppercase;
  white-space: nowrap;
}
.cev-table tbody td { padding: 13px 14px; border-bottom: 1px solid #f0f2fa; vertical-align: middle; color: #334155; background: #fff; }
.cev-table tbody tr:nth-child(even) td { background: #fafbff; }
.cev-table tbody tr:last-child td { border-bottom: none; }
.cev-table tbody tr:hover td { background: #f0fdff; }
.cev-doc-name { font-weight: 700; color: #083344; }
.cev-mono { font-family: 'JetBrains Mono','SF Mono',ui-monospace,monospace; font-size: 12px; color: #1f2937; }
.cev-date { font-size: 12px; color: #475569; white-space: nowrap; }
.cev-attach { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; font-weight: 600; color: #0891b2; text-decoration: none; padding: 4px 10px; border: 1px solid #a5f3fc; border-radius: 8px; background: #f0fdff; white-space: nowrap; transition: all .15s; }
.cev-attach:hover { background: #cffafe; border-color: #67e8f9; color: #0e7490; }
.cev-attach i { font-size: 14px; flex-shrink: 0; }
/* Keep long filenames from stretching the Attachment column — cap the label
 * and ellipsize; the full name stays available via the cell's title tooltip. */
.cev-attach-name { max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cev-attach-muted { color: #94a3b8; background: #f8fafc; border-color: #e2e8f0; cursor: default; }
.cev-empty { padding: 30px !important; text-align: center; color: #94a3b8; font-style: italic; }
[data-bs-theme="dark"] .cev-date { color: #94a3b8; }
[data-bs-theme="dark"] .cev-attach { color: #67e8f9; background: rgba(8,145,178,.12); border-color: rgba(34,211,238,.30); }
[data-bs-theme="dark"] .cev-attach:hover { background: rgba(8,145,178,.22); color: #cffafe; }
[data-bs-theme="dark"] .cev-attach-muted { color: #64748b; background: rgba(255,255,255,.03); border-color: rgba(255,255,255,.08); }
.cev-muted { color: #94a3b8; font-style: italic; font-size: 12px; }

.cev-date {
  display: inline-block;
  font-size: 11.5px; font-weight: 600;
  padding: 3px 9px; border-radius: 6px;
  background: #ecfeff; color: #0e7490;
}
.cev-date-expiry[data-status="expiring"] { background: #fef3c7; color: #92400e; }
.cev-date-expiry[data-status="pending"]  { background: #fee2e2; color: #b91c1c; }

.cev-attach {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 3px 9px; border-radius: 6px;
  background: #cffafe; color: #0e7490;
  font-size: 11.5px; font-weight: 600;
  border: 1px solid rgba(8,145,178,.30);
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
.cev-row-act-upload   { color: #06b6d4; background: rgba(8,145,178,.08); border-color: rgba(8,145,178,.20); }
.cev-row-act-upload:hover:not(.is-disabled)   { background: rgba(8,145,178,.18); transform: translateY(-1px); }
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
[data-bs-theme="dark"] .cev-row-act-upload   { color: #67e8f9; background: rgba(8,145,178,.20); border-color: rgba(8,145,178,.40); }
[data-bs-theme="dark"] .cev-row-act-upload:hover:not(.is-disabled)   { background: rgba(8,145,178,.32); }
[data-bs-theme="dark"] .cev-row-act-send   { background: rgba(8,145,178,.24) !important; color: #67e8f9 !important; border-color: rgba(8,145,178,.42) !important; }
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
.cev-chip-pill { display: inline-flex; align-items: center; gap: 4px; padding: 3px 9px; border-radius: 6px; background: #cffafe; color: #0e7490; font-size: 11.5px; font-weight: 700; border: 1px solid rgba(8,145,178,.30); font-family: 'JetBrains Mono', ui-monospace, monospace; }
.cev-chip-pill-warm { background: #fef3c7; color: #92400e; border-color: rgba(217,119,6,.30); }
.cev-cust-cell { display: inline-flex; align-items: center; gap: 8px; }
.cev-cust-mono {
  width: 26px; height: 26px; border-radius: 50%;
  display: inline-flex; align-items: center; justify-content: center;
  background: linear-gradient(135deg, #06b6d4, #0891b2); color: #fff;
  font-size: 11.5px; font-weight: 800;
  flex-shrink: 0;
}
/* Coloured-number compliance cell — bold ratio + % beneath, no circle. */
.cev-ratio-num {
  display: inline-flex; flex-direction: column; align-items: center;
  line-height: 1.1; font-variant-numeric: tabular-nums;
}
.cev-ratio-num-main { font-size: 14px; font-weight: 800; letter-spacing: -0.01em; }
.cev-ratio-num-pct  { font-size: 9.5px; font-weight: 700; margin-top: 1px; opacity: .9; }
.cev-ratio-num[data-tone="good"] { color: #16a34a; }
.cev-ratio-num[data-tone="mid"]  { color: #f59e0b; }
.cev-ratio-num[data-tone="bad"]  { color: #dc2626; }

.cev-ship-filter { display: flex; gap: 8px; flex-wrap: wrap; }
/* 2-tab toggle (Buyer = / ≠ Consignee) — compact pills in a tray, not
   full-width, matching the Figma. */
.cev-ship-filter-2 {
  display: inline-flex; gap: 6px; padding: 4px;
  background: #eef2f7; border-radius: 12px; align-self: flex-start;
}
.cev-ship-filter-2 .cev-ship-fbtn {
  flex: 0 0 auto; min-width: 0;
  padding: 8px 18px; border: 1px solid rgba(8,145,178,.22); background: #fff; border-radius: 9px;
}
.cev-ship-filter-2 .cev-ship-fbtn:not(.is-active):hover { background: #f0fdff; border-color: rgba(8,145,178,.40); color: #0891b2; }
.cev-ship-fbtn {
  flex: 1; min-width: 160px;
  padding: 10px 18px;
  background: #fff;
  border: 1px solid rgba(8,145,178,.20);
  border-radius: 10px;
  color: #475569;
  font-size: 12.5px; font-weight: 700;
  cursor: pointer; transition: all .15s;
}
.cev-ship-fbtn:hover { background: #f0fdff; color: #0891b2; }
.cev-ship-fbtn.is-active {
  background: linear-gradient(135deg, #0891b2, #06b6d4);
  color: #fff; border-color: transparent;
  box-shadow: 0 4px 12px rgba(8,145,178,.30);
}

/* ─── FOOTER ─── */
.cev-footer {
  position: relative;
  flex-shrink: 0;
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 14px 24px;
  background: linear-gradient(110deg, #f0fdff 0%, #e6fafd 50%, #f0fdff 100%);
  border-top: 1.5px solid #bdf1fb;
  overflow: hidden;
}
.cev-footer::before {
  content: ''; position: absolute; top: 0; left: 0; right: 0; height: 1.5px;
  background: linear-gradient(90deg, transparent 0%, #67e8f9 30%, #06b6d4 50%, #67e8f9 70%, transparent 100%);
}
.cev-footer-meta { font-size: 12px; color: #64748b; }
.cev-footer-actions { display: flex; gap: 10px; }
.cev-btn {
  display: inline-flex; align-items: center; gap: 7px;
  padding: 9px 18px;
  border-radius: 10px;
  font-size: 12.5px; font-weight: 700;
  cursor: pointer; border: 1px solid transparent;
  transition: all .15s;
}
.cev-btn-light { background: linear-gradient(135deg, #cffafe 0%, #a5f3fc 100%); color: #0e7490; border: 1.5px solid rgba(6,182,212,.30); box-shadow: 0 2px 8px rgba(6,182,212,.15), inset 0 1px 0 rgba(255,255,255,.6); letter-spacing: .01em; }
.cev-btn-light:hover { background: linear-gradient(135deg, #a5f3fc 0%, #67e8f9 100%); transform: translateY(-1px); box-shadow: 0 5px 14px rgba(6,182,212,.28), inset 0 1px 0 rgba(255,255,255,.6); }
.cev-btn-dark  { background: linear-gradient(135deg, #0c4a6e, #06b6d4); color: #fff; box-shadow: 0 4px 14px rgba(12,74,110,.30); }
.cev-btn-dark:hover  { transform: translateY(-1px); box-shadow: 0 8px 22px rgba(12,74,110,.45); }
/* Spinner used by the Export All button while the XLSX workbook is
 * being built. Class-scoped to .cev-spin so it doesn't collide with
 * any global ri-spin rule the project may add later. */
.cev-spin { display: inline-block; animation: cevSpin .8s linear infinite; }
@keyframes cevSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

/* ─── DARK MODE — violet palette mapped to lavender-on-deep-purple ─── */
[data-bs-theme="dark"] .cev-card { background: #08222b; }
[data-bs-theme="dark"] .cev-groups-wrap { background: linear-gradient(180deg, #08222b 0%, #0a2a33 100%); }
[data-bs-theme="dark"] .cev-group { background: #0a2a33; border-color: rgba(34,211,238,.30); }
[data-bs-theme="dark"] .cev-group:hover { background: #0c3540; border-color: rgba(34,211,238,.5); }
[data-bs-theme="dark"] .cev-group.is-active { background: linear-gradient(120deg,#0c4a6e,#0891b2); border-color: #06b6d4; }
/* Inactive ghost button readable on the dark card; active stays solid white. */
[data-bs-theme="dark"] .cev-group-overview { background: linear-gradient(135deg, #06b6d4, #0891b2); color: #fff; border: none; }
[data-bs-theme="dark"] .cev-group-overview:hover { background: linear-gradient(135deg, #22d3ee, #0891b2); color: #fff; }
[data-bs-theme="dark"] .cev-group.is-active .cev-group-overview { background: #fff; color: #0891b2; border-color: #fff; }
[data-bs-theme="dark"] .cev-group.is-active .cev-group-overview:hover { background: #f0fdff; color: #0891b2; }
[data-bs-theme="dark"] .cev-group-icon { background: rgba(8,145,178,.22); color: #67e8f9; border-color: rgba(34,211,238,.3); }
[data-bs-theme="dark"] .cev-group.is-active .cev-group-icon { background: rgba(255,255,255,.18); color: #fff; }
[data-bs-theme="dark"] .cev-group-title { color: #cffafe; }
[data-bs-theme="dark"] .cev-group-sub { color: #7bb5c2; }
[data-bs-theme="dark"] .cev-tabs-wrap { background: #0a2a33; border-bottom-color: rgba(8,145,178,.30); }
[data-bs-theme="dark"] .cev-tab { color: #7bb5c2; }
[data-bs-theme="dark"] .cev-tab-icon { background: rgba(255,255,255,.05); color: #7bb5c2; }
[data-bs-theme="dark"] .cev-tab:hover { color: #67e8f9; }
[data-bs-theme="dark"] .cev-tab:hover .cev-tab-icon { background: rgba(34,211,238,0.12); color: #67e8f9; }
[data-bs-theme="dark"] .cev-tab.is-active { color: #67e8f9; border-bottom-color: #22d3ee; }
[data-bs-theme="dark"] .cev-tab.is-active .cev-tab-icon { background: rgba(34,211,238,0.18); color: #67e8f9; }
[data-bs-theme="dark"] .cev-tab-count { background: rgba(8,145,178,.18); color: #67e8f9; border-color: rgba(8,145,178,.35); }
[data-bs-theme="dark"] .cev-tab.is-active .cev-tab-count { background: linear-gradient(135deg,#06b6d4,#22d3ee); color: #fff; border-color: transparent; }
[data-bs-theme="dark"] .cev-kpi-outer { background: linear-gradient(180deg, #08222b 0%, #0a2a33 100%); border-bottom-color: rgba(8,145,178,.22); }
[data-bs-theme="dark"] .cev-kpi-fade-l { background: linear-gradient(90deg, #08222b 0%, #08222b 25%, rgba(8,34,43,0) 100%); }
[data-bs-theme="dark"] .cev-kpi-fade-r { background: linear-gradient(270deg, #0a2a33 0%, #0a2a33 25%, rgba(8,42,51,0) 100%); }
[data-bs-theme="dark"] .cev-kpi-nav { background: linear-gradient(135deg, #0c3540 0%, #08222b 100%); color: #67e8f9; box-shadow: 0 2px 6px rgba(0,0,0,.40), 0 8px 22px rgba(0,0,0,.50), inset 0 0 0 1px rgba(8,145,178,.30); }
[data-bs-theme="dark"] .cev-kpi-nav:hover { background: linear-gradient(135deg, #0891b2, #06b6d4); color: #fff; }
[data-bs-theme="dark"] .cev-kpi-tile { background: #0a2a33; border-color: rgba(8,145,178,.28); box-shadow: 0 2px 10px rgba(0,0,0,0.30); }
[data-bs-theme="dark"] .cev-kpi-tile:hover { border-color: rgba(8,145,178,.45); box-shadow: 0 6px 18px rgba(0,0,0,0.40); }
[data-bs-theme="dark"] .cev-kpi-label { color: #94a3b8; }
/* KPI numbers carry per-tile accent colours via inline style; in dark mode
   those light-mode hues read dim. brightness/saturate lifts whatever colour is
   applied, and the currentColor glow makes each number "shine" in its own hue. */
[data-bs-theme="dark"] .cev-kpi-value { color: #cffafe; filter: brightness(1.3) saturate(1.25); }
[data-bs-theme="dark"] .cev-body { background: #08222b; scrollbar-color: #0891b2 transparent; }
[data-bs-theme="dark"] .cev-body::-webkit-scrollbar-thumb { background: #0891b2; }
[data-bs-theme="dark"] .cev-body::-webkit-scrollbar-thumb:hover { background: #22d3ee; }
[data-bs-theme="dark"] .cev-section { background: linear-gradient(110deg, rgba(8,145,178,.14), rgba(34,211,238,.10)); border-color: rgba(8,145,178,.30); }
[data-bs-theme="dark"] .cev-section-title { color: #cffafe; }
[data-bs-theme="dark"] .cev-section-sub { color: #67e8f9; }
[data-bs-theme="dark"] .cev-section-count { color: #cffafe; }
[data-bs-theme="dark"] .cev-section-count-label { color: #67e8f9; }
[data-bs-theme="dark"] .cev-table-wrap { background: #0a2a33; border-color: rgba(8,145,178,.28); }
[data-bs-theme="dark"] .cev-table thead th {
  background:
    linear-gradient(180deg, rgba(8,145,178,.22) 0%, rgba(8,145,178,.16) 55%, rgba(12,74,110,.18) 100%);
  color: #67e8f9;
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,0.08),
    inset 0 -1px 0 rgba(8,145,178,0.40),
    0 4px 10px -8px rgba(0,0,0,0.40);
}
[data-bs-theme="dark"] .cev-table tbody td { color: #e2e8f0; border-bottom-color: rgba(8,145,178,.10); background: transparent; }
[data-bs-theme="dark"] .cev-table tbody tr:nth-child(even) td { background: rgba(8,145,178,.05); }
[data-bs-theme="dark"] .cev-table tbody tr:hover td { background: rgba(8,145,178,.12); }
[data-bs-theme="dark"] .cev-doc-name { color: #cffafe; }
[data-bs-theme="dark"] .cev-mono { color: #e2e8f0; }
[data-bs-theme="dark"] .cev-date { background: rgba(8,145,178,.16); color: #67e8f9; }
[data-bs-theme="dark"] .cev-date-expiry[data-status="expiring"] { background: rgba(245,158,11,.18); color: #fcd34d; }
[data-bs-theme="dark"] .cev-date-expiry[data-status="pending"]  { background: rgba(239,68,68,.18); color: #fca5a5; }
[data-bs-theme="dark"] .cev-attach { background: rgba(8,145,178,.16); color: #67e8f9; border-color: rgba(8,145,178,.30); }
[data-bs-theme="dark"] .cev-ratio-num[data-tone="good"] { color: #4ade80; }
[data-bs-theme="dark"] .cev-ratio-num[data-tone="mid"]  { color: #fcd34d; }
[data-bs-theme="dark"] .cev-ratio-num[data-tone="bad"]  { color: #fca5a5; }
[data-bs-theme="dark"] .cev-chip-pill { background: rgba(8,145,178,.16); color: #67e8f9; }
[data-bs-theme="dark"] .cev-chip-pill-warm { background: rgba(217,119,6,.18); color: #fcd34d; border-color: rgba(217,119,6,.30); }
[data-bs-theme="dark"] .cev-footer { background: #08222b; border-top-color: rgba(8,145,178,.22); }
[data-bs-theme="dark"] .cev-footer-meta { color: #cbd5e1; }
[data-bs-theme="dark"] .cev-btn-light { background: rgba(8,145,178,.12); color: #67e8f9; border-color: rgba(8,145,178,.30); }
[data-bs-theme="dark"] .cev-btn-light:hover { background: rgba(8,145,178,.18); }
[data-bs-theme="dark"] .cev-ship-fbtn { background: #0a2a33; color: #94a3b8; border-color: rgba(8,145,178,.28); }
[data-bs-theme="dark"] .cev-ship-fbtn:hover { color: #67e8f9; background: rgba(8,145,178,.10); }
[data-bs-theme="dark"] .cev-ship-filter-2 { background: rgba(8,145,178,.12); }
[data-bs-theme="dark"] .cev-ship-filter-2 .cev-ship-fbtn:not(.is-active) { background: #0a2a33; border-color: rgba(8,145,178,.28); }
[data-bs-theme="dark"] .cev-ship-fbtn.is-active { background: linear-gradient(135deg,#0891b2,#22d3ee); color: #06283a; border-color: transparent; box-shadow: 0 4px 14px rgba(34,211,238,.4); }
/* All badges — translucent colour fills on dark (match the segment chips). */
[data-bs-theme="dark"] .cev-req-m { background: rgba(16,185,129,.18) !important; color: #6ee7b7 !important; border-color: rgba(16,185,129,.4) !important; }
[data-bs-theme="dark"] .cev-req-o { background: rgba(148,163,184,.16) !important; color: #cbd5e1 !important; border-color: rgba(148,163,184,.32) !important; }
[data-bs-theme="dark"] .cev-sec-pill-ok   { background: rgba(16,185,129,.18) !important; color: #6ee7b7 !important; border-color: rgba(16,185,129,.4) !important; }
[data-bs-theme="dark"] .cev-sec-pill-warn { background: rgba(245,158,11,.18) !important; color: #fcd34d !important; border-color: rgba(245,158,11,.4) !important; }
[data-bs-theme="dark"] .cev-sec-pill-bad  { background: rgba(239,68,68,.18) !important; color: #fca5a5 !important; border-color: rgba(239,68,68,.4) !important; }
[data-bs-theme="dark"] .cev-sec-pill-docs { background: rgba(59,130,246,.18) !important; color: #93c5fd !important; border-color: rgba(59,130,246,.4) !important; }
[data-bs-theme="dark"] .cev-pill[data-status="Verified"] { background: rgba(16,185,129,.18) !important; color: #6ee7b7 !important; }
[data-bs-theme="dark"] .cev-pill[data-status="Signed"]   { background: rgba(59,130,246,.18) !important; color: #93c5fd !important; }
[data-bs-theme="dark"] .cev-pill[data-status="Expiring"] { background: rgba(245,158,11,.18) !important; color: #fcd34d !important; }
[data-bs-theme="dark"] .cev-pill[data-status="Pending"]  { background: rgba(239,68,68,.18) !important; color: #fca5a5 !important; }
[data-bs-theme="dark"] .cev-pill[data-status="Draft"]    { background: rgba(245,158,11,.18) !important; color: #fcd34d !important; }
[data-bs-theme="dark"] .cev-pill[data-status="Declined"],
[data-bs-theme="dark"] .cev-pill[data-status="Expired"]  { background: rgba(239,68,68,.18) !important; color: #fca5a5 !important; }
[data-bs-theme="dark"] .cev-pill[data-status="Recalled"] { background: rgba(148,163,184,.18) !important; color: #cbd5e1 !important; }
/* Expanded shipment detail panel (ShipmentDocPanel) — all inline light styles. */
[data-bs-theme="dark"] .cev-ship-expand > td { background: #08222b !important; }
[data-bs-theme="dark"] .cev-sdp [style*="background: rgb(255, 255, 255)"],
[data-bs-theme="dark"] .cev-sdp [style*="background:rgb(255, 255, 255)"] { background: #0a2630 !important; border-color: rgba(8,145,178,.28) !important; }
[data-bs-theme="dark"] .cev-sdp [style*="rgb(15, 23, 42)"] { color: #e2e8f0 !important; }
[data-bs-theme="dark"] .cev-sdp [style*="rgb(71, 85, 105)"] { color: #cbd5e1 !important; }
[data-bs-theme="dark"] .cev-sdp [style*="rgb(100, 116, 139)"] { color: #94a3b8 !important; }
[data-bs-theme="dark"] .cev-sdp tbody tr { border-bottom-color: rgba(8,145,178,.12) !important; }
[data-bs-theme="dark"] .cev-sdp [style*="rgb(241, 245, 249)"] { background: rgba(148,163,184,.18) !important; border-color: rgba(148,163,184,.32) !important; }
[data-bs-theme="dark"] .cev-sdp [style*="rgb(254, 243, 199)"] { background: rgba(245,158,11,.18) !important; border-color: rgba(245,158,11,.4) !important; }
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
  /* Narrow screens: wrap the columns instead of scrolling. */
  .cev-kpi-strip { padding: 10px 12px; gap: 4px 0; flex-wrap: wrap; }
  .cev-kpi-tile { flex: 1 1 140px; padding: 8px 12px; }
  .cev-kpi-value { font-size: 22px; }
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
  .cev-kpi-tile { flex: 1 1 130px; }
  .cev-tab { padding: 6px 12px; font-size: 11.5px; }
  .cev-tab-icon { width: 14px; height: 14px; font-size: 12px; }
  .cev-tab-count { font-size: 9.5px; padding: 1px 6px; }
  /* Tabs scroll sideways instead of squashing when they don't fit. */
  .cev-tabs { flex-wrap: nowrap; overflow-x: auto; -webkit-overflow-scrolling: touch; }
  .cev-tab { flex: 0 0 auto; }
  /* Section header (title + status pills) stacks so pills don't overflow. */
  .cev-section { flex-direction: column; align-items: flex-start; gap: 8px; }
  .cev-section-right { width: 100%; flex-wrap: wrap; }
}
@media (max-width: 480px) {
  .cev-header { padding: 10px 12px; }
  .cev-header-title { font-size: 15px; margin-bottom: 5px; }
  .cev-header-eyebrow { font-size: 9px; }
  .cev-vault-icon { width: 34px; height: 34px; border-radius: 9px; }
  .cev-header-meta { font-size: 10px; }
  .cev-kpi-strip { padding: 8px 10px; }
  /* Exactly two KPI tiles per row on phones. */
  .cev-kpi-tile { flex: 1 1 calc(50% - 2px); padding: 7px 10px; }
  .cev-kpi-value { font-size: 19px; }
  .cev-groups-wrap { padding: 10px 12px 0; }
  .cev-tabs-wrap { padding: 8px 10px; }
  .cev-body { padding: 12px 12px 16px; }
  .cev-footer { padding: 10px 12px; }
  .cev-footer-meta { font-size: 11px; }
}
`;
