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
 * A dedicated, lead-scoped vault. Styled to match the Agreement / Trade
 * Document popup's violet theme: a compact violet gradient hero, three
 * document tabs (Due Diligence / KYC Documents / Trade License), the violet
 * document table, and an Export All / Close Vault footer. (The per-tab
 * summary card and Verified/Expiring/Pending chips were removed by design.)
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
  /* Every consignee under the lead's customer. When this has more than one
   * entry (and the target is a consignee), the modal renders a consignee-wise
   * tab strip so the user can switch which consignee's vault is shown. When
   * null / single, only `target` is shown. */
  consignees?: LeadVaultTarget[] | null;
  /* db_id of the consignee actually mapped to the lead / quotation. Its tab
   * in the strip gets a "Mapped" badge so the user can tell it apart from the
   * customer's other consignees. */
  mappedConsigneeId?: number | null;
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

export default function LeadEvidenceVaultModal({ open, target, onClose, consignees, mappedConsigneeId }: Props) {
  const toast = useToast();
  const [tab, setTab] = useState<TabKey>('company-dd');
  const [vaultLive, setVaultLive] = useState<VaultData | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [signatureRows, setSignatureRows] = useState<SigReqRow[]>([]);
  const [page, setPage] = useState(1);
  /* Which consignee tab is active (its db_id). Only meaningful when the
   * consignee strip is shown; defaults to the lead's mapped consignee. */
  const [activeConsId, setActiveConsId] = useState<number | null>(null);

  /* Consignee-wise tab strip — only when the target is a consignee AND the
   * customer has more than one. */
  const consigneeTabs = useMemo(
    () => (target?.ownerType === 'consignee' && consignees && consignees.length > 1 ? consignees : null),
    [target?.ownerType, consignees],
  );

  /* The party actually being shown. With a consignee strip it's the active
   * tab; otherwise it's the passed `target`. Everything below (fetches,
   * hero, table, export) keys off `view`, not `target`. */
  const view: LeadVaultTarget | null = useMemo(() => {
    if (!consigneeTabs) return target;
    return consigneeTabs.find(c => c.db_id === activeConsId) ?? consigneeTabs[0];
  }, [consigneeTabs, activeConsId, target]);

  const ownerType = view?.ownerType ?? 'customer';
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

  /* Scroll lock — lock BOTH <html> and <body> so the page behind can't
   * scroll while the vault is open (body-only isn't enough). */
  useEffect(() => {
    if (!open) return;
    const b = document.body.style.overflow;
    const h = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    return () => { document.body.style.overflow = b; document.documentElement.style.overflow = h; };
  }, [open]);

  /* When the modal opens, default the active consignee tab to the lead's
   * mapped consignee (the `target`). */
  useEffect(() => {
    if (open) setActiveConsId(target?.db_id ?? null);
  }, [open, target?.db_id]);

  /* Reset to the first tab ONLY when the shown party changes (open for a
   * new party, OR the user switches consignee tab) — NOT on every
   * re-render. Previously this lived in the Escape effect and depended on
   * `onClose`, so an upload's refetch (which re-rendered the parent → new
   * onClose) yanked the user back to Due Diligence. */
  useEffect(() => {
    if (open) { setTab('company-dd'); setPage(1); }
  }, [open, view?.db_id]);

  /* New tab → back to page 1. */
  useEffect(() => { setPage(1); }, [tab]);

  const reloadVault = useCallback(() => {
    if (!view?.db_id) return Promise.resolve();
    setLoading(true);
    return api.get(`/segment-uploads/${ownerType}/${view.db_id}/vault`)
      .then(r => { setVaultLive((r.data?.data ?? null) as VaultData | null); })
      .catch(() => { /* keep previous state on transient failures */ })
      .finally(() => setLoading(false));
  }, [view?.db_id, ownerType]);

  useEffect(() => {
    if (!open || !view?.db_id) { setVaultLive(null); return; }
    let cancelled = false;
    setLoading(true);
    api.get(`/segment-uploads/${ownerType}/${view.db_id}/vault`)
      .then(r => { if (!cancelled) setVaultLive((r.data?.data ?? null) as VaultData | null); })
      .catch(() => { if (!cancelled) setVaultLive(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, view?.db_id, ownerType]);

  useEffect(() => {
    if (!open || !view?.db_id) { setSignatureRows([]); return; }
    let cancelled = false;
    api.get('/clm/signature-requests', { params: { party_id: view.db_id, model_name: modelName, sync: 1 } })
      .then(r => { if (!cancelled) setSignatureRows(Array.isArray(r.data?.data) ? (r.data.data as SigReqRow[]) : []); })
      .catch(() => { if (!cancelled) setSignatureRows([]); });
    return () => { cancelled = true; };
  }, [open, view?.db_id, modelName]);

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


  /* Export All → a single ZIP with four folders (Due Diligence / KYC
   * Documents / Trade License / Trade Documents). Every uploaded file in
   * each bucket is fetched and dropped into its folder so the user gets
   * the whole evidence archive in one download. Buckets with no uploads
   * still appear (with a placeholder note) so all four folders are
   * present. Files are fetched same-origin from their attachment_url. */
  const onExportAll = async () => {
    if (!vault || !view) return;
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
      const safeId = (view.id || ownerType).replace(/[^A-Za-z0-9_-]/g, '_');
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

  if (!open || !view) return null;

  return createPortal(
    <>
      <style>{LEV_CSS}</style>
      {/* Backdrop click does NOT close the vault — closing is only via the
          × button, the footer's Close Vault, or Escape. Prevents losing the
          view on an accidental outside click. */}
      <div className="lev-backdrop">
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
                  <h1 className="lev-hero-name">{view.company || view.id}</h1>
                </div>
              </div>
              <div className="lev-hero-right">
                {/* Identity chips moved to the right, beside the close button,
                    so the left side is just the title — keeps the hero short. */}
                <div className="lev-hero-meta">
                  <span className="lev-hero-id">{view.id}</span>
                  {sameAsCustomer && (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 11px', borderRadius: 20, fontSize: 11, fontWeight: 800, background: 'rgba(255,255,255,.22)', color: '#fff', border: '1px solid rgba(255,255,255,.42)', whiteSpace: 'nowrap' }}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                      Same as Customer
                    </span>
                  )}
                  {view.risk && <span className="lev-hero-risk">{view.risk}</span>}
                  {view.contact && (<><span className="lev-dot" /><span>{view.contact}</span></>)}
                  {view.contactCity && (<><span className="lev-dot" /><span>{view.contactCity}</span></>)}
                </div>
                <button className="lev-hero-close" type="button" onClick={onClose} title="Close" aria-label="Close">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </div>
            </div>
          </div>

          {/* ── CONSIGNEE STRIP ──
              Only when the lead's customer has more than one consignee.
              Switching a tab swaps `view`, which re-fetches that
              consignee's vault + signatures. */}
          {consigneeTabs && (
            <div className="lev-cons-strip" role="tablist" aria-label="Consignees">
              <span className="lev-cons-strip-lbl">Consignees</span>
              <div className="lev-cons-strip-tabs">
                {consigneeTabs.map(c => {
                  const isMapped = mappedConsigneeId != null && c.db_id === mappedConsigneeId;
                  return (
                    <button
                      key={c.db_id ?? c.id}
                      type="button"
                      role="tab"
                      aria-selected={view.db_id === c.db_id}
                      className={`lev-cons-tab ${view.db_id === c.db_id ? 'active' : ''} ${isMapped ? 'mapped' : ''}`}
                      onClick={() => setActiveConsId(c.db_id ?? null)}
                      title={isMapped ? `${c.company || c.id} — mapped to this quotation` : (c.company || c.id)}
                    >
                      <span className="lev-cons-code">{c.id}</span>
                      <span className="lev-cons-name">{c.company || '—'}</span>
                      {isMapped && (
                        <span className="lev-cons-mapped" aria-label="Mapped to this quotation">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                          Mapped
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

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
            {/* Section summary card + Verified/Expiring/Pending chips removed
                per design — the table goes straight under the tabs. */}

            {/* Table */}
            <div className="lev-table-card">
              <div className="lev-table-scroll">
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
                          <span className="lev-req lev-req-m">★ Mandatory</span>
                        ) : (
                          <span className="lev-req lev-req-o">Optional</span>
                        )}
                      </td>
                      <td>
                        <LeadVaultRowActions doc={d} ownerType={ownerType} ownerId={view.db_id ?? null} tab={tab} onReload={reloadVault} sameAsCustomer={sameAsCustomer} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>

              {/* Pagination — 5 rows per page, rendered as the table card's
                  own footer bar (sits flush under the rows, not floating on
                  the body background). */}
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
          </div>

          {/* ── FOOTER ── */}
          <div className="lev-footer">
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
   Violet theme matching the Agreement / Trade Document popup
   (LeadAgreementSendModal): violet gradient hero, violet active tabs,
   violet table header, violet primary buttons. Status chips (Verified /
   Expiring / Pending) keep their semantic green / amber / red. */
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
  box-shadow: 0 24px 64px rgba(15,23,42,.30), 0 60px 120px rgba(124,58,237,.18);
  animation: lev-pop .22s ease-out;
  font-family: var(--font-sans);
}

/* ── Hero — violet gradient + white text, in the Price Shared family but
   kept saturated on the right (instead of fading to near-white lavender)
   so the identity chips sitting there read crisply in white. */
.lev-hero {
  background: linear-gradient(115deg, #6d28d9 0%, #7c3aed 55%, #8b5cf6 100%);
  padding: 11px 18px; position: relative; overflow: hidden; color: #fff;
}
.lev-hero-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; position: relative; z-index: 1; }
.lev-hero-left { display: flex; align-items: center; gap: 12px; flex: 1 1 auto; min-width: 0; }
.lev-hero-avatar {
  width: 40px; height: 40px; border-radius: 11px; flex-shrink: 0;
  background: rgba(255,255,255,.18); border: 1px solid rgba(255,255,255,.28);
  display: inline-flex; align-items: center; justify-content: center;
  box-shadow: 0 4px 12px rgba(124,58,237,.20), inset 0 1px 0 rgba(255,255,255,.30);
}
.lev-hero-avatar svg { width: 20px; height: 20px; stroke: #fff; display: block; }
.lev-hero-text { flex: 1 1 auto; min-width: 0; }
.lev-hero-eyebrow { font-size: 9.5px; font-weight: 800; color: rgba(255,255,255,.85); letter-spacing: .16em; text-transform: uppercase; margin-bottom: 1px; }
.lev-hero-name { font-size: 16px; font-weight: 800; color: #fff; letter-spacing: -.3px; margin: 0; line-height: 1.15; text-shadow: 0 1px 3px rgba(0,0,0,.12); }
/* Right cluster — identity chips + close button beside each other, in white
   so they read on the saturated violet. */
.lev-hero-right { display: flex; align-items: center; gap: 14px; flex-shrink: 0; position: relative; z-index: 1; }
.lev-hero-meta { display: flex; align-items: center; justify-content: flex-end; gap: 9px; flex-wrap: wrap; font-size: 11.5px; color: rgba(255,255,255,.90); font-weight: 600; }
.lev-hero-id {
  font-family: 'JetBrains Mono', 'SF Mono', Menlo, monospace; font-weight: 700; letter-spacing: .04em; font-size: 11px;
  background: rgba(255,255,255,.20); border: 1px solid rgba(255,255,255,.38);
  padding: 2px 9px; border-radius: 7px; color: #fff;
}
.lev-hero-risk {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 3px 10px; border-radius: 999px;
  font-size: 10.5px; font-weight: 800; letter-spacing: .05em; text-transform: uppercase;
  background: rgba(245,158,11,.28); color: #fde68a; border: 1px solid rgba(252,211,77,.55);
}
.lev-dot { width: 4px; height: 4px; border-radius: 50%; background: rgba(255,255,255,.55); flex-shrink: 0; }
.lev-hero-close {
  width: 32px; height: 32px; border-radius: 50%; flex-shrink: 0; cursor: pointer;
  background: rgba(255,255,255,.20); border: 1px solid rgba(255,255,255,.40); color: #fff;
  display: inline-flex; align-items: center; justify-content: center; transition: all .18s ease; position: relative; z-index: 1;
}
.lev-hero-close:hover { background: rgba(255,255,255,.32); transform: rotate(90deg); }
.lev-hero-close svg { width: 16px; height: 16px; }

/* ── Consignee strip ── */
.lev-cons-strip {
  display: flex; align-items: center; gap: 12px;
  padding: 10px 18px; background: #F5F3FF; border-bottom: 1px solid #E9D5FF;
}
.lev-cons-strip-lbl {
  font-size: 9.5px; font-weight: 800; letter-spacing: .14em; text-transform: uppercase;
  color: #7c3aed; flex-shrink: 0;
}
.lev-cons-strip-tabs { display: flex; align-items: center; gap: 8px; overflow-x: auto; flex: 1 1 auto; padding-bottom: 2px; }
.lev-cons-tab {
  display: inline-flex; align-items: center; gap: 8px; flex-shrink: 0;
  padding: 6px 14px; border-radius: 999px; cursor: pointer; font-family: inherit;
  background: #fff; border: 1.5px solid #DDD6FE; color: #5b21b6; transition: all .15s ease;
  max-width: 260px;
}
.lev-cons-tab:hover:not(.active) { border-color: #a78bfa; background: #faf5ff; }
.lev-cons-tab.active {
  background: linear-gradient(135deg, #6d28d9 0%, #7c3aed 100%); border-color: #6d28d9; color: #fff;
  box-shadow: 0 3px 8px rgba(124,58,237,.30);
}
.lev-cons-code {
  font-family: 'JetBrains Mono', 'SF Mono', Menlo, monospace; font-weight: 800; font-size: 11px;
  letter-spacing: .02em; flex-shrink: 0;
}
.lev-cons-name { font-size: 12px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
/* "Mapped" badge — marks the consignee tied to the lead/quotation. Green so
   it reads on both the white inactive tab and the violet active tab. */
.lev-cons-mapped {
  display: inline-flex; align-items: center; gap: 3px; flex-shrink: 0;
  padding: 2px 7px; border-radius: 999px;
  font-size: 9.5px; font-weight: 800; letter-spacing: .04em; text-transform: uppercase;
  background: #10b981; color: #fff; border: 1px solid rgba(255,255,255,.4);
}
.lev-cons-mapped svg { width: 9px; height: 9px; }
/* Inactive-but-mapped tab gets an emerald ring so it stands out even when
   another consignee tab is the one being viewed. */
.lev-cons-tab.mapped:not(.active) { border-color: #10b981; box-shadow: 0 0 0 1px rgba(16,185,129,.35); }
[data-bs-theme="dark"] .lev-cons-strip { background: rgba(124,58,237,.10); border-bottom-color: rgba(167,139,250,.30); }
[data-bs-theme="dark"] .lev-cons-tab.mapped:not(.active) { border-color: #34d399; box-shadow: 0 0 0 1px rgba(52,211,153,.40); }
[data-bs-theme="dark"] .lev-cons-strip-lbl { color: #c4b5fd; }
[data-bs-theme="dark"] .lev-cons-tab { background: #1e293b; border-color: rgba(167,139,250,.30); color: #c4b5fd; }
[data-bs-theme="dark"] .lev-cons-tab:hover:not(.active) { border-color: rgba(167,139,250,.55); background: rgba(124,58,237,.18); }
[data-bs-theme="dark"] .lev-cons-tab.active { background: linear-gradient(135deg, #6d28d9 0%, #7c3aed 100%); border-color: #6d28d9; color: #fff; }

/* ── Tabs — filled violet "pill" style, matching the Product Sourcing
   popup (.psm-tab): white outlined pill that fills with a violet gradient
   when active. */
.lev-tabs { background: #fff; display: flex; align-items: center; gap: 10px; padding: 14px 18px; border-bottom: 1px solid #f1f5f9; flex-wrap: wrap; }
.lev-tab {
  display: inline-flex; align-items: center; gap: 7px;
  padding: 6px 14px; border: 1.5px solid #ddd6fe; border-radius: 9px;
  background: #fff; color: #6d28d9;
  font-size: 12px; font-weight: 700; letter-spacing: .01em;
  cursor: pointer; font-family: inherit; transition: all .15s;
}
.lev-tab svg { width: 15px; height: 15px; stroke: currentColor; flex-shrink: 0; }
.lev-tab .lev-tab-count {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 22px; padding: 1px 8px; border-radius: 999px;
  background: #ede9fe; color: #6d28d9;
  font-size: 10.5px; font-weight: 800; font-variant-numeric: tabular-nums;
}
.lev-tab:hover:not(.active) { background: #faf5ff; }
.lev-tab.active {
  background: linear-gradient(135deg, #7c3aed, #6d28d9);
  border-color: transparent; color: #fff;
  box-shadow: 0 4px 12px rgba(124,58,237,.35);
}
.lev-tab.active svg { color: #fff; }
.lev-tab.active .lev-tab-count { background: rgba(255,255,255,.25); color: #fff; }

/* ── Body ── */
.lev-body { flex: 1; overflow-y: auto; padding: 12px 18px; background: linear-gradient(180deg, #FAFBFF 0%, #F1F5F9 100%); }
.lev-section-card {
  background: linear-gradient(135deg, #FAFBFF 0%, #F5F3FF 100%);
  border: 1px solid #E9D5FF; border-radius: 14px; padding: 18px 22px; margin-bottom: 18px;
  display: flex; align-items: center; justify-content: space-between; gap: 16px;
  box-shadow: 0 1px 3px rgba(15,23,42,.04);
}
.lev-section-left { display: flex; align-items: center; gap: 14px; flex: 1 1 auto; min-width: 0; }
.lev-section-icon {
  width: 48px; height: 48px; border-radius: 12px; flex-shrink: 0;
  background: linear-gradient(135deg, #6d28d9 0%, #7c3aed 100%); color: #fff;
  display: inline-flex; align-items: center; justify-content: center;
  box-shadow: 0 6px 14px rgba(124,58,237,.34), inset 0 1px 0 rgba(255,255,255,.20);
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
.lev-table-card { background: #fff; border: 1px solid #ECEEF3; border-radius: 14px; overflow: hidden; box-shadow: 0 1px 3px rgba(15,23,42,.04), 0 8px 18px rgba(15,23,42,.05); }
.lev-table-scroll { overflow-x: auto; }
.lev-doc-table { width: 100%; border-collapse: separate; border-spacing: 0; min-width: 1000px; }
.lev-doc-table thead tr { background: linear-gradient(135deg, #4c1d95 0%, #6d28d9 100%); }
.lev-doc-table th { background: transparent; color: #fff; padding: 9px 14px; font-size: 10.5px; font-weight: 800; letter-spacing: .10em; text-transform: uppercase; text-align: left; white-space: nowrap; }
.lev-doc-table td { padding: 9px 14px; border-bottom: 1px solid #F1F5F9; font-size: 13px; color: #1E293B; vertical-align: middle; white-space: nowrap; }
.lev-doc-table tbody tr:last-child td { border-bottom: none; }
.lev-doc-table tbody tr { transition: background .15s ease; }
.lev-doc-table tbody tr:hover td { background: #FAFBFF; }
.lev-empty { text-align: center; padding: 30px 14px; color: #94A3B8; font-style: italic; }
.lev-doc-name { font-weight: 700; color: #0F172A; }
.lev-doc-license { font-family: 'JetBrains Mono', 'SF Mono', Menlo, monospace; color: #5b21b6; font-weight: 700; font-size: 12.5px; }
.lev-doc-att { display: inline-flex; align-items: center; gap: 6px; padding: 5px 12px; border-radius: 8px; background: #ECFDF5; color: #047857; border: 1px solid #A7F3D0; font-size: 11.5px; font-weight: 700; cursor: pointer; text-decoration: none; transition: all .15s ease; }
.lev-doc-att:hover { background: #D1FAE5; }
.lev-doc-att svg { width: 12px; height: 12px; stroke: currentColor; }
/* Requirement badge (Mandatory / Optional) — class-based so dark mode can
   re-tint it (inline styles couldn't be reached by the dark theme rules). */
.lev-req { display: inline-flex; align-items: center; gap: 4px; padding: 3px 10px; border-radius: 20px; font-size: 11px; font-weight: 800; border: 1px solid; white-space: nowrap; }
.lev-req-m { background: #dcfce7; color: #15803d; border-color: #bbf7d0; }
.lev-req-o { background: #f1f5f9; color: #64748b; border-color: #e2e8f0; font-weight: 700; }
[data-bs-theme="dark"] .lev-req-m { background: rgba(34,197,94,.18); color: #86efac; border-color: rgba(34,197,94,.40); }
[data-bs-theme="dark"] .lev-req-o { background: rgba(148,163,184,.16); color: #cbd5e1; border-color: rgba(148,163,184,.32); }

.lev-doc-status { display: inline-flex; align-items: center; gap: 5px; padding: 4px 11px; border-radius: 999px; font-size: 10.5px; font-weight: 800; letter-spacing: .04em; border: 1px solid; white-space: nowrap; }
.lev-doc-status.verified { background: #ECFDF5; color: #047857; border-color: #A7F3D0; }
.lev-doc-status.expiring { background: #FEF3C7; color: #B45309; border-color: #FDE68A; }
.lev-doc-status.pending  { background: #FEF2F2; color: #B91C1C; border-color: #FECACA; }
.lev-doc-dash { color: #CBD5E1; font-weight: 700; }

/* Row actions */
.lev-row-actions { display: flex; gap: 6px; align-items: center; }
.lev-act { width: 28px; height: 28px; border-radius: 7px; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; border: 1px solid transparent; text-decoration: none; transition: all .12s; }
.lev-act svg { width: 13px; height: 13px; }
.lev-act-view { background: #ede9fe; color: #5b21b6; border-color: #ddd6fe; }
.lev-act-view:hover { background: #ddd6fe; }
.lev-act-download { background: #f5f3ff; color: #7c3aed; border-color: #ddd6fe; }
.lev-act-download:hover { background: #ede9fe; }
.lev-act-upload { background: #f0fdf4; color: #15803d; border-color: #bbf7d0; }
.lev-act-upload:hover { background: #dcfce7; }
.lev-act-cert { background: #ede9fe; color: #7c3aed; border-color: #c4b5fd; }
.lev-act.is-disabled { opacity: .4; cursor: not-allowed; pointer-events: none; }
/* Dark-mode tints — translucent fills so the icon buttons read on the dark
   table instead of sitting as bright light chips. */
[data-bs-theme="dark"] .lev-act-view     { background: rgba(124,58,237,.22); color: #c4b5fd; border-color: rgba(167,139,250,.38); }
[data-bs-theme="dark"] .lev-act-view:hover { background: rgba(124,58,237,.34); }
[data-bs-theme="dark"] .lev-act-download { background: rgba(124,58,237,.14); color: #c4b5fd; border-color: rgba(167,139,250,.30); }
[data-bs-theme="dark"] .lev-act-download:hover { background: rgba(124,58,237,.26); }
[data-bs-theme="dark"] .lev-act-upload   { background: rgba(34,197,94,.16); color: #86efac; border-color: rgba(34,197,94,.35); }
[data-bs-theme="dark"] .lev-act-upload:hover { background: rgba(34,197,94,.26); }
[data-bs-theme="dark"] .lev-act-cert     { background: rgba(124,58,237,.22); color: #c4b5fd; border-color: rgba(167,139,250,.42); }

/* ── Pagination — flush footer bar inside the table card ── */
.lev-pager { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; padding: 8px 14px; border-top: 1px solid #ECEEF3; background: #FBFCFE; }
.lev-pager-info { font-size: 12px; font-weight: 600; color: #64748B; }
.lev-pager-ctrls { display: inline-flex; align-items: center; gap: 6px; }
.lev-pager-btn, .lev-pager-num {
  min-width: 30px; height: 30px; padding: 0 8px; border-radius: 8px; cursor: pointer;
  background: #fff; border: 1px solid #E2E8F0; color: #475569;
  font-family: inherit; font-size: 12.5px; font-weight: 700;
  display: inline-flex; align-items: center; justify-content: center; transition: all .14s ease;
}
.lev-pager-btn svg { width: 14px; height: 14px; }
.lev-pager-btn:hover:not(:disabled), .lev-pager-num:hover:not(.active) { background: #F5F3FF; border-color: #ddd6fe; color: #6d28d9; }
.lev-pager-btn:disabled { opacity: .45; cursor: not-allowed; }
.lev-pager-num.active { background: linear-gradient(135deg, #6d28d9 0%, #7c3aed 100%); border-color: #6d28d9; color: #fff; box-shadow: 0 3px 8px rgba(124,58,237,.30); }

/* ── Footer ── */
.lev-footer { background: #fff; border-top: 1px solid #ECEEF3; padding: 10px 18px; display: flex; align-items: center; justify-content: flex-end; gap: 14px; flex-wrap: wrap; }
.lev-footer-info { font-size: 12.5px; color: #64748B; font-weight: 500; }
.lev-footer-info strong { color: #1E293B; font-weight: 700; }
.lev-footer-actions { display: flex; gap: 10px; }
.lev-footer-btn { height: 38px; padding: 0 18px; border-radius: 10px; font-size: 12.5px; font-weight: 700; cursor: pointer; display: inline-flex; align-items: center; gap: 7px; font-family: inherit; border: 1.5px solid transparent; transition: all .22s cubic-bezier(.22,1,.36,1); }
.lev-footer-btn svg { width: 14px; height: 14px; stroke: currentColor; }
.lev-footer-btn.outline { background: #fff; border-color: #E2E8F0; color: #475569; }
.lev-footer-btn.outline:hover:not(:disabled) { background: #F5F3FF; border-color: #ddd6fe; color: #6d28d9; transform: translateY(-1px); }
.lev-footer-btn.outline:disabled { opacity: .55; cursor: not-allowed; }
.lev-footer-btn.primary { background: linear-gradient(135deg, #6d28d9 0%, #7c3aed 100%); border: none; color: #fff; box-shadow: 0 6px 14px rgba(124,58,237,.32), inset 0 1px 0 rgba(255,255,255,.20); }
.lev-footer-btn.primary:hover { transform: translateY(-1px); box-shadow: 0 10px 20px rgba(124,58,237,.40), inset 0 1px 0 rgba(255,255,255,.25); }

/* ── Dark mode — keep the hero/table chrome, tint the surfaces ── */
[data-bs-theme="dark"] .lev-modal { background: #0f172a; }
[data-bs-theme="dark"] .lev-tabs { background: #0f172a; border-bottom-color: rgba(148,163,184,.18); }
[data-bs-theme="dark"] .lev-tab { color: #c4b5fd; background: #1e293b; border-color: rgba(167,139,250,.30); }
[data-bs-theme="dark"] .lev-tab .lev-tab-count { background: rgba(167,139,250,.18); color: #ddd6fe; }
/* Active keeps the violet gradient pill from the base rule. */
[data-bs-theme="dark"] .lev-tab.active { color: #fff; border-color: transparent; }
[data-bs-theme="dark"] .lev-tab.active .lev-tab-count { background: rgba(255,255,255,.22); color: #fff; }
[data-bs-theme="dark"] .lev-tab:hover:not(.active) { background: rgba(124,58,237,.20); }
[data-bs-theme="dark"] .lev-body { background: #0b1220; }
[data-bs-theme="dark"] .lev-section-card { background: rgba(124,58,237,.10); border-color: rgba(167,139,250,.30); }
[data-bs-theme="dark"] .lev-section-title { color: #f1f5f9; }
[data-bs-theme="dark"] .lev-section-desc { color: #94a3b8; }
[data-bs-theme="dark"] .lev-section-count .num { color: #c4b5fd; }
[data-bs-theme="dark"] .lev-table-card { background: #0f172a; border-color: rgba(148,163,184,.18); }
[data-bs-theme="dark"] .lev-doc-table td { color: #e2e8f0; border-bottom-color: rgba(148,163,184,.14); }
[data-bs-theme="dark"] .lev-doc-table tbody tr:hover td { background: rgba(167,139,250,.08); }
[data-bs-theme="dark"] .lev-doc-name { color: #f8fafc; }
[data-bs-theme="dark"] .lev-doc-license { color: #c4b5fd; }
[data-bs-theme="dark"] .lev-footer { background: #0f172a; border-top-color: rgba(148,163,184,.18); }
[data-bs-theme="dark"] .lev-footer-info { color: #94a3b8; }
[data-bs-theme="dark"] .lev-footer-info strong { color: #e2e8f0; }
[data-bs-theme="dark"] .lev-footer-btn.outline { background: #1e293b; border-color: rgba(148,163,184,.30); color: #cbd5e1; }
[data-bs-theme="dark"] .lev-pager { background: rgba(148,163,184,.06); border-top-color: rgba(148,163,184,.18); }
[data-bs-theme="dark"] .lev-pager-info { color: #94a3b8; }
[data-bs-theme="dark"] .lev-pager-btn, [data-bs-theme="dark"] .lev-pager-num { background: #1e293b; border-color: rgba(148,163,184,.30); color: #cbd5e1; }
[data-bs-theme="dark"] .lev-pager-num.active { background: linear-gradient(135deg, #6d28d9 0%, #7c3aed 100%); border-color: #6d28d9; color: #fff; }

@media (max-width: 760px) {
  .lev-backdrop { padding: 10px; }
  .lev-hero { padding: 18px 16px; }
  .lev-tabs, .lev-body, .lev-footer { padding-left: 16px; padding-right: 16px; }
  .lev-footer { flex-direction: column; align-items: stretch; }
  .lev-footer-actions { justify-content: flex-end; }
}
`;
