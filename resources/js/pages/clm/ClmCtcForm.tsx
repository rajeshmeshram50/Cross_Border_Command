import { useEffect, useState } from 'react';
import { useToast } from '../../contexts/ToastContext';
import { pad2, type CtcContract } from './clmOpsData';
import { useOpsTheme, type OpsTokens } from './useOpsTheme';

/* ─────────────────────────────────────────────────────────────────────────
 * Case to Case Contracts → full-screen "Create / Edit CTC Agreement" form.
 *
 * Faithful violet-themed port of `_ctcFormHTML` from the prototype: a 4-stage
 * flow (Agreement Drafting → Internal Review → Counterparty Signing → Final
 * Repository) driven by a stage stepper. Stage 1 is the three-panel
 * workspace (Counterparty Details · Draft Workspace · Summary). Stages 2–4
 * render the styled review / signing / repository panels.
 * ───────────────────────────────────────────────────────────────────────── */

const ORGS = [
  { name: 'IGC - Aurentic',   sub: 'Aurentic · Group Entity',   initials: 'AU', grad: '#7C3AED,#4C1D95', industry: 'Financial Services', entityType: 'Group Holding',   jurisdiction: 'UAE · ADGM' },
  { name: 'IGC - Healthcare', sub: 'Healthcare · Group Entity', initials: 'HC', grad: '#0891b2,#0e7490', industry: 'Healthcare',         entityType: 'Operating Entity', jurisdiction: 'UAE · DHA' },
  { name: 'IGC - Agrotech',   sub: 'Agrotech · Group Entity',   initials: 'AG', grad: '#16a34a,#15803d', industry: 'Agri-Technology',     entityType: 'Subsidiary',       jurisdiction: 'UAE · DMCC' },
];

const CP_DIR: Record<'buyer' | 'supplier', { id: string; name: string; initials: string; country: string; phone: string; email: string; grad: string }[]> = {
  buyer: [
    { id: 'C-001', name: 'GreenHarvest Global Ltd', initials: 'GG', country: 'United States', phone: '+1-415-555-0123', email: 'james@gh.com',       grad: '#4F46E5,#7C3AED' },
    { id: 'C-002', name: 'Atlas Trading Co.',       initials: 'AT', country: 'United Kingdom', phone: '+44-20-7946-0958', email: 'info@atlas.co.uk',  grad: '#0891B2,#0E7490' },
    { id: 'C-003', name: 'Orient Foods Pvt Ltd',    initials: 'OF', country: 'India',          phone: '+91-98200-12345', email: 'ops@orientfoods.in', grad: '#059669,#047857' },
    { id: 'C-004', name: 'Sahara Imports DMCC',     initials: 'SI', country: 'UAE',            phone: '+971-4-321-0987', email: 'trade@sahara.ae',    grad: '#D97706,#B45309' },
  ],
  supplier: [
    { id: 'S-001', name: 'AgroSource International', initials: 'AS', country: 'Brazil',      phone: '+55-11-3456-7890', email: 'export@agrosource.br', grad: '#16A34A,#15803D' },
    { id: 'S-002', name: 'MedEquip Solutions GmbH', initials: 'MS', country: 'Germany',     phone: '+49-89-2345-6789', email: 'sales@medequip.de',    grad: '#0891B2,#0E7490' },
    { id: 'S-003', name: 'PrimePack Industries',    initials: 'PP', country: 'South Korea', phone: '+82-2-789-0123',   email: 'b2b@primepack.kr',     grad: '#7C3AED,#4C1D95' },
  ],
};

const STAGES = [
  { n: 1, label: 'Agreement Drafting',                 sub: 'Create or upload agreement draft' },
  { n: 2, label: 'Internal Review & Approval',         sub: 'Internal validation and approval workflow' },
  { n: 3, label: 'Counterparty Negotiation & Signing', sub: 'Negotiation, approval, and signing process' },
  { n: 4, label: 'Final Contract Repository',          sub: 'Store finalized signed agreement and history' },
];

type CP = { name: string; initials: string; country: string; phone: string; email: string; grad: string; badge: string; referred: string };

export default function ClmCtcForm({ editing, onClose, onSaved }: { editing: CtcContract | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const t = useOpsTheme('violet');
  const [stage, setStage] = useState(1);
  const [cp1, setCp1] = useState<CP | null>(null);
  const [cp2, setCp2] = useState<CP | null>(null);
  const [org, setOrg] = useState<typeof ORGS[number] | null>(null);
  const [orgOpen, setOrgOpen] = useState(false);
  const [picker, setPicker] = useState<1 | 2 | null>(null);
  const [agTitle, setAgTitle] = useState(editing?.title ?? '');
  const [agType, setAgType] = useState(editing?.type ?? '');
  const [effDate, setEffDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [draft, setDraft] = useState('');

  useEffect(() => { document.body.style.overflow = 'hidden'; return () => { document.body.style.overflow = ''; }; }, []);

  const goStage = (n: number) => setStage(n);

  const save = () => {
    if (!agTitle.trim()) { toast.error('Missing title', 'Enter an agreement title'); setStage(1); return; }
    toast.success(editing ? 'CTC updated' : 'CTC created', agTitle);
    onSaved();
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 500000, background: t.dark ? '#0d0a1a' : '#F0F0FA', overflowY: 'auto', fontFamily: "'Rubik', system-ui, sans-serif", WebkitFontSmoothing: 'antialiased' }}>
      <style>{CTC_FORM_CSS}</style>
      <div style={{ height: '100vh', background: t.dark ? '#0d0a1a' : '#F0F0F8', display: 'flex', flexDirection: 'column', padding: '16px 16px 0', gap: 10, overflow: 'hidden' }}>

        {/* HEADER */}
        <div style={{ borderRadius: 14, overflow: 'hidden', flexShrink: 0, boxShadow: '0 2px 12px rgba(109,40,217,.1)', border: `1.5px solid ${t.dark ? 'rgba(124,58,237,.35)' : 'rgba(124,58,237,.18)'}` }}>
          <div style={{ background: t.dark ? '#1c1438' : 'linear-gradient(110deg,#F5F3FF 0%,#EDE9FE 25%,#DDD6FE 55%,#C4B5FD 80%,#A78BFA 100%)', position: 'relative', overflow: 'hidden' }}>
            <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 5, background: 'linear-gradient(180deg,#A78BFA,#7C3AED,#5B21B6)' }} />
            <span style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '50%', background: 'linear-gradient(180deg,rgba(255,255,255,.5),transparent)', pointerEvents: 'none' }} />
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 20px', minHeight: 60, position: 'relative', zIndex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 40, height: 40, borderRadius: 11, background: 'linear-gradient(135deg,#8B5CF6,#7C3AED,#5B21B6)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 0 3px rgba(124,58,237,.2),0 4px 12px rgba(91,33,182,.4)', flexShrink: 0 }}>
                  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="8" y1="13" x2="16" y2="13" /><line x1="8" y1="17" x2="12" y2="17" /></svg>
                </div>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 500, color: t.dark ? '#c4b5fd' : '#2e1065', letterSpacing: '-.35px', lineHeight: 1.2 }}>{editing ? `Edit CTC Agreement — ${editing.id}` : 'Case-to-Case Contract'}</div>
                  <div style={{ fontSize: 11, fontWeight: 500, color: t.dark ? '#a78bfa' : '#5B21B6', marginTop: 2, opacity: .9 }}>Create one-time operational agreement with a counterparty</div>
                </div>
              </div>
              <button onClick={onClose} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 18px', border: 'none', borderRadius: 9, fontFamily: 'inherit', fontSize: 12, fontWeight: 700, color: '#fff', cursor: 'pointer', background: 'linear-gradient(135deg,#8B5CF6,#6D28D9,#5B21B6)', boxShadow: '0 3px 12px rgba(91,33,182,.38)' }}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
                Back to CTC Agreement List
              </button>
            </div>
          </div>
        </div>

        {/* STAGE FLOW */}
        <div style={{ borderRadius: 14, overflow: 'hidden', flexShrink: 0, background: t.surface, boxShadow: '0 2px 10px rgba(109,40,217,.07)', border: `1.5px solid ${t.dark ? 'rgba(124,58,237,.25)' : 'rgba(124,58,237,.12)'}` }}>
          <div style={{ padding: '10px 16px 12px' }}>
            <div style={{ display: 'flex', alignItems: 'stretch', justifyContent: 'space-between' }}>
              {STAGES.map((s, i) => {
                const active = s.n === stage, done = s.n < stage, isLast = i === STAGES.length - 1;
                const num = String(s.n).padStart(2, '0');
                return (
                  <div key={s.n} style={{ display: 'flex', alignItems: 'stretch', flex: 1, minWidth: 0 }}>
                    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                      <div onClick={() => goStage(s.n)} style={{
                        position: 'relative', overflow: 'hidden', cursor: 'pointer', height: '100%', padding: '11px 12px 10px', minHeight: 88, borderRadius: 10,
                        background: active ? 'linear-gradient(140deg,#5B21B6 0%,#6D28D9 45%,#7C3AED 100%)' : done ? (t.dark ? 'rgba(124,58,237,.14)' : 'linear-gradient(140deg,#EDE9FE 0%,#DDD6FE 100%)') : (t.dark ? 'rgba(255,255,255,.04)' : '#F0F1F8'),
                        border: active ? 'none' : done ? `1.5px solid ${t.dark ? 'rgba(124,58,237,.4)' : '#C4B5FD'}` : `1.5px solid ${t.dark ? 'rgba(148,163,184,.18)' : '#E2E4F0'}`,
                        boxShadow: active ? '0 6px 20px rgba(109,40,217,.35)' : done ? '0 2px 8px rgba(124,58,237,.1)' : '0 1px 4px rgba(15,23,42,.04)' }}>
                        {active && <span style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '45%', background: 'linear-gradient(180deg,rgba(255,255,255,.1),transparent)', pointerEvents: 'none', borderRadius: '10px 10px 0 0' }} />}
                        {active && <span style={{ position: 'absolute', top: 9, right: 10, display: 'flex', alignItems: 'center', gap: 4, background: 'rgba(255,255,255,.2)', border: '1px solid rgba(255,255,255,.32)', borderRadius: 20, padding: '2px 8px', fontSize: 7, fontWeight: 800, color: '#fff', letterSpacing: '.5px', textTransform: 'uppercase', zIndex: 2 }}><span style={{ width: 5, height: 5, borderRadius: '50%', background: '#34d399' }} />Active</span>}
                        {done && <span style={{ position: 'absolute', top: 9, right: 10, width: 17, height: 17, borderRadius: '50%', background: 'linear-gradient(135deg,#A78BFA,#7C3AED)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 6px rgba(124,58,237,.28)', zIndex: 2 }}><svg width="7" height="7" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12" /></svg></span>}
                        <div style={{ fontSize: 7.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.9px', lineHeight: 1, marginBottom: 6, color: active ? 'rgba(255,255,255,.55)' : done ? '#A78BFA' : (t.dark ? '#7c87a8' : '#A5AEC8') }}>STAGE {num}</div>
                        <div style={{ fontSize: 12, lineHeight: 1.3, marginBottom: 2, paddingRight: active || done ? 26 : 6, color: active ? '#fff' : done ? (t.dark ? '#c4b5fd' : '#5B21B6') : (t.dark ? t.textSub : '#5B6480'), fontWeight: active || done ? 800 : 700 }}>{s.label}</div>
                        <div style={{ fontSize: 9, fontWeight: 500, lineHeight: 1.4, color: active ? 'rgba(255,255,255,.62)' : done ? '#A78BFA' : (t.dark ? '#7c87a8' : '#A0AABE') }}>{s.sub}</div>
                        <div style={{ position: 'absolute', bottom: -12, right: 2, fontSize: 68, fontWeight: 900, lineHeight: 1, letterSpacing: -5, pointerEvents: 'none', userSelect: 'none', color: active ? 'rgba(255,255,255,.12)' : done ? 'rgba(124,58,237,.18)' : 'rgba(148,163,215,.2)' }}>{num}</div>
                      </div>
                    </div>
                    {!isLast && (
                      <div style={{ flexShrink: 0, width: 28, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <svg width="28" height="16" viewBox="0 0 28 16" fill="none"><line x1="0" y1="8" x2="20" y2="8" stroke={done || active ? '#C4B5FD' : '#D8DBE8'} strokeWidth="1.5" /><polygon points="20,4 28,8 20,12" fill={done || active ? '#A78BFA' : '#BEC3D8'} /></svg>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* STAGE BODY */}
        <div style={{ flex: 1, minHeight: 0, display: 'flex', overflow: 'hidden', paddingBottom: 16 }}>
          {stage === 1 && (
            <Stage1
              t={t}
              cp1={cp1} cp2={cp2} org={org} orgOpen={orgOpen} setOrgOpen={setOrgOpen}
              onAddCp={setPicker} onRemoveCp={(slot) => slot === 1 ? setCp1(null) : setCp2(null)}
              onSelectOrg={(o) => { setOrg(o); setOrgOpen(false); }} onResetOrg={() => setOrg(null)}
              agTitle={agTitle} setAgTitle={setAgTitle} agType={agType} setAgType={setAgType}
              effDate={effDate} setEffDate={setEffDate} endDate={endDate} setEndDate={setEndDate}
              draft={draft} setDraft={setDraft}
              onNext={() => goStage(2)}
            />
          )}
          {stage > 1 && <StageReview t={t} stage={stage} cp1={cp1} cp2={cp2} org={org} agTitle={agTitle} agType={agType} effDate={effDate} endDate={endDate} draft={draft} onBack={() => goStage(stage - 1)} onNext={() => goStage(stage + 1)} onSave={save} />}
        </div>
      </div>

      {picker && (
        <CpPicker t={t} slot={picker} onClose={() => setPicker(null)} onPick={(cp) => { if (picker === 1) setCp1(cp); else setCp2(cp); setPicker(null); }} />
      )}
    </div>
  );
}

/* ── Stage 1 three-panel workspace ── */
function Stage1(p: {
  t: OpsTokens;
  cp1: CP | null; cp2: CP | null; org: typeof ORGS[number] | null; orgOpen: boolean; setOrgOpen: (b: boolean) => void;
  onAddCp: (slot: 1 | 2) => void; onRemoveCp: (slot: 1 | 2) => void; onSelectOrg: (o: typeof ORGS[number]) => void; onResetOrg: () => void;
  agTitle: string; setAgTitle: (s: string) => void; agType: string; setAgType: (s: string) => void;
  effDate: string; setEffDate: (s: string) => void; endDate: string; setEndDate: (s: string) => void;
  draft: string; setDraft: (s: string) => void; onNext: () => void;
}) {
  const t = p.t;
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [midStep, setMidStep] = useState<1 | 2 | 3>(1);          // inner Step 01 / 02 / 03
  const [createdBy, setCreatedBy] = useState<'us' | 'cp'>('us');
  const [draftMode, setDraftMode] = useState<'draft' | 'upload'>('draft');
  const [renewal, setRenewal] = useState<'yes' | 'no'>('yes');
  const [renewalType, setRenewalType] = useState<'manual' | 'auto'>('manual');
  const [termNotice, setTermNotice] = useState('30');
  const ipt: React.CSSProperties = { width: '100%', height: 34, padding: '0 12px', border: `1.5px solid ${t.searchBorder}`, borderRadius: 9, fontSize: 11, fontFamily: 'inherit', color: t.text, outline: 'none', background: t.dark ? 'rgba(255,255,255,.04)' : '#fff', boxSizing: 'border-box' };
  const sel: React.CSSProperties = { ...ipt, cursor: 'pointer' };
  const MID_STEPS = [
    { n: 1, label: 'Counter Party Details', next: 'Next: Agreement Details' },
    { n: 2, label: 'Agreement Basic Details', next: 'Next: Draft Content' },
    { n: 3, label: 'Draft Agreement Content', next: 'Next: Internal Review' },
  ] as const;
  const midNext = () => { if (midStep < 3) setMidStep((midStep + 1) as 1 | 2 | 3); else p.onNext(); };
  const midBack = () => { if (midStep > 1) setMidStep((midStep - 1) as 1 | 2 | 3); };
  return (
    <div style={{ display: 'flex', alignItems: 'stretch', gap: 12, flex: 1, minHeight: 0, width: '100%' }}>
      {/* LEFT — Counterparty Details */}
      <div style={{ flex: leftOpen ? 2 : '0 0 48px', minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', transition: 'flex .25s cubic-bezier(.22,1,.36,1)' }}>
        {!leftOpen ? <CollapsedBar t={t} title="Counterparty Details" headGrad="#4C1D95,#6D28D9,#7C3AED,#8B5CF6,#A78BFA" dir="left" onExpand={() => setLeftOpen(true)} /> :
        <Panel t={t} header="Panel 01" title="Counterparty Details" headGrad="#4C1D95,#6D28D9,#7C3AED,#8B5CF6,#A78BFA" onCollapse={() => setLeftOpen(false)} collapseDir="left">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 12, overflowY: 'auto' }}>
            {([1, 2] as const).map(slot => {
              const cp = slot === 1 ? p.cp1 : p.cp2;
              return cp ? <CpCard key={slot} t={t} slot={slot} cp={cp} onRemove={() => p.onRemoveCp(slot)} />
                : <button key={slot} onClick={() => p.onAddCp(slot)} style={{ border: '1.5px dashed #C4B5FD', borderRadius: 10, width: '100%', padding: '10px 14px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, background: 'transparent', cursor: 'pointer', fontFamily: 'inherit' }}>
                  <div style={{ width: 18, height: 18, borderRadius: '50%', background: 'linear-gradient(135deg,#7C3AED,#A78BFA)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg></div>
                  <span style={{ fontSize: 9, fontWeight: 700, color: '#7C3AED' }}>Add Counter Party {slot}</span>
                </button>;
            })}
            {/* Org */}
            <div style={{ position: 'relative' }}>
              {!p.org ? (
                <div onClick={() => p.setOrgOpen(!p.orgOpen)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '7px 10px', borderRadius: 8, border: '1.5px dashed #C4B5FD', background: 'transparent', cursor: 'pointer' }}>
                  <div style={{ width: 15, height: 15, borderRadius: '50%', background: 'linear-gradient(135deg,#7C3AED,#A78BFA)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><svg width="7" height="7" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round"><rect x="2" y="7" width="20" height="14" rx="2" /><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" /></svg></div>
                  <span style={{ fontSize: 9, fontWeight: 700, color: '#7C3AED' }}>Select Organisation</span>
                  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#C4B5FD" strokeWidth="2.5" strokeLinecap="round" style={{ marginLeft: 'auto', transform: p.orgOpen ? 'rotate(180deg)' : 'none' }}><polyline points="6 9 12 15 18 9" /></svg>
                </div>
              ) : (
                <div style={{ borderRadius: 10, border: `1.5px solid ${t.dark ? 'rgba(124,58,237,.3)' : '#DDD6FE'}`, background: t.surface, overflow: 'hidden' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', background: t.dark ? 'rgba(124,58,237,.18)' : 'linear-gradient(110deg,#EDE9FE,#DDD6FE)' }}><span style={{ fontSize: 7.5, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', color: t.dark ? '#c4b5fd' : '#6D28D9' }}>Organisation</span></div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '8px 10px 6px' }}>
                    <div style={{ width: 32, height: 32, borderRadius: 9, background: `linear-gradient(135deg,${p.org.grad})`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: '0 3px 8px rgba(109,40,217,.3)' }}><span style={{ fontSize: 10, fontWeight: 800, color: '#fff' }}>{p.org.initials}</span></div>
                    <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 11, fontWeight: 800, color: t.textStrong, lineHeight: 1.3 }}>{p.org.name}</div><div style={{ fontSize: 8.5, color: t.dark ? '#a78bfa' : '#7C3AED', fontWeight: 500, marginTop: 2 }}>{p.org.sub}</div></div>
                    <button onClick={p.onResetOrg} style={{ width: 18, height: 18, borderRadius: '50%', background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.2)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><svg width="7" height="7" viewBox="0 0 24 24" fill="none" stroke="#EF4444" strokeWidth="3" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg></button>
                  </div>
                  <div style={{ borderTop: `1px solid ${t.dark ? 'rgba(148,163,184,.12)' : '#F1EEFF'}`, padding: '5px 10px 8px', display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <OrgDetail t={t} text={p.org.jurisdiction} /><OrgDetail t={t} text={p.org.entityType} /><OrgDetail t={t} text={p.org.industry} />
                  </div>
                </div>
              )}
              {p.orgOpen && !p.org && (
                <div style={{ position: 'absolute', bottom: '100%', left: 0, right: 0, marginBottom: 6, background: t.surface, border: `1.5px solid ${t.dark ? 'rgba(124,58,237,.3)' : '#DDD6FE'}`, borderRadius: 14, boxShadow: '0 12px 36px rgba(109,40,217,.18)', overflow: 'hidden', zIndex: 50, padding: 7 }}>
                  {ORGS.map(o => (
                    <div key={o.name} onClick={() => p.onSelectOrg(o)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px', borderRadius: 9, cursor: 'pointer', marginBottom: 2 }}
                      onMouseEnter={e => (e.currentTarget.style.background = t.dark ? 'rgba(124,58,237,.14)' : '#F5F3FF')} onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                      <div style={{ width: 32, height: 32, borderRadius: 9, background: `linear-gradient(135deg,${o.grad})`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><span style={{ fontSize: 9.5, fontWeight: 800, color: '#fff' }}>{o.initials}</span></div>
                      <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 11, fontWeight: 800, color: t.textStrong }}>{o.name}</div><div style={{ fontSize: 9, color: t.dark ? '#a78bfa' : '#9D76E0', fontWeight: 500, marginTop: 1 }}>{o.sub}</div></div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </Panel>}
      </div>

      {/* MIDDLE — Draft workspace */}
      <div style={{ flex: 5.5, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <Panel t={t} header="Panel 02 · Main Workspace" title="Agreement Draft Workspace" headGrad="#4C1D95,#6D28D9,#7C3AED,#8B5CF6,#A78BFA">
          <div className="ctc-mid-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '16px 18px 12px', display: 'flex', flexDirection: 'column', gap: 12 }}>

            {/* ── inner STEP stepper ── */}
            <div style={{ display: 'flex', alignItems: 'center', background: t.surface, borderRadius: 12, border: `1.5px solid ${t.dark ? 'rgba(124,58,237,.25)' : '#EDE9FE'}`, padding: '10px 14px', flexShrink: 0, boxShadow: '0 2px 10px rgba(109,40,217,.07)' }}>
              {MID_STEPS.map((s, i) => {
                const on = midStep === s.n, done = midStep > s.n;
                return (
                  <div key={s.n} style={{ display: 'flex', alignItems: 'center', flex: i < 2 ? 1 : '0 1 auto', minWidth: 0 }}>
                    <div onClick={() => setMidStep(s.n)} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', minWidth: 0 }}>
                      <div style={{ width: 32, height: 32, borderRadius: 10, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: on || done ? 'linear-gradient(135deg,#4F46E5,#7C3AED)' : (t.dark ? 'rgba(255,255,255,.05)' : '#F5F0FF'), border: on || done ? 'none' : `2px solid ${t.dark ? 'rgba(124,58,237,.3)' : '#DDD6FE'}`, boxShadow: on ? '0 3px 10px rgba(79,70,229,.4)' : 'none' }}>
                        <span style={{ fontSize: 11, fontWeight: 900, color: on || done ? '#fff' : (t.dark ? '#a78bfa' : '#C4B5FD') }}>{pad2(s.n)}</span>
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 6, fontWeight: 800, letterSpacing: '.1em', textTransform: 'uppercase', color: on || done ? (t.dark ? '#a78bfa' : '#A78BFA') : (t.dark ? '#7c87a8' : '#C4B5FD'), lineHeight: 1, marginBottom: 1 }}>Step {pad2(s.n)}</div>
                        <div style={{ fontSize: 8.5, fontWeight: on ? 800 : 700, color: on || done ? (t.dark ? '#c4b5fd' : '#4F46E5') : (t.dark ? '#7c87a8' : '#C4B5FD'), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1.2 }}>{s.label}</div>
                      </div>
                    </div>
                    {i < 2 && <div style={{ flex: 1, height: 2, margin: '0 8px', borderRadius: 2, background: done ? 'linear-gradient(90deg,#7C3AED,#DDD6FE)' : (t.dark ? 'rgba(148,163,184,.15)' : '#EDE9FE') }} />}
                  </div>
                );
              })}
            </div>

            {/* ══ STEP 1 — Counter Parties (read only) ══ */}
            {midStep === 1 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <SectionBar t={t} label="Counter Parties" readOnly />
                {!p.cp1 && !p.cp2 ? (
                  <ReadEmpty t={t} title="No Counterparties Added Yet" sub="Add Counter Parties from the left panel to see their details here."
                    chips={[`CP 1 — ${p.cp1 ? 'Added' : 'Not Added'}`, `CP 2 — ${p.cp2 ? 'Added' : 'Not Added'}`, `Org — ${p.org ? 'Selected' : 'Not Selected'}`]} />
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    {p.cp1 && <CpReadCard t={t} idx={1} cp={p.cp1} />}
                    {p.cp2 && <CpReadCard t={t} idx={2} cp={p.cp2} />}
                  </div>
                )}
                <SectionBar t={t} label="Our Organisation" readOnly />
                {!p.org ? (
                  <ReadEmpty t={t} title="Organisation not selected" sub="Please select your organisation from the left panel." chips={[]} />
                ) : (
                  <div style={{ borderRadius: 14, overflow: 'hidden', border: `1.5px solid ${t.dark ? 'rgba(124,58,237,.25)' : '#EDE9FE'}`, background: t.surface, boxShadow: '0 4px 16px rgba(109,40,217,.08)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', background: `linear-gradient(118deg,${p.org.grad})` }}>
                      <div style={{ width: 40, height: 40, borderRadius: 11, background: 'rgba(255,255,255,.2)', border: '1.5px solid rgba(255,255,255,.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><span style={{ fontSize: 13, fontWeight: 800, color: '#fff' }}>{p.org.initials}</span></div>
                      <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 13.5, fontWeight: 800, color: '#fff' }}>{p.org.name}</div><div style={{ fontSize: 9.5, color: 'rgba(255,255,255,.7)', fontWeight: 500 }}>{p.org.sub}</div></div>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 20, background: 'rgba(255,255,255,.18)', border: '1px solid rgba(255,255,255,.3)' }}><span style={{ width: 6, height: 6, borderRadius: '50%', background: '#34d399' }} /><span style={{ fontSize: 9, fontWeight: 800, color: '#fff' }}>Active</span></span>
                    </div>
                    <div style={{ padding: '10px 16px', display: 'flex', flexWrap: 'wrap', gap: 16 }}>
                      {[['Jurisdiction', p.org.jurisdiction], ['Entity Type', p.org.entityType], ['Industry', p.org.industry]].map(([k, v]) => (
                        <div key={k}><div style={{ fontSize: 7.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.08em', color: t.textMuted, marginBottom: 2 }}>{k}</div><div style={{ fontSize: 11.5, fontWeight: 700, color: t.text }}>{v}</div></div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ══ STEP 2 — Agreement Basic Details ══ */}
            {midStep === 2 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {/* Agreement Basics */}
                <div style={{ background: t.surface, borderRadius: 14, border: `1.5px solid ${t.dark ? 'rgba(124,58,237,.25)' : '#EDE9FE'}`, overflow: 'hidden', boxShadow: '0 2px 12px rgba(109,40,217,.06)' }}>
                  <div style={{ padding: '11px 14px', background: t.dark ? 'rgba(124,58,237,.14)' : 'linear-gradient(110deg,#EDE9FE 0%,#F3F0FF 40%,#E8E2FF 100%)', borderBottom: `1.5px solid ${t.dark ? 'rgba(124,58,237,.25)' : '#DDD6FE'}`, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 28, height: 28, borderRadius: 8, background: 'linear-gradient(135deg,#7C3AED,#5B21B6)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg></div>
                    <div><div style={{ fontSize: 11.5, fontWeight: 800, color: t.dark ? '#ddd6fe' : '#3B0764' }}>Agreement Basics</div><div style={{ fontSize: 8, color: t.dark ? '#a78bfa' : '#7C3AED', fontWeight: 500 }}>Title &amp; type of this contract</div></div>
                  </div>
                  <div style={{ padding: '10px 14px', display: 'grid', gridTemplateColumns: '3fr 2fr', gap: 9, alignItems: 'end' }}>
                    <Field t={t} label="Agreement Title *"><input value={p.agTitle} onChange={e => p.setAgTitle(e.target.value)} placeholder="e.g. Supply Agreement — GreenHarvest × AgroSource" style={ipt} /></Field>
                    <Field t={t} label="Agreement Type *">
                      <select value={p.agType} onChange={e => p.setAgType(e.target.value)} style={sel}>
                        <option value="">Select type…</option>
                        {['NDA', 'SLA', 'MSA', 'CSA', 'VPA', 'DA', 'JVA', 'EAA', 'MOU', 'TTA', 'PFA', 'NCA'].map(o => <option key={o}>{o}</option>)}
                      </select>
                    </Field>
                  </div>
                </div>

                {/* Agreement Created By */}
                <div style={{ background: t.surface, borderRadius: 14, border: `1.5px solid ${t.dark ? 'rgba(124,58,237,.25)' : '#EDE9FE'}`, overflow: 'hidden', boxShadow: '0 2px 12px rgba(109,40,217,.06)' }}>
                  <div style={{ padding: '11px 14px', background: t.dark ? 'rgba(124,58,237,.14)' : 'linear-gradient(110deg,#EDE9FE 0%,#F3F0FF 40%,#E8E2FF 100%)', borderBottom: `1.5px solid ${t.dark ? 'rgba(124,58,237,.25)' : '#DDD6FE'}`, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 28, height: 28, borderRadius: 8, background: 'linear-gradient(135deg,#7C3AED,#5B21B6)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round"><circle cx="9" cy="7" r="4" /><path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2" /><path d="M19 8v6M16 11h6" /></svg></div>
                    <div><div style={{ fontSize: 11.5, fontWeight: 800, color: t.dark ? '#ddd6fe' : '#3B0764' }}>Agreement Created By</div><div style={{ fontSize: 8, color: t.dark ? '#a78bfa' : '#7C3AED', fontWeight: 500 }}>Who initiates the draft</div></div>
                  </div>
                  <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                      <BigChoice t={t} sel={createdBy === 'us'} onClick={() => setCreatedBy('us')} title="Created By Us" sub="We draft & own the agreement" tag="Internal draft"
                        icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round"><rect x="2" y="7" width="20" height="14" rx="2" /><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" /></svg>} />
                      <BigChoice t={t} sel={createdBy === 'cp'} onClick={() => setCreatedBy('cp')} title="By Counterparty" sub="They send the draft to us" tag="External draft"
                        icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /></svg>} />
                    </div>
                    {createdBy === 'us' ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                        <MiniLabel t={t}>How would you like to proceed?</MiniLabel>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7 }}>
                          <BigChoice t={t} sel={draftMode === 'draft'} onClick={() => setDraftMode('draft')} title="Draft Manually" sub="Write in editor →"
                            icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4z" /></svg>} />
                          <BigChoice t={t} sel={draftMode === 'upload'} onClick={() => setDraftMode('upload')} title="Upload File" sub="Upload internal draft"
                            icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>} />
                        </div>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                        <MiniLabel t={t}>Upload Counterparty Draft</MiniLabel>
                        <div style={{ border: `2px dashed ${t.dark ? 'rgba(124,58,237,.4)' : '#C4B5FD'}`, borderRadius: 12, padding: '18px 16px', textAlign: 'center', background: t.dark ? 'rgba(124,58,237,.06)' : 'linear-gradient(135deg,#FAFBFF,#F5F0FF)' }}>
                          <div style={{ width: 38, height: 38, borderRadius: 11, background: 'linear-gradient(135deg,#7C3AED,#5B21B6)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 9px' }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg></div>
                          <div style={{ fontSize: 10, fontWeight: 800, color: t.dark ? '#ddd6fe' : '#3B0764', marginBottom: 3 }}>Drop counterparty draft here</div>
                          <div style={{ fontSize: 8, color: t.textMuted, marginBottom: 10, fontWeight: 500 }}>PDF, DOCX supported · Max 25MB</div>
                          <span style={{ padding: '5px 16px', borderRadius: 8, background: 'linear-gradient(135deg,#7C3AED,#5B21B6)', fontSize: 9, fontWeight: 700, color: '#fff' }}>Browse Files</span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Agreement Details */}
                <div style={{ background: t.surface, borderRadius: 14, border: `1.5px solid ${t.dark ? 'rgba(16,185,129,.3)' : '#BBF7D0'}`, overflow: 'hidden', boxShadow: '0 2px 12px rgba(109,40,217,.06)' }}>
                  <div style={{ padding: '11px 14px', background: t.dark ? 'rgba(16,185,129,.12)' : 'linear-gradient(110deg,#ECFDF5 0%,#F0FDF9 40%,#D1FAE5 100%)', borderBottom: `1.5px solid ${t.dark ? 'rgba(16,185,129,.25)' : '#A7F3D0'}`, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 28, height: 28, borderRadius: 8, background: 'linear-gradient(135deg,#059669,#047857)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round"><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg></div>
                    <div><div style={{ fontSize: 11.5, fontWeight: 800, color: t.dark ? '#6ee7b7' : '#064E3B' }}>Agreement Details</div><div style={{ fontSize: 8, color: t.dark ? '#34d399' : '#059669', fontWeight: 500 }}>Dates, renewal &amp; termination terms</div></div>
                  </div>
                  <div style={{ padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, alignItems: 'end' }}>
                      <Field t={t} label="Effective Date *" green><input type="date" value={p.effDate} onChange={e => p.setEffDate(e.target.value)} style={{ ...ipt, borderColor: t.dark ? 'rgba(16,185,129,.35)' : '#A7F3D0' }} /></Field>
                      <Field t={t} label="End Date *" green><input type="date" value={p.endDate} onChange={e => p.setEndDate(e.target.value)} style={{ ...ipt, borderColor: t.dark ? 'rgba(16,185,129,.35)' : '#A7F3D0' }} /></Field>
                      <Field t={t} label="Termination Notice" green>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <input type="number" min="1" value={termNotice} onChange={e => setTermNotice(e.target.value)} style={{ ...ipt, borderColor: t.dark ? 'rgba(16,185,129,.35)' : '#A7F3D0', width: 60, textAlign: 'center', padding: '0 6px' }} />
                          <span style={{ fontSize: 10, color: t.textSub, fontWeight: 600 }}>days</span>
                        </div>
                      </Field>
                    </div>
                    <div>
                      <MiniLabel t={t} green>Auto Renewal</MiniLabel>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7, marginTop: 4 }}>
                        <GreenChoice t={t} sel={renewal === 'yes'} onClick={() => setRenewal('yes')} title="Yes" sub="Contract renews automatically"
                          icon={<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round"><polyline points="20 6 9 17 4 12" /></svg>} />
                        <GreenChoice t={t} sel={renewal === 'no'} onClick={() => setRenewal('no')} title="No" sub="Contract expires on end date"
                          icon={<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>} />
                      </div>
                    </div>
                    {renewal === 'yes' && (
                      <div>
                        <MiniLabel t={t} green>Renewal Schedule</MiniLabel>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7, marginTop: 4 }}>
                          <GreenChoice t={t} sel={renewalType === 'manual'} onClick={() => setRenewalType('manual')} title="Manual Renewal" sub="Renewed by team action"
                            icon={<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><polyline points="20 8 20 14" /><line x1="17" y1="11" x2="23" y2="11" /></svg>} />
                          <GreenChoice t={t} sel={renewalType === 'auto'} onClick={() => setRenewalType('auto')} title="Auto Renewal" sub="Renews automatically"
                            icon={<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round"><path d="M23 4v6h-6" /><path d="M1 20v-6h6" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" /></svg>} />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* ══ STEP 3 — Draft Agreement Content ══ */}
            {midStep === 3 && (
              <div style={{ background: t.surface, borderRadius: 14, border: `1.5px solid ${t.dark ? 'rgba(124,58,237,.25)' : '#EDE9FE'}`, overflow: 'hidden', boxShadow: '0 2px 12px rgba(109,40,217,.08)' }}>
                <div style={{ padding: '12px 14px', background: 'linear-gradient(118deg,#3B0764 0%,#5B21B6 35%,#7C3AED 65%,#8B5CF6 100%)', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 30, height: 30, borderRadius: 9, background: 'rgba(255,255,255,.18)', border: '1.5px solid rgba(255,255,255,.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4z" /></svg></div>
                  <div><div style={{ fontSize: 7, fontWeight: 800, letterSpacing: '.15em', textTransform: 'uppercase', color: 'rgba(255,255,255,.6)' }}>Step 03</div><div style={{ fontSize: 12.5, fontWeight: 800, color: '#fff' }}>Draft Agreement Content</div></div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 2, padding: '6px 10px', borderBottom: `1px solid ${t.dark ? 'rgba(124,58,237,.18)' : '#F1EEFF'}`, background: t.dark ? 'rgba(255,255,255,.02)' : '#FAFBFF', flexWrap: 'wrap' }}>
                  {['B', 'I', 'U', 'S'].map(b => <button key={b} style={{ width: 24, height: 24, borderRadius: 5, border: 'none', background: 'none', cursor: 'pointer', fontSize: 11, fontWeight: b === 'B' ? 900 : 600, fontStyle: b === 'I' ? 'italic' : 'normal', textDecoration: b === 'U' ? 'underline' : b === 'S' ? 'line-through' : 'none', color: t.dark ? '#c4b5fd' : '#4C1D95', fontFamily: 'Georgia, serif' }}>{b}</button>)}
                  <span style={{ width: 1, height: 16, background: t.dark ? 'rgba(124,58,237,.25)' : '#DDD6FE', margin: '0 4px' }} />
                  <span style={{ fontSize: 8.5, color: t.textMuted, fontStyle: 'italic' }}>Placeholders auto-fill on generation</span>
                  <span style={{ marginLeft: 'auto', fontSize: 8, fontWeight: 700, color: t.dark ? '#a78bfa' : '#C4B5FD', letterSpacing: '.05em' }}>{'{{PLACEHOLDER}}'}</span>
                </div>
                <textarea value={p.draft} onChange={e => p.setDraft(e.target.value)} placeholder="Start drafting your agreement content here…&#10;&#10;This Agreement is entered into between [Counter Party 1] and [Counter Party 2]…" style={{ width: '100%', minHeight: 200, padding: '14px 16px', border: 'none', outline: 'none', fontSize: 11, fontFamily: 'inherit', color: t.text, lineHeight: 1.8, resize: 'vertical', background: t.surface, boxSizing: 'border-box' }} />
              </div>
            )}
          </div>

          {/* sticky footer nav */}
          <div style={{ flexShrink: 0, padding: '10px 18px', borderTop: `1px solid ${t.dark ? 'rgba(124,58,237,.2)' : '#EDE9FE'}`, background: t.dark ? 'rgba(255,255,255,.03)' : 'rgba(255,255,255,.85)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            {midStep > 1 ? (
              <button onClick={midBack} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '7px 14px', borderRadius: 8, background: t.dark ? 'rgba(124,58,237,.16)' : '#F8F6FF', border: `1.5px solid ${t.dark ? 'rgba(124,58,237,.3)' : '#DDD6FE'}`, cursor: 'pointer', fontFamily: 'inherit' }}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={t.dark ? '#c4b5fd' : '#7C3AED'} strokeWidth="2.8" strokeLinecap="round"><polyline points="15 18 9 12 15 6" /></svg>
                <span style={{ fontSize: 9, fontWeight: 700, color: t.dark ? '#c4b5fd' : '#7C3AED' }}>Back</span>
              </button>
            ) : <span />}
            <button onClick={midNext} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 9, background: 'linear-gradient(135deg,#4F46E5,#7C3AED)', border: 'none', cursor: 'pointer', fontFamily: 'inherit', boxShadow: '0 3px 10px rgba(79,70,229,.35)' }}>
              <span style={{ fontSize: 9.5, fontWeight: 700, color: '#fff' }}>{MID_STEPS[midStep - 1].next}</span>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.8" strokeLinecap="round"><polyline points="9 18 15 12 9 6" /></svg>
            </button>
          </div>
        </Panel>
      </div>

      {/* RIGHT — Summary */}
      <div style={{ flex: rightOpen ? 2.5 : '0 0 48px', minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', transition: 'flex .25s cubic-bezier(.22,1,.36,1)' }}>
        {!rightOpen ? <CollapsedBar t={t} title="Agreement Summary Details" headGrad="#6D28D9,#7C3AED,#8B5CF6,#A78BFA,#C4B5FD" dir="right" onExpand={() => setRightOpen(true)} /> :
        <Panel t={t} header="Panel 03" title="Agreement Summary Details" headGrad="#6D28D9,#7C3AED,#8B5CF6,#A78BFA,#C4B5FD" onCollapse={() => setRightOpen(false)} collapseDir="right">
          <RightTools t={t} draft={p.draft} onInsert={(tok) => p.setDraft((p.draft ? p.draft + ' ' : '') + tok)} summary={[['Agreement', p.agTitle || '—'], ['Type', p.agType || '—'], ['Eff. Date', p.effDate || '—'], ['End Date', p.endDate || '—'], ['CP 1', p.cp1?.name || '—'], ['CP 2', p.cp2?.name || '—'], ['Organisation', p.org?.name || '—']]} />
        </Panel>}
      </div>
    </div>
  );
}

/* ── Stages 2–4: shared LEFT (read-only counterparty) + RIGHT (review) panels, changing MIDDLE ── */
function StageReview({ t, stage, cp1, cp2, org, agTitle, agType, effDate, endDate, draft, onBack, onNext, onSave }: {
  t: OpsTokens; stage: number; cp1: CP | null; cp2: CP | null; org: typeof ORGS[number] | null; agTitle: string; agType: string; effDate: string; endDate: string; draft: string;
  onBack: () => void; onNext: () => void; onSave: () => void;
}) {
  const MID = {
    2: { head: '#3B0764,#5B21B6,#7C3AED,#8B5CF6', sup: 'Panel 02 · Agreement Preview', title: 'Agreement Preview' },
    3: { head: '#0e7490,#0891b2,#06b6d4', sup: 'Panel 02 · Negotiation & Signing', title: 'Counterparty Negotiation & Signing' },
    4: { head: '#064E3B,#059669,#10B981', sup: 'Panel 02 · Signed Agreement', title: 'Final Contract Repository' },
  }[stage]!;
  const summary: [string, string][] = [['Agreement', agTitle || 'Agreement Draft'], ['Type', agType || '—'], ['Eff. Date', effDate || '—'], ['End Date', endDate || '—'], ['Renewable', 'No'], ['Term', '30 days']];

  return (
    <div style={{ display: 'flex', alignItems: 'stretch', gap: 12, flex: 1, minHeight: 0, width: '100%' }}>

      {/* LEFT — Counterparty Details (read only) */}
      <div style={{ flex: 2, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{ flex: 1, minHeight: 0, background: t.dark ? '#161226' : 'linear-gradient(160deg,#faf8ff,#f3effe 50%,#ede8fd)', borderRadius: 16, border: `1.5px solid ${t.dark ? 'rgba(139,92,246,.3)' : 'rgba(139,92,246,.22)'}`, boxShadow: '0 4px 20px rgba(109,40,217,.1)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: '11px 14px', background: 'linear-gradient(118deg,#4C1D95,#6D28D9,#7C3AED,#8B5CF6)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 28, height: 28, borderRadius: 8, background: 'rgba(255,255,255,.18)', border: '1.5px solid rgba(255,255,255,.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /></svg></div>
              <div><div style={{ fontSize: 7, fontWeight: 700, color: 'rgba(255,255,255,.6)', letterSpacing: '.12em', textTransform: 'uppercase' }}>Panel 01</div><div style={{ fontSize: 11, fontWeight: 800, color: '#fff' }}>Counterparty Details</div></div>
            </div>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px', borderRadius: 20, background: 'rgba(255,255,255,.15)', border: '1px solid rgba(255,255,255,.25)' }}><svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.8)" strokeWidth="2.2" strokeLinecap="round"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg><span style={{ fontSize: 7.5, fontWeight: 700, color: 'rgba(255,255,255,.85)' }}>Read Only</span></span>
          </div>
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {cp1 && <CpReadCard t={t} idx={1} cp={cp1} />}
            {cp2 && <CpReadCard t={t} idx={2} cp={cp2} />}
            {org && (
              <div style={{ borderRadius: 12, overflow: 'hidden', border: `1.5px solid ${t.dark ? 'rgba(124,58,237,.25)' : '#EDE9FE'}`, background: t.surface }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '10px 12px', background: `linear-gradient(118deg,${org.grad})` }}>
                  <div style={{ width: 32, height: 32, borderRadius: 9, background: 'rgba(255,255,255,.2)', border: '1.5px solid rgba(255,255,255,.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><span style={{ fontSize: 11, fontWeight: 800, color: '#fff' }}>{org.initials}</span></div>
                  <div style={{ minWidth: 0, flex: 1 }}><div style={{ fontSize: 8, fontWeight: 800, color: 'rgba(255,255,255,.7)', textTransform: 'uppercase', letterSpacing: '.08em' }}>Our Organisation</div><div style={{ fontSize: 12, fontWeight: 800, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{org.name}</div></div>
                </div>
                <div style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {[org.jurisdiction, org.entityType, org.industry].map((v, i) => <div key={i} style={{ fontSize: 9.5, color: t.textSub, fontWeight: 500 }}>{v}</div>)}
                </div>
              </div>
            )}
            {!cp1 && !cp2 && !org && <div style={{ fontSize: 10, color: t.textMuted, textAlign: 'center', padding: 20 }}>No counterparty details captured.</div>}
          </div>
        </div>
      </div>

      {/* MIDDLE — changes per stage */}
      <div style={{ flex: 5.5, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{ flex: 1, minHeight: 0, background: t.surface, borderRadius: 16, border: `1.5px solid ${stage === 4 ? 'rgba(5,150,105,.25)' : (t.dark ? 'rgba(124,58,237,.25)' : 'rgba(124,58,237,.18)')}`, boxShadow: '0 4px 20px rgba(109,40,217,.08)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: '11px 16px', background: `linear-gradient(118deg,${MID.head})`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
              <div style={{ width: 28, height: 28, borderRadius: 8, background: 'rgba(255,255,255,.18)', border: '1.5px solid rgba(255,255,255,.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg></div>
              <div><div style={{ fontSize: 7, fontWeight: 700, color: 'rgba(255,255,255,.6)', letterSpacing: '.12em', textTransform: 'uppercase' }}>{MID.sup}</div><div style={{ fontSize: 12, fontWeight: 800, color: '#fff' }}>{MID.title}</div></div>
            </div>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 9px', borderRadius: 20, background: 'rgba(255,255,255,.15)', border: '1px solid rgba(255,255,255,.25)', cursor: 'pointer' }}><svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.9)" strokeWidth="2.2" strokeLinecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg><span style={{ fontSize: 7.5, fontWeight: 700, color: 'rgba(255,255,255,.9)' }}>Download</span></span>
          </div>
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', background: t.dark ? '#100c1c' : '#F0EFF8', padding: '18px 24px' }}>
            <div style={{ maxWidth: 600, margin: '0 auto', background: t.dark ? '#1a1530' : '#fff', borderRadius: 6, boxShadow: '0 2px 12px rgba(0,0,0,.1)', padding: '36px 40px', position: 'relative' }}>
              <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 5, background: stage === 4 ? 'linear-gradient(90deg,#047857,#059669,#10B981)' : 'linear-gradient(90deg,#4C1D95,#7C3AED,#A78BFA)', borderRadius: '6px 6px 0 0' }} />
              <div style={{ textAlign: 'center', marginBottom: 22 }}>
                <span style={{ display: 'inline-block', padding: '3px 12px', borderRadius: 20, background: t.dark ? 'rgba(124,58,237,.2)' : 'linear-gradient(135deg,#EDE9FE,#DDD6FE)', border: `1px solid ${t.dark ? 'rgba(124,58,237,.4)' : '#C4B5FD'}`, marginBottom: 8 }}><span style={{ fontSize: 8, fontWeight: 800, color: t.dark ? '#c4b5fd' : '#6D28D9', letterSpacing: '.15em' }}>CTC-001</span></span>
                <div style={{ fontSize: 18, fontWeight: 900, color: t.textStrong, letterSpacing: '-.4px', marginBottom: 4, textTransform: 'uppercase' }}>{agTitle || 'Agreement Draft'}</div>
                <div style={{ fontSize: 9.5, color: t.textMuted, fontWeight: 500, marginBottom: 10 }}>({agType || 'Mutual Non-Disclosure & Confidentiality Agreement'})</div>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 14px', borderRadius: 8, background: t.dark ? 'rgba(255,255,255,.03)' : '#FAFBFF', border: `1px solid ${t.dark ? 'rgba(124,58,237,.2)' : '#EDE9FE'}` }}><span style={{ fontSize: 9, color: t.textSub, fontWeight: 500 }}>Entered into as of <span style={{ color: t.dark ? '#c4b5fd' : '#7C3AED', fontWeight: 700, background: t.dark ? 'rgba(124,58,237,.18)' : '#EDE9FE', padding: '1px 7px', borderRadius: 4 }}>{effDate || '—'}</span></span></div>
              </div>
              <div style={{ height: 1, background: t.dark ? 'rgba(148,163,184,.15)' : 'linear-gradient(90deg,transparent,#DDD6FE 30%,#DDD6FE 70%,transparent)', marginBottom: 20 }} />
              <div style={{ fontSize: 10, fontWeight: 800, color: t.dark ? '#c4b5fd' : '#4C1D95', letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 10, textAlign: 'center' }}>Parties</div>
              {[['Disclosing Party', cp1?.referred || cp1?.name || '{{party_1_name}}', '#7C3AED'], ['Receiving Party', cp2?.referred || cp2?.name || org?.name || '{{party_2_name}}', '#A78BFA']].map(([role, name, clr], i) => (
                <div key={i}>
                  {i === 1 && <div style={{ textAlign: 'center', fontSize: 10, fontWeight: 700, color: '#A78BFA', margin: '6px 0' }}>— AND —</div>}
                  <div style={{ borderLeft: `3px solid ${clr}`, padding: '10px 14px', borderRadius: '0 8px 8px 0', background: t.dark ? 'rgba(124,58,237,.07)' : 'linear-gradient(135deg,#FAFBFF,#F5F0FF)', marginBottom: 10 }}>
                    <div style={{ fontSize: 8, fontWeight: 800, color: clr, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: 4 }}>{role}</div>
                    <div style={{ fontSize: 11, fontWeight: 800, color: t.textStrong }}>{name}</div>
                    <div style={{ fontSize: 8.5, color: t.textMuted, marginTop: 2 }}>hereinafter referred to as the <strong>"{role}"</strong></div>
                  </div>
                </div>
              ))}
              <div style={{ fontSize: 10, color: t.textSub, lineHeight: 1.7, marginTop: 10, whiteSpace: 'pre-wrap' }}>{draft || 'Each party may be referred to individually as a "Party" and collectively as the "Parties". The Parties wish to explore a potential business relationship relating to {{business_purpose}} (the "Purpose").'}</div>
            </div>
          </div>
          {/* footer nav */}
          <div style={{ flexShrink: 0, padding: '10px 16px', background: t.surface, borderTop: `1.5px solid ${t.dark ? 'rgba(124,58,237,.2)' : '#EDE9FE'}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <button onClick={onBack} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 9, background: t.dark ? 'rgba(124,58,237,.16)' : '#F5F0FF', border: `1.5px solid ${t.dark ? 'rgba(124,58,237,.3)' : '#DDD6FE'}`, cursor: 'pointer', fontFamily: 'inherit', fontSize: 9.5, fontWeight: 700, color: t.dark ? '#c4b5fd' : '#6D28D9' }}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={t.dark ? '#c4b5fd' : '#6D28D9'} strokeWidth="2.5" strokeLinecap="round"><polyline points="15 18 9 12 15 6" /></svg> Previous Stage
            </button>
            {stage < 4
              ? <button onClick={onNext} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 18px', borderRadius: 9, background: 'linear-gradient(135deg,#4C1D95,#6D28D9,#7C3AED)', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 9.5, fontWeight: 800, color: '#fff', boxShadow: '0 3px 10px rgba(109,40,217,.35)' }}>Next Stage <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round"><polyline points="9 18 15 12 9 6" /></svg></button>
              : <button onClick={onSave} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 18px', borderRadius: 9, background: 'linear-gradient(135deg,#059669,#047857)', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 9.5, fontWeight: 800, color: '#fff', boxShadow: '0 3px 10px rgba(5,150,105,.35)' }}><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12" /></svg> Store in Repository</button>}
          </div>
        </div>
      </div>

      {/* RIGHT — Internal Review & Approval (shared) */}
      <div style={{ flex: 2.5, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{ flex: 1, minHeight: 0, background: t.dark ? '#161226' : 'linear-gradient(160deg,#faf8ff,#f3effe 40%,#ede8fd)', borderRadius: 16, border: `1.5px solid ${t.dark ? 'rgba(167,139,250,.3)' : 'rgba(167,139,250,.28)'}`, boxShadow: '0 4px 24px rgba(109,40,217,.1)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: '11px 14px', background: 'linear-gradient(118deg,#6D28D9,#7C3AED,#8B5CF6,#A78BFA)', display: 'flex', alignItems: 'center', gap: 9, flexShrink: 0 }}>
            <div style={{ width: 28, height: 28, borderRadius: 8, background: 'rgba(255,255,255,.18)', border: '1.5px solid rgba(255,255,255,.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"><polyline points="9 11 12 14 22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg></div>
            <div><div style={{ fontSize: 7, fontWeight: 700, color: 'rgba(255,255,255,.6)', letterSpacing: '.12em', textTransform: 'uppercase' }}>Panel 03</div><div style={{ fontSize: 12, fontWeight: 800, color: '#fff' }}>{stage === 4 ? 'Repository Record' : stage === 3 ? 'Negotiation Status' : 'Internal Review & Approval'}</div></div>
          </div>
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '10px 12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {/* Version History trigger */}
            <button style={{ width: '100%', padding: '9px 12px', borderRadius: 11, border: `1.5px solid ${t.dark ? 'rgba(124,58,237,.3)' : '#DDD6FE'}`, background: t.surface, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <div style={{ width: 26, height: 26, borderRadius: 8, background: 'linear-gradient(135deg,#7C3AED,#5B21B6)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"><polyline points="12 8 12 12 14 14" /><path d="M3.05 11a9 9 0 1 1 .5 4m-.5 5v-5h5" /></svg></div>
                <div style={{ textAlign: 'left' }}><div style={{ fontSize: 9, fontWeight: 800, color: t.dark ? '#ddd6fe' : '#3B0764' }}>Version History</div><div style={{ fontSize: 7.5, color: t.dark ? '#a78bfa' : '#A78BFA', marginTop: 1 }}>View all drafts &amp; revisions</div></div>
              </div>
              <span style={{ padding: '2px 8px', borderRadius: 10, background: 'linear-gradient(135deg,#7C3AED,#5B21B6)', fontSize: 7.5, fontWeight: 800, color: '#fff' }}>v{stage + 1}</span>
            </button>
            {/* Agreement summary */}
            <div style={{ borderRadius: 11, border: `1.5px solid ${t.dark ? 'rgba(124,58,237,.25)' : '#EDE9FE'}`, background: t.surface }}>
              <div style={{ padding: '6px 10px', background: t.dark ? 'rgba(124,58,237,.14)' : 'linear-gradient(110deg,#EDE9FE,#F3F0FF)', borderBottom: `1px solid ${t.dark ? 'rgba(124,58,237,.25)' : '#DDD6FE'}`, display: 'flex', justifyContent: 'space-between' }}><span style={{ fontSize: 7, fontWeight: 800, color: t.dark ? '#c4b5fd' : '#6D28D9', letterSpacing: '.1em', textTransform: 'uppercase' }}>Agreement Summary</span><span style={{ fontSize: 7, color: t.dark ? '#a78bfa' : '#A78BFA', fontWeight: 600 }}>CTC-001</span></div>
              <div style={{ padding: '8px 10px 4px' }}>{summary.map(([k, v]) => (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 6, padding: '4px 0', borderBottom: `1px solid ${t.dark ? 'rgba(148,163,184,.1)' : '#FAF8FF'}` }}><span style={{ fontSize: 7.5, fontWeight: 700, color: t.textMuted, textTransform: 'uppercase', letterSpacing: '.06em' }}>{k}</span><span style={{ fontSize: 8.5, fontWeight: 700, color: t.textStrong, textAlign: 'right' }}>{v}</span></div>
              ))}</div>
            </div>
            {/* Approvers & review status */}
            <div style={{ borderRadius: 11, border: `1.5px solid ${t.dark ? 'rgba(124,58,237,.25)' : '#EDE9FE'}`, background: t.surface }}>
              <div style={{ padding: '6px 10px', background: t.dark ? 'rgba(124,58,237,.14)' : 'linear-gradient(110deg,#EDE9FE,#F3F0FF)', borderBottom: `1px solid ${t.dark ? 'rgba(124,58,237,.25)' : '#DDD6FE'}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 7, fontWeight: 800, color: t.dark ? '#c4b5fd' : '#6D28D9', letterSpacing: '.1em', textTransform: 'uppercase' }}>Approvers &amp; Review Status</span>
                <span style={{ padding: '2px 7px', borderRadius: 10, background: t.dark ? 'rgba(245,158,11,.16)' : '#FEF3C7', border: `1px solid ${t.dark ? 'rgba(245,158,11,.4)' : '#FDE68A'}`, fontSize: 7, fontWeight: 700, color: t.dark ? '#fcd34d' : '#D97706' }}>● {stage === 4 ? 'Completed' : 'Pending'}</span>
              </div>
              <div style={{ padding: '10px 10px 14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 9px', borderRadius: 9, background: t.dark ? 'rgba(255,255,255,.03)' : 'linear-gradient(135deg,#FAFBFF,#F5F0FF)', border: `1.5px solid ${t.dark ? 'rgba(124,58,237,.2)' : '#EDE9FE'}`, marginBottom: 14 }}>
                  <div style={{ width: 28, height: 28, borderRadius: 8, background: 'linear-gradient(135deg,#F97316,#EA580C)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><span style={{ fontSize: 10, fontWeight: 800, color: '#fff' }}>RK</span></div>
                  <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 9.5, fontWeight: 800, color: t.textStrong }}>Rajesh Kumar</div><div style={{ display: 'flex', gap: 3, marginTop: 3 }}><span style={{ fontSize: 6.5, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: t.dark ? 'rgba(245,158,11,.16)' : '#FEF3C7', color: t.dark ? '#fcd34d' : '#D97706' }}>C-SUITE</span><span style={{ fontSize: 6.5, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: t.dark ? 'rgba(239,68,68,.16)' : '#FEE2E2', color: t.dark ? '#fca5a5' : '#DC2626' }}>Mandatory</span></div></div>
                  <span style={{ padding: '3px 8px', borderRadius: 8, background: stage >= 3 ? (t.dark ? 'rgba(16,185,129,.16)' : '#ECFDF5') : (t.dark ? 'rgba(245,158,11,.16)' : '#FEF3C7'), fontSize: 7, fontWeight: 700, color: stage >= 3 ? (t.dark ? '#6ee7b7' : '#059669') : (t.dark ? '#fcd34d' : '#D97706') }}>{stage >= 3 ? 'Approved' : 'Pending'}</span>
                </div>
                <div style={{ fontSize: 7, fontWeight: 800, color: t.textMuted, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 6 }}><div style={{ height: 1, background: t.dark ? 'rgba(148,163,184,.15)' : '#EDE9FE', flex: 1 }} />Review Timeline<div style={{ height: 1, background: t.dark ? 'rgba(148,163,184,.15)' : '#EDE9FE', flex: 1 }} /></div>
                <TimelineItem t={t} tone="done" title="Draft Submitted" badge="Done" sub="Agreement drafted & submitted for internal review" />
                <TimelineItem t={t} tone={stage >= 3 ? 'done' : 'active'} title="Internal Review" badge={stage >= 3 ? 'Done' : 'Active'} sub="Rajesh Kumar reviewing the agreement" last={stage < 3} />
                {stage >= 3 && <TimelineItem t={t} tone={stage === 4 ? 'done' : 'active'} title={stage === 4 ? 'Signed & Stored' : 'Counterparty Signing'} badge={stage === 4 ? 'Done' : 'Active'} sub={stage === 4 ? 'Final signed agreement archived' : 'Awaiting counterparty signature'} last />}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function TimelineItem({ t, tone, title, badge, sub, last }: { t: OpsTokens; tone: 'done' | 'active'; title: string; badge: string; sub: string; last?: boolean }) {
  const c = tone === 'done' ? '#059669' : '#7C3AED';
  return (
    <div style={{ display: 'flex', gap: 10 }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0, width: 24 }}>
        <div style={{ width: 24, height: 24, borderRadius: '50%', background: `linear-gradient(135deg,${tone === 'done' ? '#059669,#047857' : '#7C3AED,#5B21B6'})`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          {tone === 'done' ? <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round"><polyline points="20 6 9 17 4 12" /></svg> : <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'rgba(255,255,255,.9)' }} />}
        </div>
        {!last && <div style={{ width: 2, height: 28, background: `linear-gradient(180deg,${c},${t.dark ? 'rgba(124,58,237,.2)' : '#EDE9FE'})`, margin: '3px 0' }} />}
      </div>
      <div style={{ flex: 1, paddingBottom: last ? 0 : 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 3 }}>
          <div style={{ fontSize: 10, fontWeight: 800, color: c }}>{title}</div>
          <span style={{ fontSize: 7, fontWeight: 700, padding: '2px 7px', borderRadius: 10, background: tone === 'done' ? (t.dark ? 'rgba(16,185,129,.16)' : '#ECFDF5') : (t.dark ? 'rgba(124,58,237,.18)' : 'linear-gradient(135deg,#EDE9FE,#DDD6FE)'), color: tone === 'done' ? (t.dark ? '#6ee7b7' : '#059669') : (t.dark ? '#c4b5fd' : '#6D28D9') }}>{badge}</span>
        </div>
        <div style={{ fontSize: 8, color: t.textMuted, lineHeight: 1.55 }}>{sub}</div>
      </div>
    </div>
  );
}

/* ── Stage-1 middle-workspace building blocks ── */
function SectionBar({ t, label, readOnly }: { t: OpsTokens; label: string; readOnly?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ width: 3, height: 18, borderRadius: 2, background: 'linear-gradient(180deg,#4F46E5,#7C3AED)', flexShrink: 0 }} />
      <span style={{ fontSize: 13, fontWeight: 800, color: t.textStrong, letterSpacing: '-.2px' }}>{label}</span>
      <div style={{ flex: 1, height: 1, background: t.dark ? 'rgba(148,163,184,.18)' : 'linear-gradient(90deg,#DDD6FE,transparent)' }} />
      {readOnly && (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px', borderRadius: 20, background: t.dark ? 'rgba(124,58,237,.18)' : '#F5F0FF', border: `1px solid ${t.dark ? 'rgba(124,58,237,.35)' : '#DDD6FE'}` }}>
          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke={t.dark ? '#c4b5fd' : '#7C3AED'} strokeWidth="2.5" strokeLinecap="round"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
          <span style={{ fontSize: 9, fontWeight: 700, color: t.dark ? '#c4b5fd' : '#7C3AED' }}>Read Only</span>
        </span>
      )}
    </div>
  );
}

function ReadEmpty({ t, title, sub, chips }: { t: OpsTokens; title: string; sub: string; chips: string[] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: '32px 24px', background: t.surface, borderRadius: 14, border: `2px dashed ${t.dark ? 'rgba(124,58,237,.3)' : '#DDD6FE'}` }}>
      <div style={{ width: 52, height: 52, borderRadius: 14, background: t.dark ? 'rgba(124,58,237,.18)' : 'linear-gradient(135deg,#EDE9FE,#DDD6FE)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={t.dark ? '#a78bfa' : '#A78BFA'} strokeWidth="1.8" strokeLinecap="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /></svg></div>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: t.textStrong, marginBottom: 5 }}>{title}</div>
        <div style={{ fontSize: 10, color: t.textMuted, lineHeight: 1.6 }}>{sub}</div>
      </div>
      {chips.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
          {chips.map(c => {
            const ok = /Added$|Selected$/.test(c) && !/Not/.test(c);
            return <span key={c} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 12px', background: t.dark ? 'rgba(124,58,237,.12)' : '#F5F0FF', borderRadius: 20, border: `1px solid ${t.dark ? 'rgba(124,58,237,.3)' : '#DDD6FE'}` }}><span style={{ width: 6, height: 6, borderRadius: '50%', background: ok ? '#10B981' : (t.dark ? 'rgba(148,163,184,.4)' : '#DDD6FE') }} /><span style={{ fontSize: 9, fontWeight: 700, color: ok ? (t.dark ? '#6ee7b7' : '#059669') : (t.dark ? '#a78bfa' : '#A78BFA') }}>{c}</span></span>;
          })}
        </div>
      )}
    </div>
  );
}

function CpReadCard({ t, idx, cp }: { t: OpsTokens; idx: number; cp: CP }) {
  return (
    <div style={{ background: t.surface, borderRadius: 14, border: `1.5px solid ${t.dark ? 'rgba(124,58,237,.25)' : '#EDE9FE'}`, overflow: 'hidden', boxShadow: '0 4px 16px rgba(109,40,217,.08)' }}>
      <div style={{ background: `linear-gradient(118deg,${cp.badge === 'BUYER' ? '#0e7490,#0891b2,#06b6d4' : cp.badge === 'SUPPLIER' ? '#047857,#059669,#10b981' : '#4C1D95,#6D28D9,#7C3AED'})`, padding: '10px 14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 8 }}>
          <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '.1em', textTransform: 'uppercase', color: 'rgba(255,255,255,.7)' }}>Counter Party {idx}</span>
          {cp.badge && <span style={{ fontSize: 8, fontWeight: 800, padding: '2px 8px', borderRadius: 20, background: 'rgba(255,255,255,.2)', border: '1px solid rgba(255,255,255,.35)', color: '#fff', textTransform: 'uppercase' }}>{cp.badge}</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(255,255,255,.2)', border: '1.5px solid rgba(255,255,255,.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><span style={{ fontSize: 11, fontWeight: 800, color: '#fff' }}>{cp.initials}</span></div>
          <div style={{ minWidth: 0, flex: 1 }}><div style={{ fontSize: 13, fontWeight: 800, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{cp.name}</div><div style={{ fontSize: 10, color: 'rgba(255,255,255,.65)', fontWeight: 500 }}>{cp.country}</div></div>
        </div>
      </div>
      <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ background: t.dark ? 'rgba(124,58,237,.1)' : 'linear-gradient(135deg,#F5F0FF,#EDE9FE)', borderRadius: 8, padding: '9px 11px', border: `1px solid ${t.dark ? 'rgba(124,58,237,.25)' : '#DDD6FE'}` }}>
          <div style={{ fontSize: 8, fontWeight: 800, color: t.dark ? '#a78bfa' : '#7C3AED', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 4 }}>Referred as in Agreement</div>
          <div style={{ fontSize: 13, fontWeight: 800, color: t.dark ? '#ddd6fe' : '#4C1D95' }}>{cp.referred}</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, paddingTop: 4, borderTop: `1px solid ${t.dark ? 'rgba(148,163,184,.12)' : '#F1EEFF'}` }}>
          {[cp.country, cp.phone, cp.email].map((v, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <div style={{ width: 20, height: 20, borderRadius: 6, background: t.dark ? 'rgba(124,58,237,.12)' : '#F5F0FF', flexShrink: 0 }} />
              <span style={{ fontSize: 11, color: t.textSub, fontWeight: 500 }}>{v}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function MiniLabel({ t, green, children }: { t: OpsTokens; green?: boolean; children: React.ReactNode }) {
  return <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 8, fontWeight: 800, letterSpacing: '.1em', textTransform: 'uppercase', color: green ? (t.dark ? '#34d399' : '#059669') : (t.dark ? '#a78bfa' : '#7C3AED') }}><span style={{ width: 3, height: 10, borderRadius: 2, background: green ? 'linear-gradient(180deg,#059669,#047857)' : 'linear-gradient(180deg,#7C3AED,#5B21B6)', flexShrink: 0 }} />{children}</label>;
}

function BigChoice({ t, sel, onClick, title, sub, tag, icon }: { t: OpsTokens; sel: boolean; onClick: () => void; title: string; sub: string; tag?: string; icon: React.ReactNode }) {
  return (
    <button onClick={onClick} style={{ padding: '9px 12px', borderRadius: 11, border: `2px solid ${sel ? '#7C3AED' : (t.dark ? 'rgba(124,58,237,.22)' : '#DDD6FE')}`, background: sel ? (t.dark ? 'rgba(124,58,237,.2)' : 'linear-gradient(135deg,#EDE9FE,#DDD6FE)') : (t.dark ? 'rgba(255,255,255,.03)' : 'linear-gradient(135deg,#F8F6FF,#F0EBFF)'), cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 9, textAlign: 'left', boxShadow: sel ? '0 2px 10px rgba(109,40,217,.18)' : 'none' }}>
      <div style={{ width: 32, height: 32, borderRadius: 9, background: sel ? 'linear-gradient(135deg,#7C3AED,#5B21B6)' : (t.dark ? 'rgba(124,58,237,.2)' : 'linear-gradient(135deg,#EDE9FE,#DDD6FE)'), display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{sel ? icon : <span style={{ color: t.dark ? '#c4b5fd' : '#7C3AED', display: 'flex' }}>{icon}</span>}</div>
      <div><div style={{ fontSize: 10.5, fontWeight: 800, color: sel ? (t.dark ? '#ddd6fe' : '#3B0764') : (t.dark ? '#c4b5fd' : '#4C1D95'), lineHeight: 1.2 }}>{title}</div><div style={{ fontSize: 8, color: t.dark ? '#a78bfa' : '#7C3AED', fontWeight: 500, marginTop: 2 }}>{sub}</div>{tag && <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginTop: 4 }}><span style={{ width: 5, height: 5, borderRadius: '50%', background: '#7C3AED', opacity: .5 }} /><span style={{ fontSize: 7.5, color: t.dark ? '#a78bfa' : '#6D28D9', fontWeight: 600 }}>{tag}</span></div>}</div>
    </button>
  );
}

function GreenChoice({ t, sel, onClick, title, sub, icon }: { t: OpsTokens; sel: boolean; onClick: () => void; title: string; sub: string; icon: React.ReactNode }) {
  return (
    <button onClick={onClick} style={{ padding: '8px 11px', borderRadius: 10, border: `2px solid ${sel ? '#059669' : (t.dark ? 'rgba(16,185,129,.25)' : '#A7F3D0')}`, background: sel ? (t.dark ? 'rgba(16,185,129,.18)' : 'linear-gradient(135deg,#D1FAE5,#A7F3D0)') : (t.dark ? 'rgba(255,255,255,.03)' : 'linear-gradient(135deg,#F0FDF4,#ECFDF5)'), cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left' }}>
      <div style={{ width: 28, height: 28, borderRadius: 8, background: sel ? 'linear-gradient(135deg,#059669,#047857)' : (t.dark ? 'rgba(16,185,129,.2)' : 'linear-gradient(135deg,#D1FAE5,#A7F3D0)'), display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{sel ? icon : <span style={{ color: t.dark ? '#34d399' : '#059669', display: 'flex' }}>{icon}</span>}</div>
      <div><div style={{ fontSize: 10.5, fontWeight: 800, color: sel ? (t.dark ? '#6ee7b7' : '#064E3B') : (t.dark ? '#cbd5e1' : '#374151') }}>{title}</div><div style={{ fontSize: 8, color: sel ? (t.dark ? '#34d399' : '#059669') : t.textMuted, fontWeight: 500, marginTop: 1 }}>{sub}</div></div>
    </button>
  );
}

/* ── Stage-1 right panel: placeholder fields + AI writing assistant + summary ── */
function RightTools({ t, draft, onInsert, summary }: { t: OpsTokens; draft: string; onInsert: (tok: string) => void; summary: string[][] }) {
  const words = draft.trim() ? draft.trim().split(/\s+/).length : 0;
  const score = Math.min(100, Math.round(words * 1.5));
  const FIELDS = [['SIGNATURE', 'signature'], ['PERSON NAME', 'person_name'], ['COMPANY NAME', 'company_name'], ['EMAIL', 'email'], ['CONTACT NO', 'contact_no'], ['ADDRESS', 'address']];
  const cardBd = `1.5px solid ${t.dark ? 'rgba(124,58,237,.25)' : '#EDE9FE'}`;
  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Placeholder fields */}
      <div style={{ background: t.surface, borderRadius: 12, border: cardBd, overflow: 'hidden', boxShadow: '0 2px 10px rgba(109,40,217,.07)' }}>
        <div style={{ padding: '9px 12px', background: t.dark ? 'rgba(124,58,237,.14)' : 'linear-gradient(110deg,#EDE9FE 0%,#F3F0FF 40%,#E8E2FF 100%)', borderBottom: `1.5px solid ${t.dark ? 'rgba(124,58,237,.25)' : '#DDD6FE'}`, display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 22, height: 22, borderRadius: 7, background: 'linear-gradient(135deg,#7C3AED,#5B21B6)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"><polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" /></svg></div>
          <div><div style={{ fontSize: 10, fontWeight: 800, color: t.dark ? '#ddd6fe' : '#3B0764' }}>Standard Placeholder Fields</div><div style={{ fontSize: 7.5, color: t.dark ? '#a78bfa' : '#7C3AED', fontWeight: 500 }}>Click a field to insert into the editor</div></div>
        </div>
        <div style={{ padding: 10, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7 }}>
          {FIELDS.map(([lbl, tok]) => (
            <button key={tok} onClick={() => onInsert(`{{${tok}}}`)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, padding: '8px 10px', borderRadius: 8, border: `1.5px solid ${t.dark ? 'rgba(124,58,237,.25)' : '#EDE9FE'}`, background: t.dark ? 'rgba(255,255,255,.03)' : '#FAFBFF', cursor: 'pointer', fontFamily: 'inherit' }}>
              <span style={{ fontSize: 8.5, fontWeight: 800, letterSpacing: '.04em', color: t.dark ? '#cbd5e1' : '#475569' }}>{lbl}</span>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={t.dark ? '#a78bfa' : '#A78BFA'} strokeWidth="2" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
            </button>
          ))}
        </div>
        <div style={{ padding: '0 10px 10px' }}><div style={{ border: `1px dashed ${t.dark ? 'rgba(124,58,237,.3)' : '#C4B5FD'}`, borderRadius: 8, padding: '8px 10px', textAlign: 'center', fontSize: 8.5, fontWeight: 600, color: t.dark ? '#a78bfa' : '#7C3AED' }}>✦ Drag to editor or click to insert at cursor</div></div>
      </div>

      {/* AI Writing Assistant */}
      <div style={{ background: t.surface, borderRadius: 12, border: cardBd, overflow: 'hidden', boxShadow: '0 2px 10px rgba(109,40,217,.07)' }}>
        <div style={{ padding: '9px 12px', background: t.dark ? 'rgba(124,58,237,.14)' : 'linear-gradient(110deg,#EDE9FE 0%,#F3F0FF 40%,#E8E2FF 100%)', borderBottom: `1.5px solid ${t.dark ? 'rgba(124,58,237,.25)' : '#DDD6FE'}`, display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 22, height: 22, borderRadius: 7, background: 'linear-gradient(135deg,#7C3AED,#5B21B6)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"><circle cx="12" cy="12" r="3" /><path d="M12 1v4M12 19v4M1 12h4M19 12h4" /></svg></div>
          <div><div style={{ fontSize: 10, fontWeight: 800, color: t.dark ? '#ddd6fe' : '#3B0764' }}>AI Writing Assistant</div><div style={{ fontSize: 7.5, color: t.dark ? '#a78bfa' : '#7C3AED', fontWeight: 500 }}>Live review as you type</div></div>
        </div>
        <div style={{ padding: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <div><div style={{ fontSize: 8, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.08em', color: t.textMuted }}>Quality Score</div><div style={{ fontSize: 24, fontWeight: 900, color: score > 0 ? (t.dark ? '#6ee7b7' : '#059669') : '#EF4444' }}>{score}<span style={{ fontSize: 11, fontWeight: 700, color: t.textMuted }}>/100</span></div></div>
            <div style={{ textAlign: 'right' }}>
              <span style={{ display: 'inline-block', padding: '3px 9px', borderRadius: 20, fontSize: 8.5, fontWeight: 800, background: score > 0 ? (t.dark ? 'rgba(16,185,129,.16)' : '#ECFDF5') : (t.dark ? 'rgba(239,68,68,.16)' : '#FEF2F2'), color: score > 0 ? (t.dark ? '#6ee7b7' : '#059669') : (t.dark ? '#fca5a5' : '#DC2626'), border: `1px solid ${score > 0 ? (t.dark ? 'rgba(16,185,129,.4)' : '#A7F3D0') : (t.dark ? 'rgba(239,68,68,.4)' : '#FECACA')}` }}>{score > 0 ? 'In Progress' : 'Not Started'}</span>
              <div style={{ fontSize: 8.5, color: t.textMuted, fontWeight: 600, marginTop: 4 }}>{words} words</div>
            </div>
          </div>
          <div style={{ height: 5, borderRadius: 4, background: t.dark ? 'rgba(255,255,255,.06)' : '#EDE9FE', overflow: 'hidden' }}><div style={{ height: '100%', width: `${score}%`, background: 'linear-gradient(90deg,#7C3AED,#059669)', transition: 'width .25s' }} /></div>
          <div style={{ marginTop: 10, padding: '10px 12px', borderRadius: 8, border: `1px dashed ${t.dark ? 'rgba(124,58,237,.3)' : '#DDD6FE'}`, textAlign: 'center', fontSize: 9, fontWeight: 600, color: t.dark ? '#a78bfa' : '#7C3AED' }}>{score > 0 ? 'Keep going — add parties, clauses & terms to raise the score.' : 'Start typing in the editor to see live analysis'}</div>
        </div>
      </div>

      {/* Compact summary */}
      <div style={{ background: t.surface, borderRadius: 12, border: cardBd, overflow: 'hidden' }}>
        <div style={{ padding: '6px 12px', background: t.dark ? 'rgba(124,58,237,.14)' : 'linear-gradient(110deg,#EDE9FE,#F3F0FF)', borderBottom: `1px solid ${t.dark ? 'rgba(124,58,237,.25)' : '#DDD6FE'}` }}><span style={{ fontSize: 7.5, fontWeight: 800, color: t.dark ? '#c4b5fd' : '#6D28D9', letterSpacing: '.1em', textTransform: 'uppercase' }}>Agreement Summary</span></div>
        <div style={{ padding: '8px 12px 4px' }}>
          {summary.map(([k, v]) => (
            <div key={k} style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 6, padding: '4px 0', borderBottom: `1px solid ${t.dark ? 'rgba(148,163,184,.1)' : '#FAF8FF'}` }}>
              <span style={{ fontSize: 7.5, fontWeight: 700, color: t.textMuted, textTransform: 'uppercase', letterSpacing: '.06em', flexShrink: 0, minWidth: 55 }}>{k}</span>
              <span style={{ fontSize: 8.5, fontWeight: 700, color: t.textStrong, textAlign: 'right', wordBreak: 'break-word', lineHeight: 1.4, flex: 1 }}>{v}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ── building blocks ── */
function Panel({ t, header, title, headGrad, children, onCollapse, collapseDir }: { t: OpsTokens; header: string; title: string; headGrad: string; children: React.ReactNode; onCollapse?: () => void; collapseDir?: 'left' | 'right' }) {
  return (
    <div style={{ flex: 1, minHeight: 0, background: t.dark ? '#161226' : 'linear-gradient(160deg,#faf8ff 0%,#f5f0fe 35%,#ede8fd 100%)', borderRadius: 16, border: `1.5px solid ${t.dark ? 'rgba(139,92,246,.3)' : 'rgba(139,92,246,.28)'}`, boxShadow: '0 6px 32px rgba(109,40,217,.12)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ padding: '13px 14px', display: 'flex', alignItems: 'center', gap: 11, flexShrink: 0, position: 'relative', overflow: 'hidden', background: `linear-gradient(118deg,${headGrad})`, borderRadius: '14px 14px 0 0' }}>
        <span style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '55%', background: 'linear-gradient(180deg,rgba(255,255,255,.2),transparent)', pointerEvents: 'none', borderRadius: '14px 14px 0 0' }} />
        <div style={{ width: 34, height: 34, borderRadius: 10, background: 'rgba(255,255,255,.18)', border: '1.5px solid rgba(255,255,255,.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, position: 'relative', zIndex: 1 }}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /></svg></div>
        <div style={{ flex: 1, minWidth: 0, position: 'relative', zIndex: 1 }}><div style={{ fontSize: 7, fontWeight: 800, letterSpacing: '.15em', textTransform: 'uppercase', color: 'rgba(255,255,255,.65)', marginBottom: 2 }}>{header}</div><div style={{ fontSize: 13, fontWeight: 800, color: '#fff', letterSpacing: '-.25px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</div></div>
        {onCollapse && (
          <button onClick={onCollapse} title="Collapse panel" style={{ width: 26, height: 26, borderRadius: 8, flexShrink: 0, position: 'relative', zIndex: 1, background: 'rgba(255,255,255,.16)', border: '1.5px solid rgba(255,255,255,.3)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">{collapseDir === 'right' ? <polyline points="9 18 15 12 9 6" /> : <polyline points="15 18 9 12 15 6" />}</svg>
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

/* ── Collapsed side-panel rail (click the arrow to expand) ── */
function CollapsedBar({ t, title, headGrad, dir, onExpand }: { t: OpsTokens; title: string; headGrad: string; dir: 'left' | 'right'; onExpand: () => void }) {
  return (
    <div onClick={onExpand} title={`Expand ${title}`} style={{ flex: 1, minHeight: 0, width: 48, cursor: 'pointer', background: t.dark ? '#161226' : 'linear-gradient(160deg,#faf8ff 0%,#f5f0fe 35%,#ede8fd 100%)', borderRadius: 16, border: `1.5px solid ${t.dark ? 'rgba(139,92,246,.3)' : 'rgba(139,92,246,.28)'}`, boxShadow: '0 6px 32px rgba(109,40,217,.12)', display: 'flex', flexDirection: 'column', alignItems: 'center', overflow: 'hidden' }}>
      <div style={{ width: '100%', padding: '11px 0', display: 'flex', alignItems: 'center', justifyContent: 'center', background: `linear-gradient(160deg,${headGrad})`, flexShrink: 0 }}>
        <div style={{ width: 26, height: 26, borderRadius: 8, background: 'rgba(255,255,255,.18)', border: '1.5px solid rgba(255,255,255,.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">{dir === 'left' ? <polyline points="9 18 15 12 9 6" /> : <polyline points="15 18 9 12 15 6" />}</svg>
        </div>
      </div>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', writingMode: 'vertical-rl', transform: 'rotate(180deg)', fontSize: 11, fontWeight: 800, letterSpacing: '.04em', color: t.dark ? '#c4b5fd' : '#5B21B6', whiteSpace: 'nowrap', padding: '12px 0' }}>{title}</div>
    </div>
  );
}

function CpCard({ t, slot, cp, onRemove }: { t: OpsTokens; slot: number; cp: CP; onRemove: () => void }) {
  const badgeGrad = cp.badge === 'BUYER' ? '#0891b2,#0e7490' : cp.badge === 'SUPPLIER' ? '#16A34A,#059669' : '#6D28D9,#4C1D95';
  return (
    <div style={{ borderRadius: 10, border: `1.5px solid ${t.dark ? 'rgba(124,58,237,.3)' : '#DDD6FE'}`, background: t.surface, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', background: t.dark ? 'rgba(124,58,237,.18)' : 'linear-gradient(110deg,#EDE9FE,#DDD6FE)' }}>
        <span style={{ fontSize: 7.5, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', color: t.dark ? '#c4b5fd' : '#6D28D9' }}>Counter Party {slot}</span>
        {cp.badge && <span style={{ fontSize: 7, fontWeight: 800, padding: '2px 7px', borderRadius: 20, background: `linear-gradient(135deg,${badgeGrad})`, color: '#fff', textTransform: 'uppercase', letterSpacing: '.06em' }}>{cp.badge}</span>}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '8px 10px 6px' }}>
        <div style={{ width: 32, height: 32, borderRadius: 9, background: `linear-gradient(135deg,${cp.grad})`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: '0 3px 8px rgba(79,70,229,.3)' }}><span style={{ fontSize: 10, fontWeight: 800, color: '#fff' }}>{cp.initials}</span></div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: t.textStrong, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1.3 }}>{cp.name}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 3, flexWrap: 'wrap' }}>
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#A78BFA" strokeWidth="2.5" strokeLinecap="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>
            <span style={{ fontSize: 8.5, fontWeight: 700, color: '#A78BFA' }}>Referred as:</span>
            <span style={{ fontSize: 8.5, fontWeight: 800, color: '#fff', background: 'linear-gradient(135deg,#6D28D9,#A78BFA)', padding: '2px 8px', borderRadius: 20 }}>{cp.referred}</span>
          </div>
        </div>
        <button onClick={onRemove} style={{ width: 18, height: 18, borderRadius: '50%', background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.2)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><svg width="7" height="7" viewBox="0 0 24 24" fill="none" stroke="#EF4444" strokeWidth="3" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg></button>
      </div>
      <div style={{ borderTop: `1px solid ${t.dark ? 'rgba(148,163,184,.12)' : '#F1EEFF'}`, padding: '5px 10px 8px', display: 'flex', flexDirection: 'column', gap: 3 }}>
        <OrgDetail t={t} text={cp.country} /><OrgDetail t={t} text={cp.phone} /><OrgDetail t={t} text={cp.email} />
      </div>
    </div>
  );
}

function OrgDetail({ t, text }: { t: OpsTokens; text: string }) {
  return <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="#A78BFA" strokeWidth="2.2" strokeLinecap="round"><circle cx="12" cy="12" r="10" /></svg><span style={{ fontSize: 9, color: t.textSub, fontWeight: 500 }}>{text}</span></div>;
}

function Field({ t, label, green, children }: { t: OpsTokens; label: string; green?: boolean; children: React.ReactNode }) {
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}><label style={{ fontSize: 8, fontWeight: 800, letterSpacing: '.1em', textTransform: 'uppercase', color: green ? (t.dark ? '#34d399' : '#059669') : (t.dark ? '#a78bfa' : '#7C3AED') }}>{label}</label>{children}</div>;
}

/* ── Counterparty picker modal ── */
function CpPicker({ t, slot, onClose, onPick }: { t: OpsTokens; slot: number; onClose: () => void; onPick: (cp: CP) => void }) {
  const [tab, setTab] = useState<'buyer' | 'supplier'>('buyer');
  const [search, setSearch] = useState('');
  const [pending, setPending] = useState<typeof CP_DIR['buyer'][number] | null>(null);
  const [referred, setReferred] = useState('');
  const list = CP_DIR[tab].filter(p => (p.name + p.id + p.email).toLowerCase().includes(search.toLowerCase()));

  return (
    <div onClick={e => { if (e.target === e.currentTarget) onClose(); }} style={{ position: 'fixed', inset: 0, zIndex: 9999999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(15,5,40,.42)', backdropFilter: 'blur(6px)' }} />
      <div style={{ position: 'relative', zIndex: 1, width: pending ? 300 : 300, background: t.surface, borderRadius: 16, boxShadow: '0 10px 48px rgba(109,40,217,.32)', overflow: 'hidden', fontFamily: "'Rubik', system-ui, sans-serif" }}>
        <div style={{ background: 'linear-gradient(118deg,#4C1D95,#6D28D9,#8B5CF6)', padding: '12px 14px 11px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: '#fff' }}>{pending ? `Confirm CP ${slot}` : `Add Counter Party ${slot}`}</div>
          <button onClick={onClose} style={{ width: 24, height: 24, borderRadius: 7, background: 'rgba(255,255,255,.15)', border: '1px solid rgba(255,255,255,.25)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg></button>
        </div>
        {!pending ? (
          <div style={{ padding: '10px 12px 12px' }}>
            <div style={{ display: 'flex', gap: 3, background: t.dark ? 'rgba(255,255,255,.05)' : '#F3F0FD', borderRadius: 9, padding: 3, marginBottom: 9 }}>
              {(['buyer', 'supplier'] as const).map(tb => (
                <button key={tb} onClick={() => setTab(tb)} style={{ flex: 1, padding: '6px 0', borderRadius: 7, border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 11, fontWeight: 700, textTransform: 'capitalize', background: tab === tb ? 'linear-gradient(135deg,#7C3AED,#6D28D9)' : 'transparent', color: tab === tb ? '#fff' : t.textMuted, boxShadow: tab === tb ? '0 2px 6px rgba(109,40,217,.3)' : 'none' }}>{tb}</button>
              ))}
            </div>
            <div style={{ position: 'relative', marginBottom: 8 }}>
              <svg style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)' }} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#A78BFA" strokeWidth="2.4" strokeLinecap="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search…" style={{ width: '100%', padding: '8px 10px 8px 30px', border: `1.5px solid ${t.searchBorder}`, borderRadius: 9, fontSize: 11, fontFamily: 'inherit', color: t.text, background: t.dark ? 'rgba(255,255,255,.04)' : '#fff', outline: 'none', boxSizing: 'border-box' }} />
            </div>
            <div style={{ overflowY: 'auto', maxHeight: 220, display: 'flex', flexDirection: 'column', gap: 1 }}>
              {list.map(p => (
                <div key={p.id} onClick={() => { setPending(p); setReferred(p.name); }} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '7px 8px', borderRadius: 9, cursor: 'pointer' }}
                  onMouseEnter={e => (e.currentTarget.style.background = t.dark ? 'rgba(124,58,237,.14)' : '#F5F0FF')} onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                  <div style={{ width: 28, height: 28, borderRadius: 8, background: `linear-gradient(135deg,${p.grad})`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><span style={{ fontSize: 8, fontWeight: 800, color: '#fff' }}>{p.initials}</span></div>
                  <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 9, fontWeight: 700, color: t.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</div><div style={{ fontSize: 7, color: t.textMuted }}>{p.country}</div></div>
                </div>
              ))}
              {!list.length && <div style={{ textAlign: 'center', padding: '20px 0', fontSize: 8, color: t.textMuted }}>No results</div>}
            </div>
          </div>
        ) : (
          <div style={{ padding: '12px 14px 14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 10 }}>
              <div style={{ width: 34, height: 34, borderRadius: 9, background: `linear-gradient(135deg,${pending.grad})`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><span style={{ fontSize: 11, fontWeight: 800, color: '#fff' }}>{pending.initials}</span></div>
              <div style={{ minWidth: 0 }}><div style={{ fontSize: 11, fontWeight: 800, color: t.textStrong }}>{pending.name}</div><div style={{ fontSize: 8, color: t.textMuted }}>{pending.email}</div></div>
            </div>
            <label style={{ fontSize: 7, fontWeight: 800, letterSpacing: '.1em', textTransform: 'uppercase', color: '#A78BFA' }}>Referred As In Agreement</label>
            <input value={referred} onChange={e => setReferred(e.target.value)} style={{ width: '100%', padding: '7px 10px', border: `1.5px solid ${t.searchBorder}`, borderRadius: 8, fontSize: 10.5, fontFamily: 'inherit', color: t.text, background: t.dark ? 'rgba(255,255,255,.04)' : '#fff', outline: 'none', boxSizing: 'border-box', marginTop: 4 }} />
            <div style={{ display: 'flex', gap: 6, marginTop: 9 }}>
              <button onClick={() => onPick({ name: pending.name, initials: pending.initials, country: pending.country, phone: pending.phone, email: pending.email, grad: pending.grad, badge: tab.toUpperCase(), referred: referred || pending.name })} style={{ flex: 1, padding: '8px 0', borderRadius: 8, background: 'linear-gradient(135deg,#4F46E5,#7C3AED)', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 10.5, fontWeight: 700, color: '#fff', boxShadow: '0 3px 12px rgba(109,40,217,.38)' }}>Confirm &amp; Add</button>
              <button onClick={() => setPending(null)} style={{ padding: '8px 13px', borderRadius: 8, background: t.dark ? 'rgba(255,255,255,.05)' : '#F8F6FF', border: `1.5px solid ${t.dark ? 'rgba(124,58,237,.3)' : '#DDD6FE'}`, cursor: 'pointer', fontFamily: 'inherit', fontSize: 10.5, fontWeight: 600, color: t.textSub }}>Back</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const CTC_FORM_CSS = `
.ctc-mid-scroll { scrollbar-width: thin; scrollbar-color: rgba(124,58,237,.55) transparent; }
.ctc-mid-scroll::-webkit-scrollbar { width: 9px; }
.ctc-mid-scroll::-webkit-scrollbar-track { background: transparent; margin: 4px 0; }
.ctc-mid-scroll::-webkit-scrollbar-thumb { background: linear-gradient(180deg,#8B5CF6,#7C3AED,#6D28D9); border-radius: 8px; border: 2px solid transparent; background-clip: padding-box; }
.ctc-mid-scroll::-webkit-scrollbar-thumb:hover { background: linear-gradient(180deg,#7C3AED,#6D28D9,#5B21B6); background-clip: padding-box; }
`;
