import { useMemo, useState } from 'react';
import { useToast } from '../../contexts/ToastContext';
import { CTC_CONTRACTS, type CtcContract, inits, PER_PAGE } from './clmOpsData';
import ClmCtcForm from './ClmCtcForm';

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

export default function ClmCaseToCasePage() {
  const toast = useToast();
  const [tab, setTab]   = useState<CtcTab>('all');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [infoOpen, setInfoOpen] = useState(true);
  const [dlOpen, setDlOpen] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<CtcContract | null>(null);

  const counts = useMemo(() => {
    const q = search.trim().toLowerCase();
    const f = q ? CTC_CONTRACTS.filter(c => (c.title + c.cp.join(' ') + c.id + c.type).toLowerCase().includes(q)) : CTC_CONTRACTS;
    return {
      all: f.length,
      signed: f.filter(c => c.status === 'signed').length,
      inprogress: f.filter(c => c.status === 'inprogress').length,
      rejected: f.filter(c => c.status === 'rejected').length,
    };
  }, [search]);

  const list = useMemo(() => {
    const q = search.trim().toLowerCase();
    let f = q ? CTC_CONTRACTS.filter(c => (c.title + c.cp.join(' ') + c.id + c.type).toLowerCase().includes(q)) : CTC_CONTRACTS;
    return tab === 'all' ? f : f.filter(c => c.status === tab);
  }, [search, tab]);

  const totalPages = Math.max(1, Math.ceil(list.length / PER_PAGE));
  const safe = Math.min(page, totalPages);
  const start = (safe - 1) * PER_PAGE;
  const slice = list.slice(start, start + PER_PAGE);

  if (formOpen) {
    return <ClmCtcForm editing={editing} onClose={() => { setFormOpen(false); setEditing(null); }} onSaved={() => { setFormOpen(false); setEditing(null); }} />;
  }

  return (
    <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8, fontFamily: "'DM Sans', system-ui, sans-serif" }}>
      <style>{CTC_CSS}</style>

      {/* CARD 1 — HEADER STRIP */}
      <div style={{ background: 'linear-gradient(110deg,#F5F3FF 0%,#EDE9FE 22%,#DDD6FE 50%,#C4B5FD 78%,#A78BFA 100%)', borderRadius: 14, border: '1px solid rgba(124,58,237,.2)', boxShadow: '0 2px 12px rgba(109,40,217,.1)', overflow: 'hidden' }}>
        <div style={{ position: 'relative', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 18px', minHeight: 64 }}>
          <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 5, background: 'linear-gradient(180deg,#A78BFA,#7C3AED,#5B21B6)' }} />
          <span style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '50%', background: 'linear-gradient(180deg,rgba(255,255,255,.55),transparent)', pointerEvents: 'none' }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, zIndex: 1, paddingLeft: 10 }}>
            <div style={{ position: 'relative', flexShrink: 0 }}>
              <div style={{ width: 42, height: 42, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg,#8B5CF6,#7C3AED,#5B21B6)', boxShadow: '0 0 0 3px rgba(124,58,237,.22),0 4px 12px rgba(91,33,182,.42)' }}>
                <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="8" y1="13" x2="16" y2="13" /><line x1="8" y1="17" x2="12" y2="17" /></svg>
              </div>
              <span style={{ position: 'absolute', bottom: -1, right: -1, width: 10, height: 10, borderRadius: '50%', background: 'linear-gradient(135deg,#4ade80,#22c55e)', border: '2px solid #EDE9FE', boxShadow: '0 0 5px rgba(34,197,94,.45)' }} />
            </div>
            <div>
              <div style={{ fontSize: 16, fontWeight: 800, color: '#2e1065', letterSpacing: '-.4px', lineHeight: 1.15 }}>Case to Case Contracts Management</div>
              <div style={{ fontSize: 11, fontWeight: 500, color: '#5B21B6', opacity: .9, marginTop: 3 }}>Manage one-time operational agreements and contract approval workflows.</div>
            </div>
          </div>
          <button onClick={() => { setEditing(null); setFormOpen(true); }} style={{ position: 'relative', overflow: 'hidden', display: 'flex', alignItems: 'center', gap: 7, padding: '9px 18px', border: 'none', borderRadius: 10, fontFamily: 'inherit', fontSize: 12, fontWeight: 700, color: '#fff', cursor: 'pointer', zIndex: 1, background: 'linear-gradient(135deg,#8B5CF6,#7C3AED,#5B21B6)', boxShadow: '0 4px 14px rgba(91,33,182,.44),inset 0 1px 0 rgba(255,255,255,.18)' }}>
            <span style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '50%', background: 'linear-gradient(180deg,rgba(255,255,255,.18),transparent)', borderRadius: '10px 10px 0 0', pointerEvents: 'none' }} />
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
            Create CTC Agreement
          </button>
        </div>
      </div>

      {/* CARD 2 — WHAT WE ARE DOING HERE */}
      <div style={{ background: '#fff', borderRadius: 14, border: '1px solid rgba(124,58,237,.18)', overflow: 'hidden', boxShadow: '0 2px 10px rgba(6,182,212,.04)' }}>
        <div style={{ position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, background: 'linear-gradient(180deg,#C4B5FD,#7C3AED,#5B21B6)', zIndex: 10 }} />
          <div onClick={() => setInfoOpen(!infoOpen)} style={{ position: 'relative', overflow: 'hidden', display: 'flex', alignItems: 'center', gap: 12, padding: '7px 12px 7px 16px', background: 'linear-gradient(110deg,#F5F3FF 0%,#EDE9FE 35%,#DDD6FE 70%,#C4B5FD 100%)', borderBottom: infoOpen ? '1px solid #DDD6FE' : '1px solid transparent', cursor: 'pointer', userSelect: 'none', minHeight: 48 }}>
            <span style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '50%', pointerEvents: 'none', background: 'linear-gradient(180deg,rgba(255,255,255,.65),transparent)' }} />
            <div style={{ width: 36, height: 36, borderRadius: 11, flexShrink: 0, background: 'linear-gradient(135deg,#8B5CF6,#7C3AED,#5B21B6)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', position: 'relative', zIndex: 1, boxShadow: '0 0 0 3px rgba(124,58,237,.2),0 4px 12px rgba(91,33,182,.36)' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
            </div>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0, position: 'relative', zIndex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: '-.2px', color: '#7C3AED', lineHeight: 1, whiteSpace: 'nowrap', flexShrink: 0 }}>Case to Case Contracts</span>
                <span style={{ width: 1, height: 13, background: '#C4B5FD', flexShrink: 0 }} />
                <span style={{ fontSize: 11, fontWeight: 800, color: '#2e1065', letterSpacing: '-.2px', lineHeight: 1, whiteSpace: 'nowrap' }}>What We Are Doing Here</span>
              </div>
              <div style={{ fontSize: 9.5, fontWeight: 500, color: '#5B21B6', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Manage case-to-case agreements from drafting, approval, negotiation, signing, and final contract storage.</div>
            </div>
            <div style={{ width: 26, height: 26, borderRadius: 8, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,.78)', border: '1.5px solid rgba(124,58,237,.25)', color: '#7C3AED', transition: 'transform .24s', boxShadow: '0 1px 4px rgba(124,58,237,.12)', transform: infoOpen ? 'none' : 'rotate(-90deg)', position: 'relative', zIndex: 1 }}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', background: 'linear-gradient(180deg,#FAF8FF 0%,#F8FAFC 100%)', overflow: 'hidden', maxHeight: infoOpen ? 320 : 0, opacity: infoOpen ? 1 : 0, transition: 'max-height .3s cubic-bezier(.22,1,.36,1),opacity .22s' }}>
            {STAGE_CARDS.map(c => (
              <div key={c.n} style={{ position: 'relative', padding: '10px 11px 11px', background: '#fff', margin: '7px 5px', borderRadius: 11, border: '1.5px solid #EDE9FE', transition: 'all .18s', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 1px 4px rgba(15,23,42,.04)' }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = '#C4B5FD'; e.currentTarget.style.boxShadow = '0 6px 18px rgba(124,58,237,.13)'; e.currentTarget.style.transform = 'translateY(-2px)'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = '#EDE9FE'; e.currentTarget.style.boxShadow = '0 1px 4px rgba(15,23,42,.04)'; e.currentTarget.style.transform = ''; }}>
                <span style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, borderRadius: '11px 11px 0 0', background: 'linear-gradient(90deg,#A78BFA,#7C3AED)' }} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{ width: 16, height: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#7C3AED' }}><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">{c.icon}</svg></div>
                  <span style={{ fontSize: 8.5, fontWeight: 800, letterSpacing: '.12em', textTransform: 'uppercase', color: '#94A3B8', lineHeight: 1 }}>Stage {c.n}</span>
                </div>
                <div style={{ fontSize: 11, fontWeight: 800, color: '#0F172A', letterSpacing: '-.2px', lineHeight: 1.25, marginBottom: 3, marginTop: 5 }}>{c.title}</div>
                <div style={{ fontSize: 9.5, fontWeight: 500, color: '#94A3B8', lineHeight: 1.4 }}>{c.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* CARD 3 — CONTRACTS LIST */}
      <div style={{ background: '#fff', borderRadius: 14, padding: 0, overflow: 'hidden', border: '1px solid rgba(109,40,217,.15)', boxShadow: '0 2px 14px rgba(109,40,217,.08)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', background: '#fff', borderBottom: '1.5px solid #EDE9FE', flexWrap: 'wrap' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', background: '#EDE9FE', borderRadius: 30, padding: 4 }}>
            {([
              ['all', 'All Contracts', null, true],
              ['signed', 'Signed Contracts', '#10B981', false],
              ['inprogress', 'In Progress', '#F59E0B', false],
              ['rejected', 'Rejected / Unapproved', '#EF4444', false],
            ] as [CtcTab, string, string | null, boolean][]).map(([key, label, dot, hasIcon]) => {
              const active = tab === key;
              return (
                <button key={key} onClick={() => { setTab(key); setPage(1); }}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 20px', borderRadius: 25, border: 'none', fontFamily: 'inherit', fontSize: 12.5, fontWeight: active ? 800 : 700, cursor: 'pointer', letterSpacing: '-.1px', transition: 'all .18s', position: 'relative', overflow: 'hidden',
                    background: active ? 'linear-gradient(135deg,#6D28D9,#7C3AED)' : 'transparent', color: active ? '#fff' : '#5B21B6', boxShadow: active ? '0 3px 10px rgba(109,40,217,.38)' : 'none' }}>
                  {active && <span style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '50%', background: 'linear-gradient(180deg,rgba(255,255,255,.18),transparent)', borderRadius: '25px 25px 0 0', pointerEvents: 'none' }} />}
                  {hasIcon
                    ? <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={active ? '#fff' : '#5B21B6'} strokeWidth="2.5" strokeLinecap="round" style={{ position: 'relative', zIndex: 1, flexShrink: 0 }}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
                    : <span style={{ width: 8, height: 8, borderRadius: '50%', background: active ? 'rgba(255,255,255,.9)' : (dot || '#10B981'), flexShrink: 0 }} />}
                  <span style={{ position: 'relative', zIndex: 1 }}>{label}</span>
                  <span style={{ position: 'relative', zIndex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 20, height: 20, padding: '0 5px', borderRadius: 20, background: active ? 'rgba(255,255,255,.28)' : 'rgba(109,40,217,.13)', fontSize: 10, fontWeight: 900, color: active ? '#fff' : '#6D28D9' }}>{counts[key]}</span>
                </button>
              );
            })}
          </div>
          <div style={{ flex: 1 }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 16px', borderRadius: 30, background: '#F8F6FF', border: '1.5px solid #EDE9FE' }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#A78BFA" strokeWidth="2.4" strokeLinecap="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
            <input value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} placeholder="Search by name, ID, company, type…"
              style={{ border: 'none', outline: 'none', fontFamily: 'inherit', fontSize: 12, fontWeight: 500, color: '#1E1050', background: 'transparent', width: 230 }} />
          </div>
        </div>

        {/* TABLE */}
        <div style={{ background: '#fff' }}>
          {slice.length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '56px 20px', textAlign: 'center', background: '#FAFBFF' }}>
              <div style={{ width: 52, height: 52, borderRadius: 14, background: 'linear-gradient(135deg,#EDE9FE,#DDD6FE)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px', boxShadow: '0 4px 12px rgba(109,40,217,.12)' }}><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#7C3AED" strokeWidth="2" strokeLinecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg></div>
              <div style={{ fontSize: 13, fontWeight: 800, color: '#2E1065', marginBottom: 6 }}>No Contracts Found</div>
              <div style={{ fontSize: 11, color: '#94A3B8', maxWidth: 300, lineHeight: 1.6 }}>Click <b>+ Create CTC Agreement</b> to add one.</div>
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1380 }}>
                <thead><tr>
                  {['SR NO', 'CTC ID', 'CTC DATE', 'AGREEMENT TITLE', 'OUR ORGANISATION', 'COUNTERPARTIES', 'CREATED BY', 'INTERNAL APPROVAL', 'EFF. DATE', 'EXPIRY DATE', 'CP SIGNED DATE', 'ACTION'].map((h, i) => (
                    <th key={h} style={{ ...TH, textAlign: i === 3 || i === 4 || i === 5 || i === 6 ? 'left' : 'center', width: [52, 124, 110, undefined, 155, 165, 136, 122, 100, 100, 122, 150][i] }}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {slice.map((c, i) => {
                    const n = start + i + 1;
                    const s = S_CFG[c.status];
                    const ap = AP_CFG[c.approval];
                    const rowBg = n % 2 === 0 ? 'rgba(245,243,255,.35)' : '#fff';
                    const extra = c.cp.length - 1;
                    const cpS = c.cpSignedDate !== '—' ? c.cpSignedDate : (c.status === 'signed' ? c.date : '—');
                    return (
                      <tr key={c.id} style={{ background: rowBg, transition: 'all .12s' }}
                        onMouseEnter={e => { e.currentTarget.style.background = 'rgba(109,40,217,.05)'; e.currentTarget.style.boxShadow = 'inset 3px 0 0 #7C3AED'; }}
                        onMouseLeave={e => { e.currentTarget.style.background = rowBg; e.currentTarget.style.boxShadow = 'none'; }}>
                        <td style={{ ...TD, width: 52 }}><div style={{ width: 24, height: 24, borderRadius: '50%', background: 'linear-gradient(135deg,#6D28D9,#5B21B6)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 5px rgba(109,40,217,.3)' }}><span style={{ fontSize: 9, fontWeight: 900, color: '#fff' }}>{String(n).padStart(2, '0')}</span></div></td>
                        <td style={{ ...TD, width: 124 }}><span style={{ fontFamily: "'Geist Mono', monospace", fontSize: 10, fontWeight: 800, color: '#4C1D95', background: 'linear-gradient(135deg,rgba(109,40,217,.1),rgba(124,58,237,.06))', padding: '3px 7px', borderRadius: 6, border: '1px solid rgba(124,58,237,.28)', whiteSpace: 'nowrap', letterSpacing: '.02em' }}>{c.id}</span></td>
                        <td style={{ ...TD, width: 110 }}><span style={{ fontSize: 10.5, fontWeight: 600, color: '#374151', whiteSpace: 'nowrap' }}>{c.date}</span></td>
                        <td style={TDL}><div style={{ fontSize: 11.5, fontWeight: 700, color: '#1E1050', letterSpacing: '-.2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 190 }} title={c.title}>{c.title}</div></td>
                        <td style={{ ...TDL, width: 155 }}><div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><div style={{ width: 24, height: 24, borderRadius: 7, background: `linear-gradient(135deg,${orgGrad(c.org)})`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: '0 2px 5px rgba(109,40,217,.2)' }}><span style={{ fontSize: 8.5, fontWeight: 900, color: '#fff', letterSpacing: '-.3px' }}>{inits(c.org)}</span></div><span style={{ fontSize: 12, fontWeight: 600, color: '#0F172A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 105 }}>{c.org}</span></div></td>
                        <td style={{ ...TDL, width: 185 }}><div style={{ display: 'flex', alignItems: 'center', gap: 7 }}><div style={{ width: 24, height: 24, borderRadius: 7, background: 'linear-gradient(135deg,#6D28D9,#8B5CF6)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: '0 2px 5px rgba(109,40,217,.18)' }}><span style={{ fontSize: 8.5, fontWeight: 900, color: '#fff', letterSpacing: '-.3px' }}>{inits(c.cp[0])}</span></div><span style={{ fontSize: 11, fontWeight: 600, color: '#0F172A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 100 }} title={c.cp.join(', ')}>{c.cp[0]}</span>{extra > 0 && <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 18, height: 18, padding: '0 4px', borderRadius: 20, background: 'linear-gradient(135deg,#6D28D9,#7C3AED)', color: '#fff', fontSize: 8.5, fontWeight: 800, flexShrink: 0, boxShadow: '0 2px 4px rgba(109,40,217,.28)' }} title={c.cp.slice(1).join(', ')}>+{extra}</span>}</div></td>
                        <td style={{ ...TDL, width: 136 }}><div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><div style={{ width: 22, height: 22, borderRadius: '50%', background: 'linear-gradient(135deg,#C4B5FD,#A78BFA)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, border: '1.5px solid #DDD6FE' }}><span style={{ fontSize: 8, fontWeight: 900, color: '#4C1D95' }}>{inits(c.createdBy)}</span></div><span style={{ fontSize: 10.5, fontWeight: 600, color: '#0F172A', whiteSpace: 'nowrap' }}>{c.createdBy}</span></div></td>
                        <td style={{ ...TD, width: 122 }}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 8px', borderRadius: 20, background: ap.bg, border: `1px solid ${ap.border}`, whiteSpace: 'nowrap' }}><span style={{ width: 5, height: 5, borderRadius: '50%', background: ap.dot, flexShrink: 0, boxShadow: `0 0 5px ${ap.dot}60` }} /><span style={{ fontSize: 9.5, fontWeight: 700, color: ap.color }}>{ap.label}</span></span></td>
                        <td style={{ ...TD, width: 100 }}><span style={{ fontSize: 10.5, fontWeight: 600, color: c.effDate === '—' ? '#C4B5FD' : '#374151', whiteSpace: 'nowrap' }}>{c.effDate}</span></td>
                        <td style={{ ...TD, width: 100 }}><span style={{ fontSize: 10.5, fontWeight: 600, color: c.endDate === '—' ? '#C4B5FD' : '#374151', whiteSpace: 'nowrap' }}>{c.endDate}</span></td>
                        <td style={{ ...TD, width: 122 }}>{cpS === '—' ? <span style={{ fontSize: 11.5, fontWeight: 600, color: '#C4B5FD' }}>—</span> : <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10.5, fontWeight: 700, color: '#059669', whiteSpace: 'nowrap' }}><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12" /></svg>{cpS}</span>}</td>
                        <td style={{ ...TD, width: 150 }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3 }}>
                            <div style={{ position: 'relative' }}>
                              <ActBtn title="Download Contract" color="#047857" bg="#D1FAE5" border="#6EE7B7" onClick={() => setDlOpen(dlOpen === c.id ? null : c.id)}>
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#047857" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
                              </ActBtn>
                              {dlOpen === c.id && (
                                <div style={{ position: 'absolute', top: 30, right: 0, zIndex: 50, background: '#fff', borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,.15)', border: '1.5px solid #E8E4F9', minWidth: 160, overflow: 'hidden' }}>
                                  {[['PDF', '#047857', '#D1FAE5', '#A7F3D0', '#ECFDF5'], ['DOCX', '#0369A1', '#DBEAFE', '#93C5FD', '#EFF6FF']].map(([fmt, col, sbg, sbd, hov]) => (
                                    <button key={fmt} onClick={() => { setDlOpen(null); toast.info('Download started', `${c.id} · ${fmt}`); }} style={{ width: '100%', padding: '10px 14px', border: 'none', background: '#fff', fontFamily: 'inherit', fontSize: 11.5, fontWeight: 700, color: col, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 9, textAlign: 'left' }}
                                      onMouseEnter={e => (e.currentTarget.style.background = hov)} onMouseLeave={e => (e.currentTarget.style.background = '#fff')}>
                                      <span style={{ width: 26, height: 26, borderRadius: 7, background: sbg, border: `1px solid ${sbd}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: col }}><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={col} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg></span>
                                      Download as {fmt}
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                            <ActBtn title="Edit CTC" color="#5B21B6" bg="#EDE9FE" border="#C4B5FD" onClick={() => { setEditing(c); setFormOpen(true); }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#5B21B6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4z" /></svg></ActBtn>
                            <ActBtn title="Version History" color="#0369A1" bg="#DBEAFE" border="#93C5FD" onClick={() => toast.info('Version History', c.id)}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#0369A1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="12 8 12 12 14 14" /><path d="M3.05 11a9 9 0 1 1 .5 4m-.5 5v-5h5" /></svg></ActBtn>
                            <ActBtn title="Agreement Timeline" color="#B45309" bg="#FEF3C7" border="#FCD34D" onClick={() => toast.info('Agreement Timeline', c.id)}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#B45309" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg></ActBtn>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 18px', background: 'linear-gradient(110deg,#F5F3FF,#EDE9FE)', borderTop: '1.5px solid #DDD6FE' }}>
                <span style={{ fontSize: 12, color: '#6D28D9', fontWeight: 500 }}>Showing <b style={{ color: '#2E1065', fontWeight: 800 }}>{start + 1}–{Math.min(start + PER_PAGE, list.length)}</b> of <b style={{ color: '#2E1065', fontWeight: 800 }}>{list.length}</b> contract{list.length !== 1 ? 's' : ''}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => {
                    const a = p === safe;
                    return <button key={p} onClick={() => setPage(p)} disabled={a} style={{ minWidth: 26, height: 26, padding: '0 6px', borderRadius: 7, border: `1.5px solid ${a ? '#6D28D9' : 'rgba(109,40,217,.18)'}`, background: a ? 'linear-gradient(135deg,#6D28D9,#7C3AED)' : 'rgba(245,243,255,.7)', color: a ? '#fff' : '#6D28D9', fontFamily: 'inherit', fontSize: 12, fontWeight: a ? 900 : 600, cursor: a ? 'default' : 'pointer' }}>{p}</button>;
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ActBtn({ title, color, bg, border, onClick, children }: { title: string; color: string; bg: string; border: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button title={title} onClick={onClick} style={{ width: 26, height: 26, borderRadius: 7, border: `1.5px solid ${border}`, background: bg, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color, opacity: .85, flexShrink: 0, transition: 'all .15s' }}
      onMouseEnter={e => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 3px 8px rgba(0,0,0,.15)'; }}
      onMouseLeave={e => { e.currentTarget.style.opacity = '.85'; e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = 'none'; }}>
      {children}
    </button>
  );
}

const TH = { padding: '7px 10px', fontSize: 7.5, fontWeight: 800, letterSpacing: '.11em', textTransform: 'uppercase', color: '#fff', whiteSpace: 'nowrap', background: '#6D28D9', borderBottom: 'none', textAlign: 'center' } as React.CSSProperties;
const TD = { padding: '7px 10px', verticalAlign: 'middle', borderBottom: '1px solid rgba(109,40,217,.06)', textAlign: 'center' } as React.CSSProperties;
const TDL = { ...TD, textAlign: 'left' } as React.CSSProperties;

const CTC_CSS = `
@keyframes ctcFade { from { opacity:0 } to { opacity:1 } }
`;
