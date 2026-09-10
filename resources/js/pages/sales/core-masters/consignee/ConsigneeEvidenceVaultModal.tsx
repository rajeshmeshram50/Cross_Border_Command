import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { ShipmentDocPanel, ShipmentDocSendForSignature, SevStat, type VaultShipmentDoc } from '../customer/CustomerEvidenceVaultModal';
/* Shared Evidence Vault stylesheet — the same one the Customer and Supplier
   vaults load. Brings in the `.sev-stat*` ring cards used below (and the
   `.cev-*` shell the next step moves onto). Consignee markup is `.cev-*`
   today, so nothing here collides with what this file already styles. */
import '../../../p2p/p2p-master-management/supplier-management/supplier-evidence-vault.css';
import SalesDocSendForSignatureModal from '../../opportunity-pipeline/matrix/stages/SalesDocSendForSignatureModal';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import api from '../../../../api';
import Tooltip from '../../../../components/ui/Tooltip';
import { useToast } from '../../../../contexts/ToastContext';
import { signatureRequestsToVaultDocs, mergeTradeDocuments, overlayShipmentSigStatus, type SigReqRow } from '../../../../utils/vaultSignatureRows';
import { downloadFile, saveApiBlob } from '../../../../utils/downloadFile';
import { resolveFileUrl } from '../../../../utils/resolveFileUrl';
import SalesCustomerSendForSignatureModal from '../customer/SalesCustomerSendForSignatureModal';
import { SigningTrackerModal } from '../../opportunity-pipeline/SigningTrackerModal';

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
  /** Mandatory / Optional per the segment DCP rules — drives the
   *  Requirement column (matches the Customer vault's table). */
  requirement?: 'M' | 'O' | null;
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
  /** Deal has a shipment order. False → the Shipment ID column has nothing real to show. */
  has_shipment?: boolean;
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
  agreements_count:       number;
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

/* `overview` is the action button's label. Both buttons open the same
 * document-overview panel, but what that panel is FOR differs by group:
 * the standard one is a read-through of every KYC / DD / licence, while the
 * case-to-case one is where trade documents and agreements get sent for
 * signature (each row carries its own Send action). Naming them after the
 * job — as the Customer and Supplier vaults do — beats printing
 * "Document Overview" twice and leaving the user to guess. */
const GROUPS: { key: GroupKey; title: string; sub: string; icon: string; overview: string }[] = [
  { key: 'standard',     title: 'Standard Documents',                  sub: 'ONE TIME · KYC, DD & LICENSES',      icon: 'ri-shield-check-line', overview: 'All Standard Document Overview' },
  { key: 'case-to-case', title: 'Case to Case Documents & Agreements', sub: 'PER DEAL · TRADE DOCS & AGREEMENTS', icon: 'ri-todo-line',         overview: 'Send Documents & Agreements for Signature' },
];

const TABS: { key: TabKey; label: string; icon: string; countKey: keyof VaultData; group: GroupKey }[] = [
  { key: 'company-dd',          label: 'Company Due Diligence', icon: 'ri-shield-check-line',   countKey: 'company_dd_count',       group: 'standard' },
  { key: 'owner-kyc',           label: 'Owner KYC Details',     icon: 'ri-user-3-line',         countKey: 'owner_kyc_count',        group: 'standard' },
  { key: 'trade-licenses',      label: 'Trade Licenses',        icon: 'ri-file-list-3-line',    countKey: 'trade_license_count',    group: 'standard' },
  { key: 'trade-documents',     label: 'Trade Documents',       icon: 'ri-article-line',        countKey: 'trade_documents_count',  group: 'case-to-case' },
  { key: 'shipment-agreements', label: 'Agreements',            icon: 'ri-truck-line',          countKey: 'total_shipments',        group: 'case-to-case' },
];

const groupOfTab = (t: TabKey): GroupKey => TABS.find(x => x.key === t)?.group ?? 'standard';

/* ─── Empty vault — the zero-state used until the live payload lands, and
 *      when the fetch fails or the consignee has no saved record yet. There is
 *      deliberately NO demo data: an empty vault must read as empty, never as
 *      a set of plausible-looking rows a reviewer could mistake for real
 *      compliance evidence. The loading skeleton covers the fetch itself. */
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
  shipment_agreements:   [],
  last_updated:          '—',
};

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
  // Upload in flight → block tab switches + closing the vault (ref-counted).
  const uploadingRef = useRef(0);
  const [uploading, setUploading] = useState(false);
  const onRowBusyChange = useCallback((busy: boolean) => {
    uploadingRef.current = Math.max(0, uploadingRef.current + (busy ? 1 : -1));
    setUploading(uploadingRef.current > 0);
  }, []);
  const [group, setGroup] = useState<GroupKey>('standard');
  /* "+N more" segment overflow popover — a titled list (matches the CLM pages'
   * authority/segment popovers), opened on click from the header chip. */
  const [segPop, setSegPop] = useState<{ names: string[]; x: number; y: number } | null>(null);
  // "Document Overview" popup — set to a group key to open the all-docs list.
  const [overview, setOverview] = useState<GroupKey | null>(null);
  const [overviewPage, setOverviewPage] = useState(1);
  // Active shipment tab inside the Case-to-Case Document Overview popup.
  const [ovShip, setOvShip] = useState<number | null>(null);
  // Row currently downloading in the Document Overview — drives a per-row spinner.
  const [ovDownloadingKey, setOvDownloadingKey] = useState<string | null>(null);

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
   * to EMPTY_VAULT if the fetch fails or the consignee has no db_id
   * (unsaved record) — never to demo rows. */
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
  /* Ticked rows in the Case-to-Case overview, held as the row keys built by
     `ovDocKey` rather than array indexes — the list re-orders when a different
     shipment is chosen, and indexes would then point at the wrong documents. */
  const [ovPicked, setOvPicked] = useState<string[]>([]);
  /* Signing tracker launched from an overview row. Held here rather than in
     the row because the overview table is rebuilt on every shipment switch. */
  const [ovTrack, setOvTrack] = useState<{ id: number; code: string } | null>(null);

  /* Shipment Send-for-Signature — launches the preview + signature-box wizard
   * for one not-yet-sent shipment document. */
  const [shipSend, setShipSend] = useState<{ leadId: number; doc: VaultShipmentDoc; docs?: VaultShipmentDoc[]; party: 'buyer' | 'consignee' } | null>(null);
  // PI row → Sales-Matrix Q/PI Send-for-Signature modal (routed by doc.pi_id).
  const [piSend, setPiSend] = useState<{ leadId: number; doc: VaultShipmentDoc } | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && uploadingRef.current === 0) onClose(); };
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
   * db_id. Failure leaves vaultLive at null, and the vault then renders
   * as EMPTY_VAULT rather than inventing rows. */
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
    /* Priority: explicit `data` prop > live API > empty vault. No demo
     * fallback — an unloaded or failed vault reads as genuinely empty. */
    const base = data ?? vaultLive ?? EMPTY_VAULT;
    if (!base) return null;
    // Trade Documents tab = the party's expected trade docs (segment-rule
    // td, party-filtered to mirror the edit form) merged with their live
    // Zoho Sign status. Each row exposes Send-for-Signature; signed rows
    // also carry the signed PDF + certificate links.
    const sigRows            = signatureRequestsToVaultDocs(signatureRows);
    const baseSegmentTd      = (base.trade_documents ?? []) as VaultDoc[];
    const mergedTd           = mergeTradeDocuments(baseSegmentTd as any, sigRows, 'consignee') as unknown as VaultDoc[];
    // Overlay freshly-synced signature status onto the shipment deal docs — the
    // vault endpoint reads the DB status without a Zoho sync, so a just-declined
    // doc can read "Pending" there (see CustomerEvidenceVaultModal for detail).
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
        'Customer = Consignee':  s.buyer_is_consignee ? 'Yes' : 'No',
      });

      const summary = [
        { Field: 'Consignee ID',          Value: consignee.id },
        { Field: 'Company',               Value: consignee.company },
        { Field: 'Linked Customer',       Value: consignee.customerId || '' },
        { Field: 'Risk',                  Value: consignee.risk ?? 'Low' },
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

  /* Status badge for the overview list.
   *
   * Text only — no leading glyph and no dot. The ✓ / ⚠ / ⌛ marks it started
   * with are emoji-class characters that render at a different weight and
   * baseline on every platform, so the badges sat unevenly beside each other;
   * the badge's own fill already carries the state.
   *
   * Signed is green, not blue. It is the settled, nothing-left-to-do state in
   * this list, exactly like Verified, and colouring it separately implied a
   * distinction that does not exist. */
  const StatusPill = ({ s }: { s: VaultStatus }) => {
    const tone =
      s === 'Verified' || s === 'Signed' ? { bg: '#dcfce7', fg: '#15803d', bd: '#bbf7d0' }
      : s === 'Expiring' ? { bg: '#fef3c7', fg: '#b45309', bd: '#fde68a' }
      :                    { bg: '#fef2f2', fg: '#dc2626', bd: '#fecaca' };
    return (
      <span className="cev-pill" data-status={s} style={{ background: tone.bg, color: tone.fg, border: `1px solid ${tone.bd}` }}>
        {s}
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
  /* Section-banner tally, by real document STATUS rather than just whether a
   * file is attached. An uploaded-but-expired licence is still a problem, and
   * "Uploaded 9" hid that — it counted the attachment and said nothing about
   * whether the document is still good. Same breakdown the Supplier vault
   * shows. */
  const statusTally = {
    Verified: docsForTab.filter(d => evEffectiveStatus(d) === 'Verified').length,
    Signed:   docsForTab.filter(d => evEffectiveStatus(d) === 'Signed').length,
    Expiring: docsForTab.filter(d => evEffectiveStatus(d) === 'Expiring').length,
    Expired:  docsForTab.filter(d => evEffectiveStatus(d) === 'Expired').length,
    Pending:  docsForTab.filter(d => evEffectiveStatus(d) === 'Pending').length,
  };

  const tabMeta = TABS.find(t => t.key === tab)!;

  /* Tab badge count. Trade Documents / Agreements are shipment-wise, so
   * their badge reflects the real number of trade docs / agreements across
   * all shipments (sum of each shipment's ratio total), not the standard KPI. */
  const ratioTotal = (ratio: string) => { const p = (ratio || '').split('/'); return parseInt(p[1] ?? p[0], 10) || 0; };
  const shipmentDocCount = (key: 'trade_docs' | 'agreement') =>
    vault.shipment_agreements.reduce((acc, r) => acc + ratioTotal(r[key].ratio), 0);
  const tabCount = (t: typeof TABS[number]): number =>
    t.key === 'trade-documents'     ? shipmentDocCount('trade_docs')
    : t.key === 'shipment-agreements' ? shipmentDocCount('agreement')
    : (vault[t.countKey] as number);

  /* Stat-row figures, matching the Customer and Supplier vaults.
   *
   * These are derived from the SAME `vault` payload the old KPI tiles read —
   * nothing new is fetched. The difference is that they are split by GROUP:
   * the Standard row counts uploaded-vs-pending across DD + KYC + Licences,
   * the Case-to-Case row counts signed-vs-pending across the shipment
   * matrix. The old strip showed all nine numbers at once regardless of
   * which group was selected, so half of them never applied to what was on
   * screen below. */
  const stdAll   = [...vault.company_dd, ...vault.owner_kyc, ...vault.trade_licenses];
  const stdTotal = stdAll.length;
  const stdUp    = stdAll.filter(isUploaded).length;
  const stdPend  = stdTotal - stdUp;
  const splitOf  = (rows: VaultDoc[]) => {
    const up = rows.filter(isUploaded).length;
    return { up, pend: rows.length - up };
  };

  /* Case-to-case rows carry "signed/total" ratios per shipment, so the
     signed half comes from the ratio's numerator rather than an attachment. */
  const ratioDone = (ratio: string) => { const p = (ratio || '').split('/'); return parseInt(p[0], 10) || 0; };
  const shipmentDocDone = (key: 'trade_docs' | 'agreement') =>
    vault.shipment_agreements.reduce((acc, r) => acc + ratioDone(r[key].ratio), 0);
  const tdTotal  = shipmentDocCount('trade_docs');
  const tdDone   = shipmentDocDone('trade_docs');
  const agrTotal = shipmentDocCount('agreement');
  const agrDone  = shipmentDocDone('agreement');
  const c2cTotal = tdTotal + agrTotal;
  const c2cDone  = tdDone + agrDone;
  const c2cPend  = c2cTotal - c2cDone;

  /* Show the skeleton only on the FIRST load (live data not in yet, no
   * explicit data prop). Re-fetches keep the current content visible. */
  const showSkeleton = loading && !vaultLive && !data;

  return createPortal(
    <div className="cev-overlay sev-overlay" role="dialog" aria-modal="true" onMouseDown={(e) => { if (e.target === e.currentTarget && !uploading) onClose(); }}>
      <style>{CNEV_CSS}</style>
      {/* `sev` is the scope hook the shared stylesheet needs: every ring-card
          rule in supplier-evidence-vault.css is written as `.sev .sev-stat…`,
          so without it the stat SVGs render unstyled — an uncapped circle at
          its natural size. It carries no styles of its own, and the rest of
          this markup is `.cev-*`, so nothing else in that sheet can reach it. */}
      {/* `cnev-vault` is this vault's own hook. The shared stylesheet is used
          by the customer and supplier vaults too, so every consignee-only
          correction in CNEV_CSS hangs off this class and cannot reach them. */}
      <div className="cev-card sev cnev-vault" onMouseDown={(e) => e.stopPropagation()}>
        {/* ─── HEADER ─── */}
        <div className="cev-header">
          <div className="cev-header-bg" aria-hidden />
          <span className="cev-header-orb" aria-hidden />
          <div className="cev-header-content">
            <div className="cev-header-left">
              <div className="cev-vault-icon">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="3" width="20" height="5" rx="1.5" />
                  <path d="M4 8v12a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V8" />
                  <line x1="10" y1="13" x2="14" y2="13" />
                  <line x1="10" y1="17" x2="14" y2="17" />
                </svg>
                <span className="cev-vault-icon-tick" aria-hidden>
                  <svg width="7" height="7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12" /></svg>
                </span>
              </div>
              <div className="cev-header-text">
                {/* The leading em-dash is drawn by the stylesheet, so it is not
                    written here — the Customer and Supplier vaults do the same. */}
                <div className="cev-header-eyebrow">PARTY WISE CLM: CONSIGNEE EVIDENCE VAULT</div>
                {/* Code and name split into their own spans: the code renders
                    mono and tinted, the name in plain white, matching the
                    "S-001 — Raipur Agro Supplies Pvt Ltd" treatment. */}
                <div className="cev-header-title">
                  <span className="sev-hd-code">{consignee.id}</span>
                  <span className="sev-hd-dash" aria-hidden>—</span>
                  <span className="sev-hd-nm">{consignee.company}</span>
                </div>
                {/* One chip per fact, all on a single row. Contact, city,
                    segment, country and risk used to be split between the
                    left chip row and a plain-text meta block on the right;
                    they are one row now, as on the other two vaults. */}
                <div className="cev-header-chips">
                  {consignee.contact && (
                    <span className="cev-chip cev-chip-contact">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                      {consignee.contact}
                    </span>
                  )}
                  {consignee.contactCity && <span className="cev-chip cev-chip-city">{consignee.contactCity}</span>}
                  {/* Consignee-only chip — the customer this consignee hangs
                      off. No equivalent on the other two vaults, kept here
                      because it is the fastest way back to the parent. */}
                  {consignee.customerId && <span className="cev-chip cev-chip-link">↳ {consignee.customerId}</span>}
                  {consignee.segment && (() => {
                    /* One segment inline; the rest collapse into a "+N more"
                     * chip whose popover lists every segment. Five used to be
                     * shown, which overflowed a header this size. */
                    const segs = String(consignee.segment).split(',').map(s => s.trim()).filter(Boolean);
                    if (segs.length === 0) return null;
                    const shown = segs.slice(0, 1);
                    const extra = segs.length - shown.length;
                    return (
                      <>
                        {shown.map((s, i) => (
                          <Tooltip key={`${s}-${i}`} label={s}>
                            <span className="cev-chip cev-chip-seg">{s.length > 20 ? s.slice(0, 20) + '…' : s}</span>
                          </Tooltip>
                        ))}
                        {extra > 0 && (
                          <button
                            type="button"
                            className="cev-chip cev-chip-seg sev-chip-more"
                            onClick={e => { const b = e.currentTarget.getBoundingClientRect(); setSegPop(prev => prev ? null : { names: segs, x: b.left, y: b.bottom + 6 }); }}
                          >+{extra} more</button>
                        )}
                      </>
                    );
                  })()}
                  {consignee.country && <span className="cev-chip cev-chip-country">{consignee.country}</span>}
                  <span className="cev-chip cev-chip-risk" data-risk={(consignee.risk ?? 'Low').replace(/\s*risk$/i, '').toLowerCase()}>{(consignee.risk ?? 'Low').replace(/\s*risk$/i, '')} Risk</span>
                </div>
              </div>
            </div>
            <div className="cev-header-right">
              <button type="button" className="cev-close" onClick={() => { if (!uploading) onClose(); }} disabled={uploading} title={uploading ? 'Please wait — an upload is in progress' : 'Close vault'} style={uploading ? { opacity: .5, cursor: 'not-allowed' } : undefined} aria-label="Close vault">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
          </div>
        </div>

        {showSkeleton ? <VaultSkeleton /> : (<>
        {/* ─── GROUP CARDS — Standard Documents vs Case to Case.
             Now FIRST, ahead of the stats. The group is what the stats are
             about, so it has to be chosen before they mean anything — the
             Customer and Supplier vaults are ordered the same way. */}
        <div className="cev-groups-wrap">
          <div className="cev-groups">
            {GROUPS.map(g => (
              <div key={g.key} className={`cev-group ${group === g.key ? 'is-active' : ''}`}>
                {/* Titles are truncated by the card, so the full title + sub
                    goes in a tooltip — same as the customer vault. */}
                <Tooltip label={`${g.title} — ${g.sub}`}>
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
                </Tooltip>
                <button
                  type="button"
                  className="cev-group-overview"
                  onClick={() => { setOverview(g.key); setOverviewPage(1); setOvShip(null); setOvPicked([]); }}
                  title="View all documents in one list"
                >
                  <i className="ri-list-check-2" aria-hidden /> {g.overview}
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* ─── STAT ROW — ring cards, identical to the Customer and Supplier
             vaults. Swaps with the selected group so every figure on it
             describes the documents listed underneath. */}
        <div className="sev-stats">
          {group === 'standard' ? (<>
            <SevStat tone="slate" icon="ri-file-list-3-line"     label="Total Standard Documents" value={stdTotal} part={stdTotal} whole={stdTotal} split={{ up: stdUp, pend: stdPend }} />
            <SevStat tone="green" icon="ri-checkbox-circle-line" label="Verified / Uploaded"      value={stdUp}    part={stdUp}    whole={stdTotal} tag="Compliant" />
            <SevStat tone="red"   icon="ri-error-warning-line"   label="Pending"                  value={stdPend}  part={stdPend}  whole={stdTotal} tag="Action needed" />
            <SevStat tone="teal"  icon="ri-building-2-line"      label="Company Due Diligence"    value={vault.company_dd.length}     part={vault.company_dd.length}     whole={stdTotal} split={splitOf(vault.company_dd)} />
            <SevStat tone="teal"  icon="ri-user-3-line"          label="Owner KYC"                value={vault.owner_kyc.length}      part={vault.owner_kyc.length}      whole={stdTotal} split={splitOf(vault.owner_kyc)} />
            <SevStat tone="teal"  icon="ri-file-shield-2-line"   label="Trade License"            value={vault.trade_licenses.length} part={vault.trade_licenses.length} whole={stdTotal} split={splitOf(vault.trade_licenses)} />
          </>) : (<>
            <SevStat tone="slate" icon="ri-file-list-3-line"     label="Total Case to Case Documents" value={c2cTotal} part={c2cTotal} whole={c2cTotal} split={{ up: c2cDone, pend: c2cPend, upLabel: 'signed', pendLabel: 'pending' }} />
            <SevStat tone="green" icon="ri-checkbox-circle-line" label="Total Signed"                 value={c2cDone}  part={c2cDone}  whole={c2cTotal} tag="Complete" />
            <SevStat tone="red"   icon="ri-error-warning-line"   label="Pending for Sign"             value={c2cPend}  part={c2cPend}  whole={c2cTotal} tag="Action needed" />
            <SevStat tone="teal"  icon="ri-article-line"         label="Trade Documents"              value={tdTotal}  part={tdTotal}  whole={c2cTotal} split={{ up: tdDone,  pend: tdTotal - tdDone,   upLabel: 'signed', pendLabel: 'pending' }} />
            <SevStat tone="amber" icon="ri-draft-line"           label="Total Agreements"             value={agrTotal} part={agrTotal} whole={c2cTotal} split={{ up: agrDone, pend: agrTotal - agrDone, upLabel: 'signed', pendLabel: 'pending' }} />
            <SevStat tone="slate" icon="ri-truck-line"           label="Total Shipments"              value={vault.total_shipments} part={vault.total_shipments} whole={vault.total_shipments} />
          </>)}
        </div>

        {/* ─── SUB-TABS — for the active group. */}
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
            the table → separated-cards layout; flat tabs keep section fused. */}
        <div className={`cev-body ${(tab === 'shipment-agreements' || tab === 'trade-documents') ? 'cev-body-ship' : ''}`}>
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
                  {statusTally.Verified > 0 && <span className="cev-sec-pill cev-sec-pill-ok"><span className="cev-sec-dot" />Verified {statusTally.Verified}</span>}
                  {statusTally.Signed > 0 && <span className="cev-sec-pill cev-sec-pill-ok"><span className="cev-sec-dot" />Signed {statusTally.Signed}</span>}
                  {statusTally.Expiring > 0 && <span className="cev-sec-pill sev-sec-pill-warn"><span className="cev-sec-dot" />Expiring {statusTally.Expiring}</span>}
                  {statusTally.Expired > 0 && <span className="cev-sec-pill cev-sec-pill-bad"><span className="cev-sec-dot" />Expired {statusTally.Expired}</span>}
                  {statusTally.Pending > 0 && <span className="cev-sec-pill cev-sec-pill-bad"><span className="cev-sec-dot" />Pending {statusTally.Pending}</span>}
                  <span className="cev-sec-pill cev-sec-pill-docs">{docsForTab.length} Documents</span>
                </>
              )}
            </div>
          </div>

          {(tab === 'shipment-agreements' || tab === 'trade-documents')
            ? <ShipmentTable rows={vault.shipment_agreements} kind={tab === 'trade-documents' ? 'trade' : 'agreement'}
                             onSend={(leadId, doc, party) => { if (doc.pi_id) setPiSend({ leadId, doc }); else setShipSend({ leadId, doc, party }); }}
                             activeSend={shipSend ?? (piSend ? { ...piSend, party: 'consignee' as const } : null)}
                             onBulkSend={(leadId, docs, party) => { if (docs.length) setShipSend({ leadId, doc: docs[0], docs, party }); }} />
            : <DocsTable rows={docsForTab} tab={tab} ownerType="consignee" ownerId={consignee?.db_id ?? null} onReload={reloadVault}
                         onSendTradeDoc={(d) => { if (d.db_id) setSendDocIds([d.db_id]); }}
                         onRemindTradeDoc={handleRemind} onRowBusyChange={onRowBusyChange} />}
        </div>

        </>)}

        {/* ─── FOOTER ─── */}
        <div className="cev-footer">
          {/* Was an empty spacer, which left the footer bar looking unfinished
              next to the other two vaults. `last_updated` was already in the
              payload and already goes into the Export All workbook — it just
              was not shown. */}
          <div className="cev-footer-meta">
            <span className="sev-foot-upd">Last updated:&nbsp;<strong>{vault.last_updated || '—'}</strong></span>
            <span className="sev-foot-div" aria-hidden />
            <span className="sev-foot-managed"><i className="ri-shield-check-line" aria-hidden /> Vault managed by Compliance Team</span>
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
                {exporting ? 'Exporting…' : 'Export All'}
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
          up to 3 places (Legal Team #9). Mirrors the Customer vault. */}
      <SalesCustomerSendForSignatureModal
        /* Bigger signature box — a company signature is routinely wider than the
           150pt default and Zoho prints it past the field, over the next one.
           Opt-in, so Quotation / PI keep their tuned placements. */
        boxSize={{ width: 240, height: 55 }}
        open={Array.isArray(sendDocIds)}
        customer={consignee?.db_id ? {
          id:      consignee.id,
          db_id:   consignee.db_id,
          company: consignee.company,
          contact: consignee.contact,
        } : null}
        modelName="Consignee"
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

      {/* Proforma Invoice Send-for-Signature — same Zoho-sign flow as the
          Sales-Matrix Q/PI stage (kind='pi'), launched from the PI row. */}
      {piSend && piSend.doc.pi_id && (
        <SalesDocSendForSignatureModal
          open={!!piSend}
          kind="pi"
          docId={piSend.doc.pi_id}
          docCode={piSend.doc.pi_code ?? null}
          leadId={piSend.leadId}
          customerName={consignee?.company ?? null}
          onClose={() => setPiSend(null)}
          onSent={() => { setPiSend(null); void reloadVault(); void reloadSignatures(); }}
        />
      )}

      {/* Document Overview popup — all documents for the chosen group in one
          flat list (name + status + download). */}
      {overview && (() => {
        const isStd = overview === 'standard';
        /* Case-to-Case: every document on the shipment, segregated by shipment
           (one tab per shipment) — same set the expanded panel now shows across
           its Customer / Consignee / Both tabs. Listing only the consignee side
           here would contradict the panel two clicks away.
           A Buyer+Consignee document is emitted into BOTH payload lists with
           the same db_id, so the merge has to de-dupe or it shows twice. */
        const ovDocKey = (d: VaultShipmentDoc) =>
          d.db_id != null ? `${d.doc_type ?? ''}#${d.db_id}` : `n#${d.name}#${d.sig_req_id}`;
        const dedupeDocs = (list: VaultShipmentDoc[]): VaultShipmentDoc[] => {
          const seen = new Set<string>();
          return list.filter((d) => { const k = ovDocKey(d); if (seen.has(k)) return false; seen.add(k); return true; });
        };
        /* Which side's documents this consignee may see, per deal.
         *
         * This was inverted — copied from the customer vault with only the
         * `buyer_is_consignee` branch swapped, so a deal with a SEPARATE
         * consignee merged in `trade_docs_buyer` and put the buyer's Proforma
         * Invoice in a consignee's list. The ratio built server-side already
         * applied the right rule, so the tile and the list disagreed.
         *
         * The rule, matching SegmentDocUploadController's $tradeAll:
         *   buyer_is_consignee  → the deal's consignee IS the buyer, one
         *                         company, so it sees both sides.
         *   otherwise           → two separate companies; the consignee sees
         *                         only its own side.
         *
         * The PI is excluded either way. It is raised to the buyer, carries
         * the buyer's commercial terms and is signed by the buyer; a consignee
         * is not a party to it under either arrangement, and the customer's
         * own vault already carries it. `pi_id` is what marks that row. */
        const withoutPi = (list: VaultShipmentDoc[]) => list.filter((d) => !d.pi_id);
        const shipDocsOf = (r: VaultShipmentRow): VaultShipmentDoc[] => r.buyer_is_consignee
          ? dedupeDocs([
              ...withoutPi(r.trade_docs_buyer ?? []),
              ...(r.trade_docs_consignee ?? []),
              ...withoutPi(r.agreements_buyer ?? []),
              ...(r.agreements_consignee ?? []),
            ])
          : [
              ...(r.trade_docs_consignee ?? []),
              ...(r.agreements_consignee ?? []),
            ];
        const shipments     = isStd ? [] : vault.shipment_agreements;
        const shipsWithDocs = isStd ? [] : shipments.filter((r) => shipDocsOf(r).length > 0);
        /* No auto-select of the first shipment any more. The panel opens on a
           chooser and only shows a document list once a shipment is picked —
           the two-step flow the customer and supplier vaults use. Falling
           straight into shipment #1 was misleading: the header named the
           bucket, not the deal, so a list of one shipment's documents read as
           if it were the whole case-to-case set. */
        const activeShip    = isStd ? null : (shipsWithDocs.find((r) => r.id === ovShip) ?? null);
        const picking       = !isStd && !activeShip;
        const docs: (VaultDoc | VaultShipmentDoc)[] = isStd
          ? [...vault.company_dd, ...vault.owner_kyc, ...vault.trade_licenses]
          : (activeShip ? shipDocsOf(activeShip) : []);
        const shipLabel = (r: VaultShipmentRow) => (r.has_shipment === false ? 'Not shipped' : r.shipment_id);

        /* Multi-select. Only case-to-case rows are tickable — standard DD / KYC
         * rows are uploads, not signature envelopes, so there is nothing to
         * send them to.
         *
         * A row is sendable only once it has a db_id: without one it was never
         * saved against this deal and the signature request has nothing to
         * point at. And one envelope carries one library, so a mixed tick list
         * (a trade document AND an agreement) has no single destination. Both
         * cases keep the button on screen but disabled, with the reason on the
         * tooltip, rather than quietly dropping rows from the send. */
        /* Which rows this panel can actually send.
         *
         * The send modal here runs in its default 'trade-doc' mode, so it
         * resolves ids against the TRADE DOCUMENT library only. An agreement
         * needs the same modal opened with mode="agreement" plus an
         * agreementContext (lead + signers), which this vault does not wire
         * up — the main Case-to-Case table gates its Send on category 'td'
         * for exactly that reason. Offering Resend on an agreement row would
         * hand the modal an id it cannot find.
         *
         * Already-signed and in-flight rows are excluded too, matching the
         * main table: there is nothing to resend on a completed envelope, and
         * a pending one wants a reminder, not a second send. */
        const sendableDoc = (d: VaultShipmentDoc) =>
          !!d.db_id
          && (d.doc_type ?? 'trade') !== 'agreement'
          && d.status !== 'Signed'
          && d.status !== 'Pending';
        const sendReason = (d: VaultShipmentDoc) =>
          !d.db_id ? 'Not saved against this deal yet'
          : (d.doc_type ?? 'trade') === 'agreement' ? 'Agreements are sent from the Case to Case tab, not here'
          : d.status === 'Signed' ? 'Already signed — nothing to resend'
          : d.status === 'Pending' ? 'Already out for signature — use Reminder instead'
          : 'Send this document for signature again';

        const keyed    = isStd ? [] : (docs as VaultShipmentDoc[]).map((doc) => ({ key: ovDocKey(doc), doc }));
        const sendable = keyed.filter((r) => sendableDoc(r.doc));
        const picked   = keyed.filter((r) => ovPicked.includes(r.key));
        const pickedIds = picked.map((r) => r.doc.db_id).filter((n): n is number => !!n);
        /* Every ticked row is sendable by construction — only sendable rows
           can be ticked — so this is a guard against stale ticks, not a
           second rule the user has to satisfy. */
        const canBulk  = picked.length > 0 && picked.every((r) => sendableDoc(r.doc));
        const allTicked = sendable.length > 0 && sendable.every((r) => ovPicked.includes(r.key));
        /* Header follows the step: the bucket name while choosing, the chosen
           deal once inside it. */
        const title = isStd
          ? 'Standard Documents — Overview'
          : (activeShip ? `Case to Case — ${shipLabel(activeShip)}` : 'Case to Case Documents & Agreements — Overview');
        const sub = isStd
          ? 'All Company Due Diligence, Owner KYC & Trade Licenses documents in one list'
          : (activeShip
            ? `Trade Documents & Agreements for ${activeShip.customer}`
            : 'Select a shipment to view its Trade Documents & Agreements');
        // No pagination — the full list scrolls inside the fixed-height body
        // after ~5 rows (see .cev-ov-body max-height + sticky header).
        return (
          <div className="cev-ov-overlay sev-ov cnev-ov" role="dialog" aria-modal="true" onMouseDown={(e) => { if (e.target === e.currentTarget) { setOverview(null); setOvPicked([]); } }}>
            <div className="cev-ov-card">
              <div className="cev-ov-head">
                <span className="cev-ov-head-icon"><i className="ri-list-check-2" aria-hidden /></span>
                <div className="cev-ov-head-text">
                  <div className="cev-ov-title">{title}</div>
                  <div className="cev-ov-sub">{sub}</div>
                </div>
                {activeShip && (
                  <button type="button" className="sev-ov-back" onClick={() => { setOvShip(null); setOverviewPage(1); setOvPicked([]); }}>
                    <i className="ri-arrow-left-s-line" aria-hidden /> Back to shipments
                  </button>
                )}
                <button type="button" className="cev-ov-close" onClick={() => { setOverview(null); setOvPicked([]); }} aria-label="Close"><i className="ri-close-line" /></button>
              </div>
              {picking ? (
                /* Step 1 — the shipment / procurement chooser. Replaces the old
                   horizontal tab strip, which hid the deal's parties behind a
                   code and could not show more than a few before scrolling. */
                <div className="cev-ov-body">
                  <div className="sev-ov-pick-cap">Select a Shipment / Procurement to view its Trade Documents &amp; Agreements</div>
                  {shipsWithDocs.length === 0 ? (
                    <div className="sev-ov-pick-empty">No transactions with documents for this consignee yet.</div>
                  ) : (
                    <ul className="sev-ov-picks">
                      {shipsWithDocs.map((r) => (
                        <li key={r.id}>
                          <button type="button" className="sev-ov-pick" onClick={() => { setOvShip(r.id); setOverviewPage(1); setOvPicked([]); }}>
                            <span className="sev-ov-pick-code">{shipLabel(r)}</span>
                            <span className="sev-ov-pick-text">
                              <span className="sev-ov-pick-title">{r.customer}</span>
                              <span className="sev-ov-pick-sub">{r.consignee || '—'} · {r.opportunity_id}</span>
                            </span>
                            <span className="sev-ov-pick-go" aria-hidden><i className="ri-arrow-right-s-line" /></span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : (
              <div className="cev-ov-body">
                <table className="cev-ov-table">
                  <thead>
                    <tr>
                      {/* Tick column only on Case-to-Case — see `sendable`. */}
                      {!isStd && (
                        <th style={{ width: 40 }}>
                          <input
                            type="checkbox"
                            aria-label="Select all sendable documents"
                            disabled={sendable.length === 0}
                            checked={allTicked}
                            onChange={(e) => setOvPicked(e.target.checked ? sendable.map((r) => r.key) : [])}
                          />
                        </th>
                      )}
                      <th style={{ width: 64 }}>SR NO</th>
                      <th>DOCUMENT NAME</th>
                      <th style={{ width: 130 }}>STATUS</th>
                      <th style={{ width: isStd ? 130 : 230 }}>ACTION</th>
                    </tr>
                  </thead>
                  <tbody>
                    {docs.length === 0 ? (
                      <tr><td colSpan={isStd ? 4 : 5} className="cev-ov-empty">{isStd ? 'No documents available.' : (shipsWithDocs.length === 0 ? 'No shipment documents available.' : 'No documents for this shipment.')}</td></tr>
                    ) : docs.map((d, i) => {
                      const absIdx = i;
                      const raw = isStd ? (d as VaultDoc).attachment_url : (d as VaultShipmentDoc).signed_url;
                      const url = raw ? resolveFileUrl(raw) : null;
                      const fname = isStd ? ((d as VaultDoc).attachment || `${d.name}.pdf`) : `${d.name}.pdf`;
                      return (
                        <tr key={`${activeShip?.id ?? 'std'}-${absIdx}`}>
                          {!isStd && (() => {
                            const rowKey = ovDocKey(d as VaultShipmentDoc);
                            const canTick = sendableDoc(d as VaultShipmentDoc);
                            return (
                              <td>
                                <Tooltip label={canTick ? 'Select for signature' : sendReason(d as VaultShipmentDoc)}>
                                  <input
                                    type="checkbox"
                                    aria-label={`Select ${d.name}`}
                                    disabled={!canTick}
                                    checked={ovPicked.includes(rowKey)}
                                    onChange={(e) => setOvPicked((prev) => e.target.checked ? [...prev, rowKey] : prev.filter((k) => k !== rowKey))}
                                  />
                                </Tooltip>
                              </td>
                            );
                          })()}
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
                            <div className="sev-ov-acts">
                            {/* Resend / Track — case-to-case only. Standard rows
                                are uploads, so neither applies to them. */}
                            {!isStd && (() => {
                              const sd = d as VaultShipmentDoc;
                              const canSend  = sendableDoc(sd);
                              const canTrack = !!sd.signature_request_id;
                              return (
                                <>
                                  <Tooltip label={sendReason(sd)}>
                                    <button
                                      type="button"
                                      className="sev-ov-act sev-ov-act-send"
                                      disabled={!canSend}
                                      onClick={() => { if (sd.db_id) setSendDocIds([sd.db_id]); }}
                                    >
                                      <i className="ri-send-plane-line" aria-hidden /> Resend
                                    </button>
                                  </Tooltip>
                                  <Tooltip label={canTrack ? 'Signing activity tracker' : 'Nothing has been sent for signature yet'}>
                                    <button
                                      type="button"
                                      className="sev-ov-act sev-ov-act-track"
                                      disabled={!canTrack}
                                      onClick={() => setOvTrack({ id: sd.signature_request_id as number, code: sd.name || shipLabel(activeShip!) })}
                                    >
                                      <i className="ri-time-line" aria-hidden /> Track
                                    </button>
                                  </Tooltip>
                                </>
                              );
                            })()}
                            {(() => {
                              const dlKey = `${activeShip?.id ?? 'std'}-${absIdx}`;
                              const dling = ovDownloadingKey === dlKey;
                              return (
                                <Tooltip label={!url ? 'No signed file yet' : (dling ? 'Downloading…' : `Download ${d.name}`)}>
                                <button
                                  type="button"
                                  /* Icon-only on Case-to-Case. Resend and Track
                                     already carry labels there, and a third
                                     labelled pill pushed the table wider than
                                     the dialog — which put the tick column off
                                     the left edge behind a horizontal scrollbar
                                     and left a white strip past the header. */
                                  className={isStd ? 'cev-ov-dl' : 'sev-ov-act'}
                                  aria-label="Download"
                                  disabled={!url || dling}
                                  onClick={async () => {
                                    if (!url) return;
                                    setOvDownloadingKey(dlKey);
                                    try {
                                      /* Signed documents go through the signature
                                         endpoint that already exists for them.
                                         signed_url points into
                                         uploads/signed_documents/, a tree
                                         downloadFile has no API route for, so it
                                         fell through to a direct fetch that Azure
                                         blocks cross-origin and ended on the
                                         window.open fallback — the file opened
                                         instead of saving. Same fix as the
                                         customer vault; keep the two in step. */
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
                                    ? <><i className="ri-loader-4-line cev-spin" aria-hidden />{isStd ? ' Downloading…' : ''}</>
                                    : <><i className="ri-download-2-line" aria-hidden />{isStd ? ' Download' : ''}</>}
                                </button>
                                </Tooltip>
                              );
                            })()}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              )}
              {/* Selection action bar.
                *
                * The bulk send used to sit in the panel header, next to Back
                * and Close — beside the two controls that LEAVE the panel, and
                * far from the ticks that arm it. It belongs under the list it
                * acts on, appearing only once something is selected, so the
                * count and the action read as one sentence.
                *
                * The button stays visible but disabled when the selection
                * cannot be sent, with the reason on its tooltip; hiding it
                * would leave the user with a tick they cannot explain. */}
              {!picking && picked.length > 0 && (
                <div className="cnev-ovbar">
                  <span className="cnev-ovbar-count">
                    {picked.length} document{picked.length > 1 ? 's' : ''} selected
                  </span>
                  <Tooltip label={canBulk
                    ? `Send ${picked.length} document${picked.length > 1 ? 's' : ''} for signature`
                    : 'One of the ticked rows can no longer be sent'}>
                    <button
                      type="button"
                      className="cnev-ovbar-send"
                      disabled={!canBulk}
                      onClick={() => { if (canBulk) setSendDocIds(pickedIds); }}
                    >
                      <i className="ri-send-plane-line" aria-hidden /> Send for Signature
                    </button>
                  </Tooltip>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* Signing tracker for an overview row. Sits outside the overview block
          so it survives that panel's re-render when a row is ticked. */}
      {ovTrack && (
        <SigningTrackerModal
          sigId={ovTrack.id}
          code={ovTrack.code}
          onClose={() => setOvTrack(null)}
        />
      )}

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

/* ── Expiry / status helpers ────────────────────────────────────────────────
 * Ported from the Supplier vault so the Expiry and Status columns read the
 * same way in both. Kept local rather than imported: SupplierEvidenceVaultModal
 * is a large P2P module and pulling it in for four small functions would drag
 * it into this lazy chunk.
 *
 * Expiry arrives as free text — the API hands back whatever the upload or the
 * segment-rule master carried ('01-Jan-2028', '2028-01-01', 'Lifetime', '—'),
 * so it is parsed leniently and left as-is when it is clearly not a date. */
const EV_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function evParseExpiry(s?: string | null): Date | null {
  if (!s) return null;
  const t = s.trim();
  if (/^(n\/a|—|-|lifetime|varies|)$/i.test(t)) return null;
  let m: RegExpMatchArray | null;
  if ((m = t.match(/^(\d{4})-(\d{2})-(\d{2})/)))          return new Date(+m[1], +m[2] - 1, +m[3]);
  if ((m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)))   return new Date(+m[3], +m[2] - 1, +m[1]);
  if ((m = t.match(/^(\d{1,2})\/(\d{4})$/)))              return new Date(+m[2], +m[1] - 1, 1);
  const d = new Date(t);
  return isNaN(d.getTime()) ? null : d;
}
function evFmtExpiry(s?: string | null): string {
  const d = evParseExpiry(s);
  if (!d) return s && s.trim() && s.trim() !== '-' ? s.trim() : '—';
  return `${String(d.getDate()).padStart(2, '0')}-${EV_MONTHS[d.getMonth()]}-${d.getFullYear()}`;
}
/* A document the API calls "Verified" is still expired if its date has passed —
   the API does not re-check that on read, so the table does it here. */
function evEffectiveStatus(d: VaultDoc): VaultStatus | 'Expired' {
  const exp = evParseExpiry(d.expiry);
  if (exp) { const today = new Date(); today.setHours(0, 0, 0, 0); if (exp < today) return 'Expired'; }
  return d.status;
}
/* Status pill for the Expiry/Status columns.
 *
 * Rendered as `.cev-pill[data-status]`, the vault's own pill, rather than a
 * private span with its own colours. That class is shape-only — the light
 * colours still come from the inline style below — but the stylesheet carries
 * `[data-bs-theme="dark"] .cev-pill[data-status="…"]` rules marked !important,
 * which is the one thing that can override an inline declaration. Built as a
 * standalone span it stayed hard-coded light green / light red on a dark page. */
function VaultStatusPill({ status }: { status: VaultStatus | 'Expired' }) {
  const map: Record<VaultStatus | 'Expired', { bg: string; color: string; bd: string }> = {
    Verified: { bg: '#dcfce7', color: '#15803d', bd: '#bbf7d0' },
    Expiring: { bg: '#fef3c7', color: '#b45309', bd: '#fde68a' },
    Pending:  { bg: '#fee2e2', color: '#dc2626', bd: '#fecaca' },
    Signed:   { bg: '#dcfce7', color: '#15803d', bd: '#bbf7d0' },
    Expired:  { bg: '#fee2e2', color: '#b91c1c', bd: '#fca5a5' },
  };
  const s = map[status] ?? map.Pending;
  return (
    <span className="cev-pill" data-status={status} style={{ background: s.bg, color: s.color, border: `1px solid ${s.bd}`, whiteSpace: 'nowrap' }}>
      {status}
    </span>
  );
}

function DocsTable({ rows, tab, ownerType, ownerId, onReload, onSendTradeDoc, onRemindTradeDoc, onRowBusyChange }: {
  rows: VaultDoc[];
  tab: TabKey;
  onRowBusyChange?: (busy: boolean) => void;
  ownerType: 'customer' | 'consignee' | 'supplier';
  ownerId: number | null;
  onReload: () => Promise<void> | void;
  onSendTradeDoc?: (doc: VaultDoc) => void;
  onRemindTradeDoc?: (doc: VaultDoc) => void | Promise<void>;
}) {
  const numberHeader = tab === 'company-dd' ? 'License / Number' : tab === 'owner-kyc' ? 'Document Number' : tab === 'trade-licenses' ? 'License Number' : 'Reference No';
  const authorityLbl = tab === 'trade-documents' ? 'Counter Party' : 'Issuing Authority';
  const category: 'kyc' | 'dd' | 'tl' | 'td' = tab === 'company-dd' ? 'dd' : tab === 'owner-kyc' ? 'kyc' : tab === 'trade-licenses' ? 'tl' : 'td';
  /* Which attachment chip is mid-download. The chip saves the file rather than
     opening it, and a save gives no visible response of its own — without a
     spinner a large file reads as a dead click and gets clicked again. */
  const [chipBusy, setChipBusy] = useState<string | null>(null);
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
            <th>Requirement</th>
            {/* Issue Date is only ever filled for SIGNED documents — the API
                sets it to the signing date on the case-to-case buckets and
                leaves it null on standard DD / KYC / Licence rows, which have
                no issue date stored anywhere. It therefore reads "—" on the
                standard tabs by design, not by fault. */}
            <th>Issue Date</th>
            <th>Expiry</th>
            <th>Attachment</th>
            <th>Status</th>
            <th style={{ width: 190 }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={10} className="cev-empty">No documents in this bucket yet.</td></tr>
          ) : rows.map((d, i) => (
            <tr key={d.id}>
              <td>{i + 1}</td>
              {/* Single-line with a CSS ellipsis. A long name used to wrap over
                  several lines and blow the row height out; the previous
                  slice(0, 25) cut mid-word at a fixed character count regardless
                  of the column's actual width. Full text stays on hover. */}
              <Tooltip label={d.name}>
                <td className="cev-doc-name"><span className="cev-trunc">{d.name}</span></td>
              </Tooltip>
              <td className="cev-mono cev-mono-ref">{d.reference || '—'}</td>
              <td className="cev-cell-dim">{d.authority && d.authority !== '—' ? <Tooltip label={d.authority}><span>{d.authority.length > 25 ? d.authority.slice(0, 25) + '…' : d.authority}</span></Tooltip> : '—'}</td>
              <td>
                {/* The inline styles carry the light-mode pill and are left
                    exactly as they were; the classes are what the shared sheet
                    needs to recolour them under [data-bs-theme="dark"]. Without
                    them these two pills stayed hard-coded light green / light
                    grey in dark mode while the customer vault's adapted. */}
                {d.requirement === 'M' ? (
                  <span className="cev-req cev-req-m" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px', borderRadius: 6, fontSize: 11, fontWeight: 800, background: '#dcfce7', color: '#15803d', border: '1px solid #bbf7d0', whiteSpace: 'nowrap' }}>★ Mandatory</span>
                ) : (
                  <span className="cev-req cev-req-o" style={{ display: 'inline-flex', alignItems: 'center', padding: '3px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700, background: '#f1f5f9', color: '#64748b', border: '1px solid #e2e8f0', whiteSpace: 'nowrap' }}>Optional</span>
                )}
              </td>
              <td className="cev-cell-dim">{d.issue_date || '—'}</td>
              {/* Plain text, not the .cev-date teal pill — the reference design
                  shows both date columns as quiet grey so the eye lands on the
                  Status pill instead. */}
              <td className="cev-cell-dim">{evFmtExpiry(d.expiry)}</td>
              <td>
                {d.attachment ? (
                  d.attachment_url ? (
                    /* Saves the file instead of opening it in the browser's
                       viewer — same change as the customer vault's chip, kept
                       in step so the Attachment column behaves identically in
                       both. The icon and tooltip now say "download" too: the
                       old file icon + "Open" described a link that a user in
                       an Attachment column reads as "get me this file".
                       The eye action in this row still opens the document. */
                    (() => {
                      const key = String(d.db_id ?? d.doc_code ?? d.name ?? '');
                      const busy = chipBusy === key;
                      return (
                        <Tooltip label={busy ? 'Downloading…' : `Download ${d.attachment}`}>
                          <a
                            href={d.attachment_url}
                            rel="noreferrer"
                            className="cev-attach"
                            style={{ textDecoration: 'none' }}
                            aria-busy={busy}
                            onClick={async (e) => {
                              e.preventDefault();
                              if (busy) return;
                              setChipBusy(key);
                              try { await downloadFile(d.attachment_url, d.attachment); }
                              finally { setChipBusy(null); }
                            }}
                          >
                            {busy
                              ? <i className="ri-loader-4-line cev-spin" style={{ fontSize: 11 }} aria-hidden />
                              : <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>}
                            {/* Uploaded file names can be very long (browser
                                screen-capture names, exported ticket names…). The
                                chip caps its width and ellipsises the text so the
                                row stays one line; hover shows the full name. */}
                            <span className="cev-attach-name cev-trunc">{d.attachment}</span>
                          </a>
                        </Tooltip>
                      );
                    })()
                  ) : (
                  /* No URL to fetch — the name is shown but not actionable, so
                     it gets the muted chip the customer vault uses for the
                     same case rather than looking like a live download. */
                  <Tooltip label={d.attachment}>
                    <span className="cev-attach cev-attach-muted">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                      <span className="cev-attach-name cev-trunc">{d.attachment}</span>
                    </span>
                  </Tooltip>
                  )
                ) : <span className="cev-muted">Not uploaded</span>}
              </td>
              <td><VaultStatusPill status={evEffectiveStatus(d)} /></td>
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

function VaultRowActions({ doc, ownerType, ownerId, category, onReload, onSendTradeDoc, onRemindTradeDoc, onBusyChange }: {
  doc: VaultDoc;
  onBusyChange?: (busy: boolean) => void;
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
    try { await downloadFile(doc.attachment_url, doc.attachment); }
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
          className={`cev-row-act cev-row-act-view sev-row-act-txt ${!canViewOrDownload ? 'is-disabled' : ''}`}
          onClick={e => { if (!canViewOrDownload) { e.preventDefault(); return; } setViewing(true); window.setTimeout(() => setViewing(false), 1200); }}
          aria-label="View"
        >
          {viewing
            ? <i className="ri-loader-4-line cev-spin" style={{ fontSize: 14 }} aria-hidden />
            : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>}
          <span>View</span>
        </a>
      </Tooltip>
      <Tooltip label={canViewOrDownload ? (downloading ? 'Downloading…' : `Download ${doc.attachment}`) : 'No attachment yet'}>
        <button
          type="button"
          aria-disabled={!canViewOrDownload || downloading}
          onClick={() => { if (canViewOrDownload) void download(); }}
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
          aria-disabled={!canReupload || busy}
          onClick={() => { if (canReupload && !busy) fileRef.current?.click(); }}
          className={`cev-row-act cev-row-act-upload sev-row-act-txt ${(!canReupload || busy) ? 'is-disabled' : ''}`}
          aria-label={doc.attachment ? 'Re-upload' : 'Upload'}
        >
          {busy
            ? <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
            : doc.attachment
              ? <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
              : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>}
          <span>{doc.attachment ? 'Re-upload' : 'Upload'}</span>
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

function ShipmentTable({ rows, kind, onSend, onBulkSend, activeSend }: {
  rows: VaultShipmentRow[];
  kind: 'trade' | 'agreement';
  /** Sends every ticked document on one deal in a single action. Passing it is
   *  what turns the panel's tick column on — the panel owns the selection. */
  onBulkSend?: (leadId: number, docs: VaultShipmentDoc[], party: 'buyer' | 'consignee') => void;
  /** Launches Send-for-Signature for one shipment doc (lead + doc + party). */
  onSend?: (leadId: number, doc: VaultShipmentDoc, party: 'buyer' | 'consignee') => void;
  /** The send currently being prepared, so its row's button can spin. This was
   *  never wired here (the customer vault has always passed it), so clicking
   *  Send in the consignee vault left the button looking untouched. */
  activeSend?: { leadId: number; doc: VaultShipmentDoc; party: 'buyer' | 'consignee' } | null;
}) {
  const [openId, setOpenId] = useState<number | null>(null);
  /* Consignee vault shows ALL shipments — no Buyer = / ≠ Consignee split at the
     TABLE level (that's a customer-vault concept). The document panel inside
     each row does split by party, exactly like the customer vault, so a doc
     that both sides sign is visible from here too. */
  const filtered = rows;
  const isAgreement = kind === 'agreement';
  const COLS = isAgreement ? 11 : 10;
  return (
    <>
      {/* No Customer = / ≠ Consignee tabs in the consignee vault — it always
          shows this consignee's shipments. */}
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
              <tr><td colSpan={COLS} className="cev-empty">No deals for this consignee.</td></tr>
            ) : filtered.map((r, i) => {
              const open = openId === r.id;
              return (
                <Fragment key={r.id}>
                  <tr style={{ cursor: 'pointer' }} onClick={() => setOpenId(open ? null : r.id)}>
                    <td style={{ textAlign: 'center' }}><span style={{ display: 'inline-block', transition: 'transform .18s', transform: open ? 'rotate(90deg)' : 'none', color: '#0891b2', fontWeight: 800 }}>▸</span></td>
                    <td>{i + 1}</td>
                    <td>{r.has_shipment === false
                      ? <span className="cev-chip-pill" style={{ opacity: .55 }} title="No shipment order raised for this deal yet">● Not shipped</span>
                      : <span className="cev-chip-pill">● {r.shipment_id}</span>}</td>
                    <td><span className="cev-chip-pill cev-chip-pill-warm">● {r.opportunity_id}</span></td>
                    <td>
                      <span className="cev-cust-cell">
                        <span className="cev-cust-mono">{r.customer.charAt(0)}</span>
                        {r.customer}
                      </span>
                    </td>
                    <td>
                      <span className="cev-cust-cell">
                        <span className="cev-cust-mono" style={{ background: 'linear-gradient(135deg,#0891b2,#06b6d4)' }}>{(r.consignee || '—').charAt(0)}</span>
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
                          buyerIsConsignee={r.buyer_is_consignee}
                          onSend={onSend ? (doc, party) => onSend(r.id, doc, party) : undefined}
                          pendingSend={activeSend && activeSend.leadId === r.id ? { doc: activeSend.doc, party: activeSend.party } : null}
                          primaryParty="consignee"
                          /* Consignee vault → Consignee Documents + Both only.
                             Buyer-exclusive paperwork belongs to the other
                             party; the shared documents this consignee actually
                             co-signs are still one tab away under Both. */
                          hideBuyerTab
                          onBulkSend={onBulkSend ? (docs, party) => onBulkSend(r.id, docs, party) : undefined}
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

const CNEV_CSS = `
/* Consignee Evidence Vault — residual styles.
 *
 * The vault shell now renders with the shared design in
 * supplier-evidence-vault.css (imported at the top of this file), the same
 * sheet the Customer and Supplier vaults use, so the ~700 lines of emerald
 * \`.cnev-*\` rules that used to live here are gone. What remains is the one
 * helper that sheet has no equivalent for. */
.cev-trunc {
  display: block; min-width: 0; max-width: 100%;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

/* Reference design tints the licence / document number and quietens the
   columns either side of it, so the row reads: bold name, teal number,
   everything supporting in grey, then the Status pill. The shared sheet
   renders .cev-mono in near-black, which flattens all of that out. */
/* The sticky overview header paints its background on the TH cells, so if the
   table is ever wider than the dialog the strip past the last column showed
   through white. Painting the row itself keeps the bar solid at any scroll
   position — same ink as the cells, so nothing changes when it fits. */
.cev-ov-table thead tr { background: #083344; }

/* Overview table sizing. Scoped to .cnev-ov — this consignee panel — so the
   customer and supplier overviews, which share .sev-ov, are untouched.
 *
   Auto layout let the ACTION cell win: Resend / Track / Download are all
   nowrap, so the column grew past its declared width, pushed the table wider
   than the dialog and produced a horizontal scrollbar — which slid the tick
   column off the left edge and clipped the download icon on the right. Fixed
   layout makes the declared widths authoritative; Document Name takes what is
   left and ellipsises, which is the one column that can afford to. */
.cnev-ov .cev-ov-table { table-layout: fixed; }
.cnev-ov .cev-ov-name {
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

.cev-mono-ref { color: #0e7490; font-weight: 600; }
.cev-cell-dim { color: #64748b; white-space: nowrap; }
[data-bs-theme="dark"] .cev-mono-ref { color: #67e8f9; }
[data-bs-theme="dark"] .cev-cell-dim { color: #94a3b8; }

/* Selection action bar under the overview list. Sits outside the scrolling
   body so it stays put while the rows scroll under it. */
.cnev-ov .cnev-ovbar {
  flex-shrink: 0;
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 12px 18px;
  background: #ecfbfe;
  border-top: 1px solid #cdeff7;
}
.cnev-ov .cnev-ovbar-count {
  font-size: 12px; font-weight: 700; color: #0e7490;
}
.cnev-ov .cnev-ovbar-send {
  display: inline-flex; align-items: center; gap: 6px;
  height: 34px; padding: 0 16px;
  border: 0; border-radius: 8px;
  background: linear-gradient(135deg, #0891b2, #22d3ee);
  color: #fff; font-family: inherit; font-size: 12px; font-weight: 700;
  cursor: pointer;
  box-shadow: 0 3px 10px rgba(8, 145, 178, .32);
  transition: filter .18s ease;
}
.cnev-ov .cnev-ovbar-send:hover:not(:disabled) { filter: brightness(1.08); }
.cnev-ov .cnev-ovbar-send:disabled { opacity: .5; cursor: not-allowed; box-shadow: none; }
.cnev-ov .cnev-ovbar-send i { font-size: 14px; line-height: 1; }

[data-bs-theme="dark"] .cnev-ov .cnev-ovbar {
  background: #08222b; border-top-color: rgba(8, 145, 178, .28);
}
[data-bs-theme="dark"] .cnev-ov .cnev-ovbar-count { color: #67e8f9; }

/* ── Active tab, to the reference design ───────────────────────────────────
 * Scoped to .cnev-vault so the customer and supplier vaults keep what they
 * have. Everything else in the tab strip already matched: grey inactive
 * label, tinted icon tile, outlined count that fills solid cyan when active.
 * Two things did not.
 *
 * The label. Selected read as teal (#0e7490) — the same family as the
 * underline and the count, so the whole tab became one cyan smear and the
 * word itself stopped being the thing that stood out. The reference keeps the
 * label near-black and lets the cyan furniture around it signal the state.
 *
 * The bar. Thin, inset 10px each side and carrying a glow, so it read as a
 * soft highlight under the middle of the tab rather than the solid rule the
 * reference draws across it. */
.cnev-vault .cev-tab.is-active { color: #155e75; }
.cnev-vault .cev-tab.is-active::after {
  left: 4px; right: 4px;
  height: 3px;
  box-shadow: none;
}
[data-bs-theme="dark"] .cnev-vault .cev-tab.is-active { color: #e6f7fb; }

/* Count badge is a CIRCLE, not a lozenge.
 *
 * The shared rule is min-width 18 / height 18 with 5px of side padding, and a
 * narrower breakpoint swaps in 1px 6px of padding — so as soon as the padding
 * outgrew the 18px floor the badge stretched sideways and sat as a flattened
 * oval next to a round one. Equal width and height with no side padding keeps
 * every single- and double-digit count perfectly round; three digits widen it
 * into a capsule, which is the right way for it to give up. */
.cnev-vault .cev-tab-count {
  min-width: 20px;
  height: 20px;
  padding: 0 4px;
  font-size: 10px;
  border-radius: 999px;
}

/* No size changes here on purpose. Enlarging the icon tile and the label was
   guesswork off two screenshots taken at different zooms, and it made the tab
   taller than the strip that holds it — the strip's own bottom border then
   showed as a second line under the active one. The tab keeps the shared
   sizing; only the badge shape and the active colour differ. */

/* ── Dark mode ─────────────────────────────────────────────────────────────
 * Everything below is scoped to .cnev-vault / .cnev-ov — this vault's own
 * roots — so it cannot reach the Customer or Supplier vaults, which share the
 * same stylesheet and are not being worked on.
 *
 * Each rule outranks the light one it corrects on SPECIFICITY, not source
 * order. The shared sheet declares its dark values before its .sev overrides,
 * so an equally-specific rule there loses to whatever comes later — which is
 * exactly how the body ended up white in dark mode. */

/* Body sheet. The shared sheet's own dark rule for .cev-body is (0,2) and is
   followed by a .sev .cev-body rule painting it #ffffff, also (0,2), which
   therefore wins. Most of the sheet hides behind .cev-table-wrap; the strip
   that showed was under .cev-section, whose dark background is a translucent
   teal and so composited over white into a near-flat band — taking the pale
   cyan section title with it. */
[data-bs-theme="dark"] .cnev-vault .cev-body { background: #08222b; }

/* Shipment chooser — step one of the Case-to-Case overview. The per-deal
   table it leads into has dark rules in the shared sheet; this step never
   did, so it opened as a white panel under a dark header. */
[data-bs-theme="dark"] .cnev-ov .sev-ov-pick-cap {
  background: #08222b; color: #cffafe; border-bottom-color: rgba(8,145,178,.28);
}
[data-bs-theme="dark"] .cnev-ov .sev-ov-pick-empty { color: #8fb2c2; }
[data-bs-theme="dark"] .cnev-ov .sev-ov-pick {
  background: #0a2630; border-bottom-color: rgba(8,145,178,.18);
}
[data-bs-theme="dark"] .cnev-ov .sev-ov-picks li:nth-child(even) .sev-ov-pick { background: #0c2c37; }
[data-bs-theme="dark"] .cnev-ov .sev-ov-pick:hover { background: rgba(8,145,178,.20); }
[data-bs-theme="dark"] .cnev-ov .sev-ov-pick-code {
  background: rgba(8,145,178,.22); border-color: rgba(34,211,238,.34); color: #67e8f9;
}
[data-bs-theme="dark"] .cnev-ov .sev-ov-pick-title { color: #e6f7fb; }
[data-bs-theme="dark"] .cnev-ov .sev-ov-pick-sub   { color: #8fb2c2; }
[data-bs-theme="dark"] .cnev-ov .sev-ov-pick-go    { color: #5b7d90; }
[data-bs-theme="dark"] .cnev-ov .sev-ov-pick:hover .sev-ov-pick-go { color: #22d3ee; }

/* Row actions in the overview. Legible as light gradients on a dark row, but
   they read as two bright chips stamped onto it; a translucent tint of the
   same hue is what the main table's row actions use. */
[data-bs-theme="dark"] .cnev-ov .sev-ov-act-send {
  background: rgba(8,145,178,.20); border-color: rgba(34,211,238,.34); color: #67e8f9;
}
[data-bs-theme="dark"] .cnev-ov .sev-ov-act-send:hover:not(:disabled) { background: rgba(8,145,178,.32); }
[data-bs-theme="dark"] .cnev-ov .sev-ov-act-track {
  background: rgba(124,58,237,.22); border-color: rgba(167,139,250,.38); color: #c4b5fd;
}
[data-bs-theme="dark"] .cnev-ov .sev-ov-act-track:hover:not(:disabled) { background: rgba(124,58,237,.34); }

/* Status badges are rounded RECTANGLES, not lozenges. The shared .cev-pill is
   999px, which turns a short word like "Draft" into a capsule and makes the
   column read as a row of tablets rather than badges. 6px matches the
   Requirement badge beside it and the reference design. Scoped, so the
   customer and supplier vaults keep their capsules. */
.cnev-vault .cev-pill,
.cnev-ov .cev-pill { border-radius: 6px; }

/* Status pills carry an inline border so each one is outlined in its own hue.
   That border is a light-mode colour, and the shared dark rules only repaint
   background and text — so in dark mode it stayed a bright ring around a dim
   pill. One neutral translucent edge reads correctly against every tone. */
[data-bs-theme="dark"] .cnev-vault .cev-pill,
[data-bs-theme="dark"] .cnev-ov .cev-pill {
  border-color: rgba(255, 255, 255, .16) !important;
}

/* Signed is green here, so its dark counterpart has to be green too. The
   shared sheet turns Signed blue in dark mode and marks it !important, which
   an inline style cannot beat — only a more specific rule can, hence the
   .cnev-ov scope and the matching !important. */
[data-bs-theme="dark"] .cnev-ov .cev-pill[data-status="Signed"] {
  background: rgba(16, 185, 129, .18) !important;
  color: #6ee7b7 !important;
}
`;
