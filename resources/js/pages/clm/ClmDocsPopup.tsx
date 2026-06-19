import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import api from '../../api';
import type { VaultData, VaultDoc, VaultStatus } from '../sales/CustomerEvidenceVaultModal';

/* ──────────────────────────────────────────────────────────────────────────
 * CLM → Buyer / Supplier Profile document popup.
 *
 * Lightweight, single-bucket alternative to the full Evidence Vault. Opened
 * from a KYC / DD / Trade Licence / Trade Docs / Agreements progress cell on
 * the Buyer Profile (buyer + consignee rows) and Supplier Profile pages, it
 * shows just that one document category as a clean checklist card (numbered
 * rows + REQ / status pills + "N of M verified" footer) instead of the
 * heavier tabbed vault.
 *
 * Data source is the same endpoint the vault uses
 *   GET /segment-uploads/{customer|consignee|supplier}/{db_id}/vault
 * so the rows stay in sync with the vault.
 * ────────────────────────────────────────────────────────────────────────── */

export type DocCategory = 'kyc' | 'dd' | 'tl' | 'td' | 'agr';

/** Normalised list-row shape the card renders, regardless of source bucket. */
type DocItem = { name: string; sub: string; status: VaultStatus };

const CATEGORY_META: Record<DocCategory, { label: string; sub: string }> = {
  kyc: { label: 'OWNER KYC DETAILS',       sub: 'Owner identity, address & photograph proofs' },
  dd:  { label: 'COMPANY DUE DILIGENCE',   sub: 'Licenses, statutory documents & compliance proofs' },
  tl:  { label: 'TRADE LICENSES',          sub: 'Trade licence documents & regulatory approvals' },
  td:  { label: 'TRADE DOCUMENTS',         sub: 'Agreements, frameworks & confidentiality documents' },
  agr: { label: 'AGREEMENTS',              sub: 'Shipment agreements & signing status' },
};

interface Props {
  open: boolean;
  onClose: () => void;
  category: DocCategory;
  ownerType: 'customer' | 'consignee' | 'supplier';
  ownerId: number | null;
  company: string;
}

/* Pull the rows for a category out of a vault payload, normalised to DocItem. */
function itemsFor(vault: VaultData, category: DocCategory): DocItem[] {
  if (category === 'agr') {
    return (vault.shipment_agreements ?? []).map((s) => ({
      name: s.shipment_id,
      sub: `${s.customer}${s.country ? ` · ${s.country}` : ''}`,
      status: (s.agreement?.pct ?? 0) === 100 ? 'Verified' : 'Pending',
    }));
  }
  const bucket: VaultDoc[] =
    category === 'kyc' ? vault.owner_kyc
    : category === 'dd' ? vault.company_dd
    : category === 'tl' ? vault.trade_licenses
    : vault.trade_documents;
  return (bucket ?? []).map((d) => ({
    name: d.name,
    sub: d.authority || '—',
    status: d.status,
  }));
}

/* Status pill — same palette as the Evidence Vault's StatusPill, with dark
 * variants (translucent fills + lightened text) for dark mode. */
function StatusPill({ s, dark }: { s: VaultStatus; dark?: boolean }) {
  const tone = dark
    ? (s === 'Verified' ? { bg: 'rgba(16,185,129,.18)', fg: '#6ee7b7', dot: '#10b981' }
      : s === 'Signed'   ? { bg: 'rgba(59,130,246,.18)', fg: '#93c5fd', dot: '#3b82f6' }
      : s === 'Expiring' ? { bg: 'rgba(245,158,11,.18)', fg: '#fcd34d', dot: '#f59e0b' }
      :                    { bg: 'rgba(239,68,68,.18)',  fg: '#fca5a5', dot: '#ef4444' })
    : (s === 'Verified' ? { bg: '#d1fae5', fg: '#047857', dot: '#10b981' }
      : s === 'Signed'   ? { bg: '#dbeafe', fg: '#1e40af', dot: '#3b82f6' }
      : s === 'Expiring' ? { bg: '#fef3c7', fg: '#92400e', dot: '#f59e0b' }
      :                    { bg: '#fee2e2', fg: '#b91c1c', dot: '#ef4444' });
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 11px', borderRadius: 20, background: tone.bg, color: tone.fg, fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: tone.dot }} />
      {s}
    </span>
  );
}

export default function ClmDocsPopup({ open, onClose, category, ownerType, ownerId, company }: Props) {
  const [vault, setVault] = useState<VaultData | null>(null);
  const [loading, setLoading] = useState(false);
  const [isDark, setIsDark] = useState(() => document.documentElement.getAttribute('data-bs-theme') === 'dark');

  /* Track <html data-bs-theme> so the popup re-themes live on toggle. */
  useEffect(() => {
    if (!open) return;
    const root = document.documentElement;
    const sync = () => setIsDark(root.getAttribute('data-bs-theme') === 'dark');
    sync();
    const obs = new MutationObserver(sync);
    obs.observe(root, { attributes: true, attributeFilter: ['data-bs-theme'] });
    return () => obs.disconnect();
  }, [open]);

  /* Close on Escape. */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  /* Fetch the vault payload when opened for an owner. */
  useEffect(() => {
    if (!open || !ownerId) { setVault(null); return; }
    let cancelled = false;
    setLoading(true);
    api.get(`/segment-uploads/${ownerType}/${ownerId}/vault`)
      .then((r) => { if (!cancelled) setVault((r.data?.data ?? null) as VaultData | null); })
      .catch(() => { if (!cancelled) setVault(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, ownerType, ownerId]);

  if (!open) return null;

  const meta = CATEGORY_META[category];
  const items = vault ? itemsFor(vault, category) : [];
  const verified = items.filter((i) => i.status === 'Verified' || i.status === 'Signed').length;
  const total = items.length;
  const noun = category === 'agr' ? 'agreements' : 'documents';

  /* Theme palette — the teal header / Close button read fine on both, so only
   * the card surface, row text, badges and footer swap for dark mode. */
  const c = isDark
    ? {
        card: '#1e293b', rowBorder: 'rgba(148,163,184,.14)',
        numBg: 'rgba(6,182,212,.16)', numBd: 'rgba(8,145,178,.4)', numFg: '#67e8f9',
        name: '#e2e8f0', sub: '#94a3b8', muted: '#94a3b8',
        reqBg: 'rgba(234,179,8,.16)', reqBd: 'rgba(253,224,71,.32)', reqFg: '#fcd34d',
        footerBg: 'linear-gradient(110deg,#16263a,#11202f)', footerBd: 'rgba(6,182,212,.28)',
        footerFg: '#7dd3fc', footerDot: '#22d3ee',
      }
    : {
        card: '#fff', rowBorder: '#eef2f6',
        numBg: '#ecfeff', numBd: '#a5f3fc', numFg: '#0e7490',
        name: '#0f172a', sub: '#94a3b8', muted: '#64748b',
        reqBg: '#fef9c3', reqBd: '#fde68a', reqFg: '#a16207',
        footerBg: 'linear-gradient(110deg,#f0fdff,#e8fafb)', footerBd: '#a5f3fc',
        footerFg: '#0e7490', footerDot: '#0891b2',
      };

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.55)', backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1080, padding: 16 }}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        style={{ width: 'min(640px, 96vw)', maxHeight: '88vh', display: 'flex', flexDirection: 'column', background: c.card, borderRadius: 18, overflow: 'hidden', boxShadow: '0 24px 60px rgba(8,47,73,.4)' }}
      >
        {/* ── Header (compact: eyebrow + name on the left; verified badge sits
            beside the close button on the right) ── */}
        <div style={{ padding: '12px 16px', background: 'linear-gradient(120deg,#0e7490 0%,#0891b2 55%,#06b6d4 100%)', color: '#fff', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 9.5, fontWeight: 800, letterSpacing: '.12em', color: 'rgba(255,255,255,.85)' }}>
              <span style={{ width: 16, height: 2, background: 'rgba(255,255,255,.7)', borderRadius: 2 }} />
              {meta.label}
            </div>
            <div style={{ fontSize: 16, fontWeight: 800, letterSpacing: '-.01em', marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{company}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 11px', borderRadius: 20, background: 'rgba(16,185,129,.22)', border: '1px solid rgba(110,231,183,.5)', color: '#d1fae5', fontSize: 11.5, fontWeight: 700, whiteSpace: 'nowrap' }}>
              ✓ {verified} Verified / Signed
            </span>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              style={{ width: 32, height: 32, borderRadius: 9, background: 'rgba(255,255,255,.16)', border: '1px solid rgba(255,255,255,.28)', color: '#fff', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            </button>
          </div>
        </div>

        {/* ── Body ── */}
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', background: c.card }}>
          {loading ? (
            <div style={{ padding: 40, textAlign: 'center', fontSize: 13, color: c.muted }}>Loading documents…</div>
          ) : total === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', fontSize: 13, color: c.muted }}>No {noun} in this bucket yet.</div>
          ) : (
            items.map((it, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 22px', borderBottom: `1px solid ${c.rowBorder}` }}>
                <span style={{ width: 38, height: 38, flexShrink: 0, borderRadius: 10, background: c.numBg, border: `1px solid ${c.numBd}`, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800, color: c.numFg }}>
                  {String(i + 1).padStart(2, '0')}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: c.name, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.name}</div>
                  <div style={{ fontSize: 12, color: c.sub, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.sub}</div>
                </div>
                <span style={{ flexShrink: 0, padding: '3px 9px', borderRadius: 6, background: c.reqBg, border: `1px solid ${c.reqBd}`, color: c.reqFg, fontSize: 10, fontWeight: 800, letterSpacing: '.04em' }}>REQ</span>
                <span style={{ flexShrink: 0 }}><StatusPill s={it.status} dark={isDark} /></span>
              </div>
            ))
          )}
        </div>

        {/* ── Footer ── */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 22px', background: c.footerBg, borderTop: `1.5px solid ${c.footerBd}`, flexShrink: 0 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12.5, fontWeight: 600, color: c.footerFg }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: c.footerDot }} />
            {verified} of {total} {noun} verified
          </span>
          <button
            type="button"
            onClick={onClose}
            style={{ padding: '9px 20px', borderRadius: 9, border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: 700, color: '#fff', background: 'linear-gradient(135deg,#0891b2,#0e7490)', boxShadow: '0 3px 10px rgba(8,145,178,.35)' }}
          >
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
