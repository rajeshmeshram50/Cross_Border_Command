import { useRef, useState } from 'react';
import api from '../../../api';
import { useToast } from '../../../contexts/ToastContext';
import { useScrollLock } from '../../../hooks/useScrollLock';
import type { OpsTokens } from './useOpsTheme';

/* ─────────────────────────────────────────────────────────────────────────
 * Shared CTC lifecycle modals — used by both the add/edit form (ClmCtcForm)
 * and the Case-to-Case Contracts table (ClmCaseToCasePage):
 *   · VersionHistoryModal   — every draft/revision/decision/sign event, each
 *                             downloadable as a PDF snapshot.
 *   · AgreementTimelineModal — the 6-step lifecycle (draft → review → approve
 *                             → sent for signing → signed → stored), derived
 *                             from the contract's version audit.
 * ───────────────────────────────────────────────────────────────────────── */

export type CtcVersion = { v: number; label: string; status: string; date: string; by: string };
export type CtcSigner = { name: string; email: string; role: string; contact: string; signed: boolean; signed_at: string | null; declined?: boolean; decline_reason?: string };

/* ── Version History — per-version PDF download (timeline-card design) ── */
export function VersionHistoryModal({ t, code, workingId, versions, onClose }: { t: OpsTokens; code: string; workingId: number | null; versions: CtcVersion[]; onClose: () => void }) {
  useScrollLock(true);   // freeze background scroll while the modal is open
  const toast = useToast();
  const [busy, setBusy] = useState<number | null>(null);
  const [activeVer, setActiveVer] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const download = async (v: number) => {
    if (!workingId) { toast.error('Not saved', 'Submit the draft for approval first.'); return; }
    setBusy(v);
    try {
      const res = await api.get(`/clm/ctc-contracts/${workingId}/versions/${v}/download`, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data as Blob);
      const a = document.createElement('a'); a.href = url; a.download = `${code}-v${v}.pdf`; document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch { toast.error('Download failed', 'Could not generate this version PDF.'); }
    finally { setBusy(null); }
  };
  // Each draft submission/resubmission is a version. Its decision outcome
  // (Approved / Rejected / Sent / Signed …) is recorded as a SEPARATE version
  // pushed after it — so we resolve each draft's outcome from the decision
  // version(s) that fall between it and the next draft, and surface that as the
  // draft's status pill (so an approved draft reads "Approved", not "Under Review").
  const all = [...versions].sort((a, b) => a.v - b.v);
  const DECISIONS = ['approved', 'rejected', 'declined', 'approving', 'sent for signing', 'signed'];
  const drafts = all
    .filter(v => (v.status || '').toLowerCase() === 'under review')
    .map((d, i, arr) => {
      const nextDraft = arr[i + 1];
      const between = all.filter(x => x.v > d.v && (!nextDraft || x.v < nextDraft.v) && DECISIONS.includes((x.status || '').toLowerCase()));
      const outcome = between.length ? between[between.length - 1].status : '';   // latest decision wins
      return { ...d, no: i + 1, outcome };
    });
  const sorted = [...drafts].sort((a, b) => b.no - a.no);   // newest first
  const latestNo = sorted[0]?.no ?? null;
  const sel = activeVer ?? latestNo;
  // Status → pill (label + colours), driven by the draft's resolved outcome.
  const pillOf = (ver: { outcome: string; no: number }) => {
    const s = (ver.outcome || '').toLowerCase();
    const C = (fg: string, dfg: string, bg: string, dbg: string) => ({ fg: t.dark ? dfg : fg, bg: t.dark ? dbg : bg });
    if (s.includes('reject')) return { label: 'Rejected', ...C('#DC2626', '#fca5a5', '#FEE2E2', 'rgba(239,68,68,.16)') };
    if (s.includes('declin')) return { label: 'Declined', ...C('#DC2626', '#fca5a5', '#FEE2E2', 'rgba(239,68,68,.16)') };
    if (s === 'approving') return { label: 'Partial Approval', ...C('#D97706', '#fcd34d', '#FEF3C7', 'rgba(245,158,11,.16)') };
    if (s.includes('approv')) return { label: 'Approved', ...C('#059669', '#6ee7b7', '#ECFDF5', 'rgba(16,185,129,.16)') };
    if (s.includes('sent')) return { label: 'Sent for Signing', ...C('#0891b2', '#67e8f9', '#ECFEFF', 'rgba(6,182,212,.16)') };
    if (s.includes('sign')) return { label: 'Signed', ...C('#059669', '#6ee7b7', '#ECFDF5', 'rgba(16,185,129,.16)') };
    return ver.no === 1
      ? { label: 'Under Review', ...C('#6D28D9', '#c4b5fd', '#EDE9FE', 'rgba(124,58,237,.16)') }
      : { label: 'Resubmitted', ...C('#D97706', '#fcd34d', '#FEF3C7', 'rgba(245,158,11,.16)') };
  };
  const jumpTo = (no: number) => { setActiveVer(no); scrollRef.current?.querySelector(`[data-ver="${no}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  const overall = sorted[0] ? pillOf(sorted[0]) : null;
  return (
    <div onClick={() => { if (busy === null) onClose(); }} style={{ position: 'fixed', inset: 0, zIndex: 9999999, background: 'rgba(15,23,42,.55)', backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <style>{`
        @keyframes ctcm-spin { to { transform: rotate(360deg); } }
        @keyframes ctcm-bar { 0% { left: -45%; } 100% { left: 100%; } }
        .ctcm-spin { animation: ctcm-spin .7s linear infinite; transform-origin: 50% 50%; }
        .ctcm-prog { position: relative; height: 5px; border-radius: 4px; overflow: hidden; background: rgba(124,58,237,.16); margin-top: 9px; }
        .ctcm-prog::before { content: ''; position: absolute; top: 0; height: 100%; width: 45%; border-radius: 4px; background: linear-gradient(90deg, transparent, #7C3AED 40%, #a78bfa 60%, transparent); animation: ctcm-bar 1.05s ease-in-out infinite; }
      `}</style>
      <div onClick={e => e.stopPropagation()} style={{ width: 'min(560px,94vw)', maxHeight: '84vh', background: t.surface, borderRadius: 16, border: `1.5px solid ${t.dark ? 'rgba(124,58,237,.35)' : '#DDD6FE'}`, boxShadow: '0 24px 70px rgba(0,0,0,.4)', display: 'flex', flexDirection: 'column', overflow: 'hidden', fontFamily: 'var(--font-sans)' }}>
        {/* Header */}
        <div style={{ padding: '13px 16px', background: 'radial-gradient(rgba(255,255,255,.16) 1.1px, transparent 1.1px), linear-gradient(118deg,#4C1D95,#6D28D9,#7C3AED)', backgroundSize: '14px 14px, auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: 9, background: 'rgba(255,255,255,.18)', border: '1.5px solid rgba(255,255,255,.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"><polyline points="12 8 12 12 14 14" /><path d="M3.05 11a9 9 0 1 1 .5 4m-.5 5v-5h5" /></svg></div>
            <div>
              <div style={{ fontSize: 8, fontWeight: 700, color: 'rgba(255,255,255,.6)', letterSpacing: '.1em', textTransform: 'uppercase' }}>{code}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 14, fontWeight: 800, color: '#fff' }}>Version History</span>
                <span style={{ fontSize: 9, color: 'rgba(255,255,255,.7)' }}>{drafts.length} version{drafts.length === 1 ? '' : 's'} · All drafts &amp; revisions</span>
                {overall && <span style={{ padding: '2px 9px', borderRadius: 20, background: 'rgba(255,255,255,.18)', border: '1px solid rgba(255,255,255,.28)', fontSize: 7.5, fontWeight: 800, color: '#fff' }}>{overall.label}</span>}
              </div>
            </div>
          </div>
          <button onClick={() => { if (busy === null) onClose(); }} disabled={busy !== null} title={busy !== null ? 'Please wait — preparing your download' : 'Close'} style={{ width: 28, height: 28, borderRadius: 8, border: 'none', background: 'rgba(255,255,255,.18)', cursor: busy !== null ? 'wait' : 'pointer', opacity: busy !== null ? .45 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg></button>
        </div>
        {/* Quick-jump number rail + sort */}
        {sorted.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '10px 16px', borderBottom: `1px solid ${t.dark ? 'rgba(124,58,237,.2)' : '#EDE9FE'}`, background: t.dark ? 'rgba(124,58,237,.06)' : '#FAF8FF', flexWrap: 'wrap' }}>
            {sorted.map(v => {
              const on = v.no === sel;
              return (
                <button key={v.no} onClick={() => jumpTo(v.no)} style={{ width: 28, height: 28, borderRadius: 8, flexShrink: 0, border: `1.5px solid ${on ? 'transparent' : (t.dark ? 'rgba(124,58,237,.4)' : '#DDD6FE')}`, background: on ? 'linear-gradient(135deg,#6D28D9,#7C3AED)' : 'transparent', color: on ? '#fff' : (t.dark ? '#c4b5fd' : '#7C3AED'), fontFamily: 'inherit', fontSize: 11, fontWeight: 800, cursor: 'pointer' }}>{v.no}</button>
              );
            })}
            <span style={{ marginLeft: 'auto', fontSize: 9, fontWeight: 700, color: t.dark ? '#a78bfa' : '#7C3AED', display: 'inline-flex', alignItems: 'center', gap: 3 }}>↓ Newest first</span>
          </div>
        )}
        {/* Timeline list */}
        <div ref={scrollRef} style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '14px 16px' }}>
          {sorted.length === 0 && <div style={{ fontSize: 11, color: t.textMuted, textAlign: 'center', padding: 28 }}>No versions recorded yet.</div>}
          {sorted.map((ver, idx) => {
            const pill = pillOf(ver);
            const last = idx === sorted.length - 1;
            return (
              <div key={ver.v} data-ver={ver.no} style={{ display: 'flex', gap: 12, scrollMarginTop: 8 }}>
                {/* VER badge + timeline line */}
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
                  <div style={{ width: 40, height: 44, borderRadius: 11, background: t.surface, border: `1.5px solid ${t.dark ? 'rgba(124,58,237,.4)' : '#DDD6FE'}`, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: '0 2px 6px rgba(109,40,217,.1)' }}>
                    <span style={{ fontSize: 6, fontWeight: 800, letterSpacing: '.1em', color: t.dark ? '#a78bfa' : '#A78BFA' }}>VER</span>
                    <span style={{ fontSize: 16, fontWeight: 900, color: t.dark ? '#c4b5fd' : '#6D28D9', lineHeight: 1 }}>{ver.no}</span>
                  </div>
                  {!last && <div style={{ width: 2, flex: 1, minHeight: 16, background: t.dark ? 'rgba(124,58,237,.25)' : '#E4DEFF', margin: '4px 0' }} />}
                </div>
                {/* card */}
                <div style={{ flex: 1, minWidth: 0, marginBottom: last ? 0 : 14, borderRadius: 12, background: t.dark ? 'rgba(255,255,255,.03)' : '#fff', border: `1.5px solid ${ver.no === sel ? '#7C3AED' : (t.dark ? 'rgba(124,58,237,.2)' : '#EDE9FE')}`, boxShadow: '0 2px 10px rgba(109,40,217,.05)', padding: '12px 14px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ fontSize: 13, fontWeight: 800, color: t.textStrong }}>Version {ver.no}</span>
                    <span style={{ padding: '2px 9px', borderRadius: 20, background: pill.bg, fontSize: 8, fontWeight: 800, color: pill.fg, flexShrink: 0 }}>{pill.label}</span>
                  </div>
                  <div style={{ fontSize: 10, color: t.textSub, lineHeight: 1.5, marginTop: 5 }}>{ver.label}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8, fontSize: 8.5, color: t.textMuted, fontWeight: 500, flexWrap: 'wrap' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>{ver.date}</span>
                    {ver.by && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>{ver.by}</span>}
                  </div>
                  <button onClick={() => download(ver.v)} disabled={busy !== null} style={{ width: '100%', marginTop: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '8px', borderRadius: 9, border: `1.5px solid ${t.dark ? 'rgba(124,58,237,.35)' : '#C4B5FD'}`, background: t.dark ? 'rgba(124,58,237,.16)' : '#F5F0FF', color: t.dark ? '#c4b5fd' : '#6D28D9', fontSize: 9.5, fontWeight: 800, cursor: busy !== null ? 'wait' : 'pointer', opacity: busy !== null && busy !== ver.v ? .5 : 1, fontFamily: 'inherit' }}>
                    {busy === ver.v
                      ? <svg className="ctcm-spin" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
                      : <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>}
                    {busy === ver.v ? 'Preparing…' : `Download v${ver.no} Draft`}
                  </button>
                  {/* Indeterminate progress + status line while this version is generating.
                      No real % — the server builds the PDF before streaming, so a
                      determinate bar would lie; the sweep signals active work. */}
                  {busy === ver.v && (
                    <>
                      <div className="ctcm-prog" />
                      <div style={{ marginTop: 6, fontSize: 8.5, fontWeight: 700, color: t.dark ? '#a78bfa' : '#7C3AED', textAlign: 'center', letterSpacing: '.02em' }}>
                        Generating your PDF… large agreements can take a moment
                      </div>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ── Agreement Timeline — 6-step lifecycle derived from the version audit ── */
type TStatus = 'done' | 'rejected' | 'pending';
type TStep = { title: string; desc: string; status: TStatus; by: string; date: string; icon: React.ReactNode };

export function AgreementTimelineModal({ t, code, title, stage, versions, signers, onClose }: { t: OpsTokens; code: string; title: string; stage: number; versions: CtcVersion[]; signers: CtcSigner[]; onClose: () => void }) {
  useScrollLock(true);   // freeze background scroll while the modal is open
  const last = (pred: (v: CtcVersion) => boolean) => [...versions].reverse().find(pred) || null;
  const v1 = versions.find(v => v.v === 1) || versions[0] || null;
  const approvedV = last(v => v.status === 'Approved');
  const rejectedV = last(v => v.status === 'Rejected');
  const sentV = last(v => v.status === 'Sent for Signing');
  const signedAllV = last(v => (v.label || '').toLowerCase().includes('signed by all'));
  const storedV = last(v => (v.label || '').toLowerCase().includes('repository'));
  const declinedV = last(v => v.status === 'Declined');
  const isApproved = !!approvedV && (!rejectedV || approvedV.v > rejectedV.v);
  const isRejected = !!rejectedV && (!approvedV || rejectedV.v > approvedV.v);
  const cpNames = signers.length ? signers.map(s => s.name).filter(Boolean).join(', ') : '';
  // Counterparty declined the e-sign — surface who + the remark they wrote.
  const declinedSigner = signers.find(s => s.declined);
  const isDeclined = (!!declinedSigner || !!declinedV) && !signedAllV;
  const declineBy = declinedSigner?.name || declinedV?.by || 'Signer';
  const declineReason = declinedSigner?.decline_reason || (declinedV?.label?.split('—')[1]?.trim() ?? '');

  const ic = {
    doc: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></>,
    shield: <><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></>,
    check: <polyline points="20 6 9 17 4 12" />,
    send: <><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></>,
    pen: <><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" /></>,
    archive: <><polyline points="21 8 21 21 3 21 3 8" /><rect x="1" y="3" width="22" height="5" /><line x1="10" y1="12" x2="14" y2="12" /></>,
  };

  const steps: TStep[] = [
    { title: 'Draft Created', desc: 'Agreement draft authored and reviewed', status: 'done', by: v1?.by || '—', date: v1?.date || '—', icon: ic.doc },
    { title: 'Internal Review & Approval', desc: 'Agreement submitted for internal validation', status: isRejected ? 'rejected' : isApproved ? 'done' : 'pending', by: (rejectedV || approvedV)?.by || '—', date: (rejectedV || approvedV)?.date || '—', icon: ic.shield },
    { title: 'Agreement Approved', desc: 'Approved by internal reviewer, ready for signing', status: isApproved ? 'done' : isRejected ? 'rejected' : 'pending', by: approvedV?.by || rejectedV?.by || '—', date: approvedV?.date || '—', icon: ic.check },
    { title: 'Sent for Counterparty Signing', desc: 'Agreement shared with the counterparties for signature', status: sentV ? 'done' : 'pending', by: cpNames || sentV?.by || 'Counterparty', date: sentV?.date || '—', icon: ic.send },
    { title: isDeclined ? 'Agreement Declined' : 'Agreement Signed', desc: isDeclined ? `Declined by ${declineBy}${declineReason ? ` — “${declineReason}”` : ''}` : 'All parties have executed the agreement', status: (signedAllV || storedV || stage >= 4) ? 'done' : isDeclined ? 'rejected' : 'pending', by: isDeclined ? declineBy : (cpNames || 'Counterparty'), date: signedAllV?.date || storedV?.date || declinedV?.date || '—', icon: ic.pen },
    { title: 'Contract Stored in Repository', desc: 'Moved to Final Contract Repository', status: (storedV || stage >= 4) ? 'done' : 'pending', by: 'System', date: storedV?.date || '—', icon: ic.archive },
  ];
  const doneCount = steps.filter(s => s.status === 'done').length;

  // The timeline is the fixed 6-step lifecycle (Draft → Review → Approved →
  // Sent → Signed → Stored). Per-round audit (each resubmission/rejection) lives
  // in the Version History modal, so this stays the clean milestone view —
  // matching the Figma and avoiding a duplicate "Agreement Signed" for the
  // repository-store event (which is recorded with status 'Signed').
  const timelineRows = steps;

  const tone = (s: TStatus) => s === 'done'
    ? { ring: '#059669,#047857', pill: t.dark ? '#6ee7b7' : '#059669', pillBg: t.dark ? 'rgba(16,185,129,.16)' : '#ECFDF5', pillBd: t.dark ? 'rgba(16,185,129,.4)' : '#A7F3D0', label: 'Done' }
    : s === 'rejected'
      ? { ring: '#DC2626,#B91C1C', pill: t.dark ? '#fca5a5' : '#DC2626', pillBg: t.dark ? 'rgba(239,68,68,.16)' : '#FEE2E2', pillBd: t.dark ? 'rgba(239,68,68,.4)' : '#FECACA', label: 'Rejected' }
      : { ring: t.dark ? '#475569,#334155' : '#CBD5E1,#94A3B8', pill: t.dark ? '#94a3b8' : '#64748B', pillBg: t.dark ? 'rgba(148,163,184,.12)' : '#F1F5F9', pillBd: t.dark ? 'rgba(148,163,184,.25)' : '#E2E8F0', label: 'Pending' };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 9999999, background: 'rgba(15,23,42,.55)', backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 'min(560px,94vw)', maxHeight: '86vh', background: t.surface, borderRadius: 18, border: `1.5px solid ${t.dark ? 'rgba(124,58,237,.35)' : '#DDD6FE'}`, boxShadow: '0 24px 70px rgba(0,0,0,.4)', display: 'flex', flexDirection: 'column', overflow: 'hidden', fontFamily: 'var(--font-sans)' }}>
        {/* header */}
        <div style={{ padding: '16px 18px', background: 'radial-gradient(rgba(255,255,255,.16) 1.1px, transparent 1.1px), linear-gradient(118deg,#4C1D95,#6D28D9,#7C3AED,#8B5CF6)', backgroundSize: '14px 14px, auto', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
            <div style={{ width: 38, height: 38, borderRadius: 11, background: 'rgba(255,255,255,.18)', border: '1.5px solid rgba(255,255,255,.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.1" strokeLinecap="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg></div>
            <div><div style={{ fontSize: 8, fontWeight: 800, color: 'rgba(255,255,255,.62)', letterSpacing: '.12em', textTransform: 'uppercase' }}>{code} · Approval Workflow</div><div style={{ fontSize: 16, fontWeight: 800, color: '#fff', letterSpacing: '-.3px' }}>Agreement Timeline</div><div style={{ fontSize: 9.5, color: 'rgba(255,255,255,.7)', marginTop: 1 }}>{title}</div></div>
          </div>
          <button onClick={onClose} style={{ width: 30, height: 30, borderRadius: 9, border: 'none', background: 'rgba(255,255,255,.18)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg></button>
        </div>
        {/* progress */}
        <div style={{ padding: '12px 18px', flexShrink: 0, background: t.dark ? 'rgba(124,58,237,.08)' : 'linear-gradient(110deg,#F5F0FF,#EDE9FE)', borderBottom: `1px solid ${t.dark ? 'rgba(124,58,237,.2)' : '#DDD6FE'}` }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 7 }}>
            <span style={{ fontSize: 8.5, fontWeight: 800, color: t.dark ? '#c4b5fd' : '#6D28D9', letterSpacing: '.1em', textTransform: 'uppercase' }}>Overall Progress</span>
            <span style={{ fontSize: 9.5, fontWeight: 800, color: t.dark ? '#ddd6fe' : '#4C1D95' }}>{doneCount} / 6 steps complete</span>
          </div>
          <div style={{ height: 6, borderRadius: 4, background: t.dark ? 'rgba(255,255,255,.08)' : '#E0D9FB', overflow: 'hidden' }}><div style={{ height: '100%', width: `${(doneCount / 6) * 100}%`, borderRadius: 4, background: 'linear-gradient(90deg,#7C3AED,#059669)', transition: 'width .3s' }} /></div>
        </div>
        {/* timeline */}
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '16px 18px' }}>
          <div style={{ fontSize: 8, fontWeight: 800, color: t.textMuted, letterSpacing: '.12em', textTransform: 'uppercase', marginBottom: 12 }}>Agreement Timeline</div>
          {timelineRows.map((s, i) => {
            const c = tone(s.status); const last = i === timelineRows.length - 1;
            return (
              <div key={i} style={{ display: 'flex', gap: 13 }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
                  <div style={{ width: 34, height: 34, borderRadius: '50%', background: `linear-gradient(135deg,${c.ring})`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: s.status === 'pending' ? 'none' : '0 3px 8px rgba(0,0,0,.18)' }}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">{s.status === 'rejected' ? <><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></> : s.icon}</svg>
                  </div>
                  {!last && <div style={{ width: 2, flex: 1, minHeight: 22, background: t.dark ? 'rgba(124,58,237,.25)' : '#E0D9FB', margin: '4px 0' }} />}
                </div>
                <div style={{ flex: 1, minWidth: 0, paddingBottom: last ? 0 : 16 }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 800, color: s.status === 'pending' ? t.textMuted : t.textStrong, letterSpacing: '-.2px' }}>{s.title}</div>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 9px', borderRadius: 20, background: c.pillBg, border: `1px solid ${c.pillBd}`, flexShrink: 0 }}>
                      <span style={{ fontSize: 8.5, fontWeight: 800, color: c.pill }}>{s.status === 'done' ? '✓ ' : s.status === 'rejected' ? '✕ ' : '● '}{c.label}</span>
                    </span>
                  </div>
                  <div style={{ fontSize: 10, color: t.textSub, fontWeight: 500, marginTop: 3, lineHeight: 1.45 }}>{s.desc}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 6 }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 9, fontWeight: 600, color: t.textMuted }}><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>{s.by}</span>
                    {s.date !== '—' && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 9, fontWeight: 600, color: t.textMuted }}><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>{s.date}</span>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
