import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useToast } from '../../../contexts/ToastContext';
import { useAuth } from '../../../contexts/AuthContext';
import { getEcho } from '../../../echo';
import { useTyping } from '../../../hooks/useTyping';
import { TypingIndicator } from '../../../components/TypingIndicator';
import api from '../../../api';
import {
  type AwsContract, type Clarification,
  inits, pad2, PER_PAGE,
} from './clmOpsData';
import { useOpsTheme, OPS_SEARCH_CSS, type OpsTokens } from './useOpsTheme';
import WorklistPager from '../../../components/ui/WorklistPager';
import { VersionHistoryModal, AgreementTimelineModal, type CtcVersion, type CtcSigner } from './clmCtcModals';
import { ShimmerTable } from '../../../components/ui/Shimmer';
import Tooltip from '../../../components/ui/Tooltip';
import SearchClear from '../../../components/ui/SearchClear';

type SentRow = AwsContract & { dbId: number; approver: string; clarifications: Clarification[]; rejReason?: string; expDate: string };


type AwsTab = 'all' | 'approved' | 'pending' | 'rejected' | 'clarify';

/* The tab rail's icons — the same change Case to Case got, on this page's five
 * tabs. Four coloured dots (green / amber / red / violet) named nothing a
 * reader could say out loud, and the violet one was the odd member of a cyan
 * page. Built to the P2P convention (SCOPE_TABS in InvoiceList.tsx): a 15px
 * glyph on a 24-unit grid at strokeWidth 2.1, round caps and joins, and
 * stroke="currentColor" so each icon takes its tab's own colour — white when
 * selected, cyan when not — rather than every state naming a hex.
 *
 * "All Contracts" carries the list glyph P2P uses for its own All tab, so the
 * modules read the same way. */
const AWS_TAB_ICO = (d: React.ReactNode) => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>{d}</svg>
);

const AWS_TABS: Array<{ key: AwsTab; label: string; icon: React.ReactNode }> = [
  {
    key: 'all', label: 'All Contracts',
    icon: AWS_TAB_ICO(<>
      <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" /><line x1="3" y1="6" x2="3.01" y2="6" />
      <line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" />
    </>),
  },
  {
    key: 'approved', label: 'Approved Contracts',
    icon: AWS_TAB_ICO(<>
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
    </>),
  },
  {
    key: 'pending', label: 'Pending Contracts',
    icon: AWS_TAB_ICO(<>
      <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
    </>),
  },
  {
    key: 'rejected', label: 'Rejected Contracts',
    icon: AWS_TAB_ICO(<>
      <circle cx="12" cy="12" r="10" />
      <line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
    </>),
  },
  {
    /* A speech bubble: a clarification is a question asked back, not a state. */
    key: 'clarify', label: 'Clarifications',
    icon: AWS_TAB_ICO(<>
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5Z" />
    </>),
  },
];

const rowSearchText = (c: SentRow): string => {
  const out: string[] = [];
  const walk = (v: unknown) => {
    if (v == null) return;
    if (Array.isArray(v)) v.forEach(walk);
    else if (typeof v === 'object') Object.values(v as Record<string, unknown>).forEach(walk);
    else { const s = String(v); out.push(s, s.replace(/\s+/g, '-')); }
  };
  walk(c);
  out.push(AP_CFG[c.approval as keyof typeof AP_CFG]?.label ?? '');
  return out.join(' ').toLowerCase();
};
const isRejectedRow = (c: SentRow): boolean => c.status === 'rejected' || c.approval === 'rejected';
const isClarifyRow  = (c: SentRow): boolean => c.status === 'clarify' || (c.clarifications?.length ?? 0) > 0;

const matchesSearch = (c: SentRow, q: string): boolean => {
  const hay = rowSearchText(c);
  return q.toLowerCase().split(/\s+/).filter(Boolean).every(w => hay.includes(w));
};

const AP_CFG = {
  /* Green, the same set Agreements To Approve uses (ATA_ST.approved) and the
     same green the Approved Agreements KPI card above this table is accented
     with. It used to be a half-conversion — cyan fill and cyan text already
     carrying the green border — so Approved read as "just another cyan thing"
     on a cyan page while Pending and Rejected carried their own colour. */
  approved: { label: 'Approved', bg: '#ECFDF5', border: '#A7F3D0', color: '#059669', dot: '#10B981' },
  pending:  { label: 'Pending',  bg: '#FFFBEB', border: '#FDE68A', color: '#D97706', dot: '#F59E0B' },
  rejected: { label: 'Rejected', bg: '#FEF2F2', border: '#FECACA', color: '#DC2626', dot: '#EF4444' },
} as const;

const dashDate = (s: string): string => (s && s !== '—' ? s.replace(/\s+/g, '-') : s);

export default function ClmAgreementsSentPage() {
  const toast = useToast();
  const { user } = useAuth();
  const navigate = useNavigate();
  const t = useOpsTheme('cyan');
  const [tab, setTab]     = useState<AwsTab>('all');
  const [page, setPage]   = useState(1);
  const [search, setSearch] = useState('');
  const [dlOpen, setDlOpen] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [lifecycleBusy, setLifecycleBusy] = useState<{ id: string; kind: 'version' | 'timeline' } | null>(null);
  const [pageSize, setPageSize] = useState(PER_PAGE);
  const autoFitRef = useRef(true);
  const onPageSize = (n: number) => { autoFitRef.current = false; setPageSize(n); setPage(1); };
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [fillH, setFillH] = useState<number | undefined>(undefined);
  const [respondId, setRespondId] = useState<string | null>(null);
  const [cpOpen, setCpOpen] = useState<{ id: string; names: string[]; x: number; y: number } | null>(null);
  useEffect(() => {
    if (!cpOpen) return;
    const close = (e: Event) => {
      if (e.type === 'scroll' && e.target instanceof Element && e.target.closest('.aws-cp-pop')) return;
      setCpOpen(null);
    };
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => { window.removeEventListener('scroll', close, true); window.removeEventListener('resize', close); };
  }, [cpOpen]);

  const [sent, setSent] = useState<SentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const load = () => {
    setLoading(true);
    api.get('/clm/ctc-contracts/sent')
      .then(r => setSent(r.data?.data ?? []))
      .catch(() => { setSent([]); toast.error('Could not load agreements', 'Please refresh and try again.'); })
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  useEffect(() => {
    const echo = getEcho();
    const cid = user?.client_id;
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    let name: string | null = null;
    if (echo && cid) {
      name = `clm.approvals.${cid}`;
      echo.private(name).listen('.approval.updated', () => load());
    }
    return () => {
      window.removeEventListener('focus', onFocus);
      if (echo && name) echo.leave(name);
    };
  }, [user?.client_id]); // eslint-disable-line react-hooks/exhaustive-deps

  const counts = useMemo(() => ({
    all:      sent.length,
    approved: sent.filter(c => c.status === 'approved').length,
    pending:  sent.filter(c => c.status === 'pending').length,
    rejected: sent.filter(isRejectedRow).length,
    clarify:  sent.filter(isClarifyRow).length,
  }), [sent]);

  const filtered = useMemo(() => {
    const q = search.trim();
    let list = sent;
    if (q) list = list.filter(c => matchesSearch(c, q));
    if (tab === 'approved') return list.filter(c => c.status === 'approved');
    if (tab === 'pending')  return list.filter(c => c.status === 'pending');
    if (tab === 'rejected') return list.filter(isRejectedRow);
    return list;
  }, [search, tab, sent]);

  const clarifyList = useMemo(() => {
    const q = search.trim();
    const list = sent.filter(isClarifyRow);
    return q ? list.filter(c => matchesSearch(c, q)) : list;
  }, [sent, search]);

  const respondContract = sent.find(c => c.id === respondId) || null;

  const submitResponse = async (id: string, text: string) => {
    const row = sent.find(x => x.id === id);
    setRespondId(null);
    if (!row?.dbId) return;
    try {
      await api.post(`/clm/ctc-contracts/${row.dbId}/respond`, { response: text });
      toast.success('Clarification submitted', `Response sent to ${row.approver ?? 'approver'}`);
      load();
    } catch { toast.error('Could not submit', 'Please try again.'); }
  };

  type CtcDetail = { code: string; title: string; dbId: number | null; stage: number; versions: CtcVersion[]; signers: CtcSigner[]; signatureRequestId: number | null };
  const [verFor, setVerFor] = useState<CtcDetail | null>(null);
  const [tlFor, setTlFor] = useState<CtcDetail | null>(null);
  const openLifecycle = async (c: SentRow, kind: 'version' | 'timeline') => {
    if (!c.dbId) { toast.error('Not available', 'This agreement has no saved record yet.'); return; }
    if (lifecycleBusy) return;
    setLifecycleBusy({ id: c.id, kind });
    try {
      const res = await api.get(`/clm/ctc-contracts/${c.dbId}`);
      const r = (res.data?.data ?? res.data ?? {}) as Record<string, unknown>;
      const detail: CtcDetail = {
        code: String(r.code ?? c.id), title: String(r.title ?? c.title ?? ''), dbId: c.dbId, stage: Number(r.stage) || 1,
        versions: (Array.isArray(r.versions) ? r.versions : []) as CtcVersion[],
        signers: (Array.isArray(r.signing_recipients) ? r.signing_recipients : []) as CtcSigner[],
        signatureRequestId: Number(r.signature_request_id) || null,
      };
      if (kind === 'version') setVerFor(detail); else setTlFor(detail);
    } catch { toast.error('Could not load', 'Failed to fetch the agreement history.'); }
    finally { setLifecycleBusy(null); }
  };

  const downloadContract = async (c: SentRow, fmt: string) => {
    if (!c.dbId) { toast.error('Not available', 'This agreement has no saved record yet.'); return; }
    if (downloadingId) return;
    setDownloadingId(c.id);
    const docx = fmt === 'DOCX';
    const grab = async (url: string, name: string) => {
      const f = await api.get(url, { responseType: 'blob' });
      const u = URL.createObjectURL(f.data as Blob);
      const a = document.createElement('a'); a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(u);
    };
    try {
      const res = await api.get(`/clm/ctc-contracts/${c.dbId}`);
      const r = (res.data?.data ?? res.data ?? {}) as Record<string, unknown>;
      if (!docx) {
        const signedUrl = String(r.signed_document_url ?? '');
        const srId = Number(r.signature_request_id) || null;
        if (signedUrl && srId) {
          try { await grab(`/clm/signature-requests/${srId}/download-file/0`, `${c.id}-signed.pdf`); toast.success('Signed copy downloaded', c.id); return; }
          catch { window.open(signedUrl, '_blank'); return; }
        }
      }
      const versions = (Array.isArray(r.versions) ? r.versions : []) as { v: number }[];
      const latestV = versions.length ? Math.max(...versions.map(v => Number(v.v) || 0)) : 1;
      await grab(`/clm/ctc-contracts/${c.dbId}/versions/${latestV}/download${docx ? '?format=docx' : ''}`, `${c.id}.${docx ? 'docx' : 'pdf'}`);
      toast.success('Download started', `${c.id} · ${fmt}`);
    } catch { toast.error('Download failed', `Could not download the ${fmt} file.`); }
    finally { setDownloadingId(null); }
  };

  useEffect(() => {
    const recompute = () => {
      const el = cardRef.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top;
      const fh = Math.max(240, window.innerHeight - top - 56);
      setFillH(prev => (prev === fh ? prev : fh));

      const toolbarH = (el.querySelector('.aws-toolbar') as HTMLElement | null)?.offsetHeight || 0;
      const theadH   = (el.querySelector('table thead') as HTMLElement | null)?.offsetHeight || 0;
      const rowH     = (el.querySelector('table tbody tr') as HTMLElement | null)?.offsetHeight || 48;
      const pagerH   = (el.querySelector('.wl-pager') as HTMLElement | null)?.offsetHeight || 54;
      const rowsFit  = Math.floor((fh - toolbarH - theadH - pagerH - 20) / rowH);
      if (!autoFitRef.current) return;
      setPageSize(prev => { const next = Math.max(4, rowsFit); return prev === next ? prev : next; });
    };
    recompute();
    const raf = requestAnimationFrame(recompute);
    const tm = window.setTimeout(recompute, 120);
    window.addEventListener('resize', recompute);
    return () => { window.removeEventListener('resize', recompute); window.clearTimeout(tm); cancelAnimationFrame(raf); };
  }, [loading, tab, sent.length]);

  return (
    <div style={{ padding: 0, display: 'flex', flexDirection: 'column', gap: 8, fontFamily: 'var(--font-sans)' }}>
      <style>{AWS_CSS + OPS_SEARCH_CSS}</style>

      {(downloadingId !== null || lifecycleBusy !== null) && createPortal(
        <div style={{ position: 'fixed', inset: 0, zIndex: 2000000, background: 'rgba(8,47,73,.55)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 15, fontFamily: 'var(--font-sans)' }}>
          <svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="#67e8f9" strokeWidth="2.4" strokeLinecap="round" style={{ animation: 'awsSpin .7s linear infinite' }}><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
          <div style={{ fontSize: 15, fontWeight: 800, color: '#fff' }}>{downloadingId !== null ? 'Preparing your download…' : 'Loading…'}</div>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,.72)' }}>Please wait — don't leave this page.</div>
        </div>, document.body)}

      {/* Strip sized like Supplier Management's — .s360m .cstrip in
          shipment-360.css: 58px tall on 20px of side padding, 16px radius. */}
      <div style={{ position: 'relative', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 20px', minHeight: 58, border: `1px solid ${t.dark ? 'rgba(6,182,212,.25)' : 'rgba(6,182,212,.3)'}`, borderRadius: 16, background: t.dark ? '#102234' : 'linear-gradient(110deg,#ecfffe 0%,#cffafe 25%,#a5f3fc 55%,#67e8f9 80%,#22d3ee 100%)', boxShadow: t.dark ? '0 2px 10px rgba(6,182,212,.1)' : '0 2px 0 rgba(255,255,255,.88) inset,0 4px 18px rgba(6,182,212,.2)' }}>
        <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, background: 'linear-gradient(180deg,#22d3ee,#0891b2,#0e7490)', borderRadius: '16px 0 0 16px' }} />
        {!t.dark && <span style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '50%', background: 'linear-gradient(180deg,rgba(255,255,255,.52),transparent)', pointerEvents: 'none', borderRadius: '16px 16px 0 0' }} />}
        <div style={{ display: 'flex', alignItems: 'center', gap: 13, zIndex: 1, paddingLeft: 10 }}>
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <div style={{ width: 38, height: 38, borderRadius: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg,#0891b2,#0e7490)', boxShadow: '0 0 0 3px rgba(6,182,212,.25),0 4px 12px rgba(8,145,178,.4)' }}>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" fill="rgba(255,255,255,.2)" stroke="#fff" strokeWidth="2" /></svg>
            </div>
            <span style={{ position: 'absolute', bottom: -1, right: -1, width: 9, height: 9, borderRadius: '50%', background: 'linear-gradient(135deg,#4ade80,#22c55e)', border: '2px solid #cef8ff', boxShadow: '0 0 6px rgba(34,197,94,.4)' }} />
          </div>
          {/* min-width:0 is what lets the subtitle below ellipsise: without it a
              flex item refuses to shrink past its content and the text wraps
              instead of being cut. */}
          <div style={{ minWidth: 0, flex: 1 }}>
            {/* No ACTIVE badge — same as Agreements To Approve: hard-coded,
                never off, and reporting only that the page exists. */}
            <div style={{ fontSize: 14.5, fontWeight: 700, color: t.dark ? '#67e8f9' : '#0c4a6e', letterSpacing: '-.4px', lineHeight: 1.2, marginBottom: 3 }}>Agreements We Sent</div>
            {/* One line, as .clm-head-strip-sub does it on every other CLM page.
                This carried maxWidth: 580 instead, which wrapped "and signing."
                onto a second line and made the strip a row taller than the rest
                of the module — with the whole right-hand half of the band empty.
                nowrap + ellipsis instead, so a narrow viewport cuts the sentence
                rather than growing the band. */}
            <div style={{ fontSize: 10, fontWeight: 500, color: t.dark ? '#7dd3fc' : '#0e7490', opacity: .85, lineHeight: 1.3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Track agreements created by us and sent to counterparties for approval, clarification, negotiation, and signing.</div>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8 }}>
        <SummaryCard t={t} accent="#06b6d4,#0891b2" value={counts.all} label="Total Agreements"
          icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="8" y1="13" x2="16" y2="13" /><line x1="8" y1="17" x2="12" y2="17" /></svg>} />
        <SummaryCard t={t} accent="#f59e0b,#d97706" value={counts.pending} label="Pending Agreements"
          icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>} />
        <SummaryCard t={t} accent="#10b981,#059669" value={counts.approved} label="Approved Agreements"
          icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round"><polyline points="20 6 9 17 4 12" /></svg>} />
        <SummaryCard t={t} accent="#ef4444,#dc2626" value={counts.rejected} label="Rejected Agreements"
          icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></svg>} />
      </div>

      <div ref={cardRef} style={{ background: t.surface, borderRadius: 14, border: `1.5px solid ${t.dark ? t.border : '#B2EBF2'}`, boxShadow: '0 1px 4px rgba(6,182,212,.07)', overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: fillH }}>
        {/* gap 8, the CLM toolbar band — see .clm-tabs-bar in clmShared.ts. */}
        {/* nowrap, with min-width 0 — these go together, and the pair is why
            the search no longer drops to its own line on a 1366 laptop.
            .ops-search is flex: 0 0 500px, a rigid 500. Five tabs with their
            count pills come to roughly 850, and 850 + 8 + 500 + 16 of padding
            overflows the content column at that width, so the toolbar's own
            wrap caught the search and put it below the rail. Wrap comes back
            under 900px, where stacking is the right answer rather than an
            accident. */}
        <div className="aws-toolbar" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 8, background: t.surface, borderBottom: `1.5px solid ${t.dark ? t.border : 'rgba(6,182,212,.18)'}`, flexWrap: 'nowrap', flexShrink: 0, minWidth: 0 }}>
          {/* The employee list's rail — its `hr-dt` skin, not the base .dt-tabs
              rule — on the teal ramp. See the longer note on Case to Case.
              3px of padding puts the rail at 42, which is .ops-search. */}
          <div className="aws-tabrail" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, borderRadius: 11, padding: 3, height: 48, boxSizing: 'border-box',
            /* The rail is what gives way first: it shrinks and scrolls its
               tabs sideways rather than shoving the search onto a second row.
               min-width 0 is what allows that at all — a flex item will not
               go below its content without it. */
            flex: '0 1 auto', minWidth: 0, overflowX: 'auto', overflowY: 'hidden',
            ...(t.dark
              ? { background: 'rgba(8,145,178,.08)', border: '1px solid rgba(8,145,178,.22)' }
              : { background: 'linear-gradient(180deg, #f6feff, #f0fdff)', border: '1px solid #c9f8fd' }) }}>
            {AWS_TABS.map(({ key, label, icon }) => {
              const active = tab === key;
              return (
                <button key={key} onClick={() => { setTab(key); setPage(1); }}
                  /* Hover, which this rail had none of — the tabs are
                     inline-styled, so a CSS :hover would lose to the inline
                     background and the only feedback was the cursor. Same wash
                     Case to Case gets from .ctc-tabrail > button:hover. The
                     selected tab is skipped: it is already filled, and washing
                     it would mean restoring a gradient on the way out. */
                  onMouseEnter={e => { if (active) return; e.currentTarget.style.background = t.dark ? 'rgba(255,255,255,.08)' : '#fff'; e.currentTarget.style.color = t.dark ? '#a5f3fc' : '#0891b2'; e.currentTarget.style.boxShadow = t.dark ? '0 2px 6px rgba(0,0,0,.35)' : '0 2px 6px rgba(16,24,40,.12)'; }}
                  onMouseLeave={e => { if (active) return; e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = t.dark ? '#67e8f9' : '#0e7490'; e.currentTarget.style.boxShadow = 'none'; }}
                  style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '0 14px', height: 40,
                    border: 0, borderRadius: 8,
                    fontFamily: 'var(--font-sans)', fontSize: 12.5, fontWeight: 650, letterSpacing: 0,
                    cursor: 'pointer', whiteSpace: 'nowrap', transition: 'background .16s, color .16s, box-shadow .16s',
                    ...(active
                      /* Lift only, no inset. The inset 0 1px 0 rgba(255,255,255,.25)
                         drew a crisp white line along the tab's top edge, which
                         reads as a border the selected tab should not have. */
                      ? { background: 'linear-gradient(135deg, #22d3ee, #0891b2 55%, #0e7490)', color: '#fff', boxShadow: '0 6px 16px -5px rgba(8,145,178,.55)' }
                      /* No shadow at rest — Case to Case, the rail these are
                         measured against, has none. A 1px shadow on a
                         transparent tab still draws a card edge, so four of
                         them read as outlined boxes in the capsule instead of
                         one band with a selection in it. */
                      : { background: 'transparent', boxShadow: 'none', color: t.dark ? '#67e8f9' : '#0e7490' }) }}>
                  {icon}
                  <span>{label}</span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 28, height: 18, padding: '0 6px', borderRadius: 999, fontSize: 10, fontWeight: 700, lineHeight: 1, fontVariantNumeric: 'tabular-nums', border: '1px solid',
                    ...(active
                      ? (t.dark
                        ? { background: 'rgba(0,0,0,.28)', borderColor: 'rgba(255,255,255,.22)', color: '#fff' }
                        : { background: 'rgba(255,255,255,.9)', borderColor: 'rgba(255,255,255,.75)', color: '#155e75' })
                      : (t.dark
                        ? { background: 'rgba(8,145,178,.14)', borderColor: 'rgba(8,145,178,.30)', color: '#67e8f9' }
                        : { background: '#ccfbf1', borderColor: '#a5e8f5', color: '#0e7490' })) }}>{counts[key]}</span>
                </button>
              );
            })}
          </div>
          <div className="aws-hspacer" style={{ flex: 1 }} />
          <div className="ops-search ops-search--cyan aws-searchbox">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={t.dark ? '#67e8f9' : '#0891b2'} strokeWidth="2.4" strokeLinecap="round" style={{ flexShrink: 0 }}><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
            <input autoComplete="off" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} placeholder="Search agreements…" />
              <SearchClear show={search} onClear={() => { setSearch(''); setPage(1); }} />
          </div>
        </div>

        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          {loading
            ? <ShimmerTable rows={6} cols={11} />
            : tab === 'clarify'
            ? <ClarifyTable searching={!!search.trim()} rows={clarifyList} page={page} setPage={setPage} pageSize={pageSize} onPageSize={onPageSize} onRespond={setRespondId} t={t} />
            : tab === 'rejected'
              ? <RejectedTable searching={!!search.trim()} rows={filtered} ata={sent} page={page} setPage={setPage} pageSize={pageSize} onPageSize={onPageSize} dlOpen={dlOpen} setDlOpen={setDlOpen} downloadingId={downloadingId} onDownload={downloadContract} t={t} />
              : <StandardTable searching={!!search.trim()} rows={filtered} page={page} setPage={setPage} pageSize={pageSize} onPageSize={onPageSize} tab={tab} dlOpen={dlOpen} setDlOpen={setDlOpen} downloadingId={downloadingId} lifecycleBusy={lifecycleBusy} cpOpen={cpOpen} setCpOpen={setCpOpen} onVersion={(c) => openLifecycle(c, 'version')} onTimeline={(c) => openLifecycle(c, 'timeline')} onDownload={downloadContract} onEdit={(c) => navigate(`/clm/case-to-case?edit=${c.dbId}`)} toast={toast} t={t} />}
        </div>
      </div>

      {respondContract && (
        <RespondModal contract={respondContract} onClose={() => setRespondId(null)} onSubmit={submitResponse} t={t} />
      )}

      {verFor && <VersionHistoryModal t={t} code={verFor.code} workingId={verFor.dbId} versions={verFor.versions} onClose={() => setVerFor(null)} />}
      {tlFor && <AgreementTimelineModal t={t} code={tlFor.code} title={tlFor.title} stage={tlFor.stage} versions={tlFor.versions} signers={tlFor.signers} signatureRequestId={tlFor.signatureRequestId} onClose={() => setTlFor(null)} />}

      {cpOpen && (
        <>
          <div onClick={() => setCpOpen(null)} style={{ position: 'fixed', inset: 0, zIndex: 600 }} />
          <div className="aws-cp-pop" style={{ position: 'fixed', left: Math.min(cpOpen.x, window.innerWidth - 240), top: cpOpen.y, zIndex: 601, width: 220, maxHeight: 280, overflowY: 'auto', background: t.surface, borderRadius: 12, border: `1.5px solid ${t.dark ? 'rgba(6,182,212,.35)' : '#A5F3FC'}`, boxShadow: '0 16px 40px rgba(0,0,0,.28)', padding: 8, fontFamily: 'var(--font-sans)' }}>
            <div style={{ fontSize: 7.5, fontWeight: 800, letterSpacing: '.1em', textTransform: 'uppercase', color: t.dark ? '#67e8f9' : '#0e7490', padding: '4px 8px 7px' }}>Counterparties ({cpOpen.names.length})</div>
            {cpOpen.names.map((name, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 8px', borderRadius: 8, background: i % 2 ? (t.dark ? 'rgba(255,255,255,.03)' : '#F0FDFF') : 'transparent' }}>
                <div style={{ width: 22, height: 22, borderRadius: 7, background: 'linear-gradient(135deg,#0891b2,#0e7490)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><span style={{ fontSize: 8, fontWeight: 900, color: '#fff' }}>{inits(name)}</span></div>
                <span style={{ fontSize: 11, fontWeight: 600, color: t.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * The KPI tile, built as the employee list builds its own (HrEmployees.tsx,
 * KPI_CARDS): a 3px accent rule across the top of a neutral-bordered card, the
 * label in small muted caps, the figure under it at 24px/700 in the body
 * colour, and the icon in a 38px tile at the top RIGHT.
 *
 * What this used to be: the icon on the LEFT, the label in the metric's colour
 * with a chip beside it repeating that same word ("Pending Agreements" +
 * PENDING), a 26px/900 figure in the metric's colour at -1.5px tracking, and a
 * caption underneath restating the label again ("Awaiting counterparty
 * response"). Three lines of type and two colour treatments per tile, where the
 * employee card has one of each.
 *
 * The chip and the caption are gone rather than restyled — both said what the
 * label already said. The figure is no longer zero-padded, so a count of 1 reads
 * "1" as it does on the employee cards, not "01".
 *
 * The accent is still per-metric: it is what distinguishes the four tiles, and
 * the employee row colours its five the same way. It just lives in the top rule
 * and the icon tile now instead of in the type.
 */
function SummaryCard({ t, accent, value, label, icon }: {
  t: OpsTokens; accent: string; value: number; label: string; icon: React.ReactNode;
}) {
  const [c1, c2] = accent.split(',');
  const bd = t.dark ? t.border : 'var(--vz-border-color)';
  return (
    <div className="aws-card" style={{ '--bd': bd, background: t.surface } as React.CSSProperties}
      onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 6px 18px rgba(6,182,212,.18)'; }}
      onMouseLeave={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = '0 1px 4px rgba(6,182,212,.08)'; }}>
      {/* Flush to the card's top edge — the card drops its own top border so the
          rule IS the edge, which is what keeps it a clean 3px band. */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: `linear-gradient(90deg,${c1},${c2})` }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: 9, fontWeight: 600, color: t.dark ? t.textMuted : 'var(--vz-secondary-color)', letterSpacing: '.05em', textTransform: 'uppercase', margin: '0 0 8px', lineHeight: 1.25, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={label}>{label}</p>
        <div style={{ fontSize: 20, fontWeight: 600, color: t.dark ? t.textStrong : 'var(--vz-heading-color, var(--vz-body-color))', lineHeight: 1 }}>{value}</div>
      </div>
      <div style={{ width: 38, height: 38, borderRadius: 10, background: `linear-gradient(135deg,${c1},${c2})`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: '0 4px 12px rgba(0,0,0,.10)' }}>{icon}</div>
    </div>
  );
}

/**
 * The initials beside a name, in the page's own accent.
 *
 * It used to take a gradient per organisation, looked up in ORG_GRAD, falling
 * back to deep violet. ORG_GRAD held three prototype names, so real data never
 * matched it and every org on this teal page drew a violet mark — the one thing
 * in the table that belonged to no palette on it. (Its shadow was neutral black
 * at 15% too, where everything else here casts its own colour.)
 *
 * One accent for the page, as Case to Case does it, and built the same way:
 * 24px on radius 8, white initials, the top-half sheen as the first background
 * layer, and a short shadow in the accent.
 */
/**
 * The initials beside a name in Our Organisation, Counterparties and Created By.
 *
 * A pale chip with cyan letters, not white letters on solid cyan. It was
 * #0891b2 → #0e7490 under a sheen and a drop shadow, which put three dark
 * blocks on every row and made the table read heavier than the data in it.
 * This is Case to Case's chip translated to the teal ramp: a 12° gradient
 * running dark at the bottom, deep-cyan initials, no border and no shadow.
 *
 * Measured, because the ramp is not flat: the letters sit on roughly #A3E9F4
 * at the centre of the box, which is 4.0:1 against #0E7490 — above the 3:1
 * floor for bold text at this size, and with more headroom than the violet
 * version on Case to Case (3.6:1). The darkest corner is still 3.7:1.
 */
function Avatar({ name }: { name: string }) {
  return (
    <div style={{
      width: 24, height: 24, borderRadius: 8, flexShrink: 0, boxSizing: 'border-box',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'linear-gradient(12deg,#67E8F9,#DFF9FD)',
    }}>
      <span style={{ fontSize: 9, fontWeight: 700, color: '#0E7490', letterSpacing: '.01em', lineHeight: 1 }}>{inits(name)}</span>
    </div>
  );
}

function ApprovalBadge({ ap }: { ap: 'approved' | 'pending' | 'rejected' }) {
  const t = useOpsTheme('cyan');
  const c = AP_CFG[ap];
  const dk = ap === 'approved' ? { bg: 'rgba(16,185,129,.16)', border: 'rgba(16,185,129,.42)', text: '#6ee7b7' }
    : ap === 'pending' ? { bg: 'rgba(245,158,11,.16)', border: 'rgba(245,158,11,.42)', text: '#fcd34d' }
    : { bg: 'rgba(239,68,68,.16)', border: 'rgba(239,68,68,.42)', text: '#fca5a5' };
  const b = t.dark ? dk : { bg: c.bg, border: c.border, text: c.color };
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', padding: '4px 12px', borderRadius: 20, background: b.bg, border: `1.5px solid ${b.border}`, whiteSpace: 'nowrap' }}>
      <span style={{ fontSize: 10.5, fontWeight: 700, color: b.text }}>{c.label}</span>
    </span>
  );
}

/* The header band, the same one the other eleven CLM lists use — .clm-table
   thead th in clmShared.ts: a light accent tint carrying 9.5px/800 uppercase in
   the accent colour, over a 1.5px accent rule.
   It was a solid dark teal strip (#0e7490 → #22d3ee) with 8px white caps: a
   heavy bar over light rows, and a size and a half below every other header in
   the product. Three tables on this page share these two constants, so they all
   change together. The dark-mode values can't live here — these are module
   constants with no access to the theme — so they are in AWS_CSS, keyed off
   .aws-table. */
const TH  = { padding: '9px 14px', fontSize: 9.5, fontWeight: 800, letterSpacing: '.07em', textTransform: 'uppercase', color: '#0e7490', whiteSpace: 'nowrap', textAlign: 'center', lineHeight: 1.3, verticalAlign: 'middle', background: 'transparent', borderBottom: '1.5px solid rgba(6,182,212,.20)' } as React.CSSProperties;
const THL = { ...TH, textAlign: 'left' } as React.CSSProperties;
const THEAD_BG = 'linear-gradient(110deg,#f0fdff,#e8fbfd)';

const ICO_DL  = <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>;
const ICO_EDIT = <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4z" /></svg>;
const ICO_VER  = <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="12 8 12 12 14 14" /><path d="M3.05 11a9 9 0 1 1 .5 4m-.5 5v-5h5" /></svg>;
const ICO_TL   = <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>;

function ActionBtn({ title, color, bg, border, t, onClick, children, busy, disabled, softOff }: { title: string; color: string; bg: string; border: string; t: OpsTokens; onClick: () => void; children: React.ReactNode; busy?: boolean; disabled?: boolean; softOff?: boolean }) {
  const fbg     = t.dark ? `color-mix(in srgb, ${color} 20%, transparent)` : bg;
  const fborder = t.dark ? `color-mix(in srgb, ${color} 45%, transparent)` : border;
  const fcolor  = t.dark ? `color-mix(in srgb, ${color} 55%, #ffffff)` : color;
  const off = busy || disabled;
  const dim = off || softOff;
  return (
    <Tooltip label={busy ? 'Loading…' : (disabled ? 'Please wait…' : title)}>
      <button onClick={onClick} disabled={off} style={{ width: 28, height: 28, borderRadius: 7, border: `1.5px solid ${fborder}`, background: fbg, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: busy ? 'wait' : dim ? 'not-allowed' : 'pointer', color: fcolor, opacity: busy ? 1 : dim ? .4 : .85, flexShrink: 0, transition: 'all .15s' }}
        onMouseEnter={e => { if (dim) return; e.currentTarget.style.opacity = '1'; e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 3px 8px rgba(0,0,0,.13)'; }}
        onMouseLeave={e => { if (dim) return; e.currentTarget.style.opacity = '.85'; e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = 'none'; }}>
        {busy
          ? <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" style={{ animation: 'awsSpin .7s linear infinite' }}><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
          : children}
      </button>
    </Tooltip>
  );
}

function DownloadMenu({ id, dlOpen, setDlOpen, onPick, t, busy, disabled }: { id: string; dlOpen: string | null; setDlOpen: (s: string | null) => void; onPick: (fmt: string) => void; t: OpsTokens; busy?: boolean; disabled?: boolean }) {
  const open = dlOpen === id;
  const btnRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const off = busy || disabled;
  const toggle = () => {
    if (off) return;
    if (open) { setDlOpen(null); return; }
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setPos({ left: Math.max(8, Math.min(r.right - 168, window.innerWidth - 176)), top: r.bottom + 6 });
    setDlOpen(id);
  };
  return (
    <>
      <Tooltip label={busy ? 'Downloading…' : (disabled ? 'Please wait…' : 'Download Contract')}><button ref={btnRef} onClick={toggle} disabled={off} style={{ width: 28, height: 28, borderRadius: 7, border: `1.5px solid ${t.dark ? 'color-mix(in srgb, #06b6d4 45%, transparent)' : '#7DD3FC'}`, background: t.dark ? 'color-mix(in srgb, #06b6d4 20%, transparent)' : '#B2EBF2', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: busy ? 'wait' : disabled ? 'not-allowed' : 'pointer', color: t.dark ? '#67e8f9' : '#0369A1', opacity: busy ? 1 : disabled ? .4 : .85, flexShrink: 0 }}>{busy ? <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" style={{ animation: 'awsSpin .7s linear infinite' }}><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg> : ICO_DL}</button></Tooltip>
      {open && pos && createPortal(
        <>
          <div onClick={() => setDlOpen(null)} style={{ position: 'fixed', inset: 0, zIndex: 1000 }} />
          <div style={{ position: 'fixed', left: pos.left, top: pos.top, zIndex: 1001, background: t.surface, borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,.25)', border: `1.5px solid ${t.dark ? t.border : '#E8E4F9'}`, minWidth: 160, overflow: 'hidden', fontFamily: 'var(--font-sans)' }}>
            {[['PDF', '#0369A1', '#B2EBF2', '#A7F3D0'], ['DOCX', '#0891b2', '#B2EBF2', '#7DD3FC']].map(([fmt, col, sbg, sbd]) => (
              <button key={fmt} onClick={() => { setDlOpen(null); onPick(fmt); }} style={{ width: '100%', padding: '10px 14px', border: 'none', background: t.surface, fontFamily: 'inherit', fontSize: 11.5, fontWeight: 700, color: t.dark ? '#67e8f9' : col, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 9, textAlign: 'left' }}
                onMouseEnter={e => (e.currentTarget.style.background = t.dark ? 'rgba(255,255,255,.06)' : '#E0F7FA')} onMouseLeave={e => (e.currentTarget.style.background = t.surface)}>
                <span style={{ width: 26, height: 26, borderRadius: 7, background: t.dark ? 'rgba(6,182,212,.18)' : sbg, border: `1px solid ${sbd}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: col }}>{ICO_DL}</span>
                Download as {fmt}
              </button>
            ))}
          </div>
        </>,
        document.body,
      )}
    </>
  );
}

function StandardTable({ searching, rows, page, setPage, pageSize, onPageSize, tab, dlOpen, setDlOpen, downloadingId, lifecycleBusy, cpOpen, setCpOpen, onVersion, onTimeline, onDownload, onEdit, toast, t }: { searching: boolean; rows: SentRow[]; page: number; setPage: (n: number) => void; pageSize: number; onPageSize: (n: number) => void; tab: AwsTab; dlOpen: string | null; setDlOpen: (s: string | null) => void; downloadingId: string | null; lifecycleBusy: { id: string; kind: 'version' | 'timeline' } | null; cpOpen: { id: string; names: string[]; x: number; y: number } | null; setCpOpen: (s: { id: string; names: string[]; x: number; y: number } | null) => void; onVersion: (c: SentRow) => void; onTimeline: (c: SentRow) => void; onDownload: (c: SentRow, fmt: string) => void; onEdit: (c: SentRow) => void; toast: ReturnType<typeof useToast>; t: OpsTokens }) {
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const safe = Math.min(page, totalPages);
  const start = (safe - 1) * pageSize;
  const slice = rows.slice(start, start + pageSize);
  const empty = `No ${tab === 'all' ? 'contracts yet' : tab + ' contracts'}.`;
  const [certId, setCertId] = useState<string | null>(null);
  const downloadCertificate = async (c: SentRow) => {
    if (!c.dbId || certId) return;
    setCertId(c.id);
    try {
      const res = await api.get(`/clm/ctc-contracts/${c.dbId}`);
      const r = (res.data?.data ?? res.data ?? {}) as Record<string, unknown>;
      const signedUrl = String(r.signed_document_url ?? '');
      const srId = Number(r.signature_request_id) || null;
      if (!signedUrl || !srId) { toast.info('Not signed yet', 'The completion certificate is available only after all parties have signed this agreement.'); return; }
      const f = await api.get(`/clm/signature-requests/${srId}/certificate`, { responseType: 'blob' });
      const u = URL.createObjectURL(new Blob([f.data as BlobPart], { type: 'application/pdf' }));
      const a = document.createElement('a'); a.href = u; a.download = `${c.id}_certificate.pdf`; document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(u);
      toast.success('Certificate downloaded', c.id);
    } catch { toast.error('Download failed', 'Could not download the completion certificate.'); }
    finally { setCertId(null); }
  };

  return (
    <div style={{ background: t.tableBg, overflow: 'hidden', flex: 1, display: 'flex', flexDirection: 'column' }}>
          <div style={{ overflowX: 'auto', flex: 1, display: 'flex', flexDirection: 'column' }}>
            <table className="aws-table" style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1300 }}>
              <thead><tr style={{ background: THEAD_BG }}>
                <th style={{ ...TH, width: 50 }}>SR NO</th>
                <th style={{ ...TH, width: 110 }}>CTC ID</th>
                <th style={{ ...TH, width: 110 }}>CTC DATE</th>
                <th style={{ ...THL, width: 200 }}>AGREEMENT TITLE</th>
                <th style={{ ...THL, width: 150 }}>OUR ORGANISATION</th>
                <th style={{ ...THL, width: 170 }}>COUNTERPARTIES</th>
                <th style={{ ...THL, width: 130 }}>CREATED BY</th>
                <th style={{ ...TH, width: 118 }}>INTERNAL APPROVAL</th>
                <th style={{ ...TH, width: 95 }}>EFF. DATE</th>
                <th style={{ ...TH, width: 95 }}>EXPIRY DATE</th>
                <th style={{ ...TH, width: 130 }}>ACTION</th>
              </tr></thead>
              <tbody>
                {slice.map((c, i) => {
                  const n = start + i + 1;
                  const ap = (c.approval === 'rejected' ? 'rejected' : c.approval) as 'approved' | 'pending' | 'rejected';
                  const bg = n % 2 === 0 ? t.rowAlt : t.tableBg;
                  const extra = c.cp.length - 1;
                  return (
                    <tr key={c.id + i} style={{ background: bg, transition: 'all .12s' }}
                      onMouseEnter={e => { e.currentTarget.style.background = t.rowHover; e.currentTarget.style.boxShadow = 'inset 3px 0 0 #0891b2'; }}
                      onMouseLeave={e => { e.currentTarget.style.background = bg; e.currentTarget.style.boxShadow = 'none'; }}>
                      <td style={TD_C}><div style={{ width: 28, height: 28, borderRadius: '50%', background: 'linear-gradient(135deg,#0891b2,#0e7490)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 6px rgba(8,145,178,.35)' }}><span style={{ fontSize: 10, fontWeight: 900, color: '#fff' }}>{pad2(n)}</span></div></td>
                      <td style={TD_C}><span style={codePill(t.dark)}>{c.id}</span></td>
                      <td style={TD_C}><span style={{ fontSize: 11.5, fontWeight: 500, color: t.textSub, whiteSpace: 'nowrap' }}>{dashDate(c.date)}</span></td>
                      <td style={TD_L}><Tooltip label={c.title}><div style={{ fontSize: 11.5, fontWeight: 600, color: t.dark ? '#67e8f9' : '#0e7490', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 190 }}>{c.title}</div></Tooltip></td>
                      <td style={TD_L}><div style={{ display: 'flex', alignItems: 'center', gap: 7 }}><Avatar name={c.org} /><Tooltip label={c.org}><span style={{ fontSize: 11.5, fontWeight: 500, color: t.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 100 }}>{c.org}</span></Tooltip></div></td>
                      <td style={TD_L}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                          <Avatar name={c.cp[0]} />
                          <Tooltip label={(c.cpLabeled ?? c.cp).join(', ')}><span style={{ fontSize: 11.5, fontWeight: 500, color: t.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 100 }}>{c.cp[0]}</span></Tooltip>
                          {extra > 0 && <Tooltip label="View all counterparties"><button className="aws-more" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setCpOpen(cpOpen?.id === c.id ? null : { id: c.id, names: c.cpLabeled ?? c.cp, x: r.left, y: r.bottom + 4 }); }}>+{extra}</button></Tooltip>}
                        </div>
                      </td>
                      <td style={TD_L}><div style={{ display: 'flex', alignItems: 'center', gap: 7 }}><Avatar name={c.createdBy} /><span style={{ fontSize: 11.5, fontWeight: 500, color: t.text, whiteSpace: 'nowrap' }}>{c.createdBy}</span></div></td>
                      <td style={TD_C}><ApprovalBadge ap={ap} /></td>
                      <td style={TD_C}><span style={{ fontSize: 11.5, fontWeight: 500, color: t.textSub, whiteSpace: 'nowrap' }}>{dashDate(c.effDate)}</span></td>
                      <td style={TD_C}><span style={{ fontSize: 11.5, fontWeight: 500, color: t.textSub, whiteSpace: 'nowrap' }}>{dashDate(c.endDate)}</span></td>
                      <td style={TD_C}>
                        {(() => {
                          const verBusy = lifecycleBusy?.id === c.id && lifecycleBusy?.kind === 'version';
                          const tlBusy  = lifecycleBusy?.id === c.id && lifecycleBusy?.kind === 'timeline';
                          const frozen  = lifecycleBusy !== null;
                          return (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                          <DownloadMenu id={c.id} dlOpen={dlOpen} setDlOpen={setDlOpen} busy={downloadingId === c.id} disabled={frozen} onPick={(fmt) => onDownload(c, fmt)} t={t} />
                          <ActionBtn title="Edit Agreement" color="#0891b2" bg="#B2EBF2" border="#7DD3FC" t={t} disabled={frozen} onClick={() => onEdit(c)}>{ICO_EDIT}</ActionBtn>
                          <ActionBtn title="Version History" color="#7C3AED" bg="#EDE9FE" border="#C4B5FD" t={t} busy={verBusy} disabled={frozen && !verBusy} onClick={() => onVersion(c)}>{ICO_VER}</ActionBtn>
                          <ActionBtn title="Agreement Timeline" color="#B45309" bg="#FEF3C7" border="#FCD34D" t={t} busy={tlBusy} disabled={frozen && !tlBusy} onClick={() => onTimeline(c)}>{ICO_TL}</ActionBtn>
                          <ActionBtn title={c.approval === 'approved' ? 'Download completion certificate' : 'Available once approved & signed'} color="#0F766E" bg="#CCFBF1" border="#5EEAD4" t={t} busy={certId === c.id} disabled={frozen && certId !== c.id} softOff={c.approval !== 'approved'} onClick={() => downloadCertificate(c)}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="6" /><path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11" /></svg></ActionBtn>
                        </div>
                          );
                        })()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {slice.length === 0 && <EmptyState msg={empty} searching={searching} t={t} />}
          </div>
          <WorklistPager total={rows.length} page={safe} pageSize={pageSize} onPage={setPage} onPageSize={onPageSize} className="wl-teal" />
    </div>
  );
}

function RejectedTable({ searching, rows, ata, page, setPage, pageSize, onPageSize, dlOpen, setDlOpen, downloadingId, onDownload, t }: { searching: boolean; rows: SentRow[]; ata: SentRow[]; page: number; setPage: (n: number) => void; pageSize: number; onPageSize: (n: number) => void; dlOpen: string | null; setDlOpen: (s: string | null) => void; downloadingId: string | null; onDownload: (c: SentRow, fmt: string) => void; t: OpsTokens }) {
  const getRej = (id: string) => { const a = ata.find(x => x.id === id); return { by: a?.approver ?? '—', reason: a?.rejReason ?? '—' }; };
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const safe = Math.min(page, totalPages);
  const start = (safe - 1) * pageSize;
  const slice = rows.slice(start, start + pageSize);

  return (
    <div style={{ background: t.tableBg, overflow: 'hidden', flex: 1, display: 'flex', flexDirection: 'column' }}>
          <div style={{ overflowX: 'auto', flex: 1, display: 'flex', flexDirection: 'column' }}>
            <table className="aws-table" style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1200 }}>
              <thead><tr style={{ background: THEAD_BG }}>
                <th style={{ ...TH, width: 52 }}>SR. NO</th>
                <th style={{ ...TH, width: 110 }}>CTC ID</th>
                <th style={{ ...TH, width: 105 }}>CTC DATE</th>
                <th style={{ ...THL, width: 200 }}>AGREEMENT TITLE</th>
                <th style={{ ...THL, width: 130 }}>CREATED BY</th>
                <th style={{ ...THL, width: 130 }}>REJECTED BY</th>
                <th style={THL}>REASON</th>
                <th style={{ ...TH, width: 100 }}>EXPIRY</th>
                <th style={{ ...TH, width: 90 }}>ACTION</th>
              </tr></thead>
              <tbody>
                {slice.map((c, i) => {
                  const n = start + i + 1;
                  const rej = getRej(c.id);
                  const bg = n % 2 === 0 ? t.rowAlt : t.tableBg;
                  return (
                    <tr key={c.id + i} style={{ background: bg, transition: 'all .12s' }}
                      onMouseEnter={e => { e.currentTarget.style.background = t.rowHover; e.currentTarget.style.boxShadow = 'inset 3px 0 0 #0891b2'; }}
                      onMouseLeave={e => { e.currentTarget.style.background = bg; e.currentTarget.style.boxShadow = 'none'; }}>
                      <td style={TD_C}><div style={{ width: 28, height: 28, borderRadius: '50%', background: 'linear-gradient(135deg,#0891b2,#0e7490)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 6px rgba(8,145,178,.35)' }}><span style={{ fontSize: 10, fontWeight: 900, color: '#fff' }}>{pad2(n)}</span></div></td>
                      <td style={TD_C}><span style={codePill(t.dark)}>{c.id}</span></td>
                      <td style={TD_C}><span style={{ fontSize: 11.5, fontWeight: 600, color: t.textSub }}>{c.date}</span></td>
                      <td style={TD_L}><Tooltip label={c.title}><div style={{ fontSize: 12.5, fontWeight: 650, color: t.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 200 }}>{c.title}</div></Tooltip></td>
                      <td style={TD_L}><div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Avatar name={c.createdBy} /><span style={{ fontSize: 11, fontWeight: 600, color: t.text, whiteSpace: 'nowrap' }}>{c.createdBy}</span></div></td>
                      <td style={TD_L}><div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><div style={{ width: 26, height: 26, borderRadius: '50%', background: 'linear-gradient(135deg,#FCA5A5,#EF4444)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><span style={{ fontSize: 8.5, fontWeight: 900, color: '#fff' }}>{inits(rej.by)}</span></div><span style={{ fontSize: 11, fontWeight: 600, color: t.dark ? '#fca5a5' : '#7F1D1D', whiteSpace: 'nowrap' }}>{rej.by}</span></div></td>
                      {/* The marker is the bare glyph, not a chip. It used to be
                          a 9px cross inside a 16px filled disc: at that size the
                          cross has barely three pixels of stroke left and the
                          fill swallows them, so the cell led with a red smudge.
                          Stroked at 13px on no background it reads at a glance,
                          and it no longer competes with the two real avatars
                          beside it — a chip in this column looked like a third
                          one that had lost its letter. */}
                      <td style={{ ...TD_L, maxWidth: 220 }}><div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={t.dark ? '#fca5a5' : '#DC2626'} strokeWidth="2.2" strokeLinecap="round" style={{ flexShrink: 0, marginTop: 1 }}><circle cx="12" cy="12" r="9" /><line x1="12" y1="8" x2="12" y2="12.5" /><line x1="12" y1="16" x2="12" y2="16" /></svg><Tooltip label={rej.reason}><div style={{ fontSize: 10.5, color: t.dark ? '#fca5a5' : '#7F1D1D', fontWeight: 500, lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{rej.reason}</div></Tooltip></div></td>
                      <td style={TD_C}><span style={{ fontSize: 11, fontWeight: 600, color: t.textSub, whiteSpace: 'nowrap' }}>{dashDate(c.endDate)}</span></td>
                      <td style={TD_C}><div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                        <DownloadMenu id={c.id} dlOpen={dlOpen} setDlOpen={setDlOpen} busy={downloadingId === c.id} onPick={(fmt) => onDownload(c, fmt)} t={t} />
                      </div></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {slice.length === 0 && <EmptyState msg="No rejected contracts." searching={searching} t={t} />}
          </div>
          <WorklistPager total={rows.length} page={safe} pageSize={pageSize} onPage={setPage} onPageSize={onPageSize} className="wl-teal" />
    </div>
  );
}

function ClarifyTable({ rows, searching, page, setPage, pageSize, onPageSize, onRespond, t }: { rows: SentRow[]; searching: boolean; page: number; setPage: (n: number) => void; pageSize: number; onPageSize: (n: number) => void; onRespond: (id: string) => void; t: OpsTokens }) {
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const safe = Math.min(page, totalPages);
  const start = (safe - 1) * pageSize;
  const slice = rows.slice(start, start + pageSize);
  return (
    <div style={{ background: t.tableBg, overflow: 'hidden', flex: 1, display: 'flex', flexDirection: 'column' }}>
      <div style={{ overflowX: 'auto', flex: 1, display: 'flex', flexDirection: 'column' }}>
        <table className="aws-table" style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1200 }}>
          <thead><tr style={{ background: THEAD_BG }}>
            <th style={{ ...TH, width: 52 }}>SR. NO</th>
            <th style={{ ...TH, width: 110 }}>CTC ID</th>
            <th style={{ ...TH, width: 100 }}>CTC DATE</th>
            <th style={{ ...THL, width: 200 }}>AGREEMENT TITLE</th>
            <th style={{ ...THL, width: 115 }}>CREATED BY</th>
            <th style={{ ...THL, width: 115 }}>APPROVER</th>
            <th style={THL}>CLARIFICATION QUERY</th>
            <th style={{ ...TH, width: 100 }}>EXPIRY</th>
            <th style={{ ...TH, width: 120 }}>ACTION</th>
          </tr></thead>
          <tbody>
            {slice.map((c, i) => {
              const n = start + i + 1;
              const pending = c.clarifications.filter(cl => !cl.response);
              const hasPending = pending.length > 0;
              const latest = hasPending ? pending[pending.length - 1] : c.clarifications[c.clarifications.length - 1];
              const round = c.clarifications.length;
              const bg = n % 2 === 0 ? t.rowAlt : t.tableBg;
              return (
                <tr key={c.id} style={{ background: bg, transition: 'all .12s' }}
                  onMouseEnter={e => { e.currentTarget.style.background = t.rowHover; e.currentTarget.style.boxShadow = 'inset 3px 0 0 #0891b2'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = bg; e.currentTarget.style.boxShadow = 'none'; }}>
                  <td style={TD_C}><div style={{ width: 28, height: 28, borderRadius: '50%', background: 'linear-gradient(135deg,#0891b2,#0e7490)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 6px rgba(8,145,178,.35)' }}><span style={{ fontSize: 10, fontWeight: 900, color: '#fff' }}>{pad2(n)}</span></div></td>
                  <td style={TD_C}><span style={codePill(t.dark)}>{c.id}</span></td>
                  <td style={TD_C}><span style={{ fontSize: 11, fontWeight: 600, color: t.textSub }}>{c.date}</span></td>
                  <td style={TD_L}><Tooltip label={c.title}><div style={{ fontSize: 12, fontWeight: 700, color: t.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 185 }}>{c.title}</div></Tooltip></td>
                  <td style={TD_L}><div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Avatar name={c.createdBy} /><span style={{ fontSize: 11, fontWeight: 600, color: t.text, whiteSpace: 'nowrap' }}>{c.createdBy}</span></div></td>
                  <td style={TD_L}><div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Avatar name={c.approver} /><span style={{ fontSize: 11, fontWeight: 600, color: t.text, whiteSpace: 'nowrap' }}>{c.approver}</span></div></td>
                  <td style={{ ...TD_L, maxWidth: 210 }}>
                    {round > 1 && <span style={{ display: 'inline-block', padding: '1px 7px', borderRadius: 20, background: '#F5F0FF', border: '1px solid #DDD6FE', fontSize: 7.5, fontWeight: 700, color: '#7C3AED', marginBottom: 3 }}>Round {round}</span>}
                    <Tooltip label={latest?.query ?? ''}><div style={{ fontSize: 11, color: t.textSub, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 210 }}>{latest?.query ?? '—'}</div></Tooltip>
                    {hasPending
                      ? <div style={{ fontSize: 8.5, color: '#F59E0B', fontWeight: 600, marginTop: 2, display: 'flex', alignItems: 'center', gap: 3 }}><svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg> Awaiting your response · raised by {c.approver} on {latest?.date}</div>
                      : <div style={{ fontSize: 8.5, color: t.dark ? '#67e8f9' : '#0891b2', fontWeight: 600, marginTop: 2, display: 'flex', alignItems: 'center', gap: 3 }}><svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke={t.dark ? '#67e8f9' : '#0891b2'} strokeWidth="2.4" strokeLinecap="round"><polyline points="20 6 9 17 4 12" /></svg> You responded · awaiting {c.approver}'s decision</div>}
                  </td>
                  <td style={TD_C}><span style={{ fontSize: 11, fontWeight: 600, color: t.textSub }}>{c.expDate}</span></td>
                  <td style={TD_C}>
                    {hasPending
                      ? <button onClick={() => onRespond(c.id)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 16px', borderRadius: 9, border: 'none', background: 'linear-gradient(135deg,#0891b2,#0e7490)', color: '#fff', fontFamily: 'inherit', fontSize: 10, fontWeight: 800, cursor: 'pointer', boxShadow: '0 3px 10px rgba(8,145,178,.4)', whiteSpace: 'nowrap' }}
                          onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-1px)'; }} onMouseLeave={e => { e.currentTarget.style.transform = ''; }}>
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
                          Respond
                        </button>
                      : <button onClick={() => onRespond(c.id)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 9, border: `1.5px solid ${t.dark ? 'rgba(124,58,237,.45)' : '#C4B5FD'}`, background: t.dark ? 'rgba(124,58,237,.14)' : '#F5F0FF', color: t.dark ? '#c4b5fd' : '#6D28D9', fontFamily: 'inherit', fontSize: 10, fontWeight: 800, cursor: 'pointer', whiteSpace: 'nowrap' }}
                          onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-1px)'; }} onMouseLeave={e => { e.currentTarget.style.transform = ''; }}>
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" /></svg>
                          View Conversation
                        </button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!slice.length && (
          <EmptyState t={t} searching={searching} title="All Clarifications Resolved" msg="No pending clarification queries. When an approver raises a query, it will appear here."
            icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#0891b2" strokeWidth="2" strokeLinecap="round"><polyline points="20 6 9 17 4 12" /></svg>} />
        )}
      </div>
      <WorklistPager total={rows.length} page={safe} pageSize={pageSize} onPage={setPage} onPageSize={onPageSize} className="wl-teal" />
    </div>
  );
}

function RespondModal({ contract, onClose, onSubmit, t }: { contract: SentRow; onClose: () => void; onSubmit: (id: string, text: string) => void; t: OpsTokens }) {
  const [text, setText] = useState('');
  const [err, setErr] = useState(false);
  const { typingName, notifyTyping, stopTyping } = useTyping(contract.id, {
    expect: [contract.approver, ...contract.clarifications.map(cl => cl.by)],
  });
  const pending = contract.clarifications.filter(cl => !cl.response);
  const hasPending = pending.length > 0;
  const MAX = 2000;
  const prevResponse = [...contract.clarifications].reverse().find(cl => cl.response)?.response ?? '';

  const threadRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [contract.clarifications.length]);

  const card: React.CSSProperties = {
    background: t.surface,
    border: `1.5px solid ${t.dark ? 'rgba(124,58,237,.26)' : '#EDE9FE'}`,
    borderRadius: 16,
    padding: 16,
  };
  const capLabel: React.CSSProperties = {
    fontSize: 8.5, fontWeight: 800, letterSpacing: '.12em', textTransform: 'uppercase',
    color: t.dark ? '#c4b5fd' : '#7C3AED',
  };

  return (
    <div onClick={e => { if (e.target === e.currentTarget) onClose(); }} style={{ position: 'fixed', inset: 0, zIndex: 9999999, background: 'rgba(12,5,38,.75)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, fontFamily: 'var(--font-sans)' }}>
      <div className="aws-clarify-modal" style={{ width: '100%', maxWidth: 880, borderRadius: 20, overflow: 'hidden', boxShadow: '0 40px 80px rgba(12,5,38,.35)', animation: 'awsSlideUp .22s cubic-bezier(.22,1,.36,1) both' }}>

        <div style={{ background: 'radial-gradient(rgba(255,255,255,.16) 1.1px, transparent 1.1px), linear-gradient(118deg,#5B21B6,#7C3AED,#8B5CF6)', backgroundSize: '14px 14px, auto', padding: '18px 22px', position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '50%', background: 'linear-gradient(180deg,rgba(255,255,255,.16),transparent)', pointerEvents: 'none' }} />
          <div style={{ position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 13 }}>
              <div style={{ width: 44, height: 44, borderRadius: 13, background: 'rgba(255,255,255,.2)', border: '1.5px solid rgba(255,255,255,.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 12px rgba(0,0,0,.15)', flexShrink: 0 }}><svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg></div>
              <div>
                <div style={{ fontSize: 8.5, fontWeight: 700, color: 'rgba(255,255,255,.62)', letterSpacing: '.14em', textTransform: 'uppercase', marginBottom: 3 }}>{contract.id} · {hasPending ? 'Clarification Response' : 'Clarification Conversation'}</div>
                <div style={{ fontSize: 17, fontWeight: 900, color: '#fff', letterSpacing: '-.3px', maxWidth: 380, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{contract.title}</div>
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,.72)', marginTop: 2 }}>{hasPending ? 'Review the query and provide your clarification.' : 'The full conversation for this agreement.'}</div>
              </div>
            </div>
            <button onClick={() => { stopTyping(); onClose(); }} style={{ width: 32, height: 32, borderRadius: 9, background: 'rgba(255,255,255,.15)', border: '1px solid rgba(255,255,255,.25)', color: '#fff', fontSize: 16, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>✕</button>
          </div>
        </div>

        <div className="aws-clarify-body" style={{ background: t.dark ? '#150f2b' : '#F7F5FF', padding: 18, display: 'grid', gridTemplateColumns: hasPending ? '1.05fr .95fr' : '1fr', gap: 16, alignItems: 'start' }}>

          <div style={card}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 13 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={t.dark ? '#c4b5fd' : '#7C3AED'} strokeWidth="2.2" strokeLinecap="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
                <span style={{ fontSize: 12.5, fontWeight: 800, color: t.text }}>Conversation History</span>
              </div>
              {contract.clarifications.length > 0 && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 9.5, fontWeight: 700, color: t.dark ? '#c4b5fd' : '#6D28D9', background: t.dark ? 'rgba(124,58,237,.18)' : '#F3EEFF', border: `1px solid ${t.dark ? 'rgba(167,139,250,.3)' : '#E4DAFF'}`, borderRadius: 20, padding: '4px 10px', whiteSpace: 'nowrap' }}>
                  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
                  {contract.clarifications[contract.clarifications.length - 1].date}
                </span>
              )}
            </div>

            <div ref={threadRef} className="aws-thread" style={{ display: 'flex', flexDirection: 'column', gap: 12, maxHeight: 330, overflowY: 'auto' }}>
              {contract.clarifications.map((cl, i) => (
                <div key={i}>
                  <div style={{ display: 'flex', gap: 9, alignItems: 'flex-start' }}>
                    <div style={{ width: 30, height: 30, borderRadius: 9, background: 'linear-gradient(135deg,#7C3AED,#5B21B6)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><span style={{ fontSize: 9.5, fontWeight: 900, color: '#fff' }}>{inits(cl.by || contract.approver)}</span></div>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 9, fontWeight: 700, color: t.textMuted, marginBottom: 4 }}>{cl.by || contract.approver} · Approver · {cl.date}</div>
                      <div style={{ background: t.dark ? 'rgba(124,58,237,.12)' : '#F4F1FC', border: `1px solid ${t.dark ? 'rgba(124,58,237,.28)' : '#E7E1FA'}`, borderRadius: '4px 12px 12px 12px', padding: '10px 13px', fontSize: 12, color: t.textSub, lineHeight: 1.55, wordBreak: 'break-word' }}>{cl.query}</div>
                    </div>
                  </div>
                  {cl.response
                    ? <div style={{ display: 'flex', gap: 9, justifyContent: 'flex-end', alignItems: 'flex-start', marginTop: 8 }}>
                        <div style={{ maxWidth: '82%', minWidth: 0 }}>
                          <div style={{ fontSize: 9, fontWeight: 700, color: t.textMuted, marginBottom: 4, textAlign: 'right' }}>You · {contract.createdBy}</div>
                          <div style={{ background: t.dark ? 'rgba(8,145,178,.16)' : '#E0F7FA', border: `1.5px solid ${t.dark ? 'rgba(6,182,212,.42)' : '#A5F3FC'}`, borderRadius: '12px 4px 12px 12px', padding: '10px 13px', fontSize: 12, color: t.dark ? '#a5f3fc' : '#0e7490', lineHeight: 1.55, wordBreak: 'break-word' }}>{cl.response}</div>
                        </div>
                        <div style={{ width: 30, height: 30, borderRadius: 9, background: 'linear-gradient(135deg,#0891b2,#0e7490)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><span style={{ fontSize: 9.5, fontWeight: 900, color: '#fff' }}>{inits(contract.createdBy)}</span></div>
                      </div>
                    : <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 7, marginLeft: 39, fontSize: 9.5, fontWeight: 700, color: '#F59E0B' }}><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg> Awaiting your response</div>}
                </div>
              ))}
            </div>
            <TypingIndicator name={typingName} color={t.dark ? '#c4b5fd' : '#7C3AED'} />
          </div>

          {hasPending ? (
            <div style={card}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 12 }}>
                <div style={{ width: 34, height: 34, borderRadius: 10, background: t.dark ? 'rgba(124,58,237,.2)' : '#EFE9FF', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={t.dark ? '#c4b5fd' : '#7C3AED'} strokeWidth="2.2" strokeLinecap="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 800, color: t.text }}>Share Your Clarification</div>
                  <div style={{ fontSize: 10.5, color: t.textMuted, lineHeight: 1.5, marginTop: 2 }}>
                    Answering {pending[pending.length - 1].by || contract.approver}&rsquo;s query to continue the process.
                  </div>
                </div>
              </div>

              <div style={{ position: 'relative' }}>
                <textarea
                  value={text}
                  maxLength={MAX}
                  onChange={e => { setText(e.target.value); setErr(false); notifyTyping(); }}
                  placeholder="Type your clarification response here…"
                  onFocus={e => { e.currentTarget.style.borderColor = '#7C3AED'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(124,58,237,.12)'; }}
                  onBlur={e => { e.currentTarget.style.borderColor = err ? '#EF4444' : (t.dark ? t.border : '#E6E1F5'); e.currentTarget.style.boxShadow = 'none'; }}
                  style={{ width: '100%', height: 150, padding: '12px 14px 26px', border: `1.5px solid ${err ? '#EF4444' : (t.dark ? t.border : '#E6E1F5')}`, borderRadius: 12, fontFamily: 'inherit', fontSize: 12.5, color: t.text, background: t.dark ? 'rgba(255,255,255,.04)' : '#fff', resize: 'none', outline: 'none', boxSizing: 'border-box', lineHeight: 1.55, transition: 'border-color .15s, box-shadow .15s' }}
                />
                <span style={{ position: 'absolute', right: 12, bottom: 10, fontSize: 9.5, fontWeight: 600, color: t.textMuted, pointerEvents: 'none' }}>{text.length}/{MAX}</span>
              </div>
              {err && <div style={{ fontSize: 9.5, color: '#EF4444', marginTop: 6, fontWeight: 600 }}>Please enter your response before submitting.</div>}

              {prevResponse && (
                <>
                  <div style={{ ...capLabel, display: 'flex', alignItems: 'center', gap: 5, margin: '14px 0 8px' }}>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><polyline points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" /></svg>
                    Quick action
                  </div>
                  <button
                    type="button"
                    onClick={() => { setText(prevResponse.slice(0, MAX)); setErr(false); notifyTyping(); }}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 12px', borderRadius: 9, border: `1.5px solid ${t.dark ? t.border : '#E6E1F5'}`, background: t.dark ? 'rgba(255,255,255,.04)' : '#FBFAFF', color: t.dark ? '#cbd5e1' : '#5B21B6', fontFamily: 'inherit', fontSize: 10.5, fontWeight: 700, cursor: 'pointer' }}
                  >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
                    Use previous response
                  </button>
                </>
              )}

              <div style={{ display: 'flex', gap: 9, marginTop: 14 }}>
                <button
                  onClick={() => { if (!text.trim()) { setErr(true); return; } stopTyping(); onSubmit(contract.id, text.trim()); }}
                  style={{ flex: 2, padding: '13px 16px', borderRadius: 12, border: 'none', background: 'linear-gradient(135deg,#7C3AED,#5B21B6)', color: '#fff', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 800, cursor: 'pointer', boxShadow: '0 4px 14px rgba(109,40,217,.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" style={{ flexShrink: 0 }}><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
                  Submit
                </button>
                <button onClick={() => { stopTyping(); onClose(); }} style={{ flex: 1, padding: '13px 16px', borderRadius: 12, border: `1.5px solid ${t.dark ? t.border : '#E6E1F5'}`, background: 'transparent', color: t.dark ? '#cbd5e1' : '#64748B', fontFamily: 'inherit', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Cancel</button>
              </div>
            </div>
          ) : null}
        </div>

        <div style={{ padding: '12px 22px', background: t.surface, borderTop: `1.5px solid ${t.dark ? 'rgba(124,58,237,.22)' : '#EDE9FE'}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <span style={{ fontSize: 10.5, fontWeight: 600, color: t.textMuted, display: 'flex', alignItems: 'center', gap: 7, lineHeight: 1.4 }}>
            {hasPending ? (
              <>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={t.dark ? '#c4b5fd' : '#7C3AED'} strokeWidth="2.2" strokeLinecap="round" style={{ flexShrink: 0 }}><circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" /></svg>
                Your response will be shared with the approver for further review.
              </>
            ) : (
              <>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={t.dark ? '#67e8f9' : '#0891b2'} strokeWidth="2.2" strokeLinecap="round" style={{ flexShrink: 0 }}><polyline points="20 6 9 17 4 12" /></svg>
                You&rsquo;ve responded &mdash; awaiting {contract.approver}&rsquo;s decision.
              </>
            )}
          </span>
          {!hasPending && (
            <button onClick={onClose} style={{ padding: '10px 22px', borderRadius: 10, border: `1.5px solid ${t.dark ? t.border : '#E2E8F0'}`, background: t.dark ? 'rgba(255,255,255,.05)' : '#F8F9FA', color: t.dark ? '#cbd5e1' : '#64748B', fontFamily: 'inherit', fontSize: 11, fontWeight: 700, cursor: 'pointer', flexShrink: 0 }}>Close</button>
          )}
        </div>
      </div>
    </div>
  );
}

function EmptyState({ msg, t, searching = false, title = 'No Contracts Found', icon }: { msg: string; t: OpsTokens; searching?: boolean; title?: string; icon?: React.ReactNode }) {
  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 20px', position: 'sticky', left: 0 }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ width: 48, height: 48, borderRadius: 13, background: 'linear-gradient(135deg,#E0F7FA,#A7F3D0)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px', boxShadow: '0 3px 10px rgba(6,182,212,.15)' }}>{icon ?? <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#0891b2" strokeWidth="2" strokeLinecap="round"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>}</div>
        <div style={{ fontSize: 13, fontWeight: 800, color: t.dark ? '#67e8f9' : '#0e7490', marginBottom: 5 }}>{searching ? 'No Matching Contracts' : title}</div>
        <div style={{ fontSize: 10.5, color: t.textMuted, maxWidth: 300, lineHeight: 1.6 }}>{searching ? 'No results match the current search.' : msg}</div>
      </div>
    </div>
  );
}

/* 11.5px/500 is the body size every CLM and HRMS list uses; the cells below set
   their own 11px/600 and 12px/700, which is why this table read a notch smaller
   and heavier than the rest. Declared here so a cell that says nothing inherits
   it, and the per-cell sizes that remain are the deliberate ones (the SR disc,
   the initials, the small captions under a clarification). */
const TD_C = { padding: '11px 14px', verticalAlign: 'middle', borderBottom: '1px solid rgba(6,182,212,.06)', textAlign: 'center', fontSize: 11.5, fontWeight: 500 } as React.CSSProperties;
const TD_L = { ...TD_C, textAlign: 'left' } as React.CSSProperties;
const codePill = (dark: boolean): React.CSSProperties => ({ fontFamily: "'Geist Mono', monospace", fontSize: 11, fontWeight: 800, color: dark ? '#67e8f9' : '#0e7490', background: dark ? 'rgba(6,182,212,.2)' : 'linear-gradient(135deg,rgba(6,182,212,.12),rgba(8,145,178,.06))', padding: '4px 9px', borderRadius: 7, border: `1px solid rgba(6,182,212,${dark ? '.42' : '.25'})`, whiteSpace: 'nowrap', letterSpacing: '.02em' });

const AWS_CSS = `
@keyframes awsSlideUp { from { opacity:0; transform:translateY(24px) scale(.96); } to { opacity:1; transform:none; } }
@keyframes awsSpin { to { transform: rotate(360deg); } }

/* ── "+2 more counterparties" ──
   A solid #0891b2 to #0e7490 disc in white, built to sit beside an initials
   chip that was also solid cyan. With the chip now pale, the +N was the
   darkest thing in the row - a secondary "there are more" affordance shouting
   over the name it belongs to.

   Same family as the chip: cyan-100 fill, the chip's #0E7490 letters, the
   chip's 8px corner instead of a 20px pill. 7.0:1, and 6.1:1 on hover.

   20px tall against the chip's 24, so it stays subordinate rather than reading
   as a second avatar. It is a button and had neither hover nor focus ring -
   the only feedback was the cursor - so both are here. */
.aws-more {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 22px; height: 20px; padding: 0 6px; box-sizing: border-box;
  border: 0; border-radius: 8px;
  background: #CFFAFE; color: #0E7490;
  font-family: inherit; font-size: 9px; font-weight: 700; line-height: 1;
  flex-shrink: 0; cursor: pointer;
  transition: background .15s ease, color .15s ease;
}
.aws-more:hover { background: #A5F3FC; }
.aws-more:focus-visible { outline: 2px solid rgba(8,145,178,.55); outline-offset: 1px; }
[data-bs-theme="dark"] .aws-more { background: rgba(8,145,178,.22); color: #67e8f9; }
[data-bs-theme="dark"] .aws-more:hover { background: rgba(8,145,178,.32); color: #a5f3fc; }

.aws-thread { scrollbar-width: thin; scrollbar-color: rgba(124,58,237,.34) transparent; }
.aws-thread::-webkit-scrollbar { width: 5px; }
.aws-thread::-webkit-scrollbar-track { background: transparent; }
.aws-thread::-webkit-scrollbar-thumb { background: rgba(124,58,237,.28); border-radius: 999px; }
.aws-thread::-webkit-scrollbar-thumb:hover { background: rgba(124,58,237,.5); }

/* Dark mode for the three table heads. The TH constant above is a module
   constant with no access to the theme, and an inline style beats a plain CSS
   rule, so these carry !important — the one case where it is the mechanism
   rather than a patch. Values are .clm-table's dark head, which the rest of CLM
   already uses. */
[data-bs-theme="dark"] .aws-table thead tr,
[data-layout-mode="dark"] .aws-table thead tr { background: #12303d !important; }
[data-bs-theme="dark"] .aws-table thead th,
[data-layout-mode="dark"] .aws-table thead th {
  color: #a5f3fc !important;
  border-bottom: 2px solid rgba(34,211,238,.55) !important;
  box-shadow: inset 0 1px 0 rgba(255,255,255,.04);
}

@media (max-width: 820px) {
  .aws-clarify-body { grid-template-columns: 1fr !important; }
  .aws-clarify-modal { max-height: 92vh; overflow-y: auto !important; }
}

/* The rail scrolls its own tabs when the toolbar runs short of room, and the
   scrollbar is hidden: it would sit inside a 48px capsule and eat the height
   the 40px tabs are centred in. */
.aws-tabrail { scrollbar-width: none; }
.aws-tabrail::-webkit-scrollbar { display: none; }
/* 0 200 500px, not the inherited 0 0 500px: the search keeps its 500 while the
   room is there and gives it back before anything wraps. 220 is the floor —
   below that "Search agreements…" is lost to the ellipsis.
   The 200 is a shrink factor, and it decides the ORDER the two give way in.
   Flex shares a shortfall in proportion to base size × factor, so at 1 each
   the rail (roughly 815 wide) would absorb about two thirds of it and the
   last tab would sit clipped at every width — measured at 22px of "Clarifi-
   cations" cut off on a 1366 laptop. 20 was not enough either: it still left
   16px cut, because every pixel the tabs below gave back was handed straight
   to the search rather than to closing the gap. At 200 the rail's share of
   any shortfall is under 2px, so the search surrenders its width first, down
   to 220, and the rail only starts to scroll once that floor is reached —
   which measures as no clipping at all from 1366 up. */
   The floor needs !important of its own: .ops-search sets min-width: 0 at the
   same specificity, so which of the two applied would otherwise come down to
   which stylesheet loaded last, and the search would collapse to nothing. */
.aws-searchbox { flex: 0 200 500px !important; min-width: 220px !important; }

/* Between 900 and 1500 the five tabs and a usable search are within about
   20px of fitting on one row, so the tabs give that back rather than leaving
   "Clarifications" half cut off on a 1366 laptop — 5px off each tab's side
   padding, 3 off the gaps and 4 off each count pill comes to roughly 80px,
   which clears it. The labels are untouched; only the air around them moves.
   The pill numbers are inline-styled, so overriding them takes !important. */
@media (min-width: 901px) and (max-width: 1500px) {
  .aws-tabrail { gap: 5px !important; }
  .aws-tabrail > button { padding: 0 9px !important; gap: 5px !important; }
  .aws-tabrail > button > span:last-child { min-width: 24px !important; padding: 0 4px !important; }
}

@media (max-width: 900px) {
  /* Under 900 the stack is deliberate, so wrap is put back on. */
  .aws-toolbar { flex-wrap: wrap !important; }
  /* height auto and overflow visible: the rail is inline-styled to 48px with
     overflow-y hidden for the scrolling case, which would clip the second row
     of tabs that wrapping creates here. */
  .aws-tabrail { flex-wrap: wrap; width: 100%; justify-content: flex-start; overflow-x: visible; overflow-y: visible; flex-basis: auto; height: auto !important; }
  .aws-tabrail > button { flex: 1 1 calc(50% - 4px); justify-content: center; }
  .aws-hspacer { display: none; }
  .aws-searchbox { width: 100% !important; max-width: none !important; flex: 1 1 100% !important; }
  .aws-searchbox input { width: 100% !important; }
}
/* The employee card's box: radius 14 on 11px 15px, a 1px neutral border with
   NO top border so the accent rule sits flush as the card's top edge, and the
   two columns top-aligned rather than centred — the figure stacks under the
   label on the left, the icon tile stays at the top right. */
.aws-card {
  position:relative; overflow:hidden; border-radius:14px; padding:11px 15px;
  background:#fff; border:1px solid var(--bd); border-top-width:0;
  box-shadow:0 1px 4px rgba(6,182,212,.08); transition:all .18s;
  /* Centred, not top-aligned: with the label on a single line the icon tile
     is taller than the text column, so flex-start hung it above the figure. */
  display:flex; align-items:center; justify-content:space-between; gap:10px;
}
`;
