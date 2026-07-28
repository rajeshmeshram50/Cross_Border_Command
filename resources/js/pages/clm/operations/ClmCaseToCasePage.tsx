import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'react-router-dom';
import { useToast } from '../../../contexts/ToastContext';
import api from '../../../api';
import { type CtcContract, inits, PER_PAGE } from './clmOpsData';
import ClmCtcForm from './ClmCtcForm';
import { useOpsTheme, type OpsTokens } from './useOpsTheme';
import { VersionHistoryModal, AgreementTimelineModal, type CtcVersion, type CtcSigner } from './clmCtcModals';
import { Shimmer } from '../../../components/ui/Shimmer';
import Tooltip from '../../../components/ui/Tooltip';

/* ─────────────────────────────────────────────────────────────────────────
 * CLM Operations · Without Shipment ID → Case to Case Contracts.
 *
 * Faithful violet-themed port of the `rCtc()` view from the CLM_CaseToCase
 * prototype: header strip with "Create CTC Agreement", a collapsible
 * "What We Are Doing Here" stage-card box, a single-capsule tab bar
 * (All / Signed / In Progress / Rejected), search, and the contracts
 * table with per-row download / edit / version / timeline actions. The
 * full-screen 4-stage create form mounts via ClmCtcForm.
 * ───────────────────────────────────────────────────────────────────────── */

type CtcTab = 'all' | 'signed' | 'inprogress' | 'rejected';

const ORG_GRAD: Record<string, string> = {
  'IGC-Healthcare': '#0369A1,#0284C7',
  'IGC-Agrotech':   '#047857,#059669',
};
const orgGrad = (org: string) => ORG_GRAD[org] ?? '#4C1D95,#7C3AED';

const S_CFG = {
  signed:     { label: 'Signed',     bg: '#ECFDF5', border: '#A7F3D0', color: '#059669', dot: '#10B981' },
  inprogress: { label: 'In Progress', bg: '#FFFBEB', border: '#FDE68A', color: '#D97706', dot: '#F59E0B' },
  rejected:   { label: 'Rejected',   bg: '#FEF2F2', border: '#FECACA', color: '#DC2626', dot: '#EF4444' },
} as const;
const AP_CFG = {
  approved: { label: 'Approved', bg: '#ECFDF5', border: '#A7F3D0', color: '#059669', dot: '#10B981' },
  pending:  { label: 'Pending', bg: '#FFFBEB', border: '#FDE68A', color: '#D97706', dot: '#F59E0B' },
  rejected: { label: 'Rejected', bg: '#FEF2F2', border: '#FECACA', color: '#DC2626', dot: '#EF4444' },
} as const;

const STAGE_CARDS = [
  { n: '01', title: 'Agreement Drafting',                   desc: 'Create or upload the agreement draft and prepare the contract details.', icon: <path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" /> },
  { n: '02', title: 'Internal Review & Approval',           desc: 'Send the agreement for internal review, validation, and approval.',      icon: <><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><polyline points="9 12 11 14 15 10" /></> },
  { n: '03', title: 'Counterparty Negotiation & Signing',   desc: 'Share the agreement with the counterparty for negotiation, approval, and signing.', icon: <><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></> },
  { n: '04', title: 'Final Contract Repository',            desc: 'Store the finalized signed agreement with complete contract history and records.', icon: <><polyline points="21 8 21 21 3 21 3 8" /><rect x="1" y="3" width="22" height="5" /><line x1="10" y1="12" x2="14" y2="12" /></> },
];

// Display dates as DD-Mon-YYYY (e.g. 17-Jul-2026). The API returns "17 Jul
// 2026"; swap the spaces for hyphens (QA #41). "—" / empty pass through.
const dashDate = (s: string): string => (s && s !== '—' ? s.replace(/\s+/g, '-') : s);

export default function ClmCaseToCasePage() {
  const toast = useToast();
  const t = useOpsTheme('violet');
  const TH = { padding: '7px 10px', fontSize: 7.5, fontWeight: 800, letterSpacing: '.11em', textTransform: 'uppercase', color: '#fff', whiteSpace: 'nowrap', background: t.dark ? '#5B21B6' : '#6D28D9', borderBottom: 'none', textAlign: 'center' } as React.CSSProperties;
  const TD = { padding: '7px 10px', verticalAlign: 'middle', borderBottom: `1px solid ${t.cellBorder}`, textAlign: 'center' } as React.CSSProperties;
  const TDL = { ...TD, textAlign: 'left' } as React.CSSProperties;
  // Status/approval pills read as glaring light chips on the dark table — swap to
  // translucent dark fills + lighter text in dark mode, keyed off the semantic colour.
  const badgeTok = (cfg: { bg: string; border: string; color: string }) => {
    if (!t.dark) return { bg: cfg.bg, border: cfg.border, text: cfg.color };
    if (cfg.color === '#059669') return { bg: 'rgba(16,185,129,.16)', border: 'rgba(16,185,129,.42)', text: '#6ee7b7' };
    if (cfg.color === '#D97706') return { bg: 'rgba(245,158,11,.16)', border: 'rgba(245,158,11,.42)', text: '#fcd34d' };
    return { bg: 'rgba(239,68,68,.16)', border: 'rgba(239,68,68,.42)', text: '#fca5a5' };
  };
  const [tab, setTab]   = useState<CtcTab>('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PER_PAGE);   // dynamic rows-per-page (worklist pager)
  // Once the user picks a "Rows per page" value, stop the viewport auto-fit
  // from overriding it so the manual choice sticks.
  const [manualSize, setManualSize] = useState(false);
  const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];
  const [search, setSearch] = useState('');
  const [infoOpen, setInfoOpen] = useState(false);   // "What We Are Doing Here" starts collapsed
  const [cpOpen, setCpOpen] = useState<{ id: string; names: string[]; x: number; y: number } | null>(null);   // counterparties popover
  // The counterparties popover is fixed-positioned to the +N badge's rect at
  // click time, so any scroll detaches it from its row (CBC-568). Auto-close on
  // scroll (capture phase catches inner scroll containers too) + on resize.
  useEffect(() => {
    if (!cpOpen) return;
    const close = () => setCpOpen(null);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [cpOpen]);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<CtcContract | null>(null);
  const [rows, setRows] = useState<CtcContract[]>([]);
  const [loading, setLoading] = useState(true);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);   // row currently downloading
  // Version-history / Agreement-Timeline fetch in flight — freezes the other
  // row actions + toolbar until it resolves (QA #40). Tracks which row/kind so
  // the clicked button shows its own spinner while the rest go disabled.
  const [lifecycleBusy, setLifecycleBusy] = useState<{ id: string; kind: 'version' | 'timeline' } | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);   // hovered table row (state-driven so the highlight survives re-renders)
  // Stretch the contracts card to fill the viewport so its footer (pagination)
  // sits at the bottom of the card even with few rows — same dynamic behaviour
  // as the CLM master tables.
  const [fillH, setFillH] = useState<number | undefined>(undefined);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const load = () => {
    setLoading(true);
    api.get('/clm/ctc-contracts')
      .then(r => setRows(r.data?.data ?? []))
      .catch(() => { setRows([]); toast.error('Could not load contracts', 'Please refresh and try again.'); })
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  // Deep-link from "Agreements We Sent" → open this contract's edit form.
  // ?edit=<dbId> is consumed once rows are loaded, then cleared so a refresh
  // or back-nav doesn't reopen the form.
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const editId = searchParams.get('edit');
    if (!editId || loading) return;
    const target = rows.find((r) => String(r.dbId) === editId);
    if (target) { setEditing(target); setFormOpen(true); }
    searchParams.delete('edit');
    setSearchParams(searchParams, { replace: true });
  }, [loading, rows, searchParams, setSearchParams]);

  // Version-history / timeline modals need the full record (versions +
  // signing recipients + stage), which the list rows don't carry — fetch on demand.
  type CtcDetail = { code: string; title: string; dbId: number | null; stage: number; versions: CtcVersion[]; signers: CtcSigner[] };
  const [verFor, setVerFor] = useState<CtcDetail | null>(null);
  const [tlFor, setTlFor] = useState<CtcDetail | null>(null);
  const openLifecycle = async (c: CtcContract, kind: 'version' | 'timeline') => {
    if (!c.dbId) { toast.error('Not available', 'This agreement has no saved record yet.'); return; }
    if (lifecycleBusy) return;   // a history/timeline load is already in flight
    setLifecycleBusy({ id: c.id, kind });
    try {
      const res = await api.get(`/clm/ctc-contracts/${c.dbId}`);
      const r = (res.data?.data ?? res.data ?? {}) as Record<string, unknown>;
      const detail: CtcDetail = {
        code: String(r.code ?? c.id), title: String(r.title ?? c.title ?? ''), dbId: c.dbId, stage: Number(r.stage) || 1,
        versions: (Array.isArray(r.versions) ? r.versions : []) as CtcVersion[],
        signers: (Array.isArray(r.signing_recipients) ? r.signing_recipients : []) as CtcSigner[],
      };
      if (kind === 'version') setVerFor(detail); else setTlFor(detail);
    } catch { toast.error('Could not load', 'Failed to fetch the agreement history.'); }
    finally { setLifecycleBusy(null); }
  };

  // Download the contract — the fully-signed PDF from Zoho when available,
  // otherwise the latest drafted version rendered to PDF.
  const downloadContract = async (c: CtcContract) => {
    if (!c.dbId) { toast.error('Not available', 'This agreement has no saved record yet.'); return; }
    if (downloadingId) return;   // a download is already in flight — ignore extra clicks
    setDownloadingId(c.id);
    const grab = async (url: string, name: string) => {
      const f = await api.get(url, { responseType: 'blob' });
      const u = URL.createObjectURL(f.data as Blob);
      const a = document.createElement('a'); a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(u);
    };
    try {
      const res = await api.get(`/clm/ctc-contracts/${c.dbId}`);
      const r = (res.data?.data ?? res.data ?? {}) as Record<string, unknown>;
      const signedUrl = String(r.signed_document_url ?? '');
      const srId = Number(r.signature_request_id) || null;
      if (signedUrl && srId) {
        try { await grab(`/clm/signature-requests/${srId}/download-file/0`, `${c.id}-signed.pdf`); toast.success('Signed copy downloaded', c.id); return; }
        catch { window.open(signedUrl, '_blank'); return; }
      }
      const versions = (Array.isArray(r.versions) ? r.versions : []) as { v: number }[];
      const latestV = versions.length ? Math.max(...versions.map(v => Number(v.v) || 0)) : 1;
      await grab(`/clm/ctc-contracts/${c.dbId}/versions/${latestV}/download`, `${c.id}.pdf`);
      toast.success('Download started', c.id);
    } catch { toast.error('Download failed', 'Could not download the contract.'); }
    finally { setDownloadingId(null); }
  };

  const counts = useMemo(() => {
    const q = search.trim().toLowerCase();
    const f = q ? rows.filter(c => (c.title + c.cp.join(' ') + c.id + c.type).toLowerCase().includes(q)) : rows;
    return {
      all: f.length,
      signed: f.filter(c => c.status === 'signed').length,
      inprogress: f.filter(c => c.status === 'inprogress').length,
      rejected: f.filter(c => c.status === 'rejected').length,
    };
  }, [search, rows]);

  const list = useMemo(() => {
    const q = search.trim().toLowerCase();
    let f = q ? rows.filter(c => (c.title + c.cp.join(' ') + c.id + c.type).toLowerCase().includes(q)) : rows;
    return tab === 'all' ? f : f.filter(c => c.status === tab);
  }, [search, tab, rows]);

  const totalPages = Math.max(1, Math.ceil(list.length / pageSize));
  const safe = Math.min(page, totalPages);
  const start = (safe - 1) * pageSize;
  const slice = list.slice(start, start + pageSize);

  // Recompute the contracts card height so it fills down to the bottom of the
  // viewport, pushing the pagination footer to the bottom of the card.
  useEffect(() => {
    const recompute = () => {
      const el = cardRef.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top;
      // Leave room at the bottom for the layout footer + the scroll container's
      // padding — with only a 24px gap the card overshot the main-content scroll
      // area and the pagination footer landed at the fold (cut off).
      const fh = Math.max(240, window.innerHeight - top - 56);
      setFillH(prev => (prev === fh ? prev : fh));

      // Dynamic rows-per-page — fit as many rows as the card height allows so
      // a tall screen shows more and a short one fewer (mirrors the Customer /
      // master tables). A manual "Rows per page" pick disables the auto-fit.
      if (manualSize) return;
      const toolbarH = (el.firstElementChild as HTMLElement | null)?.offsetHeight || 0;
      const theadH   = (el.querySelector('table thead') as HTMLElement | null)?.offsetHeight || 0;
      const footerH  = (el.querySelector('.tc-wl-pag') as HTMLElement | null)?.offsetHeight || 0;
      const rowH     = (el.querySelector('table tbody tr') as HTMLElement | null)?.offsetHeight || 44;
      const avail    = fh - toolbarH - theadH - footerH - 20;
      const rowsFit  = Math.max(1, Math.floor(avail / rowH));
      setPageSize(prev => (prev === rowsFit ? prev : Math.max(PER_PAGE, rowsFit)));
    };
    recompute();
    const raf = requestAnimationFrame(recompute);
    const tm = window.setTimeout(recompute, 120);
    window.addEventListener('resize', recompute);
    return () => { window.removeEventListener('resize', recompute); window.clearTimeout(tm); cancelAnimationFrame(raf); };
  }, [list.length, loading, manualSize]);

  if (formOpen) {
    return <ClmCtcForm editing={editing} onClose={() => { setFormOpen(false); setEditing(null); load(); }} onSaved={() => { setFormOpen(false); setEditing(null); load(); }} />;
  }

  return (
    <div style={{ padding: 0, display: 'flex', flexDirection: 'column', gap: 8, fontFamily: 'var(--font-sans)' }}>
      <style>{CTC_CSS}</style>

      {/* Whole-page lock while a contract is downloading — the PDF can take a
          while to generate server-side, so block every other action (create,
          tab switch, other rows) until it finishes and can't be cut off. */}
      {downloadingId !== null && createPortal(
        <div style={{ position: 'fixed', inset: 0, zIndex: 2000000, background: 'rgba(15,7,50,.55)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 15, fontFamily: 'var(--font-sans)' }}>
          <svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="#c4b5fd" strokeWidth="2.4" strokeLinecap="round" style={{ animation: 'ctcSpin .7s linear infinite' }}><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
          <div style={{ fontSize: 15, fontWeight: 800, color: '#fff' }}>Preparing your download…</div>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,.72)' }}>Large agreements can take a moment — please don't leave this page.</div>
        </div>, document.body)}

      {/* CARD 1 — HEADER STRIP */}
      <div style={{ background: t.dark ? '#1c1438' : 'linear-gradient(110deg,#F5F3FF 0%,#EDE9FE 22%,#DDD6FE 50%,#C4B5FD 78%,#A78BFA 100%)', borderRadius: 14, border: `1px solid ${t.dark ? 'rgba(124,58,237,.4)' : 'rgba(124,58,237,.2)'}`, boxShadow: '0 2px 12px rgba(109,40,217,.1)', overflow: 'hidden' }}>
        <div className="ctc-header-strip" style={{ position: 'relative', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 18px', minHeight: 64 }}>
          <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 5, background: 'linear-gradient(180deg,#A78BFA,#7C3AED,#5B21B6)' }} />
          <span style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '50%', background: t.dark ? 'linear-gradient(180deg,rgba(255,255,255,.04),transparent)' : 'linear-gradient(180deg,rgba(255,255,255,.55),transparent)', pointerEvents: 'none' }} />
          <div className="ctc-header-titlewrap" style={{ display: 'flex', alignItems: 'center', gap: 14, zIndex: 1, paddingLeft: 10 }}>
            <div style={{ position: 'relative', flexShrink: 0 }}>
              <div style={{ width: 42, height: 42, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg,#8B5CF6,#7C3AED,#5B21B6)', boxShadow: '0 0 0 3px rgba(124,58,237,.22),0 4px 12px rgba(91,33,182,.42)' }}>
                <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="8" y1="13" x2="16" y2="13" /><line x1="8" y1="17" x2="12" y2="17" /></svg>
              </div>
              <span style={{ position: 'absolute', bottom: -1, right: -1, width: 10, height: 10, borderRadius: '50%', background: 'linear-gradient(135deg,#4ade80,#22c55e)', border: '2px solid #EDE9FE', boxShadow: '0 0 5px rgba(34,197,94,.45)' }} />
            </div>
            <div>
              <div className="ctc-header-title" style={{ fontSize: 16, fontWeight: 500, color: t.dark ? '#c4b5fd' : '#2e1065', letterSpacing: '-.4px', lineHeight: 1.15 }}>Case to Case Contracts Management</div>
              <div style={{ fontSize: 11, fontWeight: 500, color: t.dark ? '#a78bfa' : '#5B21B6', opacity: .9, marginTop: 3 }}>Manage one-time operational agreements and contract approval workflows.</div>
            </div>
          </div>
          <button onClick={() => { setEditing(null); setFormOpen(true); }} disabled={lifecycleBusy !== null} style={{ position: 'relative', overflow: 'hidden', display: 'flex', alignItems: 'center', gap: 7, padding: '9px 18px', border: 'none', borderRadius: 10, fontFamily: 'inherit', fontSize: 12, fontWeight: 700, color: '#fff', cursor: lifecycleBusy !== null ? 'not-allowed' : 'pointer', opacity: lifecycleBusy !== null ? .6 : 1, zIndex: 1, background: 'linear-gradient(135deg,#8B5CF6,#7C3AED,#5B21B6)', boxShadow: '0 4px 14px rgba(91,33,182,.44),inset 0 1px 0 rgba(255,255,255,.18)' }}>
            <span style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '50%', background: 'linear-gradient(180deg,rgba(255,255,255,.18),transparent)', borderRadius: '10px 10px 0 0', pointerEvents: 'none' }} />
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
            Create CTC Agreement
          </button>
        </div>
      </div>

      {/* CARD 2 — WHAT WE ARE DOING HERE */}
      <div style={{ background: t.surface, borderRadius: 14, border: `1px solid ${t.dark ? 'rgba(124,58,237,.3)' : 'rgba(124,58,237,.18)'}`, overflow: 'hidden', boxShadow: '0 2px 10px rgba(6,182,212,.04)' }}>
        <div style={{ position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, background: 'linear-gradient(180deg,#C4B5FD,#7C3AED,#5B21B6)', zIndex: 10 }} />
          <div onClick={() => setInfoOpen(!infoOpen)} style={{ position: 'relative', overflow: 'hidden', display: 'flex', alignItems: 'center', gap: 12, padding: '7px 12px 7px 16px', background: t.dark ? '#241a44' : 'linear-gradient(110deg,#F5F3FF 0%,#EDE9FE 35%,#DDD6FE 70%,#C4B5FD 100%)', borderBottom: infoOpen ? `1px solid ${t.dark ? 'rgba(124,58,237,.3)' : '#DDD6FE'}` : '1px solid transparent', cursor: 'pointer', userSelect: 'none', minHeight: 48 }}>
            <span style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '50%', pointerEvents: 'none', background: t.dark ? 'linear-gradient(180deg,rgba(255,255,255,.04),transparent)' : 'linear-gradient(180deg,rgba(255,255,255,.65),transparent)' }} />
            <div style={{ width: 36, height: 36, borderRadius: 11, flexShrink: 0, background: 'linear-gradient(135deg,#8B5CF6,#7C3AED,#5B21B6)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', position: 'relative', zIndex: 1, boxShadow: '0 0 0 3px rgba(124,58,237,.2),0 4px 12px rgba(91,33,182,.36)' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
            </div>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0, position: 'relative', zIndex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: '-.2px', color: t.dark ? '#c4b5fd' : '#7C3AED', lineHeight: 1, whiteSpace: 'nowrap', flexShrink: 0 }}>Case to Case Contracts</span>
                <span style={{ width: 1, height: 13, background: t.dark ? 'rgba(196,181,253,.4)' : '#C4B5FD', flexShrink: 0 }} />
                <span style={{ fontSize: 11, fontWeight: 800, color: t.dark ? '#ede9fe' : '#2e1065', letterSpacing: '-.2px', lineHeight: 1, whiteSpace: 'nowrap' }}>What We Are Doing Here</span>
              </div>
              <div style={{ fontSize: 9.5, fontWeight: 500, color: t.dark ? '#a78bfa' : '#5B21B6', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Manage case-to-case agreements from drafting, approval, negotiation, signing, and final contract storage.</div>
            </div>
            <div style={{ width: 26, height: 26, borderRadius: 8, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: t.dark ? 'rgba(255,255,255,.08)' : 'rgba(255,255,255,.78)', border: '1.5px solid rgba(124,58,237,.25)', color: t.dark ? '#c4b5fd' : '#7C3AED', transition: 'transform .24s', boxShadow: '0 1px 4px rgba(124,58,237,.12)', transform: infoOpen ? 'none' : 'rotate(-90deg)', position: 'relative', zIndex: 1 }}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
            </div>
          </div>
          <div className="ctc-stagegrid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', background: t.dark ? '#161226' : 'linear-gradient(180deg,#FAF8FF 0%,#F8FAFC 100%)', overflow: 'hidden', maxHeight: infoOpen ? 640 : 0, opacity: infoOpen ? 1 : 0, transition: 'max-height .3s cubic-bezier(.22,1,.36,1),opacity .22s' }}>
            {STAGE_CARDS.map((c, i) => (
              <div key={c.n} style={{ position: 'relative', padding: '10px 11px 11px', background: t.dark ? 'rgba(255,255,255,.03)' : '#fff', margin: '7px 5px', marginLeft: i === 0 ? 14 : 5, borderRadius: 11, border: `1.5px solid ${t.dark ? 'rgba(124,58,237,.22)' : '#EDE9FE'}`, transition: 'all .18s', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 1px 4px rgba(15,23,42,.04)' }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = '#C4B5FD'; e.currentTarget.style.boxShadow = '0 6px 18px rgba(124,58,237,.13)'; e.currentTarget.style.transform = 'translateY(-2px)'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = t.dark ? 'rgba(124,58,237,.22)' : '#EDE9FE'; e.currentTarget.style.boxShadow = '0 1px 4px rgba(15,23,42,.04)'; e.currentTarget.style.transform = ''; }}>
                <span style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, borderRadius: '11px 11px 0 0', background: 'linear-gradient(90deg,#A78BFA,#7C3AED)' }} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{ width: 16, height: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', color: t.dark ? '#a78bfa' : '#7C3AED' }}><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">{c.icon}</svg></div>
                  <span style={{ fontSize: 8.5, fontWeight: 800, letterSpacing: '.12em', textTransform: 'uppercase', color: t.textMuted, lineHeight: 1 }}>Stage {c.n}</span>
                </div>
                <div style={{ fontSize: 11, fontWeight: 800, color: t.text, letterSpacing: '-.2px', lineHeight: 1.25, marginBottom: 3, marginTop: 5 }}>{c.title}</div>
                <div style={{ fontSize: 9.5, fontWeight: 500, color: t.textMuted, lineHeight: 1.4 }}>{c.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* CARD 3 — CONTRACTS LIST */}
      <div ref={cardRef} style={{ background: t.surface, borderRadius: 14, padding: 0, overflow: 'hidden', border: `1px solid ${t.dark ? 'rgba(109,40,217,.3)' : 'rgba(109,40,217,.15)'}`, boxShadow: '0 2px 14px rgba(109,40,217,.08)', display: 'flex', flexDirection: 'column', minHeight: fillH }}>
        <div className="ctc-toolbar" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', background: t.surface, borderBottom: `1.5px solid ${t.dark ? 'rgba(124,58,237,.2)' : '#EDE9FE'}`, flexWrap: 'wrap' }}>
          {/* Tab rail — mirrors the Customer page's .smc-pill-group: a
              translucent rail with a violet hairline and gap-separated pills.
              On small screens it wraps to full width so the tabs never overflow
              (QA #42). */}
          <div className="ctc-tabrail" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: t.dark ? 'rgba(124,58,237,.10)' : 'rgba(255,255,255,.55)', border: `1px solid ${t.dark ? 'rgba(167,139,250,.20)' : 'rgba(139,92,246,.22)'}`, borderRadius: 11, padding: 4 }}>
            {([
              ['all', 'All Contracts', null, true],
              ['signed', 'Signed Contracts', '#10B981', false],
              ['inprogress', 'In Progress', '#F59E0B', false],
              ['rejected', 'Rejected / Unapproved', '#EF4444', false],
            ] as [CtcTab, string, string | null, boolean][]).map(([key, label, dot, hasIcon]) => {
              const active = tab === key;
              return (
                <button key={key} disabled={lifecycleBusy !== null} onClick={() => { setTab(key); setPage(1); }}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '0 14px', height: 34, borderRadius: 8, fontFamily: 'inherit', fontSize: 12.5, fontWeight: 700, cursor: lifecycleBusy !== null ? 'not-allowed' : 'pointer', opacity: lifecycleBusy !== null && !active ? .6 : 1, letterSpacing: 0, whiteSpace: 'nowrap', transition: 'background .16s, color .16s, box-shadow .16s, border-color .16s', position: 'relative', overflow: 'hidden',
                    ...(active
                      ? { border: 0, background: 'linear-gradient(135deg, #a78bfa 0%, #8b5cf6 35%, #7c3aed 68%, #5b21b6 100%)', color: '#fff', boxShadow: '0 5px 14px rgba(124,58,237,.5), 0 1px 0 rgba(255,255,255,.4) inset, 0 -2px 6px rgba(91,33,182,.3) inset', textShadow: '0 1px 2px rgba(76,29,149,.4)' }
                      : { background: t.dark ? 'linear-gradient(135deg, rgba(124,58,237,.16), rgba(124,58,237,.10))' : 'linear-gradient(135deg, #f5f1fe, #ede9fe)', border: `1px solid ${t.dark ? 'rgba(167,139,250,.25)' : 'rgba(139,92,246,.2)'}`, color: t.dark ? '#c4b5fd' : '#6d28d9' }) }}>
                  {active && <span style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '50%', background: 'linear-gradient(180deg,rgba(255,255,255,.18),transparent)', borderRadius: '8px 8px 0 0', pointerEvents: 'none' }} />}
                  {hasIcon
                    ? <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={active ? '#fff' : (t.dark ? '#c4b5fd' : '#6d28d9')} strokeWidth="2.5" strokeLinecap="round" style={{ position: 'relative', zIndex: 1, flexShrink: 0 }}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
                    : <span style={{ width: 8, height: 8, borderRadius: '50%', background: active ? 'rgba(255,255,255,.9)' : (dot || '#10B981'), flexShrink: 0 }} />}
                  <span style={{ position: 'relative', zIndex: 1 }}>{label}</span>
                  <span style={{ position: 'relative', zIndex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 20, height: 18, padding: '0 7px', borderRadius: 999, fontSize: 10, fontWeight: 800, lineHeight: 1,
                    ...(active
                      ? { color: '#fff', background: 'rgba(255,255,255,.24)', border: '1px solid rgba(255,255,255,.4)' }
                      : (t.dark ? { color: '#c4b5fd', background: 'rgba(124,58,237,.18)', border: '1px solid rgba(167,139,250,.30)' } : { color: '#7c3aed', background: '#fff', border: '1px solid #ddd0f7' })) }}>{counts[key]}</span>
                </button>
              );
            })}
          </div>
          <div className="ctc-hspacer" style={{ flex: 1 }} />
          <div className="ctc-searchbox" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 16px', borderRadius: 30, background: t.searchBg, border: `1.5px solid ${t.searchBorder}` }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#A78BFA" strokeWidth="2.4" strokeLinecap="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
            <input value={search} disabled={lifecycleBusy !== null} onChange={e => { setSearch(e.target.value); setPage(1); }} placeholder="Search by name, ID, company, type…"
              style={{ border: 'none', outline: 'none', fontFamily: 'inherit', fontSize: 12, fontWeight: 500, color: t.searchText, background: 'transparent', width: 230 }} />
          </div>
        </div>

        {/* TABLE */}
        <div style={{ background: t.tableBg, flex: 1, display: 'flex', flexDirection: 'column' }}>
          {!loading && slice.length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '56px 20px', textAlign: 'center', background: t.dark ? 'rgba(255,255,255,.02)' : '#FAFBFF' }}>
              <div style={{ width: 52, height: 52, borderRadius: 14, background: 'linear-gradient(135deg,#EDE9FE,#DDD6FE)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px', boxShadow: '0 4px 12px rgba(109,40,217,.12)' }}><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#7C3AED" strokeWidth="2" strokeLinecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg></div>
              <div style={{ fontSize: 13, fontWeight: 800, color: t.textStrong, marginBottom: 6 }}>No Contracts Found</div>
              <div style={{ fontSize: 11, color: t.textMuted, maxWidth: 300, lineHeight: 1.6 }}>Click <b>+ Create CTC Agreement</b> to add one.</div>
            </div>
          ) : (
            <>
            {/* Only the table scrolls horizontally; the pager lives OUTSIDE this
                container so it never inherits the table's 1380px min-width and
                stays pinned to the visible card width when the table scrolls. */}
            <div style={{ overflowX: 'auto', flex: 1 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1380 }}>
                <thead><tr>
                  {['SR NO', 'CTC ID', 'CTC DATE', 'AGREEMENT TITLE', 'OUR ORGANISATION', 'COUNTERPARTIES', 'CREATED BY', 'INTERNAL APPROVAL', 'EFF. DATE', 'EXPIRY DATE', 'CP SIGNED DATE', 'ACTION'].map((h, i) => (
                    <th key={h} style={{ ...TH, textAlign: i === 3 || i === 4 || i === 5 || i === 6 ? 'left' : 'center', width: [52, 124, 110, undefined, 155, 165, 136, 122, 100, 100, 122, 150][i] }}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {loading ? Array.from({ length: Math.max(1, pageSize) }).map((_, r) => (
                    <tr key={`shim-${r}`}>{Array.from({ length: 12 }).map((__, c) => <td key={c} style={{ ...TD }}><Shimmer height={14} /></td>)}</tr>
                  )) : slice.length === 0 ? (
                    <tr><td colSpan={12} style={{ ...TD, textAlign: 'center', padding: '36px 16px', color: t.textMuted, fontSize: 12, fontWeight: 600 }}>No contracts found.</td></tr>
                  ) : slice.map((c, i) => {
                    const n = start + i + 1;
                    const s = S_CFG[c.status];
                    const ap = AP_CFG[c.approval];
                    const apb = badgeTok(ap);
                    const isHover = hoverId === c.id;
                    // Drive the hover highlight from React state (not imperative
                    // DOM writes) so a re-render — download click, popover, search —
                    // can't reset a hovered row back to the whitish `rowAlt` stripe
                    // mid-hover (the "white flash / flicker" in dark mode).
                    const rowBg = isHover ? t.rowHover : (n % 2 === 0 ? t.rowAlt : t.tableBg);
                    const extra = c.cp.length - 1;
                    const cpS = c.cpSignedDate !== '—' ? c.cpSignedDate : (c.status === 'signed' ? c.date : '—');
                    return (
                      <tr key={c.id} style={{ background: rowBg, transition: 'background .12s', boxShadow: isHover ? 'inset 3px 0 0 #7C3AED' : 'none' }}
                        onMouseEnter={() => setHoverId(c.id)}
                        onMouseLeave={() => setHoverId(h => (h === c.id ? null : h))}>
                        <td style={{ ...TD, width: 52 }}><div style={{ width: 24, height: 24, borderRadius: '50%', background: 'linear-gradient(135deg,#6D28D9,#5B21B6)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 5px rgba(109,40,217,.3)' }}><span style={{ fontSize: 9, fontWeight: 900, color: '#fff' }}>{String(n).padStart(2, '0')}</span></div></td>
                        <td style={{ ...TD, width: 124 }}><span style={{ fontFamily: "'Geist Mono', monospace", fontSize: 10, fontWeight: 800, color: t.dark ? '#c4b5fd' : '#4C1D95', background: t.dark ? 'rgba(124,58,237,.2)' : 'linear-gradient(135deg,rgba(109,40,217,.1),rgba(124,58,237,.06))', padding: '3px 7px', borderRadius: 6, border: '1px solid rgba(124,58,237,.28)', whiteSpace: 'nowrap', letterSpacing: '.02em' }}>{c.id}</span></td>
                        <td style={{ ...TD, width: 110 }}><span style={{ fontSize: 10.5, fontWeight: 600, color: t.textSub, whiteSpace: 'nowrap' }}>{dashDate(c.date)}</span></td>
                        <td style={TDL}><Tooltip label={c.title}><div style={{ fontSize: 11.5, fontWeight: 700, color: t.textStrong, letterSpacing: '-.2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 190 }}>{c.title}</div></Tooltip></td>
                        <td style={{ ...TDL, width: 155 }}><div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><div style={{ width: 24, height: 24, borderRadius: 7, background: `linear-gradient(135deg,${orgGrad(c.org)})`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: '0 2px 5px rgba(109,40,217,.2)' }}><span style={{ fontSize: 8.5, fontWeight: 900, color: '#fff', letterSpacing: '-.3px' }}>{inits(c.org)}</span></div><Tooltip label={c.org}><span style={{ fontSize: 12, fontWeight: 600, color: t.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 105 }}>{c.org}</span></Tooltip></div></td>
                        <td style={{ ...TDL, width: 185 }}><div style={{ display: 'flex', alignItems: 'center', gap: 7 }}><div style={{ width: 24, height: 24, borderRadius: 7, background: 'linear-gradient(135deg,#6D28D9,#8B5CF6)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: '0 2px 5px rgba(109,40,217,.18)' }}><span style={{ fontSize: 8.5, fontWeight: 900, color: '#fff', letterSpacing: '-.3px' }}>{inits(c.cp[0])}</span></div><Tooltip label={(c.cpLabeled ?? c.cp).join(', ')}><span style={{ fontSize: 11, fontWeight: 600, color: t.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 100 }}>{c.cp[0]}</span></Tooltip>{extra > 0 && <Tooltip label="View all counterparties"><button onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setCpOpen(cpOpen?.id === c.id ? null : { id: c.id, names: c.cpLabeled ?? c.cp, x: r.left, y: r.bottom + 4 }); }} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 18, height: 18, padding: '0 5px', borderRadius: 20, background: 'linear-gradient(135deg,#6D28D9,#7C3AED)', color: '#fff', fontSize: 8.5, fontWeight: 800, flexShrink: 0, boxShadow: '0 2px 4px rgba(109,40,217,.28)', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>+{extra}</button></Tooltip>}</div></td>
                        <td style={{ ...TDL, width: 136 }}><div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><div style={{ width: 22, height: 22, borderRadius: '50%', background: 'linear-gradient(135deg,#C4B5FD,#A78BFA)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, border: '1.5px solid #DDD6FE' }}><span style={{ fontSize: 8, fontWeight: 900, color: '#4C1D95' }}>{inits(c.createdBy)}</span></div><span style={{ fontSize: 10.5, fontWeight: 600, color: t.text, whiteSpace: 'nowrap' }}>{c.createdBy}</span></div></td>
                        <td style={{ ...TD, width: 122 }}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 8px', borderRadius: 20, background: apb.bg, border: `1px solid ${apb.border}`, whiteSpace: 'nowrap' }}><span style={{ width: 5, height: 5, borderRadius: '50%', background: ap.dot, flexShrink: 0, boxShadow: `0 0 5px ${ap.dot}60` }} /><span style={{ fontSize: 9.5, fontWeight: 700, color: apb.text }}>{ap.label}</span></span></td>
                        <td style={{ ...TD, width: 100 }}><span style={{ fontSize: 10.5, fontWeight: 600, color: c.effDate === '—' ? '#C4B5FD' : t.textSub, whiteSpace: 'nowrap' }}>{dashDate(c.effDate)}</span></td>
                        <td style={{ ...TD, width: 100 }}><span style={{ fontSize: 10.5, fontWeight: 600, color: c.endDate === '—' ? '#C4B5FD' : t.textSub, whiteSpace: 'nowrap' }}>{dashDate(c.endDate)}</span></td>
                        <td style={{ ...TD, width: 122 }}>{cpS === '—' ? <span style={{ fontSize: 11.5, fontWeight: 600, color: '#C4B5FD' }}>—</span> : <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10.5, fontWeight: 700, color: '#059669', whiteSpace: 'nowrap' }}><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12" /></svg>{dashDate(cpS)}</span>}</td>
                        <td style={{ ...TD, width: 150 }}>
                          {(() => {
                            // Freeze the whole row's actions while a version /
                            // timeline load is in flight (QA #40); the clicked
                            // history/timeline button keeps its own spinner.
                            const verBusy = lifecycleBusy?.id === c.id && lifecycleBusy?.kind === 'version';
                            const tlBusy  = lifecycleBusy?.id === c.id && lifecycleBusy?.kind === 'timeline';
                            const frozen  = lifecycleBusy !== null || downloadingId !== null;
                            return (
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3 }}>
                            <ActBtn t={t} tone="green" title="Download signed copy / latest PDF" busy={downloadingId === c.id} busyLabel="Downloading…" disabled={frozen} onClick={() => downloadContract(c)}>
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
                            </ActBtn>
                            {/* Once signed, the agreement is locked → show a view (eye) icon
                                instead of edit; opening it lands on the view-only stage. */}
                            {c.status === 'signed' ? (
                              <ActBtn t={t} tone="violet" title="View CTC" disabled={frozen} onClick={() => { setEditing(c); setFormOpen(true); }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg></ActBtn>
                            ) : (
                              <ActBtn t={t} tone="violet" title="Edit CTC" disabled={frozen} onClick={() => { setEditing(c); setFormOpen(true); }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4z" /></svg></ActBtn>
                            )}
                            <ActBtn t={t} tone="blue" title="Version History" busy={verBusy} busyLabel="Loading…" disabled={frozen && !verBusy} onClick={() => openLifecycle(c, 'version')}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="12 8 12 12 14 14" /><path d="M3.05 11a9 9 0 1 1 .5 4m-.5 5v-5h5" /></svg></ActBtn>
                            <ActBtn t={t} tone="amber" title="Agreement Timeline" busy={tlBusy} busyLabel="Loading…" disabled={frozen && !tlBusy} onClick={() => openLifecycle(c, 'timeline')}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg></ActBtn>
                          </div>
                            );
                          })()}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </div>
              <div className="tc-wl-pag" style={{ margin: 0 }}>
                <span className="tc-wl-info">
                  {list.length === 0
                    ? 'No records'
                    : <>Showing <span className="tc-wl-hl">{start + 1}–{Math.min(start + pageSize, list.length)}</span> of <span className="tc-wl-hl">{list.length}</span></>}
                </span>
                <div className="tc-wl-right">
                  <span className="tc-wl-rows">
                    Rows per page:
                    <select value={pageSize} onChange={e => { setManualSize(true); setPageSize(parseInt(e.target.value, 10)); setPage(1); }}>
                      {[...new Set([pageSize, ...PAGE_SIZE_OPTIONS])].sort((a, b) => a - b).map(n => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </span>
                  <span className="tc-wl-range">{safe} / {totalPages}</span>
                  <div className="tc-wl-nav">
                    <button type="button" className="tc-wl-btn" disabled={safe <= 1 || lifecycleBusy !== null} onClick={() => setPage(p => Math.max(1, p - 1))} aria-label="Previous page">
                      <i className="ri-arrow-left-s-line"></i>
                    </button>
                    <button type="button" className="tc-wl-btn" disabled={safe >= totalPages || lifecycleBusy !== null} onClick={() => setPage(p => Math.min(totalPages, p + 1))} aria-label="Next page">
                      <i className="ri-arrow-right-s-line"></i>
                    </button>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {verFor && <VersionHistoryModal t={t} code={verFor.code} workingId={verFor.dbId} versions={verFor.versions} onClose={() => setVerFor(null)} />}
      {tlFor && <AgreementTimelineModal t={t} code={tlFor.code} title={tlFor.title} stage={tlFor.stage} versions={tlFor.versions} signers={tlFor.signers} onClose={() => setTlFor(null)} />}

      {/* All-counterparties popover (opened from the +N badge) */}
      {cpOpen && (
        <>
          <div onClick={() => setCpOpen(null)} style={{ position: 'fixed', inset: 0, zIndex: 600 }} />
          <div style={{ position: 'fixed', left: Math.min(cpOpen.x, window.innerWidth - 240), top: cpOpen.y, zIndex: 601, width: 220, maxHeight: 280, overflowY: 'auto', background: t.surface, borderRadius: 12, border: `1.5px solid ${t.dark ? 'rgba(124,58,237,.35)' : '#DDD6FE'}`, boxShadow: '0 16px 40px rgba(0,0,0,.28)', padding: 8, fontFamily: 'var(--font-sans)' }}>
            <div style={{ fontSize: 7.5, fontWeight: 800, letterSpacing: '.1em', textTransform: 'uppercase', color: t.dark ? '#c4b5fd' : '#6D28D9', padding: '4px 8px 7px' }}>Counterparties ({cpOpen.names.length})</div>
            {cpOpen.names.map((name, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 8px', borderRadius: 8, background: i % 2 ? (t.dark ? 'rgba(255,255,255,.03)' : '#FAFBFF') : 'transparent' }}>
                <div style={{ width: 22, height: 22, borderRadius: 7, background: 'linear-gradient(135deg,#6D28D9,#8B5CF6)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><span style={{ fontSize: 8, fontWeight: 900, color: '#fff' }}>{inits(name)}</span></div>
                <Tooltip label={name}><span style={{ fontSize: 11, fontWeight: 600, color: t.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</span></Tooltip>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

const ACT_TONES = {
  green:  { light: { bg: '#D1FAE5', border: '#6EE7B7', color: '#047857' }, dark: { bg: 'rgba(16,185,129,.16)',  border: 'rgba(16,185,129,.42)', color: '#6ee7b7' } },
  violet: { light: { bg: '#EDE9FE', border: '#C4B5FD', color: '#5B21B6' }, dark: { bg: 'rgba(124,58,237,.18)', border: 'rgba(124,58,237,.45)', color: '#c4b5fd' } },
  blue:   { light: { bg: '#DBEAFE', border: '#93C5FD', color: '#0369A1' }, dark: { bg: 'rgba(56,189,248,.16)',  border: 'rgba(56,189,248,.42)', color: '#7dd3fc' } },
  amber:  { light: { bg: '#FEF3C7', border: '#FCD34D', color: '#B45309' }, dark: { bg: 'rgba(245,158,11,.16)',  border: 'rgba(245,158,11,.42)', color: '#fcd34d' } },
} as const;

function ActBtn({ t, tone, title, onClick, children, busy, busyLabel, disabled }: { t: OpsTokens; tone: keyof typeof ACT_TONES; title: string; onClick: () => void; children: React.ReactNode; busy?: boolean; busyLabel?: string; disabled?: boolean }) {
  const s = t.dark ? ACT_TONES[tone].dark : ACT_TONES[tone].light;
  // `busy`     → this button's own async op (spinner, wait cursor).
  // `disabled` → frozen because ANOTHER action is loading (dimmed, no spinner).
  const off = busy || disabled;
  return (
    <Tooltip label={busy ? (busyLabel ?? 'Loading…') : (disabled ? 'Please wait…' : title)}>
      <button onClick={onClick} aria-label={title} disabled={off} style={{ width: 26, height: 26, borderRadius: 7, border: `1.5px solid ${s.border}`, background: s.bg, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: busy ? 'wait' : disabled ? 'not-allowed' : 'pointer', color: s.color, opacity: busy ? 1 : disabled ? .4 : .85, flexShrink: 0, transition: 'all .15s' }}
        onMouseEnter={e => { if (off) return; e.currentTarget.style.opacity = '1'; e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 3px 8px rgba(0,0,0,.15)'; }}
        onMouseLeave={e => { if (off) return; e.currentTarget.style.opacity = '.85'; e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = 'none'; }}>
        {busy
          ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" style={{ animation: 'ctcSpin .7s linear infinite' }}><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
          : children}
      </button>
    </Tooltip>
  );
}

const CTC_CSS = `
@keyframes ctcFade { from { opacity:0 } to { opacity:1 } }
@keyframes ctcSpin { to { transform: rotate(360deg) } }

/* ── Responsive layout (QA #42) ──
   On narrow screens: the header title + Create button stack; the stage cards
   go 2-per-row; the tab rail goes full width with 2 tabs per row; and the
   search takes the next row at full width. The wide table already scrolls
   horizontally on its own. */
@media (max-width: 860px) {
  .ctc-header-strip { flex-direction: column; align-items: stretch; gap: 12px; padding: 14px 16px; min-height: 0; }
  /* Drop the extra indent so the title block lines up flush with the full-width
     Create button below it, and let the title sit at a calmer size. */
  .ctc-header-titlewrap { padding-left: 6px !important; }
  .ctc-header-title { font-size: 15px !important; }
  .ctc-header-strip > button { width: 100%; justify-content: center; }
  .ctc-stagegrid { grid-template-columns: repeat(2, 1fr) !important; }
  .ctc-tabrail { flex-wrap: wrap; width: 100%; justify-content: flex-start; }
  .ctc-tabrail > button { flex: 1 1 calc(50% - 4px); justify-content: center; }
  .ctc-hspacer { display: none; }
  .ctc-searchbox { width: 100%; }
  .ctc-searchbox input { width: 100% !important; }
}
/* Phones: two-per-row squeezes the long "Rejected / Unapproved" tab and clips
   it. Give each tab its OWN full-width row so the label + count always fit and
   the pills read as a clean, uniform, easy-to-tap filter list. */
@media (max-width: 560px) {
  .ctc-toolbar { padding: 12px !important; gap: 8px !important; }
  .ctc-tabrail { width: 100%; gap: 6px; }
  .ctc-tabrail > button { flex: 1 1 100% !important; justify-content: flex-start; height: 40px; }
  /* Push the count badge to the far right so every row lines up. */
  .ctc-tabrail > button > span:last-child { margin-left: auto; }
}
`;
