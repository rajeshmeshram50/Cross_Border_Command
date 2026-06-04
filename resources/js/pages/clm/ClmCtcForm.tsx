import { useEffect, useRef, useState } from 'react';
import { useToast } from '../../contexts/ToastContext';
import api from '../../api';
import { MasterSelect, MasterDatePicker, MasterFormStyles } from '../master/masterFormKit';
import ClmInsertPlaceholderModal from './ClmInsertPlaceholderModal';
import ClmClauseInsertPanel from './ClmClauseInsertPanel';
import HeaderFooterPanel, { DEFAULT_HEADER, DEFAULT_FOOTER, type HeaderConfig, type FooterConfig } from '../hrms/doc-templates/HeaderFooterPanel';
import { pad2, type CtcContract } from './clmOpsData';
import { useOpsTheme, type OpsTokens } from './useOpsTheme';
import { VersionHistoryModal, type CtcVersion } from './clmCtcModals';

/* ─────────────────────────────────────────────────────────────────────────
 * Case to Case Contracts → full-screen "Create / Edit CTC Agreement" form.
 *
 * Faithful violet-themed port of `_ctcFormHTML` from the prototype: a 4-stage
 * flow (Agreement Drafting → Internal Review → Counterparty Signing → Final
 * Repository) driven by a stage stepper. Stage 1 is the three-panel
 * workspace (Counterparty Details · Draft Workspace · Summary). Stages 2–4
 * render the styled review / signing / repository panels.
 * ───────────────────────────────────────────────────────────────────────── */

/* Our-organisation options are sourced from the Company Details master
 * (GET /master/company). We surface only Country, State, Company Name and
 * Short Code. The master is India-centric (GSTIN/PAN/IEC) and has no country
 * column, so country defaults to "India". */
type Org = { id: number; name: string; shortCode: string; state: string; country: string; city: string; grad: string; initials: string; sub: string };

const ORG_GRADS = ['#7C3AED,#4C1D95', '#0891b2,#0e7490', '#16a34a,#15803d', '#D97706,#B45309', '#4F46E5,#7C3AED', '#DB2777,#9D174D'];
const orgInitials = (s: string) => (s || '').trim().split(/\s+/).map(w => w[0] || '').join('').slice(0, 2).toUpperCase() || 'CO';
function mapCompany(row: Record<string, unknown>, i: number): Org {
  const name = String(row.company_name ?? row.name ?? 'Company');
  const code = String(row.short_code ?? '');
  const state = String(row.state ?? '') || '—';
  const city = String(row.city ?? '');
  return { id: Number(row.id ?? i), name, shortCode: code || '—', state, country: String(row.country ?? 'India'), city, grad: ORG_GRADS[i % ORG_GRADS.length], initials: (code || orgInitials(name)).slice(0, 2).toUpperCase(), sub: [code, state].filter(Boolean).join(' · ') };
}

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
  const [cps, setCps] = useState<CP[]>([]);
  const cp1 = cps[0] ?? null;
  const cp2 = cps[1] ?? null;
  const [org, setOrg] = useState<Org | null>(null);
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [agTypes, setAgTypes] = useState<{ value: string; label: string }[]>([]);
  const [agTypesLoading, setAgTypesLoading] = useState(true);
  const [orgOpen, setOrgOpen] = useState(false);
  const [picker, setPicker] = useState(false);
  const [agTitle, setAgTitle] = useState(editing?.title ?? '');
  const [agType, setAgType] = useState(editing?.type ?? '');
  const [effDate, setEffDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [draft, setDraft] = useState('');
  const [sentForApproval, setSentForApproval] = useState(false);   // set when the draft is submitted for approval
  // The persisted contract we're driving through the lifecycle (set on create
  // or in edit mode) + its live server snapshot (approval status, versions,
  // signing recipients) so Stages 2–4 reflect what approvers / signers did.
  const [workingId, setWorkingId] = useState<number | null>(editing?.dbId ?? null);
  const [record, setRecord] = useState<Record<string, unknown> | null>(null);
  // Page-shell header/footer config — lifted to the parent so it survives the
  // stage change and the Stage-2 preview can render the same logo/header/footer.
  const [header, setHeader] = useState<HeaderConfig>(DEFAULT_HEADER);
  const [footer, setFooter] = useState<FooterConfig>(DEFAULT_FOOTER);
  useEffect(() => { if (org?.name) setHeader(h => h.title === DEFAULT_HEADER.title ? { ...h, title: org.name } : h); }, [org]);

  const errMsg = (e: unknown) => (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
  const refreshRecord = async (id?: number | null) => {
    const rid = id ?? workingId;
    if (!rid) return;
    try { const res = await api.get(`/clm/ctc-contracts/${rid}`); setRecord((res.data?.data ?? res.data ?? null) as Record<string, unknown>); }
    catch { /* keep last snapshot */ }
  };
  // Poll for approver / signer activity while we sit on a review/signing stage.
  useEffect(() => {
    if (!workingId || stage < 2) return;
    const iv = window.setInterval(() => { refreshRecord(); }, 15000);
    return () => window.clearInterval(iv);
  }, [workingId, stage]); // eslint-disable-line react-hooks/exhaustive-deps

  const approval = String((record?.approval_status as string) ?? (sentForApproval ? 'pending' : ''));

  useEffect(() => { document.body.style.overflow = 'hidden'; return () => { document.body.style.overflow = ''; }; }, []);

  // Pull "Our Organisation" options from the Company Details master.
  useEffect(() => {
    let alive = true;
    api.get('/master/company')
      .then(res => { if (!alive) return; const rows = Array.isArray(res.data) ? res.data : (res.data?.data ?? []); setOrgs(rows.map(mapCompany)); })
      .catch(() => { if (alive) setOrgs([]); });
    return () => { alive = false; };
  }, []);

  // Agreement Type options come from the CLM Agreement Type master.
  useEffect(() => {
    let alive = true;
    api.get('/clm/agreement-types')
      .then(res => { if (!alive) return; const rows = (res.data?.data ?? res.data ?? []) as Record<string, unknown>[]; setAgTypes(rows.map(r => ({ value: String(r.name ?? r.code ?? ''), label: String(r.name ?? r.code ?? '') })).filter(o => o.value)); })
      .catch(() => { if (alive) setAgTypes([]); })
      .finally(() => { if (alive) setAgTypesLoading(false); });
    return () => { alive = false; };
  }, []);

  const goStage = (n: number) => setStage(n);

  // Edit mode — hydrate the form from the saved record.
  useEffect(() => {
    const dbId = editing?.dbId;
    if (!dbId) return;
    let alive = true;
    api.get(`/clm/ctc-contracts/${dbId}`).then(res => {
      if (!alive) return;
      const r = (res.data?.data ?? res.data ?? {}) as Record<string, unknown>;
      setRecord(r);
      setWorkingId(dbId);
      if (r.approval_status) setSentForApproval(true);
      // Resume the lifecycle at the stage the contract reached.
      setStage(Math.min(4, Math.max(1, Number(r.stage) || 1)));
      const d = (v: unknown) => (v ? String(v).slice(0, 10) : '');
      setAgTitle(String(r.title ?? ''));
      setAgType(String(r.agreement_type ?? ''));
      setEffDate(d(r.eff_date));
      setEndDate(d(r.end_date));
      setDraft(String(r.content ?? ''));
      if (r.org_name) setOrg({ id: 0, name: String(r.org_name), shortCode: String(r.org_short_code ?? '—'), state: String(r.org_state ?? '—'), country: String(r.org_country ?? 'India'), city: '', grad: ORG_GRADS[0], initials: orgInitials(String(r.org_name)), sub: [r.org_short_code, r.org_state].filter(Boolean).join(' · ') });
      const cpArr = (Array.isArray(r.counterparties) ? r.counterparties : []) as Record<string, unknown>[];
      setCps(cpArr.map((c, i) => ({ name: String(c.name ?? ''), initials: orgInitials(String(c.name ?? '')), country: String(c.country ?? ''), phone: String(c.phone ?? ''), email: String(c.email ?? ''), grad: ORG_GRADS[i % ORG_GRADS.length], badge: String(c.badge ?? ''), referred: String(c.referred ?? c.name ?? '') })));
      if (r.header_config) setHeader({ ...DEFAULT_HEADER, ...(r.header_config as object) } as HeaderConfig);
      if (r.footer_config) setFooter({ ...DEFAULT_FOOTER, ...(r.footer_config as object) } as FooterConfig);
    }).catch(() => { if (alive) toast.error('Could not load', 'Failed to open this agreement for editing.'); });
    return () => { alive = false; };
  }, [editing?.dbId]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = () => {
    if (!agTitle.trim()) { toast.error('Missing title', 'Enter an agreement title'); setStage(1); return; }
    toast.success(editing ? 'CTC updated' : 'CTC created', agTitle);
    onSaved();
  };

  // Persist edits to an existing agreement.
  const saveEdit = async () => {
    if (!editing?.dbId) return;
    if (!agTitle.trim()) { toast.error('Missing title', 'Enter an agreement title in Step 2.'); return; }
    try {
      await api.put(`/clm/ctc-contracts/${editing.dbId}`, {
        title: agTitle, agreement_type: agType || null,
        content: draft || null, header_config: header, footer_config: footer,
        counterparties: cps.map(c => ({ name: c.name, country: c.country, phone: c.phone, email: c.email, badge: c.badge, referred: c.referred })),
        eff_date: effDate || null, end_date: endDate || null,
      });
      toast.success('Changes saved', agTitle);
      onSaved();
    } catch (e) {
      const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error('Could not save', msg || 'Please try again.');
    }
  };

  // Persist the agreement + push it into the approval queue (Submit & Send for Approval).
  const submitForApproval = async (approval: { approvers: { name: string; email: string; role: string; mandatory: boolean }[]; days: number; reminder: number }) => {
    if (!agTitle.trim()) { toast.error('Missing title', 'Enter an agreement title in Step 2.'); return; }
    const payload = {
      title: agTitle, agreement_type: agType || null,
      org_name: org?.name ?? null, org_short_code: org?.shortCode ?? null, org_state: org?.state ?? null, org_country: org?.country ?? null,
      counterparties: cps.map(c => ({ name: c.name, country: c.country, phone: c.phone, email: c.email, badge: c.badge, referred: c.referred })),
      eff_date: effDate || null, end_date: endDate || null,
      content: draft || null, header_config: header, footer_config: footer,
      approvers: approval.approvers, days_to_approve: approval.days, reminder_days: approval.reminder,
    };
    try {
      const res = await api.post('/clm/ctc-contracts', payload);
      const newId = Number((res.data?.data as { dbId?: number } | undefined)?.dbId ?? 0) || null;
      toast.success('Sent for approval', `${agTitle} is now in the approval queue.`);
      setSentForApproval(true);
      setWorkingId(newId);
      await refreshRecord(newId);
      goStage(2);
    } catch (e) {
      toast.error('Could not submit', errMsg(e) || 'Please try again.');
    }
  };

  // ── Lifecycle transitions (sender side) ──
  // After a rejection: push the corrected draft back for internal review.
  const resubmitDraft = async () => {
    if (!workingId) return;
    if (!agTitle.trim()) { toast.error('Missing title', 'Enter an agreement title in Step 2.'); setStage(1); return; }
    try {
      await api.post(`/clm/ctc-contracts/${workingId}/resubmit`, { content: draft || null, title: agTitle, header_config: header, footer_config: footer });
      toast.success('Resubmitted', 'Revised draft sent back for internal review.');
      await refreshRecord();
      goStage(2);
    } catch (e) { toast.error('Could not resubmit', errMsg(e) || 'Please try again.'); }
  };

  // Approved → send to the chosen counterparties for signature & negotiation.
  const sendForSigning = async (recipients: { name: string; email: string; role: string; contact: string }[], days: number | null) => {
    if (!workingId) return;
    try {
      await api.post(`/clm/ctc-contracts/${workingId}/send-for-signing`, { recipients, days_to_sign: days });
      toast.success('Sent for signing', 'Agreement shared with the counterparties.');
      await refreshRecord();
      goStage(3);
    } catch (e) { toast.error('Could not send', errMsg(e) || 'Please try again.'); }
  };

  const recordSignature = async (payload: { index?: number; all?: boolean }) => {
    if (!workingId) return;
    try { await api.post(`/clm/ctc-contracts/${workingId}/record-signature`, payload); await refreshRecord(); }
    catch (e) { toast.error('Could not update', errMsg(e) || 'Please try again.'); }
  };

  // All parties signed → store in the Final Contract Repository.
  const moveToRepository = async () => {
    if (!workingId) return;
    try {
      await api.post(`/clm/ctc-contracts/${workingId}/move-to-repository`, {});
      toast.success('Moved', 'Stored in the final contract repository.');
      await refreshRecord();
      goStage(4);
    } catch (e) { toast.error('Could not move', errMsg(e) || 'Please try again.'); }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9000, background: t.dark ? '#0d0a1a' : '#F0F0FA', overflowY: 'auto', fontFamily: "'Rubik', system-ui, sans-serif", WebkitFontSmoothing: 'antialiased' }}>
      <style>{CTC_FORM_CSS}</style>
      <MasterFormStyles />
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
              cps={cps} orgs={orgs} agTypes={agTypes} agTypesLoading={agTypesLoading} org={org} orgOpen={orgOpen} setOrgOpen={setOrgOpen}
              onAddCp={() => setPicker(true)} onRemoveCp={(idx) => setCps(cps.filter((_, j) => j !== idx))}
              onSelectOrg={(o) => { setOrg(o); setOrgOpen(false); }} onResetOrg={() => setOrg(null)}
              agTitle={agTitle} setAgTitle={setAgTitle} agType={agType} setAgType={setAgType}
              effDate={effDate} setEffDate={setEffDate} endDate={endDate} setEndDate={setEndDate}
              draft={draft} setDraft={setDraft}
              header={header} setHeader={setHeader} footer={footer} setFooter={setFooter}
              isEditing={!!editing?.dbId} onUpdate={saveEdit}
              onSubmitForApproval={submitForApproval}
              resubmitMode={!!workingId && approval === 'rejected'} onResubmit={resubmitDraft}
              onNext={() => goStage(2)}
            />
          )}
          {stage > 1 && <StageReview t={t} stage={stage} cps={cps} org={org} agTitle={agTitle} agType={agType} effDate={effDate} endDate={endDate} draft={draft} header={header} footer={footer} sentForApproval={sentForApproval} workingId={workingId} record={record} approval={approval} onResubmitEdit={() => goStage(1)} onSendForSigning={sendForSigning} onRecordSignature={recordSignature} onMoveToRepository={moveToRepository} onRefresh={refreshRecord} onBack={() => goStage(stage - 1)} onNext={() => goStage(stage + 1)} onSave={save} />}
        </div>
      </div>

      {picker && (
        <CpPicker t={t} slot={cps.length + 1} onClose={() => setPicker(false)} onPick={(cp) => { setCps([...cps, cp]); setPicker(false); }} />
      )}
    </div>
  );
}

/* ── Stage 1 three-panel workspace ── */
function Stage1(p: {
  t: OpsTokens;
  cps: CP[]; orgs: Org[]; agTypes: { value: string; label: string }[]; agTypesLoading: boolean; org: Org | null; orgOpen: boolean; setOrgOpen: (b: boolean) => void;
  onAddCp: () => void; onRemoveCp: (idx: number) => void; onSelectOrg: (o: Org) => void; onResetOrg: () => void;
  agTitle: string; setAgTitle: (s: string) => void; agType: string; setAgType: (s: string) => void;
  effDate: string; setEffDate: (s: string) => void; endDate: string; setEndDate: (s: string) => void;
  draft: string; setDraft: (s: string) => void;
  header: HeaderConfig; setHeader: (h: HeaderConfig) => void; footer: FooterConfig; setFooter: (f: FooterConfig) => void;
  isEditing: boolean; onUpdate: () => void;
  onSubmitForApproval: (approval: { approvers: { name: string; email: string; role: string; mandatory: boolean }[]; days: number; reminder: number }) => void;
  resubmitMode: boolean; onResubmit: () => void;
  onNext: () => void;
}) {
  const t = p.t;
  const cp1 = p.cps[0] ?? null;
  const cp2 = p.cps[1] ?? null;
  const [cpPage, setCpPage] = useState(0);                        // left-panel CP carousel (2 at a time)
  const [midCpPage, setMidCpPage] = useState(0);                  // middle Step-1 CP carousel (2 at a time)
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [midStep, setMidStep] = useState<1 | 2 | 3>(1);          // inner Step 01 / 02 / 03
  const [renewal, setRenewal] = useState<'yes' | 'no'>('yes');
  const [renewalType, setRenewalType] = useState<'manual' | 'auto'>('manual');
  const [termNotice, setTermNotice] = useState('30');
  const [editorFs, setEditorFs] = useState(false);              // draft editor full-screen
  // Page-shell header/footer config (logo, header name, footer text, pagination) —
  // lifted to the parent so the Stage-2 preview shares the same config.
  const header = p.header, setHeader = p.setHeader, footer = p.footer, setFooter = p.setFooter;
  const [phOpen, setPhOpen] = useState(false);                  // placeholder picker
  const [clauseOpen, setClauseOpen] = useState(false);          // clause library picker
  const [approvalOpen, setApprovalOpen] = useState(false);      // Review & Approval Workflow popup
  // contentEditable draft editor (mirrors the Agreement / Trade-Document editors:
  // native execCommand, caret stashing, placeholder/clause/upload-docx insertion).
  const editorRef = useRef<HTMLDivElement | null>(null);
  const lastRange = useRef<Range | null>(null);
  const docxRef = useRef<HTMLInputElement | null>(null);
  // Seed the editor's HTML once it appears (Step 3) without clobbering it on every keystroke.
  useEffect(() => {
    if (midStep === 3 && editorRef.current && editorRef.current.innerHTML !== p.draft) editorRef.current.innerHTML = p.draft || '';
  }, [midStep]); // eslint-disable-line react-hooks/exhaustive-deps
  // Stash the caret whenever the selection sits inside the editor.
  useEffect(() => {
    const onSel = () => {
      const sel = window.getSelection();
      if (sel && sel.rangeCount && editorRef.current && editorRef.current.contains(sel.anchorNode)) lastRange.current = sel.getRangeAt(0).cloneRange();
    };
    document.addEventListener('selectionchange', onSel);
    return () => document.removeEventListener('selectionchange', onSel);
  }, []);
  const syncDraft = () => { if (editorRef.current) p.setDraft(editorRef.current.innerHTML); };
  const restoreCaret = () => {
    const el = editorRef.current; if (!el) return; el.focus();
    const sel = window.getSelection(); if (!sel) return;
    if (lastRange.current && el.contains(lastRange.current.commonAncestorContainer)) { sel.removeAllRanges(); sel.addRange(lastRange.current); }
    else { const r = document.createRange(); r.selectNodeContents(el); r.collapse(false); sel.removeAllRanges(); sel.addRange(r); }
  };
  const insertText = (text: string) => { restoreCaret(); document.execCommand('insertText', false, text + ' '); syncDraft(); };
  const insertHtml = (html: string) => { restoreCaret(); document.execCommand('insertHTML', false, html); syncDraft(); };
  const exec = (cmd: string, val?: string) => { editorRef.current?.focus(); document.execCommand(cmd, false, val); syncDraft(); };
  const uploadDocx = async (file: File) => {
    const fd = new FormData(); fd.append('docx', file);
    try {
      const res = await api.post('/clm/docx-to-html', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      const html = String(res.data?.html ?? '');
      if (editorRef.current) editorRef.current.innerHTML = html;
      p.setDraft(html);
    } catch { /* keep current content if parsing fails */ }
  };
  const ipt: React.CSSProperties = { width: '100%', height: 34, padding: '0 12px', border: `1.5px solid ${t.searchBorder}`, borderRadius: 9, fontSize: 11, fontFamily: 'inherit', color: t.text, outline: 'none', background: t.dark ? 'rgba(255,255,255,.04)' : '#fff', boxSizing: 'border-box' };
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
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 10, padding: 12, overflowY: 'auto' }}>
            {(() => {
              const total = p.cps.length;
              const pages = Math.max(1, Math.ceil(total / 2));
              const safe = Math.min(cpPage, pages - 1);
              const visible = p.cps.slice(safe * 2, safe * 2 + 2);
              const navBtn = (dir: 'l' | 'r', dis: boolean, onClick: () => void) => (
                <button onClick={onClick} disabled={dis} title={dir === 'l' ? 'Previous' : 'Next'} style={{ width: 26, height: 26, borderRadius: 8, flexShrink: 0, border: `1.5px solid ${t.dark ? 'rgba(124,58,237,.3)' : '#DDD6FE'}`, background: dis ? 'transparent' : (t.dark ? 'rgba(124,58,237,.14)' : '#F5F0FF'), cursor: dis ? 'not-allowed' : 'pointer', opacity: dis ? .4 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={t.dark ? '#c4b5fd' : '#7C3AED'} strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">{dir === 'l' ? <polyline points="15 18 9 12 15 6" /> : <polyline points="9 18 15 12 9 6" />}</svg>
                </button>
              );
              return (
                <>
                  {total > 2 && (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                      {navBtn('l', safe === 0, () => setCpPage(Math.max(0, safe - 1)))}
                      <span style={{ fontSize: 8.5, fontWeight: 700, color: t.textMuted }}>Showing {safe * 2 + 1}–{Math.min(safe * 2 + 2, total)} of {total}</span>
                      {navBtn('r', safe >= pages - 1, () => setCpPage(Math.min(pages - 1, safe + 1)))}
                    </div>
                  )}
                  {visible.map((cp, vi) => {
                    const idx = safe * 2 + vi;
                    return <CpCard key={idx} t={t} slot={idx + 1} cp={cp} onRemove={() => p.onRemoveCp(idx)} />;
                  })}
                  <button onClick={p.onAddCp} style={{ border: `1.5px dashed ${t.dark ? 'rgba(124,58,237,.4)' : '#C4B5FD'}`, borderRadius: 10, width: '100%', padding: '10px 14px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, background: 'transparent', cursor: 'pointer', fontFamily: 'inherit' }}>
                    <div style={{ width: 18, height: 18, borderRadius: '50%', background: 'linear-gradient(135deg,#7C3AED,#A78BFA)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg></div>
                    <span style={{ fontSize: 9, fontWeight: 700, color: t.dark ? '#c4b5fd' : '#7C3AED' }}>{total === 0 ? 'Add Counter Party' : 'Add more Counter Party'}</span>
                  </button>
                </>
              );
            })()}
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
                    <OrgDetail t={t} label="Country" text={p.org.country} /><OrgDetail t={t} label="State" text={p.org.state} /><OrgDetail t={t} label="Short Code" text={p.org.shortCode} />
                  </div>
                </div>
              )}
              {p.orgOpen && !p.org && (
                <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 6, background: t.surface, border: `1.5px solid ${t.dark ? 'rgba(124,58,237,.3)' : '#DDD6FE'}`, borderRadius: 14, boxShadow: '0 12px 36px rgba(109,40,217,.18)', maxHeight: 260, overflowY: 'auto', zIndex: 50, padding: 7 }}>
                  {p.orgs.length === 0 ? (
                    <div style={{ padding: '14px 12px', textAlign: 'center', fontSize: 9.5, fontWeight: 600, color: t.textMuted }}>No companies in the Company Details master yet.</div>
                  ) : p.orgs.map(o => (
                    <div key={o.id} onClick={() => p.onSelectOrg(o)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px', borderRadius: 9, cursor: 'pointer', marginBottom: 2 }}
                      onMouseEnter={e => (e.currentTarget.style.background = t.dark ? 'rgba(124,58,237,.14)' : '#F5F3FF')} onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                      <div style={{ width: 32, height: 32, borderRadius: 9, background: `linear-gradient(135deg,${o.grad})`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><span style={{ fontSize: 9.5, fontWeight: 800, color: '#fff' }}>{o.initials}</span></div>
                      <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 11, fontWeight: 800, color: t.textStrong, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{o.name}</div><div style={{ fontSize: 9, color: t.dark ? '#a78bfa' : '#9D76E0', fontWeight: 500, marginTop: 1 }}>{o.shortCode} · {o.state} · {o.country}</div></div>
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
                {p.cps.length === 0 ? (
                  <ReadEmpty t={t} title="No Counterparties Added Yet" sub="Add Counter Parties from the left panel to see their details here."
                    chips={[`CP 1 — ${cp1 ? 'Added' : 'Not Added'}`, `CP 2 — ${cp2 ? 'Added' : 'Not Added'}`, `Org — ${p.org ? 'Selected' : 'Not Selected'}`]} />
                ) : (() => {
                  const total = p.cps.length;
                  const pages = Math.max(1, Math.ceil(total / 2));
                  const safe = Math.min(midCpPage, pages - 1);
                  const visible = p.cps.slice(safe * 2, safe * 2 + 2);
                  const arrow = (dir: 'l' | 'r', dis: boolean, onClick: () => void) => (
                    <button onClick={onClick} disabled={dis} title={dir === 'l' ? 'Previous' : 'Next'} style={{ width: 30, height: 30, flexShrink: 0, alignSelf: 'center', borderRadius: 8, border: `1.5px solid ${t.dark ? 'rgba(124,58,237,.3)' : '#DDD6FE'}`, background: dis ? 'transparent' : (t.dark ? 'rgba(124,58,237,.14)' : '#F5F0FF'), cursor: dis ? 'not-allowed' : 'pointer', opacity: dis ? .35 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={t.dark ? '#c4b5fd' : '#7C3AED'} strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">{dir === 'l' ? <polyline points="15 18 9 12 15 6" /> : <polyline points="9 18 15 12 9 6" />}</svg>
                    </button>
                  );
                  return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {total > 2 && arrow('l', safe === 0, () => setMidCpPage(Math.max(0, safe - 1)))}
                        <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, minWidth: 0 }}>
                          {visible.map((cp, vi) => <CpReadCard key={safe * 2 + vi} t={t} idx={safe * 2 + vi + 1} cp={cp} />)}
                        </div>
                        {total > 2 && arrow('r', safe >= pages - 1, () => setMidCpPage(Math.min(pages - 1, safe + 1)))}
                      </div>
                      {total > 2 && (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                          {Array.from({ length: pages }, (_, i) => (
                            <button key={i} onClick={() => setMidCpPage(i)} style={{ width: i === safe ? 18 : 7, height: 7, borderRadius: 4, border: 'none', padding: 0, cursor: 'pointer', background: i === safe ? 'linear-gradient(90deg,#7C3AED,#A78BFA)' : (t.dark ? 'rgba(148,163,184,.3)' : '#DDD6FE'), transition: 'width .2s' }} />
                          ))}
                          <span style={{ fontSize: 8.5, fontWeight: 700, color: t.textMuted, marginLeft: 4 }}>Showing {safe * 2 + 1}–{Math.min(safe * 2 + 2, total)} of {total}</span>
                        </div>
                      )}
                    </div>
                  );
                })()}
                <SectionBar t={t} label="Our Organisation" readOnly />
                {!p.org ? (
                  <ReadEmpty t={t} title="Organisation not selected" sub="Please select your organisation from the left panel." chips={[]} />
                ) : (
                  <div style={{ borderRadius: 14, overflow: 'hidden', border: `1.5px solid ${t.dark ? 'rgba(124,58,237,.25)' : '#EDE9FE'}`, background: t.surface, boxShadow: '0 4px 16px rgba(109,40,217,.08)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', background: `linear-gradient(118deg,${p.org.grad})` }}>
                      <div style={{ width: 40, height: 40, borderRadius: 11, background: 'rgba(255,255,255,.2)', border: '1.5px solid rgba(255,255,255,.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><span style={{ fontSize: 13, fontWeight: 800, color: '#fff' }}>{p.org.initials}</span></div>
                      <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 13.5, fontWeight: 800, color: '#fff' }}>{p.org.name}</div><div style={{ fontSize: 9.5, color: 'rgba(255,255,255,.7)', fontWeight: 500 }}>Short Code: {p.org.shortCode}</div></div>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 20, background: 'rgba(255,255,255,.18)', border: '1px solid rgba(255,255,255,.3)' }}><span style={{ width: 6, height: 6, borderRadius: '50%', background: '#34d399' }} /><span style={{ fontSize: 9, fontWeight: 800, color: '#fff' }}>Active</span></span>
                    </div>
                    <div style={{ padding: '10px 16px', display: 'flex', flexWrap: 'wrap', gap: 16 }}>
                      {[['Company Name', p.org.name], ['Short Code', p.org.shortCode], ['Country', p.org.country], ['State', p.org.state]].map(([k, v]) => (
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
                      <MasterSelect value={p.agType} onChange={p.setAgType} options={p.agTypes} loading={p.agTypesLoading} placeholder={p.agTypesLoading ? 'Loading…' : (p.agTypes.length ? 'Select type…' : 'No agreement types in master')} />
                    </Field>
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
                      <Field t={t} label="Effective Date *" green><MasterDatePicker value={p.effDate} onChange={p.setEffDate} placeholder="Select date" /></Field>
                      <Field t={t} label="End Date *" green><MasterDatePicker value={p.endDate} onChange={p.setEndDate} minDate={p.effDate || undefined} placeholder="Select date" /></Field>
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
              <div style={editorFs
                ? { position: 'fixed', inset: 16, zIndex: 400, background: t.surface, borderRadius: 14, border: `1.5px solid ${t.dark ? 'rgba(124,58,237,.4)' : '#C4B5FD'}`, overflow: 'hidden', boxShadow: '0 30px 80px rgba(8,3,28,.5)', display: 'flex', flexDirection: 'column' }
                : { background: t.surface, borderRadius: 14, border: `1.5px solid ${t.dark ? 'rgba(124,58,237,.25)' : '#EDE9FE'}`, overflow: 'hidden', boxShadow: '0 2px 12px rgba(109,40,217,.08)', display: 'flex', flexDirection: 'column' }}>
                {/* header with actions */}
                <div style={{ padding: '12px 14px', background: 'linear-gradient(118deg,#3B0764 0%,#5B21B6 35%,#7C3AED 65%,#8B5CF6 100%)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexShrink: 0, flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 30, height: 30, borderRadius: 9, background: 'rgba(255,255,255,.18)', border: '1.5px solid rgba(255,255,255,.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4z" /></svg></div>
                    <div><div style={{ fontSize: 7, fontWeight: 800, letterSpacing: '.15em', textTransform: 'uppercase', color: 'rgba(255,255,255,.6)' }}>Stage 03</div><div style={{ fontSize: 12.5, fontWeight: 800, color: '#fff' }}>Draft Agreement Content</div><div style={{ fontSize: 8, fontWeight: 500, color: 'rgba(255,255,255,.65)' }}>Write or paste your agreement text below</div></div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <input ref={docxRef} type="file" accept=".doc,.docx" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) uploadDocx(f); e.target.value = ''; }} />
                    <FrostBtn onClick={() => docxRef.current?.click()} icon={<><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></>}>Upload Doc</FrostBtn>
                    <FrostBtn onClick={() => setPhOpen(true)} icon={<><polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" /></>}>{'{} Placeholder'}</FrostBtn>
                    <FrostBtn onClick={() => setClauseOpen(true)} icon={<><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></>}>Clause Library</FrostBtn>
                    <FrostBtn active onClick={() => setEditorFs(v => !v)} icon={editorFs ? <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3" /> : <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />}>{editorFs ? 'Exit Full Screen' : 'Full Screen'}</FrostBtn>
                  </div>
                </div>
                {/* full toolbar */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 1, padding: '6px 10px', borderBottom: `1px solid ${t.dark ? 'rgba(124,58,237,.18)' : '#F1EEFF'}`, background: t.dark ? 'rgba(255,255,255,.02)' : '#FAFBFF', flexWrap: 'wrap' }}>
                  <select defaultValue="12" onChange={e => exec('fontSize', ({ '10': '1', '11': '2', '12': '3', '14': '4', '16': '5', '18': '6' } as Record<string, string>)[e.target.value] || '3')} style={{ height: 24, padding: '0 4px', borderRadius: 5, border: `1px solid ${t.dark ? 'rgba(124,58,237,.3)' : '#E4DEFF'}`, fontSize: 9, fontFamily: 'inherit', color: t.dark ? '#c4b5fd' : '#4C1D95', background: t.dark ? 'rgba(255,255,255,.04)' : '#F8F6FF', cursor: 'pointer', marginRight: 3 }}>{['10', '11', '12', '14', '16', '18'].map(s => <option key={s}>{s}</option>)}</select>
                  <select defaultValue="Paragraph" onChange={e => exec('formatBlock', ({ 'Paragraph': 'p', 'Heading 1': 'h1', 'Heading 2': 'h2', 'Heading 3': 'h3' } as Record<string, string>)[e.target.value] || 'p')} style={{ height: 24, padding: '0 5px', borderRadius: 5, border: `1px solid ${t.dark ? 'rgba(124,58,237,.3)' : '#E4DEFF'}`, fontSize: 9, fontFamily: 'inherit', color: t.dark ? '#c4b5fd' : '#4C1D95', background: t.dark ? 'rgba(255,255,255,.04)' : '#F8F6FF', cursor: 'pointer', marginRight: 5, minWidth: 72 }}>{['Paragraph', 'Heading 1', 'Heading 2', 'Heading 3'].map(s => <option key={s}>{s}</option>)}</select>
                  <ToolDiv t={t} />
                  {([['B', 'bold'], ['I', 'italic'], ['U', 'underline'], ['S', 'strikeThrough']] as const).map(([b, cmd]) => <button key={b} type="button" title={b} onMouseDown={e => e.preventDefault()} onClick={() => exec(cmd)} style={{ width: 24, height: 24, borderRadius: 5, border: 'none', background: 'none', cursor: 'pointer', fontSize: 11, fontWeight: b === 'B' ? 900 : 600, fontStyle: b === 'I' ? 'italic' : 'normal', textDecoration: b === 'U' ? 'underline' : b === 'S' ? 'line-through' : 'none', color: t.dark ? '#c4b5fd' : '#4C1D95', fontFamily: 'Georgia, serif' }} onMouseEnter={e => (e.currentTarget.style.background = t.dark ? 'rgba(124,58,237,.18)' : '#EDE9FE')} onMouseLeave={e => (e.currentTarget.style.background = 'none')}>{b}</button>)}
                  <ToolDiv t={t} />
                  <ToolBtn t={t} title="Align left" onClick={() => exec('justifyLeft')}><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="15" y2="12" /><line x1="3" y1="18" x2="18" y2="18" /></ToolBtn>
                  <ToolBtn t={t} title="Align center" onClick={() => exec('justifyCenter')}><line x1="3" y1="6" x2="21" y2="6" /><line x1="6" y1="12" x2="18" y2="12" /><line x1="4" y1="18" x2="20" y2="18" /></ToolBtn>
                  <ToolBtn t={t} title="Align right" onClick={() => exec('justifyRight')}><line x1="3" y1="6" x2="21" y2="6" /><line x1="9" y1="12" x2="21" y2="12" /><line x1="6" y1="18" x2="21" y2="18" /></ToolBtn>
                  <ToolBtn t={t} title="Justify" onClick={() => exec('justifyFull')}><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></ToolBtn>
                  <ToolDiv t={t} />
                  <ToolBtn t={t} title="Bullet list" onClick={() => exec('insertUnorderedList')}><line x1="9" y1="6" x2="20" y2="6" /><line x1="9" y1="12" x2="20" y2="12" /><line x1="9" y1="18" x2="20" y2="18" /><circle cx="4" cy="6" r="1.5" fill="currentColor" /><circle cx="4" cy="12" r="1.5" fill="currentColor" /><circle cx="4" cy="18" r="1.5" fill="currentColor" /></ToolBtn>
                  <ToolBtn t={t} title="Numbered list" onClick={() => exec('insertOrderedList')}><line x1="10" y1="6" x2="21" y2="6" /><line x1="10" y1="12" x2="21" y2="12" /><line x1="10" y1="18" x2="21" y2="18" /><path d="M4 6h1v4" /><path d="M4 10h2" /></ToolBtn>
                  <ToolBtn t={t} title="Indent" onClick={() => exec('indent')}><line x1="3" y1="6" x2="21" y2="6" /><polyline points="3 12 8 16 3 20" /><line x1="10" y1="12" x2="21" y2="12" /><line x1="10" y1="18" x2="21" y2="18" /></ToolBtn>
                  <ToolBtn t={t} title="Outdent" onClick={() => exec('outdent')}><line x1="3" y1="6" x2="21" y2="6" /><polyline points="11 12 6 16 11 20" /><line x1="13" y1="12" x2="21" y2="12" /><line x1="13" y1="18" x2="21" y2="18" /></ToolBtn>
                  <ToolDiv t={t} />
                  <ToolBtn t={t} title="Insert link" onClick={() => { const u = window.prompt('Link URL'); if (u) exec('createLink', u); }}><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></ToolBtn>
                  <ToolBtn t={t} title="Undo" onClick={() => exec('undo')}><polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 1 0 .49-4.95" /></ToolBtn>
                  <ToolBtn t={t} title="Redo" onClick={() => exec('redo')}><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-.49-4.95" /></ToolBtn>
                </div>
                <div style={{ flex: editorFs ? 1 : undefined, minHeight: editorFs ? 0 : 280, overflowY: 'auto', background: t.dark ? '#100c1c' : '#eef0f6', padding: 14 }}>
                  <HeaderFooterPanel header={header} setHeader={setHeader} footer={footer} setFooter={setFooter} uploadLogoEndpoint="/clm/trade-doc-library/upload-header-logo">
                    <div ref={editorRef} className="ctc-editor" contentEditable suppressContentEditableWarning data-ph="Start drafting your agreement content here…  This Agreement is entered into between [Counter Party 1] and [Counter Party 2]…" onInput={syncDraft} onBlur={syncDraft} style={{ minHeight: 220, padding: '14px 16px', border: 'none', outline: 'none', fontSize: 12, fontFamily: 'inherit', color: '#1f2937', lineHeight: 1.8, background: '#fff', boxSizing: 'border-box' }} />
                  </HeaderFooterPanel>
                </div>
                {/* footer hint */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 12px', background: t.dark ? 'rgba(255,255,255,.02)' : '#FAFBFF', borderTop: `1px solid ${t.dark ? 'rgba(124,58,237,.18)' : '#F1EEFF'}`, flexShrink: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#A78BFA" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg><span style={{ fontSize: 8, color: t.dark ? '#a78bfa' : '#A78BFA', fontWeight: 500, fontStyle: 'italic' }}>Placeholders auto-fill on agreement generation</span></div>
                  <span style={{ fontSize: 8, fontWeight: 700, color: t.dark ? '#a78bfa' : '#C4B5FD', letterSpacing: '.05em' }}>{'{{PLACEHOLDER}}'}</span>
                </div>
                {phOpen && <ClmInsertPlaceholderModal open={phOpen} onClose={() => setPhOpen(false)} onInsert={tok => insertText(tok)} />}
                {clauseOpen && <ClmClauseInsertPanel onClose={() => setClauseOpen(false)} onInsert={html => insertHtml(html)} />}
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
            {midStep < 3 ? (
              <button onClick={midNext} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 9, background: 'linear-gradient(135deg,#4F46E5,#7C3AED)', border: 'none', cursor: 'pointer', fontFamily: 'inherit', boxShadow: '0 3px 10px rgba(79,70,229,.35)' }}>
                <span style={{ fontSize: 9.5, fontWeight: 700, color: '#fff' }}>{MID_STEPS[midStep - 1].next}</span>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.8" strokeLinecap="round"><polyline points="9 18 15 12 9 6" /></svg>
              </button>
            ) : p.resubmitMode ? (
              <button onClick={p.onResubmit} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '9px 18px', borderRadius: 9, background: 'linear-gradient(135deg,#B45309,#D97706,#F59E0B)', border: 'none', cursor: 'pointer', fontFamily: 'inherit', boxShadow: '0 4px 14px rgba(217,119,6,.4)' }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round"><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" /></svg>
                <span style={{ fontSize: 10, fontWeight: 800, color: '#fff' }}>Resubmit for Review</span>
              </button>
            ) : p.isEditing ? (
              <button onClick={p.onUpdate} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '9px 18px', borderRadius: 9, background: 'linear-gradient(135deg,#059669,#047857)', border: 'none', cursor: 'pointer', fontFamily: 'inherit', boxShadow: '0 4px 14px rgba(5,150,105,.4)' }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round"><polyline points="20 6 9 17 4 12" /></svg>
                <span style={{ fontSize: 10, fontWeight: 800, color: '#fff' }}>Save Changes</span>
              </button>
            ) : (
              <button onClick={() => setApprovalOpen(true)} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '9px 18px', borderRadius: 9, background: 'linear-gradient(135deg,#4C1D95,#6D28D9,#7C3AED)', border: 'none', cursor: 'pointer', fontFamily: 'inherit', boxShadow: '0 4px 14px rgba(109,40,217,.4)' }}>
                <span style={{ fontSize: 10, fontWeight: 800, color: '#fff' }}>Submit &amp; Send for Approval</span>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
              </button>
            )}
          </div>
        </Panel>
      </div>
      {approvalOpen && <ApprovalWorkflowModal t={t} orgName={p.org?.name ?? 'Our Organisation'} onClose={() => setApprovalOpen(false)} onSubmit={(data) => { setApprovalOpen(false); p.onSubmitForApproval(data); }} />}

      {/* RIGHT — Summary */}
      <div style={{ flex: rightOpen ? 2.5 : '0 0 48px', minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', transition: 'flex .25s cubic-bezier(.22,1,.36,1)' }}>
        {!rightOpen ? <CollapsedBar t={t} title="Agreement Summary Details" headGrad="#6D28D9,#7C3AED,#8B5CF6,#A78BFA,#C4B5FD" dir="right" onExpand={() => setRightOpen(true)} /> :
        <Panel t={t} header="Panel 03" title="Agreement Summary Details" headGrad="#6D28D9,#7C3AED,#8B5CF6,#A78BFA,#C4B5FD" onCollapse={() => setRightOpen(false)} collapseDir="right">
          <RightTools t={t} draft={p.draft} onInsert={(tok) => { if (editorRef.current) insertText(tok); else p.setDraft((p.draft ? p.draft + ' ' : '') + tok); }} summary={[['Agreement', p.agTitle || '—'], ['Type', p.agType || '—'], ['Eff. Date', p.effDate || '—'], ['End Date', p.endDate || '—'], ['Counterparties', p.cps.length ? `${p.cps.length} added` : '—'], ['CP 1', cp1?.name || '—'], ['Organisation', p.org?.name || '—']]} />
        </Panel>}
      </div>
    </div>
  );
}

/* ── Stages 2–4: shared LEFT (read-only counterparty) + RIGHT (review) panels, changing MIDDLE ── */
type SignRecipient = { name: string; email: string; role: string; contact: string; signed: boolean; signed_at: string | null };

function StageReview({ t, stage, cps, org, agTitle, agType, effDate, endDate, draft, header, footer, sentForApproval, workingId, record, approval, onResubmitEdit, onSendForSigning, onRecordSignature, onMoveToRepository, onRefresh, onBack, onNext, onSave }: {
  t: OpsTokens; stage: number; cps: CP[]; org: Org | null; agTitle: string; agType: string; effDate: string; endDate: string; draft: string; header: HeaderConfig; footer: FooterConfig; sentForApproval: boolean;
  workingId: number | null; record: Record<string, unknown> | null; approval: string;
  onResubmitEdit: () => void;
  onSendForSigning: (recipients: { name: string; email: string; role: string; contact: string }[], days: number | null) => void;
  onRecordSignature: (payload: { index?: number; all?: boolean }) => void;
  onMoveToRepository: () => void; onRefresh: () => void;
  onBack: () => void; onNext: () => void; onSave: () => void;
}) {
  const [reminded, setReminded] = useState(false);
  const [signingOpen, setSigningOpen] = useState(false);
  const [vhOpen, setVhOpen] = useState(false);
  const versions = (Array.isArray(record?.versions) ? record!.versions : []) as CtcVersion[];
  const signers = (Array.isArray(record?.signing_recipients) ? record!.signing_recipients : []) as SignRecipient[];
  const allSigned = signers.length > 0 && signers.every(s => s.signed);
  const code = String((record?.code as string) ?? 'CTC');
  const rejReason = String((record?.rejection_reason as string) ?? '');
  const apprName = String((record?.primary_approver_name as string) ?? 'Approver');
  const apprInit = apprName.trim().split(/\s+/).map(w => w[0] || '').join('').slice(0, 2).toUpperCase() || 'AP';
  const MID = {
    2: { head: '#3B0764,#5B21B6,#7C3AED,#8B5CF6', sup: 'Panel 02 · Agreement Preview', title: 'Agreement Preview' },
    3: { head: '#0e7490,#0891b2,#06b6d4', sup: 'Panel 02 · Negotiation & Signing', title: 'Counterparty Negotiation & Signing' },
    4: { head: '#064E3B,#059669,#10B981', sup: 'Panel 02 · Signed Agreement', title: 'Final Contract Repository' },
  }[stage]!;
  const cp1 = cps[0] ?? null;
  const cp2 = cps[1] ?? null;
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
            {cps.map((cp, i) => <CpReadCard key={i} t={t} idx={i + 1} cp={cp} />)}
            {org && (
              <div style={{ borderRadius: 12, overflow: 'hidden', border: `1.5px solid ${t.dark ? 'rgba(124,58,237,.25)' : '#EDE9FE'}`, background: t.surface }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '10px 12px', background: `linear-gradient(118deg,${org.grad})` }}>
                  <div style={{ width: 32, height: 32, borderRadius: 9, background: 'rgba(255,255,255,.2)', border: '1.5px solid rgba(255,255,255,.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><span style={{ fontSize: 11, fontWeight: 800, color: '#fff' }}>{org.initials}</span></div>
                  <div style={{ minWidth: 0, flex: 1 }}><div style={{ fontSize: 8, fontWeight: 800, color: 'rgba(255,255,255,.7)', textTransform: 'uppercase', letterSpacing: '.08em' }}>Our Organisation</div><div style={{ fontSize: 12, fontWeight: 800, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{org.name}</div></div>
                </div>
                <div style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {[['Short Code', org.shortCode], ['Country', org.country], ['State', org.state]].map(([k, v]) => (
                    <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><span style={{ fontSize: 8, fontWeight: 700, color: t.textMuted, textTransform: 'uppercase', letterSpacing: '.04em' }}>{k}</span><span style={{ fontSize: 9.5, color: t.textSub, fontWeight: 600 }}>{v}</span></div>
                  ))}
                </div>
              </div>
            )}
            {cps.length === 0 && !org && <div style={{ fontSize: 10, color: t.textMuted, textAlign: 'center', padding: 20 }}>No counterparty details captured.</div>}
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
            <span onClick={() => setVhOpen(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 9px', borderRadius: 20, background: 'rgba(255,255,255,.15)', border: '1px solid rgba(255,255,255,.25)', cursor: 'pointer' }}><svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.9)" strokeWidth="2.2" strokeLinecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg><span style={{ fontSize: 7.5, fontWeight: 700, color: 'rgba(255,255,255,.9)' }}>Download</span></span>
          </div>
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', background: t.dark ? '#100c1c' : '#F0EFF8', padding: '18px 24px' }}>
            <div style={{ maxWidth: 600, margin: '0 auto', background: t.dark ? '#1a1530' : '#fff', borderRadius: 6, boxShadow: '0 2px 12px rgba(0,0,0,.1)', padding: '36px 40px', position: 'relative' }}>
              <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 5, background: stage === 4 ? 'linear-gradient(90deg,#047857,#059669,#10B981)' : 'linear-gradient(90deg,#4C1D95,#7C3AED,#A78BFA)', borderRadius: '6px 6px 0 0' }} />
              {/* Configured document header (logo + name) from Stage 1 */}
              {(header.show_logo || header.show_title) && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 14, justifyContent: header.align === 'center' ? 'center' : header.align === 'right' ? 'flex-end' : 'flex-start', padding: '6px 12px', marginBottom: 14, borderRadius: 6, borderBottom: '2px solid rgba(124,58,237,.18)', background: header.background, color: header.text_color }}>
                  {header.show_logo && header.logo_url && <img src={header.logo_url} alt="logo" style={{ maxHeight: Math.max(24, Math.min(200, header.logo_height ?? 62)), objectFit: 'contain' }} />}
                  {header.show_title && <div style={{ textAlign: header.align, minWidth: 0 }}><div style={{ fontSize: 14, fontWeight: 800, lineHeight: 1.2 }}>{header.title}</div>{header.subtitle && <div style={{ fontSize: 9, opacity: .7, marginTop: 1 }}>{header.subtitle}</div>}</div>}
                </div>
              )}
              <div style={{ textAlign: 'center', marginBottom: 22 }}>
                <span style={{ display: 'inline-block', padding: '3px 12px', borderRadius: 20, background: t.dark ? 'rgba(124,58,237,.2)' : 'linear-gradient(135deg,#EDE9FE,#DDD6FE)', border: `1px solid ${t.dark ? 'rgba(124,58,237,.4)' : '#C4B5FD'}`, marginBottom: 8 }}><span style={{ fontSize: 8, fontWeight: 800, color: t.dark ? '#c4b5fd' : '#6D28D9', letterSpacing: '.15em' }}>{code}</span></span>
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
              {draft
                ? <div className="ctc-editor" style={{ fontSize: 10, color: t.textSub, lineHeight: 1.7, marginTop: 10 }} dangerouslySetInnerHTML={{ __html: draft }} />
                : <div style={{ fontSize: 10, color: t.textSub, lineHeight: 1.7, marginTop: 10 }}>Each party may be referred to individually as a "Party" and collectively as the "Parties". The Parties wish to explore a potential business relationship relating to {'{{business_purpose}}'} (the "Purpose").</div>}
              {/* Configured document footer (text + pagination) from Stage 1 */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', alignItems: 'center', gap: 6, marginTop: 26, paddingTop: 10, borderTop: '1.5px solid rgba(124,58,237,.18)', background: footer.background, color: footer.text_color, fontSize: 9, fontWeight: 500 }}>
                {(['left', 'center', 'right'] as const).map(cell => {
                  const pn = footer.page_number_format === 'N' ? '1' : footer.page_number_format === 'Page N' ? 'Page 1' : footer.page_number_format === 'N / M' ? '1 / 1' : 'Page 1 of 1';
                  return (
                    <div key={cell} style={{ textAlign: cell, display: 'flex', alignItems: 'center', gap: 6, justifyContent: cell === 'center' ? 'center' : cell === 'right' ? 'flex-end' : 'flex-start' }}>
                      {footer.align === cell && <span>{footer.text}</span>}
                      {footer.show_page_number && footer.page_number_align === cell && <span style={{ fontWeight: 600 }}>{pn}</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
          {/* footer nav */}
          <div style={{ flexShrink: 0, padding: '10px 16px', background: t.surface, borderTop: `1.5px solid ${t.dark ? 'rgba(124,58,237,.2)' : '#EDE9FE'}`, display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {/* Stage 2 — Internal Review & Approval outcomes */}
              {stage === 2 && approval === 'rejected' && (
                <button onClick={onResubmitEdit} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 18px', borderRadius: 9, background: 'linear-gradient(135deg,#B45309,#D97706,#F59E0B)', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 9.5, fontWeight: 800, color: '#fff', boxShadow: '0 3px 10px rgba(217,119,6,.35)' }}><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z" /></svg> Edit &amp; Resubmit for Review</button>
              )}
              {stage === 2 && approval === 'approved' && (
                <button onClick={() => setSigningOpen(true)} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 18px', borderRadius: 9, background: 'linear-gradient(135deg,#0e7490,#0891b2,#06b6d4)', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 9.5, fontWeight: 800, color: '#fff', boxShadow: '0 3px 10px rgba(8,145,178,.35)' }}><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg> Send for Signing &amp; Negotiation</button>
              )}
              {stage === 2 && approval !== 'approved' && approval !== 'rejected' && (
                <button disabled title="Waiting for the approver's decision" style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 18px', borderRadius: 9, background: t.dark ? 'rgba(255,255,255,.04)' : '#F1F5F9', border: `1.5px solid ${t.dark ? 'rgba(148,163,184,.2)' : '#E2E8F0'}`, cursor: 'not-allowed', fontFamily: 'inherit', fontSize: 9.5, fontWeight: 800, color: t.textMuted }}><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg> Awaiting Approval</button>
              )}
              {/* Stage 3 — Counterparty signing */}
              {stage === 3 && !allSigned && (
                <button onClick={() => onRecordSignature({ all: true })} disabled={signers.length === 0} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 18px', borderRadius: 9, background: signers.length === 0 ? (t.dark ? 'rgba(255,255,255,.04)' : '#F1F5F9') : 'linear-gradient(135deg,#0e7490,#0891b2,#06b6d4)', border: 'none', cursor: signers.length === 0 ? 'not-allowed' : 'pointer', fontFamily: 'inherit', fontSize: 9.5, fontWeight: 800, color: signers.length === 0 ? t.textMuted : '#fff', boxShadow: signers.length === 0 ? 'none' : '0 3px 10px rgba(8,145,178,.35)' }}><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12" /></svg> Mark All as Signed</button>
              )}
              {stage === 3 && allSigned && (
                <button onClick={onMoveToRepository} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 18px', borderRadius: 9, background: 'linear-gradient(135deg,#059669,#047857)', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 9.5, fontWeight: 800, color: '#fff', boxShadow: '0 3px 10px rgba(5,150,105,.35)' }}>Move to Final Repository <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round"><polyline points="9 18 15 12 9 6" /></svg></button>
              )}
              {/* Stage 4 — store finalized agreement */}
              {stage === 4 && (
                <button onClick={onSave} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 18px', borderRadius: 9, background: 'linear-gradient(135deg,#059669,#047857)', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 9.5, fontWeight: 800, color: '#fff', boxShadow: '0 3px 10px rgba(5,150,105,.35)' }}><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12" /></svg> Store in Repository</button>
              )}
            </div>
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
            {/* Rejection banner — shown when an approver rejected this draft */}
            {approval === 'rejected' && (
              <div style={{ borderRadius: 11, border: `1.5px solid ${t.dark ? 'rgba(239,68,68,.4)' : '#FECACA'}`, background: t.dark ? 'rgba(239,68,68,.1)' : '#FEF2F2', padding: '9px 11px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={t.dark ? '#fca5a5' : '#DC2626'} strokeWidth="2.4" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></svg>
                  <span style={{ fontSize: 8.5, fontWeight: 800, color: t.dark ? '#fca5a5' : '#DC2626', textTransform: 'uppercase', letterSpacing: '.08em' }}>Returned by Approver</span>
                </div>
                <div style={{ fontSize: 9, color: t.dark ? '#fecaca' : '#991B1B', lineHeight: 1.5 }}>{rejReason || 'The approver requested changes before this agreement can proceed.'}</div>
              </div>
            )}
            {/* Version History trigger */}
            <button onClick={() => setVhOpen(true)} style={{ width: '100%', padding: '9px 12px', borderRadius: 11, border: `1.5px solid ${t.dark ? 'rgba(124,58,237,.3)' : '#DDD6FE'}`, background: t.surface, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <div style={{ width: 26, height: 26, borderRadius: 8, background: 'linear-gradient(135deg,#7C3AED,#5B21B6)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"><polyline points="12 8 12 12 14 14" /><path d="M3.05 11a9 9 0 1 1 .5 4m-.5 5v-5h5" /></svg></div>
                <div style={{ textAlign: 'left' }}><div style={{ fontSize: 9, fontWeight: 800, color: t.dark ? '#ddd6fe' : '#3B0764' }}>Version History</div><div style={{ fontSize: 7.5, color: t.dark ? '#a78bfa' : '#A78BFA', marginTop: 1 }}>View &amp; download all versions</div></div>
              </div>
              <span style={{ padding: '2px 8px', borderRadius: 10, background: 'linear-gradient(135deg,#7C3AED,#5B21B6)', fontSize: 7.5, fontWeight: 800, color: '#fff' }}>{versions.length ? `${versions.length} ver` : 'v1'}</span>
            </button>
            {/* Stage 3 — counterparty signing tracker */}
            {stage === 3 && (
              <div style={{ borderRadius: 11, border: `1.5px solid ${t.dark ? 'rgba(6,182,212,.3)' : '#A5F3FC'}`, background: t.surface, overflow: 'hidden' }}>
                <div style={{ padding: '7px 10px', background: t.dark ? 'rgba(6,182,212,.14)' : 'linear-gradient(110deg,#ECFEFF,#CFFAFE)', borderBottom: `1px solid ${t.dark ? 'rgba(6,182,212,.25)' : '#A5F3FC'}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 7, fontWeight: 800, color: t.dark ? '#67e8f9' : '#0E7490', letterSpacing: '.1em', textTransform: 'uppercase' }}>Signing Status</span>
                  <span style={{ fontSize: 7, fontWeight: 700, color: t.dark ? '#67e8f9' : '#0891b2' }}>{signers.filter(s => s.signed).length}/{signers.length} signed</span>
                </div>
                <div style={{ padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 7 }}>
                  {signers.length === 0 && <div style={{ fontSize: 9, color: t.textMuted, textAlign: 'center', padding: 8 }}>No recipients yet.</div>}
                  {signers.map((s, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 8px', borderRadius: 9, background: t.dark ? 'rgba(255,255,255,.03)' : '#F8FEFF', border: `1.5px solid ${s.signed ? (t.dark ? 'rgba(16,185,129,.3)' : '#A7F3D0') : (t.dark ? 'rgba(6,182,212,.2)' : '#CFFAFE')}` }}>
                      <div style={{ width: 24, height: 24, borderRadius: 7, background: s.signed ? 'linear-gradient(135deg,#059669,#047857)' : 'linear-gradient(135deg,#0891b2,#0e7490)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><span style={{ fontSize: 8.5, fontWeight: 800, color: '#fff' }}>{(s.name || '?').slice(0, 2).toUpperCase()}</span></div>
                      <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 9, fontWeight: 800, color: t.textStrong, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.name}</div><div style={{ fontSize: 7.5, color: t.textMuted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.role || s.email || '—'}</div></div>
                      {s.signed
                        ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '3px 7px', borderRadius: 8, background: t.dark ? 'rgba(16,185,129,.16)' : '#ECFDF5', fontSize: 7, fontWeight: 800, color: t.dark ? '#6ee7b7' : '#059669' }}><svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round"><polyline points="20 6 9 17 4 12" /></svg>Signed</span>
                        : <button onClick={() => onRecordSignature({ index: i })} style={{ padding: '3px 8px', borderRadius: 8, border: 'none', background: 'linear-gradient(135deg,#0891b2,#0e7490)', color: '#fff', fontSize: 7, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' }}>Mark Signed</button>}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {/* Agreement summary */}
            <div style={{ borderRadius: 11, border: `1.5px solid ${t.dark ? 'rgba(124,58,237,.25)' : '#EDE9FE'}`, background: t.surface }}>
              <div style={{ padding: '6px 10px', background: t.dark ? 'rgba(124,58,237,.14)' : 'linear-gradient(110deg,#EDE9FE,#F3F0FF)', borderBottom: `1px solid ${t.dark ? 'rgba(124,58,237,.25)' : '#DDD6FE'}`, display: 'flex', justifyContent: 'space-between' }}><span style={{ fontSize: 7, fontWeight: 800, color: t.dark ? '#c4b5fd' : '#6D28D9', letterSpacing: '.1em', textTransform: 'uppercase' }}>Agreement Summary</span><span style={{ fontSize: 7, color: t.dark ? '#a78bfa' : '#A78BFA', fontWeight: 600 }}>{code}</span></div>
              <div style={{ padding: '8px 10px 4px' }}>{summary.map(([k, v]) => (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 6, padding: '4px 0', borderBottom: `1px solid ${t.dark ? 'rgba(148,163,184,.1)' : '#FAF8FF'}` }}><span style={{ fontSize: 7.5, fontWeight: 700, color: t.textMuted, textTransform: 'uppercase', letterSpacing: '.06em' }}>{k}</span><span style={{ fontSize: 8.5, fontWeight: 700, color: t.textStrong, textAlign: 'right' }}>{v}</span></div>
              ))}</div>
            </div>
            {/* Approvers & review status */}
            <div style={{ borderRadius: 11, border: `1.5px solid ${t.dark ? 'rgba(124,58,237,.25)' : '#EDE9FE'}`, background: t.surface }}>
              <div style={{ padding: '6px 10px', background: t.dark ? 'rgba(124,58,237,.14)' : 'linear-gradient(110deg,#EDE9FE,#F3F0FF)', borderBottom: `1px solid ${t.dark ? 'rgba(124,58,237,.25)' : '#DDD6FE'}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 7, fontWeight: 800, color: t.dark ? '#c4b5fd' : '#6D28D9', letterSpacing: '.1em', textTransform: 'uppercase' }}>Approvers &amp; Review Status</span>
                {(() => {
                  const lbl = approval === 'approved' ? 'Approved' : approval === 'rejected' ? 'Rejected' : stage === 4 ? 'Completed' : 'Pending';
                  const ok = approval === 'approved' || stage === 4, bad = approval === 'rejected';
                  const bg = ok ? (t.dark ? 'rgba(16,185,129,.16)' : '#ECFDF5') : bad ? (t.dark ? 'rgba(239,68,68,.16)' : '#FEE2E2') : (t.dark ? 'rgba(245,158,11,.16)' : '#FEF3C7');
                  const fg = ok ? (t.dark ? '#6ee7b7' : '#059669') : bad ? (t.dark ? '#fca5a5' : '#DC2626') : (t.dark ? '#fcd34d' : '#D97706');
                  return <span style={{ padding: '2px 7px', borderRadius: 10, background: bg, border: `1px solid ${fg}33`, fontSize: 7, fontWeight: 700, color: fg }}>● {lbl}</span>;
                })()}
              </div>
              <div style={{ padding: '10px 10px 14px' }}>
                {(() => {
                  const ok = approval === 'approved' || stage >= 4, bad = approval === 'rejected';
                  const stBg = ok ? (t.dark ? 'rgba(16,185,129,.16)' : '#ECFDF5') : bad ? (t.dark ? 'rgba(239,68,68,.16)' : '#FEE2E2') : (t.dark ? 'rgba(245,158,11,.16)' : '#FEF3C7');
                  const stFg = ok ? (t.dark ? '#6ee7b7' : '#059669') : bad ? (t.dark ? '#fca5a5' : '#DC2626') : (t.dark ? '#fcd34d' : '#D97706');
                  return (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 9px', borderRadius: 9, background: t.dark ? 'rgba(255,255,255,.03)' : 'linear-gradient(135deg,#FAFBFF,#F5F0FF)', border: `1.5px solid ${t.dark ? 'rgba(124,58,237,.2)' : '#EDE9FE'}`, marginBottom: 14 }}>
                  <div style={{ width: 28, height: 28, borderRadius: 8, background: 'linear-gradient(135deg,#F97316,#EA580C)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><span style={{ fontSize: 10, fontWeight: 800, color: '#fff' }}>{apprInit}</span></div>
                  <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 9.5, fontWeight: 800, color: t.textStrong, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{apprName}</div><div style={{ display: 'flex', gap: 3, marginTop: 3 }}><span style={{ fontSize: 6.5, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: t.dark ? 'rgba(245,158,11,.16)' : '#FEF3C7', color: t.dark ? '#fcd34d' : '#D97706' }}>APPROVER</span><span style={{ fontSize: 6.5, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: t.dark ? 'rgba(239,68,68,.16)' : '#FEE2E2', color: t.dark ? '#fca5a5' : '#DC2626' }}>Mandatory</span></div></div>
                  <span style={{ padding: '3px 8px', borderRadius: 8, background: stBg, fontSize: 7, fontWeight: 700, color: stFg }}>{ok ? 'Approved' : bad ? 'Rejected' : 'Pending'}</span>
                </div>
                  );
                })()}
                {/* Send Reminder — enabled only once the draft has been sent for approval */}
                <button onClick={() => sentForApproval && setReminded(true)} disabled={!sentForApproval || reminded} title={sentForApproval ? '' : 'Send the draft for approval first'} style={{ width: '100%', marginBottom: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '8px', borderRadius: 9, border: `1.5px solid ${reminded ? (t.dark ? 'rgba(16,185,129,.4)' : '#A7F3D0') : sentForApproval ? (t.dark ? 'rgba(124,58,237,.4)' : '#C4B5FD') : (t.dark ? 'rgba(148,163,184,.2)' : '#E2E8F0')}`, background: reminded ? (t.dark ? 'rgba(16,185,129,.12)' : '#ECFDF5') : sentForApproval ? (t.dark ? 'rgba(124,58,237,.14)' : '#F5F0FF') : (t.dark ? 'rgba(255,255,255,.02)' : '#F8FAFC'), cursor: sentForApproval && !reminded ? 'pointer' : 'not-allowed', opacity: sentForApproval ? 1 : .55, fontFamily: 'inherit' }}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={reminded ? (t.dark ? '#6ee7b7' : '#059669') : sentForApproval ? (t.dark ? '#c4b5fd' : '#7C3AED') : (t.dark ? '#94a3b8' : '#94A3B8')} strokeWidth="2.2" strokeLinecap="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></svg>
                  <span style={{ fontSize: 9, fontWeight: 800, color: reminded ? (t.dark ? '#6ee7b7' : '#059669') : sentForApproval ? (t.dark ? '#c4b5fd' : '#6D28D9') : (t.dark ? '#94a3b8' : '#94A3B8') }}>{reminded ? 'Reminder Sent' : 'Send Reminder'}</span>
                </button>
                <div style={{ fontSize: 7, fontWeight: 800, color: t.textMuted, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 6 }}><div style={{ height: 1, background: t.dark ? 'rgba(148,163,184,.15)' : '#EDE9FE', flex: 1 }} />Review Timeline<div style={{ height: 1, background: t.dark ? 'rgba(148,163,184,.15)' : '#EDE9FE', flex: 1 }} /></div>
                <TimelineItem t={t} tone="done" title="Draft Submitted" badge="Done" sub="Agreement drafted & submitted for internal review" />
                <TimelineItem t={t} tone={approval === 'approved' || stage >= 3 ? 'done' : 'active'} title="Internal Review" badge={approval === 'approved' || stage >= 3 ? 'Done' : approval === 'rejected' ? 'Returned' : 'Active'} sub={approval === 'approved' ? `Approved by ${apprName}` : approval === 'rejected' ? `Returned by ${apprName} for changes` : `${apprName} reviewing the agreement`} last={stage < 3} />
                {stage >= 3 && <TimelineItem t={t} tone={stage === 4 ? 'done' : 'active'} title={stage === 4 ? 'Signed & Stored' : 'Counterparty Signing'} badge={stage === 4 ? 'Done' : allSigned ? 'Signed' : 'Active'} sub={stage === 4 ? 'Final signed agreement archived' : allSigned ? 'All parties signed — ready to store' : 'Awaiting counterparty signature'} last />}
              </div>
            </div>
          </div>
        </div>
      </div>

      {vhOpen && <VersionHistoryModal t={t} code={code} workingId={workingId} versions={versions} onClose={() => setVhOpen(false)} />}
      {signingOpen && <SendForSigningModal t={t} cps={cps} onClose={() => setSigningOpen(false)} onSend={(recipients, days) => { setSigningOpen(false); onSendForSigning(recipients, days); }} />}
    </div>
  );
}

/* ── Version History — every draft / revision / decision / signing event, each downloadable as PDF ── */
/* ── Send for Signing & Negotiation — pick recipients (counterparties + contact + days) ── */
function SendForSigningModal({ t, cps, onClose, onSend }: { t: OpsTokens; cps: CP[]; onClose: () => void; onSend: (recipients: { name: string; email: string; role: string; contact: string }[], days: number | null) => void }) {
  const toast = useToast();
  const [rows, setRows] = useState(() => cps.map(c => ({ name: c.name, email: c.email || '', role: c.badge || 'Counterparty', contact: '', selected: true })));
  const [days, setDays] = useState('14');
  const toggle = (i: number) => setRows(rs => rs.map((r, j) => j === i ? { ...r, selected: !r.selected } : r));
  const setField = (i: number, k: 'contact' | 'email', v: string) => setRows(rs => rs.map((r, j) => j === i ? { ...r, [k]: v } : r));
  const submit = () => {
    const chosen = rows.filter(r => r.selected).map(({ name, email, role, contact }) => ({ name, email, role, contact }));
    if (chosen.length === 0) { toast.error('No recipients', 'Select at least one party to send for signing.'); return; }
    onSend(chosen, days ? Number(days) : null);
  };
  const ipt: React.CSSProperties = { width: '100%', height: 30, padding: '0 10px', border: `1.5px solid ${t.searchBorder}`, borderRadius: 8, fontSize: 10, fontFamily: 'inherit', color: t.text, outline: 'none', background: t.dark ? 'rgba(255,255,255,.04)' : '#fff', boxSizing: 'border-box' };
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 9999999, background: 'rgba(15,23,42,.55)', backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 'min(560px,94vw)', maxHeight: '84vh', background: t.surface, borderRadius: 16, border: `1.5px solid ${t.dark ? 'rgba(6,182,212,.35)' : '#A5F3FC'}`, boxShadow: '0 24px 70px rgba(0,0,0,.4)', display: 'flex', flexDirection: 'column', overflow: 'hidden', fontFamily: "'Rubik',system-ui,sans-serif" }}>
        <div style={{ padding: '13px 16px', background: 'linear-gradient(118deg,#0e7490,#0891b2,#06b6d4)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <div style={{ width: 30, height: 30, borderRadius: 9, background: 'rgba(255,255,255,.18)', border: '1.5px solid rgba(255,255,255,.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg></div>
            <div><div style={{ fontSize: 13, fontWeight: 800, color: '#fff' }}>Send for Signing &amp; Negotiation</div><div style={{ fontSize: 9, color: 'rgba(255,255,255,.7)', marginTop: 1 }}>Choose the counterparties who must sign</div></div>
          </div>
          <button onClick={onClose} style={{ width: 26, height: 26, borderRadius: 8, border: 'none', background: 'rgba(255,255,255,.18)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg></button>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {rows.length === 0 && <div style={{ fontSize: 11, color: t.textMuted, textAlign: 'center', padding: 24 }}>No counterparties on this agreement. Add them in Stage 1 first.</div>}
          {rows.map((r, i) => (
            <div key={i} style={{ borderRadius: 12, border: `1.5px solid ${r.selected ? (t.dark ? 'rgba(6,182,212,.35)' : '#A5F3FC') : (t.dark ? 'rgba(148,163,184,.2)' : '#E2E8F0')}`, background: r.selected ? (t.dark ? 'rgba(6,182,212,.08)' : '#F8FEFF') : (t.dark ? 'rgba(255,255,255,.02)' : '#F8FAFC'), padding: '10px 12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: r.selected ? 9 : 0 }}>
                <button onClick={() => toggle(i)} style={{ width: 20, height: 20, borderRadius: 6, border: `1.5px solid ${r.selected ? '#0891b2' : (t.dark ? 'rgba(148,163,184,.4)' : '#CBD5E1')}`, background: r.selected ? 'linear-gradient(135deg,#0891b2,#0e7490)' : 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{r.selected && <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round"><polyline points="20 6 9 17 4 12" /></svg>}</button>
                <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 11, fontWeight: 800, color: t.textStrong, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name || 'Counterparty'}</div><div style={{ fontSize: 8.5, color: t.textMuted }}>{r.role}</div></div>
              </div>
              {r.selected && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <div><div style={{ fontSize: 8, fontWeight: 700, color: t.textMuted, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 3 }}>Contact Person</div><input value={r.contact} onChange={e => setField(i, 'contact', e.target.value)} placeholder="Name of signatory" style={ipt} /></div>
                  <div><div style={{ fontSize: 8, fontWeight: 700, color: t.textMuted, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 3 }}>Email</div><input value={r.email} onChange={e => setField(i, 'email', e.target.value)} placeholder="signatory@company.com" style={ipt} /></div>
                </div>
              )}
            </div>
          ))}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 12, border: `1.5px solid ${t.dark ? 'rgba(124,58,237,.2)' : '#EDE9FE'}`, background: t.dark ? 'rgba(255,255,255,.03)' : '#FAFBFF' }}>
            <div style={{ flex: 1 }}><div style={{ fontSize: 9, fontWeight: 800, color: t.textStrong }}>Days to Sign</div><div style={{ fontSize: 8, color: t.textMuted, marginTop: 1 }}>Deadline for all parties to complete signing</div></div>
            <input type="number" min={1} max={365} value={days} onChange={e => setDays(e.target.value)} style={{ ...ipt, width: 76, textAlign: 'center' }} />
          </div>
        </div>
        <div style={{ flexShrink: 0, padding: '11px 16px', borderTop: `1.5px solid ${t.dark ? 'rgba(124,58,237,.2)' : '#EDE9FE'}`, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onClose} style={{ padding: '8px 16px', borderRadius: 9, border: `1.5px solid ${t.dark ? 'rgba(148,163,184,.25)' : '#E2E8F0'}`, background: 'transparent', color: t.textSub, fontSize: 10, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
          <button onClick={submit} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 18px', borderRadius: 9, border: 'none', background: 'linear-gradient(135deg,#0e7490,#0891b2,#06b6d4)', color: '#fff', fontSize: 10, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit', boxShadow: '0 3px 10px rgba(8,145,178,.35)' }}><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg> Send for Signing</button>
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

/* Draft-editor header action button (frosted on the dark gradient) */
function FrostBtn({ onClick, icon, active, children }: { onClick: () => void; icon: React.ReactNode; active?: boolean; children: React.ReactNode }) {
  return (
    <button onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '5px 9px', borderRadius: 8, border: `1.5px solid rgba(255,255,255,${active ? '.45' : '.3'})`, background: `rgba(255,255,255,${active ? '.22' : '.15'})`, cursor: 'pointer', fontFamily: 'inherit', transition: 'all .15s' }}
      onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,.3)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,.55)'; }}
      onMouseLeave={e => { e.currentTarget.style.background = `rgba(255,255,255,${active ? '.22' : '.15'})`; e.currentTarget.style.borderColor = `rgba(255,255,255,${active ? '.45' : '.3'})`; }}>
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">{icon}</svg>
      <span style={{ fontSize: 8.5, fontWeight: 700, color: '#fff' }}>{children}</span>
    </button>
  );
}

/* Draft-editor toolbar icon button + divider */
function ToolBtn({ t, active, title, onClick, children }: { t: OpsTokens; active?: boolean; title?: string; onClick?: () => void; children: React.ReactNode }) {
  return (
    <button type="button" title={title} onMouseDown={e => e.preventDefault()} onClick={onClick} style={{ width: 24, height: 24, borderRadius: 5, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', background: active ? (t.dark ? 'rgba(124,58,237,.2)' : '#EDE9FE') : 'none', color: t.dark ? '#c4b5fd' : '#6D28D9' }}
      onMouseEnter={e => (e.currentTarget.style.background = t.dark ? 'rgba(124,58,237,.2)' : '#EDE9FE')} onMouseLeave={e => (e.currentTarget.style.background = active ? (t.dark ? 'rgba(124,58,237,.2)' : '#EDE9FE') : 'none')}>
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">{children}</svg>
    </button>
  );
}
function ToolDiv({ t }: { t: OpsTokens }) {
  return <span style={{ width: 1, height: 16, background: t.dark ? 'rgba(124,58,237,.25)' : '#DDD6FE', margin: '0 4px', flexShrink: 0 }} />;
}

function MiniLabel({ t, green, children }: { t: OpsTokens; green?: boolean; children: React.ReactNode }) {
  return <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 8, fontWeight: 800, letterSpacing: '.1em', textTransform: 'uppercase', color: green ? (t.dark ? '#34d399' : '#059669') : (t.dark ? '#a78bfa' : '#7C3AED') }}><span style={{ width: 3, height: 10, borderRadius: 2, background: green ? 'linear-gradient(180deg,#059669,#047857)' : 'linear-gradient(180deg,#7C3AED,#5B21B6)', flexShrink: 0 }} />{children}</label>;
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
  const plain = draft.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  const words = plain ? plain.split(/\s+/).length : 0;
  const score = Math.min(100, Math.round(words * 1.5));
  const FIELDS = [['SIGNATURE', 'signature'], ['PERSON NAME', 'person_name'], ['COMPANY NAME', 'company_name'], ['EMAIL', 'email'], ['CONTACT NO', 'contact_no'], ['ADDRESS', 'address']];
  const cardBd = `1.5px solid ${t.dark ? 'rgba(124,58,237,.25)' : '#EDE9FE'}`;
  return (
    <div className="ctc-mid-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Placeholder fields */}
      <div style={{ background: t.surface, borderRadius: 12, border: cardBd, overflow: 'hidden', boxShadow: '0 2px 10px rgba(109,40,217,.07)' }}>
        <div style={{ padding: '9px 12px', background: t.dark ? 'rgba(124,58,237,.14)' : 'linear-gradient(110deg,#EDE9FE 0%,#F3F0FF 40%,#E8E2FF 100%)', borderBottom: `1.5px solid ${t.dark ? 'rgba(124,58,237,.25)' : '#DDD6FE'}`, display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 22, height: 22, borderRadius: 7, background: 'linear-gradient(135deg,#7C3AED,#5B21B6)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"><polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" /></svg></div>
          <div><div style={{ fontSize: 10, fontWeight: 800, color: t.dark ? '#ddd6fe' : '#3B0764' }}>Standard Placeholder Fields</div><div style={{ fontSize: 7.5, color: t.dark ? '#a78bfa' : '#7C3AED', fontWeight: 500 }}>Click a field to insert into the editor</div></div>
        </div>
        <div className="ctc-mid-scroll" style={{ padding: 10, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7, maxHeight: 118, overflowY: 'auto' }}>
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

function OrgDetail({ t, label, text }: { t: OpsTokens; label?: string; text: string }) {
  return <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="#A78BFA" strokeWidth="2.2" strokeLinecap="round"><circle cx="12" cy="12" r="10" /></svg>{label && <span style={{ fontSize: 8, fontWeight: 700, color: t.textMuted, textTransform: 'uppercase', letterSpacing: '.04em' }}>{label}</span>}<span style={{ fontSize: 9, color: t.textSub, fontWeight: 600 }}>{text}</span></div>;
}

function Field({ t, label, green, children }: { t: OpsTokens; label: string; green?: boolean; children: React.ReactNode }) {
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}><label style={{ fontSize: 8, fontWeight: 800, letterSpacing: '.1em', textTransform: 'uppercase', color: green ? (t.dark ? '#34d399' : '#059669') : (t.dark ? '#a78bfa' : '#7C3AED') }}>{label}</label>{children}</div>;
}

/* ── Counterparty picker modal ── */
/* ── Stage-1 Step-3 "Submit & Send for Approval" → Review & Approval Workflow popup ── */
type Approver = { name: string; email: string; initials: string; grad: string; tags: [string, string][]; locked: boolean };
function ApprovalWorkflowModal({ t, orgName, onClose, onSubmit }: { t: OpsTokens; orgName: string; onClose: () => void; onSubmit: (data: { approvers: { name: string; email: string; role: string; mandatory: boolean }[]; days: number; reminder: number }) => void }) {
  const [approvers, setApprovers] = useState<Approver[]>([]);
  const [days, setDays] = useState(7);
  const [reminder, setReminder] = useState(5);
  const [pickerOpen, setPickerOpen] = useState(false);
  const addApprover = () => setPickerOpen(true);
  const mergeApprovers = (picked: Approver[]) => {
    setApprovers(list => { const have = new Set(list.map(a => a.email || a.name)); return [...list, ...picked.filter(p => !have.has(p.email || p.name))]; });
    setPickerOpen(false);
  };
  const tagBg = (c: string) => c === '#D97706' ? (t.dark ? 'rgba(245,158,11,.16)' : '#FEF3C7') : c === '#DC2626' ? (t.dark ? 'rgba(239,68,68,.16)' : '#FEE2E2') : (t.dark ? 'rgba(124,58,237,.18)' : '#EDE9FE');
  const stepper = (label: string, val: number, set: (n: number) => void, unit?: string, icon?: React.ReactNode) => (
    <div style={{ padding: '9px 11px', borderRadius: 10, border: `1.5px solid ${t.dark ? 'rgba(124,58,237,.25)' : '#EDE9FE'}`, background: t.dark ? 'rgba(255,255,255,.03)' : '#FAFBFF' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6 }}>{icon}<div style={{ fontSize: 7.5, fontWeight: 700, color: t.dark ? '#a78bfa' : '#7C3AED', letterSpacing: '.08em', textTransform: 'uppercase' }}>{label}</div></div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button onClick={() => set(Math.max(1, val - 1))} style={{ width: 22, height: 22, borderRadius: 6, border: `1.5px solid ${t.dark ? 'rgba(124,58,237,.3)' : '#DDD6FE'}`, background: t.dark ? 'rgba(124,58,237,.14)' : '#F8F6FF', cursor: 'pointer', color: t.dark ? '#c4b5fd' : '#6D28D9', fontSize: 12, flexShrink: 0 }}>−</button>
        <div style={{ flex: 1, textAlign: 'center', display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 2 }}><span style={{ fontSize: 15, fontWeight: 800, color: t.textStrong }}>{val}</span>{unit && <span style={{ fontSize: 9, fontWeight: 600, color: t.textMuted }}>{unit}</span>}</div>
        <button onClick={() => set(val + 1)} style={{ width: 22, height: 22, borderRadius: 6, border: `1.5px solid ${t.dark ? 'rgba(124,58,237,.3)' : '#DDD6FE'}`, background: t.dark ? 'rgba(124,58,237,.14)' : '#F8F6FF', cursor: 'pointer', color: t.dark ? '#c4b5fd' : '#6D28D9', fontSize: 12, flexShrink: 0 }}>+</button>
      </div>
    </div>
  );
  return (
    <div onClick={e => { if (e.target === e.currentTarget) onClose(); }} style={{ position: 'fixed', inset: 0, zIndex: 9999999, background: 'rgba(15,7,50,.72)', backdropFilter: 'blur(10px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, fontFamily: "'Rubik', system-ui, sans-serif" }}>
      <div style={{ width: '100%', maxWidth: 420, borderRadius: 20, overflow: 'hidden', boxShadow: '0 40px 80px rgba(109,40,217,.3)', border: `1.5px solid ${t.dark ? 'rgba(124,58,237,.4)' : 'rgba(124,58,237,.25)'}` }}>
        {/* header */}
        <div style={{ background: 'linear-gradient(118deg,#3B0764,#5B21B6,#7C3AED,#8B5CF6)', padding: '14px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 34, height: 34, borderRadius: 10, background: 'rgba(255,255,255,.18)', border: '1.5px solid rgba(255,255,255,.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"><polyline points="9 11 12 14 22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg></div>
            <div><div style={{ fontSize: 7.5, fontWeight: 700, color: 'rgba(255,255,255,.6)', letterSpacing: '.12em', textTransform: 'uppercase' }}>Stage 02</div><div style={{ fontSize: 14, fontWeight: 800, color: '#fff' }}>Review &amp; Approval Workflow</div><div style={{ fontSize: 8.5, color: 'rgba(255,255,255,.65)', fontWeight: 500 }}>Select approvers for this agreement draft</div></div>
          </div>
          <button onClick={onClose} style={{ width: 28, height: 28, borderRadius: 8, background: 'rgba(255,255,255,.12)', border: '1.5px solid rgba(255,255,255,.22)', color: '#fff', cursor: 'pointer', fontSize: 13, flexShrink: 0 }}>✕</button>
        </div>
        {/* body */}
        <div style={{ background: t.surface, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* initiator */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 12px', borderRadius: 11, background: t.dark ? 'rgba(124,58,237,.14)' : 'linear-gradient(135deg,#EDE9FE,#DDD6FE)', border: `1.5px solid ${t.dark ? 'rgba(124,58,237,.35)' : '#C4B5FD'}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
              <div style={{ width: 32, height: 32, borderRadius: 9, background: 'linear-gradient(135deg,#7C3AED,#5B21B6)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><span style={{ fontSize: 11, fontWeight: 800, color: '#fff' }}>{orgInitials(orgName)}</span></div>
              <div><div style={{ fontSize: 7, fontWeight: 700, color: t.dark ? '#a78bfa' : '#7C3AED', letterSpacing: '.1em', textTransform: 'uppercase' }}>Created By</div><div style={{ fontSize: 11, fontWeight: 800, color: t.dark ? '#ddd6fe' : '#3B0764' }}>{orgName}</div></div>
            </div>
            <span style={{ padding: '3px 9px', borderRadius: 20, background: 'linear-gradient(135deg,#7C3AED,#5B21B6)', fontSize: 8, fontWeight: 800, color: '#fff' }}>Initiator</span>
          </div>
          {/* approvers */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 7 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 3, height: 10, borderRadius: 2, background: 'linear-gradient(180deg,#7C3AED,#5B21B6)' }} /><span style={{ fontSize: 8, fontWeight: 800, color: t.dark ? '#c4b5fd' : '#4C1D95', letterSpacing: '.08em', textTransform: 'uppercase' }}>Approvers</span></div>
              <button onClick={addApprover} style={{ display: 'flex', alignItems: 'center', gap: 3, padding: '3px 8px', borderRadius: 6, border: `1.5px solid ${t.dark ? 'rgba(124,58,237,.3)' : '#DDD6FE'}`, background: t.dark ? 'rgba(124,58,237,.14)' : '#F5F0FF', cursor: 'pointer', fontFamily: 'inherit' }}><svg width="8" height="8" viewBox="0 0 16 16" fill="none" stroke={t.dark ? '#c4b5fd' : '#7C3AED'} strokeWidth="2.5" strokeLinecap="round"><line x1="8" y1="2" x2="8" y2="14" /><line x1="2" y1="8" x2="14" y2="8" /></svg><span style={{ fontSize: 8, fontWeight: 700, color: t.dark ? '#c4b5fd' : '#6D28D9' }}>Add Approver</span></button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {approvers.map((a, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 10, border: `1.5px solid ${t.dark ? 'rgba(124,58,237,.2)' : '#EDE9FE'}`, background: t.dark ? 'rgba(255,255,255,.03)' : '#FAFBFF' }}>
                  <div style={{ width: 30, height: 30, borderRadius: 9, background: `linear-gradient(135deg,${a.grad})`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><span style={{ fontSize: 10, fontWeight: 800, color: '#fff' }}>{a.initials}</span></div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 1, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 10, fontWeight: 800, color: t.textStrong }}>{a.name}</span>
                      {a.tags.map(([label, clr]) => <span key={label} style={{ padding: '1px 6px', borderRadius: 4, background: tagBg(clr), border: `1px solid ${clr}55`, fontSize: 7, fontWeight: 700, color: clr }}>{label}</span>)}
                    </div>
                    <div style={{ fontSize: 8, color: t.textMuted, fontWeight: 500 }}>{a.email}</div>
                  </div>
                  {a.locked
                    ? <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={t.dark ? '#a78bfa' : '#C4B5FD'} strokeWidth="2" strokeLinecap="round" style={{ flexShrink: 0 }}><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
                    : <button onClick={() => setApprovers(list => list.filter((_, j) => j !== i))} title="Remove" style={{ width: 20, height: 20, borderRadius: 6, border: 'none', background: 'rgba(239,68,68,.1)', cursor: 'pointer', color: '#EF4444', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg></button>}
                </div>
              ))}
              <div onClick={addApprover} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 10, border: `1.5px dashed ${t.dark ? 'rgba(124,58,237,.3)' : '#DDD6FE'}`, background: t.dark ? 'rgba(255,255,255,.02)' : '#FAFBFF', cursor: 'pointer' }}>
                <div style={{ width: 30, height: 30, borderRadius: 9, background: t.dark ? 'rgba(124,58,237,.2)' : 'linear-gradient(135deg,#EDE9FE,#DDD6FE)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke={t.dark ? '#c4b5fd' : '#7C3AED'} strokeWidth="2.5" strokeLinecap="round"><line x1="8" y1="2" x2="8" y2="14" /><line x1="2" y1="8" x2="14" y2="8" /></svg></div>
                <span style={{ fontSize: 9, fontWeight: 600, color: t.dark ? '#c4b5fd' : '#7C3AED' }}>+ Add Member</span>
              </div>
            </div>
          </div>
          {/* days + reminder */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {stepper('Days to Approve', days, setDays)}
            {stepper('Reminder', reminder, setReminder, 'd', <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke={t.dark ? '#a78bfa' : '#7C3AED'} strokeWidth="2.2" strokeLinecap="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></svg>)}
          </div>
          {/* submit */}
          <button disabled={approvers.length === 0} onClick={() => onSubmit({ approvers: approvers.map(a => ({ name: a.name, email: a.email, role: a.tags[0]?.[0] ?? '', mandatory: a.locked || a.tags.some(tg => tg[0] === 'Mandatory') })), days, reminder })} title={approvers.length === 0 ? 'Add at least one approver' : ''} style={{ width: '100%', padding: 11, borderRadius: 11, border: 'none', background: approvers.length === 0 ? (t.dark ? 'rgba(124,58,237,.25)' : '#C4B5FD') : 'linear-gradient(135deg,#4C1D95,#6D28D9,#7C3AED)', color: '#fff', fontFamily: 'inherit', fontSize: 11.5, fontWeight: 800, cursor: approvers.length === 0 ? 'not-allowed' : 'pointer', opacity: approvers.length === 0 ? .6 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, boxShadow: approvers.length === 0 ? 'none' : '0 4px 14px rgba(109,40,217,.4)' }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
            Submit for Approval
          </button>
        </div>
      </div>
      {pickerOpen && <ApproverPickerModal t={t} existing={approvers.map(a => a.email || a.name)} onClose={() => setPickerOpen(false)} onAdd={mergeApprovers} />}
    </div>
  );
}

/* Multi-select "Select Approvers" picker — the client, the branch and the
 * employees under the active branch (GET /clm/ctc-contracts/approver-candidates). */
const ROLE_FG = ['#D97706', '#059669', '#DC2626', '#7C3AED', '#0891b2', '#DB2777'];
function ApproverPickerModal({ t, existing, onClose, onAdd }: { t: OpsTokens; existing: string[]; onClose: () => void; onAdd: (a: Approver[]) => void }) {
  type Emp = { name: string; email: string; title: string; role: string; roleFg: string; initials: string; grad: string };
  const [emps, setEmps] = useState<Emp[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sel, setSel] = useState<Set<string>>(new Set());
  useEffect(() => {
    let alive = true;
    api.get('/clm/ctc-contracts/approver-candidates')
      .then(res => {
        if (!alive) return;
        const rows = (res.data?.data ?? (Array.isArray(res.data) ? res.data : [])) as Record<string, unknown>[];
        setEmps(rows.map((e, i) => {
          const ut = String(e.user_type ?? '');
          const branchName = e.branch_name ? String(e.branch_name) : '';
          const role = ut === 'client_admin' ? 'CLIENT' : ut === 'branch_user' ? 'BRANCH' : (branchName || 'EMPLOYEE').toUpperCase();
          const roleFg = ut === 'client_admin' ? '#7C3AED' : ut === 'branch_user' ? '#0891b2' : ROLE_FG[role.split('').reduce((s, c) => s + c.charCodeAt(0), 0) % ROLE_FG.length];
          const title = ut === 'client_admin' ? 'Client Administrator' : ut === 'branch_user' ? (branchName ? `${branchName} · Branch` : 'Branch') : branchName;
          const name = String(e.name ?? 'User');
          return { name, email: String(e.email ?? ''), title, role, roleFg, initials: orgInitials(name), grad: ORG_GRADS[i % ORG_GRADS.length] };
        }));
        setLoading(false);
      })
      .catch(() => { if (alive) { setEmps([]); setLoading(false); } });
    return () => { alive = false; };
  }, []);
  const q = search.trim().toLowerCase();
  const list = q ? emps.filter(e => (e.name + e.role + e.title + e.email).toLowerCase().includes(q)) : emps;
  const keyOf = (e: Emp) => e.email || e.name;
  const toggle = (k: string) => setSel(s => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const confirm = () => {
    const picked: Approver[] = emps.filter(e => sel.has(keyOf(e))).map(e => ({ name: e.name, email: e.email, initials: e.initials, grad: e.grad, tags: e.role ? [[e.role, e.roleFg]] as [string, string][] : [], locked: false }));
    onAdd(picked);
  };
  const roleBg = (fg: string) => t.dark ? fg + '28' : fg + '1f';
  return (
    <div onClick={e => { if (e.target === e.currentTarget) onClose(); }} style={{ position: 'fixed', inset: 0, zIndex: 99999999, background: 'rgba(15,7,50,.72)', backdropFilter: 'blur(10px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, fontFamily: "'Rubik', system-ui, sans-serif" }}>
      <div style={{ width: '100%', maxWidth: 520, maxHeight: '86vh', borderRadius: 20, overflow: 'hidden', display: 'flex', flexDirection: 'column', boxShadow: '0 40px 80px rgba(109,40,217,.3)', border: `1.5px solid ${t.dark ? 'rgba(124,58,237,.4)' : 'rgba(124,58,237,.25)'}` }}>
        <div style={{ background: 'linear-gradient(118deg,#5B21B6,#6D28D9,#7C3AED,#8B5CF6)', padding: '14px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 34, height: 34, borderRadius: 10, background: 'rgba(255,255,255,.18)', border: '1.5px solid rgba(255,255,255,.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><line x1="19" y1="8" x2="19" y2="14" /><line x1="22" y1="11" x2="16" y2="11" /></svg></div>
            <div><div style={{ fontSize: 14, fontWeight: 800, color: '#fff' }}>Select Approvers</div><div style={{ fontSize: 8.5, color: 'rgba(255,255,255,.7)', fontWeight: 500 }}>Client, branch &amp; employees — select multiple</div></div>
          </div>
          <button onClick={onClose} style={{ width: 28, height: 28, borderRadius: 8, background: 'rgba(255,255,255,.12)', border: '1.5px solid rgba(255,255,255,.22)', color: '#fff', cursor: 'pointer', fontSize: 13, flexShrink: 0 }}>✕</button>
        </div>
        <div style={{ background: t.surface, padding: 14, flexShrink: 0 }}>
          <div style={{ position: 'relative' }}>
            <svg style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#A78BFA" strokeWidth="2.4" strokeLinecap="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name or role…" autoFocus style={{ width: '100%', padding: '10px 12px 10px 34px', border: `1.5px solid ${t.dark ? 'rgba(124,58,237,.4)' : '#C4B5FD'}`, borderRadius: 10, fontSize: 12, fontFamily: 'inherit', color: t.text, background: t.dark ? 'rgba(255,255,255,.04)' : '#fff', outline: 'none', boxSizing: 'border-box' }} />
          </div>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', background: t.surface, padding: '0 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {list.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '32px 0', fontSize: 11, fontWeight: 600, color: t.textMuted }}>{loading ? 'Loading employees…' : 'No employees found'}</div>
          ) : list.map(e => {
            const k = keyOf(e); const on = sel.has(k); const already = existing.includes(k);
            return (
              <div key={k} onClick={() => !already && toggle(k)} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '11px 12px', borderRadius: 12, border: `1.5px solid ${on ? '#7C3AED' : (t.dark ? 'rgba(124,58,237,.2)' : '#EDE9FE')}`, background: already ? (t.dark ? 'rgba(255,255,255,.02)' : '#F8FAFC') : on ? (t.dark ? 'rgba(124,58,237,.14)' : '#F5F0FF') : t.surface, cursor: already ? 'not-allowed' : 'pointer', opacity: already ? .55 : 1 }}>
              <div style={{ width: 18, height: 18, borderRadius: 5, flexShrink: 0, border: `2px solid ${on || already ? '#7C3AED' : (t.dark ? 'rgba(148,163,184,.4)' : '#C4B5FD')}`, background: on || already ? '#7C3AED' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{(on || already) && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12" /></svg>}</div>
                <div style={{ width: 38, height: 38, borderRadius: 10, background: `linear-gradient(135deg,${e.grad})`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><span style={{ fontSize: 12, fontWeight: 800, color: '#fff' }}>{e.initials}</span></div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}><span style={{ fontSize: 12.5, fontWeight: 800, color: t.textStrong }}>{e.name}</span>{e.role && <span style={{ padding: '1px 7px', borderRadius: 5, background: roleBg(e.roleFg), border: `1px solid ${e.roleFg}55`, fontSize: 7.5, fontWeight: 800, color: e.roleFg, letterSpacing: '.04em' }}>{e.role}</span>}{already && <span style={{ fontSize: 8, fontWeight: 700, color: t.textMuted }}>· added</span>}</div>
                  {e.title && <div style={{ fontSize: 10, color: t.textMuted, fontWeight: 500, marginTop: 1 }}>{e.title}</div>}
                </div>
              </div>
            );
          })}
          <div style={{ height: 4 }} />
        </div>
        <div style={{ background: t.surface, borderTop: `1.5px solid ${t.dark ? 'rgba(124,58,237,.2)' : '#EDE9FE'}`, padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexShrink: 0 }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: t.dark ? '#a78bfa' : '#7C3AED' }}>{sel.size > 0 ? `${sel.size} selected` : 'Select approvers from the list'}</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={onClose} style={{ padding: '8px 16px', borderRadius: 9, background: t.dark ? 'rgba(255,255,255,.05)' : '#fff', border: `1.5px solid ${t.dark ? 'rgba(124,58,237,.3)' : '#DDD6FE'}`, cursor: 'pointer', fontFamily: 'inherit', fontSize: 11, fontWeight: 700, color: t.textSub }}>Cancel</button>
            <button onClick={confirm} disabled={sel.size === 0} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 18px', borderRadius: 9, background: 'linear-gradient(135deg,#6D28D9,#7C3AED)', border: 'none', cursor: sel.size === 0 ? 'not-allowed' : 'pointer', opacity: sel.size === 0 ? .55 : 1, fontFamily: 'inherit', fontSize: 11, fontWeight: 800, color: '#fff', boxShadow: '0 3px 10px rgba(109,40,217,.35)' }}><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12" /></svg>Add Selected</button>
          </div>
        </div>
      </div>
    </div>
  );
}

type PickEntry = { id: string; name: string; initials: string; country: string; phone: string; email: string; grad: string };
const toEntry = (name: unknown, country: unknown, phone: unknown, email: unknown, id: unknown, i: number): PickEntry => ({
  id: String(id ?? i), name: String(name || '—'), initials: orgInitials(String(name || '')), country: String(country || '—'), phone: String(phone || '—'), email: String(email || '—'), grad: ORG_GRADS[i % ORG_GRADS.length],
});

function CpPicker({ t, slot, onClose, onPick }: { t: OpsTokens; slot: number; onClose: () => void; onPick: (cp: CP) => void }) {
  const [tab, setTab] = useState<'buyer' | 'consignee' | 'supplier'>('buyer');
  const [search, setSearch] = useState('');
  const [pending, setPending] = useState<PickEntry | null>(null);
  const [referred, setReferred] = useState('');
  const [dir, setDir] = useState<Record<'buyer' | 'consignee' | 'supplier', PickEntry[]>>({ buyer: [], consignee: [], supplier: [] });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    const rowsOf = (d: unknown): Record<string, unknown>[] => Array.isArray(d) ? d as Record<string, unknown>[] : ((d as { data?: unknown })?.data as Record<string, unknown>[] ?? []);
    Promise.allSettled([api.get('/customers', { params: { tab: 'all' } }), api.get('/consignees'), api.get('/vendors', { params: { per_page: 200 } })]).then(([cu, co, ve]) => {
      if (!alive) return;
      const buyer = cu.status === 'fulfilled' ? rowsOf(cu.value.data).map((r, i) => toEntry(r.company ?? r.company_name, r.country, r.phone, r.email, r.id, i)) : [];
      const consignee = co.status === 'fulfilled' ? rowsOf(co.value.data).map((r, i) => toEntry(r.company ?? r.company_name, r.country, r.phone, r.email, r.id, i)) : [];
      const supplier = ve.status === 'fulfilled' ? rowsOf(ve.value.data).map((r, i) => { const a = (r.primaryAddress ?? r.primary_address) as Record<string, unknown> | undefined; return toEntry(r.company_name ?? r.vendor_name, a?.city ?? r.country, a?.contact_no ?? r.mobile, r.primary_email ?? a?.email, r.vendor_code ?? r.id, i); }) : [];
      setDir({ buyer, consignee, supplier });
      setLoading(false);
    });
    return () => { alive = false; };
  }, []);

  const list = dir[tab].filter(p => (p.name + p.id + p.email).toLowerCase().includes(search.toLowerCase()));
  const tabBadge = tab === 'buyer'
    ? { label: 'Buyer', bg: t.dark ? 'rgba(8,145,178,.18)' : '#E0F7FA', bd: t.dark ? 'rgba(6,182,212,.4)' : '#A5F3FC', fg: t.dark ? '#67e8f9' : '#0891b2' }
    : tab === 'supplier'
      ? { label: 'Supplier', bg: t.dark ? 'rgba(16,185,129,.16)' : '#ECFDF5', bd: t.dark ? 'rgba(16,185,129,.4)' : '#A7F3D0', fg: t.dark ? '#6ee7b7' : '#059669' }
      : { label: 'Consignee', bg: t.dark ? 'rgba(124,58,237,.18)' : '#EDE9FE', bd: t.dark ? 'rgba(124,58,237,.4)' : '#C4B5FD', fg: t.dark ? '#c4b5fd' : '#7C3AED' };

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
              {(['buyer', 'consignee', 'supplier'] as const).map(tb => (
                <button key={tb} onClick={() => { setTab(tb); setSearch(''); }} style={{ flex: 1, padding: '6px 0', borderRadius: 7, border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 10, fontWeight: 700, textTransform: 'capitalize', background: tab === tb ? 'linear-gradient(135deg,#7C3AED,#6D28D9)' : 'transparent', color: tab === tb ? '#fff' : t.textMuted, boxShadow: tab === tb ? '0 2px 6px rgba(109,40,217,.3)' : 'none' }}>{tb}</button>
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
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
                      <span style={{ flexShrink: 0, fontFamily: "'Geist Mono', monospace", fontSize: 7, fontWeight: 800, color: tabBadge.fg, background: tabBadge.bg, border: `1px solid ${tabBadge.bd}`, padding: '1px 5px', borderRadius: 5, letterSpacing: '.02em' }}>{p.id}</span>
                      <span style={{ fontSize: 9, fontWeight: 700, color: t.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 2 }}>
                      <span style={{ flexShrink: 0, fontSize: 6.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.04em', color: tabBadge.fg, background: tabBadge.bg, border: `1px solid ${tabBadge.bd}`, padding: '1px 5px', borderRadius: 20 }}>{tabBadge.label}</span>
                      <span style={{ fontSize: 7, color: t.textMuted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.country}</span>
                    </div>
                  </div>
                </div>
              ))}
              {!list.length && <div style={{ textAlign: 'center', padding: '20px 0', fontSize: 8.5, color: t.textMuted }}>{loading ? 'Loading…' : `No ${tab}s found`}</div>}
            </div>
          </div>
        ) : (
          <div style={{ padding: '12px 14px 14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 10 }}>
              <div style={{ width: 34, height: 34, borderRadius: 9, background: `linear-gradient(135deg,${pending.grad})`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><span style={{ fontSize: 11, fontWeight: 800, color: '#fff' }}>{pending.initials}</span></div>
              <div style={{ minWidth: 0 }}><div style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ fontFamily: "'Geist Mono', monospace", fontSize: 7, fontWeight: 800, color: tabBadge.fg, background: tabBadge.bg, border: `1px solid ${tabBadge.bd}`, padding: '1px 5px', borderRadius: 5 }}>{pending.id}</span><span style={{ fontSize: 11, fontWeight: 800, color: t.textStrong }}>{pending.name}</span></div><div style={{ fontSize: 8, color: t.textMuted, marginTop: 1 }}>{pending.email}</div></div>
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
.ctc-editor:empty:before { content: attr(data-ph); color: #94a3b8; pointer-events: none; white-space: pre-wrap; }
.ctc-editor h1, .ctc-editor h2, .ctc-editor h3 { font-weight: 800; margin: 8px 0 4px; }
.ctc-editor ul, .ctc-editor ol { padding-left: 22px; margin: 6px 0; }
`;
