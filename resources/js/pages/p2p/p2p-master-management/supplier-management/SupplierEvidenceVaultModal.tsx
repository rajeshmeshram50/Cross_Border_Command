import { Fragment, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

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

import { SegmentRefUploadPopup } from './AddVendorModal';
import { SigningTrackerModal } from '../../../sales/opportunity-pipeline/SigningTrackerModal';
import './supplier-evidence-vault.css';

async function fetchVaultBlob(rawUrl: string): Promise<Blob | null> {
  if (!rawUrl) return null;
  if (/segment_doc_uploads\//i.test(rawUrl)) {
    try {
      const res = await api.get('/segment-uploads/download', { params: { url: rawUrl }, responseType: 'blob' });
      return res.data as Blob;
    } catch {}
  }
  try {
    const res = await fetch(resolveFileUrl(rawUrl), { credentials: 'include' });
    if (res.ok) return await res.blob();
  } catch {}
  return null;
}

export type VaultStatus = 'Verified' | 'Pending' | 'Expiring' | 'Signed';

export interface VaultDoc {
  id: number;

  db_id?: number | null;

  party?: string | null;

  signature_request_id?: number | null;
  sig_state?: string | null;
  name: string;
  reference?: string | null;
  authority?: string | null;
  issue_date?: string | null;
  expiry?: string | null;
  attachment?: string | null;

  attachment_url?: string | null;
  status: VaultStatus;

  doc_code?: string | null;

  requirement?: 'M' | 'O' | null;

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

  docs?: VaultDoc[];

  agreements?: VaultDoc[];
}

export interface SupplierVaultTarget {
  id: string;
  db_id?: number;
  company: string;
  risk?: string;
  segment?: string;

  segments?: string[];
  country?: string;

  type?: string;
  contact?: string;
  contactCity?: string;

  email?: string;

  customerId?: string;
}

interface Props {
  open: boolean;
  supplier: SupplierVaultTarget | null;
  onClose: () => void;
  data?: VaultData | null;

  viewOnly?: boolean;

  onVaultChange?: () => void;
}

const VaultViewOnlyCtx = createContext(false);

type TabKey = 'company-dd' | 'owner-kyc' | 'trade-licenses' | 'trade-documents' | 'shipment-agreements';

type GroupKey = 'standard' | 'case-to-case';

const VAULT_GLYPHS: Record<string, ReactNode> = {
  shieldCheck:    <><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><polyline points="9 12 11 14 15 10" /></>,
  clipboardCheck: <><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" /><rect x="8" y="2" width="8" height="4" rx="1" /><path d="M9 14l2 2 4-4" /></>,
  list:           <><line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" /></>,
  home:           <><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" /></>,
  user:           <><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /></>,
  monitor:        <><rect x="2" y="3" width="20" height="14" rx="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" /></>,
  file:           <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></>,
  fileLines:      <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="8" y1="13" x2="16" y2="13" /><line x1="8" y1="17" x2="13" y2="17" /></>,
  checkCircle:    <><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></>,
  warning:        <><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></>,
  box:            <><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /><polyline points="3.27 6.96 12 12.01 20.73 6.96" /><line x1="12" y1="22.08" x2="12" y2="12" /></>,
  truck:          <><rect x="1" y="3" width="15" height="13" rx="1.5" /><polygon points="16 8 20 8 23 11 23 16 16 16 16 8" /><circle cx="5.5" cy="18.5" r="2.5" /><circle cx="18.5" cy="18.5" r="2.5" /></>,
  clock:          <><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></>,
  send:           <><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></>,
};

function Glyph({ d, size, sw = 2.2 }: { d: ReactNode; size: number; sw?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {d}
    </svg>
  );
}

const GROUPS: { key: GroupKey; title: string; sub: string; icon: ReactNode; overview: string }[] = [
  { key: 'standard',     title: 'Standard Documents',                  sub: 'ONE TIME · KYC, DD & LICENSES',      icon: VAULT_GLYPHS.shieldCheck, overview: 'All Standard Document Overview' },
  { key: 'case-to-case', title: 'Case to Case Documents & Agreements', sub: 'PER DEAL · TRADE DOCS & AGREEMENTS', icon: VAULT_GLYPHS.clipboardCheck, overview: 'Send Documents & Agreements for Signature' },
];

const TABS: { key: TabKey; label: string; icon: ReactNode; countKey: keyof VaultData; group: GroupKey }[] = [
  { key: 'company-dd',          label: 'Company Due Diligence', icon: VAULT_GLYPHS.home,      countKey: 'company_dd_count',       group: 'standard' },
  { key: 'owner-kyc',           label: 'Owner KYC Details',     icon: VAULT_GLYPHS.user,      countKey: 'owner_kyc_count',        group: 'standard' },
  { key: 'trade-licenses',      label: 'Trade Licenses',        icon: VAULT_GLYPHS.monitor,   countKey: 'trade_license_count',    group: 'standard' },
  { key: 'trade-documents',     label: 'Trade Documents',       icon: VAULT_GLYPHS.file,      countKey: 'trade_documents_count',  group: 'case-to-case' },
  { key: 'shipment-agreements', label: 'Agreements',            icon: VAULT_GLYPHS.fileLines, countKey: 'total_shipments',        group: 'case-to-case' },
];

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

  const [segPop, setSegPop] = useState<{ names: string[]; x: number; y: number } | null>(null);

  const [overview, setOverview] = useState<GroupKey | null>(null);
  const [overviewPage, setOverviewPage] = useState(1);

  const [ovDownloadingKey, setOvDownloadingKey] = useState<string | null>(null);
  const [ovUpload, setOvUpload] = useState<{ doc: VaultDoc; category: 'dd' | 'kyc' | 'tl' } | null>(null);

  const [shipmentIdMode, setShipmentIdMode] = useState<'with' | 'without'>('with');

  const selectGroup = (g: GroupKey) => {
    setGroup(g);
    const first = TABS.find(t => t.group === g);
    if (first) setTab(first.key);
  };
  const selectTab = (t: typeof TABS[number]) => {
    setTab(t.key);
  };

  const [vaultLive, setVaultLive] = useState<VaultData | null>(null);
  const [loading, setLoading] = useState(false);

  const [exporting, setExporting] = useState(false);

  const [signatureRows, setSignatureRows] = useState<SigReqRow[]>([]);

  const [sendDocIds, setSendDocIds] = useState<number[] | null>(null);

  const [sendKind, setSendKind] = useState<'trade' | 'agreement'>('trade');

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const b = document.body.style.overflow;
    const h = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    return () => { document.body.style.overflow = b; document.documentElement.style.overflow = h; };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setTab('company-dd');
    setGroup('standard');
    setShipmentIdMode('with');

  }, [open, supplier?.db_id]);

  const onVaultChangeRef = useRef(onVaultChange);
  onVaultChangeRef.current = onVaultChange;

  const reloadVault = useCallback(() => {
    if (!supplier?.db_id) return Promise.resolve();
    setLoading(true);
    return api.get(`/segment-uploads/supplier/${supplier.db_id}/vault`)
      .then(r => {
        setVaultLive((r.data?.data ?? null) as VaultData | null);

        onVaultChangeRef.current?.();
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [supplier?.db_id]);

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

  const reloadSignatures = useCallback(() => {
    if (!supplier?.db_id) return Promise.resolve();
    return api.get('/clm/signature-requests', {
      params: { party_id: supplier.db_id, model_name: 'Vendor', sync: 1 },
    })
      .then(r => { setSignatureRows(Array.isArray(r.data?.data) ? (r.data.data as SigReqRow[]) : []); })
      .catch(() => {});
  }, [supplier?.db_id]);

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

    const base = data ?? vaultLive ?? EMPTY_VAULT;
    if (!base) return null;

    const tradeSigRows       = signatureRequestsToVaultDocs(signatureRows.filter(r => (r.document_type ?? 'trade_doc') !== 'agreement'));
    const agrSigRows         = signatureRequestsToVaultDocs(signatureRows.filter(r => r.document_type === 'agreement'));
    const sigRows            = tradeSigRows;
    const baseSegmentTd      = (base.trade_documents ?? []) as VaultDoc[];
    const mergedTd           = mergeTradeDocuments(baseSegmentTd as any, sigRows, 'supplier') as unknown as VaultDoc[];
    const baseSegmentSigned  = baseSegmentTd.filter(r => r.status === 'Verified' || r.status === 'Signed').length;
    const baseSegmentPending = baseSegmentTd.filter(r => r.status === 'Pending').length;
    const mergedSigned       = mergedTd.filter(r => r.status === 'Verified' || r.status === 'Signed').length;
    const mergedPending      = mergedTd.filter(r => r.status === 'Pending').length;

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

      verified_signed: Math.max(0, (base.verified_signed ?? 0) - baseSegmentSigned) + mergedSigned,
      pending:         Math.max(0, (base.pending ?? 0)         - baseSegmentPending) + mergedPending,
      total_documents: Math.max(0, (base.total_documents ?? 0) - baseSegmentTd.length) + mergedTd.length,
    };
  }, [supplier, data, vaultLive, signatureRows]);

  if (!open || !supplier || !vault) return null;

  const handleExportAll = async () => {
    if (!vault || !supplier || exporting) return;

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

      const [{ default: JSZip }, { saveAs }] = await Promise.all([
        import('jszip'),
        import('file-saver'),
      ]);
      const zip = new JSZip();

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

        if (!docs.some(d => d.attachment_url)) folder.file('(no documents).txt', 'No uploaded documents in this category.');
      };

      const std = zip.folder('Standard')!;
      await addDocs(std.folder('Company Due Diligence')!, vault.company_dd);
      await addDocs(std.folder('Owner KYC Details')!, vault.owner_kyc);
      await addDocs(std.folder('Trade Licenses')!, vault.trade_licenses);

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

  const submitOvUpload = async (f: File, expiryDate?: string) => {
    if (!ovUpload || !supplier?.db_id || !ovUpload.doc.doc_code) return;
    if (!/\.(pdf|jpe?g|png)$/i.test(f.name)) {
      toast.error('Unsupported file type', 'Only PDF, JPG or PNG files are allowed. Word / Excel files are not supported.');
      return;
    }
    try {
      const fd = new FormData();
      fd.append('category', ovUpload.category);
      fd.append('doc_code', ovUpload.doc.doc_code);
      fd.append('doc_name', ovUpload.doc.name || ovUpload.doc.doc_code);
      if (expiryDate) fd.append('expiry_date', expiryDate);
      fd.append('attachment', f);
      await api.post(`/segment-uploads/supplier/${supplier.db_id}`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      await reloadVault();
      toast.success('Document uploaded', `${f.name} has been attached.`);
      setOvUpload(null);
    } catch (e: any) {
      toast.error('Upload failed', e?.response?.data?.message || 'The file could not be uploaded. Please try again.');
    }
  };

  const docsForTab: VaultDoc[] = tab === 'company-dd' ? vault.company_dd
    : tab === 'owner-kyc'      ? vault.owner_kyc
    : tab === 'trade-licenses' ? vault.trade_licenses
    : tab === 'trade-documents' ? vault.trade_documents
    : [];

  const isUploaded = (d: VaultDoc) => !!(d.attachment_url || (d.attachment && d.attachment !== '—'));

  const stdAll: VaultDoc[] = [...vault.company_dd, ...vault.owner_kyc, ...vault.trade_licenses];
  const upOf = (rows: VaultDoc[]) => rows.filter(isUploaded).length;
  const stdTotal = stdAll.length;
  const stdUp    = upOf(stdAll);
  const stdPend  = stdTotal - stdUp;
  const splitOf  = (rows: VaultDoc[]) => ({ up: upOf(rows), pend: rows.length - upOf(rows) });

  const dealRows  = shipmentIdMode === 'with' ? (vault.vendor_with_shipment ?? []) : (vault.vendor_without_shipment ?? []);
  const dealDocs  = dealRows.flatMap(r => r.docs ?? []);
  const dealAgrs  = dealRows.flatMap(r => r.agreements ?? []);
  const caseAll   = [...dealDocs, ...dealAgrs];
  const isSigned  = (d: VaultDoc) => d.status === 'Signed' || (d.sig_state ?? '').toLowerCase() === 'completed';
  const caseSigned  = caseAll.filter(isSigned).length;
  const caseWaiting = caseAll.filter(d => d.signature_request_id && !isSigned(d)).length;
  const caseUnsent  = caseAll.filter(d => !d.signature_request_id).length;

  const statusTally = {
    Verified: docsForTab.filter(d => evEffectiveStatus(d) === 'Verified').length,
    Signed:   docsForTab.filter(d => evEffectiveStatus(d) === 'Signed').length,
    Expiring: docsForTab.filter(d => evEffectiveStatus(d) === 'Expiring').length,
    Expired:  docsForTab.filter(d => evEffectiveStatus(d) === 'Expired').length,
    Pending:  docsForTab.filter(d => evEffectiveStatus(d) === 'Pending').length,
  };

  const tabMeta = TABS.find(t => t.key === tab)!;

  const tabCount = (t: typeof TABS[number]): number => {
    if (t.group === 'case-to-case') {
      return (shipmentIdMode === 'with' ? (vault.vendor_with_shipment ?? []) : (vault.vendor_without_shipment ?? [])).length;
    }
    return vault[t.countKey] as number;
  };

  const showSkeleton = loading && !vaultLive && !data;

  return createPortal(
    <VaultViewOnlyCtx.Provider value={viewOnly}>
    <div className="cev-overlay sev-overlay" role="dialog" aria-modal="true" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <style>{CEV_CSS}</style>
      <div className="cev-card sev" onMouseDown={(e) => e.stopPropagation()}>

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

                {(() => {
                  const segs = (supplier.segments && supplier.segments.length > 0
                    ? supplier.segments
                    : (supplier.segment ? [supplier.segment] : [])
                  ).map(s => String(s).trim()).filter(Boolean);
                  const chipSegs = segs.slice(0, 3);
                  const segRest  = segs.length - chipSegs.length;
                  const type = (supplier.type ?? '').trim();

                  const showType = !!type && !/^(pending|-|—|n\/a)$/i.test(type);
                  const risk = (supplier.risk ?? 'Low').replace(/\s*risk$/i, '');
                  return (
                    <div className="cev-header-chips">

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

        <div className="cev-groups-wrap">
          <div className="cev-groups">
            {GROUPS.map(g => (
              <div key={g.key} className={`cev-group ${group === g.key ? 'is-active' : ''}`}>
                <button
                  type="button"
                  className="cev-group-main"
                  onClick={() => selectGroup(g.key)}
                >
                  <span className="cev-group-icon"><Glyph d={g.icon} size={17} sw={2.1} /></span>
                  <span className="cev-group-text">
                    <span className="cev-group-title">{g.title}</span>
                    <span className="cev-group-sub">{g.sub}</span>
                  </span>
                </button>
                <button
                  type="button"
                  className="cev-group-overview"
                  onClick={() => { setOverview(g.key); setOverviewPage(1); }}
                  title="View all documents in one list"
                >
                  <Glyph d={VAULT_GLYPHS.list} size={12} sw={2.3} /> {g.overview}
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="sev-stats">
          {group === 'standard' ? (<>
            <SevStat tone="slate" icon={VAULT_GLYPHS.file}  label="Total Standard Documents" value={stdTotal} part={stdTotal} whole={stdTotal} split={{ up: stdUp, pend: stdPend }} />
            <SevStat tone="green" icon={VAULT_GLYPHS.checkCircle} label="Verified / Uploaded"   value={stdUp}    part={stdUp}    whole={stdTotal} tag="Compliant" />
            <SevStat tone="red"   icon={VAULT_GLYPHS.warning}   label="Pending"               value={stdPend}  part={stdPend}  whole={stdTotal} tag="Action needed" />
            <SevStat tone="teal"  icon={VAULT_GLYPHS.home}          label="Company Due Diligence" value={vault.company_dd.length}     part={vault.company_dd.length}     whole={stdTotal} split={splitOf(vault.company_dd)} />
            <SevStat tone="teal"  icon={VAULT_GLYPHS.user}          label="Owner KYC"             value={vault.owner_kyc.length}      part={vault.owner_kyc.length}      whole={stdTotal} split={splitOf(vault.owner_kyc)} />
            <SevStat tone="teal"  icon={VAULT_GLYPHS.monitor}        label="Trade License"         value={vault.trade_licenses.length} part={vault.trade_licenses.length} whole={stdTotal} split={splitOf(vault.trade_licenses)} />
          </>) : (<>
            <SevStat tone="slate" icon={VAULT_GLYPHS.truck}            label="With Shipment ID Transactions" value={(vault.vendor_with_shipment ?? []).length} />
            <SevStat tone="slate" icon={VAULT_GLYPHS.box}   label="All Other Transactions"        value={(vault.vendor_without_shipment ?? []).length} />
            <SevStat tone="teal"  icon={VAULT_GLYPHS.file}         label="Total Trade Documents"         value={dealDocs.length} part={dealDocs.length} whole={caseAll.length} />
            <SevStat tone="teal"  icon={VAULT_GLYPHS.fileLines}    label="Total Agreements"              value={dealAgrs.length} part={dealAgrs.length} whole={caseAll.length} />
            <SevStat tone="green" icon={VAULT_GLYPHS.checkCircle} label="Total Signed"                  value={caseSigned}  part={caseSigned}  whole={caseAll.length} tag="Complete" />
            <SevStat tone="amber" icon={VAULT_GLYPHS.clock}            label="Pending for Sign"              value={caseWaiting} part={caseWaiting} whole={caseAll.length} tag="Awaiting" />
            <SevStat tone="red"   icon={VAULT_GLYPHS.send}       label="Not Sent for Signature"        value={caseUnsent}  part={caseUnsent}  whole={caseAll.length} tag="Action needed" />
          </>)}
        </div>

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

        <div className="cev-tabs-wrap">
          <div className="cev-tabs">
            {TABS.filter(t => t.group === group).map(t => (
              <button
                key={t.key}
                type="button"
                className={`cev-tab ${tab === t.key ? 'is-active' : ''}`}
                onClick={() => selectTab(t)}
              >
                <span className="cev-tab-icon"><Glyph d={t.icon} size={13} /></span>
                <span className="cev-tab-label">{t.label}</span>
                <span className="cev-tab-count">{tabCount(t)}</span>
              </button>
            ))}
          </div>
        </div>

        <div className={`cev-body ${tab === 'shipment-agreements' ? 'cev-body-ship' : ''}`}>

          <div className="cev-section">
            <div className="cev-section-left">
              <div className="cev-section-icon"><Glyph d={tabMeta.icon} size={16} /></div>
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

      <SalesCustomerSendForSignatureModal
        open={Array.isArray(sendDocIds)}
        customer={supplier?.db_id ? {
          id:      supplier.id,
          db_id:   supplier.db_id,
          company: supplier.company,
          contact: supplier.contact,
          email:   supplier.email,
        } : null}
        modelName="Vendor"
        multiBox
        sendAsAgreement={sendKind === 'agreement'}
        preselectedDocIds={sendDocIds ?? undefined}
        onClose={() => setSendDocIds(null)}
        onSent={() => { setSendDocIds(null); void reloadSignatures(); }}
      />

      {overview && (() => {
        const isStd = overview === 'standard';
        type OvRow = { doc: VaultDoc; cat: 'dd' | 'kyc' | 'tl' | 'td' };
        const stdDocs: OvRow[] = isStd ? [
          ...vault.company_dd.map(d => ({ doc: d, cat: 'dd' as const })),
          ...vault.owner_kyc.map(d => ({ doc: d, cat: 'kyc' as const })),
          ...vault.trade_licenses.map(d => ({ doc: d, cat: 'tl' as const })),
        ] : [];
        const c2cDocs: OvRow[] = isStd ? [] : vault.trade_documents.map(d => ({ doc: d, cat: 'td' as const }));
        const title = isStd ? 'Standard Documents — Overview' : 'Case to Case Agreements — Overview';
        const sub = isStd
          ? 'All Company Due Diligence, Owner KYC & Trade Licenses documents in one list'
          : 'All Trade Documents & Agreements in one list';
        const docs: OvRow[] = isStd ? stdDocs : c2cDocs;

        void overviewPage;
        return (
          <div className="cev-ov-overlay sev-ov" role="dialog" aria-modal="true" onMouseDown={(e) => { if (e.target === e.currentTarget) setOverview(null); }}>
            <div className="cev-ov-card">
              <div className="cev-ov-head">
                <span className="cev-ov-head-icon"><Glyph d={VAULT_GLYPHS.list} size={18} /></span>
                <div className="cev-ov-head-text">
                  <div className="cev-ov-title">{title}</div>
                  <div className="cev-ov-sub">{sub}</div>
                </div>
                <button type="button" className="cev-ov-close" onClick={() => setOverview(null)} aria-label="Close"><i className="ri-close-line" /></button>
              </div>
              <div className="cev-ov-body">
                <table className="cev-ov-table">
                  <thead><tr><th style={{ width: 48 }}>#</th><th>Document Name</th><th style={{ width: 150 }}>Status</th><th style={{ width: 150 }}>Action</th></tr></thead>
                  <tbody>
                    {docs.length === 0 ? (
                      <tr><td colSpan={4} className="cev-ov-empty">No documents available.</td></tr>
                    ) : docs.map((row, i) => {
                      const d = row.doc;
                      const absIdx = i;
                      const raw = d.attachment_url;
                      const url = raw ? resolveFileUrl(raw) : null;
                      const fname = d.attachment || `${d.name}.pdf`;
                      const dlKey = `${overview}-${absIdx}`;
                      const dling = ovDownloadingKey === dlKey;
                      const canUpload = !viewOnly && row.cat !== 'td' && !!supplier?.db_id && !!d.doc_code;
                      return (
                        <tr key={`${overview}-${absIdx}`}>
                          <td className="cev-ov-num">{absIdx + 1}</td>
                          <td className="cev-ov-name">{d.name}</td>
                          <td><OvStatusPill s={evEffectiveStatus(d)} /></td>
                          <td>
                            {url ? (
                              <button
                                type="button"
                                className="cev-ov-dl"
                                disabled={dling}
                                onClick={async () => {
                                  setOvDownloadingKey(dlKey);
                                  try { await downloadFile(url, fname); } finally { setOvDownloadingKey(null); }
                                }}
                              >
                                {dling
                                  ? <><i className="ri-loader-4-line cev-spin" aria-hidden /> Downloading…</>
                                  : <><i className="ri-download-2-line" aria-hidden /> Download</>}
                              </button>
                            ) : canUpload ? (
                              <button
                                type="button"
                                className="cev-ov-up"
                                onClick={() => setOvUpload({ doc: d, category: row.cat as 'dd' | 'kyc' | 'tl' })}
                              >
                                <i className="ri-upload-2-line" aria-hidden /> Upload
                              </button>
                            ) : (
                              <button type="button" className="cev-ov-dl" disabled>
                                <i className="ri-download-2-line" aria-hidden /> Download
                              </button>
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
        );
      })()}

      {ovUpload && (<>
        <style>{'.avm-cp-backdrop{z-index:13000!important;}html div.master-datepicker-popup{z-index:13100!important;}'}</style>
        <SegmentRefUploadPopup
          title={ovUpload.category === 'dd' ? 'DD Document Name' : ovUpload.category === 'kyc' ? 'Owner KYC Document Name' : 'Trade License Document Name'}
          row={{ code: ovUpload.doc.reference || ovUpload.doc.doc_code || '', name: ovUpload.doc.name, authority: ovUpload.doc.authority, requirement: (ovUpload.doc.requirement as 'M' | 'O') || 'M' }}
          onClose={() => setOvUpload(null)}
          onSubmit={async (f, expiryDate) => { await submitOvUpload(f, expiryDate); }}
        />
      </>)}

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

function SevStat(props: {
  tone: 'slate' | 'teal' | 'green' | 'amber' | 'red';
  icon: ReactNode;
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
      <span className="sev-stat-ico"><Glyph d={props.icon} size={11} /></span>
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

function VaultSkeleton() {
  return (
    <div className="cev-skel">

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

  const codeLbl = tab === 'owner-kyc' ? 'Document Number' : tab === 'trade-documents' ? 'Reference' : 'License / Number';

  const category: 'kyc' | 'dd' | 'tl' | 'td' = tab === 'company-dd' ? 'dd' : tab === 'owner-kyc' ? 'kyc' : tab === 'trade-licenses' ? 'tl' : 'td';
  return (
    <div className="cev-table-wrap">
      <div className="cev-table-scroll">

      <table className="cev-table">
        <thead>
          <tr>
            <th style={{ width: 40 }}>Sr No</th>

            <th style={{ width: 220 }}>Document Name</th>
            <th>{codeLbl}</th>
            <th>{authorityLbl}</th>
            <th>Requirement</th>
            <th>Expiry</th>
            <th>Attachment</th>
            <th>Status</th>
            <th style={{ width: 190 }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={9} className="cev-empty">No documents in this bucket yet.</td></tr>
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

function evExpiryIso(s?: string | null): string {
  const d = evParseExpiry(s);
  if (!d) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function evEffectiveStatus(d: VaultDoc): VaultStatus | 'Expired' {
  const exp = evParseExpiry(d.expiry);
  if (exp) { const today = new Date(); today.setHours(0, 0, 0, 0); if (exp < today) return 'Expired'; }
  return d.status;
}

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

function clipFileName(s: string, max = 42): string {
  if (!s || s.length <= max) return s;
  const dot = s.lastIndexOf('.');
  const ext = dot > 0 && s.length - dot <= 6 ? s.slice(dot) : '';
  return s.slice(0, Math.max(1, max - ext.length - 1)) + '…' + ext;
}

function VaultReuploadPopup({ doc, category, busy, onClose, onSubmit }: {
  doc: VaultDoc;
  category: 'kyc' | 'dd' | 'tl' | 'td' | 'agreement';
  busy: boolean;
  onClose: () => void;
  onSubmit: (f: File, opts?: { docName?: string; expiryDate?: string }) => void | Promise<void>;
}) {
  const toast = useToast();

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
  const docName = doc.name || '';
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

function OvStatusPill({ s }: { s: VaultStatus | 'Expired' }) {
  const tone = s === 'Verified' || s === 'Signed' ? ['#ecfdf5', '#059669', '#6ee7b7', '#10b981']
    : s === 'Expiring' ? ['#fffbeb', '#d97706', '#fcd34d', '#f59e0b']
    : ['#fef2f2', '#dc2626', '#fecaca', '#ef4444'];
  return (
    <span
      className="sev-ov-pill"
      style={{ background: `linear-gradient(135deg, ${tone[0]}, #fff)`, color: tone[1], border: `1px solid ${tone[2]}` }}
    >
      <span className="sev-ov-pill-dot" style={{ background: tone[3] }} />
      {s}
    </span>
  );
}

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
  const [trackerOpen, setTrackerOpen] = useState(false);
  const canTrack = !!doc.signature_request_id;
  const canViewOrDownload = !!doc.attachment_url;
  const canReupload = !!ownerId && !!doc.doc_code;

  const isStdCat = category === 'kyc' || category === 'dd' || category === 'tl';

  const isSigned     = doc.sig_state === 'completed' || doc.status === 'Signed';
  const isInProgress = doc.sig_state === 'inprogress';

  const isTradeDoc   = (category === 'td' || category === 'agreement') && !!ownerId && !!doc.db_id;
  const canSend   = !viewOnly && isTradeDoc && !!onSendTradeDoc && !isSigned && !isInProgress;
  const canRemind = isTradeDoc && !!onRemindTradeDoc && isInProgress && !!doc.signature_request_id;

  const remind = async () => {
    if (!onRemindTradeDoc) return;
    setReminding(true);
    try { await onRemindTradeDoc(doc); } finally { setReminding(false); }
  };

  const onPick = async (f: File | undefined, opts?: { docName?: string; expiryDate?: string }): Promise<boolean> => {
    if (!f || !ownerId || !doc.doc_code) return false;

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
          className={`cev-row-act cev-row-act-view sev-row-act-txt ${!canViewOrDownload ? 'is-disabled' : ''}`}
          onClick={e => { if (!canViewOrDownload) e.preventDefault(); }}
          aria-label="View"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
          <span>View</span>
        </a>
      </Tooltip>
      {category !== 'td' && category !== 'agreement' && !viewOnly && (
      <Tooltip label={canReupload ? (busy ? 'Uploading…' : (doc.attachment ? 'Re-upload (replace file)' : 'Upload')) : 'Save the record first'}>
        <button
          type="button"
          disabled={!canReupload || busy}
          onClick={() => setReupOpen(true)}
          className={`cev-row-act cev-row-act-upload sev-row-act-txt ${(!canReupload || busy) ? 'is-disabled' : ''}`}
          aria-label={doc.attachment ? 'Re-upload' : 'Upload'}
        >
          {busy
            ? <svg className="cev-spin" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
            : doc.attachment
              ? <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
              : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>}
          <span>{doc.attachment ? 'Re-upload' : 'Upload'}</span>
        </button>
      </Tooltip>
      )}

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

const DEAL_TH: React.CSSProperties = { padding: '10px 8px', fontSize: 7, fontWeight: 700, letterSpacing: '.12em', color: 'rgba(255,255,255,.65)', textTransform: 'uppercase' };
const DEAL_THC: React.CSSProperties = { ...DEAL_TH, textAlign: 'center' };
const DEAL_AV_GRADS = [
  'linear-gradient(135deg,#06b6d4,#22d3ee)',
  'linear-gradient(135deg,#0e7490,#22d3ee)',
  'linear-gradient(135deg,#0891b2,#06b6d4)',
  'linear-gradient(135deg,#083344,#0891b2)',
];

function dealFrac(c?: DealCount) {

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

const DEAL_SUB_TH: React.CSSProperties = { padding: '8px 12px', fontSize: 6.5, fontWeight: 700, letterSpacing: '.12em', color: 'rgba(255,255,255,.65)', textTransform: 'uppercase' };

function dealDocState(d: VaultDoc): { label: string; c: [string, string, string, string] } {
  if (d.sig_state === 'completed' || d.status === 'Signed') return { label: 'Signed', c: ['#ecfdf5', '#059669', '#a7f3d0', '#10b981'] };
  if (d.sig_state === 'inprogress') return { label: 'Sent', c: ['#fffbeb', '#d97706', '#fcd34d', '#f59e0b'] };

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

  docKind?: 'trade' | 'agreement';
}) {
  const [open, setOpen] = useState<number | null>(null);

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
