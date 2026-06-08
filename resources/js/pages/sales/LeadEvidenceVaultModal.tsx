import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import api from '../../api';
import Tooltip from '../../components/ui/Tooltip';
import { useToast } from '../../contexts/ToastContext';
import { signatureRequestsToVaultDocs, type SigReqRow } from '../../utils/vaultSignatureRows';
import type { VaultData, VaultDoc, VaultStatus } from './CustomerEvidenceVaultModal';

/* ────────────────────────────────────────────────────────────────────────────
 * Lead Evidence Vault — Sales Matrix lead-stage popup
 *
 * A dedicated, lead-scoped vault rendered in the exact IDIMS "Evidence
 * Vault" popup design (sky-blue/cyan theme): blue gradient hero, four
 * document tabs (Due Diligence / KYC Documents / Trade License / Trade
 * Documents), per-tab Verified / Expiring / Pending chips, the navy
 * document table, and an Export All / Close Vault footer.
 *
 * Same live data + per-document actions (View / Download / Upload-replace
 * / Certificate) as the standalone Customer / Consignee vaults — only the
 * presentation differs. Used only by SalesMatrixDetail's left CLM panel. */

export interface LeadVaultTarget {
  ownerType: 'customer' | 'consignee';
  id: string;            // display code, e.g. C-001 / CN-001
  db_id?: number;
  company: string;
  risk?: string;         // Low / Medium / High
  type?: string;
  segment?: string;
  country?: string;
  contact?: string;      // contact person
  contactCity?: string;  // city
}

interface Props {
  open: boolean;
  target: LeadVaultTarget | null;
  onClose: () => void;
}

/* Trade Documents are no longer shown here — they now live segment-wise in
 * the Sales Matrix "Segment Details" card (see LeadAgreementSendModal). This
 * per-party vault keeps only the identity/compliance buckets. */
type TabKey = 'company-dd' | 'owner-kyc' | 'trade-licenses';

/* Rows shown per page in the document table. */
const PAGE_SIZE = 5;

const TABS: {
  key: TabKey; label: string; icon: TabIcon;
  sectionTitle: string; sub: string; countKey: keyof VaultData;
}[] = [
  { key: 'company-dd',      label: 'Due Diligence',   icon: 'home',   sectionTitle: 'Company Due Diligence', sub: 'Business registration, tax, compliance & identity documents', countKey: 'company_dd_count' },
  { key: 'owner-kyc',       label: 'KYC Documents',   icon: 'user',   sectionTitle: 'Owner KYC Details',     sub: 'Owner & director identity verification documents',           countKey: 'owner_kyc_count' },
  { key: 'trade-licenses',  label: 'Trade License',   icon: 'shield', sectionTitle: 'Trade Licenses',        sub: 'Export / import licenses & regulatory permits',              countKey: 'trade_license_count' },
];

type TabIcon = 'home' | 'user' | 'shield' | 'file';

function TabSvg({ name }: { name: TabIcon }) {
  if (name === 'home') return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>;
  if (name === 'user') return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>;
  if (name === 'shield') return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/></svg>;
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>;
}

export default function LeadEvidenceVaultModal({ open, target, onClose }: Props) {
  const toast = useToast();
  const [tab, setTab] = useState<TabKey>('company-dd');
  const [vaultLive, setVaultLive] = useState<VaultData | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [signatureRows, setSignatureRows] = useState<SigReqRow[]>([]);
  const [page, setPage] = useState(1);

  const ownerType = target?.ownerType ?? 'customer';
  const modelName = ownerType === 'consignee' ? 'Consignee' : 'Customer';

  /* Escape-to-close. Kept separate from the tab-reset effect below so a
   * changing `onClose` identity (the parent passes a fresh closure on
   * every render) doesn't retrigger a tab reset. */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  /* Reset to the first tab ONLY when the modal opens for a new party —
   * NOT on every re-render. Previously this lived in the Escape effect
   * and depended on `onClose`, so an upload's refetch (which re-rendered
   * the parent → new onClose) yanked the user back to Due Diligence. */
  useEffect(() => {
    if (open) { setTab('company-dd'); setPage(1); }
  }, [open, target?.db_id]);

  /* New tab → back to page 1. */
  useEffect(() => { setPage(1); }, [tab]);

  const reloadVault = useCallback(() => {
    if (!target?.db_id) return Promise.resolve();
    setLoading(true);
    return api.get(`/segment-uploads/${ownerType}/${target.db_id}/vault`)
      .then(r => { setVaultLive((r.data?.data ?? null) as VaultData | null); })
      .catch(() => { /* keep previous state on transient failures */ })
      .finally(() => setLoading(false));
  }, [target?.db_id, ownerType]);

  useEffect(() => {
    if (!open || !target?.db_id) { setVaultLive(null); return; }
    let cancelled = false;
    setLoading(true);
    api.get(`/segment-uploads/${ownerType}/${target.db_id}/vault`)
      .then(r => { if (!cancelled) setVaultLive((r.data?.data ?? null) as VaultData | null); })
      .catch(() => { if (!cancelled) setVaultLive(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, target?.db_id, ownerType]);

  useEffect(() => {
    if (!open || !target?.db_id) { setSignatureRows([]); return; }
    let cancelled = false;
    api.get('/clm/signature-requests', { params: { party_id: target.db_id, model_name: modelName, sync: 1 } })
      .then(r => { if (!cancelled) setSignatureRows(Array.isArray(r.data?.data) ? (r.data.data as SigReqRow[]) : []); })
      .catch(() => { if (!cancelled) setSignatureRows([]); });
    return () => { cancelled = true; };
  }, [open, target?.db_id, modelName]);

  const vault: VaultData | null = useMemo(() => {
    if (!vaultLive) return null;
    const sigRows = signatureRequestsToVaultDocs(signatureRows) as unknown as VaultDoc[];
    return { ...vaultLive, trade_documents: sigRows, trade_documents_count: sigRows.length };
  }, [vaultLive, signatureRows]);

  // Consignee flagged "Same as Customer" — its docs mirror the linked
  // customer and direct uploads are rejected (409). Show a badge + disable
  // the upload action.
  const sameAsCustomer = ownerType === 'consignee' && !!vault?.same_as_customer;

  const docsForTab: VaultDoc[] = useMemo(() => {
    if (!vault) return [];
    return tab === 'owner-kyc'      ? vault.owner_kyc
         : tab === 'trade-licenses' ? vault.trade_licenses
         : vault.company_dd;
  }, [vault, tab]);

  const tabMeta = TABS.find(t => t.key === tab)!;

  const chips = useMemo(() => {
    let verified = 0, expiring = 0, pending = 0;
    for (const d of docsForTab) {
      if (d.status === 'Verified' || d.status === 'Signed') verified++;
      else if (d.status === 'Expiring') expiring++;
      else if (d.status === 'Pending') pending++;
    }
    return { verified, expiring, pending };
  }, [docsForTab]);

  /* Export All → a single ZIP with four folders (Due Diligence / KYC
   * Documents / Trade License / Trade Documents). Every uploaded file in
   * each bucket is fetched and dropped into its folder so the user gets
   * the whole evidence archive in one download. Buckets with no uploads
   * still appear (with a placeholder note) so all four folders are
   * present. Files are fetched same-origin from their attachment_url. */
  const onExportAll = async () => {
    if (!vault || !target) return;
    setExporting(true);
    try {
      const zip = new JSZip();
      const groups: { folder: string; docs: VaultDoc[] }[] = [
        { folder: 'Due Diligence',   docs: vault.company_dd },
        { folder: 'KYC Documents',   docs: vault.owner_kyc },
        { folder: 'Trade License',   docs: vault.trade_licenses },
      ];
      let added = 0, failed = 0;
      for (const g of groups) {
        const dir = zip.folder(g.folder)!;
        let idx = 0;
        for (const d of g.docs) {
          if (!d.attachment_url) continue;
          try {
            const res = await fetch(d.attachment_url);
            if (!res.ok) { failed++; continue; }
            const blob = await res.blob();
            idx++;
            const base = (d.attachment || `${d.name}.pdf`).replace(/[\\/:*?"<>|]+/g, '_');
            dir.file(`${String(idx).padStart(2, '0')}_${base}`, blob);
            added++;
          } catch {
            failed++;   // skip unreachable file, keep going
          }
        }
        if (idx === 0) dir.file('_no-documents.txt', 'No uploaded documents in this bucket yet.');
      }

      if (added === 0) {
        toast.warning('Nothing to export', 'No uploaded files were found across the four document buckets.');
        return;
      }

      const content = await zip.generateAsync({ type: 'blob' });
      const stamp = new Date().toISOString().slice(0, 10);
      const safeId = (target.id || ownerType).replace(/[^A-Za-z0-9_-]/g, '_');
      saveAs(content, `EvidenceVault_${safeId}_${stamp}.zip`);
      toast.success(
        'Exported',
        `${added} file${added === 1 ? '' : 's'} bundled into a ZIP (4 folders)${failed ? ` · ${failed} skipped` : ''}.`,
      );
    } catch (err: any) {
      toast.error('Export failed', err?.message || 'Could not build the ZIP archive.');
    } finally {
      setExporting(false);
    }
  };

  /* Pagination — 5 rows per page. `safePage` clamps in case the row
   * count shrinks (e.g. after a refetch) below the current page. */
  const totalPages = Math.max(1, Math.ceil(docsForTab.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pagedDocs = docsForTab.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const firstRow = docsForTab.length === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1;
  const lastRow = Math.min(safePage * PAGE_SIZE, docsForTab.length);

  if (!open || !target) return null;

  return createPortal(
    <>
      <style>{LEV_CSS}</style>
      <div className="lev-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        <div className="lev-modal" role="dialog" aria-modal="true" aria-label="Evidence Vault">

          {/* ── HERO ── */}
          <div className="lev-hero">
            <div className="lev-hero-row">
              <div className="lev-hero-left">
                <div className="lev-hero-avatar">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
                    <line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
                  </svg>
                </div>
                <div className="lev-hero-text">
                  <div className="lev-hero-eyebrow">EVIDENCE VAULT</div>
                  <h1 className="lev-hero-name">{target.company || target.id}</h1>
                  <div className="lev-hero-meta">
                    <span className="lev-hero-id">{target.id}</span>
                    {sameAsCustomer && (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 11px', borderRadius: 20, fontSize: 11, fontWeight: 800, background: 'rgba(255,255,255,.22)', color: '#fff', border: '1px solid rgba(255,255,255,.4)', whiteSpace: 'nowrap' }}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                        Same as Customer
                      </span>
                    )}
                    {target.risk && <span className="lev-hero-risk">{target.risk}</span>}
                    {target.contact && (<><span className="lev-dot" /><span>{target.contact}</span></>)}
                    {target.contactCity && (<><span className="lev-dot" /><span>{target.contactCity}</span></>)}
                  </div>
                </div>
              </div>
              <button className="lev-hero-close" type="button" onClick={onClose} title="Close" aria-label="Close">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
          </div>

          {/* ── TABS ── */}
          <div className="lev-tabs">
            {TABS.map(t => (
              <button key={t.key} type="button" className={`lev-tab ${tab === t.key ? 'active' : ''}`} onClick={() => setTab(t.key)}>
                <TabSvg name={t.icon} />
                {t.label}
                <span className="lev-tab-count">{(vault?.[t.countKey] as number) ?? 0}</span>
              </button>
            ))}
          </div>

          {/* ── BODY ── */}
          <div className="lev-body">
            {/* Section card */}
            <div className="lev-section-card">
              <div className="lev-section-left">
                <div className="lev-section-icon"><TabSvg name={tabMeta.icon} /></div>
                <div className="lev-section-text">
                  <h3 className="lev-section-title">{tabMeta.sectionTitle}</h3>
                  <div className="lev-section-desc">{tabMeta.sub}</div>
                </div>
              </div>
              <div className="lev-section-count">
                <div className="num">{docsForTab.length}</div>
                <div className="lbl">Documents</div>
              </div>
            </div>

            {/* Chips */}
            <div className="lev-chips">
              <span className="lev-chip verified">✓ Verified <span className="lev-chip-count">{chips.verified}</span></span>
              <span className="lev-chip expiring">⚠ Expiring <span className="lev-chip-count">{chips.expiring}</span></span>
              <span className="lev-chip pending">⏳ Pending <span className="lev-chip-count">{chips.pending}</span></span>
            </div>

            {/* Table */}
            <div className="lev-table-card">
              <table className="lev-doc-table">
                {/* Columns mirror the Edit Customer form's DD/KYC table:
                    Sr No · Auto Code · Document Name · Issuing Authority · Requirement · Actions. */}
                <thead>
                  <tr>
                    <th>Sr No</th>
                    <th>Auto Code</th>
                    <th>Document Name</th>
                    <th>{tab === 'trade-documents' ? 'Counter Party' : 'Issuing Authority'}</th>
                    <th>Requirement</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loading && docsForTab.length === 0 ? (
                    <tr><td colSpan={6} className="lev-empty">Loading documents…</td></tr>
                  ) : docsForTab.length === 0 ? (
                    <tr><td colSpan={6} className="lev-empty">No documents in this bucket yet.</td></tr>
                  ) : pagedDocs.map((d, i) => (
                    /* key on doc_code (unique per bucket) + index — the backend
                       can hand two rows the same numeric `id` (upload id vs.
                       fallback index), which collided as React keys. */
                    <tr key={`${d.doc_code ?? 'doc'}-${i}`}>
                      <td>{(safePage - 1) * PAGE_SIZE + i + 1}</td>
                      <td><span className="lev-doc-license">{d.reference || d.doc_code || '—'}</span></td>
                      <td><span className="lev-doc-name">{d.name}</span></td>
                      <td>{d.authority || '—'}</td>
                      <td>
                        {d.requirement === 'M' ? (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 800, background: '#dcfce7', color: '#15803d', border: '1px solid #bbf7d0', whiteSpace: 'nowrap' }}>★ Mandatory</span>
                        ) : (
                          <span style={{ display: 'inline-flex', alignItems: 'center', padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: '#f1f5f9', color: '#64748b', border: '1px solid #e2e8f0', whiteSpace: 'nowrap' }}>Optional</span>
                        )}
                      </td>
                      <td>
                        <LeadVaultRowActions doc={d} ownerType={ownerType} ownerId={target.db_id ?? null} tab={tab} onReload={reloadVault} sameAsCustomer={sameAsCustomer} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination — 5 rows per page */}
            {docsForTab.length > 0 && (
              <div className="lev-pager">
                <div className="lev-pager-info">Showing {firstRow}–{lastRow} of {docsForTab.length}</div>
                <div className="lev-pager-ctrls">
                  <button type="button" className="lev-pager-btn" disabled={safePage <= 1} onClick={() => setPage(p => Math.max(1, p - 1))} aria-label="Previous page">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><polyline points="15 18 9 12 15 6"/></svg>
                  </button>
                  {Array.from({ length: totalPages }).map((_, idx) => {
                    const n = idx + 1;
                    return (
                      <button key={n} type="button" className={`lev-pager-num ${n === safePage ? 'active' : ''}`} onClick={() => setPage(n)}>
                        {n}
                      </button>
                    );
                  })}
                  <button type="button" className="lev-pager-btn" disabled={safePage >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))} aria-label="Next page">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><polyline points="9 18 15 12 9 6"/></svg>
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* ── FOOTER ── */}
          <div className="lev-footer">
            <div className="lev-footer-info">Last updated: <strong>{vault?.last_updated || '—'}</strong> · Vault managed by <strong>Compliance Team</strong></div>
            <div className="lev-footer-actions">
              <button type="button" className="lev-footer-btn outline" disabled={exporting || !vault} onClick={() => void onExportAll()}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                {exporting ? 'Exporting…' : 'Export All'}
              </button>
              <button type="button" className="lev-footer-btn primary" onClick={onClose}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><polyline points="20 6 9 17 4 12"/></svg>
                Close Vault
              </button>
            </div>
          </div>
        </div>
      </div>
    </>,
    document.body,
  );
}

/* ─── Status badge — outlined pills, exact reference palette. */
function StatusBadge({ s }: { s: VaultStatus }) {
  const cls = s === 'Verified' ? 'verified'
            : s === 'Signed'   ? 'verified'
            : s === 'Expiring' ? 'expiring'
            : 'pending';
  const mark = (s === 'Verified' || s === 'Signed') ? '✓' : s === 'Expiring' ? '⚠' : '⏳';
  return <span className={`lev-doc-status ${cls}`}>{mark} {s}</span>;
}

/* ─── Per-row actions — View / Download / Upload-replace / Certificate. */
function LeadVaultRowActions({ doc, ownerType, ownerId, tab, onReload, sameAsCustomer }: {
  doc: VaultDoc;
  ownerType: 'customer' | 'consignee';
  ownerId: number | null;
  tab: TabKey;
  onReload: () => Promise<void> | void;
  sameAsCustomer?: boolean;
}) {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const category: 'kyc' | 'dd' | 'tl' | 'td' = tab === 'company-dd' ? 'dd' : tab === 'owner-kyc' ? 'kyc' : tab === 'trade-licenses' ? 'tl' : 'td';
  const canViewOrDownload = !!doc.attachment_url;
  const canReupload = !!ownerId && !!doc.doc_code;

  const download = () => {
    if (!doc.attachment_url) return;
    const a = document.createElement('a');
    a.href = doc.attachment_url; a.download = doc.attachment || ''; a.target = '_blank'; a.rel = 'noreferrer';
    document.body.appendChild(a); a.click(); a.remove();
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
      await api.post(`/segment-uploads/${ownerType}/${ownerId}`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      await onReload();
    } catch {
      /* silent — surface via reload */
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="lev-row-actions">
      <input ref={fileRef} type="file" hidden accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx"
             onChange={e => { void onPick(e.target.files?.[0] ?? undefined); e.currentTarget.value = ''; }} />
      <Tooltip label={canViewOrDownload ? `View ${doc.attachment}` : 'No attachment yet'}>
        <a href={canViewOrDownload ? doc.attachment_url! : undefined} target={canViewOrDownload ? '_blank' : undefined} rel="noreferrer"
           aria-disabled={!canViewOrDownload} className={`lev-act lev-act-view ${!canViewOrDownload ? 'is-disabled' : ''}`}
           onClick={e => { if (!canViewOrDownload) e.preventDefault(); }} aria-label="View">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
        </a>
      </Tooltip>
      <Tooltip label={canViewOrDownload ? `Download ${doc.attachment}` : 'No attachment yet'}>
        <button type="button" disabled={!canViewOrDownload} onClick={download}
                className={`lev-act lev-act-download ${!canViewOrDownload ? 'is-disabled' : ''}`} aria-label="Download">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        </button>
      </Tooltip>
      <Tooltip label={sameAsCustomer ? 'Same as Customer — upload on the linked customer' : (canReupload ? (busy ? 'Uploading…' : (doc.attachment ? 'Re-upload (replace file)' : 'Upload')) : 'Save the record first')}>
        <button type="button" disabled={busy || (!canReupload && !sameAsCustomer)}
                onClick={() => {
                  if (sameAsCustomer) {
                    toast.warning('Upload not allowed', 'This consignee is “Same as Customer” — you cannot upload a file here. Upload it on the linked customer instead.');
                    return;
                  }
                  fileRef.current?.click();
                }}
                className={`lev-act lev-act-upload ${(sameAsCustomer || !canReupload || busy) ? 'is-disabled' : ''}`} aria-label={doc.attachment ? 'Re-upload' : 'Upload'}>
          {busy
            ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
            : doc.attachment
              ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
              : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>}
        </button>
      </Tooltip>
      {doc.certificate_url && (
        <Tooltip label="Certificate of Completion">
          <a href={doc.certificate_url} target="_blank" rel="noreferrer" className="lev-act lev-act-cert" aria-label="Certificate of Completion">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="6"/><path d="M15.477 12.89L17 22l-5-3-5 3 1.523-9.11"/></svg>
        </a>
        </Tooltip>
      )}
    </div>
  );
}

/* ─────────────────────────── styles ───────────────────────────
   Values lifted verbatim from the SalesMatrix prototype's popup-mode
   Evidence Vault (#eepOverlay sky-blue/cyan theme) so the React popup is
   pixel-faithful: gradients, font weights, letter-spacing, paddings. */
const LEV_CSS = `
@keyframes lev-pop { from { opacity: 0; transform: translateY(8px) scale(.98); } to { opacity: 1; transform: none; } }

.lev-backdrop {
  position: fixed; inset: 0; z-index: 1100;
  background: rgba(15,23,42,.55); backdrop-filter: blur(3px);
  display: flex; align-items: center; justify-content: center; padding: 28px;
}
.lev-modal {
  width: min(1100px, 100%); max-height: calc(100vh - 56px);
  background: #fff; border-radius: 18px; overflow: hidden;
  display: flex; flex-direction: column;
  box-shadow: 0 24px 64px rgba(15,23,42,.30), 0 60px 120px rgba(2,132,199,.18);
  animation: lev-pop .22s ease-out;
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
}

/* ── Hero ── */
.lev-hero {
  background:
    radial-gradient(circle at 15% 50%, rgba(255,255,255,.15) 0%, transparent 55%),
    linear-gradient(135deg, #0c4a6e 0%, #0369a1 30%, #0284c7 65%, #0ea5e9 100%);
  padding: 24px 30px 24px; position: relative; overflow: hidden; color: #fff;
}
.lev-hero::after {
  content: ''; position: absolute; top: -40%; right: -5%;
  width: 460px; height: 460px;
  background: radial-gradient(circle, rgba(255,255,255,.10) 0%, transparent 70%); pointer-events: none;
}
.lev-hero-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; position: relative; z-index: 1; }
.lev-hero-left { display: flex; align-items: flex-start; gap: 18px; flex: 1 1 auto; min-width: 0; }
.lev-hero-avatar {
  width: 60px; height: 60px; border-radius: 16px; flex-shrink: 0;
  background: rgba(255,255,255,.18); border: 1px solid rgba(255,255,255,.28);
  display: inline-flex; align-items: center; justify-content: center;
  box-shadow: 0 8px 18px rgba(0,0,0,.18), inset 0 1px 0 rgba(255,255,255,.30);
}
.lev-hero-avatar svg { width: 28px; height: 28px; stroke: #fff; display: block; }
.lev-hero-text { flex: 1 1 auto; min-width: 0; }
.lev-hero-eyebrow { font-size: 10.5px; font-weight: 800; color: rgba(255,255,255,.80); letter-spacing: .16em; text-transform: uppercase; margin-bottom: 4px; }
.lev-hero-name { font-size: 24px; font-weight: 800; color: #fff; letter-spacing: -.5px; margin: 0 0 8px; line-height: 1.2; text-shadow: 0 1px 3px rgba(0,0,0,.12); }
.lev-hero-meta { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; font-size: 12.5px; color: rgba(255,255,255,.85); font-weight: 500; }
.lev-hero-id {
  font-family: 'JetBrains Mono', 'SF Mono', Menlo, monospace; font-weight: 700; letter-spacing: .04em;
  background: rgba(255,255,255,.16); border: 1px solid rgba(255,255,255,.24);
  padding: 3px 10px; border-radius: 8px; color: #fff;
}
.lev-hero-risk {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 3px 10px; border-radius: 999px;
  font-size: 10.5px; font-weight: 800; letter-spacing: .05em; text-transform: uppercase;
  background: rgba(245,158,11,.20); color: #FCD34D; border: 1px solid rgba(252,211,77,.40);
}
.lev-dot { width: 4px; height: 4px; border-radius: 50%; background: rgba(255,255,255,.45); flex-shrink: 0; }
.lev-hero-close {
  width: 38px; height: 38px; border-radius: 50%; flex-shrink: 0; cursor: pointer;
  background: rgba(255,255,255,.16); border: 1px solid rgba(255,255,255,.24); color: #fff;
  display: inline-flex; align-items: center; justify-content: center; transition: all .18s ease; position: relative; z-index: 1;
}
.lev-hero-close:hover { background: rgba(255,255,255,.30); transform: rotate(90deg); }
.lev-hero-close svg { width: 18px; height: 18px; }

/* ── Tabs ── */
.lev-tabs { background: #fff; display: flex; align-items: center; gap: 0; padding: 0 30px; border-bottom: 1px solid #ECEEF3; flex-wrap: wrap; }
.lev-tab {
  background: transparent; border: none; border-bottom: 3px solid transparent;
  padding: 16px 22px 14px; font-size: 13.5px; font-weight: 600; color: #64748B;
  cursor: pointer; font-family: inherit; letter-spacing: -.1px;
  display: inline-flex; align-items: center; gap: 8px; margin-bottom: -1px; transition: all .18s ease;
}
.lev-tab svg { width: 16px; height: 16px; stroke: currentColor; }
.lev-tab .lev-tab-count { background: #F1F5F9; color: #64748B; border-radius: 999px; padding: 2px 9px; font-size: 11px; font-weight: 700; font-variant-numeric: tabular-nums; }
.lev-tab:hover:not(.active) { color: #0284c7; background: #F0F9FF; }
.lev-tab.active { color: #0284c7; border-bottom-color: #0284c7; font-weight: 700; }
.lev-tab.active svg { color: #0284c7; }
.lev-tab.active .lev-tab-count { background: #e0f2fe; color: #0c4a6e; }

/* ── Body ── */
.lev-body { flex: 1; overflow-y: auto; padding: 22px 30px; background: linear-gradient(180deg, #FAFBFF 0%, #F1F5F9 100%); }
.lev-section-card {
  background: linear-gradient(135deg, #FAFBFF 0%, #F5F3FF 100%);
  border: 1px solid #E9D5FF; border-radius: 14px; padding: 18px 22px; margin-bottom: 18px;
  display: flex; align-items: center; justify-content: space-between; gap: 16px;
  box-shadow: 0 1px 3px rgba(15,23,42,.04);
}
.lev-section-left { display: flex; align-items: center; gap: 14px; flex: 1 1 auto; min-width: 0; }
.lev-section-icon {
  width: 48px; height: 48px; border-radius: 12px; flex-shrink: 0;
  background: linear-gradient(135deg, #0284c7 0%, #0ea5e9 100%); color: #fff;
  display: inline-flex; align-items: center; justify-content: center;
  box-shadow: 0 6px 14px rgba(2,132,199,.34), inset 0 1px 0 rgba(255,255,255,.20);
}
.lev-section-icon svg { width: 22px; height: 22px; stroke: currentColor; }
.lev-section-text { flex: 1 1 auto; min-width: 0; }
.lev-section-title { font-size: 15.5px; font-weight: 800; color: #1F2937; letter-spacing: -.2px; margin: 0; }
.lev-section-desc { font-size: 12px; color: #6B7280; font-weight: 500; margin-top: 3px; }
.lev-section-count { text-align: right; flex-shrink: 0; }
.lev-section-count .num { font-size: 28px; font-weight: 800; color: #7C3AED; line-height: 1; letter-spacing: -.5px; }
.lev-section-count .lbl { font-size: 9.5px; font-weight: 800; color: #94A3B8; letter-spacing: .12em; text-transform: uppercase; margin-top: 2px; }

/* ── Chips ── */
.lev-chips { display: flex; gap: 10px; margin-bottom: 14px; flex-wrap: wrap; }
.lev-chip { display: inline-flex; align-items: center; gap: 8px; padding: 8px 14px; border-radius: 999px; font-size: 12px; font-weight: 700; border: 1px solid transparent; font-family: inherit; }
.lev-chip-count { font-weight: 800; font-variant-numeric: tabular-nums; font-size: 12.5px; }
.lev-chip.verified { background: #ECFDF5; color: #047857; border-color: #A7F3D0; }
.lev-chip.expiring { background: #FEF3C7; color: #B45309; border-color: #FDE68A; }
.lev-chip.pending  { background: #FEF2F2; color: #B91C1C; border-color: #FECACA; }

/* ── Table ── */
.lev-table-card { background: #fff; border: 1px solid #ECEEF3; border-radius: 14px; overflow: hidden; overflow-x: auto; box-shadow: 0 1px 3px rgba(15,23,42,.04), 0 8px 18px rgba(15,23,42,.05); }
.lev-doc-table { width: 100%; border-collapse: separate; border-spacing: 0; min-width: 1000px; }
.lev-doc-table thead tr { background: linear-gradient(135deg, #0c4a6e 0%, #1e3a8a 100%); }
.lev-doc-table th { background: transparent; color: #fff; padding: 14px 18px; font-size: 10.5px; font-weight: 800; letter-spacing: .10em; text-transform: uppercase; text-align: left; white-space: nowrap; }
.lev-doc-table td { padding: 14px 18px; border-bottom: 1px solid #F1F5F9; font-size: 13px; color: #1E293B; vertical-align: middle; white-space: nowrap; }
.lev-doc-table tbody tr:last-child td { border-bottom: none; }
.lev-doc-table tbody tr { transition: background .15s ease; }
.lev-doc-table tbody tr:hover td { background: #FAFBFF; }
.lev-empty { text-align: center; padding: 30px 14px; color: #94A3B8; font-style: italic; }
.lev-doc-name { font-weight: 700; color: #0F172A; }
.lev-doc-license { font-family: 'JetBrains Mono', 'SF Mono', Menlo, monospace; color: #0369a1; font-weight: 700; font-size: 12.5px; }
.lev-doc-att { display: inline-flex; align-items: center; gap: 6px; padding: 5px 12px; border-radius: 8px; background: #ECFDF5; color: #047857; border: 1px solid #A7F3D0; font-size: 11.5px; font-weight: 700; cursor: pointer; text-decoration: none; transition: all .15s ease; }
.lev-doc-att:hover { background: #D1FAE5; }
.lev-doc-att svg { width: 12px; height: 12px; stroke: currentColor; }
.lev-doc-status { display: inline-flex; align-items: center; gap: 5px; padding: 4px 11px; border-radius: 999px; font-size: 10.5px; font-weight: 800; letter-spacing: .04em; border: 1px solid; white-space: nowrap; }
.lev-doc-status.verified { background: #ECFDF5; color: #047857; border-color: #A7F3D0; }
.lev-doc-status.expiring { background: #FEF3C7; color: #B45309; border-color: #FDE68A; }
.lev-doc-status.pending  { background: #FEF2F2; color: #B91C1C; border-color: #FECACA; }
.lev-doc-dash { color: #CBD5E1; font-weight: 700; }

/* Row actions */
.lev-row-actions { display: flex; gap: 6px; align-items: center; }
.lev-act { width: 28px; height: 28px; border-radius: 7px; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; border: 1px solid transparent; text-decoration: none; transition: all .12s; }
.lev-act svg { width: 13px; height: 13px; }
.lev-act-view { background: #e0f2fe; color: #0369a1; border-color: #bae6fd; }
.lev-act-view:hover { background: #bae6fd; }
.lev-act-download { background: #ecfeff; color: #0e7490; border-color: #a5f3fc; }
.lev-act-download:hover { background: #cffafe; }
.lev-act-upload { background: #f0fdf4; color: #15803d; border-color: #bbf7d0; }
.lev-act-upload:hover { background: #dcfce7; }
.lev-act-cert { background: #cffafe; color: #0e7490; border-color: #67e8f9; }
.lev-act.is-disabled { opacity: .4; cursor: not-allowed; pointer-events: none; }

/* ── Pagination ── */
.lev-pager { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-top: 14px; }
.lev-pager-info { font-size: 12px; font-weight: 600; color: #64748B; }
.lev-pager-ctrls { display: inline-flex; align-items: center; gap: 6px; }
.lev-pager-btn, .lev-pager-num {
  min-width: 30px; height: 30px; padding: 0 8px; border-radius: 8px; cursor: pointer;
  background: #fff; border: 1px solid #E2E8F0; color: #475569;
  font-family: inherit; font-size: 12.5px; font-weight: 700;
  display: inline-flex; align-items: center; justify-content: center; transition: all .14s ease;
}
.lev-pager-btn svg { width: 14px; height: 14px; }
.lev-pager-btn:hover:not(:disabled), .lev-pager-num:hover:not(.active) { background: #F0F9FF; border-color: #bae6fd; color: #0284c7; }
.lev-pager-btn:disabled { opacity: .45; cursor: not-allowed; }
.lev-pager-num.active { background: linear-gradient(135deg, #0284c7 0%, #0ea5e9 100%); border-color: #0284c7; color: #fff; box-shadow: 0 3px 8px rgba(2,132,199,.30); }

/* ── Footer ── */
.lev-footer { background: #fff; border-top: 1px solid #ECEEF3; padding: 14px 30px; display: flex; align-items: center; justify-content: space-between; gap: 14px; flex-wrap: wrap; }
.lev-footer-info { font-size: 12.5px; color: #64748B; font-weight: 500; }
.lev-footer-info strong { color: #1E293B; font-weight: 700; }
.lev-footer-actions { display: flex; gap: 10px; }
.lev-footer-btn { height: 38px; padding: 0 18px; border-radius: 10px; font-size: 12.5px; font-weight: 700; cursor: pointer; display: inline-flex; align-items: center; gap: 7px; font-family: inherit; border: 1.5px solid transparent; transition: all .22s cubic-bezier(.22,1,.36,1); }
.lev-footer-btn svg { width: 14px; height: 14px; stroke: currentColor; }
.lev-footer-btn.outline { background: #fff; border-color: #E2E8F0; color: #475569; }
.lev-footer-btn.outline:hover:not(:disabled) { background: #F0F9FF; border-color: #bae6fd; color: #0284c7; transform: translateY(-1px); }
.lev-footer-btn.outline:disabled { opacity: .55; cursor: not-allowed; }
.lev-footer-btn.primary { background: linear-gradient(135deg, #0284c7 0%, #0ea5e9 100%); border: none; color: #fff; box-shadow: 0 6px 14px rgba(2,132,199,.32), inset 0 1px 0 rgba(255,255,255,.20); }
.lev-footer-btn.primary:hover { transform: translateY(-1px); box-shadow: 0 10px 20px rgba(2,132,199,.40), inset 0 1px 0 rgba(255,255,255,.25); }

/* ── Dark mode — keep the hero/table chrome, tint the surfaces ── */
[data-bs-theme="dark"] .lev-modal { background: #0f172a; }
[data-bs-theme="dark"] .lev-tabs { background: #0f172a; border-bottom-color: rgba(148,163,184,.18); }
[data-bs-theme="dark"] .lev-tab { color: #94a3b8; }
[data-bs-theme="dark"] .lev-tab .lev-tab-count { background: rgba(148,163,184,.18); color: #cbd5e1; }
[data-bs-theme="dark"] .lev-tab.active { color: #38bdf8; border-bottom-color: #38bdf8; }
[data-bs-theme="dark"] .lev-tab.active .lev-tab-count { background: rgba(56,189,248,.20); color: #e0f2fe; }
[data-bs-theme="dark"] .lev-body { background: #0b1220; }
[data-bs-theme="dark"] .lev-section-card { background: rgba(124,58,237,.10); border-color: rgba(167,139,250,.30); }
[data-bs-theme="dark"] .lev-section-title { color: #f1f5f9; }
[data-bs-theme="dark"] .lev-section-desc { color: #94a3b8; }
[data-bs-theme="dark"] .lev-section-count .num { color: #c4b5fd; }
[data-bs-theme="dark"] .lev-table-card { background: #0f172a; border-color: rgba(148,163,184,.18); }
[data-bs-theme="dark"] .lev-doc-table td { color: #e2e8f0; border-bottom-color: rgba(148,163,184,.14); }
[data-bs-theme="dark"] .lev-doc-table tbody tr:hover td { background: rgba(56,189,248,.08); }
[data-bs-theme="dark"] .lev-doc-name { color: #f8fafc; }
[data-bs-theme="dark"] .lev-doc-license { color: #7dd3fc; }
[data-bs-theme="dark"] .lev-footer { background: #0f172a; border-top-color: rgba(148,163,184,.18); }
[data-bs-theme="dark"] .lev-footer-info { color: #94a3b8; }
[data-bs-theme="dark"] .lev-footer-info strong { color: #e2e8f0; }
[data-bs-theme="dark"] .lev-footer-btn.outline { background: #1e293b; border-color: rgba(148,163,184,.30); color: #cbd5e1; }
[data-bs-theme="dark"] .lev-pager-info { color: #94a3b8; }
[data-bs-theme="dark"] .lev-pager-btn, [data-bs-theme="dark"] .lev-pager-num { background: #1e293b; border-color: rgba(148,163,184,.30); color: #cbd5e1; }
[data-bs-theme="dark"] .lev-pager-num.active { background: linear-gradient(135deg, #0284c7 0%, #0ea5e9 100%); border-color: #0284c7; color: #fff; }

@media (max-width: 760px) {
  .lev-backdrop { padding: 10px; }
  .lev-hero { padding: 18px 16px; }
  .lev-tabs, .lev-body, .lev-footer { padding-left: 16px; padding-right: 16px; }
  .lev-footer { flex-direction: column; align-items: stretch; }
  .lev-footer-actions { justify-content: flex-end; }
}
`;
