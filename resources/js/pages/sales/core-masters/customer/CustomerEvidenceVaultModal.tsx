import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
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
import '../../../p2p/p2p-master-management/supplier-management/supplier-evidence-vault.css';
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

export interface VaultShipmentDoc {
  sig_req_id: number;
  signature_request_id?: number | null;
  sig_state?: string | null;
  db_id?: number | null;
  doc_type?: string | null;
  name: string;
  required: string;
  status: 'Signed' | 'Pending' | 'Declined' | 'Recalled' | 'Expired' | 'Draft';
  uploaded_on: string;
  valid_upto: string;
  signed_url?: string | null;
  pi_id?: number | null;
  pi_code?: string | null;
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
  has_shipment?: boolean;
  trade_docs_buyer?:     VaultShipmentDoc[];
  trade_docs_consignee?: VaultShipmentDoc[];
  agreements_buyer?:     VaultShipmentDoc[];
  agreements_consignee?: VaultShipmentDoc[];
}

export interface VaultData {
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
  agreements?:            VaultDoc[];
  shipment_agreements:    VaultShipmentRow[];
  last_updated:           string;
}

export interface CustomerVaultTarget {
  id: string;
  db_id?: number;
  company: string;
  risk?: string;
  type?: string;
  segment?: string;
  country?: string;
  contact?: string;
  contactCity?: string;
}

interface Props {
  open: boolean;
  customer: CustomerVaultTarget | null;
  onClose: () => void;
  data?: VaultData | null;
  initialTab?: TabKey;
}

export type TabKey = 'company-dd' | 'owner-kyc' | 'trade-licenses' | 'trade-documents' | 'shipment-agreements';

type GroupKey = 'standard' | 'case-to-case';

const GROUPS: { key: GroupKey; title: string; sub: string; icon: string; overview: string }[] = [
  { key: 'standard',     title: 'Standard Documents',                  sub: 'ONE TIME · KYC, DD & LICENSES',      icon: 'ri-shield-check-line', overview: 'All Standard Document Overview' },
  { key: 'case-to-case', title: 'Case to Case Documents & Agreements', sub: 'PER DEAL · TRADE DOCS & AGREEMENTS', icon: 'ri-todo-line',         overview: 'Send Documents & Agreements for Signature' },
];

const TABS: { key: TabKey; label: string; sectionTitle?: string; icon: string; countKey: keyof VaultData; group: GroupKey }[] = [
  { key: 'company-dd',          label: 'Company Due Diligence', icon: 'ri-shield-check-line',   countKey: 'company_dd_count',       group: 'standard' },
  { key: 'owner-kyc',           label: 'Owner KYC Details',     icon: 'ri-user-3-line',         countKey: 'owner_kyc_count',        group: 'standard' },
  { key: 'trade-licenses',      label: 'Trade Licenses',        icon: 'ri-file-list-3-line',    countKey: 'trade_license_count',    group: 'standard' },
  { key: 'trade-documents',     label: 'Trade Documents & Agreements (Per Transaction)',
                                sectionTitle: 'Trade Documents & Agreements',
                                                                icon: 'ri-article-line',        countKey: 'trade_documents_count',  group: 'case-to-case' },
];

const groupOfTab = (t: TabKey): GroupKey => TABS.find(x => x.key === t)?.group ?? 'standard';

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
  const uploadingRef = useRef(0);
  const [uploading, setUploading] = useState(false);
  const onRowBusyChange = useCallback((busy: boolean) => {
    uploadingRef.current = Math.max(0, uploadingRef.current + (busy ? 1 : -1));
    setUploading(uploadingRef.current > 0);
  }, []);
  const [segPop, setSegPop] = useState<{ names: string[]; x: number; y: number } | null>(null);
  const [overview, setOverview] = useState<GroupKey | null>(null);
  const [ovShip, setOvShip] = useState<number | null>(null);
  const [ovShipFilter, setOvShipFilter] = useState<'buyer-eq-consignee' | 'buyer-neq-consignee'>('buyer-eq-consignee');
  const [ovDownloadingKey, setOvDownloadingKey] = useState<string | null>(null);
  const [ovUploadingKey, setOvUploadingKey] = useState<string | null>(null);
  const ovFileRef = useRef<HTMLInputElement | null>(null);
  const ovUploadTarget = useRef<{ doc: VaultDoc; cat: 'dd' | 'kyc' | 'tl'; key: string } | null>(null);
  const [shipmentFilter, setShipmentFilter] = useState<'buyer-eq-consignee' | 'buyer-neq-consignee'>('buyer-eq-consignee');

  const selectGroup = (g: GroupKey) => {
    setGroup(g);
    const first = TABS.find(t => t.group === g);
    if (first) setTab(first.key);
  };
  const [exporting, setExporting] = useState(false);
  const [vaultLive, setVaultLive] = useState<VaultData | null>(null);
  const [loading, setLoading] = useState(false);
  const [signatureRows, setSignatureRows] = useState<SigReqRow[]>([]);
  const [sendDocIds, setSendDocIds] = useState<number[] | null>(null);
  const [shipSend, setShipSend] = useState<{ leadId: number; doc: VaultShipmentDoc; docs?: VaultShipmentDoc[]; party: 'buyer' | 'consignee' } | null>(null);
  const [piSend, setPiSend] = useState<{ leadId: number; doc: VaultShipmentDoc } | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || uploadingRef.current !== 0) return;
      if (overview) return;
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, overview]);

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
    const startTab = initialTab ?? 'company-dd';
    setTab(startTab);
    setGroup(groupOfTab(startTab));
    setShipmentFilter('buyer-eq-consignee');
  }, [open, customer?.db_id, initialTab]);

  const reloadVault = useCallback(() => {
    if (!customer?.db_id) return Promise.resolve();
    setLoading(true);
    return api.get(`/segment-uploads/customer/${customer.db_id}/vault`)
      .then(r => { setVaultLive((r.data?.data ?? null) as VaultData | null); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [customer?.db_id]);

  const ovUploadPick = useCallback(async (file: File | undefined) => {
    const target = ovUploadTarget.current;
    ovUploadTarget.current = null;
    if (!file || !target || !customer?.db_id || !target.doc.doc_code) return;
    if (!/\.(pdf|jpe?g|png)$/i.test(file.name)) {
      toast.error('Unsupported file type', 'Only PDF, JPG or PNG files are allowed. Word / Excel files are not supported.');
      return;
    }
    if (file.size > 2048 * 1024) {
      toast.error('File too large', 'The file must be 2048 KB (2 MB) or smaller.');
      return;
    }
    setOvUploadingKey(target.key);
    onRowBusyChange(true);
    try {
      const fd = new FormData();
      fd.append('category', target.cat);
      fd.append('doc_code', target.doc.doc_code);
      fd.append('doc_name', target.doc.name || target.doc.doc_code);
      fd.append('attachment', file);
      await api.post(`/segment-uploads/customer/${customer.db_id}`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      await reloadVault();
      toast.success('Document uploaded', `${file.name} has been attached.`);
    } catch (e: any) {
      toast.error('Upload failed', e?.response?.data?.message || 'The file could not be uploaded. Please try again.');
    } finally {
      setOvUploadingKey(null);
      onRowBusyChange(false);
    }
  }, [customer?.db_id, reloadVault, toast, onRowBusyChange]);

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

  const reloadSignatures = useCallback(() => {
    if (!customer?.db_id) return Promise.resolve();
    return api.get('/clm/signature-requests', {
      params: { party_id: customer.db_id, model_name: 'Customer', sync: 1 },
    })
      .then(r => { setSignatureRows(Array.isArray(r.data?.data) ? (r.data.data as SigReqRow[]) : []); })
      .catch(() => {});
  }, [customer?.db_id]);

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

  const vault: VaultData | null = useMemo(() => {
    if (!customer) return null;
    const base = data ?? vaultLive ?? EMPTY_VAULT;
    if (!base) return null;
    const sigRows            = signatureRequestsToVaultDocs(signatureRows);
    const baseSegmentTd      = (base.trade_documents ?? []) as VaultDoc[];
    const mergedTd           = mergeTradeDocuments(baseSegmentTd as any, sigRows, 'buyer') as unknown as VaultDoc[];
    const overlaidShipments = overlayShipmentSigStatus(base.shipment_agreements ?? [], signatureRows);
    return {
      ...base,
      trade_documents: mergedTd as typeof base.trade_documents,
      shipment_agreements: overlaidShipments as typeof base.shipment_agreements,
    };
  }, [customer, data, vaultLive, signatureRows]);

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

  const StatusPill = ({ s }: { s: VaultStatus }) => {
    const tone =
      s === 'Verified' ? { bg: '#ecfdf5', fg: '#059669' }
      : s === 'Signed'   ? { bg: '#dbeafe', fg: '#1e40af' }
      : s === 'Expiring' ? { bg: '#fef3c7', fg: '#92400e' }
      :                    { bg: '#fef2f2', fg: '#dc2626' };
    return (
      <span className="cev-pill" data-status={s} style={{ background: tone.bg, color: tone.fg }}>
        {s}
      </span>
    );
  };

  const docsForTab: VaultDoc[] = tab === 'company-dd' ? vault.company_dd
    : tab === 'owner-kyc'      ? vault.owner_kyc
    : tab === 'trade-licenses' ? vault.trade_licenses
    : tab === 'trade-documents' ? vault.trade_documents
    : [];
  const isUploaded = (d: VaultDoc) => !!(d.attachment_url || (d.attachment && d.attachment !== '—'));
  const counts = {
    Uploaded: docsForTab.filter(isUploaded).length,
    Pending:  docsForTab.filter(d => !isUploaded(d)).length,
  };

  const tabMeta = TABS.find(t => t.key === tab) ?? TABS[0];

  /* Case-to-Case is about shipments, so an opportunity that has not raised one
     yet does not belong in it. Those rows rendered as "Not shipped" with every
     ratio at 0/x and nothing to expand, while the section pill — which reads
     the server's total_shipments — already excluded them, so the list and the
     count contradicted each other. One filtered list now feeds the table, the
     overview picker and every count derived from them. has_shipment is
     optional, so undefined still counts as shipped. */
  const shippedRows = vault.shipment_agreements.filter(r => r.has_shipment !== false);

  const ratioTotal = (ratio: string) => { const p = (ratio || '').split('/'); return parseInt(p[1] ?? p[0], 10) || 0; };
  const shipmentDocCount = (key: 'trade_docs' | 'agreement') =>
    shippedRows.reduce((acc, r) => acc + ratioTotal(r[key].ratio), 0);
  const tabCount = (t: typeof TABS[number]): number =>
    t.key === 'trade-documents'     ? shipmentDocCount('trade_docs') + shipmentDocCount('agreement')
    : t.key === 'shipment-agreements' ? shipmentDocCount('agreement')
    : (vault[t.countKey] as number);

  const stdAll   = [...vault.company_dd, ...vault.owner_kyc, ...vault.trade_licenses];
  const stdTotal = stdAll.length;
  const stdUp    = stdAll.filter(isUploaded).length;
  const stdPend  = stdTotal - stdUp;
  const splitOf  = (rows: VaultDoc[]) => {
    const up = rows.filter(isUploaded).length;
    return { up, pend: rows.length - up };
  };

  const ratioDone = (ratio: string) => { const p = (ratio || '').split('/'); return parseInt(p[0], 10) || 0; };
  const shipmentDocDone = (key: 'trade_docs' | 'agreement') =>
    shippedRows.reduce((acc, r) => acc + ratioDone(r[key].ratio), 0);
  const tdTotal  = shipmentDocCount('trade_docs');
  const tdDone   = shipmentDocDone('trade_docs');
  const agrTotal = shipmentDocCount('agreement');
  const agrDone  = shipmentDocDone('agreement');
  const c2cTotal = tdTotal + agrTotal;
  const c2cDone  = tdDone + agrDone;
  const c2cPend  = c2cTotal - c2cDone;

  const showSkeleton = loading && !vaultLive && !data;

  return createPortal(
    <div className="cev-overlay sev-overlay" role="dialog" aria-modal="true" onMouseDown={(e) => { if (e.target === e.currentTarget && !uploading) onClose(); }}>
      <style>{CLM_CSS}</style>
      <div className="cev-card sev" onMouseDown={(e) => e.stopPropagation()}>
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
                <div className="cev-header-eyebrow">PARTY WISE CLM: CUSTOMER EVIDENCE VAULT</div>
                <div className="cev-header-title">
                  <span className="sev-hd-code">{customer.id}</span>
                  <span className="sev-hd-dash" aria-hidden>—</span>
                  <span className="sev-hd-nm">{customer.company}</span>
                </div>
                <div className="cev-header-chips">
                  {customer.contact && (
                    <span className="cev-chip cev-chip-contact">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                      {customer.contact}
                    </span>
                  )}
                  {customer.contactCity && <span className="cev-chip cev-chip-city">{customer.contactCity}</span>}
                  {customer.type && <span className="cev-chip cev-chip-type">{customer.type}</span>}
                  {customer.segment && (() => {
                    const segs = String(customer.segment).split(',').map(s => s.trim()).filter(Boolean);
                    if (segs.length === 0) return null;
                    const first = segs[0];
                    const extra = segs.length - 1;
                    const short = first.length > 20 ? first.slice(0, 20) + '…' : first;
                    /* One badge rather than a chip plus a separate "+N more"
                       button: the named segment carries the count inline and the
                       whole thing opens the full list. */
                    if (extra === 0) {
                      return <Tooltip label={first}><span className="cev-chip cev-chip-seg">{short}</span></Tooltip>;
                    }
                    return (
                      <Tooltip label={`${segs.length} segments — click to see all`}>
                        <button
                          type="button"
                          className="cev-chip cev-chip-seg sev-chip-more"
                          onClick={e => { const b = e.currentTarget.getBoundingClientRect(); setSegPop(prev => prev ? null : { names: segs, x: b.left, y: b.bottom + 6 }); }}
                        >{short}<span className="cev-chip-seg-count">+{extra}</span></button>
                      </Tooltip>
                    );
                  })()}
                  {customer.country && <span className="cev-chip cev-chip-country">{customer.country}</span>}
                  {(() => {
                    const risk = (customer.risk ?? '').replace(/\s*risk$/i, '').trim();
                    if (!risk) return null;
                    return <span className="cev-chip cev-chip-risk" data-risk={risk.toLowerCase()}>{risk} Risk</span>;
                  })()}
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
        <div className="cev-groups-wrap">
          <div className="cev-groups">
            {GROUPS.map(g => (
              <div key={g.key} className={`cev-group ${group === g.key ? 'is-active' : ''}`}>
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
                  onClick={() => { setOverview(g.key); setOvShip(null); }}
                  title="View all documents in one list"
                >
                  <i className="ri-list-check-2" aria-hidden /> {g.overview}
                </button>
              </div>
            ))}
          </div>
        </div>

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

        {/* Customer =/≠ Consignee — the same pill toggle the Supplier vault uses
            for its transaction switch, now above the tab row rather than buried
            in the table. Shown only where it applies: the shipment table is the
            one view it filters. */}
        {tab === 'trade-documents' && (
          <div className="cev-shp-toggle">
            <button type="button" className={shipmentFilter === 'buyer-eq-consignee' ? 'is-active' : ''} onClick={() => setShipmentFilter('buyer-eq-consignee')}>
              <i className="ri-user-shared-line" aria-hidden />Customer = Consignee
            </button>
            <button type="button" className={shipmentFilter === 'buyer-neq-consignee' ? 'is-active' : ''} onClick={() => setShipmentFilter('buyer-neq-consignee')}>
              <i className="ri-user-received-line" aria-hidden />Customer &ne; Consignee
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

        <div className={`cev-body ${tab === 'trade-documents' ? 'cev-body-ship' : ''}`}>
          <div className="cev-section">
            <div className="cev-section-left">
              <div className="cev-section-icon"><i className={tabMeta.icon} /></div>
              <div>
                <div className="cev-section-title">{tabMeta.sectionTitle ?? tabMeta.label}</div>
                <div className="cev-section-sub">{sectionSub(tab)}</div>
              </div>
            </div>
            <div className="cev-section-right">
              {tab === 'trade-documents' ? (
                <span className="cev-sec-pill cev-sec-pill-docs">{vault.total_shipments} Shipments</span>
              ) : (
                <>
                  {counts.Uploaded > 0 && <span className="cev-sec-pill cev-sec-pill-ok"><span className="cev-sec-dot" />Uploaded {counts.Uploaded}</span>}
                  {counts.Pending > 0 && <span className="cev-sec-pill cev-sec-pill-bad"><span className="cev-sec-dot" />Pending {counts.Pending}</span>}
                </>
              )}
            </div>
          </div>

          {tab === 'trade-documents'
            ? <ShipmentTable rows={shippedRows} kind="both" filter={shipmentFilter}
                             onSend={(leadId, doc, party) => { if (doc.pi_id) setPiSend({ leadId, doc }); else setShipSend({ leadId, doc, party }); }}
                             onBulkSend={(leadId, docs, party) => { if (docs.length) setShipSend({ leadId, doc: docs[0], docs, party }); }}
                             activeSend={shipSend ?? (piSend ? { ...piSend, party: 'buyer' } : null)} />
            : <DocsTable rows={docsForTab} tab={tab} ownerType="customer" ownerId={customer?.db_id ?? null} onReload={reloadVault}
                         onSendTradeDoc={(d) => { if (d.db_id) setSendDocIds([d.db_id]); }}
                         onRemindTradeDoc={handleRemind} onRowBusyChange={onRowBusyChange} />}
        </div>
        </>)}

        <div className="cev-footer">
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
                {exporting ? ' Exporting…' : ' Export All'}
              </button>
            </Tooltip>
            <button type="button" className="cev-btn cev-btn-dark" onClick={() => { if (!uploading) onClose(); }} disabled={uploading} title={uploading ? 'Please wait — an upload is in progress' : undefined} style={uploading ? { opacity: .6, cursor: 'not-allowed' } : undefined}>
              {uploading ? 'Uploading…' : 'Close Vault'}
            </button>
          </div>
        </div>
      </div>

      <SalesCustomerSendForSignatureModal
        boxSize={{ width: 240, height: 55 }}
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

      <ShipmentDocSendForSignature
        target={shipSend}
        onClose={() => setShipSend(null)}
        onSent={() => { setShipSend(null); void reloadVault(); void reloadSignatures(); }}
      />

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

      {overview && (() => {
        const isStd = overview === 'standard';
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
        const shipments = isStd ? [] : shippedRows.filter(r =>
          ovShipFilter === 'buyer-neq-consignee' ? !r.buyer_is_consignee : r.buyer_is_consignee);
        const shipsWithDocs = isStd ? [] : shipments.filter((r) => shipDocsOf(r).length > 0);
        const activeShip = isStd ? null : (shipsWithDocs.find((r) => r.id === ovShip) ?? null);
        const picking = !isStd && !activeShip;
        const docs: { doc: VaultDoc | VaultShipmentDoc; cat: 'dd' | 'kyc' | 'tl' | null }[] = isStd
          ? [
              ...vault.company_dd.map((d) => ({ doc: d, cat: 'dd' as const })),
              ...vault.owner_kyc.map((d) => ({ doc: d, cat: 'kyc' as const })),
              ...vault.trade_licenses.map((d) => ({ doc: d, cat: 'tl' as const })),
            ]
          : (activeShip ? shipDocsOf(activeShip).map((d) => ({ doc: d, cat: null })) : []);
        const shipLabel = (r: VaultShipmentRow) => (r.has_shipment === false ? 'Not shipped' : r.shipment_id);
        const title = isStd
          ? 'Standard Documents — Overview'
          : (activeShip ? `Case to Case — ${shipLabel(activeShip)}` : 'Case to Case Documents & Agreements — Overview');
        const sub = isStd
          ? 'All Company Due Diligence, Owner KYC & Trade Licenses documents in one list'
          : (activeShip
            ? `Trade Documents & Agreements for ${activeShip.customer}`
            : 'Select a shipment to view its Trade Documents & Agreements');
        return (
          <div className="cev-ov-overlay sev-ov" role="dialog" aria-modal="true">
            <div className="cev-ov-card">
              <input
                ref={ovFileRef}
                type="file"
                hidden
                accept=".pdf,.jpg,.jpeg,.png"
                onChange={(e) => { void ovUploadPick(e.target.files?.[0] ?? undefined); e.currentTarget.value = ''; }}
              />
              <div className="cev-ov-head">
                <span className="cev-ov-head-icon"><i className="ri-list-check-2" aria-hidden /></span>
                <div className="cev-ov-head-text">
                  <div className="cev-ov-title">{title}</div>
                  <div className="cev-ov-sub">{sub}</div>
                </div>
                {activeShip && (
                  <button type="button" className="sev-ov-back" onClick={() => setOvShip(null)}>
                    <i className="ri-arrow-left-s-line" aria-hidden /> Back to shipments
                  </button>
                )}
                <button type="button" className="cev-ov-close" onClick={() => setOverview(null)} aria-label="Close"><i className="ri-close-line" /></button>
              </div>
              {picking ? (
                <div className="cev-ov-body">
                  <div className="cev-shp-toggle cev-ov-shp-toggle">
                    <button type="button" className={ovShipFilter === 'buyer-eq-consignee' ? 'is-active' : ''} onClick={() => { setOvShipFilter('buyer-eq-consignee'); setOvShip(null); }}>
                      <i className="ri-user-shared-line" aria-hidden />Customer = Consignee
                    </button>
                    <button type="button" className={ovShipFilter === 'buyer-neq-consignee' ? 'is-active' : ''} onClick={() => { setOvShipFilter('buyer-neq-consignee'); setOvShip(null); }}>
                      <i className="ri-user-received-line" aria-hidden />Customer &ne; Consignee
                    </button>
                  </div>
                  {shipsWithDocs.length === 0 ? (
                    <div className="sev-ov-pick-empty">
                      No {ovShipFilter === 'buyer-neq-consignee' ? 'separate-consignee' : 'customer-as-consignee'} transactions with documents for this customer yet.
                    </div>
                  ) : (
                    <ul className="sev-ov-picks">
                      {shipsWithDocs.map((r) => (
                        <li key={r.id}>
                          <button type="button" className="sev-ov-pick" onClick={() => setOvShip(r.id)}>
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
              ) : (!isStd && activeShip) ? (
              /* A picked shipment shows the SAME panel the main table expands
                 to — same columns, same select column and bulk bar, same row
                 actions — rather than a reduced list that could only download.
                 One component, so the two can't drift apart. */
              <div className="cev-ov-body">
                <ShipmentDocPanel
                  buyer={[...(activeShip.trade_docs_buyer ?? []), ...(activeShip.agreements_buyer ?? [])]}
                  consignee={[...(activeShip.trade_docs_consignee ?? []), ...(activeShip.agreements_consignee ?? [])]}
                  showType
                  buyerIsConsignee={activeShip.buyer_is_consignee}
                  onSend={(doc, party) => { if (doc.pi_id) setPiSend({ leadId: activeShip.id, doc }); else setShipSend({ leadId: activeShip.id, doc, party }); }}
                  onBulkSend={(docs, party) => { if (docs.length) setShipSend({ leadId: activeShip.id, doc: docs[0], docs, party }); }}
                  pendingSend={shipSend && shipSend.leadId === activeShip.id ? { doc: shipSend.doc, party: shipSend.party } : null}
                />
              </div>
              ) : (
              <div className="cev-ov-body">
                <table className="cev-ov-table">
                  <thead><tr><th style={{ width: 64 }}>SR NO</th><th>DOCUMENT NAME</th><th style={{ width: 130 }}>STATUS</th><th style={{ width: 130 }}>ACTION</th></tr></thead>
                  <tbody>
                    {docs.length === 0 ? (
                      <tr><td colSpan={4} className="cev-ov-empty">{isStd ? 'No documents available.' : (shipsWithDocs.length === 0 ? 'No shipment documents available.' : 'No documents for this shipment.')}</td></tr>
                    ) : docs.map((row, i) => {
                      const d = row.doc;
                      const absIdx = i;
                      const raw = isStd ? (d as VaultDoc).attachment_url : (d as VaultShipmentDoc).signed_url;
                      const url = raw ? resolveFileUrl(raw) : null;
                      const fname = isStd ? ((d as VaultDoc).attachment || `${d.name}.pdf`) : `${d.name}.pdf`;
                      return (
                        <tr key={`${activeShip?.id ?? 'std'}-${absIdx}`}>
                          <td className="cev-ov-num">{absIdx + 1}</td>
                          <Tooltip label={d.name} disabled={(d.name || '').length <= 35}>
                            <td className="cev-ov-name">{(d.name || '').length > 35 ? (d.name || '').slice(0, 35) + '…' : d.name}</td>
                          </Tooltip>
                          <td><StatusPill s={d.status as VaultStatus} /></td>
                          <td>
                            {(() => {
                              const dlKey = `${activeShip?.id ?? 'std'}-${absIdx}`;
                              const dling = ovDownloadingKey === dlKey;
                              const uping = ovUploadingKey === dlKey;
                              const canUpload = isStd && !!row.cat && !!customer.db_id && !!(d as VaultDoc).doc_code;
                              if (!url && canUpload) {
                                return (
                                  <button
                                    type="button"
                                    className="cev-ov-up"
                                    disabled={uping}
                                    onClick={() => {
                                      ovUploadTarget.current = { doc: d as VaultDoc, cat: row.cat as 'dd' | 'kyc' | 'tl', key: dlKey };
                                      ovFileRef.current?.click();
                                    }}
                                  >
                                    {uping
                                      ? <><i className="ri-loader-4-line cev-spin" aria-hidden /> Uploading…</>
                                      : <><i className="ri-upload-2-line" aria-hidden /> Upload</>}
                                  </button>
                                );
                              }
                              return (
                                <button
                                  type="button"
                                  className="cev-ov-dl"
                                  disabled={!url || dling}
                                  onClick={async () => {
                                    if (!url) return;
                                    setOvDownloadingKey(dlKey);
                                    try {
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
    </div>,
    document.body
  );
}

/* Exported for the Consignee vault, which shares this design. Kept here
   rather than in a component file because this is where the vault design
   lives and the consignee vault already imports from this module. */
export function SevStat(props: {
  tone: 'slate' | 'teal' | 'green' | 'amber' | 'red';
  icon: string;
  label: string;
  value: number;
  part?: number;
  whole?: number;
  tag?: string;
  split?: { up: number; pend: number; upLabel?: string; pendLabel?: string };
}) {
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
          <span className={`sev-split-up ${props.split.up === 0 ? 'is-zero' : ''}`}>{props.split.up} {props.split.upLabel ?? 'uploaded'}</span>
          <span className={`sev-split-pd ${props.split.pend === 0 ? 'is-zero' : ''}`}>{props.split.pend} {props.split.pendLabel ?? 'pending'}</span>
        </div>
      ) : props.tag ? <div className="sev-stat-tag">{props.tag}</div> : null}
    </div>
  );
}

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

function DocsTable({ rows, tab, ownerType, ownerId, onReload, onSendTradeDoc, onRemindTradeDoc, onRowBusyChange }: {
  rows: VaultDoc[];
  tab: TabKey;
  ownerType: 'customer' | 'consignee' | 'supplier';
  ownerId: number | null;
  onReload: () => Promise<void> | void;
  onSendTradeDoc?: (doc: VaultDoc) => void;
  onRemindTradeDoc?: (doc: VaultDoc) => void | Promise<void>;
  onRowBusyChange?: (busy: boolean) => void;
}) {
  const authorityLbl = tab === 'trade-documents' ? 'Counter Party' : 'Issuing Authority';
  const [chipBusy, setChipBusy] = useState<string | null>(null);
  const category: 'kyc' | 'dd' | 'tl' | 'td' = tab === 'company-dd' ? 'dd' : tab === 'owner-kyc' ? 'kyc' : tab === 'trade-licenses' ? 'tl' : 'td';
  return (
    <div className="cev-table-wrap">
      <div className="cev-table-scroll">

      <table className="cev-table">
        <thead>
          <tr>
            <th style={{ width: 56 }}>Sr No</th>
            <th>Auto Code</th>
            <th>Document Name</th>
            <th>{authorityLbl}</th>
            <th>Requirement</th>
            <th>Attachment</th>
            <th style={{ width: 260 }}>Actions</th>
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

function VaultRowActions({ doc, ownerType, ownerId, category, onReload, onSendTradeDoc, onRemindTradeDoc, onBusyChange }: {
  doc: VaultDoc;
  ownerType: 'customer' | 'consignee' | 'supplier';
  ownerId: number | null;
  category: 'kyc' | 'dd' | 'tl' | 'td';
  onReload: () => Promise<void> | void;
  onSendTradeDoc?: (doc: VaultDoc) => void;
  onRemindTradeDoc?: (doc: VaultDoc) => void | Promise<void>;
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
  const isSigned     = doc.sig_state === 'completed' || doc.status === 'Signed';
  const isInProgress = doc.sig_state === 'inprogress';
  const isTradeDoc   = category === 'td' && !!ownerId && !!doc.db_id;
  const canSend   = isTradeDoc && !!onSendTradeDoc && !isSigned && !isInProgress;
  const canRemind = isTradeDoc && !!onRemindTradeDoc && isInProgress && !!doc.signature_request_id;
  const canTrack  = !!doc.signature_request_id;

  const remind = async () => {
    if (!onRemindTradeDoc) return;
    setReminding(true);
    try { await onRemindTradeDoc(doc); } finally { setReminding(false); }
  };

  const download = async () => {
    if (downloading || !doc.attachment_url) return;
    setDownloading(true);
    try { await downloadFile(doc.attachment_url, doc.attachment ?? undefined); }
    finally { setDownloading(false); }
  };

  const onPick = async (f: File | undefined) => {
    if (!f || !ownerId || !doc.doc_code) return;
    if (!/\.(pdf|jpe?g|png)$/i.test(f.name)) {
      toast.error('Unsupported file type', 'Only PDF, JPG or PNG files are allowed. Word / Excel files are not supported.');
      return;
    }
    if (f.size > 2048 * 1024) {
      toast.error('File too large', 'The file must be 2048 KB (2 MB) or smaller.');
      return;
    }
    setBusy(true);
    onBusyChange?.(true);
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
          className={`cev-row-act cev-row-act-view sev-row-act-txt ${!canViewOrDownload ? 'is-disabled' : ''}`}
          onClick={e => { if (!canViewOrDownload) { e.preventDefault(); return; } setViewing(true); window.setTimeout(() => setViewing(false), 1200); }}
          aria-label="View"
        >
          {/* Only the ICON swaps for the spinner — the label stays put, so the
              button keeps its width and the row of actions doesn't reflow
              while one of them is working. */}
          {viewing
            ? <i className="ri-loader-4-line cev-spin" style={{ fontSize: 13 }} aria-hidden />
            : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>}
          <span>View</span>
        </a>
      </Tooltip>
      <Tooltip label={canViewOrDownload ? (downloading ? 'Downloading…' : `Download ${doc.attachment}`) : 'No attachment yet'}>
        <button
          type="button"
          disabled={!canViewOrDownload || downloading}
          onClick={download}
          className={`cev-row-act cev-row-act-download sev-row-act-txt ${!canViewOrDownload ? 'is-disabled' : ''}`}
          aria-label="Download"
        >
          {downloading
            ? <i className="ri-loader-4-line cev-spin" style={{ fontSize: 13 }} aria-hidden />
            : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>}
          <span>Download</span>
        </button>
      </Tooltip>
      {category !== 'td' && (
      <Tooltip label={canReupload ? (busy ? 'Uploading…' : (doc.attachment ? 'Re-upload (replace file)' : 'Upload')) : 'Save the record first'}>
        <button
          type="button"
          disabled={!canReupload || busy}
          onClick={() => fileRef.current?.click()}
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

function ShipmentTable({ rows, kind, filter, onSend, onBulkSend, activeSend }: {
  rows: VaultShipmentRow[];
  kind: 'trade' | 'agreement' | 'both';
  /* The Customer =/≠ Consignee switch now lives above the tab row, next to the
     other vault-level controls, so this only reads the value. */
  filter: 'buyer-eq-consignee' | 'buyer-neq-consignee';
  onSend?: (leadId: number, doc: VaultShipmentDoc, party: 'buyer' | 'consignee') => void;
  onBulkSend?: (leadId: number, docs: VaultShipmentDoc[], party: 'buyer' | 'consignee') => void;
  activeSend?: { leadId: number; doc: VaultShipmentDoc; party: 'buyer' | 'consignee' } | null;
}) {
  const [openId, setOpenId] = useState<number | null>(null);
  /* Flipping the switch swaps the whole row set, so a row left expanded from
     the other side would hang open over unrelated shipments. */
  useEffect(() => { setOpenId(null); }, [filter]);
  const buyerNeq = filter === 'buyer-neq-consignee';
  /* `rows` arrives already limited to opportunities that raised a shipment —
     see shippedRows in the vault — so this only splits by the consignee switch. */
  const filtered = rows.filter(r => buyerNeq ? !r.buyer_is_consignee : r.buyer_is_consignee);
  const showAgreement = kind === 'agreement' || kind === 'both';
  const COLS = showAgreement ? 11 : 10;
  return (
    <>
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
              {showAgreement && <th>Agreement</th>}
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
                        <span className="cev-cust-mono" style={{ background: 'linear-gradient(135deg,#059669,#10b981)' }}>{(r.consignee || '—').charAt(0)}</span>
                        {r.consignee || '—'}
                      </span>
                    </td>
                    <td><Ratio r={r.due_dil} /></td>
                    <td><Ratio r={r.kyc} /></td>
                    <td><Ratio r={r.trade_lic} /></td>
                    <td><Ratio r={r.trade_docs} /></td>
                    {showAgreement && <td><Ratio r={r.agreement} /></td>}
                  </tr>
                  {open && (
                    <tr className="cev-ship-expand">
                      <td colSpan={COLS} style={{ padding: 0, background: '#f0fdff' }}>
                        <ShipmentDocPanel
                          buyer={kind === 'both'
                            ? [...(r.trade_docs_buyer ?? []), ...(r.agreements_buyer ?? [])]
                            : kind === 'trade' ? (r.trade_docs_buyer ?? []) : (r.agreements_buyer ?? [])}
                          consignee={kind === 'both'
                            ? [...(r.trade_docs_consignee ?? []), ...(r.agreements_consignee ?? [])]
                            : kind === 'trade' ? (r.trade_docs_consignee ?? []) : (r.agreements_consignee ?? [])}
                          showType={kind === 'both'}
                          buyerIsConsignee={r.buyer_is_consignee}
                          onSend={onSend ? (doc, party) => onSend(r.id, doc, party) : undefined}
                          onBulkSend={onBulkSend ? (docs, party) => onBulkSend(r.id, docs, party) : undefined}
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

export function ShipmentDocPanel({ buyer, consignee, buyerIsConsignee, onSend, onBulkSend, primaryParty = 'buyer', hideBuyerTab = false, pendingSend, showType = false }: {
  /* No party name here: the shipment row this panel expands from already names
     the customer and the consignee, and the tabs below say whose documents are
     on screen, so repeating it was noise. */
  buyer: VaultShipmentDoc[]; consignee: VaultShipmentDoc[]; buyerIsConsignee: boolean;
  onSend?: (doc: VaultShipmentDoc, party: 'buyer' | 'consignee') => void;
  /* Opt-in. Supplying it turns on the select column and the bulk bar; the
     Consignee vault shares this panel and passes nothing, so it is unchanged. */
  onBulkSend?: (docs: VaultShipmentDoc[], party: 'buyer' | 'consignee') => void;

  primaryParty?: 'buyer' | 'consignee';
  hideBuyerTab?: boolean;
  pendingSend?: { doc: VaultShipmentDoc; party: 'buyer' | 'consignee' } | null;
  showType?: boolean;
}) {
  const toast = useToast();
  const [party, setParty] = useState<'buyer' | 'consignee' | 'both'>(primaryParty);
  const [busy, setBusy] = useState<number | null>(null);
  const [trackSig, setTrackSig] = useState<{ id: number; code: string } | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const docKey = (d: VaultShipmentDoc) => (d.db_id != null ? `${d.doc_type ?? ''}#${d.db_id}` : `n#${d.name}#${d.sig_req_id}`);
  const buyerKeys = new Set(buyer.map(docKey));
  const consKeys = new Set(consignee.map(docKey));
  const buyerOnly = buyer.filter(d => !consKeys.has(docKey(d)));
  const consOnly = consignee.filter(d => !buyerKeys.has(docKey(d)));
  const bothDocs = buyer.filter(d => consKeys.has(docKey(d)));
  const activeParty = hideBuyerTab && party === 'buyer' ? 'consignee' : party;
  const docs = buyerIsConsignee
    ? (primaryParty === 'consignee' ? consignee : buyer)
    : activeParty === 'both' ? bothDocs : activeParty === 'buyer' ? buyerOnly : consOnly;

  /* A row can be picked only when a first send is actually possible for it —
     the same gate the per-row Send button uses (db_id + status Draft), so the
     checkbox never offers something the button would refuse. Anything that has
     been sent before is locked: Signed, Pending, Declined, Recalled and Expired
     all mean a signature request already exists for that document. The PI row
     is excluded too — it sends through its own kind='pi' flow, not this one. */
  const bulkOn      = !!onBulkSend;
  const sentAlready = (d: VaultShipmentDoc) => d.status !== 'Draft';
  const selectable  = (d: VaultShipmentDoc) => !!d.db_id && !d.pi_id && !sentAlready(d);
  const lockReason  = (d: VaultShipmentDoc) =>
      d.pi_id            ? 'The Proforma Invoice is sent from its own action'
    : sentAlready(d)     ? `Already sent for signature — currently ${d.status}`
    :                      'This document cannot be sent for signature yet';

  const pickable  = docs.filter(selectable);
  const chosen    = docs.filter(d => picked.includes(docKey(d)) && selectable(d));
  const allPicked = pickable.length > 0 && chosen.length === pickable.length;
  /* Trade documents and agreements travel through different send flows, so one
     batch has to be all of one kind. */
  /* A batch may mix trade documents and agreements. They still travel on
     separate signature requests — the two live in different libraries and the
     backend keeps one request to one kind — so a mixed pick is sent as two
     rounds, back to back, from the one click. */
  const mixedKinds = new Set(chosen.map(d => (d.doc_type === 'agreement' ? 'agreement' : 'trade'))).size > 1;
  const bulkParty = (d: VaultShipmentDoc): 'buyer' | 'consignee' => (buyer.includes(d) ? 'buyer' : 'consignee');
  const toggle    = (d: VaultShipmentDoc) =>
    setPicked(prev => prev.includes(docKey(d)) ? prev.filter(k => k !== docKey(d)) : [...prev, docKey(d)]);

  /* Switching the Customer / Consignee / Both tab swaps the whole list, so a
     carried-over selection would send documents the user can no longer see. */
  useEffect(() => { setPicked([]); }, [activeParty]);

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
      {!buyerIsConsignee && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
          {!hideBuyerTab && (
            <button type="button" onClick={() => setParty('buyer')} style={partyTabStyle(party === 'buyer')}>Customer Documents <b>{buyerOnly.length}</b></button>
          )}
          <button type="button" onClick={() => setParty('consignee')} style={partyTabStyle(activeParty === 'consignee')}>Consignee Documents <b>{consOnly.length}</b></button>
          <button type="button" onClick={() => setParty('both')} style={partyTabStyle(activeParty === 'both')}>Both <b>{bothDocs.length}</b></button>
        </div>
      )}
      {docs.length === 0 ? (
        <div style={{ padding: '18px', textAlign: 'center', color: '#64748b', fontSize: 12, background: '#fff', border: '1px dashed #a5f3fc', borderRadius: 8 }}>No {activeParty === 'both' ? '' : activeParty === 'buyer' ? 'buyer ' : 'consignee '}documents on this shipment.</div>
      ) : (
        <div style={{ background: '#fff', border: '1px solid #d6eef5', borderRadius: 10, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
            <thead>
              <tr style={{ background: 'linear-gradient(90deg,#0e7490,#0891b2)', color: '#fff' }}>
                {bulkOn && (
                  <th style={{ padding: '8px 10px', width: 34, textAlign: 'center' }}>
                    <Tooltip label={pickable.length === 0 ? 'Nothing on this shipment is awaiting a first send' : allPicked ? 'Clear selection' : 'Select every document that has not been sent yet'}>
                      <input
                        type="checkbox"
                        className="cev-sdp-check"
                        aria-label="Select all documents awaiting signature"
                        disabled={pickable.length === 0}
                        checked={allPicked}
                        onChange={(e) => setPicked(e.target.checked ? pickable.map(docKey) : [])}
                      />
                    </Tooltip>
                  </th>
                )}
                {['Sr No', 'Document Name', 'Required', 'Signed On', 'Status', 'Actions'].map((h) => (
                  <th key={h} style={{ padding: '8px 10px', textAlign: h === 'Document Name' ? 'left' : 'center', fontSize: 9, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {docs.map((d, i) => (
                <tr key={d.sig_req_id + '-' + i} style={{ borderBottom: '1px solid #ecfeff' }}>
                  {bulkOn && (
                    <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                      <Tooltip label={selectable(d) ? 'Select for bulk send' : lockReason(d)}>
                        {/* The span keeps the tooltip alive over a disabled input —
                            a disabled control fires no pointer events of its own. */}
                        <span style={{ display: 'inline-flex' }}>
                          <input
                            type="checkbox"
                            className="cev-sdp-check"
                            aria-label={`Select ${d.name}`}
                            disabled={!selectable(d)}
                            checked={picked.includes(docKey(d)) && selectable(d)}
                            onChange={() => toggle(d)}
                          />
                        </span>
                      </Tooltip>
                    </td>
                  )}
                  <td style={{ padding: '8px 10px', textAlign: 'center', color: '#94a3b8', fontWeight: 700 }}>{i + 1}</td>
                  <Tooltip label={d.name} disabled={(d.name || '').length <= 35}>
                    <td style={{ padding: '8px 10px', fontWeight: 700, color: '#0f172a' }}>
                      {(d.name || '').length > 35 ? (d.name || '').slice(0, 35) + '…' : d.name}
                      {showType && (
                        <span style={{ display: 'block', marginTop: 2, fontSize: 9, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: d.doc_type === 'agreement' ? '#b45309' : '#0e7490' }}>
                          {d.doc_type === 'agreement' ? 'Agreement' : 'Trade Document'}
                        </span>
                      )}
                    </td>
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
                    {d.signed_url && (
                      <Tooltip label="View signed document">
                        <button type="button" aria-label="View" onClick={() => window.open(resolveFileUrl(d.signed_url!), '_blank', 'noopener')} style={{ ...docActStyle('#0891b2'), padding: '4px 8px' }}><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg> View</button>
                      </Tooltip>
                    )}
                    {d.status === 'Draft' && onSend && d.db_id && (() => {
                      const isSending = !!pendingSend && pendingSend.doc === d;
                      return (
                        <Tooltip label={isSending ? 'Sending…' : 'Send for signature'}>
                        <button type="button" aria-label="Send" disabled={isSending}
                          onClick={() => onSend(d, buyer.includes(d) ? 'buyer' : 'consignee')}
                          style={{ ...docActPrimary(), padding: '4px 8px', ...(isSending ? { cursor: 'wait' } : null) }}>
                          {isSending
                            ? <i className="ri-loader-4-line cev-spin" style={{ fontSize: 12, display: 'inline-block' }} aria-hidden />
                            : <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>}{isSending ? ' Sending…' : ' Send'}
                        </button>
                        </Tooltip>
                      );
                    })()}
                    {d.pi_id && onSend && d.status !== 'Signed' && !d.sig_req_id && d.status !== 'Declined' && d.status !== 'Recalled' && (() => {
                      const isSending = !!pendingSend && pendingSend.doc === d;
                      return (
                        <Tooltip label={isSending ? 'Sending…' : 'Send the Proforma Invoice for signature'}>
                        <button type="button" aria-label="Send for Signature" disabled={isSending}
                          onClick={() => onSend(d, buyer.includes(d) ? 'buyer' : 'consignee')}
                          style={{ ...docActPrimary(), padding: '4px 8px', ...(isSending ? { cursor: 'wait' } : null) }}>
                          {isSending
                            ? <i className="ri-loader-4-line cev-spin" style={{ fontSize: 12, display: 'inline-block' }} aria-hidden />
                            : <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>}{isSending ? ' Sending…' : ' Send'}
                        </button>
                        </Tooltip>
                      );
                    })()}
                    {(d.status === 'Declined' || d.status === 'Recalled') && onSend && (d.db_id || d.pi_id) && (() => {
                      const isSending = !!pendingSend && pendingSend.doc === d;
                      return (
                        <Tooltip label={isSending ? 'Sending…' : `Re-send for signature (${d.status.toLowerCase()})`}>
                        <button type="button" aria-label="Resend for Signature" disabled={isSending}
                          onClick={() => onSend(d, buyer.includes(d) ? 'buyer' : 'consignee')}
                          style={{ ...docActPrimary(), padding: '4px 8px', ...(isSending ? { cursor: 'wait' } : null) }}>
                          {isSending
                            ? <i className="ri-loader-4-line cev-spin" style={{ fontSize: 12, display: 'inline-block' }} aria-hidden />
                            : <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" /><path d="M21 3v5h-5" /><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" /><path d="M8 16H3v5" /></svg>}{isSending ? ' Sending…' : ' Resend'}
                        </button>
                        </Tooltip>
                      );
                    })()}
                    {d.status === 'Pending' && d.sig_req_id > 0 && <Tooltip label={busy === d.sig_req_id ? 'Sending reminder…' : 'Send reminder to the signer'}><button type="button" aria-label="Send Reminder" disabled={busy === d.sig_req_id} onClick={() => remind(d)} style={{ ...docActStyle('#06b6d4'), padding: '4px 8px' }}>{busy === d.sig_req_id ? '…' : <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></svg>}{busy === d.sig_req_id ? ' Sending…' : ' Remind'}</button></Tooltip>}
                    {(d.signature_request_id ?? (d.sig_req_id > 0 ? d.sig_req_id : null)) && (
                      <Tooltip label="View signing timeline">
                        <button type="button" aria-label="Signing activity tracker"
                          onClick={() => setTrackSig({ id: (d.signature_request_id ?? d.sig_req_id) as number, code: d.pi_code || d.name })}
                          style={{ ...docActStyle('#0891b2'), padding: '4px 8px' }}>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v5h5" /><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8" /><path d="M12 7v5l4 2" /></svg> Track
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
      {/* Bulk action bar — under the table, so the row you tick last is the one
          nearest the button and the table never shifts down as the bar appears. */}
      {bulkOn && chosen.length > 0 && (
        <div className="cev-sdp-bulk">
          <span className="cev-sdp-bulk-count">{chosen.length} of {pickable.length} selected</span>
          <button type="button" className="cev-sdp-bulk-clear" onClick={() => setPicked([])}>Clear</button>
          <Tooltip label={mixedKinds
            ? `Send the ${chosen.length} selected documents for signature — trade documents and agreements go out as two requests, one after the other`
            : `Send the ${chosen.length} selected document${chosen.length > 1 ? 's' : ''} for signature in one go`}>
            <button
              type="button"
              className="cev-sdp-bulk-send"
              onClick={() => { onBulkSend!(chosen, bulkParty(chosen[0])); setPicked([]); }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
              Send {chosen.length} for Signature
            </button>
          </Tooltip>
        </div>
      )}
      {trackSig && (
        <SigningTrackerModal sigId={trackSig.id} code={trackSig.code} onClose={() => setTrackSig(null)} />
      )}
    </div>
  );
}

export function ShipmentDocSendForSignature({ target, onClose, onSent }: {
  /* `doc` is the single/representative document and stays required, so the
     Consignee vault's existing single-send call site is unchanged. `docs`, when
     present, is the whole batch a bulk send picked — both underlying flows take
     a list already (trade docs by id, agreements as rows), so a batch needs no
     new endpoint. */
  target: { leadId: number; doc: VaultShipmentDoc; docs?: VaultShipmentDoc[]; party: 'buyer' | 'consignee' } | null;
  onClose: () => void;
  onSent: () => void;
}) {
  const toast = useToast();
  const [agr, setAgr] = useState<AgreementContext | null>(null);
  const [td,  setTd]  = useState<{ ids: number[]; leadId: number; modelName: 'Customer' | 'Consignee'; customer: SendForSignatureCustomer | null } | null>(null);
  /* A batch that mixes both kinds runs in two rounds: the trade documents go
     first and the agreements wait here until that round finishes. They cannot
     share one request — the two live in different libraries and the server
     keeps one signature request to one kind — so the signer receives two. */
  const [queuedAgr, setQueuedAgr] = useState<AgreementContext | null>(null);
  const sentAny = useRef(false);

  /* Only refresh-and-close once the whole chain is done; calling the parent's
     onSent between rounds would clear `target` and drop the second round. */
  const finish = () => {
    setAgr(null); setTd(null); setQueuedAgr(null);
    if (sentAny.current) onSent(); else onClose();
  };

  useEffect(() => {
    sentAny.current = false;
    if (!target?.doc.db_id) { setAgr(null); setTd(null); setQueuedAgr(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const res  = await api.get(`/clm/leads/${target.leadId}/agreement-applicable`);
        if (cancelled) return;
        const data = res.data?.data;
        const cust = data?.lead?.customer;
        const cons = data?.lead?.consignee;

        /* One document or many — the batch is the unit from here down. */
        const batch = (target.docs?.length ? target.docs : [target.doc]).filter(d => d.db_id);

        const agrBatch = batch.filter(d => d.doc_type === 'agreement');
        const tdBatch  = batch.filter(d => d.doc_type !== 'agreement');

        let agrCtx: AgreementContext | null = null;
        if (agrBatch.length) {
          const found: any[] = [];
          for (const d of agrBatch) {
            let a: any = null;
            for (const seg of (data?.segments ?? [])) {
              const f = (seg.agreements ?? []).find((x: any) => x.id === d.db_id);
              if (f) { a = f; break; }
            }
            if (!a) {
              toast.error('Cannot send', batch.length > 1
                ? `“${d.name}” is no longer applicable to the shipment, so the batch was not sent.`
                : 'This agreement is no longer applicable to the shipment.');
              onClose(); return;
            }
            found.push(a);
          }
          const tokensOf = (a: any) => String(a.party ?? '').toLowerCase().split(',').map((s: string) => s.trim()).filter(Boolean).sort();
          /* One envelope carries ONE signer set. Agreements that name different
             parties would otherwise ask a signer to sign a document that was
             never addressed to them, so a mixed batch is refused rather than
             silently over-sent. */
          const sig = tokensOf(found[0]).join('|');
          const odd = found.find(a => tokensOf(a).join('|') !== sig);
          if (odd) {
            toast.error('Cannot send together', `“${odd.title ?? odd.code}” is addressed to a different party than the others. Send it on its own.`);
            onClose(); return;
          }
          const tokens = tokensOf(found[0]);
          const signers: AgreementSigner[] = [];
          if (tokens.includes('buyer'))     signers.push({ role: 'buyer',     name: cust?.name ?? '⚠ Customer not mapped',  email: cust?.email ?? null });
          if (tokens.includes('consignee')) signers.push({ role: 'consignee', name: cons?.name ?? '⚠ Consignee not mapped', email: cons?.email ?? null });
          agrCtx = {
            leadId: target.leadId,
            agreements: found.map(a => ({
              id: a.id, code: a.code, title: a.title, agreement_type: a.agreement_type,
              party: a.party, content: a.content ?? null,
              header_config: a.header_config ?? null, footer_config: a.footer_config ?? null,
            }) as AgreementSendRow),
            signers,
          };
        }

        if (tdBatch.length) {
          const p = target.party === 'consignee' ? cons : cust;
          if (agrCtx) {
            toast.info('Two steps', `${tdBatch.length} trade document${tdBatch.length > 1 ? 's' : ''} first — the ${agrBatch.length} agreement${agrBatch.length > 1 ? 's' : ''} follow in a second step.`);
          }
          setQueuedAgr(agrCtx);
          setTd({
            ids: tdBatch.map(d => d.db_id!),
            leadId: target.leadId,
            modelName: target.party === 'consignee' ? 'Consignee' : 'Customer',
            customer: p ? { id: String(p.code ?? p.id), db_id: p.id, company: p.name, email: p.email } : null,
          });
        } else if (agrCtx) {
          setAgr(agrCtx);
        }
      } catch {
        if (!cancelled) { toast.error('Cannot send', 'Could not load the document. Please try again.'); onClose(); }
      }
    })();
    return () => { cancelled = true; };
  }, [target]);

  const preparing = !!target && !agr && !td;

  return (
    <>
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
        boxSize={{ width: 240, height: 55 }}
        open={!!agr}
        customer={null}
        mode="agreement"
        agreementContext={agr}
        onClose={() => { setAgr(null); finish(); }}
        onSent={() => { sentAny.current = true; setAgr(null); onSent(); }}
      />
      <SalesCustomerSendForSignatureModal
        boxSize={{ width: 240, height: 55 }}
        open={!!td}
        mode="trade-doc"
        multiBox
        modelName={td?.modelName ?? 'Customer'}
        customer={td?.customer ?? null}
        leadId={td?.leadId ?? null}
        preselectedDocIds={td?.ids}
        onClose={() => { setTd(null); setQueuedAgr(null); finish(); }}
        onSent={() => {
          sentAny.current = true;
          setTd(null);
          /* Hand straight over to the agreement round when one is queued. */
          if (queuedAgr) { setAgr(queuedAgr); setQueuedAgr(null); } else { onSent(); }
        }}
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
  display: 'inline-flex', alignItems: 'center', gap: 5, margin: '0 3px', padding: '4px 10px', borderRadius: 7, border: `1.5px solid ${c}`,
  background: '#fff', color: c, fontFamily: 'inherit', fontSize: 10, fontWeight: 700, cursor: 'pointer',
});

/* Filled counterpart for the send-type actions. Send / Resend are the primary
   thing you do to a row, so they carry the solid cyan pill while the secondary
   actions — View, Reminder, Track — stay pale outlines beside them. */
const docActPrimary = (): CSSProperties => ({
  display: 'inline-flex', alignItems: 'center', gap: 5, margin: '0 3px', padding: '4px 10px', borderRadius: 7,
  border: '1.5px solid transparent', background: 'linear-gradient(135deg, #22d3ee, #0891b2)', color: '#fff',
  fontFamily: 'inherit', fontSize: 10, fontWeight: 700, cursor: 'pointer',
  boxShadow: '0 2px 8px rgba(8,145,178,.30)',
});

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
    case 'trade-documents':  return 'Trade documents & agreements raised against each transaction';
    case 'shipment-agreements': return 'Per-shipment compliance matrix grouped by customer-consignee link';
  }
}
