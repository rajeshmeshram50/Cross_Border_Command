import { useEffect, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import api from '../../../api';
import type { VaultData, VaultDoc, VaultStatus } from '../../sales/core-masters/customer/CustomerEvidenceVaultModal';

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

/* ──────────────────────────────────────────────────────────────────────────
 * One payload per owner, shared by all five cells.
 *
 * KYC, DD, Trade Licences, Trade Documents and Agreements are five cells on
 * the same row, and every one of them opens this popup and GETs the SAME
 * vault — so reading a row's documents cost four or five identical requests,
 * each paid for in full. That is what the "takes time to open" reports are
 * measuring: the reported call was 0.9 kB and took 3.06s, and the trivial
 * unread-count beside it in the same waterfall took 1.47s, so the time is
 * per-request latency on the server, not payload or query work (the handler
 * measures ~6ms). Nothing is won by sending less; what wins is not sending it
 * again.
 *
 * Stale-while-revalidate, not a plain cache: a hit renders immediately AND
 * still refetches behind the popup, so the second open is instant and the
 * numbers are never older than one open. The window is deliberately short —
 * this is for "I clicked KYC, now I'm clicking DD", not for holding documents
 * across a working session — and uploads anywhere refresh it through
 * invalidateDocsCache below.
 * ────────────────────────────────────────────────────────────────────────── */
const VAULT_TTL_MS = 60_000;
const vaultCache = new Map<string, { at: number; data: VaultData | null }>();
const cacheKey = (ownerType: string, ownerId: number) => `${ownerType}:${ownerId}`;

/** Drop a cached payload after an upload / verify / delete touches that owner. */
export function invalidateDocsCache(ownerType?: string, ownerId?: number) {
  if (ownerType && ownerId) vaultCache.delete(cacheKey(ownerType, ownerId));
  else vaultCache.clear();
}

export type DocCategory = 'kyc' | 'dd' | 'tl' | 'td' | 'agr';

/** Normalised list-row shape the card renders, regardless of source bucket. */
type DocItem = { name: string; sub: string; status: VaultStatus };

/* Which deal a per-transaction row belongs to.
 *
 * Trade documents and agreements are listed once PER DEAL, not once per
 * library document — the same document required on two shipments is two
 * obligations, signed separately on each. Both copies carried the same title
 * and an empty sub-line, so the list looked like it was repeating itself.
 * Naming the deal is what separates them.
 *
 * Shows the SHIPMENT ID, because that is the column the vault's own
 * transaction table leads with and therefore the code the reader is matching
 * against. The opportunity is the fallback for a deal with no shipment code
 * at all. Standard one-time documents (KYC / DD / licences) belong to the
 * company rather than a deal and carry no stamp, so they keep the authority
 * line they had. */
type DealStamped = { deal_shipment_id?: string | null; deal_opportunity_id?: string | null; deal_has_shipment?: boolean };

function dealLabel(row: DealStamped, fallback: string): string {
  const shp = row.deal_shipment_id ?? '';
  const opp = row.deal_opportunity_id ?? '';
  return shp || opp || fallback;
}

/** One row: 14px padding, a 38px tile, 14px padding, 1px rule. */
const ROW_H = 67;

const CATEGORY_META: Record<DocCategory, { label: string; sub: string }> = {
  kyc: { label: 'OWNER KYC DETAILS',       sub: 'Owner identity, address & photograph proofs' },
  dd:  { label: 'COMPANY DUE DILIGENCE',   sub: 'Licenses, statutory documents & compliance proofs' },
  tl:  { label: 'TRADE LICENSES',          sub: 'Trade licence documents & regulatory approvals' },
  td:  { label: 'TRADE DOCUMENTS',         sub: 'Agreements, frameworks & confidentiality documents' },
  agr: { label: 'AGREEMENTS',              sub: 'Applicable agreements & signing status' },
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
    // Segment-applicable agreements for the entity (customer/consignee/vendor),
    // overlaid with signature status — the same set the Buyer/Supplier Profile
    // agr cell counts. NOT the per-shipment list, which is shipment-gated and
    // read "0 of 0" for parties without a shipment order (CBC #66).
    return (vault.agreements ?? []).map((a) => ({
      name: a.name,
      sub: dealLabel(a as DealStamped, a.authority || '—'),
      status: (a.status === 'Signed' || a.status === 'Verified') ? a.status : 'Pending',
    }));
  }
  const bucket: VaultDoc[] =
    category === 'kyc' ? vault.owner_kyc
    : category === 'dd' ? vault.company_dd
    : category === 'tl' ? vault.trade_licenses
    : vault.trade_documents;
  return (bucket ?? []).map((d) => ({
    name: d.name,
    // Only the per-deal bucket carries a stamp; KYC / DD / licences fall back
    // to their issuing authority, which is what identifies those.
    sub: dealLabel(d as DealStamped, d.authority || '—'),
    status: d.status,
  }));
}

/* Shimmer placeholder box — a tinted base with a sweeping highlight, used by
 * the loading skeleton so a spinner-less wait still reads as "loading". */
function skBox(dark?: boolean): CSSProperties {
  const base = dark ? 'rgba(148,163,184,.16)' : '#e9eef3';
  const hl   = dark ? 'rgba(203,213,225,.28)' : '#f5f9fc';
  return {
    backgroundImage: `linear-gradient(90deg, ${base} 25%, ${hl} 50%, ${base} 75%)`,
    backgroundSize: '200% 100%',
    animation: 'clmDocsSk 1.3s ease-in-out infinite',
  };
}

/* Status pill — same palette as the Evidence Vault's StatusPill, with dark
 * variants (translucent fills + lightened text) for dark mode. */
function StatusPill({ s, dark }: { s: VaultStatus; dark?: boolean }) {
  const tone = dark
    ? (s === 'Verified' ? { bg: 'rgba(16,185,129,.18)', fg: '#6ee7b7', bd: 'rgba(16,185,129,.38)' }
      : s === 'Signed'   ? { bg: 'rgba(59,130,246,.18)', fg: '#93c5fd', bd: 'rgba(59,130,246,.38)' }
      : s === 'Expiring' ? { bg: 'rgba(245,158,11,.18)', fg: '#fcd34d', bd: 'rgba(245,158,11,.38)' }
      :                    { bg: 'rgba(239,68,68,.18)',  fg: '#fca5a5', bd: 'rgba(239,68,68,.38)' })
    : (s === 'Verified' ? { bg: '#d1fae5', fg: '#047857', bd: '#a7f3d0' }
      : s === 'Signed'   ? { bg: '#dbeafe', fg: '#1e40af', bd: '#bfdbfe' }
      : s === 'Expiring' ? { bg: '#fef3c7', fg: '#92400e', bd: '#fde68a' }
      :                    { bg: '#fee2e2', fg: '#b91c1c', bd: '#fecaca' });
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', padding: '4px 12px', borderRadius: 20, background: tone.bg, border: `1px solid ${tone.bd}`, color: tone.fg, fontSize: 10, fontWeight: 800, letterSpacing: '.04em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
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

  /* Fetch the vault payload when opened for an owner — from cache first.
     A fresh entry paints the rows with no spinner at all; the request still
     goes out behind it so what you are looking at is at most one open old. */
  useEffect(() => {
    if (!open || !ownerId) { setVault(null); return; }
    let cancelled = false;

    const key = cacheKey(ownerType, ownerId);
    const hit = vaultCache.get(key);
    const fresh = hit && Date.now() - hit.at < VAULT_TTL_MS;
    if (fresh) { setVault(hit!.data); setLoading(false); }
    else { setVault(null); setLoading(true); }

    api.get(`/segment-uploads/${ownerType}/${ownerId}/vault`)
      .then((r) => {
        const data = (r.data?.data ?? null) as VaultData | null;
        vaultCache.set(key, { at: Date.now(), data });
        if (!cancelled) setVault(data);
      })
      /* A failed revalidation leaves a cached payload on screen rather than
         blanking rows the user is reading; only a cold open shows nothing. */
      .catch(() => { if (!cancelled && !fresh) setVault(null); })
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
        footerFg: '#7dd3fc',
      }
    : {
        card: '#fff', rowBorder: '#eef2f6',
        numBg: '#ecfeff', numBd: '#a5f3fc', numFg: '#0e7490',
        name: '#0f172a', sub: '#94a3b8', muted: '#64748b',
        reqBg: '#fef9c3', reqBd: '#fde68a', reqFg: '#a16207',
        footerBg: 'linear-gradient(110deg,#f0fdff,#e8fafb)', footerBd: '#a5f3fc',
        footerFg: '#0e7490',
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
        style={{ width: 'min(760px, 96vw)', maxHeight: '88vh', display: 'flex', flexDirection: 'column', background: c.card, borderRadius: 18, overflow: 'hidden', boxShadow: '0 24px 60px rgba(8,47,73,.4)' }}
      >
        {/* ── Header (compact: eyebrow + name on the left; verified badge sits
            beside the close button on the right) ── */}
        <div style={{ padding: '18px 20px', background: 'linear-gradient(120deg,#0e7490 0%,#0891b2 55%,#06b6d4 100%)', color: '#fff', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 9.5, fontWeight: 700, letterSpacing: '.12em', color: 'rgba(255,255,255,.85)' }}>
              <span style={{ width: 16, height: 2, background: 'rgba(255,255,255,.7)', borderRadius: 2 }} />
              {meta.label}
            </div>
            {/* 700, not 800, and the band is 18px deep rather than 12. On a saturated
                teal the heavier cut filled in and read as a slab; the extra height
                is what lets the pair breathe once it is lighter. */}
            <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-.01em', marginTop: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{company}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 11px', borderRadius: 20, background: 'rgba(16,185,129,.22)', border: '1px solid rgba(110,231,183,.5)', color: '#d1fae5', fontSize: 11.5, fontWeight: 600, whiteSpace: 'nowrap' }}>
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
        {/* Five rows, then scroll. A row is 14px of padding either side of a
            38px number tile plus its 1px rule, so 67px each. Without the cap
            the list grew to 88vh and a long bucket filled the screen, which
            buried the footer count and the Close button on a short window.
            88vh still applies on top, for screens shorter than five rows. */}
        {/* A slim 6px rail on no track. The list is capped, so something has to
            say the sixth row exists — but at 10px on a 760px dialog the bar
            read as a second border down the edge. */}
        <style>{`.clm-docs-list{scrollbar-width:thin;scrollbar-color:rgba(8,145,178,.4) transparent;}
          .clm-docs-list::-webkit-scrollbar{width:6px;}
          .clm-docs-list::-webkit-scrollbar-track{background:transparent;}
          .clm-docs-list::-webkit-scrollbar-thumb{background:rgba(8,145,178,.4);border-radius:999px;}
          .clm-docs-list:hover::-webkit-scrollbar-thumb{background:rgba(8,145,178,.6);}`}</style>
        <div className="clm-docs-list" style={{ flex: 1, minHeight: 0, maxHeight: ROW_H * 5, overflowY: 'auto', background: c.card }}>
          {loading ? (
            <>
              <style>{`@keyframes clmDocsSk{0%{background-position:200% 0}100%{background-position:-200% 0}}`}</style>
              {[0, 1, 2, 3].map((i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 22px', borderBottom: `1px solid ${c.rowBorder}` }}>
                  <span style={{ width: 38, height: 38, flexShrink: 0, borderRadius: 10, ...skBox(isDark) }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', height: 13, width: '55%', borderRadius: 5, ...skBox(isDark) }} />
                    <span style={{ display: 'block', height: 11, width: '35%', borderRadius: 5, marginTop: 7, ...skBox(isDark) }} />
                  </div>
                  <span style={{ width: 38, height: 18, flexShrink: 0, borderRadius: 6, ...skBox(isDark) }} />
                  <span style={{ width: 74, height: 22, flexShrink: 0, borderRadius: 20, ...skBox(isDark) }} />
                </div>
              ))}
            </>
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
          <span style={{ display: 'inline-flex', alignItems: 'center', fontSize: 12, fontWeight: 600, color: c.footerFg }}>
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
