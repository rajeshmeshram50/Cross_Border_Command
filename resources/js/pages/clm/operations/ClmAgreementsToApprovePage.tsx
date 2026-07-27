import { useEffect, useMemo, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
// Vite-friendly worker URL — same setup the CTC sign-position modal uses.
import PdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?worker&url';
import { useToast } from '../../../contexts/ToastContext';
import { useAuth } from '../../../contexts/AuthContext';
import { getEcho } from '../../../echo';
import { useTyping } from '../../../hooks/useTyping';
import { TypingIndicator } from '../../../components/TypingIndicator';
import api from '../../../api';
import { type AtaContract, inits, pad2, PER_PAGE } from './clmOpsData';
import { useOpsTheme, type OpsTokens } from './useOpsTheme';
import WorklistPager from '../../../components/ui/WorklistPager';
import { ShimmerTable } from '../../../components/ui/Shimmer';
import Tooltip from '../../../components/ui/Tooltip';

pdfjsLib.GlobalWorkerOptions.workerSrc = PdfjsWorker as unknown as string;

/** To-approve rows from GET /clm/ctc-contracts/to-approve (AtaContract + db id). */
type AtaRow = AtaContract & { dbId: number };

// Display dates as DD-Mon-YYYY (e.g. 17-Jul-2026). The API returns "17 Jul
// 2026"; swap the spaces for hyphens (QA #9). "—" / empty pass through.
const dashDate = (s: string): string => (s && s !== '—' ? s.replace(/\s+/g, '-') : s);

// The CTC DATE can carry a submission time ("18 Jul 2026 12:32"). Split it into
// a hyphenated date and a 12-hour AM/PM time so the date shows on top (no
// trailing hyphen) and the time on its own line below.
const dateTimeParts = (s: string): { date: string; time: string } => {
  if (!s || s === '—') return { date: s || '—', time: '' };
  const p = s.trim().split(/\s+/);
  const date = p.slice(0, 3).join('-');
  let time = '';
  if (p[3] && /^\d{1,2}:\d{2}/.test(p[3])) {
    const [hh, mm] = p[3].split(':');
    let h = parseInt(hh, 10);
    const ap = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    time = `${h}:${mm} ${ap}`;
  }
  return { date, time };
};

/* ─────────────────────────────────────────────────────────────────────────
 * CLM Operations · Without Shipment ID → Agreements To Approve.
 *
 * Faithful port of the cyan-themed `rAta()` view from the CLM_CaseToCase
 * prototype: header strip, five summary cards, capsule filter tabs
 * (All / Pending / Clarifications / Approved / Rejected), a status-aware
 * table, plus the Take Action modal (Raise Clarification / Reject) and
 * direct Approve flow.
 * ───────────────────────────────────────────────────────────────────────── */

type AtaTab = 'all' | 'pending' | 'clarification' | 'approved' | 'rejected';

const TH  = { padding: '10px 14px', fontSize: 8, fontWeight: 800, letterSpacing: '.12em', textTransform: 'uppercase', color: '#fff', whiteSpace: 'nowrap', textAlign: 'center', background: 'transparent', borderBottom: 'none' } as React.CSSProperties;
const THL = { ...TH, textAlign: 'left' } as React.CSSProperties;
const TD_C = { padding: '11px 14px', verticalAlign: 'middle', borderBottom: '1px solid rgba(6,182,212,.06)', textAlign: 'center' } as React.CSSProperties;
const TD_L = { ...TD_C, textAlign: 'left' } as React.CSSProperties;
const codePill = (dark: boolean): React.CSSProperties => ({ fontFamily: "'Geist Mono', monospace", fontSize: 11, fontWeight: 800, color: dark ? '#67e8f9' : '#0e7490', background: dark ? 'rgba(6,182,212,.2)' : 'rgba(6,182,212,.1)', padding: '4px 9px', borderRadius: 7, border: `1px solid rgba(6,182,212,${dark ? '.42' : '.28'})` });

const S_CFG = {
  approved:      { label: 'Approved', bg: '#ECFDF5', border: '#A7F3D0', color: '#059669', dot: '#10B981' },
  pending:       { label: 'Pending', bg: '#FFFBEB', border: '#FDE68A', color: '#D97706', dot: '#F59E0B' },
  clarification: { label: 'Clarification', bg: '#F5F3FF', border: '#DDD6FE', color: '#7C3AED', dot: '#8B5CF6' },
  rejected:      { label: 'Rejected', bg: '#FEF2F2', border: '#FECACA', color: '#DC2626', dot: '#EF4444' },
} as const;

// Status pills read as glaring light chips on the dark table — swap to translucent
// dark fills + lighter text in dark mode, keyed off the semantic colour.
const badgeTok = (cfg: { bg: string; border: string; color: string }, dark: boolean) => {
  if (!dark) return { bg: cfg.bg, border: cfg.border, text: cfg.color };
  if (cfg.color === '#059669') return { bg: 'rgba(16,185,129,.16)', border: 'rgba(16,185,129,.42)', text: '#6ee7b7' };
  if (cfg.color === '#D97706') return { bg: 'rgba(245,158,11,.16)', border: 'rgba(245,158,11,.42)', text: '#fcd34d' };
  if (cfg.color === '#7C3AED') return { bg: 'rgba(124,58,237,.18)', border: 'rgba(124,58,237,.45)', text: '#c4b5fd' };
  return { bg: 'rgba(239,68,68,.16)', border: 'rgba(239,68,68,.42)', text: '#fca5a5' };
};

export default function ClmAgreementsToApprovePage() {
  const toast = useToast();
  const { user } = useAuth();
  const t = useOpsTheme('cyan');
  const [tab, setTab]   = useState<AtaTab>('pending');
  const [page, setPage] = useState(1);
  // Dynamic rows-per-page — auto-fits the table to the viewport (like the CTC /
  // Sent pages); the user's explicit pick from the pager sticks thereafter.
  const [pageSize, setPageSize] = useState(PER_PAGE);
  const autoFitRef = useRef(true);
  const onPageSize = (n: number) => { autoFitRef.current = false; setPageSize(n); setPage(1); };
  const cardRef = useRef<HTMLDivElement | null>(null);
  // Card stretches to fill the viewport so the pager pins to the screen bottom
  // instead of floating under a short list (leaving a big empty gap).
  const [fillH, setFillH] = useState<number | undefined>(undefined);
  const [actionId, setActionId] = useState<string | null>(null);
  const [actionChoice, setActionChoice] = useState<'clarify' | 'reject' | null>(null);
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [ata, setAta]   = useState<AtaRow[]>([]);
  const [loading, setLoading] = useState(true);
  // True while an approve / reject / clarify request is in flight — keeps the
  // modal open with a spinner so the user knows the action is processing.
  const [submitting, setSubmitting] = useState(false);
  const load = () => {
    setLoading(true);
    api.get('/clm/ctc-contracts/to-approve')
      .then(r => setAta(r.data?.data ?? []))
      .catch(() => { setAta([]); toast.error('Could not load agreements', 'Please refresh and try again.'); })
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  // Real-time: refetch the moment any approval event lands for this tenant
  // (Reverb private channel) + on tab focus as a dropped-socket safety net.
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
    all:           ata.length,
    pending:       ata.filter(c => c.status === 'pending').length,
    clarification: ata.filter(c => c.status === 'clarification').length,
    approved:      ata.filter(c => c.status === 'approved').length,
    rejected:      ata.filter(c => c.status === 'rejected').length,
  }), [ata]);

  const list = useMemo(() => tab === 'all' ? ata : ata.filter(c => c.status === tab), [ata, tab]);
  const actionContract = ata.find(c => c.id === actionId) || null;
  const reviewContract = ata.find(c => c.id === reviewId) || null;

  // Download the approved (or any) agreement's PDF straight from the list —
  // reuses the same fetch path as the Review modal (signature-style preview,
  // falling back to the latest drafted version rendered to PDF).
  const [dlId, setDlId] = useState<string | null>(null);
  const downloadCtcPdf = async (id: string) => {
    const row = ata.find(c => c.id === id); if (!row?.dbId || dlId) return;
    setDlId(id);
    try {
      let blob: Blob;
      try {
        const res = await api.post('/clm/signature-requests/ctc-preview', { contract_id: row.dbId }, { responseType: 'blob' });
        blob = res.data as Blob;
      } catch {
        const meta = await api.get(`/clm/ctc-contracts/${row.dbId}`);
        const r = (meta.data?.data ?? meta.data ?? {}) as Record<string, unknown>;
        const versions = (Array.isArray(r.versions) ? r.versions : []) as { v?: number }[];
        const latestV = versions.length ? Math.max(...versions.map(v => Number(v.v) || 0)) : 1;
        const res2 = await api.get(`/clm/ctc-contracts/${row.dbId}/versions/${latestV}/download`, { responseType: 'blob' });
        blob = res2.data as Blob;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `${row.id || 'agreement'}.pdf`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (e: any) {
      toast.error('Download failed', e?.response?.data?.message ?? 'Could not download the agreement.');
    } finally {
      setDlId(null);
    }
  };

  const doApprove = async (id: string) => {
    const row = ata.find(c => c.id === id); if (!row?.dbId || submitting) return;
    // Keep the Review modal open with a spinner while the request is in flight;
    // close it only once the action succeeds (on error the user can retry).
    setSubmitting(true);
    try { await api.post(`/clm/ctc-contracts/${row.dbId}/approve`); toast.success('Agreement approved', 'Approved successfully'); setReviewId(null); load(); }
    catch { toast.error('Could not approve', 'Please try again.'); }
    finally { setSubmitting(false); }
  };
  const doAction = async (id: string, mode: 'clarification' | 'rejected', comment: string) => {
    const row = ata.find(c => c.id === id); if (!row?.dbId || submitting) return;
    setSubmitting(true);
    try {
      if (mode === 'rejected') { await api.post(`/clm/ctc-contracts/${row.dbId}/reject`, { reason: comment }); toast.error('Agreement rejected', 'Sent back to initiator'); }
      else { await api.post(`/clm/ctc-contracts/${row.dbId}/clarify`, { query: comment }); toast.info('Clarification raised', 'Sent to initiator'); }
      // Success → close both the action popup AND the review PDF behind it.
      setActionId(null); setActionChoice(null); setReviewId(null);
      load();
    } catch { toast.error('Action failed', 'Please try again.'); }
    finally { setSubmitting(false); }
  };

  // Auto-fit rows-per-page to the space below the card so the table fills the
  // viewport. Recomputes on data load, tab switch, and resize; skips while the
  // user has an explicit rows-per-page selected.
  useEffect(() => {
    const recompute = () => {
      const el = cardRef.current; if (!el) return;
      const top = el.getBoundingClientRect().top;
      // Stretch the card to the viewport (leave room for the layout footer + the
      // scroll container's padding, else the pager lands at the fold / cut off).
      const fh = Math.max(240, window.innerHeight - top - 56);
      setFillH(prev => (prev === fh ? prev : fh));

      if (!autoFitRef.current) return;
      const toolbarH = (el.firstElementChild as HTMLElement | null)?.offsetHeight || 0;
      const theadH   = (el.querySelector('table thead') as HTMLElement | null)?.offsetHeight || 0;
      const footerH  = (el.querySelector('.wl-pager') as HTMLElement | null)?.offsetHeight || 54;
      const rowH     = (el.querySelector('table tbody tr') as HTMLElement | null)?.offsetHeight || 48;
      const rowsFit  = Math.floor((fh - toolbarH - theadH - footerH - 20) / rowH);
      setPageSize(prev => { const next = Math.max(4, rowsFit); return prev === next ? prev : next; });
    };
    recompute();
    const raf = requestAnimationFrame(recompute);
    const tm = window.setTimeout(recompute, 120);
    window.addEventListener('resize', recompute);
    return () => { window.removeEventListener('resize', recompute); window.clearTimeout(tm); cancelAnimationFrame(raf); };
  }, [loading, tab, ata.length]);

  return (
    <div style={{ padding: 0, display: 'flex', flexDirection: 'column', gap: 14, fontFamily: 'var(--font-sans)' }}>
      <style>{ATA_CSS}</style>

      {/* HEADER STRIP */}
      <div style={{ position: 'relative', overflow: 'hidden', display: 'flex', alignItems: 'center', padding: '0 18px', minHeight: 64, border: `1px solid ${t.dark ? 'rgba(6,182,212,.25)' : 'rgba(6,182,212,.3)'}`, borderRadius: 14, background: t.dark ? '#102234' : 'linear-gradient(110deg,#ecfffe 0%,#cffafe 25%,#a5f3fc 55%,#67e8f9 80%,#22d3ee 100%)', boxShadow: t.dark ? '0 2px 10px rgba(6,182,212,.1)' : '0 2px 0 rgba(255,255,255,.88) inset,0 4px 18px rgba(6,182,212,.2)' }}>
        <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, background: 'linear-gradient(180deg,#22d3ee,#0891b2,#0e7490)', borderRadius: '14px 0 0 14px' }} />
        {!t.dark && <span style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '50%', background: 'linear-gradient(180deg,rgba(255,255,255,.52),transparent)', pointerEvents: 'none', borderRadius: '14px 14px 0 0' }} />}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, zIndex: 1, paddingLeft: 10 }}>
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <div style={{ width: 38, height: 38, borderRadius: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg,#0891b2,#0e7490)', boxShadow: '0 0 0 3px rgba(6,182,212,.25),0 4px 12px rgba(8,145,178,.4)' }}>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><polyline points="9 12 11 14 15 10" /></svg>
            </div>
            <span style={{ position: 'absolute', bottom: -1, right: -1, width: 9, height: 9, borderRadius: '50%', background: 'linear-gradient(135deg,#4ade80,#22c55e)', border: '2px solid #cef8ff', boxShadow: '0 0 6px rgba(34,197,94,.4)' }} />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
              <div style={{ fontSize: 16, fontWeight: 500, color: t.dark ? '#67e8f9' : '#0c4a6e', letterSpacing: '-.4px', lineHeight: 1.15 }}>Agreements To Approve</div>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 9px', borderRadius: 20, background: 'rgba(6,182,212,.15)', border: '1px solid rgba(6,182,212,.35)' }}>
                <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#22c55e', boxShadow: '0 0 5px rgba(34,197,94,.5)' }} />
                <span style={{ fontSize: 8.5, fontWeight: 800, color: t.dark ? '#7dd3fc' : '#0e7490', letterSpacing: '.06em' }}>ACTIVE</span>
              </span>
            </div>
            <div style={{ fontSize: 11, fontWeight: 500, color: t.dark ? '#7dd3fc' : '#0e7490', opacity: .9, lineHeight: 1.4, maxWidth: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Review and approve agreements received for internal approval — accept, reject, or request clarification before sending to counterparties.</div>
          </div>
        </div>
      </div>

      {/* SUMMARY CARDS */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 8 }}>
        <StatCard t={t} accent="#06b6d4,#0891b2" border="#A5F3FC" titleColor="#164e63" tag="Total" tagBg="#CFFAFE" tagColor="#0891b2" value={counts.all} label="Total Received" sub="All agreements received"
          icon={<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>} />
        <StatCard t={t} accent="#f59e0b,#d97706" border="#FEF3C7" titleColor="#92400E" tag="Pending" tagBg="#FEF3C7" tagColor="#D97706" value={counts.pending} label="Pending Approval" sub="Awaiting your decision"
          icon={<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>} />
        <StatCard t={t} accent="#8B5CF6,#7C3AED" border="#DDD6FE" titleColor="#4C1D95" tag="Query" tagBg="#EDE9FE" tagColor="#7C3AED" value={counts.clarification} label="Clarifications" sub="Queries raised, awaiting reply"
          icon={<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>} />
        <StatCard t={t} accent="#10b981,#059669" border="#D1FAE5" titleColor="#065F46" tag="Approved" tagBg="#D1FAE5" tagColor="#059669" value={counts.approved} label="Approved" sub="Approved by you"
          icon={<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round"><polyline points="20 6 9 17 4 12" /></svg>} />
        <StatCard t={t} accent="#ef4444,#dc2626" border="#FEE2E2" titleColor="#7F1D1D" tag="Rejected" tagBg="#FEE2E2" tagColor="#DC2626" value={counts.rejected} label="Rejected" sub="Sent back or declined"
          icon={<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></svg>} />
      </div>

      {/* FILTER TABS + TABLE */}
      <div ref={cardRef} style={{ background: t.surface, borderRadius: 14, border: `1.5px solid ${t.dark ? t.border : '#A5F3FC'}`, boxShadow: '0 1px 4px rgba(6,182,212,.08)', overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: fillH }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 14px', background: t.surface, borderBottom: `1.5px solid ${t.dark ? t.border : 'rgba(6,182,212,.18)'}`, flexWrap: 'wrap', flexShrink: 0 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', background: t.tabCapsule, borderRadius: 30, padding: 4, boxShadow: t.dark ? 'none' : 'inset 0 1px 4px rgba(6,182,212,.15)' }}>
            {([
              ['all', 'All Agreements', null],
              ['pending', 'Pending Approval', null],
              ['clarification', 'Clarifications', '#8B5CF6'],
              ['approved', 'Approved', '#10B981'],
              ['rejected', 'Rejected', '#EF4444'],
            ] as [AtaTab, string, string | null][]).map(([key, label, dot]) => {
              const active = tab === key;
              return (
                <button key={key} onClick={() => { setTab(key); setPage(1); }}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '8px 16px', borderRadius: 25, border: 'none', fontFamily: 'inherit', fontSize: 12, fontWeight: active ? 800 : 700, cursor: 'pointer', transition: 'all .18s', position: 'relative', overflow: 'hidden',
                    background: active ? 'linear-gradient(135deg,#0e7490,#0891b2,#06b6d4)' : 'transparent', color: active ? '#fff' : t.tabInactive,
                    boxShadow: active ? '0 3px 12px rgba(6,182,212,.5),inset 0 1px 0 rgba(255,255,255,.22)' : 'none' }}>
                  {active && <span style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '50%', background: 'linear-gradient(180deg,rgba(255,255,255,.2),transparent)', borderRadius: '25px 25px 0 0', pointerEvents: 'none' }} />}
                  {dot && <span style={{ width: 7, height: 7, borderRadius: '50%', background: active ? 'rgba(255,255,255,.9)' : dot, flexShrink: 0, boxShadow: active ? 'none' : `0 0 0 2px ${dot}40` }} />}
                  <span style={{ position: 'relative', zIndex: 1 }}>{label}</span>
                  <span style={{ position: 'relative', zIndex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 18, height: 18, padding: '0 5px', borderRadius: 20, background: active ? 'rgba(255,255,255,.28)' : 'rgba(14,116,144,.2)', fontSize: 9, fontWeight: 900, color: active ? '#fff' : t.tabInactive }}>{pad2(counts[key])}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          {loading
            ? <ShimmerTable rows={6} cols={9} />
            : tab === 'clarification'
            ? <ClarificationTable rows={list} page={page} setPage={setPage} pageSize={pageSize} onPageSize={onPageSize} onReview={setReviewId} onChat={(id) => { setActionChoice('clarify'); setActionId(id); }} t={t} />
            : <StandardTable rows={list} tab={tab} page={page} setPage={setPage} pageSize={pageSize} onPageSize={onPageSize} onReview={setReviewId} onDownload={downloadCtcPdf} dlId={dlId} t={t} />}
        </div>
      </div>

      {reviewContract && (
        <ReviewApproveModal
          contract={reviewContract}
          onClose={() => setReviewId(null)}
          onApprove={(id) => doApprove(id)}
          /* Keep the review modal mounted behind — the clarify/reject popup
             stacks ON TOP of the PDF, so cancelling returns to the document. */
          onClarify={(id) => { setActionChoice('clarify'); setActionId(id); }}
          onReject={(id) => { setActionChoice('reject'); setActionId(id); }}
          submitting={submitting}
          t={t}
        />
      )}
      {actionContract && <TakeActionModal contract={actionContract} initialChoice={actionChoice} onClose={() => { setActionId(null); setActionChoice(null); }} onSubmit={doAction} submitting={submitting} t={t} />}
    </div>
  );
}

function StatCard({ t, accent, border, titleColor, tag, tagBg, tagColor, value, label, sub, icon }: {
  t: OpsTokens; accent: string; border: string; titleColor: string; tag: string; tagBg: string; tagColor: string; value: number; label: string; sub: string; icon: React.ReactNode;
}) {
  const [c1, c2] = accent.split(',');
  return (
    <div style={{ position: 'relative', overflow: 'hidden', borderRadius: 12, padding: '12px 14px', background: t.surface, border: `1.5px solid ${t.dark ? t.border : border}`, boxShadow: '0 1px 4px rgba(6,182,212,.1)', transition: 'all .18s', display: 'flex', alignItems: 'center', gap: 11 }}
      onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 6px 18px rgba(6,182,212,.2)'; }}
      onMouseLeave={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = '0 1px 4px rgba(6,182,212,.1)'; }}>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 4, borderRadius: '12px 12px 0 0', background: `linear-gradient(90deg,${c1},${c2})` }} />
      <div style={{ width: 36, height: 36, borderRadius: 10, background: `linear-gradient(135deg,${c1},${c2})`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: `0 3px 10px ${c1}59,inset 0 1px 0 rgba(255,255,255,.2)` }}>{icon}</div>
      <div style={{ flex: 1, minWidth: 0, position: 'relative', zIndex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 1 }}>
          <span style={{ fontSize: 9.5, fontWeight: 700, color: t.dark ? t.textSub : titleColor }}>{label}</span>
          <span style={{ fontSize: 7, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', padding: '2px 6px', borderRadius: 20, background: t.dark ? 'rgba(255,255,255,.06)' : tagBg, color: tagColor }}>{tag}</span>
        </div>
        <div style={{ fontSize: 24, fontWeight: 900, letterSpacing: '-1.5px', color: t.dark ? t.textStrong : titleColor, lineHeight: 1.1, marginBottom: 1 }}>{pad2(value)}</div>
        <div style={{ fontSize: 8, fontWeight: 500, color: t.textMuted }}>{sub}</div>
      </div>
    </div>
  );
}

function Pager({ total, page, setPage, t }: { total: number; page: number; setPage: (n: number) => void; t: OpsTokens }) {
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));
  const safe = Math.min(page, totalPages);
  const start = (safe - 1) * PER_PAGE;
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', background: t.pagerBg, borderTop: `1.5px solid ${t.dark ? t.border : '#A5F3FC'}` }}>
      <span style={{ fontSize: 11.5, color: t.dark ? '#67e8f9' : '#0e7490', fontWeight: 500 }}>Showing <b style={{ color: t.dark ? '#cffafe' : '#164e63', fontWeight: 800 }}>{total === 0 ? 0 : start + 1}–{Math.min(start + PER_PAGE, total)}</b> of <b style={{ color: t.dark ? '#cffafe' : '#164e63', fontWeight: 800 }}>{total}</b></span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => {
          const a = p === safe;
          return <button key={p} onClick={() => setPage(p)} disabled={a} style={{ minWidth: 30, height: 30, padding: '0 7px', borderRadius: 7, border: `1.5px solid ${a ? '#0891b2' : 'rgba(8,145,178,.2)'}`, background: a ? 'linear-gradient(135deg,#06b6d4,#0891b2)' : t.pagerBtn, color: a ? '#fff' : (t.dark ? '#67e8f9' : '#0891b2'), fontFamily: 'inherit', fontSize: 12, fontWeight: a ? 900 : 600, cursor: a ? 'default' : 'pointer' }}>{p}</button>;
        })}
      </div>
    </div>
  );
}

/* Opens the Review & Approve modal (read the PDF, then approve / reject /
   clarify). Named for what it does — it doesn't approve directly. */
function ReviewBtn({ active, onClick, onBlocked }: { active: boolean; onClick: () => void; onBlocked?: () => void }) {
  return (
    <Tooltip label={active ? 'Review & Approve' : 'Awaiting clarification response'}>
      <button onClick={() => (active ? onClick() : onBlocked?.())} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 12px', borderRadius: 8, border: active ? 'none' : '1.5px solid #E2E8F0', background: active ? 'linear-gradient(135deg,#0891b2,#0e7490)' : '#F8FAFC', color: active ? '#fff' : '#CBD5E1', fontFamily: 'inherit', fontSize: 9.5, fontWeight: active ? 700 : 600, cursor: 'pointer', boxShadow: active ? '0 2px 7px rgba(8,145,178,.35)' : 'none', whiteSpace: 'nowrap', opacity: active ? 1 : .6 }}>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={active ? '#fff' : '#CBD5E1'} strokeWidth="2" strokeLinecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg> Review &amp; Approve
      </button>
    </Tooltip>
  );
}

/* Respond / chat button — opens the shared clarification thread so ANY approver
   on the contract can read the conversation and add their own remark. Always
   active (unlike Review & Approve, which waits for the initiator's reply). */
function RespondBtn({ onClick, t }: { onClick: () => void; t: OpsTokens }) {
  const fg = t.dark ? '#67e8f9' : '#0e7490';
  return (
    <Tooltip label="View conversation & add your remark">
      <button onClick={onClick} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 11px', borderRadius: 8, border: `1.5px solid ${t.dark ? 'rgba(6,182,212,.45)' : '#A5F3FC'}`, background: t.dark ? 'rgba(6,182,212,.14)' : '#ECFEFF', color: fg, fontFamily: 'inherit', fontSize: 9.5, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={fg} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg> Respond
      </button>
    </Tooltip>
  );
}

/* View + Take Action buttons removed — the Review & Approve modal now handles
   viewing the PDF and all three actions (clarify / reject / approve). The old
   chat-bubble button is gone too: the full conversation history now lives inside
   the Raise Clarification popup itself. */

/* Lists every approver on a contract with their individual decision (✓/✕/?/•),
   so a multi-approver / multi-round agreement shows who actually decided rather
   than just the static primary approver. Falls back to the single `approver`. */
const APPR_ST: Record<string, { ic: string; color: string }> = {
  approved:      { ic: '✓', color: '#059669' },
  rejected:      { ic: '✕', color: '#DC2626' },
  clarification: { ic: '?', color: '#7C3AED' },
  pending:       { ic: '•', color: '#94A3B8' },
};
function ApproverList({ c, t }: { c: AtaContract; t: OpsTokens }) {
  const list = (c.approvers && c.approvers.length)
    ? c.approvers
    : (c.approver ? [{ name: c.approver, status: c.status }] : []);
  if (!list.length) return <span style={{ fontSize: 11, color: t.textSub }}>—</span>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      {list.map((a, i) => {
        const si = APPR_ST[a.status] || APPR_ST.pending;
        return (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span title={a.status} style={{ width: 15, height: 15, borderRadius: '50%', background: si.color, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 8.5, fontWeight: 900, color: '#fff', flexShrink: 0 }}>{si.ic}</span>
            <span style={{ fontSize: 11, fontWeight: 600, color: t.text, whiteSpace: 'nowrap' }}>{a.name}</span>
          </div>
        );
      })}
    </div>
  );
}

function StandardTable({ rows, tab, page, setPage, pageSize, onPageSize, onReview, onDownload, dlId, t }: { rows: AtaContract[]; tab: AtaTab; page: number; setPage: (n: number) => void; pageSize: number; onPageSize: (n: number) => void; onReview: (id: string) => void; onDownload: (id: string) => void; dlId: string | null; t: OpsTokens }) {
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const safe = Math.min(page, totalPages);
  const start = (safe - 1) * pageSize;
  const slice = rows.slice(start, start + pageSize);
  const isRej = tab === 'rejected';

  if (!slice.length) {
    return (
      <div style={{ background: t.dark ? t.tableBg : '#F0FDFF', minHeight: 160, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 20px' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ width: 48, height: 48, borderRadius: 13, background: 'linear-gradient(135deg,#E0F7FA,#A5F3FC)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px' }}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#0891b2" strokeWidth="2" strokeLinecap="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg></div>
          <div style={{ fontSize: 13, fontWeight: 800, color: t.dark ? '#67e8f9' : '#164e63', marginBottom: 5 }}>No Agreements Found</div>
          <div style={{ fontSize: 10.5, color: t.textMuted, maxWidth: 280, lineHeight: 1.6 }}>No {tab === 'all' ? 'agreements received' : tab + ' agreements'} yet.</div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ background: t.tableBg, overflow: 'hidden', flex: 1, display: 'flex', flexDirection: 'column' }}>
      <div style={{ overflowX: 'auto', flex: 1 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1200 }}>
          <thead><tr style={{ background: 'linear-gradient(90deg,#0e7490 0%,#0891b2 35%,#06b6d4 70%,#22d3ee 100%)' }}>
            <th style={{ ...TH, width: 52 }}>SR. NO</th>
            <th style={{ ...TH, width: 110 }}>CTC ID</th>
            <th style={{ ...TH, width: 110 }}>CTC DATE</th>
            <th style={THL}>AGREEMENT TITLE</th>
            <th style={{ ...THL, width: 120 }}>CREATED BY</th>
            <th style={{ ...THL, width: 120 }}>APPROVER</th>
            <th style={{ ...TH, width: 120 }}>STATUS</th>
            {isRej && <th style={THL}>REJECTION REASON</th>}
            <th style={{ ...TH, width: 100 }}>EXPIRY DATE</th>
            <th style={{ ...TH, width: 185 }}>ACTION</th>
          </tr></thead>
          <tbody>
            {slice.map((c, i) => {
              const n = start + i + 1;
              const s = S_CFG[c.status];
              const sb = badgeTok(s, t.dark);
              const bg = n % 2 === 0 ? t.rowAlt : t.tableBg;
              const actionable = c.status === 'pending' || c.status === 'clarification';
              return (
                <tr key={c.id + i} style={{ background: bg, transition: 'all .12s' }}
                  onMouseEnter={e => { e.currentTarget.style.background = t.rowHover; e.currentTarget.style.boxShadow = 'inset 3px 0 0 #0891b2'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = bg; e.currentTarget.style.boxShadow = 'none'; }}>
                  <td style={TD_C}><div style={{ width: 28, height: 28, borderRadius: '50%', background: 'linear-gradient(135deg,#0891b2,#0e7490)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 6px rgba(8,145,178,.35)' }}><span style={{ fontSize: 10, fontWeight: 900, color: '#fff' }}>{pad2(n)}</span></div></td>
                  <td style={TD_C}><span style={codePill(t.dark)}>{c.id}</span></td>
                  <td style={TD_C}>{(() => { const dt = dateTimeParts(c.date); return (<span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}><span style={{ fontSize: 11.5, fontWeight: 600, color: t.textSub, whiteSpace: 'nowrap' }}>{dt.date}</span>{dt.time && <span style={{ fontSize: 9, fontWeight: 600, color: t.dark ? '#67e8f9' : '#0891b2', whiteSpace: 'nowrap' }}>{dt.time}</span>}</span>); })()}</td>
                  <td style={TD_L}><Tooltip label={c.title}><div style={{ fontSize: 12.5, fontWeight: 700, color: t.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 190 }}>{c.title}</div></Tooltip></td>
                  <td style={TD_L}><div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><div style={{ width: 26, height: 26, borderRadius: '50%', background: 'linear-gradient(135deg,#A5F3FC,#67E8F9)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, border: '1.5px solid #CFFAFE' }}><span style={{ fontSize: 8.5, fontWeight: 900, color: '#0e7490' }}>{inits(c.createdBy)}</span></div><span style={{ fontSize: 11, fontWeight: 600, color: t.text, whiteSpace: 'nowrap' }}>{c.createdBy}</span></div></td>
                  <td style={TD_L}><ApproverList c={c} t={t} /></td>
                  <td style={TD_C}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 20, background: sb.bg, border: `1.5px solid ${sb.border}`, whiteSpace: 'nowrap' }}><span style={{ width: 5, height: 5, borderRadius: '50%', background: s.dot, flexShrink: 0 }} /><span style={{ fontSize: 10.5, fontWeight: 700, color: sb.text }}>{s.label}</span></span></td>
                  {isRej && <td style={{ ...TD_L, maxWidth: 180 }}><Tooltip label={c.rejReason ?? ''}><div style={{ fontSize: 10.5, color: '#DC2626', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 175 }}>{c.rejReason}</div></Tooltip></td>}
                  <td style={TD_C}><span style={{ fontSize: 11, fontWeight: 600, color: t.textSub, whiteSpace: 'nowrap' }}>{dashDate(c.expDate)}</span></td>
                  <td style={TD_C}>
                    {actionable ? (
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
                        <ReviewBtn active onClick={() => onReview(c.id)} />
                      </div>
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                        <Tooltip label={dlId === c.id ? 'Preparing PDF…' : 'Download agreement PDF'}>
                          <button type="button" onClick={() => onDownload(c.id)} disabled={dlId === c.id} aria-label="Download agreement PDF" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 27, height: 27, borderRadius: 8, border: `1px solid ${c.status === 'approved' ? '#A7F3D0' : '#FECACA'}`, background: c.status === 'approved' ? '#ECFDF5' : '#FEF2F2', color: c.status === 'approved' ? '#059669' : '#DC2626', cursor: dlId === c.id ? 'wait' : 'pointer', flexShrink: 0 }}>
                            {dlId === c.id
                              ? <svg className="ata-spin" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
                              : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>}
                          </button>
                        </Tooltip>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <WorklistPager total={rows.length} page={safe} pageSize={pageSize} onPage={setPage} onPageSize={onPageSize} className="wl-teal" />
    </div>
  );
}

function ClarificationTable({ rows, page, setPage, pageSize, onPageSize, onReview, onChat, t }: { rows: AtaContract[]; page: number; setPage: (n: number) => void; pageSize: number; onPageSize: (n: number) => void; onReview: (id: string) => void; onChat: (id: string) => void; t: OpsTokens }) {
  const toast = useToast();
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const safe = Math.min(page, totalPages);
  const start = (safe - 1) * pageSize;
  const slice = rows.slice(start, start + pageSize);

  if (!slice.length) {
    return <div style={{ background: t.dark ? t.tableBg : '#F0FDFF', minHeight: 160, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 20px' }}><div style={{ fontSize: 13, fontWeight: 800, color: t.dark ? '#67e8f9' : '#164e63' }}>No clarification requests.</div></div>;
  }

  return (
    <div style={{ background: t.tableBg, overflow: 'hidden', flex: 1, display: 'flex', flexDirection: 'column' }}>
      <div style={{ overflowX: 'auto', flex: 1 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1200 }}>
          <thead><tr style={{ background: 'linear-gradient(90deg,#0e7490 0%,#0891b2 35%,#06b6d4 70%,#22d3ee 100%)' }}>
            <th style={{ ...TH, width: 52 }}>SR. NO</th>
            <th style={{ ...TH, width: 110 }}>CTC ID</th>
            <th style={{ ...TH, width: 110 }}>CTC DATE</th>
            <th style={THL}>AGREEMENT TITLE</th>
            <th style={{ ...THL, width: 120 }}>CREATED BY</th>
            <th style={{ ...THL, width: 120 }}>APPROVER</th>
            <th style={THL}>CLARIFICATION QUERY</th>
            <th style={{ ...TH, width: 100 }}>EXPIRY DATE</th>
            <th style={{ ...TH, width: 220 }}>ACTION</th>
          </tr></thead>
          <tbody>
            {slice.map((c, i) => {
              const n = start + i + 1;
              const latest = c.clarifications.length ? c.clarifications[c.clarifications.length - 1] : null;
              const hasResp = !!(latest && latest.response);
              const bg = n % 2 === 0 ? (t.dark ? 'rgba(6,182,212,.05)' : 'rgba(236,254,255,.5)') : t.tableBg;
              return (
                <tr key={c.id} style={{ background: bg, transition: 'all .12s' }}
                  onMouseEnter={e => { e.currentTarget.style.background = t.dark ? 'rgba(6,182,212,.14)' : 'rgba(6,182,212,.06)'; e.currentTarget.style.boxShadow = 'inset 3px 0 0 #0891b2'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = bg; e.currentTarget.style.boxShadow = 'none'; }}>
                  <td style={TD_C}><div style={{ width: 28, height: 28, borderRadius: '50%', background: 'linear-gradient(135deg,#0891b2,#0e7490)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 6px rgba(8,145,178,.35)' }}><span style={{ fontSize: 10, fontWeight: 900, color: '#fff' }}>{pad2(n)}</span></div></td>
                  <td style={TD_C}><span style={{ fontFamily: "'Geist Mono', monospace", fontSize: 11, fontWeight: 800, color: t.dark ? '#67e8f9' : '#0e7490', background: 'rgba(6,182,212,.1)', padding: '4px 9px', borderRadius: 7, border: '1px solid rgba(6,182,212,.28)' }}>{c.id}</span></td>
                  <td style={TD_C}>{(() => { const dt = dateTimeParts(c.date); return (<span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}><span style={{ fontSize: 11.5, fontWeight: 600, color: t.textSub, whiteSpace: 'nowrap' }}>{dt.date}</span>{dt.time && <span style={{ fontSize: 9, fontWeight: 600, color: t.dark ? '#67e8f9' : '#0891b2', whiteSpace: 'nowrap' }}>{dt.time}</span>}</span>); })()}</td>
                  <td style={TD_L}><Tooltip label={c.title}><div style={{ fontSize: 12.5, fontWeight: 700, color: t.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 190 }}>{c.title}</div></Tooltip></td>
                  <td style={TD_L}><div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><div style={{ width: 24, height: 24, borderRadius: '50%', background: 'linear-gradient(135deg,#22d3ee,#06b6d4)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><span style={{ fontSize: 8, fontWeight: 900, color: '#fff' }}>{inits(c.createdBy)}</span></div><span style={{ fontSize: 11, fontWeight: 600, color: t.text, whiteSpace: 'nowrap' }}>{c.createdBy}</span></div></td>
                  <td style={TD_L}><ApproverList c={c} t={t} /></td>
                  <td style={{ ...TD_L, maxWidth: 220 }}>
                    <Tooltip label={latest?.query ?? ''}><div style={{ fontSize: 11, color: t.textSub, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 220 }}>{latest?.query ?? '—'}</div></Tooltip>
                    {hasResp && <div style={{ fontSize: 9.5, color: '#059669', fontWeight: 600, marginTop: 2 }}>✓ Response provided</div>}
                  </td>
                  <td style={TD_C}><span style={{ fontSize: 11, fontWeight: 600, color: t.textSub, whiteSpace: 'nowrap' }}>{dashDate(c.expDate)}</span></td>
                  <td style={TD_C}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, flexWrap: 'nowrap' }}>
                      {/* Open the shared clarification thread — available to EVERY
                          approver (not just the one who raised it) so any of them
                          can read the conversation and add their own remark. */}
                      <RespondBtn onClick={() => onChat(c.id)} t={t} />
                      <ReviewBtn active={hasResp} onClick={() => onReview(c.id)} onBlocked={() => toast.warning('Clarification pending', `Awaiting clarification response from ${c.createdBy}. You can review & approve once they reply.`)} />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <WorklistPager total={rows.length} page={safe} pageSize={pageSize} onPage={setPage} onPageSize={onPageSize} className="wl-teal" />
    </div>
  );
}

/* ── Take Action modal (Raise Clarification / Reject) ── */
function TakeActionModal({ contract, onClose, onSubmit, initialChoice = null, submitting = false, t }: { contract: AtaContract; onClose: () => void; onSubmit: (id: string, mode: 'clarification' | 'rejected', comment: string) => void; initialChoice?: 'clarify' | 'reject' | null; submitting?: boolean; t: OpsTokens }) {
  const [choice, setChoice] = useState<'clarify' | 'reject' | null>(initialChoice);
  const [comment, setComment] = useState('');
  const [err, setErr] = useState(false);
  const { typingName, notifyTyping, stopTyping } = useTyping(contract.id);

  const close = () => { stopTyping(); onClose(); };

  const submit = () => {
    if (!choice) { setErr(true); return; }
    if (!comment.trim()) { setErr(true); return; }
    stopTyping();
    onSubmit(contract.id, choice === 'reject' ? 'rejected' : 'clarification', comment.trim());
  };

  return (
    <div onClick={e => { if (e.target === e.currentTarget) close(); }} style={{ position: 'fixed', inset: 0, zIndex: 9999999, background: 'rgba(8,3,28,.82)', backdropFilter: 'blur(14px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, fontFamily: 'var(--font-sans)' }}>
      <div style={{ width: '100%', maxWidth: 520, borderRadius: 24, overflow: 'hidden', boxShadow: '0 50px 100px rgba(8,3,28,.5),0 20px 40px rgba(6,182,212,.12)', border: '1px solid rgba(255,255,255,.1)', animation: 'ataSlideUp .24s cubic-bezier(.22,1,.36,1) both', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
        {/* Header — red for reject, cyan for clarify / default. */}
        <div style={{ background: choice === 'reject' ? 'radial-gradient(rgba(255,255,255,.16) 1.1px, transparent 1.1px), linear-gradient(135deg,#7f1d1d 0%,#b91c1c 42%,#dc2626 78%,#ef4444 100%)' : 'radial-gradient(rgba(255,255,255,.16) 1.1px, transparent 1.1px), linear-gradient(135deg,#0e7490 0%,#0891b2 45%,#06b6d4 80%,#22d3ee 100%)', backgroundSize: '14px 14px, auto', padding: '22px 24px 20px', position: 'relative', overflow: 'hidden', flexShrink: 0 }}>
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '55%', background: 'linear-gradient(180deg,rgba(255,255,255,.18),transparent)', pointerEvents: 'none' }} />
          <div style={{ position: 'relative', zIndex: 1, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <div style={{ width: 46, height: 46, borderRadius: 14, background: 'rgba(255,255,255,.2)', border: '1.5px solid rgba(255,255,255,.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 12px rgba(0,0,0,.15)' }}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg></div>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 4 }}><span style={{ fontSize: 9, fontWeight: 800, color: 'rgba(255,255,255,.65)', letterSpacing: '.16em', textTransform: 'uppercase' }}>{contract.id}</span><span style={{ width: 3, height: 3, borderRadius: '50%', background: 'rgba(255,255,255,.4)' }} /><span style={{ fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,.65)', letterSpacing: '.1em', textTransform: 'uppercase' }}>{initialChoice === 'clarify' ? 'Raise Clarification' : initialChoice === 'reject' ? 'Reject Agreement' : 'Review Action'}</span></div>
                <div style={{ fontSize: 18, fontWeight: 900, color: '#fff', letterSpacing: '-.4px', lineHeight: 1.15, maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{contract.title}</div>
              </div>
            </div>
            <button onClick={close} style={{ width: 34, height: 34, borderRadius: 10, background: 'rgba(255,255,255,.15)', border: '1.5px solid rgba(255,255,255,.25)', color: '#fff', fontSize: 17, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>✕</button>
          </div>
        </div>


        {/* Body */}
        <div style={{ padding: '20px 24px 22px', background: t.surface, overflowY: 'auto' }}>
          {/* When a specific action was chosen from the Review modal, this popup
              is single-purpose — the Choose-Action cards are hidden entirely. */}
          {!initialChoice && (
            <>
              <div style={{ fontSize: 8.5, fontWeight: 800, letterSpacing: '.12em', textTransform: 'uppercase', color: t.textMuted, marginBottom: 12 }}>Choose Action</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
                <ChoiceCard sel={choice === 'clarify'} onClick={() => { setChoice('clarify'); setErr(false); }} grad="#7C3AED,#5B21B6" selBg={t.dark ? 'rgba(124,58,237,.2)' : '#EDE9FE'} selBd={t.dark ? 'rgba(124,58,237,.5)' : '#C4B5FD'} baseBg={t.dark ? 'rgba(124,58,237,.08)' : '#FAF5FF'} baseBd={t.dark ? 'rgba(124,58,237,.22)' : '#E8E4F9'} title="Raise Clarification" titleColor={t.dark ? '#ddd6fe' : '#3B0764'} sub="Request more info or details from the agreement initiator." subColor={t.dark ? '#c4b5fd' : '#7C3AED'}
                  icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>} />
                <ChoiceCard sel={choice === 'reject'} onClick={() => { setChoice('reject'); setErr(false); }} grad="#EF4444,#DC2626" selBg={t.dark ? 'rgba(239,68,68,.18)' : '#FEE2E2'} selBd={t.dark ? 'rgba(239,68,68,.5)' : '#FCA5A5'} baseBg={t.dark ? 'rgba(239,68,68,.07)' : '#FEF2F2'} baseBd={t.dark ? 'rgba(239,68,68,.2)' : '#FEE2E2'} title="Reject Agreement" titleColor={t.dark ? '#fca5a5' : '#7F1D1D'} sub="Decline this agreement and notify the initiator with your reason." subColor={t.dark ? '#f87171' : '#DC2626'}
                  icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></svg>} />
              </div>
            </>
          )}
          {choice === 'clarify' && (
            <div style={{ marginBottom: 16 }}>
              <ClarificationThread contract={contract} typingName={typingName} t={t} />
            </div>
          )}
          <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: '.1em', textTransform: 'uppercase', color: t.textMuted, marginBottom: 7 }}>{choice === 'reject' ? 'Rejection Reason' : choice === 'clarify' ? (contract.clarifications.length > 0 ? 'Add New Clarification Query' : 'Clarification Query') : 'Comment / Reason'} <span style={{ color: '#EF4444' }}>*</span></div>
          <textarea value={comment} onChange={e => { setComment(e.target.value); setErr(false); if (choice === 'clarify') notifyTyping(); }} placeholder={choice === 'reject' ? 'Enter the reason for rejecting this agreement…' : choice === 'clarify' ? 'Enter your clarification query for the initiator…' : 'Enter your clarification query or rejection reason…'}
            style={{ width: '100%', height: 85, padding: '11px 13px', border: `1.5px solid ${err && !comment.trim() ? '#EF4444' : t.searchBorder}`, borderRadius: 11, fontFamily: 'inherit', fontSize: 12, color: t.text, resize: 'none', outline: 'none', lineHeight: 1.55, background: t.searchBg, boxSizing: 'border-box' }} />
          {err && !choice && <div style={{ fontSize: 9, color: '#EF4444', marginTop: 6, fontWeight: 600 }}>Please choose an action.</div>}
          <button onClick={submit} disabled={submitting} style={{ width: '100%', marginTop: 12, padding: 13, borderRadius: 12, border: 'none', background: choice === 'reject' ? 'linear-gradient(135deg,#EF4444,#DC2626)' : 'linear-gradient(135deg,#0e7490,#0891b2,#06b6d4)', color: '#fff', fontFamily: 'inherit', fontSize: 13, fontWeight: 800, cursor: submitting ? 'wait' : 'pointer', opacity: submitting ? .75 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, boxShadow: '0 4px 16px rgba(6,182,212,.4)', letterSpacing: '-.1px' }}>
            {submitting
              ? <svg className="ata-spin" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
              : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round"><polyline points="9 11 12 14 22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg>}
            {submitting ? 'Submitting…' : (choice === 'reject' ? 'Confirm Rejection' : choice === 'clarify' ? 'Submit Clarification' : 'Submit Action')}
          </button>
        </div>
      </div>
    </div>
  );
}

function ChoiceCard({ sel, onClick, grad, selBg, selBd, baseBg, baseBd, title, titleColor, sub, subColor, icon }: {
  sel: boolean; onClick: () => void; grad: string; selBg: string; selBd: string; baseBg: string; baseBd: string; title: string; titleColor: string; sub: string; subColor: string; icon: React.ReactNode;
}) {
  return (
    <div onClick={onClick} style={{ borderRadius: 14, border: `2px solid ${sel ? selBd : baseBd}`, background: sel ? selBg : baseBg, padding: 14, cursor: 'pointer', transition: 'all .18s', boxShadow: sel ? `0 0 0 3px ${selBd}40` : 'none' }}>
      <div style={{ width: 36, height: 36, borderRadius: 10, background: `linear-gradient(135deg,${grad})`, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 10, boxShadow: `0 3px 8px ${grad.split(',')[0]}4d` }}>{icon}</div>
      <div style={{ fontSize: 12, fontWeight: 800, color: titleColor, marginBottom: 3 }}>{title}</div>
      <div style={{ fontSize: 9.5, color: subColor, fontWeight: 500, lineHeight: 1.4 }}>{sub}</div>
    </div>
  );
}

/* ── Clarification conversation thread — embedded inside the Raise Clarification
 *    popup so the approver reads the full back-and-forth (plus a live "typing…"
 *    indicator) right above the box where they add their next query. ── */
function ClarificationThread({ contract, typingName, t }: { contract: AtaContract; typingName: string | null; t: OpsTokens }) {
  return (
    <div style={{ background: t.dark ? '#102234' : '#F0FDFF', border: `1.5px solid ${t.dark ? 'rgba(6,182,212,.28)' : '#CFFAFE'}`, borderRadius: 14, padding: '12px 14px', maxHeight: 230, overflowY: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 11 }}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={t.dark ? '#67e8f9' : '#0891b2'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
        <span style={{ fontSize: 8.5, fontWeight: 800, letterSpacing: '.1em', textTransform: 'uppercase', color: t.dark ? '#67e8f9' : '#0891b2' }}>Conversation History</span>
      </div>
      {contract.clarifications.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '18px 10px', fontSize: 11, fontWeight: 600, color: t.textMuted }}>No previous clarification — this will be the first query.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {contract.clarifications.map((cl, i) => (
            <div key={i}>
              {/* Your query (right) — filled cyan bubble */}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'flex-start' }}>
                <div style={{ maxWidth: '82%', minWidth: 0 }}>
                  <div style={{ fontSize: 8.5, fontWeight: 700, color: t.textMuted, marginBottom: 3, textAlign: 'right' }}>{cl.by || contract.approver} · Approver · {cl.date}</div>
                  <div style={{ background: t.dark ? 'rgba(8,145,178,.18)' : '#E0F7FA', border: `1.5px solid ${t.dark ? 'rgba(6,182,212,.42)' : '#A5F3FC'}`, borderRadius: '12px 4px 12px 12px', padding: '9px 12px', fontSize: 11.5, color: t.dark ? '#a5f3fc' : '#0e7490', lineHeight: 1.55, wordBreak: 'break-word' }}>{cl.query}</div>
                </div>
                <div style={{ width: 26, height: 26, borderRadius: 8, background: 'linear-gradient(135deg,#0891b2,#0e7490)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><span style={{ fontSize: 8.5, fontWeight: 900, color: '#fff' }}>{inits(cl.by || contract.approver)}</span></div>
              </div>
              {/* Sender's revert (left) — white/surface bubble */}
              {cl.response
                ? <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 7 }}>
                    <div style={{ width: 26, height: 26, borderRadius: 8, background: 'linear-gradient(135deg,#22d3ee,#06b6d4)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><span style={{ fontSize: 8.5, fontWeight: 900, color: '#0c4a6e' }}>{inits(contract.createdBy)}</span></div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 8.5, fontWeight: 700, color: t.textMuted, marginBottom: 3 }}>{contract.createdBy} · Initiator</div>
                      <div style={{ background: t.surface, border: `1.5px solid ${t.dark ? 'rgba(6,182,212,.25)' : '#CFFAFE'}`, borderRadius: '4px 12px 12px 12px', padding: '9px 12px', fontSize: 11.5, color: t.textSub, lineHeight: 1.55, wordBreak: 'break-word' }}>{cl.response}</div>
                    </div>
                  </div>
                : <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4, marginTop: 6, marginRight: 34, fontSize: 9, fontWeight: 600, color: '#F59E0B' }}><svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg> Awaiting {contract.createdBy}&apos;s response</div>}
            </div>
          ))}
        </div>
      )}
      <TypingIndicator name={typingName} color={t.dark ? '#67e8f9' : '#0891b2'} />
    </div>
  );
}

/* ── Review & Approve modal — a page-by-page agreement reader. One page is
 *    shown at a time with prev/next navigation; the three action buttons stay
 *    locked until every page has been viewed (maxSeen reaches the last page). ── */
function ReviewApproveModal({ contract, onClose, onApprove, onClarify, onReject, submitting = false, t }: {
  contract: AtaRow; onClose: () => void; onApprove: (id: string) => void; onClarify: (id: string) => void; onReject: (id: string) => void; submitting?: boolean; t: OpsTokens;
}) {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [numPages, setNumPages] = useState(0);
  const [activePage, setActivePage] = useState(1);
  const [maxSeen, setMaxSeen] = useState(1);
  const docRef = useRef<{ numPages: number; getPage: (n: number) => Promise<any> } | null>(null);
  const blobRef = useRef<Blob | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);

  const reachedEnd = numPages > 0 && maxSeen >= numPages;
  // A long agreement (100s of pages) shouldn't force clicking through every page
  // to unlock actions — the reviewer can self-attest with a checkbox instead.
  // Actions unlock on EITHER reaching the last page OR ticking "I have read".
  const [confirmedRead, setConfirmedRead] = useState(false);
  const unlocked = reachedEnd || confirmedRead;

  // Download the agreement PDF (the same blob we're previewing).
  const downloadPdf = () => {
    if (!blobRef.current) return;
    const url = URL.createObjectURL(blobRef.current);
    const a = document.createElement('a');
    a.href = url; a.download = `${contract.id || 'agreement'}.pdf`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  };

  // Action buttons stay tappable even when locked — tapping before the full
  // agreement is read shows a toaster instead of doing nothing.
  const guard = (fn: (id: string) => void) => {
    if (!unlocked) { toast.warning('Read the full agreement', 'Read all pages, or tick "I have read the agreement", before taking an action.'); return; }
    fn(contract.id);
  };
  // Ticking "I have read" self-attests the whole document, so the bar fills to
  // 100% just as if every page had been scrolled through.
  const progressPct = confirmedRead ? 100 : (numPages > 0 ? Math.round((maxSeen / numPages) * 100) : 0);

  // Load the PDF document once.
  useEffect(() => {
    let cancelled = false;
    // Prefer the signature-style preview (page shell + org signature applied).
    // If that render fails for this contract, fall back to the latest drafted
    // version rendered to PDF — the same reliable path the Case-to-Case list
    // "Download" uses — so the reviewer always gets a PDF instead of the
    // "Could not load the agreement PDF." error (QA #7).
    const fetchBlob = async (): Promise<Blob> => {
      try {
        const res = await api.post('/clm/signature-requests/ctc-preview', { contract_id: contract.dbId }, { responseType: 'blob' });
        return res.data as Blob;
      } catch {
        const meta = await api.get(`/clm/ctc-contracts/${contract.dbId}`);
        const r = (meta.data?.data ?? meta.data ?? {}) as Record<string, unknown>;
        const versions = (Array.isArray(r.versions) ? r.versions : []) as { v?: number }[];
        const latestV = versions.length ? Math.max(...versions.map(v => Number(v.v) || 0)) : 1;
        const res2 = await api.get(`/clm/ctc-contracts/${contract.dbId}/versions/${latestV}/download`, { responseType: 'blob' });
        return res2.data as Blob;
      }
    };
    (async () => {
      try {
        const blob = await fetchBlob();
        if (cancelled) return;
        blobRef.current = blob;
        const buf = await blob.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
        if (cancelled) return;
        docRef.current = pdf as unknown as { numPages: number; getPage: (n: number) => Promise<any> };
        setNumPages(pdf.numPages);
        setActivePage(1);
        setMaxSeen(1);
        setLoading(false);
      } catch { if (!cancelled) { setError(true); setLoading(false); } }
    })();
    return () => { cancelled = true; };
  }, [contract.dbId]);

  // Paint the active page onto the canvas, fit to the stage width.
  useEffect(() => {
    if (loading) return;
    const doc = docRef.current; const canvas = canvasRef.current; const stage = stageRef.current;
    if (!doc || !canvas || !stage) return;
    let cancelled = false;
    (async () => {
      const page = await doc.getPage(activePage);
      if (cancelled) return;
      const base = page.getViewport({ scale: 1 });
      const avail = Math.max(280, stage.clientWidth - 56);
      const scale = Math.min(1.7, avail / base.width);
      const vp = page.getViewport({ scale });
      canvas.width = Math.floor(vp.width);
      canvas.height = Math.floor(vp.height);
      canvas.style.width = '100%';
      canvas.style.height = 'auto';
      const ctx = canvas.getContext('2d');
      if (ctx) await page.render({ canvasContext: ctx, viewport: vp }).promise;
    })();
    return () => { cancelled = true; };
  }, [activePage, loading]);

  const go = (n: number) => {
    const next = Math.min(numPages, Math.max(1, n));
    setActivePage(next);
    setMaxSeen(m => Math.max(m, next));
  };

  // Keyboard navigation.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') go(activePage + 1);
      else if (e.key === 'ArrowLeft') go(activePage - 1);
      else if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activePage, numPages]); // eslint-disable-line react-hooks/exhaustive-deps

  const navBtn = (dir: 'prev' | 'next'): React.CSSProperties => {
    const disabled = dir === 'prev' ? activePage <= 1 : activePage >= numPages;
    const pulse = dir === 'next' && !reachedEnd && !disabled;
    return {
      width: 44, height: 44, borderRadius: '50%', border: 'none', flexShrink: 0,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.3 : 1,
      color: '#fff', background: 'linear-gradient(135deg,#0891b2,#0e7490)',
      boxShadow: pulse ? '0 0 0 0 rgba(8,145,178,.5)' : '0 4px 14px rgba(8,145,178,.4)',
      animation: pulse ? 'ataPulse 1.6s infinite' : 'none',
    };
  };

  const actBtn = (c1: string, c2: string): React.CSSProperties => ({
    padding: '10px 16px', borderRadius: 10, border: 'none', fontFamily: 'inherit', fontSize: 12, fontWeight: 800,
    color: '#fff', cursor: 'pointer', opacity: unlocked ? 1 : 0.45,
    background: `linear-gradient(135deg,${c1},${c2})`, whiteSpace: 'nowrap',
    boxShadow: unlocked ? `0 4px 14px ${c1}55` : 'none', transition: 'all .18s',
  });

  return (
    <div onClick={e => { if (e.target === e.currentTarget) onClose(); }} style={{ position: 'fixed', inset: 0, zIndex: 9999999, background: 'rgba(8,3,28,.85)', backdropFilter: 'blur(12px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, fontFamily: 'var(--font-sans)' }}>
      <style>{REVIEW_CSS}</style>
      <div style={{ width: '100%', maxWidth: 860, height: '94vh', background: t.surface, borderRadius: 20, overflow: 'hidden', display: 'flex', flexDirection: 'column', boxShadow: '0 50px 110px rgba(8,3,28,.55)', border: '1px solid rgba(255,255,255,.08)', animation: 'ataSlideUp .26s cubic-bezier(.22,1,.36,1) both' }}>
        {/* Header */}
        <div style={{ background: 'linear-gradient(135deg,#0c4a6e 0%,#0e7490 40%,#0891b2 75%,#06b6d4 100%)', padding: '16px 22px 0', position: 'relative', overflow: 'hidden', flexShrink: 0 }}>
          <span style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '55%', background: 'linear-gradient(180deg,rgba(255,255,255,.16),transparent)', pointerEvents: 'none' }} />
          <div style={{ position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 13, minWidth: 0 }}>
              <div style={{ width: 44, height: 44, borderRadius: 13, background: 'rgba(255,255,255,.2)', border: '1.5px solid rgba(255,255,255,.32)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="9" y1="13" x2="15" y2="13" /><line x1="9" y1="17" x2="13" y2="17" /></svg>
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 8.5, fontWeight: 700, color: 'rgba(255,255,255,.65)', letterSpacing: '.14em', textTransform: 'uppercase', marginBottom: 2 }}>{contract.id} · Review &amp; Approve</div>
                <div style={{ fontSize: 16, fontWeight: 900, color: '#fff', letterSpacing: '-.3px', maxWidth: 520, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{contract.title}</div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
              <Tooltip label="Download PDF">
                <button onClick={downloadPdf} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 32, padding: '0 12px', borderRadius: 9, background: 'rgba(255,255,255,.18)', border: '1px solid rgba(255,255,255,.3)', color: '#fff', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
                  Download
                </button>
              </Tooltip>
              <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: 9, background: 'rgba(255,255,255,.15)', border: '1px solid rgba(255,255,255,.25)', color: '#fff', fontSize: 16, cursor: 'pointer' }}>✕</button>
            </div>
          </div>
          {/* Reading-progress bar */}
          <div style={{ position: 'relative', zIndex: 1, marginTop: 14, height: 4, borderRadius: 4, background: 'rgba(255,255,255,.22)', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${progressPct}%`, background: unlocked ? 'linear-gradient(90deg,#34d399,#10b981)' : 'linear-gradient(90deg,#a5f3fc,#fff)', borderRadius: 4, transition: 'width .3s ease' }} />
          </div>
          <div style={{ position: 'relative', zIndex: 1, padding: '5px 0 8px', fontSize: 8.5, fontWeight: 700, letterSpacing: '.06em', color: 'rgba(255,255,255,.8)', textTransform: 'uppercase' }}>
            {unlocked ? '✓ Fully reviewed' : `Reviewed ${maxSeen} of ${numPages || '…'} pages`}
          </div>
        </div>

        {/* Page stage — the wrapper holds the FIXED arrows (they never scroll
            away); the inner div is the only thing that scrolls a long page. */}
        <div style={{ flex: 1, minHeight: 0, position: 'relative', background: t.dark ? 'radial-gradient(circle at 50% 0%, #14233a, #0b1220)' : 'radial-gradient(circle at 50% 0%, #eef4f8, #d8e2ea)' }}>
          <div ref={stageRef} style={{ position: 'absolute', inset: 0, overflowY: 'auto', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '20px 64px' }}>
            {loading && <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, color: t.dark ? '#cbd5e1' : '#475569' }}><span className="spinner-border text-info" role="status" aria-hidden="true" /><span style={{ fontSize: 12, fontWeight: 600 }}>Loading agreement…</span></div>}
            {error && <div style={{ alignSelf: 'center', textAlign: 'center', color: '#dc2626', fontWeight: 600, fontSize: 12.5 }}>Could not load the agreement PDF.</div>}
            {!loading && !error && (
              <div className="ata-paper" style={{ width: '100%', maxWidth: 620, borderRadius: 6, overflow: 'hidden', boxShadow: '0 12px 40px rgba(8,3,28,.35)', background: '#fff' }}>
                <canvas ref={canvasRef} style={{ width: '100%', height: 'auto', display: 'block', background: '#fff' }} />
              </div>
            )}
          </div>
          {/* Fixed prev / next — pinned to the viewer centre regardless of scroll. */}
          {!loading && !error && numPages > 1 && (
            <>
              <Tooltip label="Previous page">
                <button onClick={() => go(activePage - 1)} disabled={activePage <= 1} style={{ ...navBtn('prev'), position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', zIndex: 5 }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
                </button>
              </Tooltip>
              <Tooltip label="Next page">
                <button onClick={() => go(activePage + 1)} disabled={activePage >= numPages} style={{ ...navBtn('next'), position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', zIndex: 5 }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
                </button>
              </Tooltip>
            </>
          )}

          {/* Consent pill — FLOATS over the document (no white strip), pinned to
              the bottom-centre of the viewer. Only appears once the PDF has
              actually loaded (not during the loading/error state) and stays until
              every page has been scrolled through; ticking it unlocks the actions. */}
          {!loading && !error && numPages > 0 && !reachedEnd && (
            <label style={{
              position: 'absolute', bottom: 6, left: '50%', transform: 'translateX(-50%)', zIndex: 6,
              display: 'inline-flex', alignItems: 'center', gap: 11, cursor: 'pointer', margin: 0,
              padding: '10px 20px', borderRadius: 10, transition: 'all .2s',
              boxShadow: confirmedRead ? '0 8px 24px rgba(5,150,105,.28)' : '0 8px 24px rgba(8,145,178,.22)',
              background: confirmedRead ? (t.dark ? 'rgba(16,185,129,.16)' : '#ecfdf5') : (t.dark ? 'rgba(6,182,212,.14)' : '#ecfeff'),
              border: `1.5px solid ${confirmedRead ? (t.dark ? 'rgba(16,185,129,.4)' : '#a7f3d0') : (t.dark ? 'rgba(6,182,212,.3)' : '#a5f3fc')}`,
            }}>
              <input type="checkbox" checked={confirmedRead} onChange={e => setConfirmedRead(e.target.checked)}
                style={{
                  appearance: 'none', WebkitAppearance: 'none', width: 18, height: 18, borderRadius: 3,
                  cursor: 'pointer', flexShrink: 0, margin: 0, transition: 'all .15s',
                  border: '2px solid #10b981',
                  background: confirmedRead ? '#059669' : (t.dark ? 'transparent' : '#fff'),
                  backgroundImage: confirmedRead ? "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='3.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='20 6 9 17 4 12'/%3E%3C/svg%3E\")" : 'none',
                  backgroundSize: '12px 12px', backgroundPosition: 'center', backgroundRepeat: 'no-repeat',
                }} />
              <span style={{ fontSize: 12.5, fontWeight: 700, lineHeight: 1.3, whiteSpace: 'nowrap', color: t.dark ? '#f1f5f9' : '#0f172a' }}>
                I confirm that I have <strong style={{ fontWeight: 800 }}>read and understood the entire agreement</strong>.
              </span>
            </label>
          )}
        </div>

        {/* Footer: page indicator (left) + gated actions (right) */}
        <div style={{ flexShrink: 0, borderTop: `1px solid ${t.dark ? t.border : '#e2e8f0'}`, background: t.surface, padding: '12px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, height: 32, boxSizing: 'border-box', padding: '0 13px', borderRadius: 30, background: t.dark ? 'rgba(6,182,212,.14)' : '#ecfeff', border: `1.5px solid ${t.dark ? 'rgba(6,182,212,.3)' : '#a5f3fc'}`, fontSize: 11.5, fontWeight: 800, color: t.dark ? '#67e8f9' : '#0e7490' }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
              Page {activePage} / {numPages || '…'}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button onClick={() => guard(onClarify)} disabled={submitting} style={{ ...actBtn('#8B5CF6', '#6D28D9'), opacity: submitting ? .55 : 1, cursor: submitting ? 'not-allowed' : 'pointer' }}>Raise Clarification</button>
            <button onClick={() => guard(onReject)} disabled={submitting} style={{ ...actBtn('#ef4444', '#dc2626'), opacity: submitting ? .55 : 1, cursor: submitting ? 'not-allowed' : 'pointer' }}>Reject</button>
            <button onClick={() => guard(onApprove)} disabled={submitting} style={{ ...actBtn('#0891b2', '#0e7490'), cursor: submitting ? 'wait' : 'pointer' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>{submitting
                ? <><svg className="ata-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>Approving…</>
                : <><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>Approve</>}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const ATA_CSS = `
@keyframes ataSlideUp { from { opacity:0; transform:translateY(18px) scale(.97); } to { opacity:1; transform:none; } }
@keyframes ataSpin { to { transform: rotate(360deg); } }
.ata-spin { animation: ataSpin .8s linear infinite; }
`;

const REVIEW_CSS = `
@keyframes ataSlideUp { from { opacity:0; transform:translateY(18px) scale(.97); } to { opacity:1; transform:none; } }
@keyframes ataPulse {
  0%   { box-shadow: 0 0 0 0 rgba(8,145,178,.5); }
  70%  { box-shadow: 0 0 0 12px rgba(8,145,178,0); }
  100% { box-shadow: 0 0 0 0 rgba(8,145,178,0); }
}
.ata-paper { animation: ataPaperIn .25s ease both; }
@keyframes ataPaperIn { from { opacity:0; transform: translateY(8px); } to { opacity:1; transform:none; } }
`;
