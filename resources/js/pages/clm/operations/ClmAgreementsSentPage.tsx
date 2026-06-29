import { useEffect, useMemo, useRef, useState } from 'react';
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
import { useOpsTheme, type OpsTokens } from './useOpsTheme';
import { VersionHistoryModal, AgreementTimelineModal, type CtcVersion, type CtcSigner } from './clmCtcModals';
import { ShimmerTable } from '../../../components/ui/Shimmer';
import Tooltip from '../../../components/ui/Tooltip';

/* Sent rows from GET /clm/ctc-contracts/sent — the AwsContract list shape
 * enriched with the clarification thread + approver so the Clarifications
 * tab and the Respond modal work off the same fetched data. */
type SentRow = AwsContract & { dbId: number; approver: string; clarifications: Clarification[]; rejReason?: string; expDate: string };

/* ─────────────────────────────────────────────────────────────────────────
 * CLM Operations · Without Shipment ID → Agreements We Sent.
 *
 * Faithful port of the cyan-themed `rAws()` view from the CLM_CaseToCase
 * prototype: header strip, four summary cards, capsule filter tabs
 * (All / Approved / Pending / Rejected / Clarifications), search and a
 * status-aware contracts table. Clarification + rejection detail is
 * derived from the shared ATA dataset, mirroring the prototype.
 * ───────────────────────────────────────────────────────────────────────── */

type AwsTab = 'all' | 'approved' | 'pending' | 'rejected' | 'clarify';

const ORG_GRAD: Record<string, string> = {
  'IGC-Aurentic':   '#7C3AED,#5B21B6',
  'IGC-Healthcare': '#0891b2,#0e7490',
  'IGC-Agrotech':   '#059669,#047857',
};

const AP_CFG = {
  approved: { label: 'Approved', bg: '#E0F7FA', border: '#A7F3D0', color: '#0891b2', dot: '#06b6d4' },
  pending:  { label: 'Pending',  bg: '#FFFBEB', border: '#FDE68A', color: '#D97706', dot: '#F59E0B' },
  rejected: { label: 'Rejected', bg: '#FEF2F2', border: '#FECACA', color: '#DC2626', dot: '#EF4444' },
} as const;

export default function ClmAgreementsSentPage() {
  const toast = useToast();
  const { user } = useAuth();
  const navigate = useNavigate();
  const t = useOpsTheme('cyan');
  const [tab, setTab]     = useState<AwsTab>('all');
  const [page, setPage]   = useState(1);
  const [search, setSearch] = useState('');
  const [dlOpen, setDlOpen] = useState<string | null>(null);
  const [respondId, setRespondId] = useState<string | null>(null);
  const [cpOpen, setCpOpen] = useState<{ id: string; names: string[]; x: number; y: number } | null>(null);   // counterparties popover

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

  // Real-time refetch on any approval event for this tenant + focus fallback.
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
    rejected: sent.filter(c => c.status === 'rejected').length,
    clarify:  sent.filter(c => c.status === 'clarify').length,
  }), [sent]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = sent;
    if (q) list = list.filter(c => (c.title + c.cp.join(' ') + c.id).toLowerCase().includes(q));
    if (tab === 'approved') return list.filter(c => c.status === 'approved');
    if (tab === 'pending')  return list.filter(c => c.status === 'pending');
    if (tab === 'rejected') return list.filter(c => c.status === 'rejected' || c.approval === 'rejected');
    return list;
  }, [search, tab, sent]);

  // Every agreement currently in clarification — both those awaiting our reply
  // AND those we've already answered (awaiting the approver's next decision) —
  // so the full conversation stays checkable here until the round closes.
  const clarifyList = useMemo(
    () => sent.filter(c => c.status === 'clarify'),
    [sent],
  );

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

  // Version-history / timeline modals reuse the same Case-to-Case records, so
  // the agreement's full version + signing history shows identically here.
  type CtcDetail = { code: string; title: string; dbId: number | null; stage: number; versions: CtcVersion[]; signers: CtcSigner[] };
  const [verFor, setVerFor] = useState<CtcDetail | null>(null);
  const [tlFor, setTlFor] = useState<CtcDetail | null>(null);
  const openLifecycle = async (c: SentRow, kind: 'version' | 'timeline') => {
    if (!c.dbId) { toast.error('Not available', 'This agreement has no saved record yet.'); return; }
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
  };

  // Download the agreement. PDF prefers the signed Zoho copy when available;
  // DOCX always renders the latest drafted version to an editable Word file.
  const downloadContract = async (c: SentRow, fmt: string) => {
    if (!c.dbId) { toast.error('Not available', 'This agreement has no saved record yet.'); return; }
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
      // Signed PDF copy is only available as PDF — DOCX skips straight to the draft render.
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
  };

  return (
    <div style={{ padding: 0, display: 'flex', flexDirection: 'column', gap: 14, fontFamily: 'var(--font-sans)' }}>
      <style>{AWS_CSS}</style>

      {/* HEADER STRIP */}
      <div style={{ position: 'relative', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 18px', minHeight: 64, border: `1px solid ${t.dark ? 'rgba(6,182,212,.25)' : 'rgba(6,182,212,.3)'}`, borderRadius: 14, background: t.dark ? '#102234' : 'linear-gradient(110deg,#ecfffe 0%,#cffafe 25%,#a5f3fc 55%,#67e8f9 80%,#22d3ee 100%)', boxShadow: t.dark ? '0 2px 10px rgba(6,182,212,.1)' : '0 2px 0 rgba(255,255,255,.88) inset,0 4px 18px rgba(6,182,212,.2)' }}>
        <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, background: 'linear-gradient(180deg,#22d3ee,#0891b2,#0e7490)', borderRadius: '14px 0 0 14px' }} />
        {!t.dark && <span style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '50%', background: 'linear-gradient(180deg,rgba(255,255,255,.52),transparent)', pointerEvents: 'none', borderRadius: '14px 14px 0 0' }} />}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, zIndex: 1, paddingLeft: 10 }}>
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <div style={{ width: 38, height: 38, borderRadius: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg,#0891b2,#0e7490)', boxShadow: '0 0 0 3px rgba(6,182,212,.25),0 4px 12px rgba(8,145,178,.4)' }}>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" fill="rgba(255,255,255,.2)" stroke="#fff" strokeWidth="2" /></svg>
            </div>
            <span style={{ position: 'absolute', bottom: -1, right: -1, width: 9, height: 9, borderRadius: '50%', background: 'linear-gradient(135deg,#4ade80,#22c55e)', border: '2px solid #cef8ff', boxShadow: '0 0 6px rgba(34,197,94,.4)' }} />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
              <div style={{ fontSize: 16, fontWeight: 500, color: t.dark ? '#67e8f9' : '#0c4a6e', letterSpacing: '-.4px', lineHeight: 1.15 }}>Agreements We Sent</div>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 9px', borderRadius: 20, background: 'rgba(6,182,212,.15)', border: '1px solid rgba(6,182,212,.35)' }}>
                <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#22c55e', boxShadow: '0 0 5px rgba(34,197,94,.5)' }} />
                <span style={{ fontSize: 8.5, fontWeight: 800, color: t.dark ? '#7dd3fc' : '#0e7490', letterSpacing: '.06em' }}>ACTIVE</span>
              </span>
            </div>
            <div style={{ fontSize: 11, fontWeight: 500, color: t.dark ? '#7dd3fc' : '#0e7490', opacity: .9, lineHeight: 1.4, maxWidth: 580 }}>Track agreements created by us and sent to counterparties for approval, clarification, negotiation, and signing.</div>
          </div>
        </div>
      </div>

      {/* SUMMARY CARDS */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8 }}>
        <SummaryCard t={t} accent="#06b6d4,#0891b2" border="#B2EBF2" hoverBorder="#A5F3FC" titleColor="#0e7490" tag="Total" tagBg="#CFFAFE" tagColor="#0891b2" value={counts.all} label="Total Agreements" sub="Created and shared with counterparties"
          icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="8" y1="13" x2="16" y2="13" /><line x1="8" y1="17" x2="12" y2="17" /></svg>} />
        <SummaryCard t={t} accent="#f59e0b,#d97706" border="#FEF3C7" hoverBorder="#FCD34D" titleColor="#92400E" tag="Pending" tagBg="#FEF3C7" tagColor="#D97706" value={counts.pending} label="Pending Agreements" sub="Awaiting counterparty response"
          icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>} />
        <SummaryCard t={t} accent="#10b981,#0891b2" border="#B2EBF2" hoverBorder="#A5F3FC" titleColor="#0e7490" tag="Approved" tagBg="#B2EBF2" tagColor="#0891b2" value={counts.approved} label="Approved Agreements" sub="Approved and ready for execution"
          icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round"><polyline points="20 6 9 17 4 12" /></svg>} />
        <SummaryCard t={t} accent="#ef4444,#dc2626" border="#FEE2E2" hoverBorder="#FCA5A5" titleColor="#7F1D1D" tag="Rejected" tagBg="#FEE2E2" tagColor="#DC2626" value={counts.rejected} label="Rejected Agreements" sub="Sent back for changes or revision"
          icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></svg>} />
      </div>

      {/* FILTER TABS + TABLE */}
      <div style={{ background: t.surface, borderRadius: 14, border: `1.5px solid ${t.dark ? t.border : '#B2EBF2'}`, boxShadow: '0 1px 4px rgba(6,182,212,.07)', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 14px', background: t.surface, borderBottom: `1.5px solid ${t.dark ? t.border : 'rgba(6,182,212,.18)'}`, flexWrap: 'wrap' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', background: t.tabCapsule, borderRadius: 30, padding: 4, boxShadow: t.dark ? 'none' : 'inset 0 1px 4px rgba(6,182,212,.12),0 1px 3px rgba(6,182,212,.08)' }}>
            {([
              ['all', 'All Contracts', null],
              ['approved', 'Approved Contracts', '#10B981'],
              ['pending', 'Pending Contracts', '#F59E0B'],
              ['rejected', 'Rejected Contracts', '#EF4444'],
              ['clarify', 'Clarifications', '#8B5CF6'],
            ] as [AwsTab, string, string | null][]).map(([key, label, dot]) => {
              const active = tab === key;
              return (
                <button key={key} onClick={() => { setTab(key); setPage(1); }}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '8px 18px', borderRadius: 25, border: 'none', fontFamily: 'inherit', fontSize: 12, fontWeight: active ? 800 : 700, cursor: 'pointer', letterSpacing: '-.1px', transition: 'all .18s', position: 'relative', overflow: 'hidden',
                    background: active ? 'linear-gradient(135deg,#0e7490,#0891b2,#06b6d4)' : 'transparent',
                    color: active ? '#fff' : t.tabInactive,
                    boxShadow: active ? '0 3px 12px rgba(6,182,212,.5),inset 0 1px 0 rgba(255,255,255,.22)' : 'none' }}>
                  {active && <span style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '50%', background: 'linear-gradient(180deg,rgba(255,255,255,.22),transparent)', borderRadius: '25px 25px 0 0', pointerEvents: 'none' }} />}
                  {key === 'all'
                    ? <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={active ? '#fff' : t.tabInactive} strokeWidth="2.4" strokeLinecap="round" style={{ position: 'relative', zIndex: 1, flexShrink: 0 }}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
                    : <span style={{ width: 7, height: 7, borderRadius: '50%', background: active ? 'rgba(255,255,255,.9)' : (dot || '#94A3B8'), flexShrink: 0, boxShadow: active ? 'none' : `0 0 0 2px ${dot}40` }} />}
                  <span style={{ position: 'relative', zIndex: 1 }}>{label}</span>
                  <span style={{ position: 'relative', zIndex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 18, height: 18, padding: '0 5px', borderRadius: 20, background: active ? 'rgba(255,255,255,.28)' : 'rgba(14,116,144,.2)', fontSize: 9, fontWeight: 900, color: active ? '#fff' : t.tabInactive }}>{counts[key]}</span>
                </button>
              );
            })}
          </div>
          <div style={{ flex: 1 }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '8px 15px', borderRadius: 22, background: t.searchBg, border: `1.5px solid ${t.searchBorder}` }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={t.dark ? '#67e8f9' : '#0891b2'} strokeWidth="2.4" strokeLinecap="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
            <input value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} placeholder="Search agreements…"
              style={{ border: 'none', outline: 'none', fontFamily: 'inherit', fontSize: 11, fontWeight: 500, color: t.searchText, background: 'transparent', width: 190 }} />
          </div>
        </div>

        {loading
          ? <ShimmerTable rows={6} cols={11} />
          : tab === 'clarify'
          ? <ClarifyTable rows={clarifyList} onRespond={setRespondId} t={t} />
          : tab === 'rejected'
            ? <RejectedTable rows={filtered} ata={sent} page={page} setPage={setPage} dlOpen={dlOpen} setDlOpen={setDlOpen} onDownload={downloadContract} toast={toast} t={t} />
            : <StandardTable rows={filtered} page={page} setPage={setPage} tab={tab} dlOpen={dlOpen} setDlOpen={setDlOpen} cpOpen={cpOpen} setCpOpen={setCpOpen} onVersion={(c) => openLifecycle(c, 'version')} onTimeline={(c) => openLifecycle(c, 'timeline')} onDownload={downloadContract} onEdit={(c) => navigate(`/clm/case-to-case?edit=${c.dbId}`)} toast={toast} t={t} />}
      </div>

      {respondContract && (
        <RespondModal contract={respondContract} onClose={() => setRespondId(null)} onSubmit={submitResponse} t={t} />
      )}

      {verFor && <VersionHistoryModal t={t} code={verFor.code} workingId={verFor.dbId} versions={verFor.versions} onClose={() => setVerFor(null)} />}
      {tlFor && <AgreementTimelineModal t={t} code={tlFor.code} title={tlFor.title} stage={tlFor.stage} versions={tlFor.versions} signers={tlFor.signers} onClose={() => setTlFor(null)} />}

      {/* All-counterparties popover (opened from the +N badge) */}
      {cpOpen && (
        <>
          <div onClick={() => setCpOpen(null)} style={{ position: 'fixed', inset: 0, zIndex: 600 }} />
          <div style={{ position: 'fixed', left: Math.min(cpOpen.x, window.innerWidth - 240), top: cpOpen.y, zIndex: 601, width: 220, maxHeight: 280, overflowY: 'auto', background: t.surface, borderRadius: 12, border: `1.5px solid ${t.dark ? 'rgba(6,182,212,.35)' : '#A5F3FC'}`, boxShadow: '0 16px 40px rgba(0,0,0,.28)', padding: 8, fontFamily: 'var(--font-sans)' }}>
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

/* ── Summary card ── */
function SummaryCard({ t, accent, border, hoverBorder, titleColor, tag, tagBg, tagColor, value, label, sub, icon }: {
  t: OpsTokens; accent: string; border: string; hoverBorder: string; titleColor: string; tag: string; tagBg: string; tagColor: string;
  value: number; label: string; sub: string; icon: React.ReactNode;
}) {
  const [c1, c2] = accent.split(',');
  const bd = t.dark ? t.border : border;
  const titleC = t.dark ? t.textStrong : titleColor;
  return (
    <div className="aws-card" style={{ '--bd': bd, '--hbd': t.dark ? 'rgba(148,163,184,.32)' : hoverBorder, background: t.surface } as React.CSSProperties}
      onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 6px 18px rgba(6,182,212,.18)'; e.currentTarget.style.borderColor = t.dark ? 'rgba(148,163,184,.32)' : hoverBorder; }}
      onMouseLeave={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = '0 1px 4px rgba(6,182,212,.08)'; e.currentTarget.style.borderColor = bd; }}>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 4, borderRadius: '12px 12px 0 0', background: `linear-gradient(90deg,${c1},${c2})` }} />
      <div style={{ width: 38, height: 38, borderRadius: 11, background: `linear-gradient(135deg,${c1},${c2})`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: `0 3px 10px ${c1}59,inset 0 1px 0 rgba(255,255,255,.2)` }}>{icon}</div>
      <div style={{ flex: 1, minWidth: 0, position: 'relative', zIndex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 1 }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: t.dark ? t.textSub : titleColor, letterSpacing: '-.1px' }}>{label}</span>
          <span style={{ fontSize: 7, fontWeight: 800, letterSpacing: '.1em', textTransform: 'uppercase', padding: '2px 6px', borderRadius: 20, background: t.dark ? 'rgba(255,255,255,.06)' : tagBg, color: tagColor }}>{tag}</span>
        </div>
        <div style={{ fontSize: 26, fontWeight: 900, letterSpacing: '-1.5px', color: titleC, lineHeight: 1.1, marginBottom: 1 }}>{pad2(value)}</div>
        <div style={{ fontSize: 8.5, fontWeight: 500, color: t.textMuted, lineHeight: 1.3 }}>{sub}</div>
      </div>
    </div>
  );
}

/* ── Shared cells ── */
function Avatar({ name, grad, size = 28, fs = 9 }: { name: string; grad: string; size?: number; fs?: number }) {
  return (
    <div style={{ width: size, height: size, borderRadius: 8, background: `linear-gradient(135deg,${grad})`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: '0 2px 5px rgba(0,0,0,.15)' }}>
      <span style={{ fontSize: fs, fontWeight: 900, color: '#fff', letterSpacing: '-.2px' }}>{inits(name)}</span>
    </div>
  );
}

function ApprovalBadge({ ap }: { ap: 'approved' | 'pending' | 'rejected' }) {
  const t = useOpsTheme('cyan');
  const c = AP_CFG[ap];
  // Light pastel pills glare on the dark table — use translucent dark fills + lighter text.
  const dk = ap === 'approved' ? { bg: 'rgba(8,145,178,.18)', border: 'rgba(6,182,212,.42)', text: '#67e8f9' }
    : ap === 'pending' ? { bg: 'rgba(245,158,11,.16)', border: 'rgba(245,158,11,.42)', text: '#fcd34d' }
    : { bg: 'rgba(239,68,68,.16)', border: 'rgba(239,68,68,.42)', text: '#fca5a5' };
  const b = t.dark ? dk : { bg: c.bg, border: c.border, text: c.color };
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 20, background: b.bg, border: `1.5px solid ${b.border}`, whiteSpace: 'nowrap' }}>
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: c.dot, flexShrink: 0, boxShadow: `0 0 5px ${c.dot}60` }} />
      <span style={{ fontSize: 10.5, fontWeight: 700, color: b.text }}>{c.label}</span>
    </span>
  );
}

const TH  = { padding: '10px 14px', fontSize: 8, fontWeight: 800, letterSpacing: '.12em', textTransform: 'uppercase', color: '#fff', whiteSpace: 'nowrap', textAlign: 'center', background: 'transparent', borderBottom: 'none' } as React.CSSProperties;
const THL = { ...TH, textAlign: 'left' } as React.CSSProperties;
const THEAD_BG = 'linear-gradient(90deg,#0e7490 0%,#0891b2 35%,#06b6d4 70%,#22d3ee 100%)';

function Pager({ total, page, setPage, t, perPage = PER_PAGE }: { total: number; page: number; setPage: (n: number) => void; t: OpsTokens; perPage?: number }) {
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const safe = Math.min(page, totalPages);
  const start = (safe - 1) * perPage;
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', background: t.pagerBg, borderTop: `1.5px solid ${t.dark ? t.border : '#A5F3FC'}` }}>
      <span style={{ fontSize: 11.5, color: t.dark ? '#67e8f9' : '#0e7490', fontWeight: 500 }}>Showing <b style={{ color: t.dark ? '#cffafe' : '#164e63', fontWeight: 800 }}>{total === 0 ? 0 : start + 1}–{Math.min(start + perPage, total)}</b> of <b style={{ color: t.dark ? '#cffafe' : '#164e63', fontWeight: 800 }}>{total}</b></span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => {
          const a = p === safe;
          return <button key={p} onClick={() => setPage(p)} disabled={a} style={{ minWidth: 30, height: 30, padding: '0 7px', borderRadius: 7, border: `1.5px solid ${a ? '#0891b2' : 'rgba(8,145,178,.2)'}`, background: a ? 'linear-gradient(135deg,#06b6d4,#0891b2)' : t.pagerBtn, color: a ? '#fff' : (t.dark ? '#67e8f9' : '#0891b2'), fontFamily: 'inherit', fontSize: 12, fontWeight: a ? 800 : 600, cursor: a ? 'default' : 'pointer' }}>{p}</button>;
        })}
      </div>
    </div>
  );
}

const ICO_DL  = <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>;
const ICO_EDIT = <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4z" /></svg>;
const ICO_VER  = <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="12 8 12 12 14 14" /><path d="M3.05 11a9 9 0 1 1 .5 4m-.5 5v-5h5" /></svg>;
const ICO_TL   = <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>;
const ICO_VIEW = <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>;

function ActionBtn({ title, color, bg, border, t, onClick, children }: { title: string; color: string; bg: string; border: string; t: OpsTokens; onClick: () => void; children: React.ReactNode }) {
  // In dark mode the light pastel pills read as bright stickers. Keep each
  // button's hue but as a translucent tint + brightened icon so they sit on
  // the dark surface. Light mode keeps the original pastel look.
  const fbg     = t.dark ? `color-mix(in srgb, ${color} 20%, transparent)` : bg;
  const fborder = t.dark ? `color-mix(in srgb, ${color} 45%, transparent)` : border;
  const fcolor  = t.dark ? `color-mix(in srgb, ${color} 55%, #ffffff)` : color;
  return (
    <Tooltip label={title}>
      <button onClick={onClick} style={{ width: 28, height: 28, borderRadius: 7, border: `1.5px solid ${fborder}`, background: fbg, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: fcolor, opacity: .85, flexShrink: 0, transition: 'all .15s' }}
        onMouseEnter={e => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 3px 8px rgba(0,0,0,.13)'; }}
        onMouseLeave={e => { e.currentTarget.style.opacity = '.85'; e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = 'none'; }}>
        {children}
      </button>
    </Tooltip>
  );
}

function DownloadMenu({ id, dlOpen, setDlOpen, onPick, t }: { id: string; dlOpen: string | null; setDlOpen: (s: string | null) => void; onPick: (fmt: string) => void; t: OpsTokens }) {
  const open = dlOpen === id;
  const btnRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const toggle = () => {
    if (open) { setDlOpen(null); return; }
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setPos({ left: Math.max(8, Math.min(r.right - 168, window.innerWidth - 176)), top: r.bottom + 6 });
    setDlOpen(id);
  };
  return (
    <>
      <Tooltip label="Download Contract"><button ref={btnRef} onClick={toggle} style={{ width: 28, height: 28, borderRadius: 7, border: `1.5px solid ${t.dark ? 'color-mix(in srgb, #06b6d4 45%, transparent)' : '#7DD3FC'}`, background: t.dark ? 'color-mix(in srgb, #06b6d4 20%, transparent)' : '#B2EBF2', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: t.dark ? '#67e8f9' : '#0369A1', opacity: .85, flexShrink: 0 }}>{ICO_DL}</button></Tooltip>
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

/* ── Standard contracts table (all / approved / pending) ── */
function StandardTable({ rows, page, setPage, tab, dlOpen, setDlOpen, cpOpen, setCpOpen, onVersion, onTimeline, onDownload, onEdit, toast, t }: { rows: SentRow[]; page: number; setPage: (n: number) => void; tab: AwsTab; dlOpen: string | null; setDlOpen: (s: string | null) => void; cpOpen: { id: string; names: string[]; x: number; y: number } | null; setCpOpen: (s: { id: string; names: string[]; x: number; y: number } | null) => void; onVersion: (c: SentRow) => void; onTimeline: (c: SentRow) => void; onDownload: (c: SentRow, fmt: string) => void; onEdit: (c: SentRow) => void; toast: ReturnType<typeof useToast>; t: OpsTokens }) {
  const totalPages = Math.max(1, Math.ceil(rows.length / PER_PAGE));
  const safe = Math.min(page, totalPages);
  const start = (safe - 1) * PER_PAGE;
  const slice = rows.slice(start, start + PER_PAGE);
  const empty = `No ${tab === 'all' ? 'contracts yet' : tab + ' contracts'}.`;

  return (
    <div style={{ background: t.tableBg, overflow: 'hidden' }}>
      {slice.length === 0 ? <EmptyState msg={empty} t={t} /> : (
        <>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1300 }}>
              <thead><tr style={{ background: THEAD_BG }}>
                <th style={{ ...TH, width: 50 }}>SR NO</th>
                <th style={{ ...TH, width: 110 }}>CTC ID</th>
                <th style={{ ...TH, width: 110 }}>CTC DATE</th>
                <th style={THL}>AGREEMENT TITLE</th>
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
                      <td style={TD_C}><span style={{ fontSize: 11.5, fontWeight: 600, color: t.textSub, whiteSpace: 'nowrap' }}>{c.date}</span></td>
                      <td style={TD_L}><Tooltip label={c.title}><div style={{ fontSize: 12.5, fontWeight: 700, color: t.dark ? '#67e8f9' : '#0e7490', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 190 }}>{c.title}</div></Tooltip></td>
                      <td style={TD_L}><div style={{ display: 'flex', alignItems: 'center', gap: 7 }}><Avatar name={c.org} grad={ORG_GRAD[c.org] || '#4C1D95,#7C3AED'} /><Tooltip label={c.org}><span style={{ fontSize: 11.5, fontWeight: 600, color: t.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 100 }}>{c.org}</span></Tooltip></div></td>
                      <td style={TD_L}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                          <Avatar name={c.cp[0]} grad="#0891b2,#0e7490" />
                          <Tooltip label={c.cp.join(', ')}><span style={{ fontSize: 11.5, fontWeight: 600, color: t.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 100 }}>{c.cp[0]}</span></Tooltip>
                          {extra > 0 && <Tooltip label="View all counterparties"><button onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setCpOpen(cpOpen?.id === c.id ? null : { id: c.id, names: c.cp, x: r.left, y: r.bottom + 4 }); }} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 20, height: 20, padding: '0 5px', borderRadius: 20, background: 'linear-gradient(135deg,#0891b2,#0e7490)', color: '#fff', fontSize: 9, fontWeight: 800, flexShrink: 0, border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>+{extra}</button></Tooltip>}
                        </div>
                      </td>
                      <td style={TD_L}><div style={{ display: 'flex', alignItems: 'center', gap: 7 }}><div style={{ width: 26, height: 26, borderRadius: '50%', background: 'linear-gradient(135deg,#A7F3D0,#7DD3FC)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, border: '1.5px solid #B2EBF2' }}><span style={{ fontSize: 8.5, fontWeight: 900, color: '#0891b2' }}>{inits(c.createdBy)}</span></div><span style={{ fontSize: 11, fontWeight: 600, color: t.text, whiteSpace: 'nowrap' }}>{c.createdBy}</span></div></td>
                      <td style={TD_C}><ApprovalBadge ap={ap} /></td>
                      <td style={TD_C}><span style={{ fontSize: 11, fontWeight: 600, color: t.textSub, whiteSpace: 'nowrap' }}>{c.effDate}</span></td>
                      <td style={TD_C}><span style={{ fontSize: 11, fontWeight: 600, color: t.textSub, whiteSpace: 'nowrap' }}>{c.endDate}</span></td>
                      <td style={TD_C}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                          <DownloadMenu id={c.id} dlOpen={dlOpen} setDlOpen={setDlOpen} onPick={(fmt) => onDownload(c, fmt)} t={t} />
                          <ActionBtn title="Edit Agreement" color="#0891b2" bg="#B2EBF2" border="#7DD3FC" t={t} onClick={() => onEdit(c)}>{ICO_EDIT}</ActionBtn>
                          <ActionBtn title="Version History" color="#7C3AED" bg="#EDE9FE" border="#C4B5FD" t={t} onClick={() => onVersion(c)}>{ICO_VER}</ActionBtn>
                          <ActionBtn title="Agreement Timeline" color="#B45309" bg="#FEF3C7" border="#FCD34D" t={t} onClick={() => onTimeline(c)}>{ICO_TL}</ActionBtn>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pager total={rows.length} page={page} setPage={setPage} t={t} />
        </>
      )}
    </div>
  );
}

/* ── Rejected contracts table ── */
function RejectedTable({ rows, ata, page, setPage, dlOpen, setDlOpen, onDownload, toast, t }: { rows: SentRow[]; ata: SentRow[]; page: number; setPage: (n: number) => void; dlOpen: string | null; setDlOpen: (s: string | null) => void; onDownload: (c: SentRow, fmt: string) => void; toast: ReturnType<typeof useToast>; t: OpsTokens }) {
  const getRej = (id: string) => { const a = ata.find(x => x.id === id); return { by: a?.approver ?? '—', reason: a?.rejReason ?? '—' }; };
  const totalPages = Math.max(1, Math.ceil(rows.length / PER_PAGE));
  const safe = Math.min(page, totalPages);
  const start = (safe - 1) * PER_PAGE;
  const slice = rows.slice(start, start + PER_PAGE);

  return (
    <div style={{ background: t.tableBg, overflow: 'hidden' }}>
      {slice.length === 0 ? <EmptyState msg="No rejected contracts." t={t} /> : (
        <>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1200 }}>
              <thead><tr style={{ background: THEAD_BG }}>
                <th style={{ ...TH, width: 52 }}>SR. NO</th>
                <th style={{ ...TH, width: 110 }}>CTC ID</th>
                <th style={{ ...TH, width: 105 }}>CTC DATE</th>
                <th style={THL}>AGREEMENT TITLE</th>
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
                      <td style={TD_L}><Tooltip label={c.title}><div style={{ fontSize: 12.5, fontWeight: 700, color: t.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 200 }}>{c.title}</div></Tooltip></td>
                      <td style={TD_L}><div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><div style={{ width: 26, height: 26, borderRadius: '50%', background: 'linear-gradient(135deg,#A5F3FC,#67E8F9)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, border: '1.5px solid #CFFAFE' }}><span style={{ fontSize: 8.5, fontWeight: 900, color: '#0e7490' }}>{inits(c.createdBy)}</span></div><span style={{ fontSize: 11, fontWeight: 600, color: t.text, whiteSpace: 'nowrap' }}>{c.createdBy}</span></div></td>
                      <td style={TD_L}><div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><div style={{ width: 26, height: 26, borderRadius: '50%', background: 'linear-gradient(135deg,#FCA5A5,#EF4444)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><span style={{ fontSize: 8.5, fontWeight: 900, color: '#fff' }}>{inits(rej.by)}</span></div><span style={{ fontSize: 11, fontWeight: 600, color: t.dark ? '#fca5a5' : '#7F1D1D', whiteSpace: 'nowrap' }}>{rej.by}</span></div></td>
                      <td style={{ ...TD_L, maxWidth: 220 }}><div style={{ display: 'flex', alignItems: 'flex-start', gap: 5 }}><div style={{ width: 16, height: 16, borderRadius: '50%', background: '#FEE2E2', border: '1px solid #FECACA', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}><svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#DC2626" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></svg></div><Tooltip label={rej.reason}><div style={{ fontSize: 10.5, color: t.dark ? '#fca5a5' : '#7F1D1D', fontWeight: 500, lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{rej.reason}</div></Tooltip></div></td>
                      <td style={TD_C}><span style={{ fontSize: 11, fontWeight: 600, color: t.textSub, whiteSpace: 'nowrap' }}>{c.endDate}</span></td>
                      <td style={TD_C}><div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                        <DownloadMenu id={c.id} dlOpen={dlOpen} setDlOpen={setDlOpen} onPick={(fmt) => onDownload(c, fmt)} t={t} />
                        <ActionBtn title="View" color="#DC2626" bg="#FEF2F2" border="#FEE2E2" t={t} onClick={() => toast.info('View Agreement', c.id)}>{ICO_VIEW}</ActionBtn>
                      </div></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pager total={rows.length} page={page} setPage={setPage} t={t} />
        </>
      )}
    </div>
  );
}

/* ── Clarifications table (sender responds) ── */
function ClarifyTable({ rows, onRespond, t }: { rows: SentRow[]; onRespond: (id: string) => void; t: OpsTokens }) {
  const awaiting = rows.filter(c => c.clarifications.some(cl => !cl.response)).length;
  if (!rows.length) {
    return (
      <div style={{ background: t.dark ? t.tableBg : '#F0FDFF', minHeight: 160, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '48px 20px' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ width: 56, height: 56, borderRadius: 16, background: 'linear-gradient(135deg,#CFFAFE,#A5F3FC)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px', boxShadow: '0 4px 12px rgba(6,182,212,.15)' }}><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#0891b2" strokeWidth="2" strokeLinecap="round"><polyline points="20 6 9 17 4 12" /></svg></div>
          <div style={{ fontSize: 13, fontWeight: 800, color: t.dark ? '#cffafe' : '#164e63', marginBottom: 6 }}>All Clarifications Resolved</div>
          <div style={{ fontSize: 10.5, color: t.textMuted, maxWidth: 300, lineHeight: 1.6 }}>No pending clarification queries. When an approver raises a query, it will appear here.</div>
        </div>
      </div>
    );
  }
  return (
    <div style={{ background: t.tableBg, overflow: 'hidden' }}>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1200 }}>
          <thead><tr style={{ background: THEAD_BG }}>
            <th style={{ ...TH, width: 52 }}>SR. NO</th>
            <th style={{ ...TH, width: 110 }}>CTC ID</th>
            <th style={{ ...TH, width: 100 }}>CTC DATE</th>
            <th style={THL}>AGREEMENT TITLE</th>
            <th style={{ ...THL, width: 115 }}>CREATED BY</th>
            <th style={{ ...THL, width: 115 }}>APPROVER</th>
            <th style={THL}>CLARIFICATION QUERY</th>
            <th style={{ ...TH, width: 100 }}>EXPIRY</th>
            <th style={{ ...TH, width: 120 }}>ACTION</th>
          </tr></thead>
          <tbody>
            {rows.map((c, i) => {
              const pending = c.clarifications.filter(cl => !cl.response);
              const hasPending = pending.length > 0;
              const latest = hasPending ? pending[pending.length - 1] : c.clarifications[c.clarifications.length - 1];
              const round = c.clarifications.length;
              const bg = (i + 1) % 2 === 0 ? t.rowAlt : t.tableBg;
              return (
                <tr key={c.id} style={{ background: bg, transition: 'all .12s' }}
                  onMouseEnter={e => { e.currentTarget.style.background = t.rowHover; e.currentTarget.style.boxShadow = 'inset 3px 0 0 #0891b2'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = bg; e.currentTarget.style.boxShadow = 'none'; }}>
                  <td style={TD_C}><div style={{ width: 28, height: 28, borderRadius: '50%', background: 'linear-gradient(135deg,#0891b2,#0e7490)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 6px rgba(8,145,178,.35)' }}><span style={{ fontSize: 10, fontWeight: 900, color: '#fff' }}>{pad2(i + 1)}</span></div></td>
                  <td style={TD_C}><span style={codePill(t.dark)}>{c.id}</span></td>
                  <td style={TD_C}><span style={{ fontSize: 11, fontWeight: 600, color: t.textSub }}>{c.date}</span></td>
                  <td style={TD_L}><Tooltip label={c.title}><div style={{ fontSize: 12, fontWeight: 700, color: t.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 185 }}>{c.title}</div></Tooltip></td>
                  <td style={TD_L}><div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><div style={{ width: 26, height: 26, borderRadius: '50%', background: 'linear-gradient(135deg,#A5F3FC,#67E8F9)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, border: '1.5px solid #CFFAFE' }}><span style={{ fontSize: 8.5, fontWeight: 900, color: '#0e7490' }}>{inits(c.createdBy)}</span></div><span style={{ fontSize: 11, fontWeight: 600, color: t.text, whiteSpace: 'nowrap' }}>{c.createdBy}</span></div></td>
                  <td style={TD_L}><div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><div style={{ width: 26, height: 26, borderRadius: '50%', background: 'linear-gradient(135deg,#0891b2,#0e7490)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><span style={{ fontSize: 8.5, fontWeight: 900, color: '#fff' }}>{inits(c.approver)}</span></div><span style={{ fontSize: 11, fontWeight: 600, color: t.text, whiteSpace: 'nowrap' }}>{c.approver}</span></div></td>
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
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', background: t.pagerBg, borderTop: `1.5px solid ${t.dark ? t.border : '#A5F3FC'}` }}>
        <span style={{ fontSize: 11.5, color: t.dark ? '#67e8f9' : '#0e7490', fontWeight: 500 }}><b style={{ color: t.dark ? '#cffafe' : '#164e63', fontWeight: 800 }}>{awaiting}</b> awaiting your response · <b style={{ color: t.dark ? '#cffafe' : '#164e63', fontWeight: 800 }}>{rows.length}</b> in clarification</span>
      </div>
    </div>
  );
}

/* ── Respond to clarification modal ── */
function RespondModal({ contract, onClose, onSubmit, t }: { contract: SentRow; onClose: () => void; onSubmit: (id: string, text: string) => void; t: OpsTokens }) {
  const [text, setText] = useState('');
  const [err, setErr] = useState(false);
  const { typingName, notifyTyping, stopTyping } = useTyping(contract.id);
  const pending = contract.clarifications.filter(cl => !cl.response);
  const hasPending = pending.length > 0;
  return (
    <div onClick={e => { if (e.target === e.currentTarget) onClose(); }} style={{ position: 'fixed', inset: 0, zIndex: 9999999, background: 'rgba(12,5,38,.75)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, fontFamily: 'var(--font-sans)' }}>
      <div style={{ width: '100%', maxWidth: 500, borderRadius: 20, overflow: 'hidden', boxShadow: '0 40px 80px rgba(12,5,38,.35)', animation: 'awsSlideUp .22s cubic-bezier(.22,1,.36,1) both' }}>
        <div style={{ background: 'radial-gradient(rgba(255,255,255,.16) 1.1px, transparent 1.1px), linear-gradient(118deg,#5B21B6,#7C3AED,#8B5CF6)', backgroundSize: '14px 14px, auto', padding: '18px 20px', position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '50%', background: 'linear-gradient(180deg,rgba(255,255,255,.16),transparent)', pointerEvents: 'none' }} />
          <div style={{ position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 13 }}>
              <div style={{ width: 44, height: 44, borderRadius: 13, background: 'rgba(255,255,255,.2)', border: '1.5px solid rgba(255,255,255,.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 12px rgba(0,0,0,.15)', flexShrink: 0 }}><svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg></div>
              <div>
                <div style={{ fontSize: 8.5, fontWeight: 700, color: 'rgba(255,255,255,.62)', letterSpacing: '.14em', textTransform: 'uppercase', marginBottom: 3 }}>{contract.id} · {hasPending ? 'Clarification Response' : 'Clarification Conversation'}</div>
                <div style={{ fontSize: 16, fontWeight: 900, color: '#fff', letterSpacing: '-.3px', maxWidth: 290, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{contract.title}</div>
              </div>
            </div>
            <button onClick={() => { stopTyping(); onClose(); }} style={{ width: 32, height: 32, borderRadius: 9, background: 'rgba(255,255,255,.15)', border: '1px solid rgba(255,255,255,.25)', color: '#fff', fontSize: 16, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>✕</button>
          </div>
        </div>
        {/* Full conversation thread — every query + response in order, so the
            sender reads the whole back-and-forth, not just the latest query. */}
        <div style={{ padding: '14px 20px', background: t.dark ? '#1c1733' : '#FAF5FF', borderBottom: `1px solid ${t.dark ? 'rgba(124,58,237,.3)' : '#DDD6FE'}`, maxHeight: 300, overflowY: 'auto' }}>
          <div style={{ fontSize: 8, fontWeight: 800, letterSpacing: '.1em', textTransform: 'uppercase', color: t.dark ? '#c4b5fd' : '#7C3AED', marginBottom: 11 }}>Conversation</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {contract.clarifications.map((cl, i) => (
              <div key={i}>
                {/* Approver query (left) */}
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  <div style={{ width: 26, height: 26, borderRadius: 8, background: 'linear-gradient(135deg,#7C3AED,#5B21B6)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><span style={{ fontSize: 8.5, fontWeight: 900, color: '#fff' }}>{inits(cl.by || contract.approver)}</span></div>
                  <div style={{ maxWidth: '80%', minWidth: 0 }}>
                    <div style={{ fontSize: 8.5, fontWeight: 700, color: t.textMuted, marginBottom: 3 }}>{cl.by || contract.approver} · Approver · {cl.date}</div>
                    <div style={{ background: t.surface, border: `1.5px solid ${t.dark ? 'rgba(124,58,237,.3)' : '#DDD6FE'}`, borderRadius: '4px 12px 12px 12px', padding: '9px 12px', fontSize: 11.5, color: t.textSub, lineHeight: 1.55, wordBreak: 'break-word', display: 'inline-block' }}>{cl.query}</div>
                  </div>
                </div>
                {/* Sender response (right) or awaiting note */}
                {cl.response
                  ? <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'flex-start', marginTop: 7 }}>
                      <div style={{ maxWidth: '80%', minWidth: 0 }}>
                        <div style={{ fontSize: 8.5, fontWeight: 700, color: t.textMuted, marginBottom: 3, textAlign: 'right' }}>You · {contract.createdBy}</div>
                        <div style={{ background: t.dark ? 'rgba(8,145,178,.16)' : '#E0F7FA', border: `1.5px solid ${t.dark ? 'rgba(6,182,212,.42)' : '#A5F3FC'}`, borderRadius: '12px 4px 12px 12px', padding: '9px 12px', fontSize: 11.5, color: t.dark ? '#a5f3fc' : '#0e7490', lineHeight: 1.55, wordBreak: 'break-word' }}>{cl.response}</div>
                      </div>
                      <div style={{ width: 26, height: 26, borderRadius: 8, background: 'linear-gradient(135deg,#0891b2,#0e7490)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><span style={{ fontSize: 8.5, fontWeight: 900, color: '#fff' }}>{inits(contract.createdBy)}</span></div>
                    </div>
                  : <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 6, marginLeft: 34, fontSize: 9, fontWeight: 600, color: '#F59E0B' }}><svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg> Awaiting your response</div>}
              </div>
            ))}
          </div>
          <TypingIndicator name={typingName} color={t.dark ? '#c4b5fd' : '#7C3AED'} />
        </div>
        {hasPending ? (
          <div style={{ padding: '16px 20px', background: t.surface, borderTop: `1.5px solid ${t.dark ? 'rgba(124,58,237,.25)' : '#EDE9FE'}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={t.dark ? '#c4b5fd' : '#7C3AED'} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
              <span style={{ fontSize: 9, fontWeight: 800, color: t.dark ? '#c4b5fd' : '#7C3AED', textTransform: 'uppercase', letterSpacing: '.1em' }}>Your Response <span style={{ color: '#EF4444' }}>*</span></span>
            </div>
            <textarea value={text} onChange={e => { setText(e.target.value); setErr(false); notifyTyping(); }} placeholder="Provide your clarification response to the approver…"
              onFocus={e => { e.currentTarget.style.borderColor = '#7C3AED'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(124,58,237,.12)'; }}
              onBlur={e => { e.currentTarget.style.borderColor = err ? '#EF4444' : (t.dark ? t.border : '#E2E8F0'); e.currentTarget.style.boxShadow = 'none'; }}
              style={{ width: '100%', height: 90, padding: '11px 13px', border: `1.5px solid ${err ? '#EF4444' : (t.dark ? t.border : '#E2E8F0')}`, borderRadius: 12, fontFamily: 'inherit', fontSize: 12, color: t.text, background: t.dark ? 'rgba(255,255,255,.04)' : '#fff', resize: 'none', outline: 'none', boxSizing: 'border-box', lineHeight: 1.55, transition: 'border-color .15s, box-shadow .15s' }} />
            {err && <div style={{ fontSize: 9, color: '#EF4444', marginTop: 5, fontWeight: 600 }}>Please enter your response before submitting.</div>}
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <button onClick={() => { stopTyping(); onClose(); }} style={{ flex: 1, padding: 10, borderRadius: 10, border: `1.5px solid ${t.dark ? t.border : '#E2E8F0'}`, background: t.dark ? 'rgba(255,255,255,.05)' : '#F8F9FA', color: t.dark ? '#cbd5e1' : '#64748B', fontFamily: 'inherit', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>Cancel</button>
              <button onClick={() => { if (!text.trim()) { setErr(true); return; } stopTyping(); onSubmit(contract.id, text.trim()); }} style={{ flex: 2, padding: 10, borderRadius: 10, border: 'none', background: 'linear-gradient(135deg,#7C3AED,#5B21B6)', color: '#fff', fontFamily: 'inherit', fontSize: 11, fontWeight: 800, cursor: 'pointer', boxShadow: '0 3px 10px rgba(109,40,217,.35)' }}>Submit Clarification Response</button>
            </div>
          </div>
        ) : (
          <div style={{ padding: '14px 20px', background: t.surface, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <span style={{ fontSize: 10.5, fontWeight: 600, color: t.textMuted, display: 'flex', alignItems: 'center', gap: 6, lineHeight: 1.4 }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={t.dark ? '#67e8f9' : '#0891b2'} strokeWidth="2.2" strokeLinecap="round" style={{ flexShrink: 0 }}><polyline points="20 6 9 17 4 12" /></svg>
              You've responded — awaiting {contract.approver}'s decision.
            </span>
            <button onClick={onClose} style={{ padding: '10px 22px', borderRadius: 10, border: `1.5px solid ${t.dark ? t.border : '#E2E8F0'}`, background: t.dark ? 'rgba(255,255,255,.05)' : '#F8F9FA', color: t.dark ? '#cbd5e1' : '#64748B', fontFamily: 'inherit', fontSize: 11, fontWeight: 700, cursor: 'pointer', flexShrink: 0 }}>Close</button>
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyState({ msg, t }: { msg: string; t: OpsTokens }) {
  return (
    <div style={{ background: t.dark ? t.tableBg : '#F0FDFF', minHeight: 160, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 20px' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ width: 48, height: 48, borderRadius: 13, background: 'linear-gradient(135deg,#E0F7FA,#A7F3D0)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px', boxShadow: '0 3px 10px rgba(6,182,212,.15)' }}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#0891b2" strokeWidth="2" strokeLinecap="round"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg></div>
        <div style={{ fontSize: 13, fontWeight: 800, color: t.dark ? '#67e8f9' : '#0e7490', marginBottom: 5 }}>No Contracts Found</div>
        <div style={{ fontSize: 10.5, color: t.textMuted, maxWidth: 280, lineHeight: 1.6 }}>{msg}</div>
      </div>
    </div>
  );
}

const TD_C = { padding: '11px 14px', verticalAlign: 'middle', borderBottom: '1px solid rgba(6,182,212,.06)', textAlign: 'center' } as React.CSSProperties;
const TD_L = { ...TD_C, textAlign: 'left' } as React.CSSProperties;
const codePill = (dark: boolean): React.CSSProperties => ({ fontFamily: "'Geist Mono', monospace", fontSize: 11, fontWeight: 800, color: dark ? '#67e8f9' : '#0e7490', background: dark ? 'rgba(6,182,212,.2)' : 'linear-gradient(135deg,rgba(6,182,212,.12),rgba(8,145,178,.06))', padding: '4px 9px', borderRadius: 7, border: `1px solid rgba(6,182,212,${dark ? '.42' : '.25'})`, whiteSpace: 'nowrap', letterSpacing: '.02em' });

const AWS_CSS = `
@keyframes awsSlideUp { from { opacity:0; transform:translateY(24px) scale(.96); } to { opacity:1; transform:none; } }
.aws-card {
  position:relative; overflow:hidden; border-radius:12px; padding:12px 14px;
  background:#fff; border:1.5px solid var(--bd);
  box-shadow:0 1px 4px rgba(6,182,212,.08); transition:all .18s;
  display:flex; align-items:center; gap:11px;
}
`;
