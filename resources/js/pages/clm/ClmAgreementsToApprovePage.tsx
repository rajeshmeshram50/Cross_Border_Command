import { useEffect, useMemo, useState } from 'react';
import { useToast } from '../../contexts/ToastContext';
import api from '../../api';
import { type AtaContract, inits, pad2, PER_PAGE } from './clmOpsData';
import { useOpsTheme, type OpsTokens } from './useOpsTheme';
import { ShimmerTable } from '../../components/ui/Shimmer';
import Tooltip from '../../components/ui/Tooltip';

/** To-approve rows from GET /clm/ctc-contracts/to-approve (AtaContract + db id). */
type AtaRow = AtaContract & { dbId: number };

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
  const t = useOpsTheme('cyan');
  const [tab, setTab]   = useState<AtaTab>('pending');
  const [page, setPage] = useState(1);
  const [actionId, setActionId] = useState<string | null>(null);
  const [ata, setAta]   = useState<AtaRow[]>([]);
  const [loading, setLoading] = useState(true);
  const load = () => {
    setLoading(true);
    api.get('/clm/ctc-contracts/to-approve')
      .then(r => setAta(r.data?.data ?? []))
      .catch(() => { setAta([]); toast.error('Could not load agreements', 'Please refresh and try again.'); })
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const counts = useMemo(() => ({
    all:           ata.length,
    pending:       ata.filter(c => c.status === 'pending').length,
    clarification: ata.filter(c => c.status === 'clarification').length,
    approved:      ata.filter(c => c.status === 'approved').length,
    rejected:      ata.filter(c => c.status === 'rejected').length,
  }), [ata]);

  const list = useMemo(() => tab === 'all' ? ata : ata.filter(c => c.status === tab), [ata, tab]);
  const actionContract = ata.find(c => c.id === actionId) || null;

  const doApprove = async (id: string) => {
    const row = ata.find(c => c.id === id); if (!row?.dbId) return;
    try { await api.post(`/clm/ctc-contracts/${row.dbId}/approve`); toast.success('Agreement approved', 'Approved successfully'); load(); }
    catch { toast.error('Could not approve', 'Please try again.'); }
  };
  // Open the exact draft that was submitted for approval as a PDF in a new
  // tab. Reuses the CTC preview renderer (page-shell + body) the signing
  // flow uses, so the approver reads the same document the counterparty will.
  // The blank tab is opened synchronously inside the click handler so the
  // browser doesn't treat the post-fetch navigation as a blocked popup.
  const doView = async (id: string) => {
    const row = ata.find(c => c.id === id); if (!row?.dbId) return;
    const tab = window.open('', '_blank');
    if (tab) { try { tab.document.write('Loading agreement…'); } catch { /* cross-origin guard */ } }
    try {
      const res = await api.post('/clm/signature-requests/ctc-preview', { contract_id: row.dbId }, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data as Blob);
      if (tab) tab.location.href = url; else window.open(url, '_blank');
      // Give the tab time to load the blob before releasing the object URL.
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch {
      if (tab) tab.close();
      toast.error('Could not open', 'Failed to render the agreement PDF.');
    }
  };
  const doAction = async (id: string, mode: 'clarification' | 'rejected', comment: string) => {
    const row = ata.find(c => c.id === id); setActionId(null); if (!row?.dbId) return;
    try {
      if (mode === 'rejected') { await api.post(`/clm/ctc-contracts/${row.dbId}/reject`, { reason: comment }); toast.error('Agreement rejected', 'Sent back to initiator'); }
      else { await api.post(`/clm/ctc-contracts/${row.dbId}/clarify`, { query: comment }); toast.info('Clarification raised', 'Sent to initiator'); }
      load();
    } catch { toast.error('Action failed', 'Please try again.'); }
  };

  return (
    <div style={{ padding: 0, display: 'flex', flexDirection: 'column', gap: 14, fontFamily: "'Rubik', system-ui, sans-serif" }}>
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
      <div style={{ background: t.surface, borderRadius: 14, border: `1.5px solid ${t.dark ? t.border : '#A5F3FC'}`, boxShadow: '0 1px 4px rgba(6,182,212,.08)', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 14px', background: t.surface, borderBottom: `1.5px solid ${t.dark ? t.border : 'rgba(6,182,212,.18)'}`, flexWrap: 'wrap' }}>
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

        {loading
          ? <ShimmerTable rows={6} cols={9} />
          : tab === 'clarification'
          ? <ClarificationTable rows={list} page={page} setPage={setPage} onApprove={doApprove} onAction={setActionId} onView={doView} t={t} />
          : <StandardTable rows={list} tab={tab} page={page} setPage={setPage} onApprove={doApprove} onAction={setActionId} onView={doView} t={t} />}
      </div>

      {actionContract && <TakeActionModal contract={actionContract} onClose={() => setActionId(null)} onSubmit={doAction} t={t} />}
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

function ApproveBtn({ active, onClick }: { active: boolean; onClick: () => void }) {
  return (
    <button disabled={!active} onClick={onClick} title="Approve" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '5px 10px', borderRadius: 8, border: active ? 'none' : '1.5px solid #E2E8F0', background: active ? 'linear-gradient(135deg,#10b981,#059669)' : '#F8FAFC', color: active ? '#fff' : '#CBD5E1', fontFamily: 'inherit', fontSize: 9.5, fontWeight: active ? 700 : 600, cursor: active ? 'pointer' : 'not-allowed', boxShadow: active ? '0 2px 7px rgba(16,185,129,.35)' : 'none', whiteSpace: 'nowrap', opacity: active ? 1 : .6 }}>
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={active ? '#fff' : '#CBD5E1'} strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12" /></svg> Approve
    </button>
  );
}

function TakeActionBtn({ active, onClick }: { active: boolean; onClick: () => void }) {
  return (
    <button disabled={!active} onClick={onClick} title="Take Action" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '5px 10px', borderRadius: 8, border: active ? 'none' : '1.5px solid #E2E8F0', background: active ? 'linear-gradient(135deg,#0891b2,#0e7490)' : '#F8FAFC', color: active ? '#fff' : '#94A3B8', fontFamily: 'inherit', fontSize: 9.5, fontWeight: active ? 700 : 600, cursor: active ? 'pointer' : 'not-allowed', boxShadow: active ? '0 2px 7px rgba(8,145,178,.35)' : 'none', whiteSpace: 'nowrap', opacity: active ? 1 : .7 }}>
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={active ? '#fff' : '#94A3B8'} strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg> Take Action
    </button>
  );
}

function ViewBtn({ onClick, t }: { onClick: () => void; t: OpsTokens }) {
  const base = t.dark ? 'rgba(6,182,212,.12)' : '#F0FDFF';
  const hov  = t.dark ? 'rgba(6,182,212,.22)' : '#CFFAFE';
  return (
    <button onClick={onClick} title="View Agreement" style={{ width: 30, height: 30, borderRadius: 8, border: `1.5px solid ${t.dark ? 'rgba(6,182,212,.3)' : '#A5F3FC'}`, background: base, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#0891b2', transition: 'all .13s', flexShrink: 0 }}
      onMouseEnter={e => (e.currentTarget.style.background = hov)} onMouseLeave={e => (e.currentTarget.style.background = base)}>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={t.dark ? '#67e8f9' : '#0891b2'} strokeWidth="2" strokeLinecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
    </button>
  );
}

function StandardTable({ rows, tab, page, setPage, onApprove, onAction, onView, t }: { rows: AtaContract[]; tab: AtaTab; page: number; setPage: (n: number) => void; onApprove: (id: string) => void; onAction: (id: string) => void; onView: (id: string) => void; t: OpsTokens }) {
  const totalPages = Math.max(1, Math.ceil(rows.length / PER_PAGE));
  const safe = Math.min(page, totalPages);
  const start = (safe - 1) * PER_PAGE;
  const slice = rows.slice(start, start + PER_PAGE);
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
    <div style={{ background: t.tableBg, overflow: 'hidden' }}>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1200 }}>
          <thead><tr style={{ background: 'linear-gradient(90deg,#0e7490 0%,#0891b2 35%,#06b6d4 70%,#22d3ee 100%)' }}>
            <th style={{ ...TH, width: 52 }}>SR. NO</th>
            <th style={{ ...TH, width: 110 }}>CTC ID</th>
            <th style={{ ...TH, width: 110 }}>CTC DATE</th>
            <th style={THL}>AGREEMENT TITLE</th>
            <th style={{ ...THL, width: 120 }}>CREATED BY</th>
            <th style={{ ...THL, width: 120 }}>APPROVER</th>
            <th style={{ ...TH, width: 120 }}>STATUS</th>
            <th style={isRej ? { ...THL } : { ...TH }}>{isRej ? 'REJECTION REASON' : '—'}</th>
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
                  <td style={TD_C}><span style={{ fontSize: 11.5, fontWeight: 600, color: t.textSub }}>{c.date}</span></td>
                  <td style={TD_L}><Tooltip label={c.title}><div style={{ fontSize: 12.5, fontWeight: 700, color: t.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 190 }}>{c.title}</div></Tooltip></td>
                  <td style={TD_L}><div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><div style={{ width: 26, height: 26, borderRadius: '50%', background: 'linear-gradient(135deg,#A5F3FC,#67E8F9)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, border: '1.5px solid #CFFAFE' }}><span style={{ fontSize: 8.5, fontWeight: 900, color: '#0e7490' }}>{inits(c.createdBy)}</span></div><span style={{ fontSize: 11, fontWeight: 600, color: t.text, whiteSpace: 'nowrap' }}>{c.createdBy}</span></div></td>
                  <td style={TD_L}><div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><div style={{ width: 26, height: 26, borderRadius: '50%', background: 'linear-gradient(135deg,#0891b2,#0e7490)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><span style={{ fontSize: 8.5, fontWeight: 900, color: '#fff' }}>{inits(c.approver)}</span></div><span style={{ fontSize: 11, fontWeight: 600, color: t.text, whiteSpace: 'nowrap' }}>{c.approver}</span></div></td>
                  <td style={TD_C}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 20, background: sb.bg, border: `1.5px solid ${sb.border}`, whiteSpace: 'nowrap' }}><span style={{ width: 5, height: 5, borderRadius: '50%', background: s.dot, flexShrink: 0 }} /><span style={{ fontSize: 10.5, fontWeight: 700, color: sb.text }}>{s.label}</span></span></td>
                  {isRej
                    ? <td style={{ ...TD_L, maxWidth: 180 }}><Tooltip label={c.rejReason ?? ''}><div style={{ fontSize: 10.5, color: '#DC2626', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 175 }}>{c.rejReason}</div></Tooltip></td>
                    : <td style={TD_C}><span style={{ color: '#C4B5FD', fontSize: 11 }}>—</span></td>}
                  <td style={TD_C}><span style={{ fontSize: 11, fontWeight: 600, color: t.textSub, whiteSpace: 'nowrap' }}>{c.expDate}</span></td>
                  <td style={TD_C}>
                    {actionable ? (
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
                        <ViewBtn onClick={() => onView(c.id)} t={t} />
                        <ApproveBtn active onClick={() => onApprove(c.id)} />
                        <TakeActionBtn active onClick={() => onAction(c.id)} />
                      </div>
                    ) : (
                      <span style={{ fontSize: 9.5, fontWeight: 600, color: c.status === 'approved' ? '#059669' : '#DC2626' }}>{c.status === 'approved' ? '✓ Approved' : '✕ Rejected'}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Pager total={rows.length} page={page} setPage={setPage} t={t} />
    </div>
  );
}

function ClarificationTable({ rows, page, setPage, onApprove, onAction, onView, t }: { rows: AtaContract[]; page: number; setPage: (n: number) => void; onApprove: (id: string) => void; onAction: (id: string) => void; onView: (id: string) => void; t: OpsTokens }) {
  const totalPages = Math.max(1, Math.ceil(rows.length / PER_PAGE));
  const safe = Math.min(page, totalPages);
  const start = (safe - 1) * PER_PAGE;
  const slice = rows.slice(start, start + PER_PAGE);

  if (!slice.length) {
    return <div style={{ background: t.dark ? t.tableBg : '#F0FDFF', minHeight: 160, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 20px' }}><div style={{ fontSize: 13, fontWeight: 800, color: t.dark ? '#67e8f9' : '#164e63' }}>No clarification requests.</div></div>;
  }

  return (
    <div style={{ background: t.tableBg, overflow: 'hidden' }}>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1200 }}>
          <thead><tr style={{ background: 'linear-gradient(90deg,#5B21B6 0%,#7C3AED 40%,#8B5CF6 70%,#A78BFA 100%)' }}>
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
              const bg = n % 2 === 0 ? (t.dark ? 'rgba(124,58,237,.05)' : 'rgba(245,243,255,.35)') : t.tableBg;
              return (
                <tr key={c.id} style={{ background: bg, transition: 'all .12s' }}
                  onMouseEnter={e => { e.currentTarget.style.background = t.dark ? 'rgba(124,58,237,.14)' : 'rgba(124,58,237,.04)'; e.currentTarget.style.boxShadow = 'inset 3px 0 0 #7C3AED'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = bg; e.currentTarget.style.boxShadow = 'none'; }}>
                  <td style={TD_C}><div style={{ width: 28, height: 28, borderRadius: '50%', background: 'linear-gradient(135deg,#7C3AED,#5B21B6)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 6px rgba(109,40,217,.35)' }}><span style={{ fontSize: 10, fontWeight: 900, color: '#fff' }}>{pad2(n)}</span></div></td>
                  <td style={TD_C}><span style={{ fontFamily: "'Geist Mono', monospace", fontSize: 11, fontWeight: 800, color: t.dark ? '#c4b5fd' : '#4C1D95', background: 'rgba(109,40,217,.1)', padding: '4px 9px', borderRadius: 7, border: '1px solid rgba(124,58,237,.28)' }}>{c.id}</span></td>
                  <td style={TD_C}><span style={{ fontSize: 11.5, fontWeight: 600, color: t.textSub }}>{c.date}</span></td>
                  <td style={TD_L}><Tooltip label={c.title}><div style={{ fontSize: 12.5, fontWeight: 700, color: t.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 190 }}>{c.title}</div></Tooltip></td>
                  <td style={TD_L}><div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><div style={{ width: 24, height: 24, borderRadius: '50%', background: 'linear-gradient(135deg,#A78BFA,#7C3AED)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><span style={{ fontSize: 8, fontWeight: 900, color: '#fff' }}>{inits(c.createdBy)}</span></div><span style={{ fontSize: 11, fontWeight: 600, color: t.text, whiteSpace: 'nowrap' }}>{c.createdBy}</span></div></td>
                  <td style={TD_L}><div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><div style={{ width: 24, height: 24, borderRadius: '50%', background: 'linear-gradient(135deg,#6D28D9,#4C1D95)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><span style={{ fontSize: 8, fontWeight: 900, color: '#fff' }}>{inits(c.approver)}</span></div><span style={{ fontSize: 11, fontWeight: 600, color: t.text, whiteSpace: 'nowrap' }}>{c.approver}</span></div></td>
                  <td style={{ ...TD_L, maxWidth: 220 }}>
                    <Tooltip label={latest?.query ?? ''}><div style={{ fontSize: 11, color: t.textSub, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 220 }}>{latest?.query ?? '—'}</div></Tooltip>
                    {hasResp && <div style={{ fontSize: 9.5, color: '#059669', fontWeight: 600, marginTop: 2 }}>✓ Response provided</div>}
                  </td>
                  <td style={TD_C}><span style={{ fontSize: 11, fontWeight: 600, color: t.textSub, whiteSpace: 'nowrap' }}>{c.expDate}</span></td>
                  <td style={TD_C}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, flexWrap: 'nowrap' }}>
                      <ViewBtn onClick={() => onView(c.id)} t={t} />
                      <ApproveBtn active={hasResp} onClick={() => onApprove(c.id)} />
                      <TakeActionBtn active={hasResp} onClick={() => onAction(c.id)} />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Pager total={rows.length} page={page} setPage={setPage} t={t} />
    </div>
  );
}

/* ── Take Action modal (Raise Clarification / Reject) ── */
function TakeActionModal({ contract, onClose, onSubmit, t }: { contract: AtaContract; onClose: () => void; onSubmit: (id: string, mode: 'clarification' | 'rejected', comment: string) => void; t: OpsTokens }) {
  const [choice, setChoice] = useState<'clarify' | 'reject' | null>(null);
  const [comment, setComment] = useState('');
  const [err, setErr] = useState(false);

  const submit = () => {
    if (!choice) { setErr(true); return; }
    if (!comment.trim()) { setErr(true); return; }
    onSubmit(contract.id, choice === 'reject' ? 'rejected' : 'clarification', comment.trim());
  };

  return (
    <div onClick={e => { if (e.target === e.currentTarget) onClose(); }} style={{ position: 'fixed', inset: 0, zIndex: 9999999, background: 'rgba(8,3,28,.82)', backdropFilter: 'blur(14px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, fontFamily: "'Rubik', system-ui, sans-serif" }}>
      <div style={{ width: '100%', maxWidth: 520, borderRadius: 24, overflow: 'hidden', boxShadow: '0 50px 100px rgba(8,3,28,.5),0 20px 40px rgba(6,182,212,.12)', border: '1px solid rgba(255,255,255,.1)', animation: 'ataSlideUp .24s cubic-bezier(.22,1,.36,1) both', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
        {/* Header */}
        <div style={{ background: 'linear-gradient(135deg,#0e7490 0%,#0891b2 45%,#06b6d4 80%,#22d3ee 100%)', padding: '22px 24px 20px', position: 'relative', overflow: 'hidden', flexShrink: 0 }}>
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '55%', background: 'linear-gradient(180deg,rgba(255,255,255,.18),transparent)', pointerEvents: 'none' }} />
          <div style={{ position: 'relative', zIndex: 1, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <div style={{ width: 46, height: 46, borderRadius: 14, background: 'rgba(255,255,255,.2)', border: '1.5px solid rgba(255,255,255,.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 12px rgba(0,0,0,.15)' }}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg></div>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 4 }}><span style={{ fontSize: 9, fontWeight: 800, color: 'rgba(255,255,255,.65)', letterSpacing: '.16em', textTransform: 'uppercase' }}>{contract.id}</span><span style={{ width: 3, height: 3, borderRadius: '50%', background: 'rgba(255,255,255,.4)' }} /><span style={{ fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,.65)', letterSpacing: '.1em', textTransform: 'uppercase' }}>Review Action</span></div>
                <div style={{ fontSize: 18, fontWeight: 900, color: '#fff', letterSpacing: '-.4px', lineHeight: 1.15, maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{contract.title}</div>
              </div>
            </div>
            <button onClick={onClose} style={{ width: 34, height: 34, borderRadius: 10, background: 'rgba(255,255,255,.15)', border: '1.5px solid rgba(255,255,255,.25)', color: '#fff', fontSize: 17, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>✕</button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14, position: 'relative', zIndex: 1, flexWrap: 'wrap' }}>
            <Chip text={contract.createdBy} />
            <Chip text={contract.date} />
            <Chip text={contract.approver} />
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 20, background: 'rgba(255,255,255,.18)', border: '1px solid rgba(255,255,255,.25)', marginLeft: 'auto' }}><span style={{ width: 6, height: 6, borderRadius: '50%', background: '#FDE68A', boxShadow: '0 0 6px rgba(253,230,138,.8)' }} /><span style={{ fontSize: 9, fontWeight: 800, color: '#FEF3C7', letterSpacing: '.06em' }}>{contract.status === 'clarification' ? 'CLARIFICATION' : 'PENDING'}</span></span>
          </div>
        </div>

        {/* Clarification history */}
        {contract.clarifications.length > 0 && (
          <div style={{ padding: '12px 24px', background: t.dark ? '#1c1733' : '#FAF5FF', borderBottom: `1px solid ${t.dark ? 'rgba(124,58,237,.3)' : '#EDE9FE'}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={t.dark ? '#c4b5fd' : '#7C3AED'} strokeWidth="2.2" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg><span style={{ fontSize: 8, fontWeight: 800, letterSpacing: '.12em', textTransform: 'uppercase', color: t.dark ? '#c4b5fd' : '#7C3AED' }}>Clarification History</span></div>
            {contract.clarifications.map((cl, i) => (
              <div key={i} style={{ borderRadius: 9, background: t.surface, border: `1px solid ${t.dark ? 'rgba(124,58,237,.3)' : '#DDD6FE'}`, padding: '9px 12px', marginBottom: 5 }}>
                <div style={{ fontSize: 9.5, color: t.dark ? '#c4b5fd' : '#5B21B6', fontWeight: 700, marginBottom: 3 }}>Query {i + 1}</div>
                <div style={{ fontSize: 10.5, color: t.textSub, lineHeight: 1.5 }}>{cl.query}</div>
                {cl.response
                  ? <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 6, padding: '5px 8px', borderRadius: 6, background: t.dark ? 'rgba(16,185,129,.14)' : '#ECFDF5', border: `1px solid ${t.dark ? 'rgba(16,185,129,.38)' : '#A7F3D0'}` }}><svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke={t.dark ? '#6ee7b7' : '#059669'} strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12" /></svg><span style={{ fontSize: 9.5, color: t.dark ? '#6ee7b7' : '#059669', fontWeight: 600 }}>{cl.response}</span></div>
                  : <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 6, padding: '5px 8px', borderRadius: 6, background: t.dark ? 'rgba(245,158,11,.14)' : '#FFFBEB', border: `1px solid ${t.dark ? 'rgba(245,158,11,.38)' : '#FDE68A'}` }}><svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke={t.dark ? '#fcd34d' : '#D97706'} strokeWidth="2.5" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg><span style={{ fontSize: 9.5, color: t.dark ? '#fcd34d' : '#D97706', fontWeight: 600 }}>Awaiting sender response</span></div>}
              </div>
            ))}
          </div>
        )}

        {/* Body */}
        <div style={{ padding: '20px 24px 22px', background: t.surface, overflowY: 'auto' }}>
          <div style={{ fontSize: 8.5, fontWeight: 800, letterSpacing: '.12em', textTransform: 'uppercase', color: t.textMuted, marginBottom: 12 }}>Choose Action</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
            <ChoiceCard sel={choice === 'clarify'} onClick={() => { setChoice('clarify'); setErr(false); }} grad="#7C3AED,#5B21B6" selBg={t.dark ? 'rgba(124,58,237,.2)' : '#EDE9FE'} selBd={t.dark ? 'rgba(124,58,237,.5)' : '#C4B5FD'} baseBg={t.dark ? 'rgba(124,58,237,.08)' : '#FAF5FF'} baseBd={t.dark ? 'rgba(124,58,237,.22)' : '#E8E4F9'} title="Raise Clarification" titleColor={t.dark ? '#ddd6fe' : '#3B0764'} sub="Request more info or details from the agreement initiator." subColor={t.dark ? '#c4b5fd' : '#7C3AED'}
              icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>} />
            <ChoiceCard sel={choice === 'reject'} onClick={() => { setChoice('reject'); setErr(false); }} grad="#EF4444,#DC2626" selBg={t.dark ? 'rgba(239,68,68,.18)' : '#FEE2E2'} selBd={t.dark ? 'rgba(239,68,68,.5)' : '#FCA5A5'} baseBg={t.dark ? 'rgba(239,68,68,.07)' : '#FEF2F2'} baseBd={t.dark ? 'rgba(239,68,68,.2)' : '#FEE2E2'} title="Reject Agreement" titleColor={t.dark ? '#fca5a5' : '#7F1D1D'} sub="Decline this agreement and notify the initiator with your reason." subColor={t.dark ? '#f87171' : '#DC2626'}
              icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></svg>} />
          </div>
          <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: '.1em', textTransform: 'uppercase', color: t.textMuted, marginBottom: 7 }}>Comment / Reason <span style={{ color: '#EF4444' }}>*</span></div>
          <textarea value={comment} onChange={e => { setComment(e.target.value); setErr(false); }} placeholder="Enter your clarification query or rejection reason…"
            style={{ width: '100%', height: 85, padding: '11px 13px', border: `1.5px solid ${err && !comment.trim() ? '#EF4444' : t.searchBorder}`, borderRadius: 11, fontFamily: 'inherit', fontSize: 12, color: t.text, resize: 'none', outline: 'none', lineHeight: 1.55, background: t.searchBg, boxSizing: 'border-box' }} />
          {err && !choice && <div style={{ fontSize: 9, color: '#EF4444', marginTop: 6, fontWeight: 600 }}>Please choose an action.</div>}
          <button onClick={submit} style={{ width: '100%', marginTop: 12, padding: 13, borderRadius: 12, border: 'none', background: choice === 'reject' ? 'linear-gradient(135deg,#EF4444,#DC2626)' : 'linear-gradient(135deg,#0e7490,#0891b2,#06b6d4)', color: '#fff', fontFamily: 'inherit', fontSize: 13, fontWeight: 800, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, boxShadow: '0 4px 16px rgba(6,182,212,.4)', letterSpacing: '-.1px' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round"><polyline points="9 11 12 14 22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg>
            {choice === 'reject' ? 'Confirm Rejection' : choice === 'clarify' ? 'Submit Clarification' : 'Submit Action'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Chip({ text }: { text: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 20, background: 'rgba(255,255,255,.15)', border: '1px solid rgba(255,255,255,.2)' }}>
      <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.8)" strokeWidth="2.5" strokeLinecap="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
      <span style={{ fontSize: 9.5, fontWeight: 600, color: 'rgba(255,255,255,.9)' }}>{text}</span>
    </span>
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

const ATA_CSS = `
@keyframes ataSlideUp { from { opacity:0; transform:translateY(18px) scale(.97); } to { opacity:1; transform:none; } }
`;
